# Prompt para la identidad visual de Margen Pilot

Cópialo entero y pégalo en la herramienta de diseño que uses (o dáselo a un
diseñador tal cual). Está escrito para que lo que devuelva **se pueda aplicar
al código sin traducirlo**: por eso pide los colores con los nombres exactos
de las variables que la aplicación ya usa. Si vuelve con una paleta bonita y
nombres inventados, hay que rehacer el trabajo.

Debajo del prompt hay una nota corta sobre qué pedir de vuelta y qué rechazar.

---

## El prompt

```
Necesito la identidad visual de un producto de software llamado **Margen
Pilot**. Quiero marca y sistema visual, no una maqueta decorativa: el
resultado tiene que poder aplicarse a una aplicación que ya existe y funciona.

## Qué es el producto

Margen Pilot junta tres cosas que hoy viven en hojas de cálculo separadas: un
cotizador que calcula el margen real de cada propuesta, las finanzas de la
empresa (caja, cartera, cobros) y el seguimiento comercial. Está hecho para
agencias de servicios pequeñas: entre tres y quince personas.

El caso que le dio origen: un grupo con **dos empresas** —una peruana que
factura en soles con IGV del 18 %, y una estadounidense que factura en dólares
sin impuesto—. Son dos contabilidades que no se mezclan nunca. Eso no es un
detalle técnico: es la idea central del producto y tiene que notarse en el
diseño.

## Quién lo usa y cuándo

El dueño de la agencia, a las ocho de la mañana, con café, preguntándose tres
cosas: cuánto tengo, quién me debe y qué cotización vale la pena. Y un
ejecutivo comercial que cotiza y envía propuestas, pero que **no puede ver los
costos ni los márgenes**: el producto se los oculta por diseño.

No es un producto para mirar. Es un producto para decidir. La diferencia manda
sobre todo lo demás: cada pantalla existe para que alguien tome una decisión y
cierre la pestaña.

## Qué tiene que transmitir la marca

**Precisión sin frialdad.** La promesa es «esta cifra es verdad»: el producto
se niega a inventar un tipo de cambio, no suma monedas distintas en un mismo
total y distingue margen de markup, que es el error que arruina el precio de
media industria. Eso es honestidad contable, y la marca tiene que oler a eso:
sobria, exacta, legible, sin alardes.

Lo que **no** es: no es una fintech de startup, no es un panel de analista con
gráficos girando, no es «inteligencia artificial para tu negocio». Es la
herramienta de alguien que lleva su propia empresa y quiere los números bien.

El tono verbal del producto, para que el visual no lo contradiga: español
neutro, directo, en segunda persona, y cada pantalla explica la regla que hay
detrás en una frase. Nunca «¡Ups, algo salió mal!». Siempre «No se pudo:
faltan S/ 1.307,94 por repartir».

## Restricciones que no son negociables

Vienen del código que ya está escrito y de accesibilidad real:

1. **Tema claro y tema oscuro, los dos de primera clase.** No es un modo
   oscuro añadido después: hay que entregar los dos juegos de color completos.
2. **Contraste WCAG AA como mínimo**: 4.5:1 para texto normal, 3:1 para texto
   grande y para los bordes de los controles. En los dos temas. Compruébalo,
   no lo supongas.
3. **El estado nunca se codifica solo con color.** Un documento vencido lleva
   texto («vencido hace 10 días»), no un punto rojo. Quien no distingue rojo de
   verde tiene que leer lo mismo. El color refuerza, nunca informa solo.
4. **El dinero se alinea en columnas y usa cifras tabulares.** Una tipografía
   sin cifras de ancho fijo queda descartada, por bonita que sea. Formato
   es-PE: símbolo delante, coma de miles, punto decimal — `S/ 11,307.94`,
   `US$ 8,420.00`.
5. **Dos monedas son dos cifras, nunca una suma.** Si el diseño necesita un
   «total general» para que se vea bien, el diseño está mal. Hace falta una
   forma visual de poner dos cifras al mismo nivel sin que parezca que falta
   sumarlas, y una tercera jerarquía, más baja, para el consolidado
   referencial, que siempre va acompañado del tipo de cambio y su fecha.
6. **Desde 375 px de ancho.** Móvil primero de verdad: el dueño mira la caja
   en el teléfono.
7. **Nada de degradados, sombras de color ni vidrio esmerilado detrás de una
   cifra.** Un número tiene que leerse en cualquier condición. Las superficies
   son planas, con bordes de 1 px.
8. Radios ya fijados: 6 px en controles, 10 px en tarjetas. Puedes proponer
   otros, pero justifícalo.

## Qué quiero de vuelta, en este orden

**1. Logotipo.** El nombre completo «Margen Pilot» y una versión corta. Más un
símbolo que funcione a 32 px y a 16 px (pestaña del navegador), legible en
monocromo y sobre fondo claro y oscuro. Sin un cohete, sin un gráfico de
barras subiendo, sin una flecha diagonal. Esos tres los he visto mil veces y no
dicen nada de este producto.

**2. La paleta, con estos nombres exactos**, en claro y en oscuro. Son las
variables CSS que la aplicación ya usa; devuélvelas como valores hex listos
para pegar:

    --bg          fondo de la página
    --surface     fondo de una tarjeta
    --surface-2   fondo hundido, dentro de una tarjeta
    --border      borde de 1 px, el único separador que hay
    --text        texto principal
    --muted       texto secundario (explicaciones)
    --subtle      texto terciario (etiquetas de campo)
    --accent      color de acción: botón primario, enlaces
    --accent-fg   texto sobre el acento
    --pos / --pos-bg    positivo: cobrado, cuadra, configurado
    --neg / --neg-bg    negativo: error, saldo en rojo
    --warn / --warn-bg  atención: vencido, no cuadra, falta configurar
    --info / --info-bg  informativo: avisos neutros
    --neu / --neu-bg    etiquetas de estado sin carga

Para cada par (color + fondo) dime el ratio de contraste que da.

**3. Tipografía.** Una familia para interfaz, con cifras tabulares, que se lea
bien a 13-14 px. Y la escala: cifra grande de panel, título de pantalla,
título de tarjeta, cuerpo, explicación, etiqueta de campo. Con tamaños y
grosores concretos. Si propones una segunda familia solo para cifras,
justifica que valga el peso de descargarla.

**4. Tres piezas resueltas**, que son las que se repiten en todo el producto:

   - **La cifra de dinero**: cómo se ve un importe, cómo se ve negativo, cómo
     se ve acompañado de su moneda, y cómo se ponen dos monedas al lado sin
     invitar a sumarlas.
   - **La etiqueta de estado**: cinco tonos (positivo, atención, negativo,
     informativo, neutro) con texto dentro, pequeñas, sin icono obligatorio.
   - **La tarjeta**: la unidad de la que está hecha toda la interfaz. Con su
     título, su cifra al extremo y su explicación debajo.

**5. Una pantalla completa de ejemplo: «Inicio».** Arriba la caja disponible
hoy, una tarjeta por moneda, con las cuentas dentro de cada una. Debajo, en
texto subordinado, el consolidado referencial con su tipo de cambio y la fecha.
Después «Por cobrar», con el número de documentos y un aviso de los vencidos.
Y abajo una lista de acciones próximas: cada línea es algo que hacer, con su
botón. En claro y en oscuro, a 1360 px y a 375 px.

## Cómo quiero que me lo expliques

Cada decisión con su motivo, en una frase. Si el acento es azul, por qué azul
y no otro. Si el fondo claro es cálido en vez de blanco puro, por qué. No
quiero adjetivos («moderno», «limpio», «elegante»): quiero el argumento.

Y si algo de lo que pido te parece equivocado, dímelo antes de entregarlo.
```

---

## Qué pedir de vuelta y qué rechazar

**Acéptalo si** vuelve con los diecinueve nombres de variable rellenos en los
dos temas, con los ratios de contraste calculados, y con la pantalla de Inicio
en claro y oscuro a los dos anchos. Eso se aplica al código en una tarde.

**Recházalo si** vuelve con una paleta de nombres propios («primary-500»,
«slate-700»): hay que volver a mapearla a mano y se pierde la mitad.

**Recházalo también si** el ejemplo de Inicio suma las dos monedas en una
cifra grande, o si el estado de un documento se distingue solo por el color
del punto. Las dos cosas significan que no leyó la parte que importa.

**Una cosa que conviene pedir aparte**, cuando la identidad esté cerrada: la
cabecera de la propuesta en PDF. Es el único sitio donde el diseño lo ve un
cliente y no tú, y hoy la marca que sale ahí es la de tu cliente (Nlima, The
Publisher), no la de Margen Pilot. Son dos problemas distintos y conviene no
mezclarlos en el mismo encargo.
