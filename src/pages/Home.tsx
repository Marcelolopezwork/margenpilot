import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { puedeEscribirDinero, useOrg, useOrgElegida } from '../app/org-context';
import { mensajeDeError } from '../lib/errors';
import { formatoFecha } from '../lib/format';
import { currencyOf, format, fromRow, toDb, type CurrencyCode, type Money } from '../lib/money';
import { requireSupabase } from '../lib/supabase';
import { Aviso, Boton, Cargando, Etiqueta, Tarjeta } from '../components/ui';
import { FiltradoPor } from '../components/piezas';
import { cobradoPorDocumento } from './finanzas/cobrado';
import { diasDeAtraso, enRojo, pendienteDe, porMoneda, vencido } from './finanzas/cartera';
import type { DocumentoEnCartera } from './finanzas/cartera';
import { monedasConCuotas, proyeccion } from './finanzas/proyeccion';
import type { CuotaEsperada } from './finanzas/proyeccion';

/**
 * Inicio es la pantalla de las ocho de la mañana: cuánto tengo, quién me debe
 * y qué conviene hacer hoy. Tres preguntas, en ese orden, que es el del
 * wireframe de `docs/UI_UX_PLAN.md` §4.1.
 *
 * La caja va arriba y **por moneda**. El consolidado referencial es una línea
 * de texto subordinada y nunca una tarjeta: si fuera tarjeta competiría con
 * las cifras reales y acabaría leyéndose como si fuera dinero de una sola
 * moneda, que es justo lo que no es.
 *
 * «Por cobrar» no se suma a la caja en el mismo bloque. Son dos cosas: una es
 * dinero que está, la otra es dinero que te deben.
 *
 * Hasta el 6/11/2026 esta pantalla era la lista de puesta en marcha, porque no
 * había ni un movimiento que mostrar. Ahora la configuración baja al final y
 * solo aparece lo que falte.
 */

type Paso = { nombre: string; cuantas: number; ruta: string; porque: string };

/** Una acción que hacer hoy, no un dato que mirar. */
type Accion = {
  clave: string;
  tono: 'atencion' | 'neutro';
  texto: string;
  ruta: string;
  boton: string;
};

export default function Home() {
  const { organizacion, entidad } = useOrgElegida();
  const { elegirEntidad } = useOrg();
  const conDinero = puedeEscribirDinero(organizacion.rol);
  const hoy = new Date().toISOString().slice(0, 10);

  const puesta = useQuery({
    queryKey: ['puesta-en-marcha', organizacion.id],
    queryFn: async () => {
      const supabase = requireSupabase();
      const org = organizacion.id;
      const [entidades, monedas, cuentas, marcas] = await Promise.all([
        supabase.from('legal_entities').select('id', { count: 'exact', head: true })
          .eq('organization_id', org).eq('is_active', true),
        supabase.from('organization_currencies').select('currency_code', { count: 'exact', head: true })
          .eq('organization_id', org).eq('is_enabled', true),
        supabase.from('cash_accounts').select('id', { count: 'exact', head: true })
          .eq('organization_id', org).eq('is_active', true),
        supabase.from('brands').select('id', { count: 'exact', head: true })
          .eq('organization_id', org).eq('is_active', true),
      ]);
      const fallo = entidades.error ?? monedas.error ?? cuentas.error ?? marcas.error;
      if (fallo) throw fallo;
      return {
        entidades: entidades.count ?? 0,
        monedas: monedas.count ?? 0,
        cuentas: cuentas.count ?? 0,
        marcas: marcas.count ?? 0,
      };
    },
  });

  const caja = useQuery({
    queryKey: ['saldos', organizacion.id, entidad?.id ?? null],
    enabled: conDinero,
    queryFn: async () => {
      const supabase = requireSupabase();
      let q = supabase
        .from('cash_accounts')
        .select('id, name, currency_code, legal_entity_id, is_active')
        .eq('organization_id', organizacion.id)
        .eq('is_active', true)
        .order('sort');
      if (entidad) q = q.eq('legal_entity_id', entidad.id);
      const { data: cuentas, error } = await q;
      if (error) throw error;

      const { data: saldos, error: e2 } = await supabase
        .from('account_balances')
        .select('cash_account_id, balance')
        .eq('organization_id', organizacion.id);
      if (e2) throw e2;

      return (cuentas ?? []).map((c) => ({
        ...c,
        saldo: fromRow(
          (saldos ?? []).find((s) => s.cash_account_id === c.id)?.balance ?? 0,
          currencyOf(c.currency_code),
        ),
      }));
    },
  });

  const cartera = useQuery({
    queryKey: ['cartera', organizacion.id, entidad?.id ?? null],
    enabled: conDinero,
    queryFn: async () => {
      const supabase = requireSupabase();
      let q = supabase
        .from('billing_documents')
        .select('id, series_number, doc_type, issue_date, due_date, currency_code, amount_total, status, client_id, legal_entity_id')
        .in('status', ['open', 'partially_paid'])
        .eq('organization_id', organizacion.id)
        .order('due_date', { nullsFirst: false });
      if (entidad) q = q.eq('legal_entity_id', entidad.id);
      const { data: docs, error } = await q;
      if (error) throw error;
      if (!docs || docs.length === 0) return [];

      const cobrado = await cobradoPorDocumento(docs.map((d) => d.id));
      return docs.map((d) => {
        const doc: DocumentoEnCartera = {
          id: d.id,
          series_number: d.series_number,
          issue_date: d.issue_date,
          due_date: d.due_date,
          currency_code: d.currency_code,
          amount_total: String(d.amount_total),
          status: d.status,
          cliente: '',
        };
        const pagado = cobrado.get(d.id);
        return {
          doc,
          serie: d.series_number,
          pendiente: pendienteDe(doc, pagado ?? fromRow(0, currencyOf(d.currency_code))),
        };
      });
    },
  });

  const cuotas = useQuery({
    queryKey: ['cuotas-esperadas', organizacion.id, entidad?.id ?? null],
    queryFn: async () => {
      let q = requireSupabase()
        .from('payment_schedule_items')
        .select('id, label, due_date, amount, currency_code, status, quote_id, billing_document_id')
        .eq('organization_id', organizacion.id)
        .in('status', ['planned', 'documented'])
        .order('due_date');
      if (entidad) q = q.eq('legal_entity_id', entidad.id);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  const tasa = useQuery({
    queryKey: ['tasa-referencial', organizacion.id],
    enabled: conDinero,
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('fx_rates')
        .select('from_code, to_code, rate, as_of, source')
        .eq('organization_id', organizacion.id)
        .order('as_of', { ascending: false })
        .limit(1);
      if (error) throw error;
      return data?.[0] ?? null;
    },
  });

  // ------------------------------------------------------------------ roles
  // El rol comercial no ve caja ni cartera porque la base no se lo enseña.
  // Darle la misma pantalla vacía parecería una aplicación estropeada.
  if (!conDinero) {
    return (
      <div className="flex flex-col gap-6">
        <header>
          <p className="text-xs uppercase tracking-widest text-subtle">Inicio</p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">{organizacion.name}</h1>
          <p className="mt-2 max-w-prose text-sm text-muted">
            La caja y la cartera son de finanzas y tu rol es comercial, así que no te las enseña la
            base de datos. Lo tuyo son las cotizaciones.
          </p>
        </header>
        <Tarjeta className="p-5">
          <h2 className="font-medium">Tus cotizaciones</h2>
          <p className="mt-2 max-w-prose text-sm text-muted">
            Ahí tienes el listado con sus estados, los filtros y el margen agregado de lo que estés
            viendo.
          </p>
          <div className="mt-4">
            <Link to="/comercial/cotizaciones">
              <Boton variante="primario">Ir a cotizaciones</Boton>
            </Link>
          </div>
        </Tarjeta>
      </div>
    );
  }

  // ------------------------------------------------------------------ caja
  const porMonedaCaja = new Map<CurrencyCode, { total: Money; cuentas: typeof caja.data }>();
  for (const cuenta of caja.data ?? []) {
    const moneda = cuenta.saldo.currency;
    const antes = porMonedaCaja.get(moneda);
    porMonedaCaja.set(moneda, {
      total: antes ? { minor: antes.total.minor + cuenta.saldo.minor, currency: moneda } : cuenta.saldo,
      cuentas: [...(antes?.cuentas ?? []), cuenta],
    });
  }
  const monedasDeCaja = [...porMonedaCaja.keys()].sort((a, b) => a.localeCompare(b));

  const porCobrar = porMoneda(
    (cartera.data ?? []).map((d) => ({
      currency_code: d.doc.currency_code,
      importe: toDb(d.pendiente),
    })),
  );
  const vencidos = (cartera.data ?? []).filter((d) => vencido(d.doc, hoy));

  const esperadas: CuotaEsperada[] = (cuotas.data ?? []).map((c) => ({
    due_date: c.due_date,
    amount: String(c.amount),
    currency_code: c.currency_code,
    status: c.status,
  }));
  const monedasProyectadas = monedasConCuotas(esperadas);

  // --------------------------------------------------------------- acciones
  const acciones: Accion[] = [];

  for (const d of vencidos.slice(0, 4)) {
    acciones.push({
      clave: `venc-${d.doc.id}`,
      tono: 'atencion',
      texto: `${d.serie ?? 'Documento sin número'} venció hace ${diasDeAtraso(d.doc, hoy)} días · ${format(d.pendiente)} sin cobrar`,
      ruta: '/finanzas',
      boton: 'Registrar cobro',
    });
  }

  // Una cuota que vence dentro de una semana y todavía no tiene documento: lo
  // que hay que hacer es emitirlo, y hoy es cuando se puede hacer a tiempo.
  const enUnaSemana = new Date(Date.parse(`${hoy}T00:00:00Z`) + 7 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const porEmitir = (cuotas.data ?? []).filter(
    (c) => c.status === 'planned' && c.billing_document_id === null && c.due_date <= enUnaSemana,
  );
  for (const c of porEmitir.slice(0, 4)) {
    acciones.push({
      clave: `emitir-${c.id}`,
      tono: c.due_date < hoy ? 'atencion' : 'neutro',
      texto: `«${c.label}» ${c.due_date < hoy ? 'venció el' : 'vence el'} ${formatoFecha(c.due_date)} y no tiene documento emitido`,
      ruta: c.quote_id ? `/comercial/cotizaciones/${c.quote_id}` : '/comercial/cotizaciones',
      boton: 'Emitir',
    });
  }

  const enRojoAhora = (caja.data ?? []).filter((c) => enRojo(c.saldo));
  for (const c of enRojoAhora) {
    acciones.push({
      clave: `rojo-${c.id}`,
      tono: 'atencion',
      texto: `${c.name} está en rojo: ${format(c.saldo)}`,
      ruta: '/finanzas',
      boton: 'Ver el libro',
    });
  }

  const pasos: Paso[] = puesta.data
    ? [
        { nombre: 'Entidades legales', cuantas: puesta.data.entidades, ruta: '/configuracion/entidades',
          porque: 'Cada entidad es un libro contable aparte, con su moneda y su impuesto.' },
        { nombre: 'Monedas habilitadas', cuantas: puesta.data.monedas, ruta: '/configuracion/monedas',
          porque: 'Una cuenta solo puede existir en una moneda habilitada en la organización.' },
        { nombre: 'Marcas', cuantas: puesta.data.marcas, ruta: '/configuracion/marcas',
          porque: 'La marca es el nombre con el que sale la cotización. Una marca no tiene caja.' },
        { nombre: 'Cuentas de caja', cuantas: puesta.data.cuentas, ruta: '/configuracion/cuentas',
          porque: 'Sin cuentas no hay dónde registrar un cobro ni un pago.' },
      ]
    : [];
  const faltan = pasos.filter((p) => p.cuantas === 0);

  const cargando = caja.isPending || cartera.isPending || cuotas.isPending;
  const fallo = caja.error ?? cartera.error ?? cuotas.error ?? puesta.error;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <p className="text-xs uppercase tracking-widest text-subtle">Inicio</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">{organizacion.name}</h1>
      </header>

      <FiltradoPor entidad={entidad?.legal_name ?? null} alQuitar={() => elegirEntidad(null)} />

      {fallo && <Aviso tipo="error">{mensajeDeError(fallo)}</Aviso>}
      {cargando && <Cargando que="tu caja" />}

      {/* ------------------------------------------------------- caja hoy */}
      {!cargando && (
        <section className="flex flex-col gap-3">
          <h2 className="text-xs uppercase tracking-widest text-subtle">Caja disponible hoy</h2>
          {monedasDeCaja.length === 0 ? (
            <Tarjeta className="p-5">
              <p className="max-w-prose text-sm text-muted">
                No hay cuentas activas, así que no hay caja que mostrar.
              </p>
              <div className="mt-3">
                <Link to="/configuracion/cuentas">
                  <Boton variante="primario">Crear una cuenta</Boton>
                </Link>
              </div>
            </Tarjeta>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {monedasDeCaja.map((moneda) => {
                const grupo = porMonedaCaja.get(moneda);
                if (!grupo) return null;
                return (
                  <Tarjeta key={moneda} className="p-5">
                    <p className="text-xs uppercase tracking-widest text-subtle">{moneda}</p>
                    <p className="num mt-1 text-2xl font-semibold tracking-tight">
                      {format(grupo.total)}
                    </p>
                    <ul className="mt-3 flex flex-col gap-1 border-t border-border pt-3">
                      {(grupo.cuentas ?? []).map((c) => (
                        <li key={c.id} className="flex items-baseline justify-between gap-3 text-sm">
                          <span className="min-w-0 truncate text-muted">{c.name}</span>
                          <span className={`num shrink-0 ${enRojo(c.saldo) ? 'text-negative' : ''}`}>
                            {format(c.saldo)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </Tarjeta>
                );
              })}
            </div>
          )}

          {/*
            El consolidado es una línea de texto, nunca una tarjeta. Y solo
            existe si hay una tasa cargada: el producto no se inventa un tipo
            de cambio, porque una conversión sin fuente no es un dato.
          */}
          {monedasDeCaja.length > 1 && (
            <p className="max-w-prose text-xs text-subtle">
              {tasa.data ? (
                <>
                  Las dos cifras no se suman: son dos contabilidades. Si necesitas una sola para
                  mirarla de lejos, el tipo de cambio cargado es{' '}
                  <span className="num">{Number(tasa.data.rate).toFixed(4)}</span>{' '}
                  {tasa.data.from_code}→{tasa.data.to_code}, de {formatoFecha(tasa.data.as_of)} (
                  {tasa.data.source}).
                </>
              ) : (
                <>
                  Las dos cifras no se suman: son dos contabilidades. Para un consolidado
                  referencial hace falta cargar un tipo de cambio con su fecha y su fuente, en
                  Configuración → Tipo de cambio. El sistema no se lo inventa.
                </>
              )}
            </p>
          )}
        </section>
      )}

      {/* ---------------------------------------------------- por cobrar */}
      {!cargando && (
        <section className="flex flex-col gap-3">
          <h2 className="text-xs uppercase tracking-widest text-subtle">Por cobrar</h2>
          <Tarjeta className="p-5">
            {porCobrar.length === 0 ? (
              <p className="max-w-prose text-sm text-muted">
                Nada emitido pendiente de cobro. Una cuota pactada en un cronograma no cuenta aquí:
                se te debe cuando hay documento.
              </p>
            ) : (
              <div className="flex flex-wrap gap-8">
                {porCobrar.map((f) => (
                  <div key={f.moneda}>
                    <p className="num text-2xl font-semibold tracking-tight">{format(f.total)}</p>
                    <p className="mt-1 text-sm text-muted">
                      {f.cuantos} {f.cuantos === 1 ? 'documento' : 'documentos'}
                      {porCobrar.length > 1 ? ` · ${f.moneda}` : ''}
                    </p>
                  </div>
                ))}
              </div>
            )}
            {vencidos.length > 0 && (
              <p className="mt-4 text-sm text-warning">
                {vencidos.length === 1
                  ? '1 documento vencido'
                  : `${vencidos.length} documentos vencidos`}
                , el más atrasado por {Math.max(...vencidos.map((d) => diasDeAtraso(d.doc, hoy)))}{' '}
                días.
              </p>
            )}
            <p className="mt-4 max-w-prose text-xs text-subtle">
              «Por pagar» llega con los proveedores: hoy la cartera solo tiene ventas, porque un
              documento de compra necesita a quién se le debe.
            </p>
          </Tarjeta>
        </section>
      )}

      {/* ----------------------------------------------- trece semanas */}
      {!cargando && monedasProyectadas.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-xs uppercase tracking-widest text-subtle">
            Lo que esperas cobrar · trece semanas
          </h2>
          {monedasProyectadas.map((moneda) => {
            const semanas = proyeccion(esperadas, moneda, hoy);
            const mayor = semanas.reduce((n, s) => (s.entra.minor > n ? s.entra.minor : n), 0n);
            const total = semanas.reduce(
              (acc, s) => ({ minor: acc.minor + s.entra.minor, currency: moneda }),
              { minor: 0n, currency: moneda } as Money,
            );
            return (
              <Tarjeta key={moneda} className="p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-medium">{moneda}</p>
                  <p className="num text-sm text-muted">{format(total)} en total</p>
                </div>
                <ul className="mt-4 flex items-end gap-1 overflow-x-auto pb-1">
                  {semanas.map((s) => {
                    const alto =
                      mayor === 0n ? 0 : Number((s.entra.minor * 100n) / mayor);
                    return (
                      <li key={s.desde} className="flex min-w-[2.2rem] flex-1 flex-col items-center gap-1">
                        <span className="num text-[0.6rem] text-subtle">
                          {s.entra.minor === 0n ? '' : format(s.entra).replace(/^[^\d-]+\s*/, '')}
                        </span>
                        <div
                          className={`w-full rounded-control ${s.atrasado.minor > 0n ? 'bg-warning' : 'bg-accent'}`}
                          style={{ height: `${Math.max(alto, s.entra.minor > 0n ? 4 : 1)}px` }}
                          aria-hidden
                        />
                        <span className="num text-[0.6rem] text-subtle">
                          {s.desde.slice(8, 10)}/{s.desde.slice(5, 7)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                {/* El gráfico es refuerzo; la tabla es el dato. Un lector de
                    pantalla y alguien que no distingue los colores leen esto. */}
                <ul className="mt-3 flex flex-col gap-1 border-t border-border pt-3 text-sm">
                  {semanas
                    .filter((s) => s.entra.minor > 0n)
                    .map((s) => (
                      <li key={s.desde} className="flex items-baseline justify-between gap-3">
                        <span className="text-muted">
                          Semana del {formatoFecha(s.desde)}
                          {s.atrasado.minor > 0n && (
                            <>
                              {' '}
                              <Etiqueta tono="atencion">
                                incluye {format(s.atrasado)} ya vencido
                              </Etiqueta>
                            </>
                          )}
                        </span>
                        <span className="num shrink-0">{format(s.entra)}</span>
                      </li>
                    ))}
                </ul>
                <p className="mt-3 max-w-prose text-xs text-subtle">
                  Solo entradas. Los pagos que salen llegan con los gastos recurrentes y las
                  compras, así que esta cifra es optimista por construcción: sirve para ver cuándo
                  entra el dinero, no para saber si sobra.
                </p>
              </Tarjeta>
            );
          })}
        </section>
      )}

      {/* ------------------------------------------------------ acciones */}
      {!cargando && acciones.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-xs uppercase tracking-widest text-subtle">Acciones próximas</h2>
          <ul className="flex flex-col gap-2">
            {acciones.map((a) => (
              <li key={a.clave}>
                <Tarjeta className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="flex min-w-0 items-center gap-2">
                    <Etiqueta tono={a.tono}>{a.tono === 'atencion' ? 'Atrasado' : 'Pronto'}</Etiqueta>
                    <span className="min-w-0 text-sm">{a.texto}</span>
                  </div>
                  <Link to={a.ruta}>
                    <Boton variante={a.tono === 'atencion' ? 'primario' : 'secundario'}>
                      {a.boton}
                    </Boton>
                  </Link>
                </Tarjeta>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* -------------------------------------------------- puesta en marcha */}
      {faltan.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-xs uppercase tracking-widest text-subtle">Falta configurar</h2>
          <ul className="flex flex-col gap-2">
            {faltan.map((paso) => (
              <li key={paso.ruta}>
                <Tarjeta className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-medium">{paso.nombre}</h3>
                      <Etiqueta tono="atencion">Sin configurar</Etiqueta>
                    </div>
                    <p className="mt-1 max-w-prose text-sm text-muted">{paso.porque}</p>
                  </div>
                  <Link to={paso.ruta}>
                    <Boton variante="primario">Configurar</Boton>
                  </Link>
                </Tarjeta>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
