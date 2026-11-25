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
 *  · los tres montones se ven de un vistazo, y el que sobra del libro
 *    también, que es el que nadie mira;
 *  · la propuesta se propone y la confirma una persona;
 *  · no hay forma de anotar un movimiento desde aquí (INV-8);
 *  · y apartar una línea exige un motivo escrito.
 */

const CUENTAS: Record<string, unknown>[] = [];
const EXTRACTOS: Record<string, unknown>[] = [];
const LINEAS: Record<string, unknown>[] = [];
const ESTADOS: Record<string, unknown>[] = [];
const MATCHES: Record<string, unknown>[] = [];
const MOVIMIENTOS: Record<string, unknown>[] = [];
const llamadas: { nombre: string; args: Record<string, unknown> }[] = [];

vi.mock('../../lib/supabase', () => {
  const datosDe = (nombre: string): Record<string, unknown>[] => {
    if (nombre === 'cash_accounts') return CUENTAS;
    if (nombre === 'bank_statements') return EXTRACTOS;
    if (nombre === 'bank_statement_lines') return LINEAS;
    if (nombre === 'bank_line_status') return ESTADOS;
    if (nombre === 'bank_line_matches') return MATCHES;
    if (nombre === 'cash_movements') return MOVIMIENTOS;
    return [];
  };
  const tabla = (nombre: string) => {
    const api: Record<string, unknown> = {
      then: (r: (v: unknown) => unknown) =>
        Promise.resolve({ data: datosDe(nombre), error: null }).then(r),
    };
    for (const m of ['select', 'eq', 'in', 'is', 'gte', 'lte', 'order', 'limit', 'not'])
      api[m] = () => api;
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

async function montar(rol: Enums<'membership_role'> = 'owner') {
  const { default: Conciliacion } = await import('./Conciliacion');
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
          <Conciliacion />
        </OrgContext.Provider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

function conDatos() {
  CUENTAS.push({
    id: 'cta-1',
    name: 'BCP soles',
    currency_code: 'PEN',
    legal_entity_id: 'e-1',
    bank_name: 'BCP',
  });
  EXTRACTOS.push({
    id: 'ext-1',
    label: 'BCP · noviembre',
    desde: '2026-11-01',
    hasta: '2026-11-30',
    lineas: 2,
    imported_at: '2026-11-30T10:00:00Z',
  });
  LINEAS.push(
    {
      id: 'l-1',
      statement_id: 'ext-1',
      fila: 1,
      value_date: '2026-11-03',
      direction: 'out',
      amount: '118.00',
      description: 'COMISION MANTENIMIENTO',
      external_ref: null,
      currency_code: 'PEN',
      ignored_reason: null,
    },
    {
      id: 'l-2',
      statement_id: 'ext-1',
      fila: 2,
      value_date: '2026-11-10',
      direction: 'in',
      amount: '1180.00',
      description: 'ABONO CLIENTE EJ',
      external_ref: null,
      currency_code: 'PEN',
      ignored_reason: null,
    },
  );
  // Solo hay movimiento para la segunda línea.
  MOVIMIENTOS.push({
    id: 'm-1',
    value_date: '2026-11-10',
    direction: 'in',
    amount: '1180.00',
    description: 'Cobro de EJ Deportes',
    external_ref: null,
    currency_code: 'PEN',
    kind: 'operating',
  });
  // Y uno que el banco no tiene.
  MOVIMIENTOS.push({
    id: 'm-2',
    value_date: '2026-11-20',
    direction: 'out',
    amount: '450.00',
    description: 'Cheque que nadie depositó',
    external_ref: null,
    currency_code: 'PEN',
    kind: 'operating',
  });
}

beforeEach(() => {
  for (const a of [CUENTAS, EXTRACTOS, LINEAS, ESTADOS, MATCHES, MOVIMIENTOS, llamadas])
    a.length = 0;
});

afterEach(cleanup);

describe('Finanzas · Conciliación', () => {
  it('al rol comercial le explica que esto no se lo enseña la base', async () => {
    await montar('commercial');
    expect(await screen.findByText('Esta sección es de finanzas')).toBeTruthy();
  });

  it('sin cuenta elegida explica por qué cada cuenta va por separado', async () => {
    await montar();
    expect(await screen.findByText('Elige una cuenta para empezar')).toBeTruthy();
    expect(screen.getByText(/no significaría nada, y la base lo impide/)).toBeTruthy();
  });

  it('enseña los tres montones, y el del libro también', async () => {
    conDatos();
    const usuario = userEvent.setup();
    await montar();
    // El selector se dibuja antes de que lleguen las cuentas: hay que esperar
    // a que la opción exista, no solo la etiqueta.
    await screen.findByRole('option', { name: /BCP soles/ });
    await usuario.selectOptions(screen.getByLabelText('Qué cuenta'), 'cta-1');

    // Dos veces cada una: la cifra de arriba y el título de su lista.
    expect(await screen.findAllByText('Sobra del banco')).toHaveLength(2);
    expect(screen.getAllByText('Sobra del libro')).toHaveLength(2);
    expect(screen.getByText('Cheque que nadie depositó')).toBeTruthy();
    expect(screen.getByText(/un cobro que diste por hecho y no llegó/)).toBeTruthy();
  });

  it('propone el movimiento que cuadra y lo confirma una persona', async () => {
    conDatos();
    const usuario = userEvent.setup();
    await montar();
    // El selector se dibuja antes de que lleguen las cuentas: hay que esperar
    // a que la opción exista, no solo la etiqueta.
    await screen.findByRole('option', { name: /BCP soles/ });
    await usuario.selectOptions(screen.getByLabelText('Qué cuenta'), 'cta-1');

    expect(await screen.findByText(/Parece «Cobro de EJ Deportes»/)).toBeTruthy();
    expect(screen.getByText(/mismo importe y mismo día/)).toBeTruthy();

    await usuario.click(screen.getByRole('button', { name: 'Es ese' }));
    await waitFor(() => expect(llamadas).toHaveLength(1));
    expect(llamadas[0]?.nombre).toBe('emparejar_linea');
    expect(llamadas[0]?.args).toMatchObject({ p_line: 'l-2', p_movement: 'm-1' });
  });

  it('la línea sin movimiento no se propone sola: no hay nada que proponer', async () => {
    conDatos();
    const usuario = userEvent.setup();
    await montar();
    // El selector se dibuja antes de que lleguen las cuentas: hay que esperar
    // a que la opción exista, no solo la etiqueta.
    await screen.findByRole('option', { name: /BCP soles/ });
    await usuario.selectOptions(screen.getByLabelText('Qué cuenta'), 'cta-1');

    await screen.findByText('COMISION MANTENIMIENTO');
    // La comisión no tiene movimiento, así que no hay botón «Es ese» para ella.
    expect(screen.getAllByRole('button', { name: 'Es ese' })).toHaveLength(1);
  });

  it('apartar una línea exige un motivo escrito', async () => {
    conDatos();
    const usuario = userEvent.setup();
    await montar();
    // El selector se dibuja antes de que lleguen las cuentas: hay que esperar
    // a que la opción exista, no solo la etiqueta.
    await screen.findByRole('option', { name: /BCP soles/ });
    await usuario.selectOptions(screen.getByLabelText('Qué cuenta'), 'cta-1');

    await usuario.click((await screen.findAllByRole('button', { name: 'Apartar' }))[0]!);
    expect(screen.getByText(/No se borra: se queda con el motivo escrito/)).toBeTruthy();

    await usuario.type(
      screen.getByLabelText('Por qué se aparta'),
      'Es la comisión de diciembre',
    );
    await usuario.click(screen.getByRole('button', { name: 'Apartarla' }));

    await waitFor(() => expect(llamadas).toHaveLength(1));
    expect(llamadas[0]?.nombre).toBe('ignorar_linea');
    expect(llamadas[0]?.args.p_motivo).toBe('Es la comisión de diciembre');
  });

  it('desde aquí no se puede anotar un movimiento (INV-8)', async () => {
    conDatos();
    const usuario = userEvent.setup();
    await montar();
    // El selector se dibuja antes de que lleguen las cuentas: hay que esperar
    // a que la opción exista, no solo la etiqueta.
    await screen.findByRole('option', { name: /BCP soles/ });
    await usuario.selectOptions(screen.getByLabelText('Qué cuenta'), 'cta-1');

    await screen.findAllByText('Sobra del banco');
    expect(screen.queryByRole('button', { name: /Anotar movimiento/ })).toBeNull();
    expect(screen.getByText(/desde aquí no se puede anotar, corregir ni borrar/)).toBeTruthy();
  });

  it('leer el archivo propone el mapeo y lo enseña antes de guardar nada', async () => {
    CUENTAS.push({
      id: 'cta-1',
      name: 'BCP soles',
      currency_code: 'PEN',
      legal_entity_id: 'e-1',
      bank_name: 'BCP',
    });
    const usuario = userEvent.setup();
    await montar();
    // El selector se dibuja antes de que lleguen las cuentas: hay que esperar
    // a que la opción exista, no solo la etiqueta.
    await screen.findByRole('option', { name: /BCP soles/ });
    await usuario.selectOptions(screen.getByLabelText('Qué cuenta'), 'cta-1');

    await usuario.click(await screen.findByLabelText('O pégalo aquí'));
    await usuario.paste(
      'Fecha;Descripción;Cargo;Abono\n03/11/2026;COMISION;118,00;\n10/11/2026;ABONO EJ;;1.180,00',
    );
    await usuario.click(screen.getByRole('button', { name: 'Leer el archivo' }));

    // Nada se ha guardado todavía: primero se confirma lo que se entendió.
    expect(llamadas).toHaveLength(0);
    expect(await screen.findByLabelText('La fecha')).toBeTruthy();
    expect(screen.getByText(/adivinar se propone, nunca se aplica solo/)).toBeTruthy();
    expect(screen.getByText('COMISION')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Importar 2 líneas' })).toBeTruthy();
  });

  it('importar manda las líneas ya leídas, con su signo', async () => {
    CUENTAS.push({
      id: 'cta-1',
      name: 'BCP soles',
      currency_code: 'PEN',
      legal_entity_id: 'e-1',
      bank_name: 'BCP',
    });
    const usuario = userEvent.setup();
    await montar();
    // El selector se dibuja antes de que lleguen las cuentas: hay que esperar
    // a que la opción exista, no solo la etiqueta.
    await screen.findByRole('option', { name: /BCP soles/ });
    await usuario.selectOptions(screen.getByLabelText('Qué cuenta'), 'cta-1');

    await usuario.click(await screen.findByLabelText('O pégalo aquí'));
    await usuario.paste('Fecha;Descripción;Cargo;Abono\n03/11/2026;COMISION;118,00;');
    await usuario.click(screen.getByRole('button', { name: 'Leer el archivo' }));

    await usuario.type(await screen.findByLabelText('Cómo se llama este extracto'), 'BCP nov');
    await usuario.click(screen.getByRole('button', { name: 'Importar 1 líneas' }));

    await waitFor(() => expect(llamadas).toHaveLength(1));
    expect(llamadas[0]?.nombre).toBe('importar_extracto');
    expect(llamadas[0]?.args.p_label).toBe('BCP nov');
    // El cargo sale negativo aunque en el archivo venga sin signo.
    expect(llamadas[0]?.args.p_lines).toMatchObject([
      { fecha: '2026-11-03', importe: '-118.00', descripcion: 'COMISION' },
    ]);
  });

  it('un archivo con varias cuentas pide elegir antes de dejar importar', async () => {
    CUENTAS.push({
      id: 'cta-1',
      name: 'Mercury USD',
      currency_code: 'USD',
      legal_entity_id: 'e-1',
      bank_name: 'Mercury',
    });
    const usuario = userEvent.setup();
    await montar();
    await screen.findByRole('option', { name: /Mercury USD/ });
    await usuario.selectOptions(screen.getByLabelText('Qué cuenta'), 'cta-1');

    // La forma real del export de Mercury: todas las cuentas en un CSV.
    await usuario.click(await screen.findByLabelText('O pégalo aquí'));
    await usuario.paste(
      'Date (UTC),Description,Amount,Status,Source Account\n' +
        '11-25-2026,Explee,-5.00,Sent,Mercury Credit\n' +
        '11-24-2026,Cliente,2125.00,Sent,OPERATING\n' +
        '10-28-2026,xAI,-102.27,Failed,Mercury Credit',
    );
    await usuario.click(screen.getByRole('button', { name: 'Leer el archivo' }));

    expect(await screen.findByText(/trae 2 cuentas distintas/)).toBeTruthy();
    await usuario.type(screen.getByLabelText('Cómo se llama este extracto'), 'Mercury nov');

    // Mientras no se elija la cuenta, no se puede importar.
    const boton = screen.getByRole('button', { name: /^Importar/ });
    expect(boton).toHaveProperty('disabled', true);

    await usuario.selectOptions(
      screen.getByLabelText('De qué cuenta son estas líneas'),
      'Mercury Credit',
    );
    await usuario.click(screen.getByRole('button', { name: /^Importar/ }));

    await waitFor(() => expect(llamadas).toHaveLength(1));
    // Solo la suya, y sin la rechazada: dos fuera por cuenta y una por estado.
    expect(llamadas[0]?.args.p_lines).toMatchObject([
      { fecha: '2026-11-25', importe: '-5.00', descripcion: 'Explee' },
    ]);
  });

  it('una tarjeta también se puede conciliar: su ciclo es donde más falta hace', async () => {
    CUENTAS.push({
      id: 'cta-card',
      name: 'Mercury Credit',
      currency_code: 'USD',
      legal_entity_id: 'e-1',
      bank_name: 'Mercury',
    });
    await montar();
    expect(await screen.findByRole('option', { name: /Mercury Credit/ })).toBeTruthy();
  });

  it('dice lo que todavía no hace: cerrar un periodo', async () => {
    await montar();
    expect(await screen.findByText(/Lo que todavía no hace esta pantalla: cerrar un periodo/)).toBeTruthy();
  });
});
