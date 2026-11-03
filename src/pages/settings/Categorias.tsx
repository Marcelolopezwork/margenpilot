import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useOrgElegida } from '../../app/org-context';
import { mensajeDeError } from '../../lib/errors';
import { nombreDireccion } from '../../lib/format';
import { requireSupabase } from '../../lib/supabase';
import { Constants } from '../../types/database';
import type { Enums } from '../../types/database';
import { Aviso, Boton, Campo, Cargando, Etiqueta, Selector, Vacio } from '../../components/ui';
import { Alta, Fila, Lista, Seccion } from './piezas';
import { useRecargar } from './recargar';

export default function Categorias() {
  const { organizacion } = useOrgElegida();
  const recargar = useRecargar(['categorias']);

  const [exito, setExito] = useState<string | null>(null);
  const [nombre, setNombre] = useState('');
  const [direccion, setDireccion] = useState<Enums<'category_direction'>>('out');

  const consulta = useQuery({
    queryKey: ['categorias', organizacion.id],
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('financial_categories')
        .select('id, name, direction, is_active, sort')
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
      const { error } = await requireSupabase().from('financial_categories').insert({
        organization_id: organizacion.id,
        name: nombre.trim(),
        direction: direccion,
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
        .from('financial_categories')
        .update({ is_active: !activa })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: recargar,
  });

  const categorias = consulta.data ?? [];

  return (
    <Seccion
      titulo="Categorías"
      regla="Las categorías son de la organización, no de la entidad: así los informes comparan los dos libros con el mismo criterio. Una categoría en uso no se borra, se desactiva, porque borrarla dejaría movimientos antiguos sin clasificar. «Movimientos del dueño» existe aparte a propósito: un aporte o un retiro mueve la caja pero no es ingreso ni gasto."
    >
      {consulta.isPending && <Cargando que="las categorías" />}
      {consulta.error && <Aviso tipo="error">{mensajeDeError(consulta.error)}</Aviso>}

      {!consulta.isPending && categorias.length === 0 && (
        <Vacio
          titulo="Todavía no hay categorías"
          explicacion="Son con lo que se clasifica cada cobro y cada pago. Al crear la organización se sembraron nueve; si no ves ninguna, es que esta organización se creó de otra forma."
          siguiente="Crea las que necesites con el formulario de abajo."
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
                  <Etiqueta tono={c.direction === 'in' ? 'positivo' : 'neutro'}>
                    {nombreDireccion(c.direction)}
                  </Etiqueta>
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

        <Selector
          etiqueta="Dirección"
          value={direccion}
          onChange={(e) => setDireccion(e.target.value as Enums<'category_direction'>)}
          ayuda="«Ambos» es para lo que va en las dos direcciones, como los movimientos del dueño."
        >
          {Constants.public.Enums.category_direction.map((d) => (
            <option key={d} value={d}>
              {nombreDireccion(d)}
            </option>
          ))}
        </Selector>

        {crear.error && <Aviso tipo="error">{mensajeDeError(crear.error)}</Aviso>}

        <Boton type="submit" variante="primario" disabled={crear.isPending || !nombre.trim()}>
          {crear.isPending ? 'Creando…' : 'Crear categoría'}
        </Boton>
      </Alta>
    </Seccion>
  );
}
