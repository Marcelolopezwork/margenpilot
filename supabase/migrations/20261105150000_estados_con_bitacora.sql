-- ---------------------------------------------------------------------------
-- Margen Pilot · F2-10 · Estados con bitácora
-- ---------------------------------------------------------------------------
--
-- Hasta hoy el estado de una cotización era un desplegable: cualquiera podía
-- pasar un borrador a «aprobada» sin que hubiera salido nunca, y no quedaba
-- rastro de quién lo hizo ni cuándo. Las dos cosas se arreglan aquí, y
-- ninguna en la interfaz:
--
--   1. Se le quita a `authenticated` el permiso de escribir la columna
--      `status`. No es que la pantalla no lo ofrezca: es que la base no lo
--      acepta. El único camino son las funciones de abajo.
--   2. Un disparador valida la transición y escribe la bitácora. Como la
--      bitácora la escribe él y no quien llama, no hay forma de cambiar un
--      estado sin dejar la fila.
--
-- La máquina es la de `docs/ARCHITECTURE.md` §4.2:
--
--   borrador ──▶ enviada ──▶ en negociación ──▶ aprobada
--      │            │              │                │
--      │            └──────────────┴──▶ rechazada   └──▶ anulada
--      └──▶ anulada                     vencida
--
-- `anulada` es terminal y exige motivo. `aprobada` solo puede anularse: una
-- cotización que el cliente aceptó no vuelve a estar en discusión, se emite
-- otra.
-- ---------------------------------------------------------------------------

create table quote_events (
  id              bigserial primary key,
  organization_id uuid not null references organizations (id) on delete cascade,
  quote_id        uuid not null references quotes (id) on delete cascade,
  at              timestamptz not null default now(),
  -- Nulo = lo cambió el sistema, no una persona. Pasa en una corrección hecha
  -- con la clave de servicio, y mentir poniendo un usuario sería peor.
  actor_id        uuid,
  from_status     quote_status,
  to_status       quote_status,
  action          text not null,
  note            text
);

comment on table quote_events is
  'Bitácora de la cotización. La escribe un disparador, no la aplicación: así ningún cambio de estado puede quedar sin registrar.';

create index quote_events_quote_idx on quote_events (quote_id, at desc);

-- ---------------------------------------------------------------------------
-- Qué transición es legal
-- ---------------------------------------------------------------------------

create or replace function app.transicion_de_cotizacion(p_from quote_status, p_to quote_status)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select case p_from
    when 'draft'       then p_to in ('sent', 'void')
    -- 'sent' → 'sent' es la reemisión: produce otra versión y es legal.
    when 'sent'        then p_to in ('sent', 'negotiation', 'approved', 'rejected', 'expired', 'void')
    when 'negotiation' then p_to in ('sent', 'approved', 'rejected', 'expired', 'void')
    when 'approved'    then p_to = 'void'
    when 'rejected'    then p_to in ('sent', 'void')
    when 'expired'     then p_to in ('sent', 'void')
    when 'void'        then false
  end;
$$;

revoke all on function app.transicion_de_cotizacion(quote_status, quote_status) from public, anon;
grant execute on function app.transicion_de_cotizacion(quote_status, quote_status) to authenticated;

-- ---------------------------------------------------------------------------
-- El disparador que valida y anota
-- ---------------------------------------------------------------------------
--
-- El motivo y la acción viajan en ajustes locales de la transacción y no en
-- parámetros, porque un disparador no recibe parámetros. Los pone la función
-- que cambia el estado y se limpian aquí mismo, para que un segundo cambio en
-- la misma transacción no herede los del primero.
--
-- La acción existe para que una emisión se anote como emisión y no como un
-- cambio de estado más. Así la bitácora tiene una sola fila por hecho: sin
-- esto, emitir un borrador dejaba dos, «issue» y «status», diciendo lo mismo.

create or replace function app.anota_cambio_de_estado() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_motivo text := nullif(btrim(coalesce(current_setting('app.motivo_de_cambio', true), '')), '');
  v_accion text := nullif(btrim(coalesce(current_setting('app.accion_de_cambio', true), '')), '');
begin
  if new.status = old.status then
    return new;
  end if;

  if not app.transicion_de_cotizacion(old.status, new.status) then
    raise exception 'transicion_invalida: una cotización en «%» no puede pasar a «%»',
      old.status, new.status;
  end if;

  -- Anular es definitivo y conserva todo (§8.9). Sin motivo, dentro de un mes
  -- nadie sabe por qué se anuló, y eso es justo lo que la bitácora evita.
  if new.status = 'void' and v_motivo is null then
    raise exception 'motivo_requerido: para anular una cotización hay que decir por qué';
  end if;

  insert into quote_events (organization_id, quote_id, actor_id, from_status, to_status, action, note)
  values (new.organization_id, new.id, auth.uid(), old.status, new.status,
          coalesce(v_accion, 'status'), v_motivo);

  perform set_config('app.motivo_de_cambio', '', true);
  perform set_config('app.accion_de_cambio', '', true);
  return new;
end $$;

create trigger quotes_anota_estado
  before update of status on quotes
  for each row execute function app.anota_cambio_de_estado();

-- ---------------------------------------------------------------------------
-- La puerta: `status` deja de ser escribible desde el cliente
-- ---------------------------------------------------------------------------
--
-- Se enumeran las columnas que sí se pueden editar. Es deliberado que una
-- columna nueva no sea escribible hasta que alguien la añada aquí: falla en
-- voz alta al desarrollar, en vez de abrir un portillo en silencio.

revoke update on quotes from authenticated;
grant update (brand_id, client_id, tax_rate_pct, tax_label, tax_included,
              valid_until, notes, design)
  on quotes to authenticated;

grant select on quote_events to authenticated;
-- Nadie inserta en la bitácora a mano, ni siquiera el dueño: la escribe el
-- disparador. Una fila que el cliente pudiera redactar no sería una bitácora.

alter table quote_events enable row level security;
alter table quote_events force row level security;

create policy quote_events_select on quote_events for select
  using (organization_id in (select app.current_orgs()));

-- ---------------------------------------------------------------------------
-- Cambiar de estado
-- ---------------------------------------------------------------------------

create or replace function cambiar_estado_cotizacion(
  p_quote uuid,
  p_to    quote_status,
  p_note  text default null
) returns quote_status
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_org uuid;
  v_from quote_status;
begin
  select organization_id, status into v_org, v_from
    from quotes where id = p_quote for update;

  if v_org is null then
    raise exception 'quote_not_found: la cotización no existe';
  end if;

  -- La función es `security definer` y por tanto se salta RLS: el permiso hay
  -- que comprobarlo a mano o cualquiera cambiaría el estado de una cotización
  -- de otra organización.
  if not app.has_role(v_org,
       array['owner','admin','finance','commercial']::membership_role[]) then
    raise exception 'quote_not_found: la cotización no existe o no es de tu organización';
  end if;

  if p_to = v_from then
    return v_from;
  end if;

  -- Enviar no es un cambio de estado, es emitir: produce la versión que se le
  -- manda al cliente. Si se pudiera llegar a «enviada» por aquí, habría
  -- cotizaciones enviadas sin ningún documento detrás.
  if p_to = 'sent' then
    raise exception 'emision_requerida: para enviar una cotización hay que emitirla';
  end if;

  perform set_config('app.motivo_de_cambio', coalesce(p_note, ''), true);
  update quotes set status = p_to, updated_at = now() where id = p_quote;
  return p_to;
end $$;

comment on function cambiar_estado_cotizacion(uuid, quote_status, text) is
  'Único camino para mover el estado de una cotización, salvo «enviada», que la produce emitir_cotizacion.';

revoke all on function cambiar_estado_cotizacion(uuid, quote_status, text) from public, anon;
grant execute on function cambiar_estado_cotizacion(uuid, quote_status, text) to authenticated;
