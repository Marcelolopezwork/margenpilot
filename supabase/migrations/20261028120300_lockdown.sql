-- ============================================================================
-- Margen Pilot · F1 · Cierre de privilegios heredados de Supabase
--
-- Por qué existe este archivo.
--
-- Un proyecto de Supabase nace con esto puesto:
--
--   alter default privileges in schema public
--     grant all on tables to anon, authenticated, service_role;
--
-- Es decir: CADA tabla que creemos en `public` queda, sola y sin que nadie lo
-- pida, con DELETE, TRUNCATE, INSERT, UPDATE, REFERENCES y TRIGGER concedidos
-- a `anon` (visitante sin sesión) y a `authenticated`. Los `grant select,
-- insert, update` de 20261028120100_rls.sql no eran el permiso que había: eran
-- un subconjunto redundante de un permiso mucho mayor que ya estaba dado.
--
-- Verificado contra el proyecto real el 28/10/2026: 15 tablas con DELETE para
-- `authenticated` y las mismas 15 con DELETE para `anon`. Y como currencies,
-- plans y plan_entitlements no tenían RLS, cualquiera con la clave pública
-- podía borrar los planes o subirse sus propios límites con un UPDATE.
--
-- Esto NO lo veía la CI: un postgres:16 pelado no trae esos default
-- privileges, así que allí los permisos eran exactamente los que pedimos.
-- Es la diferencia entre verificar contra Postgres y verificar contra Supabase.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Que las tablas futuras no nazcan abiertas
--
-- Solo para el rol `postgres`, que es quien aplica nuestras migraciones. Los
-- default privileges de `supabase_admin` gobiernan los objetos internos de
-- Supabase y no son asunto nuestro.
-- ----------------------------------------------------------------------------

alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on functions from anon, authenticated;

-- ----------------------------------------------------------------------------
-- 2. Dejar a cero lo ya concedido y volver a dar solo lo que hace falta
-- ----------------------------------------------------------------------------

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;

-- `anon` no recupera nada. En este producto no hay una sola pantalla sin
-- sesión: quien no ha entrado no tiene por qué leer ni una fila.

-- Referencia: solo lectura.
grant select on currencies, plans, plan_entitlements to authenticated;

-- Negocio: nunca DELETE y nunca TRUNCATE. Lo que se deshace se anula (INV-7).
grant select, insert, update on
  profiles, organizations, memberships, subscriptions,
  organization_currencies, legal_entities, brands, tax_rates,
  cash_accounts, fx_rates, financial_categories
to authenticated;

grant select on audit_log to authenticated;

grant execute on function create_organization(text, char) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. RLS en las tablas de referencia
--
-- No llevaban RLS porque son datos de catálogo iguales para todo el mundo.
-- Pero «no tiene RLS» en Supabase significa «abierta a quien tenga privilegio
-- de tabla», y el privilegio estaba dado. Se enciende y se abre solo a lectura.
--
-- Sin `force row level security`: el dueño es `postgres`, que tiene BYPASSRLS,
-- así que forzar no cambiaría nada aquí. Las funciones `security definer` que
-- leen plan_entitlements siguen viéndolo todo, que es lo que deben hacer.
-- ----------------------------------------------------------------------------

alter table currencies        enable row level security;
alter table plans             enable row level security;
alter table plan_entitlements enable row level security;

create policy currencies_select on currencies
  for select to authenticated using (true);

-- El plan `internal` no es público: no tiene por qué aparecerle a un cliente.
create policy plans_select on plans
  for select to authenticated using (is_public);

create policy plan_entitlements_select on plan_entitlements
  for select to authenticated
  using (exists (select 1 from plans p where p.code = plan_code and p.is_public));

-- ----------------------------------------------------------------------------
-- 4. Funciones internas que no son disparadores
--
-- Las que devuelven `trigger` no se pueden invocar como funciones normales, así
-- que no hace falta tocarlas. Estas dos sí se podrían, y son `security definer`.
-- ----------------------------------------------------------------------------

revoke all on function app.assert_entitlement(uuid, text) from public;
revoke all on function app.assert_plan_reconciled(uuid) from public;
