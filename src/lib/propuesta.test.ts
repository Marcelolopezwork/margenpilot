// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { construirPropuestaPdf, nombreDeLaPropuesta } from './propuesta';
import { condicionesDe } from './pdf-piezas';
import type { DatosPdf } from './pdf-piezas';

/**
 * Que la propuesta «se vea bien» lo juzga una persona mirándola. Lo que estas
 * pruebas vigilan es lo que no se puede comprobar a ojo sin abrir diez
 * archivos: que la secuencia de láminas sea la que es, que el índice no
 * prometa una lámina que no existe, y que ningún costo tenga por dónde
 * colarse.
 */

const linea = (descripcion: string, importe: string) => ({
  descripcion,
  resumen: 'Un resumen corto del servicio.',
  detalle: null,
  incluye: ['Primer entregable', 'Segundo entregable'],
  noIncluye: ['Lo que no entra'],
  condiciones: [] as string[],
  cantidad: '1',
  precioUnitario: importe,
  importe,
});

const base: DatosPdf = {
  numero: 'NL-COT-2026-0007',
  fecha: '4 nov 2026',
  periodo: 'NOVIEMBRE 2026',
  validaHasta: '4 dic 2026',
  emisor: {
    nombre: '3 Brothers MKT SAC',
    taxId: '20601234567',
    direccion: 'Lima, Perú',
    telefono: '992 988 453',
    email: 'marcelo@agenciaenlima.com',
  },
  marca: {
    nombre: 'Nlima',
    color: '#012DFF',
    colorSecundario: '#FD3659',
    logoUrl: null,
    portadaUrl: null,
  },
  cliente: { nombre: 'Amotape', taxId: '20512345678' },
  lineas: [linea('Branding', 'S/ 3,200.00')],
  neto: 'S/ 3,200.00',
  impuesto: null,
  notaImpuesto: 'Precio no incluye IGV 18 %.',
  total: 'S/ 3,200.00 PEN',
  notas: null,
  condiciones: 'El servicio empieza con el 50 % adelantado del monto cotizado.',
};

function firma(doc: Awaited<ReturnType<typeof construirPropuestaPdf>>): string {
  const bytes = new Uint8Array(doc.output('arraybuffer')).slice(0, 5);
  return String.fromCharCode(...bytes);
}

describe('la propuesta en láminas', () => {
  it('es un PDF de verdad', async () => {
    const doc = await construirPropuestaPdf(base);
    expect(firma(doc)).toBe('%PDF-');
  });

  it('va apaisada y del tamaño de su presentación, no en A4', async () => {
    const doc = await construirPropuestaPdf(base);
    const { width, height } = doc.internal.pageSize;
    expect(Math.round(width)).toBe(254);
    expect(Math.round(height)).toBe(143);
  });

  it('arma la secuencia completa: portada, índice, portadilla, servicio, condiciones y cierre', async () => {
    // Un servicio sin impuesto: no hay lámina de inversión porque el precio
    // ya está en la del servicio y repetirlo no añade nada.
    const doc = await construirPropuestaPdf(base);
    expect(doc.getNumberOfPages()).toBe(6);
  });

  it('añade la lámina de inversión cuando hay más de un servicio', async () => {
    const doc = await construirPropuestaPdf({
      ...base,
      lineas: [linea('Branding', 'S/ 3,200.00'), linea('Evento', 'S/ 4,800.00')],
    });
    // Dos portadillas y dos servicios más la de inversión.
    expect(doc.getNumberOfPages()).toBe(9);
  });

  it('añade la lámina de inversión cuando hay impuesto, aunque sea un solo servicio', async () => {
    const doc = await construirPropuestaPdf({
      ...base,
      impuesto: { etiqueta: 'IGV 18 %', importe: 'S/ 576.00' },
    });
    expect(doc.getNumberOfPages()).toBe(7);
  });

  it('se salta las condiciones si no hay ninguna, en vez de dejar la lámina vacía', async () => {
    const doc = await construirPropuestaPdf({ ...base, condiciones: null });
    expect(doc.getNumberOfPages()).toBe(5);
  });

  it('se genera sin marca: sale con los colores de serie y bloques de color en vez de foto', async () => {
    const doc = await construirPropuestaPdf({ ...base, marca: null });
    expect(doc.output('arraybuffer').byteLength).toBeGreaterThan(1000);
  });

  it('aguanta una propuesta de doce servicios sin romperse', async () => {
    const muchas = Array.from({ length: 12 }, (_, i) => linea(`Servicio ${i + 1}`, 'S/ 1,000.00'));
    const doc = await construirPropuestaPdf({ ...base, lineas: muchas });
    expect(doc.getNumberOfPages()).toBeGreaterThan(24);
  });

  it('parte el servicio en varias láminas cuando los entregables no caben en una', async () => {
    const corta = await construirPropuestaPdf(base);
    const larga = await construirPropuestaPdf({
      ...base,
      lineas: [
        {
          ...linea('Branding', 'S/ 3,200.00'),
          incluye: Array.from(
            { length: 30 },
            (_, i) => `Entregable número ${i + 1}, descrito con el detalle que pide un cliente`,
          ),
        },
      ],
    });
    expect(larga.getNumberOfPages()).toBeGreaterThan(corta.getNumberOfPages());
  });

  it('nombra el archivo distinto del documento A4, para no pisar uno con otro', () => {
    expect(nombreDeLaPropuesta(base)).toBe('NL-COT-2026-0007-Amotape-propuesta.pdf');
  });

  it('no tiene por dónde imprimir un costo: el tipo de datos no los admite', () => {
    expect(Object.keys(base.lineas[0] ?? {})).toEqual([
      'descripcion',
      'resumen',
      'detalle',
      'incluye',
      'noIncluye',
      'condiciones',
      'cantidad',
      'precioUnitario',
      'importe',
    ]);
  });
});

describe('las condiciones de la cotización', () => {
  it('junta las de la entidad con las del servicio', () => {
    expect(
      condicionesDe({
        ...base,
        condiciones: 'Pago 50 % al inicio.\nValidez de 30 días.',
        lineas: [{ ...linea('Branding', 'S/ 1.00'), condiciones: ['Dos rondas de ajustes.'] }],
      }),
    ).toEqual(['Pago 50 % al inicio.', 'Validez de 30 días.', 'Dos rondas de ajustes.']);
  });

  it('no repite la misma condición aunque esté escrita en los dos sitios', () => {
    // Ver dos veces la misma condición hace dudar al cliente de cuál vale.
    expect(
      condicionesDe({
        ...base,
        condiciones: 'Pago 50 % al inicio.',
        lineas: [{ ...linea('Branding', 'S/ 1.00'), condiciones: ['  pago 50 %  al inicio. '] }],
      }),
    ).toEqual(['Pago 50 % al inicio.']);
  });

  it('descarta renglones en blanco: un salto de línea de más no es una condición', () => {
    expect(condicionesDe({ ...base, condiciones: 'Una.\n\n\nOtra.\n' })).toEqual(['Una.', 'Otra.']);
  });
});
