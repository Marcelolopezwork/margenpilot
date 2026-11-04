import { useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { mensajeDeError } from '../lib/errors';
import { requireSupabase } from '../lib/supabase';
import { Aviso, Boton } from '../components/ui';

/**
 * La biblioteca de fotos de la organización, en pequeño.
 *
 * Es la misma en todas partes: lo que se sube aquí se puede volver a usar en
 * cualquier propuesta. Por eso las fotos tienen tabla propia y no viven solo
 * dentro del diseño de una cotización; si no, cada propuesta empezaría de cero
 * y habría que resubir el mismo banner cada mes.
 */
export default function SelectorDeFoto({
  organizacionId,
  ruta,
  etiqueta,
  alElegir,
}: {
  organizacionId: string;
  ruta: string | null;
  etiqueta: string;
  alElegir: (ruta: string | null) => void;
}) {
  const entrada = useRef<HTMLInputElement>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const fotos = useQuery({
    queryKey: ['propuesta', 'fotos', organizacionId],
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('org_media')
        .select('id, path, label')
        .eq('organization_id', organizacionId)
        .eq('is_active', true)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const url = (r: string | null) =>
    r ? requireSupabase().storage.from('marcas').getPublicUrl(r).data.publicUrl : null;

  const subir = useMutation({
    mutationFn: async (archivo: File) => {
      const supabase = requireSupabase();
      const extension = archivo.name.split('.').pop()?.toLowerCase() ?? 'jpg';
      // La carpeta es el id de la organización: la política de Storage lo
      // exige y es lo que impide escribir en la carpeta de otra.
      const destino = `${organizacionId}/propuestas/${crypto.randomUUID()}.${extension}`;
      const subida = await supabase.storage
        .from('marcas')
        .upload(destino, archivo, { contentType: archivo.type });
      if (subida.error) throw subida.error;

      const { error } = await supabase.from('org_media').insert({
        organization_id: organizacionId,
        path: destino,
        label: archivo.name.slice(0, 80),
      });
      if (error) throw error;
      return destino;
    },
    onSuccess: (destino) => {
      void fotos.refetch();
      alElegir(destino);
    },
  });

  function elegirArchivo(archivo: File | undefined) {
    if (!archivo) return;
    if (archivo.size > 5 * 1024 * 1024) {
      setAviso('La foto no puede pasar de 5 MB. Redúcela y vuelve a intentarlo.');
      return;
    }
    setAviso(null);
    subir.mutate(archivo);
  }

  const actual = url(ruta);

  return (
    <details className="mt-3 border-t border-border pt-3">
      <summary className="flex cursor-pointer items-center gap-2 text-sm text-muted">
        {actual ? (
          <img src={actual} alt="" className="h-7 w-10 rounded-sm object-cover" />
        ) : (
          <span className="h-7 w-10 rounded-sm bg-subtle/20" />
        )}
        {etiqueta}
      </summary>

      <div className="mt-3 flex flex-col gap-2">
        <div className="grid grid-cols-6 gap-1.5">
          {(fotos.data ?? []).map((f) => (
            <button
              key={f.id}
              type="button"
              title={f.label ?? ''}
              onClick={() => alElegir(f.path)}
              className={`aspect-[4/3] rounded-sm bg-cover bg-center ${
                f.path === ruta ? 'ring-2 ring-accent' : 'hover:ring-2 hover:ring-border'
              }`}
              style={{ backgroundImage: `url("${url(f.path) ?? ''}")` }}
            />
          ))}
        </div>

        {(fotos.data ?? []).length === 0 && !fotos.isPending && (
          <p className="text-xs text-subtle">
            Todavía no hay fotos. Sube una y quedará disponible para todas las propuestas.
          </p>
        )}

        <input
          ref={entrada}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          onChange={(e) => elegirArchivo(e.target.files?.[0])}
        />
        <div className="flex gap-2">
          <Boton
            variante="secundario"
            className="min-h-0 px-3 py-1.5 text-xs"
            disabled={subir.isPending}
            onClick={() => entrada.current?.click()}
          >
            {subir.isPending ? 'Subiendo…' : 'Subir foto'}
          </Boton>
          {ruta && (
            <Boton
              variante="sutil"
              className="min-h-0 px-3 py-1.5 text-xs"
              onClick={() => alElegir(null)}
            >
              Quitar
            </Boton>
          )}
        </div>

        {aviso && <Aviso tipo="atencion">{aviso}</Aviso>}
        {subir.error && <Aviso tipo="error">{mensajeDeError(subir.error)}</Aviso>}
        {fotos.error && <Aviso tipo="error">{mensajeDeError(fotos.error)}</Aviso>}
      </div>
    </details>
  );
}
