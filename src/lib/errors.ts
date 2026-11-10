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

/**
 * Códigos cuyo mensaje ya viene escrito para leerse y con la cifra concreta
 * dentro. Aquí una traducción fija sería peor: perdería el número, que es lo
 * único que le dice al usuario qué tiene que corregir. Lo único que sobra es
 * el código delante.
 */
const CON_CIFRAS: readonly string[] = [
  'cronograma_descuadrado',
  'cobro_excede_documento',
  'asignacion_excede_movimiento',
  'desglose_descuadrado',
  'documento_cerrado',
  'cuenta_de_otro_libro',
  // Estos tres traen los nombres propios dentro: qué gasto, qué empresa, qué
  // cuenta, cuántos pagos. Sin ellos el mensaje no se puede corregir, que es
  // justo lo que pasaba cuando este error llegaba como violación de clave
  // ajena y decía «falta un dato relacionado» (trampa #15).
  'gasto_de_otra_empresa',
  'gasto_en_otra_moneda',
  'gasto_no_se_muda',
  // F3-6 · las compras. Cada uno trae dentro lo que hay que corregir: qué
  // proveedor, qué número repetido, qué categoría, qué fechas, cuánto queda.
  'pago_excede_documento',
  'compra_repetida',
  'categoria_de_ingreso',
  'vencimiento_antes_de_la_fecha',
  'documento_con_dinero',
  'direccion_no_concuerda',
  'esto_es_una_compra',
  'esto_es_una_venta',
  'proveedor_obligatorio',
];

function conCifras(bruto: string): string | null {
  const corte = bruto.indexOf(':');
  if (corte < 0) return null;
  if (!CON_CIFRAS.includes(bruto.slice(0, corte).trim())) return null;

  const resto = bruto.slice(corte + 1).trim();
  if (!resto) return null;
  const frase = resto.charAt(0).toUpperCase() + resto.slice(1);
  return /[.!?]$/.test(frase) ? frase : `${frase}.`;
}

/** Prefijos con traducción fija. Son exclusivos entre sí, el orden no importa. */
const FIJOS: readonly (readonly [string, string])[] = [
  [
    'currency_not_enabled',
    'Esa moneda no está habilitada en la organización. Habilítala primero en Configuración → Monedas.',
  ],
  [
    'no_fx_rate',
    'Falta el tipo de cambio entre esas dos monedas. Cárgalo en Configuración → Tipo de cambio: el sistema no se lo inventa, porque una conversión sin fuente no es un dato.',
  ],
  [
    'service_entity_mismatch',
    'Esa ficha es de la otra empresa del grupo. Son dos contabilidades con monedas distintas, así que no se pueden cruzar: crea la ficha en esta empresa o cotiza desde la otra.',
  ],
  [
    'quote_not_found',
    'Esa cotización ya no existe o no es de tu organización. Vuelve al listado y ábrela de nuevo.',
  ],
  [
    'design_patch_invalid',
    'El ajuste de diseño llegó mal formado. Recarga la pantalla; si vuelve a pasar, es un fallo nuestro.',
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
  ['not_authenticated', 'Tu sesión caducó. Vuelve a entrar.'],
  // Los de acceso llegan con el texto de Supabase, en inglés, y son los que
  // más va a ver alguien que se equivoca al teclear.
  ['Invalid login credentials', 'Correo o contraseña incorrectos.'],
  ['Email not confirmed', 'Ese usuario existe pero su correo no está confirmado. Confírmalo desde el panel de Supabase, en Authentication → Users.'],
  ['email rate limit exceeded', 'Supabase no deja enviar más correos por ahora: su servicio de cortesía tiene un límite bajo por hora. Entra con contraseña o espera un rato (D-7).'],
  // F2-15 · el cronograma de cobro
  [
    'cotizacion_no_aprobada',
    'El cronograma de cobro se arma cuando el cliente acepta la cotización. Mientras no esté aprobada no hay nada que repartir.',
  ],
  [
    'sin_version',
    'Esta cotización no tiene ninguna versión emitida, así que no hay un total aceptado que repartir. Emítela primero.',
  ],
  [
    'cronograma_invalido',
    'El cronograma llegó mal formado o con demasiadas cuotas. Recarga la pantalla y vuelve a repartir.',
  ],
  // F3 · documentos, cobros y el libro de caja
  [
    'cuota_no_encontrada',
    'Esa cuota ya no existe, o no tienes permiso de finanzas en esta organización. El cronograma lo arma quien lleva el dinero.',
  ],
  [
    'cuota_no_prevista',
    'Esta cuota ya tiene documento emitido o ya se cobró. Para cambiarla hay que anular lo que haya detrás, no volver a emitir.',
  ],
  [
    'cuota_sin_cotizacion',
    'Esta cuota no cuelga de ninguna cotización, así que no se sabe a qué cliente facturarla.',
  ],
  [
    'documento_no_encontrado',
    'Ese documento ya no existe, o no tienes permiso de finanzas en esta organización.',
  ],
  [
    'cuenta_no_encontrada',
    'Esa cuenta ya no existe, o no tienes permiso de finanzas en esta organización.',
  ],
  ['importe_invalido', 'El importe tiene que ser mayor que cero.'],
  [
    'descripcion_obligatoria',
    'Un movimiento necesita concepto. Sin él, dentro de tres meses no se puede conciliar con el extracto del banco.',
  ],
  ['motivo_obligatorio', 'Anular algo exige decir por qué. Queda escrito y no se borra.'],
  [
    'movimiento_no_encontrado',
    'Ese movimiento ya no existe, o no tienes permiso de finanzas en esta organización.',
  ],
  ['movimiento_ya_anulado', 'Este movimiento ya estaba anulado.'],
  // F3-3 · gastos fijos
  [
    'gasto_no_encontrado',
    'Ese gasto fijo ya no existe, o no tienes permiso de finanzas en esta organización.',
  ],
  [
    'recurrente_solo_sale',
    'Un gasto fijo se paga, no se cobra. Si entró dinero, no es el pago de una suscripción: anótalo como entrada suelta.',
  ],
  [
    'etiqueta_obligatoria',
    'El gasto necesita un nombre, el que vas a reconocer en el extracto del banco.',
  ],
  [
    'entidad_no_encontrada',
    'Esa empresa ya no existe, o no tienes permiso de finanzas en esta organización.',
  ],
  ['invalid_name', 'Hace falta un nombre.'],
  ['unknown_currency', 'Esa moneda no existe en el catálogo.'],
  // F3-6 · compras
  [
    'categoria_no_encontrada',
    'Esa categoría ya no existe en esta organización. Recarga la pantalla y elígela otra vez.',
  ],
  ['impuesto_invalido', 'El impuesto no puede ser negativo.'],
  ['documento_ya_anulado', 'Este documento ya estaba anulado.'],
];

/** Códigos SQLSTATE que llegan sin ningún mensaje nuestro. */
const POR_CODIGO: Record<string, string> = {
  '23505':
    'Ya existe un registro con ese nombre. Los nombres no se repiten dentro de una organización.',
  '23503': 'Falta un dato relacionado, o el que elegiste ya no existe.',
  '23514': 'Algún valor no cumple una regla de la base de datos.',
  '42501':
    'La base de datos no te deja hacer eso. Si crees que deberías poder, es una política que hay que revisar, no un permiso que subir.',
  PGRST301: 'Tu sesión caducó. Vuelve a entrar.',
  invalid_credentials: 'Correo o contraseña incorrectos.',
  email_not_confirmed:
    'Ese usuario existe pero su correo no está confirmado. Confírmalo desde el panel de Supabase, en Authentication → Users.',
  user_not_found: 'No hay ningún usuario con ese correo.',
  weak_password: 'Esa contraseña es demasiado corta o demasiado común.',
  email_address_not_authorized:
    'Supabase solo escribe a los correos de los miembros de su organización mientras no haya SMTP propio. Entra con contraseña (D-7).',
  over_email_send_rate_limit:
    'Supabase no deja enviar más correos por ahora: su servicio de cortesía tiene un límite bajo por hora. Entra con contraseña o espera un rato (D-7).',
  over_request_rate_limit: 'Demasiados intentos seguidos. Espera un minuto.',
};

const SIN_DETALLE = 'Algo falló y no llegó ningún detalle.';

export function mensajeDeError(error: ErrorLike): string {
  if (!error) return SIN_DETALLE;

  const bruto = (error.message ?? '').trim();
  const partes = bruto.split(':');

  const conDatos =
    limiteDePlan(partes) ?? demasiadasOrganizaciones(partes) ?? conCifras(bruto);
  if (conDatos) return conDatos;

  for (const [prefijo, texto] of FIJOS) {
    if (bruto.startsWith(prefijo)) return texto;
  }

  const porCodigo = error.code ? POR_CODIGO[error.code] : undefined;
  if (porCodigo) return porCodigo;

  return bruto || SIN_DETALLE;
}
