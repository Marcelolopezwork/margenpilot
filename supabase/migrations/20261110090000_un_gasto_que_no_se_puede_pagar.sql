-- ---------------------------------------------------------------------------
-- Margen Pilot · F3-3b · El gasto que no se podía pagar
-- ---------------------------------------------------------------------------
--
-- Marcelo cargó «Claude Code», 200 USD al mes, eligiendo el costo del catálogo
-- —que está en dólares— y dejando como empresa que lo paga a 3 Brothers MKT
-- SAC, que solo tiene una cuenta en soles. En el grupo no existe ninguna
-- cuenta en dólares de 3 Brothers: la única cuenta en USD es Mercury, y es de
-- The Publisher Ventures LLC.
--
-- Ese gasto era, por construcción, imposible de pagar. Y al intentarlo, la
-- clave compuesta de `cash_movements` hizo su trabajo —el dinero no cruza de
-- un libro a otro (ADR-16)— pero lo hizo como violación de clave ajena, que
-- llega a la pantalla traducida a «falta un dato relacionado, o el que
-- elegiste ya no existe». Es verdad y es inútil: no dice qué dato, ni por qué.
--
-- La regla de la que sale esta migración: **una restricción estructural
-- impide, y una puerta explica.** La clave compuesta es la que garantiza que
-- la fila imposible no exista ni por error de programación nuestro; pero
-- cuando el que se equivoca es el usuario, el que tiene que contestar es el
-- gate, con los nombres y las monedas dentro del mensaje. Dejar que el error
-- lo dé la restricción es correcto y es maleducado.
--
-- Y un segundo arreglo, que es el que de verdad lo desatasca: la empresa y la
-- moneda de un gasto no se podían cambiar nunca. El motivo era bueno —un
-- movimiento ya registrado apunta al gasto por sus cuatro columnas— pero la
-- prohibición era más ancha que el motivo. Mientras ningún movimiento apunte
-- al gasto no hay enlace que romper, y ese es exactamente el caso de un gasto
-- que nunca se pudo pagar. Ahora la regla se mide: se prohíbe cuando hay
-- pagos, y entonces el mensaje dice cuántos.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- `registrar_movimiento` · explica por qué ese gasto no se paga desde ahí
-- ---------------------------------------------------------------------------

drop function if exists registrar_movimiento(uuid, cash_direction, numeric, text, date, cash_kind, uuid, uuid, text, numeric, numeric, uuid);

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
  p_recurring    uuid default null
) returns setof cash_movements
language plpgsql security definer set search_path = public, pg_temp as $$
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
    description, external_ref, amount_net, amount_tax, source, recurring_expense_id)
  values (
    v_cuenta.organization_id, p_account, v_cuenta.legal_entity_id, p_direction, v_importe,
    v_cuenta.currency_code, coalesce(p_value_date, current_date), p_kind, p_category,
    case when p_client is not null then 'client' else null end, p_client,
    btrim(p_description), nullif(btrim(coalesce(p_external_ref, '')), ''),
    v_neto, v_imp,
    case when p_kind = 'opening' then 'opening'
         when p_recurring is not null then 'recurring'
         else 'manual' end,
    p_recurring)
  returning id into v_mov;

  return query select * from cash_movements where id = v_mov;
end $$;

comment on function registrar_movimiento(uuid, cash_direction, numeric, text, date, cash_kind, uuid, uuid, text, numeric, numeric, uuid) is
  'Alta manual en el libro de caja. Con p_recurring, marca qué gasto fijo salda y explica por qué no, si no puede (F3-1, F3-3).';

revoke all on function registrar_movimiento(uuid, cash_direction, numeric, text, date, cash_kind, uuid, uuid, text, numeric, numeric, uuid) from public, anon;
grant execute on function registrar_movimiento(uuid, cash_direction, numeric, text, date, cash_kind, uuid, uuid, text, numeric, numeric, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- `guardar_gasto_recurrente` · mudarse se prohíbe cuando hay algo que romper
-- ---------------------------------------------------------------------------

create or replace function guardar_gasto_recurrente(
  p_entity    uuid,
  p_label     text,
  p_amount    numeric,
  p_currency  char(3),
  p_id        uuid default null,
  p_cadence   recurrence default 'monthly',
  p_starts_on date default null,
  p_day       int default null,
  p_ends_on   date default null,
  p_account   uuid default null,
  p_category  uuid default null,
  p_cost_item uuid default null,
  p_notes     text default null
) returns setof recurring_expenses
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org    uuid;
  v_dec    int;
  v_importe numeric;
  v_id     uuid;
  v_antes  record;
  v_cuenta record;
  v_pagos  int;
  v_suya   text;
begin
  select e.organization_id into v_org
    from legal_entities e where e.id = p_entity;

  if v_org is null then
    raise exception 'entidad_no_encontrada: esa empresa no existe';
  end if;

  if not app.can_write_money(v_org) then
    raise exception 'entidad_no_encontrada: esa empresa no existe o no es de tu organización';
  end if;

  if btrim(coalesce(p_label, '')) = '' then
    raise exception 'etiqueta_obligatoria: un gasto recurrente necesita un nombre para reconocerlo en el extracto';
  end if;

  select c.minor_units into v_dec from currencies c where c.code = p_currency;
  if v_dec is null then
    raise exception 'unknown_currency: esa moneda no existe en el catálogo';
  end if;

  v_importe := round(coalesce(p_amount, 0), v_dec);
  if v_importe <= 0 then
    raise exception 'importe_invalido: el importe tiene que ser mayor que cero';
  end if;

  -- La cuenta de la que sale es opcional, pero si se dice, tiene que poder
  -- pagarlo: misma empresa y misma moneda. Esto lo impide igual la clave
  -- compuesta; aquí se dice con nombres, que es lo que se puede corregir.
  if p_account is not null then
    select a.* into v_cuenta from cash_accounts a where a.id = p_account;

    if v_cuenta.id is null or v_cuenta.organization_id <> v_org then
      raise exception 'cuenta_no_encontrada: esa cuenta no existe o no es de tu organización';
    end if;

    if v_cuenta.legal_entity_id <> p_entity or v_cuenta.currency_code <> p_currency then
      select e.legal_name into v_suya from legal_entities e where e.id = p_entity;
      raise exception
        'cuenta_de_otro_libro: % es una cuenta de otro libro y este gasto lo paga % en %. De una cuenta solo sale el dinero de su empresa y en su moneda',
        v_cuenta.name, v_suya, p_currency;
    end if;
  end if;

  if p_id is null then
    insert into recurring_expenses (
      organization_id, legal_entity_id, label, amount, currency_code, cadence,
      day_of_month, starts_on, ends_on, category_id, cash_account_id,
      cost_item_id, notes)
    values (
      v_org, p_entity, btrim(p_label), v_importe, p_currency, p_cadence,
      p_day, coalesce(p_starts_on, current_date), p_ends_on, p_category, p_account,
      p_cost_item, nullif(btrim(coalesce(p_notes, '')), ''))
    returning id into v_id;
  else
    select r.* into v_antes from recurring_expenses r where r.id = p_id for update;

    if v_antes.id is null then
      raise exception 'gasto_no_encontrado: ese gasto recurrente no existe';
    end if;

    if v_antes.organization_id <> v_org then
      raise exception 'gasto_no_encontrado: ese gasto recurrente no es de tu organización';
    end if;

    -- Cambiar la empresa o la moneda dejaría huérfano el enlace de los
    -- movimientos ya registrados, que apuntan al gasto por las cuatro
    -- columnas. Pero solo si hay movimientos: mientras no haya ninguno no hay
    -- nada que romper, y prohibirlo obligaba a archivar y volver a crear un
    -- gasto que nunca movió un céntimo.
    if v_antes.legal_entity_id <> p_entity or v_antes.currency_code <> p_currency then
      select count(*) into v_pagos
        from cash_movements m where m.recurring_expense_id = p_id;

      if v_pagos > 0 then
        raise exception
          'gasto_no_se_muda: «%» ya tiene % pago(s) registrado(s), que lo señalan con su empresa y su moneda dentro. Archívalo y crea el nuevo: eso es además lo que de verdad pasó',
          v_antes.label, v_pagos;
      end if;
    end if;

    update recurring_expenses
       set legal_entity_id = p_entity,
           currency_code = p_currency,
           label = btrim(p_label),
           amount = v_importe,
           cadence = p_cadence,
           day_of_month = p_day,
           starts_on = coalesce(p_starts_on, starts_on),
           ends_on = p_ends_on,
           category_id = p_category,
           cash_account_id = p_account,
           cost_item_id = p_cost_item,
           notes = nullif(btrim(coalesce(p_notes, '')), '')
     where id = p_id;

    v_id := p_id;
  end if;

  return query select * from recurring_expenses where id = v_id;
end $$;

comment on function guardar_gasto_recurrente(uuid, text, numeric, char, uuid, recurrence, date, int, date, uuid, uuid, uuid, text) is
  'Crea o edita un gasto fijo. Es una regla de proyección, no un movimiento: no mueve dinero. Su empresa y su moneda se cambian mientras no tenga pagos (F3-3).';

revoke all on function guardar_gasto_recurrente(uuid, text, numeric, char, uuid, recurrence, date, int, date, uuid, uuid, uuid, text) from public, anon;
grant execute on function guardar_gasto_recurrente(uuid, text, numeric, char, uuid, recurrence, date, int, date, uuid, uuid, uuid, text) to authenticated;
