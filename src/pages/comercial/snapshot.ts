/**
 * Leer una versión emitida.
 *
 * Lo que arregla este archivo: hasta ahora los dos documentos —el A4 y la
 * propuesta en láminas— se dibujaban del estado actual de la cotización. Si
 * mañana sube el costo de una licencia, o alguien reescribe la ficha de un
 * servicio, reimprimir una cotización de hace un mes daba un papel distinto
 * del que recibió el cliente. Al emitir, la base guarda una copia completa
 * (`quote_versions.snapshot`) y de aquí sale el documento de esa copia.
 *
 * Lo que llega es `jsonb`, o sea `unknown`: puede traer cualquier cosa. Por
 * eso se lee a la defensiva, igual que el diseño de la propuesta. Un snapshot
 * que no se entienda devuelve `null` y la pantalla lo dice, en vez de romper
 * mostrando un documento a medias.
 *
 * Aquí tampoco hay sitio para un costo: el snapshot no los guarda y
 * `DatosPdf` no tendría dónde ponerlos. El margen de una versión vive en
 * `quote_version_costs`, con su propia política.
 */

import { formatoFecha, formatoMesAño, formatoTasa } from '../../lib/format';
import { currencyOf, format, fromDb } from '../../lib/money';
import type { CurrencyCode } from '../../lib/money';
import type { DatosPdf } from '../../lib/pdf';
import type { DatosPropuesta, Diseño } from '../../propuesta/tipos';
import { leerDiseño } from '../../propuesta/tipos';
import { notaDeImpuesto } from './totales';

type Objeto = Record<string, unknown>;

function objeto(v: unknown): Objeto | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Objeto) : null;
}

function texto(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null;
}

function lista(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

export type EntregableSnapshot = { tipo: string; texto: string };

export type LineaSnapshot = {
  id: string;
  nombre: string;
  resumen: string | null;
  detalle: string | null;
  cantidad: string;
  precioUnitario: string;
  neto: string;
  entregables: EntregableSnapshot[];
};

export type Snapshot = {
  numero: string;
  moneda: CurrencyCode;
  tasaImpuesto: string;
  impuestoAplicado: boolean;
  etiquetaImpuesto: string | null;
  validaHasta: string | null;
  notas: string | null;
  creadaEl: string | null;
  emisor: {
    nombre: string;
    taxId: string | null;
    direccion: string | null;
    telefono: string | null;
    email: string | null;
    condiciones: string | null;
  };
  marca: {
    nombre: string;
    logo: string | null;
    color: string | null;
    colorSecundario: string | null;
    foto: string | null;
  } | null;
  cliente: { nombre: string; taxId: string | null };
  lineas: LineaSnapshot[];
  diseño: Diseño;
};

export type TotalesSnapshot = {
  neto: string;
  impuesto: string;
  total: string;
  /** El total con el código de moneda: «S/ 3,776.00 PEN», como en el A4. */
  totalConCodigo: string;
};

/**
 * Convierte el `jsonb` de una versión en algo utilizable, o `null`.
 *
 * Exige número, moneda y al menos una línea: sin eso no hay documento que
 * dibujar, y adivinar los huecos sería inventarse una cotización.
 */
export function leerSnapshot(crudo: unknown): Snapshot | null {
  const raiz = objeto(crudo);
  if (!raiz) return null;

  const cot = objeto(raiz['cotizacion']);
  const numero = texto(cot?.['numero']);
  const codigoMoneda = texto(cot?.['moneda']);
  if (!numero || !codigoMoneda) return null;

  let moneda: CurrencyCode;
  try {
    moneda = currencyOf(codigoMoneda);
  } catch {
    return null;
  }

  const lineas: LineaSnapshot[] = [];
  for (const cruda of lista(raiz['lineas'])) {
    const l = objeto(cruda);
    const id = texto(l?.['id']);
    const nombre = texto(l?.['descripcion']);
    if (!l || !id || !nombre) continue;
    lineas.push({
      id,
      nombre,
      resumen: texto(l['resumen']),
      detalle: texto(l['detalle']),
      cantidad: texto(l['cantidad']) ?? '1',
      precioUnitario: texto(l['precio_unitario']) ?? '0',
      neto: texto(l['neto']) ?? '0',
      entregables: lista(l['entregables']).flatMap((e) => {
        const t = objeto(e);
        const tipo = texto(t?.['tipo']);
        const contenido = texto(t?.['texto']);
        return tipo && contenido ? [{ tipo, texto: contenido }] : [];
      }),
    });
  }
  if (lineas.length === 0) return null;

  const empresa = objeto(raiz['empresa']);
  const marca = objeto(raiz['marca']);
  const cliente = objeto(raiz['cliente']);

  return {
    numero,
    moneda,
    tasaImpuesto: texto(cot?.['tasa_impuesto']) ?? '0',
    impuestoAplicado: cot?.['impuesto_aplicado'] === true,
    etiquetaImpuesto: texto(cot?.['etiqueta_impuesto']),
    validaHasta: texto(cot?.['valida_hasta']),
    notas: texto(cot?.['notas']),
    creadaEl: texto(cot?.['creada_el']),
    emisor: {
      nombre: texto(empresa?.['razon_social']) ?? '',
      taxId: texto(empresa?.['tax_id']),
      direccion: texto(empresa?.['direccion']),
      telefono: texto(empresa?.['telefono']),
      email: texto(empresa?.['email']),
      condiciones: texto(empresa?.['condiciones']),
    },
    marca: marca
      ? {
          nombre: texto(marca['nombre']) ?? '',
          logo: texto(marca['logo']),
          color: texto(marca['color']),
          colorSecundario: texto(marca['color_secundario']),
          foto: texto(marca['foto']),
        }
      : null,
    cliente: {
      nombre: texto(cliente?.['nombre']) ?? '',
      taxId: texto(cliente?.['tax_id']),
    },
    lineas,
    diseño: leerDiseño(raiz['diseno']),
  };
}

/** Los tres importes que guardó la emisión, ya formateados con su moneda. */
export function leerTotales(crudo: unknown, moneda: CurrencyCode): TotalesSnapshot {
  const t = objeto(crudo);
  const importe = (clave: string, opciones?: { showCode?: boolean }) =>
    format(fromDb(texto(t?.[clave]) ?? '0', moneda), opciones);
  return {
    neto: importe('neto'),
    impuesto: importe('impuesto'),
    total: importe('total'),
    totalConCodigo: importe('total', { showCode: true }),
  };
}

function etiquetaDe(s: Snapshot): string {
  return s.etiquetaImpuesto ?? `Impuesto ${formatoTasa(s.tasaImpuesto)}`;
}

/** Las condiciones de la entidad más las de cada línea, sin repetir. */
function condicionesDe(s: Snapshot): string[] {
  const crudas = [
    ...(s.emisor.condiciones ?? '').split('\n'),
    ...s.lineas.flatMap((l) =>
      l.entregables.filter((e) => e.tipo === 'condition').map((e) => e.texto),
    ),
  ];
  const vistas = new Set<string>();
  const salida: string[] = [];
  for (const cruda of crudas) {
    const t = cruda.trim();
    if (!t) continue;
    const clave = t.toLocaleLowerCase('es').replace(/\s+/g, ' ');
    if (vistas.has(clave)) continue;
    vistas.add(clave);
    salida.push(t);
  }
  return salida;
}

function deLaLinea(l: LineaSnapshot, tipo: string): string[] {
  return l.entregables.filter((e) => e.tipo === tipo).map((e) => e.texto);
}

/** El documento A4 de una versión emitida. */
export function datosPdfDeSnapshot(
  s: Snapshot,
  totales: unknown,
  urlDe: (ruta: string | null) => string | null,
): DatosPdf {
  const sumas = leerTotales(totales, s.moneda);
  const conImpuesto = s.impuestoAplicado && Number(s.tasaImpuesto) > 0;
  const precio = (v: string) => format(fromDb(v, s.moneda));

  return {
    numero: s.numero,
    fecha: s.creadaEl ? formatoFecha(s.creadaEl) : '',
    periodo: s.creadaEl ? formatoMesAño(s.creadaEl) : '',
    validaHasta: s.validaHasta ? formatoFecha(s.validaHasta) : null,
    emisor: {
      nombre: s.emisor.nombre,
      taxId: s.emisor.taxId,
      direccion: s.emisor.direccion,
      telefono: s.emisor.telefono,
      email: s.emisor.email,
    },
    marca: s.marca
      ? {
          nombre: s.marca.nombre,
          color: s.marca.color,
          colorSecundario: s.marca.colorSecundario,
          logoUrl: urlDe(s.marca.logo),
          portadaUrl: urlDe(s.marca.foto),
        }
      : null,
    cliente: { nombre: s.cliente.nombre, taxId: s.cliente.taxId },
    lineas: s.lineas.map((l) => ({
      descripcion: l.nombre,
      resumen: l.resumen,
      detalle: l.detalle,
      incluye: deLaLinea(l, 'include'),
      noIncluye: deLaLinea(l, 'exclude'),
      condiciones: deLaLinea(l, 'condition'),
      cantidad: l.cantidad,
      precioUnitario: precio(l.precioUnitario),
      importe: precio(l.neto),
    })),
    neto: sumas.neto,
    impuesto: conImpuesto ? { etiqueta: etiquetaDe(s), importe: sumas.impuesto } : null,
    notaImpuesto: notaDeImpuesto(s.impuestoAplicado, s.tasaImpuesto, etiquetaDe(s)),
    total: sumas.totalConCodigo,
    notas: s.notas,
    condiciones: s.emisor.condiciones,
  };
}

/** La propuesta en láminas de una versión emitida. */
export function datosPropuestaDeSnapshot(
  s: Snapshot,
  totales: unknown,
  urlDe: (ruta: string | null) => string | null,
): DatosPropuesta {
  const sumas = leerTotales(totales, s.moneda);
  const conImpuesto = s.impuestoAplicado && Number(s.tasaImpuesto) > 0;
  const precio = (v: string) => format(fromDb(v, s.moneda));

  return {
    numero: s.numero,
    periodo: s.creadaEl ? formatoMesAño(s.creadaEl) : '',
    validaHasta: s.validaHasta ? formatoFecha(s.validaHasta) : null,
    emisor: {
      nombre: s.emisor.nombre,
      taxId: s.emisor.taxId,
      direccion: s.emisor.direccion,
      telefono: s.emisor.telefono,
      email: s.emisor.email,
      web: null,
    },
    marca: s.marca ? { nombre: s.marca.nombre, logoUrl: urlDe(s.marca.logo) } : null,
    cliente: { nombre: s.cliente.nombre, taxId: s.cliente.taxId },
    lineas: s.lineas.map((l) => ({
      id: l.id,
      nombre: l.nombre,
      resumen: l.resumen,
      detalle: l.detalle,
      incluye: deLaLinea(l, 'include'),
      noIncluye: deLaLinea(l, 'exclude'),
      condiciones: deLaLinea(l, 'condition'),
      cantidad: l.cantidad,
      precioUnitario: precio(l.precioUnitario),
      importe: precio(l.neto),
    })),
    neto: sumas.neto,
    impuesto: conImpuesto ? { etiqueta: etiquetaDe(s), importe: sumas.impuesto } : null,
    notaImpuesto: notaDeImpuesto(s.impuestoAplicado, s.tasaImpuesto, etiquetaDe(s)),
    total: sumas.total,
    notas: s.notas,
    condiciones: condicionesDe(s),
  };
}

/**
 * El diseño con el que se emitió, con la foto de la marca como respaldo. Es
 * lo mismo que hace la pantalla de la propuesta con los datos vivos: quien ya
 * subió la portada de su marca no tiene que volver a elegirla.
 */
export function diseñoDeSnapshot(s: Snapshot): Diseño {
  return { ...s.diseño, fotoPortada: s.diseño.fotoPortada ?? s.marca?.foto ?? null };
}
