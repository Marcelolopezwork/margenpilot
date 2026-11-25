-- ===========================================================================
-- UN SOLO ARCHIVO para pegar en Supabase → SQL Editor y pulsar Run.
--
-- Generado por supabase/seed/armar.sh. No se edita a mano.
--
-- Hace tres cosas, en este orden y en una sola pasada:
--
--  1. aplica las migraciones que faltan en el proyecto —el cierre de
--     conciliación (F6-2) y las horas por trabajo (F5-5)— y las deja
--     apuntadas en el historial para que no se vuelvan a aplicar;
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
-- Margen Pilot · F6-2 · Hasta aquí está cuadrado
--
-- La otra mitad de la conciliación. Con F6-1 se puede cruzar el extracto con
-- el libro; lo que faltaba es poder **cerrar**: decir «hasta el 31 de octubre
-- esto está cuadrado con el banco» y que deje de pedir atención.
--
-- Sin cierre, conciliar es una tarea que nunca termina: cada mes vuelves a
-- mirar las mismas líneas viejas porque nada dice que ya se miraron.
--
-- ---------------------------------------------------------------------------
-- INV-8.8 — Un cierre es una afirmación con condiciones, no una fecha
-- ---------------------------------------------------------------------------
--
-- 1. **No se puede cerrar lo que no está resuelto.** Para cerrar hasta una
--    fecha, cada línea del extracto hasta esa fecha tiene que estar cuadrada
--    o apartada con su motivo. Un cierre que admite líneas sueltas no afirma
--    nada: solo las esconde.
--
-- 2. **No se cierra contra nada.** Hace falta al menos un extracto importado
--    que llegue hasta esa fecha. Cerrar octubre sin haber importado octubre
--    sería decir que cuadra con un extracto que nadie miró.
--
-- 3. **Ni hacia el futuro.** El banco todavía no ha dicho qué pasó mañana.
--
-- 4. **Lo cerrado no se toca.** Emparejar, desemparejar o apartar una línea
--    anterior al cierre se rechaza con nombres: primero se reabre. Si lo
--    cerrado se pudiera cambiar en silencio, el cierre sería un adorno.
--
-- 5. **Y no se importa encima.** Un extracto con líneas anteriores al cierre
--    se rechaza entero, porque dejaría líneas nuevas sin resolver **debajo**
--    de una fecha que afirma que todo lo de antes está resuelto. La salida es
--    reabrir, importar y volver a cerrar.
--
-- 6. **Reabrir se puede y es una acción explícita.** Con fecha nula el cierre
--    desaparece. Encontrar un error dos meses después es normal; lo que no
--    puede pasar es cambiarlo sin querer.
--
-- 7. **El cierre vive en su propia tabla.** No en una columna de
--    `cash_accounts`, donde `authenticated` tiene UPDATE y podría escribir la
--    fecha sin pasar por ninguna de las comprobaciones de arriba. Aquí no
--    tiene ni un permiso de escritura: la fecha solo la pone el gate.
--
-- 8. **Los movimientos sin línea del banco no bloquean el cierre, pero no se
--    esconden.** El extracto es la autoridad sobre lo que pasó en el banco, y
--    el cierre afirma que *ese lado* está explicado. Un movimiento tuyo sin
--    línea —un cheque que nadie depositó— sigue a la vista después de cerrar,
--    en su propia lista, porque sigue sin explicación.
--
-- Y la de siempre, que no cambia: **conciliar no crea dinero** (INV-8). Este
-- archivo trae la única excepción que esa regla siempre admitió, y es
-- explícita: `crear_movimiento_desde_linea` anota el gasto que el banco te
-- cobró y tú nunca apuntaste. Pasa por las mismas comprobaciones que el alta
-- manual, queda marcado `source = 'bank_import'` y empareja en el mismo acto.
-- No es conciliar creando dinero: es anotar lo que faltaba, diciéndolo.
-- ============================================================================

create table bank_reconciliations (
  cash_account_id uuid primary key,
  organization_id uuid not null references organizations (id) on delete cascade,
  legal_entity_id uuid not null,
  currency_code   char(3) not null references currencies (code),
  /* Hasta cuándo está cuadrado. Una sola fila por cuenta: la historia de los
     cierres la guarda audit_log, que es donde van las cosas que pasaron. */
  hasta           date not null,
  closed_by       uuid not null default auth.uid(),
  closed_at       timestamptz not null default now(),

  foreign key (cash_account_id, organization_id, legal_entity_id, currency_code)
    references cash_accounts (id, organization_id, legal_entity_id, currency_code)
);

create index bank_reconciliations_org_idx on bank_reconciliations (organization_id);

create trigger bank_reconciliations_audit
  after insert or update or delete on bank_reconciliations
  for each row execute function app.audit_changes();

comment on table bank_reconciliations is
  'Hasta qué fecha está cuadrada cada cuenta con su banco. Sin escritura para authenticated: la fecha solo la pone cerrar_conciliacion (INV-8.8.7).';

grant select on bank_reconciliations to authenticated;

alter table bank_reconciliations enable row level security;
alter table bank_reconciliations force  row level security;

create policy bank_reconciliations_select on bank_reconciliations for select
  using (organization_id in (select app.current_orgs())
         and app.can_write_money(organization_id));

-- ---------------------------------------------------------------------------
-- Hasta cuándo está cerrada una cuenta
-- ---------------------------------------------------------------------------
--
-- En una función y no copiado en cada gate: la pregunta se hace cuatro veces
-- y la respuesta tiene que ser la misma las cuatro.

create or replace function app.cerrada_hasta(p_account uuid) returns date
language sql stable security definer set search_path = public, pg_temp as $$
  select r.hasta from bank_reconciliations r where r.cash_account_id = p_account
$$;

revoke all on function app.cerrada_hasta(uuid) from public, anon;

/* Levanta el error si la fecha cae dentro de lo ya cerrado. */
create or replace function app.no_toques_lo_cerrado(p_account uuid, p_fecha date)
returns void
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare v_hasta date := app.cerrada_hasta(p_account);
begin
  if v_hasta is not null and p_fecha <= v_hasta then
    raise exception
      'periodo_cerrado: esta cuenta está cuadrada hasta el %, y eso es del %. Si de verdad hay que cambiarlo, reabre el cierre primero: lo cerrado que se puede tocar en silencio no afirma nada',
      to_char(v_hasta, 'DD/MM/YYYY'), to_char(p_fecha, 'DD/MM/YYYY');
  end if;
end $fn$;

revoke all on function app.no_toques_lo_cerrado(uuid, date) from public, anon;

-- ---------------------------------------------------------------------------
-- Puerta · cerrar y reabrir
-- ---------------------------------------------------------------------------

create or replace function cerrar_conciliacion(p_account uuid, p_hasta date default null)
returns setof bank_reconciliations
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_cuenta  record;
  v_sueltas int;
  v_primera date;
begin
  select a.* into v_cuenta from cash_accounts a where a.id = p_account;

  if v_cuenta.id is null or not app.can_write_money(v_cuenta.organization_id) then
    raise exception 'cuenta_no_encontrada: esa cuenta no existe o no es de tu organización';
  end if;

  -- Reabrir. Explícito y sin condiciones: encontrar un error dos meses
  -- después es normal.
  if p_hasta is null then
    delete from bank_reconciliations where cash_account_id = p_account;
    return;
  end if;

  if p_hasta > current_date then
    raise exception
      'fecha_futura: no se puede cerrar hasta el %: el banco todavía no ha dicho qué pasó ese día',
      to_char(p_hasta, 'DD/MM/YYYY');
  end if;

  if not exists (
    select 1 from bank_statements s
     where s.cash_account_id = p_account and s.hasta >= p_hasta
  ) then
    raise exception
      'sin_extracto: no hay ningún extracto importado que llegue hasta el %. Cerrar sin extracto sería decir que cuadra con algo que nadie miró',
      to_char(p_hasta, 'DD/MM/YYYY');
  end if;

  select count(*), min(l.value_date) into v_sueltas, v_primera
    from bank_statement_lines l
    left join bank_line_status e on e.line_id = l.id
   where l.cash_account_id = p_account
     and l.value_date <= p_hasta
     and l.ignored_at is null
     and not coalesce(e.cuadra, false);

  if v_sueltas > 0 then
    raise exception
      'quedan_lineas: todavía hay % % del banco sin resolver hasta el %, la más antigua del %. Empareja cada una con su movimiento o apártala con su motivo: un cierre que las admite no afirma nada, solo las esconde',
      v_sueltas,
      case when v_sueltas = 1 then 'línea' else 'líneas' end,
      to_char(p_hasta, 'DD/MM/YYYY'),
      to_char(v_primera, 'DD/MM/YYYY');
  end if;

  insert into bank_reconciliations (
    cash_account_id, organization_id, legal_entity_id, currency_code, hasta)
  values (
    p_account, v_cuenta.organization_id, v_cuenta.legal_entity_id,
    v_cuenta.currency_code, p_hasta)
  on conflict (cash_account_id) do update
    set hasta = excluded.hasta, closed_by = auth.uid(), closed_at = now();

  return query select * from bank_reconciliations where cash_account_id = p_account;
end $fn$;

comment on function cerrar_conciliacion(uuid, date) is
  'Afirma que una cuenta está cuadrada con su banco hasta una fecha, y se niega si no lo está. Con fecha nula, reabre (INV-8.8).';

revoke all on function cerrar_conciliacion(uuid, date) from public, anon;
grant execute on function cerrar_conciliacion(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Lo cerrado no se toca: los tres gates aprenden la fecha
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

  perform app.no_toques_lo_cerrado(v_linea.cash_account_id, v_linea.value_date);

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

create or replace function desemparejar_linea(p_match uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_match record;
  v_linea record;
begin
  select m.* into v_match from bank_line_matches m where m.id = p_match;

  if v_match.id is null or not app.can_write_money(v_match.organization_id) then
    raise exception 'emparejamiento_no_encontrado: eso no existe o no es de tu organización';
  end if;

  select l.* into v_linea from bank_statement_lines l where l.id = v_match.statement_line_id;
  perform app.no_toques_lo_cerrado(v_match.cash_account_id, v_linea.value_date);

  delete from bank_line_matches where id = p_match;
end $fn$;

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

  perform app.no_toques_lo_cerrado(v_linea.cash_account_id, v_linea.value_date);

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

-- ---------------------------------------------------------------------------
-- Y no se importa por debajo del cierre
-- ---------------------------------------------------------------------------
--
-- Se vuelve a declarar entera para meter una comprobación de cuatro líneas,
-- que es lo que cuesta no tener dos caminos de importación.

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
  v_cerrado date;
  v_viejas  int;
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

  select min((e.item->>'fecha')::date),
         max((e.item->>'fecha')::date),
         count(*)
    into v_desde, v_hasta, v_cuantas
    from jsonb_array_elements(p_lines) as e(item);

  if v_desde is null then
    raise exception 'fecha_obligatoria: alguna línea no trae fecha. Revisa qué columna mapeaste como fecha';
  end if;

  -- INV-8.8.5 · nada por debajo del cierre, o el cierre deja de significar
  -- que todo lo anterior está resuelto.
  v_cerrado := app.cerrada_hasta(p_account);
  if v_cerrado is not null and v_desde <= v_cerrado then
    select count(*) into v_viejas
      from jsonb_array_elements(p_lines) as e(item)
     where (e.item->>'fecha')::date <= v_cerrado;

    raise exception
      'periodo_cerrado: % de esas líneas son del % o antes, y esta cuenta está cuadrada hasta el %. Importarlas dejaría líneas sin resolver por debajo de una fecha que dice que todo lo anterior lo está: reabre el cierre, impórtalas y vuelve a cerrar',
      v_viejas, to_char(v_cerrado, 'DD/MM/YYYY'), to_char(v_cerrado, 'DD/MM/YYYY');
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

-- ---------------------------------------------------------------------------
-- Puerta · anotar el gasto que el banco te cobró y tú no apuntaste
-- ---------------------------------------------------------------------------
--
-- La única excepción que INV-8 siempre admitió, y es explícita: la pides tú,
-- línea por línea. Crea el movimiento con los datos de la línea, lo marca
-- `source = 'bank_import'` para que se sepa de dónde salió, y empareja en el
-- mismo acto. Lo que no hace —y por eso sigue sin violar la regla— es tocar
-- un movimiento que ya existía: solo añade el que faltaba.

create or replace function crear_movimiento_desde_linea(
  p_line        uuid,
  p_category    uuid default null,
  p_description text default null,
  p_kind        cash_kind default 'operating'
) returns setof cash_movements
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_linea record;
  v_cat   record;
  v_mov   uuid;
begin
  select l.* into v_linea from bank_statement_lines l where l.id = p_line;

  if v_linea.id is null or not app.can_write_money(v_linea.organization_id) then
    raise exception 'linea_no_encontrada: esa línea del extracto no existe o no es de tu organización';
  end if;

  perform app.no_toques_lo_cerrado(v_linea.cash_account_id, v_linea.value_date);

  if v_linea.ignored_at is not null then
    raise exception
      'linea_ignorada: esa línea está apartada con el motivo «%». Quítale el motivo antes de anotarla',
      v_linea.ignored_reason;
  end if;

  if exists (select 1 from bank_line_matches m where m.statement_line_id = p_line) then
    raise exception
      'linea_emparejada: esa línea ya está marcada contra un movimiento. Si aquel no era, quita el emparejamiento primero';
  end if;

  if p_kind in ('transfer', 'opening') then
    raise exception
      'tipo_invalido: una pata de transferencia o una apertura no se anotan desde aquí. Una transferencia se anota entera, con sus dos lados (INV-5)';
  end if;

  if p_category is not null then
    select fc.name, fc.direction into v_cat
      from financial_categories fc
     where fc.id = p_category and fc.organization_id = v_linea.organization_id;
    if v_cat.name is null then
      raise exception 'categoria_no_encontrada: esa categoría no existe en esta organización';
    end if;
    if v_cat.direction = 'in' and v_linea.direction = 'out' then
      raise exception
        'categoria_de_ingreso: «%» es una categoría de ingresos y en el banco eso es dinero que salió. Elige una de gastos o cámbiala a «ambas» en Configuración → Categorías',
        v_cat.name;
    end if;
    if v_cat.direction = 'out' and v_linea.direction = 'in' then
      raise exception
        'categoria_de_gasto: «%» es una categoría de gastos y en el banco eso es dinero que entró. Elige una de ingresos o cámbiala a «ambas» en Configuración → Categorías',
        v_cat.name;
    end if;
  end if;

  insert into cash_movements (
    organization_id, cash_account_id, legal_entity_id, direction, amount,
    currency_code, value_date, kind, category_id, description, external_ref, source)
  values (
    v_linea.organization_id, v_linea.cash_account_id, v_linea.legal_entity_id,
    v_linea.direction, v_linea.amount, v_linea.currency_code, v_linea.value_date,
    p_kind, p_category,
    coalesce(nullif(btrim(coalesce(p_description, '')), ''), v_linea.description),
    v_linea.external_ref, 'bank_import')
  returning id into v_mov;

  insert into bank_line_matches (
    organization_id, cash_account_id, currency_code, statement_line_id, cash_movement_id)
  values (
    v_linea.organization_id, v_linea.cash_account_id, v_linea.currency_code, p_line, v_mov);

  return query select * from cash_movements where id = v_mov;
end $fn$;

comment on function crear_movimiento_desde_linea(uuid, uuid, text, cash_kind) is
  'Anota el movimiento que faltaba a partir de una línea del banco y la empareja. Marcado source=bank_import (INV-8).';

revoke all on function crear_movimiento_desde_linea(uuid, uuid, text, cash_kind) from public, anon;
grant execute on function crear_movimiento_desde_linea(uuid, uuid, text, cash_kind) to authenticated;

-- Queda apuntada en el historial: si no, un despliegue futuro intentaría
-- aplicarla otra vez y fallaría a mitad.
insert into supabase_migrations.schema_migrations (version, name)
values ('20261125120000', 'hasta_aqui_esta_cuadrado')
on conflict (version) do nothing;

-- ============================================================================
-- Margen Pilot · F5-5 · Cuánto tiempo se fue
--
-- La otra mitad de «cuánto deja cada trabajo». Hoy un trabajo sabe cuánto
-- **dinero** costó; no sabe cuánto **tiempo**. Y un trabajo que dejó 40 %
-- pero se comió tres semanas de dos personas no dejó 40 %: dejó mucho menos,
-- solo que la parte cara no pasó por el banco.
--
-- Es el agujero clásico de una agencia de servicios. El margen por dinero
-- premia al trabajo que se hace con pocos proveedores, aunque se lo coma tu
-- equipo entero; el margen por hora dice la verdad.
--
-- ---------------------------------------------------------------------------
-- INV-16 — Las horas se cuentan aparte del dinero, y no se convierten
-- ---------------------------------------------------------------------------
--
-- 1. **Una hora no es un costo.** No se multiplica por una tarifa ni se suma
--    al costo real del trabajo. Hacerlo contaría dos veces el sueldo de quien
--    ya cobra, o inventaría un gasto que nunca salió del banco. El resultado
--    del mes no cambia ni un céntimo por anotar horas.
--
-- 2. **Lo que las horas producen es una división, no una suma.** «Este
--    trabajo deja 4 000 y se comió 80 horas» son 50 por hora. Esa cifra es la
--    que se compara entre servicios, y es la que delata al cliente que paga
--    bien y cuesta más.
--
-- 3. **Se guardan en minutos enteros.** «Hora y media» entra como 90. Un
--    `numeric` de horas con decimales es la misma trampa que un importe en
--    coma flotante: 0,1 + 0,2 horas no son 0,3 horas.
--
-- 4. **Quién hizo el trabajo es un texto, no un usuario.** El freelance que
--    editó el video no tiene cuenta en Margen y no la va a tener. Lo que hace
--    falta es poder decir «Eli» y que se agrupe.
--
-- 5. **Un apunte de horas se borra.** No es un hecho económico: no hay
--    documento ni dinero detrás, y una tarde mal apuntada tiene que poder
--    desaparecer. El rastro lo guarda `audit_log`, igual que el de una cuota
--    prevista que se quita.
--
-- 6. **Las horas viven en el libro de su trabajo.** La clave compuesta con la
--    entidad lo impone, igual que en las compras y los gastos (INV-11).
-- ============================================================================

create table job_time_entries (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  legal_entity_id uuid not null,
  job_id          uuid not null,
  /* Quién. Texto y no usuario: el freelance no tiene cuenta (INV-16.4). */
  who             text not null check (btrim(who) <> ''),
  spent_on        date not null,
  /* Minutos enteros. Ver INV-16.3. El tope de veinticuatro horas no es
     burocracia: un dedo torpe que teclea 800 en vez de 80 mete trece horas
     de más y nadie lo nota hasta que el margen por hora sale absurdo. */
  minutes         int not null check (minutes > 0 and minutes <= 1440),
  note            text,
  created_by      uuid not null default auth.uid(),
  created_at      timestamptz not null default now(),

  foreign key (job_id, organization_id, legal_entity_id)
    references jobs (id, organization_id, legal_entity_id) on delete cascade
);

create index job_time_entries_trabajo_idx on job_time_entries (organization_id, job_id);
create index job_time_entries_quien_idx
  on job_time_entries (organization_id, lower(btrim(who)));

create trigger job_time_entries_audit
  after insert or update or delete on job_time_entries
  for each row execute function app.audit_changes();

comment on table job_time_entries is
  'El tiempo que se le fue a cada trabajo, en minutos enteros. No es un costo y no se convierte en uno (INV-16).';

grant select on job_time_entries to authenticated;

alter table job_time_entries enable row level security;
alter table job_time_entries force  row level security;

-- Mismo permiso que los trabajos: quien ve el costo ve el tiempo.
create policy job_time_entries_select on job_time_entries for select
  using (organization_id in (select app.current_orgs())
         and app.can_see_costs(organization_id));

-- ---------------------------------------------------------------------------
-- Cuánto tiempo lleva cada trabajo
-- ---------------------------------------------------------------------------

create view job_time with (security_invoker = true) as
select t.job_id,
       t.organization_id,
       sum(t.minutes)::int        as minutos,
       count(*)::int              as apuntes,
       count(distinct lower(btrim(t.who)))::int as personas,
       min(t.spent_on)            as desde,
       max(t.spent_on)            as hasta
  from job_time_entries t
 group by t.job_id, t.organization_id;

comment on view job_time is
  'Minutos por trabajo. En minutos y no en horas: la división la hace quien la enseña, con el redondeo a la vista (INV-16.3).';

grant select on job_time to authenticated;

-- ---------------------------------------------------------------------------
-- Puerta · anotar horas
-- ---------------------------------------------------------------------------

create or replace function anotar_horas(
  p_job     uuid,
  p_who     text,
  p_minutes int,
  p_on      date default null,
  p_note    text default null
) returns setof job_time_entries
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_job  record;
  v_quien text;
  v_id   uuid;
begin
  select j.* into v_job from jobs j where j.id = p_job;

  if v_job.id is null or not app.can_see_costs(v_job.organization_id) then
    raise exception 'trabajo_no_encontrado: ese trabajo no existe o no es de tu organización';
  end if;

  v_quien := btrim(coalesce(p_who, ''));
  if v_quien = '' then
    raise exception 'quien_obligatorio: hace falta saber de quién fue ese tiempo. Sin eso no se puede responder a «en qué se le va el mes al equipo»';
  end if;

  if p_minutes is null or p_minutes <= 0 then
    raise exception 'minutos_invalidos: el tiempo va en minutos y tiene que ser mayor que cero';
  end if;

  if p_minutes > 1440 then
    raise exception
      'minutos_invalidos: % minutos son más de veinticuatro horas en un día. Si de verdad fueron varios días, anótalos por separado: así se ve cuándo se fue el tiempo',
      p_minutes;
  end if;

  insert into job_time_entries (
    organization_id, legal_entity_id, job_id, who, spent_on, minutes, note)
  values (
    v_job.organization_id, v_job.legal_entity_id, p_job, v_quien,
    coalesce(p_on, current_date), p_minutes,
    nullif(btrim(coalesce(p_note, '')), ''))
  returning id into v_id;

  return query select * from job_time_entries where id = v_id;
end $fn$;

comment on function anotar_horas(uuid, text, int, date, text) is
  'Apunta tiempo en un trabajo. No toca el costo ni el resultado: las horas no se convierten en dinero (INV-16.1).';

revoke all on function anotar_horas(uuid, text, int, date, text) from public, anon;
grant execute on function anotar_horas(uuid, text, int, date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Puerta · quitar un apunte
-- ---------------------------------------------------------------------------

create or replace function quitar_horas(p_entry uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare v_entry record;
begin
  select t.* into v_entry from job_time_entries t where t.id = p_entry;

  if v_entry.id is null or not app.can_see_costs(v_entry.organization_id) then
    raise exception 'apunte_no_encontrado: ese apunte no existe o no es de tu organización';
  end if;

  -- Se borra, y se puede: no es un hecho económico. `audit_log` guarda la
  -- fila que había (INV-16.5).
  delete from job_time_entries where id = p_entry;
end $fn$;

revoke all on function quitar_horas(uuid) from public, anon;
grant execute on function quitar_horas(uuid) to authenticated;

-- Queda apuntada en el historial: si no, un despliegue futuro intentaría
-- aplicarla otra vez y fallaría a mitad.
insert into supabase_migrations.schema_migrations (version, name)
values ('20261125130000', 'cuanto_tiempo_se_fue')
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

  -- --------------------------------------------- el tiempo de cada trabajo
  -- Las horas no son un costo y no se convierten en uno (INV-16.1). Lo que
  -- producen es una división: estos dos trabajos tienen margen parecido y muy
  -- distinto por hora, que es justo lo que el porcentaje solo no dice.
  perform anotar_horas(v_trab_lanz, 'Chelo', 240, current_date - 18, 'Guion y dirección');
  perform anotar_horas(v_trab_lanz, 'Eli', 480, current_date - 16, 'Edición');
  perform anotar_horas(v_trab_lanz, 'Chelo', 120, current_date - 12);
  perform anotar_horas(v_trab_redes, 'Chelo', 180, current_date - 10);
  perform anotar_horas(v_trab_redes, 'Eli', 120, current_date - 8);

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
