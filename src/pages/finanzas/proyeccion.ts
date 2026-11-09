import {
  add,
  currencyOf,
  fromRow,
  subtract,
  zero,
  type CurrencyCode,
  type Money,
} from '../../lib/money';
import type { Enums } from '../../types/database';

/**
 * La proyección de caja: qué entra y qué sale, semana a semana.
 *
 * Es el lente **Caja** del plan y la razón de que existan el cronograma de
 * cobro y los gastos recurrentes. Cuatro decisiones la gobiernan, y las cuatro
 * se pueden «arreglar» sin querer:
 *
 *  1. **Lo previsto cuenta.** Una cuota `planned` no es cartera —nadie la debe
 *     todavía— pero sí es caja esperada. Dejarla fuera haría que la proyección
 *     solo viera lo ya facturado, que es precisamente lo que no sirve para
 *     decidir si llegas a fin de mes.
 *  2. **Lo cobrado y lo pagado no cuentan.** Ya están en el saldo. Si además
 *     apareciesen aquí, el dinero se contaría dos veces.
 *  3. **Lo atrasado no desaparece: cae en la primera semana y se señala.** Una
 *     cuota que venció sin cobrarse sigue siendo dinero que esperas, y lo
 *     esperas ya. Dejarla en su semana pasada la escondería; descartarla diría
 *     que no vas a cobrarla. Lo mismo con una suscripción que debías pagar el
 *     mes pasado.
 *  4. **Un gasto recurrente es una regla, no dinero.** No existe como
 *     movimiento hasta que se paga. Aquí se expande en las fechas que le
 *     tocan, y la ocurrencia cuyo periodo ya tiene un pago registrado
 *     desaparece: si no, el mes pagado seguiría apareciendo como pendiente.
 *
 * Y la de siempre: cada moneda es una proyección aparte (INV-10).
 */

export interface CuotaEsperada {
  due_date: string;
  amount: string;
  currency_code: string;
  status: Enums<'schedule_status'>;
}

export interface GastoRecurrente {
  id: string;
  label: string;
  amount: string;
  currency_code: string;
  cadence: Enums<'recurrence'>;
  day_of_month: number | null;
  starts_on: string;
  ends_on: string | null;
  is_active: boolean;
  /**
   * El día en que el gasto se anotó en el sistema, en ISO.
   *
   * Hace falta porque `starts_on` es cuándo empezó la suscripción en la vida
   * real, y puede ser de hace años. Sin este tope, cargar hoy el hosting que
   * pagas desde enero haría aparecer diez meses «sin pagar»: el sistema no
   * tiene ni una prueba de que no se pagaran, y presumir que no se pagaron es
   * inventar deuda. Antes de anotarlo no hay información; después, la
   * ausencia de un pago sí significa algo.
   */
  recorded_on: string;
}

/** Un pago ya registrado, para no proyectar dos veces el mismo mes. */
export interface PagoRegistrado {
  recurring_expense_id: string | null;
  value_date: string;
  is_void: boolean;
}

export interface SalidaEsperada {
  gasto: string;
  label: string;
  due_date: string;
  amount: string;
  currency_code: string;
}

export interface SemanaDeCaja {
  /** El lunes de la semana, en ISO. */
  desde: string;
  entra: Money;
  sale: Money;
  neto: Money;
  cuotas: number;
  gastos: number;
  /** Cuánto de lo que entra esta semana ya venció. Solo la primera lo tiene. */
  entraVencido: Money;
  /** Cuánto de lo que sale esta semana ya debía haberse pagado. */
  saleVencido: Money;
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
 * Una fecha en el mes indicado, recortando el día al último que exista. Un
 * gasto que se cobra el 31 no se salta febrero: se cobra el 28. Y marzo vuelve
 * a ser el 31, porque el día de referencia no se degrada de un mes al
 * siguiente.
 */
function fechaEnMes(anio: number, mes: number, dia: number): string {
  const anioReal = anio + Math.floor(mes / 12);
  const mesReal = ((mes % 12) + 12) % 12;
  const ultimo = new Date(Date.UTC(anioReal, mesReal + 1, 0)).getUTCDate();
  return new Date(Date.UTC(anioReal, mesReal, Math.min(dia, ultimo)))
    .toISOString()
    .slice(0, 10);
}

const PASO_EN_MESES: Record<Enums<'recurrence'>, number> = {
  weekly: 0,
  monthly: 1,
  quarterly: 3,
  yearly: 12,
};

/**
 * El periodo al que pertenece una fecha, según la cadencia. Es la clave que
 * decide si una ocurrencia ya está pagada: si pagaste el hosting de noviembre
 * el día 3 o el día 27, el mes está saldado igual.
 */
export function periodoDe(iso: string, cadencia: Enums<'recurrence'>): string {
  const anio = iso.slice(0, 4);
  const mes = Number(iso.slice(5, 7));
  if (cadencia === 'yearly') return anio;
  if (cadencia === 'quarterly') return `${anio}-T${Math.ceil(mes / 3)}`;
  if (cadencia === 'weekly') return lunesDe(iso);
  return iso.slice(0, 7);
}

/** Tope de vueltas: trece semanas no dan para más, y evita un bucle infinito. */
const MAX_OCURRENCIAS = 500;

/**
 * Las fechas en que toca pagar ese gasto dentro de la ventana [desde, hasta).
 * Un gasto archivado no genera ninguna.
 */
export function ocurrencias(gasto: GastoRecurrente, desde: string, hasta: string): string[] {
  if (!gasto.is_active) return [];

  const fechas: string[] = [];
  const fin = gasto.ends_on && gasto.ends_on < hasta ? gasto.ends_on : hasta;
  // La ventana nunca empieza antes de que el gasto existiera ni antes de que
  // se anotara: ver `recorded_on`.
  const inicio = [desde, gasto.starts_on, gasto.recorded_on].reduce((a, b) => (a > b ? a : b));

  if (gasto.cadence === 'weekly') {
    let ms = aFecha(gasto.starts_on);
    for (let i = 0; i < MAX_OCURRENCIAS; i += 1) {
      const fecha = aIso(ms);
      if (fecha >= fin) break;
      if (fecha >= inicio) fechas.push(fecha);
      ms += 7 * DIA;
    }
    return fechas;
  }

  const paso = PASO_EN_MESES[gasto.cadence];
  const anio = Number(gasto.starts_on.slice(0, 4));
  const mes = Number(gasto.starts_on.slice(5, 7)) - 1;
  const dia = gasto.day_of_month ?? Number(gasto.starts_on.slice(8, 10));

  for (let i = 0; i < MAX_OCURRENCIAS; i += 1) {
    const fecha = fechaEnMes(anio, mes + i * paso, dia);
    if (fecha >= fin) break;
    if (fecha >= inicio) fechas.push(fecha);
  }

  return fechas;
}

/**
 * Las salidas esperadas en la ventana, ya descontadas las que están pagadas.
 * Lo atrasado se incluye: `desde` puede ser muy anterior a hoy y la proyección
 * decide después en qué semana ponerlo.
 */
export function salidasEsperadas(
  gastos: readonly GastoRecurrente[],
  pagos: readonly PagoRegistrado[],
  desde: string,
  hasta: string,
): SalidaEsperada[] {
  const salidas: SalidaEsperada[] = [];

  for (const gasto of gastos) {
    const periodosPagados = new Set(
      pagos
        .filter((p) => !p.is_void && p.recurring_expense_id === gasto.id)
        .map((p) => periodoDe(p.value_date, gasto.cadence)),
    );

    for (const fecha of ocurrencias(gasto, desde, hasta)) {
      if (periodosPagados.has(periodoDe(fecha, gasto.cadence))) continue;
      salidas.push({
        gasto: gasto.id,
        label: gasto.label,
        due_date: fecha,
        amount: gasto.amount,
        currency_code: gasto.currency_code,
      });
    }
  }

  return salidas;
}

/**
 * Las trece semanas que vienen, contando desde el lunes de la semana de `hoy`.
 * Trece y no doce porque es el trimestre más la semana en curso: es el
 * horizonte en el que una agencia de servicios puede hacer algo con lo que ve.
 */
export function proyeccion(
  cuotas: readonly CuotaEsperada[],
  salidas: readonly SalidaEsperada[],
  moneda: CurrencyCode,
  hoy: string,
  semanas = 13,
): SemanaDeCaja[] {
  const primera = lunesDe(hoy);
  const fin = sumarSemanas(primera, semanas);
  const cero = zero(moneda);

  const resultado: SemanaDeCaja[] = [];
  for (let i = 0; i < semanas; i += 1) {
    resultado.push({
      desde: sumarSemanas(primera, i),
      entra: cero,
      sale: cero,
      neto: cero,
      cuotas: 0,
      gastos: 0,
      entraVencido: cero,
      saleVencido: cero,
    });
  }

  const indiceDe = (fecha: string): number | null => {
    const lunes = fecha < primera ? primera : lunesDe(fecha);
    const i = resultado.findIndex((s) => s.desde === lunes);
    return i < 0 ? null : i;
  };

  const importeDe = (valor: string): Money | null => {
    try {
      return fromRow(valor, moneda);
    } catch {
      return null;
    }
  };

  const mismaMoneda = (codigo: string): boolean => {
    try {
      return currencyOf(codigo) === moneda;
    } catch {
      return false;
    }
  };

  for (const cuota of cuotas) {
    if (cuota.status === 'settled' || cuota.status === 'cancelled') continue;
    if (!mismaMoneda(cuota.currency_code)) continue;
    if (cuota.due_date >= fin) continue;

    const i = indiceDe(cuota.due_date);
    const semana = i === null ? undefined : resultado[i];
    if (i === null || !semana) continue;

    const importe = importeDe(cuota.amount);
    if (!importe) continue;

    const vencida = cuota.due_date < primera;
    resultado[i] = {
      ...semana,
      entra: add(semana.entra, importe),
      cuotas: semana.cuotas + 1,
      entraVencido: vencida ? add(semana.entraVencido, importe) : semana.entraVencido,
    };
  }

  for (const salida of salidas) {
    if (!mismaMoneda(salida.currency_code)) continue;
    if (salida.due_date >= fin) continue;

    const i = indiceDe(salida.due_date);
    const semana = i === null ? undefined : resultado[i];
    if (i === null || !semana) continue;

    const importe = importeDe(salida.amount);
    if (!importe) continue;

    const vencida = salida.due_date < primera;
    resultado[i] = {
      ...semana,
      sale: add(semana.sale, importe),
      gastos: semana.gastos + 1,
      saleVencido: vencida ? add(semana.saleVencido, importe) : semana.saleVencido,
    };
  }

  return resultado.map((s) => ({ ...s, neto: subtract(s.entra, s.sale) }));
}

/**
 * El saldo proyectado al final de cada semana, partiendo del saldo de hoy.
 * Ahora que hay salidas, esto ya puede bajar: una semana con más gastos que
 * cobros resta, y ver dónde cruza el cero es justamente para lo que sirve.
 */
export function saldoProyectado(hoy: Money, semanas: readonly SemanaDeCaja[]): Money[] {
  const salida: Money[] = [];
  let acumulado = hoy;
  for (const semana of semanas) {
    acumulado = add(acumulado, semana.neto);
    salida.push(acumulado);
  }
  return salida;
}

/** Las monedas que de verdad aparecen, para no dibujar una proyección vacía. */
export function monedasConMovimiento(
  cuotas: readonly CuotaEsperada[],
  salidas: readonly SalidaEsperada[],
): CurrencyCode[] {
  const vistas = new Set<CurrencyCode>();
  for (const cuota of cuotas) {
    if (cuota.status === 'settled' || cuota.status === 'cancelled') continue;
    try {
      vistas.add(currencyOf(cuota.currency_code));
    } catch {
      continue;
    }
  }
  for (const salida of salidas) {
    try {
      vistas.add(currencyOf(salida.currency_code));
    } catch {
      continue;
    }
  }
  return [...vistas].sort((a, b) => a.localeCompare(b));
}

const NOMBRES_CADENCIA: Record<Enums<'recurrence'>, string> = {
  weekly: 'cada semana',
  monthly: 'cada mes',
  quarterly: 'cada trimestre',
  yearly: 'cada año',
};

export function nombreCadencia(cadencia: Enums<'recurrence'>): string {
  return NOMBRES_CADENCIA[cadencia];
}

export const CADENCIAS: readonly Enums<'recurrence'>[] = [
  'monthly',
  'quarterly',
  'yearly',
  'weekly',
];
