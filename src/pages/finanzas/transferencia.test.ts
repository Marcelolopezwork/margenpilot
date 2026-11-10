import { describe, expect, it } from 'vitest';
import {
  destinosPosibles,
  haceFaltaMontoDestino,
  porQueNoHayDestino,
  type CuentaParaMover,
} from './transferencia';

const cuenta = (
  id: string,
  legal_entity_id: string,
  currency_code: string,
  is_active = true,
): CuentaParaMover => ({ id, name: id, legal_entity_id, currency_code, is_active });

const BCP = cuenta('bcp', 'tres-brothers', 'PEN');
const CHICA = cuenta('chica', 'tres-brothers', 'PEN');
const DOLARES = cuenta('dolares', 'tres-brothers', 'USD');
const MERCURY = cuenta('mercury', 'publisher', 'USD');
const VIEJA = cuenta('vieja', 'tres-brothers', 'PEN', false);

describe('a dónde se puede mover el dinero', () => {
  it('solo a otras cuentas de la misma empresa', () => {
    const r = destinosPosibles([BCP, CHICA, DOLARES, MERCURY], BCP);
    expect(r.map((c) => c.id)).toEqual(['chica', 'dolares']);
  });

  it('nunca a sí misma, ni a una cuenta archivada', () => {
    const r = destinosPosibles([BCP, CHICA, VIEJA], BCP);
    expect(r.map((c) => c.id)).toEqual(['chica']);
  });

  it('sin origen no hay destinos que ofrecer', () => {
    expect(destinosPosibles([BCP, CHICA], undefined)).toEqual([]);
    expect(porQueNoHayDestino([BCP, CHICA], undefined)).toBe('sin-origen');
  });

  /**
   * El caso real del 10/11: dos cuentas, una por empresa. Así que no hay
   * ninguna transferencia posible, y eso hay que decirlo con esas palabras en
   * vez de enseñar un desplegable vacío.
   */
  it('con una sola cuenta en esa empresa, lo dice en vez de callarse', () => {
    expect(porQueNoHayDestino([BCP, MERCURY], BCP)).toBe('unica-de-su-empresa');
  });

  it('y cuando sí hay a dónde, no dice nada', () => {
    expect(porQueNoHayDestino([BCP, CHICA], BCP)).toBeNull();
  });
});

describe('cuándo hace falta decir cuánto llegó', () => {
  it('cuando las dos cuentas no comparten moneda', () => {
    expect(haceFaltaMontoDestino(BCP, DOLARES)).toBe(true);
  });

  it('y no cuando la comparten: lo que sale es lo que llega', () => {
    expect(haceFaltaMontoDestino(BCP, CHICA)).toBe(false);
  });

  it('sin las dos cuentas elegidas todavía no se pregunta nada', () => {
    expect(haceFaltaMontoDestino(BCP, undefined)).toBe(false);
    expect(haceFaltaMontoDestino(undefined, DOLARES)).toBe(false);
  });
});
