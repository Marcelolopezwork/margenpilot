import { describe, expect, it } from 'vitest';
import { format } from '../../lib/money';
import { notaDeImpuesto, totalesDe } from './totales';

/**
 * Esta prueba existe para que no se separen dos aritméticas.
 *
 * `emitir_cotizacion` suma en SQL lo mismo que esto suma en TypeScript: si
 * dejaran de coincidir, el total de la pantalla y el total guardado en la
 * versión emitida dirían cifras distintas, y el cliente podría ver las dos.
 *
 * Los números de abajo se comprobaron contra el proyecto real el 4/11/2026,
 * emitiendo dentro de un `begin; … rollback;`: la base devolvió neto 61.780,03
 * e impuesto 11.120,41 con estas mismas líneas.
 */

describe('la aritmética de una cotización', () => {
  it('redondea el precio unitario antes de multiplicar, como money.ts', () => {
    // R-4.1: 10,0050 cierra en 10,01, y 10,01 × 3 = 30,03.
    // Un round(10,0050 × 3, 2) ingenuo daría 30,02, un céntimo menos.
    const { neto } = totalesDe([{ unit_price: 10.005, quantity: 3 }], 'PEN', 0, false);
    expect(format(neto)).toBe('S/ 30.03');
  });

  it('da lo mismo que la base al emitir', () => {
    const filas = [
      { unit_price: 61750, quantity: 1 },
      { unit_price: 10.005, quantity: 3 },
    ];
    const { neto, impuesto, total } = totalesDe(filas, 'PEN', '18.0000', true);
    expect(format(neto)).toBe('S/ 61,780.03');
    // R-4.3: el impuesto va sobre el neto ya redondeado de CADA línea.
    // 61.750,00 → 11.115,00 y 30,03 → 5,41. Sobre el total daría 11.120,41
    // igual, pero no siempre, y la regla manda.
    expect(format(impuesto)).toBe('S/ 11,120.41');
    expect(format(total)).toBe('S/ 72,900.44');
  });

  it('la casilla manda: sin aplicar el impuesto, no hay impuesto', () => {
    const filas = [{ unit_price: 1000, quantity: 1 }];
    const { impuesto, total } = totalesDe(filas, 'PEN', '18.0000', false);
    expect(format(impuesto)).toBe('S/ 0.00');
    expect(format(total)).toBe('S/ 1,000.00');
  });

  it('no le dice a un cliente de Estados Unidos que el precio no incluye IGV', () => {
    expect(notaDeImpuesto(true, '0', 'IGV 18 %')).toBe('Precio final. No se aplica impuesto.');
    expect(notaDeImpuesto(true, '18', 'IGV 18 %')).toBe('Precio incluye IGV 18 %.');
    expect(notaDeImpuesto(false, '18', 'IGV 18 %')).toBe('Precio no incluye IGV 18 %.');
  });
});
