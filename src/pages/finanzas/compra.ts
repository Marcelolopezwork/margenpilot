import {
  add,
  currencyOf,
  fromRow,
  netFromGross,
  subtract,
  zero,
  type Money,
} from '../../lib/money';
import type { Enums } from '../../types/database';

/**
 * Lo que se puede saber de una compra sin pintar nada.
 *
 * La idea que gobierna este archivo es que **el IGV que pagas no es tu gasto**.
 * Es crédito fiscal: sale de tu cuenta y vuelve contra el IGV que cobraste. Si
 * se sumara al gasto, el resultado de cada mes saldría más bajo de lo que es,
 * todos los meses y sin que nada avisara.
 *
 * Por eso aquí el total, el neto y el impuesto son tres cifras distintas y
 * ninguna función las confunde.
 */

export interface CompraEnCartera {
  id: string;
  series_number: string | null;
  description: string | null;
  doc_type: Enums<'document_type'>;
  issue_date: string;
  due_date: string | null;
  currency_code: string;
  amount_total: string;
  amount_net: string;
  amount_tax: string;
  tax_rate: string | null;
  status: Enums<'document_status'>;
  legal_entity_id: string;
  proveedor: string;
  categoria: string | null;
}

/**
 * Los comprobantes que se reciben. La nota de crédito no está: no es una
 * compra, es la corrección de una anterior, y meterla aquí sumaría un gasto
 * donde hubo una devolución.
 */
export const TIPOS_DE_COMPRA: readonly Enums<'document_type'>[] = [
  'invoice',
  'boleta',
  'receipt',
  'other',
];

const NOMBRES: Record<Enums<'document_status'>, string> = {
  draft: 'borrador',
  open: 'por pagar',
  partially_paid: 'pagada a medias',
  paid: 'pagada',
  void: 'anulada',
};

/**
 * El mismo enum, otras palabras. Un documento `open` es «por cobrar» si lo
 * emitiste y «por pagar» si lo recibiste, y llamar a los dos igual es lo que
 * hace que alguien lea la cifra al revés.
 */
export function nombreEstadoCompra(estado: Enums<'document_status'>): string {
  return NOMBRES[estado];
}

export interface Desglose {
  neto: Money;
  impuesto: Money;
}

/** Parte un total que lleva el impuesto dentro, como lo parte la base. */
export function desglose(total: Money, tasa: string): Desglose {
  const neto = netFromGross(total, tasa);
  return { neto, impuesto: subtract(total, neto) };
}

/** Lo que falta por pagar de una compra. */
export function pendienteDeCompra(compra: CompraEnCartera, pagado: Money): Money {
  return subtract(fromRow(compra.amount_total, currencyOf(compra.currency_code)), pagado);
}

/**
 * El concepto legible. El número de serie no lo es: «F001-1234» no dice en qué
 * se fue el dinero, y dentro de tres meses es lo único que queda.
 */
export function conceptoDeCompra(compra: CompraEnCartera): string {
  const escrito = (compra.description ?? '').trim();
  if (escrito) return escrito;
  const serie = (compra.series_number ?? '').trim();
  if (serie) return serie;
  return 'Compra sin número';
}

/** El IGV de un grupo de compras, que es crédito fiscal y no gasto. */
export function impuestoDe(compras: readonly CompraEnCartera[], moneda: string): Money {
  const codigo = currencyOf(moneda);
  return compras
    .filter((c) => c.currency_code === moneda)
    .reduce((suma, c) => add(suma, fromRow(c.amount_tax, codigo)), zero(codigo));
}

/**
 * Una compra sin fecha de vencimiento no está vencida: está sin plazo. No es
 * lo mismo que estar al día, pero tampoco es un atraso que el proveedor pueda
 * reclamar, y pintarla en rojo sería inventarse una urgencia.
 */
export function vencidaDesde(compra: CompraEnCartera, hoy: string): number {
  if (!compra.due_date) return 0;
  if (compra.status === 'paid' || compra.status === 'void') return 0;
  if (compra.due_date >= hoy) return 0;
  const ms = Date.parse(`${hoy}T00:00:00Z`) - Date.parse(`${compra.due_date}T00:00:00Z`);
  return Math.max(0, Math.round(ms / 86_400_000));
}

/**
 * Los proveedores que ya existen, para ofrecerlos al teclear. Se comparan
 * normalizados porque «Movistar» y «movistar » son el mismo proveedor, y la
 * base lo impone con un índice único sobre el nombre normalizado.
 */
export function yaExisteProveedor(
  nombre: string,
  proveedores: readonly { name: string }[],
): boolean {
  const buscado = nombre.trim().toLowerCase();
  if (!buscado) return false;
  return proveedores.some((p) => p.name.trim().toLowerCase() === buscado);
}
