-- ===========================================================================
-- UN SOLO ARCHIVO para pegar en Supabase → SQL Editor y pulsar Run.
--
-- Generado por supabase/seed/armar.sh. No se edita a mano.
--
-- Hace tres cosas, en este orden y en una sola pasada:
--
--  1. aplica la migración de «cuánto deja cada trabajo» (F5), que es la única
--     que falta en el proyecto, y la deja apuntada en el historial de
--     migraciones para que no se vuelva a aplicar;
--  2. borra la organización «Margen Demo» si existe de una pasada anterior.
--     Los trabajos nacen al aprobar una cotización, así que una demo creada
--     antes de esta migración no tiene ninguno y la pantalla nueva saldría
--     vacía. Esto NO toca «Margen Pilot»: borra una sola fila, la de la demo,
--     y lo demás cae por cascada;
--  3. vuelve a crear «Margen Demo» con datos de prueba en todo, ahora con sus
--     trabajos y con dos compras atribuidas.
--
-- Para quitar la demo después, sin volver a crearla: borrar-demo.sql.
-- ===========================================================================

-- ============================================================================
-- Margen Pilot · F5 · Cuánto deja cada trabajo
--
-- Es la pregunta con la que empezó el producto y la única grande que faltaba.
-- Hoy el margen existe en dos sitios y ninguno sirve para decidir: al abrir
-- una cotización se ve el margen de **esa propuesta** (lo que prometía), y en
-- Análisis el resultado del **mes entero** (lo que pasó con todo junto). Lo
-- que no había es el del medio: «la campaña de lanzamiento me dejó esto y la
-- gestión de redes esto otro».
--
-- ---------------------------------------------------------------------------
-- INV-14 — Un trabajo es una línea aprobada, y el dinero se le atribuye
-- ---------------------------------------------------------------------------
--
-- 1. **Un trabajo nace de una línea aprobada.** Al aprobar una cotización,
--    cada línea de la versión vigente se convierte en un trabajo. Así
--    «cuánto deja la campaña» tiene sujeto antes de que llegue la primera
--    factura, y no depende de que alguien se acuerde de crear nada.
--
-- 2. **El trabajo guarda la foto del día que se aprobó.** `price_net` es el
--    neto de su línea en la versión aceptada y `expected_cost` el costo que
--    estaba estimado en ese momento, con la misma aritmética que usó
--    `emitir_cotizacion`. Ninguno de los dos se edita después: la frase
--    «cotizaste 40 % y te quedó 22 %» exige que el 40 % no se mueva.
--
-- 3. **El ingreso del trabajo se deriva; no se atribuye.** Una cotización de
--    tres líneas se factura con un documento por cuota, y ese documento no es
--    de una línea: es de la cotización. Pero el reparto entre líneas ya está
--    decidido y escrito —cada línea tiene su neto en la versión—, así que la
--    parte del trabajo es `price_net / quote_net` de lo facturado. Al derivarlo
--    no hay nada que se pueda atribuir mal, y nada que se desincronice.
--
-- 4. **El costo del trabajo sí se atribuye a mano**, porque no hay nada de
--    donde derivarlo: ninguna factura de proveedor sabe para qué trabajo era.
--    Por eso `job_id` existe en las compras y en los gastos, y **no** en las
--    ventas: una venta ya tiene su parte calculada y atribuirla además sería
--    contarla dos veces.
--
-- 5. **El margen se calcula sobre netos de los dos lados.** El IGV que cobras
--    no es tuyo y el que pagas es crédito fiscal (INV-12.2). Un margen
--    calculado sobre totales se equivoca en los dos sentidos a la vez.
--
-- 6. **Es margen de lo facturado, no de lo cobrado** (INV-6): el hecho es el
--    documento. Un trabajo puede tener 45 % de margen y cero en el banco, y
--    las dos cosas son verdad al mismo tiempo. Para la segunda está la caja.
--
-- 7. **Dos monedas no se suman** (INV-10). El lente devuelve una fila por
--    trabajo y moneda. Un costo en dólares de un trabajo en soles se enseña
--    aparte y sin convertir: convertirlo en silencio sería inventar un margen
--    que depende del día.
--
-- 8. **Este lente no es el resultado del mes y no lo alimenta.** El reparto
--    por línea redondea, así que los céntimos de los trabajos de una
--    cotización pueden no sumar exactamente su documento. El resultado del
--    periodo sigue saliendo de `economic_facts` sin pasar por aquí, que es
--    donde los céntimos tienen que cuadrar.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- La tabla
-- ---------------------------------------------------------------------------

create table jobs (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations (id) on delete cascade,
  legal_entity_id  uuid not null,
  quote_id         uuid not null,
  quote_version_id uuid not null,
  -- La línea de la que nació. Nulo solo si la versión es tan antigua que su
  -- snapshot no llevaba el id de la línea.
  quote_line_id    uuid,
  service_id       uuid,
  client_id        uuid not null,
  name             text not null check (btrim(name) <> ''),
  currency_code    char(3) not null references currencies (code),

  -- La foto del día que se aprobó (INV-14.2).
  price_net        numeric(18, 2) not null check (price_net >= 0),
  quote_net        numeric(18, 2) not null check (quote_net >= 0),
  expected_cost    numeric(18, 2) not null default 0 check (expected_cost >= 0),

  status           text not null default 'open'
                     check (status in ('open', 'done', 'cancelled')),
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- La línea no puede valer más que la cotización entera de la que es parte.
  constraint la_linea_cabe_en_la_cotizacion check (price_net <= quote_net),

  foreign key (legal_entity_id, organization_id)
    references legal_entities (id, organization_id) on delete cascade,
  foreign key (quote_id, organization_id)
    references quotes (id, organization_id) on delete cascade,
  foreign key (quote_version_id, organization_id)
    references quote_versions (id, organization_id),
  foreign key (quote_line_id, organization_id)
    references quote_lines (id, organization_id),
  foreign key (service_id, organization_id)
    references services (id, organization_id),
  foreign key (client_id, organization_id)
    references clients (id, organization_id),

  unique (id, organization_id),
  -- Esta es la clave que impone INV-11 en la atribución: un documento de otra
  -- empresa no tiene cómo apuntar a este trabajo (ADR-16).
  constraint jobs_id_org_entidad_key unique (id, organization_id, legal_entity_id)
);

-- Una línea aprobada es un trabajo, no dos. Aprobar, renegociar y volver a
-- aprobar no duplica nada.
create unique index trabajo_por_linea on jobs (quote_line_id)
  where quote_line_id is not null;

create index jobs_cotizacion_idx on jobs (organization_id, quote_id);
create index jobs_servicio_idx   on jobs (organization_id, service_id)
  where service_id is not null;
create index jobs_abiertos_idx   on jobs (organization_id, legal_entity_id, status);

create trigger jobs_touch before update on jobs
  for each row execute function app.touch_updated_at();
create trigger jobs_audit
  after insert or update or delete on jobs
  for each row execute function app.audit_changes();

comment on table jobs is
  'Un trabajo vendido: una línea de la versión que el cliente aceptó, con el precio y el costo estimado congelados el día de la aprobación (INV-14).';
comment on column jobs.price_net is
  'Neto de esta línea en la versión aceptada. No se edita: es el denominador de «cotizaste tanto».';
comment on column jobs.quote_net is
  'Neto de la versión entera. Con price_net da la parte de este trabajo en lo que se facture (INV-14.3).';

grant select on jobs to authenticated;

alter table jobs enable row level security;
alter table jobs force  row level security;

-- Un trabajo lleva el costo estimado dentro, así que se lee con el mismo
-- permiso que los costos de una versión: el rol comercial cotiza y aprueba,
-- pero el margen no es suyo (ADR-34).
create policy jobs_select on jobs for select
  using (organization_id in (select app.current_orgs())
         and app.can_see_costs(organization_id));

-- Sin insert ni update para `authenticated`: los crea la aprobación y los
-- cambia `actualizar_trabajo`, que deja el precio en paz.

-- ---------------------------------------------------------------------------
-- La atribución
-- ---------------------------------------------------------------------------

alter table billing_documents add column job_id uuid;

-- INV-14.4: solo las compras. Una venta ya tiene su parte derivada.
alter table billing_documents
  add constraint el_trabajo_solo_en_las_compras
  check (job_id is null or direction = 'purchase');

alter table billing_documents
  add constraint billing_documents_trabajo_fkey
  foreign key (job_id, organization_id, legal_entity_id)
  references jobs (id, organization_id, legal_entity_id);

create index billing_documents_trabajo_idx
  on billing_documents (organization_id, job_id) where job_id is not null;

alter table cash_movements add column job_id uuid;

-- Un gasto, nunca una entrada: el ingreso del trabajo es el derivado y una
-- entrada atribuida lo contaría por segunda vez. Y nunca una pata de
-- transferencia ni una apertura, que no son hechos económicos (INV-5).
alter table cash_movements
  add constraint el_trabajo_solo_en_los_gastos
  check (job_id is null
         or (direction = 'out' and kind not in ('transfer', 'opening')));

alter table cash_movements
  add constraint cash_movements_trabajo_fkey
  foreign key (job_id, organization_id, legal_entity_id)
  references jobs (id, organization_id, legal_entity_id);

create index cash_movements_trabajo_idx
  on cash_movements (organization_id, job_id) where job_id is not null;

-- ---------------------------------------------------------------------------
-- El hecho económico, ahora con el trabajo al que se atribuyó
-- ---------------------------------------------------------------------------
--
-- Tercera vez que se recrea la vista, y por el mismo motivo que las dos
-- anteriores: `create or replace view` solo deja añadir columnas al final, y
-- `job_id` se entiende al lado de las otras dos contrapartes.

drop view economic_facts;

create view economic_facts with (security_invoker = true) as

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
       d.job_id,
       coalesce(nullif(btrim(d.description), ''),
                nullif(btrim(d.series_number), ''),
                case when d.direction = 'sale'
                     then 'Documento sin número'
                     else 'Compra sin número' end)          as concepto
  from billing_documents d
 where d.status <> 'void'
   and not d.is_opening

union all

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
       coalesce(m.amount_net, m.amount),
       coalesce(m.amount_tax, 0),
       m.category_id,
       m.client_id,
       m.supplier_id,
       m.job_id,
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
-- El lente: cuánto deja cada trabajo
-- ---------------------------------------------------------------------------
--
-- Una fila por trabajo y moneda (INV-14.7). Devuelve sumas y cuentas, no
-- porcentajes: el margen de un conjunto es Σutilidad / Σneto y eso ya está
-- escrito y probado una vez, en `aggregateMarginPercent`. Dos definiciones
-- del mismo porcentaje es como se termina enseñando dos cifras distintas.

create view job_margins with (security_invoker = true) as
with facturado as (
  -- La parte de este trabajo en lo que se facturó de su cotización (INV-14.3).
  -- Se suman primero los documentos y se reparte después, para que el reparto
  -- redondee una vez y no una por factura.
  select j.id                as job_id,
         j.organization_id,
         j.legal_entity_id,
         d.currency_code,
         'in'::text          as lado,
         round(sum(d.amount_net) * j.price_net / nullif(j.quote_net, 0),
               c.minor_units) as neto,
         count(*)::int        as cuantos
    from jobs j
    join quote_versions v
      on v.quote_id = j.quote_id
     and v.organization_id = j.organization_id
    join billing_documents d
      on d.quote_version_id = v.id
     and d.organization_id = j.organization_id
    join currencies c on c.code = d.currency_code
   where d.direction = 'sale'
     and d.status <> 'void'
     and not d.is_opening
   group by j.id, j.organization_id, j.legal_entity_id, d.currency_code,
            j.price_net, j.quote_net, c.minor_units
),
gastado as (
  -- Y lo que se le atribuyó, por INV-6: la factura de compra cuando hay
  -- factura, y el movimiento cuando el movimiento es el hecho. Un pago que
  -- salda una factura ya atribuida no entra aquí, porque la vista lo excluye.
  select f.job_id,
         f.organization_id,
         f.legal_entity_id,
         f.currency_code,
         'out'::text   as lado,
         sum(f.amount_net) as neto,
         count(*)::int  as cuantos
    from economic_facts f
   where f.job_id is not null
     and f.direction = 'out'
   group by 1, 2, 3, 4
)
select organization_id,
       legal_entity_id,
       job_id,
       currency_code,
       sum(case when lado = 'in'  then neto    else 0 end) as ingreso_neto,
       sum(case when lado = 'out' then neto    else 0 end) as costo_neto,
       sum(case when lado = 'in'  then cuantos else 0 end) as documentos,
       sum(case when lado = 'out' then cuantos else 0 end) as costos
  from (select * from facturado union all select * from gastado) as partes
 group by 1, 2, 3, 4;

comment on view job_margins is
  'Cuánto deja cada trabajo, por moneda: su parte de lo facturado menos lo que se le atribuyó, los dos en neto (INV-14). Sin porcentajes a propósito: el margen de un conjunto se calcula una sola vez, en el cliente.';

grant select on job_margins to authenticated;

-- ---------------------------------------------------------------------------
-- Crear los trabajos al aprobar
-- ---------------------------------------------------------------------------
--
-- Igual que el cronograma: lo que tiene que pasar siempre no puede depender
-- de que la pantalla se acuerde. Se lee del snapshot de la versión y no de
-- las líneas vivas, porque lo que se vendió es lo que el cliente aceptó, no
-- lo que la cotización diga mañana.

create or replace function app.crear_trabajos(p_quote uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_q     record;
  v_vid   uuid;
  v_snap  jsonb;
  v_neto  numeric;
  v_dec   int;
  v_linea jsonb;
  v_id    uuid;
  v_cant  numeric;
  v_costo numeric;
begin
  -- Idempotente: aprobar, renegociar y volver a aprobar no rehace nada. Los
  -- trabajos ya pueden tener costos atribuidos, y rehacerlos los perdería.
  if exists (select 1 from jobs where quote_id = p_quote) then
    return;
  end if;

  select q.organization_id, q.legal_entity_id, q.currency_code, q.client_id
    into v_q
    from quotes q where q.id = p_quote;

  select qv.id, qv.snapshot, (qv.totals->>'neto')::numeric
    into v_vid, v_snap, v_neto
    from quote_versions qv
   where qv.quote_id = p_quote
   order by qv.version_no desc
   limit 1;

  -- Sin versión no hay nada que partir, y no debería pasar: a «aprobada» solo
  -- se llega desde «enviada» o «en negociación», y a las dos se llega
  -- emitiendo. Si pasa, aprobar no es el momento de quejarse.
  if v_vid is null or v_neto is null then
    return;
  end if;

  select c.minor_units into v_dec from currencies c where c.code = v_q.currency_code;

  for v_linea in
    select e.valor from jsonb_array_elements(coalesce(v_snap->'lineas', '[]'::jsonb)) as e(valor)
  loop
    v_id   := nullif(v_linea->>'id', '')::uuid;
    v_cant := coalesce((v_linea->>'cantidad')::numeric, 1);

    -- El costo estimado de la línea, con la misma aritmética que usó
    -- `emitir_cotizacion`: cada componente redondeado, sumados, y el total
    -- por la cantidad de la línea. Si cambia una, tiene que cambiar la otra.
    select round(coalesce(sum(round(round(qlc.unit_cost, v_dec) * qlc.quantity, v_dec)), 0) * v_cant,
                 v_dec)
      into v_costo
      from quote_line_costs qlc
     where qlc.quote_line_id = v_id and qlc.is_active;

    insert into jobs (
      organization_id, legal_entity_id, quote_id, quote_version_id,
      quote_line_id, service_id, client_id, name, currency_code,
      price_net, quote_net, expected_cost)
    select v_q.organization_id, v_q.legal_entity_id, p_quote, v_vid,
           v_id,
           (select ql.service_id from quote_lines ql where ql.id = v_id),
           v_q.client_id,
           coalesce(nullif(btrim(v_linea->>'descripcion'), ''), 'Trabajo sin nombre'),
           v_q.currency_code,
           round(coalesce((v_linea->>'neto')::numeric, 0), v_dec),
           round(v_neto, v_dec),
           coalesce(v_costo, 0)
    on conflict do nothing;
  end loop;
end $fn$;

revoke all on function app.crear_trabajos(uuid) from public, anon;

-- El disparador de estados gana una línea, por el mismo motivo por el que ya
-- creaba el cronograma.

create or replace function app.anota_cambio_de_estado() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_motivo text := nullif(btrim(coalesce(current_setting('app.motivo_de_cambio', true), '')), '');
  v_accion text := nullif(btrim(coalesce(current_setting('app.accion_de_cambio', true), '')), '');
begin
  if new.status = old.status then
    return new;
  end if;

  if not app.transicion_de_cotizacion(old.status, new.status) then
    raise exception 'transicion_invalida: una cotización en «%» no puede pasar a «%»',
      old.status, new.status;
  end if;

  -- Anular es definitivo y conserva todo (§8.9). Sin motivo, dentro de un mes
  -- nadie sabe por qué se anuló, y eso es justo lo que la bitácora evita.
  if new.status = 'void' and v_motivo is null then
    raise exception 'motivo_requerido: para anular una cotización hay que decir por qué';
  end if;

  insert into quote_events (organization_id, quote_id, actor_id, from_status, to_status, action, note)
  values (new.organization_id, new.id, auth.uid(), old.status, new.status,
          coalesce(v_accion, 'status'), v_motivo);

  if new.status = 'approved' then
    perform app.cronograma_por_defecto(new.id);
    perform app.crear_trabajos(new.id);
  end if;

  perform set_config('app.motivo_de_cambio', '', true);
  perform set_config('app.accion_de_cambio', '', true);
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Puerta · atribuir una compra a un trabajo
-- ---------------------------------------------------------------------------
--
-- `authenticated` no tiene UPDATE en `billing_documents` ni en
-- `cash_movements`, y así se queda. Atribuir pasa por aquí, con un trabajo
-- nulo para desatribuir.

create or replace function app.comprueba_el_trabajo(
  p_job    uuid,
  p_org    uuid,
  p_entity uuid
) returns void
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_job  record;
  v_suya text;
  v_mia  text;
begin
  select j.id, j.name, j.legal_entity_id into v_job
    from jobs j where j.id = p_job and j.organization_id = p_org;

  if v_job.id is null then
    raise exception 'trabajo_no_encontrado: ese trabajo no existe o no es de tu organización';
  end if;

  if v_job.legal_entity_id <> p_entity then
    select e.legal_name into v_suya from legal_entities e where e.id = v_job.legal_entity_id;
    select e.legal_name into v_mia  from legal_entities e where e.id = p_entity;
    raise exception
      'trabajo_de_otra_empresa: «%» es un trabajo de % y esto es de %. El dinero no cruza de una empresa a otra: el costo de un trabajo de % tiene que anotarse en %',
      v_job.name, v_suya, v_mia, v_suya, v_suya;
  end if;
end $fn$;

revoke all on function app.comprueba_el_trabajo(uuid, uuid, uuid) from public, anon;

create or replace function atribuir_compra(p_document uuid, p_job uuid default null)
returns setof billing_documents
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_doc record;
begin
  select d.* into v_doc from billing_documents d where d.id = p_document for update;

  if v_doc.id is null or not app.can_write_money(v_doc.organization_id) then
    raise exception 'documento_no_encontrado: ese documento no existe o no es de tu organización';
  end if;

  if v_doc.direction <> 'purchase' then
    raise exception
      'no_es_una_compra: a un trabajo se le atribuye lo que costó, no lo que se vendió. Lo que se vendió ya tiene su parte calculada desde la línea que se aprobó';
  end if;

  if v_doc.status = 'void' then
    raise exception 'documento_ya_anulado: esta compra está anulada; no cuenta en ningún trabajo';
  end if;

  if p_job is not null then
    perform app.comprueba_el_trabajo(p_job, v_doc.organization_id, v_doc.legal_entity_id);
  end if;

  update billing_documents set job_id = p_job where id = p_document;

  return query select * from billing_documents where id = p_document;
end $fn$;

comment on function atribuir_compra(uuid, uuid) is
  'Dice para qué trabajo era una factura de proveedor. Con p_job nulo, la desatribuye (F5).';

revoke all on function atribuir_compra(uuid, uuid) from public, anon;
grant execute on function atribuir_compra(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Puerta · atribuir un gasto suelto a un trabajo
-- ---------------------------------------------------------------------------

create or replace function atribuir_gasto(p_movement uuid, p_job uuid default null)
returns setof cash_movements
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_mov  record;
  v_otra text;
begin
  select m.* into v_mov from cash_movements m where m.id = p_movement for update;

  if v_mov.id is null or not app.can_write_money(v_mov.organization_id) then
    raise exception 'movimiento_no_encontrado: ese movimiento no existe o no es de tu organización';
  end if;

  if v_mov.is_void then
    raise exception 'movimiento_ya_anulado: ese movimiento está anulado; no cuenta en ningún trabajo';
  end if;

  if v_mov.direction <> 'out' then
    raise exception
      'no_es_un_gasto: a un trabajo se le atribuye lo que costó. Una entrada de dinero no, porque el ingreso del trabajo sale de la línea que se aprobó y contarla además sería contarla dos veces';
  end if;

  if v_mov.kind in ('transfer', 'opening') then
    raise exception
      'no_es_un_gasto: mover dinero entre tus cuentas o anotar un saldo inicial no es un costo de ningún trabajo (INV-5)';
  end if;

  -- Un pago que salda una factura no es el hecho económico: la factura lo es
  -- (INV-6). Atribuir el pago no sumaría nada, y dejaría al usuario creyendo
  -- que ya lo hizo.
  if p_job is not null then
    select coalesce(nullif(btrim(d.description), ''),
                    nullif(btrim(d.series_number), ''),
                    to_char(d.issue_date, 'DD/MM/YYYY'))
      into v_otra
      from payment_allocations a
      join billing_documents d on d.id = a.billing_document_id
     where a.cash_movement_id = p_movement
     limit 1;

    if v_otra is not null then
      raise exception
        'el_pago_no_se_atribuye: este pago salda la factura «%». Lo que cuenta en el trabajo es la factura, no el pago: atribuye la factura',
        v_otra;
    end if;

    perform app.comprueba_el_trabajo(p_job, v_mov.organization_id, v_mov.legal_entity_id);
  end if;

  update cash_movements set job_id = p_job where id = p_movement;

  return query select * from cash_movements where id = p_movement;
end $fn$;

comment on function atribuir_gasto(uuid, uuid) is
  'Dice para qué trabajo era un gasto sin factura detrás. Con p_job nulo, lo desatribuye (F5).';

revoke all on function atribuir_gasto(uuid, uuid) from public, anon;
grant execute on function atribuir_gasto(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Puerta · cambiar lo que de un trabajo se puede cambiar
-- ---------------------------------------------------------------------------
--
-- El nombre, el estado y las notas. Nunca el precio acordado ni el costo
-- estimado: son la foto del día que se aprobó, y editarlos convertiría
-- «cotizaste 40 %» en una cifra que se puede acomodar al resultado.

create or replace function actualizar_trabajo(
  p_job    uuid,
  p_name   text default null,
  p_status text default null,
  p_notes  text default null
) returns setof jobs
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_job record;
begin
  select j.* into v_job from jobs j where j.id = p_job for update;

  if v_job.id is null or not app.can_see_costs(v_job.organization_id) then
    raise exception 'trabajo_no_encontrado: ese trabajo no existe o no es de tu organización';
  end if;

  if p_name is not null and btrim(p_name) = '' then
    raise exception 'nombre_obligatorio: un trabajo sin nombre no se reconoce en una lista';
  end if;

  if p_status is not null and p_status not in ('open', 'done', 'cancelled') then
    raise exception 'estado_invalido: un trabajo está en curso, terminado o cancelado';
  end if;

  update jobs
     set name   = coalesce(nullif(btrim(coalesce(p_name, '')), ''), name),
         status = coalesce(p_status, status),
         notes  = case when p_notes is null then notes
                       else nullif(btrim(p_notes), '') end
   where id = p_job;

  return query select * from jobs where id = p_job;
end $fn$;

comment on function actualizar_trabajo(uuid, text, text, text) is
  'Cambia el nombre, el estado o las notas de un trabajo. El precio acordado y el costo estimado no se tocan (INV-14.2).';

revoke all on function actualizar_trabajo(uuid, text, text, text) from public, anon;
grant execute on function actualizar_trabajo(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Las dos puertas que ya existían, ahora con trabajo
-- ---------------------------------------------------------------------------
--
-- Se vuelven a declarar enteras y se tira la firma anterior. Añadir un
-- parámetro con valor por defecto **no** reemplaza una función en Postgres:
-- crea una sobrecarga y deja la vieja viva, y entonces hay dos puertas para
-- lo mismo y una de ellas no sabe de trabajos.
--
-- Podría atribuirse en una segunda llamada después de anotar, y se descartó:
-- si la segunda falla, el costo queda anotado y sin trabajo, que es
-- exactamente el agujero por el que este lente se queda vacío. Dentro de una
-- función es una transacción: o las dos cosas, o ninguna.

drop function registrar_compra(uuid, text, numeric, text, document_type, text, date, date, numeric, uuid, text);

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
  p_description text default null,
  p_job         uuid default null
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

  -- El trabajo se comprueba antes de crear nada: si es de otra empresa, que
  -- no quede ni la compra ni el proveedor nuevo.
  if p_job is not null then
    perform app.comprueba_el_trabajo(p_job, v_ent.organization_id, p_entity);
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
    amount_net, amount_tax, amount_total, tax_rate, status, job_id)
  values (
    v_ent.organization_id, p_entity, 'purchase', p_doc_type, v_serie,
    v_prov, p_category, nullif(btrim(coalesce(p_description, '')), ''),
    v_fecha, v_vence, v_moneda,
    v_neto, v_importe - v_neto, v_importe, v_tasa, 'open', p_job)
  returning id into v_doc;

  return query select * from billing_documents where id = v_doc;
end $fn$;

comment on function registrar_compra(uuid, text, numeric, text, document_type, text, date, date, numeric, uuid, text, uuid) is
  'Anota la factura de un proveedor: crea el documento de compra, el proveedor si hace falta, y la atribuye al trabajo si se dice cuál (F3-6, F5).';

revoke all on function registrar_compra(uuid, text, numeric, text, document_type, text, date, date, numeric, uuid, text, uuid) from public, anon;
grant execute on function registrar_compra(uuid, text, numeric, text, document_type, text, date, date, numeric, uuid, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------

drop function registrar_movimiento(uuid, cash_direction, numeric, text, date, cash_kind, uuid, uuid, text, numeric, numeric, uuid);

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
  p_amount_tax   numeric default null,
  p_recurring    uuid default null,
  p_job          uuid default null
) returns setof cash_movements
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_cuenta record;
  v_gasto  record;
  v_suya   text;
  v_mia    text;
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

  -- -------------------------------------------------------------------------
  -- Si dice que paga un gasto fijo, se comprueba aquí y con nombres. Lo que
  -- viene después es la clave compuesta, que impide lo mismo pero sin
  -- explicarlo.
  -- -------------------------------------------------------------------------
  if p_recurring is not null then
    -- Un gasto recurrente solo se paga; no se cobra. Marcar una entrada como
    -- pago de una suscripción dejaría la proyección creyendo que ese mes está
    -- saldado con dinero que entró.
    if p_direction <> 'out' then
      raise exception 'recurrente_solo_sale: un gasto recurrente se paga, no se cobra';
    end if;

    select r.* into v_gasto from recurring_expenses r where r.id = p_recurring;

    if v_gasto.id is null or v_gasto.organization_id <> v_cuenta.organization_id then
      raise exception 'gasto_no_encontrado: ese gasto recurrente no existe o no es de tu organización';
    end if;

    if v_gasto.legal_entity_id <> v_cuenta.legal_entity_id then
      select e.legal_name into v_suya from legal_entities e where e.id = v_gasto.legal_entity_id;
      select e.legal_name into v_mia  from legal_entities e where e.id = v_cuenta.legal_entity_id;
      raise exception
        'gasto_de_otra_empresa: «%» lo paga % y % es una cuenta de %. El dinero no cruza de una empresa a otra: elige una cuenta de %, o cambia de empresa el gasto si todavía no tiene pagos',
        v_gasto.label, v_suya, v_cuenta.name, v_mia, v_suya;
    end if;

    if v_gasto.currency_code <> v_cuenta.currency_code then
      select e.legal_name into v_suya from legal_entities e where e.id = v_gasto.legal_entity_id;
      raise exception
        'gasto_en_otra_moneda: «%» está en % y % es una cuenta en %. Un pago en otra moneda no salda ese gasto: hace falta una cuenta en % de %, o el gasto en %',
        v_gasto.label, v_gasto.currency_code, v_cuenta.name, v_cuenta.currency_code,
        v_gasto.currency_code, v_suya, v_cuenta.currency_code;
    end if;
  end if;

  -- -------------------------------------------------------------------------
  -- Y si dice para qué trabajo es, se comprueba igual: con nombres propios
  -- antes de que la clave compuesta lo impida sin explicarlo (F5).
  -- -------------------------------------------------------------------------
  if p_job is not null then
    if p_direction <> 'out' then
      raise exception
        'no_es_un_gasto: a un trabajo se le atribuye lo que costó. Una entrada de dinero no, porque el ingreso del trabajo sale de la línea que se aprobó y contarla además sería contarla dos veces';
    end if;

    if p_kind in ('transfer', 'opening') then
      raise exception
        'no_es_un_gasto: mover dinero entre tus cuentas o anotar un saldo inicial no es un costo de ningún trabajo (INV-5)';
    end if;

    perform app.comprueba_el_trabajo(p_job, v_cuenta.organization_id, v_cuenta.legal_entity_id);
  end if;

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
    description, external_ref, amount_net, amount_tax, source, recurring_expense_id,
    job_id)
  values (
    v_cuenta.organization_id, p_account, v_cuenta.legal_entity_id, p_direction, v_importe,
    v_cuenta.currency_code, coalesce(p_value_date, current_date), p_kind, p_category,
    case when p_client is not null then 'client' else null end, p_client,
    btrim(p_description), nullif(btrim(coalesce(p_external_ref, '')), ''),
    v_neto, v_imp,
    case when p_kind = 'opening' then 'opening'
         when p_recurring is not null then 'recurring'
         else 'manual' end,
    p_recurring, p_job)
  returning id into v_mov;

  return query select * from cash_movements where id = v_mov;
end $fn$;

comment on function registrar_movimiento(uuid, cash_direction, numeric, text, date, cash_kind, uuid, uuid, text, numeric, numeric, uuid, uuid) is
  'Alta manual en el libro de caja. Con p_recurring marca qué gasto fijo salda; con p_job, para qué trabajo fue el costo (F3-1, F3-3, F5).';

revoke all on function registrar_movimiento(uuid, cash_direction, numeric, text, date, cash_kind, uuid, uuid, text, numeric, numeric, uuid, uuid) from public, anon;
grant execute on function registrar_movimiento(uuid, cash_direction, numeric, text, date, cash_kind, uuid, uuid, text, numeric, numeric, uuid, uuid) to authenticated;

-- Queda apuntada en el historial: si no, un despliegue futuro intentaría
-- aplicarla otra vez y fallaría a mitad.
insert into supabase_migrations.schema_migrations (version, name)
values ('20261123120000', 'cuanto_deja_cada_trabajo')
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
