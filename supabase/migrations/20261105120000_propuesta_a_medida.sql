-- ---------------------------------------------------------------------------
-- La propuesta se arma, no se genera
-- ---------------------------------------------------------------------------
--
-- El primer intento dibujaba la propuesta con jsPDF: rectángulos y Helvetica.
-- Marcelo lo dijo sin rodeos —«está bien feo»— y tiene razón: vende diseño,
-- y mandar eso le resta. La propuesta pasa a ser una página web que se
-- imprime a PDF desde el navegador, con tipografías y fotos de verdad, y él
-- elige qué foto va en cada lámina.
--
-- Eso necesita dos cosas que antes no existían: dónde guardar las fotos que
-- sube, y dónde recordar cómo quiere que salga cada cotización.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Las fotos
-- ---------------------------------------------------------------------------
--
-- Viven en el bucket `marcas`, que ya existe y cuya política de Storage exige
-- que la primera carpeta de la ruta sea una organización del que escribe. Lo
-- que falta aquí es el índice: sin él, una foto subida hace dos meses no se
-- puede volver a usar porque nadie se acuerda de su nombre de archivo.

create table org_media (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  -- Ruta dentro del bucket `marcas`, siempre bajo la carpeta de la org.
  path            text not null,
  label           text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  created_by      uuid default auth.uid(),
  unique (organization_id, path)
);

comment on table org_media is
  'Biblioteca de fotos de la organización para las propuestas. Solo presentación: nada de aquí entra en un número.';

create index org_media_org_idx on org_media (organization_id, created_at desc)
  where is_active;

grant select, insert, update, delete on org_media to authenticated;
-- Igual que en todas: `authenticated` no borra en ninguna tabla. Una foto que
-- ya no se quiere se marca inactiva, que además evita que una propuesta vieja
-- se quede sin la imagen con la que se envió.
revoke delete on org_media from authenticated;

alter table org_media enable row level security;

create policy org_media_select on org_media for select
  using (organization_id in (select app.current_orgs()));
create policy org_media_insert on org_media for insert
  with check (app.has_role(organization_id,
    array['owner', 'admin', 'finance', 'commercial']::membership_role[]));
create policy org_media_update on org_media for update
  using (app.has_role(organization_id,
    array['owner', 'admin', 'finance', 'commercial']::membership_role[]))
  with check (organization_id in (select app.current_orgs()));

-- ---------------------------------------------------------------------------
-- Cómo sale cada cotización
-- ---------------------------------------------------------------------------
--
-- Va en `jsonb` y no en columnas a propósito, en contra de lo que se hace en
-- el resto del esquema. La razón: aquí no hay ni un dato que afecte a un
-- número. Son decisiones de presentación —qué foto, qué color, qué variante
-- de portada— que van a cambiar muchas veces mientras Marcelo afina el
-- formato, y cada cambio no merece una migración. El día que algo de aquí
-- dentro signifique dinero, ese día sale a su columna.

alter table quotes add column design jsonb not null default '{}'::jsonb;

comment on column quotes.design is
  'Solo presentación de la propuesta: fotos por lámina, colores, tipografía y variantes. Nada de aquí entra en ningún cálculo.';
