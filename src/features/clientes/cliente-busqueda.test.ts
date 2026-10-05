import { describe, expect, it } from 'vitest';

import {
  MAX_BUSQUEDA,
  busquedaToParams,
  busquedaToSearch,
  filtrarClientes,
  hayBusqueda,
  leerBusqueda,
  limpiarBusqueda,
  sanitizeVolverClientes,
  textoCantidadClientes,
} from '@/features/clientes/cliente-busqueda';

const CLIENTES = [
  { id: '1', nombre: 'Almacén Central' },
  { id: '2', nombre: 'Bodega Norte' },
  { id: '3', nombre: 'Cooperativa  Agrícola del Sur' },
  { id: '4', nombre: 'Distribuidora ÑANDÚ' },
  { id: '5', nombre: 'almacen del puerto' },
];

const params = (texto: string) => new URLSearchParams(texto);

describe('filtrarClientes (búsqueda local que ignora tildes, mayúsculas y espacios de más)', () => {
  it('sin búsqueda (o de solo espacios), todos y en el mismo orden', () => {
    expect(filtrarClientes(CLIENTES, '').map((c) => c.id)).toEqual(['1', '2', '3', '4', '5']);
    expect(filtrarClientes(CLIENTES, '   ').map((c) => c.id)).toEqual(['1', '2', '3', '4', '5']);
  });

  it('"almacen" encuentra "Almacén Central" y "almacen del puerto" (sin tildes ni mayúsculas)', () => {
    expect(filtrarClientes(CLIENTES, 'almacen').map((c) => c.id)).toEqual(['1', '5']);
    expect(filtrarClientes(CLIENTES, 'ALMACÉN').map((c) => c.id)).toEqual(['1', '5']);
  });

  it('busca en cualquier parte del nombre, no solo al principio', () => {
    expect(filtrarClientes(CLIENTES, 'norte').map((c) => c.id)).toEqual(['2']);
    expect(filtrarClientes(CLIENTES, 'agricola del').map((c) => c.id)).toEqual(['3']); // el nombre tiene dos espacios
    expect(filtrarClientes(CLIENTES, '  agrícola   DEL  ').map((c) => c.id)).toEqual(['3']);
  });

  it('la ñ, como las demás tildes, se busca igual con o sin ella (la misma regla que el aviso de duplicado)', () => {
    expect(filtrarClientes(CLIENTES, 'ñandu').map((c) => c.id)).toEqual(['4']);
    expect(filtrarClientes(CLIENTES, 'nandú').map((c) => c.id)).toEqual(['4']);
  });

  it('sin coincidencias: lista vacía', () => {
    expect(filtrarClientes(CLIENTES, 'zzz')).toEqual([]);
  });

  it('no modifica la lista original', () => {
    const copia = [...CLIENTES];
    filtrarClientes(CLIENTES, 'almacen');
    expect(CLIENTES).toEqual(copia);
  });
});

describe('leerBusqueda / limpiarBusqueda (?q= es entrada del usuario)', () => {
  it('lee q tal cual (sin recortar: así se puede seguir escribiendo después de un espacio)', () => {
    expect(leerBusqueda(params('q=almacen'))).toBe('almacen');
    expect(leerBusqueda(params('q=Almac%C3%A9n%20'))).toBe('Almacén ');
    expect(leerBusqueda(params(''))).toBe('');
    expect(leerBusqueda(params('otra=cosa'))).toBe('');
  });

  it(`corta a ${MAX_BUSQUEDA} caracteres (code points: un emoji es 1)`, () => {
    expect(limpiarBusqueda('a'.repeat(150))).toBe('a'.repeat(MAX_BUSQUEDA));
    expect(Array.from(limpiarBusqueda('🚚'.repeat(150)))).toHaveLength(MAX_BUSQUEDA);
    expect(leerBusqueda(params(`q=${'b'.repeat(500)}`))).toHaveLength(MAX_BUSQUEDA);
  });

  it('el recorte previo de un texto enorme no cambia el resultado, ni siquiera si corta un emoji a la mitad', () => {
    // 'a' + 150 emojis: los primeros 100 code points ocupan 199 unidades UTF-16 y la 200 es la mitad de un emoji.
    const mezcla = limpiarBusqueda(`a${'🚚'.repeat(150)}`);
    expect(mezcla).toBe(`a${'🚚'.repeat(MAX_BUSQUEDA - 1)}`);
    expect(Array.from(mezcla)).toHaveLength(MAX_BUSQUEDA);
    expect(limpiarBusqueda('c'.repeat(3_000_000))).toBe('c'.repeat(MAX_BUSQUEDA));
  });

  it('los caracteres de control (saltos, tabs, nulos, DEL) se cambian por un espacio', () => {
    expect(limpiarBusqueda('alma\ncen')).toBe('alma cen');
    expect(limpiarBusqueda('a\tb\u0000c\u007fd\u0085e')).toBe('a b c d e');
  });

  it('lo que no es texto da vacío', () => {
    for (const raro of [null, undefined, 42, {}, ['almacen'], true]) {
      expect(limpiarBusqueda(raro), JSON.stringify(raro)).toBe('');
    }
  });

  it('hayBusqueda: solo espacios no cuenta', () => {
    expect(hayBusqueda('')).toBe(false);
    expect(hayBusqueda('   ')).toBe(false);
    expect(hayBusqueda(' a ')).toBe(true);
  });
});

describe('busquedaToParams / busquedaToSearch', () => {
  it('sin búsqueda no se escribe nada (/clientes es "todos")', () => {
    expect(busquedaToParams('').toString()).toBe('');
    expect(busquedaToParams('   ').toString()).toBe('');
    expect(busquedaToSearch('')).toBe('');
  });

  it('con búsqueda: ?q=..., codificada', () => {
    expect(busquedaToSearch('almacen')).toBe('?q=almacen');
    expect(busquedaToSearch('Almacén Central')).toBe('?q=Almac%C3%A9n+Central');
    expect(busquedaToSearch('a&b=c')).toBe('?q=a%26b%3Dc'); // no cuela otro parámetro
  });

  it('ida y vuelta: lo que se escribe se lee igual', () => {
    for (const q of ['almacen', 'Almacén Central', 'a&b=c', 'año 2025', '50% off']) {
      expect(leerBusqueda(busquedaToParams(q))).toBe(q);
    }
  });
});

describe('sanitizeVolverClientes (el volver del state no es de confianza)', () => {
  it('acepta lo que la lista podría haber escrito (con o sin ?)', () => {
    expect(sanitizeVolverClientes('?q=almacen')).toBe('?q=almacen');
    expect(sanitizeVolverClientes('q=almacen')).toBe('?q=almacen');
    expect(sanitizeVolverClientes('')).toBe('');
    expect(sanitizeVolverClientes('?q=')).toBe('');
  });

  it('quita cualquier otro parámetro y sanea el q', () => {
    expect(sanitizeVolverClientes('?q=almacen&next=//evil.test')).toBe('?q=almacen');
    expect(sanitizeVolverClientes('?mes=2025-08&q=bodega')).toBe('?q=bodega');
    expect(sanitizeVolverClientes(`?q=${'c'.repeat(300)}`)).toBe(`?q=${'c'.repeat(MAX_BUSQUEDA)}`);
  });

  it('rutas, URLs, objetos y lo que no es texto dan vacío (o solo un q inofensivo)', () => {
    for (const raro of ['//evil.test', 'https://evil.test', '/viajes', 'javascript:alert(1)', 42, null, undefined, {}, ['?q=a']]) {
      expect(sanitizeVolverClientes(raro), JSON.stringify(raro)).toBe('');
    }
  });

  it('lo que devuelve es siempre "" o "?q=..." (nunca una ruta)', () => {
    for (const entrada of ['?q=a', '?q=a/b', '?q=//evil.test', '?x=1&q=%2F%2Fevil.test']) {
      expect(sanitizeVolverClientes(entrada)).toMatch(/^(\?q=[^&]*)?$/);
    }
  });
});

describe('textoCantidadClientes', () => {
  it('sin búsqueda: el total, en singular o plural', () => {
    expect(textoCantidadClientes(1, 1, false)).toBe('1 cliente');
    expect(textoCantidadClientes(3, 3, false)).toBe('3 clientes');
  });

  it('con búsqueda: cuántos de cuántos', () => {
    expect(textoCantidadClientes(2, 3, true)).toBe('2 de 3 clientes');
    expect(textoCantidadClientes(0, 3, true)).toBe('0 de 3 clientes');
    expect(textoCantidadClientes(1, 1, true)).toBe('1 de 1 cliente');
  });
});
