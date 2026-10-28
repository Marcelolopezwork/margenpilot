-- Stub de lo que Supabase provee y un Postgres pelado no.
-- SOLO para la verificación en CI. En Supabase real este archivo no se aplica:
-- el esquema auth y auth.uid() ya existen.

create schema if not exists auth;

create table if not exists auth.users (
  id    uuid primary key,
  email text
);

-- En Supabase, auth.uid() sale del JWT. Aquí sale de una variable de sesión,
-- que es lo que permite a las pruebas hacerse pasar por un usuario.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('app.current_user_id', true), '')::uuid
$$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;
