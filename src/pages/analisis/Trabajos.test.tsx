// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { OrgContext } from '../../app/org-context';
import type { ContextoOrg, Entidad, Organizacion } from '../../app/org-context';
import type { Enums } from '../../types/database';

/**
 * Lo que esta pantalla tiene que dejar claro, y lo que estas pruebas vigilan:
 *
 *  · los dos márgenes se miden sobre el mismo precio acordado, así que la
 *    diferencia entre ellos se puede enseñar en puntos;
 *  · el margen de un servicio se pondera, no se promedia;
 *  · un trabajo cancelado no se mide contra un precio que ya no va a cobrar;
 *  · un costo en otra moneda se enseña y no se suma (INV-10);
 *  · y el precio acordado no se puede editar desde aquí.
 */

const TRABAJOS: Record<string, unknown>[] = [];
const MARGENES: Record<string, unknown>[] = [];
const CLIENTES = [{ id: 'cli-1', name: 'EJ Deportes' }];
const SERVICIOS = [
  { id: 'srv-lanz', name: 'Campaña de lanzamiento' },
  { id: 'srv-redes', name: 'Gestión de redes' },
];
const llamadas: { nombre: string; args: Record<string, unknown> }[] = [];

vi.mock('../../lib/supabase', () => {
  const datosDe = (nombre: string): Record<string, unknown>[] => {
    if (nombre === 'jobs') return TRABAJOS;
    if (nombre === 'job_margins') return MARGENES;
    if (nombre === 'clients') return CLIENTES;
    if (nombre === 'services') return SERVICIOS;
    return [];
  };
  const tabla = (nombre: string) => {
    const api: Record<string, unknown> = {
      then: (r: (v: unknown) => unknown) =>
        Promise.resolve({ data: datosDe(nombre), error: null }).then(r),
    };
    for (const m of ['select', 'eq', 'in', 'order', 'limit']) api[m] = () => api;
    return api;
  };
  return {
    isConfigured: true,
    requireSupabase: () => ({
      from: (nombre: string) => tabla(nombre),
      rpc: (nombre: string, args: Record<string, unknown>) => {
        llamadas.push({ nombre, args });
        return Promise.resolve({ data: null, error: null });
      },
    }),
  };
});

const entidad = (id: string, legal_name: string): Entidad =>
  ({
    id,
    legal_name,
    organization_id: 'org-1',
    country: 'PE',
    default_currency_code: 'PEN',
    is_active: true,
    tax_id: null,
    archived_reason: null,
    address: null,
    phone: null,
    email: null,
    quote_terms: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }) as Entidad;

const trabajo = (extra: Record<string, unknown>) => ({
  id: 'j-1',
  name: 'Campaña de lanzamiento',
  client_id: 'cli-1',
  service_id: 'srv-lanz',
  quote_id: 'q-1',
  currency_code: 'PEN',
  price_net: '600.00',
  quote_net: '1000.00',
  expected_cost: '300.00',
  status: 'open',
  notes: null,
  created_at: '2026-11-01T10:00:00Z',
  ...extra,
});

const cifras = (extra: Record<string, unknown>) => ({
  job_id: 'j-1',
  currency_code: 'PEN',
  ingreso_neto: '0.00',
  costo_neto: '0.00',
  documentos: 0,
  costos: 0,
  ...extra,
});

async function montar(rol: Enums<'membership_role'> = 'owner') {
  const { default: Trabajos } = await import('./Trabajos');
  const org: ContextoOrg = {
    cargando: false,
    error: null,
    organizaciones: [],
    organizacion: {
      id: 'org-1',
      name: 'Margen Pilot',
      slug: 'margen',
      country: 'PE',
      display_currency_code: 'PEN',
      requires_plan_reconciliation: false,
      created_by: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      rol,
    } as Organizacion,
    elegirOrganizacion: vi.fn(),
    entidades: [entidad('e-1', '3 Brothers MKT SAC')],
    entidad: null,
    elegirEntidad: vi.fn(),
  };
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <MemoryRouter>
      <QueryClientProvider client={cliente}>
        <OrgContext.Provider value={org}>
          <Trabajos />
        </OrgContext.Provider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  for (const a of [TRABAJOS, MARGENES, llamadas]) a.length = 0;
});

afterEach(cleanup);

describe('Análisis · Trabajos', () => {
  it('al rol comercial le explica que el margen real no se lo enseña la base', async () => {
    await montar('commercial');
    expect(await screen.findByText('Esta sección es de finanzas')).toBeTruthy();
    expect(screen.getByText(/El margen que prometía cada propuesta sí es tuyo/)).toBeTruthy();
  });

  it('sin trabajos explica que nacen al aprobar, no a mano', async () => {
    await montar();
    expect(await screen.findByText('Todavía no hay ningún trabajo')).toBeTruthy();
    expect(screen.getByText(/se vuelve un trabajo el día que el cliente la acepta/)).toBeTruthy();
  });

  it('enseña el cotizado, el real y los puntos que se está comiendo', async () => {
    TRABAJOS.push(trabajo({}));
    MARGENES.push(cifras({ costo_neto: '420.00', ingreso_neto: '600.00', costos: 2, documentos: 1 }));
    await montar();

    await screen.findByText('Se están comiendo el margen');
    // Cotizado 50 %, real 30 %: veinte puntos.
    expect(screen.getAllByText('50 %').length).toBeGreaterThan(0);
    expect(screen.getAllByText('30 %').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/20 pts/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Estimaste S\/ 300.00 y va por S\/ 420.00/).length).toBe(1);
  });

  it('no se puede editar el precio acordado desde la pantalla', async () => {
    TRABAJOS.push(trabajo({}));
    const usuario = userEvent.setup();
    await montar();

    await usuario.click(await screen.findByRole('button', { name: 'Cambiar' }));
    expect(await screen.findByLabelText('Nombre')).toBeTruthy();
    expect(screen.getByLabelText('Estado')).toBeTruthy();
    expect(screen.queryByLabelText(/acordado/i)).toBeNull();
    expect(screen.getByText(/no se pueden cambiar desde ninguna pantalla/)).toBeTruthy();
  });

  it('cerrar un trabajo pasa por su puerta, con el estado dentro', async () => {
    TRABAJOS.push(trabajo({}));
    const usuario = userEvent.setup();
    await montar();

    await usuario.click(await screen.findByRole('button', { name: 'Cambiar' }));
    await usuario.selectOptions(await screen.findByLabelText('Estado'), 'done');
    await usuario.click(screen.getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(llamadas).toHaveLength(1));
    expect(llamadas[0]?.nombre).toBe('actualizar_trabajo');
    expect(llamadas[0]?.args).toMatchObject({ p_job: 'j-1', p_status: 'done' });
  });

  it('un cancelado se enseña sin margen y dice por qué', async () => {
    TRABAJOS.push(trabajo({ status: 'cancelled' }));
    MARGENES.push(cifras({ costo_neto: '200.00' }));
    const usuario = userEvent.setup();
    await montar();

    await usuario.click(await screen.findByRole('button', { name: 'Ver también los cerrados' }));
    expect(screen.getByText(/no se le calcula margen/)).toBeTruthy();
    // Y no aparece en «se están comiendo el margen», porque no tiene desvío.
    expect(screen.queryByText('Se están comiendo el margen')).toBeNull();
  });

  it('el margen de un servicio se pondera, no se promedia', async () => {
    TRABAJOS.push(
      trabajo({
        id: 'j-grande',
        service_id: 'srv-redes',
        price_net: '10000.00',
        quote_net: '10000.00',
        expected_cost: '5000.00',
      }),
      trabajo({
        id: 'j-chico',
        service_id: 'srv-redes',
        price_net: '1000.00',
        quote_net: '1000.00',
        expected_cost: '500.00',
      }),
    );
    MARGENES.push(
      cifras({ job_id: 'j-grande', costo_neto: '9000.00' }),
      cifras({ job_id: 'j-chico', costo_neto: '500.00' }),
    );
    await montar();

    await screen.findByText('Cuánto deja cada servicio');
    // Σutilidad / Σacordado = 1 500 / 11 000 = 13.64 %, no el 30 % del promedio.
    expect(screen.getAllByText('13.64 %').length).toBeGreaterThan(0);
    expect(screen.queryByText('30 %')).toBeNull();
  });

  it('un costo en otra moneda se enseña y no entra en el margen', async () => {
    TRABAJOS.push(trabajo({}));
    MARGENES.push(
      cifras({ ingreso_neto: '600.00', costo_neto: '200.00', costos: 1, documentos: 1 }),
      cifras({ currency_code: 'USD', costo_neto: '50.00', costos: 1 }),
    );
    await montar();

    expect(
      (await screen.findAllByText(/Además hay costos en otra moneda, sin convertir/)).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText(/US\$ 50.00 USD/).length).toBeGreaterThan(0);
  });

  it('avisa del trabajo que ya cuesta y no tiene ni una factura emitida', async () => {
    TRABAJOS.push(trabajo({}));
    MARGENES.push(cifras({ costo_neto: '200.00', costos: 1 }));
    await montar();

    expect(
      await screen.findByText(/ya cuesta S\/ 200.00 y no tiene ni una factura emitida/),
    ).toBeTruthy();
  });

  it('dice lo que todavía no sabe: cuántas horas se le fueron', async () => {
    TRABAJOS.push(trabajo({}));
    await montar();
    expect(await screen.findByText(/no sabe cuántas horas se le fueron/)).toBeTruthy();
  });
});
