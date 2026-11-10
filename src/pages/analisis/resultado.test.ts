import { describe, expect, it } from 'vitest';
import { format } from '../../lib/money';
import {
  fueraDelResultado,
  gastosPorCategoria,
  ingresosPorCliente,
  rangoDe,
  resultadoPorMoneda,
  type Hecho,
} from './resultado';

const hecho = (h: Partial<Hecho>): Hecho => ({
  origen: 'movimiento',
  fecha: '2026-11-05',
  direction: 'out',
  flow_class: 'operating',
  kind: 'operating',
  currency_code: 'PEN',
  amount_total: '100.00',
  amount_net: '100.00',
  amount_tax: '0.00',
  category_id: null,
  client_id: null,
  concepto: 'Algo',
  ...h,
});

describe('los periodos son completos, no móviles', () => {
  it('este mes va del 1 al último día, y febrero sabe cuántos tiene', () => {
    expect(rangoDe('mes', '2026-11-09')).toEqual({ desde: '2026-11-01', hasta: '2026-11-30' });
    expect(rangoDe('mes', '2028-02-15')).toEqual({ desde: '2028-02-01', hasta: '2028-02-29' });
  });

  it('el mes pasado cruza el año sin inventarse un mes cero', () => {
    expect(rangoDe('mes-pasado', '2027-01-04')).toEqual({
      desde: '2026-12-01',
      hasta: '2026-12-31',
    });
  });

  it('este año es el año entero', () => {
    expect(rangoDe('anio', '2026-11-09')).toEqual({ desde: '2026-01-01', hasta: '2026-12-31' });
  });

  it('los últimos doce meses incluyen el que corre, entero', () => {
    expect(rangoDe('doce-meses', '2026-11-09')).toEqual({
      desde: '2025-12-01',
      hasta: '2026-11-30',
    });
    expect(rangoDe('doce-meses', '2026-12-31')).toEqual({
      desde: '2026-01-01',
      hasta: '2026-12-31',
    });
  });
});

describe('el resultado', () => {
  it('es el neto que entra menos el neto que sale, y el impuesto va aparte', () => {
    const [r] = resultadoPorMoneda([
      hecho({ origen: 'documento', direction: 'in', amount_total: '11800.00', amount_net: '10000.00', amount_tax: '1800.00' }),
      hecho({ direction: 'out', amount_total: '1180.00', amount_net: '1000.00', amount_tax: '180.00' }),
    ]);
    expect(format(r!.ingresos)).toBe('S/ 10,000.00');
    expect(format(r!.gastos)).toBe('S/ 1,000.00');
    expect(format(r!.resultado)).toBe('S/ 9,000.00');
    // El IGV no es resultado: es dinero de la SUNAT que pasa por la cuenta.
    expect(format(r!.igvCobrado)).toBe('S/ 1,800.00');
    expect(format(r!.igvPagado)).toBe('S/ 180.00');
    expect(r!.margen).toBeCloseTo(90, 5);
  });

  it('dos monedas son dos resultados, nunca una suma', () => {
    const filas = resultadoPorMoneda([
      hecho({ direction: 'in', currency_code: 'PEN', amount_net: '1000.00' }),
      hecho({ direction: 'in', currency_code: 'USD', amount_net: '500.00' }),
    ]);
    expect(filas).toHaveLength(2);
    expect(format(filas[0]!.ingresos)).toBe('S/ 1,000.00');
    expect(format(filas[1]!.ingresos)).toBe('US$ 500.00');
  });

  /**
   * La razón de ser del lente: un retiro del dueño no es un gasto. Si se
   * restara del resultado, el negocio parecería peor de lo que es, y si se
   * ignorara del todo, el dinero habría desaparecido.
   */
  it('lo no operativo no entra en el resultado, pero no desaparece', () => {
    const [r] = resultadoPorMoneda([
      hecho({ direction: 'in', amount_net: '5000.00', amount_total: '5000.00' }),
      hecho({
        direction: 'out',
        flow_class: 'non_operating',
        kind: 'owner_draw',
        amount_total: '2000.00',
        amount_net: '2000.00',
        concepto: 'Retiro',
      }),
    ]);
    expect(format(r!.ingresos)).toBe('S/ 5,000.00');
    expect(format(r!.gastos)).toBe('S/ 0.00');
    expect(format(r!.resultado)).toBe('S/ 5,000.00');
    expect(format(r!.noOperativo)).toBe('-S/ 2,000.00');
  });

  it('sin ingresos no hay margen que inventar', () => {
    const [r] = resultadoPorMoneda([hecho({ direction: 'out', amount_net: '300.00' })]);
    expect(r!.margen).toBeNull();
    expect(format(r!.resultado)).toBe('-S/ 300.00');
  });
});

describe('de dónde vino y en qué se fue', () => {
  it('agrupa el ingreso por cliente y ordena de mayor a menor', () => {
    const filas = ingresosPorCliente(
      [
        hecho({ direction: 'in', client_id: 'c1', amount_net: '1000.00' }),
        hecho({ direction: 'in', client_id: 'c2', amount_net: '4000.00' }),
        hecho({ direction: 'in', client_id: 'c1', amount_net: '500.00' }),
      ],
      new Map([
        ['c1', 'EJ Deportes'],
        ['c2', 'Nlima'],
      ]),
    );
    expect(filas.map((f) => [f.nombre, format(f.total)])).toEqual([
      ['Nlima', 'S/ 4,000.00'],
      ['EJ Deportes', 'S/ 1,500.00'],
    ]);
  });

  it('un cliente borrado se nombra, no se esconde', () => {
    const [f] = ingresosPorCliente([hecho({ direction: 'in', client_id: 'c9' })], new Map());
    expect(f!.nombre).toBe('Cliente que ya no existe');
  });

  it('un gasto sin categoría se cuenta igual y lo dice', () => {
    const filas = gastosPorCategoria(
      [
        hecho({ direction: 'out', category_id: 'k1', amount_net: '200.00' }),
        hecho({ direction: 'out', category_id: null, amount_net: '50.00' }),
      ],
      new Map([['k1', 'Herramientas']]),
    );
    expect(filas.map((f) => f.nombre)).toEqual(['Herramientas', 'Sin categoría']);
  });

  it('y lo no operativo se lista uno por uno', () => {
    const fuera = fueraDelResultado([
      hecho({ flow_class: 'non_operating', concepto: 'Retiro' }),
      hecho({ concepto: 'Hosting' }),
    ]);
    expect(fuera.map((h) => h.concepto)).toEqual(['Retiro']);
  });
});
