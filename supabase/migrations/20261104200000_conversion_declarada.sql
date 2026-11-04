-- ============================================================================
-- Margen Pilot · INV-10 · La conversión se declara, no se adivina
--
-- Va en un disparador y no en cada sitio que inserte un costo: así no hay
-- forma de meter una cifra en otra moneda sin que quede escrito de dónde
-- salió. Si no hay tasa, la operación falla; inventarse una sería peor.
-- ============================================================================

create or replace function app.tipo_de_cambio(p_org uuid, p_from char(3), p_to char(3))
returns table (tasa numeric, fecha date)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if p_from = p_to then
    return query select 1::numeric, current_date;
    return;
  end if;

  return query
  select f.rate, f.as_of
  from fx_rates f
  where (f.organization_id = p_org or f.organization_id is null)
    and f.from_code = p_from and f.to_code = p_to
  order by f.as_of desc, (f.organization_id is not null) desc
  limit 1;
  if found then return; end if;

  -- La inversa de una tasa declarada sigue siendo una tasa declarada.
  return query
  select round(1 / f.rate, 8), f.as_of
  from fx_rates f
  where (f.organization_id = p_org or f.organization_id is null)
    and f.from_code = p_to and f.to_code = p_from and f.rate <> 0
  order by f.as_of desc, (f.organization_id is not null) desc
  limit 1;
end $$;

revoke all on function app.tipo_de_cambio(uuid, char, char) from public;

create or replace function app.convertir_costo_de_linea() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_moneda char(3);
  v_tasa   numeric;
  v_fecha  date;
begin
  select q.currency_code into v_moneda
  from quote_lines l join quotes q on q.id = l.quote_id
  where l.id = new.quote_line_id;

  -- Sin moneda de origen declarada, se asume la de la cotización.
  if new.source_currency is null then
    new.source_currency  := v_moneda;
    new.source_unit_cost := new.unit_cost;
  end if;
  if new.source_unit_cost is null then
    new.source_unit_cost := new.unit_cost;
  end if;

  if new.source_currency = v_moneda then
    new.unit_cost := new.source_unit_cost;
    new.fx_rate   := null;
    new.fx_as_of  := null;
    return new;
  end if;

  select t.tasa, t.fecha into v_tasa, v_fecha
  from app.tipo_de_cambio(new.organization_id, new.source_currency, v_moneda) t;

  if v_tasa is null then
    raise exception 'no_fx_rate: no hay tipo de cambio de % a %', new.source_currency, v_moneda
      using errcode = 'check_violation';
  end if;

  new.unit_cost := round(new.source_unit_cost * v_tasa, 4);
  new.fx_rate   := v_tasa;
  new.fx_as_of  := v_fecha;
  return new;
end $$;

revoke all on function app.convertir_costo_de_linea() from public;

create trigger quote_line_costs_convertir
  before insert or update of source_unit_cost, source_currency, unit_cost on quote_line_costs
  for each row execute function app.convertir_costo_de_linea();
