-- ============================================================================
-- Margen Pilot · Herramientas compartidas entre las dos empresas
--
-- Marcelo lo planteó con un caso concreto: su hosting aloja la web de la
-- agencia peruana y la de la americana, y se lo facturan en una sola moneda.
-- Su pregunta fue si había que duplicar la herramienta, una versión en soles
-- y otra en dólares.
--
-- No. Dos filas para la misma herramienta son dos números que se separan: el
-- día que suba el hosting en dólares, la versión en soles se queda mintiendo,
-- y nadie se acuerda de que existía.
--
-- Se registra una vez, en la moneda en que la facturan, sin empresa dueña. La
-- conversión ocurre al cotizar y queda escrita con su tasa y su fecha, que es
-- lo que exige INV-10: dos monedas no se suman sin declarar la conversión.
-- ============================================================================

alter table cost_items alter column legal_entity_id drop not null;

comment on column cost_items.legal_entity_id is
  'La empresa dueña del costo. Nulo = compartido: una herramienta que usan las dos.';

-- Lo que se convirtió y con qué, guardado en la propia línea. Sin esto, la
-- cifra en soles de un hosting en dólares sería un número sin procedencia.
alter table quote_line_costs add column source_currency  char(3) references currencies (code);
alter table quote_line_costs add column source_unit_cost numeric(18,4);
alter table quote_line_costs add column fx_rate          numeric(18,8);
alter table quote_line_costs add column fx_as_of         date;

comment on column quote_line_costs.source_unit_cost is
  'Lo que factura el proveedor, en su moneda. unit_cost es eso ya convertido a la de la cotización.';

alter table service_cost_lines add column source_currency  char(3) references currencies (code);
alter table service_cost_lines add column source_unit_cost numeric(18,4);
