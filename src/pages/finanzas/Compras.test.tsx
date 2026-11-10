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
 *  · una factura es gasto el día que llega, no el día que se paga;
 *  · el IGV que lleva dentro se dice aparte, porque es crédito fiscal y no
 *    gasto, y la cifra se enseña antes de guardar y no después;
 *  · el proveedor se escribe, y la pantalla dice si es nuevo o si ya existe
 *    —aunque se teclee con otras mayúsculas—;
 *  · y una factura que no se puede pagar desde ninguna cuenta lo dice en ese
 *    momento, con el nombre de la empresa dentro.
 */

const COMPRAS: Record<string, unknown>[] = [];
const PROVEEDORES: Record<string, unknown>[] = [];
const CUENTAS: Record<string, unknown>[] = [];
const CATEGORIAS: Record<string, unknown>[] = [];
const IMPUESTOS: Record<string, unknown>[] = [];
const ASIGNACIONES: Record<string, unknown>[] = [];
const MOVIMIENTOS: Record<string, unknown>[] = [];
const llamadas: { nombre: string; args: Record<string, unknown> }[] = [];

vi.mock('../../lib/supabase', () => {
  const datosDe = (nombre: string): Record<string, unknown>[] => {
    if (nombre === 'billing_documents') return COMPRAS;
    if (nombre === 'suppliers') return PROVEEDORES;
    if (nombre === 'cash_accounts') return CUENTAS;
    if (nombre === 'financial_categories') return CATEGORIAS;
    if (nombre === 'tax_rates') return IMPUESTOS;
    if (nombre === 'payment_allocations') return ASIGNACIONES;
    if (nombre === 'cash_movements') return MOVIMIENTOS;
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
  const { default: Compras } = await import('./Compras');
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
          <Compras />
        </OrgContext.Provider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const compra = (extra: Record<string, unknown>) => ({
  id: 'd-1',
  series_number: 'F001-1234',
  description: 'Hosting anual',
  doc_type: 'invoice',
  issue_date: '2026-11-01',
  due_date: '2026-11-30',
  currency_code: 'PEN',
  amount_total: '1180.00',
  amount_net: '1000.00',
  amount_tax: '180.00',
  tax_rate: '18.0000',
  status: 'open',
  legal_entity_id: 'e-1',
  supplier_id: 'p-1',
  category_id: null,
  ...extra,
});

beforeEach(() => {
  COMPRAS.length = 0;
  PROVEEDORES.length = 0;
  CUENTAS.length = 0;
  CATEGORIAS.length = 0;
  IMPUESTOS.length = 0;
  ASIGNACIONES.length = 0;
  MOVIMIENTOS.length = 0;
  llamadas.length = 0;
});
afterEach(cleanup);

describe('Compras · lo que debes y el IGV que no es tu gasto', () => {
  it('sin compras explica qué se pierde sin ellas', async () => {
    await montar();
    expect(await screen.findByText('Todavía no hay ninguna compra anotada')).toBeTruthy();
    expect(screen.getByText(/parece el mejor del año/)).toBeTruthy();
  });

  it('al rol comercial no le enseña nada y lo dice', async () => {
    await montar('commercial');
    expect(await screen.findByText('Esta sección es de finanzas')).toBeTruthy();
  });

  it('enseña lo que debes, con el IGV señalado como crédito fiscal', async () => {
    COMPRAS.push(compra({}));
    PROVEEDORES.push({ id: 'p-1', name: 'Movistar', is_active: true });
    await montar();

    expect(await screen.findByText('Lo que debes a proveedores')).toBeTruthy();
    // Dos veces: el total de lo que debes arriba y lo que queda de esta
    // factura en su fila. Es la misma cifra porque hay una sola factura.
    expect(screen.getAllByText('S/ 1,180.00')).toHaveLength(2);
    expect(screen.getByText(/De eso, S\/ 180.00 es IGV: crédito fiscal, no gasto/)).toBeTruthy();
    // La fila dice el gasto y el impuesto por separado, no solo el total.
    expect(screen.getByText(/Gasto S\/ 1,000.00 · IGV S\/ 180.00/)).toBeTruthy();
    expect(screen.getByText('Hosting anual')).toBeTruthy();
  });

  it('una factura pasada de fecha se dice vencida, con los días', async () => {
    COMPRAS.push(compra({ due_date: '2020-01-01' }));
    PROVEEDORES.push({ id: 'p-1', name: 'Movistar', is_active: true });
    await montar();
    expect(await screen.findByText(/vencida hace \d+ días/)).toBeTruthy();
  });

  it('enseña el desglose mientras se teclea, antes de guardar', async () => {
    CUENTAS.push({ id: 'c-1', name: 'BCP soles', currency_code: 'PEN', legal_entity_id: 'e-1' });
    IMPUESTOS.push({ legal_entity_id: 'e-1', name: 'IGV', rate: '18.0000', is_default: true });
    const usuario = userEvent.setup();
    await montar();
    await screen.findByText('Anotar una compra');

    await usuario.selectOptions(screen.getByLabelText('De qué empresa es la compra'), 'e-1');
    await usuario.selectOptions(screen.getByLabelText('Moneda de la compra'), 'PEN');
    await usuario.type(screen.getByLabelText('Total de la factura'), '1180');

    // La tasa queda vacía: se usa la de la empresa, y se dice cuál es.
    expect(screen.getByText(/se usa el IGV de 3 Brothers MKT SAC: 18.0000 %/)).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText(/es gasto y/)).toBeTruthy();
    });
    expect(screen.getByText('S/ 1,000.00')).toBeTruthy();
    expect(screen.getByText('S/ 180.00')).toBeTruthy();
  });

  it('dice si el proveedor que escribes es nuevo o ya existe, sin distinguir mayúsculas', async () => {
    PROVEEDORES.push({ id: 'p-1', name: 'Movistar', is_active: true });
    const usuario = userEvent.setup();
    await montar();
    await screen.findByText('Anotar una compra');

    const campo = screen.getByLabelText('A quién le compras');
    await usuario.type(campo, 'movistar');
    expect(screen.getByText('Ya existe: se usará ese mismo proveedor.')).toBeTruthy();

    await usuario.clear(campo);
    await usuario.type(campo, 'Claro');
    expect(screen.getByText('Es nuevo: se creará al guardar.')).toBeTruthy();
  });

  it('anota la compra llamando a la puerta, con el total y la empresa', async () => {
    CUENTAS.push({ id: 'c-1', name: 'BCP soles', currency_code: 'PEN', legal_entity_id: 'e-1' });
    const usuario = userEvent.setup();
    await montar();
    await screen.findByText('Anotar una compra');

    await usuario.selectOptions(screen.getByLabelText('De qué empresa es la compra'), 'e-1');
    await usuario.type(screen.getByLabelText('A quién le compras'), 'Movistar');
    await usuario.type(screen.getByLabelText('Qué compraste'), 'Teléfono de noviembre');
    await usuario.selectOptions(screen.getByLabelText('Moneda de la compra'), 'PEN');
    await usuario.type(screen.getByLabelText('Total de la factura'), '236');
    await usuario.click(screen.getByRole('button', { name: 'Anotar la compra' }));

    await waitFor(() => expect(llamadas).toHaveLength(1));
    expect(llamadas[0]?.nombre).toBe('registrar_compra');
    expect(llamadas[0]?.args.p_entity).toBe('e-1');
    expect(llamadas[0]?.args.p_supplier).toBe('Movistar');
    expect(llamadas[0]?.args.p_amount).toBe(236);
    expect(llamadas[0]?.args.p_currency).toBe('PEN');
    expect(llamadas[0]?.args.p_description).toBe('Teléfono de noviembre');
    // Y confirma la idea que importa: ya es gasto, aunque no esté pagada.
    expect(
      await screen.findByText(/Ya cuenta como gasto del .*aunque todavía no la hayas pagado/),
    ).toBeTruthy();
  });

  it('paga una factura por la puerta de pagos, no por la de cobros', async () => {
    COMPRAS.push(compra({}));
    PROVEEDORES.push({ id: 'p-1', name: 'Movistar', is_active: true });
    CUENTAS.push({ id: 'c-1', name: 'BCP soles', currency_code: 'PEN', legal_entity_id: 'e-1' });
    const usuario = userEvent.setup();
    await montar();

    await usuario.click(await screen.findByRole('button', { name: 'Pagar' }));
    await usuario.selectOptions(screen.getByLabelText('De qué cuenta sale'), 'c-1');
    await usuario.click(screen.getByRole('button', { name: 'Registrar el pago' }));

    await waitFor(() => expect(llamadas).toHaveLength(1));
    expect(llamadas[0]?.nombre).toBe('registrar_pago_de_compra');
    expect(llamadas[0]?.args.p_document).toBe('d-1');
    expect(llamadas[0]?.args.p_account).toBe('c-1');
    // Prellena lo que queda, que es lo que se paga nueve de cada diez veces.
    expect(llamadas[0]?.args.p_amount).toBe(1180);
  });

  it('una factura que ninguna cuenta puede pagar lo dice al intentarlo', async () => {
    COMPRAS.push(compra({ currency_code: 'USD', amount_total: '200.00', amount_net: '200.00', amount_tax: '0.00' }));
    PROVEEDORES.push({ id: 'p-1', name: 'Adobe', is_active: true });
    CUENTAS.push({ id: 'c-1', name: 'BCP soles', currency_code: 'PEN', legal_entity_id: 'e-1' });
    const usuario = userEvent.setup();
    await montar();

    await usuario.click(await screen.findByRole('button', { name: 'Pagar' }));
    expect(
      screen.getByText(/3 Brothers MKT SAC no tiene ninguna cuenta en esa moneda/),
    ).toBeTruthy();
    expect(screen.queryByLabelText('De qué cuenta sale')).toBeNull();
  });

  it('anular exige un motivo y avisa de que el pago se anula primero', async () => {
    COMPRAS.push(compra({}));
    PROVEEDORES.push({ id: 'p-1', name: 'Movistar', is_active: true });
    const usuario = userEvent.setup();
    await montar();

    await usuario.click(await screen.findByRole('button', { name: 'Anular' }));
    expect(screen.getByText(/anula primero ese movimiento desde Caja/)).toBeTruthy();

    await usuario.type(screen.getByLabelText('Por qué se anula'), 'El número estaba mal');
    await usuario.click(screen.getByRole('button', { name: 'Anular la compra' }));

    await waitFor(() => expect(llamadas).toHaveLength(1));
    expect(llamadas[0]?.nombre).toBe('anular_documento');
    expect(llamadas[0]?.args.p_motivo).toBe('El número estaba mal');
  });

  it('dice lo que todavía no sabe: a qué trabajo pertenece cada compra', async () => {
    await montar();
    expect(
      await screen.findByText(/no cuánto dejó cada servicio/),
    ).toBeTruthy();
  });
});
