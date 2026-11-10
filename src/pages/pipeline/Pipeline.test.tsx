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
 * Lo que este tablero tiene que cumplir:
 *
 *  · la cifra de arriba es lo que está **en juego**: ni los borradores, que el
 *    cliente no ha visto, ni las aprobadas, que ya se ganaron;
 *  · una cotización sin emitir no aporta cifra, y lo dice en vez de enseñar
 *    un cero que parecería un total;
 *  · señala lo que lleva días sin moverse, que es la única cosa que una lista
 *    ordenada por fecha no puede enseñar;
 *  · y mover una tarjeta pasa por la puerta de la base, nunca por un `update`.
 */

const COTIZACIONES: Record<string, unknown>[] = [];
const CLIENTES: Record<string, unknown>[] = [{ id: 'cli-1', name: 'EJ Deportes' }];
const VERSIONES: Record<string, unknown>[] = [];
const COSTOS: Record<string, unknown>[] = [];
const EVENTOS: Record<string, unknown>[] = [];
const llamadas: { nombre: string; args: Record<string, unknown> }[] = [];
const tablasPedidas: string[] = [];

vi.mock('../../lib/supabase', () => {
  const datosDe = (nombre: string): Record<string, unknown>[] => {
    if (nombre === 'quotes') return COTIZACIONES;
    if (nombre === 'clients') return CLIENTES;
    if (nombre === 'quote_versions') return VERSIONES;
    if (nombre === 'quote_version_costs') return COSTOS;
    if (nombre === 'quote_events') return EVENTOS;
    return [];
  };
  const tabla = (nombre: string) => {
    tablasPedidas.push(nombre);
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
  const { default: Pipeline } = await import('./Pipeline');
  const org: ContextoOrg = {
    cargando: false, error: null, organizaciones: [],
    organizacion: {
      id: 'org-1', name: 'Margen Pilot', slug: 'margen', country: 'PE',
      display_currency_code: 'PEN', requires_plan_reconciliation: false, created_by: null,
      created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', rol,
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
          <Pipeline />
        </OrgContext.Provider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const cotizacion = (extra: Record<string, unknown>) => ({
  id: 'q-1',
  number: 'COT-001',
  status: 'sent',
  currency_code: 'PEN',
  valid_until: null,
  created_at: '2026-11-09T10:00:00Z',
  client_id: 'cli-1',
  legal_entity_id: 'e-1',
  ...extra,
});

const version = (quote_id: string, neto: string, extra: Record<string, unknown> = {}) => ({
  id: `v-${quote_id}`,
  quote_id,
  version_no: 1,
  totals: { neto, moneda: 'PEN' },
  ...extra,
});

beforeEach(() => {
  COTIZACIONES.length = 0;
  VERSIONES.length = 0;
  COSTOS.length = 0;
  EVENTOS.length = 0;
  llamadas.length = 0;
  tablasPedidas.length = 0;
});
afterEach(cleanup);

describe('Pipeline · el tablero de lo que está en juego', () => {
  it('sin cotizaciones explica qué repartiría y manda a crear la primera', async () => {
    await montar();
    expect(await screen.findByText('Todavía no hay ninguna cotización')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ir a Comercial' })).toBeTruthy();
  });

  it('la cifra en juego deja fuera los borradores y las aprobadas', async () => {
    COTIZACIONES.push(
      cotizacion({ id: 'q-1', number: 'COT-001', status: 'sent' }),
      cotizacion({ id: 'q-2', number: 'COT-002', status: 'draft' }),
      cotizacion({ id: 'q-3', number: 'COT-003', status: 'approved' }),
    );
    VERSIONES.push(
      version('q-1', '10000.00'),
      version('q-3', '7000.00'),
    );
    await montar();

    expect(await screen.findByText('Lo que está en juego')).toBeTruthy();
    // Los 10.000 de la enviada, y no los 7.000 de la aprobada.
    expect(screen.getAllByText('S/ 10,000.00').length).toBeGreaterThan(0);
    expect(screen.getByText(/sin las aprobadas, que ya no están/)).toBeTruthy();
    expect(screen.getByText('1 cotización')).toBeTruthy();
  });

  it('una cotización sin emitir lo dice en vez de enseñar un cero', async () => {
    COTIZACIONES.push(cotizacion({ id: 'q-2', number: 'COT-002', status: 'draft' }));
    await montar();
    expect(await screen.findByText('Sin emitir: no hay cifra todavía')).toBeTruthy();
  });

  it('señala la que lleva semanas sin moverse, con sus días', async () => {
    COTIZACIONES.push(cotizacion({ created_at: '2026-01-01T00:00:00Z' }));
    VERSIONES.push(version('q-1', '10000.00'));
    await montar();

    expect(await screen.findByText(/llevan más de dos semanas sin moverse|lleva más de dos semanas sin moverse/)).toBeTruthy();
    expect(screen.getByText('Nadie la ha tocado en más de dos semanas.')).toBeTruthy();
    expect(screen.getByText(/Quieta \d+ días/)).toBeTruthy();
  });

  it('el último movimiento sale de la bitácora, no de la fecha de creación', async () => {
    COTIZACIONES.push(cotizacion({ created_at: '2026-01-01T00:00:00Z' }));
    VERSIONES.push(version('q-1', '10000.00'));
    EVENTOS.push({ quote_id: 'q-1', at: new Date().toISOString() });
    await montar();

    expect(await screen.findByText('Se movió hoy')).toBeTruthy();
    expect(screen.queryByText('Nadie la ha tocado en más de dos semanas.')).toBeNull();
  });

  it('una que pasó su plazo y sigue abierta se dice, porque «vencida» la decide una persona', async () => {
    COTIZACIONES.push(cotizacion({ valid_until: '2026-01-15' }));
    VERSIONES.push(version('q-1', '10000.00'));
    EVENTOS.push({ quote_id: 'q-1', at: new Date().toISOString() });
    await montar();

    expect(await screen.findByText('Su plazo ya pasó y sigue abierta.')).toBeTruthy();
    expect(screen.getByText(/«vencida» es una decisión tuya/)).toBeTruthy();
  });

  it('mover una tarjeta pasa por la puerta de la base', async () => {
    COTIZACIONES.push(cotizacion({}));
    VERSIONES.push(version('q-1', '10000.00'));
    const usuario = userEvent.setup();
    await montar();
    await screen.findByText('COT-001');

    await usuario.selectOptions(screen.getByLabelText('Mover COT-001 a'), 'negotiation');
    await usuario.click(screen.getByRole('button', { name: 'Mover a En negociación' }));

    await waitFor(() => expect(llamadas).toHaveLength(1));
    expect(llamadas[0]?.nombre).toBe('cambiar_estado_cotizacion');
    expect(llamadas[0]?.args.p_quote).toBe('q-1');
    expect(llamadas[0]?.args.p_to).toBe('negotiation');
  });

  it('aprobar avisa de que crea el cronograma de cobro', async () => {
    COTIZACIONES.push(cotizacion({}));
    VERSIONES.push(version('q-1', '10000.00'));
    const usuario = userEvent.setup();
    await montar();
    await screen.findByText('COT-001');

    await usuario.selectOptions(screen.getByLabelText('Mover COT-001 a'), 'approved');
    expect(screen.getByText(/crea el cronograma de cobro/)).toBeTruthy();
  });

  it('anular exige motivo antes de dejar mover, y lo manda en la nota', async () => {
    COTIZACIONES.push(cotizacion({}));
    VERSIONES.push(version('q-1', '10000.00'));
    const usuario = userEvent.setup();
    await montar();
    await screen.findByText('COT-001');

    await usuario.selectOptions(screen.getByLabelText('Mover COT-001 a'), 'void');
    const boton = screen.getByRole('button', { name: 'Mover a Anulada' });
    expect(boton).toHaveProperty('disabled', true);

    await usuario.type(screen.getByLabelText('Por qué se anula COT-001'), 'El cliente desapareció');
    await usuario.click(screen.getByRole('button', { name: 'Mover a Anulada' }));

    await waitFor(() => expect(llamadas).toHaveLength(1));
    expect(llamadas[0]?.args.p_to).toBe('void');
    expect(llamadas[0]?.args.p_note).toBe('El cliente desapareció');
  });

  it('a «Enviada» no se llega moviendo una tarjeta, y el borrador solo ofrece anularse', async () => {
    COTIZACIONES.push(cotizacion({ status: 'draft' }));
    await montar();
    await screen.findByText('COT-001');

    const opciones = [...screen.getByLabelText('Mover COT-001 a').querySelectorAll('option')].map(
      (o) => o.textContent,
    );
    expect(opciones).toEqual(['Dejarla donde está', 'Anulada']);
    expect(screen.getByText(/se llega emitiendo/)).toBeTruthy();
  });

  it('las cerradas no están hasta que se piden', async () => {
    COTIZACIONES.push(
      cotizacion({ id: 'q-1', number: 'COT-001', status: 'sent' }),
      cotizacion({ id: 'q-9', number: 'COT-009', status: 'rejected' }),
    );
    const usuario = userEvent.setup();
    await montar();
    await screen.findByText('COT-001');

    expect(screen.queryByText('COT-009')).toBeNull();
    await usuario.click(screen.getByLabelText(/Ver también las cerradas/));
    expect(await screen.findByText('COT-009')).toBeTruthy();
  });

  it('al rol comercial no le pide los costos: con el join devolvería cero filas', async () => {
    COTIZACIONES.push(cotizacion({}));
    VERSIONES.push(version('q-1', '10000.00'));
    COSTOS.push({ quote_version_id: 'v-q-1', cost: '4000.00' });
    await montar('commercial');
    await screen.findByText('COT-001');

    expect(tablasPedidas).not.toContain('quote_version_costs');
    expect(screen.queryByText(/margen/)).toBeNull();
  });

  it('con costos, la tarjeta enseña el margen de la versión emitida', async () => {
    COTIZACIONES.push(cotizacion({}));
    VERSIONES.push(version('q-1', '10000.00'));
    COSTOS.push({ quote_version_id: 'v-q-1', cost: '4000.00' });
    await montar();
    await screen.findByText('COT-001');

    expect(screen.getByText(/margen 60.0 %/)).toBeTruthy();
  });
});
