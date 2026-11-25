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
  supplier_id: string | null;
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

/**
 * Lo que salió, por proveedor. Es el espejo de «de dónde vino el ingreso», y
 * contesta otra pregunta que la categoría no contesta: la categoría dice en
 * qué se fue y esto dice a quién. Un gasto anotado como movimiento suelto no
 * tiene proveedor, así que cae en su propio grupo en vez de inventarse uno.
 */
export function gastosPorProveedor(
  hechos: readonly Hecho[],
  nombres: ReadonlyMap<string, string>,
): Fila[] {
  return agrupar(
    hechos.filter((h) => h.flow_class === 'operating' && h.direction === 'out'),
    (h) => h.supplier_id,
    (p) => nombres.get(p) ?? 'Proveedor que ya no existe',
    'Sin proveedor anotado',
  );
}

/** Y lo que no es del negocio, uno por uno: son pocos y se leen mejor así. */
export function fueraDelResultado(hechos: readonly Hecho[]): Hecho[] {
  return hechos.filter((h) => h.flow_class === 'non_operating');
}

/* ---------------------------------------------------------------------------
 * La serie por mes: qué mes entró más y qué mes entró menos
 * -------------------------------------------------------------------------*/

export interface MesDeResultado {
  /** `2026-11`. Es la clave y el orden a la vez. */
  mes: string;
  moneda: CurrencyCode;
  /** Neto de lo que entró, sin impuesto: el margen no se mide sobre el IGV. */
  ingresos: Money;
  gastos: Money;
  resultado: Money;
  hechos: number;
}

export interface SeriePorMes {
  moneda: CurrencyCode;
  meses: MesDeResultado[];
  /** El mes de más ingresos y el de menos. Null si no hay ni un mes con algo. */
  mejor: MesDeResultado | null;
  peor: MesDeResultado | null;
  /** El ingreso del mes más alto. Es la escala de las barras. */
  techo: Money;
}

/** `2026-11-23` → `2026-11`. Sin `Date`: una cadena ISO ya viene ordenada. */
export function mesDe(iso: string): string {
  return iso.slice(0, 7);
}

/** Los meses de la ventana, en orden, incluidos los que no tuvieron nada. */
export function mesesEntre(desde: string, hasta: string): string[] {
  const meses: string[] = [];
  let anio = Number(desde.slice(0, 4));
  let mes = Number(desde.slice(5, 7));
  const fin = mesDe(hasta);

  // Tope de vueltas: ninguna ventana de este producto pasa de diez años, y
  // así una fecha corrupta no cuelga la pantalla.
  for (let i = 0; i < 120; i += 1) {
    const clave = `${anio}-${pad(mes)}`;
    meses.push(clave);
    if (clave >= fin) break;
    mes += 1;
    if (mes > 12) {
      mes = 1;
      anio += 1;
    }
  }

  return meses;
}

/**
 * Lo que entró y salió mes a mes, por moneda.
 *
 * Tres decisiones:
 *
 * 1. **Los meses sin nada existen.** Un mes vacío es un hueco en la serie, no
 *    una columna que falta: si se saltara, dos meses separados por un verano
 *    muerto aparecerían pegados y la serie mentiría sobre el ritmo del
 *    negocio.
 * 2. **Es el mismo lente Resultado, mes a mes.** Solo cuenta lo operativo, y
 *    por su neto: un retiro del dueño no es un gasto y el IGV no es ingreso
 *    (INV-6, §2.3). Así la suma de los meses es el total de arriba, y no hay
 *    dos cifras que puedan discrepar.
 * 3. **«El mejor» es por ingresos, no por resultado.** Es la pregunta que se
 *    hace: qué mes vendí más. El resultado de cada mes está en su columna y en
 *    la tabla, para que la otra pregunta también tenga respuesta.
 */
export function seriePorMes(
  hechos: readonly Hecho[],
  desde: string,
  hasta: string,
): SeriePorMes[] {
  const ventana = mesesEntre(desde, hasta);

  return monedasDe(hechos).map((moneda) => {
    const vacio = (mes: string): MesDeResultado => ({
      mes,
      moneda,
      ingresos: zero(moneda),
      gastos: zero(moneda),
      resultado: zero(moneda),
      hechos: 0,
    });

    const porMes = new Map<string, MesDeResultado>(ventana.map((m) => [m, vacio(m)]));

    for (const h of hechos) {
      let suya: CurrencyCode;
      try {
        suya = currencyOf(h.currency_code);
      } catch {
        continue;
      }
      if (suya !== moneda) continue;
      // Lo no operativo se queda fuera, igual que en el resultado del periodo.
      if (h.flow_class !== 'operating') continue;

      const clave = mesDe(h.fecha);
      const mes = porMes.get(clave) ?? vacio(clave);
      const neto = fromRow(h.amount_net, moneda);

      if (h.direction === 'in') mes.ingresos = add(mes.ingresos, neto);
      else mes.gastos = add(mes.gastos, neto);
      mes.resultado = subtract(mes.ingresos, mes.gastos);
      mes.hechos += 1;
      porMes.set(clave, mes);
    }

    const meses = [...porMes.values()].sort((a, b) => a.mes.localeCompare(b.mes));
    const conAlgo = meses.filter((m) => m.hechos > 0);

    let mejor: MesDeResultado | null = null;
    let peor: MesDeResultado | null = null;
    for (const m of conAlgo) {
      if (!mejor || m.ingresos.minor > mejor.ingresos.minor) mejor = m;
      if (!peor || m.ingresos.minor < peor.ingresos.minor) peor = m;
    }

    // La escala de las barras: el mayor de los dos lados, para que entradas y
    // salidas se puedan comparar a ojo. Dos escalas distintas en el mismo
    // gráfico inventarían una relación que no está en los datos.
    let techo = zero(moneda);
    for (const m of meses) {
      if (m.ingresos.minor > techo.minor) techo = m.ingresos;
      if (m.gastos.minor > techo.minor) techo = m.gastos;
    }

    return { moneda, meses, mejor, peor, techo };
  });
}

/** `2026-11` → `nov 2026`. Para el eje, donde el espacio es poco. */
export function nombreMes(clave: string): string {
  const anio = Number(clave.slice(0, 4));
  const mes = Number(clave.slice(5, 7));
  if (!Number.isFinite(anio) || !Number.isFinite(mes) || mes < 1 || mes > 12) return clave;
  return new Intl.DateTimeFormat('es-PE', { month: 'short', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(anio, mes - 1, 1)))
    .replace('.', '');
}

/**
 * La altura de una barra en porcentaje, de 0 a 100.
 *
 * Es el único sitio de este producto donde un importe pasa por `number`, y se
 * puede porque el resultado son **píxeles y no dinero**: una barra con medio
 * píxel de más no descuadra nada. La cifra que se lee sale siempre de
 * `format`, nunca de aquí.
 */
export function alturaDeBarra(valor: Money, techo: Money): number {
  if (techo.minor <= 0n || valor.minor <= 0n) return 0;
  const alto = (Number(valor.minor) / Number(techo.minor)) * 100;
  return Math.max(1, Math.min(100, alto));
}
