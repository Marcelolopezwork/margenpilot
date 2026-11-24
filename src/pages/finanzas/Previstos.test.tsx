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
 * Lo que esta pantalla tiene que dejar claro:
 *
 *  · un previsto es un plan y no dinero, así que no toca el saldo;
 *  · lo que entra y lo que sale son dos cifras y no se restan (INV-10);
 *  · lo saldado deja de contar, porque ya está en el saldo;
 *  · y quitarlo se puede mientras no tenga movimiento, que es lo que
 *    distingue una proyección de un hecho económico.
 */

const PREVISTOS: Record<string, unknown>[] = [];
const ASIGNACIONES: Record<string, unknown>[] = [];
const MOVIMIENTOS: Record<string, unknown>[] = [];
const CUENTAS: Record<string, unknown>[] = [];
const MONEDAS = [{ currency_code: 'PEN' }, { currency_code: 'USD' }];
const llamadas: { nombre: string; args: Record<string, unknown> }[] = [];

vi.mock('../../lib/supabase', () => {
  const datosDe = (nombre: string): Record<string, unknown>[] => {
    if (nombre === 'payment_schedule_items') return PREVISTOS;
    if (nombre === 'payment_allocations') return ASIGNACIONES;
    if (nombre === 'cash_movements') return MOVIMIENTOS;
    if (nombre === 'cash_accounts') return CUENTAS;
    if (nombre === 'organization_currencies') return MONEDAS;
    return [];
  };
  const tabla = (nombre: string) => {
    const api: Record<string, unknown> = {
      then: (r: (v: unknown) => unknown) =>
        Promise.resolve({ data: datosDe(nombre), error: null }).then(r),
    };
    for (const m of ['select', 'eq', 'in', 'is', 'order', 'limit', 'not']) api[m] = () => api;
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

const previsto = (x: Record<string, unknown>) => ({
  id: 'p-1',
  label: 'Cámara pactada',
  direction: 'out',
  due_date: '2026-12-15',
  amount: '3000.00',
  currency_code: 'PEN',
  status: 'planned',
  quote_id: null,
  expected_cash_account_id: null,
  legal_entity_id: 'e-1',
  ...x,
});

async function montar(rol: Enums<'membership_role'> = 'owner') {
  const { default: Previstos } = await import('./Previstos');
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
          <Previstos />
        </OrgContext.Provider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  for (const a of [PREVISTOS, ASIGNACIONES, MOVIMIENTOS, CUENTAS, llamadas]) a.length = 0;
});

afterEach(cleanup);

describe('Finanzas · Previstos', () => {
  it('al rol comercial le explica que esto no se lo enseña la base', async () => {
    await montar('commercial');
    expect(await screen.findByText('Esta sección es de finanzas')).toBeTruthy();
  });

  it('sin nada explica qué se pierde la proyección por no tenerlo', async () => {
    await montar();
    expect(await screen.findByText('Todavía no hay nada previsto de una sola vez')).toBeTruthy();
    expect(screen.getByText(/no están en ninguna de las tres/)).toBeTruthy();
  });

  it('lo que entra y lo que sale se enseñan aparte, sin restarse', async () => {
    PREVISTOS.push(
      previsto({}),
      previsto({ id: 'p-2', label: 'Adelanto de EJ', direction: 'in', amount: '1200.00' }),
    );
    await montar();

    await screen.findByText('Cámara pactada');
    // Dos veces cada una: en el total de su dirección y en su fila.
    expect(screen.getAllByText('S/ 3,000.00')).toHaveLength(2);
    expect(screen.getAllByText('S/ 1,200.00')).toHaveLength(2);
    expect(screen.getByText(/No se restan entre sí/)).toBeTruthy();
  });

  it('anotar uno pasa por su puerta con la dirección dentro', async () => {
    const usuario = userEvent.setup();
    await montar();
    await screen.findByText('Anotar un previsto');

    await usuario.selectOptions(screen.getByLabelText('De qué empresa'), 'e-1');
    await usuario.type(screen.getByLabelText('Qué es'), 'Cámara pactada');
    await usuario.selectOptions(screen.getByLabelText('Moneda'), 'PEN');
    await usuario.type(screen.getByLabelText('Cuánto'), '3000');
    await usuario.type(screen.getByLabelText('Cuándo'), '2026-12-15');
    await usuario.click(screen.getByRole('button', { name: 'Anotar el previsto' }));

    await waitFor(() => expect(llamadas).toHaveLength(1));
    expect(llamadas[0]?.nombre).toBe('guardar_previsto');
    expect(llamadas[0]?.args).toMatchObject({
      p_entity: 'e-1',
      p_direction: 'out',
      p_label: 'Cámara pactada',
      p_amount: 3000,
      p_currency: 'PEN',
      p_due_date: '2026-12-15',
    });
  });

  it('registrar el dinero viene con lo que falta ya puesto', async () => {
    PREVISTOS.push(previsto({}));
    ASIGNACIONES.push({
      payment_schedule_item_id: 'p-1',
      amount: '1000.00',
      currency_code: 'PEN',
      cash_movement_id: 'm-1',
    });
    MOVIMIENTOS.push({ id: 'm-1', is_void: false });
    CUENTAS.push({
      id: 'cta-1',
      name: 'BCP soles',
      currency_code: 'PEN',
      legal_entity_id: 'e-1',
    });
    const usuario = userEvent.setup();
    await montar();

    // Quedan 2 000 de los 3 000, porque los 1 000 ya están en el saldo.
    expect(await screen.findByText(/S\/ 2,000.00 por pagar de los S\/ 3,000.00 previstos/)).toBeTruthy();

    await usuario.click(screen.getByRole('button', { name: 'Registrar pago' }));
    expect(await screen.findByLabelText('Cuánto pagas')).toHaveProperty('value', '2000.00');

    await usuario.selectOptions(screen.getByLabelText('De qué cuenta sale'), 'cta-1');
    await usuario.click(screen.getByRole('button', { name: 'Registrar el movimiento' }));

    await waitFor(() => expect(llamadas).toHaveLength(1));
    expect(llamadas[0]?.nombre).toBe('saldar_previsto');
    expect(llamadas[0]?.args).toMatchObject({ p_item: 'p-1', p_account: 'cta-1', p_amount: 2000 });
  });

  it('una asignación anulada no da el previsto por saldado', async () => {
    PREVISTOS.push(previsto({}));
    ASIGNACIONES.push({
      payment_schedule_item_id: 'p-1',
      amount: '3000.00',
      currency_code: 'PEN',
      cash_movement_id: 'm-1',
    });
    MOVIMIENTOS.push({ id: 'm-1', is_void: true });
    await montar();

    // Si el pago anulado contara, este previsto desaparecería de la curva y el
    // dinero que vuelve a hacer falta no aparecería en ninguna semana.
    expect(await screen.findByText(/S\/ 3,000.00 por pagar/)).toBeTruthy();
    expect(screen.queryByText('saldado')).toBeNull();
  });

  it('lo saldado se enseña sin botones y no cuenta en el total', async () => {
    PREVISTOS.push(previsto({ status: 'settled' }));
    ASIGNACIONES.push({
      payment_schedule_item_id: 'p-1',
      amount: '3000.00',
      currency_code: 'PEN',
      cash_movement_id: 'm-1',
    });
    MOVIMIENTOS.push({ id: 'm-1', is_void: false });
    await montar();

    expect(await screen.findByText('saldado')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Registrar pago' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Quitar' })).toBeNull();
    // Sin nada que proyectar, no se dibuja el bloque de totales.
    expect(screen.queryByText(/No se restan entre sí/)).toBeNull();
  });

  it('quitar uno explica por qué sí se puede borrar', async () => {
    PREVISTOS.push(previsto({}));
    const usuario = userEvent.setup();
    await montar();

    await usuario.click(await screen.findByRole('button', { name: 'Quitar' }));
    expect(screen.getByText(/todavía no es un hecho económico/)).toBeTruthy();

    await usuario.click(screen.getByRole('button', { name: 'Quitarlo' }));
    await waitFor(() => expect(llamadas).toHaveLength(1));
    expect(llamadas[0]?.nombre).toBe('quitar_previsto');
    expect(llamadas[0]?.args.p_item).toBe('p-1');
  });

  it('sin cuenta en esa moneda lo dice en vez de dejar enviar algo imposible', async () => {
    PREVISTOS.push(previsto({ currency_code: 'USD' }));
    CUENTAS.push({
      id: 'cta-1',
      name: 'BCP soles',
      currency_code: 'PEN',
      legal_entity_id: 'e-1',
    });
    const usuario = userEvent.setup();
    await montar();

    await usuario.click(await screen.findByRole('button', { name: 'Registrar pago' }));
    expect(screen.getByText(/No hay ninguna cuenta de esa empresa en USD/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Registrar el movimiento' })).toBeNull();
  });

  it('dice lo que todavía no hace', async () => {
    await montar();
    expect(await screen.findByText(/Lo que todavía no hace: repetir uno/)).toBeTruthy();
  });
});
