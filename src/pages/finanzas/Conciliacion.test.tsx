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
 *  · dice de un vistazo qué falta en cada lista, y cuántas son;
 *  · resuelve el caso normal en dos botones —confirmar lo que ya tenías,
 *    anotar lo que no— y no en una decisión por línea;
 *  · la frontera entre esos dos botones es lo delicado: lo que ya tenías
 *    apuntado se empareja, nunca se anota, porque anotarlo lo duplicaría;
 *  · lo parecido pero de otra fecha no entra en ninguna tanda: eso se mira
 *    una por una, y la lista detallada sigue estando para eso;
 *  · desde aquí no se corrige ni se borra un movimiento (INV-8);
 *  · apartar una línea exige un motivo escrito;
 *  · y el importador pregunta lo menos posible: el nombre del extracto se
 *    deduce del archivo y las columnas solo se tocan si algo no cuadró.
 */

const CUENTAS: Record<string, unknown>[] = [];
const EXTRACTOS: Record<string, unknown>[] = [];
const LINEAS: Record<string, unknown>[] = [];
const ESTADOS: Record<string, unknown>[] = [];
const MATCHES: Record<string, unknown>[] = [];
const MOVIMIENTOS: Record<string, unknown>[] = [];
const CIERRES: Record<string, unknown>[] = [];
const CATEGORIAS: Record<string, unknown>[] = [];
const llamadas: { nombre: string; args: Record<string, unknown> }[] = [];
/** Mensaje de error con el que falla la enésima llamada, contando desde 0. */
const FALLOS: string[] = [];

vi.mock('../../lib/supabase', () => {
  const datosDe = (nombre: string): Record<string, unknown>[] => {
    if (nombre === 'cash_accounts') return CUENTAS;
    if (nombre === 'bank_statements') return EXTRACTOS;
    if (nombre === 'bank_statement_lines') return LINEAS;
    if (nombre === 'bank_line_status') return ESTADOS;
    if (nombre === 'bank_line_matches') return MATCHES;
    if (nombre === 'cash_movements') return MOVIMIENTOS;
    if (nombre === 'bank_reconciliations') return CIERRES;
    if (nombre === 'financial_categories') return CATEGORIAS;
    return [];
  };
  const tabla = (nombre: string) => {
    const api: Record<string, unknown> = {
      then: (r: (v: unknown) => unknown) =>
        Promise.resolve({ data: datosDe(nombre), error: null }).then(r),
    };
    for (const m of ['select', 'eq', 'in', 'is', 'gte', 'lte', 'order', 'limit', 'not'])
      api[m] = () => api;
    // `maybeSingle` devuelve una fila o null, no un array: sin esto el mock
    // reventaría justo en la consulta del cierre.
    api['maybeSingle'] = () =>
      Promise.resolve({ data: datosDe(nombre)[0] ?? null, error: null });
    return api;
  };
  return {
    isConfigured: true,
    requireSupabase: () => ({
      from: (nombre: string) => tabla(nombre),
      rpc: (nombre: string, args: Record<string, unknown>) => {
        llamadas.push({ nombre, args });
        const falla = FALLOS[llamadas.length - 1];
        return Promise.resolve(
          falla ? { data: null, error: { message: falla } } : { data: null, error: null },
        );
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
    // Sin saldos declarados: «no se pudo comprobar», que no es «cuadra».
    saldo_inicial: null,
    saldo_final: null,
    diferencia: null,
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

/**
 * El detalle línea por línea está cerrado de entrada. Abrirlo es lo que hace
 * alguien que quiere revisar una, y es el punto de partida de las pruebas que
 * comprueban las acciones de una sola línea.
 */
async function abrirDetalle(usuario: ReturnType<typeof userEvent.setup>) {
  await usuario.click(
    await screen.findByRole('button', { name: 'Ver el detalle, línea por línea' }),
  );
}

beforeEach(() => {
  for (const a of [
    CUENTAS, EXTRACTOS, LINEAS, ESTADOS, MATCHES, MOVIMIENTOS, CIERRES, CATEGORIAS, llamadas,
    FALLOS,
  ])
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

  it('dice cuántas faltan antes de enseñar una sola línea', async () => {
    conDatos();
    const usuario = userEvent.setup();
    await montar();
    // El selector se dibuja antes de que lleguen las cuentas: hay que esperar
    // a que la opción exista, no solo la etiqueta.
    await screen.findByRole('option', { name: /BCP soles/ });
    await usuario.selectOptions(screen.getByLabelText('Qué cuenta'), 'cta-1');

    expect(await screen.findByText('Faltan 2 líneas por explicar')).toBeTruthy();
    // Y las separa por lo que hay que hacer con cada una, no por montones.
    expect(screen.getByText('1 línea es un movimiento que ya tenías')).toBeTruthy();
    expect(screen.getByText('1 línea no es ningún movimiento tuyo')).toBeTruthy();
    expect(screen.getByText('2 movimientos tuyos no están en el extracto')).toBeTruthy();
    // El detalle no está puesto: treinta filas pidiendo una decisión cada una
    // es lo que hacía que esta pantalla no se usara.
    expect(screen.queryByText('COMISION MANTENIMIENTO')).toBeNull();
  });

  it('el montón que nadie mira —lo que falta en el banco— también se enseña', async () => {
    conDatos();
    const usuario = userEvent.setup();
    await montar();
    await screen.findByRole('option', { name: /BCP soles/ });
    await usuario.selectOptions(screen.getByLabelText('Qué cuenta'), 'cta-1');
    // Se nombra en el resumen, sin abrir nada: es el que más dice.
    expect(await screen.findByText('2 movimientos tuyos no están en el extracto')).toBeTruthy();

    await abrirDetalle(usuario);
    expect(screen.getByText('Cheque que nadie depositó')).toBeTruthy();
    expect(screen.getAllByText(/un cobro que diste por hecho y no llegó/).length).toBeGreaterThan(
      0,
    );
  });

  it('propone el movimiento que cuadra y lo confirma una persona', async () => {
    conDatos();
    const usuario = userEvent.setup();
    await montar();
    // El selector se dibuja antes de que lleguen las cuentas: hay que esperar
    // a que la opción exista, no solo la etiqueta.
    await screen.findByRole('option', { name: /BCP soles/ });
    await usuario.selectOptions(screen.getByLabelText('Qué cuenta'), 'cta-1');

    await abrirDetalle(usuario);
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

    await abrirDetalle(usuario);
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

    await abrirDetalle(usuario);
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

  it('lo único que crea dinero es «Anotarlo», y se pide línea por línea', async () => {
    conDatos();
    CATEGORIAS.push({ id: 'cat-1', name: 'Comisiones bancarias', direction: 'out' });
    const usuario = userEvent.setup();
    await screen.findByRole; // nada: solo para mantener el orden de lectura
    await montar();
    await screen.findByRole('option', { name: /BCP soles/ });
    await usuario.selectOptions(screen.getByLabelText('Qué cuenta'), 'cta-1');
    await abrirDetalle(usuario);

    await screen.findByText('Las que faltan en tu libro');
    // No hay un botón genérico de alta: se anota una línea concreta.
    expect(screen.queryByRole('button', { name: /Anotar movimiento/ })).toBeNull();
    expect(
      screen.getByText(/no se puede corregir ni borrar un movimiento que ya existía/),
    ).toBeTruthy();

    await usuario.click((await screen.findAllByRole('button', { name: 'Anotarlo' }))[0]!);
    expect(screen.getByText(/Esto es lo único que crea dinero desde aquí/)).toBeTruthy();
    await usuario.selectOptions(screen.getByLabelText('Categoría'), 'cat-1');
    await usuario.click(screen.getByRole('button', { name: 'Anotarlo y emparejar' }));

    await waitFor(() => expect(llamadas).toHaveLength(1));
    expect(llamadas[0]?.nombre).toBe('crear_movimiento_desde_linea');
    expect(llamadas[0]?.args).toMatchObject({ p_line: 'l-1', p_category: 'cat-1' });
  });

  it('confirma en tanda lo que ya tenías apuntado, y no lo anota', async () => {
    conDatos();
    const usuario = userEvent.setup();
    await montar();
    await screen.findByRole('option', { name: /BCP soles/ });
    await usuario.selectOptions(screen.getByLabelText('Qué cuenta'), 'cta-1');

    expect(await screen.findByText('1 línea es un movimiento que ya tenías')).toBeTruthy();
    await usuario.click(screen.getByRole('button', { name: 'Confirmar la línea' }));

    await waitFor(() => expect(llamadas).toHaveLength(1));
    // Emparejar, nunca anotar: el movimiento ya existe y anotarlo lo duplicaría.
    expect(llamadas[0]?.nombre).toBe('emparejar_linea');
    expect(llamadas[0]?.args).toMatchObject({ p_line: 'l-2', p_movement: 'm-1' });
    expect(llamadas.some((l) => l.nombre === 'crear_movimiento_desde_linea')).toBe(false);
    expect(await screen.findByText(/No se movió ni un céntimo/)).toBeTruthy();
  });

  it('trae en tanda lo que no tenías, con la categoría elegida una sola vez', async () => {
    conDatos();
    CATEGORIAS.push({ id: 'cat-1', name: 'Comisiones bancarias', direction: 'out' });
    const usuario = userEvent.setup();
    await montar();
    await screen.findByRole('option', { name: /BCP soles/ });
    await usuario.selectOptions(screen.getByLabelText('Qué cuenta'), 'cta-1');

    expect(await screen.findByText('1 línea no es ningún movimiento tuyo')).toBeTruthy();
    // Y lo dice: esto es lo único de la pantalla que cambia el saldo.
    expect(screen.getByText(/Esto sí cambia tu saldo/)).toBeTruthy();
    // Y avisa del traspaso entre cuentas propias, que traído así sería un
    // gasto de la empresa que nunca ocurrió.
    expect(screen.getByText(/traspasos entre tus propias cuentas/)).toBeTruthy();

    await usuario.selectOptions(screen.getByLabelText('Categoría para los gastos'), 'cat-1');
    await usuario.click(screen.getByRole('button', { name: 'Traer la línea al libro' }));

    await waitFor(() => expect(llamadas).toHaveLength(1));
    expect(llamadas[0]?.nombre).toBe('crear_movimiento_desde_linea');
    expect(llamadas[0]?.args).toMatchObject({ p_line: 'l-1', p_category: 'cat-1' });
  });

  it('lo que se parece pero es de otra fecha no entra en ninguna tanda', async () => {
    conDatos();
    // Mismo importe que el cheque de m-2, tres días antes. Puede ser el mismo
    // pago o dos cosas distintas que valen lo mismo, y eso no lo decide esto.
    LINEAS.push({
      id: 'l-3',
      statement_id: 'ext-1',
      fila: 3,
      value_date: '2026-11-17',
      direction: 'out',
      amount: '450.00',
      description: 'CARGO SIN DETALLE',
      external_ref: null,
      currency_code: 'PEN',
      ignored_reason: null,
    });
    const usuario = userEvent.setup();
    await montar();
    await screen.findByRole('option', { name: /BCP soles/ });
    await usuario.selectOptions(screen.getByLabelText('Qué cuenta'), 'cta-1');

    expect(
      await screen.findByText('1 línea se parece a un movimiento tuyo, pero no es seguro'),
    ).toBeTruthy();
    // La tanda de traer sigue siendo solo la comisión: la dudosa queda fuera.
    expect(screen.getByRole('button', { name: 'Traer la línea al libro' })).toBeTruthy();
  });

  it('si una falla a la mitad de la tanda, dice cuántas quedaron hechas', async () => {
    conDatos();
    // Dos líneas que no son ningún movimiento: la segunda falla.
    LINEAS.push({
      id: 'l-4',
      statement_id: 'ext-1',
      fila: 4,
      value_date: '2026-11-18',
      direction: 'out',
      amount: '35.00',
      description: 'PORTES',
      external_ref: null,
      currency_code: 'PEN',
      ignored_reason: null,
    });
    FALLOS[1] = 'periodo_cerrado: esta cuenta está cuadrada hasta el 30/11/2026';
    const usuario = userEvent.setup();
    await montar();
    await screen.findByRole('option', { name: /BCP soles/ });
    await usuario.selectOptions(screen.getByLabelText('Qué cuenta'), 'cta-1');

    await usuario.click(
      await screen.findByRole('button', { name: 'Traer las 2 al libro' }),
    );

    expect(await screen.findByText(/Se hicieron 1 de 2 y la siguiente falló/)).toBeTruthy();
    expect(screen.getByText(/quedaron guardadas/)).toBeTruthy();
  });

  it('un extracto que no cuadra consigo mismo se dice antes que nada', async () => {
    conDatos();
    // Lo que delata un archivo cortado: la aritmética del propio banco.
    EXTRACTOS[0]!.saldo_inicial = '1000.00';
    EXTRACTOS[0]!.saldo_final = '2000.00';
    EXTRACTOS[0]!.diferencia = '120.00';
    const usuario = userEvent.setup();
    await montar();
    await screen.findByRole('option', { name: /BCP soles/ });
    await usuario.selectOptions(screen.getByLabelText('Qué cuenta'), 'cta-1');

    expect(await screen.findByText(/no cuadra con sus propios saldos/)).toBeTruthy();
    expect(screen.getByText(/S\/ 120.00 que sus líneas no explican/)).toBeTruthy();
    expect(screen.getByText(/el periodo no se puede cerrar/)).toBeTruthy();
  });

  it('sin saldos declarados no se inventa un descuadre: no es lo mismo que cuadrar', async () => {
    conDatos();
    const usuario = userEvent.setup();
    await montar();
    await screen.findByRole('option', { name: /BCP soles/ });
    await usuario.selectOptions(screen.getByLabelText('Qué cuenta'), 'cta-1');

    await screen.findByText('Faltan 2 líneas por explicar');
    expect(screen.queryByText(/no cuadra con sus propios saldos/)).toBeNull();
  });

  it('cerrar el periodo afirma una fecha, y reabrir la quita', async () => {
    conDatos();
    const usuario = userEvent.setup();
    await montar();
    await screen.findByRole('option', { name: /BCP soles/ });
    await usuario.selectOptions(screen.getByLabelText('Qué cuenta'), 'cta-1');

    expect(await screen.findByText('Sin cerrar')).toBeTruthy();
    expect(screen.getByText(/un cierre que admite líneas sueltas no afirma nada/)).toBeTruthy();

    await usuario.type(screen.getByLabelText('Cuadrado hasta'), '2026-11-30');
    await usuario.click(screen.getByRole('button', { name: 'Cerrar el periodo' }));

    await waitFor(() => expect(llamadas).toHaveLength(1));
    expect(llamadas[0]?.nombre).toBe('cerrar_conciliacion');
    expect(llamadas[0]?.args).toMatchObject({ p_account: 'cta-1', p_hasta: '2026-11-30' });
  });

  it('con el periodo cerrado, lo anterior deja de pedir atención', async () => {
    conDatos();
    CIERRES.push({ hasta: '2026-11-30', closed_at: '2026-12-01T10:00:00Z' });
    const usuario = userEvent.setup();
    await montar();
    await screen.findByRole('option', { name: /BCP soles/ });
    await usuario.selectOptions(screen.getByLabelText('Qué cuenta'), 'cta-1');

    expect(await screen.findByText('Cuadrado hasta el 30 nov. 2026')).toBeTruthy();
    // Las dos líneas son de noviembre: ninguna sigue pidiendo atención.
    await abrirDetalle(usuario);
    expect(screen.queryByText('COMISION MANTENIMIENTO')).toBeNull();
    expect(screen.getByRole('button', { name: 'Reabrir' })).toBeTruthy();
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

    await usuario.click(await screen.findByLabelText('El contenido del archivo'));
    await usuario.paste(
      'Fecha;Descripción;Cargo;Abono\n03/11/2026;COMISION;118,00;\n10/11/2026;ABONO EJ;;1.180,00',
    );
    await usuario.click(screen.getByRole('button', { name: 'Leer el archivo' }));

    // Nada se ha guardado todavía: primero se confirma lo que se entendió.
    expect(llamadas).toHaveLength(0);
    expect(await screen.findByLabelText('La fecha')).toBeTruthy();
    expect(screen.getByText(/si la fecha y el importe son los que ves en tu banco/)).toBeTruthy();
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

    await usuario.click(await screen.findByLabelText('El contenido del archivo'));
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
    await usuario.click(await screen.findByLabelText('El contenido del archivo'));
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
    const boton = screen.getByRole('button', { name: /^Importar \d/ });
    expect(boton).toHaveProperty('disabled', true);

    await usuario.selectOptions(
      screen.getByLabelText('De qué cuenta son estas líneas'),
      'Mercury Credit',
    );
    await usuario.click(screen.getByRole('button', { name: /^Importar \d/ }));

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

  it('dice lo que todavía no hace: recordar el mapeo de un mes para otro', async () => {
    await montar();
    expect(
      await screen.findByText(/recordar de un mes para otro qué columna era cuál/),
    ).toBeTruthy();
  });
});
