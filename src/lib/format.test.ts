import { describe, expect, it } from 'vitest';
import {
  formatoFecha,
  formatoMesAño,
  formatoTasa,
  nombreDireccion,
  nombrePais,
  nombreTipoCuenta,
} from './format';

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

describe('formatoMesAño', () => {
  it('devuelve vacío con una fecha inválida, no la palabra «inválida» en la portada', () => {
    expect(formatoMesAño('no soy una fecha')).toBe('');
  });

  it('da mes y año en mayúsculas y sin el «de» del medio', () => {
    const texto = formatoMesAño('2026-11-04T10:00:00Z');
    expect(texto).toMatch(/2026/);
    expect(texto).toBe(texto.toLocaleUpperCase('es-PE'));
    expect(texto).not.toContain(' DE ');
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

describe('un día no es un instante', () => {
  /**
   * `new Date('2026-11-30')` es la medianoche UTC. Formateada en Lima —y en
   * cualquier zona detrás de UTC— caía en el 29, así que todas las fechas
   * que vienen de una columna `date` se enseñaban un día antes: el
   * vencimiento de una factura, la fecha de un movimiento, hasta cuándo vale
   * una cotización.
   */
  it('una fecha sin hora se lee en UTC, que es como se escribió', () => {
    expect(formatoFecha('2026-11-30')).toBe('30 nov. 2026');
    expect(formatoFecha('2026-01-01')).toBe('1 ene. 2026');
    // El primero de mes es donde más duele: se iba al mes anterior.
    expect(formatoMesAño('2026-03-01')).toBe('MARZO 2026');
  });

  it('un instante se lee en la zona de quien mira, que es lo que se quiere', () => {
    // Las 03:00 UTC del día 1 son todavía el 30 en Lima, y eso es correcto
    // para una hora: pasó cuando pasó.
    const texto = formatoFecha('2026-12-01T03:00:00Z');
    expect(['30 nov. 2026', '1 dic. 2026']).toContain(texto);
  });

  it('lo ilegible sigue dando una raya, no una fecha inventada', () => {
    expect(formatoFecha('mañana')).toBe('—');
    expect(formatoMesAño('mañana')).toBe('');
  });
});
