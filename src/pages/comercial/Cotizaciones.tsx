import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { puedeVerCostos, useOrg, useOrgElegida } from '../../app/org-context';
import { mensajeDeError } from '../../lib/errors';
import { formatoFecha } from '../../lib/format';
import { format } from '../../lib/money';
import { requireSupabase } from '../../lib/supabase';
import { Aviso, Boton, Cargando, Etiqueta, Selector, Tarjeta, Vacio } from '../../components/ui';
import { Alta, Fila, Lista, Seccion } from '../../components/piezas';
import { useRecargar } from '../../components/recargar';
import { ESTADOS } from './estados';
import type { Estado } from './estados';
import { margenPorMoneda, ultimaPorCotizacion } from './margen-agregado';
import type { VersionConCosto } from './margen-agregado';

const ORDEN_ESTADOS: Estado[] = [
  'draft',
  'sent',
  'negotiation',
  'approved',
  'rejected',
  'expired',
  'void',
];

export default function Cotizaciones() {
  const { organizacion, entidad } = useOrgElegida();
  const { entidades } = useOrg();
  const navegar = useNavigate();
  const recargar = useRecargar(['cotizaciones']);
  const conCostos = puedeVerCostos(organizacion.rol);

  const [entidadId, setEntidadId] = useState(entidad?.id ?? '');
  const [clienteId, setClienteId] = useState('');
  const [filtroEstado, setFiltroEstado] = useState('');
  const [filtroCliente, setFiltroCliente] = useState('');

  const clientes = useQuery({
    queryKey: ['clientes', organizacion.id],
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('clients')
        .select('id, name, is_active')
        .eq('organization_id', organizacion.id)
        .order('name');
      if (error) throw error;
      return data ?? [];
    },
  });

  const consulta = useQuery({
    queryKey: [
      'cotizaciones',
      organizacion.id,
      entidad?.id ?? null,
      filtroEstado || null,
      filtroCliente || null,
    ],
    queryFn: async () => {
      let q = requireSupabase()
        .from('quotes')
        .select('id, number, status, currency_code, valid_until, created_at, client_id, legal_entity_id')
        .eq('organization_id', organizacion.id)
        .order('created_at', { ascending: false });
      if (entidad) q = q.eq('legal_entity_id', entidad.id);
      if (filtroEstado) q = q.eq('status', filtroEstado as Estado);
      if (filtroCliente) q = q.eq('client_id', filtroCliente);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  const ids = (consulta.data ?? []).map((q) => q.id);

  /**
   * El margen de lo que se está viendo.
   *
   * Sale de las versiones emitidas y no de las líneas de hoy: el margen que
   * importa es el del papel que recibió el cliente. Son dos consultas y no un
   * join porque el costo vive en su propia tabla, que un rol comercial no lee
   * (ADR-34); con el join, esa consulta devolvería cero filas y parecería que
   * no hay cotizaciones.
   */
  const resumen = useQuery({
    queryKey: ['cotizaciones', organizacion.id, 'margen', ids.join(',')],
    enabled: conCostos && ids.length > 0,
    queryFn: async (): Promise<VersionConCosto[]> => {
      const supabase = requireSupabase();
      const versiones = await supabase
        .from('quote_versions')
        .select('id, quote_id, version_no, totals')
        .in('quote_id', ids);
      if (versiones.error) throw versiones.error;
      const filas = versiones.data ?? [];
      if (filas.length === 0) return [];

      const costos = await supabase
        .from('quote_version_costs')
        .select('quote_version_id, cost')
        .in(
          'quote_version_id',
          filas.map((v) => v.id),
        );
      if (costos.error) throw costos.error;
      const porVersion = new Map(
        (costos.data ?? []).map((c) => [c.quote_version_id, String(c.cost)]),
      );

      return filas.flatMap((v) => {
        const totales = v.totals as Record<string, unknown> | null;
        const neto = totales?.['neto'];
        const moneda = totales?.['moneda'];
        const costo = porVersion.get(v.id);
        if (typeof neto !== 'string' || typeof moneda !== 'string' || costo === undefined) {
          return [];
        }
        return [{ quote_id: v.quote_id, version_no: v.version_no, moneda, neto, costo }];
      });
    },
  });

  /**
   * Crear una cotización toca cuatro cosas de la configuración: la entidad da
   * la moneda y el impuesto por defecto, y el número lo asigna la base con un
   * lock para que dos a la vez no salgan con el mismo.
   */
  const crear = useMutation({
    mutationFn: async (): Promise<string> => {
      const supabase = requireSupabase();
      const ent = entidades.find((e) => e.id === entidadId);
      if (!ent) throw new Error('Elige una entidad.');

      const numero = await supabase.rpc('next_quote_number', { p_entity: entidadId });
      if (numero.error) throw numero.error;

      const impuesto = await supabase
        .from('tax_rates')
        .select('name, rate')
        .eq('legal_entity_id', entidadId)
        .eq('is_default', true)
        .maybeSingle();
      if (impuesto.error) throw impuesto.error;

      const { data, error } = await supabase
        .from('quotes')
        .insert({
          organization_id: organizacion.id,
          legal_entity_id: entidadId,
          client_id: clienteId,
          number: numero.data,
          currency_code: ent.default_currency_code,
          tax_rate_pct: impuesto.data?.rate ?? 0,
          tax_label: impuesto.data?.name ?? null,
        })
        .select('id')
        .single();
      if (error) throw error;
      return data.id;
    },
    onSuccess: (id) => {
      recargar();
      navegar(`/comercial/cotizaciones/${id}`);
    },
  });

  const nombreCliente = (id: string) =>
    (clientes.data ?? []).find((c) => c.id === id)?.name ?? 'Cliente';
  const nombreEntidad = (id: string) =>
    entidades.find((e) => e.id === id)?.legal_name ?? 'Entidad';

  const cotizaciones = consulta.data ?? [];
  const activos = (clientes.data ?? []).filter((c) => c.is_active);
  const entidadesActivas = entidades.filter((e) => e.is_active);
  const hayFiltro = filtroEstado !== '' || filtroCliente !== '';
  const margenes = margenPorMoneda(ultimaPorCotizacion(resumen.data ?? []));

  return (
    <Seccion
      titulo="Cotizaciones"
      regla="La entidad que cotiza decide la moneda, el impuesto y el número: son dos libros separados y cada uno lleva su propia numeración. El número se lo asigna la base de datos, no el navegador, para que dos cotizaciones creadas a la vez no salgan con el mismo."
    >
      {consulta.isPending && <Cargando que="las cotizaciones" />}
      {consulta.error && <Aviso tipo="error">{mensajeDeError(consulta.error)}</Aviso>}

      {activos.length === 0 && !clientes.isPending && (
        <Vacio
          titulo="Antes hace falta un cliente"
          explicacion="Una cotización va dirigida a alguien. Es el único dato que no admite blanco."
          siguiente="Crea el primer cliente en la pestaña Clientes."
          accion={
            <Link to="/comercial/clientes">
              <Boton variante="primario">Ir a Clientes</Boton>
            </Link>
          }
        />
      )}

      {activos.length > 0 && !consulta.isPending && (cotizaciones.length > 0 || hayFiltro) && (
        <div className="flex flex-wrap items-end gap-3">
          <Selector
            etiqueta="Estado"
            value={filtroEstado}
            onChange={(e) => setFiltroEstado(e.target.value)}
          >
            <option value="">Todos los estados</option>
            {ORDEN_ESTADOS.map((e) => (
              <option key={e} value={e}>
                {ESTADOS[e]}
              </option>
            ))}
          </Selector>
          <Selector
            etiqueta="Cliente"
            value={filtroCliente}
            onChange={(e) => setFiltroCliente(e.target.value)}
          >
            <option value="">Todos los clientes</option>
            {(clientes.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Selector>
          {hayFiltro && (
            <Boton
              variante="sutil"
              onClick={() => {
                setFiltroEstado('');
                setFiltroCliente('');
              }}
            >
              Quitar filtros
            </Boton>
          )}
        </div>
      )}

      {conCostos && margenes.length > 0 && (
        <Tarjeta className="p-5">
          <h2 className="text-sm font-semibold">Margen de lo que estás viendo</h2>
          <p className="mt-1 max-w-xl text-xs text-subtle">
            Ponderado: la utilidad de todas dividida entre el precio de todas, no el
            promedio de los porcentajes. Sale de la última versión emitida de cada
            cotización. Filtra por «Aprobada» para ver el de lo que ganaste.
          </p>
          <div className="mt-4 flex flex-wrap gap-x-10 gap-y-4">
            {margenes.map((m) => (
              <div key={m.moneda}>
                <p className="text-xs text-subtle">
                  {m.moneda} · {m.cuantas} {m.cuantas === 1 ? 'cotización' : 'cotizaciones'}
                </p>
                <p className="num mt-0.5 text-2xl font-semibold">
                  {m.margen === null ? '—' : `${m.margen.toFixed(1)} %`}
                </p>
                <p className="num mt-0.5 text-xs text-muted">
                  {format(m.utilidad)} de utilidad sobre {format(m.neto)}
                </p>
              </div>
            ))}
          </div>
          {margenes.length > 1 && (
            <p className="mt-3 text-xs text-subtle">
              Son dos cifras y no una porque las monedas no se suman. Para verlas juntas
              hará falta el consolidado referencial, con su tasa a la vista.
            </p>
          )}
        </Tarjeta>
      )}

      {activos.length > 0 && !consulta.isPending && cotizaciones.length === 0 && (
        <Vacio
          titulo={hayFiltro ? 'Nada con este filtro' : 'Todavía no has cotizado nada'}
          explicacion={
            hayFiltro
              ? 'Hay cotizaciones, pero ninguna cumple lo que has pedido arriba.'
              : 'Una cotización nace en borrador: puedes añadirle líneas, ver su margen real y cambiarla las veces que quieras antes de enviarla.'
          }
          siguiente={
            hayFiltro
              ? 'Quita el filtro para volver a verlas todas.'
              : 'Elige entidad y cliente aquí abajo y entra al editor.'
          }
        />
      )}

      {cotizaciones.length > 0 && (
        <Lista>
          {cotizaciones.map((q) => (
            <Fila
              key={q.id}
              principal={
                <>
                  <span className="num font-medium">{q.number}</span>
                  <span>{nombreCliente(q.client_id)}</span>
                  <Etiqueta tono={q.status === 'approved' ? 'positivo' : 'neutro'}>
                    {ESTADOS[q.status]}
                  </Etiqueta>
                </>
              }
              secundario={
                <>
                  {nombreEntidad(q.legal_entity_id)} · {q.currency_code} ·{' '}
                  {formatoFecha(q.created_at)}
                  {q.valid_until ? ` · vence ${formatoFecha(q.valid_until)}` : ''}
                </>
              }
              extremo={
                <Link to={`/comercial/cotizaciones/${q.id}`}>
                  <Boton variante="secundario">Abrir</Boton>
                </Link>
              }
            />
          ))}
        </Lista>
      )}

      {activos.length > 0 && entidadesActivas.length > 0 && (
        <Alta titulo="Nueva cotización" onSubmit={() => crear.mutate()}>
          <Selector
            etiqueta="Entidad que cotiza"
            value={entidadId}
            onChange={(e) => setEntidadId(e.target.value)}
            required
            ayuda="Decide la moneda, el impuesto y la numeración."
          >
            <option value="">Elige una entidad</option>
            {entidadesActivas.map((e) => (
              <option key={e.id} value={e.id}>
                {e.legal_name} · {e.default_currency_code}
              </option>
            ))}
          </Selector>

          <Selector
            etiqueta="Cliente"
            value={clienteId}
            onChange={(e) => setClienteId(e.target.value)}
            required
          >
            <option value="">Elige un cliente</option>
            {activos.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Selector>

          {crear.error && <Aviso tipo="error">{mensajeDeError(crear.error)}</Aviso>}

          <Boton
            type="submit"
            variante="primario"
            disabled={crear.isPending || !entidadId || !clienteId}
          >
            {crear.isPending ? 'Creando…' : 'Crear y abrir el editor'}
          </Boton>
        </Alta>
      )}
    </Seccion>
  );
}
