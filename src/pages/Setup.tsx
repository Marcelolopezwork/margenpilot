/**
 * Lo que se ve cuando falta configurar Supabase.
 * No es una pantalla de error: es una lista de lo que hay que hacer.
 */
export default function Setup() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-4 py-12">
      <header>
        <p className="text-xs uppercase tracking-widest text-subtle">Configuración pendiente</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Margen Pilot</h1>
        <p className="mt-3 text-muted">
          Falta conectar la base de datos. Son tres pasos y se hacen una sola vez.
        </p>
      </header>

      <ol className="flex flex-col gap-4">
        <li className="rounded-card border border-border bg-surface p-5">
          <h2 className="font-medium">1 · Crea el proyecto en Supabase</h2>
          <p className="mt-1 text-sm text-muted">
            En <span className="text-text">supabase.com</span>, proyecto nuevo. Región cercana a
            Perú y contraseña de base de datos guardada en tu gestor, no en un archivo.
          </p>
        </li>
        <li className="rounded-card border border-border bg-surface p-5">
          <h2 className="font-medium">2 · Copia las dos claves públicas</h2>
          <p className="mt-1 text-sm text-muted">
            En <span className="text-text">Project Settings → API</span>, copia la URL del proyecto
            y la clave <code className="text-text">anon</code>. La clave{' '}
            <code className="text-text">service_role</code> no se usa aquí y no debe salir del
            panel.
          </p>
        </li>
        <li className="rounded-card border border-border bg-surface p-5">
          <h2 className="font-medium">3 · Crea el archivo .env</h2>
          <p className="mt-1 text-sm text-muted">
            Copia <code className="text-text">.env.example</code> a{' '}
            <code className="text-text">.env</code>, pega los dos valores y reinicia{' '}
            <code className="text-text">npm run dev</code>.
          </p>
          <pre className="num mt-3 overflow-x-auto rounded-control bg-surface-2 p-3 text-xs text-muted">
            {'VITE_SUPABASE_URL=https://xxxxx.supabase.co\nVITE_SUPABASE_ANON_KEY=eyJ...'}
          </pre>
        </li>
      </ol>

      <p className="text-xs text-subtle">
        .env está en .gitignore: no se sube al repositorio y no se comparte por chat.
      </p>
    </main>
  );
}
