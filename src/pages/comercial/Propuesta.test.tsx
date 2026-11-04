// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
    design: {},
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

/**
 * El remedo de Supabase **guarda lo que se escribe**. Con uno que devolviera
 * siempre lo mismo, una prueba de «cambio la portada y cambia la lámina»
 * pasaría o fallaría por el motivo equivocado.
 */
const escrito: { design: Record<string, unknown>; parches: Record<string, unknown>[] } = {
  design: {},
  parches: [],
};

vi.mock('../../lib/supabase', () => {
  const tabla = (nombre: string) => {
    const api: Record<string, unknown> = {
      update: () => api,
      then: (resolver: (v: unknown) => unknown) => {
        const fila =
          nombre === 'quotes'
            ? { ...(DATOS['quotes'] as object), design: escrito.design }
            : (DATOS[nombre] ?? []);
        return Promise.resolve({ data: fila, error: null }).then(resolver);
      },
    };
    for (const metodo of ['select', 'eq', 'order', 'single', 'insert', 'limit']) {
      api[metodo] = () => api;
    }
    return api;
  };
  return {
    isConfigured: true,
    requireSupabase: () => ({
      from: (nombre: string) => tabla(nombre),
      // El guardado manda solo lo que cambió y la base lo funde; el remedo
      // hace lo mismo para que la prueba valga de algo.
      rpc: (_nombre: string, args: { p_patch: Record<string, unknown> }) => {
        escrito.parches.push(args.p_patch);
        escrito.design = { ...escrito.design, ...args.p_patch };
        return Promise.resolve({ data: escrito.design, error: null });
      },
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

afterEach(() => {
  cleanup();
  escrito.design = {};
  escrito.parches = [];
});

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

  it('cambia de verdad la portada al elegir otra variante', async () => {
    const usuario = userEvent.setup();
    await montar();
    expect(document.querySelector('.portada-completa')).toBeTruthy();

    await usuario.click(screen.getByRole('button', { name: 'Partida en dos' }));

    await waitFor(() => expect(document.querySelector('.portada-dividida')).toBeTruthy());
    expect(document.querySelector('.portada-completa')).toBeNull();
  });

  it('cambia de verdad la tipografía al elegir otra pareja', async () => {
    const usuario = userEvent.setup();
    await montar();

    await usuario.click(screen.getByRole('button', { name: 'Playfair · Lato' }));

    await waitFor(() => {
      const lienzo = document.querySelector('.lienzo') as HTMLElement | null;
      expect(lienzo?.style.getPropertyValue('--titulo')).toContain('Playfair');
    });
  });

  it('manda solo el campo que cambió, no el diseño entero', async () => {
    // El fallo de producción venía de reescribir el objeto completo desde una
    // copia vieja: lo viejo pisaba lo recién guardado. Mandando solo el campo
    // tocado, eso no puede volver a pasar venga de donde venga cada cambio.
    const usuario = userEvent.setup();
    await montar();

    await usuario.click(screen.getByRole('button', { name: 'Partida en dos' }));

    await waitFor(() => expect(escrito.parches).toHaveLength(1));
    expect(escrito.parches[0]).toEqual({ portada: 'dividida' });
  });

  it('no pierde un ajuste anterior al hacer el siguiente', async () => {
    // El fallo que vio Marcelo: cada cambio parte del diseño que tenga a mano,
    // y si ese está viejo deshace lo que se acabó de guardar.
    const usuario = userEvent.setup();
    await montar();

    await usuario.click(screen.getByRole('button', { name: 'Foto arriba' }));
    await usuario.click(screen.getByRole('button', { name: 'Inter · Inter' }));

    await waitFor(() => {
      expect(escrito.design['portada']).toBe('banda');
      expect(escrito.design['tipografia']).toBe('suiza');
    });
  });
});
