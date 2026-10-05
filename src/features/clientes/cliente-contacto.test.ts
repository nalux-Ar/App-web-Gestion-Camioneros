import { describe, expect, it } from 'vitest';

import { hrefEmail, hrefTelefono } from '@/features/clientes/cliente-contacto';

describe('hrefTelefono (enlace tel: solo con un número limpio)', () => {
  it('arma tel: SOLO con los dígitos (y el + inicial), no con el texto tal cual', () => {
    expect(hrefTelefono('351 555-1234')).toBe('tel:3515551234');
    expect(hrefTelefono('+54 9 351 555-1234')).toBe('tel:+5493515551234');
    expect(hrefTelefono('(0351) 555.1234')).toBe('tel:03515551234');
    expect(hrefTelefono('  3515551234  ')).toBe('tel:3515551234');
  });

  it('entre 6 y 15 dígitos', () => {
    expect(hrefTelefono('123456')).toBe('tel:123456');
    expect(hrefTelefono('12345')).toBeNull();
    expect(hrefTelefono('123456789012345')).toBe('tel:123456789012345');
    expect(hrefTelefono('1234567890123456')).toBeNull();
    expect(hrefTelefono('+ ( ) - .')).toBeNull(); // sin dígitos
  });

  it('con letras, anotaciones u otros símbolos NO arma enlace (se muestra como texto)', () => {
    for (const raro of [
      '351 555-1234 Juan',
      '351-ALMACEN',
      '351 555 1234 int. 23',
      '*123#',
      '351;ext=2',
      '351,555',
      '+54+9351',
      '3515551234+',
      '351\n5551234',
      '351\t5551234',
      'tel:3515551234',
      'javascript:alert(1)',
      'javascript:alert(3515551234)',
      'data:text/html,<script>alert(1)</script>',
      '//evil.test/3515551234',
      'https://evil.test',
      '３５１５５５１２３４', // dígitos de ancho completo
    ]) {
      expect(hrefTelefono(raro), JSON.stringify(raro)).toBeNull();
    }
  });

  it('vacío, null, undefined y lo que no es texto: null', () => {
    for (const raro of ['', '   ', null, undefined, 3515551234, {}, ['3515551234'], { toString: () => '3515551234' }]) {
      expect(hrefTelefono(raro), JSON.stringify(raro)).toBeNull();
    }
  });

  it('más largo que lo que acepta la base (50): null', () => {
    expect(hrefTelefono(`351 ${' '.repeat(50)}5551234`)).toBeNull();
  });

  it('lo que devuelve siempre es tel: seguido de un + opcional y dígitos', () => {
    for (const valido of ['351 555-1234', '+54 9 351 555-1234', '(0351) 555.1234', '011 4444-5555']) {
      expect(hrefTelefono(valido)).toMatch(/^tel:\+?[0-9]{6,15}$/);
    }
  });
});

describe('hrefEmail (enlace mailto: solo con un email estricto)', () => {
  it('arma mailto: con el email recortado', () => {
    expect(hrefEmail('ventas@bodega.test')).toBe('mailto:ventas@bodega.test');
    expect(hrefEmail('  Ventas.Norte+pedidos@sub.bodega.test.ar ')).toBe('mailto:Ventas.Norte+pedidos@sub.bodega.test.ar');
    expect(hrefEmail('a_b-c@x-y.co')).toBe('mailto:a_b-c@x-y.co');
  });

  it('nada que permita colar parámetros, otro esquema o un destino distinto', () => {
    for (const raro of [
      'ventas@bodega.test?bcc=otro@evil.test',
      'ventas@bodega.test&cc=otro@evil.test',
      'ventas@bodega.test#x',
      'ventas@bodega.test,otro@evil.test',
      'ventas@bodega.test;otro@evil.test',
      'mailto:ventas@bodega.test',
      'javascript:alert(1)//@x.test',
      'javascript:alert(1)',
      'ventas%40bodega.test@x.test',
      'a%0Abcc@x.test',
      'ventas @bodega.test',
      'ventas@bodega .test',
      'ventas@bodega.test\nbcc:otro@evil.test',
      '"ventas"@bodega.test',
      '<ventas@bodega.test>',
      'ventas@[127.0.0.1]',
      'ventas@bodega/../x.test',
      'https://evil.test',
    ]) {
      expect(hrefEmail(raro), JSON.stringify(raro)).toBeNull();
    }
  });

  it('formas inválidas: sin arroba, sin dominio, sin punto, TLD numérico o de 1 letra, puntos raros, guiones en los bordes', () => {
    for (const raro of [
      'ventas',
      'ventas@',
      '@bodega.test',
      'ventas@bodega',
      'ventas@bodega.c',
      'ventas@bodega.123',
      '.ventas@bodega.test',
      'ventas.@bodega.test',
      'ven..tas@bodega.test',
      'ventas@-bodega.test',
      'ventas@bodega-.test',
      'ventas@bodega..test',
      'a@b@c.test',
    ]) {
      expect(hrefEmail(raro), raro).toBeNull();
    }
  });

  it('caracteres fuera de ASCII (dominios con tilde) no arman enlace: se muestran como texto', () => {
    expect(hrefEmail('ventas@almacén.test.ar')).toBeNull();
    expect(hrefEmail('josé@bodega.test')).toBeNull();
  });

  it('vacío, null, undefined, lo que no es texto y lo demasiado largo: null', () => {
    for (const raro of ['', '  ', null, undefined, 42, {}, ['a@b.co']]) {
      expect(hrefEmail(raro), JSON.stringify(raro)).toBeNull();
    }
    expect(hrefEmail(`${'a'.repeat(65)}@b.co`)).toBeNull(); // parte local de más de 64
    expect(hrefEmail(`a@${'b'.repeat(250)}.test`)).toBeNull(); // más de 254 en total
  });
});
