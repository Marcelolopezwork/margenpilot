-- ============================================================================
-- Margen Pilot · F1 · Aislamiento multi-organización
--
-- Dos niveles de aislamiento, y conviene no confundirlos:
--   1. Entre ORGANIZACIONES, con RLS: un cliente del SaaS no ve nada de otro.
--   2. Entre ENTIDADES legales dentro de una organización, con legal_entity_id
--      y el GROUP BY de cada informe (ADR-16). Eso NO es RLS: Marcelo sí debe
--      ver sus dos libros, lo que no debe pasar es que se sumen.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Helpers
--
-- security definer es imprescindible: si la política de una tabla consultara
-- memberships directamente, la política de memberships se evaluaría otra vez
-- y entraría en recursión infinita.
-- ----------------------------------------------------------------------------

create or replace function app.current_orgs() returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select organization_id
  from memberships
  where user_id = auth.uid() and status = 'active'
$$;

create or replace function app.has_role(p_org uuid, p_roles membership_role[]) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from memberships
    where user_id = auth.uid()
      and organization_id = p_org
      and status = 'active'
      and role = any (p_roles)
  )
$$;

-- Atajo: ¿puede este usuario escribir datos financieros en esta organización?
create or replace function app.can_write_money(p_org uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select app.has_role(p_org, array['owner', 'admin', 'finance']::membership_role[])
$$;

-- ¿Puede ver costos y márgenes? El rol comercial NO.
create or replace function app.can_see_costs(p_org uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select app.has_role(p_org, array['owner', 'admin', 'finance']::membership_role[])
$$;

revoke all on function app.current_orgs() from public;
revoke all on function app.has_role(uuid, membership_role[]) from public;
revoke all on function app.can_write_money(uuid) from public;
revoke all on function app.can_see_costs(uuid) from public;

-- ----------------------------------------------------------------------------
-- Privilegios base
-- ----------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated;
  end if;
end $$;

grant usage on schema public to authenticated;
grant usage on schema app to authenticated;

grant execute on function app.current_orgs() to authenticated;
grant execute on function app.has_role(uuid, membership_role[]) to authenticated;
grant execute on function app.can_write_money(uuid) to authenticated;
grant execute on function app.can_see_costs(uuid) to authenticated;

-- Datos de referencia: lectura para todos, escritura para nadie.
grant select on currencies, plans, plan_entitlements to authenticated;

-- Datos de negocio: nunca DELETE. Lo que se deshace se anula, no se borra
-- (INV-7). En F1 todavía no hay tablas financieras, pero la costumbre empieza
-- aquí para que nadie la introduzca después.
grant select, insert, update on
  profiles, organizations, memberships, subscriptions,
  organization_currencies, legal_entities, brands, tax_rates,
  cash_accounts, fx_rates, financial_categories
to authenticated;

grant select on audit_log to authenticated;

-- ----------------------------------------------------------------------------
-- Activación
-- ----------------------------------------------------------------------------

alter table profiles                enable row level security;
alter table organizations           enable row level security;
alter table memberships             enable row level security;
alter table subscriptions           enable row level security;
alter table organization_currencies enable row level security;
alter table legal_entities          enable row level security;
alter table brands                  enable row level security;
alter table tax_rates               enable row level security;
alter table cash_accounts           enable row level security;
alter table fx_rates                enable row level security;
alter table financial_categories    enable row level security;
alter table audit_log               enable row level security;

alter table profiles                force row level security;
alter table organizations           force row level security;
alter table memberships             force row level security;
alter table subscriptions           force row level security;
alter table organization_currencies force row level security;
alter table legal_entities          force row level security;
alter table brands                  force row level security;
alter table tax_rates               force row level security;
alter table cash_accounts           force row level security;
alter table fx_rates                force row level security;
alter table financial_categories    force row level security;
alter table audit_log               force row level security;

-- ----------------------------------------------------------------------------
-- profiles · cada uno el suyo
-- ----------------------------------------------------------------------------

create policy profiles_select on profiles for select using (id = auth.uid());
create policy profiles_insert on profiles for insert with check (id = auth.uid());
create policy profiles_update on profiles for update using (id = auth.uid()) with check (id = auth.uid());

-- ----------------------------------------------------------------------------
-- organizations
--
-- Sin política de INSERT a propósito: una organización se crea solo por
-- app.create_organization(), que además crea la membresía de owner y la
-- suscripción en la misma transacción. Así no puede existir una organización
-- huérfana a la que nadie tenga acceso.
-- ----------------------------------------------------------------------------

create policy organizations_select on organizations for select
  using (id in (select app.current_orgs()));

create policy organizations_update on organizations for update
  using (app.has_role(id, array['owner', 'admin']::membership_role[]))
  with check (app.has_role(id, array['owner', 'admin']::membership_role[]));

-- ----------------------------------------------------------------------------
-- memberships
-- ----------------------------------------------------------------------------

create policy memberships_select on memberships for select
  using (organization_id in (select app.current_orgs()));

create policy memberships_insert on memberships for insert
  with check (app.has_role(organization_id, array['owner', 'admin']::membership_role[]));

create policy memberships_update on memberships for update
  using (app.has_role(organization_id, array['owner', 'admin']::membership_role[]))
  with check (app.has_role(organization_id, array['owner', 'admin']::membership_role[]));

-- ----------------------------------------------------------------------------
-- subscriptions · se lee; la escribe el servidor
-- ----------------------------------------------------------------------------

create policy subscriptions_select on subscriptions for select
  using (organization_id in (select app.current_orgs()));

-- ----------------------------------------------------------------------------
-- Configuración de la organización
-- ----------------------------------------------------------------------------

create policy org_currencies_select on organization_currencies for select
  using (organization_id in (select app.current_orgs()));
create policy org_currencies_write on organization_currencies for insert
  with check (app.has_role(organization_id, array['owner', 'admin']::membership_role[]));
create policy org_currencies_update on organization_currencies for update
  using (app.has_role(organization_id, array['owner', 'admin']::membership_role[]))
  with check (organization_id in (select app.current_orgs()));

create policy legal_entities_select on legal_entities for select
  using (organization_id in (select app.current_orgs()));
create policy legal_entities_insert on legal_entities for insert
  with check (app.has_role(organization_id, array['owner', 'admin']::membership_role[]));
create policy legal_entities_update on legal_entities for update
  using (app.has_role(organization_id, array['owner', 'admin']::membership_role[]))
  with check (organization_id in (select app.current_orgs()));

-- Las marcas las puede crear cualquiera que cotice: son presentación, no
-- contabilidad. Ilimitadas (D-3).
create policy brands_select on brands for select
  using (organization_id in (select app.current_orgs()));
create policy brands_insert on brands for insert
  with check (app.has_role(organization_id,
    array['owner', 'admin', 'finance', 'commercial']::membership_role[]));
create policy brands_update on brands for update
  using (app.has_role(organization_id,
    array['owner', 'admin', 'finance', 'commercial']::membership_role[]))
  with check (organization_id in (select app.current_orgs()));

create policy tax_rates_select on tax_rates for select
  using (organization_id in (select app.current_orgs()));
create policy tax_rates_insert on tax_rates for insert
  with check (app.has_role(organization_id, array['owner', 'admin']::membership_role[]));
create policy tax_rates_update on tax_rates for update
  using (app.has_role(organization_id, array['owner', 'admin']::membership_role[]))
  with check (organization_id in (select app.current_orgs()));

-- ----------------------------------------------------------------------------
-- Cuentas de caja · las ve quien puede ver dinero
-- ----------------------------------------------------------------------------

create policy cash_accounts_select on cash_accounts for select
  using (
    organization_id in (select app.current_orgs())
    and app.can_write_money(organization_id)
  );
create policy cash_accounts_insert on cash_accounts for insert
  with check (app.has_role(organization_id, array['owner', 'admin']::membership_role[]));
create policy cash_accounts_update on cash_accounts for update
  using (app.has_role(organization_id, array['owner', 'admin']::membership_role[]))
  with check (organization_id in (select app.current_orgs()));

-- ----------------------------------------------------------------------------
-- Tasas de cambio · las globales las ve todo el mundo
-- ----------------------------------------------------------------------------

create policy fx_rates_select on fx_rates for select
  using (organization_id is null or organization_id in (select app.current_orgs()));
create policy fx_rates_insert on fx_rates for insert
  with check (
    organization_id is not null
    and app.can_write_money(organization_id)
  );
-- Sin UPDATE: una tasa no se corrige, se añade otra con as_of posterior.

create policy categories_select on financial_categories for select
  using (organization_id in (select app.current_orgs()));
create policy categories_insert on financial_categories for insert
  with check (app.can_write_money(organization_id));
create policy categories_update on financial_categories for update
  using (app.can_write_money(organization_id))
  with check (organization_id in (select app.current_orgs()));

-- ----------------------------------------------------------------------------
-- audit_log · se lee, no se escribe ni se toca
-- ----------------------------------------------------------------------------

create policy audit_log_select on audit_log for select
  using (
    organization_id in (select app.current_orgs())
    and app.has_role(organization_id, array['owner', 'admin']::membership_role[])
  );
