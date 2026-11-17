import { describe, expect, it } from 'vitest';

import { alternarMarca, idsDe, marcadosVigentes, partirPorCamion, recortarSeleccion, todosMarcados, totalDeMarcados } from './sumar-gastos-seleccion';

// La lógica pura de la selección de gastos de «Sumar gastos que ya cargué»: qué se manda, cuánto suma y cómo se parte la lista.

const A = 'e1000000-0000-4000-8000-00000000000a';
const B = 'e1000000-0000-4000-8000-00000000000b';
const C = 'e1000000-0000-4000-8000-00000000000c';
const D = 'e1000000-0000-4000-8000-00000000000d';
const FUERA = 'e1000000-0000-4000-8000-0000000000ff';

describe('idsDe', () => {
  it('los ids de la lista, en su orden', () => {
    expect(idsDe([{ id: B }, { id: A }, { id: C }])).toEqual([B, A, C]);
    expect(idsDe([])).toEqual([]);
  });
});

describe('marcadosVigentes: lo que se manda es SIEMPRE selección ∩ lista de ahora', () => {
  it('sale en el orden de la LISTA (el de cercanía a la fecha del viaje), no en el que se fueron marcando', () => {
    expect(marcadosVigentes([A, B, C, D], new Set([D, A, C]))).toEqual([A, C, D]);
  });

  it('un id marcado que ya NO está en la lista no sale nunca', () => {
    expect(marcadosVigentes([A, B], new Set([A, FUERA]))).toEqual([A]);
    expect(marcadosVigentes([A, B], new Set([FUERA]))).toEqual([]);
  });

  it('sin nada marcado, o con la lista vacía: nada', () => {
    expect(marcadosVigentes([A, B], new Set())).toEqual([]);
    expect(marcadosVigentes([], new Set([A]))).toEqual([]);
  });

  it('no cambia lo que recibe', () => {
    const vigentes = Object.freeze([A, B, C]);
    const marcados = new Set([C, A]);
    marcadosVigentes(vigentes, marcados);
    expect([...marcados]).toEqual([C, A]);
  });
});

describe('recortarSeleccion', () => {
  it('quita lo que ya no está en la lista y conserva lo demás', () => {
    expect([...recortarSeleccion(new Set([A, B, FUERA]), [A, B, C])]).toEqual([A, B]);
  });

  it('con la lista vacía deja la selección vacía', () => {
    expect(recortarSeleccion(new Set([A, B]), []).size).toBe(0);
  });

  it('si no se pierde nada devuelve el MISMO conjunto (guardarlo en un estado no provoca un render de más)', () => {
    const marcados = new Set([A, B]);
    expect(recortarSeleccion(marcados, [A, B, C])).toBe(marcados);
  });

  it('si se pierde algo devuelve un conjunto NUEVO y no cambia el que recibe', () => {
    const marcados = new Set([A, FUERA]);
    const recortado = recortarSeleccion(marcados, [A]);
    expect(recortado).not.toBe(marcados);
    expect([...marcados]).toEqual([A, FUERA]);
  });
});

describe('alternarMarca', () => {
  it('marca lo que no estaba marcado y desmarca lo que sí', () => {
    const uno = alternarMarca(new Set(), A);
    expect([...uno]).toEqual([A]);
    expect([...alternarMarca(uno, B)]).toEqual([A, B]);
    expect([...alternarMarca(uno, A)]).toEqual([]);
  });

  it('devuelve un conjunto nuevo: no cambia el que recibe', () => {
    const antes = new Set([A]);
    const despues = alternarMarca(antes, B);
    expect(despues).not.toBe(antes);
    expect([...antes]).toEqual([A]);
  });
});

describe('todosMarcados', () => {
  it('true solo si TODA la lista está marcada', () => {
    expect(todosMarcados([A, B], new Set([A, B]))).toBe(true);
    expect(todosMarcados([A, B], new Set([A]))).toBe(false);
    expect(todosMarcados([A, B], new Set())).toBe(false);
  });

  it('con la lista vacía no: no hay nada que estar marcado', () => {
    expect(todosMarcados([], new Set())).toBe(false);
    expect(todosMarcados([], new Set([A]))).toBe(false);
  });

  it('un marcado que no está en la lista no cuenta ni por faltante ni por sobrante', () => {
    expect(todosMarcados([A], new Set([A, FUERA]))).toBe(true);
    expect(todosMarcados([A, B], new Set([A, FUERA]))).toBe(false);
  });
});

describe('totalDeMarcados', () => {
  const gastos = [
    { id: A, monto: 0.1 },
    { id: B, monto: 0.2 },
    { id: C, monto: 100.3 },
  ];

  it('suma en CENTAVOS enteros: 0,1 + 0,2 da 0,3 (no 0,30000000000000004) y 0,1 + 0,2 + 100,3 da 100,6', () => {
    expect(totalDeMarcados(gastos, new Set([A, B]))).toBe(0.3);
    expect(totalDeMarcados(gastos, new Set([A, B, C]))).toBe(100.6);
  });

  it('suma solo lo marcado', () => {
    expect(totalDeMarcados(gastos, new Set([C]))).toBe(100.3);
    expect(totalDeMarcados(gastos, new Set())).toBe(0);
  });

  it('un marcado que no está en los gastos no suma nada', () => {
    expect(totalDeMarcados(gastos, new Set([A, FUERA]))).toBe(0.1);
  });
});

describe('partirPorCamion: los de otro camión no se pueden sumar (la misma regla que la base)', () => {
  const CAMION_1 = 'c1000000-0000-4000-8000-000000000001';
  const CAMION_2 = 'c1000000-0000-4000-8000-000000000002';

  it('el viaje con camión: los de ese camión y los SIN camión se pueden sumar; los de otro camión, no', () => {
    const gastos = [
      { id: A, camion_id: CAMION_1 },
      { id: B, camion_id: CAMION_2 },
      { id: C, camion_id: null },
      { id: D },
    ];
    const { sumables, deOtroCamion } = partirPorCamion(gastos, { camion_id: CAMION_1 });
    expect(idsDe(sumables)).toEqual([A, C, D]);
    expect(idsDe(deOtroCamion)).toEqual([B]);
  });

  it('un viaje SIN camión no choca con ninguno: se pueden sumar todos', () => {
    const gastos = [
      { id: A, camion_id: CAMION_1 },
      { id: B, camion_id: CAMION_2 },
      { id: C, camion_id: null },
    ];
    const { sumables, deOtroCamion } = partirPorCamion(gastos, { camion_id: null });
    expect(idsDe(sumables)).toEqual([A, B, C]);
    expect(deOtroCamion).toEqual([]);
  });

  it('cada grupo conserva el orden en que llegaron (el de cercanía a la fecha del viaje)', () => {
    const gastos = [
      { id: D, camion_id: CAMION_2 },
      { id: C, camion_id: CAMION_1 },
      { id: B, camion_id: CAMION_2 },
      { id: A, camion_id: CAMION_1 },
    ];
    const { sumables, deOtroCamion } = partirPorCamion(gastos, { camion_id: CAMION_1 });
    expect(idsDe(sumables)).toEqual([C, A]);
    expect(idsDe(deOtroCamion)).toEqual([D, B]);
  });

  it('sin gastos: dos listas vacías; y no cambia la lista que recibe', () => {
    expect(partirPorCamion([], { camion_id: CAMION_1 })).toEqual({ sumables: [], deOtroCamion: [] });
    const gastos = Object.freeze([{ id: A, camion_id: CAMION_2 }]);
    expect(partirPorCamion(gastos, { camion_id: CAMION_1 }).deOtroCamion).toHaveLength(1);
  });
});
