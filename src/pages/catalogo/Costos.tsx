import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useMonedasHabilitadas } from '../../app/consultas';
import { puedeVerCostos, useOrgElegida } from '../../app/org-context';
import { mensajeDeError } from '../../lib/errors';
import { currencyOf, format, fromRow } from '../../lib/money';
import { requireSupabase } from '../../lib/supabase';
import { Constants } from '../../types/database';
import type { Enums } from '../../types/database';
import { Aviso, Boton, Campo, Cargando, Etiqueta, Selector, Vacio } from '../../components/ui';
import { Alta, Fila, Lista, Seccion } from '../../components/piezas';
import { useRecargar } from '../../components/recargar';

const TIPOS: Record<Enums<'cost_item_kind'>, string> = {
  role: 'Persona',
  tool: 'Herramienta',
  external: 'Externo',
  other: 'Otro',
};

export default function Costos() {
  const { organizacion } = useOrgElegida();
  const monedas = useMonedasHabilitadas(organizacion.id);
  const recargar = useRecargar(['costos']);

  const [exito, setExito] = useState<string | null>(null);
  const [nombre, setNombre] = useState('');
  const [tipo, setTipo] = useState<Enums<'cost_item_kind'>>('role');
  const [unidad, setUnidad] = useState('hora');
  const [costo, setCosto] = useState('');
  const [moneda, setMoneda] = useState('');

  const consulta = useQuery({
    queryKey: ['costos', organizacion.id],
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('cost_items')
        .select('id, name, kind, unit, unit_cost, currency_code, is_active')
        .eq('organization_id', organizacion.id)
        .order('name');
      if (error) throw error;
      return data ?? [];
    },
  });

  const crear = useMutation({
    onMutate: () => setExito(null),
    mutationFn: async () => {
      const { error } = await requireSupabase().from('cost_items').insert({
        organization_id: organizacion.id,
        name: nombre.trim(),
        kind: tipo,
        unit: unidad.trim(),
        unit_cost: Number(costo.replace(',', '.')),
        currency_code: moneda,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setExito(`${nombre.trim()} queda en el catálogo de costos.`);
      setNombre('');
      setCosto('');
      recargar();
    },
  });

  const alternar = useMutation({
    mutationFn: async ({ id, activo }: { id: string; activo: boolean }) => {
      const { error } = await requireSupabase()
        .from('cost_items')
        .update({ is_active: !activo })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: recargar,
  });

  // Doble guarda: la ruta ya no se ofrece a quien no puede, pero entrar por
  // la barra de direcciones es gratis y la pantalla tiene que decir algo.
  if (!puedeVerCostos(organizacion.rol)) {
    return (
      <Vacio
        titulo="Los costos no son parte de tu rol"
        explicacion="En esta organización los costos y los márgenes los ven los roles de dirección y finanzas. Tú trabajas con los precios, que es lo que ve el cliente."
        siguiente="Si necesitas verlos, pídele a quien administre la organización que te cambie el rol."
      />
    );
  }

  const items = consulta.data ?? [];
  const disponibles = monedas.data ?? [];

  return (
    <Seccion
      titulo="Ítems de costo"
      regla="Lo que cuesta producir, con su unidad y su precio por unidad: una hora de dirección creativa, un mes de licencia, un proveedor externo. Se reutilizan entre fichas de servicio, y al añadir uno a una ficha se copia su costo del momento, así que subirle el precio a un ítem no reescribe las fichas que ya existían."
    >
      {consulta.isPending && <Cargando que="los ítems de costo" />}
      {consulta.error && <Aviso tipo="error">{mensajeDeError(consulta.error)}</Aviso>}

      {!consulta.isPending && items.length === 0 && (
        <Vacio
          titulo="Todavía no hay ítems de costo"
          explicacion="Sin ellos, cada ficha de servicio tendría que escribir sus costos a mano, y el mismo diseñador acabaría con tres precios distintos en tres fichas."
          siguiente="Empieza por los que más repites: las horas de cada rol y las licencias que pagas."
        />
      )}

      {items.length > 0 && (
        <Lista>
          {items.map((c) => (
            <Fila
              key={c.id}
              principal={
                <>
                  <span className="font-medium">{c.name}</span>
                  <Etiqueta>{TIPOS[c.kind]}</Etiqueta>
                  {!c.is_active && <Etiqueta tono="atencion">Inactivo</Etiqueta>}
                </>
              }
              secundario={
                <span className="num">
                  {format(fromRow(c.unit_cost, currencyOf(c.currency_code)))} por {c.unit}
                </span>
              }
              extremo={
                <Boton
                  variante="sutil"
                  disabled={alternar.isPending}
                  onClick={() => alternar.mutate({ id: c.id, activo: c.is_active })}
                >
                  {c.is_active ? 'Desactivar' : 'Reactivar'}
                </Boton>
              }
            />
          ))}
        </Lista>
      )}

      {alternar.error && <Aviso tipo="error">{mensajeDeError(alternar.error)}</Aviso>}

      <Alta titulo="Nuevo ítem de costo" exito={exito} onSubmit={() => crear.mutate()}>
        <Campo
          etiqueta="Nombre"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          required
          maxLength={120}
          ayuda="Como lo llamas al presupuestar: «Dirección creativa», «Licencia stock»."
        />

        <Selector
          etiqueta="Tipo"
          value={tipo}
          onChange={(e) => setTipo(e.target.value as Enums<'cost_item_kind'>)}
        >
          {Constants.public.Enums.cost_item_kind.map((k) => (
            <option key={k} value={k}>
              {TIPOS[k]}
            </option>
          ))}
        </Selector>

        <Campo
          etiqueta="Unidad"
          value={unidad}
          onChange={(e) => setUnidad(e.target.value)}
          required
          maxLength={40}
          ayuda="Cómo se mide: hora, mes, unidad, proyecto, palabra."
        />

        <Campo
          etiqueta="Costo por unidad"
          type="number"
          inputMode="decimal"
          step="0.0001"
          min="0"
          value={costo}
          onChange={(e) => setCosto(e.target.value)}
          required
          ayuda="Lo que te cuesta a ti, no lo que cobras."
        />

        <Selector
          etiqueta="Moneda"
          value={moneda}
          onChange={(e) => setMoneda(e.target.value)}
          required
          ayuda="Solo las habilitadas en la organización."
        >
          <option value="">Elige una moneda</option>
          {disponibles.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Selector>

        {crear.error && <Aviso tipo="error">{mensajeDeError(crear.error)}</Aviso>}

        <Boton
          type="submit"
          variante="primario"
          disabled={crear.isPending || !nombre.trim() || !moneda || costo.trim() === ''}
        >
          {crear.isPending ? 'Creando…' : 'Crear ítem'}
        </Boton>
      </Alta>
    </Seccion>
  );
}
