import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { mensajeDeError } from '../../lib/errors';
import { requireSupabase } from '../../lib/supabase';
import { Aviso, Boton } from '../../components/ui';

/**
 * El color y el logo con los que sale la cotización impresa.
 *
 * El logo vive en Storage, en una carpeta por organización, y el bucket es
 * público: acaba dentro de un PDF que se manda por correo, así que ocultarlo
 * no ocultaría nada. Lo que sí está cerrado es quién escribe, y eso lo
 * comprueba la política contra `app.current_orgs()`.
 */
export default function MarcaFormato({
  marcaId,
  organizacionId,
  nombre,
  color,
  logoPath,
  alCambiar,
}: {
  marcaId: string;
  organizacionId: string;
  nombre: string;
  color: string | null;
  logoPath: string | null;
  alCambiar: () => void;
}) {
  const entrada = useRef<HTMLInputElement>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const urlPublica = logoPath
    ? requireSupabase().storage.from('marcas').getPublicUrl(logoPath).data.publicUrl
    : null;

  const guardarColor = useMutation({
    mutationFn: async (nuevo: string) => {
      const { error } = await requireSupabase()
        .from('brands')
        .update({ accent_color: nuevo })
        .eq('id', marcaId);
      if (error) throw error;
    },
    onSuccess: alCambiar,
  });

  const subirLogo = useMutation({
    mutationFn: async (archivo: File) => {
      const supabase = requireSupabase();
      const extension = archivo.name.split('.').pop()?.toLowerCase() ?? 'png';
      // La carpeta es el id de la organización: la política de Storage lo
      // exige y es lo que impide escribir en la carpeta de otra.
      const ruta = `${organizacionId}/${marcaId}.${extension}`;

      const subida = await supabase.storage
        .from('marcas')
        .upload(ruta, archivo, { upsert: true, contentType: archivo.type });
      if (subida.error) throw subida.error;

      const { error } = await supabase.from('brands').update({ logo_path: ruta }).eq('id', marcaId);
      if (error) throw error;
    },
    onSuccess: () => {
      setAviso(null);
      alCambiar();
    },
  });

  const quitarLogo = useMutation({
    mutationFn: async () => {
      const { error } = await requireSupabase()
        .from('brands')
        .update({ logo_path: null })
        .eq('id', marcaId);
      if (error) throw error;
    },
    onSuccess: alCambiar,
  });

  function elegir(archivo: File | undefined) {
    if (!archivo) return;
    if (archivo.size > 2 * 1024 * 1024) {
      setAviso('El logo no puede pasar de 2 MB. Redúcelo y vuelve a intentarlo.');
      return;
    }
    if (archivo.type === 'image/svg+xml') {
      setAviso('El PDF no sabe dibujar SVG. Súbelo en PNG o JPG.');
      return;
    }
    setAviso(null);
    subirLogo.mutate(archivo);
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-4 border-t border-border pt-3">
      <label className="flex items-center gap-2 text-sm text-muted">
        Color
        <input
          type="color"
          defaultValue={color ?? '#2a4b8d'}
          onBlur={(e) => guardarColor.mutate(e.target.value)}
          aria-label={`Color de ${nombre}`}
          className="h-9 w-14 cursor-pointer rounded-control border border-border bg-surface"
        />
      </label>

      {urlPublica ? (
        <span className="flex items-center gap-3">
          <img
            src={urlPublica}
            alt={`Logo de ${nombre}`}
            className="h-9 max-w-[120px] object-contain"
          />
          <Boton
            variante="sutil"
            className="min-h-0 px-2 py-1 text-xs"
            disabled={quitarLogo.isPending}
            onClick={() => quitarLogo.mutate()}
          >
            Quitar logo
          </Boton>
        </span>
      ) : (
        <span className="text-sm text-subtle">Sin logo</span>
      )}

      <input
        ref={entrada}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        onChange={(e) => elegir(e.target.files?.[0])}
      />
      <Boton
        variante="secundario"
        className="min-h-0 px-3 py-1.5 text-xs"
        disabled={subirLogo.isPending}
        onClick={() => entrada.current?.click()}
      >
        {subirLogo.isPending ? 'Subiendo…' : urlPublica ? 'Cambiar logo' : 'Subir logo'}
      </Boton>

      {aviso && <Aviso tipo="atencion">{aviso}</Aviso>}
      {subirLogo.error && <Aviso tipo="error">{mensajeDeError(subirLogo.error)}</Aviso>}
      {guardarColor.error && <Aviso tipo="error">{mensajeDeError(guardarColor.error)}</Aviso>}
    </div>
  );
}
