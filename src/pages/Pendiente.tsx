import { Link } from 'react-router-dom';
import { destinoDe } from '../app/navegacion';
import { Boton, Vacio } from '../components/ui';

/**
 * Lo que se ve en una sección que todavía no existe.
 *
 * No dice «próximamente»: dice qué va a vivir aquí, cuándo llega y —esto es lo
 * que hace que no sea una pantalla de adorno— qué parte de esa pregunta ya se
 * puede contestar hoy y dónde.
 *
 * La primera versión mandaba a Configuración y decía que lo único listo era la
 * base de datos. Era verdad en septiembre. Mientras el producto crece, un
 * hueco que no se actualiza deja de ser honesto y pasa a ser falso: ahora lo
 * que se ofrece mientras tanto viene de fuera, para que se mueva con el
 * producto y no con la fecha en que se escribió esta pantalla.
 */
export default function Pendiente({
  ruta,
  fase,
  mientras,
}: {
  ruta: string;
  fase: string;
  mientras: { texto: string; ruta: string; boton: string };
}) {
  const destino = destinoDe(ruta);
  if (!destino) return null;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold tracking-tight">{destino.nombre}</h1>
      <Vacio
        titulo={`${destino.nombre} llega con ${fase}`}
        explicacion={destino.para}
        siguiente={mientras.texto}
        accion={
          <Link to={mientras.ruta}>
            <Boton variante="primario">{mientras.boton}</Boton>
          </Link>
        }
      />
    </div>
  );
}
