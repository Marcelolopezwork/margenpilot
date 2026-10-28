# PRD — Producto

> **Alcance vigente desde el 28/10/2026:** el producto es **cotizador + dashboard financiero + pipeline y seguimiento**, en un solo software, con dos libros contables separados por entidad (Perú en soles con IGV, EE.UU. en dólares sin IGV). Fuera: importación y conciliación bancaria. Ver `DECISIONS.md` §2.


**Nombre comercial:** pendiente. En el código y la documentación se usa el nombre de trabajo **`margen`** (minúscula, sin marca). No condiciona la decisión de marca ni implica registro.

---

## 1. Qué es

Un sistema operativo para negocios de servicios que recorre el camino completo **cotizar → cobrar/pagar → verificar contra el banco → entender caja y rentabilidad**, con varias empresas y varias monedas, sin ser software contable.

**Propuesta de valor (provisional):** «Del presupuesto al dinero en tu cuenta.»

## 2. Qué no es

No es software contable, no emite comprobantes ante SUNAT, no declara impuestos, no es un CRM omnicanal, no gestiona inventario ni valoración de activos, no se conecta a bancos por API, no da asesoría financiera. Ver `FINANCIAL_RULES.md` §7, que es la lista normativa.

## 3. Usuarios

| Rol | Ve | No ve |
|---|---|---|
| `owner` | todo, incluida facturación del SaaS | — |
| `admin` | todo excepto facturación del SaaS | — |
| `finance` | caja, documentos, costos, márgenes, conciliación | facturación del SaaS |
| `commercial` | clientes, cotizaciones, precios, estados | **costos, márgenes, caja, bancos** |
| `viewer` | informes sin costos ni márgenes | costos, caja, bancos |

**Cliente inicial:** la organización de Marcelo. **Mercado posterior:** agencias, consultores, estudios y profesionales independientes de habla hispana con una o dos empresas y una o dos monedas.

## 4. Planes

| | Free | Pro | Internal |
|---|---|---|---|
| Entidades legales | 1 | 2 | ∞ |
| Monedas habilitadas | 1 | 2 | ∞ |
| Cuentas de caja | 2 | 8 | ∞ |
| Usuarios | 1 | 5 | ∞ |
| Marcas comerciales | ∞ | ∞ | ∞ |
| Cotizaciones y PDF | sí | sí | sí |
| Importación bancaria | **no** (solo cuadre manual) | sí, 12/mes · 5 MB | ∞ |
| API/MCP de lectura | no | sí | sí |
| Precio | 0 | **pendiente** | n/a |

Tres decisiones de producto detrás de esta tabla:

1. **Las marcas son ilimitadas porque no son empresas.** Una marca es presentación (nombre, logo, color en la propuesta). No posee cuentas, no emite documentos, no aparece en informes financieros. Si una marca pudiera facturar, el límite de entidades no valdría nada.
2. **La importación bancaria es la razón para pagar.** Es la función diferenciadora (§3.5 del plan) y la que consume Storage y cómputo. Dejarla fuera de Free alinea costo y valor. Free conserva el **cuadre manual**, que resuelve el caso del usuario de una sola cuenta.
3. **La organización propia usa el plan `internal`**, no público y no facturable, porque con tres entidades potenciales y dos monedas no cabe en Pro. Sin esto, el dueño del producto no puede usar su propio producto.

**Degradación de plan:** nunca borra datos. Pide elegir qué entidades y monedas quedan activas, archiva el resto (legibles y exportables, cerradas a operaciones nuevas) y bloquea toda operación nueva hasta que la elección se haga.

## 5. Alcance v1 (lo que existe el 1/1/2027)

**Dentro:**
- Organización, entidades legales, marcas, monedas, cuentas de caja, impuestos por entidad, usuarios y roles con aislamiento probado.
- Clientes, proveedores y contactos.
- Movimientos de caja: cobros, pagos, comisiones, impuestos pagados, retiros y aportes del dueño, préstamos, transferencias entre cuentas propias con y sin cambio de moneda.
- Documentos de cobro y de pago, con asignación de cobros parciales y un cobro aplicado a varios documentos.
- Saldos y obligaciones de apertura al 1/1/2027.
- Dashboard de caja por cuenta, entidad y moneda, más consolidado referencial etiquetado con su tipo de cambio.
- Cuadre manual mensual por cuenta con diferencia calculada y cierre registrado.
- Catálogo de servicios con incluye/no incluye, condiciones y composición de costos (roles, herramientas, externos).
- Cotizador con precio editable o derivado por fee, impuestos, utilidad, margen y markup como campos distintos, estados, bitácora, snapshot inmutable y PDF.
- Anulación con rastro. Nada se borra.

**Fuera de v1, por fase:** conciliación con parser y scoring (F4), flujo de 13 semanas y rentabilidad por cliente (F5), API/MCP de agentes (F5), Stripe y onboarding autoservicio (F7), apps en tiendas (F8), OFX/PDF bancario, plantillas de propuesta personalizables, oportunidades/pipeline, gastos recurrentes automáticos.

**Fuera para siempre en este producto:** migración de datos transaccionales de 2026, cualquier integración o lectura de Focus, inventario y valuación, contabilidad por partida doble, emisión electrónica.

## 6. Objetivos medibles de la v1

| # | Objetivo | Cómo se mide |
|---|---|---|
| O1 | Crear un servicio con ficha y costos, y emitir una cotización profesional en PDF | Un ciclo completo con datos sintéticos, PDF fiel al snapshot |
| O2 | Aprobar, pactar cobros y seguirlos sin duplicar ingresos | Criterio §8.4: aprobar S/ 1.000 no mueve caja; cobrar S/ 400 la mueve en 400 y deja 600 en cartera |
| O3 | Registrar operaciones por entidad, cuenta, moneda y fecha real | Toda consulta de caja filtra por las cuatro dimensiones |
| O4 | Ver caja real por cuenta/empresa/moneda y consolidado referencial | Criterio §8.3: PEN y USD nunca sumados sin TC, fecha y fuente |
| O5 | Verificar lo registrado contra el banco | v1: cuadre manual con diferencia calculada y cierre registrado (§8.12). F4: conciliación asistida |
| O6 | Cierre mensual guiado | v1: cuadre por cuenta con diferencia explicada. El objetivo de "20 minutos" se medirá en el primer cierre real, no se promete |
| O7 | Demostrar aislamiento y límites | Suite pgTAP: cero accesos cruzados entre dos organizaciones; Free no supera sus límites ni por API |

## 7. Principios de producto

1. **Cada cifra declara su lente.** Caja o Resultado, nunca ambiguo. (`FINANCIAL_RULES.md` §3)
2. **Nada financiero se borra.** Se anula con motivo y contrapartida.
3. **Lo emitido es inmutable.** Una propuesta enviada no cambia sola nunca.
4. **El sistema propone, la persona aprueba.** Ninguna coincidencia bancaria se confirma automáticamente.
5. **Multimoneda significa no sumar.** Convertir es una decisión explícita y etiquetada.
6. **Los límites de plan se validan en el servidor.** El cliente no decide nada sobre su plan.
7. **Exactitud antes que velocidad.** Si hay que elegir, se recorta alcance, nunca pruebas de dinero.
