/**
 * La aritmética del cronograma de cobro.
 *
 * Está separada de la pantalla porque es donde se puede perder un céntimo.
 * Repartir 11.307,94 en tres no da tres cifras iguales, y si el resto se
 * pierde, la base rechaza el cronograma entero: `guardar_cronograma` exige
 * que las cuotas sumen exactamente el total de la versión aprobada.
 *
 * Todo lo que aquí se suma pasa por `money.ts`, en unidades mínimas. Repartir
 * con números decimales de JavaScript es justo la forma de que falten dos
 * céntimos en la última cuota.
 */

import { add, fromDb, MoneyError, subtract, toDb, zero } from '../../lib/money';
import type { CurrencyCode, Money } from '../../lib/money';

export type EstadoCuota = 'planned' | 'documented' | 'settled' | 'cancelled';

/** Una fila tal como se edita en pantalla: importes y fechas como texto. */
export interface FilaCuota {
  /** Nulo mientras la cuota no se ha guardado nunca. */
  id: string | null;
  label: string;
  due_date: string;
  amount: string;
  cash_account_id: string;
  status: EstadoCuota;
}

/** Las que ya tienen documento o cobro no se editan ni se reparten. */
export function estaCongelada(estado: EstadoCuota): boolean {
  return estado === 'documented' || estado === 'settled';
}

/**
 * Reparte un importe en partes iguales sin perder nada.
 *
 * El resto va a la última cuota, que es la convención de toda la vida en un
 * cronograma de pagos: 11.307,94 en tres son 3.769,31 · 3.769,31 · 3.769,32.
 * Lo que importa es que la suma vuelva a dar el total exacto.
 */
export function repartir(total: Money, partes: number): Money[] {
  if (!Number.isInteger(partes) || partes < 1) {
    throw new MoneyError(`no se puede repartir en ${partes} partes`);
  }
  const n = BigInt(partes);
  const base = total.minor / n;
  const cuotas: Money[] = [];
  for (let i = 0; i < partes - 1; i += 1) {
    cuotas.push({ minor: base, currency: total.currency });
  }
  cuotas.push({ minor: total.minor - base * BigInt(partes - 1), currency: total.currency });
  return cuotas;
}

/**
 * Suma lo que hay escrito en pantalla.
 *
 * Devuelve `null` si algún importe no se entiende, en vez de tratarlo como
 * cero: un campo a medio teclear no es una cuota de cero soles, y decir
 * «cuadra» mientras uno está vacío sería mentir.
 */
export function sumaDe(filas: readonly { amount: string }[], moneda: CurrencyCode): Money | null {
  let total = zero(moneda);
  for (const f of filas) {
    if (f.amount.trim() === '') return null;
    try {
      total = add(total, fromDb(f.amount, moneda));
    } catch {
      return null;
    }
  }
  return total;
}

/** Lo que falta por repartir. Negativo si se pasó. */
export function diferencia(suma: Money, total: Money): Money {
  return subtract(total, suma);
}

/**
 * La misma fecha, n meses más tarde.
 *
 * Si el día no existe en el mes de destino —un 31 de enero a un mes— cae al
 * último día del mes, en vez de saltar al 3 de marzo como haría `setMonth`.
 */
export function mesesDespues(iso: string, meses: number): string {
  const [a, m, d] = iso.split('-').map(Number);
  if (!a || !m || !d) return iso;
  const destino = m - 1 + meses;
  const anio = a + Math.floor(destino / 12);
  const mes = ((destino % 12) + 12) % 12;
  const ultimo = new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate();
  const dia = Math.min(d, ultimo);
  return `${String(anio).padStart(4, '0')}-${String(mes + 1).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

/** La fecha de hoy en el formato que espera un `<input type="date">`. */
export function hoyIso(): string {
  const ahora = new Date();
  return `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}-${String(ahora.getDate()).padStart(2, '0')}`;
}

/**
 * Arma un reparto en n cuotas mensuales desde una fecha.
 *
 * Es lo que hay detrás de los botones «50 / 50» y «3 cuotas». El nombre de
 * cada cuota se escribe aquí para que el cliente lea «Anticipo 50 %» y no
 * «Cuota 1», que no dice nada.
 */
export function reparto(
  total: Money,
  partes: number,
  desde: string,
  congeladas: readonly FilaCuota[] = [],
): FilaCuota[] {
  const importes = repartir(total, partes);
  return importes.map((importe, i) => ({
    id: null,
    label: etiqueta(i, partes, congeladas.length),
    due_date: mesesDespues(desde, i),
    amount: toDb(importe),
    cash_account_id: '',
    status: 'planned' as const,
  }));
}

function etiqueta(indice: number, partes: number, yaCongeladas: number): string {
  if (partes === 1 && yaCongeladas === 0) return 'Pago único';
  if (indice === 0 && yaCongeladas === 0 && partes === 2) return 'Anticipo 50 %';
  if (indice === partes - 1 && yaCongeladas === 0 && partes === 2) return 'Contra entrega';
  return `Cuota ${indice + 1 + yaCongeladas} de ${partes + yaCongeladas}`;
}
