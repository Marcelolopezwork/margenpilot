-- ============================================================================
-- Margen Pilot · F2 · Clientes y cotizaciones (F2-6 a F2-9)
--
-- Dos cosas se copian a la cotización en vez de referenciarse, y es a
-- propósito: la tasa de impuesto y el costo de cada línea. Si mañana sube el
-- IGV o le subes el sueldo a un diseñador, la cotización que ya enviaste
-- sigue diciendo exactamente lo que decía. Una cotización es una promesa con
-- fecha, no una consulta a los datos de hoy.
--
-- Y los costos de una línea siguen siendo invisibles para el rol comercial,
-- igual que en el catálogo (ADR-34).
-- ============================================================================

create type quote_status as enum ('draft', 'sent', 'approved', 'rejected', 'expired', 'void');

-- Hacen falta para las claves ajenas compuestas: cruzar organizaciones tiene
-- que ser imposible por estructura, no por un disparador que se pueda olvidar.
alter table legal_entities add constraint legal_entities_id_org_key unique (id, organization_id);
alter table brands         add constraint brands_id_org_key         unique (id, organization_id);

create table clients (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  name            text not null,
  tax_id          text,
  email           text,
  notes           text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, name),
  unique (id, organization_id)
);

create table quotes (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  legal_entity_id uuid not null,
  brand_id        uuid,
  client_id       uuid not null,
  number          text not null,
  currency_code   char(3) not null references currencies (code),
  tax_rate_pct    numeric(7,4) not null default 0 check (tax_rate_pct >= 0),
  tax_label       text,
  status          quote_status not null default 'draft',
  valid_until     date,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, legal_entity_id, number),
  unique (id, organization_id),
  foreign key (legal_entity_id, organization_id)
    references legal_entities (id, organization_id),
  foreign key (brand_id, organization_id) references brands (id, organization_id),
  foreign key (client_id, organization_id) references clients (id, organization_id)
);

create index quotes_org_idx    on quotes (organization_id, created_at desc);
create index quotes_entity_idx on quotes (legal_entity_id);
create index quotes_client_idx on quotes (client_id);

create table quote_lines (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  quote_id        uuid not null,
  service_id      uuid,
  description     text not null,
  quantity        numeric(18,4) not null check (quantity > 0),
  unit_price      numeric(18,4) not null check (unit_price >= 0),
  sort            int not null default 0,
  created_at      timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (quote_id, organization_id)
    references quotes (id, organization_id) on delete cascade,
  foreign key (service_id, organization_id) references services (id, organization_id)
);

create index quote_lines_quote_idx on quote_lines (quote_id, sort);

create table quote_line_costs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  quote_line_id   uuid not null,
  cost_item_id    uuid,
  label           text,
  quantity        numeric(18,4) not null check (quantity > 0),
  unit_cost       numeric(18,4) not null check (unit_cost >= 0),
  unit            text not null default 'hora',
  sort            int not null default 0,
  created_at      timestamptz not null default now(),
  foreign key (quote_line_id, organization_id)
    references quote_lines (id, organization_id) on delete cascade,
  foreign key (cost_item_id, organization_id) references cost_items (id, organization_id),
  check (cost_item_id is not null or nullif(btrim(label), '') is not null)
);

create index quote_line_costs_line_idx on quote_line_costs (quote_line_id, sort);
create index quote_line_costs_item_idx on quote_line_costs (cost_item_id);

create trigger quotes_currency_check
  before insert or update of currency_code on quotes
  for each row execute function app.check_catalog_currency('currency_code');

create trigger clients_touch before update on clients
  for each row execute function app.touch_updated_at();
create trigger quotes_touch before update on quotes
  for each row execute function app.touch_updated_at();

do $$
declare t text;
begin
  foreach t in array array['clients', 'quotes', 'quote_lines', 'quote_line_costs'] loop
    execute format(
      'create trigger %I_audit after insert or update or delete on %I for each row execute function app.audit_changes()',
      t, t);
  end loop;
end $$;

-- Numeración única por entidad y año. El lock cierra la carrera de dos
-- cotizaciones creadas a la vez, que es lo que produce números repetidos.
create or replace function next_quote_number(p_entity uuid) returns text
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org  uuid;
  v_anio text := to_char(now(), 'YYYY');
  v_n    int;
begin
  select organization_id into v_org from legal_entities where id = p_entity;
  if v_org is null then
    raise exception 'unknown_entity: la entidad no existe' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from memberships
                 where organization_id = v_org and user_id = auth.uid() and status = 'active') then
    raise exception 'not_authenticated' using errcode = 'insufficient_privilege';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_entity::text || ':' || v_anio, 0));

  select count(*) + 1 into v_n
  from quotes
  where legal_entity_id = p_entity and number like 'COT-' || v_anio || '-%';

  return 'COT-' || v_anio || '-' || lpad(v_n::text, 3, '0');
end $$;

revoke all on function next_quote_number(uuid) from public, anon;
grant execute on function next_quote_number(uuid) to authenticated;

grant select, insert, update on clients, quotes, quote_lines, quote_line_costs to authenticated;

alter table clients          enable row level security;
alter table quotes           enable row level security;
alter table quote_lines      enable row level security;
alter table quote_line_costs enable row level security;

alter table clients          force row level security;
alter table quotes           force row level security;
alter table quote_lines      force row level security;
alter table quote_line_costs force row level security;

create policy clients_select on clients for select
  using (organization_id in (select app.current_orgs()));
create policy clients_insert on clients for insert
  with check (app.has_role(organization_id,
    array['owner','admin','finance','commercial']::membership_role[]));
create policy clients_update on clients for update
  using (app.has_role(organization_id,
    array['owner','admin','finance','commercial']::membership_role[]))
  with check (organization_id in (select app.current_orgs()));

create policy quotes_select on quotes for select
  using (organization_id in (select app.current_orgs()));
create policy quotes_insert on quotes for insert
  with check (app.has_role(organization_id,
    array['owner','admin','finance','commercial']::membership_role[]));
create policy quotes_update on quotes for update
  using (app.has_role(organization_id,
    array['owner','admin','finance','commercial']::membership_role[]))
  with check (organization_id in (select app.current_orgs()));

create policy quote_lines_select on quote_lines for select
  using (organization_id in (select app.current_orgs()));
create policy quote_lines_insert on quote_lines for insert
  with check (app.has_role(organization_id,
    array['owner','admin','finance','commercial']::membership_role[]));
create policy quote_lines_update on quote_lines for update
  using (app.has_role(organization_id,
    array['owner','admin','finance','commercial']::membership_role[]))
  with check (organization_id in (select app.current_orgs()));

create policy quote_line_costs_select on quote_line_costs for select
  using (app.can_see_costs(organization_id));
create policy quote_line_costs_insert on quote_line_costs for insert
  with check (app.can_see_costs(organization_id));
create policy quote_line_costs_update on quote_line_costs for update
  using (app.can_see_costs(organization_id))
  with check (app.can_see_costs(organization_id));
