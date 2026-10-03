import { describe, expect, it } from 'vitest';

import { charLength } from '@/lib/text';

describe('charLength (como length() de Postgres: code points, no unidades UTF-16)', () => {
  it('cuenta caracteres comunes y vacío', () => {
    expect(charLength('')).toBe(0);
    expect(charLength('hola')).toBe(4);
    expect(charLength('ñandú')).toBe(5);
  });

  it('un emoji cuenta 1, no 2', () => {
    expect('😀'.length).toBe(2);
    expect(charLength('😀')).toBe(1);
    expect(charLength('a😀b')).toBe(3);
  });

  it('con tope nunca devuelve más de tope + 1', () => {
    expect(charLength('abcdef', 3)).toBe(4);
    expect(charLength('abc', 3)).toBe(3);
    expect(charLength('😀'.repeat(10), 3)).toBe(4);
  });

  it('con un texto gigante no lo recorre: responde tope + 1 por el largo en unidades UTF-16', () => {
    expect(charLength('x'.repeat(10_000_000), 200)).toBe(201);
  });

  it('el límite exacto: 200 caracteres no pasan de 200; 201 sí', () => {
    expect(charLength('a'.repeat(200), 200)).toBe(200);
    expect(charLength('a'.repeat(201), 200)).toBe(201);
    expect(charLength('😀'.repeat(200), 200)).toBe(200);
  });
});
