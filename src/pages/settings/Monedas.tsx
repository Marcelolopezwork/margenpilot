import { useMutation, useQuery } from '@tanstack/react-query';
import { useMonedasCatalogo } from '../../app/consultas';
import { useOrgElegida } from '../../app/org-context';
import { mensajeDeError } from '../../lib/errors';
import { requireSupabase } from '../../lib/supabase';
import { Aviso, Boton, Cargando, Etiqueta } from '../../components/ui';
import { Fila, Lista, Seccion } from '../../components/piezas';
import { useRecargar } from '../../components/recargar';

export default function Monedas() {
  const { organizacion } = useOrgElegida();
  const catalogo = useMonedasCatalogo();
  const recargar = useRecargar(['monedas-org', 'entidades', 'cuentas']);

  const habilitadas = useQuery({
    queryKey: ['monedas-org-detalle', organizacion.id],
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('organization_currencies')
        .select('currency_code, is_enabled')
        .eq('organization_id', organizacion.id);
      if (error) throw error;
      return data ?? [];
    },
  });

  const cambiar = useMutation({
    mutationFn: async ({ code, activar }: { code: string; activar: boolean }) => {
      // Upsert y no insert: deshabilitar deja la fila, así que volver a
      // habilitarla es actualizarla, no crearla de nuevo.
      const { error } = await requireSupabase()
        .from('organization_currencies')
        .upsert(
          { organization_id: organizacion.id, currency_code: code, is_enabled: activar },
          { onConflict: 'organization_id,currency_code' },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      void habilitadas.refetch();
      recargar();
    },
  });

  const estado = new Map((habilitadas.data ?? []).map((f) => [f.currency_code, f.is_enabled]));

  return (
    <Seccion
      titulo="Monedas"
      regla="Habilitar una moneda es lo que permite abrir cuentas en ella. Una cuenta vive en una sola moneda: si un banco te da una cuenta multimoneda, aquí son dos cuentas. Y dos monedas nunca se suman sin una tasa con su fecha y su fuente a la vista, así que el consolidado siempre es referencial."
    >
      {(catalogo.isPending || habilitadas.isPending) && <Cargando que="las monedas" />}
      {catalogo.error && <Aviso tipo="error">{mensajeDeError(catalogo.error)}</Aviso>}
      {habilitadas.error && <Aviso tipo="error">{mensajeDeError(habilitadas.error)}</Aviso>}

      {catalogo.data && (
        <Lista>
          {catalogo.data.map((m) => {
            const activa = estado.get(m.code) === true;
            return (
              <Fila
                key={m.code}
                principal={
                  <>
                    <span className="num font-medium">{m.code}</span>
                    <span className="text-muted">{m.symbol}</span>
                    {activa ? (
                      <Etiqueta tono="positivo">Habilitada</Etiqueta>
                    ) : (
                      <Etiqueta>No habilitada</Etiqueta>
                    )}
                  </>
                }
                secundario={m.name}
                extremo={
                  <Boton
                    variante={activa ? 'sutil' : 'secundario'}
                    disabled={cambiar.isPending}
                    onClick={() => cambiar.mutate({ code: m.code, activar: !activa })}
                  >
                    {activa ? 'Deshabilitar' : 'Habilitar'}
                  </Boton>
                }
              />
            );
          })}
        </Lista>
      )}

      {cambiar.error && <Aviso tipo="error">{mensajeDeError(cambiar.error)}</Aviso>}

      <Aviso tipo="info">
        Deshabilitar una moneda no borra nada: las cuentas y los movimientos que ya existan en ella
        siguen ahí. Lo que impide es abrir cuentas nuevas.
      </Aviso>
    </Seccion>
  );
}
