-- Stub de lo que Supabase provee y un Postgres pelado no.
-- SOLO para la verificación en CI. En Supabase real este archivo no se aplica:
-- el esquema auth y auth.uid() ya existen.

create schema if not exists auth;

create table if not exists auth.users (
  id    uuid primary key,
  email text
);

-- Copia literal de la definición que trae Supabase (verificada contra el
-- proyecto real el 28/10/2026). Es importante que sea idéntica: así las
-- pruebas se hacen pasar por un usuario de la misma forma en CI y en
-- producción, y no existe un camino que solo funcione en uno de los dos.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;
