import { useState } from 'react';
import { format } from '../../lib/money';
import { alturaDeBarra, nombreMes, type SeriePorMes } from './resultado';

/**
 * Mes a mes: qué mes entró más y qué mes entró menos.
 *
 * Las decisiones que gobiernan este gráfico, que son casi todas de lectura y
 * no de dibujo:
 *
 *  1. **Los colores no son el verde y el rojo del resto de la app.** Verde
 *     contra rojo da ΔE 5,2 en deuteranopia: ocho de cada cien hombres verían
 *     dos barras del mismo color pegadas. Este azul contra este ocre dan 22,6.
 *     Para un número suelto el verde sigue bien —viene con su signo y su
 *     texto—, pero dos barras una al lado de otra no tienen signo.
 *  2. **Una sola escala.** Las entradas y las salidas se miden contra el mismo
 *     techo, que es el mayor de los dos. Dos escalas en el mismo gráfico
 *     inventarían una relación que no está en los datos; es el error de
 *     gráfico más repetido que existe.
 *  3. **Ninguna cifra depende del color.** Hay leyenda, el mejor y el peor mes
 *     están etiquetados con su importe, cada columna es un botón que dice
 *     todo lo suyo al enfocarlo o pasar por encima, y debajo hay una tabla con
 *     los doce meses. El color es un refuerzo, nunca el dato.
 *  4. **No se etiqueta cada barra.** Un número encima de cada columna es ruido
 *     y nadie lo lee. Se etiquetan dos: el mes de más y el de menos, que son
 *     la pregunta.
 *  5. **Un mes sin nada ocupa su sitio.** Si se saltara, dos meses separados
 *     por un verano muerto aparecerían pegados y la serie mentiría sobre el
 *     ritmo del negocio.
 */

const ALTO = 'h-40';
/**
 * El ancho de una columna y el hueco entre columnas, en un solo sitio: la
 * fila de barras y la fila de meses son dos listas distintas y tienen que
 * alinearse al píxel. Son dos porque la línea de base tiene que ser **una**
 * línea continua por debajo de todas las barras: dibujada columna a columna
 * se corta en cada hueco y lo que se ve es una línea de puntos, que es
 * justamente lo que un eje no debe parecer.
 */
const COLUMNA = 'w-[3.25rem] shrink-0';
const HUECO = 'gap-2';

function Llave({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted">
      {/* El color va en el cuadro, nunca en el texto: un ocre claro sobre la
          superficie no se lee, y la identidad la da el cuadro de al lado. */}
      <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-sm ${color}`} />
      {children}
    </span>
  );
}

export default function Barras({ serie }: { serie: SeriePorMes }) {
  const [encima, setEncima] = useState<string | null>(null);

  const mesesConAlgo = serie.meses.filter((m) => m.hechos > 0).length;

  // Un solo mes con datos no es una serie: es una cifra, y la cifra ya está
  // arriba. Dibujar una columna sola sería un gráfico de una barra.
  if (mesesConAlgo < 2) {
    return (
      <p className="text-sm text-muted">
        {mesesConAlgo === 0
          ? 'No hay ningún movimiento operativo en este periodo, así que no hay serie que dibujar.'
          : 'Solo hay un mes con movimiento en este periodo. Para ver el ritmo del negocio, elige «los últimos doce meses» arriba.'}
      </p>
    );
  }

  const detalle = serie.meses.find((m) => m.mes === encima);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <Llave color="bg-serie-entra">Entró</Llave>
        <Llave color="bg-serie-sale">Salió</Llave>
        <span className="text-xs text-subtle">Netos, sin impuesto · tope {format(serie.techo)}</span>
      </div>

      {/*
        El eje de meses va debajo y en el flujo normal, no dentro de una caja
        de alto fijo: una tarjeta cuyo alto deja fuera las etiquetas del eje
        acaba con una barra de scroll diminuta dentro.
      */}
      <div className="-mx-1 overflow-x-auto px-1 pb-1">
        <div className="min-w-max">
        <ul className={`flex ${HUECO} items-end border-y border-border`} role="list">
          {serie.meses.map((m) => {
            const activo = encima === m.mes;
            const esMejor = serie.mejor?.mes === m.mes;
            const esPeor = serie.peor?.mes === m.mes;
            return (
              <li key={m.mes} className={`flex ${COLUMNA} flex-col items-center gap-1 pb-px pt-1`}>
                {/*
                  La etiqueta directa, solo en los dos meses que importan, y
                  con una palabra en vez del importe: «S/ 11,756.00» mide
                  noventa píxeles y la columna cincuenta y dos, así que el
                  número se saldría de su columna y podría pisar al vecino. El
                  importe está en la frase de abajo, en la tabla y al enfocar
                  la columna; aquí solo hace falta saber cuál es cuál.
                */}
                <span
                  className={`h-4 whitespace-nowrap text-[10px] font-medium ${
                    esMejor || esPeor ? 'text-text' : 'text-transparent'
                  }`}
                >
                  {esMejor ? 'más' : esPeor ? 'menos' : '·'}
                </span>

                <button
                  type="button"
                  onMouseEnter={() => setEncima(m.mes)}
                  onMouseLeave={() => setEncima(null)}
                  onFocus={() => setEncima(m.mes)}
                  onBlur={() => setEncima(null)}
                  // Todo lo de la columna, dicho con palabras. Es lo que lee un
                  // lector de pantalla y lo que hace que el gráfico no dependa
                  // del color ni del ratón.
                  aria-label={`${nombreMes(m.mes)}: entró ${format(m.ingresos)}, salió ${format(
                    m.gastos,
                  )}, queda ${format(m.resultado)}${
                    esMejor ? '. Es el mes de más ingresos' : esPeor ? '. Es el mes de menos ingresos' : ''
                  }`}
                  className={`flex ${ALTO} w-full items-end justify-center rounded-control ${
                    activo ? 'bg-surface-2' : ''
                  }`}
                >
                  {/* Las dos barras, separadas por 2px de superficie: el hueco
                      es lo que las distingue, no un borde dibujado alrededor. */}
                  <span className="flex h-full w-full items-end justify-center gap-0.5">
                    <span
                      aria-hidden="true"
                      style={{ height: `${alturaDeBarra(m.ingresos, serie.techo)}%` }}
                      className="w-[0.6rem] max-w-[24px] rounded-t bg-serie-entra"
                    />
                    <span
                      aria-hidden="true"
                      style={{ height: `${alturaDeBarra(m.gastos, serie.techo)}%` }}
                      className="w-[0.6rem] max-w-[24px] rounded-t bg-serie-sale"
                    />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        {/*
          Los meses, fuera de la caja del gráfico y debajo de la línea de
          base. Van en su propia fila, con el mismo ancho y el mismo hueco,
          para que la base pueda ser una sola línea de lado a lado. Es
          `aria-hidden` porque cada columna ya dice su mes en la etiqueta del
          botón: aquí repetirlo solo haría que un lector de pantalla leyera
          doce meses sueltos sin nada al lado.
        */}
        <ul aria-hidden="true" className={`flex ${HUECO} pt-1`}>
          {serie.meses.map((m) => (
            <li
              key={m.mes}
              className={`${COLUMNA} whitespace-nowrap text-center text-[10px] text-subtle`}
            >
              {nombreMes(m.mes)}
            </li>
          ))}
        </ul>
        </div>
      </div>

      {/*
        Lo que el ratón o el teclado señalan. No es la única forma de leer un
        valor —para eso está la tabla—, así que no deja a nadie fuera.
      */}
      <p role="status" className="min-h-5 text-sm">
        {detalle ? (
          <>
            <span className="font-medium">{nombreMes(detalle.mes)}</span>
            <span className="text-muted">
              {' · entró '}
              {format(detalle.ingresos)}
              {' · salió '}
              {format(detalle.gastos)}
              {' · queda '}
            </span>
            <span className={detalle.resultado.minor < 0n ? 'text-negative' : 'text-positive'}>
              {format(detalle.resultado)}
            </span>
          </>
        ) : (
          <span className="text-subtle">
            Pasa por encima de un mes, o recórrelos con el tabulador, para ver sus cifras.
          </span>
        )}
      </p>

      {serie.mejor && serie.peor && serie.mejor.mes !== serie.peor.mes && (
        <p className="max-w-prose text-sm text-muted">
          El mes de más ingresos fue <span className="text-text">{nombreMes(serie.mejor.mes)}</span>{' '}
          con {format(serie.mejor.ingresos)}, y el de menos,{' '}
          <span className="text-text">{nombreMes(serie.peor.mes)}</span> con{' '}
          {format(serie.peor.ingresos)}. Los meses sin una sola operación no cuentan como «el
          peor»: son meses sin datos, que no es lo mismo que un mes malo.
        </p>
      )}

      {/*
        La tabla no es un extra: es la versión que se puede leer sin ver el
        gráfico, copiar y comprobar. Cada gráfico de este producto tiene la
        suya.
      */}
      <details className="text-sm">
        <summary className="min-h-11 cursor-pointer py-2 text-muted">
          Ver la tabla de los {serie.meses.length} meses
        </summary>
        <div className="overflow-x-auto">
          <table className="mt-2 w-full min-w-max text-sm">
            <caption className="sr-only">
              Ingresos, gastos y resultado por mes en {serie.moneda}
            </caption>
            <thead>
              <tr className="text-left text-xs text-subtle">
                <th scope="col" className="py-1 pr-4 font-normal">
                  Mes
                </th>
                <th scope="col" className="py-1 pr-4 text-right font-normal">
                  Entró
                </th>
                <th scope="col" className="py-1 pr-4 text-right font-normal">
                  Salió
                </th>
                <th scope="col" className="py-1 text-right font-normal">
                  Queda
                </th>
              </tr>
            </thead>
            <tbody>
              {serie.meses.map((m) => (
                <tr key={m.mes} className="border-t border-border">
                  <th scope="row" className="py-1 pr-4 text-left font-normal">
                    {nombreMes(m.mes)}
                  </th>
                  <td className="py-1 pr-4 text-right tabular-nums">{format(m.ingresos)}</td>
                  <td className="py-1 pr-4 text-right tabular-nums">{format(m.gastos)}</td>
                  <td
                    className={`py-1 text-right tabular-nums ${
                      m.resultado.minor < 0n ? 'text-negative' : ''
                    }`}
                  >
                    {format(m.resultado)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
