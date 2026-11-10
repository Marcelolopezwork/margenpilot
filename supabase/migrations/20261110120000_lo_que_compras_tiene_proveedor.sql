-- ===========================================================================
-- F3-6 · Proveedores y compras
-- ===========================================================================
--
-- Hasta aquí el producto solo sabía vender. Un gasto se podía anotar como
-- movimiento suelto, pero no existía la factura del proveedor: ni a quién se
-- le debe, ni desde cuándo, ni el IGV que se pagó dentro.
--
-- Tres ideas sostienen esta migración, y cada una está impuesta por estructura
-- y no por un aviso en la pantalla:
--
--  1. **Una compra no la hace un cliente.** El documento tiene exactamente una
--     contraparte, y cuál de las dos columnas se rellena lo decide su
--     dirección. No hay forma de emitir una compra «a» un cliente ni de
--     facturar una venta «a» un proveedor: es un `check`, no una convención.
--
--  2. **La misma factura no se anota dos veces.** La serie de un proveedor es
--     única dentro de la organización mientras el documento esté vivo. El
--     error que llega lleva el nombre del proveedor y el número dentro, porque
--     «ya existe un registro» no le dice a nadie qué corregir.
--
--  3. **El IGV que pagas no es tu gasto.** Es crédito fiscal: dinero que sale
--     de tu cuenta y vuelve contra el IGV que cobraste. El documento guarda
--     neto e impuesto por separado, el lente Resultado ya sabe restar solo el
--     neto, y la pantalla de Análisis lo dice en voz alta. Meter el IGV en el
--     gasto infla el gasto y desinfla el resultado todos los meses.
--
-- Lo que esta migración NO hace, a propósito: atar una compra a un trabajo
-- concreto. Eso es «cuánto deja cada servicio» y necesita además las líneas de
-- la versión aceptada. La columna que lo permitirá (`category_id`) entra aquí
-- porque sin ella un gasto con factura caería en «sin categoría» en Análisis,
-- que es peor que no tenerlo.

-- ---------------------------------------------------------------------------
-- El proveedor · su propia lista, no un cliente con una marca
-- ---------------------------------------------------------------------------
--
-- Podría haber sido un `is_supplier` en `clients` y habría costado una línea.
-- Pero entonces el casero y la SUNAT aparecerían en el desplegable de
-- «cliente» al hacer una cotización, y la lista de clientes —que es una lista
-- comercial, de gente a la que se le vende— dejaría de significar eso.
--
-- El índice único es sobre el nombre normalizado y no sobre el nombre: sin él,
-- «Movistar», «movistar» y «Movistar » serían tres proveedores, y el gasto de
-- teléfono aparecería repartido entre los tres.

create table suppliers (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  name            text not null check (btrim(name) <> ''),
  tax_id          text,
  email           text,
  notes           text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (id, organization_id)
);

create unique index suppliers_nombre_normalizado
  on suppliers (organization_id, lower(btrim(name)));

create trigger suppliers_touch before update on suppliers
  for each row execute function app.touch_updated_at();
create trigger suppliers_audit
  after insert or update or delete on suppliers
  for each row execute function app.audit_changes();

comment on table suppliers is
  'A quién le compras. Lista aparte de la de clientes: a un proveedor no se le cotiza.';

grant select, insert, update on suppliers to authenticated;

alter table suppliers enable row level security;
alter table suppliers force  row level security;

create policy suppliers_select on suppliers for select
  using (organization_id in (select app.current_orgs()));
create policy suppliers_insert on suppliers for insert
  with check (app.has_role(organization_id,
    array['owner','admin','finance']::membership_role[]));
create policy suppliers_update on suppliers for update
  using (app.has_role(organization_id,
    array['owner','admin','finance']::membership_role[]))
  with check (organization_id in (select app.current_orgs()));

-- ---------------------------------------------------------------------------
-- El documento admite las dos direcciones
-- ---------------------------------------------------------------------------

-- El `check (direction = 'sale')` original se escribió sin nombre, así que lo
-- bautizó Postgres. Se busca por su definición en vez de confiar en el nombre
-- que le tocó: si la convención de nombres de Postgres cambiara, este bloque
-- seguiría encontrándolo y el `drop constraint if exists` de un nombre
-- adivinado no.
do $$
declare v_nombre text;
begin
  select c.conname into v_nombre
    from pg_constraint c
   where c.conrelid = 'billing_documents'::regclass
     and c.contype  = 'c'
     and pg_get_constraintdef(c.oid) like '%direction%'
     and pg_get_constraintdef(c.oid) like '%sale%';
  if v_nombre is not null then
    execute format('alter table billing_documents drop constraint %I', v_nombre);
  end if;
end $$;

alter table billing_documents
  add constraint direccion_conocida check (direction in ('sale', 'purchase'));

alter table billing_documents alter column client_id drop not null;

alter table billing_documents add column supplier_id uuid;
alter table billing_documents add column category_id uuid;
alter table billing_documents add column description text;

alter table billing_documents
  add constraint billing_documents_proveedor_fkey
  foreign key (supplier_id, organization_id) references suppliers (id, organization_id);
alter table billing_documents
  add constraint billing_documents_categoria_fkey
  foreign key (category_id, organization_id)
  references financial_categories (id, organization_id);

-- Exactamente una contraparte, y la que corresponde a la dirección. Esto es
-- lo que hace imposible una compra facturada a un cliente.
alter table billing_documents
  add constraint la_contraparte_concuerda check (
    (direction = 'sale'     and client_id   is not null and supplier_id is null) or
    (direction = 'purchase' and supplier_id is not null and client_id   is null));

-- Una cotización es una oferta nuestra: de ahí no sale una compra.
alter table billing_documents
  add constraint solo_una_venta_viene_de_cotizacion
  check (direction = 'sale' or quote_version_id is null);

-- La misma factura de proveedor no entra dos veces. Fuera del índice quedan
-- las anuladas: si una se anuló por estar mal escrita, su número tiene que
-- poder volver a usarse.
create unique index compras_sin_repetir
  on billing_documents (organization_id, supplier_id, upper(btrim(series_number)))
  where direction = 'purchase' and series_number is not null and status <> 'void';

create index billing_documents_proveedor_idx
  on billing_documents (organization_id, supplier_id) where supplier_id is not null;

comment on column billing_documents.description is
  'El concepto en palabras. En una compra es lo único legible: «F001-1234» no dice en qué se fue el dinero.';

-- ---------------------------------------------------------------------------
-- El movimiento también puede señalar a un proveedor
-- ---------------------------------------------------------------------------

alter table cash_movements add column supplier_id uuid;
alter table cash_movements
  add constraint cash_movements_proveedor_fkey
  foreign key (supplier_id, organization_id) references suppliers (id, organization_id);

-- Un movimiento tiene una contraparte, no dos. Que sea cliente o proveedor lo
-- dice `counterparty_kind`; que no sea los dos lo dice esto.
alter table cash_movements
  add constraint una_sola_contraparte
  check (client_id is null or supplier_id is null);

create index cash_movements_proveedor_idx
  on cash_movements (organization_id, supplier_id) where supplier_id is not null;

-- ---------------------------------------------------------------------------
-- El hecho económico, ahora con las dos contrapartes (INV-6)
-- ---------------------------------------------------------------------------
--
-- La vista se recrea en vez de reemplazarse: `create or replace view` solo
-- admite añadir columnas al final, y aquí hay que meter `supplier_id` al lado
-- de `client_id`, que es donde se entiende.

drop view economic_facts;

create view economic_facts with (security_invoker = true) as

-- La venta existe cuando se emite el documento, no cuando se cobra. La compra,
-- cuando llega la factura, no cuando se paga.
select d.organization_id,
       d.legal_entity_id,
       d.currency_code,
       'documento'::text                                   as origen,
       d.id                                                as source_id,
       d.issue_date                                         as fecha,
       case when d.direction = 'sale' then 'in' else 'out' end::cash_direction as direction,
       'operating'::flow_class                              as flow_class,
       null::cash_kind                                      as kind,
       d.amount_total,
       d.amount_net,
       d.amount_tax,
       d.category_id,
       d.client_id,
       d.supplier_id,
       -- El concepto escrito manda sobre el número de serie: en una compra,
       -- «Hosting anual» se entiende y «F001-1234» no.
       coalesce(nullif(btrim(d.description), ''),
                nullif(btrim(d.series_number), ''),
                case when d.direction = 'sale'
                     then 'Documento sin número'
                     else 'Compra sin número' end)          as concepto
  from billing_documents d
 where d.status <> 'void'
   and not d.is_opening

union all

-- Y el movimiento que no salda ningún documento: entonces él es el hecho.
select m.organization_id,
       m.legal_entity_id,
       m.currency_code,
       'movimiento'::text,
       m.id,
       m.value_date,
       m.direction,
       m.flow_class,
       m.kind,
       m.amount,
       -- Si el usuario no desglosó impuesto, el neto es el importe entero.
       -- Inventar un IGV donde no se declaró sería peor que no tenerlo.
       coalesce(m.amount_net, m.amount),
       coalesce(m.amount_tax, 0),
       m.category_id,
       m.client_id,
       m.supplier_id,
       m.description
  from cash_movements m
 where not m.is_void
   and m.flow_class in ('operating', 'non_operating')
   and not exists (
         select 1 from payment_allocations a
          where a.cash_movement_id = m.id
            and a.billing_document_id is not null);

comment on view economic_facts is
  'INV-6 escrito una vez: los documentos emitidos —ventas y compras— más los movimientos que no saldan ninguno. Excluye las patas de transferencia y las aperturas por definición, no por filtro.';

grant select on economic_facts to authenticated;

-- ---------------------------------------------------------------------------
-- Saldar un documento · un solo cuerpo para cobrar y para pagar
-- ---------------------------------------------------------------------------
--
-- Cobrar una venta y pagar una compra son la misma operación con el signo
-- cambiado: crear el movimiento en la cuenta y atarlo al documento con una
-- asignación. El tope —no se puede saldar más de lo que el documento dice— y
-- la derivación del estado (INV-3) son idénticos.
--
-- Por eso el cuerpo está una sola vez. Dos copias se habrían separado en el
-- primer arreglo que alguien hiciera en una y no en la otra, y entonces
-- existirían dos definiciones de «cuánto queda», que es justo la clase de
-- discrepancia que este producto no admite.
--
-- Las dos puertas públicas que lo llaman se quedan por el nombre: una compra
-- se paga y una venta se cobra, y una función que se llamara
-- `registrar_cobro` y pagara facturas de proveedor sería una mentira en el
-- código.

create or replace function app.saldar_documento(
  p_document     uuid,
  p_account      uuid,
  p_amount       numeric,
  p_value_date   date,
  p_external_ref text,
  p_description  text
) returns setof cash_movements
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_doc       record;
  v_cuenta    record;
  v_dec       int;
  v_importe   numeric;
  v_pagado    numeric;
  v_pendiente numeric;
  v_item      uuid;
  v_mov       uuid;
  v_es_venta  boolean;
  v_dir       cash_direction;
  v_quien     text;
  v_verbo     text;
  v_nombre    text;
begin
  select d.* into v_doc from billing_documents d where d.id = p_document for update;

  if v_doc.id is null then
    raise exception 'documento_no_encontrado: ese documento no existe';
  end if;

  if not app.can_write_money(v_doc.organization_id) then
    raise exception 'documento_no_encontrado: ese documento no existe o no es de tu organización';
  end if;

  v_es_venta := v_doc.direction = 'sale';

  if v_es_venta then
    v_dir := 'in'; v_quien := 'client'; v_verbo := 'Cobro';
  else
    v_dir := 'out'; v_quien := 'supplier'; v_verbo := 'Pago';
  end if;

  if v_doc.status not in ('open', 'partially_paid') then
    if v_es_venta then
      raise exception 'documento_cerrado: este documento está % y no admite cobros', v_doc.status;
    else
      raise exception 'documento_cerrado: esta compra está % y no admite pagos', v_doc.status;
    end if;
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
      'cuenta_de_otro_libro: este documento está en % y hay que saldarlo desde una cuenta de la misma empresa y moneda',
      v_doc.currency_code;
  end if;

  select c.minor_units into v_dec from currencies c where c.code = v_doc.currency_code;
  v_importe := round(coalesce(p_amount, 0), v_dec);

  if v_importe <= 0 then
    raise exception 'importe_invalido: un movimiento tiene que ser mayor que cero';
  end if;

  select coalesce(sum(a.amount), 0) into v_pagado
    from payment_allocations a
    join cash_movements m on m.id = a.cash_movement_id and not m.is_void
   where a.billing_document_id = p_document;

  v_pendiente := round(v_doc.amount_total - v_pagado, v_dec);

  if v_importe > v_pendiente then
    if v_es_venta then
      raise exception
        'cobro_excede_documento: de este documento quedan % % por cobrar y estás registrando %',
        to_char(v_pendiente, 'FM999999999990.00'), v_doc.currency_code,
        to_char(v_importe, 'FM999999999990.00');
    else
      raise exception
        'pago_excede_documento: de esta compra quedan % % por pagar y estás registrando %',
        to_char(v_pendiente, 'FM999999999990.00'), v_doc.currency_code,
        to_char(v_importe, 'FM999999999990.00');
    end if;
  end if;

  -- Solo una venta cuelga de una cuota. Una compra no viene de ningún
  -- cronograma nuestro.
  if v_es_venta then
    select i.id into v_item
      from payment_schedule_items i where i.billing_document_id = p_document limit 1;
  end if;

  v_nombre := coalesce(nullif(btrim(v_doc.description), ''),
                       nullif(btrim(v_doc.series_number), ''),
                       'de documento sin número');

  insert into cash_movements (
    organization_id, cash_account_id, legal_entity_id, direction, amount,
    currency_code, value_date, kind, category_id, counterparty_kind,
    client_id, supplier_id, description, external_ref, source)
  values (
    v_doc.organization_id, p_account, v_doc.legal_entity_id, v_dir, v_importe,
    v_doc.currency_code, coalesce(p_value_date, current_date), 'operating',
    v_doc.category_id, v_quien,
    v_doc.client_id, v_doc.supplier_id,
    coalesce(nullif(btrim(coalesce(p_description, '')), ''), v_verbo || ' ' || v_nombre),
    nullif(btrim(coalesce(p_external_ref, '')), ''),
    case when v_es_venta then 'quote' else 'manual' end)
  returning id into v_mov;

  insert into payment_allocations (
    organization_id, legal_entity_id, currency_code, cash_movement_id,
    billing_document_id, payment_schedule_item_id, amount)
  values (
    v_doc.organization_id, v_doc.legal_entity_id, v_doc.currency_code, v_mov,
    p_document, v_item, v_importe);

  return query select * from cash_movements where id = v_mov;
end $fn$;

comment on function app.saldar_documento(uuid, uuid, numeric, date, text, text) is
  'El cuerpo compartido de cobrar una venta y pagar una compra. No es pública: se entra por registrar_cobro o registrar_pago_de_compra.';

revoke all on function app.saldar_documento(uuid, uuid, numeric, date, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Puerta · cobrar una venta
-- ---------------------------------------------------------------------------

create or replace function registrar_cobro(
  p_document     uuid,
  p_account      uuid,
  p_amount       numeric,
  p_value_date   date default null,
  p_external_ref text default null,
  p_description  text default null
) returns setof cash_movements
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare v_dir text;
begin
  select d.direction into v_dir from billing_documents d where d.id = p_document;

  if v_dir = 'purchase' then
    raise exception 'esto_es_una_compra: este documento es una factura de proveedor: se paga, no se cobra. Hazlo desde Finanzas → Compras.';
  end if;

  return query select * from app.saldar_documento(
    p_document, p_account, p_amount, p_value_date, p_external_ref, p_description);
end $fn$;

comment on function registrar_cobro(uuid, uuid, numeric, date, text, text) is
  'Registra el cobro de una venta: crea el movimiento de caja y la asignación. Admite parciales (F2-16).';

revoke all on function registrar_cobro(uuid, uuid, numeric, date, text, text) from public, anon;
grant execute on function registrar_cobro(uuid, uuid, numeric, date, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Puerta · pagar una compra
-- ---------------------------------------------------------------------------

create or replace function registrar_pago_de_compra(
  p_document     uuid,
  p_account      uuid,
  p_amount       numeric,
  p_value_date   date default null,
  p_external_ref text default null,
  p_description  text default null
) returns setof cash_movements
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare v_dir text;
begin
  select d.direction into v_dir from billing_documents d where d.id = p_document;

  if v_dir = 'sale' then
    raise exception 'esto_es_una_venta: este documento es una venta tuya: se cobra, no se paga. Hazlo desde la cartera, en Finanzas → Caja.';
  end if;

  return query select * from app.saldar_documento(
    p_document, p_account, p_amount, p_value_date, p_external_ref, p_description);
end $fn$;

comment on function registrar_pago_de_compra(uuid, uuid, numeric, date, text, text) is
  'Paga una factura de proveedor, entera o en partes: crea el movimiento de salida y la asignación (F3-6).';

revoke all on function registrar_pago_de_compra(uuid, uuid, numeric, date, text, text) from public, anon;
grant execute on function registrar_pago_de_compra(uuid, uuid, numeric, date, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- El tope aprende la dirección
-- ---------------------------------------------------------------------------
--
-- Desde que hay compras, una asignación puede mentir de una forma nueva:
-- atar un ingreso a una factura de proveedor la dejaría pagada con dinero que
-- entró. Con una sola dirección posible el caso no existía; ahora existe, y se
-- cierra donde se cierran los demás, en el disparador que ya vigila los topes.

create or replace function app.respeta_los_topes() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_tope     numeric;
  v_asignado numeric;
  v_kind     cash_kind;
  v_dir      cash_direction;
  v_doc_dir  text;
begin
  select m.amount, m.kind, m.direction into v_tope, v_kind, v_dir
    from cash_movements m where m.id = new.cash_movement_id;

  if v_kind = 'transfer' then
    raise exception
      'asignacion_de_transferencia: ese movimiento es una pata de una transferencia entre tus propias cuentas, no dinero de un cliente. Asignarlo a un documento lo daría por cobrado con dinero que no vino de fuera';
  end if;

  -- INV-2 · un cobro de S/ 400 no se puede asignar a S/ 500 de facturas.
  select coalesce(sum(a.amount), 0) into v_asignado
    from payment_allocations a where a.cash_movement_id = new.cash_movement_id;

  if v_asignado > v_tope then
    raise exception
      'asignacion_excede_movimiento: el movimiento es de % y se le han asignado %',
      to_char(v_tope, 'FM999999999990.00'), to_char(v_asignado, 'FM999999999990.00');
  end if;

  -- INV-3 · lo asignado a un documento no puede pasar de su total, y el dinero
  -- tiene que ir en el sentido del documento.
  if new.billing_document_id is not null then
    select d.amount_total, d.direction into v_tope, v_doc_dir
      from billing_documents d where d.id = new.billing_document_id;

    if v_doc_dir = 'sale' and v_dir = 'out' then
      raise exception
        'direccion_no_concuerda: ese documento es una venta tuya y eso es dinero que salió. Un pago no cobra una factura';
    end if;
    if v_doc_dir = 'purchase' and v_dir = 'in' then
      raise exception
        'direccion_no_concuerda: ese documento es una compra y eso es dinero que entró. Un cobro no paga una factura de proveedor';
    end if;

    select coalesce(sum(a.amount), 0) into v_asignado
      from payment_allocations a
      join cash_movements m on m.id = a.cash_movement_id and not m.is_void
     where a.billing_document_id = new.billing_document_id;

    if v_asignado > v_tope then
      raise exception
        'cobro_excede_documento: el documento es de % y se le han asignado %',
        to_char(v_tope, 'FM999999999990.00'), to_char(v_asignado, 'FM999999999990.00');
    end if;
  end if;

  return null;
end $fn$;

-- ---------------------------------------------------------------------------
-- Puerta · anotar una compra
-- ---------------------------------------------------------------------------
--
-- Una compra no sale de ninguna cuota: llega una factura y hay que anotarla.
-- Por eso esto no se parece a `emitir_documento`, que convierte una cuota
-- prevista en documento, sino que crea el documento desde cero.
--
-- El proveedor entra por nombre y no por identificador a propósito. Nadie va a
-- dar de alta al casero en una pantalla aparte antes de anotar el recibo del
-- alquiler: se escribe el nombre, y si no existe se crea. Lo que evita que
-- «Movistar» y «movistar» se conviertan en dos proveedores es el índice único
-- sobre el nombre normalizado, no la buena memoria de quien teclea.

create or replace function registrar_compra(
  p_entity      uuid,
  p_supplier    text,
  p_amount      numeric,
  p_currency    text,
  p_doc_type    document_type default 'invoice',
  p_series      text default null,
  p_issue_date  date default null,
  p_due_date    date default null,
  p_tax_rate    numeric default null,
  p_category    uuid default null,
  p_description text default null
) returns setof billing_documents
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_ent     record;
  v_cat     record;
  v_moneda  char(3);
  v_dec     int;
  v_importe numeric;
  v_tasa    numeric;
  v_neto    numeric;
  v_fecha   date;
  v_vence   date;
  v_nombre  text;
  v_serie   text;
  v_prov    uuid;
  v_otra    text;
  v_doc     uuid;
begin
  select le.id, le.organization_id, le.legal_name into v_ent
    from legal_entities le where le.id = p_entity;

  if v_ent.id is null or not app.can_write_money(v_ent.organization_id) then
    raise exception 'entidad_no_encontrada: esa empresa no existe o no tienes permiso de finanzas en ella';
  end if;

  v_nombre := btrim(coalesce(p_supplier, ''));
  if v_nombre = '' then
    raise exception 'proveedor_obligatorio: una compra necesita saber a quién se le compró. Sin eso, dentro de tres meses el gasto no se puede reclamar ni cuadrar con el extracto';
  end if;

  v_moneda := upper(btrim(coalesce(p_currency, '')));
  if not exists (select 1 from currencies c where c.code = v_moneda) then
    raise exception 'unknown_currency: % no existe en el catálogo de monedas', v_moneda;
  end if;
  if not exists (
    select 1 from organization_currencies oc
     where oc.organization_id = v_ent.organization_id
       and oc.currency_code = v_moneda
       and oc.is_enabled
  ) then
    raise exception 'currency_not_enabled: % no está habilitada en esta organización', v_moneda;
  end if;

  select c.minor_units into v_dec from currencies c where c.code = v_moneda;
  v_importe := round(coalesce(p_amount, 0), v_dec);
  if v_importe <= 0 then
    raise exception 'importe_invalido: el total de la compra tiene que ser mayor que cero';
  end if;

  -- Sin tasa dicha, la de la empresa. No se asume 18 %: una factura exonerada
  -- existe, y un IGV inventado se convierte en crédito fiscal que no tienes.
  v_tasa := p_tax_rate;
  if v_tasa is null then
    select t.rate into v_tasa
      from tax_rates t
     where t.legal_entity_id = p_entity and t.is_default and t.is_active;
  end if;
  v_tasa := coalesce(v_tasa, 0);
  if v_tasa < 0 then
    raise exception 'impuesto_invalido: el impuesto no puede ser negativo';
  end if;

  v_fecha := coalesce(p_issue_date, current_date);
  v_vence := p_due_date;
  if v_vence is not null and v_vence < v_fecha then
    raise exception
      'vencimiento_antes_de_la_fecha: la factura es del % y pones vencimiento el %. Así aparecería vencida desde el día que llegó',
      to_char(v_fecha, 'DD/MM/YYYY'), to_char(v_vence, 'DD/MM/YYYY');
  end if;

  if p_category is not null then
    select fc.name, fc.direction into v_cat
      from financial_categories fc
     where fc.id = p_category and fc.organization_id = v_ent.organization_id;
    if v_cat.name is null then
      raise exception 'categoria_no_encontrada: esa categoría no existe en esta organización';
    end if;
    if v_cat.direction = 'in' then
      raise exception
        'categoria_de_ingreso: «%» es una categoría de ingresos y esto es una compra. Elige una de gastos o cámbiala a «ambas» en Configuración → Categorías',
        v_cat.name;
    end if;
  end if;

  -- Se busca sin distinguir mayúsculas ni espacios de más, que es como se
  -- teclea el mismo nombre dos veces.
  select s.id into v_prov
    from suppliers s
   where s.organization_id = v_ent.organization_id
     and lower(btrim(s.name)) = lower(v_nombre);

  if v_prov is null then
    insert into suppliers (organization_id, name)
    values (v_ent.organization_id, v_nombre)
    returning id into v_prov;
  end if;

  v_serie := nullif(btrim(coalesce(p_series, '')), '');

  if v_serie is not null then
    select coalesce(nullif(btrim(d.description), ''), to_char(d.issue_date, 'DD/MM/YYYY'))
      into v_otra
      from billing_documents d
     where d.organization_id = v_ent.organization_id
       and d.direction = 'purchase'
       and d.supplier_id = v_prov
       and upper(btrim(d.series_number)) = upper(v_serie)
       and d.status <> 'void'
     limit 1;

    if v_otra is not null then
      raise exception
        'compra_repetida: ya hay una compra de % con el número % (%). Si es otra factura, revisa el número; si es la misma, ya está anotada',
        v_nombre, v_serie, v_otra;
    end if;
  end if;

  -- El total lleva el impuesto dentro, igual que en una venta: es como viene
  -- escrito en la factura y es lo que se va a pagar.
  v_neto := round(v_importe / (1 + v_tasa / 100), v_dec);

  insert into billing_documents (
    organization_id, legal_entity_id, direction, doc_type, series_number,
    supplier_id, category_id, description, issue_date, due_date, currency_code,
    amount_net, amount_tax, amount_total, tax_rate, status)
  values (
    v_ent.organization_id, p_entity, 'purchase', p_doc_type, v_serie,
    v_prov, p_category, nullif(btrim(coalesce(p_description, '')), ''),
    v_fecha, v_vence, v_moneda,
    v_neto, v_importe - v_neto, v_importe, v_tasa, 'open')
  returning id into v_doc;

  return query select * from billing_documents where id = v_doc;
end $fn$;

comment on function registrar_compra(uuid, text, numeric, text, document_type, text, date, date, numeric, uuid, text) is
  'Anota la factura de un proveedor: crea el documento de compra y, si hace falta, el proveedor (F3-6).';

revoke all on function registrar_compra(uuid, text, numeric, text, document_type, text, date, date, numeric, uuid, text) from public, anon;
grant execute on function registrar_compra(uuid, text, numeric, text, document_type, text, date, date, numeric, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Puerta · anular un documento
-- ---------------------------------------------------------------------------
--
-- Hacía falta desde que hay un índice que impide repetir el número de una
-- factura de proveedor: sin forma de anular, una factura mal teclada dejaría
-- su número inutilizado para siempre.
--
-- No borra: marca. Y se niega si ya hay dinero asignado, porque anular el
-- documento dejando sus cobros vivos convertiría ese dinero en un ingreso sin
-- venta. Primero se anula el movimiento, después el documento.

create or replace function anular_documento(
  p_document uuid,
  p_motivo   text
) returns setof billing_documents
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_doc     record;
  v_motivo  text;
  v_pagado  numeric;
  v_cuantos int;
begin
  select d.* into v_doc from billing_documents d where d.id = p_document for update;

  if v_doc.id is null then
    raise exception 'documento_no_encontrado: ese documento no existe';
  end if;

  if not app.can_write_money(v_doc.organization_id) then
    raise exception 'documento_no_encontrado: ese documento no existe o no es de tu organización';
  end if;

  if v_doc.status = 'void' then
    raise exception 'documento_ya_anulado: este documento ya estaba anulado';
  end if;

  v_motivo := nullif(btrim(coalesce(p_motivo, '')), '');
  if v_motivo is null then
    raise exception 'motivo_obligatorio: anular algo exige decir por qué. Queda escrito y no se borra';
  end if;

  select count(*), coalesce(sum(a.amount), 0) into v_cuantos, v_pagado
    from payment_allocations a
    join cash_movements m on m.id = a.cash_movement_id and not m.is_void
   where a.billing_document_id = p_document;

  if v_cuantos > 0 then
    raise exception
      'documento_con_dinero: este documento tiene % movimiento(s) asignados por % %. Anula primero esos movimientos: si se anulara el documento dejándolos vivos, ese dinero quedaría sin hecho que lo explique',
      v_cuantos, to_char(v_pagado, 'FM999999999990.00'), v_doc.currency_code;
  end if;

  update billing_documents
     set status = 'void', void_reason = v_motivo
   where id = p_document;

  -- La cuota vuelve a estar prevista: su documento ya no existe, así que se
  -- puede volver a emitir. Sin esto quedaría «documentada» señalando a un
  -- documento anulado y no habría forma de facturarla otra vez.
  update payment_schedule_items
     set status = 'planned', billing_document_id = null
   where billing_document_id = p_document;

  return query select * from billing_documents where id = p_document;
end $fn$;

comment on function anular_documento(uuid, text) is
  'Anula un documento vivo y sin dinero asignado, dejando el motivo escrito. La cuota de la que salió vuelve a estar prevista (F3-6).';

revoke all on function anular_documento(uuid, text) from public, anon;
grant execute on function anular_documento(uuid, text) to authenticated;
