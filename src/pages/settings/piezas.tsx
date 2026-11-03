import { useEffect, useRef } from 'react';
import { Tarjeta } from '../../components/ui';

/**
 * Lo que repiten las seis pantallas de Configuración: la cabecera que explica
 * la regla que hay detrás, y la tabla que se vuelve lista en móvil.
 *
 * La cabecera no es decorativa. Cada una de estas pantallas configura algo que
 * luego la base de datos hace cumplir con un disparador; si el usuario no sabe
 * la regla, el error que verá después no tendrá sentido.
 */
export function Seccion({
  titulo,
  regla,
  children,
}: {
  titulo: string;
  regla: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">{titulo}</h1>
        <p className="mt-2 max-w-prose text-sm text-muted">{regla}</p>
      </header>
      {children}
    </div>
  );
}

/**
 * Confirmación de que algo se creó.
 *
 * Se lleva el foco al aparecer, y eso resuelve dos cosas de un golpe: un
 * lector de pantalla la anuncia, y el botón de enviar deja de quedarse con el
 * anillo de foco encima, que es lo que hace que parezca pulsado para siempre
 * después de crear algo.
 */
function Exito({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  return (
    <p
      ref={ref}
      tabIndex={-1}
      role="status"
      className="mt-4 rounded-card border border-border bg-positive-bg p-4 text-sm text-positive"
    >
      <span className="font-medium">Hecho: </span>
      {children}
    </p>
  );
}

/** Formulario de alta en una tarjeta, con su título propio. */
export function Alta({
  titulo,
  exito,
  children,
  onSubmit,
}: {
  titulo: string;
  /** Qué se acaba de crear. Null mientras no haya nada que confirmar. */
  exito?: string | null | undefined;
  children: React.ReactNode;
  onSubmit: () => void;
}) {
  return (
    <Tarjeta className="p-5">
      <h2 className="mb-4 font-medium">{titulo}</h2>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        {children}
      </form>
      {/* La clave fuerza un montaje nuevo por cada alta: sin ella, crear dos
          seguidas no volvería a mover el foco ni a anunciar la segunda. */}
      {exito && <Exito key={exito}>{exito}</Exito>}
    </Tarjeta>
  );
}

/**
 * Lista de registros. En móvil cada fila es una tarjeta apilada; en escritorio
 * se alinea en columnas. No se usa <table>: el contenido es una lista de
 * objetos con acciones, no una matriz de datos comparables.
 */
export function Lista({ children }: { children: React.ReactNode }) {
  return <ul className="flex flex-col gap-2">{children}</ul>;
}

export function Fila({
  principal,
  secundario,
  extremo,
}: {
  principal: React.ReactNode;
  secundario?: React.ReactNode;
  extremo?: React.ReactNode;
}) {
  return (
    <li>
      <Tarjeta className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">{principal}</div>
          {secundario && <div className="mt-1 text-sm text-muted">{secundario}</div>}
        </div>
        {extremo && <div className="flex shrink-0 items-center gap-2">{extremo}</div>}
      </Tarjeta>
    </li>
  );
}
