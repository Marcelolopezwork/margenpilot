import { describe, expect, it } from 'vitest';
import { format } from '../../lib/money';
import { margenPorMoneda, ultimaPorCotizacion } from './margen-agregado';
import type { VersionConCosto } from './margen-agregado';

/**
 * Esta prueba defiende la regla §2.3, que es la razón de ser del producto.
 *
 * El cotizador que Marcelo usaba llamaba «margen» al markup y promediaba
 * porcentajes para sacar el margen del mes. Las dos cosas inflan la cifra, y
 * la segunda la infla justo cuando más engaña: cuando hay una cotización
 * grande de poco margen entre varias pequeñas de mucho.
 */

const v = (extra: Partial<VersionConCosto>): VersionConCosto => ({
  quote_id: 'c-1',
  version_no: 1,
  moneda: 'PEN',
  neto: '1000.00',
  costo: '500.00',
  ...extra,
});

describe('el margen de un grupo de cotizaciones', () => {
  it('pondera por importe, no promedia porcentajes', () => {
    // Una al 10 % cien veces mayor que dos al 50 %.
    const filas = [
      v({ quote_id: 'c-1', neto: '100000.00', costo: '90000.00' }),
      v({ quote_id: 'c-2', neto: '1000.00', costo: '500.00' }),
      v({ quote_id: 'c-3', neto: '1000.00', costo: '500.00' }),
    ];
    const [pen] = margenPorMoneda(filas);
    // Promediar los porcentajes daría 36,7 %. La cifra honesta es 10,8 %.
    expect(pen?.margen?.toFixed(1)).toBe('10.8');
    expect(format(pen!.neto)).toBe('S/ 102,000.00');
    expect(format(pen!.utilidad)).toBe('S/ 11,000.00');
    expect(pen?.cuantas).toBe(3);
  });

  it('cuenta cada cotización una sola vez, por su última versión', () => {
    // Reemitir no duplica: la v1 ya no existe para el cliente.
    const filas = [
      v({ quote_id: 'c-1', version_no: 1, neto: '1000.00', costo: '900.00' }),
      v({ quote_id: 'c-1', version_no: 2, neto: '2000.00', costo: '1000.00' }),
    ];
    const ultimas = ultimaPorCotizacion(filas);
    expect(ultimas).toHaveLength(1);
    expect(ultimas[0]?.version_no).toBe(2);

    const [pen] = margenPorMoneda(ultimas);
    expect(pen?.margen?.toFixed(1)).toBe('50.0');
  });

  it('no suma soles con dólares: devuelve una cifra por moneda', () => {
    const filas = [
      v({ quote_id: 'c-1', moneda: 'PEN', neto: '1000.00', costo: '600.00' }),
      v({ quote_id: 'c-2', moneda: 'USD', neto: '1000.00', costo: '200.00' }),
    ];
    const resultado = margenPorMoneda(filas);
    expect(resultado.map((r) => r.moneda)).toEqual(['PEN', 'USD']);
    expect(resultado[0]?.margen?.toFixed(1)).toBe('40.0');
    expect(resultado[1]?.margen?.toFixed(1)).toBe('80.0');
    expect(format(resultado[1]!.neto)).toBe('US$ 1,000.00');
  });

  it('una moneda que el producto no conoce se queda fuera, no se mete en otro montón', () => {
    const filas = [
      v({ quote_id: 'c-1', moneda: 'PEN' }),
      v({ quote_id: 'c-2', moneda: 'EUR' }),
    ];
    const resultado = margenPorMoneda(filas);
    expect(resultado).toHaveLength(1);
    expect(resultado[0]?.moneda).toBe('PEN');
  });

  it('sin precio no hay porcentaje que calcular', () => {
    const [pen] = margenPorMoneda([v({ neto: '0.00', costo: '0.00' })]);
    expect(pen?.margen).toBeNull();
  });

  it('una lista vacía no inventa un cero', () => {
    // Cero por ciento de margen y «no hay nada que medir» no son lo mismo.
    expect(margenPorMoneda([])).toEqual([]);
  });
});
