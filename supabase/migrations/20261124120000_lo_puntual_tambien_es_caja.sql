-- ============================================================================
-- Margen Pilot · F5-3 · Lo puntual también es caja
--
-- Lo último que la proyección de trece semanas no veía: un cobro o un pago de
-- **una sola vez**, con fecha futura y sin factura detrás. Un adelanto que te
-- van a pasar, la cámara que pactaste para el 15 de enero, el adelanto que le
-- diste al freelance. No cabía en ninguna de las tres cosas que ya existían:
-- no es una cuota de una cotización, no es un gasto fijo que se repite, y no
-- es una factura de proveedor porque no hay factura.
--
-- ---------------------------------------------------------------------------
-- No hay tabla nueva, y eso es lo importante de esta migración
-- ---------------------------------------------------------------------------
--
-- `payment_schedule_items` se escribió el 5/11 con este comentario dentro:
--
--     Nulos cuando la cuota no venga de una cotización. Hoy siempre vienen de
--     una; en F3 habrá pagos previstos a proveedores que no tienen detrás
--     ninguna, y por eso `direction` ya distingue entrada de salida.
--
-- Es decir: la tabla ya tenía `quote_id` nulable y `direction`, y lo que
-- faltaba eran las puertas. Hacer una tabla nueva habría dejado dos
-- definiciones de «dinero previsto», dos índices para la proyección y dos
-- sitios donde arreglar el mismo error. Un apunte previsto suelto es una fila
-- de esta tabla con `quote_id` nulo, y se llama **previsto** para distinguirlo
-- de una **cuota**, que es la que viene de una cotización.
--
-- ---------------------------------------------------------------------------
-- INV-15.4 — Un previsto es un plan; se salda con dinero, no con un botón
-- ---------------------------------------------------------------------------
--
-- 1. **No mueve dinero.** Igual que una cuota prevista o un gasto fijo: entra
--    en la proyección y no toca el saldo (INV-1). Existe de verdad el día que
--    se registra el movimiento.
--
-- 2. **Su estado se deriva de lo asignado, no se declara.** `saldar_previsto`
--    crea el movimiento y la asignación; el estado lo pone
--    `app.recalcula_estado_previsto`, por los mismos disparadores que ya
--    siguen a un documento. Un botón «marcar como pagado» sería un estado que
--    puede discrepar del dinero, y entonces la proyección tendría dos
--    verdades.
--
-- 3. **Saldado a medias sigue proyectando lo que falta.** Si pactaste 3 000 y
--    adelantaste 1 000, lo que queda en la curva es 2 000: los 1 000 ya están
--    en el saldo y contarlos otra vez sería contarlos dos veces (INV-15.1).
--
-- 4. **El dinero va en el sentido del previsto.** Un previsto de salida no se
--    salda con una entrada, igual que un ingreso no paga una factura de
--    proveedor (`direccion_no_concuerda`). Esto sí se vigila.
--
-- 5. **Lo que NO se vigila es el tope, y es deliberado.** A una cuota de una
--    cotización no se le puede asignar más de lo que vale, porque es un
--    derecho de cobro con un importe acordado (INV-3). Un previsto es una
--    estimación tuya: si la cámara que pactaste en 3 000 terminó costando
--    3 200, negarse a registrar el pago sería obligarte a editar el plan para
--    poder anotar la realidad. El movimiento es el dinero y es correcto; el
--    plan solo queda saldado.
--
-- 6. **Mientras es un plan se puede quitar; en cuanto tiene dinero, no.** Un
--    previsto sin asignaciones se borra —una proyección no es un hecho
--    económico, el mismo razonamiento que ya usa `guardar_cronograma`— y
--    `audit_log` guarda el rastro. Con dinero asignado, no: borrarlo dejaría
--    un movimiento señalando a algo que no existe.
--
-- 7. **Una cuota de cotización no entra por aquí.** Se emite su documento y
--    se cobra, que es lo que la pone en la cartera. Si estas puertas la
--    aceptaran, habría dos caminos para cobrar una venta y uno de los dos no
--    dejaría documento.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- El estado de un previsto, derivado de lo que se le asignó
-- ---------------------------------------------------------------------------

create or replace function app.recalcula_estado_previsto(p_item uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_item   record;
  v_pagado numeric;
  v_estado schedule_status;
begin
  if p_item is null then return; end if;

  select i.id, i.amount, i.status, i.quote_id into v_item
    from payment_schedule_items i where i.id = p_item;
  if v_item.id is null then return; end if;

  -- Una cuota de cotización sigue a su documento y no a sus asignaciones: de
  -- eso se encarga `app.recalcula_estado_documento`. Y una cancelada se queda
  -- cancelada: un pago posterior no la revive.
  if v_item.quote_id is not null or v_item.status = 'cancelled' then return; end if;

  select coalesce(sum(a.amount), 0) into v_pagado
    from payment_allocations a
    join cash_movements m on m.id = a.cash_movement_id
   where a.payment_schedule_item_id = p_item and not m.is_void;

  v_estado := case when v_pagado >= v_item.amount then 'settled' else 'planned' end::schedule_status;

  if v_estado is distinct from v_item.status then
    update payment_schedule_items set status = v_estado where id = p_item;
  end if;
end $fn$;

revoke all on function app.recalcula_estado_previsto(uuid) from public, anon;

-- Los dos disparadores que ya seguían a un documento ahora siguen también al
-- previsto. Se vuelven a declarar enteros porque son cuerpos de cinco líneas
-- y partirlos en dos funciones costaría más de lo que ahorra.

create or replace function app.al_cambiar_una_asignacion() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  perform app.recalcula_estado_documento(
    coalesce(new.billing_document_id, old.billing_document_id));
  perform app.recalcula_estado_previsto(
    coalesce(new.payment_schedule_item_id, old.payment_schedule_item_id));
  return null;
end $fn$;

create or replace function app.al_anular_un_movimiento() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare r record;
begin
  if new.is_void is distinct from old.is_void then
    for r in select distinct a.billing_document_id
               from payment_allocations a
              where a.cash_movement_id = new.id and a.billing_document_id is not null
    loop
      perform app.recalcula_estado_documento(r.billing_document_id);
    end loop;

    for r in select distinct a.payment_schedule_item_id
               from payment_allocations a
              where a.cash_movement_id = new.id
                and a.payment_schedule_item_id is not null
    loop
      perform app.recalcula_estado_previsto(r.payment_schedule_item_id);
    end loop;
  end if;
  return null;
end $fn$;

-- ---------------------------------------------------------------------------
-- El tope aprende la dirección de un previsto
-- ---------------------------------------------------------------------------
--
-- Se añade la comprobación de sentido (INV-15.4.4) y NO la del tope
-- (INV-15.4.5). El resto del cuerpo es el de F3-6, sin un cambio.

create or replace function app.respeta_los_topes() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_tope     numeric;
  v_asignado numeric;
  v_kind     cash_kind;
  v_dir      cash_direction;
  v_doc_dir  text;
  v_item_dir text;
  v_etiqueta text;
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

  -- INV-15.4.4 · el dinero va en el sentido del previsto. Sin tope: un
  -- previsto es una estimación, no un derecho de cobro.
  if new.payment_schedule_item_id is not null then
    select i.direction, i.label into v_item_dir, v_etiqueta
      from payment_schedule_items i where i.id = new.payment_schedule_item_id;

    if v_item_dir = 'in' and v_dir = 'out' then
      raise exception
        'direccion_no_concuerda: «%» es dinero que esperas cobrar y eso es dinero que salió. Un pago no salda un cobro previsto',
        v_etiqueta;
    end if;
    if v_item_dir = 'out' and v_dir = 'in' then
      raise exception
        'direccion_no_concuerda: «%» es dinero que esperas pagar y eso es dinero que entró. Un cobro no salda un pago previsto',
        v_etiqueta;
    end if;
  end if;

  return null;
end $fn$;

-- ---------------------------------------------------------------------------
-- Puerta · guardar un previsto
-- ---------------------------------------------------------------------------

create or replace function guardar_previsto(
  p_entity    uuid,
  p_direction text,
  p_label     text,
  p_amount    numeric,
  p_currency  text,
  p_due_date  date,
  p_account   uuid default null,
  p_id        uuid default null
) returns setof payment_schedule_items
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_ent     record;
  v_previo  record;
  v_moneda  char(3);
  v_dec     int;
  v_importe numeric;
  v_dir     text;
  v_etiqueta text;
  v_cuenta  record;
  v_item    uuid;
begin
  select le.id, le.organization_id, le.legal_name into v_ent
    from legal_entities le where le.id = p_entity;

  if v_ent.id is null or not app.can_write_money(v_ent.organization_id) then
    raise exception 'entidad_no_encontrada: esa empresa no existe o no tienes permiso de finanzas en ella';
  end if;

  v_dir := lower(btrim(coalesce(p_direction, '')));
  if v_dir not in ('in', 'out') then
    raise exception 'direccion_invalida: un previsto es dinero que entra o dinero que sale';
  end if;

  v_etiqueta := btrim(coalesce(p_label, ''));
  if v_etiqueta = '' then
    raise exception 'etiqueta_obligatoria: el previsto necesita un nombre, el que vas a reconocer en la proyección dentro de dos meses';
  end if;

  if p_due_date is null then
    raise exception 'fecha_obligatoria: un previsto sin fecha no cae en ninguna semana, y entonces no proyecta nada';
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
    raise exception 'importe_invalido: el importe tiene que ser mayor que cero';
  end if;

  -- La cuenta esperada, si se dice cuál, es del mismo libro y la misma
  -- moneda. La clave compuesta lo impone igual; esto lo explica antes.
  if p_account is not null then
    select a.id, a.name into v_cuenta
      from cash_accounts a
     where a.id = p_account
       and a.organization_id = v_ent.organization_id
       and a.legal_entity_id = p_entity
       and a.currency_code = v_moneda;

    if v_cuenta.id is null then
      raise exception
        'cuenta_de_otro_libro: esa cuenta no es de % en %. De una cuenta sale el dinero de su empresa y en su moneda',
        v_ent.legal_name, v_moneda;
    end if;
  end if;

  if p_id is null then
    insert into payment_schedule_items (
      organization_id, legal_entity_id, direction, label, due_date, amount,
      currency_code, expected_cash_account_id, status)
    values (
      v_ent.organization_id, p_entity, v_dir, v_etiqueta, p_due_date, v_importe,
      v_moneda, p_account, 'planned')
    returning id into v_item;
  else
    select i.* into v_previo
      from payment_schedule_items i where i.id = p_id for update;

    if v_previo.id is null or v_previo.organization_id <> v_ent.organization_id then
      raise exception 'previsto_no_encontrado: ese previsto no existe o no es de tu organización';
    end if;

    if v_previo.quote_id is not null then
      raise exception
        'cuota_de_cotizacion: «%» es una cuota de una cotización y se edita en su cronograma, no aquí',
        v_previo.label;
    end if;

    -- Con dinero asignado no se cambia el importe ni el libro: habría que
    -- decidir qué pasa con lo ya asignado, y la respuesta honesta es que se
    -- anula el movimiento primero.
    if exists (select 1 from payment_allocations a
                where a.payment_schedule_item_id = p_id) then
      raise exception
        'previsto_con_dinero: «%» ya tiene un movimiento asignado. Anula ese movimiento desde Caja antes de cambiarlo',
        v_previo.label;
    end if;

    update payment_schedule_items
       set direction = v_dir,
           label = v_etiqueta,
           due_date = p_due_date,
           amount = v_importe,
           currency_code = v_moneda,
           legal_entity_id = p_entity,
           expected_cash_account_id = p_account
     where id = p_id;
    v_item := p_id;
  end if;

  return query select * from payment_schedule_items where id = v_item;
end $fn$;

comment on function guardar_previsto(uuid, text, text, numeric, text, date, uuid, uuid) is
  'Crea o corrige un cobro o pago previsto de una sola vez, sin cotización ni factura detrás (F5-3).';

revoke all on function guardar_previsto(uuid, text, text, numeric, text, date, uuid, uuid) from public, anon;
grant execute on function guardar_previsto(uuid, text, text, numeric, text, date, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Puerta · quitar un previsto que todavía es solo un plan
-- ---------------------------------------------------------------------------

create or replace function quitar_previsto(p_item uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare v_item record;
begin
  select i.* into v_item from payment_schedule_items i where i.id = p_item for update;

  if v_item.id is null or not app.can_write_money(v_item.organization_id) then
    raise exception 'previsto_no_encontrado: ese previsto no existe o no es de tu organización';
  end if;

  if v_item.quote_id is not null then
    raise exception
      'cuota_de_cotizacion: «%» es una cuota de una cotización. Se quita desde su cronograma, que comprueba que las demás sigan sumando el total',
      v_item.label;
  end if;

  if exists (select 1 from payment_allocations a where a.payment_schedule_item_id = p_item) then
    raise exception
      'previsto_con_dinero: «%» ya tiene un movimiento asignado. Si el pago no era este, anula el movimiento desde Caja; borrar el previsto dejaría ese dinero señalando a algo que no existe',
      v_item.label;
  end if;

  -- Se borra, y se puede: una proyección no es un hecho económico, no hay
  -- documento ni dinero detrás, y `audit_log` guarda la fila que había. Es el
  -- mismo razonamiento de `guardar_cronograma` con las cuotas previstas.
  delete from payment_schedule_items where id = p_item;
end $fn$;

comment on function quitar_previsto(uuid) is
  'Borra un previsto que todavía no tiene dinero asignado. Con dinero, se niega y dice qué anular primero (F5-3).';

revoke all on function quitar_previsto(uuid) from public, anon;
grant execute on function quitar_previsto(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Puerta · saldar un previsto con dinero de verdad
-- ---------------------------------------------------------------------------
--
-- Es el hermano de `app.saldar_documento` para lo que no tiene documento:
-- crea el movimiento en la cuenta y la asignación que lo ata al previsto. El
-- estado lo deriva el disparador, no esta función.

create or replace function saldar_previsto(
  p_item         uuid,
  p_account      uuid,
  p_amount       numeric,
  p_value_date   date default null,
  p_external_ref text default null,
  p_description  text default null
) returns setof cash_movements
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_item      record;
  v_cuenta    record;
  v_dec       int;
  v_importe   numeric;
  v_asignado  numeric;
  v_mov       uuid;
begin
  select i.* into v_item from payment_schedule_items i where i.id = p_item for update;

  if v_item.id is null or not app.can_write_money(v_item.organization_id) then
    raise exception 'previsto_no_encontrado: ese previsto no existe o no es de tu organización';
  end if;

  if v_item.quote_id is not null then
    raise exception
      'cuota_de_cotizacion: «%» es una cuota de una cotización: emite su documento y cóbralo, que es lo que la mete en la cartera',
      v_item.label;
  end if;

  if v_item.status = 'cancelled' then
    raise exception 'previsto_cancelado: «%» está cancelado', v_item.label;
  end if;

  select a.* into v_cuenta
    from cash_accounts a
   where a.id = p_account
     and a.organization_id = v_item.organization_id
     and a.legal_entity_id = v_item.legal_entity_id
     and a.currency_code   = v_item.currency_code;

  if v_cuenta.id is null then
    raise exception
      'cuenta_de_otro_libro: «%» está en % y hay que saldarlo desde una cuenta de la misma empresa y moneda',
      v_item.label, v_item.currency_code;
  end if;

  select c.minor_units into v_dec from currencies c where c.code = v_item.currency_code;
  v_importe := round(coalesce(p_amount, 0), v_dec);

  if v_importe <= 0 then
    raise exception 'importe_invalido: un movimiento tiene que ser mayor que cero';
  end if;

  select coalesce(sum(a.amount), 0) into v_asignado
    from payment_allocations a
    join cash_movements m on m.id = a.cash_movement_id and not m.is_void
   where a.payment_schedule_item_id = p_item;

  if v_asignado >= v_item.amount then
    raise exception
      'previsto_ya_saldado: «%» ya está saldado del todo con % de los % previstos',
      v_item.label,
      to_char(v_asignado, 'FM999999999990.00'),
      to_char(v_item.amount, 'FM999999999990.00');
  end if;

  insert into cash_movements (
    organization_id, cash_account_id, legal_entity_id, direction, amount,
    currency_code, value_date, kind, description, external_ref, source)
  values (
    v_item.organization_id, p_account, v_item.legal_entity_id, v_item.direction::cash_direction,
    v_importe, v_item.currency_code, coalesce(p_value_date, current_date), 'operating',
    coalesce(nullif(btrim(coalesce(p_description, '')), ''), v_item.label),
    nullif(btrim(coalesce(p_external_ref, '')), ''), 'manual')
  returning id into v_mov;

  insert into payment_allocations (
    organization_id, legal_entity_id, currency_code, cash_movement_id,
    payment_schedule_item_id, amount)
  values (
    v_item.organization_id, v_item.legal_entity_id, v_item.currency_code, v_mov,
    p_item, v_importe);

  return query select * from cash_movements where id = v_mov;
end $fn$;

comment on function saldar_previsto(uuid, uuid, numeric, date, text, text) is
  'Registra el dinero de un previsto: crea el movimiento y la asignación. El estado lo deriva el disparador (F5-3).';

revoke all on function saldar_previsto(uuid, uuid, numeric, date, text, text) from public, anon;
grant execute on function saldar_previsto(uuid, uuid, numeric, date, text, text) to authenticated;
