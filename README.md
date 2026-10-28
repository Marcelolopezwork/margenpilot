# Margen Pilot

Cotizador, dashboard financiero y pipeline comercial en un solo software, con **dos libros contables separados**: Perú en soles con IGV, Estados Unidos en dólares sin IGV.

> Del presupuesto al dinero en tu cuenta.

## Estado

| | |
|---|---|
| Fase | **F1 Fundaciones**, en curso |
| Web | arranca, con acceso por enlace de correo |
| Base de datos | tres migraciones escritas · **no aplicadas todavía** |
| Supabase | **pendiente de crear** (ver más abajo) |
| Hosting | SiteGround, `public/.htaccess` ya preparado |
| Verificado en local | tipos, lint, build y 16 pruebas de dinero |
| Sin verificar | las migraciones: faltan Docker o el proyecto de Supabase |

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

1. **Crear el proyecto** en supabase.com. Región cercana a Perú.
2. **Aplicar las migraciones**, en orden, desde el SQL Editor o con `supabase db push` tras `supabase link`:
   - `supabase/migrations/20261028120000_foundations.sql`
   - `supabase/migrations/20261028120100_rls.sql`
   - `supabase/migrations/20261028120200_entitlements.sql`
3. **Entrar una vez** en la app con tu correo, para que exista el usuario.
4. **Ejecutar** `supabase/setup/margen-pilot-org.sql`, que crea la organización y las dos entidades con sus marcas y sus impuestos.

`supabase/stubs/auth.sql` y `supabase/tests/invariants.sql` son solo para la CI: suplen el esquema `auth` en un Postgres pelado y comprueban los invariantes. No se aplican al proyecto real.

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
