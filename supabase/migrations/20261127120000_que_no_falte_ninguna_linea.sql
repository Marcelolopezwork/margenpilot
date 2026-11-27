-- ============================================================================
-- F4-4 · Que no falte ninguna línea
--
-- El caso más silencioso de toda la conciliación: **un archivo cortado**.
-- Descargas el extracto, el navegador trunca la descarga o eliges mal el rango
-- de fechas, e importas veinte líneas de las treinta que hubo. Las veinte
-- cuadran una por una. Cada emparejamiento es correcto. Puedes cerrar el
-- periodo y afirmar que todo está explicado, y será mentira: lo que falta no
-- protesta, porque lo que falta no está.
--
-- Lo que lo detecta no son las líneas: es la **aritmética del propio banco**.
-- Un extracto trae su saldo inicial y su saldo final, y entre los dos tiene
-- que caber exactamente la suma de sus movimientos:
--
--     saldo_final − saldo_inicial = Σ abonos − Σ cargos
--
-- Si no cabe, falta o sobra algo, y la diferencia dice cuánto. Esto es
-- INV-8.12 y tiene tres reglas:
--
--  1. **Los saldos son opcionales; la comprobación, no.** Hay extractos que no
--     los traen —un CSV de movimientos sueltos— y obligar a inventarlos sería
--     peor que no comprobar: un saldo inventado hace cuadrar cualquier cosa.
--     Sin saldos, `diferencia` queda **nula**, que significa «no se pudo
--     comprobar», y no cero, que significaría «comprobado y cuadra».
--  2. **Un extracto descuadrado se importa igual.** Rechazarlo dejaría al
--     usuario sin sus líneas y sin saber por qué; lo que no puede hacer es
--     pasar por bueno. Entra marcado, y la pantalla lo dice con la cifra
--     dentro.
--  3. **Y bloquea el cierre.** Cerrar es afirmar que hasta una fecha todo lo
--     del banco está explicado (INV-8.8). Con un extracto que no cuadra
--     consigo mismo, esa afirmación no se puede hacer: no es que falte
--     emparejar una línea, es que no se sabe cuántas líneas hubo.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Tres columnas en el extracto
-- ---------------------------------------------------------------------------

alter table bank_statements
  add column saldo_inicial numeric(18, 2),
  add column saldo_final   numeric(18, 2),
  /* Lo que el banco dice que se movió menos lo que dicen sus líneas. Nula
     cuando no se pudo comprobar; cero cuando cuadra al céntimo. */
  add column diferencia    numeric(18, 2),
  /* Los dos saldos van juntos o no van: con uno solo no hay nada que
     comprobar, y guardarlo suelto invita a creer que sí. */
  add constraint los_saldos_van_juntos check (
    (saldo_inicial is null) = (saldo_final is null)
  ),
  add constraint la_diferencia_necesita_saldos check (
    diferencia is null or saldo_inicial is not null
  );

comment on column bank_statements.saldo_inicial is
  'El saldo con el que abre el extracto, según el banco. Nulo si el archivo no lo trae.';
comment on column bank_statements.saldo_final is
  'El saldo con el que cierra, según el banco. Nulo si el archivo no lo trae.';
comment on column bank_statements.diferencia is
  'saldo_final - saldo_inicial - (abonos - cargos). Nula = no comprobado; 0 = cuadra (INV-8.12).';

-- ---------------------------------------------------------------------------
-- Importar, ahora con la comprobación dentro
-- ---------------------------------------------------------------------------
--
-- La firma vieja se tira antes de crear la nueva: añadir parámetros con valor
-- por defecto **crea una sobrecarga**, no reemplaza nada, y entonces hay dos
-- funciones con el mismo nombre y PostgREST elige por los argumentos que le
-- manden. La pantalla nueva mandaría los saldos y la vieja seguiría ahí,
-- importando sin comprobar nada, para cualquiera que no los mande.

drop function if exists importar_extracto(uuid, text, jsonb);

create or replace function importar_extracto(
  p_account       uuid,
  p_label         text,
  p_lines         jsonb,
  p_saldo_inicial numeric default null,
  p_saldo_final   numeric default null
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
  v_neto    numeric;
  v_dif     numeric;
  v_cerrado date;
  v_viejas  int;
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

  if (p_saldo_inicial is null) <> (p_saldo_final is null) then
    raise exception
      'saldos_a_medias: para comprobar que no falta ninguna línea hacen falta los dos saldos, el inicial y el final. Con uno solo no hay nada que comparar; sin ninguno se importa igual, pero sin comprobar';
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

  /*
    INV-8.8.5 · nada por debajo del cierre, o el cierre deja de significar que
    todo lo anterior está resuelto.

    Esto ya estaba en esta función desde F6-2, y la primera versión de esta
    migración lo perdió por copiar el cuerpo de F6-1. La aserción que lo
    vigilaba llevaba escrita dos días y lo cazó en la CI: **reescribir una
    función entera es heredar todo lo que le habían añadido, y lo único que
    sabe cuánto era es la prueba.**
  */
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

  /*
    La aritmética del banco. Se hace sobre el mismo redondeo con el que se van
    a guardar las líneas, no sobre los decimales que trajera el archivo: si se
    comparara contra el valor sin redondear, un extracto correcto con tres
    decimales daría una diferencia de céntimos y la comprobación se volvería
    ruido que nadie mira.
  */
  if p_saldo_inicial is not null then
    select coalesce(sum(round((e.item->>'importe')::numeric, v_dec)), 0)
      into v_neto
      from jsonb_array_elements(p_lines) as e(item);
    v_dif := round(p_saldo_final - p_saldo_inicial - v_neto, v_dec);
  end if;

  insert into bank_statements (
    organization_id, legal_entity_id, cash_account_id, currency_code,
    label, desde, hasta, lineas, source_sha256, saldo_inicial, saldo_final, diferencia)
  values (
    v_cuenta.organization_id, v_cuenta.legal_entity_id, p_account, v_cuenta.currency_code,
    btrim(p_label), v_desde, v_hasta, v_cuantas, v_sha,
    round(p_saldo_inicial, v_dec), round(p_saldo_final, v_dec), v_dif)
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

comment on function importar_extracto(uuid, text, jsonb, numeric, numeric) is
  'Guarda un extracto y sus líneas tal como vinieron, y comprueba contra los saldos del banco que no falte ninguna (INV-8, INV-8.12).';

revoke all on function importar_extracto(uuid, text, jsonb, numeric, numeric) from public, anon;
grant execute on function importar_extracto(uuid, text, jsonb, numeric, numeric) to authenticated;

-- ---------------------------------------------------------------------------
-- Y el cierre aprende a negarse
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
  v_mal     record;
begin
  select a.* into v_cuenta from cash_accounts a where a.id = p_account;

  if v_cuenta.id is null or not app.can_write_money(v_cuenta.organization_id) then
    raise exception 'cuenta_no_encontrada: esa cuenta no existe o no es de tu organización';
  end if;

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

  /*
    Un extracto que no cuadra consigo mismo invalida el cierre entero del
    periodo que toca. No es «falta emparejar una línea»: es que no se sabe
    cuántas líneas hubo, así que ninguna afirmación sobre ese periodo se
    sostiene (INV-8.12.3).
  */
  select s.label, s.diferencia, s.desde, s.hasta into v_mal
    from bank_statements s
   where s.cash_account_id = p_account
     and s.desde <= p_hasta
     and s.diferencia is not null
     and s.diferencia <> 0
   order by s.desde
   limit 1;

  if v_mal.label is not null then
    raise exception
      'extracto_descuadrado: el extracto «%» (del % al %) no cuadra con sus propios saldos: sobran o faltan % de movimiento. Mientras no se sepa cuántas líneas hubo, cerrar el periodo no afirma nada. Vuelve a descargarlo completo y reimpórtalo',
      v_mal.label, to_char(v_mal.desde, 'DD/MM/YYYY'), to_char(v_mal.hasta, 'DD/MM/YYYY'),
      abs(v_mal.diferencia);
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
  'Afirma que una cuenta está cuadrada con su banco hasta una fecha, y se niega si no lo está: líneas sueltas, fuera de rango, hacia el futuro o un extracto que no cuadra consigo mismo (INV-8.8, INV-8.12).';
