import { describe, expect, it } from 'vitest';
import { format, fromDb, toDb } from '../../lib/money';
import {
  diferencia,
  estaCongelada,
  mesesDespues,
  repartir,
  reparto,
  sumaDe,
} from './cuotas';

/**
 * Repartir es donde se pierde un céntimo.
 *
 * `guardar_cronograma` exige que las cuotas sumen **exactamente** el total de
 * la versión aprobada. Si el reparto deja un resto por el camino, la base
 * rechaza el cronograma entero y el usuario ve un error que no entiende. Por
 * eso casi todas las pruebas de aquí terminan sumando y comparando.
 */

const PEN = 'PEN' as const;

describe('repartir un total en cuotas', () => {
  it('no pierde un céntimo cuando la división no es exacta', () => {
    // 11.307,94 entre tres no da tres cifras iguales.
    const partes = repartir(fromDb('11307.94', PEN), 3);
    expect(partes.map(toDb)).toEqual(['3769.31', '3769.31', '3769.32']);
    const suma = sumaDe(partes.map((p) => ({ amount: toDb(p) })), PEN);
    expect(toDb(suma!)).toBe('11307.94');
  });

  it('el resto va a la última cuota, no a la primera', () => {
    const partes = repartir(fromDb('10.00', PEN), 3);
    expect(partes.map(toDb)).toEqual(['3.33', '3.33', '3.34']);
  });

  it('en una sola parte devuelve el total', () => {
    expect(repartir(fromDb('11307.94', PEN), 1).map(toDb)).toEqual(['11307.94']);
  });

  it('un 50/50 exacto no inventa decimales', () => {
    expect(repartir(fromDb('11307.94', PEN), 2).map(toDb)).toEqual(['5653.97', '5653.97']);
  });
});

describe('sumar lo que hay escrito en pantalla', () => {
  it('suma los importes de todas las cuotas', () => {
    const suma = sumaDe([{ amount: '5653.97' }, { amount: '5653.97' }], PEN);
    expect(format(suma!)).toBe('S/ 11,307.94');
  });

  it('un campo a medio teclear no es una cuota de cero', () => {
    // Decir «cuadra» con un importe vacío sería mentir, y el usuario pulsaría
    // guardar para que se lo rechazara la base.
    expect(sumaDe([{ amount: '100' }, { amount: '' }], PEN)).toBeNull();
    expect(sumaDe([{ amount: 'mil' }], PEN)).toBeNull();
  });

  it('dice cuánto falta, y en negativo cuando se pasa', () => {
    const total = fromDb('11307.94', PEN);
    expect(format(diferencia(fromDb('10000.00', PEN), total))).toBe('S/ 1,307.94');
    expect(format(diferencia(fromDb('12000.00', PEN), total))).toBe('-S/ 692.06');
  });
});

describe('las fechas del cronograma', () => {
  it('suma meses sin saltarse febrero', () => {
    // `setMonth` convertiría el 31 de enero más un mes en el 3 de marzo.
    expect(mesesDespues('2027-01-31', 1)).toBe('2027-02-28');
    expect(mesesDespues('2026-11-10', 1)).toBe('2026-12-10');
    expect(mesesDespues('2026-12-10', 1)).toBe('2027-01-10');
    expect(mesesDespues('2026-11-05', 0)).toBe('2026-11-05');
  });
});

describe('el reparto que arman los botones', () => {
  it('un 50/50 sale con nombres que el cliente entiende', () => {
    const filas = reparto(fromDb('11307.94', PEN), 2, '2026-11-05');
    expect(filas.map((f) => f.label)).toEqual(['Anticipo 50 %', 'Contra entrega']);
    expect(filas.map((f) => f.due_date)).toEqual(['2026-11-05', '2026-12-05']);
    expect(filas.map((f) => f.amount)).toEqual(['5653.97', '5653.97']);
    expect(filas.every((f) => f.status === 'planned')).toBe(true);
    expect(filas.every((f) => f.id === null)).toBe(true);
  });

  it('tres cuotas se numeran y se escalonan por mes', () => {
    const filas = reparto(fromDb('11307.94', PEN), 3, '2026-11-05');
    expect(filas.map((f) => f.label)).toEqual(['Cuota 1 de 3', 'Cuota 2 de 3', 'Cuota 3 de 3']);
    expect(filas.map((f) => f.due_date)).toEqual(['2026-11-05', '2026-12-05', '2027-01-05']);
  });

  it('cuenta las que ya están documentadas al numerar', () => {
    const congelada = {
      id: 'c-1',
      label: 'Anticipo 50 %',
      due_date: '2026-11-05',
      amount: '5653.97',
      cash_account_id: '',
      status: 'documented' as const,
    };
    const filas = reparto(fromDb('5653.97', PEN), 2, '2026-12-05', [congelada]);
    expect(filas.map((f) => f.label)).toEqual(['Cuota 2 de 3', 'Cuota 3 de 3']);
    // Y el reparto es sobre lo que queda, no sobre el total.
    expect(filas.map((f) => f.amount)).toEqual(['2826.98', '2826.99']);
  });
});

describe('qué cuota se puede tocar', () => {
  it('lo documentado y lo cobrado no se edita', () => {
    expect(estaCongelada('planned')).toBe(false);
    expect(estaCongelada('documented')).toBe(true);
    expect(estaCongelada('settled')).toBe(true);
  });
});
