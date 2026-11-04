-- ---------------------------------------------------------------------------
-- Margen Pilot · F2-11 y F2-13 · Emitir congela el documento
-- ---------------------------------------------------------------------------
--
-- La deuda que esto paga, anotada desde la primera sesión: hoy el PDF se
-- genera del estado actual de la cotización. Si mañana sube el costo de una
-- licencia, o se reescribe la ficha de un servicio, y se vuelve a imprimir una
-- cotización de hace un mes, sale un documento distinto del que el cliente
-- recibió. Eso no es un detalle de formato: es que no hay constancia de lo que
-- se ofertó.
--
-- Al emitir se guarda una copia completa de lo que se manda —empresa, marca,
-- cliente, líneas, entregables, impuestos, validez y hasta el diseño de la
-- propuesta— y esa copia no se vuelve a tocar. Reemitir no la reescribe: crea
-- la siguiente. La v1 se queda con su contenido y su huella.
--
-- Dos tablas y no una por la regla 6 de FINANCIAL_RULES: el costo no se
-- esconde en la interfaz, se niega en la base. `quote_versions` es el
-- documento del cliente y no contiene ni un costo; el margen vive aparte, con
-- su propia política. Un rol `commercial` lee la versión y no lee el margen,
-- igual que hoy no lee `quote_line_costs` (ADR-34).
-- ---------------------------------------------------------------------------

create table quote_versions (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  quote_id        uuid not null,
  version_no      int not null check (version_no > 0),
  issued_at       timestamptz not null default now(),
  issued_by       uuid,
  -- Todo lo que el cliente ve, tal como estaba al emitir. Sin un solo costo.
  snapshot        jsonb not null,
  -- neto, impuesto y total, como texto: un importe no cruza JSON como número
  -- (ADR-33). Aquí el que manda es el snapshot; esto es para no recalcular.
  totals          jsonb not null,
  -- Huella del snapshot. Permite demostrar que un PDF reimpreso sale de la
  -- misma versión y no de otra. El PDF del servidor con su propia huella sigue
  -- siendo F2-12; hasta que exista, la reproducibilidad la da este hash.
  snapshot_sha256 text not null,
  unique (quote_id, version_no),
  unique (id, organization_id),
  foreign key (quote_id, organization_id)
    references quotes (id, organization_id) on delete cascade
);

comment on table quote_versions is
  'Inmutable. authenticated no tiene INSERT, UPDATE ni DELETE: las escribe emitir_cotizacion y nadie más.';

create index quote_versions_quote_idx on quote_versions (quote_id, version_no desc);

create table quote_version_costs (
  quote_version_id uuid primary key references quote_versions (id) on delete cascade,
  organization_id  uuid not null references organizations (id) on delete cascade,
  cost             numeric(18,4) not null check (cost >= 0),
  profit           numeric(18,4) not null,
  -- Margen sobre precio, markup sobre costo. Se guardan los dos porque
  -- confundirlos es el error que este producto existe para no repetir.
  -- Para agregados NO se promedian: el margen de un grupo es Σutilidad / Σneto
  -- (revisión §2.3), y para eso están `profit` y los totales de la versión.
  margin_pct       numeric(9,4),
  markup_pct       numeric(9,4)
);

comment on table quote_version_costs is
  'El margen de una versión emitida. Tabla aparte para que el rol commercial pueda leer la versión sin leer el costo.';

-- ---------------------------------------------------------------------------
-- Emitir
-- ---------------------------------------------------------------------------
--
-- La aritmética repite la de `src/pages/comercial/totales.ts` a propósito, y
-- tiene que seguir dando lo mismo: se redondea el precio unitario a los
-- decimales de la moneda, luego la línea, y el total es la suma de líneas ya
-- redondeadas (R-4.1 a R-4.4). Hay una prueba que compara las dos.

create or replace function emitir_cotizacion(p_quote uuid, p_note text default null)
returns table (version_no int, snapshot_sha256 text)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_q      record;
  v_dec    smallint;
  v_tasa   numeric;
  v_lineas jsonb;
  v_neto   numeric := 0;
  v_imp    numeric := 0;
  v_costo  numeric := 0;
  v_snap   jsonb;
  v_no     int;
  v_id     uuid;
  v_sha    text;
begin
  select * into v_q from quotes where id = p_quote for update;

  if v_q.id is null then
    raise exception 'quote_not_found: la cotización no existe';
  end if;

  if not app.has_role(v_q.organization_id,
       array['owner','admin','finance','commercial']::membership_role[]) then
    raise exception 'quote_not_found: la cotización no existe o no es de tu organización';
  end if;

  if not app.transicion_de_cotizacion(v_q.status, 'sent') then
    raise exception 'transicion_invalida: una cotización en «%» no se puede emitir', v_q.status;
  end if;

  if not exists (select 1 from quote_lines where quote_id = p_quote and is_active) then
    raise exception 'cotizacion_vacia: no se puede emitir una cotización sin líneas';
  end if;

  -- Los decimales salen de la moneda, nunca de una constante (R-4.4).
  select c.minor_units into v_dec from currencies c where c.code = v_q.currency_code;
  v_tasa := case when v_q.tax_included then v_q.tax_rate_pct else 0 end;

  with l as (
    select ql.id,
           ql.sort,
           ql.description,
           ql.public_summary,
           ql.public_detail,
           ql.quantity,
           round(ql.unit_price, v_dec) as precio,
           round(round(ql.unit_price, v_dec) * ql.quantity, v_dec) as neto
      from quote_lines ql
     where ql.quote_id = p_quote and ql.is_active
  )
  select jsonb_agg(
           jsonb_build_object(
             -- El id de la línea viaja en el snapshot porque el diseño de la
             -- propuesta guarda la foto de cada servicio por ese id. Sin él,
             -- reimprimir una versión perdería las fotos.
             'id',              l.id,
             'orden',           l.sort,
             'descripcion',     l.description,
             'resumen',         l.public_summary,
             'detalle',         l.public_detail,
             'cantidad',        l.quantity::text,
             'precio_unitario', l.precio::text,
             'neto',            l.neto::text,
             'entregables',     coalesce((
               select jsonb_agg(jsonb_build_object('tipo', t.kind, 'texto', t.content, 'orden', t.sort)
                                order by t.sort)
                 from quote_line_terms t
                where t.quote_line_id = l.id and t.is_active
             ), '[]'::jsonb)
           ) order by l.sort
         ),
         coalesce(sum(l.neto), 0),
         coalesce(sum(round(l.neto * v_tasa / 100, v_dec)), 0)
    into v_lineas, v_neto, v_imp
    from l;

  -- El costo de la línea: cada componente redondeado, sumados, y el total por
  -- la cantidad de la línea. Mismo orden que `costoDe` en el editor.
  with cl as (
    select ql.id,
           ql.quantity,
           coalesce(sum(round(round(qlc.unit_cost, v_dec) * qlc.quantity, v_dec)), 0) as unitario
      from quote_lines ql
      left join quote_line_costs qlc
             on qlc.quote_line_id = ql.id and qlc.is_active
     where ql.quote_id = p_quote and ql.is_active
     group by ql.id, ql.quantity
  )
  select coalesce(sum(round(cl.unitario * cl.quantity, v_dec)), 0) into v_costo from cl;

  v_snap := jsonb_build_object(
    'cotizacion', jsonb_build_object(
      'numero',            v_q.number,
      'moneda',            v_q.currency_code,
      'tasa_impuesto',     v_q.tax_rate_pct::text,
      'impuesto_aplicado', v_q.tax_included,
      'etiqueta_impuesto', v_q.tax_label,
      'valida_hasta',      v_q.valid_until,
      'notas',             v_q.notes,
      'creada_el',         v_q.created_at
    ),
    'empresa', (
      select jsonb_build_object(
               'razon_social', e.legal_name, 'tax_id', e.tax_id, 'pais', e.country,
               'direccion', e.address, 'telefono', e.phone, 'email', e.email,
               'condiciones', e.quote_terms)
        from legal_entities e where e.id = v_q.legal_entity_id
    ),
    'marca', (
      select jsonb_build_object(
               'nombre', b.name, 'logo', b.logo_path, 'color', b.accent_color,
               'color_secundario', b.accent_secondary, 'foto', b.cover_path)
        from brands b where b.id = v_q.brand_id
    ),
    'cliente', (
      select jsonb_build_object('nombre', c.name, 'tax_id', c.tax_id, 'email', c.email)
        from clients c where c.id = v_q.client_id
    ),
    'lineas', coalesce(v_lineas, '[]'::jsonb),
    -- El diseño de la propuesta es parte del documento: la portada, la
    -- tipografía y las fotos con las que salió. Reimprimir la v1 tiene que dar
    -- la v1, también en la forma.
    'diseno', coalesce(v_q.design, '{}'::jsonb)
  );

  select coalesce(max(qv.version_no), 0) + 1 into v_no
    from quote_versions qv where qv.quote_id = p_quote;

  -- jsonb normaliza el orden de las claves, así que el mismo contenido da
  -- siempre la misma huella.
  v_sha := encode(sha256(convert_to(v_snap::text, 'UTF8')), 'hex');

  insert into quote_versions (organization_id, quote_id, version_no, issued_by,
                              snapshot, totals, snapshot_sha256)
  values (v_q.organization_id, p_quote, v_no, auth.uid(), v_snap,
          jsonb_build_object(
            'moneda',    v_q.currency_code,
            'decimales', v_dec,
            'neto',      round(v_neto, v_dec)::text,
            'impuesto',  round(v_imp, v_dec)::text,
            'total',     round(v_neto + v_imp, v_dec)::text),
          v_sha)
  returning id into v_id;

  insert into quote_version_costs (quote_version_id, organization_id, cost, profit,
                                   margin_pct, markup_pct)
  values (v_id, v_q.organization_id,
          round(v_costo, v_dec),
          round(v_neto - v_costo, v_dec),
          case when v_neto  = 0 then null else round((v_neto - v_costo) / v_neto  * 100, 4) end,
          case when v_costo = 0 then null else round((v_neto - v_costo) / v_costo * 100, 4) end);

  -- La bitácora la escribe el disparador de `quotes`, así que basta decirle qué
  -- hecho es y con qué nota.
  perform set_config('app.accion_de_cambio', 'issue', true);
  perform set_config('app.motivo_de_cambio',
                     'v' || v_no || coalesce(' · ' || nullif(btrim(p_note), ''), ''), true);

  if v_q.status <> 'sent' then
    update quotes set status = 'sent', updated_at = now() where id = p_quote;
  else
    -- Reemitir no cambia el estado, y el disparador solo salta cuando cambia.
    -- Esta es la única fila de bitácora que se escribe desde fuera de él.
    insert into quote_events (organization_id, quote_id, actor_id, from_status, to_status,
                              action, note)
    values (v_q.organization_id, p_quote, auth.uid(), v_q.status, 'sent', 'issue',
            'v' || v_no || coalesce(' · ' || nullif(btrim(p_note), ''), ''));
    perform set_config('app.motivo_de_cambio', '', true);
    perform set_config('app.accion_de_cambio', '', true);
  end if;

  return query select v_no, v_sha;
end $$;

comment on function emitir_cotizacion(uuid, text) is
  'Congela la cotización en una versión nueva y la pasa a enviada. Nunca reescribe una versión anterior (F2-13).';

revoke all on function emitir_cotizacion(uuid, text) from public, anon;
grant execute on function emitir_cotizacion(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Permisos · se lee, no se escribe
-- ---------------------------------------------------------------------------
--
-- Ni INSERT. Las versiones las crea `emitir_cotizacion`, que es definer. Una
-- versión que el cliente pudiera insertar por su cuenta no sería constancia de
-- nada. Se escriben los grants completos y se revoca acto seguido lo que no
-- toca, para que se lea como una decisión y no como un olvido.

grant select, insert, update, delete on quote_versions      to authenticated;
revoke insert, update, delete on quote_versions             from authenticated;
grant select, insert, update, delete on quote_version_costs to authenticated;
revoke insert, update, delete on quote_version_costs        from authenticated;

alter table quote_versions      enable row level security;
alter table quote_version_costs enable row level security;
alter table quote_versions      force row level security;
alter table quote_version_costs force row level security;

create policy quote_versions_select on quote_versions for select
  using (organization_id in (select app.current_orgs()));

create policy quote_version_costs_select on quote_version_costs for select
  using (app.can_see_costs(organization_id));
