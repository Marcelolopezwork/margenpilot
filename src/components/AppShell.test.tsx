// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import type { User } from '@supabase/supabase-js';
import { SesionContext } from '../app/session-context';
import { OrgContext } from '../app/org-context';
import type { ContextoOrg, Entidad } from '../app/org-context';
import AppShell from './AppShell';

/**
 * La aceptación de F1-12 es «navegable completo en 375 px y en escritorio,
 * teclado incluido». Eso no se comprueba mirando una captura: se comprueba
 * con el árbol de accesibilidad, que es lo que lee tanto un lector de
 * pantalla como alguien que solo usa el teclado.
 *
 * El armazón se monta con los contextos falsos a propósito: lo que se prueba
 * aquí es la navegación, no de dónde salen los datos.
 */

const entidad = (id: string, legal_name: string): Entidad => ({
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
});

function montar(sobre: Partial<ContextoOrg> = {}, rutas?: ReactNode) {
  const org: ContextoOrg = {
    cargando: false,
    error: null,
    organizaciones: [],
    organizacion: {
      id: 'org-1',
      // Un nombre distinto al de la app a propósito: si se llamara igual,
      // la aserción de abajo no distinguiría la marca del nombre de la
      // organización y la prueba pasaría por el motivo equivocado.
      name: 'Grupo de prueba',
      slug: 'grupo-de-prueba',
      country: 'PE',
      display_currency_code: 'PEN',
      requires_plan_reconciliation: false,
      created_by: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      rol: 'owner',
    },
    elegirOrganizacion: vi.fn(),
    entidades: [entidad('e-1', '3 Brothers MKT SAC'), entidad('e-2', 'The Publisher Ventures LLC')],
    entidad: null,
    elegirEntidad: vi.fn(),
    ...sobre,
  };

  const sesion = {
    cargando: false,
    usuario: { id: 'u-1', email: 'marcelo@ejemplo.test' } as unknown as User,
    salir: vi.fn(async () => {}),
  };

  render(
    <MemoryRouter initialEntries={['/']}>
      <SesionContext.Provider value={sesion}>
        <OrgContext.Provider value={org}>
          <Routes>
            <Route element={<AppShell />}>
              {rutas ?? <Route index element={<p>contenido</p>} />}
            </Route>
          </Routes>
        </OrgContext.Provider>
      </SesionContext.Provider>
    </MemoryRouter>,
  );

  return { org, sesion };
}

afterEach(cleanup);

describe('armazón de la app', () => {
  it('ofrece los siete destinos en la barra lateral', () => {
    montar();
    const lateral = within(screen.getByRole('navigation', { name: 'Secciones' }));
    for (const nombre of [
      'Inicio',
      'Comercial',
      'Catálogos',
      'Finanzas',
      'Pipeline',
      'Análisis',
      'Configuración',
    ]) {
      expect(lateral.getByRole('link', { name: nombre })).toBeDefined();
    }
  });

  it('marca el destino actual con aria-current, no solo con color', () => {
    montar();
    const lateral = within(screen.getByRole('navigation', { name: 'Secciones' }));
    expect(lateral.getByRole('link', { name: 'Inicio' }).getAttribute('aria-current')).toBe('page');
    expect(lateral.getByRole('link', { name: 'Finanzas' }).getAttribute('aria-current')).toBeNull();
  });

  it('deja en la barra inferior los tres destinos de móvil, no los siete', () => {
    montar();
    const inferior = within(screen.getByRole('navigation', { name: 'Secciones principales' }));
    expect(inferior.getAllByRole('link')).toHaveLength(3);
    expect(inferior.getByRole('button', { name: 'Más' })).toBeDefined();
  });

  it('abre la hoja de «Más» con el teclado y cierra con Escape', async () => {
    const usuario = userEvent.setup();
    montar();

    expect(screen.queryByRole('dialog')).toBeNull();

    const mas = screen.getByRole('button', { name: 'Más' });
    mas.focus();
    await usuario.keyboard('{Enter}');

    const hoja = screen.getByRole('dialog', { name: 'Más secciones' });
    expect(hoja.getAttribute('aria-modal')).toBe('true');
    // El foco va a la hoja: si no, el teclado se queda detrás del fondo.
    expect(document.activeElement).toBe(hoja);

    const dentro = within(hoja);
    for (const nombre of ['Catálogos', 'Pipeline', 'Análisis', 'Configuración']) {
      expect(dentro.getByRole('link', { name: nombre })).toBeDefined();
    }

    await usuario.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('ofrece las entidades y la opción de verlas todas', () => {
    montar();
    const selector = screen.getByLabelText('Entidad legal') as HTMLSelectElement;
    const opciones = Array.from(selector.options).map((o) => o.textContent);
    expect(opciones).toEqual([
      'Todas las entidades',
      '3 Brothers MKT SAC',
      'The Publisher Ventures LLC',
    ]);
    expect(selector.value).toBe('');
  });

  it('avisa del cambio de entidad en vez de recargar la página', async () => {
    const usuario = userEvent.setup();
    const { org } = montar();
    await usuario.selectOptions(screen.getByLabelText('Entidad legal'), 'e-1');
    expect(org.elegirEntidad).toHaveBeenCalledWith('e-1');
  });

  it('no dibuja un desplegable de un solo elemento para la organización', () => {
    montar();
    expect(screen.queryByLabelText('Organización')).toBeNull();
    expect(screen.getByTitle('Grupo de prueba').textContent).toBe('Grupo de prueba');
  });

  it('da tres opciones de tema, con «sistema» recuperable', () => {
    montar();
    const grupo = within(screen.getByRole('group', { name: 'Tema de la interfaz' }));
    const radios = grupo.getAllByRole('radio') as HTMLInputElement[];
    expect(radios.map((r) => r.value)).toEqual(['sistema', 'claro', 'oscuro']);
    expect(radios.find((r) => r.checked)?.value).toBe('sistema');
  });

  it('cambia el tema poniendo data-theme en el documento', async () => {
    const usuario = userEvent.setup();
    montar();
    await usuario.click(screen.getByRole('radio', { name: 'Oscuro' }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    await usuario.click(screen.getByRole('radio', { name: 'Sistema' }));
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });
});

/**
 * Lo que esta tanda vigila es lo que se veía como «se queda pegado en una
 * pantalla en blanco y hay que recargar». Son dos cosas distintas con el mismo
 * síntoma, y las dos tienen que estar cerradas:
 *
 *  · un fallo al dibujar una pantalla desmontaba el árbol entero, menú
 *    incluido, y dejaba la página en blanco sin un mensaje que nadie pudiera
 *    leer ni contar;
 *  · y cambiar de pantalla conservaba la posición del desplazamiento, así que
 *    quien venía de la mitad de una pantalla larga aterrizaba en una zona sin
 *    nada de la siguiente.
 */

function Rompe(): never {
  throw new Error('una fila que no me esperaba');
}

function Atras() {
  const navegar = useNavigate();
  return (
    <button type="button" onClick={() => navegar(-1)}>
      atrás
    </button>
  );
}

describe('cuando una pantalla se rompe', () => {
  it('enseña el fallo y deja el menú en pie, en vez de una página en blanco', () => {
    const consola = vi.spyOn(console, 'error').mockImplementation(() => {});
    montar({}, <Route index element={<Rompe />} />);

    expect(screen.getByText('Esta pantalla se rompió')).toBeDefined();
    // El menú sigue ahí: el fallo es de una sección, no de la aplicación.
    expect(screen.getByRole('navigation', { name: 'Secciones' })).toBeDefined();
    consola.mockRestore();
  });

  it('deja el texto técnico a la vista para poder mandarlo', async () => {
    const consola = vi.spyOn(console, 'error').mockImplementation(() => {});
    const usuario = userEvent.setup();
    montar({}, <Route index element={<Rompe />} />);

    await usuario.click(screen.getByText('Qué dice el fallo'));
    expect(screen.getByText(/una fila que no me esperaba/)).toBeDefined();
    consola.mockRestore();
  });
});

/* Dos pantallas de verdad: el desplazamiento solo se mide navegando. */
const DOS_PANTALLAS = (
  <>
    <Route index element={<p>inicio</p>} />
    <Route path="finanzas" element={<Atras />} />
  </>
);

describe('al cambiar de pantalla', () => {
  it('te deja arriba de la nueva', async () => {
    const mover = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    const usuario = userEvent.setup();
    montar({}, DOS_PANTALLAS);
    mover.mockClear();

    await usuario.click(
      within(screen.getByRole('navigation', { name: 'Secciones' })).getByRole('link', {
        name: 'Finanzas',
      }),
    );

    expect(mover).toHaveBeenCalledWith(0, 0);
    mover.mockRestore();
  });

  it('no te mueve cuando vuelves atrás, porque ahí la posición es la que esperas', async () => {
    const mover = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    const usuario = userEvent.setup();
    montar({}, DOS_PANTALLAS);

    await usuario.click(
      within(screen.getByRole('navigation', { name: 'Secciones' })).getByRole('link', {
        name: 'Finanzas',
      }),
    );
    mover.mockClear();

    // El botón está en Finanzas, que es donde acabamos de llegar.
    await usuario.click(screen.getByRole('button', { name: 'atrás' }));
    expect(mover).not.toHaveBeenCalled();
    mover.mockRestore();
  });
});
