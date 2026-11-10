/**
 * Dinero en Margen Pilot.
 *
 * Regla absoluta: un importe NUNCA es un `number`. Los números de coma flotante
 * de JavaScript no pueden representar 0.1 exactamente, y un sistema financiero
 * que los usa acumula error. Aquí el dinero es un `bigint` de unidades mínimas
 * (céntimos) más su moneda, y toda operación es exacta.
 *
 * Postgres entrega `numeric` como string precisamente para no perder precisión
 * en el camino: `fromDb` es la única puerta de entrada.
 *
 * Reglas implementadas, de docs/FINANCIAL_RULES.md §4:
 *   R-4.1  redondeo HALF_UP (0,005 → 0,01)
 *   R-4.2  se redondea al cerrar cada línea; el total es la suma de líneas ya
 *          redondeadas, nunca el redondeo de la suma
 *   R-4.3  el impuesto se calcula sobre el neto ya redondeado
 *   R-4.4  los decimales salen de la moneda, no de una constante
 *   INV-10 dos monedas no se suman nunca sin declarar la conversión
 */

export type CurrencyCode = 'PEN' | 'USD';

/** Decimales y símbolo por moneda (R-4.4). */
const CURRENCY: Record<CurrencyCode, { minorUnits: number; symbol: string }> = {
  PEN: { minorUnits: 2, symbol: 'S/' },
  USD: { minorUnits: 2, symbol: 'US$' },
};

export interface Money {
  /** Unidades mínimas. 1234n con minorUnits 2 son 12,34. */
  readonly minor: bigint;
  readonly currency: CurrencyCode;
}

const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;

export class MoneyError extends Error {}

/** División con redondeo HALF_UP, alejándose del cero (R-4.1). */
function divHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new MoneyError('división por cero');
  const negative = numerator < 0n !== denominator < 0n;
  const a = numerator < 0n ? -numerator : numerator;
  const b = denominator < 0n ? -denominator : denominator;
  const quotient = a / b;
  const remainder = a % b;
  const rounded = remainder * 2n >= b ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

/** Convierte un decimal en string a una fracción exacta. */
function toRatio(decimal: string): { numerator: bigint; denominator: bigint } {
  const match = DECIMAL.exec(decimal.trim());
  if (!match) throw new MoneyError(`valor decimal no válido: ${decimal}`);
  const sign = match[1] === '-' ? -1n : 1n;
  const whole = match[2] ?? '0';
  const fraction = match[3] ?? '';
  return {
    numerator: sign * BigInt(whole + fraction),
    denominator: 10n ** BigInt(fraction.length),
  };
}

/**
 * Única puerta de entrada desde la base de datos o desde un formulario.
 * Acepta separadores de miles por comodidad al teclear.
 */
export function fromDb(value: string, currency: CurrencyCode): Money {
  const cleaned = value.trim().replace(/,/g, '');
  const match = DECIMAL.exec(cleaned);
  if (!match) throw new MoneyError(`importe no válido: ${value}`);

  const { minorUnits } = CURRENCY[currency];
  const whole = match[2] ?? '0';
  const fraction = match[3] ?? '';

  const kept = (fraction + '0'.repeat(minorUnits)).slice(0, minorUnits);
  const dropped = fraction.slice(minorUnits);

  let minor = BigInt(whole + kept);
  // Si venían más decimales de los que admite la moneda, HALF_UP.
  const firstDropped = dropped.charAt(0);
  if (firstDropped !== '' && Number(firstDropped) >= 5) minor += 1n;

  return { minor: match[1] === '-' ? -minor : minor, currency };
}

/**
 * El código de moneda que llega de la base es un `string` cualquiera. Esto lo
 * convierte en una moneda conocida o falla en el acto: un importe sin moneda
 * cierta no es un importe, es un número suelto.
 */
export function currencyOf(code: string): CurrencyCode {
  const upper = code.trim().toUpperCase();
  if (upper in CURRENCY) return upper as CurrencyCode;
  throw new MoneyError(`moneda desconocida: ${code}`);
}

/**
 * La puerta por la que entra el dinero que viene de una fila de la base.
 *
 * PostgREST entrega las columnas `numeric` como **texto**, aunque los tipos
 * que genera Supabase las declaren `number` (ADR-33). Esta función acepta las
 * dos cosas y deja constancia de por qué: si algún día llegara de verdad un
 * `number`, la precisión ya se habría perdido antes de llegar aquí, así que
 * el `String()` no es una conversión sino la última red.
 */
export function fromRow(value: number | string, currency: CurrencyCode): Money {
  return fromDb(typeof value === 'string' ? value : String(value), currency);
}

export function zero(currency: CurrencyCode): Money {
  return { minor: 0n, currency };
}

/** Serializa para Postgres `numeric`. Siempre con todos los decimales. */
export function toDb(money: Money): string {
  const { minorUnits } = CURRENCY[money.currency];
  const negative = money.minor < 0n;
  const abs = (negative ? -money.minor : money.minor).toString().padStart(minorUnits + 1, '0');
  const whole = abs.slice(0, abs.length - minorUnits);
  const fraction = abs.slice(abs.length - minorUnits);
  return `${negative ? '-' : ''}${whole}${minorUnits > 0 ? `.${fraction}` : ''}`;
}

function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    // INV-10: esto no se "arregla" convirtiendo por detrás. Quien quiera sumar
    // monedas distintas tiene que pasar por convert() con tasa, fecha y fuente.
    throw new MoneyError(
      `no se pueden operar ${a.currency} y ${b.currency} sin una conversión declarada`,
    );
  }
}

export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { minor: a.minor + b.minor, currency: a.currency };
}

export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return { minor: a.minor - b.minor, currency: a.currency };
}

export function negate(money: Money): Money {
  return { minor: -money.minor, currency: money.currency };
}

export function isZero(money: Money): boolean {
  return money.minor === 0n;
}

export function compare(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b);
  return a.minor < b.minor ? -1 : a.minor > b.minor ? 1 : 0;
}

/**
 * Suma de líneas YA redondeadas (R-4.2). El total nunca se redondea aparte:
 * es exactamente esto.
 */
export function sumLines(lines: readonly Money[], currency: CurrencyCode): Money {
  return lines.reduce<Money>((total, line) => add(total, line), zero(currency));
}

/** Multiplica por una cantidad entera (p. ej. 12 horas). */
export function multiplyByQuantity(unit: Money, quantity: string): Money {
  const { numerator, denominator } = toRatio(quantity);
  return { minor: divHalfUp(unit.minor * numerator, denominator), currency: unit.currency };
}

/** Multiplica por un porcentaje expresado como decimal: "18" → 18 %. */
export function percentOf(base: Money, percent: string): Money {
  const { numerator, denominator } = toRatio(percent);
  return { minor: divHalfUp(base.minor * numerator, denominator * 100n), currency: base.currency };
}

/** Impuesto sobre el neto YA redondeado de la línea (R-4.3). */
export function taxOn(netLine: Money, taxRatePercent: string): Money {
  return percentOf(netLine, taxRatePercent);
}

/**
 * Conversión explícita entre monedas. Exige la tasa; quien la llama es
 * responsable de mostrar fecha y fuente junto a la cifra (D-5, ADR-14).
 * El resultado es SIEMPRE referencial: no se almacena.
 */
export function convert(money: Money, to: CurrencyCode, rate: string): Money {
  if (money.currency === to) return money;
  const { numerator, denominator } = toRatio(rate);
  if (numerator <= 0n) throw new MoneyError('la tasa de cambio debe ser positiva');
  return { minor: divHalfUp(money.minor * numerator, denominator), currency: to };
}

/** Formato es-PE: símbolo delante, coma de miles, punto decimal. */
export function format(money: Money, options?: { showCode?: boolean }): string {
  const { minorUnits, symbol } = CURRENCY[money.currency];
  const negative = money.minor < 0n;
  const abs = (negative ? -money.minor : money.minor).toString().padStart(minorUnits + 1, '0');
  const whole = abs.slice(0, abs.length - minorUnits).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fraction = abs.slice(abs.length - minorUnits);
  const body = minorUnits > 0 ? `${whole}.${fraction}` : whole;
  const code = options?.showCode ? ` ${money.currency}` : '';
  return `${negative ? '-' : ''}${symbol} ${body}${code}`;
}

/* ------------------------------------------------------------------ *
 * Rentabilidad
 *
 * margen y markup son RATIOS, no dinero, así que aquí sí se devuelve
 * `number`: son porcentajes para mostrar, nunca se acumulan ni se guardan
 * como importes. Son campos distintos y no se confunden jamás: es el error
 * exacto que tiene el cotizador actual, que guarda markup en un campo
 * llamado `margen_bruto`.
 * ------------------------------------------------------------------ */

/** margen = (precio neto − costo directo) / precio neto. Null si el precio es 0. */
export function marginPercent(netPrice: Money, directCost: Money): number | null {
  assertSameCurrency(netPrice, directCost);
  if (netPrice.minor === 0n) return null;
  const profit = netPrice.minor - directCost.minor;
  return (Number(profit) / Number(netPrice.minor)) * 100;
}

/** markup = (precio neto − costo directo) / costo directo. Null si el costo es 0. */
export function markupPercent(netPrice: Money, directCost: Money): number | null {
  assertSameCurrency(netPrice, directCost);
  if (directCost.minor === 0n) return null;
  const profit = netPrice.minor - directCost.minor;
  return (Number(profit) / Number(directCost.minor)) * 100;
}

/**
 * Margen de un grupo: Σ utilidad / Σ precio neto (ponderado).
 * PROHIBIDO promediar porcentajes: tres cotizaciones al 10 %, 50 % y 50 % no
 * dan 36,7 % si la primera es cien veces mayor. Dan 10,8 %.
 */
export function aggregateMarginPercent(
  rows: readonly { netPrice: Money; directCost: Money }[],
  currency: CurrencyCode,
): number | null {
  const totalNet = sumLines(
    rows.map((r) => r.netPrice),
    currency,
  );
  const totalCost = sumLines(
    rows.map((r) => r.directCost),
    currency,
  );
  return marginPercent(totalNet, totalCost);
}

/**
 * La tasa que de verdad aplicó el banco: lo que llegó entre lo que salió
 * (INV-5). No se teclea en ninguna parte, y por eso no puede estar mal. El
 * margen que el banco se quedó entre su tasa publicada y esta queda dentro de
 * la cifra, y eso es lo honesto: nadie sabe cómo lo repartió, así que no se
 * inventa.
 *
 * Seis decimales y aritmética entera. Una tasa que se enseña es una cifra, y
 * las cifras de este proyecto no pasan por `number`. Devuelve null cuando no
 * hay tasa que calcular: falta un lado, o alguno no es positivo.
 */
export function effectiveRate(from: Money, to: Money): string | null {
  if (from.minor <= 0n || to.minor <= 0n) return null;
  const escalaOrigen = 10n ** BigInt(CURRENCY[from.currency].minorUnits);
  const escalaDestino = 10n ** BigInt(CURRENCY[to.currency].minorUnits);
  const SEIS = 1_000_000n;
  const bruto = divHalfUp(to.minor * escalaOrigen * SEIS, from.minor * escalaDestino);
  const entero = bruto / SEIS;
  const resto = (bruto % SEIS).toString().padStart(6, '0');
  return `${entero}.${resto}`;
}

/**
 * El neto que hay dentro de un importe que ya lleva el impuesto (F3-6).
 *
 * En una factura de compra lo que viene escrito es el total: el proveedor
 * cobra 118 y el IGV va dentro. Para que el gasto sea el gasto y el IGV sea
 * crédito fiscal hay que partirlo hacia atrás, y hacerlo con la misma fórmula
 * que la base de datos: `round(total / (1 + tasa/100), decimales)`.
 *
 * Se calcula en enteros sobre la fracción exacta de la tasa, con un solo
 * redondeo al final. La base es la que manda —ella guarda la cifra—; esto
 * existe para que el formulario pueda enseñar el desglose mientras se teclea,
 * en vez de descubrirlo después de guardar.
 */
export function netFromGross(gross: Money, taxRatePercent: string): Money {
  const { numerator, denominator } = toRatio(taxRatePercent);
  if (numerator < 0n) throw new MoneyError('el impuesto no puede ser negativo');
  // neto = total / (1 + tasa/100) = total · 100·den / (100·den + num)
  return {
    minor: divHalfUp(gross.minor * 100n * denominator, 100n * denominator + numerator),
    currency: gross.currency,
  };
}
