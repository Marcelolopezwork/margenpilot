-- ===========================================================================
-- Datos de demostración · organización «Margen Demo»
-- ===========================================================================
--
-- Para ver el producto funcionando con algo dentro, sin tocar «Margen Pilot».
--
-- Va en una organización aparte a propósito, y la razón no es estética: nada
-- financiero se borra en este producto (INV-7, `authenticated` no tiene ni un
-- permiso de DELETE). Si los datos de prueba vivieran en la organización real,
-- quitarlos después sería imposible: lo más que se podría hacer es anularlos,
-- y quedarían a la vista para siempre en la cartera, en el libro y en el
-- resultado de noviembre de 2026.
--
-- En su propia organización, en cambio, borrarla es una sola fila: todo lo
-- demás cuelga de `organization_id` con `on delete cascade`. Eso es lo que
-- hace `borrar-demo.sql`.
--
-- Todo se crea por las mismas puertas que usa la aplicación —emitir, aprobar,
-- cobrar, transferir, comprar, pagar— y no con inserciones a mano. Si una
-- invariante estuviera mal, esto fallaría aquí en vez de dejar datos
-- imposibles que luego confunden más que ayudar.
--
-- Es un solo bloque `do`, es decir una sola transacción: o entra todo o no
-- entra nada. Ejecutarlo dos veces falla por el slug repetido, y eso es lo
-- correcto: dos demos a medias serían peor.

do $demo$
declare
  v_usuario uuid;
  v_org    uuid;
  v_pe     uuid;  -- Demo Perú SAC
  v_us     uuid;  -- Demo Studio LLC
  v_marca_pe uuid;
  v_marca_us uuid;
  v_bcp    uuid;  -- PEN, Demo Perú SAC
  v_chica  uuid;  -- PEN, Demo Perú SAC
  v_mercury uuid; -- USD, Demo Studio LLC
  v_cat_camp uuid;
  v_cat_cont uuid;
  v_srv_lanz uuid;
  v_srv_redes uuid;
  v_srv_retainer uuid;
  v_ci_direccion uuid;
  v_ci_video uuid;
  v_ci_ads uuid;
  v_ci_redaccion uuid;
  v_cli_ej uuid;
  v_cli_dental uuid;
  v_cli_nova uuid;
  v_cli_harbor uuid;
  v_g_herramientas uuid;
  v_g_servicios uuid;
  v_g_personal uuid;
  v_g_proveedores uuid;
  v_q_borrador uuid;
  v_q_enviada uuid;
  v_q_negociando uuid;
  v_q_aprobada uuid;
  v_q_rechazada uuid;
  v_q_vencida uuid;
  v_cuota  uuid;
  v_doc    uuid;
  v_compra uuid;
begin
  -- Quién es el dueño de la demo: el usuario más antiguo del proyecto. En
  -- «Margen Pilot» hay exactamente uno, así que es él; en la CI es el primero
  -- de los dos de prueba. Buscarlo en vez de escribir su identificador aquí
  -- hace que este archivo sirva en los dos sitios y no guarde datos de nadie.
  select u.id into v_usuario from auth.users u order by u.created_at, u.id limit 1;
  if v_usuario is null then
    raise exception 'no hay ningún usuario en el proyecto: la demo necesita un dueño';
  end if;

  -- Las puertas comprueban `auth.uid()`, así que hay que decir quién escribe.
  -- Se hace con set_config local y no con `set` a secas: un `set` de sesión no
  -- sobrevive a un pooler en modo transacción, y esto vive exactamente lo que
  -- vive el bloque.
  perform set_config('request.jwt.claim.sub', v_usuario::text, true);

  -- ---------------------------------------------------------------- la base
  v_org := create_organization('Margen Demo', 'PEN');

  -- Sin plan internal, el plan free topa en una entidad, una moneda y dos
  -- cuentas, y la demo necesita dos empresas con tres cuentas para que se
  -- pueda ver una transferencia.
  update subscriptions set plan_code = 'internal' where organization_id = v_org;

  insert into organization_currencies (organization_id, currency_code)
  values (v_org, 'USD');

  insert into legal_entities (organization_id, legal_name, country, default_currency_code,
    tax_id, address, phone, email)
  values (v_org, 'Demo Perú SAC', 'PE', 'PEN',
    '20600000001', 'Av. Demo 123, Lima', '+51 900 000 001', 'hola@demo.pe')
  returning id into v_pe;

  insert into legal_entities (organization_id, legal_name, country, default_currency_code,
    tax_id, address, email)
  values (v_org, 'Demo Studio LLC', 'US', 'USD',
    '99-0000001', '1 Demo St, Wilmington DE', 'hello@demostudio.co')
  returning id into v_us;

  insert into brands (organization_id, legal_entity_id, name, accent_color)
  values (v_org, v_pe, 'Demo Perú', '#1d4ed8') returning id into v_marca_pe;
  insert into brands (organization_id, legal_entity_id, name, accent_color)
  values (v_org, v_us, 'Demo Studio', '#0f766e') returning id into v_marca_us;

  insert into tax_rates (organization_id, legal_entity_id, name, rate, is_default)
  values (v_org, v_pe, 'IGV 18%', 18.0000, true);
  insert into tax_rates (organization_id, legal_entity_id, name, rate, is_default)
  values (v_org, v_us, 'Sin impuesto', 0.0000, true);

  -- Una conversión sin fuente no es un dato (ADR-14): la tasa se carga con su
  -- fecha y su origen, aunque sea de demostración.
  insert into fx_rates (organization_id, from_code, to_code, rate, as_of, source)
  values (v_org, 'USD', 'PEN', 3.75000000, current_date, 'demo');

  insert into cash_accounts (organization_id, legal_entity_id, name, currency_code, sort)
  values (v_org, v_pe, 'BCP Soles', 'PEN', 10) returning id into v_bcp;
  insert into cash_accounts (organization_id, legal_entity_id, name, currency_code, sort)
  values (v_org, v_pe, 'Caja Chica', 'PEN', 20) returning id into v_chica;
  insert into cash_accounts (organization_id, legal_entity_id, name, currency_code, sort)
  values (v_org, v_us, 'Mercury USD', 'USD', 30) returning id into v_mercury;

  select id into v_g_herramientas from financial_categories
   where organization_id = v_org and name = 'Herramientas y licencias';
  select id into v_g_servicios from financial_categories
   where organization_id = v_org and name = 'Alquiler y servicios';
  select id into v_g_personal from financial_categories
   where organization_id = v_org and name = 'Personal y freelancers';
  select id into v_g_proveedores from financial_categories
   where organization_id = v_org and name = 'Proveedores';

  -- -------------------------------------------------------------- catálogo
  insert into service_categories (organization_id, name)
  values (v_org, 'Campañas') returning id into v_cat_camp;
  insert into service_categories (organization_id, name)
  values (v_org, 'Contenido') returning id into v_cat_cont;

  insert into cost_items (organization_id, legal_entity_id, name, kind, unit, unit_cost, currency_code)
  values (v_org, v_pe, 'Dirección creativa', 'role', 'hora', 120.0000, 'PEN')
  returning id into v_ci_direccion;
  insert into cost_items (organization_id, legal_entity_id, name, kind, unit, unit_cost, currency_code)
  values (v_org, v_pe, 'Edición de video', 'role', 'hora', 80.0000, 'PEN')
  returning id into v_ci_video;
  insert into cost_items (organization_id, legal_entity_id, name, kind, unit, unit_cost, currency_code)
  values (v_org, v_pe, 'Pauta Meta', 'tool', 'mes', 1500.0000, 'PEN')
  returning id into v_ci_ads;
  insert into cost_items (organization_id, legal_entity_id, name, kind, unit, unit_cost, currency_code)
  values (v_org, v_us, 'Redacción senior', 'role', 'hora', 25.0000, 'USD')
  returning id into v_ci_redaccion;

  insert into services (organization_id, legal_entity_id, code, name, category_id,
    suggested_currency_code, default_fee_pct)
  values (v_org, v_pe, 'CAMP-01', 'Campaña de lanzamiento', v_cat_camp, 'PEN', 80)
  returning id into v_srv_lanz;
  insert into services (organization_id, legal_entity_id, code, name, category_id,
    suggested_currency_code, default_fee_pct)
  values (v_org, v_pe, 'REDES-01', 'Gestión de redes mensual', v_cat_cont, 'PEN', 60)
  returning id into v_srv_redes;
  insert into services (organization_id, legal_entity_id, code, name, category_id,
    suggested_currency_code, default_fee_pct)
  values (v_org, v_us, 'CONT-01', 'Content retainer', v_cat_cont, 'USD', 70)
  returning id into v_srv_retainer;

  insert into service_cost_lines (organization_id, service_id, cost_item_id, quantity,
    unit_cost, unit, currency_code)
  values
    (v_org, v_srv_lanz,     v_ci_direccion, 12, 120.0000, 'hora', 'PEN'),
    (v_org, v_srv_lanz,     v_ci_video,     20,  80.0000, 'hora', 'PEN'),
    (v_org, v_srv_lanz,     v_ci_ads,        1, 1500.0000, 'mes', 'PEN'),
    (v_org, v_srv_redes,    v_ci_video,      8,  80.0000, 'hora', 'PEN'),
    (v_org, v_srv_redes,    v_ci_direccion,  4, 120.0000, 'hora', 'PEN'),
    (v_org, v_srv_retainer, v_ci_redaccion, 20,  25.0000, 'hora', 'USD');

  -- --------------------------------------------------------------- clientes
  insert into clients (organization_id, name, tax_id, email) values
    (v_org, 'EJ Deportes SAC', '20600000111', 'compras@ejdeportes.pe')
  returning id into v_cli_ej;
  insert into clients (organization_id, name, tax_id, email) values
    (v_org, 'Clínica Dental Sonrisa', '20600000222', 'admin@sonrisa.pe')
  returning id into v_cli_dental;
  insert into clients (organization_id, name, email) values
    (v_org, 'Nova Café', 'hola@novacafe.pe')
  returning id into v_cli_nova;
  insert into clients (organization_id, name, email) values
    (v_org, 'Harbor Goods LLC', 'ap@harborgoods.co')
  returning id into v_cli_harbor;

  -- ------------------------------------------------------------ el tablero
  -- Una por columna, para que Pipeline tenga algo que repartir.

  -- Borrador: sin emitir, así que no tiene cifra que el cliente haya visto.
  insert into quotes (organization_id, legal_entity_id, brand_id, client_id, number,
    currency_code, tax_rate_pct, tax_label, valid_until)
  values (v_org, v_pe, v_marca_pe, v_cli_ej, next_quote_number(v_pe), 'PEN', 18, 'IGV',
    current_date + 20)
  returning id into v_q_borrador;
  perform add_quote_line_from_service(v_q_borrador, v_srv_redes, 1);

  -- Enviada y quieta: emitida hace veinticinco días y nadie la ha tocado.
  insert into quotes (organization_id, legal_entity_id, brand_id, client_id, number,
    currency_code, tax_rate_pct, tax_label, valid_until, created_at)
  values (v_org, v_pe, v_marca_pe, v_cli_dental, next_quote_number(v_pe), 'PEN', 18, 'IGV',
    current_date + 5, now() - interval '25 days')
  returning id into v_q_enviada;
  perform add_quote_line_from_service(v_q_enviada, v_srv_lanz, 1);
  perform emitir_cotizacion(v_q_enviada, 'Enviada por correo');

  -- En negociación: se movió ayer.
  insert into quotes (organization_id, legal_entity_id, brand_id, client_id, number,
    currency_code, tax_rate_pct, tax_label, valid_until, created_at)
  values (v_org, v_pe, v_marca_pe, v_cli_nova, next_quote_number(v_pe), 'PEN', 18, 'IGV',
    current_date + 12, now() - interval '9 days')
  returning id into v_q_negociando;
  perform add_quote_line_from_service(v_q_negociando, v_srv_redes, 3);
  perform emitir_cotizacion(v_q_negociando);
  perform cambiar_estado_cotizacion(v_q_negociando, 'negotiation', 'Pide bajar el alcance');

  -- Vencida: su plazo pasó y se marcó.
  insert into quotes (organization_id, legal_entity_id, brand_id, client_id, number,
    currency_code, tax_rate_pct, tax_label, valid_until, created_at)
  values (v_org, v_pe, v_marca_pe, v_cli_nova, next_quote_number(v_pe), 'PEN', 18, 'IGV',
    current_date - 10, now() - interval '60 days')
  returning id into v_q_vencida;
  perform add_quote_line_from_service(v_q_vencida, v_srv_redes, 1);
  perform emitir_cotizacion(v_q_vencida);
  perform cambiar_estado_cotizacion(v_q_vencida, 'expired', 'Se le pasó el plazo');

  -- Rechazada, y en la otra empresa: dos libros, dos monedas.
  insert into quotes (organization_id, legal_entity_id, brand_id, client_id, number,
    currency_code, tax_rate_pct, valid_until, created_at)
  values (v_org, v_us, v_marca_us, v_cli_harbor, next_quote_number(v_us), 'USD', 0,
    current_date + 15, now() - interval '30 days')
  returning id into v_q_rechazada;
  perform add_quote_line_from_service(v_q_rechazada, v_srv_retainer, 1);
  perform emitir_cotizacion(v_q_rechazada);
  perform cambiar_estado_cotizacion(v_q_rechazada, 'rejected', 'Eligió a otra agencia');

  -- Aprobada: la que llega hasta el dinero.
  insert into quotes (organization_id, legal_entity_id, brand_id, client_id, number,
    currency_code, tax_rate_pct, tax_label, valid_until, created_at)
  values (v_org, v_pe, v_marca_pe, v_cli_ej, next_quote_number(v_pe), 'PEN', 18, 'IGV',
    current_date + 30, now() - interval '40 days')
  returning id into v_q_aprobada;
  perform add_quote_line_from_service(v_q_aprobada, v_srv_lanz, 1);
  perform add_quote_line_from_service(v_q_aprobada, v_srv_redes, 2);
  perform emitir_cotizacion(v_q_aprobada, 'Versión final acordada');
  perform cambiar_estado_cotizacion(v_q_aprobada, 'approved', 'Firmada');

  -- ------------------------------------------------------------- el dinero
  -- El saldo de apertura es un movimiento más (`kind='opening'`), no un campo
  -- aparte: por eso hay una sola fórmula de saldo y no dos cifras que puedan
  -- discrepar (INV-1).
  perform registrar_movimiento(v_bcp, 'in', 18000, 'Saldo de apertura', null, 'opening');
  perform registrar_movimiento(v_chica, 'in', 600, 'Saldo de apertura', null, 'opening');
  perform registrar_movimiento(v_mercury, 'in', 4200, 'Saldo de apertura', null, 'opening');

  -- Mover dinero entre dos cuentas de la MISMA empresa, con su comisión. Las
  -- dos patas quedan fuera del resultado; la comisión no, porque se pagó.
  perform registrar_transferencia(v_bcp, v_chica, 1200, null,
    current_date - 6, 'Reponer la caja chica', 5, v_bcp);

  -- Un gasto con su IGV declarado, sin documento: él es su propio hecho.
  perform registrar_movimiento(v_bcp, 'out', 118, 'Taxis de la semana',
    current_date - 4, 'operating', v_g_servicios, null, null, 100, 18);

  -- Y uno sin desglose: el neto es el importe entero, no se inventa un IGV.
  perform registrar_movimiento(v_chica, 'out', 85, 'Café para la reunión',
    current_date - 3, 'operating', v_g_servicios);

  -- Un cobro que no salda ningún documento también es un hecho por sí mismo.
  perform registrar_movimiento(v_bcp, 'in', 450, 'Trabajo suelto sin factura',
    current_date - 8, 'operating', null, v_cli_nova);

  -- Lo que no es del negocio se ve, pero no se resta del resultado.
  perform registrar_movimiento(v_bcp, 'out', 2500, 'Retiro del dueño',
    current_date - 10, 'owner_draw');

  perform registrar_movimiento(v_mercury, 'out', 12, 'Comisión mensual del banco',
    current_date - 5, 'bank_fee', v_g_servicios);

  -- ---------------------------------------------- facturar y cobrar lo ganado
  -- La primera cuota de la aprobada: documento emitido y cobrado entero.
  select i.id into v_cuota
    from payment_schedule_items i
   where i.quote_id = v_q_aprobada
   order by i.due_date, i.sort
   limit 1;

  if v_cuota is not null then
    select id into v_doc from emitir_documento(v_cuota, 'invoice', 'F001-00000101',
      current_date - 20, current_date - 5);
    perform registrar_cobro(v_doc, v_bcp, (select amount_total from billing_documents where id = v_doc),
      current_date - 4, 'OP-884211');

    -- La segunda: emitida y cobrada a medias, que es el caso que de verdad
    -- se da y el que enseña «cobrado a medias» en la cartera.
    select i.id into v_cuota
      from payment_schedule_items i
     where i.quote_id = v_q_aprobada and i.status = 'planned'
     order by i.due_date, i.sort
     limit 1;

    if v_cuota is not null then
      select id into v_doc from emitir_documento(v_cuota, 'invoice', 'F001-00000102',
        current_date - 12, current_date + 8);
      perform registrar_cobro(v_doc, v_bcp,
        round((select amount_total from billing_documents where id = v_doc) / 2, 2),
        current_date - 2, 'OP-884390');
    end if;
  end if;

  -- --------------------------------------------------------------- compras
  -- Una con IGV: 236 son 200 de gasto y 36 de crédito fiscal.
  perform registrar_compra(v_pe, 'Movistar', 236, 'PEN',
    p_series => 'F001-998877',
    p_description => 'Teléfono e internet de octubre',
    p_issue_date => current_date - 7,
    p_due_date => current_date + 8,
    p_category => v_g_servicios);

  -- Una vencida y sin pagar: es la que tiene que saltar en Inicio.
  select id into v_compra from registrar_compra(v_pe, 'Imprenta Lima', 1180, 'PEN',
    p_series => 'F002-000450',
    p_description => 'Impresión de material para el lanzamiento',
    p_issue_date => current_date - 35,
    p_due_date => current_date - 12,
    p_category => v_g_proveedores);

  -- Una exonerada y pagada a medias.
  select id into v_compra from registrar_compra(v_pe, 'Freelance Video', 800, 'PEN',
    p_tax_rate => 0,
    p_description => 'Edición de dos piezas',
    p_issue_date => current_date - 15,
    p_due_date => current_date + 15,
    p_category => v_g_personal);
  perform registrar_pago_de_compra(v_compra, v_bcp, 300, current_date - 1, 'OP-884455');

  -- Y una en la otra empresa, en dólares y pagada entera.
  select id into v_compra from registrar_compra(v_us, 'Adobe', 59.99, 'USD',
    p_tax_rate => 0,
    p_description => 'Creative Cloud de noviembre',
    p_issue_date => current_date - 9,
    p_due_date => current_date - 2,
    p_category => v_g_herramientas);
  perform registrar_pago_de_compra(v_compra, v_mercury, 59.99, current_date - 2);

  -- ----------------------------------------------------------- gastos fijos
  perform guardar_gasto_recurrente(v_us, 'Adobe Creative Cloud', 59.99, 'USD',
    p_cadence => 'monthly', p_starts_on => (current_date - interval '6 months')::date,
    p_day => 5, p_account => v_mercury, p_category => v_g_herramientas,
    p_notes => 'Se renueva solo el día 5');
  perform guardar_gasto_recurrente(v_pe, 'Hosting y dominios', 145, 'PEN',
    p_cadence => 'monthly', p_starts_on => (current_date - interval '1 year')::date,
    p_day => 12, p_account => v_bcp, p_category => v_g_herramientas);
  perform guardar_gasto_recurrente(v_pe, 'Contador', 450, 'PEN',
    p_cadence => 'monthly', p_starts_on => (current_date - interval '2 years')::date,
    p_day => 28, p_account => v_bcp, p_category => v_g_servicios);
  perform guardar_gasto_recurrente(v_pe, 'Dominio .pe', 240, 'PEN',
    p_cadence => 'yearly', p_starts_on => (current_date - interval '3 years')::date,
    p_day => 3, p_account => v_bcp, p_category => v_g_herramientas);

  raise notice 'Margen Demo lista: organización %', v_org;
end $demo$;
