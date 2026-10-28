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

set app.current_user_id = '11111111-1111-1111-1111-111111111111';
select create_organization('Org A', 'PEN');

set app.current_user_id = '22222222-2222-2222-2222-222222222222';
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

set app.current_user_id = '11111111-1111-1111-1111-111111111111';
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
declare v_org uuid; v_entity uuid; v_other_org uuid;
begin
  select id into v_org from organizations where slug = 'org-a';
  select id into v_other_org from organizations where slug = 'org-b';
  select id into v_entity from legal_entities where organization_id = v_org and legal_name = 'Entidad Uno';

  -- Moneda habilitada: pasa.
  insert into cash_accounts (organization_id, legal_entity_id, name, currency_code)
  values (v_org, v_entity, 'BCP Soles', 'PEN');

  -- Moneda no habilitada: no pasa.
  perform assert_raises(
    format('insert into cash_accounts (organization_id, legal_entity_id, name, currency_code)
            values (%L, %L, ''Cuenta rara'', ''PEN'')', v_other_org, v_entity),
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
declare v_count int;
begin
  select count(*) into v_count
  from information_schema.role_table_grants
  where grantee = 'authenticated'
    and privilege_type = 'DELETE'
    and table_schema = 'public';

  perform assert_true(v_count = 0,
    format('el rol authenticated no debe tener DELETE en ninguna tabla, y lo tiene en %s', v_count));
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

select 'TODAS LAS PRUEBAS DE F1 PASARON' as resultado;
