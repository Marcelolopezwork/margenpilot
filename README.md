# margen — SaaS comercial y financiero

Nombre de trabajo. **No hay código de aplicación todavía**: este repositorio contiene, por ahora, la especificación aprobada para construirlo.

Del presupuesto al dinero en la cuenta: cotizar → cobrar y pagar → verificar contra el banco → entender caja y rentabilidad. Varias empresas, varias monedas. No es software contable.

## Estado

| | |
|---|---|
| Fase actual | **F0 — decisiones y diseño** |
| Código de aplicación | no iniciado |
| Supabase | **no creado** |
| Despliegues | ninguno |
| Dominio | ninguno |
| Meta operativa | registrar la operación real desde el **1/1/2027** |

Las dos aplicaciones anteriores (Cotizador Pro y TPL Finanzas) y sus proyectos Supabase quedan **intactos** como archivo histórico. No se migra ningún dato transaccional de 2026. Focus queda fuera de este proyecto por completo.

## Documentación

Léela en este orden:

| Documento | Para qué |
|---|---|
| [docs/00-REVISION-CRITICA.md](docs/00-REVISION-CRITICA.md) | Qué está bien del plan, qué contradice, qué falta, con evidencia del código actual |
| [docs/PRD.md](docs/PRD.md) | Qué es el producto, qué no es, planes y alcance de la v1 |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Stack, ERD completo, RLS, límites de plan, motor de conciliación |
| [docs/FINANCIAL_RULES.md](docs/FINANCIAL_RULES.md) | **Normativo.** Invariantes, fórmulas, redondeo, multimoneda, los dos lentes |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Calendario real, dos escenarios de capacidad, puertas de decisión |
| [docs/BACKLOG.md](docs/BACKLOG.md) | Historias por fase con aceptación verificable |
| [docs/UI_UX_PLAN.md](docs/UI_UX_PLAN.md) | Tokens, cinco pantallas prioritarias, accesibilidad |
| [docs/TEST_PLAN.md](docs/TEST_PLAN.md) | Qué se prueba, con qué, y qué bloquea un merge |
| [docs/DECISIONS.md](docs/DECISIONS.md) | Decisiones de arquitectura adoptadas y **las seis que faltan por decidir** |

## Lo siguiente

1. Responder las seis decisiones bloqueantes de [docs/DECISIONS.md](docs/DECISIONS.md) §2.
2. Revisar los [wireframes de las cinco pantallas](https://claude.ai/artifact/WGvmH8gmBmycTGdK6noHEi) (F0-5, publicados; ver [docs/UI_UX_PLAN.md](docs/UI_UX_PLAN.md) §8).
3. Repo Git privado, estructura y CI (F0-2, F0-3).
4. Empezar F1.

## Principios que no se negocian

- Nada financiero se borra: se anula con motivo y contrapartida.
- Lo emitido es inmutable: una propuesta enviada no cambia sola nunca.
- Dos monedas no se suman sin declarar tasa, fecha y fuente.
- Cada cifra declara su lente: Caja o Resultado.
- El sistema propone, la persona aprueba.
- Exactitud antes que velocidad: si hay que recortar, se recorta alcance, nunca pruebas de dinero.
