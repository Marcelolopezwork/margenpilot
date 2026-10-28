-- ============================================================================
-- Margen Pilot · F1 Fundaciones
--
-- Identidad SaaS, organización, entidades legales, marcas, monedas, cuentas de
-- caja, impuestos y tasas de cambio.
--
-- Decisión que atraviesa todo este archivo: ADR-16. Perú y Estados Unidos son
-- dos contabilidades separadas. Eso se impone con `legal_entity_id` obligatorio
-- y validado, no con dos juegos de tablas. Ver docs/ARCHITECTURE.md §2.0.
-- ============================================================================

create extension if not exists pgcrypto;

create schema if not exists app;
comment on schema app is 'Funciones internas: helpers de RLS, límites de plan, auditoría. No expuesto al cliente.';

-- ----------------------------------------------------------------------------
-- Tipos
-- ----------------------------------------------------------------------------

create type membership_role as enum ('owner', 'admin', 'finance', 'commercial', 'viewer');
create type membership_status as enum ('invited', 'active', 'suspended');
create type account_kind as enum ('bank', 'cash', 'wallet', 'card');
create type fx_rate_kind as enum ('closing', 'official', 'manual');
create type category_direction as enum ('in', 'out', 'both');

-- ----------------------------------------------------------------------------
-- Identidad
-- ----------------------------------------------------------------------------

create table profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text,
  email       text,
  locale      text not null default 'es-PE',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table profiles is 'Datos de la persona. Su id ES el de auth.users.';

create table organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,
  country     char(2) not null default 'PE',
  -- Moneda en la que se presentan los totales referenciales del Inicio.
  -- NO es la moneda de ninguna transacción: cada una guarda la suya (INV-9).
  display_currency_code char(3) not null default 'PEN',
  -- Cuando una bajada de plan deja la organización por encima de sus límites,
  -- esto queda en true y bloquea toda operación nueva hasta que se elija qué
  -- entidades y monedas siguen activas (ADR-05, degradación sin pérdida).
  requires_plan_reconciliation boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references auth.users (id)
);

create table memberships (
  organization_id uuid not null references organizations (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  role            membership_role not null default 'viewer',
  status          membership_status not null default 'active',
  invited_by      uuid references auth.users (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  primary key (organization_id, user_id)
);
comment on column memberships.role is
  'owner y admin: todo. finance: ve costos y caja. commercial: cotiza sin ver costos ni caja. viewer: informes sin costos.';

create index memberships_user_idx on memberships (user_id) where status = 'active';

-- ----------------------------------------------------------------------------
-- Planes y suscripción
-- ----------------------------------------------------------------------------

create table plans (
  code       text primary key,
  name       text not null,
  is_public  boolean not null default true,
  sort       int not null default 0
);

create table plan_entitlements (
  plan_code  text not null references plans (code) on delete cascade,
  key        text not null,
  value_int  int,
  value_bool boolean,
  primary key (plan_code, key),
  constraint one_value check (num_nonnulls(value_int, value_bool) = 1)
);
comment on table plan_entitlements is
  'Límites por plan. value_int nulo = sin límite. Se validan en app.assert_entitlement (ADR-05).';

create table subscriptions (
  organization_id        uuid primary key references organizations (id) on delete cascade,
  plan_code              text not null references plans (code),
  status                 text not null default 'active'
                           check (status in ('active', 'past_due', 'canceled', 'trialing')),
  -- Se rellenan cuando exista cobro real. El plan SIEMPRE se deriva de lo que
  -- diga la pasarela, nunca de algo que escriba el cliente.
  stripe_customer_id     text,
  stripe_subscription_id text,
  current_period_end     timestamptz,
  cancel_at              timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- Monedas
-- ----------------------------------------------------------------------------

create table currencies (
  code        char(3) primary key,
  name        text not null,
  symbol      text not null,
  -- De aquí salen los decimales de presentación, nunca de una constante en
  -- el código (regla R-4.4 de docs/FINANCIAL_RULES.md).
  minor_units smallint not null default 2 check (minor_units between 0 and 4)
);

create table organization_currencies (
  organization_id uuid not null references organizations (id) on delete cascade,
  currency_code   char(3) not null references currencies (code),
  is_enabled      boolean not null default true,
  enabled_at      timestamptz not null default now(),
  primary key (organization_id, currency_code)
);

-- ----------------------------------------------------------------------------
-- Entidades legales y marcas
--
-- La entidad es el libro contable: quien emite la cotización, quien posee las
-- cuentas y quien tiene su régimen de impuesto. La marca es presentación.
-- ----------------------------------------------------------------------------

create table legal_entities (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  legal_name      text not null,
  tax_id          text,
  country         char(2) not null,
  -- Moneda en la que opera esta entidad. El SAC cobra en PEN, la LLC en USD.
  default_currency_code char(3) not null references currencies (code),
  is_active       boolean not null default true,
  archived_reason text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, legal_name)
);
comment on table legal_entities is
  'Un libro contable por fila. Ningún informe de resultado mezcla dos entidades (ADR-16).';

create table brands (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  -- Una marca pertenece a una entidad: elegir la marca ya determina quién
  -- cotiza. Ilimitadas y añadibles libremente (ADR-03, D-3).
  legal_entity_id uuid not null references legal_entities (id) on delete cascade,
  name            text not null,
  logo_path       text,
  accent_color    text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, name)
);
comment on table brands is
  'Solo presentación: nombre, logo y color en la cotización y su PDF. No posee cuentas ni documentos; por eso no hay ninguna clave ajena hacia aquí desde cash_accounts.';

-- ----------------------------------------------------------------------------
-- Impuestos
-- ----------------------------------------------------------------------------

create table tax_rates (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  legal_entity_id uuid not null references legal_entities (id) on delete cascade,
  name            text not null,
  -- 18.0000 para el IGV peruano, 0.0000 para la LLC.
  rate            numeric(7, 4) not null check (rate >= 0 and rate <= 100),
  is_default      boolean not null default false,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (legal_entity_id, name)
);

create unique index tax_rates_one_default_per_entity
  on tax_rates (legal_entity_id) where is_default;

-- ----------------------------------------------------------------------------
-- Cuentas de caja
-- ----------------------------------------------------------------------------

create table cash_accounts (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  -- Obligatorio: una cuenta pertenece a un libro y solo a uno (ADR-16).
  legal_entity_id uuid not null references legal_entities (id),
  name            text not null,
  kind            account_kind not null default 'bank',
  -- Una cuenta, una moneda. Si un banco real es multimoneda, se modelan dos
  -- cuentas (INV-9).
  currency_code   char(3) not null references currencies (code),
  bank_name       text,
  -- Solo los últimos 4 dígitos. El número completo no se almacena NUNCA,
  -- ni aquí ni en ningún log.
  account_ref_masked text check (account_ref_masked is null or length(account_ref_masked) <= 8),
  is_active       boolean not null default true,
  sort            int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, legal_entity_id, name)
);

create index cash_accounts_entity_idx on cash_accounts (organization_id, legal_entity_id)
  where is_active;

-- La cuenta no puede estar en una moneda que la organización no tiene habilitada.
create or replace function app.check_account_currency() returns trigger
language plpgsql as $$
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

create trigger cash_accounts_currency_check
  before insert or update of currency_code, legal_entity_id, organization_id on cash_accounts
  for each row execute function app.check_account_currency();

-- ----------------------------------------------------------------------------
-- Tasas de cambio · append-only
-- ----------------------------------------------------------------------------

create table fx_rates (
  id              uuid primary key default gen_random_uuid(),
  -- Nula = tasa global compartida; con valor = tasa propia de la organización.
  organization_id uuid references organizations (id) on delete cascade,
  from_code       char(3) not null references currencies (code),
  to_code         char(3) not null references currencies (code),
  rate            numeric(18, 8) not null check (rate > 0),
  as_of           date not null,
  source          text not null,
  kind            fx_rate_kind not null default 'manual',
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users (id),
  constraint fx_distinct_currencies check (from_code <> to_code)
);

create unique index fx_rates_unique
  on fx_rates (coalesce(organization_id, '00000000-0000-0000-0000-000000000000'::uuid),
               from_code, to_code, as_of, kind);

comment on table fx_rates is
  'Nunca se corrige una tasa: se añade otra con as_of posterior. Para el consolidado se usa la última disponible (D-5), y la UI debe mostrar rate, as_of y source junto a la cifra.';

-- ----------------------------------------------------------------------------
-- Categorías financieras
-- ----------------------------------------------------------------------------

create table financial_categories (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  name            text not null,
  direction       category_direction not null default 'both',
  parent_id       uuid references financial_categories (id) on delete set null,
  is_active       boolean not null default true,
  sort            int not null default 0,
  created_at      timestamptz not null default now(),
  unique (organization_id, name)
);

-- ----------------------------------------------------------------------------
-- Auditoría
-- ----------------------------------------------------------------------------

create table audit_log (
  id              bigserial primary key,
  organization_id uuid,
  actor_id        uuid,
  entity_table    text not null,
  entity_id       uuid,
  action          text not null,
  before          jsonb,
  after           jsonb,
  at              timestamptz not null default now()
);

create index audit_log_org_idx on audit_log (organization_id, at desc);

create or replace function app.audit_changes() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_before jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_after  jsonb := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  v_row    jsonb := coalesce(v_after, v_before);
begin
  insert into audit_log (organization_id, actor_id, entity_table, entity_id, action, before, after)
  values (
    nullif(v_row ->> 'organization_id', '')::uuid,
    auth.uid(),
    tg_table_name,
    nullif(v_row ->> 'id', '')::uuid,
    tg_op,
    v_before,
    v_after
  );
  return coalesce(new, old);
end $$;

-- ----------------------------------------------------------------------------
-- updated_at
-- ----------------------------------------------------------------------------

create or replace function app.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'profiles', 'organizations', 'memberships', 'subscriptions',
    'legal_entities', 'brands', 'cash_accounts'
  ] loop
    execute format(
      'create trigger %I_touch before update on %I for each row execute function app.touch_updated_at()',
      t, t);
  end loop;
end $$;

-- Auditoría en lo que importa desde el día uno.
do $$
declare t text;
begin
  foreach t in array array['legal_entities', 'cash_accounts', 'tax_rates', 'memberships'] loop
    execute format(
      'create trigger %I_audit after insert or update or delete on %I for each row execute function app.audit_changes()',
      t, t);
  end loop;
end $$;
