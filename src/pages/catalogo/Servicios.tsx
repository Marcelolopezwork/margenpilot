import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useMonedasHabilitadas } from '../../app/consultas';
import { useOrgElegida } from '../../app/org-context';
import { mensajeDeError } from '../../lib/errors';
import { formatoTasa } from '../../lib/format';
import { requireSupabase } from '../../lib/supabase';
import { Constants } from '../../types/database';
import type { Enums } from '../../types/database';
import { Aviso, Boton, Campo, Cargando, Etiqueta, Selector, Vacio } from '../../components/ui';
import { Alta, Fila, Lista, Seccion } from '../../components/piezas';
import { useRecargar } from '../../components/recargar';

const TIPOS: Record<Enums<'service_kind'>, string> = {
  one_off: 'Puntual',
  recurring: 'Recurrente',
  retainer: 'Fee mensual',
};

export default function Servicios() {
  const { organizacion } = useOrgElegida();
  const monedas = useMonedasHabilitadas(organizacion.id);
  const recargar = useRecargar(['servicios']);

  const [exito, setExito] = useState<string | null>(null);
  const [codigo, setCodigo] = useState('');
  const [nombre, setNombre] = useState('');
  const [categoria, setCategoria] = useState('');
  const [tipo, setTipo] = useState<Enums<'service_kind'>>('one_off');
  const [periodicidad, setPeriodicidad] = useState('');
  const [moneda, setMoneda] = useState('');
  const [fee, setFee] = useState('80');

  const categorias = useQuery({
    queryKey: ['categorias-servicio', organizacion.id],
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('service_categories')
        .select('id, name, is_active')
        .eq('organization_id', organizacion.id)
        .order('sort')
        .order('name');
      if (error) throw error;
      return data ?? [];
    },
  });

  const consulta = useQuery({
    queryKey: ['servicios', organizacion.id],
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('services')
        .select(
          'id, code, name, kind, periodicity, suggested_currency_code, default_fee_pct, is_active, category_id',
        )
        .eq('organization_id', organizacion.id)
        .order('code');
      if (error) throw error;
      return data ?? [];
    },
  });

  const crear = useMutation({
    onMutate: () => setExito(null),
    mutationFn: async () => {
      const { error } = await requireSupabase()
        .from('services')
        .insert({
          organization_id: organizacion.id,
          code: codigo.trim().toUpperCase(),
          name: nombre.trim(),
          category_id: categoria || null,
          kind: tipo,
          periodicity: tipo === 'one_off' ? null : periodicidad.trim(),
          suggested_currency_code: moneda || null,
          default_fee_pct: Number(fee.replace(',', '.')),
        });
      if (error) throw error;
    },
    onSuccess: () => {
      setExito(`${nombre.trim()} queda en el catálogo. Su composición de costos se añade después.`);
      setCodigo('');
      setNombre('');
      recargar();
    },
  });

  const alternar = useMutation({
    mutationFn: async ({ id, activo }: { id: string; activo: boolean }) => {
      const { error } = await requireSupabase()
        .from('services')
        .update({ is_active: !activo })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: recargar,
  });

  const nombreCategoria = (id: string | null) =>
    id ? ((categorias.data ?? []).find((c) => c.id === id)?.name ?? 'Categoría desconocida') : null;

  const servicios = consulta.data ?? [];
  const disponibles = monedas.data ?? [];

  return (
    <Seccion
      titulo="Fichas de servicio"
      regla="Lo que vendes, con su código, su tipo y el fee que propones por defecto. Ojo con el fee: es markup SOBRE EL COSTO, no margen sobre el precio. Un fee del 80 % sobre un costo de 100 da un precio de 180, y eso es un margen del 44,4 %, no del 80 %. Son dos cifras distintas y el cotizador las mostrará por separado."
    >
      {consulta.isPending && <Cargando que="las fichas" />}
      {consulta.error && <Aviso tipo="error">{mensajeDeError(consulta.error)}</Aviso>}

      {!consulta.isPending && servicios.length === 0 && (
        <Vacio
          titulo="Todavía no hay fichas de servicio"
          explicacion="Una ficha es lo que luego se arrastra a una cotización: trae su descripción, su composición de costos y su precio sugerido ya hechos."
          siguiente="Crea la primera con el formulario de abajo. El código es el que verás en los listados: CAMP-01, SEO-MES, WEB-LAND."
        />
      )}

      {servicios.length > 0 && (
        <Lista>
          {servicios.map((s) => (
            <Fila
              key={s.id}
              principal={
                <>
                  <span className="num text-subtle">{s.code}</span>
                  <span className="font-medium">{s.name}</span>
                  <Etiqueta>{TIPOS[s.kind]}</Etiqueta>
                  {!s.is_active && <Etiqueta tono="atencion">Inactiva</Etiqueta>}
                </>
              }
              secundario={
                <>
                  {[
                    nombreCategoria(s.category_id),
                    s.periodicity,
                    s.suggested_currency_code,
                    `fee ${formatoTasa(s.default_fee_pct)}`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </>
              }
              extremo={
                <Boton
                  variante="sutil"
                  disabled={alternar.isPending}
                  onClick={() => alternar.mutate({ id: s.id, activo: s.is_active })}
                >
                  {s.is_active ? 'Archivar' : 'Reactivar'}
                </Boton>
              }
            />
          ))}
        </Lista>
      )}

      {alternar.error && <Aviso tipo="error">{mensajeDeError(alternar.error)}</Aviso>}

      <Alta titulo="Nueva ficha de servicio" exito={exito} onSubmit={() => crear.mutate()}>
        <Campo
          etiqueta="Código"
          value={codigo}
          onChange={(e) => setCodigo(e.target.value.toUpperCase())}
          required
          maxLength={32}
          ayuda="Corto y estable. No se repite dentro de la organización."
        />

        <Campo
          etiqueta="Nombre"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          required
          maxLength={160}
          ayuda="Como lo lee el cliente en la cotización."
        />

        <Selector
          etiqueta="Categoría (opcional)"
          value={categoria}
          onChange={(e) => setCategoria(e.target.value)}
        >
          <option value="">Sin categoría</option>
          {(categorias.data ?? [])
            .filter((c) => c.is_active)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </Selector>

        <Selector
          etiqueta="Tipo"
          value={tipo}
          onChange={(e) => setTipo(e.target.value as Enums<'service_kind'>)}
        >
          {Constants.public.Enums.service_kind.map((k) => (
            <option key={k} value={k}>
              {TIPOS[k]}
            </option>
          ))}
        </Selector>

        {tipo !== 'one_off' && (
          <Campo
            etiqueta="Periodicidad"
            value={periodicidad}
            onChange={(e) => setPeriodicidad(e.target.value)}
            required
            maxLength={40}
            ayuda="Cada cuánto se repite: mensual, trimestral, anual."
          />
        )}

        <Selector
          etiqueta="Moneda sugerida (opcional)"
          value={moneda}
          onChange={(e) => setMoneda(e.target.value)}
          ayuda="Solo una sugerencia: la cotización manda sobre esto."
        >
          <option value="">Sin sugerencia</option>
          {disponibles.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Selector>

        <Campo
          etiqueta="Fee por defecto sobre el costo"
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          value={fee}
          onChange={(e) => setFee(e.target.value)}
          required
          ayuda="En porcentaje sobre el costo. 80 significa precio = costo × 1,80."
        />

        {crear.error && <Aviso tipo="error">{mensajeDeError(crear.error)}</Aviso>}

        <Boton
          type="submit"
          variante="primario"
          disabled={
            crear.isPending ||
            !codigo.trim() ||
            !nombre.trim() ||
            (tipo !== 'one_off' && !periodicidad.trim())
          }
        >
          {crear.isPending ? 'Creando…' : 'Crear ficha'}
        </Boton>
      </Alta>
    </Seccion>
  );
}
