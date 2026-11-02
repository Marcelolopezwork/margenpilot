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
