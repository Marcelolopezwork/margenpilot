import { NavLink, Outlet } from 'react-router-dom';

/**
 * Análisis tiene dos lentes y no uno.
 *
 * Resultado mira un periodo: cuánto entró y cuánto salió entre dos fechas.
 * Trabajos mira una pieza de trabajo de punta a punta, sin importar en qué
 * mes cayó cada factura. Son preguntas distintas y las dos cifras pueden no
 * parecerse: un trabajo rentable que se cobra en enero y se paga en marzo
 * deja un enero magnífico y un marzo malo, y ninguno de los dos meses dice
 * nada sobre el trabajo.
 */
const SUBSECCIONES = [
  { ruta: 'resultado', nombre: 'Resultado' },
  { ruta: 'trabajos', nombre: 'Trabajos' },
] as const;

export default function Analisis() {
  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Análisis" className="-mx-4 overflow-x-auto px-4">
        <ul className="flex gap-1">
          {SUBSECCIONES.map(({ ruta, nombre }) => (
            <li key={ruta}>
              <NavLink
                to={ruta}
                className={({ isActive }) =>
                  `inline-flex min-h-11 items-center whitespace-nowrap rounded-control px-3 text-sm ${
                    isActive
                      ? 'bg-surface-2 font-medium text-text'
                      : 'text-muted hover:bg-surface-2 hover:text-text'
                  }`
                }
              >
                {nombre}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <Outlet />
    </div>
  );
}
