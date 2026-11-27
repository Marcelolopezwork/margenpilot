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
  v_primero date;
  v_ultimo  date;
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

  /*
    La fecha tiene que caer **dentro** de lo importado: ni antes del primer
    día que trajo un extracto —estarías cerrando un periodo que nadie miró—
    ni después del último —el banco todavía no ha dicho qué pasó ahí—.

    Lo que esto NO detecta es un hueco en medio: si importaste septiembre y
    noviembre y cierras a mitad de octubre, octubre no se miró y esto deja
    pasar. Detectarlo exigiría saber que los extractos son continuos, y un
    extracto no trae esa promesa. Queda dicho aquí en vez de fingir que se
    comprueba.
  */
  select min(s.desde), max(s.hasta) into v_primero, v_ultimo
    from bank_statements s where s.cash_account_id = p_account;

  if v_primero is null then
    raise exception
      'sin_extracto: esta cuenta no tiene ningún extracto importado. Cerrar sin extracto sería decir que cuadra con algo que nadie miró';
  end if;

  if p_hasta < v_primero or p_hasta > v_ultimo then
    raise exception
      'sin_extracto: los extractos de esta cuenta van del % al %, y quieres cerrar hasta el %. Fuera de ese rango no hay nada importado con lo que cuadrar',
      to_char(v_primero, 'DD/MM/YYYY'), to_char(v_ultimo, 'DD/MM/YYYY'),
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
