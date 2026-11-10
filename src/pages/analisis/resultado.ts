/**
 * El lente Resultado: cuánto deja el negocio, sin contar nada dos veces.
 *
 * La regla de qué entra y qué no vive en la base, en la vista
 * `economic_facts` (INV-6): los documentos emitidos más los movimientos que no
 * saldan ninguno, sin las patas de transferencia ni las aperturas. Aquí no se
 * vuelve a filtrar nada de eso —hacerlo sería tener la regla escrita dos veces
 * y que un día discrepen—. Lo que hay aquí es la aritmética: agrupar, sumar y
 * no mezclar monedas nunca (INV-10).
 */

import type { Enums } from '../../types/database';
import {
  add,
  currencyOf,
  fromRow,
  marginPercent,
  subtract,
  zero,
  type CurrencyCode,
  type Money,
} from '../../lib/money';

/** Lo que la vista devuelve, con los `numeric` como texto (ADR-33). */
export interface Hecho {
  origen: string;
  fecha: string;
  direction: 'in' | 'out';
  flow_class: 'operating' | 'non_operating' | 'internal_transfer' | 'opening';
  /** Nulo cuando el hecho es un documento: un documento no tiene tipo de movimiento. */
  kind: Enums<'cash_kind'> | null;
  currency_code: string;
  amount_total: string | number;
  amount_net: string | number;
  amount_tax: string | number;
  category_id: string | null;
  client_id: string | null;
  concepto: string;
}

export interface Resultado {
  moneda: CurrencyCode;
  /** Neto de lo que entra: la venta sin su impuesto. */
  ingresos: Money;
  /** Neto de lo que sale. */
  gastos: Money;
  resultado: Money;
  /** Impuesto de lo que se cobró y de lo que se pagó, por separado. */
  igvCobrado: Money;
  igvPagado: Money;
  /** Lo que no es del negocio: aportes y préstamos menos retiros. */
  noOperativo: Money;
  hechos: number;
  /** Resultado ÷ ingresos, en porcentaje. Null sin ingresos. */
  margen: number | null;
}

export interface Fila {
  clave: string;
  nombre: string;
  moneda: CurrencyCode;
  total: Money;
  hechos: number;
}

export type Periodo = 'mes' | 'mes-pasado' | 'anio' | 'doce-meses';

export interface Rango {
  desde: string;
  hasta: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** El último día de un mes, con 1 = enero. Febrero incluido. */
function ultimoDia(anio: number, mes: number): number {
  return new Date(Date.UTC(anio, mes, 0)).getUTCDate();
}

/**
 * Los periodos son meses y años completos a propósito. «Los últimos 30 días»
 * daría una cifra que cambia cada mañana y que no se puede comparar con nada
 * ni cuadrar con una declaración.
 */
export function rangoDe(periodo: Periodo, hoy: string): Rango {
  const [anio, mes] = hoy.split('-').map(Number) as [number, number];

  if (periodo === 'anio') return { desde: `${anio}-01-01`, hasta: `${anio}-12-31` };

  if (periodo === 'mes-pasado') {
    const a = mes === 1 ? anio - 1 : anio;
    const m = mes === 1 ? 12 : mes - 1;
    return { desde: `${a}-${pad(m)}-01`, hasta: `${a}-${pad(m)}-${pad(ultimoDia(a, m))}` };
  }

  if (periodo === 'doce-meses') {
    // Doce meses completos, el que corre incluido.
    const a = mes === 12 ? anio : anio - 1;
    const m = mes === 12 ? 1 : mes + 1;
    return {
      desde: `${a}-${pad(m)}-01`,
      hasta: `${anio}-${pad(mes)}-${pad(ultimoDia(anio, mes))}`,
    };
  }

  return {
    desde: `${anio}-${pad(mes)}-01`,
    hasta: `${anio}-${pad(mes)}-${pad(ultimoDia(anio, mes))}`,
  };
}

export function nombrePeriodo(periodo: Periodo): string {
  if (periodo === 'mes') return 'Este mes';
  if (periodo === 'mes-pasado') return 'El mes pasado';
  if (periodo === 'anio') return 'Este año';
  return 'Los últimos doce meses';
}

/** Monedas presentes, en orden estable. */
function monedasDe(hechos: readonly Hecho[]): CurrencyCode[] {
  const vistas: CurrencyCode[] = [];
  for (const h of hechos) {
    const m = currencyOf(h.currency_code);
    if (!vistas.includes(m)) vistas.push(m);
  }
  return vistas;
}

/**
 * Una fila por moneda, nunca una suma. Soles y dólares son dos contabilidades
 * y un total único exigiría un tipo de cambio escondido dentro.
 */
export function resultadoPorMoneda(hechos: readonly Hecho[]): Resultado[] {
  return monedasDe(hechos).map((moneda) => {
    const suyos = hechos.filter((h) => currencyOf(h.currency_code) === moneda);
    let ingresos = zero(moneda);
    let gastos = zero(moneda);
    let igvCobrado = zero(moneda);
    let igvPagado = zero(moneda);
    let noOperativo = zero(moneda);

    for (const h of suyos) {
      const neto = fromRow(h.amount_net, moneda);
      const impuesto = fromRow(h.amount_tax, moneda);
      const entra = h.direction === 'in';

      if (h.flow_class === 'operating') {
        if (entra) {
          ingresos = add(ingresos, neto);
          igvCobrado = add(igvCobrado, impuesto);
        } else {
          gastos = add(gastos, neto);
          igvPagado = add(igvPagado, impuesto);
        }
        continue;
      }

      // Lo no operativo no entra en el resultado del negocio: se enseña
      // aparte, porque un retiro del dueño no es un gasto y un préstamo
      // recibido no es una venta.
      const total = fromRow(h.amount_total, moneda);
      noOperativo = entra ? add(noOperativo, total) : subtract(noOperativo, total);
    }

    const resultado = subtract(ingresos, gastos);
    return {
      moneda,
      ingresos,
      gastos,
      resultado,
      igvCobrado,
      igvPagado,
      noOperativo,
      hechos: suyos.length,
      margen: marginPercent(ingresos, gastos),
    };
  });
}

/** Agrupa por una clave, dentro de cada moneda, y ordena de mayor a menor. */
function agrupar(
  hechos: readonly Hecho[],
  clave: (h: Hecho) => string | null,
  nombre: (c: string) => string,
  sinClave: string,
): Fila[] {
  const filas = new Map<string, Fila>();
  for (const h of hechos) {
    const moneda = currencyOf(h.currency_code);
    const c = clave(h) ?? '';
    const id = `${moneda}·${c}`;
    const antes = filas.get(id);
    const neto = fromRow(h.amount_net, moneda);
    filas.set(id, {
      clave: c,
      nombre: c ? nombre(c) : sinClave,
      moneda,
      total: antes ? add(antes.total, neto) : neto,
      hechos: (antes?.hechos ?? 0) + 1,
    });
  }
  return [...filas.values()].sort((a, b) =>
    a.moneda === b.moneda ? Number(b.total.minor - a.total.minor) : a.moneda < b.moneda ? -1 : 1,
  );
}

/** Lo que entró, por cliente. Solo lo operativo: un préstamo no es un cliente. */
export function ingresosPorCliente(
  hechos: readonly Hecho[],
  nombres: ReadonlyMap<string, string>,
): Fila[] {
  return agrupar(
    hechos.filter((h) => h.flow_class === 'operating' && h.direction === 'in'),
    (h) => h.client_id,
    (c) => nombres.get(c) ?? 'Cliente que ya no existe',
    'Sin cliente anotado',
  );
}

/** Lo que salió, por categoría. */
export function gastosPorCategoria(
  hechos: readonly Hecho[],
  nombres: ReadonlyMap<string, string>,
): Fila[] {
  return agrupar(
    hechos.filter((h) => h.flow_class === 'operating' && h.direction === 'out'),
    (h) => h.category_id,
    (c) => nombres.get(c) ?? 'Categoría que ya no existe',
    'Sin categoría',
  );
}

/** Y lo que no es del negocio, uno por uno: son pocos y se leen mejor así. */
export function fueraDelResultado(hechos: readonly Hecho[]): Hecho[] {
  return hechos.filter((h) => h.flow_class === 'non_operating');
}
