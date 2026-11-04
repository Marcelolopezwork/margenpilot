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
 *    nuestro. Por eso esta función no recibe ni un solo costo: no puede
 *    imprimirlos aunque alguien se despiste.
 *
 * jsPDF se carga solo al pulsar «Descargar». Pesa más que toda la aplicación
 * y no tiene sentido que viaje en cada visita.
 */

export type LineaPdf = {
  descripcion: string;
  /** Lo que el cliente lee debajo del título. Puede faltar. */
  detalle: string | null;
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
  marca: { nombre: string; color: string | null; logoUrl: string | null } | null;
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

function aRgb(hex: string | null): [number, number, number] {
  const limpio = (hex ?? '').trim().replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(limpio)) return [42, 75, 141]; // el azul de la app
  return [
    parseInt(limpio.slice(0, 2), 16),
    parseInt(limpio.slice(2, 4), 16),
    parseInt(limpio.slice(4, 6), 16),
  ];
}

/**
 * Descarga el logo y lo convierte a data URL, que es lo que jsPDF entiende.
 * Si falla —la imagen no está, el formato no sirve, no hay red— se sigue sin
 * logo: una cotización sin logotipo es fea, pero una que no se genera es
 * inútil.
 */
async function cargarLogo(url: string): Promise<{ datos: string; ancho: number; alto: number } | null> {
  try {
    const respuesta = await fetch(url);
    if (!respuesta.ok) return null;
    const blob = await respuesta.blob();
    if (blob.type === 'image/svg+xml') return null; // jsPDF no dibuja SVG

    const datos = await new Promise<string>((resolve, reject) => {
      const lector = new FileReader();
      lector.onload = () => resolve(String(lector.result));
      lector.onerror = () => reject(new Error('no se pudo leer el logo'));
      lector.readAsDataURL(blob);
    });

    const medidas = await new Promise<{ ancho: number; alto: number }>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ ancho: img.naturalWidth, alto: img.naturalHeight });
      img.onerror = () => reject(new Error('no se pudo medir el logo'));
      img.src = datos;
    });

    return { datos, ...medidas };
  } catch {
    return null;
  }
}

/**
 * Construye el documento y lo devuelve sin descargarlo, que es lo que
 * permite comprobarlo en una prueba. `descargarCotizacionPdf` es esto más
 * una línea.
 */
export async function construirCotizacionPdf(d: DatosPdf) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ]);

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const color = aRgb(d.marca?.color ?? null);
  const IZQ = 16;
  const DER = 194;
  let y = 18;

  // ---------------------------------------------------------------- cabecera
  const logo = d.marca?.logoUrl ? await cargarLogo(d.marca.logoUrl) : null;
  if (logo) {
    // Alto fijo de 14 mm y ancho proporcional: un logo apaisado y uno
    // cuadrado tienen que verse igual de bien sin deformarse.
    const alto = 14;
    const ancho = Math.min(50, (logo.ancho / logo.alto) * alto);
    doc.addImage(logo.datos, IZQ, y - 4, ancho, alto);
    y += alto;
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

  // Bloque de la derecha: número y fechas.
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...TINTA);
  doc.text('COTIZACIÓN', DER, 18, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(d.numero, DER, 24, { align: 'right' });
  doc.setFontSize(9);
  doc.setTextColor(...GRIS);
  doc.text(d.fecha, DER, 29, { align: 'right' });
  if (d.validaHasta) doc.text(`Válida hasta ${d.validaHasta}`, DER, 33.5, { align: 'right' });

  y = Math.max(y, 36) + 6;
  doc.setDrawColor(...color);
  doc.setLineWidth(0.8);
  doc.line(IZQ, y, DER, y);
  y += 9;

  // ----------------------------------------------------------------- cliente
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...GRIS);
  doc.text('PARA', IZQ, y);
  y += 5;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...TINTA);
  doc.text(d.cliente.nombre, IZQ, y);
  if (d.cliente.taxId) {
    y += 4.5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...GRIS);
    doc.text(d.cliente.taxId, IZQ, y);
  }
  y += 8;

  // ------------------------------------------------------------------ líneas
  autoTable(doc, {
    startY: y,
    margin: { left: IZQ, right: 16 },
    head: [['Concepto', 'Cant.', 'Precio', 'Importe']],
    body: d.lineas.map((l) => [
      l.detalle ? `${l.descripcion}\n${l.detalle}` : l.descripcion,
      l.cantidad,
      l.precioUnitario,
      l.importe,
    ]),
    styles: { font: 'helvetica', fontSize: 9.5, cellPadding: 3, textColor: TINTA },
    headStyles: { fillColor: color, textColor: [255, 255, 255], fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 'auto' },
      1: { cellWidth: 18, halign: 'right' },
      2: { cellWidth: 30, halign: 'right' },
      3: { cellWidth: 32, halign: 'right' },
    },
    alternateRowStyles: { fillColor: [248, 247, 245] },
    // El detalle va en gris y más pequeño, debajo del concepto.
    didParseCell: (datos) => {
      if (datos.section === 'body' && datos.column.index === 0) {
        const texto = datos.cell.raw;
        if (typeof texto === 'string' && texto.includes('\n')) {
          datos.cell.styles.cellPadding = { top: 3, bottom: 3, left: 3, right: 3 };
        }
      }
    },
  });

  type ConAutoTable = { lastAutoTable?: { finalY: number } };
  y = ((doc as unknown as ConAutoTable).lastAutoTable?.finalY ?? y) + 8;

  // ------------------------------------------------------------------ totales
  const filas: [string, string, boolean][] = [['Subtotal', d.neto, false]];
  if (d.impuesto) filas.push([d.impuesto.etiqueta, d.impuesto.importe, false]);
  filas.push(['Total', d.total, true]);

  for (const [etiqueta, importe, fuerte] of filas) {
    if (fuerte) {
      doc.setDrawColor(...color);
      doc.setLineWidth(0.4);
      doc.line(DER - 70, y - 4, DER, y - 4);
    }
    doc.setFont('helvetica', fuerte ? 'bold' : 'normal');
    doc.setFontSize(fuerte ? 12 : 10);
    doc.setTextColor(...(fuerte ? color : GRIS));
    doc.text(etiqueta, DER - 70, y);
    doc.setTextColor(...(fuerte ? color : TINTA));
    doc.text(importe, DER, y, { align: 'right' });
    y += fuerte ? 8 : 6;
  }

  // Sin impuesto no se deja el hueco en blanco: se dice.
  if (!d.impuesto) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(...GRIS);
    doc.text('Precio final. No se aplica impuesto.', DER, y, { align: 'right' });
    y += 6;
  }

  // ------------------------------------------------------------- pie de página
  const bloque = (titulo: string, cuerpo: string) => {
    const lineas = doc.splitTextToSize(cuerpo, DER - IZQ);
    if (y + lineas.length * 4 > 275) {
      doc.addPage();
      y = 20;
    }
    y += 4;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...GRIS);
    doc.text(titulo, IZQ, y);
    y += 5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...TINTA);
    doc.text(lineas, IZQ, y);
    y += lineas.length * 4.2 + 2;
  };

  if (d.notas) bloque('NOTAS', d.notas);
  if (d.condiciones) bloque('CONDICIONES', d.condiciones);

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
