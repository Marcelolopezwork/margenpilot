import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { DESTINOS, RUTAS_MOVIL } from '../app/navegacion';
import { useSesion } from '../app/session-context';
import { escribir, leer } from '../lib/storage';
import { IconoCerrar, IconoMas } from './icons';
import OrgEntityPicker from './OrgEntityPicker';
import ThemeToggle from './ThemeToggle';
import { Boton } from './ui';

const movil = DESTINOS.filter((d) => RUTAS_MOVIL.includes(d.ruta));
const enHoja = DESTINOS.filter((d) => !RUTAS_MOVIL.includes(d.ruta));

function clasesEnlace(activo: boolean, colapsada: boolean) {
  return [
    'flex min-h-11 items-center gap-3 rounded-control text-sm',
    colapsada ? 'justify-center px-0' : 'px-3',
    activo ? 'bg-surface-2 font-medium text-text' : 'text-muted hover:bg-surface-2 hover:text-text',
  ].join(' ');
}

/**
 * El armazón: barra lateral en escritorio, barra inferior en móvil y una hoja
 * para lo que no cabe abajo. Se diseñó a 375 px y se expandió, no al revés.
 *
 * `aria-current` lo pone NavLink solo, que es lo que anuncia el destino actual
 * a un lector de pantalla. El color no basta.
 */
export default function AppShell() {
  const { usuario, salir } = useSesion();
  const [colapsada, setColapsada] = useState(() => leer('sidebar') === 'si');
  const [hoja, setHoja] = useState(false);
  const location = useLocation();
  const panelHoja = useRef<HTMLDivElement>(null);

  // Navegar cierra la hoja: si no, queda tapando la pantalla a la que acabas
  // de llegar.
  useEffect(() => setHoja(false), [location.pathname]);

  useEffect(() => {
    if (!hoja) return;
    panelHoja.current?.focus();
    const alPulsar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setHoja(false);
    };
    document.addEventListener('keydown', alPulsar);
    return () => document.removeEventListener('keydown', alPulsar);
  }, [hoja]);

  function alternarLateral() {
    const siguiente = !colapsada;
    setColapsada(siguiente);
    escribir('sidebar', siguiente ? 'si' : 'no');
  }

  return (
    <div className="min-h-screen lg:flex">
      <aside
        className={`hidden shrink-0 border-r border-border bg-surface lg:flex lg:flex-col ${
          colapsada ? 'lg:w-16' : 'lg:w-60'
        }`}
      >
        <div className={`flex h-14 items-center ${colapsada ? 'justify-center' : 'px-4'}`}>
          {colapsada ? (
            <span className="text-base font-semibold" aria-hidden="true">
              M
            </span>
          ) : (
            <span className="font-semibold tracking-tight">Margen Pilot</span>
          )}
        </div>

        <nav aria-label="Secciones" className="flex flex-1 flex-col gap-1 p-2">
          {DESTINOS.map(({ ruta, nombre, icono: Icono }) => (
            <NavLink
              key={ruta}
              to={ruta}
              end={ruta === '/'}
              title={colapsada ? nombre : undefined}
              className={({ isActive }) => clasesEnlace(isActive, colapsada)}
            >
              <Icono className="h-5 w-5 shrink-0" />
              {colapsada ? <span className="sr-only">{nombre}</span> : nombre}
            </NavLink>
          ))}
        </nav>

        <div className="p-2">
          <Boton
            variante="sutil"
            onClick={alternarLateral}
            aria-expanded={!colapsada}
            className="w-full"
          >
            {colapsada ? '›' : '‹ Colapsar'}
          </Boton>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between gap-3 border-b border-border bg-surface px-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="font-semibold tracking-tight lg:hidden">Margen Pilot</span>
            <OrgEntityPicker />
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <ThemeToggle />
            <Boton variante="sutil" onClick={() => void salir()} className="hidden lg:inline-flex">
              Salir
            </Boton>
          </div>
        </header>

        <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-24 pt-6 lg:pb-10">
          <Outlet />
        </main>
      </div>

      <nav
        aria-label="Secciones principales"
        className="fixed bottom-0 left-0 right-0 z-10 flex border-t border-border bg-surface lg:hidden"
      >
        {movil.map(({ ruta, nombre, icono: Icono }) => (
          <NavLink
            key={ruta}
            to={ruta}
            end={ruta === '/'}
            className={({ isActive }) =>
              `flex min-h-14 flex-1 flex-col items-center justify-center gap-1 text-xs ${
                isActive ? 'text-accent' : 'text-muted'
              }`
            }
          >
            <Icono className="h-5 w-5" />
            {nombre}
          </NavLink>
        ))}
        <button
          type="button"
          onClick={() => setHoja(true)}
          aria-expanded={hoja}
          className="flex min-h-14 flex-1 flex-col items-center justify-center gap-1 text-xs text-muted"
        >
          <IconoMas className="h-5 w-5" />
          Más
        </button>
      </nav>

      {hoja && (
        <div className="fixed inset-0 z-20 lg:hidden">
          <button
            type="button"
            aria-label="Cerrar el menú"
            onClick={() => setHoja(false)}
            className="absolute inset-0 bg-black/40"
          />
          <div
            ref={panelHoja}
            role="dialog"
            aria-modal="true"
            aria-label="Más secciones"
            tabIndex={-1}
            className="absolute bottom-0 left-0 right-0 rounded-t-card border-t border-border bg-surface p-4 pb-6"
          >
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-medium">Más</h2>
              <Boton variante="sutil" onClick={() => setHoja(false)} aria-label="Cerrar">
                <IconoCerrar className="h-4 w-4" />
              </Boton>
            </div>

            <nav aria-label="Más secciones" className="flex flex-col gap-1">
              {enHoja.map(({ ruta, nombre, icono: Icono }) => (
                <NavLink
                  key={ruta}
                  to={ruta}
                  className={({ isActive }) => clasesEnlace(isActive, false)}
                >
                  <Icono className="h-5 w-5" />
                  {nombre}
                </NavLink>
              ))}
            </nav>

            <div className="mt-4 border-t border-border pt-4">
              <p className="truncate text-xs text-subtle">{usuario?.email}</p>
              <Boton variante="secundario" onClick={() => void salir()} className="mt-2 w-full">
                Salir
              </Boton>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
