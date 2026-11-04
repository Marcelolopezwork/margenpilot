import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useOrg, useOrgElegida } from '../../app/org-context';
import { mensajeDeError } from '../../lib/errors';
import { formatoFecha, formatoMesAño } from '../../lib/format';
import { currencyOf, format } from '../../lib/money';
import type { CurrencyCode } from '../../lib/money';
import { requireSupabase } from '../../lib/supabase';
import { Aviso, Boton, Cargando } from '../../components/ui';
import { useRecargar } from '../../components/recargar';
import Laminas from '../../propuesta/Laminas';
import {
  PAREJAS,
  PORTADAS,
  TIPOGRAFIAS,
  leerDiseño,
  urlDeFuentes,
} from '../../propuesta/tipos';
import type { DatosPropuesta, Diseño } from '../../propuesta/tipos';
import { notaDeImpuesto, totalesDe } from './totales';
import type { Json } from '../../types/database';

const NOMBRE_PORTADA: Record<(typeof PORTADAS)[number], string> = {
  completa: 'Foto a toda página',
  dividida: 'Partida en dos',
  banda: 'Foto arriba',
};

/** El color de serie cuando ni el diseño ni la marca dicen otra cosa. */
const PRIMARIO = '#012dff';
const SECUNDARIO = '#fd3659';

export default function Propuesta() {
  const { id = '' } = useParams();
  const { organizacion } = useOrgElegida();
  const { entidades } = useOrg();
  const recargar = useRecargar(['cotizacion', 'propuesta']);

  // Qué hueco de foto se está rellenando. La alternativa —un desplegable por
  // hueco— obliga a reconocer las fotos por su nombre de archivo.
  const [hueco, setHueco] = useState<string>('portada');
  const [subiendo, setSubiendo] = useState(false);
  const [avisoFoto, setAvisoFoto] = useState<string | null>(null);
  const entrada = useRef<HTMLInputElement>(null);

  const cabecera = useQuery({
    queryKey: ['cotizacion', id],
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('quotes')
        .select(
          'id, number, currency_code, tax_rate_pct, tax_included, tax_label, valid_until, notes, legal_entity_id, brand_id, client_id, created_at, design',
        )
        .eq('id', id)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const lineas = useQuery({
    queryKey: ['cotizacion', id, 'lineas'],
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('quote_lines')
        .select('id, description, public_detail, public_summary, quantity, unit_price, sort')
        .eq('quote_id', id)
        .eq('is_active', true)
        .order('sort');
      if (error) throw error;
      return data ?? [];
    },
  });

  const entregables = useQuery({
    queryKey: ['cotizacion', id, 'entregables'],
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('quote_line_terms')
        .select('id, quote_line_id, kind, content, sort')
        .eq('organization_id', organizacion.id)
        .eq('is_active', true)
        .order('sort');
      if (error) throw error;
      return data ?? [];
    },
  });

  const cliente = useQuery({
    queryKey: ['cliente', cabecera.data?.client_id],
    enabled: Boolean(cabecera.data?.client_id),
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('clients')
        .select('name, tax_id')
        .eq('id', cabecera.data?.client_id as string)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const marcas = useQuery({
    queryKey: ['marcas', organizacion.id, null],
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('brands')
        .select('id, name, accent_color, accent_secondary, logo_path, cover_path')
        .eq('organization_id', organizacion.id)
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return data ?? [];
    },
  });

  const fotos = useQuery({
    queryKey: ['propuesta', 'fotos', organizacion.id],
    queryFn: async () => {
      const { data, error } = await requireSupabase()
        .from('org_media')
        .select('id, path, label')
        .eq('organization_id', organizacion.id)
        .eq('is_active', true)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const guardar = useMutation({
    mutationFn: async (nuevo: Diseño) => {
      const { error } = await requireSupabase()
        .from('quotes')
        .update({ design: nuevo as unknown as Json })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: recargar,
  });

  const subir = useMutation({
    mutationFn: async (archivo: File) => {
      const supabase = requireSupabase();
      const extension = archivo.name.split('.').pop()?.toLowerCase() ?? 'jpg';
      // La carpeta es el id de la organización: la política de Storage lo
      // exige y es lo que impide escribir en la carpeta de otra.
      const ruta = `${organizacion.id}/propuestas/${crypto.randomUUID()}.${extension}`;
      const subida = await supabase.storage
        .from('marcas')
        .upload(ruta, archivo, { contentType: archivo.type });
      if (subida.error) throw subida.error;

      const { error } = await supabase.from('org_media').insert({
        organization_id: organizacion.id,
        path: ruta,
        label: archivo.name.slice(0, 80),
      });
      if (error) throw error;
      return ruta;
    },
    onSuccess: (ruta) => {
      void fotos.refetch();
      asignar(ruta);
    },
  });

  const diseño: Diseño = useMemo(
    () => leerDiseño(cabecera.data?.design),
    [cabecera.data?.design],
  );

  useEffect(() => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = urlDeFuentes(diseño.tipografia);
    document.head.appendChild(link);
    return () => link.remove();
  }, [diseño.tipografia]);

  function cambiar(parche: Partial<Diseño>) {
    guardar.mutate({ ...diseño, ...parche });
  }

  function asignar(ruta: string | null) {
    if (hueco === 'portada') return cambiar({ fotoPortada: ruta });
    if (hueco === 'indice') return cambiar({ fotoIndice: ruta });
    if (hueco === 'cierre') return cambiar({ fotoCierre: ruta });
    const fotosServicio = { ...diseño.fotosServicio };
    if (ruta) fotosServicio[hueco] = ruta;
    else delete fotosServicio[hueco];
    cambiar({ fotosServicio });
  }

  function elegirArchivo(archivo: File | undefined) {
    if (!archivo) return;
    if (archivo.size > 5 * 1024 * 1024) {
      setAvisoFoto('La foto no puede pasar de 5 MB. Redúcela y vuelve a intentarlo.');
      return;
    }
    setAvisoFoto(null);
    setSubiendo(true);
    subir.mutate(archivo, { onSettled: () => setSubiendo(false) });
  }

  const cargando =
    cabecera.isPending || lineas.isPending || entregables.isPending || marcas.isPending;
  const error = cabecera.error ?? lineas.error ?? entregables.error ?? marcas.error;

  if (error) {
    return (
      <main className="mx-auto max-w-lg p-6">
        <Aviso tipo="error">{mensajeDeError(error)}</Aviso>
      </main>
    );
  }
  if (cargando || !cabecera.data) {
    return (
      <main className="p-10">
        <Cargando que="la propuesta" />
      </main>
    );
  }

  const q = cabecera.data;
  const moneda: CurrencyCode = currencyOf(q.currency_code);
  const filas = lineas.data ?? [];
  const entidad = entidades.find((e) => e.id === q.legal_entity_id);
  const marca = (marcas.data ?? []).find((m) => m.id === q.brand_id) ?? null;

  const urlDe = (ruta: string | null): string | null => {
    if (!ruta) return null;
    return requireSupabase().storage.from('marcas').getPublicUrl(ruta).data.publicUrl;
  };

  const conImpuesto = q.tax_included && Number(q.tax_rate_pct) > 0;
  const etiquetaImpuesto = q.tax_label ?? 'Impuesto';
  const { neto, impuesto, total } = totalesDe(filas, moneda, q.tax_rate_pct, q.tax_included);

  const terminos = entregables.data ?? [];
  const deLaLinea = (lineaId: string, tipo: string) =>
    terminos.filter((t) => t.quote_line_id === lineaId && t.kind === tipo).map((t) => t.content);

  // Las condiciones de la entidad más las de cada servicio, sin repetir la
  // que esté escrita en los dos sitios.
  const condiciones: string[] = [];
  const vistas = new Set<string>();
  for (const cruda of [
    ...(entidad?.quote_terms ?? '').split('\n'),
    ...filas.flatMap((l) => deLaLinea(l.id, 'condition')),
  ]) {
    const texto = cruda.trim();
    if (!texto) continue;
    const clave = texto.toLocaleLowerCase('es').replace(/\s+/g, ' ');
    if (vistas.has(clave)) continue;
    vistas.add(clave);
    condiciones.push(texto);
  }

  const datos: DatosPropuesta = {
    numero: q.number,
    periodo: formatoMesAño(q.created_at),
    validaHasta: q.valid_until ? formatoFecha(q.valid_until) : null,
    emisor: {
      nombre: entidad?.legal_name ?? '',
      taxId: entidad?.tax_id ?? null,
      direccion: entidad?.address ?? null,
      telefono: entidad?.phone ?? null,
      email: entidad?.email ?? null,
      web: null,
    },
    marca: marca ? { nombre: marca.name, logoUrl: urlDe(marca.logo_path) } : null,
    cliente: { nombre: cliente.data?.name ?? '', taxId: cliente.data?.tax_id ?? null },
    // Ni un costo cruza esta frontera: el tipo de DatosPropuesta no los admite.
    lineas: filas.map((l) => ({
      id: l.id,
      nombre: l.description,
      resumen: l.public_summary,
      detalle: l.public_detail,
      incluye: deLaLinea(l.id, 'include'),
      noIncluye: deLaLinea(l.id, 'exclude'),
      condiciones: deLaLinea(l.id, 'condition'),
      cantidad: String(l.quantity),
      precioUnitario: format(totalesDe([{ ...l, quantity: 1 }], moneda, 0, false).neto),
      importe: format(totalesDe([l], moneda, 0, false).neto),
    })),
    neto: format(neto),
    impuesto: conImpuesto ? { etiqueta: etiquetaImpuesto, importe: format(impuesto) } : null,
    notaImpuesto: notaDeImpuesto(q.tax_included, q.tax_rate_pct, etiquetaImpuesto),
    total: format(total),
    notas: q.notes,
    condiciones,
  };

  // La portada de la marca sigue valiendo: quien ya la subió no tiene que
  // volver a elegirla aquí.
  const conFotos: Diseño = {
    ...diseño,
    fotoPortada: diseño.fotoPortada ?? marca?.cover_path ?? null,
  };

  const huecos = [
    { clave: 'portada', titulo: 'Portada', ruta: conFotos.fotoPortada },
    { clave: 'indice', titulo: 'Índice', ruta: diseño.fotoIndice },
    ...filas.map((l) => ({
      clave: l.id,
      titulo: l.description,
      ruta: diseño.fotosServicio[l.id] ?? null,
    })),
    { clave: 'cierre', titulo: 'Cierre', ruta: diseño.fotoCierre },
  ];

  const laminas: { clave: keyof Diseño; titulo: string }[] = [
    { clave: 'mostrarIndice', titulo: 'Índice' },
    { clave: 'mostrarPortadillas', titulo: 'Portadilla por servicio' },
    { clave: 'mostrarInversion', titulo: 'Resumen de inversión' },
    { clave: 'mostrarCondiciones', titulo: 'Condiciones' },
    { clave: 'mostrarCierre', titulo: 'Cierre' },
  ];

  return (
    <div className="min-h-screen bg-[#e9e7e2]">
      <aside className="no-imprime fixed inset-y-0 left-0 z-10 w-[310px] overflow-y-auto border-r border-border bg-surface p-4 text-sm">
        <Link to={`/comercial/cotizaciones/${id}`} className="text-xs text-muted hover:underline">
          ← Volver a la cotización
        </Link>
        <h1 className="mt-2 text-base font-medium">{q.number}</h1>
        <p className="text-xs text-muted">{datos.cliente.nombre}</p>

        <Boton
          variante="primario"
          className="mt-4 w-full"
          onClick={() => window.print()}
          disabled={filas.length === 0}
        >
          Descargar PDF
        </Boton>
        <p className="mt-2 text-xs text-subtle">
          Se abre la ventana de impresión del navegador. Elige <strong>Guardar como PDF</strong>,
          márgenes <strong>Ninguno</strong> y desactiva encabezados y pies.
        </p>

        <Grupo titulo="Portada">
          <div className="flex flex-col gap-1.5">
            {PORTADAS.map((p) => (
              <Opcion
                key={p}
                activa={diseño.portada === p}
                onClick={() => cambiar({ portada: p })}
              >
                {NOMBRE_PORTADA[p]}
              </Opcion>
            ))}
          </div>
        </Grupo>

        <Grupo titulo="Tipografía">
          <div className="flex flex-col gap-1.5">
            {TIPOGRAFIAS.map((t) => (
              <Opcion
                key={t}
                activa={diseño.tipografia === t}
                onClick={() => cambiar({ tipografia: t })}
              >
                {PAREJAS[t].nombre}
              </Opcion>
            ))}
          </div>
        </Grupo>

        <Grupo titulo="Colores">
          <div className="flex items-center gap-3">
            <Color
              etiqueta="Principal"
              valor={diseño.colorPrimario ?? marca?.accent_color ?? PRIMARIO}
              onChange={(v) => cambiar({ colorPrimario: v })}
            />
            <Color
              etiqueta="Acento"
              valor={diseño.colorSecundario ?? marca?.accent_secondary ?? SECUNDARIO}
              onChange={(v) => cambiar({ colorSecundario: v })}
            />
          </div>
          {(diseño.colorPrimario ?? diseño.colorSecundario) !== null && (
            <button
              type="button"
              className="mt-2 text-xs text-muted underline"
              onClick={() => cambiar({ colorPrimario: null, colorSecundario: null })}
            >
              Volver a los de la marca
            </button>
          )}
        </Grupo>

        <Grupo titulo="Fotos">
          <p className="mb-2 text-xs text-subtle">
            Elige el hueco y después la foto. Cada servicio puede llevar la suya.
          </p>
          <div className="flex flex-col gap-1.5">
            {huecos.map((h) => (
              <button
                key={h.clave}
                type="button"
                onClick={() => setHueco(h.clave)}
                className={`flex items-center gap-2 rounded-control border px-2 py-1.5 text-left text-xs ${
                  hueco === h.clave ? 'border-accent bg-accent/10' : 'border-border'
                }`}
              >
                <span
                  className="h-7 w-10 shrink-0 rounded-sm bg-cover bg-center"
                  style={{
                    backgroundImage: h.ruta ? `url("${urlDe(h.ruta) ?? ''}")` : undefined,
                    backgroundColor: h.ruta ? undefined : '#d8d5cf',
                  }}
                />
                <span className="truncate">{h.titulo}</span>
              </button>
            ))}
          </div>

          <div className="mt-3 grid grid-cols-4 gap-1.5">
            {(fotos.data ?? []).map((f) => (
              <button
                key={f.id}
                type="button"
                title={f.label ?? ''}
                onClick={() => asignar(f.path)}
                className="aspect-[4/3] rounded-sm bg-cover bg-center ring-offset-1 hover:ring-2 hover:ring-accent"
                style={{ backgroundImage: `url("${urlDe(f.path) ?? ''}")` }}
              />
            ))}
          </div>

          <input
            ref={entrada}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            onChange={(e) => elegirArchivo(e.target.files?.[0])}
          />
          <div className="mt-2 flex gap-2">
            <Boton
              variante="secundario"
              className="min-h-0 px-3 py-1.5 text-xs"
              disabled={subiendo}
              onClick={() => entrada.current?.click()}
            >
              {subiendo ? 'Subiendo…' : 'Subir foto'}
            </Boton>
            <Boton
              variante="sutil"
              className="min-h-0 px-3 py-1.5 text-xs"
              onClick={() => asignar(null)}
            >
              Quitar
            </Boton>
          </div>
          {avisoFoto && <Aviso tipo="atencion">{avisoFoto}</Aviso>}
          {subir.error && <Aviso tipo="error">{mensajeDeError(subir.error)}</Aviso>}
        </Grupo>

        <Grupo titulo="Láminas">
          <div className="flex flex-col gap-1.5">
            {laminas.map((l) => (
              <label key={l.clave} className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={Boolean(diseño[l.clave])}
                  onChange={(e) => cambiar({ [l.clave]: e.target.checked } as Partial<Diseño>)}
                />
                {l.titulo}
              </label>
            ))}
          </div>
        </Grupo>

        {guardar.error && <Aviso tipo="error">{mensajeDeError(guardar.error)}</Aviso>}
      </aside>

      <div className="marco-propuesta">
        {filas.length === 0 ? (
          <p className="p-10 text-sm text-muted">
            Esta cotización no tiene líneas todavía, así que no hay nada que proponer.
          </p>
        ) : (
          <Laminas
            datos={datos}
            diseño={conFotos}
            urlDe={urlDe}
            colorPrimario={diseño.colorPrimario ?? marca?.accent_color ?? PRIMARIO}
            colorSecundario={diseño.colorSecundario ?? marca?.accent_secondary ?? SECUNDARIO}
          />
        )}
      </div>
    </div>
  );
}

function Grupo({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="mt-5 border-t border-border pt-4">
      <h2 className="mb-2 text-xs uppercase tracking-widest text-subtle">{titulo}</h2>
      {children}
    </section>
  );
}

function Opcion({
  activa,
  onClick,
  children,
}: {
  activa: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-control border px-2.5 py-1.5 text-left text-xs ${
        activa ? 'border-accent bg-accent/10 font-medium' : 'border-border'
      }`}
    >
      {children}
    </button>
  );
}

function Color({
  etiqueta,
  valor,
  onChange,
}: {
  etiqueta: string;
  valor: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-muted">
      <input
        type="color"
        defaultValue={valor}
        onBlur={(e) => onChange(e.target.value)}
        aria-label={etiqueta}
        className="h-8 w-12 cursor-pointer rounded-control border border-border bg-surface"
      />
      {etiqueta}
    </label>
  );
}
