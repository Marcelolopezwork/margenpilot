import { describe, expect, it } from 'vitest';
import {
  aLineas,
  adivinarDecimal,
  adivinarMapeo,
  adivinarOrdenDeFecha,
  adivinarSeparador,
  mismaReferencia,
  parsearFecha,
  parsearImporte,
  pareceCabecera,
  proponer,
  separarCsv,
  separarFila,
  type LineaDelBanco,
  type MovimientoDelLibro,
} from './extracto';

describe('separar el archivo', () => {
  it('el punto y coma gana cuando parte todas las filas igual', () => {
    // Un CSV de Excel en español: punto y coma, y comas dentro del texto.
    const texto = 'Fecha;Descripcion;Importe\n03/11/2026;PAGO A PROVEEDOR, S.A.;-118,00';
    expect(adivinarSeparador(texto)).toBe(';');
  });

  it('respeta las comillas y las comillas dobles de dentro', () => {
    expect(separarFila('a,"b,c",d', ',')).toEqual(['a', 'b,c', 'd']);
    expect(separarFila('a,"di ""hola""",c', ',')).toEqual(['a', 'di "hola"', 'c']);
  });

  it('una descripción con comas no engaña al separador', () => {
    const texto =
      'Fecha,Concepto,Importe\n03/11/2026,"ABONO, CLIENTE EJ",1180.00\n04/11/2026,"CARGO, COMISION",-18.00';
    const filas = separarCsv(texto);
    expect(filas).toHaveLength(3);
    expect(filas[1]).toEqual(['03/11/2026', 'ABONO, CLIENTE EJ', '1180.00']);
  });

  it('las líneas en blanco no son filas', () => {
    expect(separarCsv('a,b\n\n\nc,d')).toHaveLength(2);
  });
});

describe('las fechas', () => {
  it('03/11/2026 en un extracto peruano es el 3 de noviembre', () => {
    expect(parsearFecha('03/11/2026', 'dmy')).toBe('2026-11-03');
  });

  it('el orden se deduce del archivo entero, no de una fila', () => {
    // Ninguna fila lo aclara: se asume día/mes, que es lo de aquí.
    expect(adivinarOrdenDeFecha(['03/11/2026', '05/11/2026'])).toBe('dmy');
    // Esta sí lo aclara: un 25 no es un mes.
    expect(adivinarOrdenDeFecha(['03/11/2026', '25/11/2026'])).toBe('dmy');
    // Y esta al revés.
    expect(adivinarOrdenDeFecha(['11/25/2026', '03/11/2026'])).toBe('mdy');
  });

  it('el formato ISO se reconoce solo', () => {
    expect(adivinarOrdenDeFecha(['2026-11-03'])).toBe('ymd');
    expect(parsearFecha('2026-11-03', 'dmy')).toBe('2026-11-03');
  });

  it('el año de dos cifras se completa', () => {
    expect(parsearFecha('03/11/26', 'dmy')).toBe('2026-11-03');
  });

  it('un 31 de febrero se rechaza, no se corrige al 3 de marzo en silencio', () => {
    expect(parsearFecha('31/02/2026', 'dmy')).toBeNull();
    expect(parsearFecha('', 'dmy')).toBeNull();
    expect(parsearFecha('mañana', 'dmy')).toBeNull();
  });
});

describe('los importes', () => {
  it('1,180.00 y 1.180,00 son el mismo importe', () => {
    expect(parsearImporte('1,180.00', '.')).toBe('1180.00');
    expect(parsearImporte('1.180,00', ',')).toBe('1180.00');
  });

  it('el decimal se deduce de cuál va el último', () => {
    expect(adivinarDecimal(['1,180.00'])).toBe('.');
    expect(adivinarDecimal(['1.180,00'])).toBe(',');
    // Con uno solo: dos cifras detrás es decimal.
    expect(adivinarDecimal(['118,00'])).toBe(',');
    expect(adivinarDecimal(['118.00'])).toBe('.');
  });

  it('el paréntesis es un negativo, que es como lo escriben algunos bancos', () => {
    expect(parsearImporte('(118.00)', '.')).toBe('-118.00');
  });

  it('se quita el símbolo de la moneda y los espacios', () => {
    expect(parsearImporte('S/ -1,180.00', '.')).toBe('-1180.00');
    expect(parsearImporte('  118.5  ', '.')).toBe('118.50');
  });

  it('lo que no es un importe devuelve null, no cero', () => {
    expect(parsearImporte('', '.')).toBeNull();
    expect(parsearImporte('n/a', '.')).toBeNull();
  });

  it('nunca pasa por coma flotante: devuelve texto', () => {
    expect(typeof parsearImporte('0.1', '.')).toBe('string');
    expect(parsearImporte('99999999.99', '.')).toBe('99999999.99');
  });
});

describe('el mapeo de columnas', () => {
  const bcp = [
    ['Fecha', 'Descripción', 'Cargo', 'Abono', 'Operación'],
    ['03/11/2026', 'COMISION MANTENIMIENTO', '118.00', '', 'OP-5001'],
    ['04/11/2026', 'ABONO CLIENTE EJ', '', '1180.00', 'OP-5002'],
  ];

  it('reconoce la cabecera por el nombre de sus columnas', () => {
    const m = adivinarMapeo(bcp);
    expect(m.conCabecera).toBe(true);
    expect(m.fecha).toBe(0);
    expect(m.descripcion).toBe(1);
    expect(m.cargo).toBe(2);
    expect(m.abono).toBe(3);
    expect(m.importe).toBeNull();
    expect(m.referencia).toBe(4);
  });

  it('sin cabecera deduce de los datos', () => {
    const m = adivinarMapeo([
      ['03/11/2026', 'COMISION MANTENIMIENTO', '-118.00'],
      ['04/11/2026', 'ABONO CLIENTE EJ', '1180.00'],
    ]);
    expect(m.conCabecera).toBe(false);
    expect(m.fecha).toBe(0);
    expect(m.descripcion).toBe(1);
    expect(m.importe).toBe(2);
  });

  it('una fila de datos no se confunde con una cabecera', () => {
    expect(pareceCabecera(['Fecha', 'Concepto', 'Importe'])).toBe(true);
    expect(pareceCabecera(['03/11/2026', 'ALGO', '-118.00'])).toBe(false);
  });

  it('en dos columnas, el cargo es una salida aunque venga sin signo', () => {
    const { lineas } = aLineas(bcp, adivinarMapeo(bcp));
    expect(lineas).toHaveLength(2);
    expect(lineas[0]?.importe).toBe('-118.00');
    expect(lineas[1]?.importe).toBe('1180.00');
  });

  it('y un «-118» en la columna de cargos sigue siendo una salida', () => {
    const filas = [
      ['Fecha', 'Descripción', 'Cargo', 'Abono'],
      ['03/11/2026', 'COMISION', '-118.00', ''],
    ];
    const { lineas } = aLineas(filas, adivinarMapeo(filas));
    expect(lineas[0]?.importe).toBe('-118.00');
  });

  it('guarda la fila original con el nombre de cada columna', () => {
    const { lineas } = aLineas(bcp, adivinarMapeo(bcp));
    expect(lineas[0]?.raw['Descripción']).toBe('COMISION MANTENIMIENTO');
    expect(lineas[0]?.referencia).toBe('OP-5001');
  });

  it('una fila ilegible no se salta en silencio: se devuelve con su motivo', () => {
    const filas = [
      ['Fecha', 'Descripción', 'Importe'],
      ['03/11/2026', 'BUENA', '-118.00'],
      ['no es fecha', 'MALA', '-10.00'],
      ['05/11/2026', 'SIN IMPORTE', ''],
    ];
    const { lineas, descartadas } = aLineas(filas, adivinarMapeo(filas));
    expect(lineas).toHaveLength(1);
    expect(descartadas).toEqual([
      { fila: 3, por: 'no se pudo leer la fecha' },
      { fila: 4, por: 'la línea no tiene importe' },
    ]);
  });

  it('una línea sin concepto no se queda sin nombre', () => {
    const filas = [['03/11/2026', '', '-118.00']];
    const { lineas } = aLineas(filas, adivinarMapeo(filas));
    expect(lineas[0]?.descripcion).toBe('Sin concepto');
  });
});

describe('proponer emparejamientos', () => {
  const linea = (x: Partial<LineaDelBanco>): LineaDelBanco => ({
    id: 'l-1',
    value_date: '2026-11-03',
    direction: 'out',
    amount: '118.00',
    description: 'COMISION',
    external_ref: null,
    currency_code: 'PEN',
    ...x,
  });

  const mov = (x: Partial<MovimientoDelLibro>): MovimientoDelLibro => ({
    id: 'm-1',
    value_date: '2026-11-03',
    direction: 'out',
    amount: '118.00',
    description: 'Comisión del banco',
    external_ref: null,
    currency_code: 'PEN',
    ...x,
  });

  it('mismo importe y mismo día es una propuesta exacta', () => {
    const [p] = proponer([linea({})], [mov({})], new Set());
    expect(p?.movimientoId).toBe('m-1');
    expect(p?.confianza).toBe('exacta');
    expect(p?.porque).toBe('mismo importe y mismo día');
  });

  it('unos días de diferencia es probable, y lo dice', () => {
    const [p] = proponer([linea({})], [mov({ value_date: '2026-11-06' })], new Set());
    expect(p?.confianza).toBe('probable');
    expect(p?.porque).toBe('mismo importe, 3 días de diferencia');
  });

  it('más de cinco días ya no se propone', () => {
    expect(proponer([linea({})], [mov({ value_date: '2026-11-20' })], new Set())).toHaveLength(0);
  });

  it('dos candidatos igual de buenos no son una propuesta', () => {
    // Dos comisiones idénticas el mismo día: elegir una al azar tacharía la
    // línea con el movimiento equivocado, y las dos listas cuadrarían con los
    // pares cambiados.
    const salida = proponer([linea({})], [mov({ id: 'm-1' }), mov({ id: 'm-2' })], new Set());
    expect(salida).toHaveLength(0);
  });

  it('la misma referencia desempata aunque la fecha no coincida', () => {
    const salida = proponer(
      [linea({ external_ref: 'OP-5001' })],
      [
        mov({ id: 'm-lejos', value_date: '2026-10-01', external_ref: 'op5001' }),
        mov({ id: 'm-cerca', external_ref: 'OTRA-9' }),
      ],
      new Set(),
    );
    expect(salida).toHaveLength(1);
    expect(salida[0]?.movimientoId).toBe('m-lejos');
    expect(salida[0]?.confianza).toBe('exacta');
  });

  it('una referencia de tres caracteres no es una referencia', () => {
    expect(mismaReferencia('12', '12')).toBe(false);
    expect(mismaReferencia('OP-5001', 'op 5001')).toBe(true);
    expect(mismaReferencia(null, null)).toBe(false);
  });

  it('la dirección tiene que coincidir', () => {
    expect(proponer([linea({})], [mov({ direction: 'in' })], new Set())).toHaveLength(0);
  });

  it('un movimiento ya conciliado no se vuelve a proponer', () => {
    expect(proponer([linea({})], [mov({})], new Set(['m-1']))).toHaveLength(0);
  });

  it('un movimiento propuesto para una línea no se propone para otra', () => {
    const salida = proponer(
      [linea({ id: 'l-1' }), linea({ id: 'l-2' })],
      [mov({})],
      new Set(),
    );
    expect(salida).toHaveLength(1);
    expect(salida[0]?.lineaId).toBe('l-1');
  });

  it('dos líneas y dos movimientos distintos se emparejan cada uno con el suyo', () => {
    const salida = proponer(
      [
        linea({ id: 'l-1', amount: '118.00' }),
        linea({ id: 'l-2', amount: '1180.00', direction: 'in' }),
      ],
      [
        mov({ id: 'm-1', amount: '118.00' }),
        mov({ id: 'm-2', amount: '1180.00', direction: 'in' }),
      ],
      new Set(),
    );
    expect(salida.map((p) => [p.lineaId, p.movimientoId])).toEqual([
      ['l-1', 'm-1'],
      ['l-2', 'm-2'],
    ]);
  });
});
