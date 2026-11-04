/**
 * Formato de lo que se lee en pantalla. Dos reglas de UI_UX_PLAN.md §2:
 * cifras tabulares siempre, y ninguna moneda implícita.
 *
 * El dinero no está aquí: vive en money.ts, que trabaja con unidades mínimas
 * en `bigint`. Esto es para porcentajes, fechas y nombres.
 */

const LOCALE = 'es-PE';

/**
 * Una tasa guardada como 18.0000 se lee «18 %» y 0.0000 se lee «0 %».
 * Se admiten hasta dos decimales porque existen tasas como el 4.5 %.
 *
 * Acepta texto además de número a propósito: **PostgREST entrega las columnas
 * `numeric` como string**, aunque los tipos generados por Supabase declaren
 * `number`. Comprobado contra el proyecto real el 03/11/2026: `numeric` vuelve
 * entrecomillado y `bigint` no.
 *
 * Convertir con `Number()` solo es admisible aquí porque una tasa va de 0 a
 * 100 y cabe de sobra en un `double`. **Ningún importe pasa por este camino:**
 * el dinero entra por `money.fromDb`, que lo lleva a unidades mínimas sin
 * tocar la coma flotante.
 */
export function formatoTasa(tasa: number | string): string {
  const valor = typeof tasa === 'number' ? tasa : Number(tasa);
  if (!Number.isFinite(valor)) return '—';
  const n = new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(valor);
  return `${n} %`;
}

/** Fecha corta para listados: 2 nov 2026. */
export function formatoFecha(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat(LOCALE, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(d);
}

/** Mes y año en mayúsculas, como va en la portada: NOVIEMBRE 2026. */
export function formatoMesAño(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const texto = new Intl.DateTimeFormat(LOCALE, { month: 'long', year: 'numeric' }).format(d);
  return texto.replace(' de ', ' ').toLocaleUpperCase(LOCALE);
}

const PAISES: Record<string, string> = { PE: 'Perú', US: 'Estados Unidos' };

/** Código ISO de país a nombre. Si no lo conocemos, se muestra el código. */
export function nombrePais(codigo: string): string {
  return PAISES[codigo] ?? codigo;
}

const CUENTAS: Record<string, string> = {
  bank: 'Banco',
  cash: 'Efectivo',
  wallet: 'Billetera',
  card: 'Tarjeta',
};

export function nombreTipoCuenta(kind: string): string {
  return CUENTAS[kind] ?? kind;
}

const DIRECCIONES: Record<string, string> = {
  in: 'Ingreso',
  out: 'Gasto',
  both: 'Ambos',
};

export function nombreDireccion(direction: string): string {
  return DIRECCIONES[direction] ?? direction;
}

const ROLES: Record<string, string> = {
  owner: 'Dueño',
  admin: 'Administrador',
  finance: 'Finanzas',
  commercial: 'Comercial',
  viewer: 'Solo lectura',
};

export function nombreRol(role: string): string {
  return ROLES[role] ?? role;
}
