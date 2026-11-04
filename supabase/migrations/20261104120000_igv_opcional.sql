-- ============================================================================
-- Margen Pilot · F2-9 · El IGV es una decisión de cada cotización
--
-- Se guarda aparte de la tasa para no perderla: desmarcar y volver a marcar
-- tiene que devolver el 18 %, no un cero que ya no sabe de dónde venía.
--
-- Y `public_detail`: lo que el cliente lee de cada línea no es lo mismo que
-- la descripción interna. El PDF imprime esto; si está vacío, la descripción.
-- ============================================================================

alter table quotes add column tax_included boolean not null default true;

comment on column quotes.tax_included is
  'Si la cotización aplica su tax_rate_pct. Falso deja el impuesto en cero sin olvidar la tasa.';

alter table quote_lines add column public_detail text;

comment on column quote_lines.public_detail is
  'Qué incluye la línea, en palabras del cliente. Se imprime en el PDF.';
