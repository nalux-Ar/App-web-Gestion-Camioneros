import { describe, expect, it } from 'vitest';

import { gastosMarcados, gastosSinViaje, hayGastosSinViaje, repartirPorCamionDelViaje } from './sumar-a-viaje';

const C1 = 'c0000000-0000-4000-8000-000000000001';
const C2 = 'c0000000-0000-4000-8000-000000000002';

describe('gastosSinViaje y hayGastosSinViaje', () => {
  const lista = [
    { id: 'a', viaje_id: null },
    { id: 'b', viaje_id: 'v1' },
    { id: 'c', viaje_id: null },
  ];

  it('deja solo los que no tienen viaje, en el mismo orden', () => {
    expect(gastosSinViaje(lista).map((g) => g.id)).toEqual(['a', 'c']);
  });

  it('no cambia la lista que recibe', () => {
    const copia = structuredClone(lista);
    gastosSinViaje(lista);
    expect(lista).toEqual(copia);
  });

  it('con todos en un viaje, o sin gastos, no queda ninguno', () => {
    expect(gastosSinViaje([{ id: 'b', viaje_id: 'v1' }])).toEqual([]);
    expect(gastosSinViaje([])).toEqual([]);
  });

  it('solo cuenta el `null` explícito: un viaje_id ausente (`undefined`) NO es «sin viaje»', () => {
    const rara = [{ id: 'x' }] as unknown as Array<{ id: string; viaje_id: string | null }>;
    expect(gastosSinViaje(rara)).toEqual([]);
    expect(hayGastosSinViaje(rara)).toBe(false);
  });

  it('hayGastosSinViaje: con uno suelto sí; con todos en un viaje o sin gastos, no', () => {
    expect(hayGastosSinViaje(lista)).toBe(true);
    expect(hayGastosSinViaje([{ id: 'b', viaje_id: 'v1' }])).toBe(false);
    expect(hayGastosSinViaje([])).toBe(false);
  });
});

describe('gastosMarcados', () => {
  const gastos = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  it('devuelve los marcados en el orden de la LISTA, no en el de la marca', () => {
    expect(gastosMarcados(gastos, ['c', 'a']).map((g) => g.id)).toEqual(['a', 'c']);
  });

  it('un id marcado que no está en la lista no sale', () => {
    expect(gastosMarcados(gastos, ['z', 'b']).map((g) => g.id)).toEqual(['b']);
  });

  it('sin marcados, ninguno', () => {
    expect(gastosMarcados(gastos, [])).toEqual([]);
  });
});

describe('repartirPorCamionDelViaje', () => {
  const g = (id: string, camion_id?: string | null) => ({ id, camion_id });

  it('sin camión en el viaje: todos van', () => {
    const r = repartirPorCamionDelViaje([g('a', C1), g('b', C2), g('c', null)], { camion_id: null });
    expect(r.aEnviar.map((x) => x.id)).toEqual(['a', 'b', 'c']);
    expect(r.deOtroCamion).toBe(0);
    expect(r.todosDeOtroCamion).toBe(false);
  });

  it('los gastos sin camión (null o ausente) van a un viaje de cualquier camión', () => {
    const r = repartirPorCamionDelViaje([g('a', null), g('b')], { camion_id: C1 });
    expect(r.aEnviar.map((x) => x.id)).toEqual(['a', 'b']);
    expect(r.deOtroCamion).toBe(0);
  });

  it('algunos de otro camión: no se mandan, se cuentan y el orden de los demás se conserva', () => {
    const r = repartirPorCamionDelViaje([g('a', C1), g('b', C2), g('c', null), g('d', C2), g('e', C1)], { camion_id: C1 });
    expect(r.aEnviar.map((x) => x.id)).toEqual(['a', 'c', 'e']);
    expect(r.deOtroCamion).toBe(2);
    expect(r.todosDeOtroCamion).toBe(false);
  });

  it('todos de otro camión: no queda nada para mandar y se dice', () => {
    const r = repartirPorCamionDelViaje([g('a', C2), g('b', C2)], { camion_id: C1 });
    expect(r.aEnviar).toEqual([]);
    expect(r.deOtroCamion).toBe(2);
    expect(r.todosDeOtroCamion).toBe(true);
  });

  it('sin nada marcado: no es «todos de otro camión» (no hay nada que lo sea)', () => {
    const r = repartirPorCamionDelViaje([], { camion_id: C1 });
    expect(r).toEqual({ aEnviar: [], deOtroCamion: 0, todosDeOtroCamion: false });
  });

  it('no cambia la lista que recibe', () => {
    const marcados = [g('a', C1), g('b', C2)];
    const copia = structuredClone(marcados);
    repartirPorCamionDelViaje(marcados, { camion_id: C1 });
    expect(marcados).toEqual(copia);
  });
});
