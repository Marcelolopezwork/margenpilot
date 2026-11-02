import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useOrg, useOrgElegida } from '../../app/org-context';
import { mensajeDeError } from '../../lib/errors';
import { formatoTasa } from '../../lib/format';
import { requireSupabase } from '../../lib/supabase';
import { Aviso, Boton, Campo, Cargando, Etiqueta, Selector, Vacio } from '../../components/ui';
import { Alta, Fila, Lista, Seccion } from './piezas';
import { useRecargar } from './recargar';

export default function Impuestos() {
  const { organizacion, entidad } = useOrgElegida();
  const { entidades } = useOrg();
  const recargar = useRecargar(['impuestos']);

  const [entidadId, setEntidadId] = useState('');
  const [nombre, setNombre] = useState('');
  const [tasa, setTasa] = useState('');

  const consulta = useQuery({
    queryKey: ['impuestos', organizacion.id, entidad?.id ?? null],
    queryFn: async () => {
      let q = requireSupabase()
        .from('tax_rates')
        .select('id, name, rate, is_default, is_active, legal_entity_id')
        .eq('organization_id', organizacion.id)
        .order('name');
      if (entidad) q = q.eq('legal_entity_id', entidad.id);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  const crear = useMutation({
    mutationFn: async () => {
      const valor = Number(tasa.replace(',', '.'));
      const { error } = await requireSupabase().from('tax_rates').insert({
        organization_id: organizacion.id,
        legal_entity_id: entidadId,
        name: nombre.trim(),
        rate: valor,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setNombre('');
      setTasa('');
      recargar();
    },
  });

  /**
   * Un índice único parcial garantiza un solo impuesto por defecto en cada
   * entidad, así que hay que quitar el anterior ANTES de poner el nuevo. Al
   * revés, la base lo rechaza.
   */
  const porDefecto = useMutation({
    mutationFn: async ({ id, entidadDe }: { id: string; entidadDe: string }) => {
      const supabase = requireSupabase();
      const quitar = await supabase
        .from('tax_rates')
        .update({ is_default: false })
        .eq('legal_entity_id', entidadDe)
        .eq('is_default', true);
      if (quitar.error) throw quitar.error;

      const poner = await supabase.from('tax_rates').update({ is_default: true }).eq('id', id);
      if (poner.error) throw poner.error;
    },
    onSuccess: recargar,
  });

  const nombreEntidad = (id: string) =>
    entidades.find((e) => e.id === id)?.legal_name ?? 'Entidad desconocida';

  const impuestos = consulta.data ?? [];

  return (
    <Seccion
      titulo="Impuestos"
      regla="Cada entidad tiene sus propias tasas, porque el régimen es de la empresa y no del grupo: IGV 18 % en Perú, 0 % en Estados Unidos. Una entidad puede tener varias tasas, pero solo una por defecto, y es la que propone el cotizador. Una entidad al 0 % no muestra bloque de impuesto en la cotización."
    >
      {consulta.isPending && <Cargando que="los impuestos" />}
      {consulta.error && <Aviso tipo="error">{mensajeDeError(consulta.error)}</Aviso>}

      {entidades.length === 0 && (
        <Vacio
          titulo="Antes hace falta una entidad"
          explicacion="Una tasa pertenece a una entidad legal, no a la organización."
          siguiente="Crea primero una entidad en la pestaña Entidades."
        />
      )}

      {entidades.length > 0 && !consulta.isPending && impuestos.length === 0 && (
        <Vacio
          titulo="Todavía no hay tasas configuradas"
          explicacion="Sin una tasa por defecto, cada cotización obliga a elegir el impuesto a mano, que es por donde se cuelan los errores."
          siguiente="Crea la tasa de cada entidad con el formulario de abajo: 18 % para la peruana, 0 % para la americana."
        />
      )}

      {impuestos.length > 0 && (
        <Lista>
          {impuestos.map((t) => (
            <Fila
              key={t.id}
              principal={
                <>
                  <span className="font-medium">{t.name}</span>
                  <span className="num text-muted">{formatoTasa(t.rate)}</span>
                  {t.is_default && <Etiqueta tono="positivo">Por defecto</Etiqueta>}
                  {!t.is_active && <Etiqueta tono="atencion">Inactiva</Etiqueta>}
                </>
              }
              secundario={nombreEntidad(t.legal_entity_id)}
              extremo={
                t.is_default ? undefined : (
                  <Boton
                    variante="sutil"
                    disabled={porDefecto.isPending}
                    onClick={() =>
                      porDefecto.mutate({ id: t.id, entidadDe: t.legal_entity_id })
                    }
                  >
                    Poner por defecto
                  </Boton>
                )
              }
            />
          ))}
        </Lista>
      )}

      {porDefecto.error && <Aviso tipo="error">{mensajeDeError(porDefecto.error)}</Aviso>}

      {entidades.length > 0 && (
        <Alta titulo="Nueva tasa" onSubmit={() => crear.mutate()}>
          <Selector
            etiqueta="Entidad"
            value={entidadId}
            onChange={(e) => setEntidadId(e.target.value)}
            required
          >
            <option value="">Elige una entidad</option>
            {entidades
              .filter((e) => e.is_active)
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {e.legal_name}
                </option>
              ))}
          </Selector>

          <Campo
            etiqueta="Nombre"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            required
            maxLength={60}
            ayuda="Como lo lee un cliente: «IGV 18%», «Sin impuesto», «Exonerado»."
          />

          <Campo
            etiqueta="Tasa"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            max="100"
            value={tasa}
            onChange={(e) => setTasa(e.target.value)}
            required
            ayuda="En porcentaje: 18 para el IGV, 0 para sin impuesto."
          />

          {crear.error && <Aviso tipo="error">{mensajeDeError(crear.error)}</Aviso>}

          <Boton
            type="submit"
            variante="primario"
            disabled={crear.isPending || !entidadId || !nombre.trim() || tasa.trim() === ''}
          >
            {crear.isPending ? 'Creando…' : 'Crear tasa'}
          </Boton>
        </Alta>
      )}
    </Seccion>
  );
}
