import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { mensajeDeError } from '../../lib/errors';
import { requireSupabase } from '../../lib/supabase';
import { Aviso, Boton } from '../../components/ui';

/**
 * El color, el logo y la portada con los que sale la cotización impresa.
 *
 * Las imágenes viven en Storage, en una carpeta por organización, y el bucket
 * es público: acaban dentro de un PDF que se manda por correo, así que
 * ocultarlas no ocultaría nada. Lo que sí está cerrado es quién escribe, y
 * eso lo comprueba la política contra `app.current_orgs()`.
 */
type Columna = 'logo_path' | 'cover_path';

export default function MarcaFormato({
  marcaId,
  organizacionId,
  nombre,
  color,
  logoPath,
  portadaPath,
  alCambiar,
}: {
  marcaId: string;
  organizacionId: string;
  nombre: string;
  color: string | null;
  logoPath: string | null;
  portadaPath: string | null;
  alCambiar: () => void;
}) {
  const entradaLogo = useRef<HTMLInputElement>(null);
  const entradaPortada = useRef<HTMLInputElement>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const url = (ruta: string | null) =>
    ruta ? requireSupabase().storage.from('marcas').getPublicUrl(ruta).data.publicUrl : null;

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

  const subir = useMutation({
    mutationFn: async ({ archivo, columna }: { archivo: File; columna: Columna }) => {
      const supabase = requireSupabase();
      const extension = archivo.name.split('.').pop()?.toLowerCase() ?? 'png';
      const sufijo = columna === 'logo_path' ? 'logo' : 'portada';
      // La carpeta es el id de la organización: la política de Storage lo
      // exige y es lo que impide escribir en la carpeta de otra.
      const ruta = `${organizacionId}/${marcaId}-${sufijo}.${extension}`;

      const subida = await supabase.storage
        .from('marcas')
        .upload(ruta, archivo, { upsert: true, contentType: archivo.type });
      if (subida.error) throw subida.error;

      const cambio = columna === 'logo_path' ? { logo_path: ruta } : { cover_path: ruta };
      const { error } = await supabase.from('brands').update(cambio).eq('id', marcaId);
      if (error) throw error;
    },
    onSuccess: () => {
      setAviso(null);
      alCambiar();
    },
  });

  const quitar = useMutation({
    mutationFn: async (columna: Columna) => {
      const cambio = columna === 'logo_path' ? { logo_path: null } : { cover_path: null };
      const { error } = await requireSupabase().from('brands').update(cambio).eq('id', marcaId);
      if (error) throw error;
    },
    onSuccess: alCambiar,
  });

  function elegir(archivo: File | undefined, columna: Columna) {
    if (!archivo) return;
    if (archivo.size > 2 * 1024 * 1024) {
      setAviso('La imagen no puede pasar de 2 MB. Redúcela y vuelve a intentarlo.');
      return;
    }
    if (archivo.type === 'image/svg+xml') {
      setAviso('El PDF no sabe dibujar SVG. Súbela en PNG o JPG.');
      return;
    }
    setAviso(null);
    subir.mutate({ archivo, columna });
  }

  const imagen = (
    columna: Columna,
    etiqueta: string,
    ruta: string | null,
    entrada: React.RefObject<HTMLInputElement>,
    alto: string,
  ) => {
    const publica = url(ruta);
    return (
      <div className="flex items-center gap-3">
        <span className="w-16 text-xs text-subtle">{etiqueta}</span>
        {publica ? (
          <>
            <img src={publica} alt={`${etiqueta} de ${nombre}`} className={`${alto} object-contain`} />
            <Boton
              variante="sutil"
              className="min-h-0 px-2 py-1 text-xs"
              disabled={quitar.isPending}
              onClick={() => quitar.mutate(columna)}
            >
              Quitar
            </Boton>
          </>
        ) : (
          <span className="text-sm text-subtle">—</span>
        )}
        <input
          ref={entrada}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          onChange={(e) => elegir(e.target.files?.[0], columna)}
        />
        <Boton
          variante="secundario"
          className="min-h-0 px-3 py-1.5 text-xs"
          disabled={subir.isPending}
          onClick={() => entrada.current?.click()}
        >
          {subir.isPending ? 'Subiendo…' : publica ? 'Cambiar' : 'Subir'}
        </Boton>
      </div>
    );
  };

  return (
    <div className="mt-3 flex flex-col gap-3 border-t border-border pt-3">
      <label className="flex items-center gap-3 text-sm text-muted">
        <span className="w-16 text-xs text-subtle">Color</span>
        <input
          type="color"
          defaultValue={color ?? '#2a4b8d'}
          onBlur={(e) => guardarColor.mutate(e.target.value)}
          aria-label={`Color de ${nombre}`}
          className="h-9 w-14 cursor-pointer rounded-control border border-border bg-surface"
        />
        <span className="text-xs text-subtle">Pinta la cabecera y los títulos del PDF.</span>
      </label>

      {imagen('logo_path', 'Logo', logoPath, entradaLogo, 'h-9 max-w-[120px]')}
      {imagen('cover_path', 'Portada', portadaPath, entradaPortada, 'h-12 max-w-[160px]')}

      <p className="text-xs text-subtle">
        La portada es la banda que abre la cotización. Apaisada funciona mejor: se recorta al ancho
        de la página.
      </p>

      {aviso && <Aviso tipo="atencion">{aviso}</Aviso>}
      {subir.error && <Aviso tipo="error">{mensajeDeError(subir.error)}</Aviso>}
      {quitar.error && <Aviso tipo="error">{mensajeDeError(quitar.error)}</Aviso>}
      {guardarColor.error && <Aviso tipo="error">{mensajeDeError(guardarColor.error)}</Aviso>}
    </div>
  );
}
