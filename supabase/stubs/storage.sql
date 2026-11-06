-- Stub de lo que Supabase provee y un Postgres pelado no.
-- SOLO para la verificación en CI. En Supabase real este archivo no se aplica:
-- el esquema storage, sus tablas y storage.foldername() ya existen.
--
-- Hace falta porque `20261104130000_datos_para_el_pdf.sql` crea el bucket de
-- marcas y sus políticas. Sin esto la CI se para ahí y, como el despliegue
-- solo corre si la CI pasó, nunca se desplegaba nada.

create schema if not exists storage;

-- Columnas verificadas contra el proyecto real el 5/11/2026. Están las que la
-- migración toca; las demás que trae Supabase (versionado, ciclo de vida) no
-- cambian el comportamiento de nada nuestro y se omiten a propósito.
create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null,
  owner              uuid,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now(),
  public             boolean default false,
  file_size_limit    bigint,
  allowed_mime_types text[]
);

create table if not exists storage.objects (
  id          uuid primary key default gen_random_uuid(),
  bucket_id   text references storage.buckets (id),
  name        text,
  owner       uuid,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  metadata    jsonb,
  path_tokens text[]
);

-- En Supabase real objects tiene RLS encendida. Si aquí no lo estuviera, las
-- políticas de la migración se crearían y no se probaría nada: existiría un
-- camino que solo funciona en CI.
alter table storage.objects enable row level security;

-- Copia literal de la definición que trae Supabase.
create or replace function storage.foldername(name text) returns text[]
language plpgsql immutable as $function$
declare
    _parts text[];
begin
    -- Split on "/" to get path segments
    select string_to_array(name, '/') into _parts;
    -- Return everything except the last segment
    return _parts[1 : array_length(_parts,1) - 1];
end
$function$;
