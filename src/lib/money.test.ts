import { describe, expect, it } from 'vitest';
import {
  MoneyError,
  add,
  aggregateMarginPercent,
  convert,
  currencyOf,
  effectiveRate,
  format,
  fromDb,
  fromRow,
  marginPercent,
  markupPercent,
  multiplyByQuantity,
  netFromGross,
  sumLines,
  taxOn,
  toDb,
  zero,
} from './money';

const pen = (v: string) => fromDb(v, 'PEN');
const usd = (v: string) => fromDb(v, 'USD');

describe('entrada y salida', () => {
  it('conserva exactamente lo que viene de Postgres', () => {
    expect(toDb(pen('1234.56'))).toBe('1234.56');
    expect(toDb(pen('0.01'))).toBe('0.01');
    expect(toDb(pen('-2500.00'))).toBe('-2500.00');
    expect(toDb(pen('8500'))).toBe('8500.00');
  });

  it('acepta separadores de miles al teclear', () => {
    expect(toDb(pen('1,200.00'))).toBe('1200.00');
    expect(toDb(pen('24,180.50'))).toBe('24180.50');
  });

  it('rechaza lo que no es un importe', () => {
    expect(() => pen('mil soles')).toThrow(MoneyError);
    expect(() => pen('')).toThrow(MoneyError);
    expect(() => pen('1.2.3')).toThrow(MoneyError);
  });

  it('no acumula error de coma flotante (0.1 + 0.2)', () => {
    expect(toDb(add(pen('0.10'), pen('0.20')))).toBe('0.30');
    // El equivalente con number daría 0.30000000000000004.
    expect(0.1 + 0.2).not.toBe(0.3);
  });
});

describe('R-4.1 · redondeo HALF_UP', () => {
  it('0,005 sube a 0,01', () => {
    expect(toDb(pen('0.005'))).toBe('0.01');
    expect(toDb(pen('33.335'))).toBe('33.34');
    expect(toDb(pen('33.334'))).toBe('33.33');
  });

  it('se aleja del cero también en negativo', () => {
    expect(toDb(pen('-0.005'))).toBe('-0.01');
  });
});

describe('R-4.2 · el total es la suma de líneas ya redondeadas', () => {
  it('tres líneas de 33.335 con IGV 18 % dan 118.02, no 118.01', () => {
    const lines = [pen('33.335'), pen('33.335'), pen('33.335')];
    const net = sumLines(lines, 'PEN');
    expect(toDb(net)).toBe('100.02');

    // R-4.3: el impuesto se calcula sobre el neto YA redondeado de cada línea
    const tax = sumLines(
      lines.map((line) => taxOn(line, '18')),
      'PEN',
    );
    expect(toDb(tax)).toBe('18.00');
    expect(toDb(add(net, tax))).toBe('118.02');

    // La vía incorrecta —sumar en crudo y redondear al final— daría 118.01.
    // Un céntimo por cotización es exactamente el descuadre que buscamos evitar.
  });
});

describe('INV-10 · dos monedas no se suman', () => {
  it('sumar soles con dólares es un error, no una conversión silenciosa', () => {
    expect(() => add(pen('1000.00'), usd('500.00'))).toThrow(MoneyError);
  });

  it('convertir es explícito y exige tasa', () => {
    // D-5: la última tasa disponible, y quien lo muestre debe poner fecha y fuente.
    const consolidated = add(pen('24180.50'), convert(usd('8420.00'), 'PEN', '3.9000'));
    expect(toDb(consolidated)).toBe('57018.50');
  });

  it('rechaza una tasa no positiva', () => {
    expect(() => convert(usd('100.00'), 'PEN', '0')).toThrow(MoneyError);
  });
});

describe('D-7 · margen y markup son campos distintos', () => {
  it('precio 100 y costo 60 dan margen 40 % y markup 66,67 %', () => {
    const price = pen('100.00');
    const cost = pen('60.00');
    expect(marginPercent(price, cost)).toBeCloseTo(40, 10);
    expect(markupPercent(price, cost)).toBeCloseTo(66.666666, 4);
  });

  it('margen nulo si el precio es cero, markup nulo si el costo es cero', () => {
    expect(marginPercent(zero('PEN'), pen('60.00'))).toBeNull();
    expect(markupPercent(pen('100.00'), zero('PEN'))).toBeNull();
  });

  it('reproduce las cifras de la cotización de los wireframes', () => {
    // Línea 1: precio 8.500,00 con costo 4.020,00 (1.440 + 2.400 + 180)
    const cost1 = sumLines([pen('1440.00'), pen('2400.00'), pen('180.00')], 'PEN');
    expect(toDb(cost1)).toBe('4020.00');
    // Línea 2: fee del 150 % sobre un costo de 900 → 2.250,00
    expect(toDb(multiplyByQuantity(pen('900.00'), '2.5'))).toBe('2250.00');

    const net = sumLines([pen('8500.00'), pen('2250.00')], 'PEN');
    const cost = sumLines([cost1, pen('900.00')], 'PEN');
    expect(toDb(net)).toBe('10750.00');
    expect(toDb(cost)).toBe('4920.00');
    expect(marginPercent(net, cost)).toBeCloseTo(54.23, 2);
    expect(markupPercent(net, cost)).toBeCloseTo(118.5, 1);

    const tax = sumLines([taxOn(pen('8500.00'), '18'), taxOn(pen('2250.00'), '18')], 'PEN');
    expect(toDb(tax)).toBe('1935.00');
    expect(toDb(add(net, tax))).toBe('12685.00');
  });
});

describe('D-7b · el margen de un grupo es ponderado, nunca el promedio', () => {
  it('10 % sobre 100.000 y 50 % sobre dos de 1.000 dan 10,8 %, no 36,7 %', () => {
    const rows = [
      { netPrice: pen('100000.00'), directCost: pen('90000.00') },
      { netPrice: pen('1000.00'), directCost: pen('500.00') },
      { netPrice: pen('1000.00'), directCost: pen('500.00') },
    ];
    const aggregate = aggregateMarginPercent(rows, 'PEN');
    expect(aggregate).toBeCloseTo(10.78, 2);

    const naiveAverage =
      rows.reduce((s, r) => s + (marginPercent(r.netPrice, r.directCost) ?? 0), 0) / rows.length;
    expect(naiveAverage).toBeCloseTo(36.67, 2);
    expect(aggregate).not.toBeCloseTo(naiveAverage, 1);
  });
});

describe('formato es-PE', () => {
  it('pone el símbolo delante y agrupa los miles', () => {
    expect(format(pen('24180.50'))).toBe('S/ 24,180.50');
    expect(format(usd('8420.00'))).toBe('US$ 8,420.00');
    expect(format(pen('-2500.00'))).toBe('-S/ 2,500.00');
    expect(format(pen('0.00'))).toBe('S/ 0.00');
    expect(format(usd('500.00'), { showCode: true })).toBe('US$ 500.00 USD');
  });
});

describe('ADR-17 · el aporte del dueño entra en caja y no en resultado', () => {
  it('la apertura suma a caja', () => {
    // El aporte es un movimiento como cualquier otro para la caja...
    const caja = sumLines([pen('30715.50'), pen('1200.00'), pen('-2500.00')], 'PEN');
    expect(toDb(caja)).toBe('29415.50');
    // ...y la exclusión del lente Resultado la hace flow_class en la base de
    // datos, no esta librería. Ver supabase/tests/invariants.sql.
  });
});

describe('entrada desde una fila de la base', () => {
  it('acepta el texto que PostgREST entrega en una columna numeric', () => {
    // ADR-33: `numeric` llega entrecomillado aunque los tipos digan number.
    expect(format(fromRow('120.0000', 'PEN'))).toBe(format(fromDb('120.00', 'PEN')));
  });

  it('acepta también un número, que es la última red', () => {
    expect(format(fromRow(120, 'PEN'))).toBe(format(fromDb('120.00', 'PEN')));
  });

  it('reconoce las monedas que existen', () => {
    expect(currencyOf('PEN')).toBe('PEN');
    expect(currencyOf('usd')).toBe('USD');
  });

  it('se niega a adivinar una moneda que no conoce', () => {
    expect(() => currencyOf('XXX')).toThrow(MoneyError);
  });
});

/**
 * La tasa efectiva (INV-5). Lo que se guarda lo calcula la base; esto es la
 * misma cuenta para poder enseñarla mientras se teclea, y tiene que dar lo
 * mismo.
 */
describe('effectiveRate', () => {
  it('es lo que llegó entre lo que salió', () => {
    expect(effectiveRate(fromDb('100.00', 'USD'), fromDb('370.00', 'PEN'))).toBe('3.700000');
  });

  it('en la misma moneda sale 1 sin ningún caso especial', () => {
    expect(effectiveRate(fromDb('500.00', 'PEN'), fromDb('500.00', 'PEN'))).toBe('1.000000');
  });

  it('redondea a seis decimales sin pasar por coma flotante', () => {
    expect(effectiveRate(fromDb('3.00', 'USD'), fromDb('10.00', 'PEN'))).toBe('3.333333');
  });

  it('y la de ida es la inversa de la de vuelta', () => {
    expect(effectiveRate(fromDb('3700.00', 'PEN'), fromDb('1000.00', 'USD'))).toBe('0.270270');
  });

  it('sin los dos lados no hay tasa que calcular', () => {
    expect(effectiveRate(zero('USD'), fromDb('370.00', 'PEN'))).toBeNull();
    expect(effectiveRate(fromDb('100.00', 'USD'), zero('PEN'))).toBeNull();
  });
});

describe('netFromGross · el neto que lleva dentro un total con impuesto', () => {
  it('devuelve el neto del IGV peruano', () => {
    expect(format(netFromGross(fromDb('1180.00', 'PEN'), '18'))).toBe('S/ 1,000.00');
    expect(format(netFromGross(fromDb('118.00', 'PEN'), '18'))).toBe('S/ 100.00');
  });

  it('con impuesto cero el neto es el total', () => {
    expect(format(netFromGross(fromDb('742.35', 'USD'), '0'))).toBe('US$ 742.35');
  });

  it('redondea al medio hacia arriba, como round() en la base', () => {
    // 85.00 / 1.18 = 72.0338…  →  72.03
    expect(format(netFromGross(fromDb('85.00', 'PEN'), '18'))).toBe('S/ 72.03');
    // 1.00 / 1.18 = 0.84745…   →  0.85
    expect(format(netFromGross(fromDb('1.00', 'PEN'), '18'))).toBe('S/ 0.85');
  });

  it('un impuesto negativo no es un impuesto', () => {
    expect(() => netFromGross(fromDb('100.00', 'PEN'), '-18')).toThrow();
  });
});
