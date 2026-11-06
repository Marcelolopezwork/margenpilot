-- ============================================================================
-- Pruebas de invariantes de F1.
-- Se ejecutan en CI contra un Postgres real, después de aplicar las
-- migraciones. Si algo falla, la ejecución aborta con FALLO: <qué>.
-- Casos de docs/TEST_PLAN.md: D-1, D-1b, D-2 y el barrido de DELETE.
-- ============================================================================

\set ON_ERROR_STOP on

create or replace function assert_true(p_cond boolean, p_msg text) returns void
language plpgsql as $$
begin
  if p_cond is not true then raise exception 'FALLO: %', p_msg; end if;
end $$;

create or replace function assert_raises(p_sql text, p_expect text, p_msg text) returns void
language plpgsql as $$
declare v_raised boolean := false; v_err text;
begin
  begin
    execute p_sql;
  exception when others then
    v_raised := true; v_err := sqlerrm;
  end;
  if not v_raised then
    raise exception 'FALLO: % — se esperaba un error y no hubo ninguno', p_msg;
  end if;
  if position(p_expect in v_err) = 0 then
    raise exception 'FALLO: % — error inesperado: %', p_msg, v_err;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Montaje: dos usuarios, dos organizaciones
-- ---------------------------------------------------------------------------

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'marcelo@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'otro@test.local');

set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
select create_organization('Org A', 'PEN');

set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';
select create_organization('Org B', 'USD');

do $$
begin
  perform assert_true((select count(*) from organizations) = 2, 'se crearon dos organizaciones');
  perform assert_true(
    (select count(*) from subscriptions where plan_code = 'free') = 2,
    'toda organización nace con plan free, nunca sin plan ni en internal');
  perform assert_true(
    (select count(*) from memberships where role = 'owner' and status = 'active') = 2,
    'cada organización nace con su owner');
  perform assert_true(
    (select count(*) from financial_categories) = 18,
    'cada organización nace con sus 9 categorías por defecto');
end $$;

-- ---------------------------------------------------------------------------
-- D-2 · Aislamiento entre organizaciones
-- ---------------------------------------------------------------------------

set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
set role authenticated;

do $$
begin
  perform assert_true((select count(*) from organizations) = 1,
    'el usuario A ve una sola organización');
  perform assert_true((select count(*) from organizations where slug = 'org-b') = 0,
    'el usuario A no ve la organización de B');
  perform assert_true((select count(*) from memberships) = 1,
    'el usuario A no ve membresías ajenas');
  perform assert_true((select count(*) from financial_categories) = 9,
    'el usuario A solo ve sus categorías');
  perform assert_true((select count(*) from plans) = 2,
    'el cliente ve los dos planes públicos y no el internal');
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- D-1 · Los límites del plan free
-- ---------------------------------------------------------------------------

do $$
declare v_org uuid;
begin
  select id into v_org from organizations where slug = 'org-a';

  -- La primera entidad entra.
  insert into legal_entities (organization_id, legal_name, country, default_currency_code)
  values (v_org, 'Entidad Uno', 'PE', 'PEN');

  -- La segunda no: free permite una.
  perform assert_raises(
    format('insert into legal_entities (organization_id, legal_name, country, default_currency_code)
            values (%L, ''Entidad Dos'', ''PE'', ''PEN'')', v_org),
    'plan_limit_reached',
    'free rechaza la segunda entidad legal');

  -- La segunda moneda tampoco.
  perform assert_raises(
    format('insert into organization_currencies (organization_id, currency_code)
            values (%L, ''USD'')', v_org),
    'plan_limit_reached',
    'free rechaza la segunda moneda');

  -- Con plan internal sí: sin filas en plan_entitlements no hay límite.
  update subscriptions set plan_code = 'internal' where organization_id = v_org;

  insert into legal_entities (organization_id, legal_name, country, default_currency_code)
  values (v_org, 'Entidad Dos', 'US', 'PEN');
  insert into organization_currencies (organization_id, currency_code) values (v_org, 'USD');

  perform assert_true((select count(*) from legal_entities where organization_id = v_org) = 2,
    'internal permite las dos entidades');
end $$;

-- ---------------------------------------------------------------------------
-- INV-9 y ADR-16 · la cuenta no puede salirse de su libro ni de su moneda
-- ---------------------------------------------------------------------------

do $$
declare v_org uuid; v_entity uuid; v_other_org uuid; v_other_entity uuid;
begin
  select id into v_org from organizations where slug = 'org-a';
  select id into v_other_org from organizations where slug = 'org-b';
  select id into v_entity from legal_entities where organization_id = v_org and legal_name = 'Entidad Uno';

  -- Org B nació en USD, así que su entidad opera en USD.
  insert into legal_entities (organization_id, legal_name, country, default_currency_code)
  values (v_other_org, 'Entidad de B', 'US', 'USD')
  returning id into v_other_entity;

  -- Moneda habilitada y entidad propia: pasa.
  insert into cash_accounts (organization_id, legal_entity_id, name, currency_code)
  values (v_org, v_entity, 'BCP Soles', 'PEN');

  -- Primera rama del disparador: org B no tiene soles habilitados.
  perform assert_raises(
    format('insert into cash_accounts (organization_id, legal_entity_id, name, currency_code)
            values (%L, %L, ''Cuenta en soles'', ''PEN'')', v_other_org, v_other_entity),
    'currency_not_enabled',
    'una cuenta no puede estar en una moneda que su organización no habilitó');

  -- Segunda rama: la moneda cuadra, pero la entidad es de otra organización.
  -- Con PEN nunca se llegaba aquí, porque saltaba primero la rama de moneda.
  perform assert_raises(
    format('insert into cash_accounts (organization_id, legal_entity_id, name, currency_code)
            values (%L, %L, ''Cuenta cruzada'', ''USD'')', v_other_org, v_entity),
    'entity_mismatch',
    'una cuenta no puede apuntar a una entidad de otra organización');

  perform assert_true(
    (select currency_code from cash_accounts where organization_id = v_org limit 1) = 'PEN',
    'la cuenta conserva su moneda');
end $$;

-- ---------------------------------------------------------------------------
-- Un solo impuesto por defecto por entidad
-- ---------------------------------------------------------------------------

do $$
declare v_org uuid; v_entity uuid;
begin
  select id into v_org from organizations where slug = 'org-a';
  select id into v_entity from legal_entities where organization_id = v_org and legal_name = 'Entidad Uno';

  insert into tax_rates (organization_id, legal_entity_id, name, rate, is_default)
  values (v_org, v_entity, 'IGV 18%', 18.0000, true);

  perform assert_raises(
    format('insert into tax_rates (organization_id, legal_entity_id, name, rate, is_default)
            values (%L, %L, ''Otro'', 10, true)', v_org, v_entity),
    'tax_rates_one_default_per_entity',
    'no puede haber dos impuestos por defecto en la misma entidad');
end $$;

-- ---------------------------------------------------------------------------
-- INV-7 · nada financiero se borra
-- ---------------------------------------------------------------------------

do $$
declare v_count int; v_list text;
begin
  -- INV-7 · nada financiero se borra ni se trunca.
  select count(*), coalesce(string_agg(distinct table_name || ':' || privilege_type, ', '), '')
    into v_count, v_list
  from information_schema.role_table_grants
  where grantee = 'authenticated'
    and table_schema = 'public'
    and privilege_type in ('DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER');

  perform assert_true(v_count = 0,
    format('authenticated solo puede leer, insertar y actualizar; sobra esto: %s', v_list));

  -- Quien no ha iniciado sesión no tiene nada que hacer en public.
  select count(*), coalesce(string_agg(distinct table_name || ':' || privilege_type, ', '), '')
    into v_count, v_list
  from information_schema.role_table_grants
  where grantee = 'anon' and table_schema = 'public';

  perform assert_true(v_count = 0,
    format('anon no debe tener ningún privilegio en public, y tiene: %s', v_list));

  -- Guarda genérica, y la más importante de las tres: toda tabla de public con
  -- RLS encendida. Es la que caza una tabla nueva de F2, F3 o F4 que se olvide
  -- de encenderla, y la que habría cazado que currencies, plans y
  -- plan_entitlements estaban abiertas de par en par.
  select count(*), coalesce(string_agg(c.relname, ', ' order by c.relname), '')
    into v_count, v_list
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;

  perform assert_true(v_count = 0,
    format('toda tabla de public necesita row level security; sin ella: %s', v_list));
end $$;

-- ---------------------------------------------------------------------------
-- El plan no se elige desde el cliente
-- ---------------------------------------------------------------------------

do $$
begin
  perform assert_raises(
    'select create_organization(''Intento'', ''PEN'', ''internal'')',
    'does not exist',
    'create_organization no acepta un plan por parámetro');
end $$;

-- ---------------------------------------------------------------------------
-- profiles · cada uno el suyo y nada más
-- ---------------------------------------------------------------------------

set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
set role authenticated;

do $$
declare v_raised boolean := false;
begin
  insert into profiles (id, full_name, email)
  values ('11111111-1111-1111-1111-111111111111', 'Marcelo', 'marcelo@test.local');

  perform assert_true((select count(*) from profiles) = 1, 'cada uno ve su propio perfil');

  begin
    insert into profiles (id, full_name) values ('22222222-2222-2222-2222-222222222222', 'Ajeno');
  exception when others then v_raised := true;
  end;
  perform assert_true(v_raised, 'nadie puede crear el perfil de otro');
end $$;

set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

do $$
begin
  perform assert_true((select count(*) from profiles) = 0, 'nadie ve el perfil de otro');
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- Techo de organizaciones por usuario
--
-- create_organization es un RPC abierto a cualquiera con sesión. Sin techo,
-- una llamada en bucle fabrica organizaciones sin fin.
-- ---------------------------------------------------------------------------

set request.jwt.claim.sub = '22222222-2222-2222-2222-222222222222';

do $$
begin
  -- B ya es dueño de una; con dos más llega al tope.
  perform create_organization('Org B2', 'USD');
  perform create_organization('Org B3', 'USD');

  perform assert_raises(
    'select create_organization(''Org B4'', ''USD'')',
    'too_many_organizations',
    'un usuario no puede fabricar organizaciones sin fin');

  perform assert_raises(
    'select create_organization(''Org rara'', ''XXX'')',
    'unknown_currency',
    'la moneda de alta tiene que existir');
end $$;

-- ---------------------------------------------------------------------------
-- F2 · Catálogos · el comercial cotiza con las fichas y NO ve los costos
--
-- Es la aceptación de F2-5, y la forma de comprobarla importa: no se mira si
-- la interfaz esconde una columna, se cuentan las filas que devuelve la base
-- a cada rol. Cero filas, no columnas vacías.
-- ---------------------------------------------------------------------------

reset role;
reset request.jwt.claim.sub;

-- Org A ya está en internal desde D-1, así que no hay tope de miembros.
insert into auth.users (id, email)
values ('33333333-3333-3333-3333-333333333333', 'comercial@test.local');

insert into memberships (organization_id, user_id, role, status)
select id, '33333333-3333-3333-3333-333333333333', 'commercial', 'active'
from organizations where slug = 'org-a';

insert into service_categories (id, organization_id, name)
select '44444444-4444-4444-4444-444444444444', id, 'Campañas'
from organizations where slug = 'org-a';

-- Una ficha pertenece a una empresa, no al grupo (ADR-16): hay que decir a
-- cuál. El costo de abajo, en cambio, se deja sin entidad a propósito: eso es
-- un costo compartido, y es un estado válido.
insert into services (id, organization_id, legal_entity_id, code, name, category_id, suggested_currency_code, default_fee_pct)
select '55555555-5555-5555-5555-555555555555', o.id, e.id, 'CAMP-01', 'Campaña de lanzamiento',
       '44444444-4444-4444-4444-444444444444', 'PEN', 80
from organizations o
join legal_entities e on e.organization_id = o.id and e.legal_name = 'Entidad Uno'
where o.slug = 'org-a';

insert into cost_items (id, organization_id, name, kind, unit, unit_cost, currency_code)
select '66666666-6666-6666-6666-666666666666', id, 'Dirección creativa', 'role', 'hora', 120.0000, 'PEN'
from organizations where slug = 'org-a';

insert into service_cost_lines (organization_id, service_id, cost_item_id, quantity, unit_cost, unit, currency_code)
select id, '55555555-5555-5555-5555-555555555555', '66666666-6666-6666-6666-666666666666',
       12, 120.0000, 'hora', 'PEN'
from organizations where slug = 'org-a';

do $$
begin
  -- Precondición explícita: D-1 habilitó USD en Org A para probar el plan
  -- internal, así que la moneda ajena hay que buscarla en Org B, que nació en
  -- USD y nunca habilitó soles. Si alguien se los habilita, esta aserción
  -- falla con un mensaje claro en vez de dejar la siguiente sin probar nada.
  perform assert_true(
    not exists (
      select 1 from organization_currencies oc
      join organizations o on o.id = oc.organization_id
      where o.slug = 'org-b' and oc.currency_code = 'PEN' and oc.is_enabled),
    'Org B no tiene soles habilitados, que es lo que hace útil la prueba siguiente');

  perform assert_raises(
    $q$insert into cost_items (organization_id, name, unit_cost, currency_code)
       select id, 'En moneda ajena', 10, 'PEN' from organizations where slug = 'org-b'$q$,
    'currency_not_enabled',
    'un ítem de costo no puede usar una moneda que la organización no habilitó');

  perform assert_raises(
    $q$insert into service_cost_lines (organization_id, service_id, quantity, unit_cost, currency_code, label)
       select id, '55555555-5555-5555-5555-555555555555', 1, 10, 'USD', 'Cruzada'
       from organizations where slug = 'org-b'$q$,
    'violates foreign key constraint',
    'una línea de costo no puede colgar de una ficha de otra organización');

  perform assert_raises(
    $q$insert into service_cost_lines (organization_id, service_id, quantity, unit_cost, currency_code)
       select id, '55555555-5555-5555-5555-555555555555', 1, 10, 'PEN'
       from organizations where slug = 'org-a'$q$,
    'violates check constraint',
    'una línea sin ítem de catálogo necesita su propia etiqueta');
end $$;

set role authenticated;

set request.jwt.claim.sub = '33333333-3333-3333-3333-333333333333';
do $$
begin
  perform assert_true((select count(*) from services) = 1,
    'el comercial ve las fichas de servicio: las necesita para cotizar');
  perform assert_true((select count(*) from service_categories) = 1,
    'el comercial ve las categorías del catálogo');
  perform assert_true((select count(*) from cost_items) = 0,
    'el comercial NO ve ningún ítem de costo (F2-5)');
  perform assert_true((select count(*) from service_cost_lines) = 0,
    'el comercial NO ve ninguna línea de costo (F2-5)');
end $$;

set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';
do $$
begin
  perform assert_true((select count(*) from cost_items) = 1,
    'el dueño sí ve los ítems de costo de su organización');
  perform assert_true((select count(*) from service_cost_lines) = 1,
    'el dueño sí ve la composición de costos de su ficha');
end $$;

reset role;

-- ---------------------------------------------------------------------------
-- F2-10 y F2-11 · El estado se mueve por la puerta, y lo emitido no se toca
-- ---------------------------------------------------------------------------
--
-- Estas no son pruebas de interfaz: comprueban que la base no acepta lo que la
-- pantalla no ofrece. Si alguien añadiera mañana un `update` directo del
-- estado, o un grant de más sobre las versiones, aquí se cae.

do $$
begin
  perform assert_true(
    not has_column_privilege('authenticated', 'quotes', 'status', 'update'),
    'authenticated no puede escribir quotes.status: el estado se mueve con las funciones');

  perform assert_true(
    has_column_privilege('authenticated', 'quotes', 'design', 'update'),
    'authenticated sí puede guardar el diseño de la propuesta');

  perform assert_true(
    not has_table_privilege('authenticated', 'quote_versions', 'insert')
    and not has_table_privilege('authenticated', 'quote_versions', 'update'),
    'una versión emitida no se inventa ni se reescribe desde el cliente');

  perform assert_true(
    not has_table_privilege('authenticated', 'quote_events', 'insert'),
    'la bitácora la escribe el disparador, no la aplicación');

  perform assert_true(
    has_table_privilege('authenticated', 'quote_versions', 'select')
    and has_table_privilege('authenticated', 'quote_events', 'select'),
    'lo emitido y la bitácora se leen');

  -- La máquina de estados, en los cuatro casos que importan.
  perform assert_true(app.transicion_de_cotizacion('draft', 'sent'),
    'un borrador se puede emitir');
  perform assert_true(not app.transicion_de_cotizacion('draft', 'approved'),
    'un borrador no puede aprobarse sin haber salido nunca');
  perform assert_true(app.transicion_de_cotizacion('approved', 'void'),
    'una aprobada solo se puede anular');
  perform assert_true(not app.transicion_de_cotizacion('approved', 'negotiation'),
    'lo que el cliente aceptó no vuelve a negociación');
  perform assert_true(not app.transicion_de_cotizacion('void', 'sent'),
    'anulada es terminal');
end $$;

-- ---------------------------------------------------------------------------
-- F2-15 · El cronograma de cobro no mueve dinero, y no se escribe a mano
-- ---------------------------------------------------------------------------
--
-- La trampa que estas aserciones vigilan es la de §4.5: que una cuota
-- prevista acabe contando como cuenta por cobrar. Mientras nazca `planned` y
-- la única puerta de escritura compruebe la suma, la proyección y la cartera
-- siguen siendo cosas distintas.

do $$
begin
  perform assert_true(
    not has_table_privilege('authenticated', 'payment_schedule_items', 'insert')
    and not has_table_privilege('authenticated', 'payment_schedule_items', 'update')
    and not has_table_privilege('authenticated', 'payment_schedule_items', 'delete'),
    'una cuota no se escribe a mano: la única puerta es guardar_cronograma');

  perform assert_true(
    has_table_privilege('authenticated', 'payment_schedule_items', 'select'),
    'el cronograma se lee');

  perform assert_true(
    (select relrowsecurity and relforcerowsecurity
       from pg_class where oid = 'payment_schedule_items'::regclass),
    'el cronograma tiene RLS, y forzada también para el dueño de la tabla');

  -- Nace como proyección. Si algún día el valor por defecto cambiara a
  -- 'documented', «Por cobrar» empezaría a contar dinero que nadie facturó.
  perform assert_true(
    (select column_default from information_schema.columns
      where table_name = 'payment_schedule_items' and column_name = 'status')
    like '%planned%',
    'una cuota nace prevista, no documentada (revisión §4.5)');

  -- Las claves que impiden cruzar los dos libros (ADR-16). Se comprueban por
  -- existencia y no por nombre de columna: lo que importa es que estén.
  perform assert_true(
    (select count(*) from pg_constraint
      where conrelid = 'payment_schedule_items'::regclass and contype = 'f') >= 4,
    'la cuota ata su entidad, su cotización, su versión y su cuenta de destino');

  perform assert_true(
    exists (select 1 from pg_constraint
             where conrelid = 'cash_accounts'::regclass and contype = 'u'
               and pg_get_constraintdef(oid) like '%legal_entity_id, currency_code)'),
    'una cuenta de destino solo se puede referenciar con su entidad y su moneda');

  -- La asimetría del catálogo, fijada para que nadie la "arregle" sin querer:
  -- una ficha es de una empresa y un costo puede ser de las dos (ChatGPT, el
  -- hosting). Si alguien pone la entidad obligatoria en cost_items, los costos
  -- compartidos dejan de existir y hay que duplicarlos.
  perform assert_true(
    (select attnotnull from pg_attribute
      where attrelid = 'services'::regclass and attname = 'legal_entity_id'),
    'una ficha de servicio tiene que decir de qué empresa es');

  perform assert_true(
    not (select attnotnull from pg_attribute
          where attrelid = 'cost_items'::regclass and attname = 'legal_entity_id'),
    'un costo puede no tener empresa: eso es un costo compartido');
end $$;

select 'TODAS LAS PRUEBAS DE F1 Y F2 PASARON · 53 aserciones' as resultado;
