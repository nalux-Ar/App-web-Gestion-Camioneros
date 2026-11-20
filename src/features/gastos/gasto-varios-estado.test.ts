import { describe, expect, it } from 'vitest';

import {
  BLOQUE_VACIO,
  CARGA_VACIA,
  SIN_CATEGORIA,
  alternarCategoria,
  bloqueDe,
  bloqueEstaVacio,
  cambiarCampo,
  cargaConBorrador,
  cargaConUna,
  elegirUnica,
  type CamposDelBloque,
} from './gasto-varios-estado';

// Qué categorías están marcadas y qué se escribió en cada bloque. La regla de fondo: con 0 o 1 categoría hay UN solo juego de campos
// (el de siempre) y cambiar de categoría no hace perder lo escrito; con 2 o más, cada una tiene el suyo.

const A = 'a0000000-0000-4000-8000-000000000001';
const B = 'a0000000-0000-4000-8000-000000000002';
const C = 'a0000000-0000-4000-8000-000000000003';

const bloque = (monto: string, descripcion = '', metodoPago: CamposDelBloque['metodoPago'] = ''): CamposDelBloque => ({
  monto,
  descripcion,
  metodoPago,
});

describe('bloqueDe y bloqueEstaVacio', () => {
  it('un bloque que nunca se tocó es el vacío; el borrador tiene su propia clave', () => {
    expect(bloqueDe(CARGA_VACIA, A)).toBe(BLOQUE_VACIO);
    expect(bloqueDe(CARGA_VACIA, SIN_CATEGORIA)).toBe(BLOQUE_VACIO);
    expect(SIN_CATEGORIA).toBe('');
  });

  it('una clave como «__proto__» o «constructor» no devuelve nada raro del objeto', () => {
    expect(bloqueDe(CARGA_VACIA, '__proto__')).toBe(BLOQUE_VACIO);
    expect(bloqueDe(CARGA_VACIA, 'constructor')).toBe(BLOQUE_VACIO);
    expect(bloqueDe(CARGA_VACIA, 'toString')).toBe(BLOQUE_VACIO);
  });

  it('está vacío solo si no tiene monto, ni descripción, ni método', () => {
    expect(bloqueEstaVacio(BLOQUE_VACIO)).toBe(true);
    expect(bloqueEstaVacio(bloque('1'))).toBe(false);
    expect(bloqueEstaVacio(bloque('', 'algo'))).toBe(false);
    expect(bloqueEstaVacio(bloque('', '', 'efectivo'))).toBe(false);
  });
});

describe('alternarCategoria: marcar y desmarcar', () => {
  it('ninguna viene marcada de entrada', () => {
    expect(CARGA_VACIA.elegidas).toEqual([]);
  });

  it('marcar una categoría la agrega; marcarla de nuevo la saca', () => {
    const una = alternarCategoria(CARGA_VACIA, A);
    expect(una.elegidas).toEqual([A]);
    expect(alternarCategoria(una, A).elegidas).toEqual([]);
  });

  it('marcar varias: se guardan sin repetir, en el orden en que se tocaron (el orden en pantalla lo da otra cosa)', () => {
    const tres = [B, A, C].reduce(alternarCategoria, CARGA_VACIA);
    expect(tres.elegidas).toEqual([B, A, C]);
  });

  it('la clave del borrador no se puede marcar como categoría', () => {
    expect(alternarCategoria(CARGA_VACIA, SIN_CATEGORIA)).toBe(CARGA_VACIA);
  });

  it('marcar una segunda categoría NO toca lo escrito en la primera, y la segunda empieza vacía', () => {
    let carga = alternarCategoria(CARGA_VACIA, A);
    carga = cambiarCampo(carga, A, 'monto', '500');
    carga = alternarCategoria(carga, B);
    expect(bloqueDe(carga, A).monto).toBe('500');
    expect(bloqueDe(carga, B)).toBe(BLOQUE_VACIO);
  });

  it('desmarcar una de varias: su bloque deja de estar marcado pero lo escrito se conserva por si se vuelve a marcar', () => {
    let carga = [A, B].reduce(alternarCategoria, CARGA_VACIA);
    carga = cambiarCampo(carga, B, 'monto', '700');
    carga = alternarCategoria(carga, B);
    expect(carga.elegidas).toEqual([A]);
    expect(bloqueDe(carga, B).monto).toBe('700');
    carga = alternarCategoria(carga, B);
    expect(carga.elegidas).toEqual([A, B]);
    expect(bloqueDe(carga, B).monto).toBe('700');
  });

  it('no cambia el objeto de la carga original (cada paso devuelve uno nuevo)', () => {
    const antes = alternarCategoria(CARGA_VACIA, A);
    const congelada = JSON.stringify(antes);
    alternarCategoria(antes, B);
    alternarCategoria(antes, A);
    cambiarCampo(antes, A, 'monto', '1');
    expect(JSON.stringify(antes)).toBe(congelada);
    expect(CARGA_VACIA).toEqual({ elegidas: [], bloques: {} });
  });
});

describe('alternarCategoria: lo escrito con UNA sola categoría pasa a la siguiente (como cuando la categoría era una opción única)', () => {
  it('sin nada marcado se ve el borrador; lo escrito ahí lo hereda la primera categoría que se marca', () => {
    let carga = cargaConBorrador(bloque('300', 'peaje', 'efectivo'));
    carga = alternarCategoria(carga, A);
    expect(carga.elegidas).toEqual([A]);
    expect(bloqueDe(carga, A)).toEqual(bloque('300', 'peaje', 'efectivo'));
    expect(bloqueDe(carga, SIN_CATEGORIA)).toBe(BLOQUE_VACIO); // el borrador queda vacío: no se duplica
  });

  it('desmarcar la ÚLTIMA categoría devuelve lo escrito al borrador (sigue a la vista, sin categoría)', () => {
    let carga = cargaConUna(A, bloque('300', 'peaje', 'efectivo'));
    carga = alternarCategoria(carga, A);
    expect(carga.elegidas).toEqual([]);
    expect(bloqueDe(carga, SIN_CATEGORIA)).toEqual(bloque('300', 'peaje', 'efectivo'));
    expect(Object.hasOwn(carga.bloques, A)).toBe(false); // ya no queda un bloque suelto de A
  });

  it('cambiar de categoría (desmarcar una y marcar otra) conserva lo escrito', () => {
    let carga = cargaConUna(A, bloque('300', 'peaje', 'efectivo'));
    carga = alternarCategoria(carga, A);
    carga = alternarCategoria(carga, B);
    expect(carga.elegidas).toEqual([B]);
    expect(bloqueDe(carga, B)).toEqual(bloque('300', 'peaje', 'efectivo'));
    // y al volver a la primera, lo escrito vuelve con ella
    carga = alternarCategoria(carga, B);
    carga = alternarCategoria(carga, A);
    expect(bloqueDe(carga, A)).toEqual(bloque('300', 'peaje', 'efectivo'));
  });

  it('con el borrador vacío, la primera categoría que se marca conserva lo que ya tenía escrito', () => {
    let carga = [A, B].reduce(alternarCategoria, CARGA_VACIA);
    carga = cambiarCampo(carga, B, 'monto', '700');
    carga = alternarCategoria(alternarCategoria(carga, A), B); // quedan 0 marcadas: B se desmarcó la última y su monto pasó al borrador
    expect(bloqueDe(carga, SIN_CATEGORIA).monto).toBe('700');
    // un borrador vacío no pisa lo que una categoría ya tenía
    const conPropio = { elegidas: [], bloques: { [A]: bloque('900') } };
    expect(bloqueDe(alternarCategoria(conPropio, A), A).monto).toBe('900');
  });

  it('si el borrador tiene algo escrito, gana sobre lo que la categoría tuviera de antes', () => {
    const carga = { elegidas: [] as string[], bloques: { [SIN_CATEGORIA]: bloque('11'), [A]: bloque('22') } };
    expect(bloqueDe(alternarCategoria(carga, A), A).monto).toBe('11');
  });
});

describe('elegirUnica (la edición de un gasto: una sola categoría)', () => {
  it('deja marcada solo la nueva y le pasa lo escrito', () => {
    const carga = elegirUnica(cargaConUna(A, bloque('300', 'x', 'efectivo')), B);
    expect(carga.elegidas).toEqual([B]);
    expect(bloqueDe(carga, B)).toEqual(bloque('300', 'x', 'efectivo'));
  });

  it('con la misma categoría no cambia nada (el mismo objeto)', () => {
    const carga = cargaConUna(A, bloque('300'));
    expect(elegirUnica(carga, A)).toBe(carga);
  });

  it('con varias marcadas las deja en una sola', () => {
    const carga = elegirUnica([A, B].reduce(alternarCategoria, CARGA_VACIA), C);
    expect(carga.elegidas).toEqual([C]);
  });
});

describe('cambiarCampo', () => {
  it('cambia un campo del bloque de esa clave y deja los demás', () => {
    let carga = cargaConUna(A, bloque('1', 'uno', 'efectivo'));
    carga = cambiarCampo(carga, A, 'monto', '2');
    expect(bloqueDe(carga, A)).toEqual(bloque('2', 'uno', 'efectivo'));
    carga = cambiarCampo(carga, A, 'metodoPago', 'transferencia');
    expect(bloqueDe(carga, A)).toEqual(bloque('2', 'uno', 'transferencia'));
  });

  it('escribir en el borrador no marca ninguna categoría', () => {
    const carga = cambiarCampo(CARGA_VACIA, SIN_CATEGORIA, 'monto', '9');
    expect(carga.elegidas).toEqual([]);
    expect(bloqueDe(carga, SIN_CATEGORIA).monto).toBe('9');
  });

  it('escribir en un bloque no toca el de otra categoría', () => {
    let carga = [A, B].reduce(alternarCategoria, CARGA_VACIA);
    carga = cambiarCampo(carga, A, 'monto', '5');
    expect(bloqueDe(carga, B).monto).toBe('');
  });
});
