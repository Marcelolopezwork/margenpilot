import { describe, expect, it } from 'vitest';
import { fromDb, toDb } from '../../lib/money';
import {
  lunesDe,
  monedasConMovimiento,
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
    const semanas = proyeccion([], [], PEN, '2026-11-06');
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
      [],
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
      [],
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
      [],
      PEN,
      '2026-11-06',
    );
    // El 4 está en la semana en curso: no es atraso, es esta semana.
    expect(toDb(semanas[0]!.entra)).toBe('3700.00');
    expect(toDb(semanas[0]!.entraVencido)).toBe('3000.00');
    expect(semanas[1]?.entraVencido.minor).toBe(0n);
  });

  it('lo que cae más allá del horizonte no se cuela en la última semana', () => {
    const semanas = proyeccion(
      [cuota({ due_date: '2027-06-01', amount: '9999.00' })],
      [],
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
    const soles = proyeccion(cuotas, [], PEN, '2026-11-06');
    const total = soles.reduce((n, s) => n + s.entra.minor, 0n);
    expect(total).toBe(fromDb('1000.00', PEN).minor);
    expect(monedasConMovimiento(cuotas, [])).toEqual(['PEN', 'USD']);
  });

  it('una moneda desconocida no entra en ninguna proyección', () => {
    const cuotas = [cuota({ currency_code: 'EUR', amount: '900.00' })];
    expect(monedasConMovimiento(cuotas, [])).toEqual([]);
    const semanas = proyeccion(cuotas, [], PEN, '2026-11-06');
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
      [],
      PEN,
      '2026-11-06',
    );
    const saldos = saldoProyectado(fromDb('4650.00', PEN), semanas);
    expect(toDb(saldos[0]!)).toBe('5650.00');
    expect(toDb(saldos[1]!)).toBe('7650.00');
    expect(toDb(saldos[12]!)).toBe('7650.00');
  });

  it('parte de un saldo en rojo sin inventar nada', () => {
    const semanas = proyeccion([cuota({ due_date: '2026-11-05', amount: '100.00' })], [], PEN, '2026-11-06');
    const saldos = saldoProyectado(fromDb('-500.00', PEN), semanas);
    expect(toDb(saldos[0]!)).toBe('-400.00');
  });
});

/* ------------------------------------------------------------------ *
 * F3-3 · las salidas fijas
 * ------------------------------------------------------------------ */

import {
  CADENCIAS,
  nombreCadencia,
  ocurrencias,
  periodoDe,
  salidasEsperadas,
  type GastoRecurrente,
  type PagoRegistrado,
} from './proyeccion';

const gasto = (extra: Partial<GastoRecurrente> = {}): GastoRecurrente => ({
  id: 'g-1',
  label: 'Claude Code',
  amount: '200.00',
  currency_code: 'PEN',
  cadence: 'monthly',
  day_of_month: 5,
  starts_on: '2026-01-05',
  ends_on: null,
  is_active: true,
  // Anotado el mismo día que arrancó: en las pruebas interesa la cadencia,
  // no el tope de `recorded_on`, que tiene sus propias pruebas abajo.
  recorded_on: '2026-01-05',
  ...extra,
});

describe('las fechas de un gasto fijo', () => {
  it('cae el mismo día cada mes', () => {
    expect(ocurrencias(gasto(), '2026-11-01', '2027-02-01')).toEqual([
      '2026-11-05',
      '2026-12-05',
      '2027-01-05',
    ]);
  });

  /**
   * Un gasto que se cobra el 31 no se salta febrero: se cobra el 28. Y marzo
   * vuelve a ser el 31, porque el día de referencia no se degrada de un mes al
   * siguiente — que es el error clásico de sumar «un mes» a una fecha.
   */
  it('el día 31 se recorta al último del mes, y no se degrada después', () => {
    const fechas = ocurrencias(
      gasto({ day_of_month: 31, starts_on: '2027-01-31' }),
      '2027-01-01',
      '2027-05-01',
    );
    expect(fechas).toEqual(['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30']);
  });

  it('trimestral y anual saltan lo que les toca', () => {
    expect(ocurrencias(gasto({ cadence: 'quarterly' }), '2026-01-01', '2027-01-01')).toEqual([
      '2026-01-05',
      '2026-04-05',
      '2026-07-05',
      '2026-10-05',
    ]);
    expect(ocurrencias(gasto({ cadence: 'yearly' }), '2026-01-01', '2028-06-01')).toEqual([
      '2026-01-05',
      '2027-01-05',
      '2028-01-05',
    ]);
  });

  it('semanal va de siete en siete', () => {
    expect(
      ocurrencias(gasto({ cadence: 'weekly', starts_on: '2026-11-02' }), '2026-11-01', '2026-11-25'),
    ).toEqual(['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23']);
  });

  it('no empieza antes de su fecha de arranque ni sigue después del fin', () => {
    expect(ocurrencias(gasto({ starts_on: '2026-12-05' }), '2026-11-01', '2027-02-01')).toEqual([
      '2026-12-05',
      '2027-01-05',
    ]);
    expect(
      ocurrencias(gasto({ ends_on: '2026-12-31' }), '2026-11-01', '2027-03-01'),
    ).toEqual(['2026-11-05', '2026-12-05']);
  });

  it('un gasto archivado no genera ninguna', () => {
    expect(ocurrencias(gasto({ is_active: false }), '2026-11-01', '2027-02-01')).toEqual([]);
  });

  /**
   * `starts_on` es cuándo empezó la suscripción en la vida real y puede ser de
   * hace años. Si se generaran ocurrencias desde entonces, cargar hoy el
   * hosting que pagas desde enero haría aparecer diez meses «sin pagar». El
   * sistema no tiene ni una prueba de que no se pagaran: presumir que no se
   * pagaron es inventar deuda.
   */
  it('no genera nada anterior al día en que se anotó', () => {
    const fechas = ocurrencias(
      gasto({ starts_on: '2026-01-05', recorded_on: '2026-11-09' }),
      '2026-08-01',
      '2027-01-01',
    );
    expect(fechas).toEqual(['2026-12-05']);
  });

  it('y cuando sí se anotó a tiempo, el impago sí cuenta', () => {
    const fechas = ocurrencias(
      gasto({ starts_on: '2026-01-05', recorded_on: '2026-08-01' }),
      '2026-09-01',
      '2026-12-01',
    );
    expect(fechas).toEqual(['2026-09-05', '2026-10-05', '2026-11-05']);
  });
});

describe('el periodo de un pago', () => {
  it('es el mes, el trimestre, el año o la semana', () => {
    expect(periodoDe('2026-11-27', 'monthly')).toBe('2026-11');
    expect(periodoDe('2026-11-27', 'quarterly')).toBe('2026-T4');
    expect(periodoDe('2026-11-27', 'yearly')).toBe('2026');
    expect(periodoDe('2026-11-27', 'weekly')).toBe('2026-11-23');
  });
});

describe('las salidas esperadas', () => {
  /**
   * Si pagaste el hosting de noviembre el día 27 y vencía el 5, el mes está
   * saldado igual. Comparar por fecha exacta lo dejaría eternamente
   * pendiente.
   */
  it('el mes ya pagado desaparece, aunque se pagara otro día', () => {
    const pagos: PagoRegistrado[] = [
      { recurring_expense_id: 'g-1', value_date: '2026-11-27', is_void: false },
    ];
    const salidas = salidasEsperadas([gasto()], pagos, '2026-11-01', '2027-01-01');
    expect(salidas.map((s) => s.due_date)).toEqual(['2026-12-05']);
  });

  it('un pago anulado no salda nada', () => {
    const pagos: PagoRegistrado[] = [
      { recurring_expense_id: 'g-1', value_date: '2026-11-05', is_void: true },
    ];
    const salidas = salidasEsperadas([gasto()], pagos, '2026-11-01', '2026-12-01');
    expect(salidas.map((s) => s.due_date)).toEqual(['2026-11-05']);
  });

  it('un pago de otro gasto no salda este', () => {
    const pagos: PagoRegistrado[] = [
      { recurring_expense_id: 'g-2', value_date: '2026-11-05', is_void: false },
      { recurring_expense_id: null, value_date: '2026-11-05', is_void: false },
    ];
    const salidas = salidasEsperadas([gasto()], pagos, '2026-11-01', '2026-12-01');
    expect(salidas).toHaveLength(1);
  });
});

describe('la proyección con salidas', () => {
  it('resta lo que sale y deja el neto de la semana', () => {
    const semanas = proyeccion(
      [cuota({ due_date: '2026-11-12', amount: '5000.00' })],
      [{ gasto: 'g-1', label: 'Claude Code', due_date: '2026-11-13', amount: '800.00', currency_code: 'PEN' }],
      PEN,
      '2026-11-06',
    );
    expect(toDb(semanas[1]!.entra)).toBe('5000.00');
    expect(toDb(semanas[1]!.sale)).toBe('800.00');
    expect(toDb(semanas[1]!.neto)).toBe('4200.00');
    expect(semanas[1]?.gastos).toBe(1);
  });

  it('una semana con más gastos que cobros da neto negativo', () => {
    const semanas = proyeccion(
      [],
      [{ gasto: 'g-1', label: 'Hosting', due_date: '2026-11-10', amount: '350.00', currency_code: 'PEN' }],
      PEN,
      '2026-11-06',
    );
    expect(toDb(semanas[1]!.neto)).toBe('-350.00');
  });

  it('una salida atrasada cae en la primera semana y se señala', () => {
    const semanas = proyeccion(
      [],
      [{ gasto: 'g-1', label: 'Hosting', due_date: '2026-09-05', amount: '350.00', currency_code: 'PEN' }],
      PEN,
      '2026-11-06',
    );
    expect(toDb(semanas[0]!.sale)).toBe('350.00');
    expect(toDb(semanas[0]!.saleVencido)).toBe('350.00');
  });

  /** Ahora que hay salidas, el saldo proyectado puede cruzar el cero. */
  it('el saldo proyectado ya puede bajar y pasar a rojo', () => {
    const semanas = proyeccion(
      [],
      [
        { gasto: 'g-1', label: 'Hosting', due_date: '2026-11-10', amount: '600.00', currency_code: 'PEN' },
        { gasto: 'g-1', label: 'Hosting', due_date: '2026-11-17', amount: '600.00', currency_code: 'PEN' },
      ],
      PEN,
      '2026-11-06',
    );
    const saldos = saldoProyectado(fromDb('1000.00', PEN), semanas);
    expect(toDb(saldos[1]!)).toBe('400.00');
    expect(toDb(saldos[2]!)).toBe('-200.00');
  });

  it('una salida en otra moneda no entra en esta proyección', () => {
    const semanas = proyeccion(
      [],
      [{ gasto: 'g-1', label: 'ChatGPT', due_date: '2026-11-10', amount: '20.00', currency_code: 'USD' }],
      PEN,
      '2026-11-06',
    );
    expect(semanas.every((s) => s.sale.minor === 0n)).toBe(true);
  });
});

describe('cómo se nombra una cadencia', () => {
  it('se dice con palabras y están las cuatro', () => {
    expect(nombreCadencia('monthly')).toBe('cada mes');
    expect(nombreCadencia('yearly')).toBe('cada año');
    expect(CADENCIAS).toHaveLength(4);
  });
});
