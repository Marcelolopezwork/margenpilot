import { add, currencyOf, fromRow, zero, type CurrencyCode, type Money } from '../../lib/money';
import type { Enums } from '../../types/database';

/**
 * La proyección de caja: qué entra, semana a semana.
 *
 * Es el lente **Caja** del plan, y la razón de que el cronograma de cobro
 * exista. Tres decisiones la gobiernan, y conviene que estén escritas aquí
 * porque las tres se pueden «arreglar» sin querer:
 *
 *  1. **Lo previsto cuenta.** Una cuota `planned` no es cartera —nadie la
 *     debe todavía— pero sí es caja esperada. Dejarla fuera haría que la
 *     proyección solo viera lo ya facturado, que es precisamente lo que no
 *     sirve para decidir si llegas a fin de mes.
 *  2. **Lo cobrado no cuenta.** Una cuota `settled` ya está en el saldo. Si
 *     además apareciera aquí, el dinero se contaría dos veces.
 *  3. **Lo atrasado no desaparece: cae en la primera semana.** Una cuota que
 *     venció y no se cobró sigue siendo dinero que esperas, y esperas ya.
 *     Dejarla en su semana pasada la escondería del gráfico; descartarla
 *     diría que no vas a cobrarla. Ninguna de las dos es verdad.
 *
 * Y la de siempre: cada moneda es una proyección aparte. Soles y dólares no
 * se suman nunca (INV-10).
 */

export interface CuotaEsperada {
  due_date: string;
  amount: string;
  currency_code: string;
  status: Enums<'schedule_status'>;
}

export interface SemanaDeCaja {
  /** El lunes de la semana, en ISO. */
  desde: string;
  entra: Money;
  cuotas: number;
  /** Cuánto de lo que entra esta semana ya venció. Solo la primera lo tiene. */
  atrasado: Money;
}

const DIA = 86_400_000;

function aFecha(iso: string): number {
  return Date.parse(`${iso}T00:00:00Z`);
}

function aIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** El lunes de la semana a la que pertenece esa fecha. */
export function lunesDe(iso: string): string {
  const ms = aFecha(iso);
  const dia = new Date(ms).getUTCDay(); // 0 domingo … 6 sábado
  return aIso(ms - ((dia + 6) % 7) * DIA);
}

export function sumarSemanas(iso: string, semanas: number): string {
  return aIso(aFecha(iso) + semanas * 7 * DIA);
}

/**
 * Las trece semanas que vienen, contando desde el lunes de la semana de
 * `hoy`. Trece y no doce porque es el trimestre más la semana en curso: es el
 * horizonte en el que una agencia de servicios puede hacer algo con lo que
 * ve.
 */
export function proyeccion(
  cuotas: readonly CuotaEsperada[],
  moneda: CurrencyCode,
  hoy: string,
  semanas = 13,
): SemanaDeCaja[] {
  const primera = lunesDe(hoy);
  const fin = sumarSemanas(primera, semanas);

  const vacias: SemanaDeCaja[] = [];
  for (let i = 0; i < semanas; i += 1) {
    vacias.push({
      desde: sumarSemanas(primera, i),
      entra: zero(moneda),
      cuotas: 0,
      atrasado: zero(moneda),
    });
  }

  for (const cuota of cuotas) {
    if (cuota.status === 'settled' || cuota.status === 'cancelled') continue;
    let suya: CurrencyCode;
    try {
      suya = currencyOf(cuota.currency_code);
    } catch {
      continue;
    }
    if (suya !== moneda) continue;
    if (cuota.due_date >= fin) continue;

    const atrasada = cuota.due_date < primera;
    const lunes = atrasada ? primera : lunesDe(cuota.due_date);
    const indice = vacias.findIndex((s) => s.desde === lunes);
    const semana = vacias[indice];
    if (!semana) continue;

    let importe: Money;
    try {
      importe = fromRow(cuota.amount, moneda);
    } catch {
      continue;
    }

    vacias[indice] = {
      desde: semana.desde,
      entra: add(semana.entra, importe),
      cuotas: semana.cuotas + 1,
      atrasado: atrasada ? add(semana.atrasado, importe) : semana.atrasado,
    };
  }

  return vacias;
}

/**
 * El saldo proyectado al final de cada semana, partiendo del saldo de hoy.
 * Solo suma entradas: las salidas futuras llegan con los gastos recurrentes y
 * las compras, y una proyección que solo tiene ingresos es optimista por
 * construcción. Hay que decirlo en pantalla, no esconderlo.
 */
export function saldoProyectado(hoy: Money, semanas: readonly SemanaDeCaja[]): Money[] {
  const salida: Money[] = [];
  let acumulado = hoy;
  for (const semana of semanas) {
    acumulado = add(acumulado, semana.entra);
    salida.push(acumulado);
  }
  return salida;
}

/** Las monedas que de verdad aparecen, para no dibujar una proyección vacía. */
export function monedasConCuotas(cuotas: readonly CuotaEsperada[]): CurrencyCode[] {
  const vistas = new Set<CurrencyCode>();
  for (const cuota of cuotas) {
    if (cuota.status === 'settled' || cuota.status === 'cancelled') continue;
    try {
      vistas.add(currencyOf(cuota.currency_code));
    } catch {
      continue;
    }
  }
  return [...vistas].sort((a, b) => a.localeCompare(b));
}
