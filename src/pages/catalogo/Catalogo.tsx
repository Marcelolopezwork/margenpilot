import { NavLink, Outlet } from 'react-router-dom';
import { puedeVerCostos, useOrgElegida } from '../../app/org-context';

/**
 * El catálogo, con su propia navegación.
 *
 * «Costos» solo aparece para quien puede verlos. No es que la pestaña esconda
 * algo: para un rol comercial la base devuelve cero filas, y una pestaña vacía
 * se lee como «aquí falta algo» en vez de como «esto no es tuyo».
 */
export default function Catalogo() {
  const { organizacion } = useOrgElegida();
  const conCostos = puedeVerCostos(organizacion.rol);

  const subsecciones = [
    { ruta: 'servicios', nombre: 'Servicios' },
    ...(conCostos ? [{ ruta: 'costos', nombre: 'Costos' }] : []),
    { ruta: 'categorias', nombre: 'Categorías' },
  ];

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Catálogo" className="-mx-4 overflow-x-auto px-4">
        <ul className="flex gap-1">
          {subsecciones.map(({ ruta, nombre }) => (
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
