import { describe, expect, it } from 'vitest';
import { format } from '../../lib/money';
import {
  CERRADAS,
  COLUMNAS,
  diasQuieta,
  enColumna,
  enJuego,
  estaQuieta,
  valorPorMoneda,
  vencidaSinMarcar,
  type TarjetaPipeline,
} from './tablero';

const t = (x: Partial<TarjetaPipeline>): TarjetaPipeline => ({
  id: 'q-1',
  number: 'COT-001',
  status: 'sent',
  currency_code: 'PEN',
  valid_until: null,
  cliente: 'EJ Deportes',
  neto: '10000.00',
  margen: null,
  ultimoMovimiento: '2026-11-09T10:00:00Z',
  ...x,
});

describe('el tablero es lo que está en juego', () => {
  it('las columnas de trabajo no incluyen las cerradas', () => {
    expect(COLUMNAS).toEqual(['draft', 'sent', 'negotiation', 'approved']);
    expect(CERRADAS).toEqual(['rejected', 'expired', 'void']);
    for (const c of CERRADAS) expect(COLUMNAS).not.toContain(c);
  });

  it('en juego son las enviadas y las que se están negociando, nada más', () => {
    const todas = [
      t({ id: 'a', status: 'draft' }),
      t({ id: 'b', status: 'sent' }),
      t({ id: 'c', status: 'negotiation' }),
      t({ id: 'd', status: 'approved' }),
      t({ id: 'e', status: 'rejected' }),
    ];
    expect(enJuego(todas).map((x) => x.id)).toEqual(['b', 'c']);
  });

  it('un borrador no está en juego porque no ha salido, y una aprobada ya se ganó', () => {
    expect(enJuego([t({ status: 'draft' })])).toHaveLength(0);
    expect(enJuego([t({ status: 'approved' })])).toHaveLength(0);
  });

  it('reparte por columna', () => {
    const todas = [t({ id: 'a', status: 'draft' }), t({ id: 'b', status: 'sent' })];
    expect(enColumna(todas, 'draft').map((x) => x.id)).toEqual(['a']);
    expect(enColumna(todas, 'expired')).toHaveLength(0);
  });
});

describe('las monedas no se suman, y «sin cifra» no es cero', () => {
  it('devuelve un total por moneda', () => {
    const v = valorPorMoneda([
      t({ id: 'a', currency_code: 'PEN', neto: '10000.00' }),
      t({ id: 'b', currency_code: 'PEN', neto: '2500.50' }),
      t({ id: 'c', currency_code: 'USD', neto: '800.00' }),
    ]);
    expect(v).toHaveLength(2);
    expect(format(v[0]!.total)).toBe('S/ 12,500.50');
    expect(format(v[1]!.total)).toBe('US$ 800.00');
    expect(v[0]?.cuantas).toBe(2);
  });

  it('una sin emitir se cuenta aparte y no entra como cero', () => {
    const v = valorPorMoneda([
      t({ id: 'a', neto: '10000.00' }),
      t({ id: 'b', neto: null }),
    ]);
    expect(format(v[0]!.total)).toBe('S/ 10,000.00');
    expect(v[0]?.cuantas).toBe(2);
    expect(v[0]?.sinEmitir).toBe(1);
  });

  it('una moneda que el producto no conoce se queda fuera entera', () => {
    const v = valorPorMoneda([t({ currency_code: 'JPY' })]);
    expect(v).toHaveLength(0);
  });
});

describe('lo que no se ha movido', () => {
  it('cuenta los días completos desde el último movimiento', () => {
    expect(diasQuieta(t({ ultimoMovimiento: '2026-11-01T23:00:00Z' }), '2026-11-09')).toBe(8);
    expect(diasQuieta(t({ ultimoMovimiento: '2026-11-09T01:00:00Z' }), '2026-11-09')).toBe(0);
  });

  it('quieta es dos semanas en juego, no en cualquier estado', () => {
    const vieja = '2026-10-01T00:00:00Z';
    expect(estaQuieta(t({ status: 'sent', ultimoMovimiento: vieja }), '2026-11-09')).toBe(true);
    expect(estaQuieta(t({ status: 'negotiation', ultimoMovimiento: vieja }), '2026-11-09')).toBe(true);
    // Un borrador parado no es un problema: nadie espera nada.
    expect(estaQuieta(t({ status: 'draft', ultimoMovimiento: vieja }), '2026-11-09')).toBe(false);
    // Y una aprobada ya se decidió.
    expect(estaQuieta(t({ status: 'approved', ultimoMovimiento: vieja }), '2026-11-09')).toBe(false);
  });

  it('trece días todavía no es quieta; catorce sí', () => {
    // Del 27 de octubre al 9 de noviembre van trece días.
    expect(estaQuieta(t({ ultimoMovimiento: '2026-10-27T00:00:00Z' }), '2026-11-09')).toBe(false);
    expect(estaQuieta(t({ ultimoMovimiento: '2026-10-26T00:00:00Z' }), '2026-11-09')).toBe(true);
  });
});

describe('vencida es una decisión, no un cálculo', () => {
  it('señala la que pasó su plazo y sigue abierta', () => {
    expect(vencidaSinMarcar(t({ valid_until: '2026-11-01' }), '2026-11-09')).toBe(true);
    expect(vencidaSinMarcar(t({ valid_until: '2026-11-30' }), '2026-11-09')).toBe(false);
  });

  it('sin plazo no hay nada que vencer', () => {
    expect(vencidaSinMarcar(t({ valid_until: null }), '2026-12-31')).toBe(false);
  });

  it('una aprobada con el plazo pasado no está vencida: está ganada', () => {
    expect(
      vencidaSinMarcar(t({ status: 'approved', valid_until: '2026-01-01' }), '2026-11-09'),
    ).toBe(false);
  });
});
