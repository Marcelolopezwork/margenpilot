-- ---------------------------------------------------------------------------
-- Margen Pilot · F3-4 · Una transferencia no es un ingreso ni un gasto
-- ---------------------------------------------------------------------------
--
-- Sin esto, mover 1.000 de una cuenta a otra se anota como dos movimientos
-- sueltos: una salida y una entrada. El saldo de cada cuenta queda bien —INV-1
-- se cumple— y el lente Resultado queda mintiendo: un mes en el que no pasó
-- nada enseña 1.000 de ingreso y 1.000 de gasto. Peor todavía, el margen por
-- cliente se calcula sobre un ingreso que no vino de ningún cliente.
--
-- Lo que impide eso no es un filtro en la pantalla: es que las dos patas se
-- reconozcan como las dos mitades de un mismo hecho. De ahí la cabecera
-- (`transfers`) y el `transfer_id` en cada pata, y de ahí que `kind` sea
-- `transfer`, que la columna generada `flow_class` convierte en
-- `internal_transfer`, excluido del lente por definición de la vista y no por
-- un `where` que alguien pueda olvidar (INV-5).
--
-- Cuatro decisiones que esta migración toma, y por qué:
--
-- 1. **La tasa no se teclea: se calcula.** `fx_rate` es una columna generada,
--    monto destino ÷ monto origen. Una tasa escrita a mano es un deseo; esta
--    es la que aplicó el banco de verdad. El margen que el banco se quedó
--    entre su tasa publicada y esta se queda dentro de la cifra, que es lo
--    honesto: no sabemos cómo lo repartió, y no vamos a inventarlo.
--
-- 2. **En la misma moneda, lo que sale es lo que llega.** Si salieron 1.000 y
--    llegaron 970 soles, no hay ninguna tasa de 0,97 que explique eso: faltan
--    30 de comisión. Se anotan como comisión, que además es un gasto de
--    verdad (`bank_fee` → `operating`), y así los 30 aparecen en el resultado
--    en vez de desaparecer dentro de una tasa falsa.
--
-- 3. **Entre dos empresas no hay transferencia.** Mover dinero de Mercury (The
--    Publisher) a BCP (3 Brothers) saca dinero del libro de una y lo mete en
--    el de la otra. Eso no es un traslado interno: es un préstamo, un aporte o
--    una venta con su factura, y son dos hechos económicos, uno en cada libro,
--    cada uno con su motivo. Llamarlo transferencia escondería el flujo entre
--    empresas justo en el lente que existe para verlo (ADR-16, INV-11).
--
-- 4. **Anular media transferencia crea dinero.** Si se anula solo la salida,
--    la entrada sigue viva y aparecieron 1.000 de la nada. `anular_movimiento`
--    anula la transferencia entera, y un disparador diferido lo comprueba al
--    cerrar la transacción: o están todas las patas, o no está ninguna.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- La cabecera
-- ---------------------------------------------------------------------------
--
-- Las dos claves compuestas a `cash_accounts` hacen cuatro trabajos a la vez,
-- sin un solo disparador: las cuentas existen, son las dos de la misma
-- organización, son las dos de la misma empresa, y la moneda declarada de
-- cada lado es la de su cuenta. Lo demás son `check` que se leen solos.

create table transfers (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  legal_entity_id uuid not null,

  from_account_id uuid not null,
  to_account_id   uuid not null,
  currency_from   char(3) not null references currencies (code),
  currency_to     char(3) not null references currencies (code),
  amount_from     numeric(18, 2) not null check (amount_from > 0),
  amount_to       numeric(18, 2) not null check (amount_to > 0),

  -- La tasa efectivamente aplicada (INV-5). Nadie la escribe, así que nadie
  -- puede escribirla mal. En la misma moneda sale 1 sin ningún caso especial.
  -- `numeric` sin precisión a propósito: acotarla solo serviría para que una
  -- transferencia legítima entre monedas muy dispares fallara al guardarse.
  fx_rate         numeric generated always as (round(amount_to / amount_from, 10)) stored,

  -- La comisión, si la hubo, y de qué cuenta la cobró el banco. Va aquí
  -- además de su movimiento porque es parte de lo que pasó, y el movimiento
  -- solo sabe que salió dinero.
  fee_amount      numeric(18, 2) check (fee_amount > 0),
  fee_account_id  uuid,

  value_date      date not null,
  description     text not null check (btrim(description) <> ''),
  external_ref    text,
  created_by      uuid not null default auth.uid(),
  created_at      timestamptz not null default now(),

  constraint cuentas_distintas check (from_account_id <> to_account_id),

  -- Decisión 2, hecha estructura.
  constraint misma_moneda_mismo_importe
    check (currency_from <> currency_to or amount_from = amount_to),

  -- Una comisión sin cuenta no se puede cobrar de ningún sitio, y una cuenta
  -- sin importe no cobra nada: o las dos cosas o ninguna.
  constraint comision_entera check ((fee_amount is null) = (fee_account_id is null)),
  constraint comision_de_una_de_las_dos
    check (fee_account_id is null or fee_account_id in (from_account_id, to_account_id)),

  foreign key (legal_entity_id, organization_id)
    references legal_entities (id, organization_id) on delete cascade,
  foreign key (from_account_id, organization_id, legal_entity_id, currency_from)
    references cash_accounts (id, organization_id, legal_entity_id, currency_code),
  foreign key (to_account_id, organization_id, legal_entity_id, currency_to)
    references cash_accounts (id, organization_id, legal_entity_id, currency_code),

  constraint transfers_id_org_entidad_key unique (id, organization_id, legal_entity_id)
);

create index transfers_fecha_idx on transfers (organization_id, value_date desc);
create index transfers_cuentas_idx on transfers (organization_id, from_account_id, to_account_id);

create trigger transfers_audit
  after insert or update or delete on transfers
  for each row execute function app.audit_changes();

-- ---------------------------------------------------------------------------
-- Las patas
-- ---------------------------------------------------------------------------
--
-- La clave compuesta lleva la entidad dentro: una pata de otro libro no puede
-- colgar de esta transferencia. Y el `check` cierra el agujero contrario: un
-- movimiento de tipo `transfer` sin cabecera sería una pata huérfana, dinero
-- que sale del resultado sin que nada explique a dónde fue.

alter table cash_movements add column transfer_id uuid;

alter table cash_movements
  add constraint cash_movements_transfer_fkey
  foreign key (transfer_id, organization_id, legal_entity_id)
  references transfers (id, organization_id, legal_entity_id);

alter table cash_movements
  add constraint pata_sin_transferencia
  check (kind <> 'transfer' or transfer_id is not null);

create index cash_movements_transfer_idx
  on cash_movements (transfer_id) where transfer_id is not null;

-- ---------------------------------------------------------------------------
-- O están todas las patas, o no está ninguna (INV-5)
-- ---------------------------------------------------------------------------
--
-- Diferido hasta el commit porque una transferencia pasa por estados
-- intermedios que no cuadran: cuando se inserta la cabecera no tiene patas, y
-- cuando se inserta la salida todavía no hay entrada. Lo que tiene que cuadrar
-- es el final de la transacción.
--
-- El estado vacío es legítimo: es una transferencia anulada entera. Lo que no
-- existe es media.

create or replace function app.la_transferencia_cuadra() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_id     uuid;
  v_t      record;
  v_salen  int;
  v_entran int;
  v_comis  int;
  v_vivas  int;
  v_debe   int;
begin
  -- Un `if` y no un `case` en una sola expresión: PL/pgSQL prepara la
  -- expresión entera contra el `new` real, así que mencionar `new.transfer_id`
  -- cuando el disparador es el de `transfers` falla aunque esa rama no se
  -- ejecute. Con dos sentencias, cada una se prepara solo si se usa.
  if tg_table_name = 'transfers' then
    v_id := new.id;
  else
    v_id := new.transfer_id;
  end if;
  if v_id is null then return null; end if;

  select t.* into v_t from transfers t where t.id = v_id;
  if v_t.id is null then return null; end if;

  select
    count(*) filter (where m.direction = 'out' and m.kind = 'transfer'
                       and m.cash_account_id = v_t.from_account_id
                       and m.amount = v_t.amount_from),
    count(*) filter (where m.direction = 'in' and m.kind = 'transfer'
                       and m.cash_account_id = v_t.to_account_id
                       and m.amount = v_t.amount_to),
    count(*) filter (where m.kind = 'bank_fee'),
    count(*)
    into v_salen, v_entran, v_comis, v_vivas
    from cash_movements m
   where m.transfer_id = v_id and not m.is_void;

  if v_vivas = 0 then return null; end if;

  v_debe := 2 + case when v_t.fee_amount is null then 0 else 1 end;

  if v_salen <> 1 or v_entran <> 1
     or v_comis <> (case when v_t.fee_amount is null then 0 else 1 end)
     or v_vivas <> v_debe then
    raise exception
      'transferencia_descuadrada: una transferencia son dos patas atadas —la salida y la entrada— más la comisión si la hubo. Esta tiene % salida(s), % entrada(s) y % comisión(es) sobre % movimiento(s) vivo(s), y debería tener %. Anular media transferencia crearía dinero: se anula entera',
      v_salen, v_entran, v_comis, v_vivas, v_debe;
  end if;

  return null;
end $fn$;

create constraint trigger transfers_cuadra
  after insert or update on transfers
  deferrable initially deferred
  for each row execute function app.la_transferencia_cuadra();

create constraint trigger cash_movements_transferencia_cuadra
  after insert or update on cash_movements
  deferrable initially deferred
  for each row when (new.transfer_id is not null)
  execute function app.la_transferencia_cuadra();

-- ---------------------------------------------------------------------------
-- Permisos · se lee, no se escribe
-- ---------------------------------------------------------------------------

grant select on transfers to authenticated;

alter table transfers enable row level security;
alter table transfers force  row level security;

create policy transfers_select on transfers for select
  using (organization_id in (select app.current_orgs())
         and app.can_write_money(organization_id));

-- ---------------------------------------------------------------------------
-- La puerta · registrar una transferencia
-- ---------------------------------------------------------------------------
--
-- Una sola llamada escribe la cabecera y sus dos o tres patas. No se parte en
-- «crea la cabecera» y «añade las patas» porque entre las dos llamadas
-- existiría una transferencia a medias, y esa es exactamente la fila que el
-- disparador de arriba declara imposible.
--
-- Las patas se insertan aquí y no llamando a `registrar_movimiento` porque esa
-- función no acepta `transfer_id`, y no debe: si lo aceptara, cualquiera
-- podría colgar una pata de una transferencia ajena. Lo que mantiene a las dos
-- honestas es el `check` de arriba, que impide un `transfer` sin cabecera por
-- cualquier camino.
--
-- Cada rechazo lleva los nombres propios dentro. La restricción estructural
-- impide; la puerta explica.

create or replace function registrar_transferencia(
  p_from         uuid,
  p_to           uuid,
  p_amount_from  numeric,
  p_amount_to    numeric default null,
  p_value_date   date default null,
  p_description  text default null,
  p_fee          numeric default null,
  p_fee_account  uuid default null,
  p_external_ref text default null
) returns setof transfers
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_o     record;
  v_d     record;
  v_cf    record;
  -- El id aparte, y no `v_cf.id` dentro del insert: la estructura de un
  -- `record` sin asignar es indeterminada, así que PL/pgSQL falla al preparar
  -- la sentencia aunque la rama del `case` no se llegue a ejecutar.
  v_cf_id uuid;
  v_nom_o text;
  v_nom_d text;
  v_de    int;
  v_da    int;
  v_dc    int;
  v_sale  numeric;
  v_llega numeric;
  v_com   numeric;
  v_fecha date;
  v_texto text;
  v_ref   text;
  v_t     uuid;
begin
  select a.* into v_o from cash_accounts a where a.id = p_from;
  select a.* into v_d from cash_accounts a where a.id = p_to;

  if v_o.id is null or v_d.id is null then
    raise exception 'cuenta_no_encontrada: una de las dos cuentas no existe';
  end if;

  if v_o.organization_id <> v_d.organization_id
     or not app.can_write_money(v_o.organization_id) then
    raise exception 'cuenta_no_encontrada: esa cuenta no existe o no es de tu organización';
  end if;

  if p_from = p_to then
    raise exception
      'cuentas_iguales: una transferencia va de una cuenta a otra. Mover dinero dentro de la misma no mueve nada: dos patas en la misma cuenta se anulan y el saldo queda igual';
  end if;

  -- Decisión 3. El mensaje tiene que servir para saber qué hacer en su lugar,
  -- porque lo que el usuario quiere hacer es legítimo: lo que no es, es una
  -- transferencia.
  if v_o.legal_entity_id <> v_d.legal_entity_id then
    select e.legal_name into v_nom_o from legal_entities e where e.id = v_o.legal_entity_id;
    select e.legal_name into v_nom_d from legal_entities e where e.id = v_d.legal_entity_id;
    raise exception
      'transferencia_entre_empresas: % es de % y % es de %. Entre dos empresas no hay traslado interno: el dinero sale del libro de una y entra en el de la otra, así que son dos hechos y cada uno necesita decir qué fue —un préstamo, un aporte del dueño o una venta con su factura—. Anótalos como dos movimientos, uno en cada cuenta, con el tipo que corresponda',
      v_o.name, v_nom_o, v_d.name, v_nom_d;
  end if;

  select c.minor_units into v_de from currencies c where c.code = v_o.currency_code;
  select c.minor_units into v_da from currencies c where c.code = v_d.currency_code;

  v_sale := round(coalesce(p_amount_from, 0), v_de);
  if v_sale <= 0 then
    raise exception 'importe_invalido: el importe va siempre en positivo; el signo lo da la dirección';
  end if;

  if v_o.currency_code = v_d.currency_code then
    v_llega := round(coalesce(p_amount_to, v_sale), v_da);
    if v_llega <> v_sale then
      raise exception
        'misma_moneda_otro_importe: salen % de % y llegan % a %, y las dos cuentas están en %. En la misma moneda no hay ninguna tasa que explique la diferencia: lo que falta es la comisión del banco. Anótala como comisión y así sale en el resultado, que es donde tiene que estar',
        to_char(v_sale, 'FM999999999990.00'), v_o.name,
        to_char(v_llega, 'FM999999999990.00'), v_d.name, v_o.currency_code;
    end if;
  else
    if p_amount_to is null then
      raise exception
        'falta_el_monto_que_llego: % está en % y % en %, así que hace falta decir cuánto llegó de verdad. La tasa no se teclea: se calcula con lo que salió y lo que llegó, y por eso es la que aplicó el banco y no una de referencia',
        v_o.name, v_o.currency_code, v_d.name, v_d.currency_code;
    end if;
    v_llega := round(p_amount_to, v_da);
    if v_llega <= 0 then
      raise exception 'importe_invalido: lo que llega también va en positivo, y algo tuvo que llegar';
    end if;
  end if;

  if coalesce(p_fee, 0) > 0 then
    if p_fee_account is null or p_fee_account = v_o.id then
      select a.* into v_cf from cash_accounts a where a.id = v_o.id;
    elsif p_fee_account = v_d.id then
      select a.* into v_cf from cash_accounts a where a.id = v_d.id;
    else
      raise exception
        'comision_de_otra_cuenta: la comisión la cobra el banco de una de las dos cuentas de la transferencia, no de una tercera';
    end if;

    select c.minor_units into v_dc from currencies c where c.code = v_cf.currency_code;
    v_com := round(p_fee, v_dc);
    if v_com <= 0 then v_com := null; else v_cf_id := v_cf.id; end if;
  end if;

  v_fecha := coalesce(p_value_date, current_date);
  v_ref   := nullif(btrim(coalesce(p_external_ref, '')), '');
  v_texto := btrim(coalesce(p_description, ''));
  if v_texto = '' then
    -- Un concepto automático con los dos nombres dentro es mejor que exigir
    -- uno: dentro de tres meses «Transferencia de Mercury a BCP soles» se
    -- entiende, y es lo que de verdad pasó.
    v_texto := format('Transferencia de %s a %s', v_o.name, v_d.name);
  end if;

  insert into transfers (
    organization_id, legal_entity_id, from_account_id, to_account_id,
    currency_from, currency_to, amount_from, amount_to,
    fee_amount, fee_account_id, value_date, description, external_ref)
  values (
    v_o.organization_id, v_o.legal_entity_id, v_o.id, v_d.id,
    v_o.currency_code, v_d.currency_code, v_sale, v_llega,
    v_com, v_cf_id,
    v_fecha, v_texto, v_ref)
  returning id into v_t;

  insert into cash_movements (
    organization_id, cash_account_id, legal_entity_id, direction, amount,
    currency_code, value_date, kind, description, external_ref,
    counterparty_kind, source, transfer_id)
  values
    (v_o.organization_id, v_o.id, v_o.legal_entity_id, 'out', v_sale,
     v_o.currency_code, v_fecha, 'transfer', v_texto, v_ref,
     'internal', 'manual', v_t),
    (v_d.organization_id, v_d.id, v_d.legal_entity_id, 'in', v_llega,
     v_d.currency_code, v_fecha, 'transfer', v_texto, v_ref,
     'internal', 'manual', v_t);

  if v_com is not null then
    insert into cash_movements (
      organization_id, cash_account_id, legal_entity_id, direction, amount,
      currency_code, value_date, kind, description, external_ref,
      counterparty_kind, source, transfer_id)
    values
      (v_cf.organization_id, v_cf.id, v_cf.legal_entity_id, 'out', v_com,
       v_cf.currency_code, v_fecha, 'bank_fee',
       format('Comisión · %s', v_texto), v_ref, 'internal', 'manual', v_t);
  end if;

  return query select * from transfers where id = v_t;
end $fn$;

comment on function registrar_transferencia(uuid, uuid, numeric, numeric, date, text, numeric, uuid, text) is
  'Mueve dinero entre dos cuentas de la misma empresa: escribe la cabecera y sus dos o tres patas en una sola transacción. La tasa aplicada se calcula, no se teclea (INV-5).';

revoke all on function registrar_transferencia(uuid, uuid, numeric, numeric, date, text, numeric, uuid, text) from public, anon;
grant execute on function registrar_transferencia(uuid, uuid, numeric, numeric, date, text, numeric, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Anular · la transferencia se anula entera
-- ---------------------------------------------------------------------------
--
-- Misma firma que antes, para que el build que ya está publicado siga
-- llamándola igual. Lo que cambia es que, si el movimiento es una pata, el
-- motivo se escribe en todas: anular solo la salida dejaría la entrada viva y
-- habrían aparecido 1.000 de la nada. El disparador diferido lo impediría de
-- todas formas; esto hace que el usuario no tenga que enterarse por un error.

create or replace function anular_movimiento(p_movement uuid, p_motivo text)
returns setof cash_movements
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_mov record;
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

  if v_mov.transfer_id is not null then
    update cash_movements
       set is_void = true, void_reason = btrim(p_motivo)
     where transfer_id = v_mov.transfer_id and not is_void;
    return query
      select * from cash_movements
       where transfer_id = v_mov.transfer_id
       order by direction desc, kind;
  end if;

  update cash_movements
     set is_void = true, void_reason = btrim(p_motivo)
   where id = p_movement;

  return query select * from cash_movements where id = p_movement;
end $fn$;

comment on function anular_movimiento(uuid, text) is
  'Marca un movimiento como anulado con motivo. No borra: el saldo se corrige y el documento vuelve a abrirse (INV-7). Si es una pata de una transferencia, anula la transferencia entera (INV-5).';

-- ---------------------------------------------------------------------------
-- Una pata de transferencia no salda una factura
-- ---------------------------------------------------------------------------
--
-- Faltaba, y es el mismo error con otra cara: asignar a una factura el dinero
-- que entró de tu propia cuenta la daría por cobrada con dinero que nunca vino
-- del cliente. El cobro seguiría pendiente y el sistema diría que no.
--
-- Va dentro del disparador que ya vigila los topes porque es la misma
-- pregunta: una asignación no puede decir algo que no pasó.

create or replace function app.respeta_los_topes() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_tope     numeric;
  v_asignado numeric;
  v_kind     cash_kind;
begin
  select m.amount, m.kind into v_tope, v_kind
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
end $fn$;
