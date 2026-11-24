-- ===========================================================================
-- UN SOLO ARCHIVO para pegar en Supabase → SQL Editor y pulsar Run.
--
-- Generado por supabase/seed/armar.sh. No se edita a mano.
--
-- Hace tres cosas, en este orden y en una sola pasada:
--
--  1. aplica la migración de «lo puntual también es caja» (F5-3), que es la
--     única que falta en el proyecto, y la deja apuntada en el historial de
--     migraciones para que no se vuelva a aplicar;
--  2. borra la organización «Margen Demo» si existe de una pasada anterior,
--     para volver a crearla con los datos nuevos. Esto NO toca «Margen
--     Pilot»: borra una sola fila, la de la demo, y lo demás cae por cascada;
--  3. vuelve a crear «Margen Demo» con datos de prueba en todo: sus trabajos
--     con dos compras atribuidas, y dos previstos de una sola vez, uno de
--     ellos adelantado a medias.
--
-- Para quitar la demo después, sin volver a crearla: borrar-demo.sql.
-- ===========================================================================

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

-- Queda apuntada en el historial: si no, un despliegue futuro intentaría
-- aplicarla otra vez y fallaría a mitad.
insert into supabase_migrations.schema_migrations (version, name)
values ('20261124120000', 'lo_puntual_tambien_es_caja')
on conflict (version) do nothing;

-- La demo de la pasada anterior, si está. Solo la demo: el slug es exacto y
-- «margen-pilot» no se parece a «margen-demo».
delete from organizations where slug = 'margen-demo';

-- ===========================================================================
-- Datos de demostración · organización «Margen Demo»
-- ===========================================================================
--
-- Para ver el producto funcionando con algo dentro, sin tocar «Margen Pilot».
--
-- Va en una organización aparte a propósito, y la razón no es estética: nada
-- financiero se borra en este producto (INV-7, `authenticated` no tiene ni un
-- permiso de DELETE). Si los datos de prueba vivieran en la organización real,
-- quitarlos después sería imposible: lo más que se podría hacer es anularlos,
-- y quedarían a la vista para siempre en la cartera, en el libro y en el
-- resultado de noviembre de 2026.
--
-- En su propia organización, en cambio, borrarla es una sola fila: todo lo
-- demás cuelga de `organization_id` con `on delete cascade`. Eso es lo que
-- hace `borrar-demo.sql`.
--
-- Todo se crea por las mismas puertas que usa la aplicación —emitir, aprobar,
-- cobrar, transferir, comprar, pagar— y no con inserciones a mano. Si una
-- invariante estuviera mal, esto fallaría aquí en vez de dejar datos
-- imposibles que luego confunden más que ayudar.
--
-- Es un solo bloque `do`, es decir una sola transacción: o entra todo o no
-- entra nada. Ejecutarlo dos veces falla por el slug repetido, y eso es lo
-- correcto: dos demos a medias serían peor.

do $demo$
declare
  v_usuario uuid;
  v_org    uuid;
  v_pe     uuid;  -- Demo Perú SAC
  v_us     uuid;  -- Demo Studio LLC
  v_marca_pe uuid;
  v_marca_us uuid;
  v_bcp    uuid;  -- PEN, Demo Perú SAC
  v_chica  uuid;  -- PEN, Demo Perú SAC
  v_mercury uuid; -- USD, Demo Studio LLC
  v_cat_camp uuid;
  v_cat_cont uuid;
  v_srv_lanz uuid;
  v_srv_redes uuid;
  v_srv_retainer uuid;
  v_ci_direccion uuid;
  v_ci_video uuid;
  v_ci_ads uuid;
  v_ci_redaccion uuid;
  v_cli_ej uuid;
  v_cli_dental uuid;
  v_cli_nova uuid;
  v_cli_harbor uuid;
  v_g_herramientas uuid;
  v_g_servicios uuid;
  v_g_personal uuid;
  v_g_proveedores uuid;
  v_q_borrador uuid;
  v_q_enviada uuid;
  v_q_negociando uuid;
  v_q_aprobada uuid;
  v_q_rechazada uuid;
  v_q_vencida uuid;
  v_cuota  uuid;
  v_doc    uuid;
  v_compra uuid;
  v_trab_lanz  uuid;
  v_trab_redes uuid;
  v_previsto   uuid;
begin
  -- Quién es el dueño de la demo: el primer usuario del proyecto. En «Margen
  -- Pilot» hay exactamente uno, así que es él; en la CI es uno de los dos de
  -- prueba, y a ninguno le estorba. Buscarlo en vez de escribir aquí su
  -- identificador hace que este archivo sirva en los dos sitios y no guarde
  -- datos de nadie.
  --
  -- Se ordena por `id` y no por `created_at` a propósito: el `auth.users` que
  -- Supabase provee tiene esa columna y el stub de la CI no, así que ordenar
  -- por ella hacía que el guion funcionara en producción y fallara en la CI,
  -- que es la peor combinación posible.
  select u.id into v_usuario from auth.users u order by u.id limit 1;
  if v_usuario is null then
    raise exception 'no hay ningún usuario en el proyecto: la demo necesita un dueño';
  end if;

  -- Las puertas comprueban `auth.uid()`, así que hay que decir quién escribe.
  -- Se hace con set_config local y no con `set` a secas: un `set` de sesión no
  -- sobrevive a un pooler en modo transacción, y esto vive exactamente lo que
  -- vive el bloque.
  perform set_config('request.jwt.claim.sub', v_usuario::text, true);

  -- ---------------------------------------------------------------- la base
  v_org := create_organization('Margen Demo', 'PEN');

  -- Sin plan internal, el plan free topa en una entidad, una moneda y dos
  -- cuentas, y la demo necesita dos empresas con tres cuentas para que se
  -- pueda ver una transferencia.
  update subscriptions set plan_code = 'internal' where organization_id = v_org;

  insert into organization_currencies (organization_id, currency_code)
  values (v_org, 'USD');

  insert into legal_entities (organization_id, legal_name, country, default_currency_code,
    tax_id, address, phone, email)
  values (v_org, 'Demo Perú SAC', 'PE', 'PEN',
    '20600000001', 'Av. Demo 123, Lima', '+51 900 000 001', 'hola@demo.pe')
  returning id into v_pe;

  insert into legal_entities (organization_id, legal_name, country, default_currency_code,
    tax_id, address, email)
  values (v_org, 'Demo Studio LLC', 'US', 'USD',
    '99-0000001', '1 Demo St, Wilmington DE', 'hello@demostudio.co')
  returning id into v_us;

  insert into brands (organization_id, legal_entity_id, name, accent_color)
  values (v_org, v_pe, 'Demo Perú', '#1d4ed8') returning id into v_marca_pe;
  insert into brands (organization_id, legal_entity_id, name, accent_color)
  values (v_org, v_us, 'Demo Studio', '#0f766e') returning id into v_marca_us;

  insert into tax_rates (organization_id, legal_entity_id, name, rate, is_default)
  values (v_org, v_pe, 'IGV 18%', 18.0000, true);
  insert into tax_rates (organization_id, legal_entity_id, name, rate, is_default)
  values (v_org, v_us, 'Sin impuesto', 0.0000, true);

  -- Una conversión sin fuente no es un dato (ADR-14): la tasa se carga con su
  -- fecha y su origen, aunque sea de demostración.
  insert into fx_rates (organization_id, from_code, to_code, rate, as_of, source)
  values (v_org, 'USD', 'PEN', 3.75000000, current_date, 'demo');

  insert into cash_accounts (organization_id, legal_entity_id, name, currency_code, sort)
  values (v_org, v_pe, 'BCP Soles', 'PEN', 10) returning id into v_bcp;
  insert into cash_accounts (organization_id, legal_entity_id, name, currency_code, sort)
  values (v_org, v_pe, 'Caja Chica', 'PEN', 20) returning id into v_chica;
  insert into cash_accounts (organization_id, legal_entity_id, name, currency_code, sort)
  values (v_org, v_us, 'Mercury USD', 'USD', 30) returning id into v_mercury;

  select id into v_g_herramientas from financial_categories
   where organization_id = v_org and name = 'Herramientas y licencias';
  select id into v_g_servicios from financial_categories
   where organization_id = v_org and name = 'Alquiler y servicios';
  select id into v_g_personal from financial_categories
   where organization_id = v_org and name = 'Personal y freelancers';
  select id into v_g_proveedores from financial_categories
   where organization_id = v_org and name = 'Proveedores';

  -- -------------------------------------------------------------- catálogo
  insert into service_categories (organization_id, name)
  values (v_org, 'Campañas') returning id into v_cat_camp;
  insert into service_categories (organization_id, name)
  values (v_org, 'Contenido') returning id into v_cat_cont;

  insert into cost_items (organization_id, legal_entity_id, name, kind, unit, unit_cost, currency_code)
  values (v_org, v_pe, 'Dirección creativa', 'role', 'hora', 120.0000, 'PEN')
  returning id into v_ci_direccion;
  insert into cost_items (organization_id, legal_entity_id, name, kind, unit, unit_cost, currency_code)
  values (v_org, v_pe, 'Edición de video', 'role', 'hora', 80.0000, 'PEN')
  returning id into v_ci_video;
  insert into cost_items (organization_id, legal_entity_id, name, kind, unit, unit_cost, currency_code)
  values (v_org, v_pe, 'Pauta Meta', 'tool', 'mes', 1500.0000, 'PEN')
  returning id into v_ci_ads;
  insert into cost_items (organization_id, legal_entity_id, name, kind, unit, unit_cost, currency_code)
  values (v_org, v_us, 'Redacción senior', 'role', 'hora', 25.0000, 'USD')
  returning id into v_ci_redaccion;

  insert into services (organization_id, legal_entity_id, code, name, category_id,
    suggested_currency_code, default_fee_pct)
  values (v_org, v_pe, 'CAMP-01', 'Campaña de lanzamiento', v_cat_camp, 'PEN', 80)
  returning id into v_srv_lanz;
  insert into services (organization_id, legal_entity_id, code, name, category_id,
    suggested_currency_code, default_fee_pct)
  values (v_org, v_pe, 'REDES-01', 'Gestión de redes mensual', v_cat_cont, 'PEN', 60)
  returning id into v_srv_redes;
  insert into services (organization_id, legal_entity_id, code, name, category_id,
    suggested_currency_code, default_fee_pct)
  values (v_org, v_us, 'CONT-01', 'Content retainer', v_cat_cont, 'USD', 70)
  returning id into v_srv_retainer;

  insert into service_cost_lines (organization_id, service_id, cost_item_id, quantity,
    unit_cost, unit, currency_code)
  values
    (v_org, v_srv_lanz,     v_ci_direccion, 12, 120.0000, 'hora', 'PEN'),
    (v_org, v_srv_lanz,     v_ci_video,     20,  80.0000, 'hora', 'PEN'),
    (v_org, v_srv_lanz,     v_ci_ads,        1, 1500.0000, 'mes', 'PEN'),
    (v_org, v_srv_redes,    v_ci_video,      8,  80.0000, 'hora', 'PEN'),
    (v_org, v_srv_redes,    v_ci_direccion,  4, 120.0000, 'hora', 'PEN'),
    (v_org, v_srv_retainer, v_ci_redaccion, 20,  25.0000, 'hora', 'USD');

  -- --------------------------------------------------------------- clientes
  insert into clients (organization_id, name, tax_id, email) values
    (v_org, 'EJ Deportes SAC', '20600000111', 'compras@ejdeportes.pe')
  returning id into v_cli_ej;
  insert into clients (organization_id, name, tax_id, email) values
    (v_org, 'Clínica Dental Sonrisa', '20600000222', 'admin@sonrisa.pe')
  returning id into v_cli_dental;
  insert into clients (organization_id, name, email) values
    (v_org, 'Nova Café', 'hola@novacafe.pe')
  returning id into v_cli_nova;
  insert into clients (organization_id, name, email) values
    (v_org, 'Harbor Goods LLC', 'ap@harborgoods.co')
  returning id into v_cli_harbor;

  -- ------------------------------------------------------------ el tablero
  -- Una por columna, para que Pipeline tenga algo que repartir.

  -- Borrador: sin emitir, así que no tiene cifra que el cliente haya visto.
  insert into quotes (organization_id, legal_entity_id, brand_id, client_id, number,
    currency_code, tax_rate_pct, tax_label, valid_until)
  values (v_org, v_pe, v_marca_pe, v_cli_ej, next_quote_number(v_pe), 'PEN', 18, 'IGV',
    current_date + 20)
  returning id into v_q_borrador;
  perform add_quote_line_from_service(v_q_borrador, v_srv_redes, 1);

  -- Enviada y quieta: emitida hace veinticinco días y nadie la ha tocado.
  insert into quotes (organization_id, legal_entity_id, brand_id, client_id, number,
    currency_code, tax_rate_pct, tax_label, valid_until, created_at)
  values (v_org, v_pe, v_marca_pe, v_cli_dental, next_quote_number(v_pe), 'PEN', 18, 'IGV',
    current_date + 5, now() - interval '25 days')
  returning id into v_q_enviada;
  perform add_quote_line_from_service(v_q_enviada, v_srv_lanz, 1);
  perform emitir_cotizacion(v_q_enviada, 'Enviada por correo');

  -- En negociación: se movió ayer.
  insert into quotes (organization_id, legal_entity_id, brand_id, client_id, number,
    currency_code, tax_rate_pct, tax_label, valid_until, created_at)
  values (v_org, v_pe, v_marca_pe, v_cli_nova, next_quote_number(v_pe), 'PEN', 18, 'IGV',
    current_date + 12, now() - interval '9 days')
  returning id into v_q_negociando;
  perform add_quote_line_from_service(v_q_negociando, v_srv_redes, 3);
  perform emitir_cotizacion(v_q_negociando);
  perform cambiar_estado_cotizacion(v_q_negociando, 'negotiation', 'Pide bajar el alcance');

  -- Vencida: su plazo pasó y se marcó.
  insert into quotes (organization_id, legal_entity_id, brand_id, client_id, number,
    currency_code, tax_rate_pct, tax_label, valid_until, created_at)
  values (v_org, v_pe, v_marca_pe, v_cli_nova, next_quote_number(v_pe), 'PEN', 18, 'IGV',
    current_date - 10, now() - interval '60 days')
  returning id into v_q_vencida;
  perform add_quote_line_from_service(v_q_vencida, v_srv_redes, 1);
  perform emitir_cotizacion(v_q_vencida);
  perform cambiar_estado_cotizacion(v_q_vencida, 'expired', 'Se le pasó el plazo');

  -- Rechazada, y en la otra empresa: dos libros, dos monedas.
  insert into quotes (organization_id, legal_entity_id, brand_id, client_id, number,
    currency_code, tax_rate_pct, valid_until, created_at)
  values (v_org, v_us, v_marca_us, v_cli_harbor, next_quote_number(v_us), 'USD', 0,
    current_date + 15, now() - interval '30 days')
  returning id into v_q_rechazada;
  perform add_quote_line_from_service(v_q_rechazada, v_srv_retainer, 1);
  perform emitir_cotizacion(v_q_rechazada);
  perform cambiar_estado_cotizacion(v_q_rechazada, 'rejected', 'Eligió a otra agencia');

  -- Aprobada: la que llega hasta el dinero.
  insert into quotes (organization_id, legal_entity_id, brand_id, client_id, number,
    currency_code, tax_rate_pct, tax_label, valid_until, created_at)
  values (v_org, v_pe, v_marca_pe, v_cli_ej, next_quote_number(v_pe), 'PEN', 18, 'IGV',
    current_date + 30, now() - interval '40 days')
  returning id into v_q_aprobada;
  perform add_quote_line_from_service(v_q_aprobada, v_srv_lanz, 1);
  perform add_quote_line_from_service(v_q_aprobada, v_srv_redes, 2);
  perform emitir_cotizacion(v_q_aprobada, 'Versión final acordada');
  perform cambiar_estado_cotizacion(v_q_aprobada, 'approved', 'Firmada');

  -- Aprobar convirtió cada línea de la versión en un trabajo (INV-14). No se
  -- crean aquí: se buscan, porque crearlos a mano sería saltarse la puerta que
  -- la aplicación usa de verdad.
  select j.id into v_trab_lanz  from jobs j
   where j.quote_id = v_q_aprobada and j.service_id = v_srv_lanz;
  select j.id into v_trab_redes from jobs j
   where j.quote_id = v_q_aprobada and j.service_id = v_srv_redes;

  -- ------------------------------------------------------------- el dinero
  -- El saldo de apertura es un movimiento más (`kind='opening'`), no un campo
  -- aparte: por eso hay una sola fórmula de saldo y no dos cifras que puedan
  -- discrepar (INV-1).
  perform registrar_movimiento(v_bcp, 'in', 18000, 'Saldo de apertura', null, 'opening');
  perform registrar_movimiento(v_chica, 'in', 600, 'Saldo de apertura', null, 'opening');
  perform registrar_movimiento(v_mercury, 'in', 4200, 'Saldo de apertura', null, 'opening');

  -- Mover dinero entre dos cuentas de la MISMA empresa, con su comisión. Las
  -- dos patas quedan fuera del resultado; la comisión no, porque se pagó.
  perform registrar_transferencia(v_bcp, v_chica, 1200, null,
    current_date - 6, 'Reponer la caja chica', 5, v_bcp);

  -- Un gasto con su IGV declarado, sin documento: él es su propio hecho.
  perform registrar_movimiento(v_bcp, 'out', 118, 'Taxis de la semana',
    current_date - 4, 'operating', v_g_servicios, null, null, 100, 18);

  -- Y uno sin desglose: el neto es el importe entero, no se inventa un IGV.
  perform registrar_movimiento(v_chica, 'out', 85, 'Café para la reunión',
    current_date - 3, 'operating', v_g_servicios);

  -- Un cobro que no salda ningún documento también es un hecho por sí mismo.
  perform registrar_movimiento(v_bcp, 'in', 450, 'Trabajo suelto sin factura',
    current_date - 8, 'operating', null, v_cli_nova);

  -- Lo que no es del negocio se ve, pero no se resta del resultado.
  perform registrar_movimiento(v_bcp, 'out', 2500, 'Retiro del dueño',
    current_date - 10, 'owner_draw');

  perform registrar_movimiento(v_mercury, 'out', 12, 'Comisión mensual del banco',
    current_date - 5, 'bank_fee', v_g_servicios);

  -- ---------------------------------------------- facturar y cobrar lo ganado
  -- La primera cuota de la aprobada: documento emitido y cobrado entero.
  select i.id into v_cuota
    from payment_schedule_items i
   where i.quote_id = v_q_aprobada
   order by i.due_date, i.sort
   limit 1;

  if v_cuota is not null then
    select id into v_doc from emitir_documento(v_cuota, 'invoice', 'F001-00000101',
      current_date - 20, current_date - 5);
    perform registrar_cobro(v_doc, v_bcp, (select amount_total from billing_documents where id = v_doc),
      current_date - 4, 'OP-884211');

    -- La segunda: emitida y cobrada a medias, que es el caso que de verdad
    -- se da y el que enseña «cobrado a medias» en la cartera.
    select i.id into v_cuota
      from payment_schedule_items i
     where i.quote_id = v_q_aprobada and i.status = 'planned'
     order by i.due_date, i.sort
     limit 1;

    if v_cuota is not null then
      select id into v_doc from emitir_documento(v_cuota, 'invoice', 'F001-00000102',
        current_date - 12, current_date + 8);
      perform registrar_cobro(v_doc, v_bcp,
        round((select amount_total from billing_documents where id = v_doc) / 2, 2),
        current_date - 2, 'OP-884390');
    end if;
  end if;

  -- --------------------------------------------------------------- compras
  -- Una con IGV: 236 son 200 de gasto y 36 de crédito fiscal.
  perform registrar_compra(v_pe, 'Movistar', 236, 'PEN',
    p_series => 'F001-998877',
    p_description => 'Teléfono e internet de octubre',
    p_issue_date => current_date - 7,
    p_due_date => current_date + 8,
    p_category => v_g_servicios);

  -- Una vencida y sin pagar: es la que tiene que saltar en Inicio.
  select id into v_compra from registrar_compra(v_pe, 'Imprenta Lima', 1180, 'PEN',
    p_series => 'F002-000450',
    p_description => 'Impresión de material para el lanzamiento',
    p_issue_date => current_date - 35,
    p_due_date => current_date - 12,
    p_category => v_g_proveedores,
    p_job => v_trab_lanz);

  -- Una exonerada y pagada a medias.
  select id into v_compra from registrar_compra(v_pe, 'Freelance Video', 800, 'PEN',
    p_tax_rate => 0,
    p_description => 'Edición de dos piezas',
    p_issue_date => current_date - 15,
    p_due_date => current_date + 15,
    p_category => v_g_personal,
    p_job => v_trab_redes);
  perform registrar_pago_de_compra(v_compra, v_bcp, 300, current_date - 1, 'OP-884455');

  -- Y una en la otra empresa, en dólares y pagada entera.
  select id into v_compra from registrar_compra(v_us, 'Adobe', 59.99, 'USD',
    p_tax_rate => 0,
    p_description => 'Creative Cloud de noviembre',
    p_issue_date => current_date - 9,
    p_due_date => current_date - 2,
    p_category => v_g_herramientas);
  perform registrar_pago_de_compra(v_compra, v_mercury, 59.99, current_date - 2);

  -- Un gasto sin factura detrás también es costo de su trabajo. El pago de una
  -- factura NO se atribuye: el hecho es la factura, y la base lo dice con
  -- nombres si alguien lo intenta (`el_pago_no_se_atribuye`).
  perform registrar_movimiento(v_bcp, 'out', 236, 'Pauta de prueba en redes',
    current_date - 11, 'operating', v_g_proveedores, null, null, 200, 36,
    null, v_trab_redes);

  -- ------------------------------------------- lo previsto de una sola vez
  -- Lo que no cabe en una cuota, ni en un gasto fijo, ni en una compra: un
  -- equipo pactado y un adelanto que van a pasar (INV-15.4). Son plan y no
  -- dinero: entran en la proyección y no tocan el saldo.
  select id into v_previsto from guardar_previsto(
    v_pe, 'out', 'Cámara pactada para enero', 3000, 'PEN',
    (current_date + interval '45 days')::date, v_bcp);
  -- Adelantada una parte: la proyección tiene que seguir viendo los 2000 que
  -- faltan, no los 3000 enteros ni cero.
  perform saldar_previsto(v_previsto, v_bcp, 1000, current_date - 2, 'OP-771100');

  perform guardar_previsto(
    v_pe, 'in', 'Adelanto que nos pasa Nova', 1500, 'PEN',
    (current_date + interval '20 days')::date, v_bcp);

  -- ----------------------------------------------------------- gastos fijos
  perform guardar_gasto_recurrente(v_us, 'Adobe Creative Cloud', 59.99, 'USD',
    p_cadence => 'monthly', p_starts_on => (current_date - interval '6 months')::date,
    p_day => 5, p_account => v_mercury, p_category => v_g_herramientas,
    p_notes => 'Se renueva solo el día 5');
  perform guardar_gasto_recurrente(v_pe, 'Hosting y dominios', 145, 'PEN',
    p_cadence => 'monthly', p_starts_on => (current_date - interval '1 year')::date,
    p_day => 12, p_account => v_bcp, p_category => v_g_herramientas);
  perform guardar_gasto_recurrente(v_pe, 'Contador', 450, 'PEN',
    p_cadence => 'monthly', p_starts_on => (current_date - interval '2 years')::date,
    p_day => 28, p_account => v_bcp, p_category => v_g_servicios);
  perform guardar_gasto_recurrente(v_pe, 'Dominio .pe', 240, 'PEN',
    p_cadence => 'yearly', p_starts_on => (current_date - interval '3 years')::date,
    p_day => 3, p_account => v_bcp, p_category => v_g_herramientas);

  raise notice 'Margen Demo lista: organización %', v_org;
end $demo$;
