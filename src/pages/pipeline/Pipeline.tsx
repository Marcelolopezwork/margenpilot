import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { puedeVerCostos, useOrg, useOrgElegida } from '../../app/org-context';
import { mensajeDeError } from '../../lib/errors';
import { formatoFecha } from '../../lib/format';
import { currencyOf, format, fromRow, marginPercent } from '../../lib/money';
import { requireSupabase } from '../../lib/supabase';
import { Aviso, Boton, Campo, Cargando, Etiqueta, Selector, Tarjeta, Vacio } from '../../components/ui';
import { FiltradoPor, Seccion } from '../../components/piezas';
import { useRecargar } from '../../components/recargar';
import { ESTADOS, SIGUIENTES, TONOS } from '../comercial/estados';
import type { Estado } from '../comercial/estados';
import {
  CERRADAS,
  COLUMNAS,
  PARA_QUE,
  diasQuieta,
  enColumna,
  enJuego,
  estaQuieta,
  valorPorMoneda,
  vencidaSinMarcar,
  type TarjetaPipeline,
} from './tablero';

/**
 * El tablero de cotizaciones.
 *
 * Lo que añade sobre el listado de Comercial no es información —ahí está toda—
 * sino dos cosas que una lista no puede dar: verlas todas a la vez repartidas
 * por estado, y moverlas de columna sin abrirlas.
 *
 * Y una tercera que es la que de verdad justifica la pantalla: **señalar lo
 * que no se ha movido**. Una cotización enviada hace tres semanas sin
 * respuesta no sale en ninguna lista ordenada por fecha; aquí sale, porque el
 * tablero sabe cuándo fue el último movimiento de cada una.
 *
 * Mover una tarjeta no es arrastrarla. Es un desplegable y un botón, por dos
 * razones: aprobar una cotización **crea el cronograma de cobro**, así que no
 * puede pasar por soltar el dedo en el sitio equivocado; y arrastrar no
 * funciona con teclado ni con lector de pantalla.
 */
export default function Pipeline() {
  const { organizacion, entidad } = useOrgElegida();
  const { elegirEntidad } = useOrg();
  const recargar = useRecargar(['pipeline', 'cotizaciones']);
  const conCostos = puedeVerCostos(organizacion.rol);
  const hoy = new Date().toISOString().slice(0, 10);

  const [verCerradas, setVerCerradas] = useState(false);
  const [moviendo, setMoviendo] = useState<Record<string, Estado | ''>>({});
  const [motivo, setMotivo] = useState('');

  const consulta = useQuery({
    queryKey: ['pipeline', organizacion.id, entidad?.id ?? null, conCostos],
    queryFn: async (): Promise<TarjetaPipeline[]> => {
      const cliente = requireSupabase();

      let q = cliente
        .from('quotes')
        .select('id, number, status, currency_code, valid_until, created_at, client_id, legal_entity_id')
        .eq('organization_id', organizacion.id)
        .order('created_at', { ascending: false });
      if (entidad) q = q.eq('legal_entity_id', entidad.id);
      const { data: cotizaciones, error } = await q;
      if (error) throw error;
      if (!cotizaciones || cotizaciones.length === 0) return [];

      const ids = cotizaciones.map((c) => c.id);

      const { data: clientes, error: e2 } = await cliente
        .from('clients')
        .select('id, name')
        .eq('organization_id', organizacion.id);
      if (e2) throw e2;
      const nombre = new Map((clientes ?? []).map((c) => [c.id, c.name]));

      // La cifra que importa es la de la última versión emitida: la que el
      // cliente tiene en la mano. Las anteriores son historia.
      const { data: versiones, error: e3 } = await cliente
        .from('quote_versions')
        .select('id, quote_id, version_no, totals')
        .in('quote_id', ids);
      if (e3) throw e3;

      const ultima = new Map<string, { id: string; version_no: number; totals: unknown }>();
      for (const v of versiones ?? []) {
        const previa = ultima.get(v.quote_id);
        if (!previa || v.version_no > previa.version_no) {
          ultima.set(v.quote_id, { id: v.id, version_no: v.version_no, totals: v.totals });
        }
      }

      // El costo vive en su propia tabla y un rol comercial no la lee
      // (ADR-34). Se pide aparte y solo si se puede: con un join, la consulta
      // entera devolvería cero filas y el tablero parecería vacío.
      const costos = new Map<string, string>();
      if (conCostos && ultima.size > 0) {
        const { data, error: e4 } = await cliente
          .from('quote_version_costs')
          .select('quote_version_id, cost')
          .in('quote_version_id', [...ultima.values()].map((v) => v.id));
        if (e4) throw e4;
        for (const c of data ?? []) costos.set(c.quote_version_id, String(c.cost));
      }

      // El último movimiento sale de la bitácora. Sin ella, la fecha de
      // creación: una cotización que nunca se movió lleva quieta desde que
      // nació, y eso es exactamente lo que hay que poder ver.
      const { data: eventos, error: e5 } = await cliente
        .from('quote_events')
        .select('quote_id, at')
        .in('quote_id', ids)
        .order('at', { ascending: false });
      if (e5) throw e5;
      const movido = new Map<string, string>();
      for (const ev of eventos ?? []) {
        if (!movido.has(ev.quote_id)) movido.set(ev.quote_id, ev.at);
      }

      return cotizaciones.map((c) => {
        const v = ultima.get(c.id);
        const totales = (v?.totals ?? null) as Record<string, unknown> | null;
        const neto = typeof totales?.['neto'] === 'string' ? (totales['neto'] as string) : null;
        const costo = v ? costos.get(v.id) : undefined;

        let margen: number | null = null;
        if (neto !== null && costo !== undefined) {
          try {
            const moneda = currencyOf(c.currency_code);
            margen = marginPercent(fromRow(neto, moneda), fromRow(costo, moneda));
          } catch {
            margen = null;
          }
        }

        return {
          id: c.id,
          number: c.number,
          status: c.status,
          currency_code: c.currency_code,
          valid_until: c.valid_until,
          cliente: nombre.get(c.client_id) ?? 'Cliente que ya no existe',
          neto,
          margen,
          ultimoMovimiento: movido.get(c.id) ?? c.created_at,
        };
      });
    },
  });

  const mover = useMutation({
    mutationFn: async ({ id, a }: { id: string; a: Estado }) => {
      const { error } = await requireSupabase().rpc('cambiar_estado_cotizacion', {
        p_quote: id,
        p_to: a,
        ...(motivo.trim() ? { p_note: motivo.trim() } : {}),
      });
      if (error) throw error;
    },
    onSuccess: (_d, { id }) => {
      setMoviendo((antes) => ({ ...antes, [id]: '' }));
      setMotivo('');
      recargar();
    },
  });

  const tarjetas = consulta.data ?? [];
  const jugando = enJuego(tarjetas);
  const valores = valorPorMoneda(jugando);
  const quietas = tarjetas.filter((t) => estaQuieta(t, hoy));
  const vencidas = tarjetas.filter((t) => vencidaSinMarcar(t, hoy));
  const columnas: readonly Estado[] = verCerradas ? [...COLUMNAS, ...CERRADAS] : COLUMNAS;

  return (
    <Seccion
      titulo="Pipeline"
      regla="El tablero es lo que está en juego: cotizaciones enviadas y en negociación. Un borrador no ha salido y una aprobada ya está ganada, así que ninguna de las dos entra en la cifra de arriba. La cifra es el neto de la última versión emitida, que es la que el cliente tiene en la mano."
    >
      <FiltradoPor entidad={entidad?.legal_name ?? null} alQuitar={() => elegirEntidad(null)} />

      {valores.length > 0 && (
        <Tarjeta className="p-5">
          <p className="text-sm text-muted">Lo que está en juego</p>
          <div className="mt-2 flex flex-wrap gap-8">
            {valores.map((v) => (
              <div key={v.moneda}>
                <p className="num text-2xl font-semibold tracking-tight">{format(v.total)}</p>
                <p className="mt-1 text-sm text-muted">
                  {v.cuantas} {v.cuantas === 1 ? 'cotización' : 'cotizaciones'}
                  {valores.length > 1 ? ` · ${v.moneda}` : ''}
                </p>
              </div>
            ))}
          </div>
          <p className="mt-3 max-w-prose text-xs text-subtle">
            Sin los borradores, que el cliente no ha visto, y sin las aprobadas, que ya no están
            en juego: esas se facturan y se cobran, y viven en Finanzas → Caja.
          </p>
        </Tarjeta>
      )}

      {(quietas.length > 0 || vencidas.length > 0) && (
        <Aviso tipo="atencion">
          {quietas.length > 0 && (
            <>
              {quietas.length === 1
                ? '1 cotización lleva más de dos semanas sin moverse'
                : `${quietas.length} cotizaciones llevan más de dos semanas sin moverse`}
              {vencidas.length > 0 ? '; ' : '. '}
            </>
          )}
          {vencidas.length > 0 && (
            <>
              {vencidas.length === 1
                ? '1 pasó su plazo y sigue abierta'
                : `${vencidas.length} pasaron su plazo y siguen abiertas`}
              .{' '}
            </>
          )}
          Ninguna de las dos cosas la decide el sistema: «vencida» es una decisión tuya, y el
          tablero solo deja de disimularlo.
        </Aviso>
      )}

      {consulta.isPending && <Cargando que="el tablero" />}
      {consulta.error && <Aviso tipo="error">{mensajeDeError(consulta.error)}</Aviso>}
      {mover.error && <Aviso tipo="error">{mensajeDeError(mover.error)}</Aviso>}

      {consulta.data?.length === 0 && (
        <Vacio
          titulo="Todavía no hay ninguna cotización"
          explicacion="El tablero reparte por estado lo que existe. Sin cotizaciones no hay nada que repartir."
          siguiente="Crea la primera en Comercial; en cuanto la emitas aparecerá aquí, en la columna «Enviada»."
          accion={
            <Link to="/comercial/cotizaciones">
              <Boton variante="primario">Ir a Comercial</Boton>
            </Link>
          }
        />
      )}

      {tarjetas.length > 0 && (
        <>
          <label className="flex items-center gap-2 text-sm text-muted">
            <input
              type="checkbox"
              checked={verCerradas}
              onChange={(e) => setVerCerradas(e.target.checked)}
              className="size-4"
            />
            Ver también las cerradas (rechazadas, vencidas y anuladas)
          </label>

          <div className="-mx-4 overflow-x-auto px-4 pb-2">
            <div className="flex gap-4" style={{ minWidth: `${columnas.length * 17}rem` }}>
              {columnas.map((estado) => {
                const deLaColumna = enColumna(tarjetas, estado);
                const suyos = valorPorMoneda(deLaColumna);
                return (
                  <section key={estado} className="flex w-[17rem] shrink-0 flex-col gap-3">
                    <header>
                      <h2 className="flex items-center gap-2 font-medium">
                        {ESTADOS[estado]}
                        <span className="text-sm text-muted">{deLaColumna.length}</span>
                      </h2>
                      {suyos.map((v) => (
                        <p key={v.moneda} className="num mt-1 text-sm text-muted">
                          {format(v.total, { showCode: suyos.length > 1 })}
                          {v.sinEmitir > 0 && (
                            <span className="text-subtle"> · {v.sinEmitir} sin emitir</span>
                          )}
                        </p>
                      ))}
                      <p className="mt-1 text-xs text-subtle">{PARA_QUE[estado]}</p>
                    </header>

                    {deLaColumna.map((t) => {
                      const dias = diasQuieta(t, hoy);
                      const quieta = estaQuieta(t, hoy);
                      const caducada = vencidaSinMarcar(t, hoy);
                      const posibles = SIGUIENTES[t.status];
                      const elegido = moviendo[t.id] ?? '';
                      return (
                        <Tarjeta key={t.id} className="flex flex-col gap-2 p-4">
                          <div className="flex items-start justify-between gap-2">
                            <Link to={`/comercial/cotizaciones/${t.id}`} className="font-medium underline">
                              {t.number}
                            </Link>
                            <Etiqueta tono={TONOS[t.status]}>{ESTADOS[t.status]}</Etiqueta>
                          </div>
                          <p className="text-sm text-muted">{t.cliente}</p>
                          <p className="num text-sm">
                            {t.neto === null ? (
                              <span className="text-subtle">Sin emitir: no hay cifra todavía</span>
                            ) : (
                              <>
                                {format(fromRow(t.neto, currencyOf(t.currency_code)))}
                                {t.margen !== null && (
                                  <span className="text-muted"> · margen {t.margen.toFixed(1)} %</span>
                                )}
                              </>
                            )}
                          </p>
                          <p className="text-xs text-subtle">
                            {dias === 0
                              ? 'Se movió hoy'
                              : `Quieta ${dias} ${dias === 1 ? 'día' : 'días'}`}
                            {t.valid_until ? ` · plazo ${formatoFecha(t.valid_until)}` : ''}
                          </p>
                          {(quieta || caducada) && (
                            <p className="text-xs text-warning">
                              {caducada
                                ? 'Su plazo ya pasó y sigue abierta.'
                                : 'Nadie la ha tocado en más de dos semanas.'}
                            </p>
                          )}

                          {posibles.length > 0 && (
                            <>
                              <Selector
                                etiqueta={`Mover ${t.number} a`}
                                value={elegido}
                                onChange={(e) =>
                                  setMoviendo((antes) => ({
                                    ...antes,
                                    [t.id]: e.target.value as Estado | '',
                                  }))
                                }
                              >
                                <option value="">Dejarla donde está</option>
                                {posibles.map((p) => (
                                  <option key={p} value={p}>
                                    {ESTADOS[p]}
                                  </option>
                                ))}
                              </Selector>

                              {elegido === 'void' && (
                                <Campo
                                  etiqueta={`Por qué se anula ${t.number}`}
                                  ayuda="Queda escrito en la bitácora y no se borra."
                                  value={motivo}
                                  onChange={(e) => setMotivo(e.target.value)}
                                />
                              )}

                              {elegido === 'approved' && (
                                <p className="text-xs text-subtle">
                                  Aprobarla crea el cronograma de cobro de la versión aceptada. Se
                                  ajusta al abrir la cotización.
                                </p>
                              )}

                              {elegido !== '' && (
                                <div>
                                  <Boton
                                    variante="primario"
                                    disabled={mover.isPending || (elegido === 'void' && motivo.trim() === '')}
                                    onClick={() => mover.mutate({ id: t.id, a: elegido })}
                                  >
                                    {mover.isPending ? 'Moviendo…' : `Mover a ${ESTADOS[elegido]}`}
                                  </Boton>
                                </div>
                              )}
                            </>
                          )}
                        </Tarjeta>
                      );
                    })}
                  </section>
                );
              })}
            </div>
          </div>

          <p className="max-w-prose text-xs text-subtle">
            A «Enviada» no se llega moviendo una tarjeta: se llega emitiendo, que es lo que produce
            el documento que recibe el cliente. Por eso el borrador solo ofrece anularse; para que
            salga, hay que abrirla y emitirla.
          </p>
        </>
      )}
    </Seccion>
  );
}
