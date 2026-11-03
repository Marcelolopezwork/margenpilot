# Registro de decisiones

**Proyecto:** Margen Pilot
**Última actualización:** 28 de octubre de 2026

Tres secciones: **§1** decisiones de arquitectura vigentes, **§2** las decisiones que tomó Marcelo el 28/10/2026, y **§3** lo que sigue abierto.

---

## 1. Decisiones de arquitectura vigentes

### ADR-01 · Un solo libro de caja por *tipo* de movimiento — **vigente**
Una tabla `cash_movements` con discriminadores `kind` y `flow_class`, en lugar de `receipts_payments` + `expenses` + `transfers`.
**Por qué:** tres tablas hermanas serían tres lugares donde nace dinero y doble contabilización garantizada. Es lo que hace la app actual de Finanzas y es la causa de sus defectos.
**No confundir con ADR-16:** esto es la separación por *tipo de movimiento*. La separación por *entidad* es total y está en ADR-16.

### ADR-16 · Dos libros contables separados por entidad — **nueva, 28/10/2026**
**Decisión:** Perú y Estados Unidos son dos contabilidades completamente separadas. `legal_entity_id` es obligatorio en toda cuenta, movimiento, documento y cotización. Todo informe de resultado, rentabilidad y caja se calcula **por entidad**, nunca mezclado. Cada entidad tiene su moneda y su régimen de impuesto.
**Por qué:** 3 Brothers MKT SAC cobra en soles y paga IGV; The Publisher Ventures LLC cobra en dólares y no aplica IGV. Son dos negocios, dos rentabilidades y dos monedas.
**Cómo se impone:** `cash_accounts.legal_entity_id` fija la entidad y la moneda de la cuenta; un trigger valida que el movimiento herede ambas; el lente Resultado se agrupa siempre por entidad; no existe ninguna vista que sume resultados de las dos.
**Única excepción:** el total de caja consolidado del Inicio, que es **referencial**, va etiquetado con tasa, fecha y fuente, y no se almacena (ADR-14, D-5).

### ADR-02 · La apertura es un movimiento, no una tabla — **vigente**
El saldo inicial es un `cash_movement`, así el saldo tiene una sola definición.

### ADR-17 · La apertura de 2027 es un aporte del dueño — **nueva, 28/10/2026**
**Decisión:** no se cargan saldos de apertura ni cuentas por cobrar/pagar abiertas. El 1/1/2027 se registra un movimiento `owner_contribution` por cuenta con el dinero que haya, y listo.
**Por qué:** decisión de Marcelo, para no complicar el arranque.
**Consecuencia:** `owner_contribution` tiene `flow_class = non_operating`, así que entra en caja y **no** en ventas ni utilidad de 2027. El criterio §8.5 del plan se cumple igual. Se elimina el trabajo de cuadrar obligaciones de apertura (antes F3-12) y la tabla `opening_balances` nunca existe.

### ADR-03 · Una marca no factura ni tiene cuentas — **vigente, reformulada**
`brands` es presentación: nombre comercial, logo y color en la cotización y su PDF. Las cuentas y los documentos pertenecen a la entidad. Marcas **ilimitadas y añadibles libremente** por cada organización (D-3).

### ADR-24 · El sistema registra documentos, no los emite — **nueva, 28/10/2026**
**Decisión:** Margen Pilot **emite cotizaciones**, no facturas. `billing_documents` no genera ningún comprobante: es el **registro** de una factura o boleta que existe fuera de la app (la que emitiste en tu facturador o la que te dio un proveedor), y sirve para saber qué te deben y qué debes.
**Por qué:** Marcelo lo señaló explícitamente, y es correcto: la app no emite ante SUNAT ni valida series.
**Consecuencia en la UI:** la pantalla se llama «Registrar documento», no «Emitir factura». La cotización sale con el nombre de la entidad configurada (p. ej. 3 Brothers MKT SAC) y la marca elegida. Se renombra el grupo a `documents` para que nadie lo lea como facturación electrónica.

### ADR-04 · Los costos viven en tablas hijas — **vigente**
`cost_items`, `service_cost_lines` y `quote_line_costs`, con política RLS propia para `owner|admin|finance`, porque Supabase atiende a todos los usuarios con el mismo rol de base de datos y los permisos por columna no distinguen un comercial de un financiero.
**Confirmado por Marcelo** con una condición: los **distintos tipos de costo** deben verse todos. `cost_items.kind` cubre `role` (personal), `tool` (herramientas y licencias), `external` (freelancers y proveedores) y `other`, y cada uno se muestra con su etiqueta en la ficha, en la cotización y en el PDF.

### ADR-05 · Los límites de plan se validan con lock por organización — **vigente**
`app.assert_entitlement()` toma `pg_advisory_xact_lock` por `(organización, recurso)` antes de contar, porque contar sin lock tiene una carrera trivial. Delegado a mi criterio por Marcelo.

### ADR-08 · Una factura se cobra en su propia moneda — **vigente, confirmada**
La asignación exige que coincidan las monedas del movimiento y del documento.
**Confirmado por Marcelo:** lo que se cotiza en soles se cobra en soles; lo que se cotiza en dólares se cobra en dólares. Con ADR-16 esto es casi automático: cada entidad tiene una sola moneda.

### ADR-14 · Los dos lentes son parte del modelo — **vigente**
**Caja** (bruto, desde `cash_movements`) y **Resultado** (neto de impuesto, desde hechos económicos). Cada cifra de la UI declara el suyo. Con ADR-16, ambos lentes se calculan por entidad.

### ADR-12 · Móvil sale de los criterios del MVP — **vigente**
En palabras claras: el producto de enero es **web**, y funciona bien en el navegador del teléfono. Publicar apps en App Store y Play Store es una decisión posterior, con su propio trabajo. Antes estaba puesto como requisito de aceptación del MVP, lo que hacía imposible aprobar el MVP.

### ADR-19 · El pipeline comercial entra al núcleo — **nueva, 28/10/2026**
**Decisión:** el producto es **cotizador + dashboard financiero + pipeline y seguimiento**, en un solo software.
**Por qué:** es como Marcelo definió el producto el 28/10.
**Alcance del pipeline:** oportunidades con cliente, origen, monto esperado, moneda, etapa y responsable; etapas configurables (nuevo → contactado → propuesta enviada → negociación → ganada / perdida); próxima acción con fecha y alerta en Inicio; bitácora de actividad por oportunidad (llamada, correo, reunión, nota); vista de tablero y de lista; y el hilo completo **oportunidad → cotización → cobro**, que es lo que une las dos mitades del producto.

### ADR-18 · Conciliación e importación bancaria fuera de alcance — **nueva, 28/10/2026**
**Decisión:** no hay importación de estados de cuenta ni motor de conciliación. Se eliminan las tablas `statement_imports`, `statement_lines`, `reconciliation_matches`, `reconciliation_decisions` e `import_formats`.
**Sustituye a:** ADR-06 (doble huella de idempotencia) y ADR-07 (conciliar no crea dinero), que dejan de aplicar porque no hay nada que conciliar. También a ADR-11 (importación solo en Pro).
**Una precisión, para que la decisión quede con la información correcta:** la importación nunca iba a necesitar la API de ningún banco. Eran los archivos CSV o XLSX que tú descargas de tu banca web y subes a mano. Dicho eso, la saco del alcance como pides.
**Lo que queda disponible, barato, si alguna vez lo quieres:** una pantalla de cuadre manual donde escribes el saldo que ves en tu banca y marcas lo que reconoces, y el sistema te dice la diferencia. No entra ahora.

### ADR-20 · Sin fecha de congelamiento — **nueva, 28/10/2026**
**Decisión:** no hay congelamiento el 20/12 ni cronograma por semanas. Se construye lo más prolijo posible, probando a medida. Marcelo empieza a usarlo en enero; si antes hace falta registrar algo, se registra.
**Sustituye a:** ADR-10 y todo el cronograma semanal de `ROADMAP.md` §6.
**Lo que se conserva del roadmap:** el **orden** de las fases y las puertas de calidad, no las fechas. Una fase se cierra cuando sus pruebas pasan, no cuando llega su semana.

### ADR-23 · Orden de ejecución — **nueva, 28/10/2026**
**Decisión (delegada a mi criterio por Marcelo en D-2):**

1. **F1 Fundaciones** — auth, organización, las dos entidades, marcas, monedas, cuentas, impuestos, roles, RLS, migraciones y CI.
2. **F2 Catálogos y cotizador** — ficha de servicio con sus costos, cotizador con margen y markup correctos, estados, instantánea inmutable y PDF.
3. **F3 Finanzas y dashboard** — movimientos, documentos registrados, cobros y pagos parciales, transferencias, y el dashboard de caja y resultado por entidad.
4. **F4 Pipeline y seguimiento** — oportunidades, etapas, próxima acción, bitácora, y el hilo oportunidad → cotización → cobro.

**Por qué este orden, y no caja primero como recomendé el 24/10:** el argumento de poner la caja primero era la fecha del 1/1, que ya no aplica (ADR-20). Sin esa presión, pesa más que el cotizador es autocontenido, es la parte que ya conoces y la que valida rápido el producto, y **genera los datos que hacen que el dashboard financiero se pueda probar de verdad** en lugar de mirarlo vacío. El pipeline va al final a propósito: es el que cose oportunidad con cotización y con cobro, así que necesita que las dos existan.

### ADR-21 · Hosting en SiteGround — **nueva, 28/10/2026**
**Decisión:** el hosting es SiteGround, como pide Marcelo. Sustituye a ADR-13 (host estático con CDN).
**Lo que hay que resolver por esa elección, y resuelvo yo:** un SPA en hosting compartido necesita que todas las rutas caigan en `index.html`, así que el build incluye un `.htaccess` con la regla de reescritura, cabeceras de seguridad y caché con hash de contenido. El despliegue es por FTP/SFTP desde CI o a mano con la carpeta `dist/`.
**Lo que SiteGround no da:** entorno de staging por rama. Se suple con un subdominio de pruebas.

### ADR-22 · El proyecto se llama Margen Pilot — **nueva, 28/10/2026**
Nombre del proyecto, del repositorio y de los documentos. Sustituye al nombre de trabajo `margen` (ADR-15).

---

## 2. Decisiones de Marcelo · 28 de octubre de 2026

### D-1 · Capacidad — **resuelta**
No es relevante y es variable: pueden ser 5 horas una semana, 10 otra, 20 otra. No se planifica por semanas (ADR-20).

### D-2 · Orden de ejecución — **resuelta, delegada**
«Hagámoslo lo mejor posible, lo dejo a tu criterio.» → ADR-23.

### D-3 · Entidades, marcas, monedas e impuestos — **resuelta**

Una organización con **dos entidades legales**, y de momento solo dos:

| Entidad legal | Marca | Moneda | Impuesto |
|---|---|---|---|
| The Publisher Ventures LLC | The Publisher Lab | **USD** | sin IGV (0 %) |
| 3 Brothers MKT SAC | Nlima | **PEN** | IGV 18 % |

- La organización es el contenedor; dentro viven las entidades. Las **marcas se añaden libremente**, sin límite: cada usuario decide cuántas tiene y las crea él mismo.
- **Confirmado por Marcelo el 02/11/2026:** la razón social es **3 Brothers MKT SAC**, con el número y no «Three», y su agencia es **Nlima**. La marca de la LLC es **The Publisher Lab**, no «The Publisher», como figuraba por error hasta esa fecha. Si SUNAT imprime la razón social en otra forma —mayúsculas, o «S.A.C.» con puntos—, es una cadena en `supabase/setup/margen-pilot-org.sql` y se cambia ahí.

### D-4 · Plan para tu propia organización — **resuelta por omisión**
Con dos entidades y dos monedas no cabes en Pro, así que tu organización va con plan `internal`: sin límites, no público, no facturable. Si prefieres otra cosa, se cambia en una fila de la tabla `subscriptions`.

### ADR-25 · Los privilegios que Supabase concede solos se revocan a mano
**28/10/2026.** Un proyecto de Supabase nace con `alter default privileges in schema public grant all on tables to anon, authenticated, service_role`. Consecuencia: cada tabla que creamos quedaba con `DELETE`, `TRUNCATE`, `INSERT`, `UPDATE`, `REFERENCES` y `TRIGGER` concedidos a `anon` y a `authenticated`, sin que nadie lo pidiera. Verificado el 28/10/2026 contra el proyecto real: 15 tablas con `DELETE` para cada uno de los dos roles. Y como `currencies`, `plans` y `plan_entitlements` no llevaban RLS, cualquiera con la clave pública y sin iniciar sesión podía `delete from plans` o subirse los límites con un `update plan_entitlements`.

La migración `20261028120300_lockdown.sql` revoca los *default privileges* para el rol `postgres` (el que aplica nuestras migraciones), deja a cero lo ya concedido y vuelve a conceder solo lo necesario. **`anon` no recupera nada:** en este producto no hay ninguna pantalla sin sesión. Las tres tablas de referencia pasan a tener RLS con política de solo lectura, y el plan `internal` deja de ser visible para un cliente.

Comprobado por HTTP con la clave pública real: las siete peticiones —leer planes, monedas, organizaciones y cuentas; borrar un plan; modificar un límite; llamar al RPC de alta— devuelven `401 permission denied`.

**Lo que esto enseña, y es la lección que queda:** verificar contra un Postgres pelado no es verificar contra Supabase. La CI seguirá usando Postgres a secas porque es rápido y gratis —desde el 02/11/2026 en la misma versión mayor que el proyecto, 17—, pero **la invariante que cuenta es la genérica**: toda tabla de `public` con RLS encendida, `authenticated` sin `DELETE` ni `TRUNCATE`, `anon` sin nada. Están en `supabase/tests/invariants.sql` y cazan la tabla de F2, F3 o F4 que se olvide de encenderla.

### ADR-26 · `create_organization` tiene techo
**28/10/2026.** La función es `security definer` y ejecutable por cualquiera con sesión, porque es el único camino para crear una organización. Pero no tenía tope: una llamada en bucle fabricaba organizaciones sin fin, cada una con sus nueve categorías. Se le pone un techo de **3 organizaciones de las que un usuario sea `owner`**, con su lock por usuario para cerrar la misma carrera que cierra `app.assert_entitlement`. No es un límite de plan: cuando se llama no existe todavía organización de la que leer un plan. Si hace falta más, se sube ahí y se documenta aquí.

### ADR-27 · El stub de `auth` de la CI es copia literal del real
**28/10/2026.** El stub definía `auth.uid()` leyendo una variable de sesión propia (`app.current_user_id`), mientras Supabase la lee del JWT (`request.jwt.claim.sub`). Las pruebas se hacían pasar por un usuario de una forma que **solo existía en la CI**. Ahora el stub lleva la definición literal de Supabase, verificada contra el proyecto, y la suite suplanta al usuario igual en los dos sitios. Un camino que solo funciona en el entorno de pruebas no prueba nada.

### ADR-28 · El repositorio es público
**02/11/2026.** Marcelo decide mantener `Marcelolopezwork/margenpilot` público, sabiendo que `docs/00-REVISION-CRITICA.md` contiene el análisis de sus dos aplicaciones en producción, y que con el repositorio se publican también el esquema, las políticas de RLS y los límites de cada plan.

Verificado **sobre lo que quedó publicado**, no sobre lo que se pretendía publicar: 42 archivos, sin `.env` y sin ninguna clave (`sb_publishable_`, `sb_secret_`, JWT). La referencia del proyecto de Supabase sí está, y no es un secreto: viaja en cada petición que hace el navegador. Lo que protege la base no es que el esquema sea secreto, es ADR-25.

### ADR-29 · El producto vive en `crm.thepublisherlab.com`
**02/11/2026.** Subdominio en el SiteGround de ADR-21, con el `public/.htaccess` que ya reescribe a `index.html`. Consecuencias:

- *Authentication → URL Configuration* lleva **las dos** URL de redirección, desarrollo y producción, y el *Site URL* apunta a producción. Una sola no basta: el enlace de acceso se emite contra el origen desde el que se pidió.
- **No hay cambio de código.** `SignIn.tsx` pasa `emailRedirectTo: window.location.origin`, así que el enlace vuelve al sitio desde el que se pidió, sea `localhost:5173` o el dominio. Lo único que hay que mantener es la lista blanca de Supabase.
- El subdominio de pruebas que ADR-21 pone en lugar del staging por rama será otro subdominio del mismo dominio, y también tendrá que entrar en esa lista.

### ADR-30 · El armazón no lleva controles que no controlan nada
**02/11/2026.** `UI_UX_PLAN.md` §3 describe en móvil cinco destinos con un `+` central de acciones rápidas, y en la barra superior un conmutador de moneda de visualización. F1 no trae ninguno de los dos.

El `+` abriría una hoja con tres acciones —nuevo movimiento, nueva cotización, nueva transferencia— que no existen hasta F2 y F3. El conmutador de moneda no tiene ninguna cifra que conmutar hasta que haya movimientos. Un control inhabilitado enseña al usuario a ignorar esa parte de la interfaz, y eso no se desaprende cuando el control empieza a funcionar.

En su lugar, la barra inferior lleva tres destinos y «Más», que abre el resto. Los dos controles vuelven con la fase que les da contenido, y el plan de UI sigue siendo el destino, no una promesa incumplida.

### ADR-31 · `react-router-dom` 7
**02/11/2026.** `npm audit` marcaba dos avisos moderados contra todo el rango 6.0.0–7.17.0: un *open redirect* por barra invertida en `<Link>` y `useNavigate`, y una inyección de constructor en la hidratación SSR. Ninguno nos afectaba hoy —no hacemos SSR y todos los destinos son literales—, pero el primero sí nos afectaría en cuanto F2 construya enlaces con datos del usuario. Se sube a 7.18.5, que es un salto de versión mayor y deja la auditoría de producción en cero. Cuesta 5,6 KB comprimidos.

### D-7 · Proveedor de correo transaccional — **abierta y con fecha límite**
**02/11/2026.** Encontrado al preparar el primer acceso, y el plan no lo contemplaba en ninguna parte.

El servicio de correo que trae Supabase **solo escribe a las direcciones de los miembros de la organización de Supabase**; a cualquier otra responde `email_address_not_authorized`. Además tiene un límite bajo por hora y es «best-effort», sin garantía de entrega.

Consecuencia inmediata: la organización `margen pilot` (plan free) la creó `info@thepublisherlab.com`, así que hoy ese es el único correo que puede recibir un enlace de acceso. Entrar con otro, como `thepublishercontact@gmail.com`, falla aunque las URL de redirección estén bien puestas.

Consecuencia de fondo, que es la que importa: **el producto no puede dar de alta a un solo cliente real sin un SMTP propio.** El acceso es por enlace de correo y ningún cliente va a ser miembro de nuestra organización de Supabase. No es trabajo de F5 ni de «cuando lancemos»: es la víspera del primer usuario que no seas tú. Queda por elegir proveedor y por decidir el dominio desde el que se envía, que debería ser `thepublisherlab.com` con su SPF y su DKIM para no caer en spam.

### ADR-32 · El acceso principal es correo y contraseña
**02/11/2026.** Rectifica una decisión mía. `BACKLOG.md` F1-1 pedía «auth con email + contraseña y recuperación» y yo monté solo el enlace por correo, que parecía más cómodo.

El resultado fue que Marcelo pasó cinco días sin poder abrir su propia aplicación. El enlace depende de que el correo salga, llegue y no caiga en spam, y encima el servicio de Supabase solo escribe a los miembros de su organización mientras no haya SMTP propio (D-7). Una forma de entrar que depende de tres cosas que pueden fallar no es la forma principal de entrar.

Ahora la pantalla tiene dos pestañas y **la contraseña es la primera**. El enlace sigue estando, porque para un cliente que no quiere gestionar otra contraseña es mejor, pero deja de ser el único camino. Los errores de acceso se traducen: `Invalid login credentials` se lee «Correo o contraseña incorrectos», y los dos del correo explican que se entre con contraseña.

**La lección, que es más general que esto:** una decisión técnica que deja al usuario sin poder usar el producto es una mala decisión, por elegante que sea. Se mide por si puede entrar, no por cuántos pasos tiene el formulario.

### ADR-33 · El dinero se guarda en `numeric`, y el `bigint` es del cliente
**03/11/2026.** Comprobado contra el proyecto real antes de escribir la primera columna de dinero, porque equivocarse aquí se arrastra a todo lo demás.

PostgREST entrega `numeric` **como texto** (`"12345678901234.5678"`) y `bigint` **como número de JavaScript** (`1234`). O sea que guardar importes como `bigint` de unidades mínimas —que es como los manejamos en TypeScript— sería *peor* que `numeric`: al cruzar JSON pasarían por un `double` y perderían precisión por encima de 2^53.

Queda como estaba planeado en FINANCIAL_RULES §4: `numeric(18,2)` para lo que liquida, `numeric(18,4)` para precios y costos unitarios, `numeric(7,4)` para porcentajes. El `bigint` de unidades mínimas vive solo dentro de `money.ts`, y `money.fromDb` es la única puerta de entrada.

**Y hay una mentira que hay que recordar:** los tipos que genera Supabase declaran `number` para las columnas `numeric`, pero en ejecución llega un `string`. No explota al mostrarlo —`Intl` convierte sola— pero sí al hacer cuentas. Por eso `formatoTasa` acepta las dos cosas y lo dice en su comentario.

### ADR-34 · El costo no se esconde en la interfaz, se niega en la base
**03/11/2026.** En el catálogo de F2, el rol `commercial` no puede leer `cost_items` ni `service_cost_lines`. No es que la pantalla oculte una columna: la base devuelve **cero filas**. Ocultar en la interfaz no sirve de nada cuando cualquiera con la clave pública puede llamar a la API y pedir la tabla entera.

Se apoya en `app.can_see_costs()`, que ya existía desde F1. Verificado con dos usuarios de la misma organización: el comercial ve 1 ficha y 1 categoría, y 0 ítems de costo y 0 líneas; la dueña ve las cuatro cosas.

Y la pertenencia a la organización no se vigila con disparadores sino con **claves ajenas compuestas**: `service_cost_lines (service_id, organization_id)` apunta a `services (id, organization_id)`. Una línea de costo de otra organización es imposible por estructura, no por una comprobación que alguien pueda olvidar.

### D-5 · Tasa del consolidado — **resuelta**
**La última tasa disponible**, mostrada siempre con su fecha y su fuente. El consolidado es referencial y no se almacena.

### D-6 · Retención de archivos — **resuelta**
**90 días.** Ya no aplica a estados de cuenta (ADR-18); aplica a los archivos que sí habrá: PDF de cotizaciones emitidas y comprobantes que se adjunten a un movimiento.

### Alcance, en las palabras de Marcelo
> «Lo que quiero es juntar el cotizador con el dashboard financiero en un solo software y agregar lo que es el tema de pipeline y seguimiento.»

Eso es el producto. Todo lo que no sirva a esas tres piezas no entra.

---

## 3. Lo que sigue abierto

**Resuelto el 02/11/2026:** el código está en `Marcelolopezwork/margenpilot` y la CI corre en cada push, con los dos trabajos en verde —incluido el paso que tira el esquema y reaplica las seis migraciones sobre una base limpia, que es la única prueba de que sirven para montar el proyecto desde cero—.

**Resuelto el 28/10/2026:** el proyecto de Supabase existe (`veocqvmywodeizuvnssn`, organización `margen pilot`, región `us-east-1`, Postgres 17). Las seis migraciones de F1 están aplicadas y las 27 aserciones de la suite pasan contra esa base. La verificación local con Docker deja de ser necesaria: se verifica contra el proyecto real, dentro de una transacción que se deshace, de modo que no queda ni una fila de prueba.

**Hecho el 03/11/2026:** Marcelo entró por primera vez con `info@thepublisherlab.com` y contraseña. Su fila de `profiles` se creó sola desde `SessionProvider`, que es la primera prueba de que la app autenticada corre contra la base real. `supabase/setup/margen-pilot-org.sql` se ejecutó: organización `Margen Pilot` con plan `internal`, él como `owner`, PEN y USD habilitadas, 9 categorías y las dos entidades con sus marcas e impuestos por defecto. El disparador de auditoría dejó sus 5 filas.

**Decidido el 02/11/2026:** Marcelo entra con `info@thepublisherlab.com`, la cuenta dueña de la organización de Supabase, que hasta que exista SMTP propio es la única que recibe el enlace (D-7). `supabase/setup/margen-pilot-org.sql` apunta ahí.

**Hecho el 02/11/2026:** F1-12 (armazón: barra lateral colapsable, barra inferior, selector de organización y entidad, tema en tres estados) y las seis pantallas de Configuración —entidades, marcas, monedas, impuestos, cuentas y categorías—, con los errores de la base traducidos a frases que dicen qué hacer. Nueve pruebas sobre el árbol de accesibilidad comprueban la aceptación de F1-12 sin depender de una sesión real.

**Lo siguiente de F2, por orden:** la ficha de servicio por dentro —sus incluye/no incluye ordenables (F2-3) y su composición de costos con precio sugerido y margen real aparte del fee (F2-4)—, y después el cotizador.

**Deuda anotada:** el bundle pasó de 500 kB en crudo (145 kB comprimidos) y Vite ya avisa. Toca dividir por rutas con `React.lazy` antes de que entre el cotizador, no después.

**Me bloquea trabajo ahora:**

- **Las URL de redirección en Supabase.** Solo hacen falta para el acceso por enlace, que ya no es el camino principal. En *Authentication → URL Configuration*: `http://localhost:5173/**` y `https://crm.thepublisherlab.com/**`, con *Site URL* apuntando a la segunda (ADR-29).
- **Registrar una cuenta de caja desde la app.** Es lo único que queda por ver funcionando de extremo a extremo: la lectura ya está probada, pero una escritura desde la interfaz contra la base real todavía no. Es además el paso que hace falta antes de F3.

**Puede esperar sin coste:** precio del plan Pro y límites finos · identidad visual y dominio · si alguna vez entra el cuadre manual (ADR-18) · alcance de acceso de agentes IA · apps en tiendas (ADR-12).

---

## 4. Cómo se registra una decisión nueva

Identificador, decisión, por qué y consecuencia, con fecha. Si contradice una anterior, la anterior se marca **sustituida por ADR-NN** y no se borra. El historial de decisiones se trata como el financiero: se anula, no se borra.
