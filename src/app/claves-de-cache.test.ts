import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Dos consultas con la misma clave de caché tienen que devolver la misma
 * forma. React Query guarda **una** entrada por clave: la última que responde
 * gana, y la pantalla que esperaba otra cosa lee campos que no existen.
 *
 * Ha pasado dos veces, y la segunda llegó como «se queda pegado en la pantalla
 * en blanco»: Inicio y Compras compartían `['compras', org, entidad]` con
 * formas distintas —una devuelve filas planas, la otra `{ compra, pagado,
 * pendiente }`—, así que entrar a Compras después de Inicio reventaba con
 * «Cannot read properties of undefined (reading 'currency_code')». Lo mismo
 * pasaba, sin reventar y por eso peor, con `saldos`, `cartera`,
 * `gastos-fijos`, `servicios`, `clientes`, `marcas` y `monedas`: cifras y
 * nombres en blanco, cuentas que desaparecían de una lista.
 *
 * La regla que esta prueba impone es la única que no se puede olvidar: **una
 * clave, un dueño.** Si dos pantallas necesitan lo mismo, la consulta se
 * escribe una vez y se comparte —como `useMonedasCatalogo` en `consultas.ts`—;
 * si necesitan cosas distintas, las claves se distinguen con un segundo
 * elemento que diga para qué es: `['compras', 'inicio', …]` y
 * `['compras', 'cartera', …]`. Invalidar por `['compras']` sigue alcanzando a
 * las dos, que es lo que hacía útil compartir la clave.
 */

// `fileURLToPath` y no `.pathname`: la ruta del proyecto tiene espacios y
// vendrían escapados como %20.
const RAIZ = fileURLToPath(new URL('..', import.meta.url));

function fuentes(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) return fuentes(ruta);
    if (!/\.tsx?$/.test(nombre) || /\.test\.tsx?$/.test(nombre)) return [];
    return [ruta];
  });
}

/** Cada `useQuery` con la clave que declara, tal como está escrita. */
function consultasDeclaradas(): { clave: string; donde: string }[] {
  const encontradas: { clave: string; donde: string }[] = [];

  for (const ruta of fuentes(RAIZ)) {
    const texto = readFileSync(ruta, 'utf8');
    const corto = ruta.slice(RAIZ.length);

    // `useQuery({` seguido, con comentarios por medio o sin ellos, de su
    // clave. El orden está impuesto por la comprobación de abajo.
    const re = /useQuery\(\{\s*((?:\/\/[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*)*)queryKey:\s*(\[[^\]]*\])/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(texto)) !== null) {
      encontradas.push({ clave: m[2]!.replace(/\s+/g, ' '), donde: corto });
    }

    // Una `useQuery` que no empiece por su clave se escaparía del escrutinio
    // sin que nadie lo notara, así que aquí se cuenta y se compara.
    const cuantas = (texto.match(/useQuery\(\{/g) ?? []).length;
    const conClave = (texto.match(re) ?? []).length;
    expect(
      conClave,
      `En ${corto} hay ${cuantas} useQuery y ${conClave} empiezan por queryKey. ` +
        'La clave va primero, o esta prueba deja de ver la consulta.',
    ).toBe(cuantas);
  }

  return encontradas;
}

describe('claves de caché', () => {
  it('ninguna clave tiene dos dueños', () => {
    const porClave = new Map<string, string[]>();
    for (const { clave, donde } of consultasDeclaradas()) {
      porClave.set(clave, [...(porClave.get(clave) ?? []), donde]);
    }

    const repetidas = [...porClave.entries()]
      .filter(([, donde]) => donde.length > 1)
      .map(([clave, donde]) => `${clave} → ${[...new Set(donde)].join(' y ')}`);

    expect(
      repetidas,
      'Dos consultas con la misma clave: la última que responda le dará sus ' +
        'filas a la otra pantalla. Compártelas en consultas.ts si son lo ' +
        'mismo, o distínguelas con un segundo elemento si no lo son.',
    ).toEqual([]);
  });

  it('encuentra las consultas que tiene que vigilar', () => {
    // Una red que no ve nada pasa siempre. Si el patrón deja de encajar con
    // cómo se escriben las consultas, esto se cae antes que la de arriba.
    expect(consultasDeclaradas().length).toBeGreaterThan(40);
  });
});
