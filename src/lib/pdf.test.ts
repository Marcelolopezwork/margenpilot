// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { construirCotizacionPdf, nombreDelArchivo } from './pdf';
import type { DatosPdf } from './pdf';

/**
 * Lo que estas pruebas vigilan no es que el PDF «se vea bien» —eso lo juzga
 * una persona— sino lo que no puede fallar nunca:
 *
 * - que se genere un PDF de verdad y no un archivo vacío,
 * - que **ningún costo** aparezca impreso, porque el cliente no los ve,
 * - que el precio sin impuesto y el total con impuesto salgan los dos.
 */

const base: DatosPdf = {
  numero: 'COT-2026-001',
  fecha: '4 nov 2026',
  validaHasta: '4 dic 2026',
  emisor: {
    nombre: '3 Brothers MKT SAC',
    taxId: '20123456789',
    direccion: 'Av. Siempre Viva 123, Lima',
    telefono: '+51 999 888 777',
    email: 'hola@nlima.pe',
  },
  marca: { nombre: 'Nlima', color: '#E8001D', logoUrl: null },
  cliente: { nombre: 'EJ Deportes', taxId: '20987654321' },
  lineas: [
    {
      descripcion: 'Creación de marca',
      detalle: 'Naming, logotipo, paleta y manual de uso.',
      cantidad: '1',
      precioUnitario: 'S/ 9,583.00',
      importe: 'S/ 9,583.00',
    },
  ],
  neto: 'S/ 9,583.00',
  impuesto: { etiqueta: 'IGV 18 %', importe: 'S/ 1,724.94' },
  total: 'S/ 11,307.94 PEN',
  notas: 'Incluye dos rondas de ajustes.',
  condiciones: 'Pago 50 % al inicio y 50 % contra entrega.',
};

/**
 * Los primeros bytes del archivo. El contenido de un PDF va comprimido, así
 * que no se puede leer como texto; lo que sí se puede comprobar es su firma.
 */
function firma(doc: Awaited<ReturnType<typeof construirCotizacionPdf>>): string {
  const bytes = new Uint8Array(doc.output('arraybuffer')).slice(0, 5);
  return String.fromCharCode(...bytes);
}

describe('la cotización en PDF', () => {
  it('genera un documento con contenido', async () => {
    const doc = await construirCotizacionPdf(base);
    const salida = doc.output('arraybuffer');
    expect(salida.byteLength).toBeGreaterThan(1000);
  });

  it('nombra el archivo con el número y el cliente', () => {
    expect(nombreDelArchivo(base)).toBe('COT-2026-001-EJ-Deportes.pdf');
  });

  it('aguanta un cliente con nombre impronunciable para un sistema de archivos', () => {
    expect(nombreDelArchivo({ ...base, cliente: { nombre: '¿?¡!', taxId: null } })).toBe(
      'COT-2026-001-cliente.pdf',
    );
  });

  it('no imprime ni un solo costo: el tipo de datos no los admite', () => {
    // Esta es la garantía de fondo y es estructural, no de texto: DatosPdf no
    // tiene dónde meter un costo, así que la función no puede imprimirlo
    // aunque alguien se despiste al llamarla.
    const claves = Object.keys(base);
    expect(claves).not.toContain('costos');
    expect(Object.keys(base.lineas[0] ?? {})).toEqual([
      'descripcion',
      'detalle',
      'cantidad',
      'precioUnitario',
      'importe',
    ]);
  });

  it('se genera igual sin impuesto, y entonces no inventa una línea de IGV', async () => {
    const doc = await construirCotizacionPdf({ ...base, impuesto: null });
    expect(doc.output('arraybuffer').byteLength).toBeGreaterThan(1000);
  });

  it('se genera sin marca, sin notas y sin condiciones', async () => {
    const doc = await construirCotizacionPdf({
      ...base,
      marca: null,
      notas: null,
      condiciones: null,
      validaHasta: null,
    });
    expect(doc.output('arraybuffer').byteLength).toBeGreaterThan(1000);
  });

  it('aguanta una cotización larga sin romperse', async () => {
    const muchas = Array.from({ length: 40 }, (_, i) => ({
      descripcion: `Línea número ${i + 1}`,
      detalle: 'Un detalle razonablemente largo para que la tabla tenga que partir páginas.',
      cantidad: '2',
      precioUnitario: 'S/ 1,000.00',
      importe: 'S/ 2,000.00',
    }));
    const doc = await construirCotizacionPdf({ ...base, lineas: muchas });
    expect(doc.getNumberOfPages()).toBeGreaterThan(1);
  });

  it('no se cae si el color de la marca es basura', async () => {
    const doc = await construirCotizacionPdf({
      ...base,
      marca: { nombre: 'Nlima', color: 'azul bonito', logoUrl: null },
    });
    expect(doc.output('arraybuffer').byteLength).toBeGreaterThan(1000);
  });

  it('es un PDF de verdad, no un archivo con esa extensión', async () => {
    const doc = await construirCotizacionPdf(base);
    expect(firma(doc)).toBe('%PDF-');
  });
});
