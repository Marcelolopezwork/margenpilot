import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useOrgElegida } from '../../app/org-context';
import { mensajeDeError } from '../../lib/errors';
import { requireSupabase } from '../../lib/supabase';
import { Aviso, Boton, Campo, Cargando, Etiqueta, Vacio } from '../../components/ui';
import { Alta, Fila, Lista, Seccion } from '../../components/piezas';
import { useRecargar } from '../../components/recargar';

export default function CategoriasServicio() {
  const { organizacion } = useOrgElegida();
  const recargar = useRecargar(['categorias-servicio', 'servicios']);

  const [exito, setExito] = useState<string | null>(null);
  const [nombre, setNombre] = useState('');

  const consulta = useQuery({
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

  const crear = useMutation({
    onMutate: () => setExito(null),
    mutationFn: async () => {
      const { error } = await requireSupabase()
        .from('service_categories')
        .insert({ organization_id: organizacion.id, name: nombre.trim() });
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
        .from('service_categories')
        .update({ is_active: !activa })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: recargar,
  });

  const categorias = consulta.data ?? [];

  return (
    <Seccion
      titulo="Categorías de servicio"
      regla="Agrupan las fichas para encontrarlas y para medir rentabilidad por línea de negocio. Son opcionales: una ficha sin categoría funciona igual. Desactivar una categoría no toca las fichas que la usaban."
    >
      {consulta.isPending && <Cargando que="las categorías" />}
      {consulta.error && <Aviso tipo="error">{mensajeDeError(consulta.error)}</Aviso>}

      {!consulta.isPending && categorias.length === 0 && (
        <Vacio
          titulo="Todavía no hay categorías"
          explicacion="Con pocas fichas no hacen falta. Empiezan a importar cuando quieres saber qué línea de negocio deja más margen."
          siguiente="Créalas cuando las necesites: «Campañas», «Contenido», «Web», «Retainers»."
        />
      )}

      {categorias.length > 0 && (
        <Lista>
          {categorias.map((c) => (
            <Fila
              key={c.id}
              principal={
                <>
                  <span className="font-medium">{c.name}</span>
                  {!c.is_active && <Etiqueta tono="atencion">Inactiva</Etiqueta>}
                </>
              }
              extremo={
                <Boton
                  variante="sutil"
                  disabled={alternar.isPending}
                  onClick={() => alternar.mutate({ id: c.id, activa: c.is_active })}
                >
                  {c.is_active ? 'Desactivar' : 'Reactivar'}
                </Boton>
              }
            />
          ))}
        </Lista>
      )}

      {alternar.error && <Aviso tipo="error">{mensajeDeError(alternar.error)}</Aviso>}

      <Alta titulo="Nueva categoría" exito={exito} onSubmit={() => crear.mutate()}>
        <Campo
          etiqueta="Nombre"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          required
          maxLength={80}
          ayuda="No se repite dentro de la organización."
        />

        {crear.error && <Aviso tipo="error">{mensajeDeError(crear.error)}</Aviso>}

        <Boton type="submit" variante="primario" disabled={crear.isPending || !nombre.trim()}>
          {crear.isPending ? 'Creando…' : 'Crear categoría'}
        </Boton>
      </Alta>
    </Seccion>
  );
}
