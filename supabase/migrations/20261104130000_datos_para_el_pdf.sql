-- ============================================================================
-- Margen Pilot · F2-12 · Lo que una cotización impresa necesita
--
-- Datos de contacto de quien emite, condiciones por defecto, y un sitio donde
-- vivan los logos. Nada de esto estaba y sin ello el PDF sale cojo.
-- ============================================================================

alter table legal_entities add column address     text;
alter table legal_entities add column phone       text;
alter table legal_entities add column email       text;
alter table legal_entities add column quote_terms text;

comment on column legal_entities.quote_terms is
  'Condiciones por defecto que se imprimen al pie de la cotización.';

-- ----------------------------------------------------------------------------
-- Logos de marca
--
-- Lectura pública: el logo acaba impreso en un PDF que se manda por correo,
-- así que protegerlo no protege nada. La escritura sí es del equipo, y cada
-- organización escribe en su propia carpeta: el primer tramo de la ruta es su
-- id, comprobado contra app.current_orgs().
-- ----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('marcas', 'marcas', true, 2097152,
        array['image/png','image/jpeg','image/webp','image/svg+xml'])
on conflict (id) do nothing;

create policy marcas_lectura on storage.objects for select
  using (bucket_id = 'marcas');

create policy marcas_escritura on storage.objects for insert to authenticated
  with check (
    bucket_id = 'marcas'
    and (storage.foldername(name))[1] in (select app.current_orgs()::text)
  );

create policy marcas_reemplazo on storage.objects for update to authenticated
  using (
    bucket_id = 'marcas'
    and (storage.foldername(name))[1] in (select app.current_orgs()::text)
  );
