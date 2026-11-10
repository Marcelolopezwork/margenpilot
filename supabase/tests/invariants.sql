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

-- ---------------------------------------------------------------------------
-- F3-1 · el dinero existe y tiene una sola fuente
-- ---------------------------------------------------------------------------
--
-- Lo que estas aserciones vigilan es la regla de la que cuelga todo lo
-- financiero, INV-1: el saldo de una cuenta sale de `cash_movements` y de
-- ningún otro sitio. Si algún día alguien concede un `insert` suelto sobre la
-- tabla, o apaga la RLS forzada, o escribe una segunda fórmula de saldo, el
-- producto deja de poder responder «cuánto tengo» con una sola cifra.

do $$
declare
  v_org     uuid;
  v_entity  uuid;
  v_cuenta  uuid;
  v_usuario uuid := '11111111-1111-1111-1111-111111111111';
  v_mov     uuid;
begin
  -- Las tres tablas del dinero se leen y no se escriben. La única puerta son
  -- las funciones, que es donde viven las comprobaciones.
  perform assert_true(
    not has_table_privilege('authenticated', 'cash_movements', 'insert')
    and not has_table_privilege('authenticated', 'cash_movements', 'update')
    and not has_table_privilege('authenticated', 'cash_movements', 'delete'),
    'el libro de caja no se escribe a mano');

  perform assert_true(
    not has_table_privilege('authenticated', 'billing_documents', 'insert')
    and not has_table_privilege('authenticated', 'billing_documents', 'update')
    and not has_table_privilege('authenticated', 'billing_documents', 'delete'),
    'un documento no se escribe a mano: nadie se declara pagado (INV-3)');

  perform assert_true(
    not has_table_privilege('authenticated', 'payment_allocations', 'insert')
    and not has_table_privilege('authenticated', 'payment_allocations', 'update')
    and not has_table_privilege('authenticated', 'payment_allocations', 'delete'),
    'una asignación no se escribe a mano: asignar no crea dinero');

  perform assert_true(
    (select bool_and(relrowsecurity and relforcerowsecurity)
       from pg_class
      where oid in ('cash_movements'::regclass, 'billing_documents'::regclass,
                    'payment_allocations'::regclass)),
    'las tres tablas del dinero tienen RLS, y forzada también para el dueño');

  -- La vista filtra con las políticas de quien pregunta. Sin esto sería un
  -- agujero: cualquiera leería el saldo de cualquier organización.
  perform assert_true(
    (select reloptions::text from pg_class where oid = 'account_balances'::regclass)
      like '%security_invoker=%',
    'la vista de saldos respeta las políticas de quien pregunta');

  -- La clase de flujo se deduce del tipo y no se puede teclear. Es lo que
  -- hace que una transferencia no pueda sumar ingreso (INV-5).
  perform assert_true(
    (select attgenerated <> '' from pg_attribute
      where attrelid = 'cash_movements'::regclass and attname = 'flow_class'),
    'la clase de flujo se deduce del tipo, no se elige (INV-5)');

  -- La clave que impone a la vez INV-9 (el dinero vive en la moneda de su
  -- cuenta) y ADR-16 (los dos libros no se mezclan), sin ningún disparador.
  perform assert_true(
    exists (select 1 from pg_constraint
             where conrelid = 'cash_movements'::regclass and contype = 'f'
               and confrelid = 'cash_accounts'::regclass
               and array_length(conkey, 1) = 4),
    'un movimiento ata su cuenta, su organización, su entidad y su moneda');

  perform assert_true(
    (select count(*) from pg_constraint
      where conrelid = 'payment_allocations'::regclass and contype = 'f'
        and array_length(conkey, 1) = 4) >= 3,
    'una asignación no puede cruzar monedas ni libros (INV-4)');

  -- Las cuatro puertas son definer con search_path fijo. Una definer sin
  -- search_path es una escalada de privilegios esperando a que alguien cree
  -- una función con el mismo nombre en otro esquema.
  perform assert_true(
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('emitir_documento', 'registrar_cobro',
                          'registrar_movimiento', 'anular_movimiento')
        and p.prosecdef
        and p.proconfig::text like '%search_path%') = 4,
    'las cuatro puertas del dinero son definer con search_path fijo');

  -- Y ahora el comportamiento: el saldo es la resta, y anular lo corrige.
  select id into v_org from organizations where slug = 'org-a';
  select id into v_entity from legal_entities
   where organization_id = v_org and legal_name = 'Entidad Uno';
  select id into v_cuenta from cash_accounts
   where organization_id = v_org and name = 'BCP Soles';

  insert into cash_movements (organization_id, cash_account_id, legal_entity_id,
    direction, amount, currency_code, value_date, description, created_by)
  values (v_org, v_cuenta, v_entity, 'in', 1000.00, 'PEN', current_date, 'Cobro', v_usuario)
  returning id into v_mov;

  insert into cash_movements (organization_id, cash_account_id, legal_entity_id,
    direction, amount, currency_code, value_date, description, created_by)
  values (v_org, v_cuenta, v_entity, 'out', 350.00, 'PEN', current_date, 'Hosting', v_usuario);

  perform assert_true(
    (select balance from account_balances where cash_account_id = v_cuenta) = 650.00,
    'el saldo es la suma de entradas menos la de salidas, y nada más (INV-1)');

  -- Anular no borra: marca. Y el saldo se corrige solo, porque la vista no
  -- cuenta lo anulado. Por eso la contrapartida de INV-7 no se crea: restaría
  -- el dinero dos veces.
  update cash_movements set is_void = true, void_reason = 'se registró dos veces'
   where id = v_mov;

  perform assert_true(
    (select balance from account_balances where cash_account_id = v_cuenta) = -350.00,
    'un movimiento anulado deja de contar en el saldo sin borrarse (INV-7)');

  perform assert_true(
    (select count(*) from cash_movements where cash_account_id = v_cuenta) = 2,
    'anular no borra la fila: la historia queda completa');
end $$;

-- ---------------------------------------------------------------------------
-- F3-3 · un gasto recurrente es una regla, no dinero
-- ---------------------------------------------------------------------------
--
-- La tentación de esta tabla es que genere movimientos sola: «el día 5 sale el
-- hosting, lo apunto yo». Eso rompería INV-1 de la peor manera posible, porque
-- el saldo diría que pagaste algo que el banco no ha cobrado. Estas aserciones
-- están para que nadie lo «mejore» así.

-- El reclamo de permisos de abajo necesita saber quién pregunta.
set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

do $$
declare
  v_org    uuid;
  v_entity uuid;
  v_cuenta uuid;
  v_saldo  numeric;
  v_gasto  uuid;
begin
  perform assert_true(
    not has_table_privilege('authenticated', 'recurring_expenses', 'insert')
    and not has_table_privilege('authenticated', 'recurring_expenses', 'update')
    and not has_table_privilege('authenticated', 'recurring_expenses', 'delete'),
    'un gasto fijo no se escribe a mano: la puerta es guardar_gasto_recurrente');

  perform assert_true(
    has_table_privilege('authenticated', 'recurring_expenses', 'select'),
    'los gastos fijos se leen');

  perform assert_true(
    (select relrowsecurity and relforcerowsecurity
       from pg_class where oid = 'recurring_expenses'::regclass),
    'los gastos fijos tienen RLS, y forzada también para el dueño');

  -- Pagar un gasto en dólares desde la cuenta en soles no es un error que se
  -- valide: es una fila que no existe (ADR-16).
  perform assert_true(
    exists (select 1 from pg_constraint
             where conrelid = 'recurring_expenses'::regclass and contype = 'f'
               and confrelid = 'cash_accounts'::regclass
               and array_length(conkey, 1) = 4),
    'un gasto fijo ata su cuenta, su organización, su entidad y su moneda');

  perform assert_true(
    exists (select 1 from pg_constraint
             where conrelid = 'recurring_expenses'::regclass and contype = 'u'
               and pg_get_constraintdef(oid) like '%legal_entity_id, currency_code)'),
    'un movimiento solo puede apuntar a un gasto con su entidad y su moneda');

  perform assert_true(
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('guardar_gasto_recurrente', 'archivar_gasto_recurrente')
        and p.prosecdef
        and p.proconfig::text like '%search_path%') = 2,
    'las puertas de los gastos fijos son definer con search_path fijo');

  -- Y lo que de verdad importa: dar de alta un gasto fijo no toca el saldo.
  select id into v_org from organizations where slug = 'org-a';
  select id into v_entity from legal_entities
   where organization_id = v_org and legal_name = 'Entidad Uno';
  select id into v_cuenta from cash_accounts
   where organization_id = v_org and name = 'BCP Soles';

  select balance into v_saldo from account_balances where cash_account_id = v_cuenta;

  insert into recurring_expenses (organization_id, legal_entity_id, label, amount,
    currency_code, cadence, day_of_month, starts_on, cash_account_id, created_by)
  values (v_org, v_entity, 'Hosting', 350.00, 'PEN', 'monthly', 5, current_date,
          v_cuenta, '11111111-1111-1111-1111-111111111111')
  returning id into v_gasto;

  perform assert_true(
    (select balance from account_balances where cash_account_id = v_cuenta) = v_saldo,
    'dar de alta un gasto fijo no mueve ni un céntimo (INV-1)');

  -- Un gasto recurrente se paga; no se cobra. Marcar una entrada como pago de
  -- una suscripción dejaría la proyección creyendo que ese mes está saldado
  -- con dinero que entró.
  perform assert_raises(
    format('select registrar_movimiento(%L, ''in'', 100, ''Colado'', null, ''operating'',
            null, null, null, null, null, %L)', v_cuenta, v_gasto),
    'recurrente_solo_sale',
    'un gasto recurrente no se puede cobrar');
end $$;

reset request.jwt.claim.sub;

-- ---------------------------------------------------------------------------
-- F3-3b · una restricción impide, una puerta explica
-- ---------------------------------------------------------------------------
--
-- La clave compuesta ya impedía pagar un gasto en dólares desde la cuenta en
-- soles, y eso está bien: es una fila que no existe. Pero lo hacía como
-- violación de clave ajena, que en pantalla se leía «falta un dato
-- relacionado, o el que elegiste ya no existe»: verdad e inútil. Estas
-- aserciones vigilan que el que contesta sea el gate, con los nombres dentro.

set request.jwt.claim.sub = '11111111-1111-1111-1111-111111111111';

do $$
declare
  v_org   uuid;
  v_uno   uuid;
  v_dos   uuid;
  v_pen   uuid;
  v_usd   uuid;
  v_gasto uuid;
begin
  select id into v_org from organizations where slug = 'org-a';
  select id into v_uno from legal_entities
   where organization_id = v_org and legal_name = 'Entidad Uno';
  select id into v_dos from legal_entities
   where organization_id = v_org and legal_name = 'Entidad Dos';
  select id into v_pen from cash_accounts
   where organization_id = v_org and name = 'BCP Soles';

  insert into cash_accounts (organization_id, legal_entity_id, name, currency_code)
  values (v_org, v_dos, 'Mercury USD', 'USD')
  returning id into v_usd;

  -- Lo que cargó Marcelo: una suscripción en dólares a nombre de la empresa
  -- que solo tiene cuenta en soles. Se guarda —la proyección la cuenta— pero
  -- no hay ninguna cuenta que pueda pagarla.
  select id into v_gasto from guardar_gasto_recurrente(
    p_entity => v_uno, p_label => 'Suscripción en dólares', p_amount => 200,
    p_currency => 'USD', p_cadence => 'monthly', p_day => 30);

  perform assert_raises(
    format('select registrar_movimiento(%L, ''out'', 200, ''Suscripción'', null,
            ''operating'', null, null, null, null, null, %L)', v_pen, v_gasto),
    '«Suscripción en dólares» está en USD y BCP Soles es una cuenta en PEN',
    'el gate dice qué gasto, en qué moneda y desde qué cuenta');

  perform assert_raises(
    format('select registrar_movimiento(%L, ''out'', 200, ''Suscripción'', null,
            ''operating'', null, null, null, null, null, %L)', v_usd, v_gasto),
    '«Suscripción en dólares» lo paga Entidad Uno y Mercury USD es una cuenta de Entidad Dos',
    'el gate nombra las dos empresas cuando el dinero cruzaría de libro');

  perform assert_raises(
    format('select registrar_movimiento(%L, ''out'', 200, ''Suscripción'', null,
            ''operating'', null, null, null, null, null, %L)',
           v_usd, gen_random_uuid()),
    'gasto_no_encontrado',
    'un gasto que no es de la organización no existe');

  -- Mientras ningún movimiento lo señale, el gasto se puede mudar de empresa:
  -- no hay enlace que romper.
  perform guardar_gasto_recurrente(
    p_entity => v_dos, p_label => 'Suscripción en dólares', p_amount => 200,
    p_currency => 'USD', p_id => v_gasto, p_cadence => 'monthly', p_day => 30);

  perform assert_true(
    (select legal_entity_id from recurring_expenses where id = v_gasto) = v_dos,
    'un gasto sin pagos se puede mudar de empresa');

  -- Y entonces ya se paga, desde la cuenta que sí es de su libro.
  perform registrar_movimiento(v_usd, 'out', 200, 'Suscripción de noviembre',
    null, 'operating', null, null, null, null, null, v_gasto);

  perform assert_true(
    (select balance from account_balances where cash_account_id = v_usd) = -200.00,
    'el pago de un gasto fijo mueve el saldo como cualquier otra salida (INV-1)');

  perform assert_true(
    (select source = 'recurring' and recurring_expense_id = v_gasto
       from cash_movements where cash_account_id = v_usd),
    'el movimiento queda marcado con el gasto que saldaba');

  -- Con un pago dentro, mudarlo se rechaza y dice cuántos hay.
  perform assert_raises(
    format('select guardar_gasto_recurrente(%L, ''Suscripción en dólares'', 200,
            ''USD'', %L)', v_uno, v_gasto),
    'ya tiene 1 pago(s) registrado(s)',
    'con pagos dentro, la empresa y la moneda no se mudan, y lo dice con la cifra');

  -- Pero el precio sí sube: eso no rompe ningún enlace.
  perform guardar_gasto_recurrente(
    p_entity => v_dos, p_label => 'Suscripción en dólares', p_amount => 250,
    p_currency => 'USD', p_id => v_gasto, p_cadence => 'monthly', p_day => 30);

  perform assert_true(
    (select amount from recurring_expenses where id = v_gasto) = 250.00,
    'subir el precio de un gasto con pagos dentro sí se puede');

  -- «Sale de» tampoco puede apuntar a una cuenta de otro libro.
  perform assert_raises(
    format('select guardar_gasto_recurrente(%L, ''Suscripción en dólares'', 250,
            ''USD'', %L, ''monthly'', null, null, null, %L)',
           v_dos, v_gasto, v_pen),
    'cuenta_de_otro_libro',
    'la cuenta de la que sale un gasto tiene que ser de su empresa y su moneda');
end $$;

-- ---------------------------------------------------------------------------
-- F3-4 · una transferencia no es un ingreso ni un gasto
-- ---------------------------------------------------------------------------
--
-- Lo que estas aserciones vigilan es que mover dinero entre cuentas propias no
-- pueda parecer un ingreso ni un gasto en el lente Resultado, y que no pueda
-- existir media transferencia. Las dos cosas son la misma: si las dos patas no
-- se reconocen como un solo hecho, el dinero aparece o desaparece.

-- El tope de cuentas del plan free son dos y org-a ya las tiene. Lo que se
-- prueba aquí es INV-5, no el plan —que tiene sus propias aserciones—, así que
-- el disparador del tope se silencia mientras se montan las cuentas.
alter table cash_accounts disable trigger cash_accounts_limit;

insert into cash_accounts (organization_id, legal_entity_id, name, currency_code)
select o.id, e.id, 'Caja Chica PEN', 'PEN'
  from organizations o
  join legal_entities e on e.organization_id = o.id and e.legal_name = 'Entidad Uno'
 where o.slug = 'org-a';

insert into cash_accounts (organization_id, legal_entity_id, name, currency_code)
select o.id, e.id, 'BCP Dolares', 'USD'
  from organizations o
  join legal_entities e on e.organization_id = o.id and e.legal_name = 'Entidad Uno'
 where o.slug = 'org-a';

alter table cash_accounts enable trigger cash_accounts_limit;

insert into clients (organization_id, name)
select id, 'Cliente de las pruebas' from organizations where slug = 'org-a';

do $$
declare
  v_org     uuid;
  v_uno     uuid;
  v_usuario uuid := '11111111-1111-1111-1111-111111111111';
  v_pen     uuid;
  v_chica   uuid;
  v_dolar   uuid;
  v_otra    uuid;
  v_t       uuid;
  v_tfx     uuid;
  v_tcom    uuid;
  v_pata    uuid;
  v_doc     uuid;
  v_s0      numeric;
  v_s1      numeric;
begin
  -- La cabecera se lee y no se escribe, como las otras tres tablas del dinero.
  -- Un `insert` suelto sobre `transfers` dejaría escribir una transferencia sin
  -- patas, que es exactamente la fila que no debe existir.
  perform assert_true(
    not has_table_privilege('authenticated', 'transfers', 'insert')
    and not has_table_privilege('authenticated', 'transfers', 'update')
    and not has_table_privilege('authenticated', 'transfers', 'delete'),
    'una transferencia no se escribe a mano: la puerta es la función');

  perform assert_true(
    (select relrowsecurity and relforcerowsecurity
       from pg_class where oid = 'transfers'::regclass),
    'transfers tiene RLS, y forzada también para el dueño');

  -- La tasa no se teclea. Esto es INV-5 hecho estructura: nadie puede guardar
  -- una tasa distinta de la que sale de los dos importes.
  perform assert_true(
    (select attgenerated <> '' from pg_attribute
      where attrelid = 'transfers'::regclass and attname = 'fx_rate'),
    'la tasa aplicada se calcula, no se escribe (INV-5)');

  perform assert_true(
    (select count(*) from pg_constraint
      where conrelid = 'transfers'::regclass and contype = 'f'
        and confrelid = 'cash_accounts'::regclass
        and array_length(conkey, 1) = 4) = 2,
    'cada lado ata su cuenta, su organización, su empresa y su moneda');

  perform assert_true(
    exists (select 1 from pg_constraint
             where conrelid = 'transfers'::regclass
               and conname = 'misma_moneda_mismo_importe'),
    'en la misma moneda, lo que sale es lo que llega');

  perform assert_true(
    exists (select 1 from pg_constraint
             where conrelid = 'cash_movements'::regclass
               and conname = 'pata_sin_transferencia'),
    'un movimiento de tipo transferencia exige su cabecera');

  perform assert_true(
    (select p.prosecdef and p.proconfig::text like '%search_path%'
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'registrar_transferencia'),
    'la puerta de las transferencias es definer con search_path fijo');

  -- Y ahora el comportamiento.
  select id into v_org from organizations where slug = 'org-a';
  select id into v_uno from legal_entities
   where organization_id = v_org and legal_name = 'Entidad Uno';
  select id into v_pen from cash_accounts
   where organization_id = v_org and name = 'BCP Soles';
  select id into v_chica from cash_accounts
   where organization_id = v_org and name = 'Caja Chica PEN';
  select id into v_dolar from cash_accounts
   where organization_id = v_org and name = 'BCP Dolares';
  select id into v_otra from cash_accounts
   where organization_id = v_org and name = 'Mercury USD';

  v_s0 := coalesce((select balance from account_balances where cash_account_id = v_pen), 0);

  select id into v_t from registrar_transferencia(
    v_pen, v_chica, 500, p_description => 'Paso a caja chica');

  perform assert_true(
    (select fx_rate from transfers where id = v_t) = 1,
    'en la misma moneda la tasa sale 1 sin ningún caso especial');

  perform assert_true(
    (select count(*) from cash_movements where transfer_id = v_t) = 2,
    'una transferencia sin comisión son dos patas atadas (INV-5)');

  perform assert_true(
    (select balance from account_balances where cash_account_id = v_pen) = v_s0 - 500,
    'la cuenta de origen pierde exactamente lo que salió (INV-1)');

  perform assert_true(
    (select balance from account_balances where cash_account_id = v_chica) = 500,
    'la de destino gana exactamente lo que llegó');

  perform assert_true(
    (select count(*) from cash_movements
      where transfer_id = v_t and flow_class = 'internal_transfer') = 2,
    'las dos patas quedan fuera del lente Resultado por su clase de flujo');

  -- Lo que sale y lo que llega no pueden diferir sin una razón. En la misma
  -- moneda no hay tasa que la dé: la razón es una comisión.
  perform assert_raises(
    format('select registrar_transferencia(%L, %L, 1000, 970)', v_pen, v_chica),
    'En la misma moneda no hay ninguna tasa que explique la diferencia',
    'en la misma moneda, una diferencia es una comisión y se anota como tal');

  -- Entre monedas distintas no se adivina: lo que llegó lo dice el extracto.
  perform assert_raises(
    format('select registrar_transferencia(%L, %L, 100)', v_dolar, v_pen),
    'hace falta decir cuánto llegó de verdad',
    'un cambio de moneda exige el monto que llegó, no una tasa de referencia');

  select id into v_tfx from registrar_transferencia(
    v_dolar, v_pen, 100, 370, p_description => 'Cambio de dólares');

  perform assert_true(
    (select fx_rate from transfers where id = v_tfx) = 3.7,
    'la tasa guardada es la que aplicó el banco: destino ÷ origen (INV-5)');

  perform assert_true(
    (select amount = 100 and currency_code = 'USD'
       from cash_movements where transfer_id = v_tfx and direction = 'out'),
    'la pata que sale va en la moneda de su cuenta (INV-9)');

  perform assert_true(
    (select amount = 370 and currency_code = 'PEN'
       from cash_movements where transfer_id = v_tfx and direction = 'in'),
    'la pata que entra va en la moneda de la suya, sin conversión escondida');

  -- La comisión es la tercera pata, y es gasto de verdad.
  v_s1 := (select balance from account_balances where cash_account_id = v_pen);

  select id into v_tcom from registrar_transferencia(
    v_pen, v_chica, 1000, null, null, 'Con comisión', 10);

  perform assert_true(
    (select count(*) from cash_movements where transfer_id = v_tcom) = 3,
    'con comisión son tres patas, no dos con el importe retocado');

  perform assert_true(
    (select flow_class = 'operating' and direction = 'out' and amount = 10
       from cash_movements where transfer_id = v_tcom and kind = 'bank_fee'),
    'la comisión sí es gasto: cuenta como operating y entra en el resultado');

  perform assert_true(
    (select balance from account_balances where cash_account_id = v_chica) = 500 + 1000,
    'el destino recibe el monto entero: la comisión la paga quien la pagó');

  perform assert_true(
    (select balance from account_balances where cash_account_id = v_pen) = v_s1 - 1010,
    'el origen pierde el monto y la comisión, que son dos cosas distintas');

  -- Entre dos empresas no hay traslado interno, y el rechazo nombra las dos.
  perform assert_raises(
    format('select registrar_transferencia(%L, %L, 100)', v_otra, v_pen),
    'es de Entidad Uno. Entre dos empresas no hay traslado interno',
    'el dinero no cruza de un libro a otro, y el error dice qué hacer en su lugar');

  perform assert_raises(
    format('select registrar_transferencia(%L, %L, 100)', v_pen, v_pen),
    'cuentas_iguales',
    'una cuenta no se transfiere a sí misma');

  -- Anular una pata anula la transferencia entera. Si no, aparecería dinero.
  select id into v_pata from cash_movements
   where transfer_id = v_tcom and direction = 'in';
  perform anular_movimiento(v_pata, 'se registró dos veces');

  perform assert_true(
    (select count(*) from cash_movements where transfer_id = v_tcom and not is_void) = 0,
    'anular una pata anula las tres: media transferencia crearía dinero');

  perform assert_true(
    (select balance from account_balances where cash_account_id = v_chica) = 500
    and (select balance from account_balances where cash_account_id = v_pen) = v_s1,
    'anulada entera, los tres saldos vuelven exactamente donde estaban');

  perform assert_true(
    (select count(*) from cash_movements where transfer_id = v_tcom) = 3,
    'y las tres filas se quedan donde estaban: nada financiero se borra (INV-7)');

  -- Una pata sin cabecera sería dinero que sale del resultado sin explicación.
  perform assert_raises(
    format('select registrar_movimiento(%L, ''out'', 10, ''Pata suelta'', null, ''transfer'')', v_pen),
    'pata_sin_transferencia',
    'un movimiento de tipo transferencia sin su cabecera no se puede insertar');

  -- Y media transferencia no llega al commit ni tocando la tabla a mano.
  select id into v_pata from cash_movements
   where transfer_id = v_tfx and direction = 'out';
  perform assert_raises(
    format('update cash_movements set is_void = true, void_reason = ''media''
            where id = %L; set constraints all immediate', v_pata),
    'transferencia_descuadrada',
    'anular media transferencia a mano no pasa del cierre de la transacción');

  -- Una pata no salda una factura: ese dinero no vino de ningún cliente.
  insert into billing_documents (organization_id, legal_entity_id, client_id,
    currency_code, amount_net, amount_tax, amount_total, created_by)
  select v_org, v_uno, c.id, 'PEN', 500, 0, 500, v_usuario
    from clients c where c.organization_id = v_org and c.name = 'Cliente de las pruebas'
  returning id into v_doc;

  select id into v_pata from cash_movements
   where transfer_id = v_t and direction = 'in';

  perform assert_raises(
    format('insert into payment_allocations (organization_id, legal_entity_id,
              currency_code, cash_movement_id, billing_document_id, amount)
            values (%L, %L, ''PEN'', %L, %L, 500);
            set constraints all immediate', v_org, v_uno, v_pata, v_doc),
    'asignacion_de_transferencia',
    'la pata de una transferencia no puede dar por cobrada una factura (INV-6)');
end $$;

-- ---------------------------------------------------------------------------
-- F3-5 · el hecho económico: ni dos veces ni ninguna
-- ---------------------------------------------------------------------------
--
-- La vista `economic_facts` es INV-6 escrito una vez. Lo que estas aserciones
-- vigilan es justo lo que se rompería sin ella: que el mismo cobro se cuente
-- como venta y otra vez como dinero, que una transferencia pase por ingreso, o
-- que el saldo con el que arrancaste parezca ganado este mes.

do $$
declare
  v_org     uuid;
  v_uno     uuid;
  v_usuario uuid := '11111111-1111-1111-1111-111111111111';
  v_pen     uuid;
  v_chica   uuid;
  v_antes   int;
  v_mov     uuid;
  v_doc     uuid;
begin
  perform assert_true(
    (select reloptions::text from pg_class where oid = 'economic_facts'::regclass)
      like '%security_invoker=%',
    'la vista del resultado respeta las políticas de quien pregunta');

  perform assert_true(
    not has_table_privilege('authenticated', 'economic_facts', 'insert')
    and not has_table_privilege('authenticated', 'economic_facts', 'update')
    and not has_table_privilege('authenticated', 'economic_facts', 'delete'),
    'el resultado se lee: no hay nada que escribir en él');

  select id into v_org from organizations where slug = 'org-a';
  select id into v_uno from legal_entities
   where organization_id = v_org and legal_name = 'Entidad Uno';
  select id into v_pen from cash_accounts
   where organization_id = v_org and name = 'BCP Soles';
  select id into v_chica from cash_accounts
   where organization_id = v_org and name = 'Caja Chica PEN';

  select count(*) into v_antes from economic_facts;

  -- El dinero con el que arrancas no lo ganaste este mes.
  perform registrar_movimiento(v_pen, 'in', 5000, 'Apertura de prueba', null, 'opening');
  perform assert_true(
    (select count(*) from economic_facts) = v_antes,
    'un saldo de apertura no es un hecho económico');

  -- Mover dinero entre cuentas propias no es ingreso ni gasto (INV-5).
  perform registrar_transferencia(v_pen, v_chica, 400, p_description => 'Traslado de prueba');
  perform assert_true(
    (select count(*) from economic_facts) = v_antes,
    'las dos patas de una transferencia no aparecen en el resultado');

  -- Pero la comisión del banco sí: eso se pagó de verdad.
  perform registrar_transferencia(v_pen, v_chica, 300, null, null, 'Traslado con comisión', 7);
  perform assert_true(
    (select count(*) from economic_facts) = v_antes + 1,
    'de una transferencia con comisión, solo la comisión es un hecho económico');
  perform assert_true(
    (select direction = 'out' and flow_class = 'operating' and amount_total = 7
       from economic_facts where concepto like 'Comisión%'),
    'y aparece como salida operativa por el importe de la comisión');

  -- Un gasto sin documento es su propio hecho, con lo que el usuario declaró.
  perform registrar_movimiento(v_pen, 'out', 118, 'Taxi de prueba', null, 'operating',
    null, null, null, 100, 18);
  perform assert_true(
    (select amount_net = 100 and amount_tax = 18 and amount_total = 118
       from economic_facts where concepto = 'Taxi de prueba'),
    'un movimiento sin documento aporta su neto y su impuesto (INV-6)');

  perform registrar_movimiento(v_pen, 'out', 50, 'Café de prueba', null, 'operating');
  perform assert_true(
    (select amount_net = 50 and amount_tax = 0
       from economic_facts where concepto = 'Café de prueba'),
    'sin desglose, el neto es el importe entero: no se inventa un IGV que nadie declaró');

  -- Lo no operativo entra con su clase puesta, para poder enseñarlo aparte.
  perform registrar_movimiento(v_pen, 'out', 1000, 'Retiro de prueba', null, 'owner_draw');
  perform assert_true(
    (select flow_class = 'non_operating' from economic_facts where concepto = 'Retiro de prueba'),
    'un retiro del dueño es un hecho económico, pero no es un gasto del negocio');

  -- Y la que sostiene el lente entero: la venta y su cobro son un solo hecho.
  select count(*) into v_antes from economic_facts;

  insert into billing_documents (organization_id, legal_entity_id, client_id,
    currency_code, amount_net, amount_tax, amount_total, created_by)
  select v_org, v_uno, c.id, 'PEN', 500, 0, 500, v_usuario
    from clients c where c.organization_id = v_org and c.name = 'Cliente de las pruebas'
  returning id into v_doc;

  perform assert_true(
    (select count(*) from economic_facts) = v_antes + 1,
    'un documento emitido es un hecho económico desde que se emite, no al cobrarse');

  select id into v_mov from registrar_movimiento(v_pen, 'in', 500, 'Cobro de prueba');
  perform assert_true(
    (select count(*) from economic_facts) = v_antes + 2,
    'y un cobro sin asignar es su propio hecho, porque no se sabe qué saldaba');

  insert into payment_allocations (organization_id, legal_entity_id, currency_code,
    cash_movement_id, billing_document_id, amount)
  values (v_org, v_uno, 'PEN', v_mov, v_doc, 500);

  perform assert_true(
    (select count(*) from economic_facts) = v_antes + 1,
    'al asignarlo al documento deja de contar aparte: el documento manda (INV-6)');

  -- Lo anulado sale del resultado igual que sale del saldo.
  perform anular_movimiento(
    (select id from cash_movements where description = 'Café de prueba'), 'prueba');
  perform assert_true(
    (select count(*) from economic_facts where concepto = 'Café de prueba') = 0,
    'un movimiento anulado deja de contar en el resultado, igual que en el saldo');
end $$;

-- ---------------------------------------------------------------------------
-- F3-6 · una compra tiene proveedor, y su IGV no es tu gasto
-- ---------------------------------------------------------------------------
--
-- Dos cosas se vigilan aquí. La primera es que una compra no pueda disfrazarse
-- de venta ni al revés: la contraparte que lleva depende de su dirección, y es
-- una restricción, no una costumbre. La segunda es el IGV: el impuesto que
-- pagas dentro de una factura es crédito fiscal y no gasto, así que el neto y
-- el impuesto se guardan separados y el lente Resultado solo resta el primero.

do $$
declare
  v_org     uuid;
  v_uno     uuid;
  v_usuario uuid := '11111111-1111-1111-1111-111111111111';
  v_pen     uuid;
  v_cat_in  uuid;
  v_cat_out uuid;
  v_antes   int;
  v_c1      uuid;
  v_c2      uuid;
  v_c3      uuid;
  v_prov    uuid;
  v_venta   uuid;
  v_mov     uuid;
  v_cuota   uuid;
  v_saldo0  numeric;
begin
  select id into v_org from organizations where slug = 'org-a';
  select id into v_uno from legal_entities
   where organization_id = v_org and legal_name = 'Entidad Uno';
  select id into v_pen from cash_accounts
   where organization_id = v_org and name = 'BCP Soles';
  select id into v_cat_in from financial_categories
   where organization_id = v_org and direction = 'in' limit 1;
  select id into v_cat_out from financial_categories
   where organization_id = v_org and name = 'Herramientas y licencias';

  -- Un proveedor se crea y se corrige. No se borra: borrarlo dejaría facturas
  -- sin saber a quién se le compró.
  perform assert_true(
    has_table_privilege('authenticated', 'suppliers', 'select')
    and has_table_privilege('authenticated', 'suppliers', 'insert')
    and has_table_privilege('authenticated', 'suppliers', 'update')
    and not has_table_privilege('authenticated', 'suppliers', 'delete'),
    'un proveedor se crea y se corrige, pero no se borra');

  perform assert_true(
    (select relrowsecurity and relforcerowsecurity
       from pg_class where oid = 'suppliers'::regclass),
    'suppliers tiene RLS, y forzada también para el dueño');

  perform assert_true(
    (select count(*) from information_schema.columns
      where table_name = 'economic_facts' and column_name = 'supplier_id') = 1,
    'el hecho económico dice a quién se le pagó, no solo en qué se fue');

  perform assert_true(
    exists (select 1 from pg_constraint
             where conrelid = 'billing_documents'::regclass
               and conname = 'solo_una_venta_viene_de_cotizacion'),
    'y la base impide que una compra cuelgue de una cotización nuestra');

  -- ---------------------------------------------------------------- la puerta
  select count(*) into v_antes from economic_facts;

  select id into v_c1 from registrar_compra(
    v_uno, 'Movistar', 1180, 'PEN',
    p_series => 'F001-1234',
    p_description => 'Teléfono de octubre',
    p_due_date => current_date + 30,
    p_category => v_cat_out);

  perform assert_true(
    (select amount_net = 1000 and amount_tax = 180 and amount_total = 1180
       from billing_documents where id = v_c1),
    'el total lleva el IGV dentro y se parte: de 1180, 1000 son gasto y 180 crédito fiscal');

  perform assert_true(
    (select direction = 'purchase' and status = 'open'
            and client_id is null and supplier_id is not null
       from billing_documents where id = v_c1),
    'una compra nace por pagar, con proveedor y sin cliente');

  perform assert_true(
    (select tax_rate = 18 from billing_documents where id = v_c1),
    'sin tasa dicha se usa la de la empresa, no una inventada');

  select supplier_id into v_prov from billing_documents where id = v_c1;
  perform assert_true(
    (select name = 'Movistar' from suppliers where id = v_prov),
    'el proveedor se crea al nombrarlo: nadie lo da de alta antes de anotar el recibo');

  select id into v_c2 from registrar_compra(
    v_uno, '  movistar ', 236, 'PEN', p_series => 'F001-9');

  perform assert_true(
    (select supplier_id from billing_documents where id = v_c2) = v_prov,
    'el mismo nombre con otras mayúsculas es el mismo proveedor, no uno nuevo');

  perform assert_true(
    (select count(*) from suppliers where organization_id = v_org) = 1,
    'y por tanto sigue habiendo un solo proveedor');

  select id into v_c3 from registrar_compra(
    v_uno, 'Contador', 500, 'PEN', p_tax_rate => 0, p_description => 'Honorarios');

  perform assert_true(
    (select amount_net = 500 and amount_tax = 0 from billing_documents where id = v_c3),
    'una factura exonerada es gasto entero: no se le inventa un IGV que nadie cobró');

  -- --------------------------------------------------- el hecho es la factura
  perform assert_true(
    (select count(*) from economic_facts) = v_antes + 3,
    'cada compra es un hecho económico desde que llega la factura, no desde que se paga');

  perform assert_true(
    (select direction = 'out' and flow_class = 'operating'
            and amount_net = 1000 and amount_tax = 180
       from economic_facts where concepto = 'Teléfono de octubre'),
    'y entra como salida operativa con su neto y su impuesto separados (INV-6)');

  perform assert_true(
    (select concepto = 'F001-9' from economic_facts where source_id = v_c2),
    'sin concepto escrito queda el número del comprobante, que es lo que hay');

  perform assert_true(
    (select supplier_id from economic_facts where source_id = v_c1) = v_prov,
    'el hecho sabe a quién se le compró');

  -- ------------------------------------------------- la misma factura, una vez
  perform assert_raises(
    format('select registrar_compra(%L, ''Movistar'', 100, ''PEN'', p_series => ''f001-1234'')',
           v_uno),
    'compra_repetida',
    'la misma factura del mismo proveedor no entra dos veces, ni con otras mayúsculas');

  perform assert_true(
    (select count(*) from registrar_compra(
       v_uno, 'Claro', 100, 'PEN', p_series => 'F001-1234')) = 1,
    'pero el mismo número de otro proveedor sí: las series son suyas, no tuyas');

  -- -------------------------------------------- la contraparte y la dirección
  perform assert_raises(
    format('insert into billing_documents (organization_id, legal_entity_id, direction,
              client_id, currency_code, amount_net, amount_tax, amount_total, created_by)
            select %L, %L, ''purchase'', c.id, ''PEN'', 100, 0, 100, %L
              from clients c where c.organization_id = %L limit 1',
           v_org, v_uno, v_usuario, v_org),
    'la_contraparte_concuerda',
    'una compra no la hace un cliente: es imposible, no está desaconsejado');

  perform assert_raises(
    format('insert into billing_documents (organization_id, legal_entity_id, direction,
              supplier_id, currency_code, amount_net, amount_tax, amount_total, created_by)
            values (%L, %L, ''sale'', %L, ''PEN'', 100, 0, 100, %L)',
           v_org, v_uno, v_prov, v_usuario),
    'la_contraparte_concuerda',
    'ni una venta se le factura a un proveedor');

  perform assert_raises(
    format('insert into cash_movements (organization_id, cash_account_id, legal_entity_id,
              direction, amount, currency_code, value_date, client_id, supplier_id,
              description, created_by)
            select %L, %L, %L, ''out'', 10, ''PEN'', current_date, c.id, %L,
                   ''dos contrapartes'', %L
              from clients c where c.organization_id = %L limit 1',
           v_org, v_pen, v_uno, v_prov, v_usuario, v_org),
    'una_sola_contraparte',
    'un movimiento tiene una contraparte, no dos');

  -- ------------------------------------------------- lo que la puerta rechaza
  perform assert_raises(
    format('select registrar_compra(%L, ''Movistar'', 100, ''PEN'',
              p_issue_date => current_date, p_due_date => current_date - 1)', v_uno),
    'vencimiento_antes_de_la_fecha',
    'una factura que vence antes de existir aparecería vencida el día que llegó');

  perform assert_raises(
    format('select registrar_compra(%L, ''Movistar'', 100, ''PEN'', p_category => %L)',
           v_uno, v_cat_in),
    'categoria_de_ingreso',
    'una categoría de ingresos no clasifica una compra');

  perform assert_raises(
    format('select registrar_compra(%L, ''   '', 100, ''PEN'')', v_uno),
    'proveedor_obligatorio',
    'una compra sin proveedor no se puede reclamar ni cuadrar con el extracto');

  perform assert_raises(
    format('select registrar_compra(%L, ''Movistar'', 0, ''PEN'')', v_uno),
    'importe_invalido',
    'una compra de cero no es una compra');

  perform assert_raises(
    format('select registrar_compra(%L, ''Movistar'', 100, ''ZZZ'')', v_uno),
    'unknown_currency',
    'ni una en una moneda que no existe');

  perform assert_raises(
    format('select registrar_compra(%L, ''Movistar'', 100, ''PEN'', p_tax_rate => -1)', v_uno),
    'impuesto_invalido',
    'un impuesto negativo no es un impuesto');

  -- ------------------------------------------------------------- pagar y cuadrar
  select balance into v_saldo0 from account_balances where cash_account_id = v_pen;
  select count(*) into v_antes from economic_facts;

  select id into v_mov from registrar_pago_de_compra(v_c3, v_pen, 200);

  perform assert_true(
    (select direction = 'out' and counterparty_kind = 'supplier'
            and supplier_id is not null and client_id is null and kind = 'operating'
       from cash_movements where id = v_mov),
    'pagar una compra saca dinero y queda apuntado al proveedor');

  perform assert_true(
    (select status = 'partially_paid' from billing_documents where id = v_c3),
    'un pago parcial deja la factura pagada a medias (INV-3)');

  perform assert_true(
    (select balance from account_balances where cash_account_id = v_pen) = v_saldo0 - 200,
    'y el saldo baja por el importe pagado, ni más ni menos (INV-1)');

  perform assert_true(
    (select count(*) from economic_facts) = v_antes,
    'el pago no es un hecho nuevo: el hecho era la factura (INV-6)');

  perform assert_raises(
    format('select registrar_pago_de_compra(%L, %L, 400)', v_c3, v_pen),
    'pago_excede_documento',
    'no se puede pagar más de lo que la factura dice');

  perform registrar_pago_de_compra(v_c3, v_pen, 300);
  perform assert_true(
    (select status = 'paid' from billing_documents where id = v_c3),
    'y al completarla queda pagada');

  perform assert_raises(
    format('select registrar_pago_de_compra(%L, %L, 10)', v_c3, v_pen),
    'documento_cerrado',
    'una factura pagada no admite más pagos');

  -- ------------------------------------------------ cada puerta por su nombre
  select id into v_venta from billing_documents
   where organization_id = v_org and direction = 'sale' limit 1;

  perform assert_raises(
    format('select registrar_cobro(%L, %L, 100)', v_c1, v_pen),
    'esto_es_una_compra',
    'una factura de proveedor se paga, no se cobra, y la puerta lo dice por su nombre');

  perform assert_raises(
    format('select registrar_pago_de_compra(%L, %L, 100)', v_venta, v_pen),
    'esto_es_una_venta',
    'y una venta tuya se cobra, no se paga');

  select id into v_mov from registrar_movimiento(v_pen, 'in', 100, 'Entrada de prueba F3-6');
  perform assert_raises(
    format('insert into payment_allocations (organization_id, legal_entity_id,
              currency_code, cash_movement_id, billing_document_id, amount)
            values (%L, %L, ''PEN'', %L, %L, 100);
            set constraints all immediate', v_org, v_uno, v_mov, v_c1),
    'direccion_no_concuerda',
    'un ingreso no paga una compra: la dejaría pagada con dinero que entró');

  -- ------------------------------------------------------------------- anular
  perform assert_raises(
    format('select anular_documento(%L, ''prueba'')', v_c3),
    'documento_con_dinero',
    'anular una factura con pagos vivos dejaría ese dinero sin nada que lo explique');

  perform assert_raises(
    format('select anular_documento(%L, ''   '')', v_c1),
    'motivo_obligatorio',
    'anular exige decir por qué');

  select count(*) into v_antes from economic_facts;
  perform anular_documento(v_c2, 'El número estaba mal');

  perform assert_true(
    (select status = 'void' and void_reason = 'El número estaba mal'
       from billing_documents where id = v_c2),
    'anular no borra: marca y deja el motivo escrito');

  perform assert_true(
    (select count(*) from economic_facts) = v_antes - 1,
    'y deja de contar en el resultado, igual que un movimiento anulado');

  perform assert_raises(
    format('select anular_documento(%L, ''otra vez'')', v_c2),
    'documento_ya_anulado',
    'no se anula dos veces');

  perform assert_true(
    (select count(*) from registrar_compra(
       v_uno, 'Movistar', 236, 'PEN', p_series => 'F001-9')) = 1,
    'y su número vuelve a estar libre: una factura mal teclada no lo inutiliza para siempre');

  -- La cuota sigue a su documento también hacia atrás.
  insert into billing_documents (organization_id, legal_entity_id, client_id,
    currency_code, amount_net, amount_tax, amount_total, created_by)
  select v_org, v_uno, c.id, 'PEN', 700, 0, 700, v_usuario
    from clients c where c.organization_id = v_org and c.name = 'Cliente de las pruebas'
  returning id into v_venta;

  insert into payment_schedule_items (organization_id, legal_entity_id, label,
    due_date, amount, currency_code, status, billing_document_id)
  values (v_org, v_uno, 'Cuota de prueba F3-6', current_date, 700, 'PEN',
    'documented', v_venta)
  returning id into v_cuota;

  perform anular_documento(v_venta, 'Se emitió por error');
  perform assert_true(
    (select status = 'planned' and billing_document_id is null
       from payment_schedule_items where id = v_cuota),
    'anulado su documento, la cuota vuelve a estar prevista y se puede volver a emitir');
end $$;

reset request.jwt.claim.sub;

select 'TODAS LAS PRUEBAS DE F1, F2 Y F3 PASARON · 167 aserciones' as resultado;
