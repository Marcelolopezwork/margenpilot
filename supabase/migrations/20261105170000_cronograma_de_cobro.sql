-- ---------------------------------------------------------------------------
-- Margen Pilot · F2-15 · Cronograma de cobro al aprobar
-- ---------------------------------------------------------------------------
--
-- Esta es la bisagra entre el cotizador y las finanzas. Hasta aquí el
-- producto sabía cuánto se ofertó; a partir de aquí sabe **cuándo se espera
-- el dinero**, que es lo que convierte una cotización aprobada en una
-- proyección de caja.
--
-- La regla que no se puede perder de vista es la del hueco §4.5 de la
-- revisión crítica: una cuota prevista **no es una cuenta por cobrar**. En
-- servicios es normal pactar el cobro antes de facturar, así que la
-- proyección tiene que existir, pero no puede contaminar la cartera. De ahí
-- los tres estados:
--
--   planned     proyección. Entra en el flujo de 13 semanas y NO en
--               «Por cobrar».
--   documented  ya hay documento emitido. Entra en «Por cobrar».
--   settled     cobrado. Sale de los dos.
--   cancelled   se documentó y después se cayó. No se borra (INV-7).
--
-- Y la que manda sobre todas, INV-1: esta tabla **no mueve dinero**. El saldo
-- de una cuenta sigue saliendo solo de `cash_movements`, que todavía no
-- existe. Aquí no hay más que fechas y expectativas.
--
-- Diferencia con `docs/ARCHITECTURE.md` §4.3, que escribía el estado como
-- `text` con un `check`: va como enum, igual que `quote_status`. El motivo es
-- práctico: los tipos que genera Supabase convierten un enum en una unión de
-- literales y un `text` en `string`. Esa unión es la que el mes pasado hizo
-- fallar la compilación cuando se añadió «en negociación» y faltaba en la
-- pantalla. Un estado nuevo tiene que romper en voz alta.
-- ---------------------------------------------------------------------------

create type schedule_status as enum ('planned', 'documented', 'settled', 'cancelled');

-- ---------------------------------------------------------------------------
-- Las claves que hacen imposible cruzar los dos libros
-- ---------------------------------------------------------------------------
--
-- ADR-16: Perú y Estados Unidos no se mezclan. En vez de comprobarlo en la
-- función, se deja que lo impida la clave foránea: una cuota lleva su entidad
-- y su moneda, y la cuenta de destino tiene que coincidir en las dos. Así no
-- existe el camino para programar un cobro de Nlima en una cuenta de The
-- Publisher, ni un cobro en soles a una cuenta en dólares.

alter table cash_accounts
  add constraint cash_accounts_id_org_entidad_moneda_key
  unique (id, organization_id, legal_entity_id, currency_code);

alter table quotes
  add constraint quotes_id_org_entidad_moneda_key
  unique (id, organization_id, legal_entity_id, currency_code);

-- ---------------------------------------------------------------------------
-- La tabla
-- ---------------------------------------------------------------------------

create table payment_schedule_items (
  id                       uuid primary key default gen_random_uuid(),
  organization_id          uuid not null references organizations (id) on delete cascade,
  legal_entity_id          uuid not null,
  -- Nulos cuando la cuota no venga de una cotización. Hoy siempre vienen de
  -- una; en F3 habrá pagos previstos a proveedores que no tienen detrás
  -- ninguna, y por eso `direction` ya distingue entrada de salida.
  quote_id                 uuid,
  quote_version_id         uuid,
  direction                text not null default 'in' check (direction in ('in', 'out')),
  label                    text not null check (btrim(label) <> ''),
  due_date                 date not null,
  amount                   numeric(18, 2) not null check (amount > 0),
  currency_code            char(3) not null references currencies (code),
  expected_cash_account_id uuid,
  status                   schedule_status not null default 'planned',
  sort                     int not null default 0,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  foreign key (legal_entity_id, organization_id)
    references legal_entities (id, organization_id) on delete cascade,
  -- La cuota hereda entidad y moneda de su cotización, y no puede discrepar.
  foreign key (quote_id, organization_id, legal_entity_id, currency_code)
    references quotes (id, organization_id, legal_entity_id, currency_code) on delete cascade,
  foreign key (quote_version_id, organization_id)
    references quote_versions (id, organization_id) on delete cascade,
  -- La cuenta de destino, si se elige, es de la misma entidad y la misma
  -- moneda. Con `expected_cash_account_id` nulo la clave no se comprueba, que
  -- es justo lo que hace falta mientras aún no se ha decidido dónde entra.
  foreign key (expected_cash_account_id, organization_id, legal_entity_id, currency_code)
    references cash_accounts (id, organization_id, legal_entity_id, currency_code),
  constraint version_exige_cotizacion check (quote_version_id is null or quote_id is not null)
);

comment on table payment_schedule_items is
  'Cronograma de cobro previsto. No mueve dinero (INV-1): una cuota «planned» es proyección, no cartera (revisión §4.5).';

create index payment_schedule_items_quote_idx
  on payment_schedule_items (quote_id, sort);
-- El índice que va a usar la proyección de 13 semanas en F3.
create index payment_schedule_items_proyeccion_idx
  on payment_schedule_items (organization_id, status, due_date);

create trigger payment_schedule_items_touch before update on payment_schedule_items
  for each row execute function app.touch_updated_at();
create trigger payment_schedule_items_audit
  after insert or update or delete on payment_schedule_items
  for each row execute function app.audit_changes();

-- ---------------------------------------------------------------------------
-- Permisos · se lee, no se escribe
-- ---------------------------------------------------------------------------
--
-- Igual que las versiones emitidas: la única puerta de escritura es la
-- función de abajo, que comprueba que el cronograma cuadre. Si la tabla
-- aceptara un `insert` suelto, cuadrar sería una costumbre y no una regla.

grant select on payment_schedule_items to authenticated;

alter table payment_schedule_items enable row level security;
alter table payment_schedule_items force row level security;

create policy payment_schedule_items_select on payment_schedule_items for select
  using (organization_id in (select app.current_orgs()));

-- ---------------------------------------------------------------------------
-- Cuánto hay que repartir
-- ---------------------------------------------------------------------------
--
-- El cronograma reparte el total de la versión **aprobada**, no el de la
-- cotización de hoy. Son lo mismo mientras no se reemita, y reemitir una
-- aprobada no se puede (`approved` solo pasa a `void`), pero la referencia
-- correcta es la versión: es la cifra que el cliente aceptó.

create or replace function app.version_vigente(p_quote uuid)
returns table (id uuid, total numeric, version_no int)
language sql stable security definer set search_path = public, pg_temp as $$
  select qv.id, (qv.totals->>'total')::numeric, qv.version_no
    from quote_versions qv
   where qv.quote_id = p_quote
   order by qv.version_no desc
   limit 1
$$;

revoke all on function app.version_vigente(uuid) from public, anon;
grant execute on function app.version_vigente(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- El cronograma por defecto, al aprobar
-- ---------------------------------------------------------------------------
--
-- Una sola cuota por el total, con fecha de hoy. Es deliberado que no intente
-- adivinar un 50/50 leyendo las condiciones de la entidad: adivinar mal
-- obliga a deshacer, y repartir es un botón en la pantalla. Lo que la base
-- garantiza es que al aprobar **siempre** hay cronograma, aunque sea de una
-- línea, para que ninguna cotización aceptada se quede fuera de la
-- proyección.

create or replace function app.cronograma_por_defecto(p_quote uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_q       record;
  v_version record;
begin
  if exists (select 1 from payment_schedule_items where quote_id = p_quote) then
    return;
  end if;

  select q.organization_id, q.legal_entity_id, q.currency_code
    into v_q from quotes q where q.id = p_quote;

  select * into v_version from app.version_vigente(p_quote);

  -- Sin versión no hay nada que repartir, y no debería pasar: a «aprobada»
  -- solo se llega desde «enviada» o «en negociación», y a las dos se llega
  -- emitiendo. Si pasa, aprobar no es el momento de quejarse.
  if v_version.id is null or coalesce(v_version.total, 0) <= 0 then
    return;
  end if;

  insert into payment_schedule_items (
    organization_id, legal_entity_id, quote_id, quote_version_id,
    direction, label, due_date, amount, currency_code, status, sort)
  values (
    v_q.organization_id, v_q.legal_entity_id, p_quote, v_version.id,
    'in', 'Pago único', current_date, v_version.total, v_q.currency_code,
    'planned', 1);
end $$;

-- El disparador de estados ya escribe la bitácora; se le añade crear el
-- cronograma por el mismo motivo por el que escribe la bitácora: lo que tiene
-- que pasar siempre no puede depender de que la pantalla se acuerde.

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
  end if;

  perform set_config('app.motivo_de_cambio', '', true);
  perform set_config('app.accion_de_cambio', '', true);
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Guardar el cronograma entero, de una vez
-- ---------------------------------------------------------------------------
--
-- Se guarda la lista completa y no cuota por cuota, y esa es la decisión de
-- diseño de esta migración. Editando fila a fila, el cronograma estaría
-- descuadrado en el intervalo entre una y otra, y entonces «las cuotas suman
-- el total» sería algo que la pantalla intenta, no algo que la base cumple.
-- Mandándolo entero, cuadra dentro de una transacción o no se guarda nada.
--
-- Las cuotas ya documentadas o cobradas no viajan en la lista: no se tocan y
-- se suman aparte. Las previstas que el usuario quitó se borran, y pueden
-- borrarse porque una proyección no es un hecho económico: no hay documento
-- ni dinero detrás. El rastro de ese borrado lo guarda `audit_log`, igual que
-- el de cualquier otra fila.

create or replace function guardar_cronograma(p_quote uuid, p_items jsonb)
returns setof payment_schedule_items
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_q         record;
  v_version   record;
  v_dec       int;
  v_suma      numeric;
  v_congelado numeric;
begin
  select q.id, q.organization_id, q.legal_entity_id, q.currency_code, q.status
    into v_q from quotes q where q.id = p_quote for update;

  if v_q.id is null then
    raise exception 'quote_not_found: la cotización no existe';
  end if;

  -- Definer se salta RLS, así que el permiso se comprueba a mano. El
  -- cronograma es dinero previsto: lo arma quien puede escribir finanzas, no
  -- el rol comercial, que sí puede aprobar.
  if not app.can_write_money(v_q.organization_id) then
    raise exception 'quote_not_found: la cotización no existe o no es de tu organización';
  end if;

  if v_q.status <> 'approved' then
    raise exception 'cotizacion_no_aprobada: el cronograma de cobro se arma cuando el cliente acepta';
  end if;

  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'cronograma_invalido: hay que mandar una lista de cuotas';
  end if;

  if jsonb_array_length(p_items) > 60 then
    raise exception 'cronograma_invalido: sesenta cuotas son más de las que nadie cobra';
  end if;

  select * into v_version from app.version_vigente(p_quote);
  if v_version.id is null then
    raise exception 'sin_version: esta cotización no tiene ninguna versión emitida';
  end if;

  select c.minor_units into v_dec from currencies c where c.code = v_q.currency_code;

  select coalesce(sum(round((e.item->>'amount')::numeric, v_dec)), 0) into v_suma
    from jsonb_array_elements(p_items) as e(item);

  -- Lo ya documentado o cobrado no se reparte otra vez, pero sigue contando
  -- para el total: el cliente debe el total, no el total menos lo facturado.
  select coalesce(sum(amount), 0) into v_congelado
    from payment_schedule_items
   where quote_id = p_quote and status in ('documented', 'settled');

  if round(v_suma + v_congelado, v_dec) <> round(v_version.total, v_dec) then
    raise exception
      'cronograma_descuadrado: las cuotas suman % y la versión aprobada es de % %',
      to_char(round(v_suma + v_congelado, v_dec), 'FM999999999990.00'),
      to_char(round(v_version.total, v_dec), 'FM999999999990.00'),
      v_q.currency_code;
  end if;

  delete from payment_schedule_items
   where quote_id = p_quote and status = 'planned';

  -- La entidad, la moneda y la versión salen de la cotización y no de lo que
  -- mande el cliente: son justamente los datos que no se negocian.
  insert into payment_schedule_items (
    organization_id, legal_entity_id, quote_id, quote_version_id, direction,
    label, due_date, amount, currency_code, expected_cash_account_id, status, sort)
  select
    v_q.organization_id, v_q.legal_entity_id, p_quote, v_version.id, 'in',
    btrim(coalesce(e.item->>'label', '')),
    (e.item->>'due_date')::date,
    round((e.item->>'amount')::numeric, v_dec),
    v_q.currency_code,
    nullif(e.item->>'cash_account_id', '')::uuid,
    'planned',
    e.idx::int
  from jsonb_array_elements(p_items) with ordinality as e(item, idx);

  return query
    select * from payment_schedule_items
     where quote_id = p_quote
     order by due_date, sort;
end $$;

comment on function guardar_cronograma(uuid, jsonb) is
  'Reemplaza las cuotas previstas de una cotización aprobada. Exige que sumen el total de la versión aprobada (F2-15).';

revoke all on function guardar_cronograma(uuid, jsonb) from public, anon;
grant execute on function guardar_cronograma(uuid, jsonb) to authenticated;
