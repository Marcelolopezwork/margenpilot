/**
 * Lo que comparten los dos PDF que sabe emitir el producto.
 *
 * Hay dos formatos y no uno por una razón de oficio: la propuesta en láminas
 * es la que Marcelo manda a un cliente —portada, una lámina por servicio,
 * condiciones—, y el documento A4 es la versión sobria para archivar o para
 * quien pide «la cotización» a secas. Comparten exactamente los mismos datos;
 * solo cambia cómo se dibujan.
 *
 * La regla de fondo vive aquí y por eso no se puede saltar desde ninguno de
 * los dos: **`DatosPdf` no tiene dónde meter un costo**. El cliente ve qué
 * contrata y cuánto paga; que detrás haya tres horas de diseñador o una
 * licencia de stock es asunto nuestro. La garantía es estructural, no un `if`
 * que alguien pueda quitar un martes.
 *
 * Tampoco se calcula nada: todo llega ya formateado desde `money.ts`. Si
 * estos módulos sumaran, habría dos aritméticas en el producto y tarde o
 * temprano una diría algo distinto de la otra.
 */

export type LineaPdf = {
  descripcion: string;
  /** La descripción del servicio, copiada de la ficha al cotizar. */
  resumen: string | null;
  /** Nota puntual de esta línea, si la hay. */
  detalle: string | null;
  incluye: string[];
  noIncluye: string[];
  /** Condiciones propias del servicio; se juntan con las de la entidad. */
  condiciones: string[];
  cantidad: string;
  precioUnitario: string;
  importe: string;
};

export type DatosPdf = {
  numero: string;
  fecha: string;
  /** «NOVIEMBRE 2026»: lo que va bajo el título en la portada. */
  periodo: string;
  validaHasta: string | null;
  emisor: {
    nombre: string;
    taxId: string | null;
    direccion: string | null;
    telefono: string | null;
    email: string | null;
  };
  marca: {
    nombre: string;
    color: string | null;
    /** El segundo color: numeración y acentos. */
    colorSecundario: string | null;
    logoUrl: string | null;
    portadaUrl: string | null;
  } | null;
  cliente: { nombre: string; taxId: string | null };
  lineas: LineaPdf[];
  neto: string;
  /** Null cuando la cotización no aplica impuesto. */
  impuesto: { etiqueta: string; importe: string } | null;
  /**
   * La frase que va bajo el precio: «Precio no incluye IGV 18 %.» o «Precio
   * final. No se aplica impuesto.». Se decide donde se conoce la tasa de la
   * entidad, no aquí: una entidad de Estados Unidos no tiene IGV que excluir
   * y escribir que no lo incluye sería mentir con cortesía.
   */
  notaImpuesto: string;
  total: string;
  notas: string | null;
  condiciones: string | null;
};

export type Rgb = [number, number, number];

/** Azul eléctrico y coral: los de la propuesta que Marcelo ya usaba. */
export const PRIMARIO: Rgb = [1, 45, 255];
export const SECUNDARIO: Rgb = [253, 54, 89];

export const TINTA: Rgb = [28, 26, 23];
export const GRIS: Rgb = [110, 110, 110];
export const SUAVE: Rgb = [245, 243, 239];
export const BLANCO: Rgb = [255, 255, 255];

/**
 * Un color de marca a RGB. Lo que no sea un hexadecimal de seis cifras cae en
 * el color por defecto: una marca a medio configurar no debe impedir que la
 * cotización salga.
 */
export function aRgb(hex: string | null, porDefecto: Rgb): Rgb {
  const limpio = (hex ?? '').trim().replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(limpio)) return porDefecto;
  return [
    parseInt(limpio.slice(0, 2), 16),
    parseInt(limpio.slice(2, 4), 16),
    parseInt(limpio.slice(4, 6), 16),
  ];
}

export type Imagen = { datos: string; ancho: number; alto: number };

/**
 * Descarga una imagen y la convierte a data URL, que es lo que jsPDF
 * entiende. Si falla —no está, no hay red, es un SVG— se sigue sin ella: una
 * cotización sin logotipo es fea, pero una que no se genera es inútil.
 */
export async function cargarImagen(url: string): Promise<Imagen | null> {
  try {
    const respuesta = await fetch(url);
    if (!respuesta.ok) return null;
    const blob = await respuesta.blob();
    if (blob.type === 'image/svg+xml') return null; // jsPDF no dibuja SVG

    const datos = await new Promise<string>((resolve, reject) => {
      const lector = new FileReader();
      lector.onload = () => resolve(String(lector.result));
      lector.onerror = () => reject(new Error('no se pudo leer la imagen'));
      lector.readAsDataURL(blob);
    });

    const medidas = await new Promise<{ ancho: number; alto: number }>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ ancho: img.naturalWidth, alto: img.naturalHeight });
      img.onerror = () => reject(new Error('no se pudo medir la imagen'));
      img.src = datos;
    });

    return { datos, ...medidas };
  } catch {
    return null;
  }
}

/**
 * Recorta una imagen a una proporción dada, centrada, como haría `object-fit:
 * cover`. jsPDF no sabe recortar: deforma la foto para que quepa en el
 * rectángulo que le des, y una portada de equipo estirada se nota a un metro.
 *
 * Si el navegador no da lienzo —o el recorte falla por lo que sea— se
 * devuelve la original. Vale más una foto con la proporción equivocada que
 * una portada en blanco.
 */
export async function recortar(imagen: Imagen, proporcion: number): Promise<Imagen> {
  try {
    const lienzo = document.createElement('canvas');
    const pincel = lienzo.getContext('2d');
    if (!pincel) return imagen;

    const actual = imagen.ancho / imagen.alto;
    // El lado que sobra se recorta por el centro.
    const anchoFuente = actual > proporcion ? imagen.alto * proporcion : imagen.ancho;
    const altoFuente = actual > proporcion ? imagen.alto : imagen.ancho / proporcion;

    lienzo.width = Math.round(anchoFuente);
    lienzo.height = Math.round(altoFuente);
    if (lienzo.width === 0 || lienzo.height === 0) return imagen;

    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('no se pudo recortar'));
      el.src = imagen.datos;
    });

    pincel.drawImage(
      img,
      (imagen.ancho - anchoFuente) / 2,
      (imagen.alto - altoFuente) / 2,
      anchoFuente,
      altoFuente,
      0,
      0,
      lienzo.width,
      lienzo.height,
    );

    const datos = lienzo.toDataURL('image/jpeg', 0.9);
    if (!datos.startsWith('data:image/jpeg')) return imagen;
    return { datos, ancho: lienzo.width, alto: lienzo.height };
  } catch {
    return imagen;
  }
}

/**
 * Todas las condiciones de la cotización, en una sola lista.
 *
 * Vienen de dos sitios: las de la entidad, que son las de siempre y se
 * escriben una vez en Configuración, y las propias de cada servicio, que se
 * copiaron a la línea al cotizar. Se repiten a menudo —«50 % por adelantado»
 * está en las dos partes—, así que se quita el duplicado comparando sin
 * mayúsculas ni espacios de sobra: ver dos veces la misma condición hace
 * dudar al cliente de cuál vale.
 */
export function condicionesDe(d: DatosPdf): string[] {
  const crudas = [
    ...(d.condiciones ?? '').split('\n'),
    ...d.lineas.flatMap((l) => l.condiciones),
  ];
  const vistas = new Set<string>();
  const salida: string[] = [];
  for (const cruda of crudas) {
    const texto = cruda.trim();
    if (!texto) continue;
    const clave = texto.toLocaleLowerCase('es').replace(/\s+/g, ' ');
    if (vistas.has(clave)) continue;
    vistas.add(clave);
    salida.push(texto);
  }
  return salida;
}

/** El nombre del archivo, a partir del número y del cliente. */
export function nombreDelArchivo(d: DatosPdf, sufijo: string): string {
  const limpio = d.cliente.nombre.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${d.numero}-${limpio || 'cliente'}${sufijo}.pdf`;
}
