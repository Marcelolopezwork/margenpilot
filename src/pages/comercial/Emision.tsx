import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Aviso, Boton, Campo, Etiqueta, Tarjeta } from '../../components/ui';
import { mensajeDeError } from '../../lib/errors';
import { formatoFecha } from '../../lib/format';
import { descargarCotizacionPdf } from '../../lib/pdf';
import { requireSupabase } from '../../lib/supabase';
import { EMITIBLES, ESTADOS, EXIGEN_MOTIVO, SIGUIENTES, TONOS } from './estados';
import type { Estado } from './estados';
import { datosPdfDeSnapshot, leerSnapshot, leerTotales } from './snapshot';

/**
 * Emitir, cambiar de estado, y ver lo que ya salió.
 *
 * Esta tarjeta existe porque antes el estado era un desplegable con los siete
 * valores y se podía pasar un borrador a «aprobada» sin que hubiera salido
 * nunca. Ahora cada botón es una transición que la base acepta, y «enviada»
 * no es un botón: es el resultado de emitir, que es lo que produce el
 * documento. Lo que no está permitido no se ofrece, y si aun así la base lo
 * rechaza, el motivo se lee aquí mismo.
 *
 * Las versiones son inmutables: la lista de abajo es el registro de lo que el
 * cliente recibió, y el A4 de cada una sale de su copia, no de la cotización
 * de hoy.
 */
export default function Emision({
  cotizacion,
  estado,
  conCostos,
  hayLineas,
}: {
  cotizacion: string;
  estado: Estado;
  conCostos: boolean;
  hayLineas: boolean;
}) {
  const cliente = useQueryClient();
  const [motivo, setMotivo] = useState('');
  const [pidiendoMotivo, setPidiendoMotivo] = useState<Estado | null>(null);

  const versiones = useQuery({
    queryKey: ['cotizacion', cotizacion, 'versiones'],
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('quote_versions')
        .select('id, version_no, issued_at, snapshot, totals, snapshot_sha256')
        .eq('quote_id', cotizacion)
        .order('version_no', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const ids = (versiones.data ?? []).map((v) => v.id);

  // El margen vive en su propia tabla: un rol comercial lee la versión y no
  // lee esto (ADR-34). Por eso es una consulta aparte y no un join.
  const margenes = useQuery({
    queryKey: ['cotizacion', cotizacion, 'margenes', ids.join(',')],
    enabled: conCostos && ids.length > 0,
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('quote_version_costs')
        .select('quote_version_id, cost, profit, margin_pct, markup_pct')
        .in('quote_version_id', ids);
      if (error) throw error;
      return data ?? [];
    },
  });

  const bitacora = useQuery({
    queryKey: ['cotizacion', cotizacion, 'bitacora'],
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('quote_events')
        .select('id, at, action, note, from_status, to_status')
        .eq('quote_id', cotizacion)
        .order('at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
  });

  function recargar() {
    void cliente.invalidateQueries({ queryKey: ['cotizacion', cotizacion] });
  }

  const emitir = useMutation({
    mutationFn: async () => {
      const { error } = await requireSupabase().rpc('emitir_cotizacion', {
        p_quote: cotizacion,
      });
      if (error) throw error;
    },
    onSuccess: recargar,
  });

  const cambiar = useMutation({
    mutationFn: async ({ a, nota }: { a: Estado; nota: string }) => {
      // `exactOptionalPropertyTypes`: un parámetro opcional se omite, no se
      // manda como undefined.
      const limpia = nota.trim();
      const { error } = await requireSupabase().rpc('cambiar_estado_cotizacion', {
        p_quote: cotizacion,
        p_to: a,
        ...(limpia === '' ? {} : { p_note: limpia }),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setPidiendoMotivo(null);
      setMotivo('');
      recargar();
    },
  });

  function pedir(a: Estado) {
    if (EXIGEN_MOTIVO.includes(a)) {
      setPidiendoMotivo(a);
      return;
    }
    cambiar.mutate({ a, nota: '' });
  }

  const urlDe = (ruta: string | null): string | null =>
    ruta ? requireSupabase().storage.from('marcas').getPublicUrl(ruta).data.publicUrl : null;

  function descargar(fila: { snapshot: unknown; totals: unknown }) {
    const snap = leerSnapshot(fila.snapshot);
    if (!snap) return;
    void descargarCotizacionPdf(datosPdfDeSnapshot(snap, fila.totals, urlDe));
  }

  const filas = versiones.data ?? [];
  const siguiente = filas.length + 1;

  return (
    <Tarjeta className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-sm font-semibold">Emisión</h2>
          <p className="mt-1 max-w-xl text-xs text-subtle">
            Emitir congela la cotización en una versión que ya no cambia. Lo que se edite
            después no toca lo que el cliente recibió: produce la versión siguiente.
          </p>
        </div>
        <Etiqueta tono={TONOS[estado]}>{ESTADOS[estado]}</Etiqueta>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {EMITIBLES.includes(estado) && (
          <Boton
            variante="primario"
            onClick={() => emitir.mutate()}
            disabled={emitir.isPending || !hayLineas}
          >
            {emitir.isPending
              ? 'Emitiendo…'
              : filas.length === 0
                ? 'Emitir'
                : `Reemitir como v${siguiente}`}
          </Boton>
        )}
        {SIGUIENTES[estado].map((a) => (
          <Boton
            key={a}
            variante={a === 'void' ? 'peligro' : 'secundario'}
            className="min-h-0 px-3 py-2 text-xs"
            onClick={() => pedir(a)}
            disabled={cambiar.isPending}
          >
            {ESTADOS[a]}
          </Boton>
        ))}
        {estado === 'void' && (
          <p className="text-xs text-subtle">
            Anulada. Se conservan las versiones, el documento y la bitácora.
          </p>
        )}
      </div>

      {!hayLineas && EMITIBLES.includes(estado) && (
        <p className="mt-2 text-xs text-subtle">
          Añade al menos una línea: una cotización sin líneas no tiene nada que emitir.
        </p>
      )}

      {pidiendoMotivo && (
        <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-border pt-4">
          <div className="min-w-64 flex-1">
            <Campo
              etiqueta={`Motivo para pasar a «${ESTADOS[pidiendoMotivo]}»`}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Se fue con otra agencia"
              ayuda="Queda en la bitácora. Sin motivo, la base no acepta la anulación."
            />
          </div>
          <Boton
            variante="primario"
            disabled={cambiar.isPending || motivo.trim() === ''}
            onClick={() => cambiar.mutate({ a: pidiendoMotivo, nota: motivo })}
          >
            Confirmar
          </Boton>
          <Boton
            variante="sutil"
            onClick={() => {
              setPidiendoMotivo(null);
              setMotivo('');
            }}
          >
            Cancelar
          </Boton>
        </div>
      )}

      {emitir.error && (
        <div className="mt-3">
          <Aviso tipo="error">{mensajeDeError(emitir.error)}</Aviso>
        </div>
      )}
      {cambiar.error && (
        <div className="mt-3">
          <Aviso tipo="error">{mensajeDeError(cambiar.error)}</Aviso>
        </div>
      )}
      {versiones.error && (
        <div className="mt-3">
          <Aviso tipo="error">{mensajeDeError(versiones.error)}</Aviso>
        </div>
      )}

      {filas.length > 0 && (
        <div className="mt-5 border-t border-border pt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-subtle">
            Versiones emitidas
          </h3>
          <ul className="mt-2 flex flex-col divide-y divide-border">
            {filas.map((v) => {
              const snap = leerSnapshot(v.snapshot);
              const sumas = snap ? leerTotales(v.totals, snap.moneda) : null;
              const margen = (margenes.data ?? []).find((m) => m.quote_version_id === v.id);
              return (
                <li key={v.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-3">
                  <span className="num w-10 text-sm font-semibold">v{v.version_no}</span>
                  <span className="text-xs text-muted">{formatoFecha(v.issued_at)}</span>
                  <span className="num text-sm">{sumas?.totalConCodigo ?? '—'}</span>
                  {margen && (
                    <span className="text-xs text-muted">
                      margen {margen.margin_pct === null ? '—' : `${Number(margen.margin_pct).toFixed(1)} %`}
                    </span>
                  )}
                  <span
                    className="num text-xs text-subtle"
                    title={`Huella del contenido: ${v.snapshot_sha256}`}
                  >
                    {v.snapshot_sha256.slice(0, 8)}
                  </span>
                  <span className="ml-auto flex items-center gap-2">
                    <Link
                      to={`/comercial/cotizaciones/${cotizacion}/propuesta/v/${v.version_no}`}
                      className="text-xs underline"
                    >
                      Ver propuesta
                    </Link>
                    <Boton
                      variante="sutil"
                      className="min-h-0 px-3 py-1.5 text-xs"
                      onClick={() => descargar(v)}
                      disabled={!snap}
                    >
                      A4
                    </Boton>
                  </span>
                  {!snap && (
                    <span className="w-full text-xs text-warning">
                      Esta versión no se puede leer. Se conserva tal cual; no se reescribe.
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {(bitacora.data ?? []).length > 0 && (
        <details className="mt-4 border-t border-border pt-4">
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-subtle">
            Bitácora
          </summary>
          <ul className="mt-2 flex flex-col gap-1.5">
            {(bitacora.data ?? []).map((e) => (
              <li key={e.id} className="text-xs text-muted">
                <span className="num text-subtle">{formatoFecha(e.at)}</span>{' '}
                {e.action === 'issue' ? 'emitida' : 'estado'}
                {e.from_status && e.to_status && e.from_status !== e.to_status && (
                  <>
                    {' · '}
                    {ESTADOS[e.from_status]} → {ESTADOS[e.to_status]}
                  </>
                )}
                {e.note && <> · {e.note}</>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Tarjeta>
  );
}
