-- ============================================================================
-- Margen Pilot · F2-4 y F2-7 · Una línea desde una ficha de servicio
--
-- Es el flujo del cotizador que Marcelo ya usaba: eliges el servicio, llegan
-- sus costos, pones el fee y el precio sale solo.
--
-- Va en la base y no en el navegador porque son tres pasos —crear la línea,
-- copiar sus costos, calcular el precio— y a medias no sirven de nada: una
-- línea sin costos miente diciendo que su margen es del 100 %.
-- ============================================================================

create or replace function add_quote_line_from_service(
  p_quote uuid,
  p_service uuid,
  p_quantity numeric default 1
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org    uuid;
  v_moneda char(3);
  v_fee    numeric;
  v_linea  uuid;
  v_costo  numeric;
  v_sort   int;
  v_ajena  text;
begin
  select organization_id, currency_code into v_org, v_moneda from quotes where id = p_quote;
  if v_org is null then
    raise exception 'unknown_quote: esa cotización no existe' using errcode = 'check_violation';
  end if;

  if not exists (select 1 from memberships
                 where organization_id = v_org and user_id = auth.uid() and status = 'active') then
    raise exception 'not_authenticated' using errcode = 'insufficient_privilege';
  end if;

  select default_fee_pct into v_fee
  from services where id = p_service and organization_id = v_org and is_active;
  if v_fee is null then
    raise exception 'unknown_service: esa ficha no existe en esta organización'
      using errcode = 'check_violation';
  end if;

  -- Dos monedas no se mezclan nunca. Si la ficha tiene costos en otra moneda,
  -- copiarlos sería inventarse una conversión.
  select string_agg(distinct l.currency_code, ', ') into v_ajena
  from service_cost_lines l
  where l.service_id = p_service and l.currency_code <> v_moneda;
  if v_ajena is not null then
    raise exception 'currency_mismatch: la ficha tiene costos en % y la cotización va en %',
      v_ajena, v_moneda using errcode = 'check_violation';
  end if;

  select coalesce(max(sort), 0) + 10 into v_sort from quote_lines where quote_id = p_quote;

  insert into quote_lines (organization_id, quote_id, service_id, description,
                           quantity, unit_price, fee_pct, sort)
  select v_org, p_quote, p_service, s.name, p_quantity, 0, s.default_fee_pct, v_sort
  from services s where s.id = p_service
  returning id into v_linea;

  -- Se copia el costo de hoy, no se apunta al catálogo.
  insert into quote_line_costs (organization_id, quote_line_id, cost_item_id, label,
                                quantity, unit_cost, unit, sort)
  select v_org, v_linea, l.cost_item_id, coalesce(l.label, ci.name, 'Costo'),
         l.quantity, l.unit_cost, l.unit, l.sort
  from service_cost_lines l
  left join cost_items ci on ci.id = l.cost_item_id
  where l.service_id = p_service and l.organization_id = v_org;

  select coalesce(sum(quantity * unit_cost), 0) into v_costo
  from quote_line_costs where quote_line_id = v_linea and is_active;

  update quote_lines set unit_price = round(v_costo * (1 + v_fee / 100), 4) where id = v_linea;

  return v_linea;
end $$;

-- Recalcula el precio de una línea cuando cambian sus costos o su fee.
-- Si la línea tiene el precio puesto a mano (fee_pct nulo), no toca nada.
create or replace function recalc_quote_line_price(p_line uuid) returns numeric
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid; v_fee numeric; v_costo numeric; v_precio numeric;
begin
  select organization_id, fee_pct into v_org, v_fee from quote_lines where id = p_line;
  if v_org is null then
    raise exception 'unknown_line: esa línea no existe' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from memberships
                 where organization_id = v_org and user_id = auth.uid() and status = 'active') then
    raise exception 'not_authenticated' using errcode = 'insufficient_privilege';
  end if;
  if v_fee is null then
    return (select unit_price from quote_lines where id = p_line);
  end if;

  select coalesce(sum(quantity * unit_cost), 0) into v_costo
  from quote_line_costs where quote_line_id = p_line and is_active;

  v_precio := round(v_costo * (1 + v_fee / 100), 4);
  update quote_lines set unit_price = v_precio where id = p_line;
  return v_precio;
end $$;

revoke all on function add_quote_line_from_service(uuid, uuid, numeric) from public, anon;
revoke all on function recalc_quote_line_price(uuid) from public, anon;
grant execute on function add_quote_line_from_service(uuid, uuid, numeric) to authenticated;
grant execute on function recalc_quote_line_price(uuid) to authenticated;
