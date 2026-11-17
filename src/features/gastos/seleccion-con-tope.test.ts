import { describe, expect, it } from 'vitest';

import { alternarMarcaConTope, primerosParaMarcar, sinCupoParaMarcar, todoLoMarcableEstaMarcado } from './seleccion-con-tope';

// La lógica pura de una selección de gastos con TOPE (como mucho `tope` marcados a la vez): la usa «Quitar gastos del viaje», donde la
// lista puede traer hasta 500 gastos y la capa de datos solo acepta 100 por pedido.

const A = 'e1000000-0000-4000-8000-00000000000a';
const B = 'e1000000-0000-4000-8000-00000000000b';
const C = 'e1000000-0000-4000-8000-00000000000c';
const D = 'e1000000-0000-4000-8000-00000000000d';

describe('alternarMarcaConTope', () => {
  it('con lugar: marca lo que no estaba marcado y desmarca lo que sí', () => {
    const uno = alternarMarcaConTope(new Set(), A, 2);
    expect([...uno]).toEqual([A]);
    expect([...alternarMarcaConTope(uno, B, 2)]).toEqual([A, B]);
    expect([...alternarMarcaConTope(uno, A, 2)]).toEqual([]);
  });

  it('SIN lugar (ya hay `tope` marcados): un gasto sin marcar NO se marca y vuelve el MISMO conjunto (no provoca un dibujo de más)', () => {
    const lleno = new Set([A, B]);
    const siguiente = alternarMarcaConTope(lleno, C, 2);
    expect(siguiente).toBe(lleno);
    expect([...siguiente]).toEqual([A, B]);
  });

  it('con el tope alcanzado un gasto MARCADO sí se puede desmarcar (y después queda lugar para otro)', () => {
    const lleno = new Set([A, B]);
    const sinB = alternarMarcaConTope(lleno, B, 2);
    expect([...sinB]).toEqual([A]);
    expect([...alternarMarcaConTope(sinB, C, 2)]).toEqual([A, C]);
  });

  it('el tope se mide contra lo marcado del momento: dos toques seguidos con una función de actualización no pasan el tope', () => {
    // Lo que hace React con `setGuardados((previos) => …)` dos veces en el mismo dibujo: la segunda ve lo que dejó la primera.
    let estado: ReadonlySet<string> = new Set([A]);
    for (const id of [B, C, D]) estado = alternarMarcaConTope(estado, id, 2);
    expect([...estado]).toEqual([A, B]);
  });

  it('exactamente en el límite: con tope − 1 marcados todavía entra uno más, y con tope marcados no', () => {
    expect(alternarMarcaConTope(new Set([A]), B, 2).size).toBe(2);
    expect(alternarMarcaConTope(new Set([A, B]), C, 2).size).toBe(2);
  });

  it('devuelve un conjunto nuevo cuando cambia algo: no toca el que recibe', () => {
    const antes = new Set([A]);
    const despues = alternarMarcaConTope(antes, B, 5);
    expect(despues).not.toBe(antes);
    expect([...antes]).toEqual([A]);
  });

  it('con tope 0 no se puede marcar nada', () => {
    const vacio = new Set<string>();
    expect(alternarMarcaConTope(vacio, A, 0)).toBe(vacio);
  });

  it('un tope que no es un entero mayor o igual a 0 tira `RangeError` (un número raro no puede dejar pasar de más)', () => {
    for (const tope of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => alternarMarcaConTope(new Set(), A, tope), String(tope)).toThrow(RangeError);
    }
  });
});

describe('primerosParaMarcar: lo que marca «Marcar todos»', () => {
  const LISTA = [A, B, C, D];

  it('los primeros `tope` de la lista, EN SU ORDEN', () => {
    expect([...primerosParaMarcar(LISTA, 2)]).toEqual([A, B]);
    expect([...primerosParaMarcar([D, C, B, A], 3)]).toEqual([D, C, B]);
  });

  it('con una lista más corta que el tope, todos; y con una lista del tamaño justo, todos', () => {
    expect([...primerosParaMarcar(LISTA, 10)]).toEqual(LISTA);
    expect([...primerosParaMarcar(LISTA, 4)]).toEqual(LISTA);
  });

  it('con tope 0 o con la lista vacía: nada', () => {
    expect(primerosParaMarcar(LISTA, 0).size).toBe(0);
    expect(primerosParaMarcar([], 5).size).toBe(0);
  });

  it('no cambia la lista que recibe', () => {
    const lista = Object.freeze([A, B, C]);
    expect([...primerosParaMarcar(lista, 2)]).toEqual([A, B]);
    expect([...lista]).toEqual([A, B, C]);
  });

  it('un tope negativo NO corta desde el final (un `slice(0, -1)` marcaría casi todo): tira `RangeError`', () => {
    expect(() => primerosParaMarcar(LISTA, -1)).toThrow(RangeError);
    expect(() => primerosParaMarcar(LISTA, 2.5)).toThrow(RangeError);
  });

  it('con 500 gastos y tope 100 marca exactamente los primeros 100', () => {
    const lista = Array.from({ length: 500 }, (_, i) => `g${i}`);
    const primeros = primerosParaMarcar(lista, 100);
    expect(primeros.size).toBe(100);
    expect([...primeros]).toEqual(lista.slice(0, 100));
    expect(primeros.has('g100')).toBe(false);
  });
});

describe('todoLoMarcableEstaMarcado: decide entre «Marcar todos» y «Desmarcar todos»', () => {
  it('lista chica (de hasta el tope): true solo si está marcada TODA', () => {
    expect(todoLoMarcableEstaMarcado(4, 4, 100)).toBe(true);
    expect(todoLoMarcableEstaMarcado(3, 4, 100)).toBe(false);
    expect(todoLoMarcableEstaMarcado(0, 4, 100)).toBe(false);
  });

  it('lista MÁS larga que el tope: true cuando se marcó el tope (más no se puede), no antes', () => {
    expect(todoLoMarcableEstaMarcado(100, 500, 100)).toBe(true);
    expect(todoLoMarcableEstaMarcado(99, 500, 100)).toBe(false);
    expect(todoLoMarcableEstaMarcado(100, 101, 100)).toBe(true);
  });

  it('lista del tamaño justo del tope: true con todo marcado', () => {
    expect(todoLoMarcableEstaMarcado(100, 100, 100)).toBe(true);
    expect(todoLoMarcableEstaMarcado(99, 100, 100)).toBe(false);
  });

  it('con la lista vacía no: no hay nada que estar marcado', () => {
    expect(todoLoMarcableEstaMarcado(0, 0, 100)).toBe(false);
  });
});

describe('sinCupoParaMarcar: ¿se llegó al tope y quedan gastos sin marcar?', () => {
  it('true con el tope marcado y más gastos en la lista', () => {
    expect(sinCupoParaMarcar(100, 101, 100)).toBe(true);
    expect(sinCupoParaMarcar(100, 500, 100)).toBe(true);
  });

  it('false con menos del tope marcado, aunque la lista sea larga', () => {
    expect(sinCupoParaMarcar(99, 500, 100)).toBe(false);
    expect(sinCupoParaMarcar(0, 500, 100)).toBe(false);
  });

  it('false con la lista del tamaño justo del tope y toda marcada: no queda nada sin marcar que apagar', () => {
    expect(sinCupoParaMarcar(100, 100, 100)).toBe(false);
  });

  it('false con una lista chica toda marcada', () => {
    expect(sinCupoParaMarcar(3, 3, 100)).toBe(false);
  });
});
