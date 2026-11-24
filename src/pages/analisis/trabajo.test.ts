import { describe, expect, it } from 'vitest';
import { format } from '../../lib/money';
import {
  conCostoYSinFacturar,
  conMargen,
  nombreEstadoDeTrabajo,
  resumenPorMoneda,
  resumenPorServicio,
  seComenElMargen,
  type MargenEnBase,
  type TrabajoEnBase,
} from './trabajo';

const trabajo = (x: Partial<TrabajoEnBase>): TrabajoEnBase => ({
  id: 'j-1',
  name: 'Campaña de lanzamiento',
  client_id: 'c-1',
  service_id: 's-lanzamiento',
  quote_id: 'q-1',
  currency_code: 'PEN',
  price_net: '600.00',
  quote_net: '1000.00',
  expected_cost: '300.00',
  status: 'open',
  notes: null,
  created_at: '2026-11-01T10:00:00Z',
  ...x,
});

const cifras = (x: Partial<MargenEnBase>): MargenEnBase => ({
  job_id: 'j-1',
  currency_code: 'PEN',
  ingreso_neto: '0.00',
  costo_neto: '0.00',
  documentos: 0,
  costos: 0,
  ...x,
});

describe('los dos márgenes de un trabajo se miden con la misma vara', () => {
  it('el cotizado y el real comparten denominador, así que su diferencia significa algo', () => {
    const [t] = conMargen(
      [trabajo({})],
      [cifras({ costo_neto: '420.00', ingreso_neto: '600.00', costos: 2, documentos: 1 })],
    );

    // Cotizado: (600 − 300) / 600 = 50 %. Real: (600 − 420) / 600 = 30 %.
    expect(t!.margenCotizado).toBeCloseTo(50);
    expect(t!.margenReal).toBeCloseTo(30);
    expect(t!.desvio).toBeCloseTo(-20);
  });

  it('facturar a plazos no mueve el margen: es un calendario, no un hecho del trabajo', () => {
    const base = trabajo({ price_net: '6000.00', expected_cost: '2000.00' });

    const [enero] = conMargen([base], [cifras({ ingreso_neto: '2000.00', costo_neto: '2000.00' })]);
    const [marzo] = conMargen([base], [cifras({ ingreso_neto: '6000.00', costo_neto: '2000.00' })]);

    expect(enero!.margenReal).toBeCloseTo(marzo!.margenReal!);
    // Lo que sí cambia es lo facturado, que se enseña con su nombre.
    expect(format(enero!.porFacturar)).toBe('S/ 4,000.00');
    expect(format(marzo!.porFacturar)).toBe('S/ 0.00');
  });

  it('un trabajo sin nada todavía tiene margen cotizado y ningún costo', () => {
    const [t] = conMargen([trabajo({})], []);

    expect(t!.margenCotizado).toBeCloseTo(50);
    expect(t!.margenReal).toBeCloseTo(100);
    expect(format(t!.costo)).toBe('S/ 0.00');
    expect(format(t!.facturado)).toBe('S/ 0.00');
    expect(t!.cuantosCostos).toBe(0);
  });

  it('un trabajo cancelado no se mide contra un precio que ya no va a cobrar', () => {
    const [t] = conMargen(
      [trabajo({ status: 'cancelled' })],
      [cifras({ costo_neto: '200.00', ingreso_neto: '100.00' })],
    );

    expect(t!.estado).toBe('cancelled');
    expect(t!.margenReal).toBeNull();
    expect(t!.desvio).toBeNull();
    // Pero lo gastado y lo facturado siguen ahí, en crudo.
    expect(format(t!.costo)).toBe('S/ 200.00');
    expect(format(t!.facturado)).toBe('S/ 100.00');
  });

  it('lo facturado por encima del acordado no deja un «por facturar» negativo', () => {
    const [t] = conMargen([trabajo({})], [cifras({ ingreso_neto: '900.00' })]);
    expect(format(t!.porFacturar)).toBe('S/ 0.00');
  });

  it('un costo en otra moneda se enseña aparte y no se suma (INV-10)', () => {
    const [t] = conMargen(
      [trabajo({})],
      [
        cifras({ costo_neto: '200.00', ingreso_neto: '600.00', costos: 1 }),
        cifras({ currency_code: 'USD', costo_neto: '50.00', costos: 1 }),
      ],
    );

    expect(format(t!.costo)).toBe('S/ 200.00');
    expect(t!.costosAjenos).toHaveLength(1);
    expect(t!.costosAjenos[0]!.moneda).toBe('USD');
    expect(format(t!.costosAjenos[0]!.costo)).toBe('US$ 50.00');
    // Y el margen real sigue siendo el de su moneda: (600 − 200) / 600.
    expect(t!.margenReal).toBeCloseTo(66.666, 2);
  });

  it('un trabajo en una moneda que el producto no conoce se queda fuera', () => {
    expect(conMargen([trabajo({ currency_code: 'EUR' })], [])).toHaveLength(0);
  });

  it('el estado se dice en palabras', () => {
    expect(nombreEstadoDeTrabajo('open')).toBe('en curso');
    expect(nombreEstadoDeTrabajo('done')).toBe('terminado');
    expect(nombreEstadoDeTrabajo('cancelled')).toBe('cancelado');
  });
});

describe('cuánto deja cada servicio', () => {
  it('pondera: no promedia porcentajes', () => {
    const trabajos = conMargen(
      [
        // 10 000 acordado, cuesta 9 000 → 10 %.
        trabajo({
          id: 'j-grande',
          price_net: '10000.00',
          expected_cost: '5000.00',
          service_id: 's-redes',
        }),
        // 1 000 acordado, cuesta 500 → 50 %.
        trabajo({
          id: 'j-chico',
          price_net: '1000.00',
          expected_cost: '500.00',
          service_id: 's-redes',
        }),
      ],
      [
        cifras({ job_id: 'j-grande', costo_neto: '9000.00' }),
        cifras({ job_id: 'j-chico', costo_neto: '500.00' }),
      ],
    );

    const [redes] = resumenPorServicio(trabajos);

    expect(redes!.servicioId).toBe('s-redes');
    expect(redes!.cuantos).toBe(2);
    expect(format(redes!.acordado)).toBe('S/ 11,000.00');
    expect(format(redes!.costo)).toBe('S/ 9,500.00');
    // Σutilidad / Σacordado = 1 500 / 11 000 = 13,6 %, no el 30 % del promedio.
    expect(redes!.margenReal).toBeCloseTo(13.636, 2);
    expect(redes!.margenCotizado).toBeCloseTo(50);
  });

  it('los cancelados no hunden el margen del servicio con dinero que nadie perdió', () => {
    const trabajos = conMargen(
      [
        trabajo({ id: 'j-vivo', service_id: 's-redes' }),
        trabajo({ id: 'j-muerto', service_id: 's-redes', status: 'cancelled' }),
      ],
      [
        cifras({ job_id: 'j-vivo', costo_neto: '300.00' }),
        cifras({ job_id: 'j-muerto', costo_neto: '500.00' }),
      ],
    );

    const [redes] = resumenPorServicio(trabajos);
    expect(redes!.cuantos).toBe(1);
    expect(format(redes!.costo)).toBe('S/ 300.00');
  });

  it('dos monedas del mismo servicio son dos filas, nunca una suma', () => {
    const trabajos = conMargen(
      [
        trabajo({ id: 'j-pen', service_id: 's-redes' }),
        trabajo({
          id: 'j-usd',
          service_id: 's-redes',
          currency_code: 'USD',
          price_net: '1000.00',
          quote_net: '1000.00',
          expected_cost: '400.00',
        }),
      ],
      [
        cifras({ job_id: 'j-pen', costo_neto: '300.00' }),
        cifras({ job_id: 'j-usd', currency_code: 'USD', costo_neto: '450.00' }),
      ],
    );

    const filas = resumenPorServicio(trabajos);
    expect(filas).toHaveLength(2);
    expect(filas.map((w) => w.moneda)).toEqual(['PEN', 'USD']);
  });

  it('los trabajos sin servicio del catálogo se agrupan en su propia fila', () => {
    const trabajos = conMargen([trabajo({ service_id: null })], []);
    const [fila] = resumenPorServicio(trabajos);
    expect(fila!.servicioId).toBeNull();
  });

  it('el peor desvío va primero, que es el que hay que mirar', () => {
    const trabajos = conMargen(
      [
        trabajo({ id: 'j-bien', service_id: 's-bien' }),
        trabajo({ id: 'j-mal', service_id: 's-mal' }),
      ],
      [
        cifras({ job_id: 'j-bien', costo_neto: '250.00' }),
        cifras({ job_id: 'j-mal', costo_neto: '550.00' }),
      ],
    );

    expect(resumenPorServicio(trabajos).map((w) => w.servicioId)).toEqual(['s-mal', 's-bien']);
  });

  it('arrastra los costos en otra moneda al resumen, también sin convertir', () => {
    const trabajos = conMargen(
      [trabajo({ id: 'j-1' }), trabajo({ id: 'j-2' })],
      [
        cifras({ job_id: 'j-1', currency_code: 'USD', costo_neto: '30.00', costos: 1 }),
        cifras({ job_id: 'j-2', currency_code: 'USD', costo_neto: '20.00', costos: 2 }),
      ],
    );

    const [redes] = resumenPorServicio(trabajos);
    expect(redes!.costosAjenos).toHaveLength(1);
    expect(format(redes!.costosAjenos[0]!.costo)).toBe('US$ 50.00');
    expect(redes!.costosAjenos[0]!.cuantos).toBe(3);
  });
});

describe('las dos listas que hay que mirar', () => {
  it('los que se comen el margen son los del desvío, no los de margen bajo', () => {
    const trabajos = conMargen(
      [
        // Cotizado al 15 % y cuesta lo previsto: está bien aunque el margen sea bajo.
        trabajo({ id: 'j-flaco', price_net: '1000.00', expected_cost: '850.00' }),
        // Cotizado al 50 % y va camino del 20 %: este es el problema.
        trabajo({ id: 'j-gordo', price_net: '1000.00', expected_cost: '500.00' }),
      ],
      [
        cifras({ job_id: 'j-flaco', costo_neto: '850.00' }),
        cifras({ job_id: 'j-gordo', costo_neto: '800.00' }),
      ],
    );

    expect(seComenElMargen(trabajos).map((w) => w.id)).toEqual(['j-gordo']);
  });

  it('con un umbral en puntos, los desvíos pequeños no molestan', () => {
    const trabajos = conMargen(
      [trabajo({ price_net: '1000.00', expected_cost: '500.00' })],
      [cifras({ costo_neto: '520.00' })],
    );

    // Dos puntos de desvío: con umbral de cinco, no aparece.
    expect(seComenElMargen(trabajos, 5)).toHaveLength(0);
    expect(seComenElMargen(trabajos, 1)).toHaveLength(1);
  });

  it('un trabajo que ya cuesta y no tiene una sola factura emitida se señala', () => {
    const trabajos = conMargen(
      [trabajo({ id: 'j-sin' }), trabajo({ id: 'j-con' })],
      [
        cifras({ job_id: 'j-sin', costo_neto: '200.00' }),
        cifras({ job_id: 'j-con', costo_neto: '200.00', ingreso_neto: '600.00', documentos: 1 }),
      ],
    );

    expect(conCostoYSinFacturar(trabajos).map((w) => w.id)).toEqual(['j-sin']);
  });
});

describe('el conjunto', () => {
  it('es la misma aritmética que las filas, no una segunda', () => {
    const trabajos = conMargen(
      [
        trabajo({ id: 'j-1', service_id: 's-uno' }),
        trabajo({ id: 'j-2', service_id: 's-dos', price_net: '400.00', expected_cost: '100.00' }),
      ],
      [
        cifras({ job_id: 'j-1', costo_neto: '300.00' }),
        cifras({ job_id: 'j-2', costo_neto: '200.00' }),
      ],
    );

    const [todo] = resumenPorMoneda(trabajos);
    const porServicio = resumenPorServicio(trabajos);

    expect(todo!.servicioId).toBeNull();
    expect(todo!.cuantos).toBe(2);
    expect(format(todo!.acordado)).toBe('S/ 1,000.00');
    expect(format(todo!.costo)).toBe('S/ 500.00');
    // Σutilidad / Σacordado = 500 / 1 000.
    expect(todo!.margenReal).toBeCloseTo(50);
    // Y cuadra con lo que suman las filas de servicio, porque es el mismo código.
    expect(
      porServicio.reduce((n, w) => n + w.utilidad.minor, 0n),
    ).toBe(todo!.utilidad.minor);
  });

  it('cada moneda es su propia fila, también en el conjunto', () => {
    const trabajos = conMargen(
      [trabajo({ id: 'j-1' }), trabajo({ id: 'j-2', currency_code: 'USD' })],
      [],
    );
    expect(resumenPorMoneda(trabajos).map((w) => w.moneda)).toEqual(['PEN', 'USD']);
  });
});
