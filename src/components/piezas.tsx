import { useEffect, useRef } from 'react';
import { Boton, Tarjeta } from './ui';

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
  alta,
  children,
}: {
  titulo: string;
  regla: string;
  /**
   * El atajo al formulario de alta de esta pantalla: qué dice el botón y a
   * qué `id` lleva. Existe porque el formulario vive al final de la página,
   * debajo de la lista, y «para agregar una compra no es nada intuitivo» fue
   * exactamente lo que pasó. Un botón arriba que diga qué va a crear resuelve
   * el descubrimiento sin mover el formulario de sitio, que es donde tiene
   * sentido cuando ya sabes que está.
   */
  alta?: { texto: string; id: string } | undefined;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{titulo}</h1>
          <p className="mt-2 max-w-prose text-sm text-muted">{regla}</p>
        </div>
        {alta && <BotonDeAlta {...alta} />}
      </header>
      {children}
    </div>
  );
}

/**
 * El botón que lleva al formulario y deja el cursor dentro.
 *
 * Desplaza y enfoca en vez de abrir un diálogo a propósito: el formulario de
 * estas pantallas enseña cosas mientras lo rellenas —el desglose del IGV, el
 * saldo de la cuenta, lo que queda por asignar— y un diálogo que tapa la
 * pantalla se lleva por delante justo eso.
 */
function BotonDeAlta({ texto, id }: { texto: string; id: string }) {
  return (
    <Boton
      variante="primario"
      onClick={() => {
        const form = document.getElementById(id);
        if (!form) return;
        // La tarjeta y no el formulario: su título —«Anotar una compra»— está
        // justo encima y es la mitad de la respuesta a «¿dónde estoy?».
        // Llamada opcional: en jsdom —y en navegadores viejos— no existe, y un
        // fallo aquí se llevaría por delante el foco, que es lo que importa.
        (form.parentElement ?? form).scrollIntoView?.({ behavior: 'smooth', block: 'start' });
        const primero = form.querySelector<HTMLElement>(
          'input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])',
        );
        // Sin `preventScroll` el navegador haría su propio salto brusco y se
        // comería la animación de arriba.
        primero?.focus({ preventScroll: true });
      }}
    >
      <span aria-hidden="true">+ </span>
      {texto}
    </Boton>
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

/**
 * Aviso de que el selector de arriba está filtrando.
 *
 * Existe porque Marcelo creyó que la aplicación no le dejaba configurar una
 * marca: lo que pasaba es que tenía otra entidad elegida arriba y la lista
 * estaba filtrada en silencio. Una lista incompleta sin explicación se lee
 * como una lista vacía.
 */
export function FiltradoPor({
  entidad,
  alQuitar,
}: {
  entidad: string | null;
  alQuitar: () => void;
}) {
  if (!entidad) return null;
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
      Mostrando solo lo de <span className="font-medium text-text">{entidad}</span>.
      <button type="button" onClick={alQuitar} className="underline">
        Ver todas las entidades
      </button>
    </p>
  );
}

/** Formulario de alta en una tarjeta, con su título propio. */
export function Alta({
  titulo,
  exito,
  id,
  children,
  onSubmit,
}: {
  titulo: string;
  /** Qué se acaba de crear. Null mientras no haya nada que confirmar. */
  exito?: string | null | undefined;
  /** Para que el botón de arriba de la pantalla pueda traer aquí el foco. */
  id?: string | undefined;
  children: React.ReactNode;
  onSubmit: () => void;
}) {
  return (
    <Tarjeta className="p-5">
      <h2 className="mb-4 font-medium">{titulo}</h2>
      <form
        id={id}
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
