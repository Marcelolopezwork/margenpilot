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
 * Lo que esta pantalla tiene que cumplir:
 *
 *  · el saldo que enseña es el del libro de caja y nada más (INV-1);
 *  · dos monedas son dos cifras, nunca una suma (INV-10);
 *  · y al rol comercial, al que la base no le enseña ni una fila, se lo
 *    explica en vez de dejarle una pantalla vacía que parece estropeada.
 */

const CUENTAS: Record<string, unknown>[] = [];
const SALDOS: Record<string, unknown>[] = [];
const DOCUMENTOS: Record<string, unknown>[] = [];
const ASIGNACIONES: Record<string, unknown>[] = [];
const MOVIMIENTOS: Record<string, unknown>[] = [];
const GASTOS: Record<string, unknown>[] = [];
const CLIENTES = [{ id: 'cli-1', name: 'EJ Deportes' }];
const llamadas: { nombre: string; args: Record<string, unknown> }[] = [];

vi.mock('../../lib/supabase', () => {
  const datosDe = (nombre: string): Record<string, unknown>[] => {
    if (nombre === 'cash_accounts') return CUENTAS;
    if (nombre === 'account_balances') return SALDOS;
    if (nombre === 'billing_documents') return DOCUMENTOS;
    if (nombre === 'payment_allocations') return ASIGNACIONES;
    if (nombre === 'cash_movements') return MOVIMIENTOS;
    if (nombre === 'recurring_expenses') return GASTOS;
    if (nombre === 'clients') return CLIENTES;
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

async function montar(rol: Enums<'membership_role'> = 'owner') {
  const { default: Caja } = await import('./Caja');
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
          <Caja />
        </OrgContext.Provider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  for (const a of [CUENTAS, SALDOS, DOCUMENTOS, ASIGNACIONES, MOVIMIENTOS, GASTOS, llamadas])
    a.length = 0;
});

afterEach(cleanup);

describe('Finanzas · Caja', () => {
  it('al rol comercial le explica que la base no se lo enseña', async () => {
    await montar('commercial');
    expect(await screen.findByText('Esta sección es de finanzas')).toBeTruthy();
    expect(screen.getByText(/no es que la pantalla los esconda/)).toBeTruthy();
  });

  it('el saldo de una cuenta sin movimientos es cero, no desconocido', async () => {
    CUENTAS.push({
      id: 'cta-1',
      name: 'BCP soles',
      bank_name: 'BCP',
      currency_code: 'PEN',
      legal_entity_id: 'e-1',
      is_active: true,
    });
    await montar();
    expect(await screen.findByText('BCP soles')).toBeTruthy();
    expect(screen.getByText(/sin movimientos todavía/)).toBeTruthy();
    expect(screen.getAllByText('S/ 0.00').length).toBeGreaterThan(0);
  });

  it('dos monedas son dos cifras y dice por qué no las suma', async () => {
    CUENTAS.push(
      { id: 'cta-1', name: 'BCP soles', bank_name: 'BCP', currency_code: 'PEN', legal_entity_id: 'e-1', is_active: true },
      { id: 'cta-2', name: 'Mercury', bank_name: null, currency_code: 'USD', legal_entity_id: 'e-2', is_active: true },
    );
    SALDOS.push(
      { cash_account_id: 'cta-1', currency_code: 'PEN', balance: '4650.00', movimientos: 2, ultimo_movimiento: '2026-11-06' },
      { cash_account_id: 'cta-2', currency_code: 'USD', balance: '1200.00', movimientos: 1, ultimo_movimiento: '2026-11-02' },
    );
    await montar();
    await screen.findByText('BCP soles');

    expect(screen.getByText('En las cuentas · PEN')).toBeTruthy();
    expect(screen.getByText('En las cuentas · USD')).toBeTruthy();
    expect(screen.getAllByText('S/ 4,650.00').length).toBeGreaterThan(0);
    expect(screen.getAllByText('US$ 1,200.00').length).toBeGreaterThan(0);
    expect(screen.getByText(/Sumarlas\s+exigiría un tipo de cambio/)).toBeTruthy();
  });

  it('un cobro anulado deja de contar como cobrado', async () => {
    DOCUMENTOS.push({
      id: 'doc-1',
      series_number: 'F001-00000123',
      doc_type: 'invoice',
      issue_date: '2026-11-01',
      due_date: '2026-11-30',
      currency_code: 'PEN',
      amount_total: '11307.94',
      status: 'partially_paid',
      client_id: 'cli-1',
      legal_entity_id: 'e-1',
    });
    ASIGNACIONES.push(
      { billing_document_id: 'doc-1', amount: '5000.00', currency_code: 'PEN', cash_movement_id: 'mov-1' },
      { billing_document_id: 'doc-1', amount: '6307.94', currency_code: 'PEN', cash_movement_id: 'mov-2' },
    );
    // `mov-2` está anulado: su asignación no cuenta, así que quedan 6307.94.
    MOVIMIENTOS.push(
      { id: 'mov-1', is_void: false, value_date: '2026-11-05', description: 'Cobro', direction: 'in', amount: '5000.00', currency_code: 'PEN', kind: 'operating', void_reason: null, cash_account_id: 'cta-1', external_ref: null, source: 'quote' },
      { id: 'mov-2', is_void: true, value_date: '2026-11-06', description: 'Cobro repetido', direction: 'in', amount: '6307.94', currency_code: 'PEN', kind: 'operating', void_reason: 'se registró dos veces', cash_account_id: 'cta-1', external_ref: null, source: 'quote' },
    );
    await montar();
    await screen.findByText(/F001-00000123/);

    expect(screen.getAllByText('S/ 6,307.94').length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'Por cobrar' })).toBeTruthy();
    // Y el movimiento anulado sigue en el libro, con su motivo.
    expect(screen.getByText(/se registró dos veces/)).toBeTruthy();
    expect(screen.getByText('anulado')).toBeTruthy();
  });

  it('anotar un movimiento manda el importe en positivo y su dirección', async () => {
    const usuario = userEvent.setup();
    CUENTAS.push({
      id: 'cta-1', name: 'BCP soles', bank_name: 'BCP', currency_code: 'PEN',
      legal_entity_id: 'e-1', is_active: true,
    });
    await montar();
    await screen.findByText('BCP soles');

    await usuario.selectOptions(screen.getByLabelText('Cuenta'), 'cta-1');
    await usuario.type(screen.getByLabelText(/Importe en PEN/), '350');
    await usuario.type(screen.getByLabelText('Concepto'), 'Hosting de noviembre');
    await usuario.click(screen.getByRole('button', { name: 'Anotar movimiento' }));

    await waitFor(() => expect(llamadas).toHaveLength(1));
    expect(llamadas[0]?.nombre).toBe('registrar_movimiento');
    expect(llamadas[0]?.args).toMatchObject({
      p_account: 'cta-1',
      p_direction: 'out',
      p_amount: 350,
      p_description: 'Hosting de noviembre',
      p_kind: 'operating',
    });
  });

  it('avisa de lo vencido con los días de atraso', async () => {
    vi.setSystemTime(new Date('2026-12-10T12:00:00Z'));
    DOCUMENTOS.push({
      id: 'doc-1', series_number: 'F001-00000123', doc_type: 'invoice',
      issue_date: '2026-11-01', due_date: '2026-11-30', currency_code: 'PEN',
      amount_total: '1000.00', status: 'open', client_id: 'cli-1', legal_entity_id: 'e-1',
    });
    await montar();
    await screen.findByText(/F001-00000123/);

    expect(screen.getByText(/Hay 1 documento vencido/)).toBeTruthy();
    expect(screen.getByText('vencido hace 10 días')).toBeTruthy();
    vi.useRealTimers();
  });
  /**
   * El fallo del 10/11. Marcelo cargó Claude Code en dólares a nombre de
   * 3 Brothers, que solo tiene cuenta en soles, y al anotar el pago la clave
   * compuesta lo rechazó con un «falta un dato relacionado». El desplegable no
   * tenía que haberlo ofrecido.
   */
  it('solo ofrece los gastos fijos que esa cuenta puede pagar', async () => {
    const usuario = userEvent.setup();
    CUENTAS.push(
      { id: 'cta-1', name: 'BCP soles', bank_name: 'BCP', currency_code: 'PEN', legal_entity_id: 'e-1', is_active: true },
      { id: 'cta-2', name: 'Mercury', bank_name: null, currency_code: 'USD', legal_entity_id: 'e-2', is_active: true },
    );
    GASTOS.push(
      { id: 'g-1', label: 'Claude Code', amount: '200.00', currency_code: 'USD', cadence: 'monthly', legal_entity_id: 'e-2', cash_account_id: null },
      { id: 'g-2', label: 'Hosting', amount: '90.00', currency_code: 'PEN', cadence: 'monthly', legal_entity_id: 'e-1', cash_account_id: null },
    );
    await montar();
    await screen.findByText('BCP soles');

    // Sin cuenta elegida no se ofrece ninguno: se pide la cuenta primero.
    expect(screen.queryByLabelText(/¿Paga un gasto fijo\?/)).toBeNull();
    expect(screen.getByText(/Elige primero la cuenta/)).toBeTruthy();

    await usuario.selectOptions(screen.getByLabelText('Cuenta'), 'cta-1');
    const soles = screen.getByLabelText(/¿Paga un gasto fijo\?/) as HTMLSelectElement;
    expect([...soles.options].map((o) => o.textContent)).toEqual([
      'No, es un gasto suelto',
      'Hosting · 90.00 PEN',
    ]);
    expect(screen.getByText(/no sale de esta cuenta/)).toBeTruthy();

    await usuario.selectOptions(screen.getByLabelText('Cuenta'), 'cta-2');
    const dolares = screen.getByLabelText(/¿Paga un gasto fijo\?/) as HTMLSelectElement;
    expect([...dolares.options].map((o) => o.textContent)).toEqual([
      'No, es un gasto suelto',
      'Claude Code · 200.00 USD',
    ]);
  });

  it('cambiar de cuenta suelta el gasto que ya no se puede pagar desde ella', async () => {
    const usuario = userEvent.setup();
    CUENTAS.push(
      { id: 'cta-1', name: 'BCP soles', bank_name: 'BCP', currency_code: 'PEN', legal_entity_id: 'e-1', is_active: true },
      { id: 'cta-2', name: 'Mercury', bank_name: null, currency_code: 'USD', legal_entity_id: 'e-2', is_active: true },
    );
    GASTOS.push({
      id: 'g-1', label: 'Claude Code', amount: '200.00', currency_code: 'USD',
      cadence: 'monthly', legal_entity_id: 'e-2', cash_account_id: null,
    });
    await montar();
    await screen.findByText('Mercury');

    await usuario.selectOptions(screen.getByLabelText('Cuenta'), 'cta-2');
    await usuario.selectOptions(screen.getByLabelText(/¿Paga un gasto fijo\?/), 'g-1');
    // Rellena el concepto y el importe desde el gasto, para no teclearlo.
    expect((screen.getByLabelText('Concepto') as HTMLInputElement).value).toBe('Claude Code');
    expect((screen.getByLabelText(/Importe en USD/) as HTMLInputElement).value).toBe('200.00');

    await usuario.selectOptions(screen.getByLabelText('Cuenta'), 'cta-1');
    await usuario.click(screen.getByRole('button', { name: 'Anotar movimiento' }));

    await waitFor(() => expect(llamadas).toHaveLength(1));
    expect(llamadas[0]?.args).not.toHaveProperty('p_recurring');
  });

  it('al pagar un gasto fijo manda cuál saldaba', async () => {
    const usuario = userEvent.setup();
    CUENTAS.push({
      id: 'cta-2', name: 'Mercury', bank_name: null, currency_code: 'USD',
      legal_entity_id: 'e-2', is_active: true,
    });
    GASTOS.push({
      id: 'g-1', label: 'Claude Code', amount: '200.00', currency_code: 'USD',
      cadence: 'monthly', legal_entity_id: 'e-2', cash_account_id: null,
    });
    await montar();
    await screen.findByText('Mercury');

    await usuario.selectOptions(screen.getByLabelText('Cuenta'), 'cta-2');
    await usuario.selectOptions(screen.getByLabelText(/¿Paga un gasto fijo\?/), 'g-1');
    await usuario.click(screen.getByRole('button', { name: 'Anotar movimiento' }));

    await waitFor(() => expect(llamadas).toHaveLength(1));
    expect(llamadas[0]?.args).toMatchObject({
      p_account: 'cta-2',
      p_direction: 'out',
      p_amount: 200,
      p_recurring: 'g-1',
    });
  });

  it('en una entrada no ofrece gastos fijos: se pagan, no se cobran', async () => {
    const usuario = userEvent.setup();
    CUENTAS.push({
      id: 'cta-2', name: 'Mercury', bank_name: null, currency_code: 'USD',
      legal_entity_id: 'e-2', is_active: true,
    });
    GASTOS.push({
      id: 'g-1', label: 'Claude Code', amount: '200.00', currency_code: 'USD',
      cadence: 'monthly', legal_entity_id: 'e-2', cash_account_id: null,
    });
    await montar();
    await screen.findByText('Mercury');

    await usuario.selectOptions(screen.getByLabelText('Cuenta'), 'cta-2');
    expect(screen.getByLabelText(/¿Paga un gasto fijo\?/)).toBeTruthy();

    await usuario.selectOptions(screen.getByLabelText('Dirección'), 'in');
    expect(screen.queryByLabelText(/¿Paga un gasto fijo\?/)).toBeNull();
  });
});
