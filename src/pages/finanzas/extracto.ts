/**
 * Leer el extracto del banco: separar el archivo, adivinar qué columna es
 * qué, y proponer con qué movimiento cuadra cada línea.
 *
 * Todo esto pasa **antes** de tocar la base. La puerta `importar_extracto`
 * recibe líneas ya leídas, y esa división es deliberada: cada banco trae su
 * formato, y un formato nuevo tiene que poder arreglarse en la pantalla sin
 * una migración.
 *
 * La regla que gobierna el módulo entero: **adivinar se propone, nunca se
 * aplica solo.** Se propone el separador, el orden de la fecha, el mapeo de
 * columnas y el emparejamiento de cada línea; una persona lo confirma. Un
 * importador que se equivoca en silencio no da un error: da una contabilidad
 * que cuadra con un extracto que no es el tuyo.
 */

import { currencyOf, fromDb, type CurrencyCode, type Money } from '../../lib/money';

/* ---------------------------------------------------------------------------
 * Separar el archivo
 * -------------------------------------------------------------------------*/

const SEPARADORES = [';', ',', '\t', '|'] as const;
export type Separador = (typeof SEPARADORES)[number];

/**
 * El separador que mejor parte el archivo: el que da más columnas y el mismo
 * número en casi todas las filas. Contar solo la cabecera no basta —una
 * descripción con comas dentro basta para engañarlo—, así que se miran las
 * primeras filas y gana la consistencia, no el recuento.
 */
export function adivinarSeparador(texto: string): Separador {
  const lineas = texto.split(/\r?\n/).filter((l) => l.trim() !== '').slice(0, 20);
  if (lineas.length === 0) return ',';

  let mejor: Separador = ',';
  let mejorNota = -1;

  for (const sep of SEPARADORES) {
    const cuentas = lineas.map((l) => separarFila(l, sep).length);
    const columnas = cuentas[0] ?? 1;
    if (columnas < 2) continue;
    const iguales = cuentas.filter((c) => c === columnas).length / cuentas.length;
    // La consistencia pesa mucho más que el número de columnas: un separador
    // que parte todas las filas igual es el bueno aunque dé menos columnas.
    const nota = iguales * 100 + columnas;
    if (nota > mejorNota) {
      mejorNota = nota;
      mejor = sep;
    }
  }

  return mejor;
}

/** Una fila, respetando las comillas y las comillas dobles de dentro. */
export function separarFila(linea: string, sep: Separador): string[] {
  const campos: string[] = [];
  let actual = '';
  let dentro = false;

  for (let i = 0; i < linea.length; i += 1) {
    const c = linea[i];
    if (c === '"') {
      if (dentro && linea[i + 1] === '"') {
        actual += '"';
        i += 1;
      } else {
        dentro = !dentro;
      }
      continue;
    }
    if (c === sep && !dentro) {
      campos.push(actual.trim());
      actual = '';
      continue;
    }
    actual += c ?? '';
  }
  campos.push(actual.trim());
  return campos;
}

export function separarCsv(texto: string, sep?: Separador): string[][] {
  const separador = sep ?? adivinarSeparador(texto);
  return texto
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
    .map((l) => separarFila(l, separador));
}

/* ---------------------------------------------------------------------------
 * Fechas e importes
 * -------------------------------------------------------------------------*/

export type OrdenDeFecha = 'dmy' | 'mdy' | 'ymd';

/**
 * El orden de la fecha, deducido del archivo entero y no de la primera fila.
 *
 * `03/11/2026` es 3 de noviembre o 11 de marzo y no hay forma de saberlo
 * mirando esa fila. Mirando todas sí: si alguna tiene el primer número por
 * encima de doce, es día/mes; si lo tiene el segundo, es mes/día. Si ninguna
 * lo aclara —un extracto de diez días a principio de mes—, se asume
 * **día/mes**, que es lo que usan los bancos peruanos, y la pantalla lo dice
 * para que se pueda corregir.
 */
export function adivinarOrdenDeFecha(valores: readonly string[]): OrdenDeFecha {
  let primeroAlto = false;
  let segundoAlto = false;

  for (const valor of valores) {
    const limpio = valor.trim();
    if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(limpio)) return 'ymd';
    const m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/.exec(limpio);
    if (!m) continue;
    if (Number(m[1]) > 12) primeroAlto = true;
    if (Number(m[2]) > 12) segundoAlto = true;
  }

  if (segundoAlto && !primeroAlto) return 'mdy';
  return 'dmy';
}

/** `03/11/2026` → `2026-11-03`. Null si no se puede leer. */
export function parsearFecha(valor: string, orden: OrdenDeFecha): string | null {
  const limpio = valor.trim();
  if (limpio === '') return null;

  let anio: number;
  let mes: number;
  let dia: number;

  const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(limpio);
  if (iso) {
    anio = Number(iso[1]);
    mes = Number(iso[2]);
    dia = Number(iso[3]);
  } else {
    const m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})/.exec(limpio);
    if (!m) return null;
    const a = Number(m[1]);
    const b = Number(m[2]);
    anio = Number(m[3]);
    if (anio < 100) anio += 2000;
    if (orden === 'mdy') {
      mes = a;
      dia = b;
    } else {
      dia = a;
      mes = b;
    }
  }

  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
  // Un 31 de febrero no se corrige al 3 de marzo en silencio: se rechaza.
  const d = new Date(Date.UTC(anio, mes - 1, dia));
  if (d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null;

  return d.toISOString().slice(0, 10);
}

export type SeparadorDecimal = ',' | '.';

/**
 * El separador decimal del archivo. `1,180.00` y `1.180,00` son el mismo
 * importe escrito de dos maneras, y confundirlos cambia la cifra por mil.
 * El criterio: el último de los dos que aparezca es el decimal.
 */
export function adivinarDecimal(valores: readonly string[]): SeparadorDecimal {
  for (const valor of valores) {
    const coma = valor.lastIndexOf(',');
    const punto = valor.lastIndexOf('.');
    if (coma >= 0 && punto >= 0) return coma > punto ? ',' : '.';
  }
  // Con uno solo de los dos no se sabe si es decimal o de millares: con
  // exactamente dos cifras detrás, es decimal.
  for (const valor of valores) {
    if (/,\d{2}\s*$/.test(valor)) return ',';
    if (/\.\d{2}\s*$/.test(valor)) return '.';
  }
  return '.';
}

/**
 * `S/ -1,180.00` → `-1180.00`. Devuelve texto, nunca `number`: un importe no
 * pasa por coma flotante en este producto (ADR-33).
 *
 * Admite el paréntesis como negativo, que es como lo escriben algunos
 * extractos: `(118.00)` son ciento dieciocho que salieron.
 */
export function parsearImporte(valor: string, decimal: SeparadorDecimal): string | null {
  let limpio = valor.trim();
  if (limpio === '') return null;

  let negativo = false;
  if (/^\(.*\)$/.test(limpio)) {
    negativo = true;
    limpio = limpio.slice(1, -1);
  }
  if (limpio.includes('-')) negativo = true;

  const millares = decimal === ',' ? '.' : ',';
  const soloCifras = limpio
    .split('')
    .filter((c) => /\d/.test(c) || c === decimal)
    .join('')
    .split(millares)
    .join('');

  if (soloCifras === '' || !/\d/.test(soloCifras)) return null;

  const partes = soloCifras.split(decimal);
  const entera = partes[0] === '' ? '0' : (partes[0] ?? '0');
  const centimos = (partes[1] ?? '').slice(0, 2).padEnd(2, '0');
  const cifra = `${entera}.${centimos}`;

  if (Number(cifra) === 0) return '0.00';
  return negativo ? `-${cifra}` : cifra;
}

/* ---------------------------------------------------------------------------
 * El mapeo de columnas
 * -------------------------------------------------------------------------*/

/** Una columna y los valores suyos que NO se importan. */
export interface Descarte {
  columna: number;
  valores: string[];
}

export interface Mapeo {
  /** La fila 0 es cabecera y no un dato. */
  conCabecera: boolean;
  fecha: number;
  descripcion: number;
  /**
   * La columna que dice de qué cuenta es cada línea, cuando el archivo trae
   * varias. Mercury exporta las nueve cuentas en el mismo CSV, y un extracto
   * de nueve cuentas importado entero en una sola no es un extracto: es
   * basura con fechas.
   */
  cuenta: number | null;
  /** Cuál de sus valores es la cuenta que se está importando. */
  cuentaValor: string | null;
  /**
   * Filas que no se importan por lo que dice una columna. El caso de siempre:
   * una transacción con estado «Failed» nunca ocurrió, y meterla en el
   * extracto sería inventar un movimiento que el banco rechazó.
   */
  descartar: Descarte[];
  /** Una sola columna con signo… */
  importe: number | null;
  /** …o dos, lo que sale y lo que entra. Es como lo da medio Perú. */
  cargo: number | null;
  abono: number | null;
  referencia: number | null;
  decimal: SeparadorDecimal;
  orden: OrdenDeFecha;
}

const PISTAS = {
  fecha: ['fecha', 'date', 'f. oper', 'f oper', 'fec'],
  descripcion: ['descrip', 'concepto', 'detalle', 'glosa', 'operacion', 'operación', 'memo'],
  importe: ['importe', 'monto', 'amount', 'valor'],
  cargo: ['cargo', 'debito', 'débito', 'debit', 'salida', 'retiro'],
  abono: ['abono', 'credito', 'crédito', 'credit', 'entrada', 'deposito', 'depósito'],
  referencia: ['referencia', 'ref', 'operacion', 'operación', 'nro', 'número', 'numero', 'doc'],
  cuenta: ['source account', 'cuenta origen', 'cuenta', 'account'],
  estado: ['status', 'estado', 'state'],
} as const;

/** Lo que en cualquier banco significa «esto no pasó». */
const NO_PASO = /fail|fallid|rechaz|anulad|revers|declin|error|cancel|void/i;

/** Los valores distintos de una columna, con cuántas filas tiene cada uno. */
export function valoresDe(
  filas: readonly (readonly string[])[],
  columna: number,
  conCabecera: boolean,
): { valor: string; cuantas: number }[] {
  const datos = conCabecera ? filas.slice(1) : filas;
  const cuenta = new Map<string, number>();
  for (const f of datos) {
    const v = (f[columna] ?? '').trim();
    cuenta.set(v, (cuenta.get(v) ?? 0) + 1);
  }
  return [...cuenta.entries()]
    .map(([valor, cuantas]) => ({ valor, cuantas }))
    .sort((a, b) => b.cuantas - a.cuantas || a.valor.localeCompare(b.valor));
}

/**
 * La columna cuyo nombre encaja con alguna pista, saltándose las que ya
 * tienen dueño.
 *
 * Lo de saltarse las tomadas no es un detalle: «Operación» es el nombre que
 * un banco le da a la descripción y otro al número de operación, así que la
 * misma pista está en las dos listas. Buscando en orden —primero la
 * descripción, después la referencia— y sin repetir columna, cada una se
 * queda con la suya.
 */
function buscaColumna(
  cabecera: readonly string[],
  pistas: readonly string[],
  tomadas: ReadonlySet<number> = new Set(),
): number | null {
  for (let i = 0; i < cabecera.length; i += 1) {
    if (tomadas.has(i)) continue;
    const texto = (cabecera[i] ?? '').toLowerCase();
    if (pistas.some((p) => texto.includes(p))) return i;
  }
  return null;
}

/** Parece cabecera si ninguna celda se lee como fecha ni como importe. */
export function pareceCabecera(fila: readonly string[]): boolean {
  if (fila.length === 0) return false;
  const conFecha = fila.some((c) => parsearFecha(c, 'dmy') !== null);
  const conNumero = fila.some((c) => /^[\s(]*-?[\d.,]+[\s)]*$/.test(c) && /\d/.test(c));
  return !conFecha && !conNumero;
}

/**
 * El mapeo propuesto. Se mira la cabecera por nombre y, cuando no hay o no
 * dice nada, se deduce de los datos: la columna que se lee como fecha en casi
 * todas las filas es la fecha, y la más larga de texto es la descripción.
 */
export function adivinarMapeo(filas: readonly (readonly string[])[]): Mapeo {
  const conCabecera = filas.length > 1 && pareceCabecera(filas[0] ?? []);
  const cabecera = conCabecera ? (filas[0] ?? []) : [];
  const datos = conCabecera ? filas.slice(1) : filas;
  const columnas = Math.max(0, ...filas.map((f) => f.length));

  const columna = (i: number): string[] => datos.map((f) => f[i] ?? '');

  const tomadas = new Set<number>();
  const tomar = (i: number | null): number | null => {
    if (i !== null) tomadas.add(i);
    return i;
  };

  let fecha = tomar(buscaColumna(cabecera, PISTAS.fecha));
  if (fecha === null) {
    let mejor = -1;
    for (let i = 0; i < columnas; i += 1) {
      const vals = columna(i);
      const aciertos = vals.filter((v) => parsearFecha(v, 'dmy') !== null).length;
      if (aciertos > mejor && aciertos > vals.length / 2) {
        mejor = aciertos;
        fecha = i;
      }
    }
    tomar(fecha);
  }

  let descripcion = tomar(buscaColumna(cabecera, PISTAS.descripcion, tomadas));
  if (descripcion === null) {
    let masLarga = -1;
    for (let i = 0; i < columnas; i += 1) {
      if (i === fecha) continue;
      const vals = columna(i);
      const letras = vals.filter((v) => /[a-zA-ZáéíóúñÁÉÍÓÚÑ]/.test(v)).length;
      const largo = vals.reduce((n, v) => n + v.length, 0);
      if (letras > vals.length / 2 && largo > masLarga) {
        masLarga = largo;
        descripcion = i;
      }
    }
    tomar(descripcion);
  }

  const cargo = tomar(buscaColumna(cabecera, PISTAS.cargo, tomadas));
  const abono = tomar(buscaColumna(cabecera, PISTAS.abono, tomadas));
  let importe = tomar(buscaColumna(cabecera, PISTAS.importe, tomadas));

  if (importe === null && (cargo === null || abono === null)) {
    for (let i = 0; i < columnas; i += 1) {
      if (i === fecha || i === descripcion) continue;
      const vals = columna(i);
      const numeros = vals.filter((v) => /\d/.test(v) && /^[\s(]*-?[\d.,]+[\s)]*$/.test(v)).length;
      if (numeros > vals.length / 2) {
        importe = tomar(i);
        break;
      }
    }
  }

  const deImportes = [importe, cargo, abono]
    .filter((i): i is number => i !== null)
    .flatMap((i) => columna(i));

  /*
    La columna que dice de qué cuenta es cada fila. Si trae un solo valor, el
    archivo es de una cuenta y no hay nada que elegir; si trae varios, se deja
    sin elegir **a propósito**, para que la pantalla lo pida. Elegir una por
    él sería importar ocho cuentas ajenas en silencio.
  */
  const colCuenta = buscaColumna(cabecera, PISTAS.cuenta, tomadas);
  const deCuenta = colCuenta === null ? [] : valoresDe(filas, colCuenta, conCabecera);

  /*
    Y las filas que no pasaron. El estado se busca por nombre y sus valores
    por lo que significan en cualquier banco: una transacción rechazada no es
    un movimiento, es un intento.
  */
  const colEstado = buscaColumna(cabecera, PISTAS.estado, tomadas);
  const malos =
    colEstado === null
      ? []
      : valoresDe(filas, colEstado, conCabecera)
          .filter((v) => NO_PASO.test(v.valor))
          .map((v) => v.valor);

  return {
    conCabecera,
    fecha: fecha ?? 0,
    descripcion: descripcion ?? (fecha === 1 ? 0 : 1),
    cuenta: colCuenta,
    cuentaValor: deCuenta.length === 1 ? (deCuenta[0]?.valor ?? null) : null,
    descartar:
      colEstado !== null && malos.length > 0 ? [{ columna: colEstado, valores: malos }] : [],
    importe: cargo !== null && abono !== null ? null : importe,
    cargo: cargo !== null && abono !== null ? cargo : null,
    abono: cargo !== null && abono !== null ? abono : null,
    referencia: buscaColumna(cabecera, PISTAS.referencia, tomadas),
    decimal: adivinarDecimal(deImportes),
    orden: adivinarOrdenDeFecha(fecha === null ? [] : columna(fecha)),
  };
}

/* ---------------------------------------------------------------------------
 * De filas a líneas importables
 * -------------------------------------------------------------------------*/

export interface LineaImportable {
  fecha: string;
  /** Con signo: negativo es dinero que salió. Texto, no `number`. */
  importe: string;
  descripcion: string;
  referencia?: string;
  raw: Record<string, string>;
}

export interface Lectura {
  lineas: LineaImportable[];
  /** Qué filas no se pudieron leer y por qué. Se enseñan, no se tragan. */
  descartadas: { fila: number; por: string }[];
  /** Cuántas quedaron fuera por cada filtro, y por cuál. También se enseñan. */
  fuera: { por: string; cuantas: number }[];
}

/**
 * Aplica el mapeo. Una fila que no se puede leer **no se salta en silencio**:
 * se devuelve en `descartadas` con el motivo, porque un importador que se come
 * tres líneas sin decirlo deja una conciliación que no cuadra y nadie sabe por
 * qué.
 */
export function aLineas(
  filas: readonly (readonly string[])[],
  mapeo: Mapeo,
): Lectura {
  const datos = mapeo.conCabecera ? filas.slice(1) : filas;
  const cabecera = mapeo.conCabecera ? (filas[0] ?? []) : [];
  const lineas: LineaImportable[] = [];
  const descartadas: { fila: number; por: string }[] = [];
  const fuera = new Map<string, number>();
  const nombreCol = (i: number) => (cabecera[i] ?? '').trim() || `columna ${i + 1}`;
  const sumaFuera = (por: string) => fuera.set(por, (fuera.get(por) ?? 0) + 1);

  datos.forEach((fila, i) => {
    const numero = i + 1 + (mapeo.conCabecera ? 1 : 0);

    // Los filtros van antes de leer nada: una fila de otra cuenta no es una
    // fila ilegible, es una fila que no toca, y mezclarlas en el mismo aviso
    // haría parecer roto un archivo que está bien.
    if (mapeo.cuenta !== null && mapeo.cuentaValor !== null) {
      if ((fila[mapeo.cuenta] ?? '').trim() !== mapeo.cuentaValor) {
        sumaFuera('son de otra cuenta');
        return;
      }
    }

    for (const d of mapeo.descartar) {
      if (d.valores.includes((fila[d.columna] ?? '').trim())) {
        sumaFuera(`${nombreCol(d.columna)} dice «${(fila[d.columna] ?? '').trim()}»`);
        return;
      }
    }

    const fecha = parsearFecha(fila[mapeo.fecha] ?? '', mapeo.orden);
    if (fecha === null) {
      descartadas.push({ fila: numero, por: 'no se pudo leer la fecha' });
      return;
    }

    let importe: string | null = null;
    if (mapeo.importe !== null) {
      importe = parsearImporte(fila[mapeo.importe] ?? '', mapeo.decimal);
    } else {
      const sale = parsearImporte(fila[mapeo.cargo ?? -1] ?? '', mapeo.decimal);
      const entra = parsearImporte(fila[mapeo.abono ?? -1] ?? '', mapeo.decimal);
      if (sale !== null && Number(sale) !== 0) {
        // En dos columnas el cargo ya es una salida: su signo lo da la
        // columna, no el número. Un «-118» en la columna de cargos son
        // ciento dieciocho que salieron, no que entraron.
        importe = `-${sale.replace('-', '')}`;
      } else if (entra !== null && Number(entra) !== 0) {
        importe = entra.replace('-', '');
      }
    }

    if (importe === null || Number(importe) === 0) {
      descartadas.push({ fila: numero, por: 'la línea no tiene importe' });
      return;
    }

    const raw: Record<string, string> = {};
    fila.forEach((valor, c) => {
      const nombre = (cabecera[c] ?? `col${c + 1}`).trim() || `col${c + 1}`;
      raw[nombre] = valor;
    });

    const referencia =
      mapeo.referencia === null ? '' : (fila[mapeo.referencia] ?? '').trim();

    lineas.push({
      fecha,
      importe,
      descripcion: (fila[mapeo.descripcion] ?? '').trim() || 'Sin concepto',
      ...(referencia ? { referencia } : {}),
      raw,
    });
  });

  return {
    lineas,
    descartadas,
    fuera: [...fuera.entries()].map(([por, cuantas]) => ({ por, cuantas })),
  };
}

/* ---------------------------------------------------------------------------
 * Proponer emparejamientos
 * -------------------------------------------------------------------------*/

export interface LineaDelBanco {
  id: string;
  value_date: string;
  direction: 'in' | 'out';
  amount: string | number;
  description: string;
  external_ref: string | null;
  currency_code: string;
}

export interface MovimientoDelLibro {
  id: string;
  value_date: string;
  direction: 'in' | 'out';
  amount: string | number;
  description: string;
  external_ref: string | null;
  currency_code: string;
}

export interface Propuesta {
  lineaId: string;
  movimientoId: string;
  /** `exacta` cuando coinciden importe y día o referencia. */
  confianza: 'exacta' | 'probable';
  /** Por qué se propone, para que se pueda decidir sin abrir nada. */
  porque: string;
}

const DIA = 86_400_000;

function diasEntre(a: string, b: string): number {
  const x = Date.parse(`${a}T00:00:00Z`);
  const y = Date.parse(`${b}T00:00:00Z`);
  if (Number.isNaN(x) || Number.isNaN(y)) return 999;
  return Math.abs(Math.round((x - y) / DIA));
}

function importeDe(valor: string | number, moneda: CurrencyCode): Money | null {
  try {
    return fromDb(typeof valor === 'string' ? valor : String(valor), moneda);
  } catch {
    return null;
  }
}

/** Dos referencias iguales ignorando mayúsculas, espacios y guiones. */
export function mismaReferencia(a: string | null, b: string | null): boolean {
  const limpia = (x: string | null) => (x ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const x = limpia(a);
  const y = limpia(b);
  // Tres caracteres no son una referencia: son una coincidencia.
  return x.length >= 4 && x === y;
}

/**
 * Qué movimiento le toca a cada línea.
 *
 * El criterio es estrecho a propósito: **mismo importe, misma dirección y la
 * fecha a menos de cinco días**, o la misma referencia. Y la regla que más
 * importa: **si hay dos candidatos igual de buenos, no se propone ninguno.**
 * Una propuesta ambigua aceptada a ciegas tacha la línea con el movimiento
 * equivocado, y entonces las dos listas cuadran con los pares cambiados, que
 * es peor que no haber conciliado.
 *
 * Los movimientos ya conciliados no entran: `yaConciliados` los trae.
 */
export function proponer(
  lineas: readonly LineaDelBanco[],
  movimientos: readonly MovimientoDelLibro[],
  yaConciliados: ReadonlySet<string>,
  dias = 5,
): Propuesta[] {
  const propuestas: Propuesta[] = [];
  const tomados = new Set<string>(yaConciliados);

  // Primero las coincidencias exactas por referencia, que son las seguras, y
  // después las de importe y fecha: así un movimiento con referencia no se
  // gasta en una coincidencia floja de otra línea.
  for (const pasada of ['referencia', 'importe'] as const) {
    for (const linea of lineas) {
      if (propuestas.some((p) => p.lineaId === linea.id)) continue;

      let moneda: CurrencyCode;
      try {
        moneda = currencyOf(linea.currency_code);
      } catch {
        continue;
      }
      const importeLinea = importeDe(linea.amount, moneda);
      if (!importeLinea) continue;

      const candidatos = movimientos.filter((m) => {
        if (tomados.has(m.id)) return false;
        if (m.direction !== linea.direction) return false;
        if (m.currency_code !== linea.currency_code) return false;
        const suyo = importeDe(m.amount, moneda);
        if (!suyo || suyo.minor !== importeLinea.minor) return false;
        if (pasada === 'referencia') return mismaReferencia(linea.external_ref, m.external_ref);
        return diasEntre(linea.value_date, m.value_date) <= dias;
      });

      // Dos candidatos igual de buenos no son una propuesta.
      if (candidatos.length !== 1) continue;
      const elegido = candidatos[0]!;
      tomados.add(elegido.id);

      const mismoDia = diasEntre(linea.value_date, elegido.value_date) === 0;
      propuestas.push({
        lineaId: linea.id,
        movimientoId: elegido.id,
        confianza: pasada === 'referencia' || mismoDia ? 'exacta' : 'probable',
        porque:
          pasada === 'referencia'
            ? `misma referencia (${elegido.external_ref ?? ''})`
            : mismoDia
              ? 'mismo importe y mismo día'
              : `mismo importe, ${diasEntre(linea.value_date, elegido.value_date)} días de diferencia`,
      });
    }
  }

  return propuestas;
}

export const PARA_QUE =
  'Cruzar lo que tú anotaste con lo que el banco dice que pasó. Conciliar no crea dinero: solo deja por escrito qué línea del extracto es qué movimiento tuyo, y enseña lo que sobra de cada lado.';
