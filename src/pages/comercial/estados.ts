import type { Enums } from '../../types/database';

/**
 * Los estados de una cotización, en castellano. Viven en su propio archivo
 * porque los usan el listado y el editor, y exportar una constante desde un
 * archivo de componentes rompe la recarga en caliente.
 */
export type Estado = Enums<'quote_status'>;

export const ESTADOS: Record<Estado, string> = {
  draft: 'Borrador',
  sent: 'Enviada',
  negotiation: 'En negociación',
  approved: 'Aprobada',
  rejected: 'Rechazada',
  expired: 'Vencida',
  void: 'Anulada',
};

export const TONOS: Record<Estado, 'neutro' | 'positivo' | 'atencion'> = {
  draft: 'neutro',
  sent: 'neutro',
  negotiation: 'atencion',
  approved: 'positivo',
  rejected: 'atencion',
  expired: 'atencion',
  void: 'atencion',
};

/**
 * A dónde puede ir cada estado.
 *
 * Repite a propósito la tabla de `app.transicion_de_cotizacion`. La que manda
 * es la base: esto solo sirve para no ofrecer un botón que vaya a fallar. Si
 * las dos dejaran de coincidir, la base rechaza y la pantalla muestra el
 * motivo; nunca al revés.
 *
 * `sent` no aparece en ninguna lista porque a «enviada» no se llega cambiando
 * de estado: se llega emitiendo, que es lo que produce el documento.
 */
export const SIGUIENTES: Record<Estado, Estado[]> = {
  draft: ['void'],
  sent: ['negotiation', 'approved', 'rejected', 'expired', 'void'],
  negotiation: ['approved', 'rejected', 'expired', 'void'],
  approved: ['void'],
  rejected: ['void'],
  expired: ['void'],
  void: [],
};

/** Desde qué estados se puede emitir (o reemitir) una cotización. */
export const EMITIBLES: Estado[] = ['draft', 'sent', 'negotiation', 'rejected', 'expired'];

/** Anular es definitivo y exige motivo, así que se pregunta antes. */
export const EXIGEN_MOTIVO: Estado[] = ['void'];
