import { NavLink, Outlet } from 'react-router-dom';

const SUBSECCIONES = [
  { ruta: 'cotizaciones', nombre: 'Cotizaciones' },
  { ruta: 'clientes', nombre: 'Clientes' },
] as const;

export default function Comercial() {
  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Comercial" className="-mx-4 overflow-x-auto px-4">
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
