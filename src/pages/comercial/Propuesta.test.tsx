// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { User } from '@supabase/supabase-js';
import { SesionContext } from '../../app/session-context';
import { OrgContext } from '../../app/org-context';
import type { ContextoOrg, Entidad } from '../../app/org-context';

/**
 * Esta pantalla es la que el cliente acaba viendo impresa, y ya pasó una vez
 * que algo se rompiera en producción y Marcelo se quedara mirando un blanco.
 * Lo que se comprueba aquí es justo eso: que con datos de verdad la propuesta
 * se monta, se arman las láminas que toca, y **ningún costo** llega al papel.
 */

const FILAS = [
  {
    id: 'l-1',
    description: 'Branding',
    public_detail: null,
    public_summary: 'La marca de principio a fin.',
    quantity: 1,
    unit_price: '3200.0000',
    sort: 10,
  },
];

const DATOS: Record<string, unknown> = {
  quotes: {
    id: 'c-1',
    number: 'NL-COT-2026-0007',
    currency_code: 'PEN',
    tax_rate_pct: '18.0000',
    tax_included: true,
    tax_label: 'IGV 18 %',
    valid_until: '2026-12-04',
    notes: null,
    legal_entity_id: 'e-1',
    brand_id: null,
    client_id: 'cli-1',
    created_at: '2026-11-04T10:00:00Z',
    design: { portada: 'completa', mostrarCondiciones: true },
  },
  quote_lines: FILAS,
  quote_line_terms: [
    { id: 't-1', quote_line_id: 'l-1', kind: 'include', content: 'Naming', sort: 10 },
    { id: 't-2', quote_line_id: 'l-1', kind: 'condition', content: 'Dos rondas.', sort: 20 },
  ],
  clients: { name: 'Amotape', tax_id: '20512345678' },
  brands: [],
  org_media: [],
};

vi.mock('../../lib/supabase', () => {
  const cadena = (tabla: string) => {
    const resultado = Promise.resolve({ data: DATOS[tabla] ?? [], error: null });
    const proxy: Record<string, unknown> = new Proxy(resultado, {
      get(objetivo, prop) {
        if (prop === 'then' || prop === 'catch' || prop === 'finally') {
          return (objetivo[prop as 'then'] as (...a: unknown[]) => unknown).bind(objetivo);
        }
        return () => proxy;
      },
    }) as unknown as Record<string, unknown>;
    return proxy;
  };
  return {
    isConfigured: true,
    requireSupabase: () => ({
      from: (tabla: string) => cadena(tabla),
      storage: {
        from: () => ({ getPublicUrl: (r: string) => ({ data: { publicUrl: `/x/${r}` } }) }),
      },
    }),
  };
});

const entidad: Entidad = {
  id: 'e-1',
  legal_name: '3 Brothers MKT SAC',
  organization_id: 'org-1',
  country: 'PE',
  default_currency_code: 'PEN',
  is_active: true,
  tax_id: '20601234567',
  archived_reason: null,
  address: 'Lima, Perú',
  phone: '992 988 453',
  email: 'marcelo@ejemplo.test',
  quote_terms: 'El servicio empieza con el 50 % adelantado.',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

async function montar() {
  const { default: Propuesta } = await import('./Propuesta');

  const org: ContextoOrg = {
    cargando: false,
    error: null,
    organizaciones: [],
    organizacion: {
      id: 'org-1',
      name: 'Margen Pilot',
      slug: 'margen-pilot',
      country: 'PE',
      display_currency_code: 'PEN',
      requires_plan_reconciliation: false,
      created_by: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      rol: 'owner',
    },
    elegirOrganizacion: vi.fn(),
    entidades: [entidad],
    entidad: null,
    elegirEntidad: vi.fn(),
  };

  const sesion = {
    cargando: false,
    usuario: { id: 'u-1', email: 'marcelo@ejemplo.test' } as unknown as User,
    salir: vi.fn(async () => {}),
  };

  const cliente = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

  render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter initialEntries={['/comercial/cotizaciones/c-1/propuesta']}>
        <SesionContext.Provider value={sesion}>
          <OrgContext.Provider value={org}>
            <Routes>
              <Route path="comercial/cotizaciones/:id/propuesta" element={<Propuesta />} />
            </Routes>
          </OrgContext.Provider>
        </SesionContext.Provider>
      </MemoryRouter>
    </QueryClientProvider>,
  );

  // Las consultas resuelven en el siguiente tic. El número sale varias veces
  // —en el panel y al pie de cada lámina—, así que se espera por el título.
  await screen.findByRole('heading', { name: 'NL-COT-2026-0007', level: 1 });
}

afterEach(cleanup);

describe('la pantalla de la propuesta', () => {
  it('se monta con una cotización de verdad en vez de quedarse en blanco', async () => {
    await montar();
    expect(screen.getByRole('button', { name: 'Descargar PDF' })).toBeTruthy();
    // El cliente se consulta después de la cabecera, así que llega un tic
    // más tarde que el resto del panel.
    expect((await screen.findAllByText('Amotape')).length).toBeGreaterThan(0);
  });

  it('arma las láminas: portada, índice, portadilla, servicio, inversión, condiciones y cierre', async () => {
    await montar();
    expect(document.querySelectorAll('.lamina')).toHaveLength(7);
  });

  it('imprime el precio y el total, no el costo', async () => {
    await montar();
    const texto = document.querySelector('.propuesta')?.textContent ?? '';
    expect(texto).toContain('S/ 3,200.00');
    expect(texto).toContain('S/ 3,776.00');
    // El costo no está en ninguna consulta de esta pantalla: no hay forma de
    // que llegue al papel ni por descuido.
    expect(texto).not.toContain('quote_line_costs');
  });

  it('deja elegir la variante de portada y la tipografía', async () => {
    await montar();
    expect(screen.getByRole('button', { name: 'Partida en dos' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Bebas Neue · Lato' })).toBeTruthy();
  });
});
