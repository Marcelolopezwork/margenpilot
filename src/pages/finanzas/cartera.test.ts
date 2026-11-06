import { describe, expect, it } from 'vitest';
import { format, fromDb, toDb } from '../../lib/money';
import {
  diasDeAtraso,
  enRojo,
  nombreEstadoDocumento,
  pagadoDe,
  pendienteDe,
  porMoneda,
  tonoEstadoDocumento,
  vencido,
  type DocumentoEnCartera,
} from './cartera';

const PEN = 'PEN' as const;

const doc = (extra: Partial<DocumentoEnCartera> = {}): DocumentoEnCartera => ({
  id: 'd-1',
  series_number: 'F001-00000123',
  issue_date: '2026-11-01',
  due_date: '2026-11-30',
  currency_code: 'PEN',
  amount_total: '11307.94',
  status: 'open',
  cliente: 'EJ Deportes',
  ...extra,
});

describe('lo que queda por cobrar', () => {
  it('suma solo las asignaciones de ese documento', () => {
    const pagado = pagadoDe(doc(), [
      { billing_document_id: 'd-1', amount: '5000.00' },
      { billing_document_id: 'd-2', amount: '9999.00' },
      { billing_document_id: 'd-1', amount: '1307.94' },
    ]);
    expect(toDb(pagado)).toBe('6307.94');
    expect(toDb(pendienteDe(doc(), pagado))).toBe('5000.00');
  });

  it('un documento sin cobros está pendiente por entero', () => {
    const pagado = pagadoDe(doc(), []);
    expect(toDb(pendienteDe(doc(), pagado))).toBe('11307.94');
  });
});

describe('el vencimiento', () => {
  it('vencido es que la fecha pasó y todavía se debe', () => {
    expect(vencido(doc(), '2026-12-01')).toBe(true);
    expect(vencido(doc(), '2026-11-30')).toBe(false);
    expect(diasDeAtraso(doc(), '2026-12-10')).toBe(10);
  });

  it('lo cobrado y lo anulado no vencen, aunque la fecha haya pasado', () => {
    expect(vencido(doc({ status: 'paid' }), '2027-01-01')).toBe(false);
    expect(vencido(doc({ status: 'void' }), '2027-01-01')).toBe(false);
  });

  /**
   * Sin plazo no es lo mismo que al día: es que nadie pactó cuándo. Marcarlo
   * como vencido sería inventar un plazo; marcarlo como al día esconde que
   * falta acordarlo.
   */
  it('sin fecha de vencimiento no está vencido', () => {
    expect(vencido(doc({ due_date: null }), '2030-01-01')).toBe(false);
    expect(diasDeAtraso(doc({ due_date: null }), '2030-01-01')).toBe(0);
  });
});

describe('agregar por moneda', () => {
  it('nunca suma soles con dólares', () => {
    const totales = porMoneda([
      { currency_code: 'PEN', importe: '1000.00' },
      { currency_code: 'USD', importe: '250.00' },
      { currency_code: 'PEN', importe: '307.94' },
    ]);
    expect(totales).toHaveLength(2);
    expect(totales[0]?.moneda).toBe('PEN');
    expect(toDb(totales[0]!.total)).toBe('1307.94');
    expect(totales[0]?.cuantos).toBe(2);
    expect(totales[1]?.moneda).toBe('USD');
    expect(toDb(totales[1]!.total)).toBe('250.00');
  });

  /**
   * Una moneda que el producto no conoce se queda fuera entera. Colarla en
   * otro grupo daría un total redondo y falso, que es peor que un total
   * incompleto y señalado.
   */
  it('una moneda desconocida no se cuela en otro grupo', () => {
    const totales = porMoneda([
      { currency_code: 'PEN', importe: '100.00' },
      { currency_code: 'EUR', importe: '900.00' },
    ]);
    expect(totales).toHaveLength(1);
    expect(toDb(totales[0]!.total)).toBe('100.00');
  });

  it('sin filas no hay cifra que enseñar', () => {
    expect(porMoneda([])).toEqual([]);
  });
});

describe('cómo se lee un documento', () => {
  it('el estado se dice con palabras, no solo con color', () => {
    expect(nombreEstadoDocumento('open')).toBe('por cobrar');
    expect(nombreEstadoDocumento('partially_paid')).toBe('cobrado a medias');
    expect(nombreEstadoDocumento('paid')).toBe('cobrado');
  });

  it('el tono refuerza: cobrado en positivo, vencido en atención', () => {
    expect(tonoEstadoDocumento(doc({ status: 'paid' }), '2026-11-10')).toBe('positivo');
    expect(tonoEstadoDocumento(doc(), '2026-12-15')).toBe('atencion');
    expect(tonoEstadoDocumento(doc(), '2026-11-10')).toBe('neutro');
  });
});

describe('un saldo en rojo', () => {
  it('no es un error de cálculo: es una cuenta sobregirada', () => {
    expect(enRojo(fromDb('-120.50', PEN))).toBe(true);
    expect(enRojo(fromDb('0.00', PEN))).toBe(false);
    expect(enRojo(fromDb('0.01', PEN))).toBe(false);
    expect(format(fromDb('-120.50', PEN))).toContain('120.50');
  });
});
