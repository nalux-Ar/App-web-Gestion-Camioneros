import { describe, expect, it } from 'vitest';

import { caracteresDelMensaje, limpiarMensaje, validarMensaje } from './reportar-form';
import { MAX_MENSAJE, MENSAJE_VACIO, textoContador, textoMensajeLargo } from './reportar-textos';

describe('validarMensaje', () => {
  it('vacío o solo espacios (también saltos de línea y tabs): error', () => {
    for (const vacio of ['', ' ', '   ', '\n\n', '\t \n ']) {
      expect(validarMensaje(vacio), JSON.stringify(vacio)).toEqual({ ok: false, error: MENSAJE_VACIO });
    }
  });

  it('se manda sin los espacios de los extremos (los del medio quedan)', () => {
    expect(validarMensaje('  No guarda  el gasto \n')).toEqual({ ok: true, mensaje: 'No guarda  el gasto' });
  });

  it(`${MAX_MENSAJE} caracteres: sí; ${MAX_MENSAJE + 1}: no, y dice cuántos tiene`, () => {
    expect(validarMensaje('a'.repeat(MAX_MENSAJE))).toEqual({ ok: true, mensaje: 'a'.repeat(MAX_MENSAJE) });
    expect(validarMensaje('a'.repeat(MAX_MENSAJE + 1))).toEqual({ ok: false, error: textoMensajeLargo(MAX_MENSAJE + 1) });
  });

  it('los espacios de los extremos no cuentan para el tope', () => {
    expect(validarMensaje(`   ${'a'.repeat(MAX_MENSAJE)}   `).ok).toBe(true);
  });

  it('cuenta caracteres reales: un emoji es 1 (como Postgres), no 2', () => {
    expect(caracteresDelMensaje('🚚')).toBe(1);
    expect(validarMensaje('🚚'.repeat(MAX_MENSAJE)).ok).toBe(true);
    expect(validarMensaje('🚚'.repeat(MAX_MENSAJE + 1)).ok).toBe(false);
  });

  it('quita los caracteres de control (NUL, BEL, ESC, DEL, C1, CR) pero deja saltos de línea y tabulaciones', () => {
    const c = (...codes: number[]) => String.fromCharCode(...codes);
    expect(limpiarMensaje(`a${c(0)}b${c(7)}c${c(27)}d${c(0x7f)}e${c(0x85)}f${c(13)}g`)).toBe('abcdefg');
    expect(limpiarMensaje(`uno${c(10)}dos${c(9)}tres`)).toBe(`uno${c(10)}dos${c(9)}tres`);
    expect(validarMensaje(`  hola${c(0)} `)).toEqual({ ok: true, mensaje: 'hola' });
  });

  it('solo controles, saltos de línea o tabs: como vacío (la base exige un caracter que no sea espacio)', () => {
    const c = (...codes: number[]) => String.fromCharCode(...codes);
    for (const vacio of [c(0, 7, 27), c(10, 9, 10), c(9), c(0, 10)]) {
      expect(validarMensaje(vacio)).toEqual({ ok: false, error: MENSAJE_VACIO });
    }
  });

  it('los controles no cuentan para el contador ni para el tope', () => {
    const c = (...codes: number[]) => String.fromCharCode(...codes);
    expect(caracteresDelMensaje(`ab${c(0, 0, 0)}`)).toBe(2);
    expect(validarMensaje(`${'a'.repeat(MAX_MENSAJE)}${c(0, 0, 0)}`).ok).toBe(true);
  });

  it('HTML o SQL son texto como cualquier otro', () => {
    expect(validarMensaje('<b>hola</b> \'; DROP TABLE x; --')).toEqual({ ok: true, mensaje: '<b>hola</b> \'; DROP TABLE x; --' });
  });
});

describe('textos del formulario', () => {
  it('contador y mensaje largo', () => {
    expect(textoContador(0)).toBe('0 de 2000 caracteres');
    expect(textoContador(2001)).toBe('2001 de 2000 caracteres');
    expect(textoMensajeLargo(2001)).toBe('Tu mensaje tiene 2001 caracteres. El máximo es 2000: acórtalo un poco.');
  });

  it('caracteresDelMensaje sin los extremos', () => {
    expect(caracteresDelMensaje('  hola \n')).toBe(4);
    expect(caracteresDelMensaje('')).toBe(0);
  });
});

describe('mensajes raros: sustitutos sueltos e invisibles', () => {
  const c = (...codes: number[]) => String.fromCharCode(...codes);

  it('quita los sustitutos sueltos (PostgREST rechazaría siempre el envío) y deja los emoji válidos', () => {
    expect(limpiarMensaje(`a${c(0xd800)}b`)).toBe('ab');
    expect(limpiarMensaje(`a${c(0xdc00)}b${c(0xdfff)}`)).toBe('ab');
    expect(limpiarMensaje('camión 🚚 ok')).toBe('camión 🚚 ok');
    expect(validarMensaje(`hola${c(0xd83d)}`)).toEqual({ ok: true, mensaje: 'hola' });
    expect(validarMensaje(c(0xd800, 0xdbff))).toEqual({ ok: false, error: MENSAJE_VACIO }); // solo sustitutos sueltos: vacío
  });

  it.each([0x200b, 0x200c, 0x200d, 0x2060, 0xfeff, 0x3164].map((code) => [code.toString(16).toUpperCase(), code] as const))('solo invisibles (U+%s): cuenta como vacío', (_hex, code) => {
    expect(validarMensaje(c(code, code, code))).toEqual({ ok: false, error: MENSAJE_VACIO });
    expect(validarMensaje(` ${c(code)}\n${c(code)}\t`)).toEqual({ ok: false, error: MENSAJE_VACIO });
  });

  it('con algo visible se envía, y los invisibles del medio quedan (la unión de un emoji compuesto no se rompe)', () => {
    const familia = String.fromCodePoint(0x1f468, 0x200d, 0x1f469);
    expect(validarMensaje(familia)).toEqual({ ok: true, mensaje: familia });
    expect(validarMensaje(`${c(0x200b)}hola${c(0x200b)}`).ok).toBe(true);
  });
});
