import { describe, expect, it } from 'vitest';
import { mensajeDeError } from './errors';

describe('mensajeDeError', () => {
  it('traduce el límite de plan con su cifra', () => {
    expect(mensajeDeError({ message: 'plan_limit_reached:max_legal_entities:2:1' })).toBe(
      'Tu plan llega hasta 1 entidades legales. Para añadir otra hay que subir de plan.',
    );
  });

  it('aguanta un límite de plan sin la cifra', () => {
    expect(mensajeDeError({ message: 'plan_limit_reached:max_currencies' })).toBe(
      'Tu plan no permite añadir más monedas.',
    );
  });

  it('traduce un recurso que no conoce sin romperse', () => {
    expect(mensajeDeError({ message: 'plan_limit_reached:max_inventado:9:3' })).toContain(
      'hasta 3 max_inventado',
    );
  });

  it('traduce el techo de organizaciones', () => {
    expect(mensajeDeError({ message: 'too_many_organizations:3:3' })).toContain('Ya tienes 3');
  });

  it('traduce el trigger de moneda no habilitada', () => {
    const m = mensajeDeError({
      message: 'currency_not_enabled: USD no está habilitada en esta organización',
    });
    expect(m).toContain('Configuración → Monedas');
  });

  it('distingue la ficha de otra empresa de la entidad de otra organización', () => {
    // Comparten prefijo y significan cosas distintas: si el orden de las
    // reglas se rompe, este caso lo caza.
    expect(
      mensajeDeError({ message: 'service_entity_mismatch: la ficha es de otra empresa del grupo' }),
    ).toContain('otra empresa del grupo');
    expect(
      mensajeDeError({ message: 'entity_mismatch: la entidad no pertenece a esta organización' }),
    ).toContain('otra organización');
  });

  it('traduce la entidad de otra organización', () => {
    const m = mensajeDeError({
      message: 'entity_mismatch: la entidad no pertenece a esta organización',
    });
    expect(m).toContain('otra organización');
  });

  it('explica que falta el tipo de cambio en vez de callarse', () => {
    const m = mensajeDeError({ message: 'no_fx_rate: no hay tipo de cambio de USD a PEN' });
    expect(m).toContain('Configuración → Tipo de cambio');
  });

  it('traduce un nombre repetido por su código SQLSTATE', () => {
    const m = mensajeDeError({ message: 'duplicate key value violates…', code: '23505' });
    expect(m).toContain('Ya existe un registro con ese nombre');
  });

  it('no esconde un error que no reconoce', () => {
    expect(mensajeDeError({ message: 'cayó el enlace de red' })).toBe('cayó el enlace de red');
  });

  it('dice algo útil cuando no llega nada', () => {
    expect(mensajeDeError(null)).toBe('Algo falló y no llegó ningún detalle.');
    expect(mensajeDeError({ message: '   ' })).toBe('Algo falló y no llegó ningún detalle.');
  });

  it('traduce una contraseña equivocada, por mensaje y por código', () => {
    expect(mensajeDeError({ message: 'Invalid login credentials' })).toBe(
      'Correo o contraseña incorrectos.',
    );
    expect(mensajeDeError({ message: 'algo en inglés', code: 'invalid_credentials' })).toBe(
      'Correo o contraseña incorrectos.',
    );
  });

  it('explica el correo que Supabase no quiere enviar', () => {
    const m = mensajeDeError({ message: '…', code: 'email_address_not_authorized' });
    expect(m).toContain('Entra con contraseña');
  });

  it('explica el límite de correos en vez de dejarlo en inglés', () => {
    expect(mensajeDeError({ message: 'email rate limit exceeded' })).toContain('límite bajo');
  });

  it('prefiere el mensaje propio al código cuando llegan los dos', () => {
    const m = mensajeDeError({ message: 'not_authenticated', code: '42501' });
    expect(m).toBe('Tu sesión caducó. Vuelve a entrar.');
  });

  it('explica una cotización que ya no es tuya en vez de callarse', () => {
    // El fallo que se arregló: antes la base devolvía cero filas sin error y
    // la pantalla decía que había guardado.
    expect(mensajeDeError({ message: 'quote_not_found: la cotización no existe' })).toContain(
      'ya no existe',
    );
  });
});

describe('F5 · los trabajos', () => {
  it('el trabajo de otra empresa conserva los nombres, que son lo que hay que corregir', () => {
    expect(
      mensajeDeError({
        message:
          'trabajo_de_otra_empresa: «Campaña de lanzamiento» es un trabajo de Demo Perú SAC y esto es de Demo Studio LLC. El dinero no cruza de una empresa a otra: el costo de un trabajo de Demo Perú SAC tiene que anotarse en Demo Perú SAC',
      }),
    ).toContain('«Campaña de lanzamiento» es un trabajo de Demo Perú SAC');
  });

  it('atribuir el pago de una factura dice cuál es la factura', () => {
    expect(
      mensajeDeError({
        message:
          'el_pago_no_se_atribuye: este pago salda la factura «Impresión del lanzamiento». Lo que cuenta en el trabajo es la factura, no el pago: atribuye la factura',
      }),
    ).toContain('«Impresión del lanzamiento»');
  });

  it('atribuir una venta a mano se explica, no se deja en el código crudo', () => {
    const frase = mensajeDeError({ message: 'no_es_una_compra: a un trabajo se le atribuye…' });
    expect(frase).toContain('sale de la línea que se aprobó');
    expect(frase).not.toContain('no_es_una_compra');
  });

  it('una entrada atribuida explica por qué se contaría dos veces', () => {
    expect(mensajeDeError({ message: 'no_es_un_gasto: una entrada no' })).toContain(
      'la contaría dos veces',
    );
  });
});

describe('F5-3 · los previstos', () => {
  it('una cuota de cotización dice cuál es y a dónde ir', () => {
    expect(
      mensajeDeError({
        message:
          'cuota_de_cotizacion: «Pago único» es una cuota de una cotización: emite su documento y cóbralo, que es lo que la mete en la cartera',
      }),
    ).toContain('«Pago único»');
  });

  it('uno con dinero asignado dice qué anular primero', () => {
    expect(
      mensajeDeError({
        message:
          'previsto_con_dinero: «Cámara pactada» ya tiene un movimiento asignado. Anula ese movimiento desde Caja antes de cambiarlo',
      }),
    ).toContain('Anula ese movimiento desde Caja');
  });

  it('la dirección se explica por lo que decide, no por lo que prohíbe', () => {
    const frase = mensajeDeError({ message: 'direccion_invalida: un previsto es…' });
    expect(frase).toContain('con qué movimiento se puede saldar');
    expect(frase).not.toContain('direccion_invalida');
  });

  it('la fecha se explica por para qué sirve', () => {
    expect(mensajeDeError({ message: 'fecha_obligatoria: sin fecha' })).toContain(
      'no caería en ninguna semana'.replace('caería', 'cae'),
    );
  });
});

describe('F6-1 · la conciliación', () => {
  it('el extracto repetido dice cuál era y cuándo entró', () => {
    expect(
      mensajeDeError({
        message:
          'extracto_repetido: este mismo extracto ya se importó como «BCP · noviembre» el 23/11/2026. Importarlo otra vez duplicaría media conciliación',
      }),
    ).toContain('«BCP · noviembre»');
  });

  it('un movimiento ya conciliado dice contra qué línea está', () => {
    expect(
      mensajeDeError({
        message:
          'movimiento_ya_conciliado: ese movimiento ya está marcado contra la línea «COMISION» del 03/11/2026. Un movimiento no puede ser dos apuntes del banco',
      }),
    ).toContain('«COMISION» del 03/11/2026');
  });

  it('un archivo del que no se leyó nada apunta a la causa de siempre', () => {
    expect(mensajeDeError({ message: 'extracto_vacio: no se leyó nada' })).toContain(
      'la columna marcada como fecha',
    );
  });

  it('un movimiento anulado explica por qué no vale para cuadrar', () => {
    expect(mensajeDeError({ message: 'movimiento_anulado: está anulado' })).toContain(
      'escondería la línea de verdad',
    );
  });
});
