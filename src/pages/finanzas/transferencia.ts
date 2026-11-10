/**
 * Lo que la pantalla necesita decidir antes de ofrecer una transferencia.
 *
 * Todo esto lo vuelve a comprobar la base, que es la que manda. Aquí está por
 * una razón distinta: para no ofrecer lo imposible. La lección de F3-3b es que
 * un rechazo correcto llega demasiado tarde si la pantalla había invitado a
 * intentarlo.
 */

export interface CuentaParaMover {
  id: string;
  name: string;
  currency_code: string;
  legal_entity_id: string;
  is_active: boolean;
}

/**
 * Las cuentas a las que se puede mover dinero desde `origen`: activas, de la
 * misma empresa, y no ella misma.
 *
 * Por qué de la misma empresa: entre dos empresas del grupo el dinero sale del
 * libro de una y entra en el de la otra, así que no es un traslado interno
 * sino un préstamo, un aporte o una venta —dos hechos, uno en cada libro, cada
 * uno con su motivo (ADR-16, INV-5)—.
 */
export function destinosPosibles(
  cuentas: readonly CuentaParaMover[],
  origen: CuentaParaMover | undefined,
): CuentaParaMover[] {
  if (!origen) return [];
  return cuentas.filter(
    (c) => c.is_active && c.id !== origen.id && c.legal_entity_id === origen.legal_entity_id,
  );
}

/**
 * Cuando no hay ningún destino, por qué no lo hay. Un desplegable vacío es un
 * misterio; peor aún cuando la respuesta —«esa empresa solo tiene una
 * cuenta»— se puede dar en una frase.
 */
export function porQueNoHayDestino(
  cuentas: readonly CuentaParaMover[],
  origen: CuentaParaMover | undefined,
): 'sin-origen' | 'unica-de-su-empresa' | null {
  if (!origen) return 'sin-origen';
  return destinosPosibles(cuentas, origen).length > 0 ? null : 'unica-de-su-empresa';
}

/**
 * Hace falta decir cuánto llegó cuando las dos cuentas no comparten moneda. En
 * la misma moneda no se pregunta: lo que sale es lo que llega, y si no lo es,
 * la diferencia es una comisión y se anota como comisión.
 */
export function haceFaltaMontoDestino(
  origen: CuentaParaMover | undefined,
  destino: CuentaParaMover | undefined,
): boolean {
  if (!origen || !destino) return false;
  return origen.currency_code !== destino.currency_code;
}
