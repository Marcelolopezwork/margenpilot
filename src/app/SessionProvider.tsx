import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { requireSupabase } from '../lib/supabase';
import { SesionContext } from './session-context';

/**
 * Sesión de Supabase, con el enlace por correo ya resuelto por el cliente
 * (`detectSessionInUrl`). Dos detalles que no son obvios:
 *
 * - `cargando` arranca en true. Sin eso, el primer render decide «no hay
 *   sesión» y manda a la pantalla de acceso a alguien que sí la tiene.
 * - Al entrar se asegura la fila de `profiles`. Es el único lugar donde se
 *   crea: la base no tiene disparador en `auth.users`, así que si no se hace
 *   aquí el perfil no existe nunca.
 */
export default function SessionProvider({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<User | null>(null);
  const [cargando, setCargando] = useState(true);
  const queryClient = useQueryClient();

  useEffect(() => {
    const supabase = requireSupabase();
    let vivo = true;

    void supabase.auth.getSession().then(({ data }) => {
      if (!vivo) return;
      setUsuario(data.session?.user ?? null);
      setCargando(false);
    });

    const { data: suscripcion } = supabase.auth.onAuthStateChange((evento, sesion) => {
      if (!vivo) return;
      setUsuario(sesion?.user ?? null);
      setCargando(false);
      // Al cambiar de usuario, lo cacheado es de otra persona.
      if (evento === 'SIGNED_OUT' || evento === 'SIGNED_IN') queryClient.clear();
    });

    return () => {
      vivo = false;
      suscripcion.subscription.unsubscribe();
    };
  }, [queryClient]);

  useEffect(() => {
    if (!usuario) return;
    const supabase = requireSupabase();
    void supabase
      .from('profiles')
      .upsert({ id: usuario.id, email: usuario.email ?? null }, { onConflict: 'id' })
      .then(({ error }) => {
        // No bloquea el uso de la app: el perfil solo guarda nombre y locale.
        if (error) console.warn('No se pudo asegurar el perfil:', error.message);
      });
  }, [usuario]);

  const salir = useCallback(async () => {
    await requireSupabase().auth.signOut();
  }, []);

  const valor = useMemo(() => ({ cargando, usuario, salir }), [cargando, usuario, salir]);

  return <SesionContext.Provider value={valor}>{children}</SesionContext.Provider>;
}
