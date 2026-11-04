/**
 * Lo que necesita la propuesta para dibujarse.
 *
 * `DatosPropuesta` es lo que dice la cotización —quién, qué y cuánto— y
 * `Diseño` es lo que decide Marcelo —qué foto, qué color, qué variante—. Van
 * separados porque cambian por motivos distintos: lo primero cuando se edita
 * la cotización y lo segundo cuando se afina cómo se ve.
 *
 * Aquí tampoco hay sitio para un costo, por la misma razón de siempre: el
 * cliente ve qué contrata y cuánto paga, no de dónde sale el precio.
 */

export type LineaPropuesta = {
  id: string;
  nombre: string;
  resumen: string | null;
  detalle: string | null;
  incluye: string[];
  noIncluye: string[];
  condiciones: string[];
  cantidad: string;
  precioUnitario: string;
  importe: string;
};

export type DatosPropuesta = {
  numero: string;
  periodo: string;
  validaHasta: string | null;
  emisor: {
    nombre: string;
    taxId: string | null;
    direccion: string | null;
    telefono: string | null;
    email: string | null;
    web: string | null;
  };
  marca: { nombre: string; logoUrl: string | null } | null;
  cliente: { nombre: string; taxId: string | null };
  lineas: LineaPropuesta[];
  neto: string;
  impuesto: { etiqueta: string; importe: string } | null;
  notaImpuesto: string;
  total: string;
  notas: string | null;
  condiciones: string[];
};

export const PORTADAS = ['completa', 'dividida', 'banda'] as const;
export type Portada = (typeof PORTADAS)[number];

export const TIPOGRAFIAS = ['bebas', 'archivo', 'editorial', 'suiza'] as const;
export type Tipografia = (typeof TIPOGRAFIAS)[number];

export type Diseño = {
  portada: Portada;
  tipografia: Tipografia;
  /** Nulo usa el de la marca. */
  colorPrimario: string | null;
  colorSecundario: string | null;
  /** Fondo oscuro en las láminas con foto a sangre. */
  fotoPortada: string | null;
  fotoIndice: string | null;
  fotoCierre: string | null;
  /** Una foto por servicio, por id de línea. */
  fotosServicio: Record<string, string>;
  mostrarIndice: boolean;
  mostrarPortadillas: boolean;
  mostrarInversion: boolean;
  mostrarCondiciones: boolean;
  mostrarCierre: boolean;
};

export const DISEÑO_POR_DEFECTO: Diseño = {
  portada: 'completa',
  tipografia: 'bebas',
  colorPrimario: null,
  colorSecundario: null,
  fotoPortada: null,
  fotoIndice: null,
  fotoCierre: null,
  fotosServicio: {},
  mostrarIndice: true,
  mostrarPortadillas: true,
  mostrarInversion: true,
  mostrarCondiciones: true,
  mostrarCierre: true,
};

/**
 * Lee el diseño guardado sin fiarse de lo que haya en la columna.
 *
 * Es `jsonb`: puede traer cualquier cosa, incluida una versión vieja del
 * formato o un campo que alguien escribió a mano. Lo que no se reconozca cae
 * en el valor por defecto en vez de romper la pantalla.
 */
export function leerDiseño(crudo: unknown): Diseño {
  const d = (typeof crudo === 'object' && crudo !== null ? crudo : {}) as Record<string, unknown>;

  const texto = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
  const bool = (v: unknown, pordefecto: boolean) => (typeof v === 'boolean' ? v : pordefecto);

  const fotos: Record<string, string> = {};
  if (typeof d['fotosServicio'] === 'object' && d['fotosServicio'] !== null) {
    for (const [k, v] of Object.entries(d['fotosServicio'] as Record<string, unknown>)) {
      if (typeof v === 'string' && v) fotos[k] = v;
    }
  }

  const portada = PORTADAS.find((p) => p === d['portada']) ?? DISEÑO_POR_DEFECTO.portada;
  const tipografia =
    TIPOGRAFIAS.find((t) => t === d['tipografia']) ?? DISEÑO_POR_DEFECTO.tipografia;

  return {
    portada,
    tipografia,
    colorPrimario: texto(d['colorPrimario']),
    colorSecundario: texto(d['colorSecundario']),
    fotoPortada: texto(d['fotoPortada']),
    fotoIndice: texto(d['fotoIndice']),
    fotoCierre: texto(d['fotoCierre']),
    fotosServicio: fotos,
    mostrarIndice: bool(d['mostrarIndice'], true),
    mostrarPortadillas: bool(d['mostrarPortadillas'], true),
    mostrarInversion: bool(d['mostrarInversion'], true),
    mostrarCondiciones: bool(d['mostrarCondiciones'], true),
    mostrarCierre: bool(d['mostrarCierre'], true),
  };
}

/** Las familias de cada pareja, tal como las pide Google Fonts. */
export const PAREJAS: Record<
  Tipografia,
  {
    nombre: string;
    titulo: string;
    texto: string;
    familias: string[];
    escala: number;
    mayusculas: boolean;
  }
> = {
  bebas: {
    nombre: 'Bebas Neue · Lato',
    titulo: "'Bebas Neue', Impact, sans-serif",
    texto: "'Lato', system-ui, sans-serif",
    familias: ['Bebas+Neue', 'Lato:wght@400;700;900'],
    // Bebas es estrecha y de caja alta: necesita menos cuerpo que las demás
    // para ocupar lo mismo.
    escala: 1.18,
    mayusculas: true,
  },
  archivo: {
    nombre: 'Archivo Black · Inter',
    titulo: "'Archivo Black', Impact, sans-serif",
    texto: "'Inter', system-ui, sans-serif",
    familias: ['Archivo+Black', 'Inter:wght@400;600;800'],
    escala: 0.84,
    mayusculas: true,
  },
  editorial: {
    nombre: 'Playfair · Lato',
    titulo: "'Playfair Display', Georgia, serif",
    texto: "'Lato', system-ui, sans-serif",
    familias: ['Playfair+Display:wght@700;900', 'Lato:wght@400;700;900'],
    escala: 0.94,
    mayusculas: false,
  },
  suiza: {
    nombre: 'Inter · Inter',
    titulo: "'Inter', system-ui, sans-serif",
    texto: "'Inter', system-ui, sans-serif",
    familias: ['Inter:wght@400;600;800;900'],
    escala: 0.86,
    mayusculas: false,
  },
};

export function urlDeFuentes(t: Tipografia): string {
  const familias = PAREJAS[t].familias.map((f) => `family=${f}`).join('&');
  return `https://fonts.googleapis.com/css2?${familias}&display=swap`;
}
