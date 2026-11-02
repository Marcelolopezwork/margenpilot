import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { mensajeDeError } from '../lib/errors';
import { escribir, leer } from '../lib/storage';
import { requireSupabase } from '../lib/supabase';
import { useSesion } from './session-context';
import { OrgContext } from './org-context';
import type { Entidad, Organizacion } from './org-context';

/**
 * Qué organización y qué entidad se están mirando.
 *
 * La entidad es el filtro que atraviesa casi todo el producto, porque son dos
 * contabilidades distintas (ADR-16). «Todas» es un estado legítimo para
 * configurar, pero no para operar: las pantallas de F3 tendrán que exigir una.
 *
 * No hace falta filtrar por organización en las consultas por seguridad —de
 * eso se encarga RLS— pero sí por corrección: el usuario está mirando una.
 */
export default function OrgProvider({ children }: { children: ReactNode }) {
  const { usuario } = useSesion();
  const userId = usuario?.id ?? null;

  const [orgElegida, setOrgElegida] = useState<string | null>(() => leer('org'));
  const [entidadElegida, setEntidadElegida] = useState<string | null>(null);

  const consultaOrgs = useQuery({
    queryKey: ['organizaciones', userId],
    enabled: Boolean(userId),
    queryFn: async (): Promise<Organizacion[]> => {
      const { data, error } = await requireSupabase()
        .from('memberships')
        .select('role, organizations(*)')
        .eq('status', 'active');
      if (error) throw error;
      return (data ?? [])
        .flatMap((fila) => (fila.organizations ? [{ ...fila.organizations, rol: fila.role }] : []))
        .sort((a, b) => a.name.localeCompare(b.name, 'es'));
    },
  });

  // useMemo y no `?? []` a secas: un array nuevo en cada render haría que
  // las dependencias del useMemo de abajo cambiasen siempre.
  const organizaciones = useMemo(() => consultaOrgs.data ?? [], [consultaOrgs.data]);

  // Si lo guardado ya no existe —se archivó, o es de otra cuenta— se cae a la
  // primera en vez de dejar la app sin organización.
  const organizacion =
    organizaciones.find((o) => o.id === orgElegida) ?? organizaciones[0] ?? null;
  const orgId = organizacion?.id ?? null;

  useEffect(() => {
    if (orgId && orgId !== orgElegida) {
      setOrgElegida(orgId);
      escribir('org', orgId);
    }
  }, [orgId, orgElegida]);

  // La entidad elegida se recuerda por organización: cambiar de organización
  // no debe arrastrar la entidad de la anterior.
  useEffect(() => {
    setEntidadElegida(orgId ? leer(`entidad.${orgId}`) : null);
  }, [orgId]);

  const consultaEntidades = useQuery({
    queryKey: ['entidades', orgId],
    enabled: Boolean(orgId),
    queryFn: async (): Promise<Entidad[]> => {
      const { data, error } = await requireSupabase()
        .from('legal_entities')
        .select('*')
        .eq('organization_id', orgId as string)
        .order('legal_name');
      if (error) throw error;
      return data ?? [];
    },
  });

  const entidades = useMemo(() => consultaEntidades.data ?? [], [consultaEntidades.data]);
  const entidad = entidades.find((e) => e.id === entidadElegida) ?? null;

  const elegirOrganizacion = useCallback((id: string) => {
    setOrgElegida(id);
    escribir('org', id);
  }, []);

  const elegirEntidad = useCallback(
    (id: string | null) => {
      setEntidadElegida(id);
      if (orgId) escribir(`entidad.${orgId}`, id ?? '');
    },
    [orgId],
  );

  const valor = useMemo(
    () => ({
      cargando: consultaOrgs.isPending || (Boolean(orgId) && consultaEntidades.isPending),
      error: consultaOrgs.error
        ? mensajeDeError(consultaOrgs.error)
        : consultaEntidades.error
          ? mensajeDeError(consultaEntidades.error)
          : null,
      organizaciones,
      organizacion,
      elegirOrganizacion,
      entidades,
      entidad,
      elegirEntidad,
    }),
    [
      consultaOrgs.isPending,
      consultaOrgs.error,
      consultaEntidades.isPending,
      consultaEntidades.error,
      orgId,
      organizaciones,
      organizacion,
      elegirOrganizacion,
      entidades,
      entidad,
      elegirEntidad,
    ],
  );

  return <OrgContext.Provider value={valor}>{children}</OrgContext.Provider>;
}
