-- ============================================================================
-- Margen Pilot · F5-5 · Cuánto tiempo se fue
--
-- La otra mitad de «cuánto deja cada trabajo». Hoy un trabajo sabe cuánto
-- **dinero** costó; no sabe cuánto **tiempo**. Y un trabajo que dejó 40 %
-- pero se comió tres semanas de dos personas no dejó 40 %: dejó mucho menos,
-- solo que la parte cara no pasó por el banco.
--
-- Es el agujero clásico de una agencia de servicios. El margen por dinero
-- premia al trabajo que se hace con pocos proveedores, aunque se lo coma tu
-- equipo entero; el margen por hora dice la verdad.
--
-- ---------------------------------------------------------------------------
-- INV-16 — Las horas se cuentan aparte del dinero, y no se convierten
-- ---------------------------------------------------------------------------
--
-- 1. **Una hora no es un costo.** No se multiplica por una tarifa ni se suma
--    al costo real del trabajo. Hacerlo contaría dos veces el sueldo de quien
--    ya cobra, o inventaría un gasto que nunca salió del banco. El resultado
--    del mes no cambia ni un céntimo por anotar horas.
--
-- 2. **Lo que las horas producen es una división, no una suma.** «Este
--    trabajo deja 4 000 y se comió 80 horas» son 50 por hora. Esa cifra es la
--    que se compara entre servicios, y es la que delata al cliente que paga
--    bien y cuesta más.
--
-- 3. **Se guardan en minutos enteros.** «Hora y media» entra como 90. Un
--    `numeric` de horas con decimales es la misma trampa que un importe en
--    coma flotante: 0,1 + 0,2 horas no son 0,3 horas.
--
-- 4. **Quién hizo el trabajo es un texto, no un usuario.** El freelance que
--    editó el video no tiene cuenta en Margen y no la va a tener. Lo que hace
--    falta es poder decir «Eli» y que se agrupe.
--
-- 5. **Un apunte de horas se borra.** No es un hecho económico: no hay
--    documento ni dinero detrás, y una tarde mal apuntada tiene que poder
--    desaparecer. El rastro lo guarda `audit_log`, igual que el de una cuota
--    prevista que se quita.
--
-- 6. **Las horas viven en el libro de su trabajo.** La clave compuesta con la
--    entidad lo impone, igual que en las compras y los gastos (INV-11).
-- ============================================================================

create table job_time_entries (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  legal_entity_id uuid not null,
  job_id          uuid not null,
  /* Quién. Texto y no usuario: el freelance no tiene cuenta (INV-16.4). */
  who             text not null check (btrim(who) <> ''),
  spent_on        date not null,
  /* Minutos enteros. Ver INV-16.3. El tope de veinticuatro horas no es
     burocracia: un dedo torpe que teclea 800 en vez de 80 mete trece horas
     de más y nadie lo nota hasta que el margen por hora sale absurdo. */
  minutes         int not null check (minutes > 0 and minutes <= 1440),
  note            text,
  created_by      uuid not null default auth.uid(),
  created_at      timestamptz not null default now(),

  foreign key (job_id, organization_id, legal_entity_id)
    references jobs (id, organization_id, legal_entity_id) on delete cascade
);

create index job_time_entries_trabajo_idx on job_time_entries (organization_id, job_id);
create index job_time_entries_quien_idx
  on job_time_entries (organization_id, lower(btrim(who)));

create trigger job_time_entries_audit
  after insert or update or delete on job_time_entries
  for each row execute function app.audit_changes();

comment on table job_time_entries is
  'El tiempo que se le fue a cada trabajo, en minutos enteros. No es un costo y no se convierte en uno (INV-16).';

grant select on job_time_entries to authenticated;

alter table job_time_entries enable row level security;
alter table job_time_entries force  row level security;

-- Mismo permiso que los trabajos: quien ve el costo ve el tiempo.
create policy job_time_entries_select on job_time_entries for select
  using (organization_id in (select app.current_orgs())
         and app.can_see_costs(organization_id));

-- ---------------------------------------------------------------------------
-- Cuánto tiempo lleva cada trabajo
-- ---------------------------------------------------------------------------

create view job_time with (security_invoker = true) as
select t.job_id,
       t.organization_id,
       sum(t.minutes)::int        as minutos,
       count(*)::int              as apuntes,
       count(distinct lower(btrim(t.who)))::int as personas,
       min(t.spent_on)            as desde,
       max(t.spent_on)            as hasta
  from job_time_entries t
 group by t.job_id, t.organization_id;

comment on view job_time is
  'Minutos por trabajo. En minutos y no en horas: la división la hace quien la enseña, con el redondeo a la vista (INV-16.3).';

grant select on job_time to authenticated;

-- ---------------------------------------------------------------------------
-- Puerta · anotar horas
-- ---------------------------------------------------------------------------

create or replace function anotar_horas(
  p_job     uuid,
  p_who     text,
  p_minutes int,
  p_on      date default null,
  p_note    text default null
) returns setof job_time_entries
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_job  record;
  v_quien text;
  v_id   uuid;
begin
  select j.* into v_job from jobs j where j.id = p_job;

  if v_job.id is null or not app.can_see_costs(v_job.organization_id) then
    raise exception 'trabajo_no_encontrado: ese trabajo no existe o no es de tu organización';
  end if;

  v_quien := btrim(coalesce(p_who, ''));
  if v_quien = '' then
    raise exception 'quien_obligatorio: hace falta saber de quién fue ese tiempo. Sin eso no se puede responder a «en qué se le va el mes al equipo»';
  end if;

  if p_minutes is null or p_minutes <= 0 then
    raise exception 'minutos_invalidos: el tiempo va en minutos y tiene que ser mayor que cero';
  end if;

  if p_minutes > 1440 then
    raise exception
      'minutos_invalidos: % minutos son más de veinticuatro horas en un día. Si de verdad fueron varios días, anótalos por separado: así se ve cuándo se fue el tiempo',
      p_minutes;
  end if;

  insert into job_time_entries (
    organization_id, legal_entity_id, job_id, who, spent_on, minutes, note)
  values (
    v_job.organization_id, v_job.legal_entity_id, p_job, v_quien,
    coalesce(p_on, current_date), p_minutes,
    nullif(btrim(coalesce(p_note, '')), ''))
  returning id into v_id;

  return query select * from job_time_entries where id = v_id;
end $fn$;

comment on function anotar_horas(uuid, text, int, date, text) is
  'Apunta tiempo en un trabajo. No toca el costo ni el resultado: las horas no se convierten en dinero (INV-16.1).';

revoke all on function anotar_horas(uuid, text, int, date, text) from public, anon;
grant execute on function anotar_horas(uuid, text, int, date, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Puerta · quitar un apunte
-- ---------------------------------------------------------------------------

create or replace function quitar_horas(p_entry uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare v_entry record;
begin
  select t.* into v_entry from job_time_entries t where t.id = p_entry;

  if v_entry.id is null or not app.can_see_costs(v_entry.organization_id) then
    raise exception 'apunte_no_encontrado: ese apunte no existe o no es de tu organización';
  end if;

  -- Se borra, y se puede: no es un hecho económico. `audit_log` guarda la
  -- fila que había (INV-16.5).
  delete from job_time_entries where id = p_entry;
end $fn$;

revoke all on function quitar_horas(uuid) from public, anon;
grant execute on function quitar_horas(uuid) to authenticated;
