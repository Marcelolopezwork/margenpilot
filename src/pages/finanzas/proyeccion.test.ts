import { describe, expect, it } from 'vitest';
import { fromDb, toDb } from '../../lib/money';
import {
  lunesDe,
  monedasConCuotas,
  proyeccion,
  saldoProyectado,
  sumarSemanas,
  type CuotaEsperada,
} from './proyeccion';

const PEN = 'PEN' as const;

const cuota = (extra: Partial<CuotaEsperada> = {}): CuotaEsperada => ({
  due_date: '2026-11-20',
  amount: '5653.97',
  currency_code: 'PEN',
  status: 'planned',
  ...extra,
});

describe('las semanas', () => {
  it('empiezan en lunes', () => {
    // 6/11/2026 es viernes; su lunes es el 2.
    expect(lunesDe('2026-11-06')).toBe('2026-11-02');
    expect(lunesDe('2026-11-02')).toBe('2026-11-02');
    // Domingo pertenece a la semana que empezó el lunes anterior.
    expect(lunesDe('2026-11-08')).toBe('2026-11-02');
    expect(lunesDe('2026-11-09')).toBe('2026-11-09');
  });

  it('se suman sin que el cambio de mes las descoloque', () => {
    expect(sumarSemanas('2026-11-30', 1)).toBe('2026-12-07');
    expect(sumarSemanas('2026-12-28', 2)).toBe('2027-01-11');
  });
});

describe('la proyección de caja', () => {
  it('son trece semanas aunque no haya nada que cobrar', () => {
    const semanas = proyeccion([], PEN, '2026-11-06');
    expect(semanas).toHaveLength(13);
    expect(semanas[0]?.desde).toBe('2026-11-02');
    expect(semanas[12]?.desde).toBe('2027-01-25');
    expect(semanas.every((s) => s.entra.minor === 0n)).toBe(true);
  });

  it('pone cada cuota en su semana', () => {
    const semanas = proyeccion(
      [
        cuota({ due_date: '2026-11-05', amount: '1000.00' }),
        cuota({ due_date: '2026-11-12', amount: '2000.00' }),
        cuota({ due_date: '2026-11-15', amount: '500.00' }),
      ],
      PEN,
      '2026-11-06',
    );
    expect(toDb(semanas[0]!.entra)).toBe('1000.00');
    // El 12 y el 15 caen en la misma semana: la del lunes 9.
    expect(semanas[1]?.desde).toBe('2026-11-09');
    expect(toDb(semanas[1]!.entra)).toBe('2500.00');
    expect(semanas[1]?.cuotas).toBe(2);
  });

  /**
   * Lo previsto es caja esperada aunque no sea cartera. Si solo contara lo
   * documentado, la proyección únicamente vería lo ya facturado, que es
   * justo lo que no sirve para saber si llegas a fin de mes.
   */
  it('cuenta lo previsto y lo documentado, no lo cobrado', () => {
    const semanas = proyeccion(
      [
        cuota({ due_date: '2026-11-20', amount: '1000.00', status: 'planned' }),
        cuota({ due_date: '2026-11-20', amount: '2000.00', status: 'documented' }),
        cuota({ due_date: '2026-11-20', amount: '4000.00', status: 'settled' }),
        cuota({ due_date: '2026-11-20', amount: '8000.00', status: 'cancelled' }),
      ],
      PEN,
      '2026-11-06',
    );
    const total = semanas.reduce((n, s) => n + s.entra.minor, 0n);
    expect(total).toBe(fromDb('3000.00', PEN).minor);
  });

  /**
   * Una cuota que venció y no se cobró sigue siendo dinero que esperas, y lo
   * esperas ya. Dejarla en su semana pasada la escondería; descartarla diría
   * que no vas a cobrarla.
   */
  it('lo atrasado cae en la primera semana y se señala', () => {
    const semanas = proyeccion(
      [
        cuota({ due_date: '2026-09-15', amount: '3000.00' }),
        cuota({ due_date: '2026-11-04', amount: '700.00' }),
      ],
      PEN,
      '2026-11-06',
    );
    // El 4 está en la semana en curso: no es atraso, es esta semana.
    expect(toDb(semanas[0]!.entra)).toBe('3700.00');
    expect(toDb(semanas[0]!.atrasado)).toBe('3000.00');
    expect(semanas[1]?.atrasado.minor).toBe(0n);
  });

  it('lo que cae más allá del horizonte no se cuela en la última semana', () => {
    const semanas = proyeccion(
      [cuota({ due_date: '2027-06-01', amount: '9999.00' })],
      PEN,
      '2026-11-06',
    );
    expect(semanas.every((s) => s.entra.minor === 0n)).toBe(true);
  });

  it('cada moneda es su propia proyección', () => {
    const cuotas = [
      cuota({ due_date: '2026-11-20', amount: '1000.00', currency_code: 'PEN' }),
      cuota({ due_date: '2026-11-20', amount: '250.00', currency_code: 'USD' }),
    ];
    const soles = proyeccion(cuotas, PEN, '2026-11-06');
    const total = soles.reduce((n, s) => n + s.entra.minor, 0n);
    expect(total).toBe(fromDb('1000.00', PEN).minor);
    expect(monedasConCuotas(cuotas)).toEqual(['PEN', 'USD']);
  });

  it('una moneda desconocida no entra en ninguna proyección', () => {
    const cuotas = [cuota({ currency_code: 'EUR', amount: '900.00' })];
    expect(monedasConCuotas(cuotas)).toEqual([]);
    const semanas = proyeccion(cuotas, PEN, '2026-11-06');
    expect(semanas.every((s) => s.entra.minor === 0n)).toBe(true);
  });
});

describe('el saldo proyectado', () => {
  it('arranca del saldo de hoy y va acumulando', () => {
    const semanas = proyeccion(
      [
        cuota({ due_date: '2026-11-05', amount: '1000.00' }),
        cuota({ due_date: '2026-11-12', amount: '2000.00' }),
      ],
      PEN,
      '2026-11-06',
    );
    const saldos = saldoProyectado(fromDb('4650.00', PEN), semanas);
    expect(toDb(saldos[0]!)).toBe('5650.00');
    expect(toDb(saldos[1]!)).toBe('7650.00');
    expect(toDb(saldos[12]!)).toBe('7650.00');
  });

  it('parte de un saldo en rojo sin inventar nada', () => {
    const semanas = proyeccion([cuota({ due_date: '2026-11-05', amount: '100.00' })], PEN, '2026-11-06');
    const saldos = saldoProyectado(fromDb('-500.00', PEN), semanas);
    expect(toDb(saldos[0]!)).toBe('-400.00');
  });
});
