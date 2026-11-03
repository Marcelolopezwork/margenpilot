import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useOrgElegida } from '../../app/org-context';
import { mensajeDeError } from '../../lib/errors';
import { requireSupabase } from '../../lib/supabase';
import { Aviso, Boton, Campo, Cargando, Etiqueta, Vacio } from '../../components/ui';
import { Alta, Fila, Lista, Seccion } from '../../components/piezas';
import { useRecargar } from '../../components/recargar';

export default function Clientes() {
  const { organizacion } = useOrgElegida();
  const recargar = useRecargar(['clientes']);

  const [exito, setExito] = useState<string | null>(null);
  const [nombre, setNombre] = useState('');
  const [ruc, setRuc] = useState('');
  const [correo, setCorreo] = useState('');

  const consulta = useQuery({
    queryKey: ['clientes', organizacion.id],
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('clients')
        .select('id, name, tax_id, email, is_active')
        .eq('organization_id', organizacion.id)
        .order('name');
      if (error) throw error;
      return data ?? [];
    },
  });

  const crear = useMutation({
    onMutate: () => setExito(null),
    mutationFn: async () => {
      const { error } = await requireSupabase().from('clients').insert({
        organization_id: organizacion.id,
        name: nombre.trim(),
        tax_id: ruc.trim() || null,
        email: correo.trim() || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setExito(`${nombre.trim()} queda en tu cartera.`);
      setNombre('');
      setRuc('');
      setCorreo('');
      recargar();
    },
  });

  const alternar = useMutation({
    mutationFn: async ({ id, activo }: { id: string; activo: boolean }) => {
      const { error } = await requireSupabase()
        .from('clients')
        .update({ is_active: !activo })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: recargar,
  });

  const clientes = consulta.data ?? [];

  return (
    <Seccion
      titulo="Clientes"
      regla="Son de la organización, no de la entidad: el mismo cliente puede recibir una cotización en soles de la peruana y otra en dólares de la americana. Nada se borra; un cliente que deja de serlo se archiva y sus cotizaciones se quedan donde están."
    >
      {consulta.isPending && <Cargando que="los clientes" />}
      {consulta.error && <Aviso tipo="error">{mensajeDeError(consulta.error)}</Aviso>}

      {!consulta.isPending && clientes.length === 0 && (
        <Vacio
          titulo="Todavía no hay clientes"
          explicacion="Una cotización necesita a quién va dirigida. Es el único dato que no se puede dejar en blanco."
          siguiente="Crea el primero aquí abajo y luego ve a Cotizaciones."
        />
      )}

      {clientes.length > 0 && (
        <Lista>
          {clientes.map((c) => (
            <Fila
              key={c.id}
              principal={
                <>
                  <span className="font-medium">{c.name}</span>
                  {!c.is_active && <Etiqueta tono="atencion">Archivado</Etiqueta>}
                </>
              }
              secundario={[c.tax_id, c.email].filter(Boolean).join(' · ') || undefined}
              extremo={
                <Boton
                  variante="sutil"
                  disabled={alternar.isPending}
                  onClick={() => alternar.mutate({ id: c.id, activo: c.is_active })}
                >
                  {c.is_active ? 'Archivar' : 'Reactivar'}
                </Boton>
              }
            />
          ))}
        </Lista>
      )}

      {alternar.error && <Aviso tipo="error">{mensajeDeError(alternar.error)}</Aviso>}

      <Alta titulo="Nuevo cliente" exito={exito} onSubmit={() => crear.mutate()}>
        <Campo
          etiqueta="Nombre o razón social"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          required
          maxLength={200}
          ayuda="Como se imprime en la cotización."
        />
        <Campo
          etiqueta="Identificación fiscal (opcional)"
          value={ruc}
          onChange={(e) => setRuc(e.target.value)}
          maxLength={32}
        />
        <Campo
          etiqueta="Correo (opcional)"
          type="email"
          value={correo}
          onChange={(e) => setCorreo(e.target.value)}
          maxLength={160}
        />

        {crear.error && <Aviso tipo="error">{mensajeDeError(crear.error)}</Aviso>}

        <Boton type="submit" variante="primario" disabled={crear.isPending || !nombre.trim()}>
          {crear.isPending ? 'Creando…' : 'Crear cliente'}
        </Boton>
      </Alta>
    </Seccion>
  );
}
