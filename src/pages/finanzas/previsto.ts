/**
 * Lo previsto de una sola vez: la aritmética, sin pantalla.
 *
 * Un previsto es una fila de `payment_schedule_items` sin cotización detrás
 * (INV-15.4): un adelanto que te van a pasar, la cámara que pactaste para
 * enero, el anticipo al freelance. No es una cuota —no viene de una
 * cotización ni se convierte en factura—, no es un gasto fijo —no se repite—
 * y no es una compra —no hay factura de proveedor—.
 *
 * Lo único con enjundia que hay aquí es «cuánto falta», y está escrito una
 * vez: el importe previsto menos lo que ya se le asignó. Lo asignado está en
 * el saldo, así que contarlo otra vez sería contarlo dos veces.
 */

import { currencyOf, format, fromRow, subtract, zero, type CurrencyCode, type Money } from '../../lib/money';

/** Una fila de `payment_schedule_items` suelta, como llega de la base. */
export interface PrevistoEnBase {
  id: string;
  label: string;
  direction: string;
  due_date: string;
  amount: string | number;
  currency_code: string;
  status: string;
  quote_id: string | null;
  expected_cash_account_id: string | null;
}

export interface PrevistoEnLista {
  id: string;
  label: string;
  entra: boolean;
  fecha: string;
  moneda: CurrencyCode;
  previsto: Money;
  asignado: Money;
  pendiente: Money;
  saldado: boolean;
  /** Días de retraso respecto a hoy. Cero si todavía no le toca. */
  atraso: number;
  cuentaId: string | null;
}

const DIA = 86_400_000;

export function diasDesde(fecha: string, hoy: string): number {
  const d = Date.parse(`${fecha}T00:00:00Z`);
  const h = Date.parse(`${hoy}T00:00:00Z`);
  if (Number.isNaN(d) || Number.isNaN(h) || d >= h) return 0;
  return Math.round((h - d) / DIA);
}

/**
 * Junta cada previsto con lo que ya se le asignó.
 *
 * Un previsto en una moneda que el producto no conoce se queda fuera, igual
 * que en los demás lentes: adivinar la moneda de un importe es la forma más
 * rápida de enseñar una cifra falsa.
 */
export function enLista(
  previstos: readonly PrevistoEnBase[],
  asignado: ReadonlyMap<string, Money>,
  hoy: string,
): PrevistoEnLista[] {
  const salida: PrevistoEnLista[] = [];

  for (const p of previstos) {
    if (p.quote_id !== null) continue;

    let moneda: CurrencyCode;
    try {
      moneda = currencyOf(p.currency_code);
    } catch {
      continue;
    }

    const previsto = fromRow(p.amount, moneda);
    const ya = asignado.get(p.id) ?? zero(moneda);
    const falta = subtract(previsto, ya);
    const pendiente = falta.minor > 0n ? falta : zero(moneda);
    const saldado = p.status === 'settled' || pendiente.minor === 0n;

    salida.push({
      id: p.id,
      label: p.label,
      entra: p.direction !== 'out',
      fecha: p.due_date,
      moneda,
      previsto,
      asignado: ya,
      pendiente,
      saldado,
      atraso: saldado ? 0 : diasDesde(p.due_date, hoy),
      cuentaId: p.expected_cash_account_id,
    });
  }

  // Lo que ya venció primero, y después por fecha: es el orden en que hay que
  // hacer algo con ellos.
  return salida.sort((a, b) => {
    if (a.saldado !== b.saldado) return a.saldado ? 1 : -1;
    return a.fecha.localeCompare(b.fecha);
  });
}

export interface TotalPrevisto {
  moneda: CurrencyCode;
  entra: Money;
  sale: Money;
  cuantos: number;
}

/** Lo que falta por entrar y por salir, por moneda y sin mezclarlas (INV-10). */
export function totalesPrevistos(filas: readonly PrevistoEnLista[]): TotalPrevisto[] {
  const porMoneda = new Map<CurrencyCode, TotalPrevisto>();

  for (const f of filas) {
    if (f.saldado) continue;
    const previo =
      porMoneda.get(f.moneda) ??
      { moneda: f.moneda, entra: zero(f.moneda), sale: zero(f.moneda), cuantos: 0 };
    if (f.entra) previo.entra = { minor: previo.entra.minor + f.pendiente.minor, currency: f.moneda };
    else previo.sale = { minor: previo.sale.minor + f.pendiente.minor, currency: f.moneda };
    previo.cuantos += 1;
    porMoneda.set(f.moneda, previo);
  }

  return [...porMoneda.values()].sort((a, b) => a.moneda.localeCompare(b.moneda));
}

/** Una frase que dice qué es cada fila, para no depender del color. */
export function explica(fila: PrevistoEnLista): string {
  if (fila.saldado) {
    return `Saldado con ${format(fila.asignado)}`;
  }
  const verbo = fila.entra ? 'por cobrar' : 'por pagar';
  if (fila.asignado.minor > 0n) {
    return `${format(fila.pendiente)} ${verbo} de los ${format(fila.previsto)} previstos`;
  }
  return `${format(fila.pendiente)} ${verbo}`;
}

export const PARA_QUE =
  'Un cobro o un pago de una sola vez, con fecha, que no viene de una cotización ni de una factura: un adelanto, un equipo pactado. Entra en la proyección de trece semanas y desaparece de ella cuando el dinero se registra.';
