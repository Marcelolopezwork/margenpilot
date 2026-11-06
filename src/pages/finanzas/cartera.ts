import {
  add,
  compare,
  currencyOf,
  fromRow,
  subtract,
  zero,
  type CurrencyCode,
  type Money,
} from '../../lib/money';
import type { Enums } from '../../types/database';

/**
 * La aritmética de la cartera y de los saldos, aparte de la pantalla, porque
 * es lo que tiene que estar bien aunque la pantalla cambie.
 *
 * Dos reglas gobiernan este archivo:
 *
 *  · **Las monedas no se suman** (INV-10, ADR-16). Soles y dólares son dos
 *    libros. Todo lo que agrega aquí devuelve una cifra por moneda, nunca una
 *    sola; sumarlas requeriría un tipo de cambio, y un total con tipo de
 *    cambio escondido es un total que miente.
 *  · **Lo previsto no es cartera.** Una cuota `planned` no está aquí: entra en
 *    la proyección de caja, no en lo que se puede reclamar. Lo que se cuenta
 *    como «por cobrar» es un documento abierto.
 */

export type EstadoDocumento = Enums<'document_status'>;

export interface DocumentoEnCartera {
  id: string;
  series_number: string | null;
  issue_date: string;
  due_date: string | null;
  currency_code: string;
  amount_total: string;
  status: EstadoDocumento;
  cliente: string;
}

export interface SaldoDeCuenta {
  cash_account_id: string;
  currency_code: string;
  balance: string;
}

/** Cuánto de un documento ya está cobrado, sumando sus asignaciones vivas. */
export function pagadoDe(
  documento: DocumentoEnCartera,
  asignaciones: readonly { billing_document_id: string | null; amount: string }[],
): Money {
  const moneda = currencyOf(documento.currency_code);
  return asignaciones
    .filter((a) => a.billing_document_id === documento.id)
    .reduce((suma, a) => add(suma, fromRow(a.amount, moneda)), zero(moneda));
}

export function pendienteDe(documento: DocumentoEnCartera, pagado: Money): Money {
  const moneda = currencyOf(documento.currency_code);
  return subtract(fromRow(documento.amount_total, moneda), pagado);
}

/**
 * Un documento está vencido si su fecha de pago ya pasó y sigue debiendo algo.
 * Sin fecha de vencimiento no está vencido: está sin plazo, que no es lo
 * mismo que estar al día pero tampoco es un atraso que se pueda reclamar.
 */
export function vencido(documento: DocumentoEnCartera, hoy: string): boolean {
  if (!documento.due_date) return false;
  if (documento.status === 'paid' || documento.status === 'void') return false;
  return documento.due_date < hoy;
}

export function diasDeAtraso(documento: DocumentoEnCartera, hoy: string): number {
  if (!vencido(documento, hoy) || !documento.due_date) return 0;
  const ms = Date.parse(`${hoy}T00:00:00Z`) - Date.parse(`${documento.due_date}T00:00:00Z`);
  return Math.max(0, Math.round(ms / 86_400_000));
}

export interface TotalPorMoneda {
  moneda: CurrencyCode;
  total: Money;
  cuantos: number;
}

/**
 * Agrega importes por moneda. Una moneda que el producto no conoce se queda
 * fuera entera en vez de colarse en otro grupo: una cifra incompleta y
 * señalada es mejor que una cifra redonda y falsa.
 */
export function porMoneda(
  filas: readonly { currency_code: string; importe: string }[],
): TotalPorMoneda[] {
  const grupos = new Map<CurrencyCode, { total: Money; cuantos: number }>();

  for (const fila of filas) {
    let moneda: CurrencyCode;
    try {
      moneda = currencyOf(fila.currency_code);
    } catch {
      continue;
    }
    const antes = grupos.get(moneda) ?? { total: zero(moneda), cuantos: 0 };
    grupos.set(moneda, {
      total: add(antes.total, fromRow(fila.importe, moneda)),
      cuantos: antes.cuantos + 1,
    });
  }

  return [...grupos.entries()]
    .map(([moneda, { total, cuantos }]) => ({ moneda, total, cuantos }))
    .sort((a, b) => a.moneda.localeCompare(b.moneda));
}

/** Un saldo en rojo no es un error de cálculo: es una cuenta sobregirada. */
export function enRojo(saldo: Money): boolean {
  return compare(saldo, zero(saldo.currency)) < 0;
}

const NOMBRES: Record<EstadoDocumento, string> = {
  draft: 'borrador',
  open: 'por cobrar',
  partially_paid: 'cobrado a medias',
  paid: 'cobrado',
  void: 'anulado',
};

export function nombreEstadoDocumento(estado: EstadoDocumento): string {
  return NOMBRES[estado];
}

export function tonoEstadoDocumento(
  documento: DocumentoEnCartera,
  hoy: string,
): 'neutro' | 'positivo' | 'atencion' {
  if (documento.status === 'paid') return 'positivo';
  if (vencido(documento, hoy)) return 'atencion';
  return 'neutro';
}

const NOMBRES_TIPO: Record<Enums<'document_type'>, string> = {
  invoice: 'Factura',
  boleta: 'Boleta',
  receipt: 'Recibo',
  note: 'Nota',
  credit_note: 'Nota de crédito',
  other: 'Documento',
};

export function nombreTipoDocumento(tipo: Enums<'document_type'>): string {
  return NOMBRES_TIPO[tipo];
}

const NOMBRES_MOVIMIENTO: Record<Enums<'cash_kind'>, string> = {
  operating: 'Operativo',
  transfer: 'Transferencia',
  opening: 'Saldo de apertura',
  owner_draw: 'Retiro del dueño',
  owner_contribution: 'Aporte del dueño',
  loan_in: 'Préstamo recibido',
  loan_repayment: 'Pago de préstamo',
  bank_fee: 'Comisión del banco',
  tax_payment: 'Pago de impuestos',
  fx_adjustment: 'Diferencia de cambio',
  refund: 'Devolución',
};

export function nombreTipoMovimiento(tipo: Enums<'cash_kind'>): string {
  return NOMBRES_MOVIMIENTO[tipo];
}

/**
 * Los tipos que se ofrecen al dar de alta un movimiento a mano. La
 * transferencia no está: necesita dos patas atadas por una cabecera (INV-5) y
 * se hace desde su propia acción, no eligiendo «transferencia» en un
 * desplegable y dejando la otra mitad sin crear.
 */
export const TIPOS_A_MANO: readonly Enums<'cash_kind'>[] = [
  'operating',
  'bank_fee',
  'tax_payment',
  'opening',
  'owner_contribution',
  'owner_draw',
  'loan_in',
  'loan_repayment',
  'refund',
  'fx_adjustment',
];

/**
 * Los tipos que se ofrecen al emitir el documento de una cuota. Son los de
 * una venta de servicios: factura y boleta en Perú, recibo cuando no hay
 * comprobante fiscal. La nota de crédito no está porque no se emite desde una
 * cuota: corrige un documento anterior y llega con su propia acción.
 */
export const TIPOS_DE_VENTA: readonly Enums<'document_type'>[] = [
  'invoice',
  'boleta',
  'receipt',
];
