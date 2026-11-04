-- ============================================================================
-- Margen Pilot · Un entregable mal escrito se desactiva, no se borra
--
-- Misma regla que con las líneas y los costos. Y los índices pasan a ser
-- parciales: solo se consultan los vivos.
-- ============================================================================

alter table service_terms    add column is_active boolean not null default true;
alter table quote_line_terms add column is_active boolean not null default true;

drop index if exists service_terms_service_idx;
create index service_terms_service_idx on service_terms (service_id, kind, sort) where is_active;

drop index if exists quote_line_terms_linea_idx;
create index quote_line_terms_linea_idx
  on quote_line_terms (quote_line_id, kind, sort) where is_active;
