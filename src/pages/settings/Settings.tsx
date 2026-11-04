import { NavLink, Outlet } from 'react-router-dom';

const SUBSECCIONES = [
  { ruta: 'entidades', nombre: 'Entidades' },
  { ruta: 'marcas', nombre: 'Marcas' },
  { ruta: 'monedas', nombre: 'Monedas' },
  { ruta: 'impuestos', nombre: 'Impuestos' },
  { ruta: 'cuentas', nombre: 'Cuentas' },
  { ruta: 'categorias', nombre: 'Categorías' },
  { ruta: 'tipos-de-cambio', nombre: 'Tipo de cambio' },
] as const;

/**
 * Configuración, con su propia navegación. El orden no es alfabético: es el
 * orden en que hay que configurarlo, porque cada paso depende del anterior.
 * Una marca necesita una entidad; una cuenta necesita una entidad y una
 * moneda habilitada.
 */
export default function Settings() {
  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Configuración" className="-mx-4 overflow-x-auto px-4">
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
