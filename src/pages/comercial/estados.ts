import type { Enums } from '../../types/database';

/**
 * Los estados de una cotización, en castellano. Viven en su propio archivo
 * porque los usan el listado y el editor, y exportar una constante desde un
 * archivo de componentes rompe la recarga en caliente.
 */
export const ESTADOS: Record<Enums<'quote_status'>, string> = {
  draft: 'Borrador',
  sent: 'Enviada',
  approved: 'Aprobada',
  rejected: 'Rechazada',
  expired: 'Vencida',
  void: 'Anulada',
};
