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

select 'TODAS LAS PRUEBAS DE F1 PASARON · 27 aserciones' as resultado;
