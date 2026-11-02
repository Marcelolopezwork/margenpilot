import { createContext, useContext } from 'react';
import type { User } from '@supabase/supabase-js';

export type Sesion = {
  /** True mientras no sabemos si hay sesión. No es «no hay sesión». */
  cargando: boolean;
  usuario: User | null;
  salir: () => Promise<void>;
};

export const SesionContext = createContext<Sesion | null>(null);

export function useSesion(): Sesion {
  const valor = useContext(SesionContext);
  if (!valor) throw new Error('useSesion necesita estar dentro de <SessionProvider>.');
  return valor;
}
