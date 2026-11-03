# Margen Pilot

Cotizador, dashboard financiero y pipeline comercial en un solo software, con **dos libros contables separados**: Perú en soles con IGV, Estados Unidos en dólares sin IGV.

> Del presupuesto al dinero en tu cuenta.

## Estado

| | |
|---|---|
| Fase | **F1** terminada · **F2** empezada: modelo de catálogos y costos |
| Web | acceso con contraseña o enlace · armazón con las siete secciones · las seis pantallas de Configuración |
| Base de datos | siete migraciones **aplicadas** al proyecto real (F1 + catálogos de F2) |
| Supabase | `veocqvmywodeizuvnssn` · organización `margen pilot` · Postgres 17 |
| Repositorio | [Marcelolopezwork/margenpilot](https://github.com/Marcelolopezwork/margenpilot), público · CI en cada push |
| Hosting | SiteGround · `crm.thepublisherlab.com` · `public/.htaccess` ya preparado |
| Verificado | 36 aserciones contra la base real · 52 pruebas (dinero, errores, formato, armazón, altas) · tipos, lint y build · CI en verde, con las migraciones reaplicadas desde cero |
| Pendiente | registrar una cuenta de caja desde la app · subir el build a `crm.thepublisherlab.com` · SMTP propio antes del primer cliente (D-7) |

Las dos aplicaciones anteriores y sus proyectos de Supabase quedan **intactos**. No se migra ningún dato de 2026. Focus queda fuera.

## Arrancar en local

```bash
npm install
cp .env.example .env     # y rellenar con los valores de tu panel de Supabase
npm run dev
```

Sin `.env` la app no falla: muestra una pantalla con los tres pasos que faltan.

| Comando | Qué hace |
|---|---|
| `npm run dev` | servidor de desarrollo |
| `npm run typecheck` | TypeScript estricto, sin emitir |
| `npm run lint` | ESLint |
| `npm test` | pruebas de dominio (dinero, márgenes, redondeo) |
| `npm run build` | build de producción en `dist/` |

## Poner en pie la base de datos

Los pasos 1 y 2 ya están hechos sobre `veocqvmywodeizuvnssn`. Quedan documentados para montar un proyecto nuevo desde cero.

1. **Crear el proyecto** en supabase.com.
2. **Aplicar las migraciones** en orden, desde el SQL Editor o con `supabase db push` tras `supabase link`:
   - `20261028120000_foundations.sql` — esquema, tablas, disparadores
   - `20261028120100_rls.sql` — aislamiento entre organizaciones
   - `20261028120200_entitlements.sql` — límites de plan y alta de organización
   - `20261028120300_lockdown.sql` — **revoca los privilegios que Supabase concede solo** (ver ADR-25; sin esta migración `anon` puede borrar los planes)
   - `20261028120400_hardening.sql` — `search_path` fijo y techo de organizaciones por usuario
   - `20261028120500_indices.sql` — `auth.uid()` fuera del bucle por fila e índices de clave ajena
3. **Entrar una vez** en la app con tu correo, para que exista el usuario.
4. **Ejecutar** `supabase/setup/margen-pilot-org.sql`, que crea la organización y las dos entidades con sus marcas y sus impuestos.

### Verificar

`supabase/tests/invariants.sql` comprueba 27 invariantes: aislamiento entre organizaciones, límites de plan, los dos libros, un solo impuesto por defecto, y las tres guardas de privilegios —toda tabla con RLS, `authenticated` sin `DELETE` ni `TRUNCATE`, `anon` sin nada—.

En la CI corre contra un `postgres:17` —la misma versión mayor que el proyecto— con `supabase/stubs/auth.sql`, que suple el esquema `auth`. Contra el proyecto real se corre envuelto en `begin; … rollback;` para que no quede ni una fila de prueba. **Las dos cosas hacen falta:** un Postgres pelado no trae los `default privileges` de Supabase, y por eso la CI no vio sola el agujero de ADR-25.

## Las reglas que no se negocian

- **Un importe nunca es un `number`.** El dinero es `bigint` de unidades mínimas en `src/lib/money.ts`. Postgres entrega `numeric` como string y esa es la única puerta de entrada.
- **Dos libros, uno por entidad.** `legal_entity_id` es obligatorio y validado. Ningún informe mezcla Perú con Estados Unidos.
- **Dos monedas no se suman** sin tasa, fecha y fuente a la vista. El consolidado es referencial y no se almacena.
- **Nada financiero se borra.** El rol `authenticated` no tiene `DELETE` en ninguna tabla.
- **Margen y markup son campos distintos.** Margen sobre precio, markup sobre costo. Es el error exacto del cotizador anterior.
- **Los límites de plan se validan en el servidor**, con lock por organización.

## Documentación

| Documento | Para qué |
|---|---|
| [docs/DECISIONS.md](docs/DECISIONS.md) | **Empieza aquí.** Decisiones vigentes y lo que sigue abierto |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Stack, ERD, RLS, límites de plan, pipeline |
| [docs/FINANCIAL_RULES.md](docs/FINANCIAL_RULES.md) | **Normativo.** Invariantes, fórmulas, redondeo, multimoneda |
| [docs/PRD.md](docs/PRD.md) | Qué es el producto y qué no es |
| [docs/UI_UX_PLAN.md](docs/UI_UX_PLAN.md) | Tokens, pantallas, accesibilidad |
| [docs/BACKLOG.md](docs/BACKLOG.md) | Historias por fase con aceptación verificable |
| [docs/TEST_PLAN.md](docs/TEST_PLAN.md) | Qué se prueba y qué bloquea un merge |
| [docs/00-REVISION-CRITICA.md](docs/00-REVISION-CRITICA.md) | Revisión del plan original, con la evidencia del código anterior |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Orden de fases (las fechas quedaron sin efecto) |

Wireframes de las cinco pantallas: https://claude.ai/artifact/WGvmH8gmBmycTGdK6noHEi
