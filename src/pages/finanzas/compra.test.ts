import { describe, expect, it } from 'vitest';
import { format, fromDb } from '../../lib/money';
import {
  TIPOS_DE_COMPRA,
  conceptoDeCompra,
  desglose,
  impuestoDe,
  nombreEstadoCompra,
  pendienteDeCompra,
  vencidaDesde,
  yaExisteProveedor,
  type CompraEnCartera,
} from './compra';

const compra = (c: Partial<CompraEnCartera>): CompraEnCartera => ({
  id: 'c-1',
  series_number: 'F001-1234',
  description: null,
  doc_type: 'invoice',
  issue_date: '2026-11-01',
  due_date: '2026-11-30',
  currency_code: 'PEN',
  amount_total: '1180.00',
  amount_net: '1000.00',
  amount_tax: '180.00',
  tax_rate: '18.0000',
  status: 'open',
  legal_entity_id: 'e-1',
  proveedor: 'Movistar',
  categoria: null,
  ...c,
});

describe('el IGV que pagas no es tu gasto', () => {
  it('parte el total como lo parte la base: neto redondeado, impuesto por diferencia', () => {
    const { neto, impuesto } = desglose(fromDb('1180.00', 'PEN'), '18');
    expect(format(neto)).toBe('S/ 1,000.00');
    expect(format(impuesto)).toBe('S/ 180.00');
  });

  it('las dos partes suman el total exacto, aunque la división no sea redonda', () => {
    const total = fromDb('101.00', 'PEN');
    const { neto, impuesto } = desglose(total, '18');
    // 101 / 1.18 = 85.5932…, que redondea a 85.59; el impuesto es lo que falta.
    expect(format(neto)).toBe('S/ 85.59');
    expect(format(impuesto)).toBe('S/ 15.41');
    expect(neto.minor + impuesto.minor).toBe(total.minor);
  });

  it('una factura exonerada es gasto entero y cero de crédito fiscal', () => {
    const { neto, impuesto } = desglose(fromDb('500.00', 'PEN'), '0');
    expect(format(neto)).toBe('S/ 500.00');
    expect(format(impuesto)).toBe('S/ 0.00');
  });

  it('admite tasas con decimales', () => {
    const { neto } = desglose(fromDb('118.00', 'PEN'), '18.5');
    expect(format(neto)).toBe('S/ 99.58');
  });

  it('suma el IGV de un grupo de compras y no mezcla monedas', () => {
    const compras = [
      compra({ amount_tax: '180.00', currency_code: 'PEN' }),
      compra({ id: 'c-2', amount_tax: '36.00', currency_code: 'PEN' }),
      compra({ id: 'c-3', amount_tax: '99.00', currency_code: 'USD' }),
    ];
    expect(format(impuestoDe(compras, 'PEN'))).toBe('S/ 216.00');
    expect(format(impuestoDe(compras, 'USD'))).toBe('US$ 99.00');
  });
});

describe('lo que falta por pagar', () => {
  it('es el total menos lo pagado', () => {
    const c = compra({ amount_total: '1180.00' });
    expect(format(pendienteDeCompra(c, fromDb('180.00', 'PEN')))).toBe('S/ 1,000.00');
  });
});

describe('el concepto es lo que se entiende', () => {
  it('manda lo escrito sobre el número de serie', () => {
    expect(conceptoDeCompra(compra({ description: 'Hosting anual' }))).toBe('Hosting anual');
  });

  it('sin concepto escrito, el número; sin número, lo dice', () => {
    expect(conceptoDeCompra(compra({ description: '   ' }))).toBe('F001-1234');
    expect(conceptoDeCompra(compra({ description: null, series_number: null }))).toBe(
      'Compra sin número',
    );
  });
});

describe('vencida es una cosa y sin plazo es otra', () => {
  it('cuenta los días solo si pasó la fecha', () => {
    expect(vencidaDesde(compra({ due_date: '2026-11-01' }), '2026-11-09')).toBe(8);
    expect(vencidaDesde(compra({ due_date: '2026-11-30' }), '2026-11-09')).toBe(0);
  });

  it('sin fecha de pago no está vencida: está sin plazo', () => {
    expect(vencidaDesde(compra({ due_date: null }), '2026-12-31')).toBe(0);
  });

  it('una compra pagada o anulada no vence nunca más', () => {
    expect(vencidaDesde(compra({ due_date: '2026-01-01', status: 'paid' }), '2026-11-09')).toBe(0);
    expect(vencidaDesde(compra({ due_date: '2026-01-01', status: 'void' }), '2026-11-09')).toBe(0);
  });
});

describe('el mismo estado, otras palabras', () => {
  it('un documento abierto que recibiste está por pagar, no por cobrar', () => {
    expect(nombreEstadoCompra('open')).toBe('por pagar');
    expect(nombreEstadoCompra('partially_paid')).toBe('pagada a medias');
    expect(nombreEstadoCompra('paid')).toBe('pagada');
  });
});

describe('el proveedor se reconoce aunque se teclee distinto', () => {
  const lista = [{ name: 'Movistar' }, { name: 'Adobe' }];

  it('no distingue mayúsculas ni espacios de más', () => {
    expect(yaExisteProveedor('  movistar ', lista)).toBe(true);
    expect(yaExisteProveedor('MOVISTAR', lista)).toBe(true);
  });

  it('uno nuevo es nuevo, y un nombre vacío no es nadie', () => {
    expect(yaExisteProveedor('Claro', lista)).toBe(false);
    expect(yaExisteProveedor('   ', lista)).toBe(false);
  });
});

describe('qué comprobantes se ofrecen', () => {
  it('la nota de crédito no está: no es una compra, es la corrección de una', () => {
    expect(TIPOS_DE_COMPRA).not.toContain('credit_note');
    expect(TIPOS_DE_COMPRA).toContain('invoice');
    expect(TIPOS_DE_COMPRA).toContain('receipt');
  });
});
