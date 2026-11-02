import { createClient } from '@supabase/supabase-js';
import type { Database } from '../types/database';

/**
 * Cliente de Supabase para el navegador.
 *
 * Solo la clave pública, nunca `service_role`: todo lo que este cliente puede
 * hacer está limitado por las políticas RLS de la base de datos. Si una
 * consulta devuelve menos de lo esperado, la respuesta correcta es revisar la
 * política, no subir de privilegios.
 *
 * La clave `sb_publishable_…` es la recomendada y se rota por separado. Se
 * acepta también la `anon` antigua (un JWT) para no romper una configuración
 * que ya exista.
 */

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY;

/** True cuando falta configurar .env: la app lo dice en pantalla en vez de romperse. */
export const isConfigured = Boolean(url && anonKey);

export const supabase = isConfigured
  ? createClient<Database>(url as string, anonKey as string, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

export function requireSupabase() {
  if (!supabase) {
    throw new Error(
      'Supabase no está configurado. Copia .env.example a .env y rellena VITE_SUPABASE_URL y VITE_SUPABASE_PUBLISHABLE_KEY.',
    );
  }
  return supabase;
}
