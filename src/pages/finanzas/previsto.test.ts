import { describe, expect, it } from 'vitest';
import { format, fromDb, type Money } from '../../lib/money';
import {
  diasDesde,
  enLista,
  explica,
  totalesPrevistos,
  type PrevistoEnBase,
} from './previsto';

const base = (x: Partial<PrevistoEnBase> = {}): PrevistoEnBase => ({
  id: 'p-1',
  label: 'Cámara pactada',
  direction: 'out',
  due_date: '2026-12-15',
  amount: '3000.00',
  currency_code: 'PEN',
  status: 'planned',
  quote_id: null,
  expected_cash_account_id: null,
  ...x,
});

const pen = (valor: string): Money => fromDb(valor, 'PEN');
const HOY = '2026-11-24';

describe('lo previsto de una sola vez', () => {
  it('sin nada asignado, lo pendiente es lo previsto', () => {
    const [f] = enLista([base()], new Map(), HOY);
    expect(format(f!.previsto)).toBe('S/ 3,000.00');
    expect(format(f!.pendiente)).toBe('S/ 3,000.00');
    expect(f!.saldado).toBe(false);
    expect(f!.entra).toBe(false);
  });

  it('con un adelanto, lo pendiente es lo que falta', () => {
    const [f] = enLista([base()], new Map([['p-1', pen('1000.00')]]), HOY);
    expect(format(f!.pendiente)).toBe('S/ 2,000.00');
    expect(explica(f!)).toBe('S/ 2,000.00 por pagar de los S/ 3,000.00 previstos');
  });

  it('cubierto del todo queda saldado, aunque el estado venga con retraso', () => {
    const [f] = enLista([base({ status: 'planned' })], new Map([['p-1', pen('3000.00')]]), HOY);
    expect(f!.saldado).toBe(true);
    expect(format(f!.pendiente)).toBe('S/ 0.00');
    expect(explica(f!)).toBe('Saldado con S/ 3,000.00');
  });

  it('pagado de más no deja un pendiente negativo', () => {
    const [f] = enLista([base()], new Map([['p-1', pen('3200.00')]]), HOY);
    expect(format(f!.pendiente)).toBe('S/ 0.00');
    expect(f!.saldado).toBe(true);
  });

  it('un previsto saldado no se marca como atrasado', () => {
    const [f] = enLista(
      [base({ due_date: '2026-10-01' })],
      new Map([['p-1', pen('3000.00')]]),
      HOY,
    );
    expect(f!.atraso).toBe(0);
  });

  it('uno sin saldar cuya fecha pasó dice cuántos días lleva', () => {
    const [f] = enLista([base({ due_date: '2026-11-14' })], new Map(), HOY);
    expect(f!.atraso).toBe(10);
  });

  it('una cuota de cotización no es un previsto y se queda fuera', () => {
    expect(enLista([base({ quote_id: 'q-1' })], new Map(), HOY)).toHaveLength(0);
  });

  it('una moneda que el producto no conoce se queda fuera, no se adivina', () => {
    expect(enLista([base({ currency_code: 'EUR' })], new Map(), HOY)).toHaveLength(0);
  });

  it('los sin saldar van primero, y entre ellos por fecha', () => {
    const filas = enLista(
      [
        base({ id: 'tarde', due_date: '2026-12-20' }),
        base({ id: 'pronto', due_date: '2026-11-30' }),
        base({ id: 'hecho', due_date: '2026-11-25', status: 'settled' }),
      ],
      new Map([['hecho', pen('3000.00')]]),
      HOY,
    );
    expect(filas.map((f) => f.id)).toEqual(['pronto', 'tarde', 'hecho']);
  });

  it('un cobro previsto se explica como lo que es', () => {
    const [f] = enLista([base({ direction: 'in', label: 'Adelanto de EJ' })], new Map(), HOY);
    expect(f!.entra).toBe(true);
    expect(explica(f!)).toBe('S/ 3,000.00 por cobrar');
  });
});

describe('los totales', () => {
  it('lo que entra y lo que sale no se restan entre sí', () => {
    const filas = enLista(
      [
        base({ id: 'sale', amount: '3000.00' }),
        base({ id: 'entra', direction: 'in', amount: '1200.00' }),
      ],
      new Map(),
      HOY,
    );
    const [total] = totalesPrevistos(filas);
    expect(format(total!.sale)).toBe('S/ 3,000.00');
    expect(format(total!.entra)).toBe('S/ 1,200.00');
    expect(total!.cuantos).toBe(2);
  });

  it('lo saldado no cuenta: ya está en el saldo', () => {
    const filas = enLista(
      [base({ id: 'vivo' }), base({ id: 'hecho', status: 'settled' })],
      new Map([['hecho', pen('3000.00')]]),
      HOY,
    );
    const [total] = totalesPrevistos(filas);
    expect(total!.cuantos).toBe(1);
    expect(format(total!.sale)).toBe('S/ 3,000.00');
  });

  it('dos monedas son dos filas (INV-10)', () => {
    const filas = enLista(
      [base({ id: 'pen' }), base({ id: 'usd', currency_code: 'USD', amount: '500.00' })],
      new Map(),
      HOY,
    );
    expect(totalesPrevistos(filas).map((t) => t.moneda)).toEqual(['PEN', 'USD']);
  });
});

describe('diasDesde', () => {
  it('cuenta hacia atrás y nunca hacia adelante', () => {
    expect(diasDesde('2026-11-14', HOY)).toBe(10);
    expect(diasDesde('2026-11-24', HOY)).toBe(0);
    expect(diasDesde('2026-12-01', HOY)).toBe(0);
  });

  it('una fecha ilegible da cero en vez de NaN', () => {
    expect(diasDesde('mañana', HOY)).toBe(0);
  });
});
