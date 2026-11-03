-- ============================================================================
-- Margen Pilot · F2 · Catálogos: fichas de servicio y su composición de costos
--
-- De aquí sale el margen, que es la razón de ser del producto.
--
-- La regla que ordena todo este archivo: **el precio lo ve quien cotiza, el
-- costo no**. El rol `commercial` no puede leer `cost_items` ni
-- `service_cost_lines`, y eso no se resuelve ocultando columnas en la
-- interfaz —cualquiera con la clave pública llamaría a la API y las vería—,
-- sino con RLS. Ya existe `app.can_see_costs()` desde F1 (F2-5).
--
-- Los importes van en `numeric`, nunca en `bigint`. Verificado el 03/11/2026
-- contra el proyecto real: PostgREST entrega `numeric` como texto y `bigint`
-- como número de JavaScript. Un bigint de unidades mínimas perdería precisión
-- al cruzar JSON por encima de 2^53; el numeric llega entero y entra por
-- `money.fromDb` (FINANCIAL_RULES.md §4).
-- ============================================================================

create type cost_item_kind as enum ('role', 'tool', 'external', 'other');
create type service_kind   as enum ('one_off', 'recurring', 'retainer');
create type term_kind      as enum ('include', 'exclude', 'condition', 'note');

-- ----------------------------------------------------------------------------
-- Categorías de servicio
-- ----------------------------------------------------------------------------

create table service_categories (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  name            text not null,
  sort            int  not null default 0,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  unique (organization_id, name)
);

-- ----------------------------------------------------------------------------
-- Ítems de costo · lo que cuesta producir, reutilizable entre fichas (F2-1)
-- ----------------------------------------------------------------------------

create table cost_items (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  name            text not null,
  kind            cost_item_kind not null default 'role',
  -- Texto libre: cada agencia mide distinto («hora», «mes», «palabra»,
  -- «proyecto») y una lista cerrada envejece mal.
  unit            text not null default 'hora',
  unit_cost       numeric(18,4) not null check (unit_cost >= 0),
  currency_code   char(3) not null references currencies (code),
  notes           text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, name),
  -- Permite la clave ajena compuesta de abajo: una línea de costo no puede
  -- apuntar a un ítem de otra organización, y eso queda garantizado por la
  -- estructura, no por un disparador que alguien pueda olvidar.
  unique (id, organization_id)
);

-- ----------------------------------------------------------------------------
-- Fichas de servicio (F2-2)
-- ----------------------------------------------------------------------------

create table services (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  code            text not null,
  name            text not null,
  category_id     uuid references service_categories (id),
  description     text,
  kind            service_kind not null default 'one_off',
  -- Solo tiene sentido en los recurrentes: «mensual», «trimestral»…
  periodicity     text,
  suggested_currency_code char(3) references currencies (code),
  -- Fee por defecto SOBRE EL COSTO, en porcentaje: 80 significa precio =
  -- costo × 1,80. Es markup sobre costo, no margen sobre precio. Confundir
  -- los dos es el error exacto que tenía el cotizador anterior, y por eso
  -- el nombre de la columna dice «fee» y no «margen».
  default_fee_pct numeric(7,4) not null default 0 check (default_fee_pct >= 0),
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, code),
  unique (id, organization_id),
  check (kind = 'one_off' or nullif(btrim(periodicity), '') is not null)
);

-- ----------------------------------------------------------------------------
-- Incluye · no incluye · condiciones · notas (F2-3)
--
-- Van en su propia tabla y no en un campo de texto porque el orden importa:
-- el PDF los imprime en el orden que fije el usuario, y una lista ordenable
-- necesita una fila por elemento.
-- ----------------------------------------------------------------------------

create table service_terms (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  service_id      uuid not null,
  kind            term_kind not null,
  content         text not null,
  sort            int not null default 0,
  created_at      timestamptz not null default now(),
  foreign key (service_id, organization_id)
    references services (id, organization_id) on delete cascade
);

create index service_terms_service_idx on service_terms (service_id, kind, sort);

-- ----------------------------------------------------------------------------
-- Composición de costos de la ficha (F2-4)
-- ----------------------------------------------------------------------------

create table service_cost_lines (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  service_id      uuid not null,
  -- Una línea puede venir del catálogo o ser algo puntual de esta ficha.
  cost_item_id    uuid,
  label           text,
  quantity        numeric(18,4) not null check (quantity > 0),
  -- Copia del costo del ítem en el momento de añadirlo. Es lo que permite
  -- desactivar o encarecer un ítem del catálogo sin alterar las fichas que ya
  -- existían, que es la aceptación de F2-1.
  unit_cost       numeric(18,4) not null check (unit_cost >= 0),
  unit            text not null default 'hora',
  currency_code   char(3) not null references currencies (code),
  sort            int not null default 0,
  created_at      timestamptz not null default now(),
  foreign key (service_id, organization_id)
    references services (id, organization_id) on delete cascade,
  foreign key (cost_item_id, organization_id)
    references cost_items (id, organization_id),
  -- O viene del catálogo, o lleva su propio nombre. Sin una de las dos, la
  -- línea no se puede ni mostrar.
  check (cost_item_id is not null or nullif(btrim(label), '') is not null)
);

create index service_cost_lines_service_idx on service_cost_lines (service_id, sort);
create index service_cost_lines_item_idx    on service_cost_lines (cost_item_id);
create index services_category_idx          on services (category_id);

-- Las claves ajenas por organization_id no llevan índice propio: la columna va
-- primera en el índice único de cada tabla y eso ya las cubre (ADR-24).

-- ----------------------------------------------------------------------------
-- Una moneda que no está habilitada no puede entrar por la puerta de atrás
-- ----------------------------------------------------------------------------

create or replace function app.check_catalog_currency() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_columna text := tg_argv[0];
  v_codigo  text := to_jsonb(new) ->> v_columna;
  v_org     uuid := (to_jsonb(new) ->> 'organization_id')::uuid;
begin
  -- En services la moneda es una sugerencia y puede faltar.
  if v_codigo is null then return new; end if;

  if not exists (
    select 1 from organization_currencies
    where organization_id = v_org
      and currency_code   = v_codigo
      and is_enabled
  ) then
    raise exception 'currency_not_enabled: % no está habilitada en esta organización', v_codigo
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

revoke all on function app.check_catalog_currency() from public;

create trigger cost_items_currency_check
  before insert or update of currency_code on cost_items
  for each row execute function app.check_catalog_currency('currency_code');

create trigger service_cost_lines_currency_check
  before insert or update of currency_code on service_cost_lines
  for each row execute function app.check_catalog_currency('currency_code');

create trigger services_currency_check
  before insert or update of suggested_currency_code on services
  for each row execute function app.check_catalog_currency('suggested_currency_code');

-- ----------------------------------------------------------------------------
-- updated_at y auditoría
-- ----------------------------------------------------------------------------

create trigger cost_items_touch before update on cost_items
  for each row execute function app.touch_updated_at();
create trigger services_touch before update on services
  for each row execute function app.touch_updated_at();

-- Se audita lo que mueve dinero. Las categorías y los términos no.
do $$
declare t text;
begin
  foreach t in array array['cost_items', 'services', 'service_cost_lines'] loop
    execute format(
      'create trigger %I_audit after insert or update or delete on %I for each row execute function app.audit_changes()',
      t, t);
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- Privilegios
--
-- Explícitos porque ADR-25 revocó los privilegios por defecto que Supabase
-- concedía solo. `anon` no recibe nada: en este producto no hay pantalla sin
-- sesión.
-- ----------------------------------------------------------------------------

grant select, insert, update on
  service_categories, cost_items, services, service_terms, service_cost_lines
to authenticated;

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------

alter table service_categories enable row level security;
alter table cost_items         enable row level security;
alter table services           enable row level security;
alter table service_terms      enable row level security;
alter table service_cost_lines enable row level security;

alter table service_categories force row level security;
alter table cost_items         force row level security;
alter table services           force row level security;
alter table service_terms      force row level security;
alter table service_cost_lines force row level security;

-- Catálogo visible: el comercial necesita las fichas para cotizar.
create policy service_categories_select on service_categories for select
  using (organization_id in (select app.current_orgs()));
create policy service_categories_insert on service_categories for insert
  with check (app.has_role(organization_id, array['owner', 'admin']::membership_role[]));
create policy service_categories_update on service_categories for update
  using (app.has_role(organization_id, array['owner', 'admin']::membership_role[]))
  with check (organization_id in (select app.current_orgs()));

create policy services_select on services for select
  using (organization_id in (select app.current_orgs()));
create policy services_insert on services for insert
  with check (app.has_role(organization_id,
    array['owner', 'admin', 'finance']::membership_role[]));
create policy services_update on services for update
  using (app.has_role(organization_id, array['owner', 'admin', 'finance']::membership_role[]))
  with check (organization_id in (select app.current_orgs()));

create policy service_terms_select on service_terms for select
  using (organization_id in (select app.current_orgs()));
create policy service_terms_insert on service_terms for insert
  with check (app.has_role(organization_id,
    array['owner', 'admin', 'finance']::membership_role[]));
create policy service_terms_update on service_terms for update
  using (app.has_role(organization_id, array['owner', 'admin', 'finance']::membership_role[]))
  with check (organization_id in (select app.current_orgs()));

-- Costos: el comercial no los ve. Cero filas, no columnas vacías (F2-5).
create policy cost_items_select on cost_items for select
  using (app.can_see_costs(organization_id));
create policy cost_items_insert on cost_items for insert
  with check (app.can_see_costs(organization_id));
create policy cost_items_update on cost_items for update
  using (app.can_see_costs(organization_id))
  with check (app.can_see_costs(organization_id));

create policy service_cost_lines_select on service_cost_lines for select
  using (app.can_see_costs(organization_id));
create policy service_cost_lines_insert on service_cost_lines for insert
  with check (app.can_see_costs(organization_id));
create policy service_cost_lines_update on service_cost_lines for update
  using (app.can_see_costs(organization_id))
  with check (app.can_see_costs(organization_id));
