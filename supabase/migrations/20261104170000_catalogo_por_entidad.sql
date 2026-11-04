-- ============================================================================
-- Margen Pilot · Un costo y una ficha pertenecen a una empresa
--
-- Lo señaló Marcelo usándolo: al cotizar desde The Publisher Ventures LLC no
-- le servía ninguna ficha, y en ninguna pantalla podía decir a qué empresa
-- pertenecía un costo. Tenía razón: el catálogo era del grupo cuando las
-- contabilidades son dos (ADR-16). Un «Diseñador gráfico 60 PEN/hora» es un
-- costo peruano y no tiene nada que hacer en una cotización en dólares.
--
-- El reparto de lo que ya existía se hace por moneda, que es lo que delata a
-- quién pertenece cada cosa.
-- ============================================================================

alter table cost_items add column legal_entity_id uuid;
alter table services   add column legal_entity_id uuid;

update cost_items c set legal_entity_id = (
  select e.id from legal_entities e
  where e.organization_id = c.organization_id and e.default_currency_code = c.currency_code
  limit 1);

update services s set legal_entity_id = coalesce(
  (select e.id from legal_entities e
   where e.organization_id = s.organization_id
     and e.default_currency_code = s.suggested_currency_code limit 1),
  (select e.id from legal_entities e
   where e.organization_id = s.organization_id
     and e.default_currency_code = (
       select l.currency_code from service_cost_lines l where l.service_id = s.id limit 1)
   limit 1),
  (select e.id from legal_entities e
   where e.organization_id = s.organization_id order by e.created_at limit 1));

alter table cost_items alter column legal_entity_id set not null;
alter table services   alter column legal_entity_id set not null;

-- Clave ajena compuesta: la entidad tiene que ser de la misma organización.
alter table cost_items add constraint cost_items_entidad_fkey
  foreign key (legal_entity_id, organization_id) references legal_entities (id, organization_id);
alter table services add constraint services_entidad_fkey
  foreign key (legal_entity_id, organization_id) references legal_entities (id, organization_id);

create index cost_items_entidad_idx on cost_items (legal_entity_id);
create index services_entidad_idx   on services (legal_entity_id);
