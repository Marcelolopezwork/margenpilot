import { createContext, useContext } from 'react';
import type { Enums, Tables } from '../types/database';

export type Entidad = Tables<'legal_entities'>;
export type Organizacion = Tables<'organizations'> & { rol: Enums<'membership_role'> };

export type ContextoOrg = {
  cargando: boolean;
  error: string | null;
  organizaciones: Organizacion[];
  organizacion: Organizacion | null;
  elegirOrganizacion: (id: string) => void;
  entidades: Entidad[];
  /** null significa «todas las entidades», que es un estado legítimo y el inicial. */
  entidad: Entidad | null;
  elegirEntidad: (id: string | null) => void;
};

/**
 * Quién ve los costos. Es el reflejo exacto de `app.can_see_costs()` en la
 * base, y conviene no confundir los papeles: **la base es la que manda**. Esto
 * solo evita dibujar una pestaña que devolvería cero filas, que es peor que no
 * tenerla porque parece que falta algo.
 */
const ROLES_CON_COSTOS: readonly Enums<'membership_role'>[] = ['owner', 'admin', 'finance'];

export function puedeVerCostos(rol: Enums<'membership_role'>): boolean {
  return ROLES_CON_COSTOS.includes(rol);
}

/**
 * Quién escribe dinero. Hoy son los mismos roles que ven costos, y aun así
 * son dos funciones, porque en la base son dos: `app.can_write_money()` y
 * `app.can_see_costs()`. El día que una de las dos cambie, el sitio donde
 * cambiarla ya está escrito.
 */
const ROLES_CON_DINERO: readonly Enums<'membership_role'>[] = ['owner', 'admin', 'finance'];

export function puedeEscribirDinero(rol: Enums<'membership_role'>): boolean {
  return ROLES_CON_DINERO.includes(rol);
}

export const OrgContext = createContext<ContextoOrg | null>(null);

export function useOrg(): ContextoOrg {
  const valor = useContext(OrgContext);
  if (!valor) throw new Error('useOrg necesita estar dentro de <OrgProvider>.');
  return valor;
}

/**
 * La organización elegida, cuando la pantalla no puede funcionar sin ella.
 * Las pantallas se montan detrás de <ExigeOrganizacion>, así que llegar aquí
 * sin organización es un error de montaje, no un estado posible.
 */
export function useOrgElegida(): { organizacion: Organizacion; entidad: Entidad | null } {
  const { organizacion, entidad } = useOrg();
  if (!organizacion) throw new Error('Esta pantalla necesita una organización elegida.');
  return { organizacion, entidad };
}
