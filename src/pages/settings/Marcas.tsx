import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useOrg, useOrgElegida } from '../../app/org-context';
import { mensajeDeError } from '../../lib/errors';
import { requireSupabase } from '../../lib/supabase';
import { Aviso, Boton, Campo, Cargando, Etiqueta, Selector, Vacio } from '../../components/ui';
import { Alta, Fila, Lista, Seccion } from '../../components/piezas';
import MarcaFormato from './MarcaFormato';
import { useRecargar } from '../../components/recargar';

export default function Marcas() {
  const { organizacion, entidad } = useOrgElegida();
  const { entidades } = useOrg();
  const recargar = useRecargar(['marcas']);

  const [exito, setExito] = useState<string | null>(null);
  const [nombre, setNombre] = useState('');
  const [entidadId, setEntidadId] = useState('');

  const consulta = useQuery({
    queryKey: ['marcas', organizacion.id, entidad?.id ?? null],
    queryFn: async () => {
      let q = requireSupabase()
        .from('brands')
        .select('id, name, is_active, legal_entity_id, accent_color, logo_path, cover_path')
        .eq('organization_id', organizacion.id)
        .order('name');
      if (entidad) q = q.eq('legal_entity_id', entidad.id);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });

  const crear = useMutation({
    onMutate: () => setExito(null),
    mutationFn: async () => {
      const { error } = await requireSupabase().from('brands').insert({
        organization_id: organizacion.id,
        legal_entity_id: entidadId,
        name: nombre.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setExito(`${nombre.trim()} queda creada.`);
      setNombre('');
      recargar();
    },
  });

  const alternar = useMutation({
    mutationFn: async ({ id, activa }: { id: string; activa: boolean }) => {
      const { error } = await requireSupabase()
        .from('brands')
        .update({ is_active: !activa })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: recargar,
  });

  const nombreEntidad = (id: string) =>
    entidades.find((e) => e.id === id)?.legal_name ?? 'Entidad desconocida';

  const marcas = consulta.data ?? [];

  return (
    <Seccion
      titulo="Marcas"
      regla="La marca es el nombre comercial con el que sale la cotización, y pertenece a una entidad. Se pueden crear tantas como quieras: no cuentan para ningún límite de plan. Lo que una marca no tiene es caja ni documentos propios, porque el dinero y los impuestos son de la entidad, no del nombre comercial."
    >
      {consulta.isPending && <Cargando que="las marcas" />}
      {consulta.error && <Aviso tipo="error">{mensajeDeError(consulta.error)}</Aviso>}

      {entidades.length === 0 && (
        <Vacio
          titulo="Antes hace falta una entidad"
          explicacion="Una marca cuelga de una entidad legal, porque es esa entidad la que factura y la que paga los impuestos."
          siguiente="Crea primero una entidad en la pestaña Entidades."
        />
      )}

      {entidades.length > 0 && !consulta.isPending && marcas.length === 0 && (
        <Vacio
          titulo={entidad ? `${entidad.legal_name} no tiene marcas` : 'Todavía no hay marcas'}
          explicacion="Sin marca, la cotización sale con la razón social, que casi nunca es el nombre con el que te conocen los clientes."
          siguiente="Crea la primera con el formulario de abajo."
        />
      )}

      {marcas.length > 0 && (
        <Lista>
          {marcas.map((m) => (
            <Fila
              key={m.id}
              principal={
                <>
                  <span className="font-medium">{m.name}</span>
                  {!m.is_active && <Etiqueta tono="atencion">Archivada</Etiqueta>}
                </>
              }
              secundario={
                <>
                  {nombreEntidad(m.legal_entity_id)}
                  <MarcaFormato
                    marcaId={m.id}
                    organizacionId={organizacion.id}
                    nombre={m.name}
                    color={m.accent_color}
                    logoPath={m.logo_path}
                    portadaPath={m.cover_path}
                    alCambiar={recargar}
                  />
                </>
              }
              extremo={
                <Boton
                  variante="sutil"
                  disabled={alternar.isPending}
                  onClick={() => alternar.mutate({ id: m.id, activa: m.is_active })}
                >
                  {m.is_active ? 'Archivar' : 'Reactivar'}
                </Boton>
              }
            />
          ))}
        </Lista>
      )}

      {alternar.error && <Aviso tipo="error">{mensajeDeError(alternar.error)}</Aviso>}

      {entidades.length > 0 && (
        <Alta titulo="Nueva marca" exito={exito} onSubmit={() => crear.mutate()}>
          <Campo
            etiqueta="Nombre comercial"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            required
            maxLength={120}
            ayuda="Como lo ve el cliente. No se repite dentro de la organización."
          />

          <Selector
            etiqueta="Entidad que factura"
            value={entidadId}
            onChange={(e) => setEntidadId(e.target.value)}
            required
            ayuda="Determina la moneda y el impuesto de lo que se cotice con esta marca."
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

          {crear.error && <Aviso tipo="error">{mensajeDeError(crear.error)}</Aviso>}

          <Boton
            type="submit"
            variante="primario"
            disabled={crear.isPending || !nombre.trim() || !entidadId}
          >
            {crear.isPending ? 'Creando…' : 'Crear marca'}
          </Boton>
        </Alta>
      )}
    </Seccion>
  );
}
