# Margen Pilot · Handoff

**Para quien abra una sesión nueva: lee esto primero y no empieces por otro sitio.**
Dice qué es el proyecto, qué funciona ya y qué falta, para no rehacer lo hecho.
Se actualiza al final de cada sesión que cambie algo.

Última actualización: **4 de noviembre de 2026**.

---

## 1. Qué es y para quién

Marcelo López dirige dos negocios y hoy los lleva con dos aplicaciones sueltas
—un cotizador y un panel de finanzas— más hojas de cálculo. Sus palabras:

> «Lo que quiero es juntar el cotizador con el dashboard financiero en un solo
> software y agregar lo que es el tema de pipeline y seguimiento.»

Eso es el producto. Todo lo que no sirva a esas tres piezas no entra.

Margen Pilot es además un **SaaS**, no una herramienta interna: la organización
de Marcelo es el primer cliente, no el único. Por eso hay planes, límites y
aislamiento entre organizaciones desde el primer día.

**Lo que lo distingue:** dos contabilidades separadas de verdad, y el margen
real visible por línea. El cotizador anterior confundía margen con markup, y
ese error es el que este producto existe para no repetir.

### Las dos entidades de Marcelo

| Entidad legal | Marca | Moneda | Impuesto | País |
|---|---|---|---|---|
| 3 Brothers MKT SAC | Nlima | PEN | IGV 18 % | Perú |
| The Publisher Ventures LLC | The Publisher Lab | USD | sin impuesto | EE. UU. |

Son **dos libros contables**, no dos vistas del mismo. Ninguna cifra los mezcla.

---

## 2. Dónde vive cada cosa

| | |
|---|---|
| Código | `github.com/Marcelolopezwork/margenpilot`, rama `main`, **público** (ADR-28) |
| Carpeta local | `~/Desktop/trabajos claudio/margen TPL` |
| Base de datos | Supabase, proyecto `veocqvmywodeizuvnssn`, organización `margen pilot`, plan free, Postgres 17 |
| Producción | `https://crm.thepublisherlab.com`, SiteGround, carpeta `crm.thepublisherlab.com/public_html` |
| Desarrollo | `npm run dev` → `http://localhost:5173` |
| Acceso de Marcelo | `info@thepublisherlab.com` **con contraseña** (ADR-32) |

El `.env` local está en `.gitignore` y lleva la URL del proyecto y la clave
publicable. Esa clave es pública por diseño: lo que protege la base es RLS, no
que la clave sea secreta.

---

## 3. Qué funciona hoy

Todo esto está **en producción y verificado contra la base real**, no solo
compilado.

### Base de datos · veintidós migraciones aplicadas

```
20261028120000 foundations      esquema, tablas, disparadores, auditoría
20261028120100 rls              aislamiento entre organizaciones
20261028120200 entitlements     límites de plan con lock
20261028120300 lockdown         revoca lo que Supabase concede solo (ADR-25)
20261028120400 hardening        search_path fijo, techo de organizaciones
20261028120500 indices          auth.uid() fuera del bucle, FK indexadas
20261103120000 catalogos        servicios, ítems de costo, composición
20261103130000 cotizaciones     clientes, cotizaciones, líneas, costos
20261103140000 quitar_lineas    desactivar líneas sin borrarlas
20261103150000 precio_derivado  precio = costo × (1 + fee/100)
20261103160000 linea_desde_servicio  copiar una ficha a una línea
20261104120000 igv_opcional     casilla de IGV y detalle para el cliente
20261104130000 datos_para_el_pdf  contacto de la entidad y bucket de logos
20261104140000 entregables     incluye / no incluye copiados a la línea
20261104150000 copiar_entregables  la ficha los lleva consigo al cotizar
20261104160000 entregables_desactivables  quitar uno sin borrarlo
20261104170000 catalogo_por_entidad  cada ficha y cada costo son de una empresa
20261104180000 ficha_de_la_misma_entidad  no se cotiza con la ficha de la otra
20261104190000 costos_compartidos  una herramienta puede ser de las dos
20261104200000 conversion_declarada  la tasa se escribe en la línea, no se supone
20261104210000 ficha_convierte_costos  la ficha convierte al copiar
20261104220000 segundo_color   el color de acento de la marca
```

### Pantallas

- **Acceso** con contraseña (principal) o enlace por correo (secundario)
- **Inicio** · estado de la puesta en marcha
- **Configuración** · entidades, marcas, monedas, impuestos, cuentas, categorías
- **Catálogo** · servicios, ítems de costo, categorías de servicio
- **Comercial** · clientes, cotizaciones, y el editor: líneas desde una ficha
  de servicio con sus costos y precio derivado del fee, costos por línea
  agrupados en personal y herramientas, casilla de IGV, marca que firma, y
  **descarga en dos formatos**: la propuesta en láminas (el formato que
  Marcelo ya mandaba: portada con foto, índice, una portadilla y una lámina
  por servicio, condiciones y cierre) y el documento A4 sobrio para archivar
- **Finanzas, Pipeline, Análisis** · todavía son marcadores honestos que dicen
  en qué fase llegan

### Datos reales que ya existen en producción

Organización `Margen Pilot` (plan `internal`), las dos entidades con sus marcas
e impuestos, monedas PEN y USD, nueve categorías financieras, dos cuentas de
caja (BCP soles en PEN, Mercury en USD), un cliente y una cotización de prueba.

### Verificación

- **84 pruebas** de Vitest: dinero, errores, formato, armazón, altas, los dos PDF
- **37 aserciones** SQL en `supabase/tests/invariants.sql`
- CI en GitHub Actions: tipos, lint, pruebas, build, y las migraciones
  reaplicadas desde cero en cada push

---

## 4. Qué falta, por orden

### Lo siguiente de F2

1. **Emisión y versiones** (F2-11, F2-13): `quote_versions` inmutable con su
   PDF. Hoy el PDF se genera del estado actual; al emitir hay que congelarlo.
2. **Transiciones de estado con bitácora** (F2-10).
3. **Cronograma de cobro al aprobar** (F2-15 a F2-17), que es la bisagra con F3.

### Después

- **F3 · Finanzas:** movimientos de caja, documentos, cobros, los dos lentes
  (Caja y Resultado), consolidado referencial con su tasa a la vista.
- **F4 · Pipeline:** tablero de oportunidades y seguimiento.

### Pendiente de Marcelo, no de código

- **SMTP propio (D-7).** El correo de Supabase **solo escribe a miembros de su
  organización**. Sin un proveedor propio, el producto no puede dar de alta a
  un solo cliente real. No es trabajo de lanzamiento: es la víspera del primer
  usuario que no sea él.
- **Despliegue automático.** `.github/workflows/deploy.yml` está escrito y
  activo, inerte hasta que existan los secretos `SG_HOST`, `SG_USER`,
  `SG_PASS`, `SG_REMOTE_DIR`, `VITE_SUPABASE_URL`,
  `VITE_SUPABASE_PUBLISHABLE_KEY`. Mientras tanto cada cambio viaja en un zip
  a mano, que es exactamente como se sirve un build caducado.
- **URL de redirección en Supabase**, solo si se quiere el acceso por enlace.

### Deuda técnica anotada

- El bundle principal va por 561 kB en crudo (≈161 kB comprimidos). jsPDF y
  sus dependencias ya van en trozos aparte, cargados solo al descargar; falta
  dividir las rutas con `React.lazy` antes de que entre F3.
- El PDF se genera en el navegador desde el estado actual de la cotización.
  F2-12 pide que salga de un snapshot inmutable y con `sha256`: hasta que
  exista `quote_versions`, reimprimir una cotización vieja puede dar un
  documento distinto del que se envió.
- Las transiciones de estado de una cotización no están validadas por trigger
  (F2-10): hoy se puede pasar de `draft` a `approved` saltándose `sent`.
- La propuesta en láminas se dibuja con Helvetica, no con las tipografías de
  su presentación (Bebas Neue para los títulos, Lato para el texto). jsPDF
  solo trae las suyas; meter las reales es cargar los `.ttf` como recurso
  aparte, que se descargaría la primera vez que alguien genera una propuesta.
  Está decidido a medias a propósito: el formato ya es el suyo, la letra no.

---

## 5. Las reglas que no se negocian

Están en `docs/FINANCIAL_RULES.md`, que es normativo. Lo esencial:

1. **Un importe nunca es un `number`.** En la base es `numeric`; en TypeScript
   entra por `money.fromDb` o `money.fromRow` y vive como `bigint` de unidades
   mínimas. Nunca coma flotante.
2. **Dos libros, uno por entidad.** `legal_entity_id` es obligatorio. Ningún
   informe mezcla Perú con Estados Unidos.
3. **Dos monedas no se suman** sin tasa, fecha y fuente a la vista. El
   consolidado es referencial y no se almacena.
4. **Margen y markup son campos distintos.** Margen sobre precio, markup sobre
   costo. Precio 100 y costo 60 → margen 40 %, markup 66,67 %.
5. **Nada financiero se borra.** `authenticated` no tiene `DELETE` en ninguna
   tabla. Lo que se deshace se anula o se desactiva.
6. **El costo no se esconde en la interfaz, se niega en la base.** Un rol
   `commercial` recibe cero filas de `cost_items`, `service_cost_lines` y
   `quote_line_costs` (ADR-34).
7. **Se redondea al cerrar cada línea**, y el total es la suma de líneas ya
   redondeadas. El impuesto va sobre el neto ya redondeado.
8. **El PDF no imprime costos.** `DatosPdf` ni siquiera tiene dónde meterlos:
   la garantía es estructural, no un `if` que alguien pueda quitar.

---

## 6. Cómo verificar antes de decir que algo funciona

```bash
npm run typecheck && npm run lint && npm test && npx vite build
```

Para la base, ejecutar consultas contra el proyecto real **envueltas en
`begin; … rollback;`**. Es lo que permite probar sobre datos y reglas de
verdad sin dejar una sola fila. Para probar RLS hay que suplantar al usuario:

```sql
set local role authenticated;
set local request.jwt.claim.sub = '<uuid del usuario>';
```

Para comprobar qué hay publicado en el dominio, **no basta un código 200**:

```bash
curl -sS -o /dev/null -w '%{http_code} %{content_type} %{size_download}\n' \
  https://crm.thepublisherlab.com/assets/index-XXXX.js
```

---

## 7. Trampas en las que ya se cayó

Cada una costó tiempo. Están aquí para no repetirlas.

1. **Verificar contra Postgres no es verificar contra Supabase.** Un proyecto
   nuevo concede `DELETE` y `TRUNCATE` a `anon` y `authenticated` por su
   cuenta. La CI con un Postgres pelado no lo vio. Lo que caza eso son las
   invariantes genéricas: toda tabla con RLS, `authenticated` sin `DELETE`,
   `anon` sin nada (ADR-25).
2. **Los tipos generados por Supabase mienten con `numeric`.** Dicen `number`
   y en ejecución llega un `string`. No explota al mostrarlo; explota al hacer
   cuentas (ADR-33).
3. **Un 200 del dominio puede ser el `.htaccess` reescribiendo.** Cualquier
   ruta inexistente devuelve `index.html` con 200. Hay que mirar el
   `content-type` y el tamaño.
4. **Nunca dos paquetes con el mismo nombre.** Se mandaron dos
   `margen-pilot-web.zip` distintos y se subió el viejo. El nombre del zip
   lleva el hash del bundle por esto.
5. **La suite de invariantes acumula estado.** Una prueba habilitaba USD en
   una organización y otra posterior daba por hecho que no lo estaba. Toda
   aserción nueva debe declarar su precondición como aserción propia.
6. **Una decisión técnica elegante que deja al usuario sin poder entrar es una
   mala decisión.** El acceso solo por enlace de correo lo dejó cinco días
   fuera de su propia aplicación (ADR-32).
7. **Construir cimientos en orden perfecto no es avance si el usuario no ve
   nada.** Conviene intercalar algo usable en cada tramo.

---

## 8. Dónde seguir leyendo

| Documento | Para qué |
|---|---|
| `docs/DECISIONS.md` | **Empieza aquí.** Decisiones vigentes, ADR-25 a ADR-34, y lo que sigue abierto |
| `docs/FINANCIAL_RULES.md` | **Normativo.** Invariantes, fórmulas, redondeo, multimoneda |
| `docs/ARCHITECTURE.md` | Stack, ERD, RLS, límites de plan |
| `docs/BACKLOG.md` | Historias por fase con su criterio de aceptación |
| `docs/UI_UX_PLAN.md` | Tokens, pantallas, accesibilidad |
| `docs/PRD.md` | Qué es el producto y qué no es |
| `README.md` | Estado resumido y cómo arrancar |

---

## 9. Cómo trabajar con Marcelo

- Es el dueño del producto y sabe lo que tiene que hacer; el desarrollo lo
  delega. Explicar **por qué**, no solo qué.
- Prefiere que se avance y se le informe, no que se le pregunte a cada paso.
- Valora la prolijidad y no tiene prisa de calendario, pero necesita **ver
  algo funcionando** con regularidad. Un tramo largo sin nada visible es un
  problema aunque el trabajo sea bueno.
- Cuando dice que algo no funciona, suele tener razón: hay que comprobarlo
  desde fuera antes de explicar por qué debería funcionar.
- Escribe en español rioplatense-peruano y de forma breve. Responder igual:
  directo, sin relleno.
