import { useCallback, useEffect, useState } from 'react';
import { borrar, escribir, leer } from '../lib/storage';

/**
 * Tema claro/oscuro con tres estados, no dos: «sistema» tiene que existir,
 * porque es lo que respeta la preferencia del sistema operativo y es el valor
 * por defecto.
 *
 * Los colores viven como variables CSS en index.css. Aquí solo se pone el
 * atributo `data-theme` en <html>, que es lo que las conmuta.
 */

export type Tema = 'sistema' | 'claro' | 'oscuro';

const CLAVE = 'tema';

function esTema(valor: string | null): valor is Tema {
  return valor === 'sistema' || valor === 'claro' || valor === 'oscuro';
}

function aplicar(tema: Tema): void {
  const raiz = document.documentElement;
  if (tema === 'sistema') raiz.removeAttribute('data-theme');
  else raiz.setAttribute('data-theme', tema === 'claro' ? 'light' : 'dark');
}

/** Lee la preferencia guardada antes del primer render, para no parpadear. */
export function temaGuardado(): Tema {
  const valor = leer(CLAVE);
  return esTema(valor) ? valor : 'sistema';
}

/**
 * Se llama una vez antes del primer render. Sin esto, quien eligió oscuro ve
 * un fogonazo claro mientras React monta.
 */
export function aplicarTemaGuardado(): void {
  aplicar(temaGuardado());
}

export function useTema(): { tema: Tema; cambiar: (siguiente: Tema) => void } {
  const [tema, setTema] = useState<Tema>(temaGuardado);

  useEffect(() => {
    aplicar(tema);
  }, [tema]);

  const cambiar = useCallback((siguiente: Tema) => {
    setTema(siguiente);
    if (siguiente === 'sistema') borrar(CLAVE);
    else escribir(CLAVE, siguiente);
  }, []);

  return { tema, cambiar };
}
