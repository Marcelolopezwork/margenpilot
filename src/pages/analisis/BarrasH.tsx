import { useState } from 'react';
import { format, type Money } from '../../lib/money';
import { anchoDeBarra } from './resultado';

/**
 * Cuánto pesa cada uno: por cliente, por categoría, por proveedor.
 *
 * Barras horizontales y no un pastel, por la razón de siempre: comparar
 * ángulos es más difícil que comparar longitudes, y un pastel con nueve
 * porciones no se lee. Además aquí hay una pregunta que el pastel contesta
 * mal y la barra bien: **quién es el primero y cuánto le saca al segundo.**
 *
 * Las decisiones, que son las mismas que en el gráfico de meses:
 *
 *  1. **Un solo color para todas las barras.** La identidad la lleva el
 *     nombre escrito al lado, no el color. Un color por cliente obligaría a
 *     inventar un tono nuevo con cada cliente nuevo, y a partir del cuarto o
 *     quinto nadie distingue de quién es cuál. El color aquí solo dice «esto
 *     es una magnitud».
 *  2. **Una sola escala**, el mayor de la lista. Cada barra se lee contra el
 *     primero, que es la comparación que importa.
 *  3. **El porcentaje del total se dice con palabras**, no con el ancho: dos
 *     barras parecidas no se distinguen a ojo y la concentración de un
 *     cliente es justo lo que hay que poder ver.
 *  4. **La tabla va debajo, dentro de un `details`.** Es la versión que se
 *     puede copiar, leer sin ver y comprobar.
 *
 * `destacar` es para el caso de la concentración: si un solo cliente pesa más
 * de la mitad, eso no es una barra más larga, es un riesgo, y se dice.
 */

export interface FilaDeBarra {
  clave: string;
  nombre: string;
  total: Money;
  /** Lo que va debajo del nombre: «3 documentos», «2 facturas». */
  nota?: string;
}

export default function BarrasH({
  filas,
  rotulo,
  moneda,
  destacarSobre,
}: {
  filas: readonly FilaDeBarra[];
  /** Qué se está midiendo. Un gráfico de una serie no lleva leyenda: lleva título. */
  rotulo: string;
  moneda: string;
  /**
   * A partir de qué porcentaje del total una fila merece una advertencia, si
   * alguna. Sin esto no se destaca ninguna.
   */
  destacarSobre?: number | undefined;
}) {
  const [encima, setEncima] = useState<string | null>(null);

  if (filas.length === 0) return null;

  const ordenadas = [...filas].sort((a, b) => (a.total.minor < b.total.minor ? 1 : -1));
  const techo = ordenadas[0]!.total;
  const total = ordenadas.reduce(
    (suma, f) => ({ minor: suma.minor + f.total.minor, currency: f.total.currency }),
    { minor: 0n, currency: techo.currency },
  );

  const parte = (valor: Money): number =>
    total.minor <= 0n ? 0 : (Number(valor.minor) / Number(total.minor)) * 100;

  const detalle = ordenadas.find((f) => f.clave === encima);
  const concentrada =
    destacarSobre !== undefined && ordenadas.length > 1 && parte(techo) >= destacarSobre
      ? ordenadas[0]!
      : null;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-subtle">
        {rotulo} · {moneda} · de mayor a menor, medidos contra el primero
      </p>

      <ul className="flex flex-col gap-2" role="list">
        {ordenadas.map((f) => {
          const activo = encima === f.clave;
          return (
            <li key={f.clave}>
              <button
                type="button"
                onMouseEnter={() => setEncima(f.clave)}
                onMouseLeave={() => setEncima(null)}
                onFocus={() => setEncima(f.clave)}
                onBlur={() => setEncima(null)}
                aria-label={`${f.nombre}: ${format(f.total)}, el ${parte(f.total).toFixed(
                  0,
                )} por ciento del total${f.nota ? `, ${f.nota}` : ''}`}
                className={`w-full rounded-control px-2 py-1 text-left ${
                  activo ? 'bg-surface-2' : ''
                }`}
              >
                <span className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-sm">{f.nombre}</span>
                  <span className="num shrink-0 text-sm font-medium">{format(f.total)}</span>
                </span>
                {/* La barra, con el riel detrás: sin riel, una barra corta
                    parece un error de dibujo en vez de una cifra pequeña. */}
                <span
                  aria-hidden="true"
                  className="mt-1 block h-2 w-full overflow-hidden rounded-sm bg-surface-2"
                >
                  <span
                    style={{ width: `${anchoDeBarra(f.total, techo)}%` }}
                    className="block h-full rounded-sm bg-serie-entra"
                  />
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <p role="status" className="min-h-5 text-sm">
        {detalle ? (
          <>
            <span className="font-medium">{detalle.nombre}</span>
            <span className="text-muted">
              {' · '}
              {format(detalle.total)}
              {' · el '}
              {parte(detalle.total).toFixed(0)} % del total
              {detalle.nota ? ` · ${detalle.nota}` : ''}
            </span>
          </>
        ) : (
          <span className="text-subtle">
            Pasa por encima de una barra, o recórrelas con el tabulador, para ver su parte del
            total.
          </span>
        )}
      </p>

      {concentrada && (
        <p className="max-w-prose text-sm text-warning">
          <span className="font-medium">{concentrada.nombre}</span> es el{' '}
          {parte(concentrada.total).toFixed(0)} % de este total. Un solo nombre que pesa más que
          todos los demás juntos no es una buena noticia disfrazada de cifra alta: es el riesgo de
          que un mes sin él sea un mes sin nada.
        </p>
      )}

      <details className="text-sm">
        <summary className="min-h-11 cursor-pointer py-2 text-muted">
          Ver la tabla {filas.length === 1 ? 'de la fila' : `de las ${filas.length} filas`}
        </summary>
        <div className="overflow-x-auto">
          <table className="mt-2 w-full min-w-max text-sm">
            <caption className="sr-only">
              {rotulo} en {moneda}
            </caption>
            <thead>
              <tr className="text-left text-xs text-subtle">
                <th scope="col" className="py-1 pr-4 font-normal">
                  Nombre
                </th>
                <th scope="col" className="py-1 pr-4 text-right font-normal">
                  Total
                </th>
                <th scope="col" className="py-1 text-right font-normal">
                  Parte
                </th>
              </tr>
            </thead>
            <tbody>
              {ordenadas.map((f) => (
                <tr key={f.clave} className="border-t border-border">
                  <th scope="row" className="py-1 pr-4 text-left font-normal">
                    {f.nombre}
                    {f.nota ? <span className="text-xs text-subtle"> · {f.nota}</span> : null}
                  </th>
                  <td className="py-1 pr-4 text-right tabular-nums">{format(f.total)}</td>
                  <td className="py-1 text-right tabular-nums">{parte(f.total).toFixed(0)} %</td>
                </tr>
              ))}
              <tr className="border-t border-border font-medium">
                <th scope="row" className="py-1 pr-4 text-left">
                  Total
                </th>
                <td className="py-1 pr-4 text-right tabular-nums">{format(total)}</td>
                <td className="py-1 text-right tabular-nums">100 %</td>
              </tr>
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
