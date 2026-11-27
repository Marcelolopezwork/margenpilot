import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { Boton, Tarjeta } from './ui';

/**
 * La red que impide que un fallo de una pantalla deje la aplicación en blanco.
 *
 * React desmonta el árbol entero cuando un error sube sin que nadie lo recoja.
 * Sin esto, cualquier fallo al dibujar una pantalla —una fila con una forma que
 * no se esperaba, una cifra imposible— no deja un mensaje ni una consola que
 * alguien vaya a leer: deja una página blanca de la que solo se sale
 * refrescando. El fallo existe igual; lo que cambia es que ahora **se puede
 * contar**, y que el resto de la aplicación sigue en pie.
 *
 * No arregla ningún error: lo enseña. Y enseña el texto técnico dentro de un
 * `<details>` a propósito, porque un fallo que el usuario puede copiar y
 * mandar es un fallo que se puede arreglar; uno que solo él vio, no.
 *
 * Se monta con `key={pathname}` desde el armazón: al navegar a otra pantalla la
 * red se rearma sola. Si no, una vez roto habría que recargar igualmente para
 * poder usar el resto del producto, que es justo lo que esto evita.
 */

interface Props {
  children: ReactNode;
  /** Lo que se estaba mirando, para que el aviso lo diga. */
  donde?: string | undefined;
}

interface Estado {
  error: Error | null;
  pila: string | null;
}

export default class Pantalla extends Component<Props, Estado> {
  override state: Estado = { error: null, pila: null };

  static getDerivedStateFromError(error: Error): Partial<Estado> {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ pila: info.componentStack ?? null });
    // Queda en la consola además del aviso: el aviso es para quien mira, la
    // consola para quien depura con el navegador abierto.
    console.error('Pantalla rota:', error, info.componentStack);
  }

  private reintentar = () => this.setState({ error: null, pila: null });

  override render() {
    const { error, pila } = this.state;
    if (!error) return this.props.children;

    const donde = this.props.donde ? ` en ${this.props.donde}` : '';

    return (
      <div className="mx-auto max-w-2xl py-2">
        <Tarjeta className="p-6">
          <h2 className="font-medium">Esta pantalla se rompió</h2>
          <p className="mt-2 max-w-prose text-sm text-muted">
            El fallo es del programa, no de tus datos: no se ha perdido ni cambiado nada. El resto
            de la aplicación sigue funcionando, así que puedes irte a otra sección por el menú.
          </p>
          <p className="mt-2 max-w-prose text-sm text-muted">
            Vuelve a intentarlo. Si pasa otra vez, abre «Qué dice el fallo» y mándame ese texto:
            con él se arregla, y sin él solo se adivina.
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            <Boton variante="primario" onClick={this.reintentar}>
              Volver a intentarlo
            </Boton>
            <Boton onClick={() => window.location.reload()}>Recargar la página</Boton>
          </div>

          <details className="mt-4">
            <summary className="cursor-pointer text-sm text-muted">Qué dice el fallo</summary>
            <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-control border border-border bg-surface-2 p-3 font-mono text-xs text-text">
              {`Fallo${donde}: ${error.message}`}
              {error.stack ? `\n\n${error.stack}` : ''}
              {pila ? `\n\nDónde:${pila}` : ''}
            </pre>
          </details>
        </Tarjeta>
      </div>
    );
  }
}
