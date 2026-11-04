import { describe, expect, it } from 'vitest';
import {
  datosPdfDeSnapshot,
  datosPropuestaDeSnapshot,
  diseñoDeSnapshot,
  leerSnapshot,
  leerTotales,
} from './snapshot';

/**
 * Lo que se comprueba aquí es la promesa de la emisión: el documento sale de
 * la copia y no de la cotización de hoy. Si esto se rompe, reimprimir una
 * cotización de hace un mes volvería a dar un papel distinto del que recibió
 * el cliente, que es la deuda que las versiones pagan.
 */

/** Tal como lo arma `emitir_cotizacion`: claves en castellano, importes en texto. */
const SNAPSHOT = {
  cotizacion: {
    numero: 'NL-COT-2026-0007',
    moneda: 'PEN',
    tasa_impuesto: '18.0000',
    impuesto_aplicado: true,
    etiqueta_impuesto: 'IGV 18 %',
    valida_hasta: '2026-12-04',
    notas: 'Vigencia sujeta a disponibilidad.',
    creada_el: '2026-11-04T10:00:00Z',
  },
  empresa: {
    razon_social: '3 Brothers MKT SAC',
    tax_id: '20601234567',
    pais: 'PE',
    direccion: 'Lima, Perú',
    telefono: '992 988 453',
    email: 'marcelo@ejemplo.test',
    condiciones: 'El servicio empieza con el 50 % adelantado.\nDos rondas por entregable.',
  },
  marca: {
    nombre: 'Nlima',
    logo: 'org/logo.png',
    color: '#2760d3',
    color_secundario: '#a50321',
    foto: 'org/portada.jpg',
  },
  cliente: { nombre: 'Amotape', tax_id: '20512345678', email: null },
  lineas: [
    {
      id: 'l-1',
      orden: 10,
      descripcion: 'Branding',
      resumen: 'La marca de principio a fin.',
      detalle: null,
      cantidad: '1.0000',
      precio_unitario: '3200.00',
      neto: '3200.00',
      entregables: [
        { tipo: 'include', texto: 'Naming', orden: 10 },
        { tipo: 'exclude', texto: 'Registro en Indecopi', orden: 20 },
        { tipo: 'condition', texto: 'Dos rondas por entregable.', orden: 30 },
      ],
    },
  ],
  diseno: { portada: 'dividida', tipografia: 'editorial', fotosServicio: { 'l-1': 'org/brd.jpg' } },
};

const TOTALES = { moneda: 'PEN', decimales: 2, neto: '3200.00', impuesto: '576.00', total: '3776.00' };

const urlDe = (ruta: string | null) => (ruta ? `/x/${ruta}` : null);

describe('leer una versión emitida', () => {
  it('lee el snapshot que escribe la base', () => {
    const s = leerSnapshot(SNAPSHOT);
    expect(s).not.toBeNull();
    expect(s?.numero).toBe('NL-COT-2026-0007');
    expect(s?.moneda).toBe('PEN');
    expect(s?.lineas).toHaveLength(1);
    expect(s?.lineas[0]?.id).toBe('l-1');
    expect(s?.marca?.nombre).toBe('Nlima');
  });

  it('devuelve null en vez de un documento a medias', () => {
    // `jsonb` puede guardar cualquier cosa, así que esto tiene que pasar.
    expect(leerSnapshot(null)).toBeNull();
    expect(leerSnapshot('una cadena')).toBeNull();
    expect(leerSnapshot({})).toBeNull();
    // Sin líneas no hay nada que dibujar.
    expect(leerSnapshot({ ...SNAPSHOT, lineas: [] })).toBeNull();
    // Una moneda que el producto no conoce no se adivina.
    expect(
      leerSnapshot({ ...SNAPSHOT, cotizacion: { ...SNAPSHOT.cotizacion, moneda: 'EUR' } }),
    ).toBeNull();
  });

  it('formatea los importes guardados con su moneda', () => {
    const s = leerSnapshot(SNAPSHOT)!;
    const t = leerTotales(TOTALES, s.moneda);
    expect(t.neto).toBe('S/ 3,200.00');
    expect(t.impuesto).toBe('S/ 576.00');
    expect(t.total).toBe('S/ 3,776.00');
    expect(t.totalConCodigo).toContain('PEN');
  });

  it('arma el A4 de la copia, no del catálogo de hoy', () => {
    const s = leerSnapshot(SNAPSHOT)!;
    const d = datosPdfDeSnapshot(s, TOTALES, urlDe);
    expect(d.numero).toBe('NL-COT-2026-0007');
    expect(d.emisor.nombre).toBe('3 Brothers MKT SAC');
    expect(d.cliente.nombre).toBe('Amotape');
    expect(d.marca?.logoUrl).toBe('/x/org/logo.png');
    expect(d.lineas[0]?.incluye).toEqual(['Naming']);
    expect(d.lineas[0]?.noIncluye).toEqual(['Registro en Indecopi']);
    expect(d.neto).toBe('S/ 3,200.00');
    expect(d.impuesto).toEqual({ etiqueta: 'IGV 18 %', importe: 'S/ 576.00' });
    expect(d.notaImpuesto).toBe('Precio incluye IGV 18 %.');
  });

  it('no deja pasar un costo al documento', () => {
    const s = leerSnapshot(SNAPSHOT)!;
    const d = datosPdfDeSnapshot(s, TOTALES, urlDe);
    // El snapshot no los guarda y DatosPdf no tiene dónde ponerlos: la
    // garantía es estructural. Esto lo deja escrito.
    expect(JSON.stringify(d)).not.toMatch(/cost|costo/i);
  });

  it('una entidad sin impuesto no dice que no lo incluye', () => {
    const sinImpuesto = leerSnapshot({
      ...SNAPSHOT,
      cotizacion: { ...SNAPSHOT.cotizacion, moneda: 'USD', tasa_impuesto: '0.0000', etiqueta_impuesto: null },
    })!;
    const d = datosPdfDeSnapshot(sinImpuesto, { ...TOTALES, moneda: 'USD', impuesto: '0.00' }, urlDe);
    expect(d.impuesto).toBeNull();
    expect(d.notaImpuesto).toBe('Precio final. No se aplica impuesto.');
  });

  it('la propuesta recupera el diseño con el que salió, fotos incluidas', () => {
    const s = leerSnapshot(SNAPSHOT)!;
    const diseño = diseñoDeSnapshot(s);
    expect(diseño.portada).toBe('dividida');
    expect(diseño.tipografia).toBe('editorial');
    // La foto de cada servicio se guarda por id de línea: sin el id en el
    // snapshot, reimprimir perdería las fotos.
    expect(diseño.fotosServicio['l-1']).toBe('org/brd.jpg');
    // Sin foto de portada propia vale la de la marca, igual que en el editor.
    expect(diseño.fotoPortada).toBe('org/portada.jpg');

    const datos = datosPropuestaDeSnapshot(s, TOTALES, urlDe);
    expect(datos.lineas[0]?.id).toBe('l-1');
    // Las condiciones de la entidad y las de la línea, sin repetir.
    expect(datos.condiciones).toEqual([
      'El servicio empieza con el 50 % adelantado.',
      'Dos rondas por entregable.',
    ]);
  });
});
