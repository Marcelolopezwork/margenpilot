import { useQuery } from '@tanstack/react-query';
import { requireSupabase } from '../lib/supabase';

/**
 * Consultas que necesitan varias pantallas. Comparten clave de caché a
 * propósito: así invalidar una vez actualiza todo lo que dependía de ella.
 */

export type Moneda = { code: string; name: string; symbol: string; minor_units: number };

/** El catálogo completo. Es una tabla de referencia con RLS de solo lectura. */
export function useMonedasCatalogo() {
  return useQuery({
    queryKey: ['monedas'],
    // No cambia nunca durante una sesión.
    staleTime: Infinity,
    queryFn: async (): Promise<Moneda[]> => {
      const { data, error } = await requireSupabase()
        .from('currencies')
        .select('code, name, symbol, minor_units')
        .order('code');
      if (error) throw error;
      return data ?? [];
    },
  });
}

/**
 * Las monedas habilitadas en la organización. Importa porque una cuenta de
 * caja solo puede existir en una de estas: el disparador
 * `app.check_account_currency` lo hace cumplir, y ofrecer otra en la interfaz
 * sería ofrecer un error.
 */
export function useMonedasHabilitadas(orgId: string | null) {
  return useQuery({
    queryKey: ['monedas-org', orgId],
    enabled: Boolean(orgId),
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await requireSupabase()
        .from('organization_currencies')
        .select('currency_code')
        .eq('organization_id', orgId as string)
        .eq('is_enabled', true)
        .order('currency_code');
      if (error) throw error;
      return (data ?? []).map((f) => f.currency_code);
    },
  });
}
