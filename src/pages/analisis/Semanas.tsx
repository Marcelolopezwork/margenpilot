import { useState } from 'react';
import { formatoFecha } from '../../lib/format';
import { format, type Money } from '../../lib/money';
import type { SemanaDeCaja } from '../finanzas/proyeccion';

/**
 * El saldo que queda cada semana, trece semanas hacia delante.
 *
 * Lo que se dibuja no es lo que entra ni lo que sale: es **el saldo con el
 * que cierras cada semana**, que es la única cifra que contesta la pregunta
 * de verdad —«¿llego?»—. Entrada y salida están en la tabla de abajo.
 *
 * Tres decisiones:
 *
 *  1. **Hay una línea de cero y se cruza.** Un saldo negativo no es una barra
 *     corta: es estar en rojo, y se dibuja al otro lado de la línea. Lo que
 *     cambia de color es el signo, no la serie.
 *  2. **Una sola escala para los dos lados.** El alto de la zona de arriba y
 *     el de la de abajo se reparten según el máximo y el mínimo de verdad, y
 *     cada barra se mide contra ese mismo rango. Dos escalas —una por lado—
 *     harían que un bache de cien soles pareciera igual de profundo que un
 *     pico de diez mil.
 *  3. **Solo se etiqueta la semana en que cruzas a rojo.** Es la que hay que
 *     leer; las demás se consultan pasando por encima o en la tabla.
 *
 * No lleva tabla propia: va justo encima de la tabla de semanas de Inicio, y
 * dos tablas iguales seguidas son ruido.
 */

const ALTO = 'h-32';
const COLUMNA = 'w-[2.75rem] shrink-0';
const HUECO = 'gap-1.5';

export default function Semanas({
  semanas,
  saldos,
}: {
  semanas: readonly SemanaDeCaja[];
  /** El saldo al cierre de cada semana, en el mismo orden. */
  saldos: readonly Money[];
}) {
  const [encima, setEncima] = useState<number | null>(null);

  const cuantas = Math.min(semanas.length, saldos.length);
  if (cuantas < 2) return null;

  const valores = saldos.slice(0, cuantas).map((s) => s.minor);
  const techo = valores.reduce((a, b) => (b > a ? b : a), 0n);
  const suelo = valores.reduce((a, b) => (b < a ? b : a), 0n);
  const rango = techo - suelo;
  if (rango <= 0n) return null;

  // El reparto del alto entre lo que está por encima del cero y lo que está
  // por debajo. De aquí sale la única escala del gráfico.
  const arriba = (Number(techo) / Number(rango)) * 100;
  const abajo = 100 - arriba;

  const parte = (v: bigint, tope: bigint): number => {
    if (tope === 0n) return 0;
    const abs = v < 0n ? -v : v;
    const t = tope < 0n ? -tope : tope;
    return Math.max(1, Math.min(100, (Number(abs) / Number(t)) * 100));
  };

  const primeraEnRojo = valores.findIndex((v) => v < 0n);
  const detalle = encima === null ? null : semanas[encima];
  const saldoDetalle = encima === null ? null : saldos[encima];

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-subtle">
        Saldo al cierre de cada semana · {semanas[0]?.entra.currency} · entre{' '}
        {format({ minor: suelo, currency: semanas[0]!.entra.currency })} y{' '}
        {format({ minor: techo, currency: semanas[0]!.entra.currency })}
      </p>

      <div className="-mx-1 overflow-x-auto px-1">
        <div className="relative min-w-max">
          {/* La línea del cero, una sola y continua de lado a lado: dibujada
              columna a columna se vería cortada en cada hueco. */}
          <div
            aria-hidden="true"
            style={{ top: `${arriba}%` }}
            className="pointer-events-none absolute inset-x-0 border-t border-border"
          />

          <ul className={`flex ${HUECO} ${ALTO}`} role="list">
            {semanas.slice(0, cuantas).map((s, i) => {
              const saldo = saldos[i]!;
              const rojo = saldo.minor < 0n;
              const activo = encima === i;
              return (
                <li key={s.desde} className={`${COLUMNA} h-full`}>
                  <button
                    type="button"
                    onMouseEnter={() => setEncima(i)}
                    onMouseLeave={() => setEncima(null)}
                    onFocus={() => setEncima(i)}
                    onBlur={() => setEncima(null)}
                    aria-label={`Semana del ${formatoFecha(s.desde)}: entra ${format(
                      s.entra,
                    )}, sale ${format(s.sale)}, cierras con ${format(saldo)}${
                      i === primeraEnRojo ? '. Es la primera semana en rojo' : ''
                    }`}
                    className={`flex h-full w-full flex-col rounded-control ${
                      activo ? 'bg-surface-2' : ''
                    }`}
                  >
                    {/* Arriba del cero: la barra crece hacia arriba. */}
                    <span
                      style={{ height: `${arriba}%` }}
                      className="flex w-full items-end justify-center"
                    >
                      {!rojo && (
                        <span
                          aria-hidden="true"
                          style={{ height: `${parte(saldo.minor, techo)}%` }}
                          className="w-3 rounded-t bg-serie-entra"
                        />
                      )}
                    </span>
                    {/* Debajo: crece hacia abajo desde la misma línea. */}
                    <span
                      style={{ height: `${abajo}%` }}
                      className="flex w-full items-start justify-center"
                    >
                      {rojo && (
                        <span
                          aria-hidden="true"
                          style={{ height: `${parte(saldo.minor, suelo)}%` }}
                          className="w-3 rounded-b bg-serie-sale"
                        />
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          {/* Los lunes, fuera de la caja del gráfico, con el mismo ancho y el
              mismo hueco para que caigan bajo su columna. */}
          <ul aria-hidden="true" className={`flex ${HUECO} pt-1`}>
            {semanas.slice(0, cuantas).map((s) => (
              <li
                key={s.desde}
                className={`${COLUMNA} whitespace-nowrap text-center text-[10px] text-subtle`}
              >
                {s.desde.slice(8, 10)}/{s.desde.slice(5, 7)}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <p role="status" className="min-h-5 text-sm">
        {detalle && saldoDetalle ? (
          <>
            <span className="font-medium">Semana del {formatoFecha(detalle.desde)}</span>
            <span className="text-muted">
              {' · entra '}
              {format(detalle.entra)}
              {' · sale '}
              {format(detalle.sale)}
              {' · cierras con '}
            </span>
            <span className={saldoDetalle.minor < 0n ? 'text-negative' : 'text-positive'}>
              {format(saldoDetalle)}
            </span>
          </>
        ) : (
          <span className="text-subtle">
            Pasa por encima de una semana, o recórrelas con el tabulador, para ver sus cifras.
          </span>
        )}
      </p>
    </div>
  );
}
