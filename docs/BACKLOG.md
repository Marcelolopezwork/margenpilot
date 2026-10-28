# Backlog ejecutable

> **Actualizado el 28/10/2026.** Las secciones **F4 Conciliación bancaria** y las historias de agentes de **F5** quedan fuera de alcance (ADR-18). Entra **Pipeline y seguimiento** como fase F4 nueva (ADR-19). El orden vigente de fases está en `DECISIONS.md` ADR-23. Las horas estimadas quedan sin efecto (ADR-20).


Cada historia tiene identificador, estimación en horas y **criterio de aceptación verificable**. Una historia no está hecha si su criterio no se puede demostrar en una demo o en un test.

Prioridades: **P0** imprescindible antes de usar dinero real · **P1** antes o poco después de enero · **P2** SaaS público.

Orden de ejecución: **F0 → F1 → F3 → F2 → F3.5 → F6**, por la razón de `ROADMAP.md` §4.

---

## F0 — Decisiones, diseño y entorno · 20–25 h · P0

| ID | Historia | h | Aceptación |
|---|---|---|---|
| F0-1 | Cerrar las decisiones bloqueantes de `DECISIONS.md` §2 | 3 | Las 6 decisiones tienen respuesta escrita y fecha en `DECISIONS.md` |
| F0-2 | Repo Git privado con estructura, `.env.example` sin secretos, `README.md` | 3 | `git clone` + `npm i` + `supabase start` + `npm run dev` funciona en limpio siguiendo solo el README |
| F0-3 | CI: typecheck, lint, test, migraciones en DB efímera | 3 | Un PR con un error de tipos o una migración que no aplica queda bloqueado |
| F0-4 | Tokens de diseño (color, tipografía, espaciado, radios) en claro y oscuro | 4 | Página de tokens renderizada; contraste AA verificado en ambos modos |
| F0-5 | Wireframes de Inicio, Cotización, Ficha de servicio, Movimiento y Cuadre | 8 | Los 5 wireframes revisados y aprobados por Marcelo, en móvil y escritorio |
| F0-6 | Seed sintético: 2 organizaciones, 3 entidades, 5 cuentas, 2 monedas, clientes, servicios | 3 | `npm run seed` reproduce el mismo estado siempre; ninguna fila con datos reales |

---

## F1 — Fundaciones SaaS · 45–60 h · P0

| ID | Historia | h | Aceptación |
|---|---|---|---|
| F1-1 | Auth con email + contraseña y recuperación; `profiles` ligado a `auth.users` | 5 | Alta, acceso, salida y recuperación funcionan en staging |
| F1-2 | `organizations` + `memberships` + roles; crear la primera organización al registrarse | 6 | Un usuario nuevo acaba con una organización propia y rol `owner` |
| F1-3 | Helpers `app.current_orgs()` y `app.has_role()`, con `security definer` | 3 | Un test demuestra que no hay recursión de políticas y que un usuario sin membresía no ve nada |
| F1-4 | RLS en todas las tablas de F1: select/insert/update por organización y rol; sin DELETE en tablas financieras | 8 | **pgTAP:** con 2 organizaciones sintéticas, cero filas cruzadas en toda tabla; `DELETE` sobre `cash_movements` falla para `authenticated` |
| F1-5 | `legal_entities` y `brands`; una marca no puede tener cuentas ni emitir documentos | 5 | No existe FK de `brands` a `cash_accounts` ni a `billing_documents`; un intento de crear una cuenta "de marca" no tiene camino en la UI ni en la API |
| F1-6 | `currencies`, `organization_currencies`, `cash_accounts` con moneda única por cuenta | 5 | Crear un movimiento en moneda distinta a su cuenta falla con error claro (INV-9) |
| F1-7 | `tax_rates` por entidad, con una entidad al 18 % y otra al 0 % | 3 | La entidad al 0 % no muestra bloque de impuesto en la UI |
| F1-8 | `plans`, `plan_entitlements`, `subscriptions`; plan `internal` para la organización propia | 4 | La organización propia opera con 3 entidades y 2 monedas sin error |
| F1-9 | `app.assert_entitlement()` + triggers en entidades, monedas, cuentas y miembros | 6 | **Test de concurrencia:** dos inserciones simultáneas de la 2.ª entidad en Free → una pasa, la otra falla con `plan_limit_reached` |
| F1-10 | Degradación de plan: elección de activos, archivado, bloqueo de operaciones nuevas | 5 | Bajar de Pro a Free no borra ninguna fila; sin elegir, toda operación nueva está bloqueada |
| F1-11 | `audit_log` con trigger genérico en tablas sensibles | 4 | Toda modificación de un movimiento o documento deja fila con actor, antes y después |
| F1-12 | Shell de la app: layout, sidebar, navegación móvil, selector de organización y entidad, claro/oscuro | 6 | Navegable completo en 375 px y en escritorio, teclado incluido |

---

## F3 — Finanzas y caja · 70–90 h · P0

| ID | Historia | h | Aceptación |
|---|---|---|---|
| F3-1 | `clients`, `suppliers`, `contacts` con alta, edición y búsqueda | 6 | Alta y búsqueda por nombre y documento de identidad fiscal |
| F3-2 | `financial_categories` por organización, con semilla razonable | 3 | Categorías editables; una categoría en uso no se puede eliminar, se desactiva |
| F3-3 | `cash_movements`: alta de cobro y de pago con cuenta, moneda, fecha de valor, contraparte, categoría y referencia | 10 | Un movimiento creado aparece en el saldo de su cuenta **inmediatamente** y solo ahí (INV-1) |
| F3-4 | Anulación por contrapartida con motivo obligatorio | 5 | Anular deja original + contrapartida + motivo; el saldo vuelve al valor previo; no hay `DELETE` posible (INV-7) |
| F3-5 | `billing_documents` de venta y de compra, con base, impuesto y total consistentes | 8 | `amount_total = amount_net + amount_tax` impuesto por CHECK; una venta exige cliente y una compra exige proveedor |
| F3-6 | `payment_allocations`: asignar un cobro a uno o varios documentos, y pagos parciales | 10 | **Criterio §8.4:** aprobar no mueve caja; cobrar 400 de 1.000 deja el documento `partially_paid` con 600 pendientes (INV-2, INV-3) |
| F3-7 | Estado del documento derivado por trigger, nunca escrito a mano | 4 | Intentar poner `paid` sin asignaciones no cambia el estado |
| F3-8 | Bloqueo de asignación entre monedas distintas, con mensaje útil | 3 | **INV-4:** cobrar en USD una factura en PEN es imposible y el mensaje explica qué hacer |
| F3-9 | Transferencias entre cuentas propias, misma moneda | 6 | Dos movimientos atados por `transfer_id`; ni ingreso ni gasto en el lente Resultado (INV-5, §8.10) |
| F3-10 | Transferencias con cambio de moneda: monto origen, monto destino, TC aplicado y comisión por separado | 7 | Mover US$ 1.000 a PEN guarda los cuatro datos; el TC almacenado es destino ÷ origen |
| F3-11 | Movimientos no operativos: retiro y aporte del dueño, préstamo, amortización, comisión bancaria, pago de impuestos | 5 | Un retiro de S/ 5.000 baja la caja y **no** aparece en el lente Resultado |
| F3-12 | Apertura: saldos por cuenta y obligaciones vivas al 1/1/2027, marcadas como apertura | 6 | **Criterio §8.5:** la apertura no suma a ventas ni a utilidad de 2027; un trigger impide crear movimientos `opening` después del cierre de apertura |
| F3-13 | Vista `account_balances` y dashboard de caja por cuenta, entidad y moneda | 8 | Los saldos cuadran con la suma manual de movimientos en cada agrupación |
| F3-14 | Consolidado referencial con TC, fecha y fuente visibles; `fx_rates` append-only | 6 | **Criterio §8.3:** S/ 1.000 + US$ 500 nunca se muestran como 1.500; sin tasa cargada, el consolidado no se muestra y explica por qué |
| F3-15 | Vista de hechos económicos (INV-6) y los dos lentes separados en la UI | 6 | Un gasto con factura asignada se cuenta una vez; un gasto sin documento también se cuenta una vez |
| F3-16 | Listado de movimientos con filtros (cuenta, entidad, moneda, rango, categoría, contraparte, estado) y exportación CSV | 6 | El CSV exportado reproduce exactamente lo filtrado, con moneda por fila |

---

## F2 — Catálogos y cotizador · 70–90 h · P0

| ID | Historia | h | Aceptación |
|---|---|---|---|
| F2-1 | `service_categories` y `cost_items` (roles, herramientas, externos) con unidad y costo | 6 | Un ítem de costo se reusa en varias fichas; desactivarlo no afecta fichas existentes |
| F2-2 | Ficha de servicio: nombre, código, categoría, descripción, tipo, periodicidad, moneda sugerida | 6 | Alta y edición completas; código único por organización |
| F2-3 | Incluye / no incluye ordenables, condiciones y notas estándar | 5 | Reordenar por arrastre persiste el orden; el PDF respeta ese orden |
| F2-4 | Composición de costos de la ficha (`service_cost_lines`) con fee por defecto y precio sugerido | 6 | La ficha muestra costo total, precio sugerido y **margen real aparte** del fee |
| F2-5 | RLS de costos: `commercial` no lee `cost_items`, `service_cost_lines` ni `quote_line_costs` | 5 | Un usuario `commercial` obtiene cero filas de las tres tablas y la UI no muestra huecos ni errores |
| F2-6 | Cotización: entidad, marca, cliente, moneda, impuesto, validez, origen del lead | 6 | Numeración única por entidad; la marca solo afecta presentación |
| F2-7 | Líneas de cotización con precio editable **o** derivado por fee | 8 | Sobrescribir el precio recalcula margen y markup; derivarlo desde el costo también (§2.2 de `FINANCIAL_RULES.md`) |
| F2-8 | Cálculo de utilidad, margen y markup como campos distintos | 5 | **Criterio §8.7:** precio 100, costo 60 → margen 40 %, markup 66,67 %, ambos visibles y etiquetados |
| F2-9 | Impuestos en la cotización: base, impuesto y total claros | 4 | Redondeo por línea y total = suma de líneas redondeadas (R-4.2); una entidad al 0 % no muestra impuesto |
| F2-10 | Estados y transiciones con bitácora | 6 | Transiciones ilegales rechazadas por trigger; cada cambio deja fila en `quote_events` |
| F2-11 | Emisión: `quote_versions` inmutable con snapshot + totales | 7 | **Criterio §8.8:** cambiar el costo de una herramienta no altera ninguna versión emitida; `UPDATE` sobre `quote_versions` falla |
| F2-12 | PDF server-side desde el snapshot, con `sha256` | 8 | **Criterio §8.9:** el PDF refleja entidad, marca, moneda, impuestos, términos e incluye/no incluye del snapshot, no del catálogo vivo |
| F2-13 | Reemisión como versión nueva; duplicar una cotización | 4 | Editar una cotización enviada crea v2 y conserva v1 con su PDF |
| F2-14 | Anulación con motivo y auditoría | 3 | Una cotización anulada conserva versiones, PDF y bitácora |
| F2-15 | Aprobación → cronograma de cobro editable (anticipo, cuotas, fechas, cuenta destino) | 7 | Las cuotas nacen `planned`: entran en proyección y **no** en "Por cobrar" (revisión §4.5) |
| F2-16 | Cuota → documento → cobro: el ciclo completo | 5 | Documentar una cuota la pasa a `documented` y a la cartera; cobrarla la pasa a `settled` |
| F2-17 | Listado de cotizaciones con filtros, y margen agregado ponderado | 5 | **El margen de un grupo es Σutilidad / Σprecio**, nunca el promedio de porcentajes (§2.3) |

---

## F3.5 — Cuadre manual · 8–12 h · P0

| ID | Historia | h | Aceptación |
|---|---|---|---|
| F35-1 | Pantalla Cuadre por cuenta y mes con marca "visto en banco" por movimiento | 5 | La marca persiste y deja rastro con actor y fecha |
| F35-2 | Saldo declarado y diferencia calculada | 3 | **Criterio §8.12:** si la diferencia no es cero, se muestra y el mes **no** se declara cuadrado |
| F35-3 | Cierre de mes con registro de diferencia y justificación obligatoria si no es cero | 3 | El cierre queda registrado con actor, fecha, saldo declarado y diferencia |

---

## F6 — Arranque operativo · 15–20 h · P0

| ID | Historia | h | Aceptación |
|---|---|---|---|
| F6-1 | Congelar versión candidata y etiquetarla | 2 | Tag en Git + migraciones aplicadas en producción desde CI, nunca a mano |
| F6-2 | **Prueba de restauración de respaldo, documentada** | 5 | Un respaldo se restaura en un proyecto limpio y los saldos coinciden; evidencia escrita con fecha |
| F6-3 | Configuración real: entidades, cuentas, monedas, impuestos, usuarios | 3 | Coincide con lo decidido en `DECISIONS.md` D-3 |
| F6-4 | Carga de apertura al 1/1/2027 con cuadre contra extractos al 31/12 | 4 | `EVIDENCIA_APERTURA.md` con saldo por cuenta, obligaciones vivas y la firma de quien lo cuadró |
| F6-5 | Guía de uso de una página para el ciclo diario | 3 | Marcelo registra un cobro, un gasto y una transferencia sin consultar a nadie |

---

## F4 — Conciliación bancaria · 60–80 h · P1 · **febrero**

**Puerta de entrada:** no empieza sin archivos reales anonimizados de al menos dos bancos (Mercury y BCP), sin números completos de cuenta.

| ID | Historia | h | Aceptación |
|---|---|---|---|
| F4-1 | Subida a bucket privado con validación de tipo, tamaño y magic bytes | 6 | Un `.xlsx` con macros y un archivo de 20 MB se rechazan; la URL firmada caduca en 60 s |
| F4-2 | `import_formats`: mapeo de columnas por banco, con previsualización | 10 | Dos bancos distintos se importan con su propia plantilla; la previsualización muestra las 10 primeras filas normalizadas |
| F4-3 | Parser CSV/XLSX server-side: fechas, signos, decimales, moneda, zona horaria | 10 | Casos de prueba por banco con fechas `dd/mm/yyyy` y `yyyy-mm-dd`, coma y punto decimal |
| F4-4 | Verificación de integridad con tolerancia configurable | 5 | **Criterio §8.12:** si `apertura + abonos − cargos ≠ cierre`, el import queda marcado y la cuenta no se declara conciliada |
| F4-5 | Doble huella e idempotencia | 8 | **Criterio §8.11:** el mismo archivo dos veces no duplica nada; un período solapado informa "31 ya importadas, 7 nuevas"; dos cargos idénticos legítimos el mismo día se conservan ambos |
| F4-6 | Motor de sugerencia con score y razones | 10 | Cada sugerencia muestra sus razones; la descripción nunca decide sola; nada se autoconfirma |
| F4-7 | Casos compuestos: abono agrupado, pago parcial, transferencia propia, comisión, reverso | 10 | Los cinco casos de `TEST_PLAN.md` §3 pasan con archivos sintéticos |
| F4-8 | Bandeja de revisión con los seis estados y acciones propuestas | 10 | Cada línea se puede enlazar, crear, marcar transferencia, marcar comisión o ignorar con motivo |
| F4-9 | Aprobación humana, bitácora y reversión controlada | 6 | **INV-8:** confirmar no crea dinero; `revert` deshace dejando rastro |
| F4-10 | Informe: % conciliado, sin clasificar y diferencia real por cuenta y período | 5 | Los tres números cuadran con la revisión manual del mismo período |
| F4-11 | Retención y limpieza de archivos según política de la organización | 4 | Al vencer la retención, el archivo se borra y la evidencia de conciliación sobrevive |

---

## F5 — Control, proyecciones y agentes · 50–70 h · P1 · **marzo**

| ID | Historia | h | Aceptación |
|---|---|---|---|
| F5-1 | Inicio ejecutivo: caja por moneda, por cobrar, por pagar, alertas | 8 | Cada tarjeta declara su lente; ninguna suma monedas sin etiqueta |
| F5-2 | Flujo de caja de 13 semanas desde cronogramas, obligaciones y recurrentes | 12 | La proyección se distingue visualmente de la caja disponible y explica de dónde sale cada semana |
| F5-3 | Rentabilidad por cliente y por servicio, con margen ponderado | 8 | Coincide con el cálculo manual sobre el seed; nunca promedia porcentajes |
| F5-4 | Alertas de vencimiento y de concentración de cliente | 6 | Se disparan con datos sintéticos y son silenciables |
| F5-5 | Cierre mensual guiado | 8 | Checklist con movimientos sin clasificar, cuentas sin cuadrar y diferencias explicadas |
| F5-6 | `api_tokens` con scopes, hash y revocación | 8 | El token se muestra una vez; revocar surte efecto inmediato |
| F5-7 | Edge Function `/mcp/query` con consultas en lista blanca, límite de tasa y auditoría | 12 | **Criterio §8.16:** solo lectura, solo scopes de su organización, cada consulta auditada; sin SQL arbitrario |

---

## F7 — Monetización web · P2

| ID | Historia | Aceptación |
|---|---|---|
| F7-1 | Stripe Checkout y Billing en modo test | Alta de suscripción Pro en test de punta a punta |
| F7-2 | Webhooks firmados e idempotentes vía `stripe_events` | **Criterio §8.15:** el mismo evento dos veces no duplica suscripción ni altera el plan |
| F7-3 | Plan derivado solo del objeto de Stripe | Un cliente que manipule su petición no cambia su plan |
| F7-4 | Alta y baja de plan, con la degradación de F1-10 | Bajar de plan preserva datos y bloquea uso fuera del plan |
| F7-5 | Portal de cliente, landing comercial, dominio | Decisión de marca tomada antes de comprar |

---

## F8 — Android e iOS · P2

| ID | Historia | Aceptación |
|---|---|---|
| F8-1 | PWA instalable con funcionamiento sin conexión para lectura | Instalable en iOS y Android; los saldos se leen sin red |
| F8-2 | Prueba de concepto con Capacitor: archivos, permisos, notificaciones, rendimiento | Decisión documentada con evidencia; si falla, se evalúa nativo o se mantiene PWA |
| F8-3 | Revisión de la política de compras digitales vigente **antes** de diseñar la pantalla de pago | **Criterio §8.17**, movido aquí desde el MVP (revisión §4.4) |
| F8-4 | Builds de prueba y publicación | Aplicaciones aprobadas compartiendo backend con la web |

---

## Huecos de flujo detectados el 28/10/2026

Al recorrer el flujo sobre los wireframes de F0-5 aparecieron tres pantallas que el flujo necesita y que las cinco no cubren. **No se dibujan ahora**: cada una se diseña al entrar en su fase, para no adelantar diseño que la implementación va a mover. Quedan aquí para que no se pierdan.

| ID | Pantalla que falta | Por qué importa | Se diseña en |
|---|---|---|---|
| H-1 | **Configuración**: entidades legales, marcas, monedas, cuentas, impuestos y miembros | Es el primer sitio donde entras el 1/1/2027, antes de registrar nada. Hoy es un destino del sidebar sin pantalla detrás. | F1, antes de F1-5 |
| H-2 | **Aprobación → cronograma de cobro → documento** | Es la bisagra de «del presupuesto al dinero en tu cuenta»: los wireframes dibujan los dos extremos y no el paso del medio. Da soporte a F2-15 y F2-16. | F2, antes de F2-15 |
| H-3 | **Lista de movimientos y detalle de cartera** | «Nuevo movimiento» es el alta; el uso diario es la lista. Hoy, en Inicio, «Por cobrar S/ 12,400» no lleva a ninguna parte. | F3, junto a F3-16 |

Ninguno de los tres cambia el modelo de datos ni los invariantes: son pantallas que faltan, no reglas que falten.
