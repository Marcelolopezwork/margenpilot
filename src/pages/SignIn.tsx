import { useState } from 'react';
import { mensajeDeError } from '../lib/errors';
import { requireSupabase } from '../lib/supabase';
import { Aviso, Boton, Campo } from '../components/ui';

/**
 * Dos formas de entrar, y la contraseña es la principal a propósito.
 *
 * El enlace por correo parecía más cómodo hasta que se vio lo que cuesta:
 * depende de que el correo salga, llegue y no caiga en spam, y el servicio de
 * Supabase solo escribe a los miembros de su organización hasta que haya SMTP
 * propio (D-7). Con contraseña se entra sin depender de nada de eso.
 *
 * El enlace sigue ahí porque para un cliente que no quiere gestionar otra
 * contraseña es mejor, pero deja de ser el único camino.
 */
type Modo = 'clave' | 'enlace';

export default function SignIn() {
  const [modo, setModo] = useState<Modo>('clave');
  const [email, setEmail] = useState('');
  const [clave, setClave] = useState('');
  const [enviado, setEnviado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function entrar(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setOcupado(true);
    setError(null);
    try {
      const supabase = requireSupabase();
      if (modo === 'clave') {
        const { error: fallo } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password: clave,
        });
        if (fallo) throw fallo;
        // No hace falta navegar: el cambio de sesión lo detecta SessionProvider
        // y la app se redibuja entera.
      } else {
        const { error: fallo } = await supabase.auth.signInWithOtp({
          email: email.trim(),
          options: { emailRedirectTo: window.location.origin },
        });
        if (fallo) throw fallo;
        setEnviado(true);
      }
    } catch (causa) {
      setError(mensajeDeError(causa as { message?: string; code?: string }));
    } finally {
      setOcupado(false);
    }
  }

  function cambiarModo(siguiente: Modo) {
    setModo(siguiente);
    setError(null);
    setEnviado(false);
  }

  const pestana = (valor: Modo, texto: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={modo === valor}
      onClick={() => cambiarModo(valor)}
      className={`min-h-11 flex-1 rounded-control px-3 text-sm ${
        modo === valor ? 'bg-surface-2 font-medium text-text' : 'text-muted hover:text-text'
      }`}
    >
      {texto}
    </button>
  );

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-4 py-12">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Margen Pilot</h1>
        <p className="mt-2 text-sm text-muted">Del presupuesto al dinero en tu cuenta.</p>
      </header>

      <div role="tablist" aria-label="Forma de entrar" className="flex gap-1">
        {pestana('clave', 'Con contraseña')}
        {pestana('enlace', 'Con enlace')}
      </div>

      {enviado ? (
        <div
          role="status"
          className="rounded-card border border-border bg-positive-bg p-5 text-sm text-positive"
        >
          Te envié un enlace a <span className="font-medium">{email}</span>. Ábrelo en este mismo
          navegador para entrar.
        </div>
      ) : (
        <form onSubmit={entrar} className="flex flex-col gap-4">
          <Campo
            etiqueta="Correo"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          {modo === 'clave' && (
            <Campo
              etiqueta="Contraseña"
              type="password"
              required
              autoComplete="current-password"
              value={clave}
              onChange={(e) => setClave(e.target.value)}
            />
          )}

          {error && <Aviso tipo="error">{error}</Aviso>}

          <Boton type="submit" variante="primario" disabled={ocupado}>
            {ocupado ? 'Entrando…' : modo === 'clave' ? 'Entrar' : 'Enviar enlace de acceso'}
          </Boton>
        </form>
      )}

      {modo === 'enlace' && !enviado && (
        <p className="text-xs text-subtle">
          El enlace depende del correo. Si no llega, entra con contraseña.
        </p>
      )}
    </main>
  );
}
