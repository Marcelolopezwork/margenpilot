# Plan de pruebas

**Regla:** las pruebas de dinero se escriben **en la misma semana** que la funcionalidad, no al final. La puerta G2 del roadmap (6 de diciembre) exige verlas en verde.

| Capa | Herramienta | Qué cubre |
|---|---|---|
| Base de datos | **pgTAP** | Invariantes INV-1 a INV-10, RLS, entitlements, triggers, máquina de estados |
| Dominio | **Vitest** | Fórmulas de margen, redondeo, conversión FX, formato de moneda, huellas de conciliación |
| Flujos | **Playwright** | Cotizar → aprobar → documentar → cobrar → cuadrar; importar y conciliar |
| Seguridad | pgTAP + Playwright | Aislamiento entre organizaciones, costos ocultos al rol comercial, API de agentes |
| Datos | seed sintético versionado | Todo. **Ningún test usa datos reales, nunca.** |

---

## 1. Invariantes (pgTAP) — bloquean el merge

| Test | Invariante | Qué verifica |
|---|---|---|
| `inv01_balance_single_source` | INV-1 | El saldo de una cuenta es exactamente Σin − Σout de movimientos no anulados. Insertar un documento, un cronograma o una asignación **no** cambia el saldo |
| `inv01_opening_is_movement` | INV-1 | El saldo de apertura es un movimiento; no hay segunda fórmula de saldo en el esquema |
| `inv02_allocation_le_movement` | INV-2 | Asignar S/ 500 a un cobro de S/ 400 falla |
| `inv03_allocation_le_document` | INV-3 | Asignar más que el total del documento falla; el estado del documento se deriva solo |
| `inv03_status_not_writable` | INV-3 | `UPDATE ... SET status='paid'` sin asignaciones no deja el documento pagado |
| `inv04_currency_match` | INV-4 | Asignar un cobro en USD a una factura en PEN falla |
| `inv05_transfer_not_income` | INV-5 | Una transferencia crea 2–3 movimientos con `transfer_id` y aporta 0 al lente Resultado |
| `inv05_fx_transfer_fields` | INV-5 | Transferencia con cambio exige `fx_rate`; se guardan monto origen, destino, TC y comisión por separado |
| `inv06_no_double_count` | INV-6 | Un gasto con documento y cobro asignado se cuenta una vez; un gasto sin documento, una vez; nunca dos |
| `inv07_no_delete` | INV-7 | `DELETE` falla para `authenticated` en las 10 tablas protegidas |
| `inv07_void_is_reversal` | INV-7 | Anular crea contrapartida con `void_of_id` y motivo; el saldo vuelve al valor previo |
| `inv08_match_creates_no_cash` | INV-8 | Confirmar una coincidencia no inserta ningún `cash_movement` |
| `inv09_movement_currency` | INV-9 | Un movimiento en moneda distinta a su cuenta falla |
| `inv10_no_blind_sum` | INV-10 | La función de consolidado exige tasa, fecha y fuente; sin ellas, devuelve error, no un número |

---

## 2. Casos de dinero (Vitest + pgTAP)

Los criterios de aceptación §8 del plan, uno por uno:

| # | Caso | Esperado |
|---|---|---|
| D-1 | Free intenta crear la 2.ª entidad o la 2.ª moneda | Rechazo desde la base; no se puede eludir por API ni por el cliente |
| D-1b | Dos sesiones crean la 2.ª entidad simultáneamente en Free | Una pasa, la otra falla con `plan_limit_reached` (lock por organización) |
| D-2 | Dos organizaciones sintéticas, barrido de todas las tablas | Cero filas cruzadas en tablas, archivos de Storage, funciones y API de agentes |
| D-3 | S/ 1.000 y US$ 500 en el dashboard | Nunca "1.500". El consolidado solo aparece con TC, fecha y fuente |
| D-4 | Cotización de S/ 1.000 aprobada; luego cobro de S/ 400 | Aprobar: caja +0. Cobrar: caja +400, documento `partially_paid`, S/ 600 por cobrar |
| D-5 | Saldo de apertura de S/ 10.000 al 1/1/2027 | Caja +10.000; ventas 2027 = 0; utilidad 2027 = 0 |
| D-6 | Factura de S/ 1.180 (neto 1.000 + IGV 180) cobrada completa | Caja +1.180 (bruto). Lente Resultado +1.000 (neto) |
| D-7 | Precio 100, costo 60 | `margen = 40,00 %`, `markup = 66,67 %`, en campos distintos |
| D-7b | Tres cotizaciones: 100k al 10 %, 1k al 50 %, 1k al 50 % | Margen agregado 10,8 %, **no** 36,7 % |
| D-8 | Cambiar el costo de una herramienta usada en una cotización emitida | La versión emitida y su PDF no cambian en nada |
| D-9 | PDF de una versión emitida | Refleja snapshot: entidad, marca, moneda, impuestos, términos, incluye/no incluye |
| D-9b | Anular una cotización emitida | Conserva versiones, PDF y bitácora; motivo obligatorio |
| D-10 | Transferir US$ 1.000 de Mercury a BCP USD | Ingreso operativo = 0; dos movimientos ligados; saldos cuadran |
| D-10b | Transferir US$ 1.000 a PEN con TC 3,78 y comisión US$ 5 | Origen 1.000 USD, destino 3.780 PEN, TC 3,78 almacenado, comisión 5 USD como gasto separado |
| D-11 | Un cobro de S/ 1.200 aplicado a dos facturas (1.000 y 200 de 800) | Primera `paid`, segunda `partially_paid` con 600 pendientes |
| D-12 | Redondeo: 3 líneas de S/ 33,335 con IGV 18 % | Total = suma de líneas ya redondeadas; descuadre de céntimos = 0 |
| D-13 | Retiro del dueño de S/ 5.000 | Caja −5.000; lente Resultado sin cambio |
| D-14 | Préstamo recibido de S/ 20.000 | Caja +20.000; ingresos 2027 = 0 |

---

## 3. Casos obligatorios de conciliación (F4)

Los doce casos que el plan exige (§3.5), cada uno con un archivo sintético versionado en `tests/fixtures/statements/`:

| # | Caso | Esperado |
|---|---|---|
| C-1 | Dos pagos del mismo importe el mismo día | Ambos conservados (`occurrence` 1 y 2); no se marcan duplicados entre sí |
| C-2 | Abono agrupado: una línea de S/ 3.000 que cubre tres facturas | Se propone como un match de 3 movimientos; se aprueba una vez |
| C-3 | Pago parcial: línea de S/ 400 contra movimiento abierto de S/ 1.000 | Conciliación parcial; el resto queda pendiente |
| C-4 | Reverso bancario: cargo y su contracargo | Se proponen como par; el neto en caja es 0; ninguno se ignora silenciosamente |
| C-5 | Comisión bancaria sin candidato | Se propone `mark_fee`; crea movimiento `bank_fee` solo tras aprobación |
| C-6 | Cambio de divisa reflejado en dos cuentas | Se propone `mark_transfer`; **no** crea ingreso (§8.10) |
| C-7 | Transferencia entre cuentas propias | Igual que C-6; el espejo se detecta por monto, signo y ventana de fechas |
| C-8 | Importación duplicada del mismo archivo | 0 líneas nuevas; se reabre el import existente |
| C-8b | Importación de período solapado, archivo distinto | Informa "N ya importadas, M nuevas"; inserta solo las M |
| C-9 | Fecha de banco distinta de la de emisión del documento | Coincidencia por monto + referencia con Δ fecha ≤ 7 días, con score menor |
| C-10 | Estado de cuenta incompleto (sin saldo final) | Pide saldo al usuario; sin él, no se declara conciliado |
| C-11 | `apertura + abonos − cargos ≠ cierre` | `integrity_ok=false`, diferencia visible, cuenta no conciliable (§8.12) |
| C-12 | Redondeo de céntimos en el archivo del banco | Tolerancia ±0,01 marcada como coincidencia de 0,90, no de 1,0 |

Y dos casos de seguridad del archivo: XLSX con macros → rechazado; archivo de 20 MB → rechazado.

---

## 4. Seguridad

| Test | Esperado |
|---|---|
| RLS barrido completo | Para cada tabla con `organization_id`: usuario de la org B obtiene 0 filas de la org A |
| Rol comercial y costos | `cost_items`, `service_cost_lines`, `quote_line_costs` devuelven 0 filas; `quotes_commercial` no expone `total_cost` ni `margin_pct` |
| Storage | Un usuario de la org B no obtiene URL firmada de un archivo de la org A |
| Números de cuenta | Barrido de todas las tablas y logs: ningún número de cuenta completo almacenado |
| Tokens de agente | Un token con scope `read:cash` no puede leer cotizaciones; cada llamada queda auditada; revocar surte efecto inmediato |
| Escritura de agentes | Ninguna ruta de la API de agentes permite escribir (F5) |
| Webhooks Stripe | El mismo `evt_` dos veces no duplica suscripción ni altera el plan (F7) |
| Plan desde el cliente | Una petición manipulada que declare `plan='pro'` no cambia nada |

---

## 5. Flujos de punta a punta (Playwright)

| Flujo | Pasos |
|---|---|
| E2E-1 **Ciclo comercial completo** | Crear servicio con costos → cotizar → emitir PDF → aprobar → generar cronograma → documentar cuota → registrar cobro parcial → verificar caja y cartera |
| E2E-2 **Ciclo de caja** | Registrar gasto sin documento → registrar gasto con factura → transferir entre cuentas con FX → retiro del dueño → verificar los dos lentes |
| E2E-3 **Cuadre mensual** | Marcar movimientos vistos → declarar saldo → ver diferencia → cerrar mes → reabrir y verificar el rastro |
| E2E-4 **Aislamiento** | Sesión en org A y sesión en org B en paralelo: ninguna ve nada de la otra en ninguna pantalla |
| E2E-5 **Límites de plan** | Org Free intenta la 2.ª entidad por UI y por llamada directa: ambas rechazadas con mensaje claro |
| E2E-6 **Conciliación** (F4) | Importar archivo → mapear → revisar sugerencias → aprobar una, crear una, ignorar una → reimportar y comprobar que nada se duplica |

---

## 6. Respaldo y restauración

**Requisito de arranque (F6-2), no opcional:** antes del 1/1/2027 hay que demostrar, con evidencia escrita y fechada, que un respaldo de producción se restaura en un proyecto limpio y que los saldos por cuenta coinciden exactamente. Un sistema financiero sin restauración probada no está listo para registrar dinero, por bien que funcione todo lo demás.

Se repite trimestralmente y queda registrado en `docs/EVIDENCIA_RESTAURACION.md`.

---

## 7. Qué bloquea un merge

1. Typecheck, lint y tests en verde.
2. Migraciones aplican en una base efímera desde cero **y** la reversión está probada en local.
3. Ninguna prueba de invariantes desactivada o marcada como pendiente.
4. Toda tabla nueva con `organization_id` llega con su RLS **y** su test de aislamiento en el mismo PR.
5. Ningún dato real en fixtures ni en seeds.
