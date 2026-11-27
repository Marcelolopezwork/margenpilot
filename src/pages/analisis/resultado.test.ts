import { describe, expect, it } from 'vitest';
import { format } from '../../lib/money';
import {
  fueraDelResultado,
  gastosPorCategoria,
  gastosPorProveedor,
  ingresosPorCliente,
  alturaDeBarra,
  mesDe,
  mesesEntre,
  nombreMes,
  rangoDe,
  resultadoPorMoneda,
  seriePorMes,
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
  supplier_id: null,
  concepto: 'Algo',
  ...h,
});

describe('a quién se le pagó', () => {
  const nombres = new Map([['prov-1', 'Movistar']]);

  it('agrupa las salidas por proveedor', () => {
    const filas = gastosPorProveedor(
      [
        hecho({ direction: 'out', supplier_id: 'prov-1', amount_net: '500.00' }),
        hecho({ direction: 'out', supplier_id: 'prov-1', amount_net: '200.00' }),
      ],
      nombres,
    );
    expect(filas).toHaveLength(1);
    expect(filas[0]?.nombre).toBe('Movistar');
    expect(format(filas[0]!.total)).toBe('S/ 700.00');
    expect(filas[0]?.hechos).toBe(2);
  });

  it('un gasto sin proveedor no se inventa uno: queda en su grupo', () => {
    const filas = gastosPorProveedor(
      [hecho({ direction: 'out', supplier_id: null, amount_net: '90.00' })],
      nombres,
    );
    expect(filas[0]?.nombre).toBe('Sin proveedor anotado');
  });

  it('lo que no es del negocio no cuenta como pago a proveedor', () => {
    const filas = gastosPorProveedor(
      [hecho({ direction: 'out', flow_class: 'non_operating', supplier_id: 'prov-1' })],
      nombres,
    );
    expect(filas).toHaveLength(0);
  });
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

describe('la serie por mes', () => {
  it('los meses sin nada existen: un verano muerto es un hueco, no una columna que falta', () => {
    const [serie] = seriePorMes(
      [
        hecho({ fecha: '2026-06-10', direction: 'in', amount_net: '1000.00' }),
        hecho({ fecha: '2026-09-10', direction: 'in', amount_net: '2000.00' }),
      ],
      '2026-06-01',
      '2026-09-30',
    );

    expect(serie!.meses.map((m) => m.mes)).toEqual(['2026-06', '2026-07', '2026-08', '2026-09']);
    expect(serie!.meses[1]!.hechos).toBe(0);
    expect(format(serie!.meses[1]!.ingresos)).toBe('S/ 0.00');
  });

  it('suma lo mismo que el resultado del periodo: una sola aritmética', () => {
    const hechos = [
      hecho({ fecha: '2026-10-05', direction: 'in', amount_net: '3000.00' }),
      hecho({ fecha: '2026-11-05', direction: 'in', amount_net: '5000.00' }),
      hecho({ fecha: '2026-11-20', direction: 'out', amount_net: '1200.00' }),
    ];
    const [serie] = seriePorMes(hechos, '2026-10-01', '2026-11-30');
    const [total] = resultadoPorMoneda(hechos);

    const sumaIngresos = serie!.meses.reduce((n, m) => n + m.ingresos.minor, 0n);
    const sumaGastos = serie!.meses.reduce((n, m) => n + m.gastos.minor, 0n);
    expect(sumaIngresos).toBe(total!.ingresos.minor);
    expect(sumaGastos).toBe(total!.gastos.minor);
  });

  it('lo no operativo se queda fuera, igual que arriba', () => {
    const [serie] = seriePorMes(
      [
        hecho({ fecha: '2026-11-05', direction: 'in', amount_net: '1000.00' }),
        hecho({
          fecha: '2026-11-06',
          direction: 'out',
          flow_class: 'non_operating',
          kind: 'owner_draw',
          amount_net: '2500.00',
          amount_total: '2500.00',
        }),
      ],
      '2026-11-01',
      '2026-11-30',
    );
    // Un retiro del dueño no es un gasto: no hunde el mes.
    expect(format(serie!.meses[0]!.gastos)).toBe('S/ 0.00');
    expect(format(serie!.meses[0]!.resultado)).toBe('S/ 1,000.00');
  });

  it('dice qué mes se vendió más y qué mes menos, por ingresos', () => {
    const [serie] = seriePorMes(
      [
        hecho({ fecha: '2026-09-10', direction: 'in', amount_net: '800.00' }),
        hecho({ fecha: '2026-10-10', direction: 'in', amount_net: '4000.00' }),
        hecho({ fecha: '2026-11-10', direction: 'in', amount_net: '2000.00' }),
      ],
      '2026-09-01',
      '2026-11-30',
    );

    expect(serie!.mejor?.mes).toBe('2026-10');
    expect(serie!.peor?.mes).toBe('2026-09');
    // Y un mes sin nada no es «el peor»: es un mes sin datos.
    expect(serie!.peor?.hechos).toBeGreaterThan(0);
  });

  it('sin un solo hecho no hay mejor ni peor, y no se inventan', () => {
    expect(seriePorMes([], '2026-01-01', '2026-12-31')).toEqual([]);
    const [serie] = seriePorMes(
      [
        hecho({
          fecha: '2026-11-05',
          direction: 'out',
          flow_class: 'non_operating',
          kind: 'owner_draw',
        }),
      ],
      '2026-11-01',
      '2026-11-30',
    );
    expect(serie!.mejor).toBeNull();
    expect(serie!.peor).toBeNull();
  });

  it('cada moneda es su propia serie (INV-10)', () => {
    const series = seriePorMes(
      [
        hecho({ fecha: '2026-11-05', direction: 'in', amount_net: '1000.00' }),
        hecho({
          fecha: '2026-11-05',
          direction: 'in',
          currency_code: 'USD',
          amount_net: '300.00',
        }),
      ],
      '2026-11-01',
      '2026-11-30',
    );
    expect(series.map((s) => s.moneda)).toEqual(['PEN', 'USD']);
  });

  it('el techo es el mayor de los dos lados, para que se puedan comparar a ojo', () => {
    const [serie] = seriePorMes(
      [
        hecho({ fecha: '2026-11-05', direction: 'in', amount_net: '1000.00' }),
        hecho({ fecha: '2026-11-06', direction: 'out', amount_net: '2500.00' }),
      ],
      '2026-11-01',
      '2026-11-30',
    );
    expect(format(serie!.techo)).toBe('S/ 2,500.00');
  });
});

describe('las piezas del gráfico', () => {
  it('mesDe recorta sin pasar por Date', () => {
    expect(mesDe('2026-11-23')).toBe('2026-11');
  });

  it('mesesEntre cruza el año', () => {
    expect(mesesEntre('2026-11-01', '2027-02-15')).toEqual([
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
    ]);
  });

  it('mesesEntre de un solo mes devuelve ese mes', () => {
    expect(mesesEntre('2026-11-01', '2026-11-30')).toEqual(['2026-11']);
  });

  it('el nombre del mes se lee, y una clave rota se devuelve tal cual', () => {
    expect(nombreMes('2026-11')).toBe('nov 2026');
    expect(nombreMes('vaya')).toBe('vaya');
  });

  it('la altura es relativa al techo, y nunca se sale de la caja', () => {
    const pen = (v: string) => ({ minor: BigInt(v), currency: 'PEN' as const });
    expect(alturaDeBarra(pen('5000'), pen('10000'))).toBe(50);
    expect(alturaDeBarra(pen('10000'), pen('10000'))).toBe(100);
    expect(alturaDeBarra(pen('20000'), pen('10000'))).toBe(100);
    expect(alturaDeBarra(pen('0'), pen('10000'))).toBe(0);
    // Sin techo no hay escala, y una división por cero no se intenta.
    expect(alturaDeBarra(pen('5000'), pen('0'))).toBe(0);
  });

  it('una barra diminuta se ve: un píxel es mejor que nada', () => {
    const pen = (v: string) => ({ minor: BigInt(v), currency: 'PEN' as const });
    expect(alturaDeBarra(pen('1'), pen('1000000'))).toBe(1);
  });
});
