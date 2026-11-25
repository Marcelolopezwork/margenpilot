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

/** Una fila de `job_time`: los minutos de un trabajo. */
export interface TiempoEnBase {
  job_id: string;
  minutos: number;
  apuntes: number;
  personas: number;
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
  /**
   * (acordado − costo) / acordado. Null cuando no hay precio, cuando está
   * cancelado o cuando todavía no se anotó un solo costo teniendo estimado:
   * entonces no es 100 %, es que no se sabe.
   */
  margenReal: number | null;
  /** Puntos de diferencia entre los dos. Negativo = se está comiendo. */
  desvio: number | null;
  /** Se estimó costo y no hay ni un apunte: el margen real no se sabe aún. */
  costoSinAnotar: boolean;
  /** Cuántas compras y gastos se le atribuyeron, en su moneda. */
  cuantosCostos: number;
  /** Cuántos documentos de venta hay detrás de lo facturado. */
  cuantosDocumentos: number;
  costosAjenos: CostoAjeno[];
  /** Minutos anotados. Cero cuando no hay ni un apunte (INV-16.3). */
  minutos: number;
  /** Cuántas personas distintas pusieron tiempo. */
  personas: number;
  /**
   * Lo que deja cada hora: utilidad ÷ horas. Null cuando no hay horas
   * anotadas o cuando el costo real todavía no se sabe —dividir una utilidad
   * inflada daría una cifra por hora inflada, que es peor que ninguna—.
   */
  porHora: Money | null;
}

/**
 * Utilidad por hora, a partir de minutos.
 *
 * Aritmética entera, como todo el dinero de este producto: céntimos por
 * sesenta, entre los minutos, redondeando al céntimo más cercano. En coma
 * flotante, mil horas de trabajo acumularían el error justo donde la cifra
 * se usa para decidir qué servicio dejar de vender.
 */
export function utilidadPorHora(utilidad: Money, minutos: number): Money | null {
  if (minutos <= 0) return null;
  const divisor = BigInt(minutos);
  const dividendo = utilidad.minor * 60n;
  const entero = dividendo / divisor;
  const resto = dividendo % divisor;
  const absResto = resto < 0n ? -resto : resto;
  // Se redondea al alejarse del cero, que es lo que hace `round()` en la base.
  const ajuste = absResto * 2n >= divisor ? (dividendo < 0n ? -1n : 1n) : 0n;
  return { minor: entero + ajuste, currency: utilidad.currency };
}

/** `390` → `6 h 30 min`. Lo que se lee; los minutos son lo que se guarda. */
export function enHoras(minutos: number): string {
  if (minutos <= 0) return '0 h';
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
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
  tiempos: readonly TiempoEnBase[] = [],
): TrabajoConMargen[] {
  const porTiempo = new Map(tiempos.map((t) => [t.job_id, t]));
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

    /*
      Un trabajo al que no se le anotó un solo costo, habiéndose estimado uno,
      no tiene margen real del 100 %: tiene uno que todavía no se sabe. Y el
      100 % es la mentira más cómoda que este producto podría contar, porque
      llega con un desvío magnífico a favor justo cuando falta el dato que lo
      hundiría. Es el mismo aviso que ya da el editor de cotizaciones cuando
      una línea no tiene costos cargados.

      Si el costo estimado también era cero, el 100 % sí es la cifra: la
      cotización dijo que no costaba nada y el desvío sale cero, que es
      coherente. Lo que no se puede es confundir «no cuesta» con «no se anotó».

      Los costos en otra moneda no cuentan como anotados a estos efectos: el
      costo en la moneda del trabajo sigue siendo cero, y el margen de su
      moneda sigue sin saberse.
    */
    const costoSinAnotar = cuantosCostos === 0 && estimado.minor > 0n;

    // Y un trabajo cancelado no se mide contra un precio que ya no va a cobrar.
    const margenReal =
      estado === 'cancelled' || costoSinAnotar ? null : marginPercent(acordado, costo);

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
      costoSinAnotar,
      cuantosCostos,
      cuantosDocumentos,
      costosAjenos: ajenos.sort((a, b) => a.moneda.localeCompare(b.moneda)),
      minutos: porTiempo.get(t.id)?.minutos ?? 0,
      personas: porTiempo.get(t.id)?.personas ?? 0,
      /*
        Solo cuando el margen real se sabe. Con el costo sin anotar, la
        utilidad está inflada y dividirla entre las horas daría una cifra por
        hora inflada: la más peligrosa de todas, porque suena concreta.
      */
      porHora:
        margenReal === null
          ? null
          : utilidadPorHora(subtract(acordado, costo), porTiempo.get(t.id)?.minutos ?? 0),
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
  /**
   * Cuántos del grupo no tienen un solo costo anotado. Mientras sea mayor que
   * cero, el margen real de este servicio está inflado: esos trabajos siguen
   * sumando su precio acordado y cero de costo. La cifra se enseña igual —es
   * la que hay— pero diciendo sobre cuántos se apoya.
   */
  sinCostos: number;
  costosAjenos: CostoAjeno[];
  /** Minutos sumados de los trabajos del grupo. */
  minutos: number;
  /**
   * Lo que deja cada hora de este servicio. Es la cifra que compara dos
   * servicios de verdad: uno al 50 % que se come el triple de horas que otro
   * al 30 % deja menos por hora, y el margen solo no lo dice.
   */
  porHora: Money | null;
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
    const sinCostos = grupo.filter((t) => t.costoSinAnotar).length;
    const minutos = grupo.reduce((n, t) => n + t.minutos, 0);

    /*
      Si a NINGUNO del grupo se le anotó un costo, el grupo tampoco tiene
      margen real: tendría el 100 %, que es la misma mentira cómoda de un
      trabajo suelto pero con más autoridad, porque viene de una suma.

      Si a alguno sí, la cifra se calcula y se enseña: es la que hay, está
      inflada en una cantidad conocida, y `sinCostos` dice en cuántos
      trabajos se apoya esa inflación. Esconderla sería peor, porque entonces
      un servicio con nueve trabajos medidos y uno sin medir no diría nada.
    */
    const margenReal =
      sinCostos === grupo.length
        ? null
        : aggregateMarginPercent(
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
      sinCostos,
      costosAjenos: [...ajenos.values()].sort((a, b) => a.moneda.localeCompare(b.moneda)),
      minutos,
      // Mismo cuidado que en un trabajo suelto: sin margen real no hay cifra
      // por hora, porque la utilidad todavía está inflada.
      porHora: margenReal === null ? null : utilidadPorHora(subtract(acordado, costo), minutos),
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

/**
 * Los trabajos a los que no se les anotó un solo costo teniendo estimado. Son
 * los que hay que rellenar antes de que el margen por servicio signifique
 * algo, y van en su propia lista: sin ellos a la vista, el resumen enseña un
 * margen inflado y nadie sabe por qué.
 */
export function sinCostosAnotados(
  trabajos: readonly TrabajoConMargen[],
): TrabajoConMargen[] {
  return trabajos.filter((t) => t.estado !== 'cancelled' && t.costoSinAnotar);
}

/**
 * Los trabajos ordenados por lo que deja cada hora, de menos a más.
 *
 * Es la lista que el margen solo no puede dar: un trabajo al 50 % que se
 * comió ochenta horas deja menos por hora que uno al 30 % que se hizo en
 * diez. Los que no tienen horas anotadas quedan fuera, no al final: no es
 * que dejen poco por hora, es que no se sabe.
 */
export function porLoQueDejaLaHora(
  trabajos: readonly TrabajoConMargen[],
): TrabajoConMargen[] {
  return trabajos
    .filter((t) => t.estado !== 'cancelled' && t.porHora !== null && t.minutos > 0)
    .sort((a, b) => Number((a.porHora?.minor ?? 0n) - (b.porHora?.minor ?? 0n)));
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
