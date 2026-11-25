-- ===========================================================================
-- UN SOLO ARCHIVO para pegar en Supabase → SQL Editor y pulsar Run.
--
-- Generado por supabase/seed/armar.sh. No se edita a mano.
--
-- Hace tres cosas, en este orden y en una sola pasada:
--
--  1. aplica la migración de «lo que el banco dice» (F6-1), que es la única
--     que falta en el proyecto, y la deja apuntada en el historial de
--     migraciones para que no se vuelva a aplicar;
--  2. borra la organización «Margen Demo» si existe de una pasada anterior,
--     para volver a crearla con los datos nuevos. Esto NO toca «Margen
--     Pilot»: borra una sola fila, la de la demo, y lo demás cae por cascada;
--  3. vuelve a crear «Margen Demo» con datos de prueba en todo: sus trabajos
--     con dos compras atribuidas, dos previstos de una sola vez —uno
--     adelantado a medias— y un extracto de banco de tres líneas, una
--     cuadrada y dos que no están en el libro.
--
-- Todo va dentro de una transacción: o entra el archivo entero o no entra
-- nada. Si algo falla a mitad, la base se queda exactamente como estaba, sin
-- una tabla a medias ni una migración apuntada que no se aplicó. En Postgres
-- el DDL también es transaccional, así que esto vale para las tablas y las
-- funciones igual que para los datos.
--
-- Para quitar la demo después, sin volver a crearla: borrar-demo.sql.
-- ===========================================================================

begin;

-- ============================================================================
-- Margen Pilot · F6-1 · Lo que el banco dice
--
-- Hasta aquí el sistema sabe **lo que tú anotaste**. El banco sabe **lo que de
-- verdad pasó**. Son dos listas que deberían coincidir y nunca coinciden del
-- todo: una comisión que no anotaste, un cobro que anotaste el 3 y entró el 5,
-- un cliente que pagó 1 180 y no 1 200, un cargo que no reconoces.
--
-- Conciliar es cruzar las dos listas y dejar por escrito que cuadran, o en qué
-- no cuadran. Esta migración trae la mitad de abajo: el extracto importado,
-- sus líneas y el emparejamiento. El cierre de un periodo conciliado viene
-- después.
--
-- ---------------------------------------------------------------------------
-- INV-8 — Conciliar no crea dinero
-- ---------------------------------------------------------------------------
--
-- Es la regla que gobierna todo lo demás y la única que no se puede relajar.
-- Marcar que una línea del extracto corresponde a un movimiento tuyo **no
-- cambia ni un céntimo del saldo**. Si conciliar pudiera crear, corregir o
-- borrar movimientos, dejaría de ser una comprobación y pasaría a ser otra
-- forma de escribir en el libro; y entonces no comprobaría nada, porque el
-- libro siempre cuadraría consigo mismo.
--
-- Aquí eso no es una promesa: ninguna de las tres tablas de abajo tiene una
-- sola escritura hacia `cash_movements`, y `authenticated` sigue sin INSERT ni
-- UPDATE sobre ella. Lo único que conciliar escribe es «esta línea del banco
-- es este movimiento mío».
--
-- Siete reglas más:
--
-- 1. **El extracto se guarda como vino.** Cada línea conserva su fila original
--    en `raw`, y no se edita nunca. Si una línea está mal, está mal en el
--    banco: eso es un dato, no un error que arreglar.
--
-- 2. **Una línea pertenece a una cuenta, y lleva su moneda.** La clave
--    compuesta `(cash_account_id, organization_id, legal_entity_id,
--    currency_code)` lo impone, igual que en los movimientos (INV-9, ADR-16).
--    No hay forma de meter el extracto del BCP en la cuenta de Mercury.
--
-- 3. **El importe se guarda como lo guarda el libro**: positivo, con la
--    dirección aparte. El signo del extracto decide la dirección al importar
--    y la fila original queda en `raw`. Dos representaciones del dinero en el
--    mismo producto serían dos sitios donde equivocarse.
--
-- 4. **Un emparejamiento une una línea con un movimiento de la misma cuenta y
--    en el mismo sentido.** Lo primero lo impone la clave compuesta; lo
--    segundo, el gate con nombres propios. Marcar una salida del banco contra
--    un cobro tuyo daría por cuadrado lo que no cuadra.
--
-- 5. **El mismo movimiento no se marca dos veces.** Índice único sobre
--    `cash_movement_id`: una línea puede corresponder a varios movimientos
--    —el banco junta dos depósitos del mismo día— pero un movimiento no
--    puede estar en dos líneas. Para eso existen dos movimientos.
--
-- 6. **Un movimiento anulado no concilia.** No es dinero: darlo por cuadrado
--    contra una línea del banco escondería la línea de verdad.
--
-- 7. **Lo que sobra se dice, no se borra.** Una línea que no es tuya —o que
--    decides dejar para después— se marca con un motivo escrito y sale de la
--    lista de pendientes sin desaparecer. Desemparejar también se puede: el
--    emparejamiento es una afirmación, y una afirmación se puede retirar.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- El extracto
-- ---------------------------------------------------------------------------

create table bank_statements (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  legal_entity_id uuid not null,
  cash_account_id uuid not null,
  currency_code   char(3) not null references currencies (code),
  label           text not null check (btrim(label) <> ''),
  /* El rango que cubre, deducido de las líneas. Sirve para avisar de que un
     extracto nuevo pisa fechas que ya estaban importadas. */
  desde           date not null,
  hasta           date not null,
  lineas          int not null check (lineas > 0),
  /* La huella del contenido: el mismo archivo no entra dos veces en la misma
     cuenta. Sin esto, importar dos veces duplicaría media conciliación. */
  source_sha256   text not null,
  imported_by     uuid not null default auth.uid(),
  imported_at     timestamptz not null default now(),

  constraint el_rango_tiene_sentido check (hasta >= desde),

  foreign key (cash_account_id, organization_id, legal_entity_id, currency_code)
    references cash_accounts (id, organization_id, legal_entity_id, currency_code),

  unique (id, organization_id),
  constraint bank_statements_id_org_cuenta_key
    unique (id, organization_id, cash_account_id)
);

create unique index extracto_sin_repetir
  on bank_statements (cash_account_id, source_sha256);

create index bank_statements_cuenta_idx
  on bank_statements (organization_id, cash_account_id, hasta desc);

create trigger bank_statements_audit
  after insert or update or delete on bank_statements
  for each row execute function app.audit_changes();

comment on table bank_statements is
  'Un extracto importado. No se edita: es lo que el banco dijo (INV-8).';

-- ---------------------------------------------------------------------------
-- Las líneas
-- ---------------------------------------------------------------------------

create table bank_statement_lines (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  legal_entity_id uuid not null,
  statement_id    uuid not null,
  cash_account_id uuid not null,
  currency_code   char(3) not null references currencies (code),
  /* El orden en el archivo. Dos líneas idénticas el mismo día existen, y
     `fila` es lo único que las distingue. */
  fila            int not null check (fila > 0),
  value_date      date not null,
  direction       cash_direction not null,
  amount          numeric(18, 2) not null check (amount > 0),
  description     text not null,
  external_ref    text,
  /* La fila original, tal como venía. Nunca se lee para calcular nada: está
     para poder mirar qué decía el banco cuando algo no cuadra. */
  raw             jsonb not null default '{}'::jsonb,
  /* Lo que sobra se dice, no se borra (regla 7). */
  ignored_reason  text,
  ignored_at      timestamptz,
  created_at      timestamptz not null default now(),

  constraint ignorar_exige_motivo
    check (ignored_at is null or btrim(coalesce(ignored_reason, '')) <> ''),

  foreign key (statement_id, organization_id, cash_account_id)
    references bank_statements (id, organization_id, cash_account_id) on delete cascade,
  foreign key (cash_account_id, organization_id, legal_entity_id, currency_code)
    references cash_accounts (id, organization_id, legal_entity_id, currency_code),

  unique (statement_id, fila),
  constraint bank_statement_lines_id_org_cuenta_moneda_key
    unique (id, organization_id, cash_account_id, currency_code)
);

create index bank_statement_lines_pendientes_idx
  on bank_statement_lines (organization_id, cash_account_id, value_date)
  where ignored_at is null;

create trigger bank_statement_lines_audit
  after insert or update or delete on bank_statement_lines
  for each row execute function app.audit_changes();

comment on table bank_statement_lines is
  'Una línea del extracto, como vino. El importe va positivo con su dirección aparte, igual que en el libro; la fila original queda en raw (INV-8.3).';

-- ---------------------------------------------------------------------------
-- El emparejamiento
-- ---------------------------------------------------------------------------
--
-- La clave compuesta de `cash_movements` va **antes** de la tabla que la usa.
-- Postgres exige que la clave única exista cuando se declara la foránea que
-- la referencia, y escribirla después da «there is no unique constraint
-- matching given keys», que no dice ni cuál falta ni dónde.

alter table cash_movements
  add constraint cash_movements_id_org_cuenta_moneda_key
  unique (id, organization_id, cash_account_id, currency_code);

create table bank_line_matches (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations (id) on delete cascade,
  cash_account_id  uuid not null,
  currency_code    char(3) not null references currencies (code),
  statement_line_id uuid not null,
  cash_movement_id uuid not null,
  /* Quién lo afirmó y cuándo. Un emparejamiento es la afirmación de una
     persona, no un cálculo: tiene que saberse de quién fue. */
  matched_by       uuid not null default auth.uid(),
  matched_at       timestamptz not null default now(),

  foreign key (statement_line_id, organization_id, cash_account_id, currency_code)
    references bank_statement_lines (id, organization_id, cash_account_id, currency_code)
    on delete cascade,
  /* La misma cuenta y la misma moneda a los dos lados. No hay forma de
     tachar una línea del BCP con un movimiento de Mercury. */
  foreign key (cash_movement_id, organization_id, cash_account_id, currency_code)
    references cash_movements (id, organization_id, cash_account_id, currency_code)
);

-- Regla 5: un movimiento no se marca dos veces.
create unique index movimiento_conciliado_una_vez
  on bank_line_matches (cash_movement_id);

create index bank_line_matches_linea_idx on bank_line_matches (statement_line_id);

create trigger bank_line_matches_audit
  after insert or update or delete on bank_line_matches
  for each row execute function app.audit_changes();

comment on table bank_line_matches is
  'Esta línea del banco es este movimiento mío. Es lo único que conciliar escribe (INV-8).';

-- ---------------------------------------------------------------------------
-- Permisos · se lee, no se escribe
-- ---------------------------------------------------------------------------

grant select on bank_statements, bank_statement_lines, bank_line_matches to authenticated;

alter table bank_statements      enable row level security;
alter table bank_statements      force  row level security;
alter table bank_statement_lines enable row level security;
alter table bank_statement_lines force  row level security;
alter table bank_line_matches    enable row level security;
alter table bank_line_matches    force  row level security;

create policy bank_statements_select on bank_statements for select
  using (organization_id in (select app.current_orgs())
         and app.can_write_money(organization_id));
create policy bank_statement_lines_select on bank_statement_lines for select
  using (organization_id in (select app.current_orgs())
         and app.can_write_money(organization_id));
create policy bank_line_matches_select on bank_line_matches for select
  using (organization_id in (select app.current_orgs())
         and app.can_write_money(organization_id));

-- ---------------------------------------------------------------------------
-- El estado de cada línea, en un solo sitio
-- ---------------------------------------------------------------------------
--
-- «Cuadra» se define una vez: la suma de lo emparejado es el importe de la
-- línea. Escrito en dos sitios, un día dirían cosas distintas y nadie sabría
-- cuál creer.

create view bank_line_status with (security_invoker = true) as
select l.id                as line_id,
       l.organization_id,
       l.cash_account_id,
       count(m.id)::int    as emparejados,
       coalesce(sum(v.amount), 0)::numeric(18, 2) as conciliado,
       (coalesce(sum(v.amount), 0) = l.amount)    as cuadra
  from bank_statement_lines l
  left join bank_line_matches m on m.statement_line_id = l.id
  left join cash_movements   v on v.id = m.cash_movement_id and not v.is_void
 group by l.id, l.organization_id, l.cash_account_id, l.amount;

comment on view bank_line_status is
  'Cuánto se le emparejó a cada línea y si cuadra. Una sola definición de «cuadra» (INV-8).';

grant select on bank_line_status to authenticated;

-- ---------------------------------------------------------------------------
-- Puerta · importar un extracto
-- ---------------------------------------------------------------------------
--
-- Las líneas llegan ya leídas y mapeadas por la pantalla: qué columna era la
-- fecha, cuál el importe y cuál la descripción lo decide una persona la
-- primera vez, porque cada banco trae su formato y adivinarlo mal es peor que
-- preguntarlo.
--
-- Cada elemento: {"fecha": "2026-11-03", "importe": -118.00,
--                 "descripcion": "...", "referencia": "OP-123", "raw": {...}}
-- El signo del importe decide la dirección.

create or replace function importar_extracto(
  p_account uuid,
  p_label   text,
  p_lines   jsonb
) returns setof bank_statements
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_cuenta  record;
  v_dec     int;
  v_sha     text;
  v_antes   record;
  v_desde   date;
  v_hasta   date;
  v_cuantas int;
  v_id      uuid;
begin
  select a.* into v_cuenta from cash_accounts a where a.id = p_account;

  if v_cuenta.id is null or not app.can_write_money(v_cuenta.organization_id) then
    raise exception 'cuenta_no_encontrada: esa cuenta no existe o no es de tu organización';
  end if;

  if btrim(coalesce(p_label, '')) = '' then
    raise exception 'etiqueta_obligatoria: el extracto necesita un nombre, el que vas a reconocer dentro de seis meses';
  end if;

  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'extracto_vacio: no se leyó ninguna línea de ese archivo. Revisa qué columna es la fecha y cuál el importe';
  end if;

  if jsonb_array_length(p_lines) > 5000 then
    raise exception 'extracto_enorme: cinco mil líneas son más de las que trae un extracto. Pártelo por meses';
  end if;

  -- La huella del contenido, no del archivo: dos descargas del mismo periodo
  -- pueden diferir en una cabecera y seguir siendo el mismo extracto.
  v_sha := encode(sha256(convert_to(p_lines::text, 'UTF8')), 'hex');

  select s.label, s.imported_at into v_antes
    from bank_statements s
   where s.cash_account_id = p_account and s.source_sha256 = v_sha;

  if v_antes.label is not null then
    raise exception
      'extracto_repetido: este mismo extracto ya se importó como «%» el %. Importarlo otra vez duplicaría media conciliación',
      v_antes.label, to_char(v_antes.imported_at, 'DD/MM/YYYY');
  end if;

  select c.minor_units into v_dec from currencies c where c.code = v_cuenta.currency_code;

  -- Se valida todo antes de escribir nada: un extracto medio importado es
  -- peor que uno no importado.
  select min((e.item->>'fecha')::date),
         max((e.item->>'fecha')::date),
         count(*)
    into v_desde, v_hasta, v_cuantas
    from jsonb_array_elements(p_lines) as e(item);

  if v_desde is null then
    raise exception 'fecha_obligatoria: alguna línea no trae fecha. Revisa qué columna mapeaste como fecha';
  end if;

  if exists (
    select 1 from jsonb_array_elements(p_lines) as e(item)
     where round(coalesce((e.item->>'importe')::numeric, 0), v_dec) = 0
  ) then
    raise exception 'importe_invalido: alguna línea tiene importe cero. Revisa qué columna mapeaste como importe';
  end if;

  insert into bank_statements (
    organization_id, legal_entity_id, cash_account_id, currency_code,
    label, desde, hasta, lineas, source_sha256)
  values (
    v_cuenta.organization_id, v_cuenta.legal_entity_id, p_account, v_cuenta.currency_code,
    btrim(p_label), v_desde, v_hasta, v_cuantas, v_sha)
  returning id into v_id;

  insert into bank_statement_lines (
    organization_id, legal_entity_id, statement_id, cash_account_id, currency_code,
    fila, value_date, direction, amount, description, external_ref, raw)
  select v_cuenta.organization_id,
         v_cuenta.legal_entity_id,
         v_id,
         p_account,
         v_cuenta.currency_code,
         e.idx::int,
         (e.item->>'fecha')::date,
         case when (e.item->>'importe')::numeric < 0 then 'out' else 'in' end::cash_direction,
         abs(round((e.item->>'importe')::numeric, v_dec)),
         coalesce(nullif(btrim(e.item->>'descripcion'), ''), 'Sin concepto'),
         nullif(btrim(coalesce(e.item->>'referencia', '')), ''),
         coalesce(e.item->'raw', e.item)
    from jsonb_array_elements(p_lines) with ordinality as e(item, idx);

  return query select * from bank_statements where id = v_id;
end $fn$;

comment on function importar_extracto(uuid, text, jsonb) is
  'Guarda un extracto y sus líneas tal como vinieron. No toca el libro (INV-8).';

revoke all on function importar_extracto(uuid, text, jsonb) from public, anon;
grant execute on function importar_extracto(uuid, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Puerta · emparejar una línea con un movimiento
-- ---------------------------------------------------------------------------

create or replace function emparejar_linea(p_line uuid, p_movement uuid)
returns setof bank_line_matches
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_linea  record;
  v_mov    record;
  v_otra   record;
  v_id     uuid;
begin
  select l.* into v_linea from bank_statement_lines l where l.id = p_line;

  if v_linea.id is null or not app.can_write_money(v_linea.organization_id) then
    raise exception 'linea_no_encontrada: esa línea del extracto no existe o no es de tu organización';
  end if;

  select m.* into v_mov from cash_movements m where m.id = p_movement;

  if v_mov.id is null or v_mov.organization_id <> v_linea.organization_id then
    raise exception 'movimiento_no_encontrado: ese movimiento no existe o no es de tu organización';
  end if;

  if v_mov.is_void then
    raise exception
      'movimiento_anulado: ese movimiento está anulado, así que no es dinero. Darlo por cuadrado contra una línea del banco escondería la línea de verdad';
  end if;

  if v_mov.cash_account_id <> v_linea.cash_account_id then
    raise exception
      'cuenta_de_otro_libro: esa línea es de una cuenta y ese movimiento de otra. Una línea del banco solo se tacha con dinero de la misma cuenta';
  end if;

  if v_mov.direction <> v_linea.direction then
    raise exception
      'direccion_no_concuerda: en el banco eso es dinero que % y el movimiento es dinero que %. Marcarlos juntos daría por cuadrado lo que no cuadra',
      case when v_linea.direction = 'in' then 'entró' else 'salió' end,
      case when v_mov.direction = 'in' then 'entró' else 'salió' end;
  end if;

  select l.value_date, l.description into v_otra
    from bank_line_matches m
    join bank_statement_lines l on l.id = m.statement_line_id
   where m.cash_movement_id = p_movement;

  if v_otra.value_date is not null then
    raise exception
      'movimiento_ya_conciliado: ese movimiento ya está marcado contra la línea «%» del %. Un movimiento no puede ser dos apuntes del banco: si de verdad lo fueron, anótalo como dos movimientos',
      v_otra.description, to_char(v_otra.value_date, 'DD/MM/YYYY');
  end if;

  if v_linea.ignored_at is not null then
    raise exception
      'linea_ignorada: esa línea está apartada con el motivo «%». Quítale el motivo antes de emparejarla',
      v_linea.ignored_reason;
  end if;

  insert into bank_line_matches (
    organization_id, cash_account_id, currency_code, statement_line_id, cash_movement_id)
  values (
    v_linea.organization_id, v_linea.cash_account_id, v_linea.currency_code, p_line, p_movement)
  returning id into v_id;

  return query select * from bank_line_matches where id = v_id;
end $fn$;

comment on function emparejar_linea(uuid, uuid) is
  'Afirma que una línea del banco es un movimiento del libro. No mueve dinero (INV-8).';

revoke all on function emparejar_linea(uuid, uuid) from public, anon;
grant execute on function emparejar_linea(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Puerta · retirar un emparejamiento
-- ---------------------------------------------------------------------------
--
-- Esto sí se borra. Un emparejamiento no es un hecho económico: es la
-- afirmación de una persona, y una afirmación se puede retirar. El rastro de
-- quién la hizo y quién la quitó lo guarda `audit_log`.

create or replace function desemparejar_linea(p_match uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare v_match record;
begin
  select m.* into v_match from bank_line_matches m where m.id = p_match;

  if v_match.id is null or not app.can_write_money(v_match.organization_id) then
    raise exception 'emparejamiento_no_encontrado: eso no existe o no es de tu organización';
  end if;

  delete from bank_line_matches where id = p_match;
end $fn$;

revoke all on function desemparejar_linea(uuid) from public, anon;
grant execute on function desemparejar_linea(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Puerta · apartar una línea que no es tuya
-- ---------------------------------------------------------------------------

create or replace function ignorar_linea(p_line uuid, p_motivo text default null)
returns setof bank_statement_lines
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_linea  record;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
begin
  select l.* into v_linea from bank_statement_lines l where l.id = p_line;

  if v_linea.id is null or not app.can_write_money(v_linea.organization_id) then
    raise exception 'linea_no_encontrada: esa línea del extracto no existe o no es de tu organización';
  end if;

  -- Motivo nulo = devolverla a la lista de pendientes.
  if v_motivo is null then
    update bank_statement_lines
       set ignored_reason = null, ignored_at = null
     where id = p_line;
    return query select * from bank_statement_lines where id = p_line;
    return;
  end if;

  if exists (select 1 from bank_line_matches m where m.statement_line_id = p_line) then
    raise exception
      'linea_emparejada: esa línea ya está marcada contra un movimiento. Quita el emparejamiento antes de apartarla';
  end if;

  update bank_statement_lines
     set ignored_reason = v_motivo, ignored_at = now()
   where id = p_line;

  return query select * from bank_statement_lines where id = p_line;
end $fn$;

comment on function ignorar_linea(uuid, text) is
  'Aparta una línea del extracto con un motivo escrito, o la devuelve a pendientes con motivo nulo. No la borra (INV-8.7).';

revoke all on function ignorar_linea(uuid, text) from public, anon;
grant execute on function ignorar_linea(uuid, text) to authenticated;

-- Queda apuntada en el historial: si no, un despliegue futuro intentaría
-- aplicarla otra vez y fallaría a mitad.
insert into supabase_migrations.schema_migrations (version, name)
values ('20261124140000', 'lo_que_el_banco_dice')
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
  v_taxis      uuid;
  v_extracto   uuid;
  v_linea      uuid;
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
  select id into v_taxis from registrar_movimiento(v_bcp, 'out', 118, 'Taxis de la semana',
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

  -- ------------------------------------------------- lo que el banco dice
  -- Un extracto de tres líneas: una que cuadra con un gasto anotado, una que
  -- no está en el libro —la comisión que nadie anotó, que es el caso de
  -- verdad— y una que el banco cobró y tampoco está. Importar no mueve el
  -- saldo ni un céntimo (INV-8): lo único que hay después es la lista del
  -- banco al lado de la tuya.
  select id into v_extracto from importar_extracto(v_bcp, 'BCP soles · este mes',
    jsonb_build_array(
      jsonb_build_object('fecha', (current_date - 4)::text, 'importe', -118.00,
                         'descripcion', 'PAGO TAXI APP', 'referencia', 'OP-330011'),
      jsonb_build_object('fecha', (current_date - 3)::text, 'importe', -14.50,
                         'descripcion', 'COMISION MANTENIMIENTO CUENTA'),
      jsonb_build_object('fecha', (current_date - 2)::text, 'importe', -35.00,
                         'descripcion', 'ITF / IMPUESTO A LAS TRANSACCIONES')));

  -- La primera sí es un gasto anotado, y se empareja. Las otras dos se quedan
  -- en «sobra del banco», que es justo lo que esta pantalla existe para
  -- enseñar: dos cargos reales que no estaban en el libro.
  select id into v_linea from bank_statement_lines
   where statement_id = v_extracto and fila = 1;
  perform emparejar_linea(v_linea, v_taxis);

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

commit;
