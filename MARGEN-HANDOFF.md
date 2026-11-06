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
| Entregas | `entregas/`, dentro del proyecto. Los zips se quedan fuera de git por `*.zip` |
| Acceso de Marcelo | `info@thepublisherlab.com` **con contraseña** (ADR-32) |

Mientras el despliegue automático no tenga sus secretos, cada cambio viaja
como un zip que Marcelo sube a mano. Ese zip se escribe en `entregas/` y no en
un directorio temporal: él trabaja con la carpeta del proyecto abierta, y un
archivo fuera de ella es un archivo que no vuelve a encontrar.

El `.env` local está en `.gitignore` y lleva la URL del proyecto y la clave
publicable. Esa clave es pública por diseño: lo que protege la base es RLS, no
que la clave sea secreta.

---

## 3. Qué funciona hoy

Todo esto está **en producción y verificado contra la base real**, no solo
compilado.

### Base de datos · veintiocho migraciones aplicadas

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
20261105120000 propuesta_a_medida  biblioteca de fotos y diseño por cotización
20261105130000 disenio_sin_pisarse  el diseño se parchea; foto por ficha
20261105140000 estado_en_negociacion  el estado que faltaba en la máquina
20261105150000 estados_con_bitacora   transiciones válidas; `status` deja de ser escribible
20261105160000 emision_inmutable      emitir congela el documento en una versión
20261105170000 cronograma_de_cobro    al aprobar nacen las cuotas previstas
```

### Pantallas

- **Acceso** con contraseña (principal) o enlace por correo (secundario)
- **Inicio** · estado de la puesta en marcha
- **Configuración** · entidades, marcas, monedas, impuestos, cuentas, categorías
- **Catálogo** · servicios, ítems de costo, categorías de servicio
- **Comercial** · clientes, cotizaciones, y el editor: líneas desde una ficha
  de servicio con sus costos y precio derivado del fee, costos por línea
  agrupados en personal y herramientas, casilla de IGV, marca que firma, y
  dos salidas: **la propuesta** (pantalla propia donde se elige la variante
  de portada, la pareja tipográfica, los colores y una foto por lámina, y se
  imprime a PDF desde el navegador) y **el documento A4** sobrio, que se
  descarga de una
- **Emisión** · dentro del editor: emitir congela la cotización en una versión
  inmutable con su huella, reemitir crea la siguiente sin tocar la anterior, el
  estado solo se mueve por transiciones que la base acepta, anular exige
  motivo, y cada hecho queda en la bitácora. Cada versión emitida se puede
  reimprimir —A4 y propuesta en láminas— **desde su copia**, no desde la
  cotización de hoy
- **Cronograma de cobro** · aparece en el editor cuando la cotización se
  aprueba. Reparte el total de la versión aceptada en cuotas con fecha y
  cuenta de destino, con botones para pago único, 50/50 o tres cuotas. Una
  cuota prevista entra en la proyección de caja y **no** en «Por cobrar»
  (revisión §4.5). Se manda entera: o suma el total o no se guarda nada
- **Listado de cotizaciones** · filtros por estado y por cliente, y el
  **margen agregado ponderado** de lo que se está viendo, una cifra por
  moneda. Σ utilidad / Σ precio, nunca el promedio de porcentajes (§2.3)
- **Finanzas, Pipeline, Análisis** · todavía son marcadores honestos que dicen
  en qué fase llegan

### Datos reales que ya existen en producción

Organización `Margen Pilot` (plan `internal`), las dos entidades con sus marcas
e impuestos, monedas PEN y USD, nueve categorías financieras, dos cuentas de
caja (BCP soles en PEN, Mercury en USD), un cliente y una cotización de prueba.

### Verificación

- **127 pruebas** de Vitest: dinero, errores, formato, armazón, altas, el A4,
  la propuesta, la aritmética de la cotización, el panel de emisión, la
  reimpresión de una versión emitida, el reparto en cuotas y el margen
  agregado
- **51 aserciones** SQL en `supabase/tests/invariants.sql`
- CI en GitHub Actions: tipos, lint, pruebas, build, y las migraciones
  reaplicadas desde cero en cada push. El Postgres de la CI es pelado y no
  trae lo que Supabase pone encima, así que `supabase/stubs/auth.sql` y
  `supabase/stubs/storage.sql` lo suplen. Una migración que toque un esquema
  de Supabase que no esté ahí deja la CI roja.

---

## 4. Qué falta, por orden

### Lo siguiente de F2

Hechos el 4/11: F2-10 (estados con bitácora), F2-11 (versiones inmutables),
F2-13 (reemisión) y F2-14 (anulación con motivo). Hechos el 5/11: F2-15
(cronograma de cobro al aprobar) y F2-17 (listado con filtros y margen
agregado ponderado).

Quedan dos, y ninguno de los dos se puede terminar todavía:

1. **Cuota → documento → cobro** (F2-16). Está en F2 en el backlog, pero
   necesita `billing_documents`, `cash_movements` y `payment_allocations`, que
   son de F3. Lo que ya está puesto es la puerta: los estados `documented` y
   `settled` existen en el enum, `guardar_cronograma` no toca una cuota que
   esté en ellos y las cuenta aparte al cuadrar la suma. Falta quien las
   mueva.
2. **PDF en el servidor con su propia huella** (F2-12). Hoy la reproducibilidad
   la da `snapshot_sha256`: el documento sale de la copia, pero lo dibuja el
   navegador. Un servicio que imprima con Chrome headless lo cerraría, y no
   toca hasta que haya envío por correo.

El wireframe H-2 del backlog («aprobación → cronograma → documento») se cubrió
a medias: el paso del medio ya existe en pantalla, el de la derecha llega con
F3.

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
  a mano, que es exactamente como se sirve un build caducado. **Solo corre si
  la CI del mismo commit pasó**: con la CI roja, poner los secretos no
  despliega nada y no avisa de por qué.
- **URL de redirección en Supabase**, solo si se quiere el acceso por enlace.

### Deuda técnica anotada

- El bundle principal va por 606 kB en crudo (≈172 kB comprimidos). jsPDF y
  sus dependencias ya van en trozos aparte, cargados solo al descargar; falta
  dividir las rutas con `React.lazy` antes de que entre F3.
- La aritmética de la cotización está escrita dos veces: en
  `src/pages/comercial/totales.ts` y dentro de `emitir_cotizacion`. Tiene que
  ser así —una la usa la pantalla y la otra la base al congelar— y lo que las
  mantiene iguales es `totales.test.ts`, con las cifras comprobadas contra el
  proyecto real. Si alguna vez discrepan, el cliente vería las dos.
- El panel de emisión repite la máquina de estados en `estados.ts` para no
  ofrecer un botón que vaya a fallar. La que manda es
  `app.transicion_de_cotizacion`; si se separan, la base rechaza y la pantalla
  muestra el motivo, nunca al contrario.
- El margen agregado del listado se arma con dos consultas desde el navegador:
  todas las versiones de las cotizaciones que se ven, y sus costos. Con las
  decenas de cotizaciones de un piloto va sobrado; con miles habrá que
  bajarlo a una vista con `security_invoker`, para que el costo lo siga
  filtrando la política de `quote_version_costs` y no el cliente.
- La propuesta carga sus tipografías de Google Fonts. Sin red salen las del
  sistema, que es feo pero no roto. Si alguna vez molesta, se sirven los
  `.woff2` desde el propio dominio.
- El PDF de la propuesta sale de la ventana de impresión del navegador, no de
  un botón que lo genere solo. Es lo que permite que se vea bien; el precio es
  que hay que elegir «Guardar como PDF» y márgenes «Ninguno» una vez. Un
  servicio que imprima en el servidor (Chrome headless) lo automatizaría, y no
  toca hasta que haya envío por correo.

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

Solo que hoy **ese bloque no funciona**, y conviene saberlo antes de confiar
en él: SiteGround tiene antibot delante del dominio y le contesta a `curl`
un `202` de `text/html` apuntando a `/.well-known/sgcaptcha/`, en cualquier
ruta, también en los assets. Un navegador automatizado recibe el «Robot
Challenge Screen», y resolver eso no se hace. Así que, mientras el despliegue
siga siendo manual, **desde aquí no se puede comprobar qué hay publicado**: lo
sabe Marcelo mirando su propia pantalla. La señal que le sirve es si el
desplegable de estado está o no está. El despliegue automático tampoco lo
resuelve: su `curl` de confirmación sale de un runner de GitHub y se come el
mismo reto, así que avisa de que no pudo comprobarlo en vez de ponerse rojo.
Lo que sí es señal real es que `lftp` subió sin error, y que el paso se pone
rojo si el dominio llega a servir un bundle **distinto** del recién subido,
que es lo único que significa que `SG_REMOTE_DIR` apunta a otra carpeta.

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
5. **Lo que la pantalla no ofrece, la base lo tiene que negar.** El estado de
   una cotización era un desplegable con los siete valores, y se podía aprobar
   un borrador que no había salido nunca. No se arregló quitando opciones del
   desplegable: se le revocó a `authenticated` el permiso de escribir la
   columna `status` y se dejaron dos funciones como única puerta. Las columnas
   editables ahora están enumeradas en el grant, así que una columna nueva no
   es escribible hasta que alguien la añada: falla en voz alta al desarrollar
   en vez de abrir un portillo en silencio.
6. **`alter type ... add value` no se puede usar en su propia transacción.**
   Añadir `negotiation` al enum y estrenarlo en la misma migración falla. Va
   sola en su archivo, y la máquina que lo usa en el siguiente.
7. **La suite de invariantes acumula estado.** Una prueba habilitaba USD en
   una organización y otra posterior daba por hecho que no lo estaba. Toda
   aserción nueva debe declarar su precondición como aserción propia.
8. **Una decisión técnica elegante que deja al usuario sin poder entrar es una
   mala decisión.** El acceso solo por enlace de correo lo dejó cinco días
   fuera de su propia aplicación (ADR-32).
9. **Construir cimientos en orden perfecto no es avance si el usuario no ve
   nada.** Conviene intercalar algo usable en cada tramo.
10. **Una migración que quita permisos rompe el sitio publicado hasta que se
    sube el build.** La base es una sola y la comparte lo que está en
    producción. El 4/11 se revocó `update(status)` sobre `quotes` mientras
    arriba seguía el build con el desplegable de estado: durante un día,
    cambiar el estado en el sitio devolvía `permission denied`. El orden es
    **primero sube el build, después aplica la migración**, y cuando el cambio
    no admite convivencia —como este, que era justamente cerrar una puerta—
    hay que decírselo a Marcelo antes de tocar la base, no después.
11. **Un módulo y un componente no pueden llamarse igual cambiando la
    mayúscula.** `cronograma.ts` junto a `Cronograma.tsx` compila en Linux y
    falla en el Mac, porque su sistema de archivos no distingue mayúsculas y
    TypeScript ve dos nombres para el mismo archivo. El ayudante se llama
    `cuotas.ts`. La convención del proyecto ya era esa —`totales.ts`,
    `estados.ts`, `snapshot.ts`— y conviene no romperla.
12. **Una CI roja no duele mientras se despliega a mano, y por eso se queda
    roja.** Desde el 4/11, la migración del bucket de marcas dejó el trabajo
    de base de datos en rojo en cada push: inserta en `storage.buckets`, que
    un Postgres pelado no tiene. Cuatro commits seguidos en rojo sin que se
    notara, porque el zip a mano no necesita la CI. Y como `deploy.yml` solo
    corre si la CI pasó, automatizar el despliegue habría consistido en
    activarlo y que no pasara nada. El arreglo es `supabase/stubs/storage.sql`;
    la lección es mirar `gh run list` antes de dar por bueno un commit.

---

### Dos pantallas no comparten clave de caché si no traen las mismas columnas

El editor y la propuesta usaban las dos `['cotizacion', id]`, pero el editor
no selecciona `design`. React Query guarda **una** entrada por clave, así que
la propuesta leía a veces una fila sin diseño, lo tomaba por «no hay diseño» y
al siguiente clic guardaba los valores de serie encima de lo que Marcelo
acababa de elegir. En pantalla parecía que los botones no hacían nada; en
`audit_log` se veía perfectamente: sus clics escribían y un segundo después
llegaba otra escritura con los valores por defecto.

Dos arreglos, y los dos hacen falta: clave propia (`['propuesta', id]`) y
guardar **solo el campo que cambió** con `set_quote_design`, que lo funde en
la base. Lo segundo es lo que hace que el fallo no pueda volver por otra
puerta.

Y la raíz de que costara verlo: un `update ... where id = ?` que no afecta a
ninguna fila **no es un error** en PostgREST. Por eso `set_quote_design` lanza
`quote_not_found` cuando no actualiza nada.

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
