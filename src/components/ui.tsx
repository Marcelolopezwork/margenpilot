import { useId } from 'react';

/**
 * Las piezas que repite toda la app. Existen para que ninguna pantalla se
 * invente su propio botón ni su propio campo: eso es lo que hace que una
 * interfaz se vea cosida a mano.
 *
 * Reglas que no se negocian aquí (UI_UX_PLAN.md §6):
 * - Todo control táctil mide 44 px de alto como mínimo (`min-h-11`).
 * - Todo campo tiene su `<label>` asociada por id, no un placeholder que
 *   desaparece al escribir.
 * - El foco nunca se quita: el `:focus-visible` global de index.css manda.
 */

const VARIANTES = {
  primario: 'bg-accent text-accent-fg hover:opacity-90',
  secundario: 'border border-border bg-surface text-text hover:bg-surface-2',
  sutil: 'text-muted hover:bg-surface-2 hover:text-text',
  peligro: 'border border-border bg-negative-bg text-negative hover:opacity-90',
} as const;

type BotonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variante?: keyof typeof VARIANTES;
};

export function Boton({ variante = 'secundario', className = '', ...resto }: BotonProps) {
  return (
    <button
      {...resto}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-control px-4 text-sm font-medium transition-opacity disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTES[variante]} ${className}`}
    />
  );
}

const CONTROL =
  'min-h-11 w-full rounded-control border border-border bg-surface px-3 text-text placeholder:text-subtle disabled:opacity-60';

type CampoProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'id' | 'className'> & {
  etiqueta: string;
  ayuda?: string | undefined;
};

export function Campo({ etiqueta, ayuda, ...resto }: CampoProps) {
  const id = useId();
  const idAyuda = `${id}-ayuda`;
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs text-subtle">
        {etiqueta}
      </label>
      <input
        {...resto}
        id={id}
        className={CONTROL}
        aria-describedby={ayuda ? idAyuda : undefined}
      />
      {ayuda && (
        <p id={idAyuda} className="mt-1 text-xs text-subtle">
          {ayuda}
        </p>
      )}
    </div>
  );
}

type SelectorProps = Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'id' | 'className'> & {
  etiqueta: string;
  ayuda?: string | undefined;
};

export function Selector({ etiqueta, ayuda, children, ...resto }: SelectorProps) {
  const id = useId();
  const idAyuda = `${id}-ayuda`;
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs text-subtle">
        {etiqueta}
      </label>
      <select
        {...resto}
        id={id}
        className={CONTROL}
        aria-describedby={ayuda ? idAyuda : undefined}
      >
        {children}
      </select>
      {ayuda && (
        <p id={idAyuda} className="mt-1 text-xs text-subtle">
          {ayuda}
        </p>
      )}
    </div>
  );
}

export function Tarjeta({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string | undefined;
}) {
  return (
    <div className={`rounded-card border border-border bg-surface ${className}`}>{children}</div>
  );
}

const AVISOS = {
  error: 'border-border bg-negative-bg text-negative',
  info: 'border-border bg-info-bg text-info',
  exito: 'border-border bg-positive-bg text-positive',
  atencion: 'border-border bg-warning-bg text-warning',
} as const;

/**
 * El estado se codifica tres veces (texto, icono y color) para que nadie
 * dependa del rojo o del verde. Aquí el icono es el prefijo textual.
 */
const PREFIJOS = {
  error: 'No se pudo',
  info: 'Nota',
  exito: 'Hecho',
  atencion: 'Atención',
} as const;

export function Aviso({
  tipo,
  children,
}: {
  tipo: keyof typeof AVISOS;
  children: React.ReactNode;
}) {
  return (
    <div
      role={tipo === 'error' ? 'alert' : 'status'}
      className={`rounded-card border p-4 text-sm ${AVISOS[tipo]}`}
    >
      <span className="font-medium">{PREFIJOS[tipo]}: </span>
      {children}
    </div>
  );
}

/**
 * Estado vacío que enseña, no que se disculpa: qué es esta pantalla, por qué
 * está vacía y cuál es la única acción siguiente (UI_UX_PLAN.md §1.5).
 */
export function Vacio({
  titulo,
  explicacion,
  siguiente,
  accion,
}: {
  titulo: string;
  explicacion: string;
  siguiente: string;
  accion?: React.ReactNode | undefined;
}) {
  return (
    <Tarjeta className="p-6">
      <h2 className="font-medium">{titulo}</h2>
      <p className="mt-2 max-w-prose text-sm text-muted">{explicacion}</p>
      <p className="mt-3 max-w-prose text-sm text-text">{siguiente}</p>
      {accion && <div className="mt-4">{accion}</div>}
    </Tarjeta>
  );
}

export function Cargando({ que }: { que: string }) {
  return (
    <p role="status" className="text-sm text-muted">
      Cargando {que}…
    </p>
  );
}

/** Etiqueta de estado: texto siempre, color como refuerzo. */
export function Etiqueta({
  children,
  tono = 'neutro',
}: {
  children: React.ReactNode;
  tono?: 'neutro' | 'positivo' | 'atencion' | undefined;
}) {
  const tonos = {
    neutro: 'bg-neutral-bg text-neutral',
    positivo: 'bg-positive-bg text-positive',
    atencion: 'bg-warning-bg text-warning',
  } as const;
  return (
    <span className={`rounded-control px-2 py-0.5 text-xs font-medium ${tonos[tono]}`}>
      {children}
    </span>
  );
}
