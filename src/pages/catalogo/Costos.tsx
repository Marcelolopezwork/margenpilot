import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useMonedasHabilitadas } from '../../app/consultas';
import { puedeVerCostos, useOrg, useOrgElegida } from '../../app/org-context';
import { mensajeDeError } from '../../lib/errors';
import { currencyOf, format, fromRow } from '../../lib/money';
import { requireSupabase } from '../../lib/supabase';
import { Constants } from '../../types/database';
import type { Enums } from '../../types/database';
import { Aviso, Boton, Campo, Cargando, Etiqueta, Selector, Vacio } from '../../components/ui';
import { Alta, Fila, FiltradoPor, Lista, Seccion } from '../../components/piezas';
import { useRecargar } from '../../components/recargar';

const TIPOS: Record<Enums<'cost_item_kind'>, string> = {
  role: 'Persona',
  tool: 'Herramienta',
  external: 'Externo',
  other: 'Otro',
};

export default function Costos() {
  const { organizacion, entidad } = useOrgElegida();
  const { entidades, elegirEntidad } = useOrg();
  const monedas = useMonedasHabilitadas(organizacion.id);
  const recargar = useRecargar(['costos']);

  const [exito, setExito] = useState<string | null>(null);
  const [nombre, setNombre] = useState('');
  const [tipo, setTipo] = useState<Enums<'cost_item_kind'>>('role');
  const [unidad, setUnidad] = useState('hora');
  const [costo, setCosto] = useState('');
  const [moneda, setMoneda] = useState('');
  const [entidadId, setEntidadId] = useState(entidad?.id ?? '');

  const consulta = useQuery({
    queryKey: ['costos', organizacion.id, entidad?.id ?? null],
    queryFn: async () => {
      let q = requireSupabase()
        .from('cost_items')
        .select('id, name, kind, unit, unit_cost, currency_code, is_active, legal_entity_id')
        .eq('organization_id', organizacion.id)
        .order('name');
      // Los compartidos salen siempre: pertenecen a las dos.
      if (entidad) q = q.or(`legal_entity_id.eq.${entidad.id},legal_entity_id.is.null`);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  const crear = useMutation({
    onMutate: () => setExito(null),
    mutationFn: async () => {
      const { error } = await requireSupabase().from('cost_items').insert({
        organization_id: organizacion.id,
        legal_entity_id: entidadId || null,
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
      regla="Lo que cuesta producir, con su unidad y su precio por unidad. Las personas pertenecen a una empresa, porque son dos contabilidades. Las herramientas suelen ser compartidas: tu hosting aloja las webs de las dos y te lo facturan en una sola moneda, así que se registra una vez en esa moneda y cada cotización lo convierte con el tipo de cambio registrado. Al añadir un costo a una ficha se copia su precio del momento, así que subirlo después no reescribe las fichas que ya existían."
    >
      <FiltradoPor entidad={entidad?.legal_name ?? null} alQuitar={() => elegirEntidad(null)} />

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
                  {c.legal_entity_id === null && <Etiqueta>Compartido</Etiqueta>}
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
        <Selector
          etiqueta="Empresa a la que pertenece"
          value={entidadId}
          onChange={(e) => setEntidadId(e.target.value)}
          ayuda="Compartido es para lo que usan las dos: una herramienta se factura en su moneda y la cotización la convierte con el tipo de cambio registrado."
        >
          <option value="">Compartido entre las dos empresas</option>
          {entidades
            .filter((e) => e.is_active)
            .map((e) => (
              <option key={e.id} value={e.id}>
                {e.legal_name} · {e.default_currency_code}
              </option>
            ))}
        </Selector>

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
