-- ---------------------------------------------------------------------------
-- Margen Pilot · F3-1 · El dinero existe
-- ---------------------------------------------------------------------------
--
-- Hasta aquí el producto sabía cuánto se ofertó (F2) y cuándo se espera el
-- dinero (F2-15). No sabía cuánto hay. Esta migración trae las tres tablas
-- que lo cierran, y la decisión que las ordena es INV-1:
--
--   saldo(cuenta) = Σ(entradas) − Σ(salidas) sobre `cash_movements`
--
-- **Ninguna otra tabla mueve dinero.** Ni los documentos, ni el cronograma,
-- ni las asignaciones. Tres tablas hermanas para cobros, gastos y
-- transferencias habrían sido tres libros de caja que se contradicen el
-- martes siguiente. Hay uno.
--
-- Y la distinción que sostiene todo lo demás, del hueco §4.5 de la revisión:
--
--   cuota prevista   → proyección. No se le debe a nadie todavía.
--   documento        → cartera. Esto sí se puede reclamar.
--   movimiento       → dinero. Esto sí está en la cuenta.
--   asignación       → une el dinero con lo que saldaba.
--
-- Asignar no crea dinero: solo dice a qué obligación fue a parar un
-- movimiento que ya existía.
--
-- Qué NO trae, a propósito:
--   · compras. `billing_documents` admite solo `direction = 'sale'` porque no
--     hay tabla de proveedores todavía, y media tabla de proveedores es peor
--     que ninguna.
--   · transferencias entre cuentas. Necesitan su propia cabecera (INV-5) y su
--     tasa efectiva; van en su migración.
--
-- Una desviación consciente de `docs/FINANCIAL_RULES.md` INV-7, explicada
-- abajo en `anular_movimiento`: la regla pide marcar el movimiento como
-- anulado **y** crear la contrapartida. Haciendo las dos cosas, con la vista
-- de saldos excluyendo los anulados, el dinero se restaría dos veces. Se
-- queda con la primera mitad, que es la que INV-1 escribe literalmente.
-- ---------------------------------------------------------------------------

create type cash_direction as enum ('in', 'out');

create type cash_kind as enum (
  'operating',           -- cobro o pago operativo
  'transfer',            -- pata de una transferencia entre cuentas propias
  'opening',             -- saldo de apertura
  'owner_draw',          -- retiro del dueño
  'owner_contribution',  -- aporte del dueño
  'loan_in',             -- préstamo recibido
  'loan_repayment',      -- amortización de préstamo
  'bank_fee',            -- comisión, mantenimiento, ITF
  'tax_payment',         -- pago de impuestos
  'fx_adjustment',       -- diferencia de cambio
  'refund'               -- devolución
);

create type flow_class as enum ('operating', 'non_operating', 'internal_transfer', 'opening');

create type document_type as enum ('invoice', 'boleta', 'receipt', 'note', 'credit_note', 'other');

-- `open` y `partially_paid` y `paid` no los escribe nadie a mano: los deriva
-- un disparador desde las asignaciones (INV-3). Están en el enum porque el
-- estado se lee, no porque se pueda elegir.
create type document_status as enum ('draft', 'open', 'partially_paid', 'paid', 'void');

-- ---------------------------------------------------------------------------
-- Las claves que hacen imposible cruzar los dos libros
-- ---------------------------------------------------------------------------
--
-- Mismo recurso que en el cronograma (ADR-16): en vez de comprobar en la
-- función que la moneda y la empresa coinciden, se deja que lo impida la
-- clave foránea compuesta. Cobrar en soles una factura en dólares, o cobrar
-- en la cuenta de The Publisher una factura de Nlima, no son errores que se
-- validan: son filas que no pueden existir.

alter table payment_schedule_items
  add constraint payment_schedule_items_id_org_entidad_moneda_key
  unique (id, organization_id, legal_entity_id, currency_code);

alter table financial_categories
  add constraint financial_categories_id_org_key unique (id, organization_id);

-- ---------------------------------------------------------------------------
-- La cartera: lo que se puede reclamar
-- ---------------------------------------------------------------------------

create table billing_documents (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  legal_entity_id uuid not null,
  direction       text not null default 'sale' check (direction = 'sale'),
  doc_type        document_type not null default 'invoice',
  series_number   text,
  client_id       uuid not null,
  issue_date      date not null default current_date,
  due_date        date,
  currency_code   char(3) not null references currencies (code),
  amount_net      numeric(18, 2) not null check (amount_net >= 0),
  amount_tax      numeric(18, 2) not null default 0 check (amount_tax >= 0),
  amount_total    numeric(18, 2) not null check (amount_total > 0),
  tax_rate        numeric(7, 4),
  quote_version_id uuid,
  is_opening      boolean not null default false,
  status          document_status not null default 'open',
  void_reason     text,
  created_by      uuid not null default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint totals_consistent check (amount_total = amount_net + amount_tax),
  constraint void_exige_motivo check (status <> 'void' or btrim(coalesce(void_reason, '')) <> ''),

  foreign key (legal_entity_id, organization_id)
    references legal_entities (id, organization_id) on delete cascade,
  foreign key (client_id, organization_id)
    references clients (id, organization_id),
  foreign key (quote_version_id, organization_id)
    references quote_versions (id, organization_id),

  constraint billing_documents_id_org_entidad_moneda_key
    unique (id, organization_id, legal_entity_id, currency_code)
);

create index billing_documents_cartera_idx
  on billing_documents (organization_id, status, due_date);
create index billing_documents_cliente_idx
  on billing_documents (organization_id, client_id);

create trigger billing_documents_touch before update on billing_documents
  for each row execute function app.touch_updated_at();
create trigger billing_documents_audit
  after insert or update or delete on billing_documents
  for each row execute function app.audit_changes();

-- La cuota apunta a su documento. `docs/ARCHITECTURE.md` §4.3 ya lo anunciaba
-- para F3: es ahora cuando hay documentos a los que apuntar.
alter table payment_schedule_items add column billing_document_id uuid;
alter table payment_schedule_items
  add constraint payment_schedule_items_documento_fkey
  foreign key (billing_document_id, organization_id, legal_entity_id, currency_code)
  references billing_documents (id, organization_id, legal_entity_id, currency_code);

-- ---------------------------------------------------------------------------
-- El libro de caja: la única fuente del dinero (INV-1)
-- ---------------------------------------------------------------------------

create table cash_movements (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations (id) on delete cascade,
  cash_account_id  uuid not null,
  legal_entity_id  uuid not null,
  direction        cash_direction not null,
  amount           numeric(18, 2) not null check (amount > 0),
  currency_code    char(3) not null references currencies (code),
  value_date       date not null,
  booked_at        timestamptz not null default now(),
  kind             cash_kind not null default 'operating',

  -- La clase de flujo no se elige: se deduce del tipo. Así una transferencia
  -- no puede sumar ingreso porque `internal_transfer` queda fuera del lente
  -- Resultado por definición de la vista, no por un `where` que alguien
  -- pueda olvidar (INV-5).
  -- Cada rama lleva su cast al enum. Castear el CASE entero
  -- (`end::flow_class`) no compila: convertir texto a enum es `stable`, no
  -- `immutable`, y una columna generada exige inmutabilidad. Con el cast en
  -- cada literal, Postgres los reduce a constantes y sí lo es.
  flow_class       flow_class not null generated always as (
                     case kind
                       when 'transfer'::cash_kind    then 'internal_transfer'::flow_class
                       when 'opening'::cash_kind     then 'opening'::flow_class
                       when 'operating'::cash_kind   then 'operating'::flow_class
                       when 'bank_fee'::cash_kind    then 'operating'::flow_class
                       when 'tax_payment'::cash_kind then 'operating'::flow_class
                       when 'refund'::cash_kind      then 'operating'::flow_class
                       else 'non_operating'::flow_class
                     end) stored,

  category_id      uuid,
  counterparty_kind text check (counterparty_kind in ('client', 'supplier', 'internal', 'other')),
  client_id        uuid,
  description      text not null check (btrim(description) <> ''),
  external_ref     text,

  -- Solo si el movimiento es su propio hecho económico, es decir si no está
  -- asignado a ningún documento (INV-6). Si lo está, el documento manda y
  -- esto se queda nulo.
  amount_net       numeric(18, 2),
  amount_tax       numeric(18, 2),

  source           text not null default 'manual'
                     check (source in ('manual', 'quote', 'recurring', 'bank_import', 'opening', 'api')),
  is_void          boolean not null default false,
  void_reason      text,
  created_by       uuid not null default auth.uid(),
  created_at       timestamptz not null default now(),

  constraint anulado_exige_motivo check (not is_void or btrim(coalesce(void_reason, '')) <> ''),

  -- Esta sola clave impone INV-9 (el dinero vive en la moneda de su cuenta) y
  -- ADR-16 (los dos libros no se mezclan), sin disparador que lo vigile.
  foreign key (cash_account_id, organization_id, legal_entity_id, currency_code)
    references cash_accounts (id, organization_id, legal_entity_id, currency_code),
  foreign key (client_id, organization_id) references clients (id, organization_id),
  foreign key (category_id, organization_id) references financial_categories (id, organization_id),

  constraint cash_movements_id_org_entidad_moneda_key
    unique (id, organization_id, legal_entity_id, currency_code)
);

create index cash_movements_cuenta_idx
  on cash_movements (organization_id, cash_account_id, value_date desc);
create index cash_movements_entidad_idx
  on cash_movements (organization_id, legal_entity_id, value_date desc);
create index cash_movements_cliente_idx
  on cash_movements (organization_id, client_id) where client_id is not null;

create trigger cash_movements_audit
  after insert or update or delete on cash_movements
  for each row execute function app.audit_changes();

-- ---------------------------------------------------------------------------
-- El saldo: una sola definición, para siempre
-- ---------------------------------------------------------------------------
--
-- No hay «saldo inicial + movimientos», porque la apertura es un movimiento
-- más (`kind = 'opening'`). Una sola fórmula significa que no existen dos
-- cifras que puedan discrepar.
--
-- `security_invoker` para que la vista no sea un agujero: filtra con las
-- políticas de quien pregunta, no con las del dueño de la vista.

create view account_balances with (security_invoker = true) as
select m.cash_account_id,
       m.organization_id,
       m.legal_entity_id,
       m.currency_code,
       sum(case when m.direction = 'in' then m.amount else -m.amount end) as balance,
       count(*)          as movimientos,
       max(m.value_date) as ultimo_movimiento
  from cash_movements m
 where not m.is_void
 group by 1, 2, 3, 4;

grant select on account_balances to authenticated;

-- ---------------------------------------------------------------------------
-- Las asignaciones: unir el dinero con lo que saldaba
-- ---------------------------------------------------------------------------

create table payment_allocations (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations (id) on delete cascade,
  legal_entity_id  uuid not null,
  currency_code    char(3) not null references currencies (code),
  cash_movement_id uuid not null,
  billing_document_id uuid,
  payment_schedule_item_id uuid,
  amount           numeric(18, 2) not null check (amount > 0),
  created_by       uuid not null default auth.uid(),
  created_at       timestamptz not null default now(),

  constraint target_required check (
    (billing_document_id is not null)::int + (payment_schedule_item_id is not null)::int >= 1),

  -- Las tres claves compuestas son INV-4: la moneda de la asignación, la del
  -- movimiento y la del documento son la misma porque no hay forma de que no
  -- lo sean.
  foreign key (cash_movement_id, organization_id, legal_entity_id, currency_code)
    references cash_movements (id, organization_id, legal_entity_id, currency_code),
  foreign key (billing_document_id, organization_id, legal_entity_id, currency_code)
    references billing_documents (id, organization_id, legal_entity_id, currency_code),
  foreign key (payment_schedule_item_id, organization_id, legal_entity_id, currency_code)
    references payment_schedule_items (id, organization_id, legal_entity_id, currency_code)
);

create index payment_allocations_movimiento_idx on payment_allocations (cash_movement_id);
create index payment_allocations_documento_idx on payment_allocations (billing_document_id);

create trigger payment_allocations_audit
  after insert or update or delete on payment_allocations
  for each row execute function app.audit_changes();

-- ---------------------------------------------------------------------------
-- Los topes: una asignación no puede inventar dinero (INV-2 e INV-3)
-- ---------------------------------------------------------------------------
--
-- Diferido hasta el commit a propósito: una función que reparte un cobro
-- entre varias facturas pasa por estados intermedios que no cuadran, y lo que
-- tiene que cuadrar es el final de la transacción, no cada paso.

create or replace function app.respeta_los_topes() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tope     numeric;
  v_asignado numeric;
begin
  -- INV-2 · un cobro de S/ 400 no se puede asignar a S/ 500 de facturas.
  select m.amount into v_tope from cash_movements m where m.id = new.cash_movement_id;
  select coalesce(sum(a.amount), 0) into v_asignado
    from payment_allocations a where a.cash_movement_id = new.cash_movement_id;

  if v_asignado > v_tope then
    raise exception
      'asignacion_excede_movimiento: el movimiento es de % y se le han asignado %',
      to_char(v_tope, 'FM999999999990.00'), to_char(v_asignado, 'FM999999999990.00');
  end if;

  -- INV-3 · lo asignado a un documento no puede pasar de su total.
  if new.billing_document_id is not null then
    select d.amount_total into v_tope
      from billing_documents d where d.id = new.billing_document_id;
    select coalesce(sum(a.amount), 0) into v_asignado
      from payment_allocations a
      join cash_movements m on m.id = a.cash_movement_id and not m.is_void
     where a.billing_document_id = new.billing_document_id;

    if v_asignado > v_tope then
      raise exception
        'cobro_excede_documento: el documento es de % y se le han cobrado %',
        to_char(v_tope, 'FM999999999990.00'), to_char(v_asignado, 'FM999999999990.00');
    end if;
  end if;

  return null;
end $$;

create constraint trigger payment_allocations_topes
  after insert or update on payment_allocations
  deferrable initially deferred
  for each row execute function app.respeta_los_topes();

-- ---------------------------------------------------------------------------
-- El estado de un documento se deriva, no se declara (INV-3)
-- ---------------------------------------------------------------------------
--
-- Nadie puede marcar una factura como pagada: se paga cuando hay dinero
-- asignado a ella. Y si ese cobro se anula, vuelve a estar abierta. Es la
-- diferencia entre un sistema que refleja la realidad y uno donde alguien
-- apunta lo que le gustaría.

create or replace function app.recalcula_estado_documento(p_doc uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_doc    record;
  v_pagado numeric;
  v_estado document_status;
begin
  if p_doc is null then return; end if;

  select d.id, d.amount_total, d.status into v_doc
    from billing_documents d where d.id = p_doc;
  if v_doc.id is null then return; end if;

  -- Un documento anulado se queda anulado: un cobro posterior no lo revive.
  if v_doc.status = 'void' then return; end if;

  select coalesce(sum(a.amount), 0) into v_pagado
    from payment_allocations a
    join cash_movements m on m.id = a.cash_movement_id
   where a.billing_document_id = p_doc and not m.is_void;

  v_estado := case
                when v_pagado >= v_doc.amount_total then 'paid'
                when v_pagado > 0                   then 'partially_paid'
                else                                     'open'
              end::document_status;

  if v_estado is distinct from v_doc.status then
    update billing_documents set status = v_estado where id = p_doc;
  end if;

  -- La cuota sigue a su documento. Cobrado del todo, `settled`; si se anula el
  -- cobro, vuelve a `documented`. Las previstas y las canceladas no se tocan.
  update payment_schedule_items
     set status = case when v_estado = 'paid' then 'settled' else 'documented' end
   where billing_document_id = p_doc
     and status in ('documented', 'settled');
end $$;

create or replace function app.al_cambiar_una_asignacion() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform app.recalcula_estado_documento(
    coalesce(new.billing_document_id, old.billing_document_id));
  return null;
end $$;

create trigger payment_allocations_estado
  after insert or update or delete on payment_allocations
  for each row execute function app.al_cambiar_una_asignacion();

create or replace function app.al_anular_un_movimiento() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare r record;
begin
  if new.is_void is distinct from old.is_void then
    for r in select distinct a.billing_document_id
               from payment_allocations a
              where a.cash_movement_id = new.id and a.billing_document_id is not null
    loop
      perform app.recalcula_estado_documento(r.billing_document_id);
    end loop;
  end if;
  return null;
end $$;

create trigger cash_movements_estado after update on cash_movements
  for each row execute function app.al_anular_un_movimiento();

-- ---------------------------------------------------------------------------
-- Permisos · se lee, no se escribe
-- ---------------------------------------------------------------------------
--
-- Las tres tablas se leen y no se escriben desde el cliente: las puertas son
-- las tres funciones de abajo. Si `cash_movements` aceptara un `insert`
-- suelto, el saldo sería una opinión.
--
-- Y las tres piden `can_write_money`, igual que `cash_accounts`: el rol
-- comercial cotiza y aprueba, pero la cartera y el banco no son suyos.
-- Nada financiero se borra (INV-7): `authenticated` no recibe `delete`.

grant select on billing_documents, cash_movements, payment_allocations to authenticated;

alter table billing_documents    enable row level security;
alter table billing_documents    force  row level security;
alter table cash_movements       enable row level security;
alter table cash_movements       force  row level security;
alter table payment_allocations  enable row level security;
alter table payment_allocations  force  row level security;

create policy billing_documents_select on billing_documents for select
  using (organization_id in (select app.current_orgs())
         and app.can_write_money(organization_id));

create policy cash_movements_select on cash_movements for select
  using (organization_id in (select app.current_orgs())
         and app.can_write_money(organization_id));

create policy payment_allocations_select on payment_allocations for select
  using (organization_id in (select app.current_orgs())
         and app.can_write_money(organization_id));

-- ---------------------------------------------------------------------------
-- Puerta 1 · emitir el documento de una cuota
-- ---------------------------------------------------------------------------
--
-- Aquí la cuota deja de ser una expectativa y entra en la cartera. El importe
-- no se pregunta: es el de la cuota, porque si se pudiera teclear otro el
-- cronograma dejaría de cuadrar con la versión aceptada y «las cuotas suman el
-- total» volvería a ser una costumbre.
--
-- El neto y el impuesto se parten con la tasa de la cotización, no con la que
-- esté puesta hoy en la entidad: el documento tiene que decir lo mismo que
-- firmó el cliente. Con tasa 0 (Estados Unidos) el neto es el total y el
-- impuesto es cero, sin ningún caso especial.
--
-- La serie y el número los teclea el usuario y pueden quedar vacíos. No se
-- inventan: en Perú los asigna SUNAT, y un número inventado en la cartera es
-- peor que ningún número.

create or replace function emitir_documento(
  p_item       uuid,
  p_doc_type   document_type default 'invoice',
  p_series     text default null,
  p_issue_date date default null,
  p_due_date   date default null
) returns setof billing_documents
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_item record;
  v_q    record;
  v_dec  int;
  v_neto numeric;
  v_doc  uuid;
begin
  select i.* into v_item
    from payment_schedule_items i where i.id = p_item for update;

  if v_item.id is null then
    raise exception 'cuota_no_encontrada: esa cuota no existe';
  end if;

  if not app.can_write_money(v_item.organization_id) then
    raise exception 'cuota_no_encontrada: esa cuota no existe o no es de tu organización';
  end if;

  if v_item.status <> 'planned' then
    raise exception 'cuota_no_prevista: esta cuota ya tiene documento o ya se cobró';
  end if;

  if v_item.quote_id is null then
    raise exception 'cuota_sin_cotizacion: no se puede emitir un documento de una cuota suelta';
  end if;

  select q.client_id, q.tax_rate_pct, q.number into v_q
    from quotes q where q.id = v_item.quote_id;

  select c.minor_units into v_dec from currencies c where c.code = v_item.currency_code;

  -- El importe de la cuota ya lleva el impuesto dentro: se parte hacia atrás.
  v_neto := round(v_item.amount / (1 + coalesce(v_q.tax_rate_pct, 0) / 100), v_dec);

  insert into billing_documents (
    organization_id, legal_entity_id, direction, doc_type, series_number,
    client_id, issue_date, due_date, currency_code,
    amount_net, amount_tax, amount_total, tax_rate, quote_version_id, status)
  values (
    v_item.organization_id, v_item.legal_entity_id, 'sale', p_doc_type,
    nullif(btrim(coalesce(p_series, '')), ''),
    v_q.client_id,
    coalesce(p_issue_date, current_date),
    coalesce(p_due_date, v_item.due_date),
    v_item.currency_code,
    v_neto, v_item.amount - v_neto, v_item.amount,
    v_q.tax_rate_pct, v_item.quote_version_id, 'open')
  returning id into v_doc;

  update payment_schedule_items
     set status = 'documented', billing_document_id = v_doc
   where id = p_item;

  return query select * from billing_documents where id = v_doc;
end $$;

comment on function emitir_documento(uuid, document_type, text, date, date) is
  'Pasa una cuota prevista a la cartera: crea su documento por el importe exacto de la cuota (F2-16).';

revoke all on function emitir_documento(uuid, document_type, text, date, date) from public, anon;
grant execute on function emitir_documento(uuid, document_type, text, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Puerta 2 · registrar el cobro de un documento
-- ---------------------------------------------------------------------------
--
-- Esto es lo único que mueve dinero hacia dentro. Crea el movimiento en la
-- cuenta y la asignación que lo ata al documento; el estado del documento y
-- el de la cuota los deriva el disparador, no esta función.
--
-- Admite cobros parciales: dos cobros de la mitad dejan el documento en
-- `partially_paid` y después en `paid`. Lo que no admite es cobrar más de lo
-- que el documento dice.

create or replace function registrar_cobro(
  p_document     uuid,
  p_account      uuid,
  p_amount       numeric,
  p_value_date   date default null,
  p_external_ref text default null,
  p_description  text default null
) returns setof cash_movements
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_doc      record;
  v_cuenta   record;
  v_dec      int;
  v_importe  numeric;
  v_pagado   numeric;
  v_pendiente numeric;
  v_item     uuid;
  v_mov      uuid;
begin
  select d.* into v_doc from billing_documents d where d.id = p_document for update;

  if v_doc.id is null then
    raise exception 'documento_no_encontrado: ese documento no existe';
  end if;

  if not app.can_write_money(v_doc.organization_id) then
    raise exception 'documento_no_encontrado: ese documento no existe o no es de tu organización';
  end if;

  if v_doc.status not in ('open', 'partially_paid') then
    raise exception 'documento_cerrado: este documento está % y no admite cobros', v_doc.status;
  end if;

  -- La cuenta tiene que ser del mismo libro y la misma moneda. La clave
  -- foránea del movimiento lo impediría igual, pero el mensaje sería el de
  -- Postgres y no se entendería (INV-4).
  select a.* into v_cuenta
    from cash_accounts a
   where a.id = p_account
     and a.organization_id = v_doc.organization_id
     and a.legal_entity_id = v_doc.legal_entity_id
     and a.currency_code   = v_doc.currency_code;

  if v_cuenta.id is null then
    raise exception
      'cuenta_de_otro_libro: este documento está en % y hay que cobrarlo en una cuenta de la misma empresa y moneda',
      v_doc.currency_code;
  end if;

  select c.minor_units into v_dec from currencies c where c.code = v_doc.currency_code;
  v_importe := round(coalesce(p_amount, 0), v_dec);

  if v_importe <= 0 then
    raise exception 'importe_invalido: un cobro tiene que ser mayor que cero';
  end if;

  select coalesce(sum(a.amount), 0) into v_pagado
    from payment_allocations a
    join cash_movements m on m.id = a.cash_movement_id and not m.is_void
   where a.billing_document_id = p_document;

  v_pendiente := round(v_doc.amount_total - v_pagado, v_dec);

  if v_importe > v_pendiente then
    raise exception
      'cobro_excede_documento: de este documento quedan % % por cobrar y estás registrando %',
      to_char(v_pendiente, 'FM999999999990.00'), v_doc.currency_code,
      to_char(v_importe, 'FM999999999990.00');
  end if;

  select i.id into v_item
    from payment_schedule_items i where i.billing_document_id = p_document limit 1;

  insert into cash_movements (
    organization_id, cash_account_id, legal_entity_id, direction, amount,
    currency_code, value_date, kind, counterparty_kind, client_id,
    description, external_ref, source)
  values (
    v_doc.organization_id, p_account, v_doc.legal_entity_id, 'in', v_importe,
    v_doc.currency_code, coalesce(p_value_date, current_date), 'operating',
    'client', v_doc.client_id,
    coalesce(nullif(btrim(coalesce(p_description, '')), ''),
             'Cobro ' || coalesce(v_doc.series_number, 'de documento sin número')),
    nullif(btrim(coalesce(p_external_ref, '')), ''),
    'quote')
  returning id into v_mov;

  insert into payment_allocations (
    organization_id, legal_entity_id, currency_code, cash_movement_id,
    billing_document_id, payment_schedule_item_id, amount)
  values (
    v_doc.organization_id, v_doc.legal_entity_id, v_doc.currency_code, v_mov,
    p_document, v_item, v_importe);

  return query select * from cash_movements where id = v_mov;
end $$;

comment on function registrar_cobro(uuid, uuid, numeric, date, text, text) is
  'Registra el cobro de un documento: crea el movimiento de caja y la asignación. Admite parciales (F2-16).';

revoke all on function registrar_cobro(uuid, uuid, numeric, date, text, text) from public, anon;
grant execute on function registrar_cobro(uuid, uuid, numeric, date, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Puerta 3 · un movimiento que no viene de una cotización
-- ---------------------------------------------------------------------------
--
-- El hosting, la comisión del banco, el saldo de apertura, el retiro del
-- dueño. Sin esto el libro solo sabría de cobros de cotizaciones y el saldo
-- de la cuenta no se parecería al del banco, que es la única prueba de que
-- esto sirve para algo.

create or replace function registrar_movimiento(
  p_account      uuid,
  p_direction    cash_direction,
  p_amount       numeric,
  p_description  text,
  p_value_date   date default null,
  p_kind         cash_kind default 'operating',
  p_category     uuid default null,
  p_client       uuid default null,
  p_external_ref text default null,
  p_amount_net   numeric default null,
  p_amount_tax   numeric default null
) returns setof cash_movements
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_cuenta record;
  v_dec    int;
  v_importe numeric;
  v_neto   numeric;
  v_imp    numeric;
  v_mov    uuid;
begin
  select a.* into v_cuenta from cash_accounts a where a.id = p_account;

  if v_cuenta.id is null then
    raise exception 'cuenta_no_encontrada: esa cuenta no existe';
  end if;

  if not app.can_write_money(v_cuenta.organization_id) then
    raise exception 'cuenta_no_encontrada: esa cuenta no existe o no es de tu organización';
  end if;

  if btrim(coalesce(p_description, '')) = '' then
    raise exception 'descripcion_obligatoria: un movimiento sin concepto no se puede conciliar después';
  end if;

  select c.minor_units into v_dec from currencies c where c.code = v_cuenta.currency_code;
  v_importe := round(coalesce(p_amount, 0), v_dec);

  if v_importe <= 0 then
    raise exception 'importe_invalido: el importe va siempre en positivo; el signo lo da la dirección';
  end if;

  -- Si se capturan neto e impuesto, tienen que sumar el importe: es el hecho
  -- económico del propio movimiento (INV-6) y no puede contradecirse.
  v_neto := case when p_amount_net is null then null else round(p_amount_net, v_dec) end;
  v_imp  := case when p_amount_tax is null then null else round(p_amount_tax, v_dec) end;

  if v_neto is not null or v_imp is not null then
    v_neto := coalesce(v_neto, v_importe - coalesce(v_imp, 0));
    v_imp  := coalesce(v_imp, v_importe - v_neto);
    if round(v_neto + v_imp, v_dec) <> v_importe then
      raise exception
        'desglose_descuadrado: el neto y el impuesto suman % y el movimiento es de %',
        to_char(v_neto + v_imp, 'FM999999999990.00'), to_char(v_importe, 'FM999999999990.00');
    end if;
  end if;

  insert into cash_movements (
    organization_id, cash_account_id, legal_entity_id, direction, amount,
    currency_code, value_date, kind, category_id, counterparty_kind, client_id,
    description, external_ref, amount_net, amount_tax, source)
  values (
    v_cuenta.organization_id, p_account, v_cuenta.legal_entity_id, p_direction, v_importe,
    v_cuenta.currency_code, coalesce(p_value_date, current_date), p_kind, p_category,
    case when p_client is not null then 'client' else null end, p_client,
    btrim(p_description), nullif(btrim(coalesce(p_external_ref, '')), ''),
    v_neto, v_imp,
    case when p_kind = 'opening' then 'opening' else 'manual' end)
  returning id into v_mov;

  return query select * from cash_movements where id = v_mov;
end $$;

comment on function registrar_movimiento(uuid, cash_direction, numeric, text, date, cash_kind, uuid, uuid, text, numeric, numeric) is
  'Alta manual en el libro de caja: gastos, comisiones, apertura, aportes y retiros (F3-1).';

revoke all on function registrar_movimiento(uuid, cash_direction, numeric, text, date, cash_kind, uuid, uuid, text, numeric, numeric) from public, anon;
grant execute on function registrar_movimiento(uuid, cash_direction, numeric, text, date, cash_kind, uuid, uuid, text, numeric, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- Puerta 4 · anular un movimiento
-- ---------------------------------------------------------------------------
--
-- Nada financiero se borra (INV-7). Anular marca la fila y exige motivo; la
-- vista de saldos deja de contarla y el estado del documento se recalcula
-- solo, así que una factura que parecía pagada vuelve a estar abierta.
--
-- Desviación consciente de INV-7, que además de marcar pedía crear el
-- movimiento contrapartida: con la vista de saldos excluyendo los anulados
-- —que es lo que INV-1 escribe literalmente— hacer las dos cosas restaría el
-- dinero dos veces. Se queda la marca. La fila no se borra, que es lo que la
-- regla protege, y el rastro completo está en `audit_log`.

create or replace function anular_movimiento(p_movement uuid, p_motivo text)
returns setof cash_movements
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_mov record;
begin
  if btrim(coalesce(p_motivo, '')) = '' then
    raise exception 'motivo_obligatorio: anular un movimiento exige decir por qué';
  end if;

  select m.* into v_mov from cash_movements m where m.id = p_movement for update;

  if v_mov.id is null then
    raise exception 'movimiento_no_encontrado: ese movimiento no existe';
  end if;

  if not app.can_write_money(v_mov.organization_id) then
    raise exception 'movimiento_no_encontrado: ese movimiento no existe o no es de tu organización';
  end if;

  if v_mov.is_void then
    raise exception 'movimiento_ya_anulado: este movimiento ya estaba anulado';
  end if;

  update cash_movements
     set is_void = true, void_reason = btrim(p_motivo)
   where id = p_movement;

  return query select * from cash_movements where id = p_movement;
end $$;

comment on function anular_movimiento(uuid, text) is
  'Marca un movimiento como anulado con motivo. No borra: el saldo se corrige y el documento vuelve a abrirse (INV-7).';

revoke all on function anular_movimiento(uuid, text) from public, anon;
grant execute on function anular_movimiento(uuid, text) to authenticated;
