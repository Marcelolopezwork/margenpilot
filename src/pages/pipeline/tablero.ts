import { add, currencyOf, fromRow, zero, type CurrencyCode, type Money } from '../../lib/money';
import type { Estado } from '../comercial/estados';

/**
 * La aritmética del tablero, aparte de la pantalla.
 *
 * Se llama `tablero.ts` y no `pipeline.ts` por la trampa #19: dos archivos que
 * solo se diferencian en mayúsculas no pueden coexistir en un Mac, y
 * `Pipeline.tsx` ya ocupa ese nombre.
 *
 * Dos decisiones gobiernan este archivo, y las dos son sobre qué NO cuenta.
 *
 *  · **El tablero es lo que está en juego.** Una cotización rechazada, vencida
 *    o anulada está cerrada: no se trabaja. Se puede ver, porque lo que se
 *    perdió también se mira, pero no vive en las columnas de trabajo ni suma
 *    en la cifra de arriba.
 *  · **La cifra en juego es la que el cliente tiene en la mano**, es decir el
 *    neto de la última versión emitida. Un borrador no tiene ninguna, así que
 *    no aporta cifra: aporta un número de cotizaciones sin emitir, que es un
 *    dato distinto y se dice como tal. Inventarle un total sacado de las
 *    líneas de hoy sería contar dinero que nadie ha pedido todavía.
 */

/** Las columnas donde hay trabajo que hacer, en el orden en que se avanza. */
export const COLUMNAS: readonly Estado[] = ['draft', 'sent', 'negotiation', 'approved'];

/** Las que ya no se trabajan. Se ven si se piden; nunca suman en «en juego». */
export const CERRADAS: readonly Estado[] = ['rejected', 'expired', 'void'];

/** Qué se hace en cada columna. El rótulo dice el estado; esto dice la tarea. */
export const PARA_QUE: Record<Estado, string> = {
  draft: 'Se está armando. Hasta emitirla, el cliente no ha visto nada.',
  sent: 'El cliente la tiene. Lo que toca es saber si la leyó.',
  negotiation: 'Hay conversación. Lo que toca es cerrar o descartar.',
  approved: 'Ganada. Lo que queda es facturarla y cobrarla, en Finanzas.',
  rejected: 'Dijo que no.',
  expired: 'Se le pasó el plazo.',
  void: 'Anulada, con su motivo escrito.',
};

export interface TarjetaPipeline {
  id: string;
  number: string;
  status: Estado;
  currency_code: string;
  valid_until: string | null;
  cliente: string;
  /** El neto de la última versión emitida. Nulo si nunca se emitió. */
  neto: string | null;
  /** Margen de esa versión. Nulo si no se emitió o si el rol no ve costos. */
  margen: number | null;
  /** Cuándo se movió por última vez. Sin bitácora, cuándo se creó. */
  ultimoMovimiento: string;
}

export function enColumna(
  tarjetas: readonly TarjetaPipeline[],
  estado: Estado,
): TarjetaPipeline[] {
  return tarjetas.filter((t) => t.status === estado);
}

/**
 * Lo que de verdad está en juego: enviadas y en negociación.
 *
 * Un borrador no está en juego —no ha salido— y una aprobada ya no lo está:
 * está ganada y lo que queda es cobrarla, que es trabajo de Finanzas y vive
 * en «Por cobrar». Meter las dos en la misma cifra daría un número que no
 * sirve para decidir nada.
 */
export function enJuego(tarjetas: readonly TarjetaPipeline[]): TarjetaPipeline[] {
  return tarjetas.filter((t) => t.status === 'sent' || t.status === 'negotiation');
}

export interface ValorDeMoneda {
  moneda: CurrencyCode;
  total: Money;
  cuantas: number;
  /** Cuántas de ese grupo no tienen cifra porque nunca se emitieron. */
  sinEmitir: number;
}

/**
 * El valor por moneda, nunca sumado (INV-10). Las que no se emitieron se
 * cuentan aparte en vez de entrar como cero: cero y «todavía no se sabe» son
 * cosas distintas, y sumar la segunda como la primera hace que la cifra
 * parezca completa cuando no lo está.
 */
export function valorPorMoneda(tarjetas: readonly TarjetaPipeline[]): ValorDeMoneda[] {
  const grupos = new Map<CurrencyCode, { total: Money; cuantas: number; sinEmitir: number }>();

  for (const t of tarjetas) {
    let moneda: CurrencyCode;
    try {
      moneda = currencyOf(t.currency_code);
    } catch {
      continue;
    }
    const antes = grupos.get(moneda) ?? { total: zero(moneda), cuantas: 0, sinEmitir: 0 };
    grupos.set(moneda, {
      total: t.neto === null ? antes.total : add(antes.total, fromRow(t.neto, moneda)),
      cuantas: antes.cuantas + 1,
      sinEmitir: antes.sinEmitir + (t.neto === null ? 1 : 0),
    });
  }

  return [...grupos.entries()]
    .map(([moneda, g]) => ({ moneda, ...g }))
    .sort((a, b) => a.moneda.localeCompare(b.moneda));
}

const DIA = 86_400_000;

/** Días desde el último movimiento. Cuenta días completos, no horas. */
export function diasQuieta(tarjeta: TarjetaPipeline, hoy: string): number {
  const desde = Date.parse(`${tarjeta.ultimoMovimiento.slice(0, 10)}T00:00:00Z`);
  const hasta = Date.parse(`${hoy}T00:00:00Z`);
  if (Number.isNaN(desde) || Number.isNaN(hasta)) return 0;
  return Math.max(0, Math.round((hasta - desde) / DIA));
}

/**
 * Quieta es una cotización que está en juego y no se ha movido en dos
 * semanas. Un borrador parado no es un problema —nadie espera nada— y una
 * aprobada tampoco: ya se decidió.
 */
export function estaQuieta(tarjeta: TarjetaPipeline, hoy: string, umbral = 14): boolean {
  if (tarjeta.status !== 'sent' && tarjeta.status !== 'negotiation') return false;
  return diasQuieta(tarjeta, hoy) >= umbral;
}

/**
 * Una cotización cuyo plazo pasó y que sigue en juego. El estado «vencida» es
 * una decisión de una persona, así que la base no lo pone sola; lo que el
 * tablero puede hacer es dejar de disimularlo.
 */
export function vencidaSinMarcar(tarjeta: TarjetaPipeline, hoy: string): boolean {
  if (tarjeta.status !== 'sent' && tarjeta.status !== 'negotiation') return false;
  if (!tarjeta.valid_until) return false;
  return tarjeta.valid_until < hoy;
}
