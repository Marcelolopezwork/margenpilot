import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';

/**
 * Nada financiero se borra, así que estas pantallas activan y desactivan. Lo
 * que sí hace falta es decir qué consultas quedan sucias tras un cambio:
 * invalidar de más recarga lo que no cambió, y de menos deja la pantalla
 * mintiendo.
 *
 * `puesta-en-marcha` se invalida siempre porque Inicio cuenta todo esto.
 *
 * Vive en su propio archivo para no exportar un hook desde un archivo de
 * componentes, que es lo que rompe la recarga en caliente.
 */
export function useRecargar(claves: readonly string[]) {
  const queryClient = useQueryClient();
  // Una firma estable: un array literal cambiaría de identidad en cada render
  // y el useCallback no serviría de nada.
  const firma = claves.join('|');

  return useCallback(() => {
    for (const clave of firma.split('|')) {
      void queryClient.invalidateQueries({ queryKey: [clave] });
    }
    void queryClient.invalidateQueries({ queryKey: ['puesta-en-marcha'] });
  }, [queryClient, firma]);
}
