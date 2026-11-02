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

  it('traduce la entidad de otra organización', () => {
    const m = mensajeDeError({
      message: 'entity_mismatch: la entidad no pertenece a esta organización',
    });
    expect(m).toContain('otra organización');
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

  it('prefiere el mensaje propio al código cuando llegan los dos', () => {
    const m = mensajeDeError({ message: 'not_authenticated', code: '42501' });
    expect(m).toBe('Tu sesión caducó. Vuelve a entrar con tu correo.');
  });
});
