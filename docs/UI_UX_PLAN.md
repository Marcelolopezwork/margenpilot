# Plan de diseño UI/UX

> **Actualizado el 28/10/2026.** En la navegación, **Bancos** se sustituye por **Pipeline** (ADR-18, ADR-19). La pantalla 5 de los wireframes (Cuadre) queda como referencia de una función que no entra ahora; su hueco lo ocupa el tablero de oportunidades. Todo lo demás —tokens, estados, accesibilidad, las otras cuatro pantallas— sigue vigente.


**Objetivo:** que se sienta producto comercial premium, no la suma de las dos interfaces actuales. Dirección: **editorial, clara, cifras legibles**. Panel compacto sin saturar.

---

## 1. Principios de interfaz

1. **La cifra es el protagonista.** Números tabulares, alineados a la derecha, con la moneda siempre visible. El resto de la interfaz se aparta.
2. **Cada cifra declara su lente.** El título de cada tarjeta y de cada gráfico dice "Caja" o "Resultado". Sin excepción (`FINANCIAL_RULES.md` §3).
3. **Nunca una moneda implícita.** Los saldos se agrupan por moneda en bloques separados. El consolidado aparece abajo, visualmente subordinado, con su etiqueta de TC.
4. **El estado se codifica tres veces:** texto, icono y color. Nadie depende del rojo/verde (§5 del plan).
5. **El vacío enseña.** Cada estado vacío dice qué es esa pantalla, por qué está vacía y cuál es la única acción siguiente.
6. **Destructivo = difícil.** Anular pide motivo escrito. No hay botón de borrar en nada financiero, porque no existe la operación.
7. **Mobile-first de verdad.** Se diseña a 375 px y se expande. Lo que no cabe en el móvil probablemente tampoco hacía falta en escritorio.

---

## 2. Tokens

### Color

Paleta neutra cálida de base (gris con un punto de amarillo) para que la interfaz no se sienta clínica, con un acento azul tinta de uso escaso: solo acciones primarias y foco.

```
--bg            superficie de página
--surface       tarjetas
--surface-2     filas alternas, cabeceras de tabla
--border        1px, sutil
--text          primario
--text-muted    secundario
--text-subtle   terciario, metadatos
--accent        azul tinta: acción primaria y anillo de foco
--accent-fg     texto sobre acento

Semánticos (los cinco tienen variante -bg para fondos suaves):
--positive      entra dinero, cuadrado, aprobado
--negative      sale dinero, diferencia, perdido
--warning       vence pronto, revisar
--info          proyección, referencial
--neutral       borrador, anulado, ignorado
```

Cada token se redefine en `@media (prefers-color-scheme: dark)` y bajo `[data-theme="dark"]`. **Todo par texto/fondo se verifica AA (4.5:1) en ambos modos antes de darse por bueno**; los colores semánticos sobre fondo suave suelen fallar en oscuro y hay que corregirlos ahí, no esperar que funcionen.

### Tipografía

| Uso | Fuente |
|---|---|
| Interfaz | Inter (o la del sistema), 14 px base, 1.5 de interlínea |
| **Cifras** | la misma con `font-variant-numeric: tabular-nums` **siempre** |
| PDF de propuesta | serif de texto para el cuerpo + sans para datos: es un documento, no una pantalla |

Escala: 12 / 13 / 14 / 16 / 20 / 24 / 32. Cifras grandes del dashboard a 32 px con peso 600, nunca más: una cifra enorme no se lee mejor, solo grita.

### Espaciado, radios, elevación

Escala de 4 px (4/8/12/16/24/32/48). Radios: 6 px controles, 10 px tarjetas, 999 px píldoras de estado. Elevación: casi nada — una sombra muy sutil en menús y diálogos, bordes para todo lo demás. Es un producto de datos, no una app de fotos.

### Formato local

`es-PE`. Miles con coma y decimales con punto, dos decimales siempre en montos (`S/ 1,250.00`, `US$ 500.00`). Fechas `dd/mm/aaaa` en lectura y `yyyy-mm-dd` en campos de entrada tipo fecha. Símbolo delante del número, separado por espacio fino. El formato sale de `currencies.minor_unit`, no de constantes.

---

## 3. Navegación

**Escritorio:** sidebar fija de 240 px, colapsable a iconos. Arriba, el selector de **organización → entidad** (dos niveles, porque la entidad filtra casi todo) y el conmutador de moneda de visualización.

```
Inicio · Comercial · Catálogos · Finanzas · Bancos · Análisis · Configuración
```

**Móvil:** barra inferior de 5 destinos — **Inicio · Finanzas · + · Comercial · Más**. El `+` central abre la hoja de acciones rápidas: nuevo movimiento, nueva cotización, nueva transferencia. Son las tres cosas que se hacen de pie.

---

## 4. Las cinco pantallas prioritarias (F0-5)

### 4.1 Inicio

```
┌─ Inicio ─────────────────── [Org ▾] [Entidad: todas ▾] ─┐
│                                                          │
│  CAJA DISPONIBLE HOY                                     │
│  ┌──────────────────────┐  ┌──────────────────────┐      │
│  │ PEN                  │  │ USD                  │      │
│  │ S/ 24,180.50         │  │ US$ 8,420.00         │      │
│  │ BCP Soles  18,900.50 │  │ Mercury     8,420.00 │      │
│  │ Caja chica  5,280.00 │  │                      │      │
│  └──────────────────────┘  └──────────────────────┘      │
│  Total referencial S/ 57,018  ·  TC 3.90 al 31/12 (SBS) ⓘ│
│                                                          │
│  ┌ POR COBRAR ──────────┐  ┌ POR PAGAR ───────────┐      │
│  │ S/ 12,400 · 4 docs   │  │ S/ 3,200 · 2 docs    │      │
│  │ ⚠ 1 vencido S/ 2,000 │  │ vence en 5 d         │      │
│  └──────────────────────┘  └──────────────────────┘      │
│                                                          │
│  ACCIONES PRÓXIMAS                                       │
│  ⚠  Factura 001-0042 venció hace 6 días      [Registrar]│
│  ○  Cuenta BCP Soles sin cuadrar: diciembre   [Cuadrar] │
│  ○  3 movimientos sin categoría               [Revisar] │
└──────────────────────────────────────────────────────────┘
```

Decisiones: la caja va **arriba y por moneda**; el consolidado es una línea de texto subordinada, no una tarjeta (si fuera tarjeta, competiría con las cifras reales). "Por cobrar" nunca se suma a la caja en el mismo bloque. Las acciones próximas son accionables, no informativas.

### 4.2 Cotización (editor)

Dos columnas en escritorio, acordeón en móvil.

```
┌─ Cotización COT-2027-014 · Borrador ────── [Vista previa] [Emitir] ─┐
│ Cliente [Acme SAC ▾]   Entidad [The Publisher SAC ▾]                │
│ Marca   [The Publisher ▾]  Moneda [PEN ▾]  IGV [18% ▾]  Vence [30d] │
├──────────────────────────── LÍNEAS ─────────────────────────────────┤
│ 1 · Campaña de lanzamiento                           [▾ costos]     │
│     Cant 1   Precio neto  S/ 8,500.00     Neto   S/ 8,500.00        │
│     ┌ Costos (solo finanzas) ───────────────────────────────┐       │
│     │ Dirección creativa  12 h × S/ 120      S/ 1,440.00    │       │
│     │ Diseñador           40 h × S/  60      S/ 2,400.00    │       │
│     │ Licencia stock       1 ×   S/ 180      S/   180.00    │       │
│     │ Costo línea                            S/ 4,020.00    │       │
│     │ ⟳ Sugerir precio con fee [ 80 ]%  →    S/ 7,236.00    │       │
│     └───────────────────────────────────────────────────────┘       │
│ [+ línea]  [+ desde servicio ▾]                                     │
├─────────────────────────────────────────────────────────────────────┤
│ Neto  S/ 8,500.00   IGV  S/ 1,530.00   TOTAL  S/ 10,030.00          │
│ ─────────────────────────────────────────────────────────────       │
│ Costo S/ 4,020.00   Utilidad S/ 4,480.00                            │
│ MARGEN 52.7 %        markup 111.4 %                 (solo finanzas) │
└─────────────────────────────────────────────────────────────────────┘
```

Decisiones: **margen y markup están separados, con el margen en mayor jerarquía** — es la corrección directa del defecto del cotizador actual. El fee es un botón que *sugiere* un precio, no un campo que lo *determina*: el precio es editable y manda. El bloque de costos es colapsable y desaparece por completo para el rol comercial (no aparece bloqueado ni vacío: no existe). Emitir avisa de que congela la versión.

### 4.3 Ficha de servicio

```
┌─ Servicio · Campaña de lanzamiento ──────── [Activo ●] [Guardar] ─┐
│ Código [CAMP-001]  Categoría [Marketing ▾]  Tipo [Proyecto ▾]     │
│ Moneda sugerida [PEN ▾]                                           │
│ Descripción [......................................]              │
├─ INCLUYE ──────────────────┬─ NO INCLUYE ───────────────────────┤
│ ⠿ Estrategia y plan        │ ⠿ Pauta publicitaria                │
│ ⠿ 8 piezas gráficas        │ ⠿ Producción audiovisual            │
│ ⠿ 1 ronda de ajustes       │ [+ añadir]                          │
│ [+ añadir]                 │                                      │
├─ CONDICIONES ──────────────────────────────────────────────────── │
│ [50% de anticipo, 50% contra entrega. Validez 15 días.]           │
├─ COMPOSICIÓN DE COSTO ─────────────────────────── (solo finanzas) │
│ Rol/Personal   Dirección creativa   12 h × S/ 120 = S/ 1,440      │
│ Herramienta    Licencia stock        1 u × S/ 180 = S/   180      │
│ [+ costo ▾]                          Costo total    S/ 4,020      │
│ Fee por defecto [80]%  → precio sugerido  S/ 7,236                │
│ Precio de venta sugerido [S/ 8,500]  →  MARGEN REAL 52.7 %        │
└───────────────────────────────────────────────────────────────────┘
```

Decisiones: incluye/no incluye lado a lado y reordenables por arrastre (⠿), porque es lo que más se edita. **El margen real se muestra junto al precio sugerido**, no escondido: es la cifra que evita cotizar a pérdida. Nota al pie: "Cambiar esta ficha no modifica cotizaciones ya emitidas."

### 4.4 Nuevo movimiento

La pantalla más usada del sistema. Un formulario, una columna, sin pestañas.

```
┌─ Nuevo movimiento ───────────────────────────────────┐
│  ( ) Cobro    ( ) Pago    ( ) Transferencia    ( ) Otro│
│                                                       │
│  Cuenta        [BCP Soles · PEN ▾]                    │
│  Monto              [          1,200.00 ]  PEN        │
│  Fecha de valor  [05/01/2027]  ⓘ fecha del banco      │
│  Contraparte   [Acme SAC ▾]                           │
│  Categoría     [Servicios profesionales ▾]            │
│  Referencia    [Op. 884512]  ⓘ ayuda a conciliar      │
│  Descripción   [...........................]          │
│                                                       │
│  ┌ ¿Cubre un documento? ──────────────────────────┐   │
│  │ ☑ F001-0042 Acme SAC   S/ 1,000 de S/ 1,000    │   │
│  │ ☑ F001-0043 Acme SAC   S/   200 de S/   800    │   │
│  │ Asignado S/ 1,200 de S/ 1,200 ✓                │   │
│  └────────────────────────────────────────────────┘   │
│                                      [Cancelar][Guardar]│
└───────────────────────────────────────────────────────┘
```

Decisiones: la moneda **no se elige**, se hereda de la cuenta y se muestra como texto (INV-9: elegirla sería ofrecer un error). La fecha por defecto es hoy pero se etiqueta "fecha del banco" para enseñar la distinción que todo el modelo necesita. La asignación a documentos va **en el mismo formulario**, con el contador "asignado X de Y": es donde se enseña, sin una palabra de manual, que cobrar y deber son cosas distintas. Si el usuario elige un documento de otra moneda, la fila aparece inhabilitada con la razón (INV-4).

### 4.5 Cuadre / Conciliación

En v1 es cuadre manual; en F4 la misma pantalla gana una pestaña de importación. Mismo esqueleto para no rediseñar.

```
┌─ Cuadre · BCP Soles · Enero 2027 ──────────────────────────┐
│  Saldo según app   S/ 24,180.50                             │
│  Saldo declarado  [S/ 24,180.50]  ⓘ cópialo de tu banca     │
│  DIFERENCIA        S/ 0.00  ✓ cuadra                        │
│                                                             │
│  34 movimientos · 31 vistos en banco · 3 pendientes         │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ ☑ 05/01  Cobro Acme SAC        Op.884512  +1,200.00 │    │
│  │ ☑ 06/01  Pago alquiler         ─           -2,500.00│    │
│  │ ☐ 08/01  Comisión mantenim.    ─             -15.00 │    │
│  └─────────────────────────────────────────────────────┘    │
│                                    [Cerrar enero] (activo)  │
└─────────────────────────────────────────────────────────────┘
```

En F4 se añaden: pestaña "Importar", y la bandeja con los seis estados, cada sugerencia mostrando **sus razones** ("monto exacto · fecha +1 día · referencia coincide · 0.93") y nunca preconfirmada.

---

## 5. Estados: un vocabulario único

| Estado | Texto | Icono | Color |
|---|---|---|---|
| Borrador | Borrador | ○ | neutral |
| Enviada | Enviada | → | info |
| Negociación | En negociación | ↔ | warning |
| Aprobada | Aprobada | ✓ | positive |
| Perdida | Perdida | ✕ | negative |
| Anulada | Anulada | ⊘ | neutral + tachado |
| Pendiente de cobro | Por cobrar | ◷ | info |
| Parcial | Parcial 40 % | ◐ | warning |
| Pagado | Pagado | ✓ | positive |
| Vencido | Vencido 6 d | ⚠ | negative |
| Cuadrado | Cuadra | ✓ | positive |
| Con diferencia | Diferencia S/ 15 | ⚠ | negative |
| Proyección | Previsto | ◌ | info, con borde discontinuo |

"Previsto" con borde discontinuo es la convención que separa visualmente proyección de hecho, en todas las pantallas.

---

## 6. Accesibilidad (requisito, no adorno)

- Todo operable con teclado; anillo de foco visible de 2 px con `--accent`, nunca `outline: none`.
- Diálogos con foco atrapado y retorno al disparador; `Esc` cierra, salvo en formularios con cambios sin guardar (que preguntan).
- Tablas con `<caption>`, encabezados `scope`, y en móvil se convierten en tarjetas, no en scroll horizontal.
- Objetivos táctiles de 44 × 44 px mínimo.
- Errores de formulario junto al campo, con `aria-describedby`, y un resumen al inicio del formulario al enviar.
- Contraste AA verificado en claro **y** oscuro. Los colores semánticos sobre fondo suave se revisan uno por uno.
- `prefers-reduced-motion` respetado: sin transiciones salvo la opacidad.
- Nada depende solo del color (regla de los tres códigos, §1.4).

---

## 7. Orden de trabajo de diseño

1. Tokens y verificación de contraste (F0-4).
2. Wireframes de estas cinco pantallas, móvil y escritorio, aprobados antes de maquetar (F0-5).
3. Componentes base: tabla de datos, campo monetario, selector de cuenta, píldora de estado, estado vacío, hoja de acción móvil.
4. Pantallas, en el orden de ejecución del roadmap (Finanzas antes que Cotizador).
5. El PDF de la propuesta se diseña aparte: es un documento impreso, con otra tipografía y otra retícula. No se deriva de la pantalla.

---

## 8. Wireframes publicados (F0-5)

**Lienzo:** https://claude.ai/artifact/WGvmH8gmBmycTGdK6noHEi — privado; nadie más puede abrirlo hasta que lo compartas desde el menú Share de la página.

Once artboards, mid-fidelity, con los tokens de §2 aplicados:

| Fila | Artboards |
|---|---|
| Portada | Leyenda de tokens con los dos temas lado a lado, los 13 estados de §5 y la escala tipográfica |
| Escritorio · 1360 px | Inicio · Cotización · Ficha de servicio · Nuevo movimiento · Cuadre |
| Móvil · 390 px | Las mismas cinco, rediseñadas: barra inferior de 5 destinos, `+` central, y las tablas convertidas en tarjetas |

**Son navegables, no estáticos:** la navegación lateral y la barra inferior enlazan entre pantallas, cada pantalla trae un conmutador claro/oscuro en su barra superior, y tres interacciones están vivas porque son las que enseñan una regla financiera:

- **Cotización:** desplegar el bloque de costos de cada línea, que es lo que el rol comercial no ve.
- **Nuevo movimiento:** marcar y desmarcar documentos, con el contador «asignado X de Y» recalculándose. La factura en USD aparece inhabilitada: es INV-4 hecho interfaz.
- **Cuadre:** marcar movimientos como vistos y escribir el saldo declarado; la diferencia se recalcula y el botón «Cerrar enero» solo se habilita con diferencia cero (criterio §8.12). El caso con diferencia deja S/ 15.00, que es exactamente la comisión sin marcar.

**Decisiones de diseño que conviene mirar con atención:**

1. En Inicio, la caja va arriba y por moneda; el consolidado referencial es **una línea de texto subordinada**, no una tarjeta. Si fuera tarjeta competiría con las cifras reales y acabaría leyéndose como si fuera dinero de una sola moneda.
2. En la cotización, **el margen tiene jerarquía tipográfica mayor que el markup** (32 px contra 18 px). Es la corrección directa del defecto del cotizador actual, que llama «margen» al markup.
3. El fee es un **botón que sugiere** un precio, no un campo que lo determina. Cada línea muestra si su precio se fijó a mano o se derivó del fee.
4. En «Nuevo movimiento» la moneda aparece como **texto, no como selector**: ofrecerla sería ofrecer un error (INV-9).

**Dos preguntas abiertas, anotadas en el lienzo:**

- En Inicio, ¿la caja va antes o después de «Por cobrar / Por pagar»? Está puesta antes, con el argumento de que lo primero que se pregunta por la mañana es cuánto hay.
- En la cotización, para el rol finanzas, ¿el bloque de costos abre desplegado o cerrado? Está cerrado salvo la primera línea.
