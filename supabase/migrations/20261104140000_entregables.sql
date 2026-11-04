-- ============================================================================
-- Margen Pilot · F2-3 · Entregables de cada línea
--
-- Una cotización que dice «Aplicación a medida · S/ 61,750» y nada más hace
-- que el cliente sienta que paga mucho por poco. Lo que falta es la secuencia
-- de entregables: qué recibe, en qué orden, y qué no está incluido.
--
-- Se copian de la ficha al cotizar, no se apuntan. Cambiar la ficha mañana no
-- puede reescribir lo que ya se envió, igual que con los costos y la tasa.
-- ============================================================================

create table quote_line_terms (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  quote_line_id   uuid not null,
  kind            term_kind not null,
  content         text not null,
  sort            int not null default 0,
  created_at      timestamptz not null default now(),
  foreign key (quote_line_id, organization_id)
    references quote_lines (id, organization_id) on delete cascade
);

create index quote_line_terms_linea_idx on quote_line_terms (quote_line_id, kind, sort);

grant select, insert, update, delete on quote_line_terms to authenticated;
-- Y el DELETE se retira acto seguido: `authenticated` no borra en ninguna
-- tabla, y la invariante de la suite lo comprueba. Queda escrito así para que
-- se vea que no es un olvido.
revoke delete on quote_line_terms from authenticated;

alter table quote_line_terms enable row level security;
alter table quote_line_terms force row level security;

create policy quote_line_terms_select on quote_line_terms for select
  using (organization_id in (select app.current_orgs()));
create policy quote_line_terms_insert on quote_line_terms for insert
  with check (app.has_role(organization_id,
    array['owner','admin','finance','commercial']::membership_role[]));
create policy quote_line_terms_update on quote_line_terms for update
  using (app.has_role(organization_id,
    array['owner','admin','finance','commercial']::membership_role[]))
  with check (organization_id in (select app.current_orgs()));

-- La descripción de la ficha también se copia: es lo que el cliente lee
-- debajo del título y hoy se perdía por el camino.
alter table quote_lines add column public_summary text;
comment on column quote_lines.public_summary is
  'Descripción del servicio tal como se copió al cotizar. Se imprime bajo el concepto.';

-- Imagen de portada de la marca, para que la cotización no empiece en blanco.
alter table brands add column cover_path text;
comment on column brands.cover_path is 'Imagen de portada en el bucket marcas.';
