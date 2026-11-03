import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useOrg, useOrgElegida } from '../../app/org-context';
import { mensajeDeError } from '../../lib/errors';
import { formatoFecha } from '../../lib/format';
import { requireSupabase } from '../../lib/supabase';
import { Aviso, Boton, Cargando, Etiqueta, Selector, Vacio } from '../../components/ui';
import { Alta, Fila, Lista, Seccion } from '../../components/piezas';
import { useRecargar } from '../../components/recargar';
import { ESTADOS } from './estados';

export default function Cotizaciones() {
  const { organizacion, entidad } = useOrgElegida();
  const { entidades } = useOrg();
  const navegar = useNavigate();
  const recargar = useRecargar(['cotizaciones']);

  const [entidadId, setEntidadId] = useState(entidad?.id ?? '');
  const [clienteId, setClienteId] = useState('');

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
    queryKey: ['cotizaciones', organizacion.id, entidad?.id ?? null],
    queryFn: async () => {
      let q = requireSupabase()
        .from('quotes')
        .select('id, number, status, currency_code, valid_until, created_at, client_id, legal_entity_id')
        .eq('organization_id', organizacion.id)
        .order('created_at', { ascending: false });
      if (entidad) q = q.eq('legal_entity_id', entidad.id);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
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

      {activos.length > 0 && !consulta.isPending && cotizaciones.length === 0 && (
        <Vacio
          titulo="Todavía no has cotizado nada"
          explicacion="Una cotización nace en borrador: puedes añadirle líneas, ver su margen real y cambiarla las veces que quieras antes de enviarla."
          siguiente="Elige entidad y cliente aquí abajo y entra al editor."
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
