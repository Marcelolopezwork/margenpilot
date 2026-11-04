-- ---------------------------------------------------------------------------
-- Un estado que faltaba: en negociación
-- ---------------------------------------------------------------------------
--
-- La máquina de estados de `docs/ARCHITECTURE.md` §4.2 la contempla desde el
-- principio y el enum no la tenía. Sin ella, una cotización que el cliente
-- está discutiendo se queda en «enviada», y entonces «enviada» significa dos
-- cosas distintas: que salió y que sigue viva. Eso estropea el pipeline antes
-- de que exista.
--
-- Va sola en su propia migración porque `alter type ... add value` no permite
-- usar el valor nuevo en la misma transacción. La máquina que lo usa está en
-- la migración siguiente.
-- ---------------------------------------------------------------------------

alter type quote_status add value if not exists 'negotiation' after 'sent';
