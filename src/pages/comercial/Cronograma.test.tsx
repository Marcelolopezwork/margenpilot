// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Estado } from './estados';

/**
 * Lo que esta pantalla tiene que cumplir es una sola cosa: que no se pueda
 * guardar un cronograma que no cuadre, y que lo ya documentado no se toque.
 * Todo lo demás es comodidad.
 *
 * La base lo impide igual —`guardar_cronograma` rechaza una suma distinta del
 * total de la versión—, así que esto no es la garantía: es que el usuario lo
 * vea antes de pulsar, en vez de leer un error.
 */

const CUOTAS: Record<string, unknown>[] = [];
const llamadas: { nombre: string; args: Record<string, unknown> }[] = [];

const CUENTAS = [
  { id: 'cta-1', name: 'BCP soles', bank_name: 'BCP' },
  { id: 'cta-2', name: 'Caja chica', bank_name: null },
];

const VERSION = {
  version_no: 1,
  totals: { moneda: 'PEN', decimales: 2, neto: '9583.00', impuesto: '1724.94', total: '11307.94' },
};

vi.mock('../../lib/supabase', () => {
  const tabla = (nombre: string) => {
    const datos = nombre === 'payment_schedule_items' ? CUOTAS : nombre === 'cash_accounts' ? CUENTAS : [];
    const api: Record<string, unknown> = {
      then: (r: (v: unknown) => unknown) => Promise.resolve({ data: datos, error: null }).then(r),
      maybeSingle: () =>
        Promise.resolve({ data: nombre === 'quote_versions' ? VERSION : null, error: null }),
    };
    for (const m of ['select', 'eq', 'order', 'limit', 'in']) api[m] = () => api;
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

async function montar(estado: Estado = 'approved', puedeEditar = true) {
  const { default: Cronograma } = await import('./Cronograma');
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={cliente}>
      <Cronograma
        cotizacion="c-1"
        estado={estado}
        moneda="PEN"
        entidad="ent-1"
        puedeEditar={puedeEditar}
      />
    </QueryClientProvider>,
  );
}

const cuota = (extra: Record<string, unknown>) => ({
  id: 'q-1',
  label: 'Pago único',
  due_date: '2026-11-05',
  amount: '11307.94',
  expected_cash_account_id: null,
  status: 'planned',
  sort: 1,
  ...extra,
});

beforeEach(() => {
  CUOTAS.length = 0;
  llamadas.length = 0;
});

afterEach(cleanup);

describe('el cronograma de cobro', () => {
  it('no existe hasta que el cliente acepta', async () => {
    await montar('sent');
    expect(screen.queryByText('Cronograma de cobro')).toBeNull();
  });

  it('enseña el total de la versión aceptada y la cuota que hay', async () => {
    CUOTAS.push(cuota({}));
    await montar();
    expect(await screen.findByText('Cronograma de cobro')).toBeTruthy();
    // Dos veces: el total de la versión arriba y la suma de las cuotas abajo.
    // Que sean la misma cifra es justamente lo que hay que ver de un vistazo.
    expect(screen.getAllByText('S/ 11,307.94')).toHaveLength(2);
    expect(screen.getByText(/Total de la v1/)).toBeTruthy();
    expect((screen.getByLabelText('Concepto de la cuota 1') as HTMLInputElement).value).toBe(
      'Pago único',
    );
    expect(screen.getByText(/cuadra con la versión aceptada/)).toBeTruthy();
  });

  it('el botón 50/50 reparte sin perder un céntimo', async () => {
    const usuario = userEvent.setup();
    CUOTAS.push(cuota({}));
    await montar();
    await screen.findByText('Cronograma de cobro');

    await usuario.click(screen.getByRole('button', { name: '50 / 50' }));

    expect((screen.getByLabelText('Importe de la cuota 1') as HTMLInputElement).value).toBe(
      '5653.97',
    );
    expect((screen.getByLabelText('Importe de la cuota 2') as HTMLInputElement).value).toBe(
      '5653.97',
    );
    expect(screen.getByText(/cuadra con la versión aceptada/)).toBeTruthy();
  });

  it('no deja guardar un cronograma que no cuadra, y dice cuánto falta', async () => {
    const usuario = userEvent.setup();
    CUOTAS.push(cuota({}));
    await montar();
    await screen.findByText('Cronograma de cobro');

    const importe = screen.getByLabelText('Importe de la cuota 1');
    await usuario.clear(importe);
    await usuario.type(importe, '10000');

    expect(screen.getByText(/faltan S\/ 1,307.94 por repartir/)).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Guardar cronograma' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(llamadas).toHaveLength(0);
  });

  it('avisa también cuando se pasa', async () => {
    const usuario = userEvent.setup();
    CUOTAS.push(cuota({}));
    await montar();
    await screen.findByText('Cronograma de cobro');

    const importe = screen.getByLabelText('Importe de la cuota 1');
    await usuario.clear(importe);
    await usuario.type(importe, '12000');

    expect(screen.getByText(/te pasas por S\/ 692.06/)).toBeTruthy();
  });

  it('manda a la base la lista entera, con la forma que espera', async () => {
    const usuario = userEvent.setup();
    CUOTAS.push(cuota({}));
    await montar();
    await screen.findByText('Cronograma de cobro');

    await usuario.click(screen.getByRole('button', { name: '50 / 50' }));
    await usuario.selectOptions(screen.getByLabelText('Cuenta de destino de la cuota 1'), 'cta-1');
    await usuario.click(screen.getByRole('button', { name: 'Guardar cronograma' }));

    await waitFor(() => expect(llamadas).toHaveLength(1));
    expect(llamadas[0]?.nombre).toBe('guardar_cronograma');
    const args = llamadas[0]?.args as { p_quote: string; p_items: Record<string, string>[] };
    expect(args.p_quote).toBe('c-1');
    expect(args.p_items).toHaveLength(2);
    expect(args.p_items[0]).toMatchObject({
      label: 'Anticipo 50 %',
      amount: '5653.97',
      cash_account_id: 'cta-1',
    });
    expect(args.p_items[1]).toMatchObject({ label: 'Contra entrega', amount: '5653.97' });
  });

  it('una cuota documentada no se edita y sigue contando para el total', async () => {
    CUOTAS.push(
      cuota({ id: 'q-1', label: 'Anticipo 50 %', amount: '5653.97', status: 'documented' }),
      cuota({ id: 'q-2', label: 'Contra entrega', amount: '5653.97', due_date: '2026-12-05' }),
    );
    await montar();
    await screen.findByText('Cronograma de cobro');

    // La documentada se lee, no se teclea.
    expect(screen.queryByLabelText('Importe de la cuota 1')).toBeNull();
    expect(screen.getByText('documentada')).toBeTruthy();
    // Y la segunda sí.
    expect((screen.getByLabelText('Importe de la cuota 2') as HTMLInputElement).value).toBe(
      '5653.97',
    );
    // Las dos juntas cuadran con el total.
    expect(screen.getByText(/cuadra con la versión aceptada/)).toBeTruthy();
  });

  it('un rol sin finanzas lo ve y no lo toca', async () => {
    CUOTAS.push(cuota({}));
    await montar('approved', false);
    await screen.findByText('Cronograma de cobro');

    expect(screen.getByText(/no lo arma/)).toBeTruthy();
    expect(screen.queryByLabelText('Importe de la cuota 1')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Guardar cronograma' })).toBeNull();
    expect(screen.queryByRole('button', { name: '50 / 50' })).toBeNull();
    // Pero las cifras sí las ve: no son un costo.
    expect(screen.getByText('Pago único')).toBeTruthy();
    // Las cuentas de la empresa no: la política de `cash_accounts` no se las
    // enseña a este rol, así que la columna no se dibuja.
    expect(screen.queryByText('Entra en')).toBeNull();
  });
});
