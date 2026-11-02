import { Link } from 'react-router-dom';
import { destinoDe } from '../app/navegacion';
import { Boton, Vacio } from '../components/ui';

/**
 * Lo que se ve en una sección que todavía no existe.
 *
 * No dice «próximamente»: dice qué va a vivir aquí, en qué fase llega y qué
 * se puede hacer hoy en su lugar. Un hueco honesto es mejor que una pantalla
 * de adorno que finge ser un producto.
 */
export default function Pendiente({ ruta, fase }: { ruta: string; fase: string }) {
  const destino = destinoDe(ruta);
  if (!destino) return null;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold tracking-tight">{destino.nombre}</h1>
      <Vacio
        titulo={`${destino.nombre} llega con ${fase}`}
        explicacion={destino.para}
        siguiente="Hoy lo que está listo es la base de datos y la configuración. Empieza por dejar las entidades, las monedas y las cuentas como las necesitas: todo lo demás se apoya en eso."
        accion={
          <Link to="/configuracion">
            <Boton variante="primario">Ir a Configuración</Boton>
          </Link>
        }
      />
    </div>
  );
}
