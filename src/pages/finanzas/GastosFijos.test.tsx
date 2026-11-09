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
 * Lo que esta pantalla tiene que dejar claro es que un gasto fijo **no mueve
 * dinero**: es una regla que alimenta la proyección. Y lo que tiene que
 * calcular bien es cuánto sale de verdad en las próximas trece semanas, que no
 * es un promedio mensual.
 */

const GASTOS: Record<string, unknown>[] = [];
const MOVIMIENTOS: Record<string, unknown>[] = [];
const CUENTAS: Record<string, unknown>[] = [];
const COSTOS: Record<string, unknown>[] = [];
const llamadas: { nombre: string; args: Record<string, unknown> }[] = [];

vi.mock('../../lib/supabase', () => {
  const datosDe = (nombre: string): Record<string, unknown>[] => {
    if (nombre === 'recurring_expenses') return GASTOS;
    if (nombre === 'cash_movements') return MOVIMIENTOS;
    if (nombre === 'cash_accounts') return CUENTAS;
    if (nombre === 'cost_items') return COSTOS;
    return [];
  };
  const tabla = (nombre: string) => {
    const api: Record<string, unknown> = {
      then: (r: (v: unknown) => unknown) =>
        Promise.resolve({ data: datosDe(nombre), error: null }).then(r),
    };
    for (const m of ['select', 'eq', 'in', 'order', 'limit', 'not']) api[m] = () => api;
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
    id, legal_name, organization_id: 'org-1', country: 'PE',
    default_currency_code: 'PEN', is_active: true, tax_id: null, archived_reason: null,
    address: null, phone: null, email: null, quote_terms: null,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  }) as Entidad;

async function montar(rol: Enums<'membership_role'> = 'owner') {
  const { default: GastosFijos } = await import('./GastosFijos');
  const org: ContextoOrg = {
    cargando: false, error: null, organizaciones: [],
    organizacion: {
      id: 'org-1', name: 'Margen Pilot', slug: 'margen', country: 'PE',
      display_currency_code: 'PEN', requires_plan_reconciliation: false, created_by: null,
      created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', rol,
    } as Organizacion,
    elegirOrganizacion: vi.fn(),
    entidades: [entidad('e-1', '3 Brothers MKT SAC'), entidad('e-2', 'The Publisher')],
    entidad: null,
    elegirEntidad: vi.fn(),
  };
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <MemoryRouter>
      <QueryClientProvider client={cliente}>
        <OrgContext.Provider value={org}>
          <GastosFijos />
        </OrgContext.Provider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const gasto = (extra: Record<string, unknown>) => ({
  id: 'g-1',
  label: 'Claude Code',
  amount: '200.00',
  currency_code: 'USD',
  cadence: 'monthly',
  day_of_month: 5,
  starts_on: '2026-11-05',
  ends_on: null,
  is_active: true,
  cash_account_id: null,
  legal_entity_id: 'e-2',
  cost_item_id: null,
  notes: null,
  created_at: '2026-11-01T00:00:00Z',
  ...extra,
});

beforeEach(() => {
  vi.setSystemTime(new Date('2026-11-09T12:00:00Z'));
  for (const a of [GASTOS, MOVIMIENTOS, CUENTAS, COSTOS, llamadas]) a.length = 0;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Gastos fijos', () => {
  it('al rol comercial le dice que no son suyos', async () => {
    await montar('commercial');
    expect(await screen.findByText('Esta sección es de finanzas')).toBeTruthy();
  });

  it('el estado vacío explica qué se rompe si no los cargas', async () => {
    await montar();
    expect(await screen.findByText('Todavía no hay ningún gasto fijo')).toBeTruthy();
    expect(screen.getByText(/solo tiene entradas y dice que vas a tener más dinero/)).toBeTruthy();
  });

  it('enseña la cadencia y cuándo toca el próximo', async () => {
    GASTOS.push(gasto({}));
    await montar();
    expect(await screen.findByText('Claude Code')).toBeTruthy();
    // Dos veces: la etiqueta de la fila y la opción del desplegable.
    expect(screen.getAllByText('cada mes').length).toBeGreaterThan(0);
    expect(screen.getByText(/el próximo el/)).toBeTruthy();
    expect(screen.getByText('US$ 200.00')).toBeTruthy();
  });

  /**
   * Trece semanas de un gasto mensual son tres pagos, no «200 al mes». Un
   * gasto anual dividido entre doce daría una cifra que no sale ningún mes.
   */
  it('el total son los pagos exactos de las trece semanas, no un promedio', async () => {
    GASTOS.push(gasto({}));
    await montar();
    await screen.findByText('Claude Code');
    expect(screen.getByText('US$ 600.00')).toBeTruthy();
    expect(screen.getByText('3 pagos')).toBeTruthy();
    expect(screen.getByText(/no un promedio\s+mensual/)).toBeTruthy();
  });

  it('un gasto archivado se ve, no desaparece', async () => {
    GASTOS.push(gasto({ is_active: false, ends_on: '2026-10-31' }));
    await montar();
    await screen.findByText('Claude Code');
    expect(screen.getByText('archivado')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reactivar' })).toBeTruthy();
  });

  it('elegir una ficha del catálogo rellena el nombre, el importe y la moneda', async () => {
    const usuario = userEvent.setup();
    COSTOS.push({
      id: 'c-1', name: 'TLDV · grabador de llamadas', unit: 'mes', unit_cost: '29.0000',
      currency_code: 'USD', kind: 'tool', legal_entity_id: null,
    });
    await montar();
    await screen.findByText('Todavía no hay ningún gasto fijo');

    await usuario.selectOptions(screen.getByLabelText('Empresa que lo paga'), 'e-2');
    await usuario.selectOptions(screen.getByLabelText(/¿Ya está en el catálogo/), 'c-1');

    expect((screen.getByLabelText('Concepto') as HTMLInputElement).value).toBe(
      'TLDV · grabador de llamadas',
    );
    expect((screen.getByLabelText('Importe') as HTMLInputElement).value).toBe('29.00');
    expect((screen.getByLabelText('Moneda') as HTMLSelectElement).value).toBe('USD');
  });

  it('al guardar manda la empresa, la cadencia y nada de dinero movido', async () => {
    const usuario = userEvent.setup();
    await montar();
    await screen.findByText('Todavía no hay ningún gasto fijo');

    await usuario.selectOptions(screen.getByLabelText('Empresa que lo paga'), 'e-2');
    await usuario.type(screen.getByLabelText('Concepto'), 'ChatGPT');
    await usuario.selectOptions(screen.getByLabelText('Moneda'), 'USD');
    await usuario.type(screen.getByLabelText('Importe'), '20');
    await usuario.type(screen.getByLabelText('Día del mes'), '1');
    await usuario.click(screen.getByRole('button', { name: 'Añadir gasto fijo' }));

    await waitFor(() => expect(llamadas).toHaveLength(1));
    expect(llamadas[0]?.nombre).toBe('guardar_gasto_recurrente');
    expect(llamadas[0]?.args).toMatchObject({
      p_entity: 'e-2',
      p_label: 'ChatGPT',
      p_amount: 20,
      p_currency: 'USD',
      p_cadence: 'monthly',
      p_day: 1,
    });
    expect(await screen.findByText(/No ha movido ningún saldo: es una regla, no un pago/)).toBeTruthy();
  });

  it('editando, la empresa y la moneda quedan bloqueadas', async () => {
    const usuario = userEvent.setup();
    GASTOS.push(gasto({}));
    await montar();
    await screen.findByText('Claude Code');

    await usuario.click(screen.getByRole('button', { name: 'Editar' }));

    expect((screen.getByLabelText('Concepto') as HTMLInputElement).value).toBe('Claude Code');
    expect((screen.getByLabelText('Empresa que lo paga') as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText('Moneda') as HTMLSelectElement).disabled).toBe(true);
  });
});
