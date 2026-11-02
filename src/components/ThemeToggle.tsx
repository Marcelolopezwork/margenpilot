import { useTema } from '../app/theme';
import type { Tema } from '../app/theme';
import { IconoLuna, IconoSistema, IconoSol } from './icons';

const OPCIONES: { valor: Tema; nombre: string; Icono: (p: { className?: string }) => React.ReactElement }[] = [
  { valor: 'sistema', nombre: 'Sistema', Icono: IconoSistema },
  { valor: 'claro', nombre: 'Claro', Icono: IconoSol },
  { valor: 'oscuro', nombre: 'Oscuro', Icono: IconoLuna },
];

/**
 * Tres estados, no dos. «Sistema» es el valor por defecto y tiene que poder
 * recuperarse: un conmutador de dos posiciones deja atrapado a quien quiere
 * seguir la preferencia del sistema operativo.
 *
 * Es un grupo de radios de verdad, así que las flechas del teclado funcionan
 * sin que tengamos que programarlas.
 */
export default function ThemeToggle() {
  const { tema, cambiar } = useTema();

  return (
    <fieldset className="flex rounded-control border border-border p-0.5">
      <legend className="sr-only">Tema de la interfaz</legend>
      {OPCIONES.map(({ valor, nombre, Icono }) => {
        const activo = tema === valor;
        return (
          <label
            key={valor}
            title={nombre}
            className={`flex h-9 w-9 cursor-pointer items-center justify-center rounded-control ${
              activo ? 'bg-surface-2 text-text' : 'text-subtle hover:text-text'
            }`}
          >
            <input
              type="radio"
              name="tema"
              value={valor}
              checked={activo}
              onChange={() => cambiar(valor)}
              className="sr-only"
            />
            <Icono className="h-4 w-4" />
            <span className="sr-only">{nombre}</span>
          </label>
        );
      })}
    </fieldset>
  );
}
