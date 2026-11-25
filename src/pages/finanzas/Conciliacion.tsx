import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { puedeEscribirDinero, useOrg, useOrgElegida } from '../../app/org-context';
import { mensajeDeError } from '../../lib/errors';
import { formatoFecha } from '../../lib/format';
import { currencyOf, format, fromRow } from '../../lib/money';
import { requireSupabase } from '../../lib/supabase';
import { Aviso, Boton, Campo, Cargando, Etiqueta, Selector, Tarjeta, Vacio } from '../../components/ui';
import { Alta, FiltradoPor, Fila, Lista, Seccion } from '../../components/piezas';
import { useRecargar } from '../../components/recargar';
import type { Json } from '../../types/database';
import {
  aLineas,
  adivinarMapeo,
  proponer,
  separarCsv,
  valoresDe,
  type LineaDelBanco,
  type Mapeo,
  type MovimientoDelLibro,
} from './extracto';

/**
 * Conciliar: cruzar lo que tú anotaste con lo que el banco dice que pasó.
 *
 * La regla que gobierna la pantalla entera es INV-8: **conciliar no crea
 * dinero.** Aquí no se puede anotar un movimiento, ni corregirlo, ni
 * borrarlo. Lo único que se escribe es «esta línea del banco es este
 * movimiento mío». Si desde aquí se pudiera arreglar el libro, el libro
 * siempre cuadraría con el banco y la comprobación no comprobaría nada.
 *
 * De ahí sale la forma de la pantalla: tres montones. Lo que cuadra, lo que
 * sobra del banco y lo que sobra del libro. El tercero es el que casi nunca
 * se mira y el que más dice: un cobro que diste por hecho y no llegó.
 */

type Paso = 'elegir' | 'mapear';

export default function Conciliacion() {
  const { organizacion, entidad } = useOrgElegida();
  const { entidades, elegirEntidad } = useOrg();
  const conDinero = puedeEscribirDinero(organizacion.rol);
  const recargar = useRecargar(['conciliacion', 'movimientos', 'saldos']);

  const [cuentaId, setCuentaId] = useState('');
  const [paso, setPaso] = useState<Paso>('elegir');
  const [texto, setTexto] = useState('');
  const [etiqueta, setEtiqueta] = useState('');
  const [mapeo, setMapeo] = useState<Mapeo | null>(null);
  const [exito, setExito] = useState<string | null>(null);
  const [apartando, setApartando] = useState<string | null>(null);
  const [motivo, setMotivo] = useState('');
  const [aMano, setAMano] = useState<{ linea: string; movimiento: string } | null>(null);

  const cuentas = useQuery({
    queryKey: ['cuentas', organizacion.id, 'para-conciliar'],
    enabled: conDinero,
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('cash_accounts')
        .select('id, name, currency_code, legal_entity_id, bank_name')
        .eq('organization_id', organizacion.id)
        .eq('is_active', true)
        .eq('kind', 'bank')
        .order('sort');
      if (error) throw error;
      return data ?? [];
    },
  });

  const datos = useQuery({
    queryKey: ['conciliacion', organizacion.id, cuentaId],
    enabled: conDinero && cuentaId !== '',
    queryFn: async () => {
      const cliente = requireSupabase();

      const { data: extractos, error } = await cliente
        .from('bank_statements')
        .select('id, label, desde, hasta, lineas, imported_at')
        .eq('organization_id', organizacion.id)
        .eq('cash_account_id', cuentaId)
        .order('hasta', { ascending: false });
      if (error) throw error;

      const { data: lineas, error: e2 } = await cliente
        .from('bank_statement_lines')
        .select(
          'id, statement_id, fila, value_date, direction, amount, description, external_ref, currency_code, ignored_reason',
        )
        .eq('organization_id', organizacion.id)
        .eq('cash_account_id', cuentaId)
        .order('value_date');
      if (e2) throw e2;

      const { data: estados, error: e3 } = await cliente
        .from('bank_line_status')
        .select('line_id, emparejados, conciliado, cuadra')
        .eq('organization_id', organizacion.id)
        .eq('cash_account_id', cuentaId);
      if (e3) throw e3;

      const { data: emparejados, error: e4 } = await cliente
        .from('bank_line_matches')
        .select('id, statement_line_id, cash_movement_id')
        .eq('organization_id', organizacion.id)
        .eq('cash_account_id', cuentaId);
      if (e4) throw e4;

      // Los movimientos del rango que cubren los extractos, que son los
      // únicos que pueden corresponder a una línea.
      const desde = (extractos ?? []).reduce<string | null>(
        (a, e) => (a === null || e.desde < a ? e.desde : a),
        null,
      );
      const hasta = (extractos ?? []).reduce<string | null>(
        (a, e) => (a === null || e.hasta > a ? e.hasta : a),
        null,
      );

      let movimientos: MovimientoDelLibro[] = [];
      if (desde && hasta) {
        const { data: movs, error: e5 } = await cliente
          .from('cash_movements')
          .select('id, value_date, direction, amount, description, external_ref, currency_code, kind')
          .eq('organization_id', organizacion.id)
          .eq('cash_account_id', cuentaId)
          .eq('is_void', false)
          // Una semana de margen a cada lado: un cobro del 30 puede aparecer
          // en el extracto del 2.
          .gte('value_date', desplazar(desde, -7))
          .lte('value_date', desplazar(hasta, 7))
          .order('value_date');
        if (e5) throw e5;
        movimientos = (movs ?? []) as unknown as MovimientoDelLibro[];
      }

      return {
        extractos: extractos ?? [],
        lineas: (lineas ?? []) as unknown as (LineaDelBanco & {
          statement_id: string;
          fila: number;
          ignored_reason: string | null;
        })[],
        estados: new Map(
          (estados ?? []).map((e) => [e.line_id ?? '', { cuadra: e.cuadra ?? false, emparejados: e.emparejados ?? 0 }]),
        ),
        emparejados: emparejados ?? [],
        movimientos,
      };
    },
  });

  const importar = useMutation({
    onMutate: () => setExito(null),
    mutationFn: async () => {
      if (!mapeo) throw new Error('sin_mapeo: falta decir qué columna es cuál');
      const { lineas } = aLineas(separarCsv(texto), mapeo);
      const { error } = await requireSupabase().rpc('importar_extracto', {
        p_account: cuentaId,
        p_label: etiqueta.trim(),
        // `LineaImportable` es JSON por construcción —texto, texto y un
        // objeto de textos— pero TypeScript no lo sabe sin una firma de
        // índice, y añadírsela haría que cualquier campo colara.
        p_lines: lineas as unknown as Json,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setExito(
        `Extracto importado. No se movió ni un céntimo del saldo: lo único que hay ahora es la lista del banco al lado de la tuya.`,
      );
      setTexto('');
      setEtiqueta('');
      setMapeo(null);
      setPaso('elegir');
      recargar();
    },
  });

  const emparejar = useMutation({
    mutationFn: async ({ linea, movimiento }: { linea: string; movimiento: string }) => {
      const { error } = await requireSupabase().rpc('emparejar_linea', {
        p_line: linea,
        p_movement: movimiento,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setAMano(null);
      recargar();
    },
  });

  const desemparejar = useMutation({
    mutationFn: async (match: string) => {
      const { error } = await requireSupabase().rpc('desemparejar_linea', { p_match: match });
      if (error) throw error;
    },
    onSuccess: () => recargar(),
  });

  const apartar = useMutation({
    mutationFn: async ({ linea, texto: razon }: { linea: string; texto: string | null }) => {
      const { error } = await requireSupabase().rpc('ignorar_linea', {
        p_line: linea,
        ...(razon ? { p_motivo: razon } : {}),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setApartando(null);
      setMotivo('');
      recargar();
    },
  });

  const lineas = datos.data?.lineas ?? [];
  const estados = datos.data?.estados ?? new Map();
  // Memorizadas porque de ellas cuelga la propuesta, y recalcularla en cada
  // tecla del textarea de importar no tendría ningún sentido.
  const movimientos = useMemo(() => datos.data?.movimientos ?? [], [datos.data]);
  const matches = useMemo(() => datos.data?.emparejados ?? [], [datos.data]);

  const yaConciliados = useMemo(
    () => new Set(matches.map((m) => m.cash_movement_id)),
    [matches],
  );

  const cuadradas = lineas.filter((l) => estados.get(l.id)?.cuadra);
  const apartadas = lineas.filter((l) => l.ignored_reason !== null);
  const pendientes = lineas.filter(
    (l) => !estados.get(l.id)?.cuadra && l.ignored_reason === null,
  );
  const sueltos = movimientos.filter((m) => !yaConciliados.has(m.id));

  const propuestas = useMemo(
    () => proponer(pendientes, movimientos, yaConciliados),
    [pendientes, movimientos, yaConciliados],
  );
  const propuestaDe = (linea: string) => propuestas.find((p) => p.lineaId === linea);
  const movimientoDe = (id: string) => movimientos.find((m) => m.id === id);

  if (!conDinero) {
    return (
      <Seccion
        titulo="Conciliación"
        regla="Cruzar lo que anotaste con lo que el banco dice que pasó."
      >
        <Vacio
          titulo="Esta sección es de finanzas"
          explicacion="Tu rol en esta organización es comercial. El libro de caja y los extractos no te los enseña la base de datos."
          siguiente="Las cotizaciones sí son tuyas: están en Comercial."
        />
      </Seccion>
    );
  }

  const cuenta = (cuentas.data ?? []).find((c) => c.id === cuentaId);
  const moneda = cuenta ? currencyOf(cuenta.currency_code) : null;
  const importe = (valor: string | number) =>
    moneda ? format(fromRow(valor, moneda)) : String(valor);

  return (
    <Seccion
      titulo="Conciliación"
      regla="El sistema sabe lo que anotaste; el banco sabe lo que pasó. Conciliar es cruzar las dos listas y dejar por escrito qué línea es qué movimiento. No mueve dinero: desde aquí no se puede anotar, corregir ni borrar un movimiento, porque entonces el libro siempre cuadraría consigo mismo y la comprobación no comprobaría nada."
    >
      <FiltradoPor entidad={entidad?.legal_name ?? null} alQuitar={() => elegirEntidad(null)} />

      <Selector
        etiqueta="Qué cuenta"
        ayuda="Solo las cuentas de banco: la caja chica no tiene extracto."
        value={cuentaId}
        onChange={(e) => {
          setCuentaId(e.target.value);
          setPaso('elegir');
          setTexto('');
          setMapeo(null);
        }}
      >
        <option value="">Elige una cuenta</option>
        {(cuentas.data ?? [])
          .filter((c) => !entidad || c.legal_entity_id === entidad.id)
          .map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} · {c.currency_code}
              {entidades.length > 1
                ? ` · ${entidades.find((x) => x.id === c.legal_entity_id)?.legal_name ?? ''}`
                : ''}
            </option>
          ))}
      </Selector>

      {cuentaId === '' && (
        <Vacio
          titulo="Elige una cuenta para empezar"
          explicacion="Cada cuenta tiene su propio extracto y su propia conciliación. Cruzar el extracto del BCP con los movimientos de Mercury no significaría nada, y la base lo impide."
          siguiente="Arriba, elige la cuenta cuyo extracto vas a importar."
        />
      )}

      {datos.isPending && cuentaId !== '' && <Cargando que="la conciliación" />}
      {datos.error && <Aviso tipo="error">{mensajeDeError(datos.error)}</Aviso>}
      {emparejar.error && <Aviso tipo="error">{mensajeDeError(emparejar.error)}</Aviso>}
      {desemparejar.error && <Aviso tipo="error">{mensajeDeError(desemparejar.error)}</Aviso>}
      {apartar.error && <Aviso tipo="error">{mensajeDeError(apartar.error)}</Aviso>}

      {/* ------------------------------------------------- los tres montones */}
      {cuentaId !== '' && lineas.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Tarjeta className="p-4">
            <p className="text-sm text-muted">Cuadra</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{cuadradas.length}</p>
            <p className="mt-1 text-xs text-subtle">líneas con su movimiento</p>
          </Tarjeta>
          <Tarjeta className="p-4">
            <p className="text-sm text-muted">Sobra del banco</p>
            <p
              className={`mt-1 text-2xl font-semibold tabular-nums ${
                pendientes.length > 0 ? 'text-warning' : ''
              }`}
            >
              {pendientes.length}
            </p>
            <p className="mt-1 text-xs text-subtle">líneas sin movimiento tuyo</p>
          </Tarjeta>
          <Tarjeta className="p-4">
            <p className="text-sm text-muted">Sobra del libro</p>
            <p
              className={`mt-1 text-2xl font-semibold tabular-nums ${
                sueltos.length > 0 ? 'text-warning' : ''
              }`}
            >
              {sueltos.length}
            </p>
            <p className="mt-1 text-xs text-subtle">movimientos sin línea del banco</p>
          </Tarjeta>
        </div>
      )}

      {/* ------------------------------------------------ sobra del banco */}
      {pendientes.length > 0 && (
        <Tarjeta className="p-5">
          <h2 className="font-medium">Sobra del banco</h2>
          <p className="mb-4 mt-2 max-w-prose text-sm text-muted">
            Líneas del extracto que todavía no son ningún movimiento tuyo. Casi siempre son gastos
            que no anotaste: comisiones, cargos, una domiciliación. Cuando una no es tuya —o la
            dejas para después— se aparta con el motivo escrito y sale de aquí sin borrarse.
          </p>
          <Lista>
            {pendientes.map((l) => {
              const p = propuestaDe(l.id);
              const sugerido = p ? movimientoDe(p.movimientoId) : undefined;
              return (
                <Fila
                  key={l.id}
                  principal={
                    <>
                      <span className="font-medium">{l.description}</span>
                      <Etiqueta tono={l.direction === 'in' ? 'positivo' : 'neutro'}>
                        {l.direction === 'in' ? 'entró' : 'salió'}
                      </Etiqueta>
                      {estados.get(l.id)?.emparejados ? (
                        <Etiqueta tono="atencion">emparejada a medias</Etiqueta>
                      ) : null}
                    </>
                  }
                  secundario={
                    <>
                      {formatoFecha(l.value_date)} · {importe(l.amount)}
                      {l.external_ref ? ` · ${l.external_ref}` : ''}
                      {sugerido && p && (
                        <>
                          <br />
                          <span className="text-text">
                            Parece «{sugerido.description}» del {formatoFecha(sugerido.value_date)}
                          </span>
                          <span className="text-muted"> · {p.porque}</span>
                        </>
                      )}
                    </>
                  }
                  extremo={
                    <>
                      {sugerido && p && (
                        <Boton
                          variante="primario"
                          disabled={emparejar.isPending}
                          onClick={() =>
                            emparejar.mutate({ linea: l.id, movimiento: p.movimientoId })
                          }
                        >
                          {p.confianza === 'exacta' ? 'Es ese' : 'Sí, es ese'}
                        </Boton>
                      )}
                      <Boton onClick={() => setAMano({ linea: l.id, movimiento: '' })}>
                        Elegir yo
                      </Boton>
                      <Boton
                        variante="sutil"
                        onClick={() => {
                          setApartando(l.id);
                          setMotivo('');
                        }}
                      >
                        Apartar
                      </Boton>
                    </>
                  }
                />
              );
            })}
          </Lista>
        </Tarjeta>
      )}

      {/* ------------------------------------- elegir el movimiento a mano */}
      {aMano &&
        (() => {
          const linea = lineas.find((l) => l.id === aMano.linea);
          if (!linea) return null;
          const posibles = movimientos.filter(
            (m) => !yaConciliados.has(m.id) && m.direction === linea.direction,
          );
          return (
            <Alta
              titulo={`Qué movimiento es «${linea.description}»`}
              onSubmit={() =>
                emparejar.mutate({ linea: aMano.linea, movimiento: aMano.movimiento })
              }
            >
              {posibles.length === 0 ? (
                <Aviso tipo="info">
                  No hay ningún movimiento sin conciliar en ese sentido dentro de las fechas del
                  extracto. Si el gasto existe pero no está anotado, anótalo en Caja y vuelve:
                  desde aquí no se puede, porque conciliar no crea dinero.
                </Aviso>
              ) : (
                <>
                  <Selector
                    etiqueta="Movimiento"
                    ayuda="Solo los del mismo sentido y sin conciliar. Lo demás la base lo rechazaría."
                    value={aMano.movimiento}
                    onChange={(e) => setAMano({ ...aMano, movimiento: e.target.value })}
                    required
                  >
                    <option value="">Elige uno</option>
                    {posibles.map((m) => (
                      <option key={m.id} value={m.id}>
                        {formatoFecha(m.value_date)} · {importe(m.amount)} · {m.description}
                      </option>
                    ))}
                  </Selector>
                  <div className="flex gap-2">
                    <Boton variante="primario" type="submit" disabled={emparejar.isPending}>
                      Emparejar
                    </Boton>
                    <Boton onClick={() => setAMano(null)}>Cancelar</Boton>
                  </div>
                </>
              )}
            </Alta>
          );
        })()}

      {apartando && (
        <Alta
          titulo="Apartar esta línea"
          onSubmit={() => apartar.mutate({ linea: apartando, texto: motivo.trim() })}
        >
          <Aviso tipo="info">
            No se borra: se queda con el motivo escrito y sale de la lista de pendientes. Dentro
            de tres meses, «por qué esta línea no está conciliada» tiene respuesta.
          </Aviso>
          <Campo
            etiqueta="Por qué se aparta"
            ayuda="Por ejemplo: «es la comisión de diciembre, la anoto el mes que viene»."
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            required
          />
          <div className="flex gap-2">
            <Boton variante="primario" type="submit" disabled={apartar.isPending}>
              Apartarla
            </Boton>
            <Boton onClick={() => setApartando(null)}>Cancelar</Boton>
          </div>
        </Alta>
      )}

      {/* ------------------------------------------------- sobra del libro */}
      {sueltos.length > 0 && (
        <Tarjeta className="p-5">
          <h2 className="font-medium">Sobra del libro</h2>
          <p className="mb-4 mt-2 max-w-prose text-sm text-muted">
            Movimientos tuyos que el banco no tiene en el periodo del extracto. Este es el montón
            que casi nadie mira y el que más dice: un cobro que diste por hecho y no llegó, un
            pago que anotaste dos veces, un cheque que nadie depositó.
          </p>
          <Lista>
            {sueltos.slice(0, 20).map((m) => (
              <Fila
                key={m.id}
                principal={
                  <>
                    <span className="font-medium">{m.description}</span>
                    <Etiqueta tono={m.direction === 'in' ? 'positivo' : 'neutro'}>
                      {m.direction === 'in' ? 'entró' : 'salió'}
                    </Etiqueta>
                  </>
                }
                secundario={
                  <>
                    {formatoFecha(m.value_date)} · {importe(m.amount)}
                    {m.external_ref ? ` · ${m.external_ref}` : ''}
                  </>
                }
              />
            ))}
          </Lista>
          {sueltos.length > 20 && (
            <p className="mt-3 text-xs text-muted">Y {sueltos.length - 20} más.</p>
          )}
        </Tarjeta>
      )}

      {/* -------------------------------------------------- lo que cuadra */}
      {cuadradas.length > 0 && (
        <details className="text-sm">
          <summary className="min-h-11 cursor-pointer py-2 text-muted">
            Ver las {cuadradas.length} líneas que cuadran
          </summary>
          <Lista>
            {cuadradas.map((l) => {
              const suyos = matches.filter((m) => m.statement_line_id === l.id);
              return (
                <Fila
                  key={l.id}
                  principal={
                    <>
                      <span className="font-medium">{l.description}</span>
                      <Etiqueta tono="positivo">cuadra</Etiqueta>
                    </>
                  }
                  secundario={
                    <>
                      {formatoFecha(l.value_date)} · {importe(l.amount)} ·{' '}
                      {suyos.length === 1
                        ? movimientoDe(suyos[0]?.cash_movement_id ?? '')?.description ??
                          'un movimiento'
                        : `${suyos.length} movimientos`}
                    </>
                  }
                  extremo={
                    <Boton
                      variante="sutil"
                      disabled={desemparejar.isPending}
                      onClick={() => suyos.forEach((m) => desemparejar.mutate(m.id))}
                    >
                      Deshacer
                    </Boton>
                  }
                />
              );
            })}
          </Lista>
        </details>
      )}

      {apartadas.length > 0 && (
        <details className="text-sm">
          <summary className="min-h-11 cursor-pointer py-2 text-muted">
            Ver las {apartadas.length} apartadas
          </summary>
          <Lista>
            {apartadas.map((l) => (
              <Fila
                key={l.id}
                principal={<span className="font-medium">{l.description}</span>}
                secundario={
                  <>
                    {formatoFecha(l.value_date)} · {importe(l.amount)} · {l.ignored_reason}
                  </>
                }
                extremo={
                  <Boton
                    variante="sutil"
                    onClick={() => apartar.mutate({ linea: l.id, texto: null })}
                  >
                    Devolver
                  </Boton>
                }
              />
            ))}
          </Lista>
        </details>
      )}

      {/* ------------------------------------------------------- importar */}
      {cuentaId !== '' && (
        <Alta
          titulo="Importar un extracto"
          exito={exito}
          onSubmit={() => (paso === 'elegir' ? leer() : importar.mutate())}
        >
          {paso === 'elegir' ? (
            <>
              <p className="max-w-prose text-sm text-muted">
                Descarga el extracto de tu banco en CSV o Excel y pega aquí su contenido, o elige
                el archivo. No hace falta que lo limpies: la pantalla propone qué columna es cuál
                y tú lo confirmas antes de guardar nada.
              </p>
              <div>
                <label
                  htmlFor="archivo-extracto"
                  className="mb-1 block text-xs text-subtle"
                >
                  El archivo
                </label>
                <input
                  id="archivo-extracto"
                  type="file"
                  accept=".csv,.txt,.tsv,text/csv,text/plain"
                  className="min-h-11 w-full text-sm"
                  onChange={(e) => {
                    const archivo = e.target.files?.[0];
                    if (!archivo) return;
                    if (!etiqueta.trim()) setEtiqueta(archivo.name.replace(/\.[^.]+$/, ''));
                    void archivo.text().then(setTexto);
                  }}
                />
              </div>
              <div>
                <label htmlFor="pegado" className="mb-1 block text-xs text-subtle">
                  O pégalo aquí
                </label>
                <textarea
                  id="pegado"
                  rows={6}
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  className="w-full rounded-control border border-border bg-surface p-3 font-mono text-xs text-text"
                  placeholder={'Fecha;Descripción;Cargo;Abono\n03/11/2026;COMISION;118,00;'}
                />
              </div>
              <div>
                <Boton variante="primario" type="submit" disabled={texto.trim() === ''}>
                  Leer el archivo
                </Boton>
              </div>
            </>
          ) : (
            /*
              Se llama como función y no como `<Mapear />` a propósito.
              Declarada dentro del componente, su identidad cambia en cada
              render, así que React la desmontaría y volvería a montarla
              entera: el campo que estuvieras escribiendo perdería el foco
              después de cada letra. Llamada, es JSX del mismo árbol.
            */
            mapeo && mapear()
          )}

          {importar.error && <Aviso tipo="error">{mensajeDeError(importar.error)}</Aviso>}
        </Alta>
      )}

      <p className="max-w-prose text-xs text-subtle">
        Lo que todavía no hace esta pantalla: cerrar un periodo. Cuando exista, «hasta el 31 de
        octubre está cuadrado con el banco» será una fecha guardada y no una creencia, y lo
        anterior a esa fecha dejará de pedir atención.
      </p>
    </Seccion>
  );

  function leer() {
    const filas = separarCsv(texto);
    setMapeo(adivinarMapeo(filas));
    setPaso('mapear');
  }

  /** El paso de confirmar el mapeo. Va aquí dentro por el estado compartido. */
  function mapear() {
    if (!mapeo) return null;
    const filas = separarCsv(texto);
    const columnas = Math.max(0, ...filas.map((f) => f.length));
    const cabecera = mapeo.conCabecera ? (filas[0] ?? []) : [];
    const nombre = (i: number) => (cabecera[i] ?? '').trim() || `Columna ${i + 1}`;
    const { lineas: leidas, descartadas, fuera } = aLineas(filas, mapeo);
    const opciones = Array.from({ length: columnas }, (_, i) => i);

    return (
      <>
        <p className="max-w-prose text-sm text-muted">
          Esto es lo que entendí. Si algo no encaja, cámbialo: adivinar se propone, nunca se
          aplica solo. Un importador que se equivoca en silencio no da un error, da una
          contabilidad que cuadra con un extracto que no es el tuyo.
        </p>

        <Campo
          etiqueta="Cómo se llama este extracto"
          ayuda="Lo que vas a reconocer dentro de seis meses. Por ejemplo: «BCP soles · noviembre»."
          value={etiqueta}
          onChange={(e) => setEtiqueta(e.target.value)}
          required
        />

        <div className="grid gap-3 sm:grid-cols-2">
          <Selector
            etiqueta="La fecha"
            value={String(mapeo.fecha)}
            onChange={(e) => setMapeo({ ...mapeo, fecha: Number(e.target.value) })}
          >
            {opciones.map((i) => (
              <option key={i} value={i}>
                {nombre(i)}
              </option>
            ))}
          </Selector>

          <Selector
            etiqueta="El concepto"
            value={String(mapeo.descripcion)}
            onChange={(e) => setMapeo({ ...mapeo, descripcion: Number(e.target.value) })}
          >
            {opciones.map((i) => (
              <option key={i} value={i}>
                {nombre(i)}
              </option>
            ))}
          </Selector>

          <Selector
            etiqueta="El importe"
            ayuda="Una columna con signo, o dos: lo que sale y lo que entra."
            value={mapeo.importe === null ? 'dos' : String(mapeo.importe)}
            onChange={(e) =>
              setMapeo(
                e.target.value === 'dos'
                  ? { ...mapeo, importe: null, cargo: mapeo.cargo ?? 0, abono: mapeo.abono ?? 0 }
                  : { ...mapeo, importe: Number(e.target.value), cargo: null, abono: null },
              )
            }
          >
            {opciones.map((i) => (
              <option key={i} value={i}>
                {nombre(i)}
              </option>
            ))}
            <option value="dos">Son dos columnas</option>
          </Selector>

          <Selector
            etiqueta="El orden de la fecha"
            ayuda="03/11/2026 es 3 de noviembre o 11 de marzo, y solo tú lo sabes con seguridad."
            value={mapeo.orden}
            onChange={(e) =>
              setMapeo({ ...mapeo, orden: e.target.value as Mapeo['orden'] })
            }
          >
            <option value="dmy">Día / mes / año</option>
            <option value="mdy">Mes / día / año</option>
            <option value="ymd">Año / mes / día</option>
          </Selector>

          {mapeo.importe === null && (
            <>
              <Selector
                etiqueta="Lo que sale (cargo)"
                value={String(mapeo.cargo ?? 0)}
                onChange={(e) => setMapeo({ ...mapeo, cargo: Number(e.target.value) })}
              >
                {opciones.map((i) => (
                  <option key={i} value={i}>
                    {nombre(i)}
                  </option>
                ))}
              </Selector>
              <Selector
                etiqueta="Lo que entra (abono)"
                value={String(mapeo.abono ?? 0)}
                onChange={(e) => setMapeo({ ...mapeo, abono: Number(e.target.value) })}
              >
                {opciones.map((i) => (
                  <option key={i} value={i}>
                    {nombre(i)}
                  </option>
                ))}
              </Selector>
            </>
          )}
        </div>

        {mapeo.cuenta !== null && (() => {
          const suyas = valoresDe(filas, mapeo.cuenta, mapeo.conCabecera);
          if (suyas.length < 2) return null;
          return (
            <>
              <Aviso tipo="atencion">
                Este archivo trae {suyas.length} cuentas distintas en la columna «
                {nombre(mapeo.cuenta)}». Mercury exporta así: todas tus cuentas en el mismo CSV.
                Importarlo entero en una sola cuenta no daría un extracto, daría nueve mezclados,
                y además cada traspaso entre tus cuentas aparece dos veces, una por cada lado.
                Elige de cuál son las líneas que vas a importar y repite el archivo para cada una.
              </Aviso>
              <Selector
                etiqueta="De qué cuenta son estas líneas"
                value={mapeo.cuentaValor ?? ''}
                onChange={(e) => setMapeo({ ...mapeo, cuentaValor: e.target.value || null })}
                required
              >
                <option value="">Elige una</option>
                {suyas.map((v) => (
                  <option key={v.valor} value={v.valor}>
                    {v.valor || '(en blanco)'} · {v.cuantas}{' '}
                    {v.cuantas === 1 ? 'línea' : 'líneas'}
                  </option>
                ))}
              </Selector>
            </>
          );
        })()}

        {fuera.length > 0 && (
          <Aviso tipo="info">
            De las {filas.length - (mapeo.conCabecera ? 1 : 0)} filas del archivo,{' '}
            {fuera.map((f) => `${f.cuantas} ${f.por}`).join(', ')}. Las rechazadas no se importan
            porque nunca ocurrieron: meterlas sería inventar un movimiento que el banco no hizo.
          </Aviso>
        )}

        <div>
          <p className="mb-2 text-xs text-subtle">
            Así quedan las {leidas.length === 1 ? 'línea' : `${leidas.length} líneas`}
            {leidas.length > 3 ? ' (las tres primeras)' : ''}:
          </p>
          <Lista>
            {leidas.slice(0, 3).map((l, i) => (
              <Fila
                key={`${l.fecha}-${i}`}
                principal={<span className="font-medium">{l.descripcion}</span>}
                secundario={
                  <>
                    {formatoFecha(l.fecha)} ·{' '}
                    {Number(l.importe) < 0 ? 'sale ' : 'entra '}
                    {l.importe.replace('-', '')}
                    {l.referencia ? ` · ${l.referencia}` : ''}
                  </>
                }
              />
            ))}
          </Lista>
        </div>

        {descartadas.length > 0 && (
          <Aviso tipo="atencion">
            {descartadas.length === 1
              ? `La fila ${descartadas[0]?.fila} no se va a importar: ${descartadas[0]?.por}.`
              : `${descartadas.length} filas no se van a importar. La primera es la ${descartadas[0]?.fila}: ${descartadas[0]?.por}.`}{' '}
            Si son las de los totales del pie, está bien. Si no, revisa qué columna mapeaste como
            fecha y cuál como importe.
          </Aviso>
        )}

        <div className="flex gap-2">
          <Boton
            variante="primario"
            type="submit"
            disabled={
              importar.isPending ||
              leidas.length === 0 ||
              etiqueta.trim() === '' ||
              (mapeo.cuenta !== null &&
                mapeo.cuentaValor === null &&
                valoresDe(filas, mapeo.cuenta, mapeo.conCabecera).length > 1)
            }
          >
            {importar.isPending ? 'Importando…' : `Importar ${leidas.length} líneas`}
          </Boton>
          <Boton onClick={() => setPaso('elegir')}>Volver</Boton>
        </div>
      </>
    );
  }
}

/** Suma días a una fecha ISO sin pasar por la zona horaria local. */
function desplazar(iso: string, dias: number): string {
  const ms = Date.parse(`${iso}T00:00:00Z`);
  if (Number.isNaN(ms)) return iso;
  return new Date(ms + dias * 86_400_000).toISOString().slice(0, 10);
}
