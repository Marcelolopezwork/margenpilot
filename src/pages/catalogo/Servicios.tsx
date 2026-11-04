import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useMonedasHabilitadas } from '../../app/consultas';
import { useOrg, useOrgElegida } from '../../app/org-context';
import { mensajeDeError } from '../../lib/errors';
import { formatoTasa } from '../../lib/format';
import { requireSupabase } from '../../lib/supabase';
import { Constants } from '../../types/database';
import type { Enums } from '../../types/database';
import { Aviso, Boton, Campo, Cargando, Etiqueta, Selector, Vacio } from '../../components/ui';
import { Alta, Fila, FiltradoPor, Lista, Seccion } from '../../components/piezas';
import { useRecargar } from '../../components/recargar';
import ServicioTerminos from './ServicioTerminos';
import SelectorDeFoto from '../../propuesta/SelectorDeFoto';

const TIPOS: Record<Enums<'service_kind'>, string> = {
  one_off: 'Puntual',
  recurring: 'Recurrente',
  retainer: 'Fee mensual',
};

export default function Servicios() {
  const { organizacion, entidad } = useOrgElegida();
  const { entidades, elegirEntidad } = useOrg();
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
  const [entidadId, setEntidadId] = useState(entidad?.id ?? '');

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
    queryKey: ['servicios', organizacion.id, entidad?.id ?? null],
    queryFn: async () => {
      let q = requireSupabase()
        .from('services')
        .select(
          'id, code, name, kind, periodicity, suggested_currency_code, default_fee_pct, is_active, category_id, legal_entity_id, cover_path',
        )
        .eq('organization_id', organizacion.id)
        .order('code');
      if (entidad) q = q.eq('legal_entity_id', entidad.id);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  const foto = useMutation({
    mutationFn: async ({ id, ruta }: { id: string; ruta: string | null }) => {
      const { error } = await requireSupabase()
        .from('services')
        .update({ cover_path: ruta })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: recargar,
  });

  const crear = useMutation({
    onMutate: () => setExito(null),
    mutationFn: async () => {
      const { error } = await requireSupabase()
        .from('services')
        .insert({
          organization_id: organizacion.id,
          legal_entity_id: entidadId,
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
      <FiltradoPor entidad={entidad?.legal_name ?? null} alQuitar={() => elegirEntidad(null)} />

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
                  <ServicioTerminos
                    servicioId={s.id}
                    organizacionId={organizacion.id}
                    nombre={s.name}
                  />
                  {/* La foto con la que sale este servicio en una propuesta,
                      salvo que la cotización elija otra. */}
                  <SelectorDeFoto
                    organizacionId={organizacion.id}
                    ruta={s.cover_path}
                    etiqueta="Foto para la propuesta"
                    alElegir={(ruta) => foto.mutate({ id: s.id, ruta })}
                  />
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
        <Selector
          etiqueta="Empresa que lo vende"
          value={entidadId}
          onChange={(e) => setEntidadId(e.target.value)}
          required
          ayuda="Solo se podrá usar en cotizaciones de esta empresa, y sus costos tienen que ser de ella."
        >
          <option value="">Elige una empresa</option>
          {entidades
            .filter((e) => e.is_active)
            .map((e) => (
              <option key={e.id} value={e.id}>
                {e.legal_name} · {e.default_currency_code}
              </option>
            ))}
        </Selector>

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
            !entidadId ||
            (tipo !== 'one_off' && !periodicidad.trim())
          }
        >
          {crear.isPending ? 'Creando…' : 'Crear ficha'}
        </Boton>
      </Alta>
    </Seccion>
  );
}
