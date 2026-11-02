import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSesion } from '../app/session-context';
import { mensajeDeError } from '../lib/errors';
import { requireSupabase } from '../lib/supabase';
import { Aviso, Boton, Campo, Selector, Tarjeta } from '../components/ui';

/**
 * Lo que se ve cuando la cuenta todavía no tiene organización.
 *
 * El alta no se hace con un `insert`: se llama a `create_organization`, que es
 * `security definer` y hace en una transacción la organización, la membresía
 * de dueño, la suscripción, las monedas y las categorías. Hacerlo por partes
 * desde el cliente dejaría a medias cualquier fallo intermedio (ADR-26).
 */
export default function Onboarding() {
  const { usuario, salir } = useSesion();
  const queryClient = useQueryClient();
  const [nombre, setNombre] = useState('');
  const [moneda, setMoneda] = useState('PEN');

  const monedas = useQuery({
    queryKey: ['monedas'],
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('currencies')
        .select('code, name, symbol')
        .order('code');
      if (error) throw error;
      return data ?? [];
    },
  });

  const crear = useMutation({
    mutationFn: async () => {
      const { error } = await requireSupabase().rpc('create_organization', {
        p_name: nombre.trim(),
        p_currency: moneda,
      });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries(),
  });

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-4 py-12">
      <header>
        <p className="text-xs uppercase tracking-widest text-subtle">Primer paso</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Crea tu organización</h1>
        <p className="mt-2 text-sm text-muted">
          Es el contenedor de todo: dentro viven las entidades legales, cada una con su moneda y su
          impuesto. El nombre se puede cambiar después.
        </p>
      </header>

      <Tarjeta className="p-5">
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            crear.mutate();
          }}
        >
          <Campo
            etiqueta="Nombre de la organización"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            required
            maxLength={120}
            autoComplete="organization"
            ayuda="Por ejemplo, el nombre del grupo, no el de una de sus empresas."
          />

          <Selector
            etiqueta="Moneda de visualización"
            value={moneda}
            onChange={(e) => setMoneda(e.target.value)}
            ayuda="La que se usa para el consolidado referencial. No limita en qué monedas cobras."
            disabled={monedas.isPending}
          >
            {(monedas.data ?? []).map((m) => (
              <option key={m.code} value={m.code}>
                {m.code} · {m.name}
              </option>
            ))}
          </Selector>

          {crear.error && <Aviso tipo="error">{mensajeDeError(crear.error)}</Aviso>}

          <Boton
            type="submit"
            variante="primario"
            disabled={crear.isPending || !nombre.trim() || monedas.isPending}
          >
            {crear.isPending ? 'Creando…' : 'Crear organización'}
          </Boton>
        </form>
      </Tarjeta>

      <p className="text-xs text-subtle">
        Entraste como {usuario?.email}.{' '}
        <button type="button" onClick={() => void salir()} className="underline">
          Salir
        </button>
      </p>
    </main>
  );
}
