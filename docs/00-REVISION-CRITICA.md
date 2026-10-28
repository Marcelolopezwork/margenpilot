# Revisión crítica del Plan Maestro v2.0

**Revisor:** Claude (arquitecto de software / product manager)
**Fecha de revisión:** 24 de octubre de 2026
**Documento revisado:** `Plan_Maestro_SaaS_Comercial_Financiero_v2.md` (v2.0, 24/10/2026)
**Fuentes contrastadas:** `index (32).html` (Cotizador Pro), `index (31).html` (TPL Finanzas) — leídos, no modificados.
**Estado:** revisión y diseño. **No se ha escrito código de aplicación, no se ha creado ningún Supabase, no se ha desplegado nada, no se ha comprado ningún dominio.**

---

## 1. Veredicto en una página

El plan es **inusualmente bueno** para un documento de planificación de producto: ya resolvió las tres decisiones que normalmente hunden este tipo de sistema (no migrar histórico, multi-tenant desde el día uno, y separar documento de caja). El 80% de lo que un arquitecto diría ya está escrito ahí.

Los problemas reales no son de visión, son tres y son concretos:

1. **El cronograma no cierra.** Faltan **9,7 semanas** para el 1/1/2027. El plan describe F0→F6 (siete fases, ~45 tablas, cotizador + finanzas + conciliación + dashboards + arranque) sin declarar capacidad. Con una persona y Claude Code, F1–F3 es alcanzable; F4–F5 no lo es sin sacrificar exactitud financiera, que es justo lo que el plan prohíbe sacrificar. Hay que **cortar ahora**, no en diciembre.
2. **El orden de fases está invertido respecto a la meta.** La meta operativa del 1/1/2027 es *registrar la operación real*. Lo que obliga a estar listo el 1 de enero es **la caja (F3)**, no el cotizador (F2). Una cotización emitida con la herramienta vieja en enero no contamina nada: no es dinero. Un movimiento de caja mal registrado en enero sí arruina el año. El plan ejecuta F2 antes de F3.
3. **El esquema propuesto en §4 crea tres libros de caja.** `receipts_payments`, `expenses` y `transfers` como tablas hermanas significa tres lugares donde nace dinero, tres lugares que conciliar y doble contabilización garantizada. El propio plan lo sospecha ("evitar duplicar el libro de caja") pero no lo resuelve. La resolución está en `ARCHITECTURE.md` §3: **una sola tabla `cash_movements`**.

Lo demás son precisiones, contradicciones menores y huecos acotados, detallados abajo.

---

## 2. Qué está bien y no hay que tocar

Estas decisiones son correctas y las doy por cerradas; no vuelvo sobre ellas.

| Decisión del plan | Por qué es correcta |
|---|---|
| No migrar transaccional 2026 (§0.2) | Elimina la fuente #1 de retraso y de datos sucios. Correcto incluso si duele. |
| Apertura al 1/1/2027 como saldos + obligaciones abiertas (§0.4) | Es exactamente la forma contable correcta de arrancar en limpio sin perder las cuentas por cobrar vivas. |
| Focus fuera, sin excepciones (§0.5) | Evita acoplamiento a un sistema que no controlas. |
| Multi-tenant + RLS desde el inicio (§0.7) | Retrofitear `organization_id` después es un proyecto de dos meses. Hacerlo ahora cuesta tres días. |
| Cada transacción conserva su moneda original; consolidado solo referencial con TC explícito (§0.11) | Es la regla que distingue un sistema financiero de una planilla. |
| Nunca borrar transacciones financieras (§3.3.8) | Correcto, y además es lo que el código actual **sí hace mal** (ver §3). |
| Snapshot de cotización emitida (§3.2) | Es la diferencia entre una propuesta auditable y una que cambia sola. |
| Margen = (precio − costo) / precio (§2) | Correcto. El código actual calcula markup y lo llama margen (ver §3). |
| CSV/XLSX antes de OFX/PDF (§3.5) | Correcto. El PDF bancario es un pozo sin fondo. |
| Bots solo lectura con scopes (§0.14) | Correcto para v1. Un agente con escritura en finanzas es un incidente esperando ocurrir. |
| Validar límites de plan en servidor, no en cliente (§4) | Correcto, y la implementación concreta tiene una trampa de concurrencia que resuelvo en `ARCHITECTURE.md` §6. |

---

## 3. Evidencia: qué encontré en el código actual

Grepeé los dos archivos de referencia para verificar si los defectos que el plan intuye existen de verdad. Existen todos, y son peores de lo que el plan asume. Esto importa porque **confirma que no se puede reusar la lógica, solo los flujos**.

### 3.1 `index (32).html` — Cotizador Pro

Tablas: `cotizaciones`, `items_cotizacion`, `servicios`, `personal`, `herramientas`, `origen_leads`, `profiles`, `logos`.

```js
// línea 598-607
const precio  = costoTotal * (1 + feePct / 100);
const margen  = costoTotal > 0 ? ((precio - costoTotal) / costoTotal) * 100 : 0;
// ...y se guarda como:
margen_bruto: totals.margen
```

- **`margen_bruto` es markup, no margen.** Con costo 60 y fee 66,67% el sistema reporta "margen 66,67%" cuando el margen real es 40%. Todo análisis de rentabilidad histórico está inflado. El plan ya lo detectó; el código lo confirma.
- **El precio no es editable:** se deriva siempre de costo × (1+fee). No existe el caso "el cliente paga 5.000 porque es lo que vale", que es como se cotiza en servicios de verdad.
- **No hay impuestos en ninguna parte.** No hay base/IGV/total. Un PDF sin IGV explícito no es cotizable en Perú.
- **La "inmutabilidad" no existe:** al editar, `items_cotizacion` se borra con `.delete().eq('cotizacion_id', ...)` y se reinserta (líneas 1013-1037). Una cotización ya enviada muta sin dejar rastro. El snapshot parcial (`servicio_incluye`, `servicio_no_incluye`, `servicio_condiciones` copiados a la cabecera) salva el texto pero no las líneas ni los costos.
- **Estados insuficientes:** solo `pendiente` / `aprobada` / `rechazada`. No hay borrador, enviada, negociación ni anulada, así que no se puede saber qué se envió al cliente ni auditar una anulación.
- **Tenancy = `user_id`.** No hay organización, ni empresa, ni marca, ni rol. Es monousuario con RLS por dueño.

### 3.2 `index (31).html` — TPL Finanzas

Tablas: `movements`, `businesses`, `business_members`, `categories`, `contacts`, `inventory_items`, `assets`.

```js
// línea 1468-1477
const filterCur = m => cur === 'ALL' || m.currency === cur;
const incomes   = state.movements.filter(m => m.type === 'income' && filterCur(m));
const totalIncome = incomes.reduce((s, m) => s + (+m.base_amount || 0), 0);
const profit    = totalIncome - totalExpense;
```

Cuatro defectos estructurales en cuatro líneas:

1. **`status` no se filtra.** Un movimiento pendiente de cobro suma a `totalIncome` y a `profit` exactamente igual que uno cobrado. El sistema declara utilidad sobre dinero que no llegó. Es el criterio de aceptación §8.4 del plan, violado de raíz.
2. **`cur === 'ALL'` suma PEN + USD directamente.** Es literalmente el "1.500" que el criterio §8.3 prohíbe.
3. **Usa `base_amount` (neto de impuesto) para todo**, incluyendo lo que el usuario lee como caja. El banco mueve brutos. Criterio §8.6, violado.
4. **No existe el concepto de cuenta.** No hay `cash_accounts`; el "efectivo" sale de un campo manual `valuation.cash` (línea 1496). No hay saldo por cuenta, así que **no hay nada contra qué conciliar**. Esto es lo que hace que la conciliación bancaria sea imposible en la app actual, no la falta de parser.
5. **No hay tipo `transfer`:** solo `income` y `expense` en todo el archivo. Mover USD 1.000 de Mercury a BCP solo se puede registrar como un gasto + un ingreso, inflando ambos. Criterio §8.10, imposible de cumplir.
6. **Borrado físico:** `db.from('movements').delete()` (línea 1309) y un reset masivo que borra todo el negocio (línea 1459). Criterio §8.14, violado.
7. **`movements` mezcla obligación y caja en la misma fila** (`date` + `due_date` + `status` + `total_amount`). Es la causa raíz de los defectos 1 y 4: no se puede separar lo pactado de lo cobrado si viven en el mismo registro.

**Conclusión de esta sección:** los flujos de pantalla y el vocabulario de negocio se reusan; el modelo de datos y las fórmulas se reescriben sin excepción. El plan dice "aprovechar flujos y aprendizajes, no la arquitectura": tenía razón, y ahora está documentado con línea de código.

---

## 4. Contradicciones y huecos del plan

Ordenados por impacto. Los marcados **[BLOQUEANTE]** requieren decisión de Marcelo (recopilados en `DECISIONS.md` §2).

### 4.1 La organización de Marcelo no cabe en ningún plan definido — **[BLOQUEANTE]**
§0.8 define Free = 1 empresa / 1 moneda y Pro = hasta 2 empresas / 2 monedas. §1 dice que el uso inicial tiene The Publisher y Nlima como marcas y/o entidades, y §0.11 exige PEN + USD. §0.12 añade The Publisher Ventures LLC con cuenta Mercury USD. Eso son potencialmente **tres entidades legales y dos monedas**: no entra en Pro.
→ **Propuesta:** plan `internal` sin límites para la organización propia, no público, no facturable. Y aclarar cuántas de las tres son entidades que facturan y cuántas son solo marcas.

### 4.2 Empresa vs marca: el límite del plan es evadible
El plan limita **empresas** pero no marcas (§9). Si una marca puede tener cuenta bancaria o emitir un documento, entonces "marca" es un sinónimo gratuito de "empresa" y el límite de Pro no vale nada.
→ **Propuesta (adoptada en el ERD):** una marca es **puramente presentación** (logo, color, nombre comercial en la propuesta y el PDF). No tiene cuentas, no emite documentos, no aparece en reportes financieros. Solo `legal_entities` factura y posee cuentas. Marcas ilimitadas en todos los planes; el límite real vive en entidades, y además hay que **limitar cuentas de caja por plan** (si no, una entidad con 40 cuentas revienta el costo de Storage y de conciliación).

### 4.3 El cronograma no declara capacidad — **[BLOQUEANTE]**
§9 dice "no prometer que F0–F6 estará listo antes del 1/1 sin capacidad y estimación", y luego el plan nunca declara la capacidad. Sin ese dato no existe cronograma, existe una lista de deseos.
→ `ROADMAP.md` presenta dos escenarios (alta dedicación ~30 h/sem y parcial ~12 h/sem) con cortes distintos. Marcelo elige uno.

### 4.4 El criterio de aceptación de móvil está en el lugar equivocado
§8.17 exige sesiones seguras, carga de archivos y cumplimiento de políticas de tienda como **criterio mínimo de aceptación**, pero §0.9 y F8 ponen móvil después del MVP web. Si §8 es la puerta del MVP, el MVP no pasa nunca.
→ **Propuesta:** §8.17 se mueve a criterios de aceptación de F8. El MVP de enero es **web responsive, mobile-first**, sin app publicada. PWA instalable como paso intermedio, explícitamente **no** como sustituto de F8.

### 4.5 "Cronograma de cobro" al aprobar: ¿crea una cuenta por cobrar o no? — **[BLOQUEANTE menor]**
§3.3.5 dice que la aprobación genera un cronograma previsto de cobro. §3.4 exige separar proyección / documento emitido / dinero cobrado. No está definido si una cuota del cronograma, antes de existir factura, ya es cuenta por cobrar (y aparece en "Por cobrar" del Inicio) o es solo proyección.
→ **Propuesta (adoptada):** tres estados explícitos. `planned` (proyección: entra en el flujo de 13 semanas, **no** en "Por cobrar"), `documented` (ya hay documento: entra en "Por cobrar"), `settled` (cobrado). En servicios es normal pactar cobro antes de facturar, así que la proyección debe existir, pero no puede contaminar la cartera.

### 4.6 Factura en una moneda, cobro en otra — **hueco no contemplado**
Nada en el plan dice qué pasa si se emite una factura en PEN y el cliente paga en USD a la cuenta Mercury. Es frecuente y rompe la regla "no sumar monedas".
→ **Propuesta v1:** prohibido. Una asignación de cobro exige que moneda del movimiento = moneda del documento. Si se cobra en otra moneda, se emite el documento en la moneda de cobro. v2: permitir con un movimiento explícito de ajuste FX y diferencia de cambio registrada. Esto debe estar **en el producto como validación, no como nota al pie**.

### 4.7 Impuestos: falta definir el "lente" de cada cifra
§8.6 exige que el banco concilie brutos y la rentabilidad analice bases, pero no define la regla que evita el doble conteo entre documentos y movimientos sin documento (el caso "gasto de taxi sin factura").
→ **Propuesta (regla INV-6 en `FINANCIAL_RULES.md`):** hecho económico = todos los documentos no anulados **+** los movimientos de caja operativos **sin** asignación a documento. Dos lentes fijos en toda la app: **Caja** (bruto, desde `cash_movements`) y **Resultado** (neto de impuesto, desde hechos económicos). Cada gráfico declara su lente en el propio título.

### 4.8 Free + Storage de estados bancarios = costo descontrolado
§9 lo menciona como riesgo sin resolverlo. Un plan Free que acepta XLSX bancarios es una invitación a usar el producto como disco duro.
→ **Propuesta:** Free **sin** importación bancaria (solo cuadre manual), cero Storage de estados. Importación = Pro, con cuota (p. ej. 12 importaciones/mes, 5 MB/archivo, retención 90 días). Esto además convierte la conciliación en la razón para pagar, que es exactamente donde el plan dice que está la diferenciación (§3.5).

### 4.9 Hosting: SiteGround es el eslabón más débil del stack
§4 lo acepta "solo después de comprobar rutas SPA, HTTPS, caché, headers". Es hosting compartido para un SPA que ya tiene backend gestionado (Supabase). No aporta nada y añade un modo de fallo.
→ **Propuesta:** host estático con CDN (Cloudflare Pages, Netlify o Vercel) con preview por rama, que además da el entorno de staging que F1 exige. Decisión de bajo costo de reversión; no bloquea.

### 4.10 Precisión monetaria: `numeric` sí, pero falta la escala
§4 dice "`numeric`, nunca `float`", correcto, pero no fija escala ni regla de redondeo, y ahí nacen los descuadres de centavos que el propio plan pone como caso de prueba obligatorio (§3.5).
→ **Propuesta:** montos que liquidan `numeric(18,2)`; costos unitarios y cantidades de cotización `numeric(18,4)`; tasas FX `numeric(18,8)`; cálculo intermedio en `numeric(18,6)`; redondeo HALF_UP al cerrar cada línea y total = suma de líneas ya redondeadas (nunca redondear el total). Detalle completo en `FINANCIAL_RULES.md` §4.

### 4.11 Huecos menores que ya resolví en el diseño (no requieren decisión)
- **Reversos bancarios y comisiones** aparecen como casos de prueba (§3.5) pero no como tipos de movimiento. Resueltos con `kind` = `bank_fee` / `refund` y anulación por contrapartida.
- **Conciliación n:m.** El plan pide soportar abono agrupado y pago parcial; eso exige que la relación línea-bancaria ↔ movimiento sea muchos-a-muchos, no un `match_id` en la fila. Resuelto en `reconciliation_matches`.
- **Idempotencia de reimportación** (§3.5.9) necesita dos huellas, no una: hash de archivo por cuenta **y** huella de línea con índice de ocurrencia (para dos cargos idénticos legítimos el mismo día). Resuelto en `ARCHITECTURE.md` §5.
- **Costos visibles solo a finanzas** (§4) no se puede hacer con RLS a secas: RLS es por fila, y Supabase usa un único rol `authenticated`, así que los permisos por columna no sirven. Resuelto moviendo los costos a tablas hijas con política propia.
- **`activity_log` y `audit_log`** son lo mismo en §4; se unifican en `audit_log`.
- **`opening_balances` como tabla aparte** obligaría a dos fórmulas de saldo. Resuelto: la apertura es un `cash_movement` de tipo `opening`, así el saldo tiene **una sola** definición.

---

## 5. Lo que recomiendo quitar del alcance ahora

No porque esté mal, sino porque compite con el 1 de enero:

| Quitar de la v1 | Razón | Dónde vuelve |
|---|---|---|
| Parser bancario con scoring (F4 completo) | 2–3 semanas de trabajo real con casos de borde que exigen archivos reales anonimizados que todavía no existen | Febrero (F4) |
| Flujo de caja de 13 semanas | Depende de que haya histórico y cronogramas cargados; en enero no hay ni uno | Febrero (F5) |
| Oportunidades / CRM ligero | El origen del lead se puede guardar en la cotización con un campo; el pipeline no aporta nada en enero | F2.5 o F5 |
| Inventario, valuación, assets (venían de TPL Finanzas) | El plan ya los deja fuera; lo repito porque están en el código y tientan | No vuelve |
| Stripe (F7) | Monetizar antes de usar el producto uno mismo es orden inverso | Cuando el uso propio esté estable |
| Capacitor / tiendas (F8) | Nada del MVP lo necesita; sí conviene que el web sea PWA instalable | Post-validación |
| Plantillas de propuesta personalizables (multi-tema) | Una plantilla buena y bien hecha > tres configurables | F2.5 |
| OCR / PDF bancario | El plan ya lo pospone, correctamente | F9, si alguna vez |

Y lo que recomiendo **añadir** al alcance de enero, que no está en el plan:

| Añadir | Por qué |
|---|---|
| **F3.5 "Cuadre manual"** (1–2 días) | Pantalla por cuenta/mes: lista de movimientos con marca "visto en banco", campo de saldo final declarado, y diferencia calculada automáticamente. Da el 80% del valor de conciliar con el 5% del esfuerzo del parser, y permite cerrar enero sin F4. |
| **Prueba de restauración de backup antes del 1/1** | El plan la menciona en F6 pero no como entregable verificable. Un sistema financiero sin restauración probada no está listo, da igual lo demás. |
| **Seed sintético de la organización demo** | Dos organizaciones sintéticas son requisito del criterio §8.2; conviene que sean un seed versionado y no datos a mano. |

---

## 6. Riesgo que el plan subestima

**El riesgo no es técnico, es de secuencia.** El plan protege muy bien la exactitud financiera (todo §8 va de eso) y protege muy bien el aislamiento multi-tenant. Lo que no protege es la posibilidad de llegar al 1 de enero con un sistema **a medias**: con cotizador terminado y caja sin terminar, el resultado es que en enero se sigue registrando dinero en la app vieja (o en una planilla), y la base "nueva y limpia" arranca en marzo con tres meses de hueco. Ese hueco es, en la práctica, la migración histórica que el plan quiere evitar — reaparecida por la puerta de atrás.

La mitigación es la inversión de orden de la §1.2: **caja primero, cotizador después.** Con F1+F3 terminados al 1/1 el año arranca limpio aunque el cotizador llegue en febrero, porque una cotización tardía no deja hueco contable. Al revés sí.

---

## 7. Dónde seguir

| Documento | Contenido |
|---|---|
| `PRD.md` | Producto, planes, alcance v1, qué es y qué no es |
| `ARCHITECTURE.md` | ERD completo, RLS, entitlements, conciliación, stack |
| `FINANCIAL_RULES.md` | Invariantes, fórmulas, redondeo, FX, los dos lentes |
| `ROADMAP.md` | Dos escenarios de capacidad, cronograma semana a semana, cortes seguros |
| `BACKLOG.md` | Historias por fase con aceptación verificable |
| `UI_UX_PLAN.md` | Tokens, 5 pantallas prioritarias, accesibilidad |
| `TEST_PLAN.md` | Casos obligatorios y cómo se verifican |
| `DECISIONS.md` | ADRs tomados en esta revisión + decisiones bloqueantes de Marcelo |

---

## Apéndice A — Sobre los archivos de referencia

**Ubicación:** `~/Downloads/index (31).html` (TPL Finanzas) y `~/Downloads/index (32).html` (Cotizador Pro). **Leídos, no modificados, no copiados a este repositorio.** No se copian porque el plan los define como referencia funcional (§2) y porque arrastrarlos invita a reusar su lógica, que es precisamente lo que no hay que hacer.

**Credenciales:** ambos archivos llevan empotrada la URL de su proyecto Supabase y una clave JWT. Verifiqué el claim `role` de cada token: **las dos son claves `anon`**, que son públicas por diseño y están protegidas por RLS. **No hay ninguna clave `service_role` expuesta**, así que no hay incidente que atender.

Dicho eso, la práctica no se repite en el producto nuevo: la clave `anon` va en variables de entorno (`.env.example` sin valores, F0-2) y la `service_role` solo existe en Edge Functions y en los secretos de CI (`ARCHITECTURE.md` §1).

**El TDR previo (`TDR-tool-servicios.md`) no está en el sistema**; no lo encontré en `~/Downloads` ni en el directorio del proyecto. Las contradicciones con el TDR que señala el plan (§2) las tomé del propio plan, no del TDR original. Si aparece y conviene contrastarlo, hay que decirlo: puede cambiar algún detalle, no las conclusiones de esta revisión.
