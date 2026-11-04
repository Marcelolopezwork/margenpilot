// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

/**
 * Reimprimir la v1 tiene que dar la v1.
 *
 * Esta pantalla no consulta la cotización: dibuja la copia. La prueba monta
 * una versión cuyo snapshot dice cosas distintas de las que diría el catálogo
 * de hoy —otro precio, otra portada, otra tipografía— y comprueba que es el
 * snapshot el que manda. Es la deuda que las versiones pagan, y la única
 * manera de saber que está pagada.
 */

const FILA = {
  id: 'v-1',
  version_no: 1,
  issued_at: '2026-11-04T12:00:00Z',
  snapshot_sha256: 'f75ebe77f3f9aa11bb22cc33dd44ee55ff66aa77bb88cc99dd00ee11ff223344',
  totals: { moneda: 'PEN', decimales: 2, neto: '3200.00', impuesto: '576.00', total: '3776.00' },
  snapshot: {
    cotizacion: {
      numero: 'NL-COT-2026-0007',
      moneda: 'PEN',
      tasa_impuesto: '18.0000',
      impuesto_aplicado: true,
      etiqueta_impuesto: 'IGV 18 %',
      valida_hasta: '2026-12-04',
      notas: null,
      creada_el: '2026-11-04T10:00:00Z',
    },
    empresa: {
      razon_social: '3 Brothers MKT SAC',
      tax_id: '20601234567',
      pais: 'PE',
      direccion: 'Lima, Perú',
      telefono: '992 988 453',
      email: 'marcelo@ejemplo.test',
      condiciones: 'El servicio empieza con el 50 % adelantado.',
    },
    marca: {
      nombre: 'Nlima',
      logo: 'org/logo.png',
      color: '#2760d3',
      color_secundario: '#a50321',
      foto: 'org/portada.jpg',
    },
    cliente: { nombre: 'Amotape', tax_id: '20512345678', email: null },
    lineas: [
      {
        id: 'l-1',
        orden: 10,
        descripcion: 'Branding',
        resumen: 'La marca de principio a fin.',
        detalle: null,
        cantidad: '1.0000',
        precio_unitario: '3200.00',
        neto: '3200.00',
        entregables: [
          { tipo: 'include', texto: 'Naming', orden: 10 },
          { tipo: 'condition', texto: 'Dos rondas por entregable.', orden: 20 },
        ],
      },
    ],
    // Lo que se eligió el día que salió, no lo que diga hoy la pantalla.
    diseno: { portada: 'dividida', tipografia: 'editorial', tema: 'oscuro' },
  },
};

vi.mock('../../lib/supabase', () => {
  const api: Record<string, unknown> = {
    then: (resolver: (v: unknown) => unknown) =>
      Promise.resolve({ data: FILA, error: null }).then(resolver),
  };
  for (const metodo of ['select', 'eq', 'single']) api[metodo] = () => api;
  return {
    isConfigured: true,
    requireSupabase: () => ({
      from: () => api,
      storage: {
        from: () => ({ getPublicUrl: (r: string) => ({ data: { publicUrl: `/x/${r}` } }) }),
      },
    }),
  };
});

async function montar() {
  const { default: PropuestaEmitida } = await import('./PropuestaEmitida');
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter initialEntries={['/comercial/cotizaciones/c-1/propuesta/v/1']}>
        <Routes>
          <Route
            path="comercial/cotizaciones/:id/propuesta/v/:version"
            element={<PropuestaEmitida />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByText('Versión 1');
}

afterEach(cleanup);

describe('la propuesta de una versión emitida', () => {
  it('arma las láminas de la copia', async () => {
    await montar();
    // Portada, índice, portadilla, servicio, inversión, condiciones y cierre.
    expect(document.querySelectorAll('.lamina')).toHaveLength(7);
    const texto = document.querySelector('.propuesta')?.textContent ?? '';
    expect(texto).toContain('Amotape');
    expect(texto).toContain('S/ 3,200.00');
    expect(texto).toContain('S/ 3,776.00');
  });

  it('respeta el diseño con el que salió, no el de hoy', async () => {
    await montar();
    // Portada partida en dos, Playfair y fondo oscuro: los tres venían en el
    // snapshot, y ninguno es el valor de serie.
    expect(document.querySelector('.portada-dividida')).toBeTruthy();
    expect(document.querySelector('.portada-completa')).toBeNull();
    const lienzo = document.querySelector('.lienzo') as HTMLElement | null;
    expect(lienzo?.style.getPropertyValue('--titulo')).toContain('Playfair');
    expect(lienzo?.dataset['tema']).toBe('oscuro');
    // El color de la marca viaja en la copia: si mañana se repinta la marca,
    // esta versión sigue saliendo azul.
    expect(lienzo?.style.getPropertyValue('--primario')).toBe('#2760d3');
  });

  it('no ofrece nada que editar', async () => {
    await montar();
    // El único botón es imprimir. Una versión emitida no se retoca.
    const botones = Array.from(document.querySelectorAll('button')).map((b) => b.textContent);
    expect(botones).toEqual(['Descargar PDF']);
    expect(screen.getByText(/No se edita/)).toBeTruthy();
  });

  it('enseña la huella del contenido', async () => {
    await montar();
    expect(screen.getByText(FILA.snapshot_sha256)).toBeTruthy();
  });

  it('no imprime ni un costo', async () => {
    await montar();
    const texto = document.querySelector('.propuesta')?.textContent ?? '';
    expect(texto).not.toMatch(/costo|margen|markup/i);
  });
});
