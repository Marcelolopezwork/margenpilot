-- ===========================================================================
-- UN SOLO ARCHIVO para pegar en Supabase → SQL Editor y pulsar Run.
--
-- Generado por supabase/seed/armar.sh. No se edita a mano.
--
-- Hace tres cosas, en este orden y en una sola pasada:
--
--  1. aplica la migración que falta en el proyecto —la comprobación de que
--     un extracto no venga cortado (F4-4)— y la deja apuntada en el
--     historial para que no se vuelva a aplicar;
--  2. borra la organización «Margen Demo» si existe de una pasada anterior,
--     para volver a crearla con los datos nuevos. Esto NO toca «Margen
--     Pilot»: borra una sola fila, la de la demo, y lo demás cae por cascada;
--  3. vuelve a crear «Margen Demo» con datos de prueba en todo: sus trabajos
--     con dos compras atribuidas, dos previstos de una sola vez —uno
--     adelantado a medias— y un extracto de banco de tres líneas con sus
--     saldos declarados: una cuadrada y dos que no están en el libro.
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

-- Queda apuntada en el historial: si no, un despliegue futuro intentaría
-- aplicarla otra vez y fallaría a mitad.
insert into supabase_migrations.schema_migrations (version, name)
values ('20261127120000', 'que_no_falte_ninguna_linea')
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
                         'descripcion', 'ITF / IMPUESTO A LAS TRANSACCIONES')),
    -- Con los dos saldos del banco: 2.000 − 167,50 = 1.832,50. Cuadra al
    -- céntimo, así que el extracto entra comprobado y el periodo se podrá
    -- cerrar en cuanto no queden líneas sueltas (INV-8.12).
    2000.00, 1832.50);

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
