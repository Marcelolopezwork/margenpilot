// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fromDb, type Money } from '../../lib/money';
import Barras from './Barras';
import type { MesDeResultado, SeriePorMes } from './resultado';

/**
 * Lo que este gráfico tiene que cumplir, y que ninguna prueba de aritmética
 * puede ver:
 *
 *  · ninguna cifra depende del color ni del ratón: hay leyenda, etiqueta
 *    hablada en cada columna y una tabla con los doce meses;
 *  · se etiquetan dos meses, no doce;
 *  · un mes sin datos no es «el peor»;
 *  · y un solo mes no se dibuja como gráfico, porque un gráfico de una barra
 *    es una cifra con adornos.
 */

const pen = (valor: string): Money => fromDb(valor, 'PEN');

const mes = (clave: string, ingresos: string, gastos: string): MesDeResultado => ({
  mes: clave,
  moneda: 'PEN',
  ingresos: pen(ingresos),
  gastos: pen(gastos),
  resultado: { minor: pen(ingresos).minor - pen(gastos).minor, currency: 'PEN' },
  hechos: Number(ingresos) + Number(gastos) > 0 ? 2 : 0,
});

const serie = (meses: MesDeResultado[]): SeriePorMes => {
  const conAlgo = meses.filter((m) => m.hechos > 0);
  let techo = pen('0.00');
  for (const m of meses) {
    if (m.ingresos.minor > techo.minor) techo = m.ingresos;
    if (m.gastos.minor > techo.minor) techo = m.gastos;
  }
  return {
    moneda: 'PEN',
    meses,
    mejor:
      conAlgo.reduce<MesDeResultado | null>(
        (a, b) => (!a || b.ingresos.minor > a.ingresos.minor ? b : a),
        null,
      ) ?? null,
    peor:
      conAlgo.reduce<MesDeResultado | null>(
        (a, b) => (!a || b.ingresos.minor < a.ingresos.minor ? b : a),
        null,
      ) ?? null,
    techo,
  };
};

const tres = serie([
  mes('2026-09', '800.00', '500.00'),
  mes('2026-10', '0.00', '0.00'),
  mes('2026-11', '4000.00', '1000.00'),
]);

afterEach(cleanup);

describe('el gráfico mes a mes', () => {
  it('tiene leyenda: la identidad no se deja al color', () => {
    render(<Barras serie={tres} />);
    // Dos veces cada una: en la leyenda y como cabecera de la tabla, que es
    // la versión que se puede leer sin ver el gráfico.
    expect(screen.getAllByText('Entró')).toHaveLength(2);
    expect(screen.getAllByText('Salió')).toHaveLength(2);
  });

  it('cada columna dice todas sus cifras con palabras', () => {
    render(<Barras serie={tres} />);
    expect(
      screen.getByRole('button', {
        name: 'nov 2026: entró S/ 4,000.00, salió S/ 1,000.00, queda S/ 3,000.00. Es el mes de más ingresos',
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', {
        name: 'oct 2026: entró S/ 0.00, salió S/ 0.00, queda S/ 0.00',
      }),
    ).toBeTruthy();
  });

  it('se etiquetan dos meses y no todos', () => {
    render(<Barras serie={tres} />);
    expect(screen.getByText('más')).toBeTruthy();
    expect(screen.getByText('menos')).toBeTruthy();
  });

  it('un mes sin un solo movimiento no es «el peor»: es un mes sin datos', () => {
    render(<Barras serie={tres} />);
    // El peor es septiembre con 800, no octubre con cero.
    expect(screen.getByText(/y el de menos,/)).toBeTruthy();
    expect(screen.getAllByText('set 2026').length).toBeGreaterThan(0);
    expect(
      screen.getByRole('button', { name: /set 2026.*Es el mes de menos ingresos/ }),
    ).toBeTruthy();
  });

  it('al enfocar una columna aparecen sus cifras, sin tener que apuntar con el ratón', async () => {
    const usuario = userEvent.setup();
    render(<Barras serie={tres} />);

    await usuario.tab();
    const estado = screen.getByRole('status');
    expect(estado.textContent).toContain('entró S/ 800.00');
    expect(estado.textContent).toContain('queda S/ 300.00');
  });

  it('la tabla está siempre, para leerlo sin ver el gráfico', () => {
    render(<Barras serie={tres} />);
    expect(screen.getByText('Ver la tabla de los 3 meses')).toBeTruthy();
    const tabla = screen.getByRole('table');
    expect(tabla.textContent).toContain('S/ 4,000.00');
    expect(tabla.textContent).toContain('S/ 1,000.00');
  });

  it('con un solo mes no dibuja un gráfico de una barra', () => {
    render(<Barras serie={serie([mes('2026-11', '4000.00', '1000.00')])} />);
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText(/Solo hay un mes con movimiento/)).toBeTruthy();
  });

  it('sin nada operativo lo dice en vez de dibujar una caja vacía', () => {
    render(<Barras serie={serie([mes('2026-11', '0.00', '0.00')])} />);
    expect(screen.getByText(/No hay ningún movimiento operativo/)).toBeTruthy();
  });

  it('enseña el tope, que es la escala contra la que se leen las barras', () => {
    render(<Barras serie={tres} />);
    expect(screen.getByText(/tope S\/ 4,000.00/)).toBeTruthy();
  });
});
