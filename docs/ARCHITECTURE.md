# Arquitectura

**Estado:** propuesta de diseño. Ninguna migración creada, ningún proyecto Supabase creado.
**Convenciones:** `snake_case`, inglés en el esquema, español en la UI. Toda tabla de negocio lleva `id uuid pk default gen_random_uuid()`, `organization_id uuid not null`, `created_at timestamptz not null default now()`, `updated_at`, `created_by uuid`.

---

## 1. Stack

| Capa | Decisión | Nota |
|---|---|---|
| Frontend web | React 18 + TypeScript + Vite | Mobile-first, responsive. PWA instalable en F2. |
| UI | Tailwind + Radix primitives + tokens propios | Radix da accesibilidad real (foco, teclado, ARIA) sin imponer estética. Ver `UI_UX_PLAN.md`. |
| Estado / datos | TanStack Query + cliente Supabase tipado (`supabase gen types`) | Sin Redux. El servidor es la fuente de verdad. |
| Formularios | react-hook-form + zod | El mismo esquema zod valida en cliente y en Edge Functions. |
| Backend | Supabase nuevo y exclusivo: Postgres 15+, Auth, Storage privado, Edge Functions | Las dos apps viejas y sus proyectos quedan intactos. |
| Dinero en cliente | `dinero.js` o enteros propios + `Intl.NumberFormat` | Prohibido `number` crudo para montos. Ver `FINANCIAL_RULES.md` §4. |
| PDF | Edge Function (Deno) con render server-side desde el snapshot | Nunca generar el PDF desde el catálogo vivo. |
| Parsers | Edge Function; CSV con `papaparse`, XLSX con `sheetjs`, ambos server-side | El archivo nunca se parsea en el navegador: el navegador no debe ver el archivo más de lo necesario y el resultado debe ser reproducible. |
| Tests | pgTAP (invariantes + RLS), Vitest (dominio), Playwright (flujos críticos) | Ver `TEST_PLAN.md`. |
| CI | GitHub Actions: typecheck, lint, test, `supabase db diff` limpio, migraciones aplicadas en DB efímera | Bloquea merge. |
| Hosting web | **SiteGround** (ADR-21) | SPA en hosting compartido: el build incluye `.htaccess` con reescritura a `index.html`, cabeceras de seguridad y caché con hash. Despliegue por SFTP desde `dist/`. Sin staging por rama: se suple con subdominio de pruebas. |
| Entornos | local (Supabase CLI) → staging → producción | Producción no se toca a mano. Nunca. |

**Regla de oro del backend:** la `service_role` key no existe fuera de Edge Functions y de los secretos de CI. El cliente web y móvil solo usan la `anon` key y viven bajo RLS.

---

## 2. Modelo de datos: visión general

Siete grupos. El corazón es el grupo 4: **una sola tabla de caja**, partida por entidad.

### 2.0 Dos libros, una tabla: cómo se impone ADR-16

Perú y Estados Unidos son dos contabilidades separadas. Eso **no** se logra con dos tablas, se logra con `legal_entity_id` obligatorio y con que todo informe se agrupe por él:

| Qué | Cómo queda garantizado |
|---|---|
| Cada cuenta pertenece a una entidad y tiene una sola moneda | `cash_accounts.legal_entity_id` + `currency_code`, ambos `not null` |
| Ningún movimiento puede cambiar de libro | trigger: `cash_movements.legal_entity_id` y `currency_code` se validan contra su cuenta (INV-9, INV-11) |
| Ningún resultado mezcla las dos | las vistas de Resultado llevan `legal_entity_id` en el `GROUP BY`; no existe ninguna vista que sume entidades |
| Cada entidad tiene su régimen de impuesto | `tax_rates.legal_entity_id`: SAC al 18 %, LLC al 0 % |
| El consolidado de caja es la única excepción | referencial, etiquetado con tasa, fecha y fuente, nunca almacenado (ADR-14, D-5) |

Partir la caja en dos tablas daría los mismos dos libros y además: dos caminos para cada consulta, dos sitios donde corregir un error, y ninguna forma de mostrar el total referencial del Inicio que sí quieres ver. La separación por entidad es total; la tabla es una.

```
[1] Identidad SaaS        organizations · profiles · memberships · plans · plan_entitlements
                          subscriptions · stripe_events · org_usage · audit_log
[2] Empresa y dinero base legal_entities · brands · currencies · organization_currencies
                          cash_accounts · fx_rates · tax_rates · financial_categories
[3] Comercial             clients · contacts · lead_sources · service_categories · services
                          cost_items · suppliers · service_cost_lines
                          quotes · quote_lines · quote_line_costs · quote_versions · quote_events
[4] Caja (núcleo)         cash_movements  ← única fuente de verdad del dinero
                          transfers · payment_allocations
[5] Obligaciones          billing_documents · payment_schedule_items · recurring_expenses
[6] Conciliación          import_formats · statement_imports · statement_lines
                          reconciliation_matches · reconciliation_decisions
[7] Sistema               alerts · api_tokens · api_access_log
```

### 2.1 Las cuatro relaciones que definen el sistema

```
                 (proyección)                (obligación)                 (dinero)
quotes ──aprobar──▶ payment_schedule_items ──▶ billing_documents ◀──┐
   │                                                                │
   └──emitir──▶ quote_versions (inmutable, PDF)        payment_allocations (n:m)
                                                                    │
cash_accounts ──1:n──▶ cash_movements ◀─────────────────────────────┘
                              ▲
                              │ reconciliation_matches (n:m)
                              ▼
statement_imports ──1:n──▶ statement_lines
```

Leído en palabras:
1. Una **cotización aprobada** produce **cuotas previstas** (proyección, no cartera).
2. Una cuota se **documenta** y se vuelve una **obligación** (cartera).
3. El **dinero** solo existe como `cash_movements` en una cuenta concreta.
4. Un movimiento se **asigna** a una o varias obligaciones (`payment_allocations`), y se **concilia** con una o varias líneas del banco (`reconciliation_matches`). Asignar y conciliar **nunca crean dinero**.

---

## 3. Grupo 4: el núcleo de caja

Esta es la decisión arquitectónica principal y la respuesta a §4 del plan ("definir si `receipts_payments` es el libro de caja", "evitar duplicar el libro de caja"). Tres tablas hermanas para cobros, gastos y transferencias serían tres libros de caja. Hay uno.

```sql
create type cash_direction as enum ('in','out');

create type cash_kind as enum (
  'operating',           -- cobro o pago operativo (con o sin documento)
  'transfer',            -- pata de una transferencia entre cuentas propias
  'opening',             -- saldo de apertura (1/1/2027)
  'owner_draw',          -- retiro del dueño
  'owner_contribution',  -- aporte del dueño
  'loan_in',             -- préstamo recibido
  'loan_repayment',      -- amortización de préstamo
  'bank_fee',            -- comisión / mantenimiento / ITF
  'tax_payment',         -- pago de impuestos
  'fx_adjustment',       -- diferencia de cambio
  'refund'               -- devolución / reverso
);

create type flow_class as enum ('operating','non_operating','internal_transfer','opening');

create table cash_movements (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id),
  cash_account_id   uuid not null references cash_accounts(id),
  legal_entity_id   uuid not null references legal_entities(id),  -- validado = cuenta.legal_entity_id
  direction         cash_direction not null,
  amount            numeric(18,2) not null check (amount > 0),    -- siempre positivo; el signo lo da direction
  currency_code     char(3) not null,                             -- validado = cuenta.currency_code
  value_date        date not null,                                -- fecha en que el banco movió el dinero
  booked_at         timestamptz not null default now(),           -- cuándo lo registramos nosotros
  kind              cash_kind not null,
  flow_class        flow_class not null generated always as (
                      case kind
                        when 'transfer'           then 'internal_transfer'
                        when 'opening'            then 'opening'
                        when 'operating'          then 'operating'
                        when 'bank_fee'           then 'operating'
                        when 'tax_payment'        then 'operating'
                        when 'refund'             then 'operating'
                        else 'non_operating'
                      end::flow_class) stored,
  category_id       uuid references financial_categories(id),
  counterparty_kind text check (counterparty_kind in ('client','supplier','internal','other')),
  client_id         uuid references clients(id),
  supplier_id       uuid references suppliers(id),
  description       text not null,
  external_ref      text,                      -- nº de operación, voucher, referencia que el banco mostrará
  amount_net        numeric(18,2),             -- solo si el movimiento es su propio hecho económico
  amount_tax        numeric(18,2),             --   (gasto sin documento). Ver INV-6.
  transfer_id       uuid references transfers(id),
  source            text not null default 'manual'
                      check (source in ('manual','quote','recurring','bank_import','opening','api')),
  is_void           boolean not null default false,
  void_of_id        uuid references cash_movements(id),  -- este movimiento revierte a aquel
  void_reason       text,
  created_by        uuid not null,
  created_at        timestamptz not null default now()
);

create index on cash_movements (organization_id, cash_account_id, value_date desc);
create index on cash_movements (organization_id, legal_entity_id, value_date desc);
create index on cash_movements (organization_id, client_id) where client_id is not null;
create index on cash_movements (organization_id, external_ref) where external_ref is not null;
```

**Saldo de una cuenta — una sola definición, para siempre:**

```sql
create view account_balances as
select cash_account_id,
       organization_id,
       currency_code,
       sum(case when direction = 'in' then amount else -amount end) as balance
from cash_movements
where not is_void
group by 1,2,3;
```

Como la apertura es un `cash_movement` de `kind='opening'`, no hay una segunda fórmula ni un "saldo inicial + movimientos". Hay saldo. Esto hace que el criterio §8.5 del plan (apertura no es venta) sea automático: `flow_class='opening'` nunca entra en el lente Resultado.

### 3.1 Transferencias

```sql
create table transfers (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null,
  from_account_id  uuid not null references cash_accounts(id),
  to_account_id    uuid not null references cash_accounts(id) check (to_account_id <> from_account_id),
  value_date       date not null,
  from_amount      numeric(18,2) not null check (from_amount > 0),
  to_amount        numeric(18,2) not null check (to_amount > 0),
  from_currency    char(3) not null,
  to_currency      char(3) not null,
  fx_rate          numeric(18,8),      -- obligatorio si from_currency <> to_currency
  fee_amount       numeric(18,2) not null default 0,
  fee_account_id   uuid references cash_accounts(id),
  out_movement_id  uuid not null references cash_movements(id),
  in_movement_id   uuid not null references cash_movements(id),
  fee_movement_id  uuid references cash_movements(id),
  note             text,
  created_by       uuid not null,
  constraint fx_required check (
    (from_currency = to_currency and fx_rate is null)
    or (from_currency <> to_currency and fx_rate is not null)
  )
);
```

Se crean con una función `create_transfer(...)` en una sola transacción: inserta el movimiento `out` (`kind='transfer'`), el `in` (`kind='transfer'`), el de comisión si hay (`kind='bank_fee'`), y la cabecera que los ata. Los tres quedan con `flow_class='internal_transfer'` o `operating` (la comisión sí es gasto real). **Criterio §8.10 satisfecho por construcción:** una transferencia no puede sumar ingreso porque `internal_transfer` está excluido del lente Resultado por definición, no por un `WHERE` que alguien pueda olvidar.

### 3.2 Asignaciones

```sql
create table payment_allocations (
  id                       uuid primary key default gen_random_uuid(),
  organization_id          uuid not null,
  cash_movement_id         uuid not null references cash_movements(id),
  billing_document_id      uuid references billing_documents(id),
  payment_schedule_item_id uuid references payment_schedule_items(id),
  amount                   numeric(18,2) not null check (amount > 0),
  currency_code            char(3) not null,
  created_by               uuid not null,
  created_at               timestamptz not null default now(),
  constraint target_required check (
    (billing_document_id is not null)::int + (payment_schedule_item_id is not null)::int >= 1
  )
);
```

n:m en ambos sentidos: un cobro cubre varias facturas, y una factura recibe varios cobros parciales. Los límites (`Σ asignado ≤ monto del movimiento`, `Σ asignado ≤ total del documento`, monedas iguales) se imponen con triggers `AFTER INSERT/UPDATE DEFERRABLE`; están especificados como INV-2 a INV-4 en `FINANCIAL_RULES.md`.

---

## 4. Grupos 3 y 5: comercial y obligaciones

### 4.1 Catálogo de servicios

Unifico `personal` + `herramientas` + freelancers del cotizador viejo en **un** catálogo de costos, porque son la misma cosa con distinta etiqueta:

```sql
create type cost_kind as enum ('role','tool','external','other');

create table cost_items (               -- catálogo reutilizable
  id uuid primary key, organization_id uuid not null,
  kind cost_kind not null,
  name text not null, role text,
  unit text not null default 'unit' check (unit in ('hour','day','month','unit','license','project')),
  unit_cost numeric(18,4) not null default 0,
  currency_code char(3) not null,
  supplier_id uuid references suppliers(id),
  is_active boolean not null default true
);

create table services (
  id uuid primary key, organization_id uuid not null,
  code text, name text not null,
  category_id uuid references service_categories(id),
  description text,
  kind text not null check (kind in ('one_shot','recurring')),
  recurrence text check (recurrence in ('monthly','quarterly','yearly')),
  suggested_currency char(3),
  includes   jsonb not null default '[]',   -- [{sort, text}] ordenable
  excludes   jsonb not null default '[]',
  terms text,
  default_fee_pct numeric(7,4),
  suggested_price numeric(18,2),
  default_tax_rate_id uuid references tax_rates(id),
  is_active boolean not null default true,
  unique (organization_id, code)
);

create table service_cost_lines (        -- composición de costo de la ficha
  id uuid primary key, organization_id uuid not null,
  service_id uuid not null references services(id) on delete cascade,
  cost_item_id uuid references cost_items(id),   -- null = línea ad-hoc
  kind cost_kind not null, name text not null,
  qty numeric(18,4) not null default 1, unit text not null,
  unit_cost numeric(18,4) not null, currency_code char(3) not null,
  sort int not null default 0
);
```

`includes` / `excludes` como `jsonb` ordenable y no como tabla: son texto libre ordenable que solo se lee junto al servicio, nunca se consulta de forma transversal, y el snapshot los congela igual. Una tabla aquí añade dos joins y cero capacidad.

### 4.2 Cotizaciones: lo que ve el cliente, lo que ve finanzas, y lo congelado

Tres tablas con tres propósitos distintos — esta separación es la que resuelve a la vez la inmutabilidad (§3.2 del plan) y la confidencialidad de costos (§4 del plan):

```sql
create type quote_status as enum ('draft','sent','negotiation','approved','lost','void');

create table quotes (
  id uuid primary key, organization_id uuid not null,
  legal_entity_id uuid not null references legal_entities(id),   -- quién factura
  brand_id uuid references brands(id),                           -- cómo se presenta
  client_id uuid not null references clients(id),
  number text not null,                                          -- serie por entidad
  currency_code char(3) not null,
  tax_rate_id uuid references tax_rates(id),
  lead_source_id uuid references lead_sources(id),
  is_recurring boolean not null default false, recurrence text,
  status quote_status not null default 'draft',
  valid_until date,
  current_version_no int not null default 0,     -- 0 = nunca emitida
  -- totales cacheados del último cálculo, para listar sin recomputar:
  total_net numeric(18,2), total_tax numeric(18,2), total_gross numeric(18,2),
  total_cost numeric(18,2), margin_pct numeric(7,4),
  created_by uuid not null,
  unique (organization_id, legal_entity_id, number)
);

create table quote_lines (            -- visible a rol comercial
  id uuid primary key, organization_id uuid not null,
  quote_id uuid not null references quotes(id) on delete cascade,
  service_id uuid references services(id),
  name text not null, description text,
  qty numeric(18,4) not null default 1,
  unit_price_net numeric(18,4) not null,     -- editable a mano o derivado de costo×(1+fee)
  fee_pct numeric(7,4),                      -- cómo se derivó el precio, si se derivó
  tax_rate numeric(7,4) not null default 0,
  includes jsonb not null default '[]', excludes jsonb not null default '[]',
  sort int not null default 0
);

create table quote_line_costs (       -- RLS propia: solo owner/admin/finance
  id uuid primary key, organization_id uuid not null,
  quote_id uuid not null references quotes(id) on delete cascade,
  quote_line_id uuid not null references quote_lines(id) on delete cascade,
  cost_item_id uuid references cost_items(id),
  kind cost_kind not null, name text not null,
  qty numeric(18,4) not null, unit text not null,
  unit_cost numeric(18,4) not null, currency_code char(3) not null,
  fx_rate_used numeric(18,8),      -- si el costo está en otra moneda que la cotización
  subtotal numeric(18,4) not null generated always as (qty * unit_cost) stored
);

create table quote_versions (         -- inmutable. sin UPDATE ni DELETE, por RLS
  id uuid primary key, organization_id uuid not null,
  quote_id uuid not null references quotes(id),
  version_no int not null,
  issued_at timestamptz not null default now(), issued_by uuid not null,
  snapshot jsonb not null,     -- entidad, marca, cliente, líneas, costos, impuestos,
                               -- incluye/no incluye, términos, validez, TC usados
  totals jsonb not null,       -- net, tax, gross, cost, profit, margin_pct, markup_pct
  pdf_path text, pdf_sha256 text,
  unique (quote_id, version_no)
);

create table quote_events (           -- bitácora: toda transición y acción sensible
  id bigserial primary key, organization_id uuid not null,
  quote_id uuid not null references quotes(id),
  at timestamptz not null default now(), actor_id uuid not null,
  from_status quote_status, to_status quote_status,
  action text not null, note text
);
```

**Máquina de estados** (transiciones permitidas, impuestas por trigger):

```
draft ──▶ sent ──▶ negotiation ──▶ approved
  │         │           │              │
  │         └───────────┴──────▶ lost  └──▶ void
  └──▶ void                        │
                                   └──▶ sent   (reabrir negociación)
```

- `draft → sent` **emite**: crea `quote_versions` v1 con snapshot + PDF, e incrementa `current_version_no`.
- Editar una cotización ya emitida es legal, pero `sent → sent` emite **v2**; v1 queda intacta con su PDF. Nunca se reescribe una versión.
- `approved` dispara la creación de `payment_schedule_items` en estado `planned`, **editables antes de confirmar** (§3.3.5 del plan).
- `void` exige motivo y conserva todo (§8.9).

### 4.3 Obligaciones y cronogramas

```sql
create table billing_documents (
  id uuid primary key, organization_id uuid not null,
  legal_entity_id uuid not null,
  direction text not null check (direction in ('sale','purchase')),
  doc_type text not null check (doc_type in ('invoice','boleta','receipt','note','credit_note','other')),
  series_number text,
  client_id uuid references clients(id), supplier_id uuid references suppliers(id),
  issue_date date not null, due_date date,
  currency_code char(3) not null,
  amount_net numeric(18,2) not null, amount_tax numeric(18,2) not null default 0,
  amount_total numeric(18,2) not null,
  tax_rate numeric(7,4),
  quote_version_id uuid references quote_versions(id),
  is_opening boolean not null default false,     -- obligación viva al 1/1/2027
  status text not null default 'open'            -- derivado por trigger desde allocations
      check (status in ('draft','open','partially_paid','paid','void')),
  void_reason text,
  created_by uuid not null,
  constraint totals_consistent check (amount_total = amount_net + amount_tax),
  constraint counterparty_xor check (
    (direction = 'sale'     and client_id   is not null and supplier_id is null)
 or (direction = 'purchase' and supplier_id is not null and client_id   is null))
);

-- Construida en la migración 20261105170000. Dos diferencias con lo que decía
-- este documento, las dos deliberadas:
--   · `status` es un enum y no un `text` con `check`, porque los tipos que
--     genera Supabase convierten un enum en una unión de literales y eso hace
--     que un estado nuevo rompa la compilación en vez de colarse;
--   · lleva `legal_entity_id` y claves compuestas, para que cruzar los dos
--     libros no sea algo que se comprueba sino algo que no existe (ADR-16).
-- `billing_document_id` llega con F3, que es cuando habrá documentos.
create type schedule_status as enum ('planned','documented','settled','cancelled');

create table payment_schedule_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  legal_entity_id uuid not null,
  quote_id uuid, quote_version_id uuid,
  direction text not null default 'in' check (direction in ('in','out')),
  label text not null check (btrim(label) <> ''),   -- 'Anticipo 50 %', 'Cuota 1 de 3'
  due_date date not null,
  amount numeric(18,2) not null check (amount > 0),
  currency_code char(3) not null references currencies(code),
  expected_cash_account_id uuid,
  status schedule_status not null default 'planned',
  sort int not null default 0,
  foreign key (quote_id, organization_id, legal_entity_id, currency_code)
    references quotes(id, organization_id, legal_entity_id, currency_code) on delete cascade,
  foreign key (expected_cash_account_id, organization_id, legal_entity_id, currency_code)
    references cash_accounts(id, organization_id, legal_entity_id, currency_code)
);
```

La tabla no se escribe desde el cliente: `authenticated` solo tiene `select`.
La única puerta es `guardar_cronograma(p_quote, p_items)`, que recibe la lista
**entera** y exige que sume el total de la versión aprobada. Fila a fila el
cronograma estaría descuadrado entre una escritura y la siguiente, y entonces
cuadrar sería una costumbre de la pantalla en vez de una regla de la base.

`payment_schedule_items.status` es la respuesta al hueco §4.5 de la revisión: `planned` entra solo en la proyección de 13 semanas; `documented` entra en "Por cobrar"; `settled` sale de ambos.

---

## 5. Grupo 6: pipeline y seguimiento comercial

Entra al núcleo por ADR-19. Sale del alcance toda la conciliación bancaria por ADR-18: las tablas `import_formats`, `statement_imports`, `statement_lines`, `reconciliation_matches`, `reconciliation_decisions` **no se crean**.

```sql
create table pipeline_stages (            -- etapas configurables por organización
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  name text not null,
  sort int not null default 0,
  is_won boolean not null default false,
  is_lost boolean not null default false,
  is_active boolean not null default true,
  unique (organization_id, name)
);

create table opportunities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  legal_entity_id uuid not null references legal_entities(id),  -- en qué libro cae
  client_id uuid references clients(id),
  title text not null,
  lead_source_id uuid references lead_sources(id),
  stage_id uuid not null references pipeline_stages(id),
  expected_amount numeric(18,2),
  currency_code char(3) not null,              -- validado = moneda de la entidad
  probability smallint check (probability between 0 and 100),
  owner_id uuid,                               -- responsable
  next_action text,                            -- la próxima acción concreta
  next_action_at date,                         -- y cuándo: alimenta las alertas de Inicio
  expected_close_date date,
  status text not null default 'open' check (status in ('open','won','lost')),
  lost_reason text,
  won_quote_version_id uuid references quote_versions(id),
  created_by uuid not null,
  closed_at timestamptz
);

create index on opportunities (organization_id, legal_entity_id, status);
create index on opportunities (organization_id, next_action_at) where status = 'open';

create table opportunity_activities (     -- bitácora: append-only
  id bigserial primary key,
  organization_id uuid not null,
  opportunity_id uuid not null references opportunities(id),
  kind text not null check (kind in ('call','email','meeting','note','quote_sent','stage_change','won','lost')),
  at timestamptz not null default now(),
  actor_id uuid not null,
  summary text not null,
  payload jsonb
);
```

**Etapas por defecto** que se siembran en cada organización nueva: nuevo · contactado · propuesta enviada · negociación · ganada (`is_won`) · perdida (`is_lost`). Son editables: se añaden, se renombran y se reordenan.

**El hilo completo**, que es lo que une las dos mitades del producto:

```
opportunities ──1:n──▶ quotes ──emitir──▶ quote_versions ──aprobar──▶ payment_schedule_items
      │                                                                      │
      │ al pasar a una etapa is_won                                          ▼
      └──▶ won_quote_version_id                               documents ──▶ cash_movements
```

Reglas:
- Mover una oportunidad a una etapa `is_won` **exige** una cotización aprobada de esa oportunidad, y guarda cuál en `won_quote_version_id`. Así «ganada» nunca es una opinión: hay una propuesta aprobada detrás con su importe.
- Mover a `is_lost` exige `lost_reason`. Es lo que después permite analizar por qué se pierde.
- Todo cambio de etapa escribe una fila en `opportunity_activities` con `kind = 'stage_change'`. La bitácora no se edita ni se borra.
- `next_action_at` vencida alimenta las acciones próximas del Inicio, junto a los documentos por cobrar vencidos.
- La moneda de la oportunidad la hereda de su entidad (ADR-16): no se elige.

**Vistas:** tablero por etapa (columnas = `pipeline_stages` ordenadas, tarjetas = oportunidades abiertas) y lista con filtros. El tablero muestra el total esperado por etapa, siempre **por entidad y moneda**, nunca sumando soles con dólares.

## 6. Multi-tenancy, RLS y límites de plan

### 6.1 Helpers

```sql
create schema if not exists app;

create or replace function app.current_orgs() returns setof uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select organization_id from memberships
  where user_id = auth.uid() and status = 'active'
$$;

create or replace function app.has_role(p_org uuid, p_roles text[]) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from memberships
    where user_id = auth.uid() and organization_id = p_org
      and status = 'active' and role = any(p_roles))
$$;
```

`security definer` es imprescindible: si la política de una tabla consultase `memberships` directamente, la política de `memberships` se evaluaría de nuevo y entraría en recursión.

### 6.2 Patrón de políticas

```sql
alter table cash_movements enable row level security;
alter table cash_movements force row level security;

create policy sel on cash_movements for select
  using (organization_id in (select app.current_orgs()));

create policy ins on cash_movements for insert
  with check (organization_id in (select app.current_orgs())
              and app.has_role(organization_id, array['owner','admin','finance']));

create policy upd on cash_movements for update
  using (organization_id in (select app.current_orgs())
         and app.has_role(organization_id, array['owner','admin','finance']))
  with check (organization_id in (select app.current_orgs()));

-- sin política de DELETE: nadie borra dinero.
revoke delete on cash_movements from authenticated;
```

**Tablas sin DELETE para nadie** (§8.14): `cash_movements`, `billing_documents`, `payment_allocations`, `transfers`, `quote_versions`, `statement_imports`, `statement_lines`, `reconciliation_matches`, `reconciliation_decisions`, `audit_log`. Se anula, no se borra.

**Roles:** `owner` · `admin` · `finance` (ve costos y caja) · `commercial` (cotiza, no ve costos ni caja) · `viewer` (lee informes sin costos).

### 6.3 Confidencialidad de costos sin permisos por columna

RLS es por fila y Supabase atiende a todos los usuarios finales con el mismo rol de base de datos (`authenticated`), así que `GRANT SELECT (columna)` no puede distinguir a un comercial de un financiero. De ahí que los costos vivan en **tablas hijas** (`quote_line_costs`, `service_cost_lines`, `cost_items`) con su propia política:

```sql
create policy sel on quote_line_costs for select
  using (organization_id in (select app.current_orgs())
         and app.has_role(organization_id, array['owner','admin','finance']));
```

Un comercial lee `quote_lines` (precio, qty, descripción) y obtiene cero filas de `quote_line_costs`. No ve un error ni un `null` sospechoso: la cotización simplemente no tiene costos para él. `quotes.total_cost` y `quotes.margin_pct` son columnas sensibles de una tabla que el comercial sí lee, así que el comercial **no** lee `quotes` directamente: lee la vista `quotes_commercial` (sin esas dos columnas) con `security_invoker`.

### 6.4 Límites de plan, a prueba de concurrencia

El plan exige validación transaccional en servidor (§4). Contar y comparar tiene una carrera clásica: dos pestañas creando la segunda empresa a la vez, ambas cuentan 1, ambas pasan. Se cierra con un lock por organización y recurso:

```sql
create or replace function app.assert_entitlement(p_org uuid, p_resource text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_limit int; v_used int;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_org::text || ':' || p_resource, 0));

  select pe.value_int into v_limit
  from subscriptions s join plan_entitlements pe on pe.plan_code = s.plan_code
  where s.organization_id = p_org and pe.key = p_resource;

  if v_limit is null then return; end if;   -- recurso sin límite en este plan

  v_used := case p_resource
    when 'max_legal_entities' then (select count(*) from legal_entities
                                    where organization_id = p_org and is_active)
    when 'max_currencies'     then (select count(*) from organization_currencies
                                    where organization_id = p_org and is_enabled)
    when 'max_cash_accounts'  then (select count(*) from cash_accounts
                                    where organization_id = p_org and is_active)
    when 'max_members'        then (select count(*) from memberships
                                    where organization_id = p_org and status = 'active')
  end;

  if v_used >= v_limit then
    raise exception 'plan_limit_reached:%:%:%', p_resource, v_used, v_limit
      using errcode = 'check_violation';
  end if;
end $$;
```

Se invoca desde triggers `BEFORE INSERT` en `legal_entities`, `organization_currencies`, `cash_accounts` y `memberships`, y también desde la Edge Function de alta, para dar un mensaje útil antes de intentar. El lock es por transacción y por `(org, recurso)`: no serializa nada más.

**Entitlements propuestos** (valores exactos pendientes, ver `DECISIONS.md`):

| key | free | pro | internal |
|---|---|---|---|
| `max_legal_entities` | 1 | 2 | ∞ |
| `max_currencies` | 1 | 2 | ∞ |
| `max_cash_accounts` | 2 | 8 | ∞ |
| `max_members` | 1 | 5 | ∞ |
| `bank_import_enabled` | **no** | sí | sí |
| `statement_imports_per_month` | 0 | 12 | ∞ |
| `api_read_enabled` | no | sí | sí |

### 6.5 Downgrade sin pérdida de datos (§4)

Nada se borra. Al bajar de plan:
1. `organizations.requires_plan_reconciliation = true`.
2. La app exige elegir qué entidades y monedas quedan activas (tantas como permita el plan nuevo).
3. Las no elegidas pasan a `is_active=false` con `archived_reason='plan_downgrade'`: sus datos se leen y se exportan, pero un trigger bloquea `INSERT` de movimientos, documentos y cotizaciones sobre ellas.
4. Mientras `requires_plan_reconciliation` siga en `true`, se bloquea toda operación nueva. No hay estado intermedio ambiguo.

---

## 7. Suscripciones (F7, diseñado ahora para no rehacer nada)

```sql
create table stripe_events (
  id text primary key,                   -- evt_... : la idempotencia es la PK
  type text not null, received_at timestamptz not null default now(),
  processed_at timestamptz, payload jsonb not null, error text
);
```

Webhook: verificar firma → `insert ... on conflict (id) do nothing` → si no insertó, el evento ya se procesó y se responde 200 sin hacer nada → si insertó, procesar en la misma transacción y sellar `processed_at`. El plan de la organización **solo** se deriva del objeto `subscription` que llega de Stripe; jamás de un campo que haya escrito el cliente (§4, §8.15).

---

## 8. Acceso de agentes IA (F5)

```sql
create table api_tokens (
  id uuid primary key, organization_id uuid not null,
  name text not null, token_hash char(64) not null unique,   -- sha256, nunca el token
  scopes text[] not null,          -- 'read:cash','read:quotes','read:receivables',...
  created_by uuid not null, expires_at timestamptz, revoked_at timestamptz,
  last_used_at timestamptz
);
create table api_access_log (
  id bigserial primary key, api_token_id uuid not null, organization_id uuid not null,
  at timestamptz not null default now(), scope text not null,
  resource text not null, query_hash char(64), rows_returned int, ip inet
);
```

Una sola Edge Function `/mcp/query` como único punto de entrada: resuelve el token → organización + scopes, ejecuta **consultas con lista blanca** (no SQL arbitrario), registra cada llamada y aplica límite de tasa. Sin escritura en v1 (§0.14). El token se muestra una vez al crearlo y no se puede volver a ver.

---

## 9. Qué se construye en qué fase

| Grupo / tabla | Fase |
|---|---|
| `organizations`, `profiles`, `memberships`, `plans`, `plan_entitlements`, `subscriptions`, `audit_log` | F1 |
| `legal_entities`, `brands`, `currencies`, `organization_currencies`, `cash_accounts`, `tax_rates`, `fx_rates`, `financial_categories` | F1 |
| `cash_movements`, `transfers`, `payment_allocations`, `billing_documents`, `clients`, `suppliers`, `contacts` | F3 |
| `payment_schedule_items`, `recurring_expenses` | F3 |
| `services`, `service_categories`, `cost_items`, `service_cost_lines`, `lead_sources` | F2 |
| `quotes`, `quote_lines`, `quote_line_costs`, `quote_versions`, `quote_events` | F2 |
| `pipeline_stages`, `opportunities`, `opportunity_activities` | F4 |
| `alerts` | F3 |
| `api_tokens`, `api_access_log`, `stripe_events` | más adelante, sin fase asignada |

Total: **37 tablas**, 4 vistas, ~10 funciones (42 menos las 5 de conciliación, más las 3 de pipeline, menos `opening_balances` que nunca existe por ADR-17 y las 2 de agentes que quedan sin fase). Nada se crea "por si acaso": cada tabla de la lista tiene al menos una historia en `BACKLOG.md` que la usa.
