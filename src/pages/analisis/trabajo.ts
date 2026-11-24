/**
 * El lente que faltaba: cuánto deja cada trabajo, y cuánto deja cada servicio.
 *
 * Hasta ahora el margen existía en dos sitios y ninguno servía para decidir:
 * al abrir una cotización, el de **esa propuesta** —lo que prometía—, y en
 * Resultado, el del **mes entero** —lo que pasó con todo junto—. Lo que no
 * había es el del medio.
 *
 * ---------------------------------------------------------------------------
 * Qué se compara con qué, y por qué así
 * ---------------------------------------------------------------------------
 *
 * Los dos márgenes de un trabajo se calculan **sobre el mismo denominador**,
 * el precio acordado:
 *
 *     margen cotizado = (acordado − estimado) / acordado
 *     margen real     = (acordado − costo real) / acordado
 *
 * Con el mismo denominador, la resta de los dos es una cifra que significa
 * algo: «cotizaste 45 % y te está dejando 28 %, catorce puntos menos».
 *
 * La tentación es calcular el margen real sobre lo facturado, y está mal:
 * facturar es un calendario, no un hecho del trabajo. Un trabajo de 6 000 con
 * 2 000 de costo y la primera cuota de 2 000 emitida daría 0 % en enero y
 * 66 % en marzo sin que nada hubiera cambiado. Lo facturado se enseña —al
 * lado, con su nombre— pero no se llama margen.
 *
 * Y lo que un trabajo cancelado nunca va a facturar no se puede medir contra
 * su precio acordado, así que no se le calcula margen: se enseña lo facturado
 * y lo gastado, en crudo, y se queda fuera del resumen por servicio.
 *
 * Las monedas no se suman (INV-10). El margen de un trabajo es el de su
 * moneda acordada; un costo en otra moneda se enseña aparte y sin convertir,
 * porque convertirlo en silencio sería un margen que depende del día.
 */

import {
  add,
  aggregateMarginPercent,
  currencyOf,
  fromRow,
  marginPercent,
  subtract,
  zero,
  type CurrencyCode,
  type Money,
} from '../../lib/money';

/** Una fila de `jobs`, con los `numeric` como texto (ADR-33). */
export interface TrabajoEnBase {
  id: string;
  name: string;
  client_id: string;
  service_id: string | null;
  quote_id: string;
  currency_code: string;
  price_net: string | number;
  quote_net: string | number;
  expected_cost: string | number;
  status: string;
  notes: string | null;
  created_at: string;
}

/** Una fila de `job_margins`: una por trabajo y moneda. */
export interface MargenEnBase {
  job_id: string;
  currency_code: string;
  ingreso_neto: string | number;
  costo_neto: string | number;
  documentos: number;
  costos: number;
}

export type EstadoDeTrabajo = 'open' | 'done' | 'cancelled';

export const ESTADOS_DE_TRABAJO: readonly EstadoDeTrabajo[] = ['open', 'done', 'cancelled'];

export function nombreEstadoDeTrabajo(estado: string): string {
  switch (estado) {
    case 'open':
      return 'en curso';
    case 'done':
      return 'terminado';
    case 'cancelled':
      return 'cancelado';
    default:
      return estado;
  }
}

/** Lo gastado en una moneda que no es la del trabajo. Se enseña, no se suma. */
export interface CostoAjeno {
  moneda: CurrencyCode;
  costo: Money;
  cuantos: number;
}

export interface TrabajoConMargen {
  id: string;
  nombre: string;
  clienteId: string;
  servicioId: string | null;
  cotizacionId: string;
  estado: EstadoDeTrabajo;
  moneda: CurrencyCode;
  /** El neto de su línea en la versión que se aceptó. No se mueve. */
  acordado: Money;
  /** El costo que estaba estimado el día de la aprobación. Tampoco se mueve. */
  estimado: Money;
  /** Lo que de verdad costó: compras y gastos atribuidos, en neto. */
  costo: Money;
  /** Su parte de lo que ya se facturó de la cotización. No es el margen. */
  facturado: Money;
  /** Lo que queda por facturar del precio acordado. Nunca negativo. */
  porFacturar: Money;
  /** (acordado − estimado) / acordado. Null si no hay precio. */
  margenCotizado: number | null;
  /** (acordado − costo) / acordado. Null si no hay precio o está cancelado. */
  margenReal: number | null;
  /** Puntos de diferencia entre los dos. Negativo = se está comiendo. */
  desvio: number | null;
  /** Cuántas compras y gastos se le atribuyeron, en su moneda. */
  cuantosCostos: number;
  /** Cuántos documentos de venta hay detrás de lo facturado. */
  cuantosDocumentos: number;
  costosAjenos: CostoAjeno[];
}

function estadoDe(valor: string): EstadoDeTrabajo {
  return valor === 'done' || valor === 'cancelled' ? valor : 'open';
}

/**
 * Junta cada trabajo con sus cifras.
 *
 * Un trabajo cuya moneda el producto no conoce se queda fuera en vez de
 * colarse en otro montón: es la misma decisión que toma `margenPorMoneda`.
 */
export function conMargen(
  trabajos: readonly TrabajoEnBase[],
  filas: readonly MargenEnBase[],
): TrabajoConMargen[] {
  const porTrabajo = new Map<string, MargenEnBase[]>();
  for (const f of filas) {
    const grupo = porTrabajo.get(f.job_id);
    if (grupo) grupo.push(f);
    else porTrabajo.set(f.job_id, [f]);
  }

  const salida: TrabajoConMargen[] = [];

  for (const t of trabajos) {
    let moneda: CurrencyCode;
    try {
      moneda = currencyOf(t.currency_code);
    } catch {
      continue;
    }

    const acordado = fromRow(t.price_net, moneda);
    const estimado = fromRow(t.expected_cost, moneda);
    const estado = estadoDe(t.status);

    let costo = zero(moneda);
    let facturado = zero(moneda);
    let cuantosCostos = 0;
    let cuantosDocumentos = 0;
    const ajenos: CostoAjeno[] = [];

    for (const f of porTrabajo.get(t.id) ?? []) {
      let suya: CurrencyCode;
      try {
        suya = currencyOf(f.currency_code);
      } catch {
        continue;
      }
      if (suya === moneda) {
        costo = add(costo, fromRow(f.costo_neto, moneda));
        facturado = add(facturado, fromRow(f.ingreso_neto, moneda));
        cuantosCostos += f.costos ?? 0;
        cuantosDocumentos += f.documentos ?? 0;
      } else {
        const gastado = fromRow(f.costo_neto, suya);
        if (gastado.minor !== 0n) {
          ajenos.push({ moneda: suya, costo: gastado, cuantos: f.costos ?? 0 });
        }
      }
    }

    const margenCotizado = marginPercent(acordado, estimado);
    // Un trabajo cancelado no se mide contra un precio que ya no va a cobrar.
    const margenReal = estado === 'cancelled' ? null : marginPercent(acordado, costo);

    const pendiente = subtract(acordado, facturado);

    salida.push({
      id: t.id,
      nombre: t.name,
      clienteId: t.client_id,
      servicioId: t.service_id,
      cotizacionId: t.quote_id,
      estado,
      moneda,
      acordado,
      estimado,
      costo,
      facturado,
      porFacturar: pendiente.minor > 0n ? pendiente : zero(moneda),
      margenCotizado,
      margenReal,
      desvio:
        margenCotizado === null || margenReal === null ? null : margenReal - margenCotizado,
      cuantosCostos,
      cuantosDocumentos,
      costosAjenos: ajenos.sort((a, b) => a.moneda.localeCompare(b.moneda)),
    });
  }

  return salida;
}

export interface ResumenDeServicio {
  /** Null = trabajos que no venían de un servicio del catálogo. */
  servicioId: string | null;
  moneda: CurrencyCode;
  acordado: Money;
  estimado: Money;
  costo: Money;
  utilidad: Money;
  margenCotizado: number | null;
  margenReal: number | null;
  desvio: number | null;
  cuantos: number;
  costosAjenos: CostoAjeno[];
}

/**
 * Cuánto deja cada servicio: la pregunta con la que empezó todo.
 *
 * Σ utilidad / Σ acordado, nunca el promedio de los porcentajes (§2.3). Dos
 * trabajos del mismo servicio al 10 % y al 50 % no dejan 30 % si el primero
 * es diez veces mayor: dejan 13,6 %.
 *
 * Los cancelados no entran: su precio acordado no se va a facturar, así que
 * meterlos aquí hundiría el margen del servicio con dinero que nadie perdió.
 */
export function resumenPorServicio(
  trabajos: readonly TrabajoConMargen[],
): ResumenDeServicio[] {
  const grupos = new Map<string, TrabajoConMargen[]>();
  for (const t of trabajos) {
    if (t.estado === 'cancelled') continue;
    const clave = `${t.servicioId ?? ''}·${t.moneda}`;
    const grupo = grupos.get(clave);
    if (grupo) grupo.push(t);
    else grupos.set(clave, [t]);
  }

  const salida: ResumenDeServicio[] = [];

  for (const grupo of grupos.values()) {
    // El grupo no puede estar vacío: se crea al meter su primer elemento.
    const moneda = grupo[0]!.moneda;
    const servicioId = grupo[0]!.servicioId;

    let acordado = zero(moneda);
    let estimado = zero(moneda);
    let costo = zero(moneda);
    const ajenos = new Map<CurrencyCode, CostoAjeno>();

    for (const t of grupo) {
      acordado = add(acordado, t.acordado);
      estimado = add(estimado, t.estimado);
      costo = add(costo, t.costo);
      for (const a of t.costosAjenos) {
        const previo = ajenos.get(a.moneda);
        if (previo) {
          previo.costo = add(previo.costo, a.costo);
          previo.cuantos += a.cuantos;
        } else {
          ajenos.set(a.moneda, { ...a });
        }
      }
    }

    const margenCotizado = aggregateMarginPercent(
      grupo.map((t) => ({ netPrice: t.acordado, directCost: t.estimado })),
      moneda,
    );
    const margenReal = aggregateMarginPercent(
      grupo.map((t) => ({ netPrice: t.acordado, directCost: t.costo })),
      moneda,
    );

    salida.push({
      servicioId,
      moneda,
      acordado,
      estimado,
      costo,
      utilidad: subtract(acordado, costo),
      margenCotizado,
      margenReal,
      desvio:
        margenCotizado === null || margenReal === null ? null : margenReal - margenCotizado,
      cuantos: grupo.length,
      costosAjenos: [...ajenos.values()].sort((a, b) => a.moneda.localeCompare(b.moneda)),
    });
  }

  // El peor desvío primero: es el que hay que mirar, no el más grande.
  return salida.sort((a, b) => {
    if (a.moneda !== b.moneda) return a.moneda.localeCompare(b.moneda);
    return (a.desvio ?? 0) - (b.desvio ?? 0);
  });
}

/**
 * Lo mismo, sin separar por servicio: el conjunto, por moneda.
 *
 * Reusa el agrupador de arriba poniendo el servicio a nulo, para que «el
 * total» no sea una segunda aritmética que un día discrepe de las filas que
 * tiene debajo.
 */
export function resumenPorMoneda(
  trabajos: readonly TrabajoConMargen[],
): ResumenDeServicio[] {
  return resumenPorServicio(trabajos.map((t) => ({ ...t, servicioId: null })));
}

/**
 * Los trabajos que se están comiendo el margen: los que ya cuestan más de lo
 * que se estimó. No es «los de margen bajo»: un trabajo cotizado al 15 % que
 * cuesta lo previsto está bien. Lo que hay que mirar es el desvío.
 */
export function seComenElMargen(
  trabajos: readonly TrabajoConMargen[],
  puntos = 0,
): TrabajoConMargen[] {
  return trabajos
    .filter((t) => t.estado !== 'cancelled' && t.desvio !== null && t.desvio < -puntos)
    .sort((a, b) => (a.desvio ?? 0) - (b.desvio ?? 0));
}

/** Los trabajos que ya cuestan y todavía no tienen una sola factura emitida. */
export function conCostoYSinFacturar(
  trabajos: readonly TrabajoConMargen[],
): TrabajoConMargen[] {
  return trabajos.filter(
    (t) => t.estado !== 'cancelled' && t.costo.minor > 0n && t.facturado.minor === 0n,
  );
}

/** Para el texto de ayuda de la pantalla, en un solo sitio. */
export const PARA_QUE =
  'Cuánto deja cada trabajo que vendiste y cuánto deja cada servicio: lo que prometía la cotización contra lo que de verdad costó.';
