/**
 * El margen de un conjunto de cotizaciones.
 *
 * La regla §2.3, que es de las que no se negocian: el margen de un grupo es
 * **Σ utilidad / Σ precio neto**, nunca el promedio de los porcentajes. Tres
 * cotizaciones al 10 %, 50 % y 50 % no dan 36,7 % si la primera es cien veces
 * mayor que las otras: dan 10,8 %. Promediar porcentajes es la forma más
 * educada de creer que se gana el triple de lo que se gana.
 *
 * Y la segunda regla, INV-10: dos monedas no se suman. Un listado con
 * cotizaciones en soles y en dólares no tiene **un** margen, tiene dos. Por
 * eso esto devuelve una fila por moneda y no una cifra.
 */

import { aggregateMarginPercent, currencyOf, fromRow, sumLines } from '../../lib/money';
import type { CurrencyCode, Money } from '../../lib/money';

/** Una versión emitida, tal como llega de la base. */
export interface VersionConCosto {
  quote_id: string;
  version_no: number;
  moneda: string;
  /** Precio neto, antes de impuesto. El margen no se calcula sobre el IGV. */
  neto: string;
  costo: string;
}

export interface MargenDeMoneda {
  moneda: CurrencyCode;
  neto: Money;
  costo: Money;
  utilidad: Money;
  /** Null cuando el neto es cero: no hay porcentaje que calcular. */
  margen: number | null;
  cuantas: number;
}

/**
 * De todas las versiones de una cotización, la última.
 *
 * Es la que el cliente tiene en la mano. Sumar todas las versiones contaría
 * la misma cotización tantas veces como se haya reemitido.
 */
export function ultimaPorCotizacion(filas: readonly VersionConCosto[]): VersionConCosto[] {
  const porCotizacion = new Map<string, VersionConCosto>();
  for (const f of filas) {
    const previa = porCotizacion.get(f.quote_id);
    if (!previa || f.version_no > previa.version_no) porCotizacion.set(f.quote_id, f);
  }
  return [...porCotizacion.values()];
}

export function margenPorMoneda(filas: readonly VersionConCosto[]): MargenDeMoneda[] {
  const porMoneda = new Map<CurrencyCode, VersionConCosto[]>();
  for (const f of filas) {
    let moneda: CurrencyCode;
    try {
      moneda = currencyOf(f.moneda);
    } catch {
      // Una moneda que el producto no conoce no se adivina ni se mete en otro
      // montón: se queda fuera del resumen.
      continue;
    }
    const grupo = porMoneda.get(moneda);
    if (grupo) grupo.push(f);
    else porMoneda.set(moneda, [f]);
  }

  return [...porMoneda.entries()]
    .map(([moneda, grupo]) => {
      const importes = grupo.map((f) => ({
        netPrice: fromRow(f.neto, moneda),
        directCost: fromRow(f.costo, moneda),
      }));
      const neto = sumLines(
        importes.map((i) => i.netPrice),
        moneda,
      );
      const costo = sumLines(
        importes.map((i) => i.directCost),
        moneda,
      );
      return {
        moneda,
        neto,
        costo,
        utilidad: { minor: neto.minor - costo.minor, currency: moneda },
        margen: aggregateMarginPercent(importes, moneda),
        cuantas: grupo.length,
      };
    })
    .sort((a, b) => a.moneda.localeCompare(b.moneda));
}
