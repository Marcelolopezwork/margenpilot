import { createClient } from '@supabase/supabase-js';

/**
 * Cliente de Supabase para el navegador.
 *
 * Solo la clave `anon`, nunca `service_role`: todo lo que este cliente puede
 * hacer está limitado por las políticas RLS de la base de datos. Si una
 * consulta devuelve menos de lo esperado, la respuesta correcta es revisar la
 * política, no subir de privilegios.
 */

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** True cuando falta configurar .env: la app lo dice en pantalla en vez de romperse. */
export const isConfigured = Boolean(url && anonKey);

export const supabase = isConfigured
  ? createClient(url as string, anonKey as string, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
  : null;

export function requireSupabase() {
  if (!supabase) {
    throw new Error(
      'Supabase no está configurado. Copia .env.example a .env y rellena VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY.',
    );
  }
  return supabase;
}
