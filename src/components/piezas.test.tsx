// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Alta, Seccion } from './piezas';

/**
 * Marcelo reportó las dos cosas que se comprueban aquí: que al crear algo la
 * app no avisaba de nada, y que el botón se quedaba «pulsado» después.
 *
 * Lo segundo era el anillo de foco, que se quedaba en el botón porque nadie
 * se lo llevaba. Mover el foco a la confirmación arregla las dos a la vez, y
 * de paso hace que un lector de pantalla la anuncie.
 */
afterEach(cleanup);

describe('confirmación del alta', () => {
  it('no dice nada mientras no se ha creado nada', () => {
    render(
      <Alta titulo="Nueva cuenta" onSubmit={vi.fn()}>
        <button type="submit">Crear</button>
      </Alta>,
    );
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('confirma lo creado y se lleva el foco del botón', () => {
    render(
      <Alta titulo="Nueva cuenta" exito="BCP Soles queda creada en PEN." onSubmit={vi.fn()}>
        <button type="submit">Crear</button>
      </Alta>,
    );

    const aviso = screen.getByRole('status');
    expect(aviso.textContent).toContain('BCP Soles queda creada en PEN.');
    expect(document.activeElement).toBe(aviso);
    expect(document.activeElement).not.toBe(screen.getByRole('button', { name: 'Crear' }));
  });

  it('vuelve a avisar en la segunda alta seguida', () => {
    const { rerender } = render(
      <Alta titulo="Nueva cuenta" exito="Primera creada." onSubmit={vi.fn()}>
        <button type="submit">Crear</button>
      </Alta>,
    );
    // El foco se mueve a mano a otro sitio, como haría quien sigue rellenando.
    screen.getByRole('button', { name: 'Crear' }).focus();

    rerender(
      <Alta titulo="Nueva cuenta" exito="Segunda creada." onSubmit={vi.fn()}>
        <button type="submit">Crear</button>
      </Alta>,
    );

    const aviso = screen.getByRole('status');
    expect(aviso.textContent).toContain('Segunda creada.');
    expect(document.activeElement).toBe(aviso);
  });
});

/**
 * Y la tercera que reportó: «para agregar compra no es nada intuitivo».
 * El formulario estaba al final de la página, debajo de la lista, y nada
 * arriba decía que existiera.
 */
describe('el atajo al formulario de alta', () => {
  it('pone un botón arriba que deja el cursor dentro del formulario', async () => {
    const usuario = userEvent.setup();
    render(
      <Seccion
        titulo="Compras"
        regla="Lo que compras."
        alta={{ texto: 'Anotar una compra', id: 'alta-compra' }}
      >
        <Alta id="alta-compra" titulo="Anotar una compra" onSubmit={vi.fn()}>
          <input aria-label="El proveedor" />
          <button type="submit">Anotar</button>
        </Alta>
      </Seccion>,
    );

    // El botón de la cabecera no es el de enviar: no envía nada.
    const atajo = screen.getByRole('button', { name: 'Anotar una compra' });
    await usuario.click(atajo);

    expect(document.activeElement).toBe(screen.getByLabelText('El proveedor'));
  });

  it('sin atajo declarado, la cabecera no inventa ningún botón', () => {
    render(
      <Seccion titulo="Compras" regla="Lo que compras.">
        <p>nada</p>
      </Seccion>,
    );
    expect(screen.queryByRole('button')).toBeNull();
  });
});
