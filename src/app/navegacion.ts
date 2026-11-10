import {
  IconoAnalisis,
  IconoCatalogos,
  IconoComercial,
  IconoConfiguracion,
  IconoFinanzas,
  IconoInicio,
  IconoPipeline,
} from '../components/icons';

export type Destino = {
  ruta: string;
  nombre: string;
  icono: (props: { className?: string }) => React.ReactElement;
  /** Una frase: qué se hace aquí. Se usa en el estado vacío de cada sección. */
  para: string;
};

/**
 * Los siete destinos de UI_UX_PLAN.md §3, con Pipeline en el lugar que tenía
 * Bancos (ADR-18, ADR-19).
 */
export const DESTINOS: readonly Destino[] = [
  {
    ruta: '/',
    nombre: 'Inicio',
    icono: IconoInicio,
    para: 'La caja de hoy por moneda, lo que está por cobrar y las tres cosas que conviene hacer.',
  },
  {
    ruta: '/comercial',
    nombre: 'Comercial',
    icono: IconoComercial,
    para: 'Cotizaciones, clientes y el estado de cada propuesta enviada.',
  },
  {
    ruta: '/catalogos',
    nombre: 'Catálogos',
    icono: IconoCatalogos,
    para: 'Los servicios que vendes con sus costos, que es de donde sale el margen.',
  },
  {
    ruta: '/finanzas',
    nombre: 'Finanzas',
    icono: IconoFinanzas,
    para: 'Movimientos de caja, documentos y cobros, separados por entidad.',
  },
  {
    ruta: '/pipeline',
    nombre: 'Pipeline',
    icono: IconoPipeline,
    para: 'El tablero de oportunidades y su seguimiento.',
  },
  {
    ruta: '/analisis',
    nombre: 'Análisis',
    icono: IconoAnalisis,
    para: 'Ingresos, gastos y resultado del periodo, sin contar nada dos veces.',
  },
  {
    ruta: '/configuracion',
    nombre: 'Configuración',
    icono: IconoConfiguracion,
    para: 'Entidades, marcas, monedas, impuestos, cuentas y categorías.',
  },
];

/**
 * En móvil caben cuatro destinos más «Más». El `+` central de acciones
 * rápidas que describe el plan sigue pendiente, pero ya no por falta de
 * acciones: desde F3-1 hay tres cosas que se hacen de pie —anotar un
 * movimiento, emitir el documento de una cuota, registrar un cobro—. Falta la
 * hoja que las ofrezca.
 */
export const RUTAS_MOVIL: readonly string[] = ['/', '/finanzas', '/comercial'];

export function destinoDe(ruta: string): Destino | undefined {
  return DESTINOS.find((d) => d.ruta === ruta);
}
