-- ============================================================================
-- Margen Pilot · F1 · Dos cosas que señaló el linter de Supabase
--
-- 1. `app.check_account_currency` y `app.touch_updated_at` no fijaban su
--    search_path. Son disparadores y no son `security definer`, así que el
--    riesgo es menor que en los helpers de RLS, pero consultan tablas sin
--    cualificar: si alguien consigue crear un objeto en un esquema que vaya
--    antes en el search_path, cambia lo que leen. Se fija, como en el resto.
--
--    pg_temp va al final a propósito: si no se nombra, Postgres lo busca
--    PRIMERO, y una tabla temporal llamada `legal_entities` se colaría.
--
-- 2. `create_organization` es ejecutable por cualquier usuario con sesión, y
--    eso es deliberado: es el único camino para crear una organización. Pero
--    tal como estaba no tenía techo. Un usuario podía llamarla en bucle y
--    fabricar organizaciones sin fin, cada una con sus nueve categorías. Se le
--    pone un tope por usuario.
-- ============================================================================

create or replace function app.check_account_currency() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if not exists (
    select 1 from organization_currencies
    where organization_id = new.organization_id
      and currency_code = new.currency_code
      and is_enabled
  ) then
    raise exception 'currency_not_enabled: % no está habilitada en esta organización', new.currency_code
      using errcode = 'check_violation';
  end if;

  if not exists (
    select 1 from legal_entities
    where id = new.legal_entity_id and organization_id = new.organization_id
  ) then
    raise exception 'entity_mismatch: la entidad no pertenece a esta organización'
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

create or replace function app.touch_updated_at() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ----------------------------------------------------------------------------
-- Techo de organizaciones por usuario
--
-- No es un límite de plan: cuando se llama a esta función todavía no existe
-- organización de la que leer un plan. Es una barandilla contra el abuso de un
-- RPC abierto. Si alguna vez hace falta más, se sube aquí y se documenta.
-- ----------------------------------------------------------------------------

create or replace function create_organization(
  p_name text,
  p_currency char(3) default 'PEN'
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_max_owned constant int := 3;
  v_user uuid := auth.uid();
  v_owned int;
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

  if not exists (select 1 from currencies where code = p_currency) then
    raise exception 'unknown_currency: % no existe', p_currency
      using errcode = 'check_violation';
  end if;

  -- Serializa por usuario: sin esto, dos llamadas a la vez cuentan lo mismo y
  -- las dos pasan. Es la misma carrera que cierra app.assert_entitlement.
  perform pg_advisory_xact_lock(hashtextextended(v_user::text || ':organizations', 0));

  select count(*) into v_owned
  from memberships
  where user_id = v_user and role = 'owner' and status = 'active';

  if v_owned >= v_max_owned then
    raise exception 'too_many_organizations:%:%', v_owned, v_max_owned
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

revoke all on function create_organization(text, char) from public, anon;
grant execute on function create_organization(text, char) to authenticated;

comment on function create_organization(text, char) is
  'Alta de organización. Siempre en plan free y con techo de 3 por usuario: subir de plan es del servidor.';
