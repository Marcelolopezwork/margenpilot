/**
 * La cotización que ve el cliente.
 *
 * Dos reglas gobiernan este archivo:
 *
 * 1. **Aquí no se calcula nada.** Todo llega ya formateado desde `money.ts`.
 *    Si este módulo sumara, habría dos aritméticas en el producto y tarde o
 *    temprano una diría algo distinto de la otra.
 * 2. **El costo no sale.** El cliente ve qué contrata y cuánto paga. Que
 *    detrás haya tres horas de diseñador o una licencia de stock es asunto
 *    nuestro. Por eso `DatosPdf` no tiene dónde meter un costo: la garantía
 *    es estructural, no un `if` que alguien pueda quitar.
 *
 * Cada servicio se imprime como un bloque con su descripción y su lista de
 * entregables, no como una fila de tabla. Una fila que dice «Aplicación a
 * medida · S/ 61,750» hace sentir al cliente que paga mucho por poco.
 *
 * jsPDF se carga solo al pulsar «Descargar». Pesa más que toda la aplicación
 * y no tiene sentido que viaje en cada visita.
 */

export type LineaPdf = {
  descripcion: string;
  /** La descripción del servicio, copiada de la ficha al cotizar. */
  resumen: string | null;
  /** Nota puntual de esta línea, si la hay. */
  detalle: string | null;
  incluye: string[];
  noIncluye: string[];
  cantidad: string;
  precioUnitario: string;
  importe: string;
};

export type DatosPdf = {
  numero: string;
  fecha: string;
  validaHasta: string | null;
  emisor: {
    nombre: string;
    taxId: string | null;
    direccion: string | null;
    telefono: string | null;
    email: string | null;
  };
  marca: {
    nombre: string;
    color: string | null;
    logoUrl: string | null;
    portadaUrl: string | null;
  } | null;
  cliente: { nombre: string; taxId: string | null };
  lineas: LineaPdf[];
  neto: string;
  /** Null cuando la cotización no aplica impuesto. */
  impuesto: { etiqueta: string; importe: string } | null;
  total: string;
  notas: string | null;
  condiciones: string | null;
};

const TINTA: [number, number, number] = [28, 26, 23];
const GRIS: [number, number, number] = [110, 110, 110];
const SUAVE: [number, number, number] = [245, 243, 239];

const IZQ = 16;
const DER = 194;
const ANCHO = DER - IZQ;
// Hasta dónde se puede escribir antes de abrir página. El número de
// página va en 289, así que 283 deja justo el aire necesario.
const PIE = 283;

function aRgb(hex: string | null): [number, number, number] {
  const limpio = (hex ?? '').trim().replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(limpio)) return [42, 75, 141];
  return [
    parseInt(limpio.slice(0, 2), 16),
    parseInt(limpio.slice(2, 4), 16),
    parseInt(limpio.slice(4, 6), 16),
  ];
}

type Imagen = { datos: string; ancho: number; alto: number };

/**
 * Descarga una imagen y la convierte a data URL, que es lo que jsPDF
 * entiende. Si falla —no está, no hay red, es un SVG— se sigue sin ella: una
 * cotización sin logotipo es fea, pero una que no se genera es inútil.
 */
async function cargarImagen(url: string): Promise<Imagen | null> {
  try {
    const respuesta = await fetch(url);
    if (!respuesta.ok) return null;
    const blob = await respuesta.blob();
    if (blob.type === 'image/svg+xml') return null; // jsPDF no dibuja SVG

    const datos = await new Promise<string>((resolve, reject) => {
      const lector = new FileReader();
      lector.onload = () => resolve(String(lector.result));
      lector.onerror = () => reject(new Error('no se pudo leer la imagen'));
      lector.readAsDataURL(blob);
    });

    const medidas = await new Promise<{ ancho: number; alto: number }>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ ancho: img.naturalWidth, alto: img.naturalHeight });
      img.onerror = () => reject(new Error('no se pudo medir la imagen'));
      img.src = datos;
    });

    return { datos, ...medidas };
  } catch {
    return null;
  }
}

export async function construirCotizacionPdf(d: DatosPdf) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const color = aRgb(d.marca?.color ?? null);

  const [logo, portada] = await Promise.all([
    d.marca?.logoUrl ? cargarImagen(d.marca.logoUrl) : Promise.resolve(null),
    d.marca?.portadaUrl ? cargarImagen(d.marca.portadaUrl) : Promise.resolve(null),
  ]);

  let y = 16;

  /** Abre página nueva si lo que viene no cabe. */
  const sitio = (alto: number) => {
    if (y + alto > PIE) {
      doc.addPage();
      y = 20;
    }
  };

  // ------------------------------------------------------------------ portada
  if (portada) {
    // Banda recortada al ancho de la página: una portada apaisada manda, una
    // vertical se recorta por el centro en vez de deformarse.
    const alto = 46;
    const anchoEscalado = (portada.ancho / portada.alto) * alto;
    const ancho = Math.max(210, anchoEscalado);
    doc.addImage(portada.datos, (210 - ancho) / 2, 0, ancho, alto);
    y = alto + 12;
  }

  // ----------------------------------------------------------------- cabecera
  const yCabecera = y;
  if (logo) {
    const alto = 14;
    const ancho = Math.min(52, (logo.ancho / logo.alto) * alto);
    doc.addImage(logo.datos, IZQ, y - 3, ancho, alto);
    y += alto + 1;
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(...color);
  doc.text(d.marca?.nombre ?? d.emisor.nombre, IZQ, y);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...GRIS);
  y += 5;
  doc.text(d.emisor.nombre + (d.emisor.taxId ? ` · ${d.emisor.taxId}` : ''), IZQ, y);

  const contacto = [d.emisor.direccion, d.emisor.telefono, d.emisor.email]
    .filter(Boolean)
    .join('  ·  ');
  if (contacto) {
    y += 4.5;
    doc.text(contacto, IZQ, y);
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...TINTA);
  doc.text('COTIZACIÓN', DER, yCabecera, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(d.numero, DER, yCabecera + 6, { align: 'right' });
  doc.setFontSize(9);
  doc.setTextColor(...GRIS);
  doc.text(d.fecha, DER, yCabecera + 11, { align: 'right' });
  if (d.validaHasta) {
    doc.text(`Válida hasta ${d.validaHasta}`, DER, yCabecera + 15.5, { align: 'right' });
  }

  y = Math.max(y, yCabecera + 18) + 6;
  doc.setDrawColor(...color);
  doc.setLineWidth(0.8);
  doc.line(IZQ, y, DER, y);
  y += 9;

  // ------------------------------------------------------------------ cliente
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...GRIS);
  doc.text('PARA', IZQ, y);
  y += 5;
  doc.setFontSize(12);
  doc.setTextColor(...TINTA);
  doc.text(d.cliente.nombre, IZQ, y);
  if (d.cliente.taxId) {
    y += 4.5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...GRIS);
    doc.text(d.cliente.taxId, IZQ, y);
  }
  y += 11;

  // ------------------------------------------------------- bloque por servicio
  d.lineas.forEach((l, i) => {
    const resumen = l.resumen ? doc.splitTextToSize(l.resumen, ANCHO - 14) : [];
    const detalle = l.detalle ? doc.splitTextToSize(l.detalle, ANCHO - 14) : [];
    // Alto aproximado para decidir el salto de página antes de empezar.
    const alto =
      16 +
      resumen.length * 4.4 +
      detalle.length * 4.4 +
      (l.incluye.length ? 6 + l.incluye.length * 4.8 : 0) +
      (l.noIncluye.length ? 6 + l.noIncluye.length * 4.8 : 0) +
      8;
    sitio(alto);

    const yInicio = y;

    // Numeración y título
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...color);
    doc.text(String(i + 1).padStart(2, '0'), IZQ + 3, y + 6);

    doc.setFontSize(12);
    doc.setTextColor(...TINTA);
    doc.text(l.descripcion.toUpperCase(), IZQ + 13, y + 6);

    doc.setFontSize(12);
    doc.text(l.importe, DER - 4, y + 6, { align: 'right' });

    if (l.cantidad !== '1') {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(...GRIS);
      doc.text(`${l.cantidad} × ${l.precioUnitario}`, DER - 4, y + 11, { align: 'right' });
    }
    y += 12;

    if (resumen.length) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      doc.setTextColor(...GRIS);
      doc.text(resumen, IZQ + 13, y);
      y += resumen.length * 4.4 + 2;
    }

    if (detalle.length) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(9);
      doc.setTextColor(...GRIS);
      doc.text(detalle, IZQ + 13, y);
      y += detalle.length * 4.4 + 2;
    }

    const lista = (titulo: string, puntos: string[], viñeta: string) => {
      if (!puntos.length) return;
      y += 2;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(...color);
      doc.text(titulo, IZQ + 13, y);
      y += 4.5;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      doc.setTextColor(...TINTA);
      for (const punto of puntos) {
        const lineas = doc.splitTextToSize(punto, ANCHO - 22);
        sitio(lineas.length * 4.6 + 2);
        doc.text(viñeta, IZQ + 14, y);
        doc.text(lineas, IZQ + 19, y);
        y += lineas.length * 4.6 + 0.6;
      }
    };

    lista('INCLUYE', l.incluye, '•');
    lista('NO INCLUYE', l.noIncluye, '–');

    y += 3;
    // Filete lateral del color de la marca: marca el bloque sin encajonarlo.
    doc.setDrawColor(...color);
    doc.setLineWidth(1.6);
    doc.line(IZQ, yInicio + 1, IZQ, Math.min(y - 2, PIE));
    y += 7;
  });

  // --------------------------------------------- totales y pie, lado a lado
  //
  // En columnas y no uno debajo de otro: el recuadro de totales deja un hueco
  // blanco enorme a su izquierda, y las notas empujadas abajo se llevaban una
  // página entera para dos párrafos.
  // El recuadro de totales solo necesita caber «Subtotal» y una cifra. Darle
  // menos ancho deja respirar al texto de la izquierda, que es el que se
  // parte en muchas líneas y empujaba todo a una página nueva.
  const ANCHO_CAJA = 70;
  const ANCHO_PIE = DER - ANCHO_CAJA - IZQ - 10;

  const pie: { titulo: string; lineas: string[] }[] = [];
  doc.setFontSize(9.5);
  if (d.notas) pie.push({ titulo: 'NOTAS', lineas: doc.splitTextToSize(d.notas, ANCHO_PIE) });
  if (d.condiciones) {
    pie.push({ titulo: 'CONDICIONES', lineas: doc.splitTextToSize(d.condiciones, ANCHO_PIE) });
  }

  const altoCaja = d.impuesto ? 30 : 26;
  const altoPie = pie.reduce((s, b) => s + 9 + b.lineas.length * 4.4 + 3, 0);
  sitio(Math.max(altoCaja, altoPie) + 6);

  const yBloque = y + 2;

  // Columna derecha: los totales.
  let yT = yBloque + 6;
  doc.setFillColor(...SUAVE);
  doc.rect(DER - ANCHO_CAJA, yBloque, ANCHO_CAJA, altoCaja, 'F');

  const fila = (etiqueta: string, importe: string, fuerte: boolean) => {
    doc.setFont('helvetica', fuerte ? 'bold' : 'normal');
    doc.setFontSize(fuerte ? 12 : 10);
    doc.setTextColor(...(fuerte ? color : GRIS));
    doc.text(etiqueta, DER - ANCHO_CAJA + 4, yT);
    doc.setTextColor(...(fuerte ? color : TINTA));
    doc.text(importe, DER - 4, yT, { align: 'right' });
    yT += fuerte ? 9 : 6.5;
  };

  fila('Subtotal', d.neto, false);
  if (d.impuesto) fila(d.impuesto.etiqueta, d.impuesto.importe, false);
  doc.setDrawColor(...color);
  doc.setLineWidth(0.4);
  doc.line(DER - ANCHO_CAJA + 4, yT - 4, DER - 4, yT - 4);
  yT += 1;
  fila('Total', d.total, true);

  if (!d.impuesto) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...GRIS);
    doc.text('Precio final. No se aplica impuesto.', DER - 4, yT, { align: 'right' });
    yT += 6;
  }

  // Columna izquierda: notas y condiciones.
  let yP = yBloque + 4;
  for (const b of pie) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...GRIS);
    doc.text(b.titulo, IZQ, yP);
    yP += 5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(...TINTA);
    doc.text(b.lineas, IZQ, yP);
    yP += b.lineas.length * 4.4 + 6;
  }

  y = Math.max(yT, yP);

  // Numeración de páginas, solo si hay más de una.
  const paginas = doc.getNumberOfPages();
  if (paginas > 1) {
    for (let p = 1; p <= paginas; p++) {
      doc.setPage(p);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(...GRIS);
      doc.text(`${d.numero}  ·  ${p} de ${paginas}`, DER, 289, { align: 'right' });
    }
  }

  return doc;
}

export function nombreDelArchivo(d: DatosPdf): string {
  const limpio = d.cliente.nombre.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${d.numero}-${limpio || 'cliente'}.pdf`;
}

export async function descargarCotizacionPdf(d: DatosPdf): Promise<void> {
  const doc = await construirCotizacionPdf(d);
  doc.save(nombreDelArchivo(d));
}
