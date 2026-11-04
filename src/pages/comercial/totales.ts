/**
 * La aritmética de una cotización, en un solo sitio.
 *
 * La usan el editor y la propuesta. Si cada pantalla sumara por su cuenta,
 * tarde o temprano una diría 9.440 y la otra 9.440,01, y el cliente vería las
 * dos. Esto no es un detalle de estilo: es la razón por la que existe el
 * producto.
 *
 * R-4.2: se redondea al cerrar cada línea y el total es la suma de líneas ya
 * redondeadas. R-4.3: el impuesto va sobre el neto ya redondeado de la línea.
 */

import { add, fromRow, multiplyByQuantity, sumLines, taxOn } from '../../lib/money';
import type { CurrencyCode, Money } from '../../lib/money';

export type FilaCotizada = { unit_price: number; quantity: number };

export function netoDeLinea(l: FilaCotizada, moneda: CurrencyCode): Money {
  return multiplyByQuantity(fromRow(l.unit_price, moneda), String(l.quantity));
}

export function totalesDe(
  filas: FilaCotizada[],
  moneda: CurrencyCode,
  tasaPct: number | string,
  impuestoAplicado: boolean,
): { neto: Money; impuesto: Money; total: Money } {
  const neto = sumLines(
    filas.map((l) => netoDeLinea(l, moneda)),
    moneda,
  );
  // La casilla manda: sin ella la tasa sigue guardada pero no se aplica.
  const tasa = impuestoAplicado ? String(tasaPct) : '0';
  const impuesto = sumLines(
    filas.map((l) => taxOn(netoDeLinea(l, moneda), tasa)),
    moneda,
  );
  return { neto, impuesto, total: add(neto, impuesto) };
}

/**
 * La frase que va bajo el precio.
 *
 * Una entidad sin impuesto no tiene nada que excluir: decirle a un cliente de
 * Estados Unidos que el precio «no incluye IGV» sería mentirle con buenos
 * modales.
 */
export function notaDeImpuesto(
  impuestoAplicado: boolean,
  tasaPct: number | string,
  etiqueta: string,
): string {
  if (Number(tasaPct) <= 0) return 'Precio final. No se aplica impuesto.';
  return impuestoAplicado ? `Precio incluye ${etiqueta}.` : `Precio no incluye ${etiqueta}.`;
}
