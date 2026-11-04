import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useOrgElegida } from '../../app/org-context';
import { mensajeDeError } from '../../lib/errors';
import { formatoFecha } from '../../lib/format';
import { requireSupabase } from '../../lib/supabase';
import { Aviso, Boton, Campo, Cargando, Etiqueta, Selector, Vacio } from '../../components/ui';
import { Alta, Fila, Lista, Seccion } from '../../components/piezas';
import { useRecargar } from '../../components/recargar';

const HOY = () => new Date().toISOString().slice(0, 10);

/**
 * Los tipos de cambio.
 *
 * La tabla es **append-only**: la tasa de mañana se añade, no pisa a la de
 * hoy. Eso es lo que permite reabrir una cotización de hace tres meses y ver
 * con qué tasa se hizo, en vez de con la de hoy.
 *
 * Se usan para convertir el costo de una herramienta que se factura en otra
 * moneda. Nunca para sumar dos monedas en un total: eso sigue prohibido.
 */
export default function TiposDeCambio() {
  const { organizacion } = useOrgElegida();
  const recargar = useRecargar(['tipos-de-cambio']);

  const [exito, setExito] = useState<string | null>(null);
  const [desde, setDesde] = useState('USD');
  const [hasta, setHasta] = useState('PEN');
  const [tasa, setTasa] = useState('');
  const [fecha, setFecha] = useState(HOY);
  const [fuente, setFuente] = useState('');

  const monedas = useQuery({
    queryKey: ['monedas'],
    staleTime: Infinity,
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('currencies')
        .select('code, name')
        .order('code');
      if (error) throw error;
      return data ?? [];
    },
  });

  const consulta = useQuery({
    queryKey: ['tipos-de-cambio', organizacion.id],
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('fx_rates')
        .select('id, from_code, to_code, rate, as_of, source, kind')
        .eq('organization_id', organizacion.id)
        .order('as_of', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const crear = useMutation({
    onMutate: () => setExito(null),
    mutationFn: async () => {
      const { error } = await requireSupabase().from('fx_rates').insert({
        organization_id: organizacion.id,
        from_code: desde,
        to_code: hasta,
        rate: Number(tasa.replace(',', '.')),
        as_of: fecha,
        source: fuente.trim() || 'Cargado a mano',
        kind: 'manual',
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setExito(`Queda registrada la tasa ${desde} → ${hasta} del ${formatoFecha(fecha)}.`);
      setTasa('');
      recargar();
    },
  });

  const filas = consulta.data ?? [];
  const vigente = filas[0];

  return (
    <Seccion
      titulo="Tipos de cambio"
      regla="Sirven para una sola cosa: convertir el costo de algo que te facturan en otra moneda, como un hosting en dólares dentro de una cotización en soles. Nunca para sumar dos monedas en un total. Nada se reescribe: la tasa de mañana se añade, y por eso una cotización de hace tres meses sigue diciendo con qué tasa se hizo."
    >
      {consulta.isPending && <Cargando que="los tipos de cambio" />}
      {consulta.error && <Aviso tipo="error">{mensajeDeError(consulta.error)}</Aviso>}

      {!consulta.isPending && filas.length === 0 && (
        <Vacio
          titulo="Todavía no hay ninguna tasa"
          explicacion="Sin ella, una cotización que use una herramienta facturada en otra moneda no se puede armar: el sistema se niega a inventarse la conversión."
          siguiente="Carga la del dólar a soles de hoy y listo."
        />
      )}

      {filas.length > 0 && (
        <Lista>
          {filas.map((f) => (
            <Fila
              key={f.id}
              principal={
                <>
                  <span className="num font-medium">
                    1 {f.from_code} = {f.rate} {f.to_code}
                  </span>
                  {f.id === vigente?.id && <Etiqueta tono="positivo">La que se aplica</Etiqueta>}
                </>
              }
              secundario={`${formatoFecha(f.as_of)} · ${f.source}`}
            />
          ))}
        </Lista>
      )}

      <Alta titulo="Registrar una tasa" exito={exito} onSubmit={() => crear.mutate()}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Selector etiqueta="De" value={desde} onChange={(e) => setDesde(e.target.value)}>
            {(monedas.data ?? []).map((m) => (
              <option key={m.code} value={m.code}>
                {m.code} · {m.name}
              </option>
            ))}
          </Selector>
          <Selector etiqueta="A" value={hasta} onChange={(e) => setHasta(e.target.value)}>
            {(monedas.data ?? []).map((m) => (
              <option key={m.code} value={m.code}>
                {m.code} · {m.name}
              </option>
            ))}
          </Selector>
        </div>

        <Campo
          etiqueta={`Cuántos ${hasta} vale 1 ${desde}`}
          type="number"
          inputMode="decimal"
          step="0.00000001"
          min="0"
          value={tasa}
          onChange={(e) => setTasa(e.target.value)}
          required
          ayuda="La inversa se calcula sola: no hace falta cargar las dos direcciones."
        />

        <Campo
          etiqueta="Fecha"
          type="date"
          value={fecha}
          onChange={(e) => setFecha(e.target.value)}
          required
          ayuda="Se aplica la más reciente que no sea posterior a hoy."
        />

        <Campo
          etiqueta="Fuente"
          value={fuente}
          onChange={(e) => setFuente(e.target.value)}
          maxLength={120}
          ayuda="De dónde la sacaste: SUNAT, tu banco, la plataforma que te cobra."
        />

        {desde === hasta && (
          <Aviso tipo="atencion">Elige dos monedas distintas: una a sí misma siempre es 1.</Aviso>
        )}
        {crear.error && <Aviso tipo="error">{mensajeDeError(crear.error)}</Aviso>}

        <Boton
          type="submit"
          variante="primario"
          disabled={crear.isPending || desde === hasta || tasa.trim() === ''}
        >
          {crear.isPending ? 'Registrando…' : 'Registrar tasa'}
        </Boton>
      </Alta>
    </Seccion>
  );
}
