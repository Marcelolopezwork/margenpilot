import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { mensajeDeError } from '../../lib/errors';
import { requireSupabase } from '../../lib/supabase';
import type { Enums } from '../../types/database';
import { Aviso, Boton, Campo, Selector } from '../../components/ui';

const TIPOS: { clave: Enums<'term_kind'>; titulo: string; ayuda: string }[] = [
  { clave: 'include', titulo: 'Incluye', ayuda: 'Cada entregable, uno por línea.' },
  { clave: 'exclude', titulo: 'No incluye', ayuda: 'Lo que el cliente suele dar por supuesto.' },
  { clave: 'condition', titulo: 'Condiciones', ayuda: 'Plazos, revisiones, forma de pago.' },
  { clave: 'note', titulo: 'Notas', ayuda: 'Para uso interno; no sale impreso.' },
];

/**
 * Los entregables de una ficha de servicio.
 *
 * Es lo que convierte una cotización de «Aplicación a medida · S/ 61,750» en
 * algo que se puede firmar: el cliente ve la secuencia de lo que recibe. Al
 * cotizar se copian a la línea, así que cambiarlos aquí no altera lo que ya
 * se envió.
 *
 * «Notas» no se imprime: es para acordarse de algo al cotizar.
 */
export default function ServicioTerminos({
  servicioId,
  organizacionId,
  nombre,
}: {
  servicioId: string;
  organizacionId: string;
  nombre: string;
}) {
  const [tipo, setTipo] = useState<Enums<'term_kind'>>('include');
  const [texto, setTexto] = useState('');

  const consulta = useQuery({
    queryKey: ['terminos', servicioId],
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('service_terms')
        .select('id, kind, content, sort')
        .eq('service_id', servicioId)
        .eq('is_active', true)
        .order('kind')
        .order('sort');
      if (error) throw error;
      return data ?? [];
    },
  });

  const recargar = () => void consulta.refetch();

  const agregar = useMutation({
    mutationFn: async () => {
      const hermanos = (consulta.data ?? []).filter((t) => t.kind === tipo);
      const { error } = await requireSupabase().from('service_terms').insert({
        organization_id: organizacionId,
        service_id: servicioId,
        kind: tipo,
        content: texto.trim(),
        sort: hermanos.length * 10 + 10,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setTexto('');
      recargar();
    },
  });

  const quitar = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await requireSupabase()
        .from('service_terms')
        .update({ is_active: false })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: recargar,
  });

  const items = consulta.data ?? [];

  return (
    <details className="mt-3 border-t border-border pt-3">
      <summary className="cursor-pointer text-sm text-muted">
        Entregables y condiciones
        {items.length > 0 && <span className="text-subtle"> · {items.length}</span>}
      </summary>

      <div className="mt-3 flex flex-col gap-4">
        {consulta.error && <Aviso tipo="error">{mensajeDeError(consulta.error)}</Aviso>}

        {items.length === 0 && !consulta.isPending && (
          <p className="max-w-prose text-sm text-muted">
            Sin entregables, la cotización de este servicio será una sola línea con un precio. Con
            ellos, el cliente ve qué recibe y en qué orden.
          </p>
        )}

        {TIPOS.map((t) => {
          const suyos = items.filter((i) => i.kind === t.clave);
          if (suyos.length === 0) return null;
          return (
            <div key={t.clave}>
              <p className="text-xs uppercase tracking-widest text-subtle">{t.titulo}</p>
              <ul className="mt-1 flex flex-col gap-1">
                {suyos.map((i) => (
                  <li key={i.id} className="flex items-start justify-between gap-3 text-sm">
                    <span>
                      {t.clave === 'exclude' ? '–' : '•'} {i.content}
                    </span>
                    <Boton
                      variante="sutil"
                      className="min-h-0 shrink-0 px-2 py-0.5 text-xs"
                      disabled={quitar.isPending}
                      onClick={() => quitar.mutate(i.id)}
                    >
                      Quitar
                    </Boton>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}

        {quitar.error && <Aviso tipo="error">{mensajeDeError(quitar.error)}</Aviso>}

        <form
          className="flex flex-col gap-3 border-t border-border pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            agregar.mutate();
          }}
        >
          <Selector
            etiqueta="Tipo"
            value={tipo}
            onChange={(e) => setTipo(e.target.value as Enums<'term_kind'>)}
          >
            {TIPOS.map((t) => (
              <option key={t.clave} value={t.clave}>
                {t.titulo}
              </option>
            ))}
          </Selector>

          <Campo
            etiqueta="Texto"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            maxLength={300}
            aria-label={`Nuevo elemento de ${nombre}`}
            ayuda={TIPOS.find((t) => t.clave === tipo)?.ayuda}
          />

          {agregar.error && <Aviso tipo="error">{mensajeDeError(agregar.error)}</Aviso>}

          <Boton
            type="submit"
            variante="secundario"
            disabled={agregar.isPending || !texto.trim()}
          >
            {agregar.isPending ? 'Añadiendo…' : 'Añadir'}
          </Boton>
        </form>
      </div>
    </details>
  );
}
