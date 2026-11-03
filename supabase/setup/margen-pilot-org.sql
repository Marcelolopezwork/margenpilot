-- ============================================================================
-- Configuración inicial de la organización de Marcelo · Margen Pilot
--
-- Se ejecuta UNA VEZ contra el proyecto real, después de que Marcelo haya
-- entrado por primera vez (el usuario tiene que existir en auth.users).
--
-- Desde el panel de Supabase: SQL Editor → pegar → Run.
--
-- Configura lo decidido en DECISIONS.md D-3:
--   The Publisher Ventures LLC  → marca The Publisher Lab → USD → sin IGV
--   3 Brothers MKT SAC          → marca Nlima             → PEN → IGV 18 %
-- ============================================================================

do $$
declare
  -- Tiene que ser un correo que pueda recibir el enlace de acceso: hasta
  -- que haya SMTP propio, solo los miembros de la organización de
  -- Supabase lo reciben (D-7).
  v_email text := 'info@thepublisherlab.com';
  v_user  uuid;
  v_org   uuid;
  v_llc   uuid;
  v_sac   uuid;
begin
  select id into v_user from auth.users where email = v_email;
  if v_user is null then
    raise exception 'No existe el usuario %. Entra una vez en la app antes de ejecutar esto.', v_email;
  end if;

  -- Se reutiliza CUALQUIER organización de la que ya seas dueño, no solo
  -- la del slug esperado. Si entraste a la app y creaste una desde la
  -- pantalla de bienvenida, esa es la que se completa aquí; buscando solo
  -- por slug se te crearía una segunda y acabarías con dos.
  select o.id into v_org
  from organizations o
  join memberships m on m.organization_id = o.id
  where m.user_id = v_user and m.role = 'owner' and m.status = 'active'
  order by (o.slug = 'margen-pilot') desc, o.created_at
  limit 1;

  if v_org is null then
    insert into organizations (name, slug, display_currency_code, created_by)
    values ('Margen Pilot', 'margen-pilot', 'PEN', v_user)
    returning id into v_org;

    -- internal: dos entidades y dos monedas no caben en pro (D-4).
    insert into subscriptions (organization_id, plan_code) values (v_org, 'internal');

    insert into memberships (organization_id, user_id, role, status)
    values (v_org, v_user, 'owner', 'active');

    insert into organization_currencies (organization_id, currency_code)
    values (v_org, 'PEN'), (v_org, 'USD');

    insert into financial_categories (organization_id, name, direction, sort) values
      (v_org, 'Ventas de servicios',      'in',   10),
      (v_org, 'Otros ingresos',           'in',   20),
      (v_org, 'Personal y freelancers',   'out',  30),
      (v_org, 'Herramientas y licencias', 'out',  40),
      (v_org, 'Proveedores',              'out',  50),
      (v_org, 'Alquiler y servicios',     'out',  60),
      (v_org, 'Comisiones bancarias',     'out',  70),
      (v_org, 'Impuestos',                'out',  80),
      (v_org, 'Movimientos del dueño',    'both', 90);
  end if;

  -- ---------------- Libro 1 · Estados Unidos, dólares, sin IGV --------------
  insert into legal_entities (organization_id, legal_name, country, default_currency_code)
  values (v_org, 'The Publisher Ventures LLC', 'US', 'USD')
  on conflict (organization_id, legal_name) do nothing;
  select id into v_llc from legal_entities
  where organization_id = v_org and legal_name = 'The Publisher Ventures LLC';

  insert into brands (organization_id, legal_entity_id, name)
  values (v_org, v_llc, 'The Publisher Lab')
  on conflict (organization_id, name) do nothing;

  insert into tax_rates (organization_id, legal_entity_id, name, rate, is_default)
  values (v_org, v_llc, 'Sin impuesto', 0.0000, true)
  on conflict (legal_entity_id, name) do nothing;

  -- ---------------- Libro 2 · Perú, soles, IGV 18 % ------------------------
  insert into legal_entities (organization_id, legal_name, country, default_currency_code)
  values (v_org, '3 Brothers MKT SAC', 'PE', 'PEN')
  on conflict (organization_id, legal_name) do nothing;
  select id into v_sac from legal_entities
  where organization_id = v_org and legal_name = '3 Brothers MKT SAC';

  insert into brands (organization_id, legal_entity_id, name)
  values (v_org, v_sac, 'Nlima')
  on conflict (organization_id, name) do nothing;

  insert into tax_rates (organization_id, legal_entity_id, name, rate, is_default)
  values (v_org, v_sac, 'IGV 18%', 18.0000, true)
  on conflict (legal_entity_id, name) do nothing;

  raise notice 'Listo. Organización %, entidades: LLC % y SAC %.', v_org, v_llc, v_sac;
  raise notice 'Las cuentas de caja se crean desde la app, no aquí: cada una necesita su moneda.';
end $$;
