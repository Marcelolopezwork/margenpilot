// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { OrgContext } from '../../app/org-context';
import type { ContextoOrg, Entidad, Organizacion } from '../../app/org-context';
import type { Enums } from '../../types/database';
import { rangoDe } from './resultado';

/**
 * Lo que esta pantalla tiene que cumplir:
 *
 *  · cuenta cada hecho una sola vez, porque la regla de qué entra vive en la
 *    vista `economic_facts` y no en un `where` de aquí (INV-6);
 *  · no suma monedas distintas (INV-10);
 *  · y lo que no es del negocio —un retiro del dueño— se ve, pero no se resta
 *    del resultado.
 */

const HECHOS: Record<string, unknown>[] = [];
const CLIENTES = [{ id: 'cli-1', name: 'EJ Deportes' }];
const CATEGORIAS = [{ id: 'cat-1', name: 'Herramientas' }];
const consultas: { tabla: string; filtros: [string, unknown][] }[] = [];

vi.mock('../../lib/supabase', () => {
  const datosDe = (nombre: string): Record<string, unknown>[] => {
    if (nombre === 'economic_facts') return HECHOS;
    if (nombre === 'clients') return CLIENTES;
    if (nombre === 'financial_categories') return CATEGORIAS;
    return [];
  };
  const tabla = (nombre: string) => {
    const registro: { tabla: string; filtros: [string, unknown][] } = { tabla: nombre, filtros: [] };
    consultas.push(registro);
    const api: Record<string, unknown> = {
      then: (r: (v: unknown) => unknown) =>
        Promise.resolve({ data: datosDe(nombre), error: null }).then(r),
    };
    for (const m of ['select', 'eq', 'in', 'order', 'limit', 'gte', 'lte']) {
      api[m] = (a: string, b: unknown) => {
        registro.filtros.push([`${m}:${a}`, b]);
        return api;
      };
    }
    return api;
  };
  return {
    isConfigured: true,
    requireSupabase: () => ({ from: (nombre: string) => tabla(nombre) }),
  };
});

const entidad = (id: string, legal_name: string, moneda: string): Entidad =>
  ({
    id,
    legal_name,
    organization_id: 'org-1',
    country: 'PE',
    default_currency_code: moneda,
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

const hecho = (h: Record<string, unknown>) => ({
  origen: 'movimiento',
  fecha: '2026-11-05',
  direction: 'out',
  flow_class: 'operating',
  kind: 'operating',
  currency_code: 'PEN',
  amount_total: '100.00',
  amount_net: '100.00',
  amount_tax: '0.00',
  category_id: null,
  client_id: null,
  concepto: 'Algo',
  ...h,
});

async function montar(rol: Enums<'membership_role'> = 'owner') {
  const { default: Analisis } = await import('./Analisis');
  const org: ContextoOrg = {
    cargando: false,
    error: null,
    organizaciones: [],
    organizacion: {
      id: 'org-1',
      name: 'Grupo de prueba',
      slug: 'grupo',
      country: 'PE',
      display_currency_code: 'PEN',
      requires_plan_reconciliation: false,
      created_by: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      rol,
    } as Organizacion,
    elegirOrganizacion: vi.fn(),
    entidades: [entidad('e-1', '3 Brothers MKT SAC', 'PEN'), entidad('e-2', 'The Publisher', 'USD')],
    entidad: null,
    elegirEntidad: vi.fn(),
  };
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <MemoryRouter>
      <QueryClientProvider client={cliente}>
        <OrgContext.Provider value={org}>
          <Analisis />
        </OrgContext.Provider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  HECHOS.length = 0;
  consultas.length = 0;
});

afterEach(cleanup);

describe('Análisis · el lente Resultado', () => {
  it('al rol comercial le explica que la base no se lo enseña', async () => {
    await montar('commercial');
    expect(await screen.findByText('Esta sección es de finanzas')).toBeTruthy();
    expect(screen.getByText(/El margen de cada cotización sí es tuyo/)).toBeTruthy();
  });

  it('el resultado es el neto que entra menos el que sale, con su margen', async () => {
    HECHOS.push(
      hecho({ origen: 'documento', direction: 'in', client_id: 'cli-1', amount_total: '11800.00', amount_net: '10000.00', amount_tax: '1800.00', concepto: 'F001-1' }),
      hecho({ direction: 'out', category_id: 'cat-1', amount_total: '1180.00', amount_net: '1000.00', amount_tax: '180.00', concepto: 'Claude Code' }),
    );
    await montar();
    await screen.findByText('Ingresos · PEN');

    // Los ingresos salen dos veces: la cifra de arriba y la fila del cliente
    // del que vinieron.
    expect(screen.getAllByText('S/ 10,000.00')).toHaveLength(2);
    expect(screen.getAllByText('S/ 1,000.00')).toHaveLength(2);
    expect(screen.getByText('S/ 9,000.00')).toBeTruthy();
    expect(screen.getByText(/margen del 90.0 %/)).toBeTruthy();
    // El IGV cobrado y el pagado se dicen, y se dice que no son resultado.
    expect(screen.getByText(/IGV cobrado S\/ 1,800.00 y pagado S\/ 180.00/)).toBeTruthy();
    // Y el desglose: de qué cliente vino y en qué se fue.
    expect(screen.getByText('EJ Deportes')).toBeTruthy();
    expect(screen.getByText('Herramientas')).toBeTruthy();
  });

  it('dos monedas son dos tarjetas y dice por qué no las suma', async () => {
    HECHOS.push(
      hecho({ direction: 'in', currency_code: 'PEN', amount_net: '1000.00' }),
      hecho({ direction: 'in', currency_code: 'USD', amount_net: '500.00' }),
    );
    await montar();
    await screen.findByText('Ingresos · PEN');

    expect(screen.getByText('Ingresos · USD')).toBeTruthy();
    expect(screen.getByText(/Un total único exigiría un tipo de cambio/)).toBeTruthy();
  });

  it('un retiro del dueño se ve, pero no se resta del resultado', async () => {
    HECHOS.push(
      hecho({ direction: 'in', amount_total: '5000.00', amount_net: '5000.00' }),
      hecho({ direction: 'out', flow_class: 'non_operating', kind: 'owner_draw', amount_total: '2000.00', amount_net: '2000.00', concepto: 'Retiro de noviembre' }),
    );
    await montar();
    await screen.findByText('Ingresos · PEN');

    // Ingresos y resultado valen lo mismo, y los gastos son cero: el retiro
    // no es un gasto del negocio.
    expect(screen.getAllByText('S/ 5,000.00').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('S/ 0.00')).toBeTruthy();
    expect(screen.getByText(/Fuera del resultado hay -S\/ 2,000.00/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Fuera del resultado' })).toBeTruthy();
    expect(screen.getByText('Retiro de noviembre')).toBeTruthy();
    expect(screen.getByText('Retiro del dueño')).toBeTruthy();
    expect(screen.getByText(/−S\/ 2,000.00/)).toBeTruthy();
  });

  it('sin nada en el periodo lo dice, y dice qué no entra nunca', async () => {
    await montar();
    expect(await screen.findByText(/No hay nada en los últimos doce meses/)).toBeTruthy();
    expect(screen.getByText(/Las transferencias entre tus cuentas y los saldos de apertura/)).toBeTruthy();
  });

  it('el periodo se pide a la base como rango de fechas, no se filtra aquí', async () => {
    const usuario = userEvent.setup();
    const hoy = new Date().toISOString().slice(0, 10);
    await montar();
    await screen.findByLabelText('Periodo');

    const doce = rangoDe('doce-meses', hoy);
    const primera = consultas.find((c) => c.tabla === 'economic_facts');
    expect(primera?.filtros).toContainEqual(['gte:fecha', doce.desde]);
    expect(primera?.filtros).toContainEqual(['lte:fecha', doce.hasta]);

    await usuario.selectOptions(screen.getByLabelText('Periodo'), 'mes');
    const mes = rangoDe('mes', hoy);
    const ultima = consultas.filter((c) => c.tabla === 'economic_facts').at(-1);
    expect(ultima?.filtros).toContainEqual(['gte:fecha', mes.desde]);
  });
});
