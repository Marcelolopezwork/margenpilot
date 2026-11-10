// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { OrgContext } from '../app/org-context';
import type { ContextoOrg, Entidad, Organizacion } from '../app/org-context';
import type { Enums } from '../types/database';

/**
 * Inicio tiene que contestar tres preguntas en orden —cuánto tengo, quién me
 * debe, qué hago hoy— sin cometer el error que arruinaría las tres: sumar dos
 * monedas, o enseñar como caja algo que todavía no ha entrado.
 */

const CUENTAS: Record<string, unknown>[] = [];
const SALDOS: Record<string, unknown>[] = [];
const DOCUMENTOS: Record<string, unknown>[] = [];
const ASIGNACIONES: Record<string, unknown>[] = [];
const MOVIMIENTOS: Record<string, unknown>[] = [];
const CUOTAS: Record<string, unknown>[] = [];
const TASAS: Record<string, unknown>[] = [];
const GASTOS: Record<string, unknown>[] = [];
const ENTIDADES: Record<string, unknown>[] = [{ id: 'e-1' }];
const MONEDAS: Record<string, unknown>[] = [{ currency_code: 'PEN' }];
const MARCAS: Record<string, unknown>[] = [{ id: 'm-1' }];

vi.mock('../lib/supabase', () => {
  const datosDe = (nombre: string): Record<string, unknown>[] => {
    if (nombre === 'cash_accounts') return CUENTAS;
    if (nombre === 'account_balances') return SALDOS;
    if (nombre === 'billing_documents') return DOCUMENTOS;
    if (nombre === 'payment_allocations') return ASIGNACIONES;
    if (nombre === 'cash_movements') return MOVIMIENTOS;
    if (nombre === 'payment_schedule_items') return CUOTAS;
    if (nombre === 'fx_rates') return TASAS;
    if (nombre === 'recurring_expenses') return GASTOS;
    if (nombre === 'legal_entities') return ENTIDADES;
    if (nombre === 'organization_currencies') return MONEDAS;
    if (nombre === 'brands') return MARCAS;
    return [];
  };
  const tabla = (nombre: string) => {
    // La dirección sí se respeta. Desde que las ventas y las compras viven en
    // la misma tabla, un `mock` que devuelve todo para las dos consultas haría
    // pasar la prueba con lo que debes contado como lo que te deben.
    let direccion: unknown = null;
    const api: Record<string, unknown> = {
      then: (r: (v: unknown) => unknown) => {
        let datos = datosDe(nombre);
        if (nombre === 'billing_documents' && direccion !== null) {
          datos = datos.filter((d) => (d.direction ?? 'sale') === direccion);
        }
        return Promise.resolve({ data: datos, error: null, count: datos.length }).then(r);
      },
    };
    for (const m of ['select', 'eq', 'in', 'order', 'limit', 'not']) {
      api[m] = (campo: string, valor: unknown) => {
        if (m === 'eq' && campo === 'direction') direccion = valor;
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

const entidad = (id: string, legal_name: string): Entidad =>
  ({
    id, legal_name, organization_id: 'org-1', country: 'PE',
    default_currency_code: 'PEN', is_active: true, tax_id: null, archived_reason: null,
    address: null, phone: null, email: null, quote_terms: null,
    created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
  }) as Entidad;

async function montar(rol: Enums<'membership_role'> = 'owner') {
  const { default: Home } = await import('./Home');
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
          <Home />
        </OrgContext.Provider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const cuenta = (id: string, name: string, moneda: string) => ({
  id, name, currency_code: moneda, legal_entity_id: 'e-1', is_active: true,
});

beforeEach(() => {
  vi.setSystemTime(new Date('2026-11-06T12:00:00Z'));
  for (const a of [CUENTAS, SALDOS, DOCUMENTOS, ASIGNACIONES, MOVIMIENTOS, CUOTAS, TASAS, GASTOS]) {
    a.length = 0;
  }
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Inicio', () => {
  it('al rol comercial le da su pantalla, no la de finanzas vacía', async () => {
    await montar('commercial');
    expect(await screen.findByText('Tus cotizaciones')).toBeTruthy();
    expect(screen.queryByText('Caja disponible hoy')).toBeNull();
  });

  it('la caja va por moneda, con las cuentas dentro y sin un total único', async () => {
    CUENTAS.push(cuenta('cta-1', 'BCP soles', 'PEN'), cuenta('cta-2', 'Mercury', 'USD'));
    SALDOS.push(
      { cash_account_id: 'cta-1', balance: '4650.00' },
      { cash_account_id: 'cta-2', balance: '8420.00' },
    );
    await montar();
    expect(await screen.findByText('Caja disponible hoy')).toBeTruthy();

    // Dos veces cada una: el total de la moneda y su única cuenta. Que
    // coincidan es lo correcto cuando esa moneda tiene una sola cuenta.
    expect(screen.getAllByText('S/ 4,650.00')).toHaveLength(2);
    expect(screen.getAllByText('US$ 8,420.00')).toHaveLength(2);
    // Las cuentas se ven dentro de su moneda.
    expect(screen.getByText('BCP soles')).toBeTruthy();
    expect(screen.getByText('Mercury')).toBeTruthy();
    // Y no existe ninguna cifra que las sume: 4650 + 8420 = 13070.
    expect(screen.queryByText(/13,070/)).toBeNull();
  });

  /**
   * ADR-16: una conversión sin fuente no es un dato. Con dos monedas en
   * pantalla y ninguna tasa cargada, lo honesto es decir que falta.
   */
  it('sin tipo de cambio cargado no hay consolidado, y lo dice', async () => {
    CUENTAS.push(cuenta('cta-1', 'BCP soles', 'PEN'), cuenta('cta-2', 'Mercury', 'USD'));
    await montar();
    await screen.findByText('Caja disponible hoy');
    expect(screen.getByText(/El sistema no se lo inventa/)).toBeTruthy();
  });

  it('con tasa cargada la enseña con su fecha y su fuente, en una línea', async () => {
    CUENTAS.push(cuenta('cta-1', 'BCP soles', 'PEN'), cuenta('cta-2', 'Mercury', 'USD'));
    TASAS.push({ from_code: 'USD', to_code: 'PEN', rate: '3.9000', as_of: '2026-10-31', source: 'SBS' });
    await montar();
    await screen.findByText('Caja disponible hoy');
    expect(screen.getByText(/3\.9000/)).toBeTruthy();
    expect(screen.getByText(/SBS/)).toBeTruthy();
  });

  it('lo por cobrar no se mezcla con la caja y avisa de lo vencido', async () => {
    CUENTAS.push(cuenta('cta-1', 'BCP soles', 'PEN'));
    SALDOS.push({ cash_account_id: 'cta-1', balance: '1000.00' });
    DOCUMENTOS.push({
      id: 'doc-1', series_number: 'F001-00000123', doc_type: 'invoice',
      issue_date: '2026-10-01', due_date: '2026-10-31', currency_code: 'PEN',
      amount_total: '2000.00', status: 'open', client_id: 'cli-1', legal_entity_id: 'e-1',
    });
    await montar();
    await screen.findByText('Por cobrar');

    expect(screen.getByText('S/ 2,000.00')).toBeTruthy();
    expect(screen.getByText(/1 documento vencido/)).toBeTruthy();
    // Y aparece como acción, con los días concretos.
    expect(screen.getByText(/venció hace 6 días/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Registrar cobro' })).toBeTruthy();
  });

  it('lo que debes va aparte de lo que te deben, y no se restan', async () => {
    CUENTAS.push(cuenta('cta-1', 'BCP soles', 'PEN'));
    DOCUMENTOS.push(
      {
        id: 'doc-1', series_number: 'F001-00000123', doc_type: 'invoice', direction: 'sale',
        issue_date: '2026-10-01', due_date: '2026-12-31', currency_code: 'PEN',
        amount_total: '2000.00', amount_tax: '0.00', status: 'open', client_id: 'cli-1',
        legal_entity_id: 'e-1',
      },
      {
        id: 'doc-2', series_number: 'F002-9', description: 'Hosting anual', doc_type: 'invoice',
        direction: 'purchase', issue_date: '2026-10-01', due_date: '2026-10-31',
        currency_code: 'PEN', amount_total: '590.00', amount_tax: '90.00', status: 'open',
        client_id: null, legal_entity_id: 'e-1',
      },
    );
    await montar();
    await screen.findByText('Por pagar');

    // Las dos cifras existen y son distintas: 2.000 que te deben y 590 que
    // debes. Restarlas daría 1.410, que no es ninguna de las dos cosas.
    expect(screen.getByText('S/ 2,000.00')).toBeTruthy();
    expect(screen.getByText('S/ 590.00')).toBeTruthy();
    expect(screen.getByText(/1 factura vencida/)).toBeTruthy();
    expect(screen.getByText(/no se compensan/)).toBeTruthy();
    // Y la factura vencida que debes es una de las cosas que hacer hoy.
    expect(screen.getByText(/Hosting anual venció hace \d+ días/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pagar' })).toBeTruthy();
  });

  it('la proyección cuenta lo previsto y marca lo que ya venció', async () => {
    CUENTAS.push(cuenta('cta-1', 'BCP soles', 'PEN'));
    CUOTAS.push(
      { id: 'q-1', label: 'Anticipo', due_date: '2026-09-30', amount: '3000.00', currency_code: 'PEN', status: 'documented', quote_id: 'c-1', billing_document_id: 'doc-9' },
      { id: 'q-2', label: 'Contra entrega', due_date: '2026-11-20', amount: '5000.00', currency_code: 'PEN', status: 'planned', quote_id: 'c-1', billing_document_id: null },
    );
    await montar();
    expect(await screen.findByText(/Flujo de caja/)).toBeTruthy();

    expect(screen.getByText(/incluye S\/ 3,000.00 por cobrar ya vencido/)).toBeTruthy();
    // Sin gastos fijos cargados, lo dice en vez de disimularlo.
    expect(screen.getByText(/Solo entradas/)).toBeTruthy();
    // Y cada semana se explica con sus conceptos (F5-2).
    expect(screen.getByText(/cobras Anticipo/)).toBeTruthy();
    expect(screen.getByText(/cobras Contra entrega/)).toBeTruthy();
  });

  /**
   * Es el agujero que F3-3 cierra: con un gasto fijo cargado, la semana deja
   * de ser solo lo que entra.
   */
  it('un gasto fijo sale en la proyección y resta del neto', async () => {
    CUENTAS.push(cuenta('cta-1', 'BCP soles', 'PEN'));
    SALDOS.push({ cash_account_id: 'cta-1', balance: '1000.00' });
    CUOTAS.push({
      id: 'q-1', label: 'Contra entrega', due_date: '2026-11-20', amount: '5000.00',
      currency_code: 'PEN', status: 'planned', quote_id: 'c-1', billing_document_id: null,
    });
    GASTOS.push({
      id: 'g-1', label: 'Suite de diseño', amount: '250.00', currency_code: 'PEN',
      cadence: 'monthly', day_of_month: 18, starts_on: '2026-01-18', ends_on: null,
      is_active: true, cash_account_id: 'cta-1', created_at: '2026-01-18T00:00:00Z',
    });
    await montar();
    await screen.findByText(/Flujo de caja/);

    // La semana del 16: entran 5000 y salen 250.
    expect(screen.getAllByText('S/ 4,750.00').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/pagas Suite de diseño/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Incluye 1 gasto fijo/)).toBeTruthy();
  });

  it('avisa de la semana en que el saldo proyectado cruza el cero', async () => {
    CUENTAS.push(cuenta('cta-1', 'BCP soles', 'PEN'));
    SALDOS.push({ cash_account_id: 'cta-1', balance: '300.00' });
    GASTOS.push({
      id: 'g-1', label: 'Hosting', amount: '400.00', currency_code: 'PEN',
      cadence: 'monthly', day_of_month: 18, starts_on: '2026-01-18', ends_on: null,
      is_active: true, cash_account_id: 'cta-1', created_at: '2026-01-18T00:00:00Z',
    });
    await montar();
    await screen.findByText(/Flujo de caja/);
    expect(screen.getByText(/cierras en rojo/)).toBeTruthy();
  });

  /**
   * Un pago ya registrado tiene que sacar su mes de la proyección. Si no, el
   * mes pagado seguiría apareciendo y la cifra estaría inflada.
   */
  it('el mes ya pagado deja de aparecer', async () => {
    CUENTAS.push(cuenta('cta-1', 'BCP soles', 'PEN'));
    GASTOS.push({
      id: 'g-1', label: 'Hosting', amount: '400.00', currency_code: 'PEN',
      cadence: 'monthly', day_of_month: 18, starts_on: '2026-01-18', ends_on: null,
      is_active: true, cash_account_id: 'cta-1', created_at: '2026-11-01T00:00:00Z',
    });
    MOVIMIENTOS.push({
      id: 'mov-1', recurring_expense_id: 'g-1', value_date: '2026-11-03', is_void: false,
      description: 'Hosting noviembre', direction: 'out', amount: '400.00',
      currency_code: 'PEN', kind: 'operating', void_reason: null,
      cash_account_id: 'cta-1', external_ref: null, source: 'recurring',
    });
    await montar();
    await screen.findByText(/Flujo de caja/);

    // Noviembre está pagado. Lo que queda es diciembre y enero, en sus dos
    // semanas; lo que no queda es noviembre.
    expect(screen.getAllByText(/pagas Hosting/)).toHaveLength(2);
  });

  it('una cuota que vence pronto y sin documento es una acción', async () => {
    CUENTAS.push(cuenta('cta-1', 'BCP soles', 'PEN'));
    CUOTAS.push({
      id: 'q-2', label: 'Anticipo 50 %', due_date: '2026-11-09', amount: '5000.00',
      currency_code: 'PEN', status: 'planned', quote_id: 'c-1', billing_document_id: null,
    });
    await montar();
    await screen.findByText('Acciones próximas');
    expect(screen.getByText(/«Anticipo 50 %» vence el .* y no tiene documento emitido/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Emitir' })).toBeTruthy();
  });

  it('la configuración ya no ocupa la pantalla: solo sale lo que falta', async () => {
    CUENTAS.push(cuenta('cta-1', 'BCP soles', 'PEN'));
    MARCAS.length = 0;
    await montar();
    await screen.findByText('Caja disponible hoy');
    expect(screen.getByText('Falta configurar')).toBeTruthy();
    expect(screen.getByText('Marcas')).toBeTruthy();
    // Y lo que ya está configurado no aparece.
    expect(screen.queryByText('Entidades legales')).toBeNull();
    MARCAS.push({ id: 'm-1' });
  });
});
