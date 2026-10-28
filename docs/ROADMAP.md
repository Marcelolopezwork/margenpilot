# Roadmap y cronograma

> **Superado en parte el 28/10/2026 (ADR-20).** Ya no hay cronograma por semanas ni fecha de congelamiento. Lo que sigue vigente de este documento es el **orden de las fases** y las puertas de calidad; las fechas y los escenarios A/B quedan sin efecto. El orden vigente está en `DECISIONS.md` ADR-23.


**Fecha de cálculo:** 24 de octubre de 2026 · **Meta operativa:** registrar la operación real desde el 1/1/2027.

---

## 1. El calendario real: no son 10 semanas, son 8

Del 26 de octubre al 31 de diciembre hay 9,7 semanas de calendario. Pero:

| Semana | Fechas | Capacidad efectiva |
|---|---|---|
| S1 | 26 oct – 1 nov | 100 % |
| S2 | 2 – 8 nov | 100 % |
| S3 | 9 – 15 nov | 100 % |
| S4 | 16 – 22 nov | 100 % |
| S5 | 23 – 29 nov | 100 % |
| S6 | 30 nov – 6 dic | 100 % |
| S7 | 7 – 13 dic | 100 % |
| S8 | 14 – 20 dic | 100 % |
| S9 | 21 – 27 dic | ~40 % (Navidad) |
| S10 | 28 – 31 dic | ~30 % (fin de año, y es la semana de la apertura) |

**El último día para integrar funcionalidad nueva es el 20 de diciembre.** S9 y S10 no son semanas de desarrollo: son la prueba de restauración, el cuadre y la carga de apertura, que es trabajo delicado y no se hace con código caliente. Planificar con 10 semanas es planificar con dos semanas que no existen.

**Presupuesto real de desarrollo: 8 semanas.**

---

## 2. Estimación por fase

Horas de trabajo efectivo (Marcelo + Claude Code). Claude Code acelera escribir código; **no** acelera decidir reglas, probar dinero ni revisar QA, que es donde se va buena parte del tiempo en un sistema financiero.

| Fase | Contenido | Horas |
|---|---|---|
| **F0** | Cerrar decisiones bloqueantes, wireframes de 5 pantallas, tokens, repo + estructura | 20 – 25 |
| **F1** | Auth, organizaciones, membresías y roles, RLS completa, entidades legales, marcas, monedas, cuentas, impuestos, entitlements Free/Pro, migraciones, CI, staging, tests de aislamiento | 45 – 60 |
| **F3** | Clientes y proveedores, documentos de cobro/pago, movimientos de caja, transferencias con FX, asignaciones, pagos parciales, apertura, categorías, dashboard de caja por cuenta/entidad/moneda | 70 – 90 |
| **F2** | Catálogo de servicios con composición de costos, cotizador completo, precio/fee/margen, impuestos, estados y bitácora, snapshot + PDF, duplicar, origen de lead | 70 – 90 |
| **F3.5** | Cuadre manual por cuenta y mes (ver §5) | 8 – 12 |
| **F6** | Congelar versión, prueba de restauración, carga de apertura, documentación de uso | 15 – 20 |
| | **Total F0+F1+F3+F2+F3.5+F6** | **228 – 297** |

F4 (conciliación con parser) son 60–80 h más. F5 (dashboards, 13 semanas, API de agentes) otras 50–70 h. **Ninguna de las dos cabe antes de enero**, y forzarlas significaría recortar pruebas financieras, que es exactamente lo que el plan prohíbe (§6, criterio de corte).

---

## 3. Elige escenario: A o B — **[decisión de Marcelo]**

### Escenario A — dedicación alta (~30 h/semana → ~245 h efectivas)

Cabe el total estimado, pero **sin holgura alguna**. Lo que se compromete y lo que es objetivo:

- **Comprometido:** F0 + F1 + F3 + F3.5 + F6 → el 1/1/2027 se registra dinero real, con caja correcta por cuenta, entidad y moneda, cuadre manual mensual y respaldo probado.
- **Objetivo (no comprometido):** F2 completo. Si el gate del 6 de diciembre no se cumple, el cotizador se posterga a enero/febrero y en enero se sigue cotizando con la herramienta actual. Una cotización emitida con la app vieja **no deja hueco contable**; un movimiento de caja sí.

### Escenario B — dedicación parcial (~12 h/semana → ~100 h efectivas)

No cabe ni la mitad del total. Recorte honesto:

- **Comprometido:** F0 (12 h) + **F1-lite** (30 h) + **F3-core** (50 h) + F6-lite (10 h) ≈ 102 h.
  - *F1-lite*: auth, una organización, entidades, marcas, monedas, cuentas, impuestos, RLS completa y CI. **Se posterga**: invitaciones de usuarios, roles granulares (solo `owner`), pantallas de administración de plan (los entitlements sí se crean en el esquema, porque añadirlos después es caro; su UI no).
  - *F3-core*: movimientos, documentos, transferencias, asignaciones, pagos parciales, apertura y dashboard de caja. **Se posterga**: gastos recurrentes, cronogramas de cobro, categorías avanzadas, informes.
- **Postergado a Q1 2027:** F2 (cotizador), F3.5, F4, F5.
- En enero se cotiza con la app actual y se registra dinero en la nueva. Es un arranque limpio del lado que importa.

**Mi recomendación:** declarar la dedicación real sin optimismo. Un escenario A que en realidad era B produce, el 20 de diciembre, un sistema a medias y la decisión de arrancar el año en una planilla — es decir, el hueco histórico que todo el plan existe para evitar.

---

## 4. Inversión del orden de fases: caja antes que cotizador

El plan ejecuta F2 (cotizador) antes de F3 (finanzas). Recomiendo invertirlo, y es la recomendación de mayor impacto de toda esta revisión.

| | Si el cotizador llega tarde | Si la caja llega tarde |
|---|---|---|
| Qué pasa en enero | Se cotiza con la app actual. Las cotizaciones no son dinero: no hay hueco contable. | Se registra el dinero en la app vieja o en una planilla. |
| Costo de recuperarlo | Cargar el catálogo nuevo y empezar a cotizar en el sistema nuevo cuando esté. Las cotizaciones viejas no hacen falta (§0.3 ya lo decidió). | **Migrar** enero (y febrero…) al sistema nuevo: cuadrar saldos, reconstruir movimientos, conciliar a mano. Es exactamente la migración histórica que el plan prohíbe, reaparecida por la puerta de atrás. |

Además, F3 es **independiente** de F2 en el esquema (`billing_documents.quote_version_id` es nullable), así que no hay deuda técnica en invertirlos: el enlace cotización → cronograma de cobro es el último paso de F2, no un prerrequisito de F3.

**Orden recomendado: F0 → F1 → F3 → F2 → F3.5 → F6 → (2027) F4 → F5 → F7 → F8.**

---

## 5. Lo que sustituye a la conciliación en enero: F3.5 "Cuadre manual"

F4 (parser + scoring) no llega. Pero cerrar enero sin ninguna forma de verificar contra el banco es inaceptable. F3.5 cuesta 1–2 días y da la mayor parte del valor:

Pantalla **Cuadre**, por cuenta y por mes:
1. Lista de los movimientos del período, con una casilla **«visto en banco»** por fila.
2. Campo **saldo final declarado** (el usuario lo copia de su banca).
3. Cálculo automático: `saldo según app − saldo declarado = diferencia`, bien visible.
4. Lista de movimientos **no marcados** como "pendientes de verificar".
5. Botón **cerrar mes**: solo se habilita con diferencia 0 (o con una nota de justificación obligatoria si no lo está). Queda un registro con fecha, usuario y diferencia.

Esto satisface el criterio §8.12 del plan (si no cuadra, se muestra la diferencia y no se declara conciliación completa) sin parsear un solo archivo. Y cuando llegue F4, las marcas manuales conviven con las automáticas en la misma tabla (`reconciliation_decisions` con `action='link'` y `payload.manual=true`).

---

## 6. Cronograma, escenario A

| Semana | Entregable verificable | Puerta |
|---|---|---|
| **S1** 26/10 – 1/11 | Decisiones bloqueantes cerradas. Repo privado con estructura, CI en verde, `.env.example`. Supabase local corriendo. Wireframes de las 5 pantallas y tokens aprobados. | — |
| **S2** 2 – 8/11 | Auth funcionando. `organizations`, `memberships`, roles. RLS escrita con helpers. Migraciones versionadas. Staging desplegado. | — |
| **S3** 9 – 15/11 | Entidades legales, marcas, monedas, cuentas de caja, impuestos. Entitlements con `assert_entitlement` y sus triggers. **Tests pgTAP de aislamiento entre dos organizaciones sintéticas en verde.** | **G1: si F1 no está cerrada el 15/11, pasar a escenario B.** |
| **S4** 16 – 22/11 | Clientes, proveedores, categorías. `cash_movements` con alta, anulación por contrapartida y dashboard de saldos por cuenta. | — |
| **S5** 23 – 29/11 | Documentos de cobro y pago. `payment_allocations` con pagos parciales y un pago a varias facturas. Estado del documento derivado por trigger. | — |
| **S6** 30/11 – 6/12 | Transferencias con y sin FX, con comisión. Apertura. Dashboard de caja por cuenta/entidad/moneda + consolidado referencial etiquetado. **Tests de los invariantes INV-1 a INV-10 en verde.** | **G2: si F3 no está cerrada el 6/12, F2 se posterga completo.** |
| **S7** 7 – 13/12 | Catálogo: servicios con incluye/no incluye, composición de costos, `cost_items`. Cotizador: líneas, precio, fee, margen, impuestos. | — |
| **S8** 14 – 20/12 | Estados de la cotización, bitácora, snapshot + PDF, duplicar. Enlace aprobación → cronograma de cobro. F3.5 Cuadre manual. | **G3: congelación. El 20/12 no entra más funcionalidad.** |
| **S9** 21 – 27/12 | Solo pruebas: suite completa, QA manual del ciclo cotizar→cobrar→cuadrar, **prueba de restauración de backup documentada**, revisión de RLS con dos organizaciones. Corrección de defectos únicamente. | — |
| **S10** 28 – 31/12 | Configuración real: entidades, cuentas y monedas definitivas. Catálogo de servicios cargado. **Carga de apertura al 1/1/2027** con cuadre contra extractos al 31/12, registrada en `EVIDENCIA_APERTURA.md`. | **G4: el 31/12, listo o se arranca con lo que esté comprometido.** |

### Cronograma, escenario B (resumen)

S1 F0 · S2–S4 F1-lite · S5–S8 F3-core · S9 pruebas + restauración · S10 apertura. El cotizador arranca en enero y entrega en febrero.

---

## 7. Después de enero

| Fase | Cuándo | Contenido | Condición de entrada |
|---|---|---|---|
| **F2** (si quedó fuera) | enero | Cotizador completo | — |
| **F4** | febrero | Importación CSV/XLSX, mapeos por banco, motor de sugerencia, bandeja de revisión, idempotencia | Requiere **archivos reales anonimizados** de Mercury y BCP; sin ellos no empieza |
| **F5** | marzo | Flujo de 13 semanas, rentabilidad por cliente, alertas, cierre mensual guiado, API/MCP de lectura con scopes | Requiere 2 meses de datos reales |
| **F7** | Q2, condicionado | Stripe, onboarding, landing, dominio, soporte | Requiere 3 meses de uso propio estable y la decisión de marca |
| **F8** | después de F7 | Capacitor, Android/iOS, políticas de tienda | Requiere validar la política de compras digitales vigente en ese momento |
| **F9** | oportunista | OFX, PDF bancario, más bancos, reglas de categorización, CRM más rico | — |

**Focus permanece fuera en todas las fases, sin excepción.**

---

## 8. Riesgos del cronograma y su mitigación

| Riesgo | Probabilidad | Mitigación |
|---|---|---|
| El PDF de la cotización consume el doble de lo estimado (siempre pasa) | alta | Una sola plantilla, bien hecha, sin personalización en v1. Render server-side desde el snapshot, sin editor visual. |
| Las reglas de impuestos por entidad se complican (entidad peruana con IGV + LLC estadounidense sin IGV) | media | `tax_rates` por entidad desde F1; la LLC se configura con tasa 0 y la UI oculta el bloque de impuesto cuando la tasa es 0. |
| Aparece la necesidad de cobrar en moneda distinta a la facturada | media | INV-4 ya decide: prohibido en v1, con mensaje claro. No se improvisa en diciembre. |
| Los tests de dinero se dejan para el final | alta, y es la más grave | Los invariantes se escriben **en la misma semana** que la funcionalidad (S4–S6), no en S9. G2 exige verlos en verde. |
| Diciembre trae imprevistos personales o de clientes | alta | Por eso el congelamiento es el 20/12 y S9–S10 están al 40/30 %. La holgura ya está en el plan, no se gasta antes. |
| Scope creep desde el TDR antiguo o desde la app de Finanzas (inventario, valuación, presupuestos) | media | `PRD.md` §5 lista explícitamente lo que no entra. Cualquier añadido pasa por `DECISIONS.md`. |
