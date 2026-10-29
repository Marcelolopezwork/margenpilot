-- ============================================================================
-- Margen Pilot · F1 · Límites de plan y alta de organización
--
-- Los límites se validan en el servidor, en la misma transacción que la
-- inserción, con un lock por (organización, recurso). Contar y comparar sin
-- lock tiene una carrera trivial: dos pestañas creando la segunda empresa a la
-- vez, ambas cuentan 1, ambas pasan (ADR-05).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Datos de referencia
-- ----------------------------------------------------------------------------

insert into currencies (code, name, symbol, minor_units) values
  ('PEN', 'Sol peruano',        'S/',   2),
  ('USD', 'Dólar estadounidense', 'US$', 2)
on conflict (code) do nothing;

insert into plans (code, name, is_public, sort) values
  ('free',     'Free',     true,  1),
  ('pro',      'Pro',      true,  2),
  -- No público y no facturable: es el plan de la organización propia, que con
  -- dos entidades y dos monedas no cabe en Pro (D-4).
  ('internal', 'Internal', false, 99)
on conflict (code) do nothing;

insert into plan_entitlements (plan_code, key, value_int, value_bool) values
  ('free', 'max_legal_entities', 1,  null),
  ('free', 'max_currencies',     1,  null),
  ('free', 'max_cash_accounts',  2,  null),
  ('free', 'max_members',        1,  null),
  ('pro',  'max_legal_entities', 2,  null),
  ('pro',  'max_currencies',     2,  null),
  ('pro',  'max_cash_accounts',  8,  null),
  ('pro',  'max_members',        5,  null)
  -- `internal` no tiene filas a propósito: sin fila, no hay límite.
on conflict (plan_code, key) do nothing;

-- ----------------------------------------------------------------------------
-- Validación de límites
-- ----------------------------------------------------------------------------

create or replace function app.assert_plan_reconciled(p_org uuid) returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if exists (
    select 1 from organizations
    where id = p_org and requires_plan_reconciliation
  ) then
    raise exception 'plan_reconciliation_required: elige qué entidades y monedas quedan activas antes de seguir operando'
      using errcode = 'check_violation';
  end if;
end $$;

create or replace function app.assert_entitlement(p_org uuid, p_resource text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_plan  text;
  v_limit int;
  v_used  int;
begin
  -- Serializa solo este par (organización, recurso). No bloquea nada más.
  perform pg_advisory_xact_lock(hashtextextended(p_org::text || ':' || p_resource, 0));

  select plan_code into v_plan from subscriptions where organization_id = p_org;
  if v_plan is null then
    raise exception 'no_subscription: la organización no tiene plan asignado'
      using errcode = 'check_violation';
  end if;

  select value_int into v_limit
  from plan_entitlements
  where plan_code = v_plan and key = p_resource;

  -- Sin fila o sin valor = sin límite para este plan.
  if v_limit is null then
    return;
  end if;

  v_used := case p_resource
    when 'max_legal_entities' then
      (select count(*) from legal_entities where organization_id = p_org and is_active)
    when 'max_currencies' then
      (select count(*) from organization_currencies where organization_id = p_org and is_enabled)
    when 'max_cash_accounts' then
      (select count(*) from cash_accounts where organization_id = p_org and is_active)
    when 'max_members' then
      (select count(*) from memberships where organization_id = p_org and status = 'active')
    else null
  end;

  if v_used is null then
    -- Un recurso con límite definido pero sin forma de contarlo es un error de
    -- programación, no una situación del usuario: que se vea en seguida.
    raise exception 'unknown_entitlement: % tiene límite pero no tiene contador', p_resource
      using errcode = 'internal_error';
  end if;

  if v_used >= v_limit then
    raise exception 'plan_limit_reached:%:%:%', p_resource, v_used, v_limit
      using errcode = 'check_violation';
  end if;
end $$;

-- Un disparador por recurso, para que el mensaje de error sea útil.

create or replace function app.enforce_entity_limit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform app.assert_plan_reconciled(new.organization_id);
  perform app.assert_entitlement(new.organization_id, 'max_legal_entities');
  return new;
end $$;

create or replace function app.enforce_currency_limit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform app.assert_plan_reconciled(new.organization_id);
  perform app.assert_entitlement(new.organization_id, 'max_currencies');
  return new;
end $$;

create or replace function app.enforce_account_limit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform app.assert_plan_reconciled(new.organization_id);
  perform app.assert_entitlement(new.organization_id, 'max_cash_accounts');
  return new;
end $$;

create or replace function app.enforce_member_limit() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.status = 'active' then
    perform app.assert_entitlement(new.organization_id, 'max_members');
  end if;
  return new;
end $$;

create trigger legal_entities_limit before insert on legal_entities
  for each row execute function app.enforce_entity_limit();

create trigger org_currencies_limit before insert on organization_currencies
  for each row execute function app.enforce_currency_limit();

create trigger cash_accounts_limit before insert on cash_accounts
  for each row execute function app.enforce_account_limit();

create trigger memberships_limit before insert on memberships
  for each row execute function app.enforce_member_limit();

-- ----------------------------------------------------------------------------
-- Alta de organización
--
-- Único camino para crear una organización. Crea en la misma transacción la
-- organización, la suscripción, la membresía de owner y las categorías por
-- defecto, de modo que no pueda quedar una organización a la que nadie tenga
-- acceso ni una sin plan.
--
-- El plan NO se recibe por parámetro a propósito: si el cliente pudiera pedir
-- `internal` se saltaría todos los límites. Siempre nace en `free`; subir de
-- plan es una operación aparte y del servidor.
-- ----------------------------------------------------------------------------

create or replace function create_organization(
  p_name text,
  p_currency char(3) default 'PEN'
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_user uuid := auth.uid();
  v_org  uuid;
  v_slug text;
begin
  if v_user is null then
    raise exception 'not_authenticated' using errcode = 'insufficient_privilege';
  end if;

  if coalesce(btrim(p_name), '') = '' then
    raise exception 'invalid_name: la organización necesita un nombre'
      using errcode = 'check_violation';
  end if;

  v_slug := btrim(lower(regexp_replace(p_name, '[^a-zA-Z0-9]+', '-', 'g')), '-');
  if v_slug = '' then v_slug := 'org'; end if;
  if exists (select 1 from organizations where slug = v_slug) then
    v_slug := v_slug || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
  end if;

  insert into organizations (name, slug, display_currency_code, created_by)
  values (btrim(p_name), v_slug, p_currency, v_user)
  returning id into v_org;

  -- Antes de la membresía: su disparador de límite necesita que el plan exista.
  insert into subscriptions (organization_id, plan_code) values (v_org, 'free');

  insert into memberships (organization_id, user_id, role, status)
  values (v_org, v_user, 'owner', 'active');

  insert into organization_currencies (organization_id, currency_code)
  values (v_org, p_currency);

  insert into financial_categories (organization_id, name, direction, sort) values
    (v_org, 'Ventas de servicios',      'in',   10),
    (v_org, 'Otros ingresos',           'in',   20),
    (v_org, 'Personal y freelancers',   'out',  30),
    (v_org, 'Herramientas y licencias', 'out',  40),
    (v_org, 'Proveedores',              'out',  50),
    (v_org, 'Alquiler y servicios',     'out',  60),
    (v_org, 'Comisiones bancarias',     'out',  70),
    (v_org, 'Impuestos',                'out',  80),
    (v_org, 'Movimientos del dueño',    'both', 90);

  return v_org;
end $$;

revoke all on function create_organization(text, char) from public;
grant execute on function create_organization(text, char) to authenticated;

comment on function create_organization(text, char) is
  'Alta de organización. Siempre en plan free: subir de plan es del servidor.';
