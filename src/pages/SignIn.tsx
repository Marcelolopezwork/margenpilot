import { useState } from 'react';
import { requireSupabase } from '../lib/supabase';

export default function SignIn() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // Enlace por correo: sin contraseñas que gestionar ni que filtrar.
      const { error: authError } = await requireSupabase().auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.origin },
      });
      if (authError) throw authError;
      setSent(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo enviar el enlace.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-4 py-12">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Margen Pilot</h1>
        <p className="mt-2 text-sm text-muted">
          Del presupuesto al dinero en tu cuenta.
        </p>
      </header>

      {sent ? (
        <div
          role="status"
          className="rounded-card border border-border bg-positive-bg p-5 text-sm text-positive"
        >
          Te envié un enlace a <span className="font-medium">{email}</span>. Ábrelo en este mismo
          navegador para entrar.
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label htmlFor="email" className="mb-1 block text-xs text-subtle">
              Correo
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-control border border-border bg-surface px-3 py-2 text-text"
              aria-describedby={error ? 'signin-error' : undefined}
            />
          </div>

          {error && (
            <p id="signin-error" role="alert" className="text-sm text-negative">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="min-h-11 rounded-control bg-accent px-4 font-medium text-accent-fg disabled:opacity-50"
          >
            {busy ? 'Enviando…' : 'Enviar enlace de acceso'}
          </button>
        </form>
      )}
    </main>
  );
}
