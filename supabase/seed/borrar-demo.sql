-- Quita la organización de demostración y, con ella, todo lo que colgaba de
-- ella: entidades, marcas, cuentas, movimientos, documentos, compras,
-- proveedores, cotizaciones, versiones, cuotas y gastos fijos.
--
-- Es una sola fila porque todas las tablas cuelgan de `organization_id` con
-- `on delete cascade`. Por eso los datos de prueba fueron a su propia
-- organización: dentro de «Margen Pilot» no se podrían quitar, porque nada
-- financiero se borra (INV-7) y lo más que se podría hacer es anularlos,
-- dejándolos a la vista para siempre.
--
-- No toca «Margen Pilot»: el `where` nombra el slug de la demo y nada más.

delete from organizations where slug = 'margen-demo';

select 'Si esto devuelve 0, la demo ya no está: ' ||
       (select count(*) from organizations where slug = 'margen-demo')::text as resultado;
