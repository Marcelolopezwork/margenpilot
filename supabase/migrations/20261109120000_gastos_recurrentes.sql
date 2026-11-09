-- ---------------------------------------------------------------------------
-- Margen Pilot · F3-3 · Lo que sale todos los meses
-- ---------------------------------------------------------------------------
--
-- La proyección de trece semanas que entró el 6/11 solo tenía entradas, y la
-- pantalla lo decía en voz alta: «optimista por construcción». Esto la cierra
-- por el lado de las salidas fijas.
--
-- En la base real hay once herramientas activas en el catálogo de costos
-- —Claude Code 200 USD/mes, la suite de diseño, el hosting, TLDV, ChatGPT— y
-- ninguna estaba en la proyección. Son exactamente la diferencia entre «entra
-- dinero en la semana 4» y «entra dinero en la semana 4 y además pago 544».
--
-- La decisión que ordena esta tabla: **un gasto recurrente es una regla, no
-- dinero.** No crea movimientos. Si los creara, el saldo de la cuenta diría
-- que pagaste el hosting de diciembre el 1 de diciembre aunque el banco no lo
-- haya cobrado todavía, y eso rompe INV-1, que es lo único que sostiene todo
-- lo financiero. Igual que una cuota prevista no es cartera, un gasto
-- recurrente no es una salida: es una salida *esperada*.
--
-- Cuando se paga de verdad, se registra un movimiento como cualquier otro y se
-- le dice de qué gasto era (`recurring_expense_id`). Eso es lo que permite que
-- la proyección deje de contar el mes que ya está pagado, en vez de
-- enseñártelo dos veces.
--
-- Por qué la entidad es obligatoria aunque una suscripción sea «compartida»:
-- un costo del catálogo puede no tener empresa, porque es un precio unitario
-- que se usa al cotizar desde las dos. Un gasto recurrente, no: alguien lo
-- paga, y sale de una cuenta concreta de una empresa concreta. Si se reparte
-- entre las dos, son dos gastos. La alternativa —una entidad nula— obligaría a
-- inventar de qué libro sale el dinero, que es justo lo que ADR-16 prohíbe.
-- ---------------------------------------------------------------------------

create type recurrence as enum ('weekly', 'monthly', 'quarterly', 'yearly');

-- Para poder atar un gasto recurrente a su ficha del catálogo. Solo por
-- organización: un costo compartido no tiene entidad (ver la migración
-- 20261104190000), así que la clave no puede incluirla.
alter table cost_items
  add constraint cost_items_id_org_key unique (id, organization_id);

create table recurring_expenses (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  legal_entity_id uuid not null,
  label           text not null check (btrim(label) <> ''),
  amount          numeric(18, 2) not null check (amount > 0),
  currency_code   char(3) not null references currencies (code),
  cadence         recurrence not null default 'monthly',

  -- El día del mes en que se cobra. Nulo = el mismo día que `starts_on`. Un 31
  -- en febrero se recorta al último día del mes: no se salta el pago.
  day_of_month    int check (day_of_month between 1 and 31),

  starts_on       date not null,
  ends_on         date,

  category_id     uuid,
  -- De dónde sale normalmente. Opcional: puede no estar decidido todavía, y
  -- la clave compuesta no se comprueba cuando una de sus columnas es nula.
  cash_account_id uuid,
  -- Su ficha en el catálogo de costos, si la tiene. Sirve para no teclear dos
  -- veces lo mismo y para que el día que suba el precio se vea en los dos
  -- sitios que hay que tocarlo.
  cost_item_id    uuid,

  is_active       boolean not null default true,
  notes           text,
  created_by      uuid not null default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint vigencia_coherente check (ends_on is null or ends_on >= starts_on),

  foreign key (legal_entity_id, organization_id)
    references legal_entities (id, organization_id) on delete cascade,
  foreign key (cash_account_id, organization_id, legal_entity_id, currency_code)
    references cash_accounts (id, organization_id, legal_entity_id, currency_code),
  foreign key (category_id, organization_id)
    references financial_categories (id, organization_id),
  foreign key (cost_item_id, organization_id)
    references cost_items (id, organization_id),

  constraint recurring_expenses_id_org_entidad_moneda_key
    unique (id, organization_id, legal_entity_id, currency_code)
);

create index recurring_expenses_proyeccion_idx
  on recurring_expenses (organization_id, is_active, starts_on);

create trigger recurring_expenses_touch before update on recurring_expenses
  for each row execute function app.touch_updated_at();
create trigger recurring_expenses_audit
  after insert or update or delete on recurring_expenses
  for each row execute function app.audit_changes();

-- Un movimiento puede decir de qué gasto recurrente era. Es lo que hace que
-- la proyección deje de contar el mes ya pagado.
alter table cash_movements add column recurring_expense_id uuid;
alter table cash_movements
  add constraint cash_movements_recurrente_fkey
  foreign key (recurring_expense_id, organization_id, legal_entity_id, currency_code)
  references recurring_expenses (id, organization_id, legal_entity_id, currency_code);

create index cash_movements_recurrente_idx
  on cash_movements (recurring_expense_id, value_date)
  where recurring_expense_id is not null;

-- ---------------------------------------------------------------------------
-- Permisos · se lee, no se escribe
-- ---------------------------------------------------------------------------

grant select on recurring_expenses to authenticated;

alter table recurring_expenses enable row level security;
alter table recurring_expenses force  row level security;

create policy recurring_expenses_select on recurring_expenses for select
  using (organization_id in (select app.current_orgs())
         and app.can_write_money(organization_id));

-- ---------------------------------------------------------------------------
-- La puerta · alta y edición
-- ---------------------------------------------------------------------------
--
-- Una sola función para crear y para editar: con `p_id` nulo inserta, y con
-- `p_id` actualiza. La moneda y la entidad no se pueden cambiar después de
-- crearlo, porque un movimiento ya registrado apunta al gasto con su entidad y
-- su moneda dentro de la clave: cambiarlas rompería ese enlace. Mover un gasto
-- de empresa es archivar uno y crear otro, que además es lo que de verdad
-- pasó.

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
    -- columnas. Se dice en vez de romperlo en silencio.
    if v_antes.legal_entity_id <> p_entity or v_antes.currency_code <> p_currency then
      raise exception
        'gasto_no_se_muda: la empresa y la moneda de un gasto no se cambian; archívalo y crea el nuevo';
    end if;

    update recurring_expenses
       set label = btrim(p_label),
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
  'Crea o edita un gasto fijo. Es una regla de proyección, no un movimiento: no mueve dinero (F3-3).';

revoke all on function guardar_gasto_recurrente(uuid, text, numeric, char, uuid, recurrence, date, int, date, uuid, uuid, uuid, text) from public, anon;
grant execute on function guardar_gasto_recurrente(uuid, text, numeric, char, uuid, recurrence, date, int, date, uuid, uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- La puerta · archivar
-- ---------------------------------------------------------------------------
--
-- No se borra, se archiva. Un gasto que ya tiene movimientos atados es
-- historia, y además la proyección de meses pasados tiene que seguir
-- explicándose. Archivar lo saca de la proyección desde hoy y lo deja donde
-- estaba.

create or replace function archivar_gasto_recurrente(p_id uuid, p_motivo text default null)
returns setof recurring_expenses
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_gasto record;
begin
  select r.* into v_gasto from recurring_expenses r where r.id = p_id for update;

  if v_gasto.id is null then
    raise exception 'gasto_no_encontrado: ese gasto recurrente no existe';
  end if;

  if not app.can_write_money(v_gasto.organization_id) then
    raise exception 'gasto_no_encontrado: ese gasto recurrente no existe o no es de tu organización';
  end if;

  update recurring_expenses
     set is_active = not v_gasto.is_active,
         ends_on = case
                     when v_gasto.is_active then coalesce(v_gasto.ends_on, current_date)
                     else null
                   end,
         notes = coalesce(nullif(btrim(coalesce(p_motivo, '')), ''), v_gasto.notes)
   where id = p_id;

  return query select * from recurring_expenses where id = p_id;
end $$;

comment on function archivar_gasto_recurrente(uuid, text) is
  'Archiva o reactiva un gasto fijo. Archivar le pone fecha de fin y lo saca de la proyección (F3-3).';

revoke all on function archivar_gasto_recurrente(uuid, text) from public, anon;
grant execute on function archivar_gasto_recurrente(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- `registrar_movimiento` aprende a decir de qué gasto era
-- ---------------------------------------------------------------------------
--
-- Se tira y se vuelve a crear con un parámetro más, en vez de dejar una
-- sobrecarga: dos funciones con el mismo nombre y distinto número de
-- argumentos son una ambigüedad esperando a que PostgREST elija la que no
-- toca. Los nombres de los parámetros viejos no cambian y el nuevo tiene
-- valor por defecto, así que el build que ya está publicado sigue llamándola
-- igual sin enterarse (trampa #10).

drop function if exists registrar_movimiento(uuid, cash_direction, numeric, text, date, cash_kind, uuid, uuid, text, numeric, numeric);

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

  -- Un gasto recurrente solo se paga; no se cobra. Marcar una entrada como
  -- pago de una suscripción dejaría la proyección creyendo que ese mes está
  -- saldado con dinero que entró.
  if p_recurring is not null and p_direction <> 'out' then
    raise exception 'recurrente_solo_sale: un gasto recurrente se paga, no se cobra';
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
  'Alta manual en el libro de caja. Con p_recurring, marca qué gasto fijo salda (F3-1, F3-3).';

revoke all on function registrar_movimiento(uuid, cash_direction, numeric, text, date, cash_kind, uuid, uuid, text, numeric, numeric, uuid) from public, anon;
grant execute on function registrar_movimiento(uuid, cash_direction, numeric, text, date, cash_kind, uuid, uuid, text, numeric, numeric, uuid) to authenticated;
