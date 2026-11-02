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

/** Formulario de alta en una tarjeta, con su título propio. */
export function Alta({
  titulo,
  children,
  onSubmit,
}: {
  titulo: string;
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
