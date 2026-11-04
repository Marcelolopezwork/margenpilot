/**
 * La propuesta en láminas: el formato que Marcelo manda a vender.
 *
 * Está calcado de la presentación que ya usaba —portada con foto a sangre,
 * índice, una portadilla y una lámina por servicio, condiciones y despedida—
 * porque ese documento ya le funciona y rehacerlo a mi gusto sería empeorar
 * algo que está probado. Lo único que cambia es de dónde salen los números:
 * antes los escribía en una diapositiva y ahora vienen de la cotización, ya
 * formateados.
 *
 * El tamaño de lámina es el de su presentación (25,4 × 14,29 cm), no A4: se
 * ve a pantalla completa en el portátil del cliente y se manda por correo sin
 * que nadie tenga que imprimir nada.
 *
 * Aquí tampoco se calcula ni se imprime un costo; la razón está en
 * `pdf-piezas.ts`, que es de donde vienen los datos.
 */

import {
  BLANCO,
  GRIS,
  PRIMARIO,
  SECUNDARIO,
  TINTA,
  aRgb,
  cargarImagen,
  condicionesDe,
  nombreDelArchivo,
  recortar,
} from './pdf-piezas';
import type { DatosPdf, Imagen, LineaPdf, Rgb } from './pdf-piezas';

type Doc = import('jspdf').jsPDF;

const ANCHO = 254;
const ALTO = 142.9;
const M = 22;
const DER = ANCHO - M;

/** Alto de línea del texto corrido. */
const INTERLINEA = 4.4;

/** Hasta dónde llega el cuerpo de una lámina antes de abrir otra. */
const CUERPO_PIE = 132;

/**
 * El precio vive abajo a la derecha. A partir de esta altura el texto se
 * estrecha para no meterse debajo: es lo que en maquetación sería un texto
 * que rodea una caja, hecho a mano porque jsPDF no sabe de flujos.
 */
const Y_PRECIO = 104;
const X_PRECIO = 150;

type Peso = 'normal' | 'bold';
type Pieza = { doc: Doc; d: DatosPdf; primario: Rgb; secundario: Rgb };

// ---------------------------------------------------------------- utilidades

function fuente(doc: Doc, tam: number, peso: Peso = 'normal') {
  doc.setFont('helvetica', peso);
  doc.setFontSize(tam);
}

function texto(
  doc: Doc,
  contenido: string | string[],
  x: number,
  y: number,
  opciones: {
    tam: number;
    color: Rgb;
    peso?: Peso;
    align?: 'left' | 'center' | 'right';
    espaciado?: number;
  },
) {
  fuente(doc, opciones.tam, opciones.peso ?? 'normal');
  doc.setTextColor(...opciones.color);
  doc.text(contenido, x, y, {
    align: opciones.align ?? 'left',
    charSpace: opciones.espaciado ?? 0,
  });
}

/**
 * Parte un texto en líneas de un ancho dado.
 *
 * Fija la fuente **antes** de medir, y no es un detalle: `splitTextToSize`
 * mide con la que esté puesta en ese momento, así que medir con el cuerpo de
 * un título y dibujar con el del texto daba renglones que se salían de la
 * caja. Costó una lámina con las condiciones metidas dentro de la foto.
 */
function partir(doc: Doc, contenido: string, ancho: number, tam: number, peso: Peso = 'normal') {
  fuente(doc, tam, peso);
  return doc.splitTextToSize(contenido, ancho) as string[];
}

function bloque(doc: Doc, color: Rgb, x: number, y: number, ancho: number, alto: number) {
  doc.setFillColor(...color);
  doc.rect(x, y, ancho, alto, 'F');
}

function regla(doc: Doc, color: Rgb, grosor: number, x1: number, y: number, x2: number) {
  doc.setDrawColor(...color);
  doc.setLineWidth(grosor);
  doc.line(x1, y, x2, y);
}

/**
 * Una foto a sangre, recortada al rectángulo. Si no hay foto se pinta el
 * color de la marca: una lámina con un bloque de color es sobria, una con un
 * hueco blanco parece rota.
 */
async function banda(
  p: Pieza,
  foto: Imagen | null,
  x: number,
  y: number,
  ancho: number,
  alto: number,
) {
  if (!foto) {
    bloque(p.doc, p.primario, x, y, ancho, alto);
    return;
  }
  const recortada = await recortar(foto, ancho / alto);
  p.doc.addImage(recortada.datos, x, y, ancho, alto);
}

function lamina(doc: Doc) {
  doc.addPage([ANCHO, ALTO], 'landscape');
}

/** El número de cotización, discreto, abajo a la izquierda. */
function firma(p: Pieza, x = M) {
  texto(p.doc, p.d.numero, x, 138, { tam: 7.5, color: GRIS });
}

// ------------------------------------------------------------------- láminas

async function portada(p: Pieza, foto: Imagen | null, logo: Imagen | null) {
  await banda(p, foto, 0, 0, ANCHO, 88);

  const centro = ANCHO / 2;
  texto(p.doc, 'PROPUESTA DE SERVICIOS', centro, 101, {
    tam: 9,
    color: p.secundario,
    peso: 'bold',
    align: 'center',
    espaciado: 2.2,
  });

  if (logo) {
    const alto = 15;
    const ancho = Math.min(80, (logo.ancho / logo.alto) * alto);
    p.doc.addImage(logo.datos, centro - ancho / 2, 106, ancho, alto);
  } else {
    texto(p.doc, p.d.marca?.nombre ?? p.d.emisor.nombre, centro, 119, {
      tam: 26,
      color: p.primario,
      peso: 'bold',
      align: 'center',
    });
  }

  regla(p.doc, p.secundario, 1.2, centro - 12, 126, centro + 12);

  texto(p.doc, `Para ${p.d.cliente.nombre}`, centro, 134, {
    tam: 13,
    color: TINTA,
    peso: 'bold',
    align: 'center',
  });
  texto(p.doc, `${p.d.periodo}  ·  ${p.d.numero}`, centro, 140, {
    tam: 8.5,
    color: GRIS,
    align: 'center',
  });
}

function indice(p: Pieza, entradas: { titulo: string; nota: string }[]) {
  lamina(p.doc);

  // Los dos filetes de los bordes: es el detalle que hace que el índice se
  // lea como una lámina y no como una lista suelta.
  bloque(p.doc, p.secundario, 0, 38, 5, 72);
  bloque(p.doc, p.secundario, ANCHO - 5, 33, 5, 72);

  texto(p.doc, 'ÍNDICE', ANCHO / 2, 30, {
    tam: 20,
    color: p.primario,
    peso: 'bold',
    align: 'center',
    espaciado: 3,
  });

  // El grupo se centra en el hueco en vez de colgar del título: con dos
  // entradas, pegarlas arriba deja media lámina vacía.
  const paso = Math.min(18, 76 / Math.max(entradas.length, 1));
  const inicio = 50 + (76 - paso * entradas.length) / 2;

  entradas.forEach((e, i) => {
    const y = inicio + i * paso;
    const altoBloque = Math.min(15, paso - 3);
    bloque(p.doc, p.primario, 26, y - altoBloque + 4.5, 24, altoBloque);
    texto(p.doc, String(i + 1).padStart(2, '0'), 38, y, {
      tam: 13,
      color: BLANCO,
      peso: 'bold',
      align: 'center',
    });
    texto(p.doc, partir(p.doc, e.titulo, 150, 13, 'bold').slice(0, 1), 58, y, {
      tam: 13,
      color: TINTA,
      peso: 'bold',
    });
    texto(p.doc, e.nota, DER, y, { tam: 9.5, color: GRIS, align: 'right' });
  });

  firma(p);
}

async function portadilla(p: Pieza, foto: Imagen | null, numero: number, titulo: string) {
  lamina(p.doc);
  await banda(p, foto, 0, 0, ANCHO, 76);

  // El bloque del número monta sobre el borde de la foto: así la portadilla
  // se lee como una sola pieza y no como una foto con texto debajo.
  bloque(p.doc, p.secundario, 105, 66, 44, 22);
  texto(p.doc, String(numero).padStart(2, '0'), 127, 81, {
    tam: 20,
    color: BLANCO,
    peso: 'bold',
    align: 'center',
  });

  texto(p.doc, partir(p.doc, titulo, 200, 20, 'bold').slice(0, 2), ANCHO / 2, 106, {
    tam: 20,
    color: p.primario,
    peso: 'bold',
    align: 'center',
  });

  regla(p.doc, p.secundario, 1, ANCHO / 2 - 10, 117, ANCHO / 2 + 10);
}

function laminaDeServicio(p: Pieza, l: LineaPdf) {
  const doc = p.doc;
  let continuacion = false;
  let y = 0;

  const abrir = () => {
    lamina(doc);
    const titulo = continuacion ? `${l.descripcion} (continúa)` : l.descripcion;
    const lineas = partir(doc, titulo, 210, 18, 'bold').slice(0, 2);
    texto(doc, lineas, ANCHO / 2, 24, { tam: 18, color: TINTA, peso: 'bold', align: 'center' });
    const yRegla = lineas.length > 1 ? 38 : 31;
    regla(doc, p.secundario, 0.9, ANCHO / 2 - 15, yRegla, ANCHO / 2 + 15);
    firma(p);
    continuacion = true;
    y = yRegla + 13;
  };

  abrir();

  /**
   * Parte un texto y, si el bloque va a caer en la zona del precio, lo vuelve
   * a partir más estrecho. Se mide dos veces a propósito: saber cuántas
   * líneas ocupa es la única forma de saber si llega hasta ahí abajo.
   */
  const bloqueDeTexto = (contenido: string, sangria: number, tam: number, peso: Peso) => {
    const ancho = (derecha: number) => derecha - M - sangria;
    const lineas = partir(doc, contenido, ancho(DER), tam, peso);
    if (y + lineas.length * INTERLINEA <= Y_PRECIO) return lineas;
    return partir(doc, contenido, ancho(X_PRECIO - 6), tam, peso);
  };

  const sitio = (alto: number) => {
    if (y + alto > CUERPO_PIE) abrir();
  };

  if (l.resumen) {
    const lineas = bloqueDeTexto(l.resumen, 0, 10, 'normal');
    sitio(lineas.length * INTERLINEA);
    texto(doc, lineas, M, y, { tam: 10, color: GRIS });
    y += lineas.length * INTERLINEA + 5;
  }

  if (l.detalle) {
    const lineas = bloqueDeTexto(l.detalle, 0, 9.5, 'normal');
    sitio(lineas.length * INTERLINEA);
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9.5);
    doc.setTextColor(...GRIS);
    doc.text(lineas, M, y);
    y += lineas.length * INTERLINEA + 5;
  }

  const lista = (titulo: string, puntos: string[], peso: Peso, color: Rgb) => {
    if (!puntos.length) return;
    sitio(14);
    texto(doc, titulo, M, y, { tam: 8, color: p.secundario, peso: 'bold', espaciado: 1.4 });
    y += 6.5;
    for (const punto of puntos) {
      const lineas = bloqueDeTexto(punto, 8, 10.5, peso);
      sitio(lineas.length * INTERLINEA + 2);
      texto(doc, '—', M, y, { tam: 10, color: p.secundario, peso: 'bold' });
      texto(doc, lineas, M + 8, y, { tam: 10.5, color, peso });
      y += lineas.length * INTERLINEA + 2.2;
    }
    y += 4;
  };

  lista('INCLUYE', l.incluye, 'bold', TINTA);
  lista('NO INCLUYE', l.noIncluye, 'normal', GRIS);

  // El precio va abajo a la derecha de la última lámina del servicio, como en
  // la presentación que ya mandaba: el cliente termina de leer qué recibe y
  // entonces ve cuánto cuesta.
  regla(doc, p.primario, 0.4, X_PRECIO, 109, DER);
  texto(doc, 'INVERSIÓN', DER, 116, {
    tam: 8,
    color: GRIS,
    peso: 'bold',
    align: 'right',
    espaciado: 2,
  });
  texto(doc, l.importe, DER, 128, { tam: 21, color: p.primario, peso: 'bold', align: 'right' });
  if (l.cantidad !== '1') {
    texto(doc, `${l.cantidad} × ${l.precioUnitario}`, DER, 134, {
      tam: 8.5,
      color: GRIS,
      align: 'right',
    });
  }
  texto(doc, p.d.notaImpuesto, DER, 139.5, { tam: 8.5, color: GRIS, align: 'right' });
}

function laminaDeInversion(p: Pieza) {
  const doc = p.doc;
  let y = 0;

  const abrir = () => {
    lamina(doc);
    texto(doc, 'INVERSIÓN', ANCHO / 2, 30, {
      tam: 20,
      color: p.primario,
      peso: 'bold',
      align: 'center',
      espaciado: 3,
    });
    firma(p);
    y = 50;
  };

  abrir();

  p.d.lineas.forEach((l, i) => {
    if (y + 11 > 96) abrir();
    texto(doc, String(i + 1).padStart(2, '0'), M, y, {
      tam: 9,
      color: p.secundario,
      peso: 'bold',
    });
    texto(doc, partir(doc, l.descripcion, 140, 11).slice(0, 1), M + 12, y, {
      tam: 11,
      color: TINTA,
    });
    texto(doc, l.importe, DER, y, { tam: 11, color: TINTA, peso: 'bold', align: 'right' });
    regla(doc, [226, 224, 220], 0.2, M, y + 3.5, DER);
    y += 11;
  });

  // Los totales, pegados a la derecha.
  const yTotales = Math.max(y + 6, 108);
  const fila = (etiqueta: string, importe: string, fuerte: boolean, yFila: number) => {
    texto(doc, etiqueta, X_PRECIO, yFila, {
      tam: fuerte ? 12 : 10,
      color: fuerte ? p.primario : GRIS,
      peso: fuerte ? 'bold' : 'normal',
    });
    texto(doc, importe, DER, yFila, {
      tam: fuerte ? 14 : 10,
      color: fuerte ? p.primario : TINTA,
      peso: 'bold',
      align: 'right',
    });
  };

  let yF = yTotales;
  fila('Subtotal', p.d.neto, false, yF);
  yF += 7;
  if (p.d.impuesto) {
    fila(p.d.impuesto.etiqueta, p.d.impuesto.importe, false, yF);
    yF += 7;
  }
  regla(doc, p.primario, 0.3, X_PRECIO, yF - 4, DER);
  yF += 3;
  fila('Total', p.d.total, true, yF);

  texto(doc, p.d.notaImpuesto, DER, yF + 7, { tam: 8.5, color: GRIS, align: 'right' });

  if (p.d.validaHasta) {
    texto(doc, `Cotización válida hasta ${p.d.validaHasta}`, M, yTotales, {
      tam: 9,
      color: GRIS,
    });
  }
}

async function laminaDeCondiciones(p: Pieza, foto: Imagen | null, condiciones: string[]) {
  const doc = p.doc;
  const X_FOTO = 176;
  // El texto termina bien antes de la foto: pegarse al borde se lee como un
  // error de maquetación aunque técnicamente quepa.
  const ANCHO_TEXTO = X_FOTO - 12 - (M + 8);
  let y = 0;

  const abrir = async () => {
    lamina(doc);
    // La foto en vertical a la derecha, como en su presentación: corta la
    // columna de texto y evita la lámina de puro párrafo.
    await banda(p, foto, X_FOTO, 0, ANCHO - X_FOTO, ALTO);
    texto(doc, 'CONDICIONES', M, 30, {
      tam: 20,
      color: p.primario,
      peso: 'bold',
      espaciado: 2.5,
    });
    firma(p);
    y = 46;
  };

  await abrir();

  for (const [i, condicion] of condiciones.entries()) {
    const lineas = partir(doc, condicion, ANCHO_TEXTO, 9);
    if (y + lineas.length * INTERLINEA > CUERPO_PIE) await abrir();
    texto(doc, String(i + 1).padStart(2, '0'), M, y, {
      tam: 8.5,
      color: p.secundario,
      peso: 'bold',
    });
    texto(doc, lineas, M + 8, y, { tam: 9, color: TINTA });
    y += lineas.length * INTERLINEA + 3.4;
  }
}

async function despedida(p: Pieza, foto: Imagen | null) {
  lamina(p.doc);
  await banda(p, foto, 0, 66, ANCHO, ALTO - 66);

  texto(p.doc, '¡GRACIAS!', M, 36, { tam: 34, color: p.primario, peso: 'bold' });
  texto(p.doc, 'CONTÁCTANOS', M, 47, {
    tam: 13,
    color: p.secundario,
    peso: 'bold',
    espaciado: 2.5,
  });

  const contacto = [p.d.emisor.email, p.d.emisor.telefono].filter(Boolean).join('  |  ');
  if (contacto) texto(p.doc, contacto, M, 55, { tam: 11, color: TINTA });

  const emisor = p.d.emisor.nombre + (p.d.emisor.taxId ? `  ·  ${p.d.emisor.taxId}` : '');
  texto(p.doc, emisor, M, 61, { tam: 8.5, color: GRIS });
}

// ------------------------------------------------------------------ montaje

export async function construirPropuestaPdf(d: DatosPdf) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [ANCHO, ALTO] });

  const p: Pieza = {
    doc,
    d,
    primario: aRgb(d.marca?.color ?? null, PRIMARIO),
    secundario: aRgb(d.marca?.colorSecundario ?? null, SECUNDARIO),
  };

  const [logo, foto] = await Promise.all([
    d.marca?.logoUrl ? cargarImagen(d.marca.logoUrl) : Promise.resolve(null),
    d.marca?.portadaUrl ? cargarImagen(d.marca.portadaUrl) : Promise.resolve(null),
  ]);

  const condiciones = condicionesDe(d);
  // Con un solo servicio el precio ya está en su lámina y una de totales solo
  // repetiría la misma cifra. Con impuesto sí hace falta: el cliente quiere
  // ver el desglose antes de firmar.
  const hayInversion = d.lineas.length > 1 || d.impuesto !== null;

  await portada(p, foto, logo);

  const entradas = d.lineas.map((l) => ({ titulo: l.descripcion, nota: 'Propuesta' }));
  if (hayInversion) entradas.push({ titulo: 'Inversión', nota: 'Resumen y total' });
  if (condiciones.length) entradas.push({ titulo: 'Condiciones', nota: 'Alcance y pagos' });
  indice(p, entradas);

  for (const [i, linea] of d.lineas.entries()) {
    await portadilla(p, foto, i + 1, linea.descripcion);
    laminaDeServicio(p, linea);
  }

  if (hayInversion) laminaDeInversion(p);
  if (condiciones.length) await laminaDeCondiciones(p, foto, condiciones);

  await despedida(p, foto);

  return doc;
}

export function nombreDeLaPropuesta(d: DatosPdf): string {
  return nombreDelArchivo(d, '-propuesta');
}

export async function descargarPropuestaPdf(d: DatosPdf): Promise<void> {
  const doc = await construirPropuestaPdf(d);
  doc.save(nombreDeLaPropuesta(d));
}
