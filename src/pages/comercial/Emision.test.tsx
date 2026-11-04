// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { Estado } from './estados';

/**
 * El panel de emisión es donde se decide qué sale y qué queda escrito, así
 * que lo que se prueba es justo eso: que «enviada» no sea un botón —se llega
 * emitiendo—, que anular pida motivo antes de llamar a la base, y que las
 * versiones ya emitidas se listen con su total.
 */

const VERSIONES: Record<string, unknown>[] = [];

const llamadas: { nombre: string; args: Record<string, unknown> }[] = [];

vi.mock('../../lib/supabase', () => {
  const tabla = (nombre: string) => {
    const api: Record<string, unknown> = {
      then: (resolver: (v: unknown) => unknown) => {
        const datos =
          nombre === 'quote_versions'
            ? VERSIONES
            : nombre === 'quote_version_costs'
              ? VERSIONES.map((v) => ({
                  quote_version_id: v['id'],
                  cost: 1000,
                  profit: 2200,
                  margin_pct: 68.75,
                  markup_pct: 220,
                }))
              : [];
        return Promise.resolve({ data: datos, error: null }).then(resolver);
      },
    };
    for (const metodo of ['select', 'eq', 'order', 'limit', 'in']) {
      api[metodo] = () => api;
    }
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
      storage: {
        from: () => ({ getPublicUrl: (r: string) => ({ data: { publicUrl: `/x/${r}` } }) }),
      },
    }),
  };
});

const SNAPSHOT = {
  cotizacion: {
    numero: 'NL-COT-2026-0007',
    moneda: 'PEN',
    tasa_impuesto: '18.0000',
    impuesto_aplicado: true,
    etiqueta_impuesto: 'IGV 18 %',
    valida_hasta: null,
    notas: null,
    creada_el: '2026-11-04T10:00:00Z',
  },
  empresa: { razon_social: '3 Brothers MKT SAC' },
  marca: null,
  cliente: { nombre: 'Amotape' },
  lineas: [
    {
      id: 'l-1',
      orden: 10,
      descripcion: 'Branding',
      cantidad: '1.0000',
      precio_unitario: '3200.00',
      neto: '3200.00',
      entregables: [],
    },
  ],
  diseno: {},
};

async function montar(estado: Estado) {
  const { default: Emision } = await import('./Emision');
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(
    <QueryClientProvider client={cliente}>
      <MemoryRouter>
        <Emision cotizacion="c-1" estado={estado} conCostos hayLineas />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await screen.findByText('Emisión');
}

beforeEach(() => {
  VERSIONES.length = 0;
  llamadas.length = 0;
});

afterEach(cleanup);

describe('el panel de emisión', () => {
  it('ofrece emitir un borrador y llama a la base', async () => {
    const usuario = userEvent.setup();
    await montar('draft');

    await usuario.click(screen.getByRole('button', { name: 'Emitir' }));

    await waitFor(() => expect(llamadas).toHaveLength(1));
    expect(llamadas[0]).toEqual({ nombre: 'emitir_cotizacion', args: { p_quote: 'c-1' } });
  });

  it('a «enviada» no se llega con un botón: se llega emitiendo', async () => {
    await montar('draft');
    expect(screen.queryByRole('button', { name: 'Enviada' })).toBeNull();
  });

  it('desde enviada ofrece lo que la base acepta, y nada más', async () => {
    await montar('sent');
    for (const nombre of ['En negociación', 'Aprobada', 'Rechazada', 'Vencida', 'Anulada']) {
      expect(screen.getByRole('button', { name: nombre })).toBeTruthy();
    }
    expect(screen.queryByRole('button', { name: 'Borrador' })).toBeNull();
  });

  it('una aprobada solo se puede anular', async () => {
    await montar('approved');
    expect(screen.getByRole('button', { name: 'Anulada' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'En negociación' })).toBeNull();
    // Tampoco se reemite: lo que el cliente aceptó no vuelve a la imprenta.
    expect(screen.queryByRole('button', { name: /Emitir|Reemitir/ })).toBeNull();
  });

  it('anular pide motivo antes de tocar la base', async () => {
    const usuario = userEvent.setup();
    await montar('sent');

    await usuario.click(screen.getByRole('button', { name: 'Anulada' }));
    expect(llamadas).toHaveLength(0);

    const motivo = screen.getByLabelText('Motivo para pasar a «Anulada»');
    await usuario.type(motivo, 'se fue con otra agencia');
    await usuario.click(screen.getByRole('button', { name: 'Confirmar' }));

    await waitFor(() => expect(llamadas).toHaveLength(1));
    expect(llamadas[0]).toEqual({
      nombre: 'cambiar_estado_cotizacion',
      args: { p_quote: 'c-1', p_to: 'void', p_note: 'se fue con otra agencia' },
    });
  });

  it('lista lo ya emitido con su total y su huella', async () => {
    VERSIONES.push({
      id: 'v-1',
      version_no: 1,
      issued_at: '2026-11-04T12:00:00Z',
      snapshot: SNAPSHOT,
      totals: { moneda: 'PEN', decimales: 2, neto: '3200.00', impuesto: '576.00', total: '3776.00' },
      snapshot_sha256: 'f75ebe77f3f9aa11bb22cc33dd44ee55ff66aa77bb88cc99dd00ee11ff223344',
    });
    await montar('sent');

    expect(await screen.findByText('v1')).toBeTruthy();
    expect(screen.getByText(/3,776.00/)).toBeTruthy();
    expect(screen.getByText('f75ebe77')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Ver propuesta' }).getAttribute('href')).toBe(
      '/comercial/cotizaciones/c-1/propuesta/v/1',
    );
    // Con versiones, el botón pasa a ofrecer la siguiente.
    expect(screen.getByRole('button', { name: 'Reemitir como v2' })).toBeTruthy();
  });

  it('sin líneas no deja emitir', async () => {
    const { default: Emision } = await import('./Emision');
    const cliente = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(
      <QueryClientProvider client={cliente}>
        <MemoryRouter>
          <Emision cotizacion="c-1" estado="draft" conCostos hayLineas={false} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByText('Emisión');
    expect(screen.getByRole('button', { name: 'Emitir' }).hasAttribute('disabled')).toBe(true);
  });
});
