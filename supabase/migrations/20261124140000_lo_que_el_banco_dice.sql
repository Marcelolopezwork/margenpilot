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

-- `cash_movements` necesita la clave compuesta por cuenta para que el
-- emparejamiento pueda exigir que los dos lados sean de la misma cuenta.
alter table cash_movements
  add constraint cash_movements_id_org_cuenta_moneda_key
  unique (id, organization_id, cash_account_id, currency_code);

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
