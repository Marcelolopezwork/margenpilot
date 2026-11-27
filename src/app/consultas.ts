import { useQuery } from '@tanstack/react-query';
import { requireSupabase } from '../lib/supabase';
import type { Hecho } from '../pages/analisis/resultado';

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

/**
 * Los hechos económicos de un rango, con los nombres que hacen falta para
 * leerlos.
 *
 * Vive aquí y no dentro de una pantalla porque la piden dos —Inicio y
 * Análisis→Resultado— y la clave de caché tiene que tener **un solo dueño**.
 * La primera vez que dos pantallas se repartieron una clave con formas
 * distintas, entrar a la segunda después de la primera reventaba la
 * aplicación (ver `claves-de-cache.test.ts`). Una consulta compartida es una
 * consulta escrita una vez.
 *
 * Es `economic_facts` y no las tablas de origen a propósito: ahí ya está
 * resuelto qué cuenta y qué no —un cobro asignado a su factura no se cuenta
 * dos veces, y una transferencia entre cuentas propias no cuenta nunca—, y
 * esa regla no se puede reimplementar en cada pantalla.
 */
export interface HechosDelPeriodo {
  hechos: Hecho[];
  clientes: Map<string, string>;
  categorias: Map<string, string>;
  proveedores: Map<string, string>;
}

export function useHechosDelPeriodo({
  orgId,
  entidadId,
  desde,
  hasta,
  habilitada,
}: {
  orgId: string;
  entidadId: string | null;
  desde: string;
  hasta: string;
  habilitada: boolean;
}) {
  return useQuery({
    queryKey: ['resultado', orgId, entidadId, desde, hasta],
    enabled: habilitada,
    queryFn: async (): Promise<HechosDelPeriodo> => {
      const cliente = requireSupabase();

      let q = cliente
        .from('economic_facts')
        .select(
          'origen, fecha, direction, flow_class, kind, currency_code, amount_total, amount_net, amount_tax, category_id, client_id, supplier_id, concepto',
        )
        .eq('organization_id', orgId)
        .gte('fecha', desde)
        .lte('fecha', hasta)
        .order('fecha', { ascending: false });
      if (entidadId) q = q.eq('legal_entity_id', entidadId);
      const { data, error } = await q;
      if (error) throw error;

      const { data: clientes, error: e2 } = await cliente
        .from('clients')
        .select('id, name')
        .eq('organization_id', orgId);
      if (e2) throw e2;

      const { data: categorias, error: e3 } = await cliente
        .from('financial_categories')
        .select('id, name')
        .eq('organization_id', orgId);
      if (e3) throw e3;

      const { data: proveedores, error: e4 } = await cliente
        .from('suppliers')
        .select('id, name')
        .eq('organization_id', orgId);
      if (e4) throw e4;

      return {
        hechos: (data ?? []) as unknown as Hecho[],
        clientes: new Map((clientes ?? []).map((c) => [c.id, c.name])),
        categorias: new Map((categorias ?? []).map((c) => [c.id, c.name])),
        proveedores: new Map((proveedores ?? []).map((p) => [p.id, p.name])),
      };
    },
  });
}
