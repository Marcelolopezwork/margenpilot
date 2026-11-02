/**
 * Traduce los errores de la base de datos a frases que dicen qué pasó y qué
 * hacer. Las excepciones de las migraciones vienen con una forma estable
 * (`clave: texto` o `clave:dato:dato`) justamente para poder reconocerlas aquí
 * sin leer el texto libre, que puede cambiar.
 *
 * El criterio: un mensaje de error que obliga al usuario a preguntar es un
 * error sin resolver. Si no reconocemos la causa, se devuelve el mensaje
 * original en vez de un «error inesperado» que esconde la única pista que hay.
 */

/** Lo mínimo que traen tanto PostgrestError como un Error normal. */
export type ErrorLike = { message?: string | null; code?: string | null } | null | undefined;

const RECURSOS: Record<string, string> = {
  max_legal_entities: 'entidades legales',
  max_currencies: 'monedas',
  max_cash_accounts: 'cuentas de caja',
  max_members: 'miembros del equipo',
};

/** `plan_limit_reached:max_legal_entities:2:1` → recurso, usado, límite. */
function limiteDePlan(partes: string[]): string | null {
  if (partes[0] !== 'plan_limit_reached') return null;
  const clave = partes[1] ?? '';
  const limite = partes[3];
  const recurso = RECURSOS[clave] ?? clave;
  if (!limite) return `Tu plan no permite añadir más ${recurso || 'de eso'}.`;
  return `Tu plan llega hasta ${limite} ${recurso}. Para añadir otra hay que subir de plan.`;
}

/** `too_many_organizations:3:3` → ya tiene, máximo. */
function demasiadasOrganizaciones(partes: string[]): string | null {
  if (partes[0] !== 'too_many_organizations') return null;
  const tiene = partes[1];
  if (!tiene) return 'Llegaste al máximo de organizaciones por cuenta.';
  return `Ya tienes ${tiene} organizaciones, que es el máximo por cuenta. Archiva una antes de crear otra.`;
}

/** Prefijos con traducción fija. Son exclusivos entre sí, el orden no importa. */
const FIJOS: readonly (readonly [string, string])[] = [
  [
    'currency_not_enabled',
    'Esa moneda no está habilitada en la organización. Habilítala primero en Configuración → Monedas.',
  ],
  [
    'entity_mismatch',
    'La entidad elegida es de otra organización. Elige una entidad de esta organización.',
  ],
  [
    'plan_reconciliation_required',
    'Bajaste de plan y falta elegir qué entidades y monedas quedan activas. Hasta hacerlo no se puede crear nada nuevo.',
  ],
  ['no_subscription', 'La organización no tiene plan asignado. Esto hay que arreglarlo en la base.'],
  [
    'unknown_entitlement',
    'El plan declara un límite que no tiene contador. Es un error de configuración del plan, no tuyo.',
  ],
  ['not_authenticated', 'Tu sesión caducó. Vuelve a entrar con tu correo.'],
  ['invalid_name', 'Hace falta un nombre.'],
  ['unknown_currency', 'Esa moneda no existe en el catálogo.'],
];

/** Códigos SQLSTATE que llegan sin ningún mensaje nuestro. */
const POR_CODIGO: Record<string, string> = {
  '23505':
    'Ya existe un registro con ese nombre. Los nombres no se repiten dentro de una organización.',
  '23503': 'Falta un dato relacionado, o el que elegiste ya no existe.',
  '23514': 'Algún valor no cumple una regla de la base de datos.',
  '42501':
    'La base de datos no te deja hacer eso. Si crees que deberías poder, es una política que hay que revisar, no un permiso que subir.',
  PGRST301: 'Tu sesión caducó. Vuelve a entrar con tu correo.',
};

const SIN_DETALLE = 'Algo falló y no llegó ningún detalle.';

export function mensajeDeError(error: ErrorLike): string {
  if (!error) return SIN_DETALLE;

  const bruto = (error.message ?? '').trim();
  const partes = bruto.split(':');

  const conDatos = limiteDePlan(partes) ?? demasiadasOrganizaciones(partes);
  if (conDatos) return conDatos;

  for (const [prefijo, texto] of FIJOS) {
    if (bruto.startsWith(prefijo)) return texto;
  }

  const porCodigo = error.code ? POR_CODIGO[error.code] : undefined;
  if (porCodigo) return porCodigo;

  return bruto || SIN_DETALLE;
}
