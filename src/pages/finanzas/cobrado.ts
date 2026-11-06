import { add, currencyOf, fromRow, zero, type Money } from '../../lib/money';
import { requireSupabase } from '../../lib/supabase';

/**
 * Cuánto se ha cobrado de verdad de cada documento.
 *
 * Vive aparte porque lo necesitan dos pantallas —la cartera en Finanzas y el
 * cronograma en una cotización— y porque tiene una trampa que no conviene
 * escribir dos veces: **una asignación de un movimiento anulado no cuenta.**
 * Si se sumaran todas, un cobro anulado seguiría pareciendo cobrado y la
 * cifra de «por cobrar» mentiría justo cuando más importa.
 *
 * Son tres consultas y no un join. Con claves foráneas compuestas el embebido
 * de PostgREST es frágil, y un fallo ahí no se vería como un error: se vería
 * como una cartera vacía, que es la forma más peligrosa de equivocarse.
 */
export async function cobradoPorDocumento(
  documentos: readonly string[],
): Promise<Map<string, Money>> {
  const cobrado = new Map<string, Money>();
  if (documentos.length === 0) return cobrado;

  const cliente = requireSupabase();

  const { data: asignaciones, error } = await cliente
    .from('payment_allocations')
    .select('billing_document_id, amount, currency_code, cash_movement_id')
    .in('billing_document_id', [...documentos]);
  if (error) throw error;
  if (!asignaciones || asignaciones.length === 0) return cobrado;

  const movimientos = [...new Set(asignaciones.map((a) => a.cash_movement_id))];
  const { data: movs, error: e2 } = await cliente
    .from('cash_movements')
    .select('id, is_void')
    .in('id', movimientos);
  if (e2) throw e2;

  const anulados = new Set((movs ?? []).filter((m) => m.is_void).map((m) => m.id));

  for (const a of asignaciones) {
    if (!a.billing_document_id) continue;
    if (anulados.has(a.cash_movement_id)) continue;
    let moneda;
    try {
      moneda = currencyOf(a.currency_code);
    } catch {
      continue;
    }
    const antes = cobrado.get(a.billing_document_id) ?? zero(moneda);
    cobrado.set(a.billing_document_id, add(antes, fromRow(a.amount, moneda)));
  }

  return cobrado;
}
