import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Aviso, Boton, Cargando } from '../../components/ui';
import { mensajeDeError } from '../../lib/errors';
import { formatoFecha } from '../../lib/format';
import { requireSupabase } from '../../lib/supabase';
import Laminas from '../../propuesta/Laminas';
import { PRIMARIO_DE_SERIE, SECUNDARIO_DE_SERIE, urlDeFuentes } from '../../propuesta/tipos';
import {
  datosPropuestaDeSnapshot,
  diseñoDeSnapshot,
  leerSnapshot,
  leerTotales,
} from './snapshot';

/**
 * La propuesta de una versión ya emitida.
 *
 * Es una pantalla aparte y no un modo del constructor, y es deliberado: una
 * versión emitida no se edita. Si esto fuera el mismo componente con los
 * controles escondidos, cualquier descuido futuro volvería a dejarlos
 * tocables, y entonces «versión» no significaría nada. Aquí no hay nada que
 * tocar: se lee de la copia y se imprime.
 *
 * Lo que sale por la impresora es lo que el cliente recibió, también en la
 * forma: la portada, la tipografía, los colores y las fotos van dentro del
 * snapshot.
 */
export default function PropuestaEmitida() {
  const { id = '', version = '' } = useParams();

  const fila = useQuery({
    queryKey: ['propuesta', id, 'version', version],
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('quote_versions')
        .select('id, version_no, issued_at, snapshot, totals, snapshot_sha256')
        .eq('quote_id', id)
        .eq('version_no', Number(version))
        .single();
      if (error) throw error;
      return data;
    },
  });

  const snap = leerSnapshot(fila.data?.snapshot);
  const diseño = snap ? diseñoDeSnapshot(snap) : null;

  // Igual que en el constructor: la tipografía se carga en la cabeza del
  // documento, no con un <link> dentro del árbol.
  const tipografia = diseño?.tipografia ?? null;
  useEffect(() => {
    if (!tipografia) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = urlDeFuentes(tipografia);
    document.head.appendChild(link);
    return () => link.remove();
  }, [tipografia]);

  if (fila.isPending) return <Cargando que="la versión emitida" />;
  if (fila.error) return <Aviso tipo="error">{mensajeDeError(fila.error)}</Aviso>;

  if (!snap || !diseño) {
    return (
      <Aviso tipo="error">
        Esta versión no se puede leer. Se conserva tal cual en la base; no se reescribe.
      </Aviso>
    );
  }

  const urlDe = (ruta: string | null): string | null =>
    ruta ? requireSupabase().storage.from('marcas').getPublicUrl(ruta).data.publicUrl : null;

  const datos = datosPropuestaDeSnapshot(snap, fila.data.totals, urlDe);
  const sumas = leerTotales(fila.data.totals, snap.moneda);

  return (
    <div className="min-h-screen bg-[#e9e7e2]">
      <aside className="no-imprime fixed inset-y-0 left-0 z-10 w-[310px] overflow-y-auto border-r border-border bg-surface p-4 text-sm">
        <Link to={`/comercial/cotizaciones/${id}`} className="text-xs text-muted hover:underline">
          ← Volver a la cotización
        </Link>
        <h1 className="mt-2 text-base font-medium">{snap.numero}</h1>
        <p className="text-xs text-muted">{datos.cliente.nombre}</p>

        <div className="mt-3 rounded-card border border-border bg-surface-2 p-3">
          <p className="text-sm font-medium">Versión {fila.data.version_no}</p>
          <p className="mt-1 text-xs text-muted">
            Emitida el {formatoFecha(fila.data.issued_at)} por {sumas.totalConCodigo}.
          </p>
          <p className="mt-2 text-xs text-subtle">
            Esto es la copia que se le mandó al cliente. No se edita: para cambiar algo, vuelve
            a la cotización y emite otra versión.
          </p>
          <p className="num mt-2 break-all text-[10px] text-subtle" title="Huella del contenido">
            {fila.data.snapshot_sha256}
          </p>
        </div>

        <Boton variante="primario" className="mt-4 w-full" onClick={() => window.print()}>
          Descargar PDF
        </Boton>
        <p className="mt-2 text-xs text-subtle">
          Se abre la ventana de impresión del navegador. Elige <strong>Guardar como PDF</strong>,
          márgenes <strong>Ninguno</strong> y desactiva encabezados y pies.
        </p>
      </aside>

      <div className="marco-propuesta">
        <Laminas
          datos={datos}
          diseño={diseño}
          urlDe={urlDe}
          colorPrimario={diseño.colorPrimario ?? snap.marca?.color ?? PRIMARIO_DE_SERIE}
          colorSecundario={
            diseño.colorSecundario ?? snap.marca?.colorSecundario ?? SECUNDARIO_DE_SERIE
          }
        />
      </div>
    </div>
  );
}
