-- ---------------------------------------------------------------------------
-- Margen Pilot · F3-5 · El hecho económico
-- ---------------------------------------------------------------------------
--
-- El lente Resultado tiene que contestar «cuánto deja esto» sin contar nada
-- dos veces ni dejarse nada fuera, y eso es más difícil de lo que parece,
-- porque el mismo gasto puede llegar de dos formas: con documento (la factura
-- del proveedor) o sin él (el taxi). Y el mismo cobro está dos veces en la
-- base a propósito: el documento, que es la venta, y el movimiento, que es el
-- dinero con el que se pagó.
--
-- INV-6 lo resuelve con una sola regla:
--
--   hechos económicos = los billing_documents  (no anulados, is_opening = false)
--                     ∪ los cash_movements que NO están asignados a un documento
--
-- Si el movimiento está asignado, **el documento manda**: ya aportó su neto y
-- su impuesto, y el movimiento solo fue el dinero. Si no está asignado a nada,
-- **el movimiento es su propio hecho económico**.
--
-- Esta vista es esa regla escrita una vez. La alternativa —que cada pantalla
-- la rehaga con sus `where`— es la forma segura de que dentro de tres meses
-- dos pantallas den dos cifras distintas y nadie sepa cuál creer.
--
-- Dos cosas quedan fuera por definición de la vista, no por un filtro que
-- alguien pueda olvidar:
--
--   · las patas de una transferencia (`internal_transfer`), porque mover
--     dinero entre cuentas propias no es un ingreso ni un gasto (INV-5);
--   · los saldos de apertura (`opening`), porque el dinero con el que
--     arrancaste no lo ganaste este mes.
--
-- Lo no operativo sí entra, con su clase puesta: un retiro del dueño es un
-- hecho económico y hay que poder verlo. Lo que no se puede es llamarlo gasto
-- y restarlo del resultado del negocio, y para eso está `flow_class`, que no
-- se elige: se deduce del tipo.
--
-- `security_invoker` para que la vista no sea un agujero: filtra con las
-- políticas de quien pregunta, no con las del dueño de la vista.
-- ---------------------------------------------------------------------------

create view economic_facts with (security_invoker = true) as

-- La venta: existe cuando se emite el documento, no cuando se cobra.
select d.organization_id,
       d.legal_entity_id,
       d.currency_code,
       'documento'::text                                   as origen,
       d.id                                                as source_id,
       d.issue_date                                         as fecha,
       -- Hoy solo hay ventas. La columna existe para que el día que entren
       -- las compras esta vista ya las ponga del lado correcto sin tocarla.
       case when d.direction = 'sale' then 'in' else 'out' end::cash_direction as direction,
       'operating'::flow_class                              as flow_class,
       null::cash_kind                                      as kind,
       d.amount_total,
       d.amount_net,
       d.amount_tax,
       null::uuid                                           as category_id,
       d.client_id,
       coalesce(nullif(btrim(d.series_number), ''), 'Documento sin número') as concepto
  from billing_documents d
 where d.status <> 'void'
   and not d.is_opening

union all

-- Y el movimiento que no salda ningún documento: entonces él es el hecho.
select m.organization_id,
       m.legal_entity_id,
       m.currency_code,
       'movimiento'::text,
       m.id,
       m.value_date,
       m.direction,
       m.flow_class,
       m.kind,
       m.amount,
       -- Si el usuario no desglosó impuesto, el neto es el importe entero.
       -- Inventar un IGV donde no se declaró sería peor que no tenerlo.
       coalesce(m.amount_net, m.amount),
       coalesce(m.amount_tax, 0),
       m.category_id,
       m.client_id,
       m.description
  from cash_movements m
 where not m.is_void
   and m.flow_class in ('operating', 'non_operating')
   and not exists (
         select 1 from payment_allocations a
          where a.cash_movement_id = m.id
            and a.billing_document_id is not null);

comment on view economic_facts is
  'INV-6 escrito una vez: los documentos emitidos más los movimientos que no saldan ninguno. Excluye las patas de transferencia y las aperturas por definición, no por filtro.';

grant select on economic_facts to authenticated;
