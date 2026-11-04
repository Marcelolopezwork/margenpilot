-- ============================================================================
-- Margen Pilot · F2-7 · Precio derivado del costo
--
-- Es como trabaja Marcelo en el cotizador que ya usaba: se arma la lista de
-- costos, se pone un fee y el precio sale solo.
--
--     precio = costo × (1 + fee/100)
--
-- `fee_pct` nulo significa precio escrito a mano. Con valor, el precio se
-- recalcula cuando cambian los costos o el fee. En los dos casos lo que se
-- guarda es `unit_price`, no la fórmula: una cotización enviada no puede
-- cambiar porque alguien tocó el catálogo después.
--
-- El nombre de la columna dice «fee» y no «margen» a propósito. El cotizador
-- anterior calculaba (precio − costo) / costo y lo llamaba margen, que es el
-- markup. Con costo 100 y fee 80 %, el markup es 80 % y el margen 44,4 %.
-- ============================================================================

alter table quote_lines add column fee_pct numeric(7,4) check (fee_pct is null or fee_pct >= 0);

comment on column quote_lines.fee_pct is
  'Markup sobre el costo, en porcentaje. Nulo = precio escrito a mano. No es el margen.';
