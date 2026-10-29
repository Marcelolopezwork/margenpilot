-- ============================================================================
-- Margen Pilot · F1 · Lo que señaló el linter de rendimiento
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. auth.uid() se evaluaba una vez POR FILA en las políticas de profiles
--
-- Envuelto en (select …), Postgres lo trata como un valor constante de la
-- consulta y lo calcula una sola vez. Las demás tablas no aparecen en el aviso
-- porque sus políticas pasan por app.current_orgs(), que ya va en subconsulta.
--
-- profiles se lee en cada carga de página, así que es el que más se nota.
-- ----------------------------------------------------------------------------

alter policy profiles_select on profiles
  using (id = (select auth.uid()));

alter policy profiles_insert on profiles
  with check (id = (select auth.uid()));

alter policy profiles_update on profiles
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ----------------------------------------------------------------------------
-- 2. Claves ajenas sin índice que cubrirlas
--
-- El linter señala catorce. Se indexan cuatro: las que la aplicación va a
-- recorrer de verdad, porque son los ejes por los que se consulta (una
-- entidad y sus marcas, una entidad y sus cuentas, una organización y sus
-- tasas, el árbol de categorías).
--
-- Las otras diez se dejan a propósito, y conviene que quede escrito por qué:
--
--   · currency_code, from_code, to_code, plan_code → apuntan a tablas de 2 y 3
--     filas. Un índice ahí no acelera nada y hay que mantenerlo.
--   · created_by, invited_by → rastro de auditoría. Nunca se consulta «todo lo
--     que creó este usuario»; si algún día se consulta, se indexa entonces.
--   · tax_rates.organization_id → el impuesto se consulta siempre por entidad,
--     que es de quien depende el régimen, y eso ya lo cubre la primera columna
--     del índice único (legal_entity_id, name). Por organización sola no se
--     consulta nunca.
--
-- Las demás claves ajenas hacia organizations ya van cubiertas por la primera
-- columna de un índice único que existe: brands y financial_categories por
-- (organization_id, name), cash_accounts por (organization_id,
-- legal_entity_id, name), memberships y organization_currencies por su clave
-- primaria.
--
-- Un índice que no se usa no es gratis: ocupa, se escribe en cada INSERT y
-- ensucia el aviso de «índices sin usar», que es donde queremos ver señal.
-- ----------------------------------------------------------------------------

create index brands_entity_idx               on brands (legal_entity_id);
create index cash_accounts_entity_fk_idx     on cash_accounts (legal_entity_id);
create index fx_rates_org_idx                on fx_rates (organization_id);
create index financial_categories_parent_idx on financial_categories (parent_id);
