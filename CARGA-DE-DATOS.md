# Margen Pilot · Carga de datos reales

**Qué es esto.** Una plantilla para llenar. Cuando me la devuelvas llena, cargo los
datos de verdad de **Nlima** y **The Publisher** en el sistema y borro todo lo de
prueba que hay ahora.

Puedes llenarla con GPT: al final del documento hay un prompt listo para pegarle.
Si algo no lo sabes, escribe **PENDIENTE**. Es mejor que un número inventado — un
costo inventado produce un margen inventado, y ese es justo el error que este
producto existe para arreglar.

---

## 0 · Cómo está ordenado el sistema

Esto es lo que GPT necesita entender para ayudarte a llenar bien el documento.

| Pieza | Qué es | Ejemplo tuyo |
|---|---|---|
| **Organización** | Tu cuenta. Una sola. | Margen Pilot |
| **Empresa (entidad legal)** | Un libro contable. Las dos **nunca se mezclan** en ningún informe. | 3 Brothers MKT SAC (Perú) · The Publisher Ventures LLC (EE. UU.) |
| **Marca** | Solo presentación: nombre, logo y colores en la cotización. Elegir la marca ya define qué empresa cotiza. | Nlima (del SAC) · The Publisher Lab (de la LLC) |
| **Ítem de costo** | Lo que te cuesta producir: una persona, una herramienta, un tercero. Se registra **una vez** y se reutiliza en todas las fichas. | Diseñador gráfico · Adobe · Fotógrafo externo |
| **Ficha de servicio** | Un servicio que vendes: su lista de costos, su fee, sus entregables y su foto. | BRD · Branding y estrategia de marca |
| **Cotización** | Cliente + líneas sacadas de las fichas. | NL-COT-2026-0007 |

### La regla que no se negocia

El precio sale del costo. El **fee** es un porcentaje **sobre el costo** (markup),
no sobre el precio:

```
precio = costo × (1 + fee / 100)
```

Con un costo de 1.000 y un fee de 80 %: precio 1.800, y el **margen** real es
44,4 %. No son lo mismo. El cotizador que usabas antes llamaba «margen» al 80 %, y
por eso vendías más barato de lo que creías. La app te muestra las dos cifras
siempre, para que nunca más se confundan.

### Dos monedas, sin inventar conversiones

- El SAC trabaja en **PEN**, la LLC en **USD**.
- Una herramienta que te facturan en dólares y usan las dos empresas se registra
  **una sola vez**, en dólares, marcada como **compartida**. No se duplica.
- Cuando esa herramienta entra en una ficha en soles, el sistema convierte con la
  tasa que tú declaraste y **guarda la tasa y la fecha** junto a la cifra. Si no hay
  tasa cargada, falla en vez de adivinar.
- La tasa la pones tú, una vez al mes. No se consulta sola a ningún sitio.

---

## 1 · Lo que YA está cargado

No lo repitas en las tablas de abajo salvo que haya que corregirlo.

**Empresas:** 3 Brothers MKT SAC (PE, PEN) · The Publisher Ventures LLC (US, USD)
**Marcas:** Nlima · the publisher · The Publisher Lab
**Impuestos:** IGV 18 % (SAC) · Sin impuesto (LLC)
**Monedas habilitadas:** PEN, USD
**Tipo de cambio:** USD→PEN 3,75 al 04/11/2026
**Categorías:** Marca · Marketing digital · Web y producto · Contenido · mano de obra
**Fichas:** MARCA-01, MKT-MES, WEB-01, APP-01, CONT-MES (SAC) · BRD, BRAND-US, WEB-US, CONT-US (LLC)
**Ítems de costo:** ~30 entre roles, herramientas y externos
**Clientes:** EJ Deportes

### Basura de prueba que voy a borrar

Dime si alguna de estas es real y la dejo:

- Servicio `BBFVBF · bfgbgfbb`
- Ítem de costo `vanessa` (500 PEN)
- Categoría `mano de obra` (duplica lo que ya hacen los ítems)
- Datos de contacto del SAC: dirección «cdfdf», teléfono «889898989», correo «m@t.com»
- Todo lo sembrado como ejemplo: los ítems y fichas que no reconozcas de las listas de arriba

---

## 2 · Lo que hay que llenar

### A · Las dos empresas

Esto es lo que sale impreso al pie de cada cotización, así que tiene que estar exacto.

| Dato | 3 Brothers MKT SAC | The Publisher Ventures LLC |
|---|---|---|
| Razón social exacta | | |
| RUC / EIN | | |
| Dirección fiscal | | |
| Teléfono | | |
| Correo comercial | | |
| Condiciones de pago | | |

> **Condiciones de pago** es el párrafo que sale en la lámina de condiciones de toda
> propuesta de esa empresa. Ejemplo: «El servicio inicia con el 50 % adelantado. El
> saldo se cancela a la entrega. Precios en soles e incluyen IGV.»

### B · Marcas

| Marca | Empresa | Color principal | Color secundario | Archivo del logo |
|---|---|---|---|---|
| Nlima | SAC | `#2760d3` | | |
| The Publisher Lab | LLC | | | |

> **Principal** pinta los bloques de color, los títulos y el precio.
> **Secundario** pinta la numeración, los filetes y las viñetas.
> Logo: PNG con fondo transparente, horizontal, mínimo 600 px de ancho.

### C · Tipo de cambio del mes

| De | A | Tasa | Fecha | Fuente |
|---|---|---|---|---|
| USD | PEN | | | |

> Una fila por mes. Nunca se corrige una tasa vieja: se añade otra con fecha
> posterior, y así queda el historial de con qué tasa se cotizó cada cosa.

### D · Personal · lo que te cuesta cada rol

Costo, no precio: lo que **tú pagas**, sin fee.

| Rol | Empresa | Unidad | Costo por unidad | Moneda | Nota |
|---|---|---|---|---|---|
| Diseñador gráfico | SAC | hora | 60 | PEN | *(ejemplo — bórralo)* |
| | | | | | |

- **Empresa:** `SAC`, `LLC` o `compartido`
- **Unidad:** texto libre — `hora`, `mes`, `proyecto`, `pieza`, `palabra`
- Si prefieres no poner nombres de personas, pon el rol. El sistema solo necesita el rol.
- **El nombre del ítem es único en toda la cuenta**, no por empresa. Si el SAC y la LLC
  tienen el mismo rol a distinto costo, distínguelos: `Diseñador gráfico (PE)` y
  `Graphic designer (US)`. Dos filas con el mismo nombre no entran.
- Un rol que cobra por mes fijo va con unidad `mes` y su sueldo bruto mensual.

### E · Herramientas y suscripciones

| Herramienta | ¿De quién? | Unidad | Costo | Moneda | Nota |
|---|---|---|---|---|---|
| Adobe Creative Cloud | compartida | mes | 60 | USD | *(ejemplo — bórralo)* |
| | | | | | |

- `compartida` = la usan las dos empresas y te la facturan en una sola moneda. **No la dupliques.**
- Pon el costo **tal como te lo facturan**: si Claude te llega en dólares, va en USD aunque lo uses para cotizar en soles.

### F · Terceros y externos

Freelancers por proyecto, imprentas, productoras, locutores, licencias de stock.

| Concepto | Empresa | Unidad | Costo | Moneda | Nota |
|---|---|---|---|---|---|
| Fotógrafo de producto | SAC | sesión | 900 | PEN | *(ejemplo — bórralo)* |
| | | | | | |

### G · Categorías de servicio

Las que de verdad usas para agrupar. Pocas y claras.

| Categoría | Orden |
|---|---|
| | |

### H · Fichas de servicio

Una fila por servicio que vendes.

| Código | Nombre | Categoría | Empresa | Tipo | Periodicidad | Moneda | Fee % | Descripción que ve el cliente |
|---|---|---|---|---|---|---|---|---|
| BRD | Branding y estrategia de marca | Marca | LLC | único | | USD | 85 | La marca de principio a fin: nombre, identidad y manual de uso. |
| | | | | | | | | |

- **Código:** corto y en mayúsculas. Es lo que aparece en los listados y en el nombre de las
  fotos. **Único en toda la cuenta**, no por empresa: si las dos venden branding, usa `BRD-PE`
  y `BRD-US`.
- **Tipo:** `único`, `recurrente` o `retainer`. Los dos últimos **necesitan** periodicidad (`mensual`, `trimestral`…).
- **Fee %:** markup sobre costo. 85 significa precio = costo × 1,85.
- **Descripción:** una o dos frases. Sale en la portadilla del servicio en la propuesta, así que escríbela para el cliente, no para ti.

### I · De qué está hecho cada servicio

El costo de la ficha. Aquí sale el margen.

| Código de ficha | Ítem (de D, E o F) | Cantidad | Unidad |
|---|---|---|---|
| BRD | Dirección creativa | 12 | hora |
| BRD | Diseñador gráfico | 30 | hora |
| BRD | Licencia de stock | 1 | paquete |
| | | | |

- El costo por unidad lo toma del ítem; aquí solo va **cuántas** unidades.
- Si un servicio lleva algo puntual que no está en el catálogo, escríbelo igual: lo doy de alta como ítem o como línea suelta de esa ficha.
- Un retainer mensual se compone con cantidades **mensuales** (8 horas de CM al mes, no las del año).

### J · Entregables por servicio

Lo que el cliente lee en la lámina del servicio. **El orden importa**: se imprime en el orden que pongas.

| Código | Tipo | Texto | Orden |
|---|---|---|---|
| BRD | incluye | Naming y arquitectura de marca | 10 |
| BRD | incluye | Manual de identidad en PDF | 20 |
| BRD | no incluye | Registro de marca ante Indecopi | 30 |
| BRD | condición | Dos rondas de ajuste por entregable | 40 |
| | | | |

- **Tipo:** `incluye`, `no incluye`, `condición` o `nota`
- Frases cortas, una idea por línea. Más de 16 por servicio y la propuesta parte la lista en otra lámina sola.

### K · Clientes

Los que de verdad vas a cotizar este trimestre. No hace falta la cartera entera.

| Nombre | RUC / Tax ID | Correo comercial | Nota |
|---|---|---|---|
| | | | |

### L · Fotos por servicio

| Código de ficha | Archivo | Qué debe mostrar |
|---|---|---|
| BRD | `BRD.jpg` | Mesa de trabajo con bocetos de logotipo *(ejemplo)* |
| | | |

Más tres genéricas que se usan cuando un servicio no tiene la suya:

| Archivo | Para qué |
|---|---|
| `portada.jpg` | La portada de cualquier propuesta |
| `indice.jpg` | La lámina del índice |
| `cierre.jpg` | La última lámina |

---

## 3 · Las fotos · especificaciones

Lee esto antes de generarlas con GPT, porque la lámina no es 16:9 exacto y el
recorte importa.

- **Medida:** 1920 × 1080 px. Una sola foto por servicio sirve para todas las láminas.
- **Formato:** JPG, PNG o WebP. **Máximo 5 MB** — el sistema no acepta más.
- **Dónde se recorta:**
  - Portadilla del servicio y portada: a sangre completa, 254 × 143 mm (casi 16:9).
  - Lateral de la lámina de servicio: una **columna vertical** de 84 × 143 mm. Se recorta el centro.
  - Portada partida en dos: columna de 146 × 143 mm, casi cuadrada.
  - Portada con banda: tira horizontal de 254 × 88 mm.
- **Por eso:** el motivo **centrado**, y nada importante pegado a los bordes.
- **Sin texto ni logos dentro de la imagen.** Encima va el título en blanco con un
  velo degradado; cualquier letra que traiga la foto choca con él.
- **Nombre del archivo = código de la ficha**: `BRD.jpg`, `WEB-01.jpg`, `MKT-MES.jpg`.
- Una foto por servicio queda guardada en la biblioteca de la organización y se
  reutiliza en todas las propuestas. No hay que volver a subirla nunca.

> **Ojo con lo que subes.** La carpeta de fotos es pública a propósito: las imágenes
> acaban dentro de PDF que mandas por correo a clientes. No subas ahí nada que no
> quieras que salga de la oficina, ni fotos de trabajos de clientes sin su permiso,
> ni stock que no tengas licenciado.

---

## 4 · Lo que NO va en este documento

Nada de esto hace falta para cargar los datos, y un documento que viaja por chat no
es sitio para ello:

- Contraseñas, claves de API, tokens de nada.
- Números de cuenta completos ni estados bancarios. De una cuenta el sistema guarda
  **solo los últimos 4 dígitos**, y eso se escribe directamente en la app.
- DNI, pasaportes ni datos personales de tu equipo. Para los costos basta el **rol**.

---

## 5 · Cómo me lo devuelves

- Un solo archivo, `.md` o `.xlsx`, con estas mismas columnas. El formato exacto da
  igual; lo que importa es que las columnas sean estas.
- Las fotos en una carpeta aparte, con los nombres de la tabla L.
- Si una tabla te queda a medias, mándala igual. Cargo lo que esté completo y te digo
  qué falta.

---

## 6 · Prompt para pegarle a GPT

```
Soy dueño de dos agencias: 3 Brothers MKT SAC (Perú, factura en soles, IGV 18 %, marca
comercial «Nlima») y The Publisher Ventures LLC (EE. UU., factura en dólares, sin
impuesto, marca «The Publisher Lab»).

Estoy cargando mi catálogo en un sistema de cotización que calcula el precio a partir
del costo. Necesito que me ayudes a llenar las tablas del documento que te adjunto
(CARGA-DE-DATOS.md), respetando estas reglas:

1. El «fee %» es markup SOBRE EL COSTO, no margen sobre el precio:
   precio = costo × (1 + fee/100). No los confundas ni los conviertas.
2. Los costos son lo que YO pago, sin fee: sueldos, suscripciones, freelancers.
3. Cada costo va en la moneda en que me lo facturan. Una herramienta que usan las dos
   empresas se registra UNA sola vez y se marca «compartida».
4. Cada servicio necesita: código corto, nombre, categoría, empresa, tipo
   (único/recurrente/retainer), moneda, fee %, una descripción de una o dos frases
   escrita para el cliente, su lista de costos con cantidades, y sus entregables
   separados en «incluye», «no incluye» y «condición».
5. No inventes cifras. Donde no tengas el dato, escribe PENDIENTE y pregúntame.

Empecemos por las tablas D, E y F (personal, herramientas y terceros). Hazme las
preguntas que necesites, de pocas en pocas, y ve armando las tablas con lo que te
responda.
```

Y para las imágenes, una por servicio:

```
Genera una imagen fotográfica, 1920 × 1080 px, horizontal, para acompañar un servicio
de [NOMBRE DEL SERVICIO] en una propuesta comercial de agencia creativa.

- Motivo centrado en el encuadre; nada importante pegado a los bordes, porque se
  recorta también en vertical.
- Sin texto, sin letras, sin logotipos de ningún tipo en la imagen.
- Luz natural, estética sobria y editorial. Sin collage ni gráficos superpuestos.
- Que funcione con un título en blanco encima, así que evita zonas muy claras en el
  tercio inferior izquierdo.
```
