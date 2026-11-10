# Reglas financieras

Este documento es **normativo**. Si el código y este documento discrepan, el código está mal.
Cada regla tiene un identificador para citarla en tests (`TEST_PLAN.md`) y en revisiones de código.

---

## 1. Invariantes del sistema

### INV-1 — La caja tiene una sola fuente
El saldo de una cuenta es, siempre y en todo contexto:

```
saldo(cuenta) = Σ(amount donde direction='in') − Σ(amount donde direction='out')
                sobre cash_movements de esa cuenta con is_void = false
```

Ninguna otra tabla mueve dinero. Ni documentos, ni cronogramas, ni asignaciones, ni conciliaciones. El saldo de apertura del 1/1/2027 es un `cash_movement` con `kind='opening'`, de modo que no existe una segunda fórmula ni un "saldo inicial + movimientos".

### INV-2 — Una asignación nunca excede su movimiento
```
Σ(payment_allocations.amount) por cash_movement_id ≤ cash_movements.amount
```
Un cobro de S/ 400 no puede quedar asignado a S/ 500 de facturas.

### INV-3 — Una asignación nunca excede su documento, y el estado se deriva
```
pagado(documento) = Σ(payment_allocations.amount) del documento (movimientos no anulados)
pagado(documento) ≤ billing_documents.amount_total

status = 'paid'            si pagado = amount_total
       = 'partially_paid'  si 0 < pagado < amount_total
       = 'open'            si pagado = 0
```
`status` **nunca** se escribe a mano: lo recalcula un trigger. Un usuario no puede declarar pagada una factura sin que exista el dinero.

### INV-4 — Las monedas no se cruzan en una asignación
```
payment_allocations.currency_code = billing_documents.currency_code
                                  = cash_movements.currency_code
```
Consecuencia de producto: **no se puede cobrar en USD una factura emitida en PEN** (v1). La app lo impide en el formulario, con el mensaje: «Esta factura está en PEN. Para cobrarla en USD, emite el documento en USD.» Caso contemplado para v2 con movimiento explícito de `fx_adjustment` y diferencia de cambio registrada.

### INV-5 — Una transferencia no es un ingreso ni un gasto
Toda transferencia produce exactamente 2 o 3 `cash_movements` atados por `transfer_id`: la salida, la entrada y, si existe, la comisión. Salida y entrada tienen `kind='transfer'` → `flow_class='internal_transfer'`, excluido del lente **Resultado** por definición de la vista, no por un filtro que alguien pueda olvidar. La comisión sí es gasto real (`kind='bank_fee'` → `flow_class='operating'`).

Si hay cambio de moneda, se guardan los **cuatro** datos: monto origen, monto destino, `fx_rate` aplicado de verdad y comisión por separado. El `fx_rate` que se almacena es el **efectivamente aplicado por el banco** (monto destino ÷ monto origen), no una tasa de referencia.

Corolarios normativos, todos con estructura detrás (implantado el 10/11/2026):

1. **`fx_rate` no se escribe nunca:** es columna generada `round(amount_to / amount_from, 10)`. Una tasa que se teclea puede discrepar de los dos importes que la definen, y entonces hay dos verdades. El margen que el banco se quedó entre su tasa publicada y esta queda dentro de la cifra: no se desglosa porque no se conoce.
2. **En la misma moneda, `amount_from = amount_to`** (`check misma_moneda_mismo_importe`). No existe ninguna tasa que explique que salgan 1.000 soles y lleguen 970. Esa diferencia es una comisión y se registra como la tercera pata, que es gasto real y entra en el lente Resultado.
3. **Las dos cuentas son de la misma `legal_entity_id`.** Entre dos empresas del grupo el dinero sale del libro de una y entra en el de la otra: son dos hechos económicos, cada uno con su motivo —préstamo, aporte del dueño o venta con documento—, y clasificarlos como `internal_transfer` los escondería justo del lente que existe para verlos (ADR-16, INV-11).
4. **La comisión la paga una de las dos cuentas de la transferencia**, nunca una tercera, y va en la moneda de esa cuenta.
5. **No existe media transferencia.** Anular una pata anula todas (`anular_movimiento`), y un disparador diferido comprueba al cerrar la transacción que las patas vivas son 2 o 3 y cuadran con la cabecera, o que no hay ninguna. Anular solo la salida haría aparecer dinero en el destino.
6. **`kind = 'transfer'` exige `transfer_id`** (`check pata_sin_transferencia`). Una pata huérfana es dinero que sale del resultado sin que nada explique a dónde fue, y por eso «transferencia» no está entre los tipos del alta manual de movimientos.
7. **Una pata no se puede asignar a un documento** (`asignacion_de_transferencia`). Daría una factura por cobrada con dinero que no vino de ningún cliente.

### INV-6 — Hecho económico: la regla que evita el doble conteo
Un mismo gasto puede llegar de dos formas: con documento (factura del proveedor) o sin él (el taxi). Para no contarlo dos veces ni dejarlo fuera:

```
hechos económicos = todos los billing_documents  (no anulados, is_opening = false)
                       · direction='sale'     → entra  (una venta)
                       · direction='purchase' → sale   (una compra)
                  ∪ los cash_movements con flow_class='operating'
                       que NO tienen ninguna payment_allocation a un documento
```

Desde el 10/11/2026 la vista lleva `supplier_id` junto a `client_id` y el `category_id` del documento: un gasto con factura tiene categoría y proveedor igual que un movimiento suelto, y sin ellos caería en «sin categoría» y «sin proveedor» cuando sí se saben.

Es decir: si el movimiento está asignado a un documento, **el documento manda** (ya aporta su neto y su impuesto) y el movimiento solo es dinero. Si el movimiento no está asignado a nada, **el movimiento es su propio hecho económico** y aporta su `amount_net` / `amount_tax` (si el usuario los capturó) o su importe total como neto (si no hay impuesto).

Esta regla está escrita **una sola vez**, en la vista `economic_facts` (implantada el 10/11/2026). Ninguna pantalla la rehace: una consulta que la reimplemente con sus propios `where` es la forma segura de que dos pantallas den dos cifras distintas y nadie sepa cuál creer. La vista es `security_invoker`, así que filtra con las políticas de quien pregunta.

Qué deja fuera **por definición de la vista**, no por un filtro que alguien pueda olvidar:

- las patas de una transferencia (`flow_class = 'internal_transfer'`), por INV-5;
- los saldos de apertura (`flow_class = 'opening'`): el dinero con el que se arrancó no se ganó en el periodo;
- los documentos anulados y los movimientos anulados.

Qué deja dentro, y por qué: **lo no operativo**, con su `flow_class` puesta. Un retiro del dueño es un hecho económico y hay que poder verlo; lo que no se puede es restarlo del resultado del negocio. El lente lo enseña aparte, y el IGV cobrado y el pagado también —no son resultado, son dinero de la SUNAT que pasa por las cuentas—.

### INV-7 — Nada financiero se borra
`DELETE` está revocado para `authenticated` en: `cash_movements`, `billing_documents`, `payment_allocations`, `transfers`, `quote_versions`, `statement_imports`, `statement_lines`, `reconciliation_matches`, `reconciliation_decisions`, `audit_log`.

Anular un movimiento = marcar `is_void=true` con `void_reason` obligatorio. El saldo se corrige solo, porque la fórmula de INV-1 no cuenta lo anulado, y la fila se queda donde estaba, que es lo que esta regla protege.

**Corregido el 6/11/2026.** Esta regla pedía además crear el movimiento contrapartida con `void_of_id` apuntando al original. Las dos cosas juntas son incompatibles con INV-1 tal como está escrita: si la fórmula del saldo excluye los anulados **y** además existe una contrapartida, el dinero se resta dos veces. Hay dos diseños coherentes —marcar y excluir, o no excluir y compensar— y se elige el primero, porque es el que INV-1 escribe literalmente y el que deja una sola fórmula de saldo. `void_of_id` deja de existir; la trazabilidad de quién anuló y cuándo la da `audit_log`, que guarda la fila antes y después.

### INV-8 — Conciliar no crea dinero
Confirmar una coincidencia solo escribe en `reconciliation_matches`. El único camino que crea un `cash_movement` desde la conciliación es la acción explícita `create_movement`, que pasa por las mismas validaciones que el alta manual y queda marcada `source='bank_import'`.

### INV-9 — El dinero vive en la moneda de su cuenta
`cash_movements.currency_code` = `cash_accounts.currency_code`, validado por trigger. Una cuenta tiene una sola moneda. Si una cuenta real es multimoneda (algunos bancos lo permiten), se modela como dos cuentas con el mismo `account_ref_masked` y se concilia por separado.

### INV-11 — Ningún dato cruza de libro
`cash_movements.legal_entity_id` y `currency_code` se validan por trigger contra su `cash_account`. Un documento, una cotización y una oportunidad llevan también su `legal_entity_id`, y una asignación exige que documento y movimiento sean de la **misma entidad**. Consecuencia: no existe ninguna operación que mezcle el libro de 3 Brothers MKT SAC con el de The Publisher Ventures LLC (ADR-16).

### INV-11b — Un gasto fijo se paga desde una cuenta de su libro
Un gasto recurrente es una **regla de proyección, no dinero**: no crea movimientos. Se paga registrando un movimiento, que lo señala con `recurring_expense_id`, y la clave compuesta exige que coincidan **entidad y moneda**: un pago en soles no salda una suscripción en dólares, y de una cuenta solo sale el dinero de su empresa. Corolario normativo: **la empresa y la moneda de un gasto se pueden cambiar mientras ningún movimiento lo señale**, porque es entonces cuando no hay enlace que romper; con pagos registrados, no —se archiva y se crea otro, que además es lo que de verdad pasó—. Y quien explica el rechazo es el gate, con los nombres dentro: dejar que lo explique la restricción deja al usuario leyendo «falta un dato relacionado» (trampas #15 y #16).

### INV-10 — Dos monedas nunca se suman sin declararlo
Ninguna consulta, vista ni componente puede sumar importes de monedas distintas sin pasar por la función de conversión, que **exige** `fx_rate`, `as_of` y `source`. El total consolidado no se almacena nunca: se calcula en el momento de mostrarlo y viaja siempre con su etiqueta.

### INV-12 — Una compra tiene proveedor, y su IGV no es tu gasto
Implantado el 10/11/2026 (F3-6). Las ventas y las compras viven en la misma tabla, `billing_documents`, distinguidas por `direction`. De ahí salen seis reglas duras, y ninguna es una recomendación: cada una la impone una restricción.

1. **Una contraparte, la que corresponde a la dirección.** `check la_contraparte_concuerda`: una venta tiene `client_id` y no `supplier_id`; una compra, lo contrario. Una compra facturada a un cliente no es un error que se detecte: es una fila que no puede existir. Lo mismo en `cash_movements`, donde `una_sola_contraparte` impide que un movimiento señale a los dos.
2. **El proveedor es su propia lista.** `suppliers` no es `clients` con una marca. A un proveedor no se le cotiza, y si estuvieran juntos el casero aparecería en el desplegable de cliente de una cotización. El índice único es sobre `lower(btrim(name))`: «Movistar», «movistar» y «Movistar » son el mismo proveedor, porque si no el gasto de teléfono saldría repartido entre tres.
3. **La misma factura no entra dos veces.** Índice único parcial sobre `(organization_id, supplier_id, upper(btrim(series_number)))` para las compras vivas. Las anuladas quedan fuera a propósito: si una se anuló por estar mal escrita, su número tiene que poder volver a usarse.
4. **El IGV soportado no se resta del resultado.** El total de la factura lleva el impuesto dentro, y se parte una sola vez: `amount_net = round(total / (1 + tasa/100), decimales)` y `amount_tax = total − amount_net`. El lente Resultado resta el neto; el impuesto se dice aparte, porque es crédito fiscal que vuelve contra el IGV cobrado. Sumarlo al gasto desinfla el resultado todos los meses sin que nada avise. Sin tasa dicha se usa la de la empresa (`tax_rates.is_default`), nunca un 18 % supuesto: una factura exonerada existe, y un IGV inventado es crédito fiscal que no se tiene.
5. **La factura es un hecho el día que llega, no el día que se paga.** Por INV-6 el documento es el hecho y el pago solo es dinero. Es lo que hace que el resultado de un mes sea el de ese mes aunque se compre a treinta días.
6. **Cobrar y pagar comparten un solo cuerpo.** `app.saldar_documento` hace las dos cosas y deriva el signo, la contraparte y el verbo de la dirección del documento; `registrar_cobro` y `registrar_pago_de_compra` son dos puertas que se niegan a la dirección que no les toca (`esto_es_una_compra`, `esto_es_una_venta`). El tope de «cuánto queda» está escrito una vez. Y `app.respeta_los_topes` rechaza una asignación cuyo movimiento vaya en sentido contrario al documento (`direccion_no_concuerda`): un ingreso no paga una factura de proveedor.

Lo que esto **todavía no** permite: saber cuánto deja cada servicio. Para eso hace falta atar cada compra y cada venta a las líneas de la versión aceptada, y hoy una compra no sabe a qué trabajo pertenece. La categoría dice en qué se fue y el proveedor dice a quién; ninguna de las dos dice para qué trabajo.

### INV-13 — Un documento se anula; no se borra ni se vacía
`anular_documento` marca `status='void'` con su motivo escrito, y se **niega** si el documento tiene movimientos vivos asignados (`documento_con_dinero`): anularlo dejando sus cobros o pagos vivos convertiría ese dinero en una entrada o salida sin hecho que la explique. El orden es: primero el movimiento, después el documento. Al anularlo, la cuota de la que salió vuelve a `planned` con su `billing_document_id` en nulo, porque si no quedaría «documentada» señalando a un documento anulado y no habría forma de volver a facturarla.

---

## 2. Precios, costos y margen

### 2.1 Fórmulas

Por línea de cotización:

```
precio_neto_línea = qty × unit_price_net
impuesto_línea    = redondear(precio_neto_línea × tax_rate)
costo_línea       = Σ(quote_line_costs.qty × unit_cost)   [convertido a la moneda de la cotización]
```

Por cotización:

```
total_neto   = Σ precio_neto_línea        (suma de líneas ya redondeadas)
total_imp    = Σ impuesto_línea
total_bruto  = total_neto + total_imp
costo_directo = Σ costo_línea
utilidad     = total_neto − costo_directo
margen  = utilidad / total_neto      → NULL si total_neto = 0
markup  = utilidad / costo_directo   → NULL si costo_directo = 0
```

**`margen` y `markup` son campos distintos, se almacenan por separado y se etiquetan por separado en la UI.** El error del cotizador actual (guardar markup en un campo llamado `margen_bruto`) no se repite.

**Verificación obligatoria** (criterio §8.7 del plan): precio 100, costo 60 → `utilidad = 40`, `margen = 40,00 %`, `markup = 66,67 %`.

### 2.2 Derivar el precio desde el costo (fee / markup)

El fee se conserva como herramienta para **construir** el precio, nunca como medida de rentabilidad:

```
unit_price_net = costo_unitario_total × (1 + fee_pct / 100)
```

El precio resultante es **editable**: el usuario puede sobrescribirlo (el caso real "este proyecto vale 5.000 aunque cueste 1.200"). Si lo sobrescribe, `fee_pct` queda como `null` o como el fee implícito recalculado, y el margen se recalcula siempre desde el precio final. El cotizador actual no permite esto y es una de sus limitaciones reales.

### 2.3 Agregación de márgenes

**Prohibido promediar porcentajes de margen.** Para cualquier agrupación (mes, cliente, servicio, entidad):

```
margen_agregado = Σ utilidad / Σ precio_neto
```

Tres cotizaciones con márgenes 10 %, 50 % y 50 % no dan 36,7 % si la primera es de S/ 100.000 y las otras de S/ 1.000: dan 10,8 %. La media aritmética de porcentajes es una de las formas más fáciles de mentirse en un informe.

### 2.4 Inmutabilidad de lo emitido

Una `quote_version` es inmutable (sin `UPDATE` ni `DELETE`). El `snapshot` congela: entidad que factura, marca, cliente, líneas con sus precios, costos, impuestos, incluye/no incluye, condiciones, validez y los tipos de cambio usados. El PDF se genera **desde el snapshot** y se guarda con su `sha256`.

Consecuencia (criterio §8.8): cambiar mañana el costo de una licencia o reescribir la ficha de un servicio **no altera** ninguna cotización emitida. Editar una cotización ya enviada produce la versión siguiente; la anterior y su PDF permanecen.

---

## 3. Los dos lentes: Caja y Resultado

Toda cifra de la app pertenece a uno de dos lentes, y **cada gráfico y cada tarjeta declara el suyo en su propio título**. Esta es la respuesta al criterio §8.6 del plan.

| | **Caja** | **Resultado** |
|---|---|---|
| Pregunta | ¿Cuánto dinero tengo y se movió? | ¿Cuánto gané? |
| Fuente | `cash_movements` | hechos económicos (INV-6) |
| Importes | **brutos**, con impuesto incluido | **netos** de impuesto |
| Fecha que manda | `value_date` (cuando el banco movió) | `issue_date` del documento |
| Incluye apertura | sí (es dinero real) | **no** |
| Incluye transferencias propias | sí, en cada cuenta | **no** |
| Incluye retiros/aportes/préstamos | sí (afectan caja) | **no** (no son operación) |
| Incluye pendiente de cobro | **no** | sí (ya se devengó) |
| Concilia con el banco | **sí, es la única que concilia** | no |

Reglas duras que se derivan:
- **R-3.1** El saldo bancario corresponde a flujos brutos reales. Jamás se muestra un "saldo" calculado con importes netos de IGV.
- **R-3.2** Una cotización aprobada de S/ 1.000 no mueve el lente Caja en nada. Cobrar S/ 400 mueve Caja +400 y deja S/ 600 en cartera (criterio §8.4).
- **R-3.3** El saldo de apertura no es venta ni utilidad de 2027 (criterio §8.5): `flow_class='opening'` está fuera del lente Resultado.
- **R-3.4** "Utilidad" nunca aparece junto a "saldo" en la misma tarjeta sin etiqueta de lente. Son preguntas distintas.
- **R-3.5** El lente Resultado de v1 es *accrual ligero*, no contabilidad: no hay depreciación, ni devengo de provisiones, ni cierre contable. La app no es software contable y la UI no debe insinuar que lo es.

---

## 4. Precisión, escalas y redondeo

| Dato | Tipo |
|---|---|
| Importes que liquidan (caja, documentos, asignaciones) | `numeric(18,2)` |
| Precios unitarios, cantidades, costos unitarios de cotización | `numeric(18,4)` |
| Porcentajes (fee, impuesto, margen) | `numeric(7,4)` |
| Tipos de cambio | `numeric(18,8)` |
| Cálculo intermedio | `numeric(18,6)` |

Prohibido `float`, `double precision` y `real` para cualquier monto, en la base y en el cliente. En TypeScript, los montos viajan como `string` desde Postgres y se manejan con enteros de unidad mínima o `dinero.js`; nunca como `number` acumulable.

**Reglas de redondeo:**
- **R-4.1** HALF_UP (0,005 → 0,01), que es lo que espera cualquier usuario y lo que hace la factura peruana.
- **R-4.2** Se redondea **al cerrar cada línea**. El total es la suma de líneas ya redondeadas. **No se redondea el total al final**: eso es lo que produce los descuadres de un céntimo que el plan pone como caso de prueba obligatorio.
- **R-4.3** El impuesto se calcula sobre el neto **ya redondeado** de la línea.
- **R-4.4** Los decimales de presentación salen de `currencies.minor_unit` (2 para PEN y USD), no de una constante en el código.
- **R-4.5** Si una conversión FX genera residuo, el residuo se registra, no se reparte: aparece como `fx_adjustment` si llega a mover caja, o se muestra como diferencia en el consolidado referencial.

---

## 5. Multimoneda y tipo de cambio

### 5.1 Qué moneda manda, siempre
Cada transacción conserva su moneda original. Cada cuenta tiene una sola moneda (INV-9). Los saldos se presentan **por moneda**, en bloques separados, sin excepción.

### 5.2 El consolidado es referencial y está etiquetado
Un total consolidado solo puede mostrarse con las cuatro piezas visibles: **monto, tasa, fecha de la tasa y fuente**.

> Total referencial: **S/ 2.950** · TC 3,90 al 31/12/2026 (SBS) · incluye US$ 500 convertidos

Sin esas cuatro piezas, el número no se muestra. Y no se almacena nunca: se calcula al mostrarlo. Criterio §8.3 satisfecho: S/ 1.000 y US$ 500 nunca aparecen como "1.500".

### 5.3 Qué tasa se usa, según el caso

| Caso | Tasa |
|---|---|
| Transferencia con cambio | la **efectivamente aplicada** por el banco (destino ÷ origen). Es un hecho, no una referencia. |
| Costo de cotización en otra moneda que la cotización | la tasa del día de **emisión** de la versión, congelada en el snapshot |
| Consolidado de saldos de hoy | política de la organización (`fx_policy`), por defecto **última tasa disponible** con su fecha |
| Informe histórico de un mes | tasa de **cierre** de ese mes, no la de hoy (si no, el pasado cambia cada día) |
| Documento emitido en moneda extranjera | tasa de su `issue_date`, congelada en el documento |

`fx_rates` guarda `(from, to, rate, as_of, source, kind)` y es append-only: una tasa nunca se corrige, se añade otra con `as_of` posterior. La fuente puede ser manual al inicio (el usuario la escribe) y automatizarse después sin cambiar el modelo.

---

## 6. Apertura al 1/1/2027 — aporte del dueño (ADR-17)

Decisión de Marcelo del 28/10/2026: la apertura se simplifica al máximo.

1. **Por cada cuenta, un movimiento `owner_contribution`** con el dinero que haya al 1/1/2027, `direction='in'`, `value_date='2027-01-01'`, descripción «Aporte inicial del dueño».
2. **No se cargan cuentas por cobrar ni por pagar abiertas de 2026.** Si queda algo pendiente de cobrar de 2026, se registra como documento nuevo cuando se cobre, o no se registra: no es información de 2027.
3. **No se carga nada más.** Ni cotizaciones, ni movimientos, ni contactos históricos. El catálogo de servicios y de clientes sí se puede cargar antes: no es transaccional y no es migración.
4. **Por qué no infla nada:** `owner_contribution` tiene `flow_class = 'non_operating'`, así que entra en el lente Caja y queda fuera del lente Resultado. El aporte no es venta ni utilidad de 2027 (R-3.3).
5. `kind='opening'` y la tabla `opening_balances` **no se usan**: quedan en el enum por compatibilidad pero ninguna fila los usa.

El cuadre contra los extractos del 31/12 sigue siendo buena idea, pero es tuyo y manual: el sistema solo necesita el importe con el que arrancas.

---

## 7. Lo que esta app no hace (y la UI no debe insinuar)

- No emite comprobantes electrónicos ante SUNAT, no valida series ni RUC contra SUNAT, no genera PLE ni libros electrónicos.
- No calcula renta, ni retenciones, ni detracciones, ni liquida IGV. Separa base e impuesto para informar, no para declarar.
- No hace contabilidad por partida doble, ni plan de cuentas, ni asientos.
- No conecta con bancos por API ni Open Banking. Solo archivos que el usuario descarga de su banca.
- No da asesoría financiera ni tributaria.

Donde el usuario pueda confundirse (p. ej. la pantalla de impuestos), la UI lo dice en una línea. Es más barato aclararlo que sostener la expectativa equivocada.
