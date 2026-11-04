-- ---------------------------------------------------------------------------
-- El segundo color de la marca
-- ---------------------------------------------------------------------------
--
-- La propuesta que Marcelo manda a sus clientes usa dos colores, no uno: el
-- primario pinta los títulos y los bloques, y el segundo la numeración y los
-- acentos. Con un solo color el índice y las portadillas pierden el contraste
-- que hace que se lean como una secuencia.
--
-- Nulo significa «usa el de siempre», igual que `accent_color`: una marca
-- recién creada sale bien sin que nadie elija nada.
-- ---------------------------------------------------------------------------

alter table brands add column accent_secondary text;

comment on column brands.accent_secondary is
  'Segundo color de la marca: numeración y acentos de la propuesta. Nulo usa el de por defecto.';
