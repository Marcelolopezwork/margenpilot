import { useMutation } from '@tanstack/react-query';
import { mensajeDeError } from '../../lib/errors';
import { requireSupabase } from '../../lib/supabase';
import type { TablesUpdate } from '../../types/database';
import { Aviso, Campo } from '../../components/ui';

/**
 * Lo que va impreso en la cotización y no es contabilidad: dirección,
 * teléfono, correo y las condiciones que se repiten siempre.
 *
 * Cada campo se guarda al salir de él. Un botón de «guardar» para cuatro
 * campos sueltos solo añade un paso que se olvida.
 */
export default function EntidadDatosPdf({
  entidadId,
  nombre,
  direccion,
  telefono,
  correo,
  condiciones,
  alCambiar,
}: {
  entidadId: string;
  nombre: string;
  direccion: string | null;
  telefono: string | null;
  correo: string | null;
  condiciones: string | null;
  alCambiar: () => void;
}) {
  // Tipado contra la tabla a propósito: así no se puede escribir en una
  // columna que no existe, que es justo el error que un Record suelto deja
  // pasar hasta tiempo de ejecución.
  type Campos = Pick<TablesUpdate<'legal_entities'>, 'address' | 'phone' | 'email' | 'quote_terms'>;

  const guardar = useMutation({
    mutationFn: async (cambio: Campos) => {
      const { error } = await requireSupabase()
        .from('legal_entities')
        .update(cambio)
        .eq('id', entidadId);
      if (error) throw error;
    },
    onSuccess: alCambiar,
  });

  const alSalir = (columna: keyof Campos) => (e: React.FocusEvent<HTMLInputElement>) => {
    guardar.mutate({ [columna]: e.target.value.trim() || null } as Campos);
  };

  return (
    <details className="mt-3 border-t border-border pt-3">
      <summary className="cursor-pointer text-sm text-muted">
        Datos que salen impresos en la cotización
      </summary>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Campo
          etiqueta="Dirección"
          defaultValue={direccion ?? ''}
          onBlur={alSalir('address')}
          maxLength={200}
          aria-label={`Dirección de ${nombre}`}
        />
        <Campo
          etiqueta="Teléfono"
          defaultValue={telefono ?? ''}
          onBlur={alSalir('phone')}
          maxLength={40}
        />
        <Campo
          etiqueta="Correo"
          type="email"
          defaultValue={correo ?? ''}
          onBlur={alSalir('email')}
          maxLength={160}
        />
        <Campo
          etiqueta="Condiciones por defecto"
          defaultValue={condiciones ?? ''}
          onBlur={alSalir('quote_terms')}
          maxLength={600}
          ayuda="Se imprimen al pie de toda cotización de esta entidad."
        />
      </div>

      {guardar.error && <Aviso tipo="error">{mensajeDeError(guardar.error)}</Aviso>}
    </details>
  );
}
