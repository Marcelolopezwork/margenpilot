import { describe, expect, it } from 'vitest';
import { formatoFecha, formatoTasa, nombreDireccion, nombrePais, nombreTipoCuenta } from './format';

describe('formatoTasa', () => {
  it('muestra el IGV sin decimales de adorno', () => {
    expect(formatoTasa(18)).toBe('18 %');
  });

  it('muestra el 0 % de la entidad americana', () => {
    expect(formatoTasa(0)).toBe('0 %');
  });

  it('conserva los decimales que existen', () => {
    expect(formatoTasa(4.5)).toBe('4.5 %');
  });

  it('acepta el texto que manda Postgres, que es lo que llega de verdad', () => {
    // PostgREST entrega `numeric` entrecomillado aunque los tipos digan number.
    expect(formatoTasa('18.0000')).toBe('18 %');
    expect(formatoTasa('0.0000')).toBe('0 %');
    expect(formatoTasa('4.5000')).toBe('4.5 %');
  });

  it('no inventa una cifra si llega basura', () => {
    expect(formatoTasa('no soy un número')).toBe('—');
  });
});

describe('formatoFecha', () => {
  it('no revienta con una fecha inválida', () => {
    expect(formatoFecha('no soy una fecha')).toBe('—');
  });

  it('formatea una fecha ISO', () => {
    // Sin afirmar el texto exacto: depende de los datos de locale del entorno.
    expect(formatoFecha('2026-11-02T10:00:00Z')).toMatch(/2026/);
  });
});

describe('nombres de catálogo', () => {
  it('traduce los países que usamos', () => {
    expect(nombrePais('PE')).toBe('Perú');
    expect(nombrePais('US')).toBe('Estados Unidos');
  });

  it('devuelve el código cuando no conoce el país', () => {
    expect(nombrePais('XX')).toBe('XX');
  });

  it('traduce los tipos de cuenta del enum', () => {
    expect(nombreTipoCuenta('bank')).toBe('Banco');
    expect(nombreTipoCuenta('wallet')).toBe('Billetera');
  });

  it('traduce las direcciones de categoría', () => {
    expect(nombreDireccion('in')).toBe('Ingreso');
    expect(nombreDireccion('out')).toBe('Gasto');
    expect(nombreDireccion('both')).toBe('Ambos');
  });
});
