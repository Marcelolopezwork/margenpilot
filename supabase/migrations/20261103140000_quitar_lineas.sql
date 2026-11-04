-- ============================================================================
-- Margen Pilot · F2 · Quitar líneas y costos sin borrar nada
--
-- `authenticated` no tiene DELETE en ninguna tabla y así se queda: es una
-- invariante que la suite comprueba en cada corrida (ADR-25). Pero una línea
-- mal tecleada en un borrador tiene que poder desaparecer de la vista.
--
-- Se desactiva en vez de borrarse: la fila sigue ahí con su rastro en
-- audit_log, y deja de contar en los totales. Para un borrador eso es de
-- sobra, y para una cotización ya enviada es lo único admisible.
-- ============================================================================

alter table quote_lines      add column is_active boolean not null default true;
alter table quote_line_costs add column is_active boolean not null default true;

-- El índice por el que se leen las líneas de una cotización pasa a cubrir
-- solo las vivas, que son las únicas que se piden.
drop index if exists quote_lines_quote_idx;
create index quote_lines_quote_idx on quote_lines (quote_id, sort) where is_active;
