import { afterEach, describe, expect, it } from 'vitest';

import { MAX_GASTOS_POR_VEZ as MAX_DE_CONSTANTS } from '@/features/gastos/constants';
import {
  MAX_GASTOS_POR_VEZ,
  distanciaEnDias,
  esDeOtroCamion,
  idsDistintos,
  mezclarCandidatos,
  ordenarPorCercania,
  parsearIdsQuitados,
  parsearResultadosVinculo,
  resumirResultados,
  type ResultadoDeGasto,
  type ResultadoVinculo,
} from '@/features/gastos/sumar-gastos';

// Lógica pura de «Sumar gastos que ya cargué»: sin base, sin red, sin React.

const A = 'a0000000-0000-4000-8000-00000000000a';
const B = 'b0000000-0000-4000-8000-00000000000b';
const C = 'c0000000-0000-4000-8000-00000000000c';
const D = 'd0000000-0000-4000-8000-00000000000d';
const E = 'e0000000-0000-4000-8000-00000000000e';

const fila = (gasto_id: string, resultado: unknown) => ({ gasto_id, resultado });
const resultadoDe = (lista: readonly ResultadoDeGasto[], id: string) => lista.find((r) => r.gastoId === id)?.resultado;

describe('MAX_GASTOS_POR_VEZ', () => {
  it('es 100 (el tope de la función de la base) y es una sola constante: la de constants.ts', () => {
    expect(MAX_GASTOS_POR_VEZ).toBe(100);
    expect(MAX_DE_CONSTANTS).toBe(100);
    expect(MAX_GASTOS_POR_VEZ).toBe(MAX_DE_CONSTANTS);
  });
});

describe('idsDistintos', () => {
  it('saca los repetidos, en el orden de la primera aparición', () => {
    expect(idsDistintos([B, A, B, A, C])).toEqual([B, A, C]);
    expect(idsDistintos([])).toEqual([]);
    expect(idsDistintos([A])).toEqual([A]);
  });

  it('un uuid en mayúsculas y en minúsculas es el mismo: queda la escritura de la primera aparición', () => {
    expect(idsDistintos([A.toUpperCase(), A, B])).toEqual([A.toUpperCase(), B]);
    expect(idsDistintos([A, A.toUpperCase()])).toEqual([A]);
  });

  it('no cambia el arreglo que recibe y devuelve uno nuevo', () => {
    const entrada = Object.freeze([A, A, B]);
    const salida = idsDistintos(entrada);
    expect(entrada).toEqual([A, A, B]);
    expect(salida).not.toBe(entrada);
  });
});

describe('parsearResultadosVinculo: la respuesta de la base se lee de forma estricta', () => {
  it('lee los cinco resultados de la base, uno por gasto', () => {
    const data = [fila(A, 'vinculado'), fila(B, 'ya_estaba'), fila(C, 'en_otro_viaje'), fila(D, 'camion_distinto'), fila(E, 'no_encontrado')];
    expect(parsearResultadosVinculo(data, [A, B, C, D, E])).toEqual([
      { gastoId: A, resultado: 'vinculado' },
      { gastoId: B, resultado: 'ya_estaba' },
      { gastoId: C, resultado: 'en_otro_viaje' },
      { gastoId: D, resultado: 'camion_distinto' },
      { gastoId: E, resultado: 'no_encontrado' },
    ]);
  });

  it('sale EXACTAMENTE en el orden en que se pidió, no en el de la respuesta', () => {
    const data = [fila(C, 'vinculado'), fila(A, 'ya_estaba'), fila(B, 'no_encontrado')];
    expect(parsearResultadosVinculo(data, [A, B, C]).map((r) => r.gastoId)).toEqual([A, B, C]);
    expect(parsearResultadosVinculo(data, [C, B, A]).map((r) => r.gastoId)).toEqual([C, B, A]);
    expect(parsearResultadosVinculo(data, [B, C, A]).map((r) => r.resultado)).toEqual(['no_encontrado', 'vinculado', 'ya_estaba']);
  });

  it('los ids pedidos repetidos se juntan en uno, en el lugar de su primera aparición', () => {
    const data = [fila(A, 'vinculado'), fila(B, 'ya_estaba')];
    expect(parsearResultadosVinculo(data, [B, A, B, A])).toEqual([
      { gastoId: B, resultado: 'ya_estaba' },
      { gastoId: A, resultado: 'vinculado' },
    ]);
  });

  it('un id que NO se pidió se ignora por completo: no aparece ni se cuenta, ni siquiera si dice «vinculado»', () => {
    const data = [fila(A, 'vinculado'), fila(E, 'vinculado'), fila(D, 'ya_estaba'), fila(B, 'no_encontrado')];
    const lista = parsearResultadosVinculo(data, [A, B]);
    expect(lista).toEqual([
      { gastoId: A, resultado: 'vinculado' },
      { gastoId: B, resultado: 'no_encontrado' },
    ]);
    expect(resumirResultados(lista)).toEqual({ sumados: 1, yaEstaban: 0, noSumados: [{ gastoId: B, motivo: 'no_encontrado' }] });
    expect(JSON.stringify(lista)).not.toContain(E);
    expect(JSON.stringify(lista)).not.toContain(D);
  });

  it('un id pedido sin fila en la respuesta es «no_se_pudo» (nunca un éxito por descarte)', () => {
    expect(parsearResultadosVinculo([fila(A, 'vinculado')], [A, B, C])).toEqual([
      { gastoId: A, resultado: 'vinculado' },
      { gastoId: B, resultado: 'no_se_pudo' },
      { gastoId: C, resultado: 'no_se_pudo' },
    ]);
    expect(parsearResultadosVinculo([], [A, B]).map((r) => r.resultado)).toEqual(['no_se_pudo', 'no_se_pudo']);
  });

  describe('filas repetidas del mismo id (la base manda una por gasto: dos que no coinciden son una respuesta rota)', () => {
    it('que COINCIDEN: es ese resultado, y el gasto sale una sola vez', () => {
      for (const resultado of ['vinculado', 'ya_estaba', 'en_otro_viaje', 'camion_distinto', 'no_encontrado'] as const) {
        expect(parsearResultadosVinculo([fila(A, resultado), fila(A, resultado)], [A]), resultado).toEqual([{ gastoId: A, resultado }]);
      }
      expect(parsearResultadosVinculo([fila(A, 'ya_estaba'), fila(A, 'ya_estaba'), fila(A, 'ya_estaba')], [A])).toEqual([{ gastoId: A, resultado: 'ya_estaba' }]);
    });

    it('que se CONTRADICEN: «no_se_pudo», venga primero la que venga (ni la primera ni la que dice «vinculado» ganan)', () => {
      expect(resultadoDe(parsearResultadosVinculo([fila(A, 'vinculado'), fila(A, 'no_encontrado')], [A]), A)).toBe('no_se_pudo');
      expect(resultadoDe(parsearResultadosVinculo([fila(A, 'no_encontrado'), fila(A, 'vinculado')], [A]), A)).toBe('no_se_pudo');
      expect(resultadoDe(parsearResultadosVinculo([fila(A, 'en_otro_viaje'), fila(A, 'vinculado')], [A]), A)).toBe('no_se_pudo');
      expect(resultadoDe(parsearResultadosVinculo([fila(A, 'vinculado'), fila(A, 'ya_estaba')], [A]), A)).toBe('no_se_pudo');
    });

    it('una contradicción no se corrige con más filas: ni una tercera que coincida con la primera, ni una que repita la segunda', () => {
      expect(resultadoDe(parsearResultadosVinculo([fila(A, 'vinculado'), fila(A, 'no_encontrado'), fila(A, 'vinculado')], [A]), A)).toBe('no_se_pudo');
      expect(resultadoDe(parsearResultadosVinculo([fila(A, 'vinculado'), fila(A, 'no_encontrado'), fila(A, 'no_encontrado')], [A]), A)).toBe('no_se_pudo');
      expect(resultadoDe(parsearResultadosVinculo([fila(A, 'vinculado'), fila(A, 'vinculado'), fila(A, 'no_encontrado')], [A]), A)).toBe('no_se_pudo');
    });

    it('una fila que no se entiende (NULL) junto a «vinculado» es «no_se_pudo», en cualquier orden: nunca un éxito', () => {
      expect(resultadoDe(parsearResultadosVinculo([fila(A, 'vinculado'), fila(A, null)], [A]), A)).toBe('no_se_pudo');
      expect(resultadoDe(parsearResultadosVinculo([fila(A, null), fila(A, 'vinculado')], [A]), A)).toBe('no_se_pudo');
      expect(resumirResultados(parsearResultadosVinculo([fila(A, null), fila(A, 'vinculado')], [A]))).toEqual({
        sumados: 0,
        yaEstaban: 0,
        noSumados: [{ gastoId: A, motivo: 'no_se_pudo' }],
      });
    });

    it('con TODAS las combinaciones de dos filas (los cinco resultados y una que no se entiende): coinciden → ese resultado; si no, «no_se_pudo»', () => {
      const lecturas: ReadonlyArray<readonly [unknown, ResultadoVinculo]> = [
        ['vinculado', 'vinculado'],
        ['ya_estaba', 'ya_estaba'],
        ['en_otro_viaje', 'en_otro_viaje'],
        ['camion_distinto', 'camion_distinto'],
        ['no_encontrado', 'no_encontrado'],
        [null, 'no_se_pudo'],
      ];
      for (const [primeraCruda, primera] of lecturas) {
        for (const [segundaCruda, segunda] of lecturas) {
          const lista = parsearResultadosVinculo([fila(A, primeraCruda), fila(A, segundaCruda)], [A]);
          expect(lista, `${primera} + ${segunda}`).toEqual([{ gastoId: A, resultado: primera === segunda ? primera : 'no_se_pudo' }]);
        }
      }
    });

    it('el mismo id en distinta mayúscula cuenta como el mismo', () => {
      expect(resultadoDe(parsearResultadosVinculo([fila(A, 'vinculado'), fila(A.toUpperCase(), 'no_encontrado')], [A]), A)).toBe('no_se_pudo');
      expect(resultadoDe(parsearResultadosVinculo([fila(A.toUpperCase(), 'ya_estaba'), fila(A, 'vinculado')], [A]), A)).toBe('no_se_pudo');
      expect(parsearResultadosVinculo([fila(A, 'vinculado'), fila(A.toUpperCase(), 'vinculado')], [A])).toEqual([{ gastoId: A, resultado: 'vinculado' }]);
      expect(parsearResultadosVinculo([fila(A.toUpperCase(), 'vinculado'), fila(A, 'vinculado')], [A.toUpperCase()])).toEqual([{ gastoId: A.toUpperCase(), resultado: 'vinculado' }]);
    });

    it('la contradicción de un id no afecta a los demás, y las filas repetidas de un id que NO se pidió no importan', () => {
      const data = [fila(A, 'vinculado'), fila(B, 'ya_estaba'), fila(A, 'no_encontrado'), fila(C, 'en_otro_viaje'), fila(E, 'vinculado'), fila(E, 'no_encontrado')];
      expect(parsearResultadosVinculo(data, [A, B, C])).toEqual([
        { gastoId: A, resultado: 'no_se_pudo' },
        { gastoId: B, resultado: 'ya_estaba' },
        { gastoId: C, resultado: 'en_otro_viaje' },
      ]);
    });
  });

  it('un `resultado` que no es EXACTAMENTE uno de los cinco (NULL, otro texto, otro tipo) es «no_se_pudo»', () => {
    const raros: unknown[] = [
      null,
      undefined,
      '',
      ' ',
      'Vinculado',
      'VINCULADO',
      ' vinculado',
      'vinculado ',
      'vinculado\n',
      'vinculado\u0000',
      'vinculados',
      'ya estaba',
      'ya-estaba',
      'YA_ESTABA',
      'ya_estaba ',
      'ok',
      'success',
      'exito',
      'true',
      '1',
      'vinculado/ya_estaba',
      'sumado',
      'toString',
      'constructor',
      '__proto__',
      'hasOwnProperty',
      true,
      false,
      0,
      1,
      NaN,
      {},
      [],
      ['vinculado'],
      { resultado: 'vinculado' },
      { toString: () => 'vinculado' },
      new String('vinculado'),
      () => 'vinculado',
    ];
    for (const raro of raros) {
      const lista = parsearResultadosVinculo([fila(A, raro)], [A]);
      expect(lista, String(raro)).toEqual([{ gastoId: A, resultado: 'no_se_pudo' }]);
    }
  });

  it('solo `vinculado` y `ya_estaba` son éxitos: ningún otro valor, venga de donde venga, llega a «sumados» ni «ya estaban»', () => {
    const textos = ['en_otro_viaje', 'camion_distinto', 'no_encontrado', 'no_se_pudo', 'Vinculado', 'ya_estaba ', '', 'otra cosa'];
    for (const texto of textos) {
      const resumen = resumirResultados(parsearResultadosVinculo([fila(A, texto)], [A]));
      expect(resumen.sumados, texto).toBe(0);
      expect(resumen.yaEstaban, texto).toBe(0);
      expect(resumen.noSumados, texto).toHaveLength(1);
    }
  });

  it('`data` que no es un arreglo: no hay filas que leer y todo es «no_se_pudo» (aunque parezca una fila suelta)', () => {
    for (const data of [null, undefined, {}, 'texto', 42, true, fila(A, 'vinculado'), { data: [fila(A, 'vinculado')] }, new Map()]) {
      expect(parsearResultadosVinculo(data, [A, B]), String(data)).toEqual([
        { gastoId: A, resultado: 'no_se_pudo' },
        { gastoId: B, resultado: 'no_se_pudo' },
      ]);
    }
  });

  it('una fila que no es un objeto con `gasto_id` de texto se descarta (y no afecta a las demás)', () => {
    const inservibles: unknown[] = [null, undefined, 'texto', 7, true, [], [A, 'vinculado'], {}, { resultado: 'vinculado' }, { gasto_id: 5, resultado: 'vinculado' }, { gasto_id: null, resultado: 'vinculado' }, { gasto_id: { id: A }, resultado: 'vinculado' }, { gasto_id: [A], resultado: 'vinculado' }];
    const lista = parsearResultadosVinculo([...inservibles, fila(B, 'ya_estaba')], [A, B]);
    expect(lista).toEqual([
      { gastoId: A, resultado: 'no_se_pudo' },
      { gastoId: B, resultado: 'ya_estaba' },
    ]);
  });

  it('un uuid en mayúsculas y en minúsculas es el mismo (la base responde en minúsculas); sale con la escritura con que se pidió', () => {
    expect(parsearResultadosVinculo([fila(A, 'vinculado')], [A.toUpperCase()])).toEqual([{ gastoId: A.toUpperCase(), resultado: 'vinculado' }]);
    expect(parsearResultadosVinculo([fila(A.toUpperCase(), 'ya_estaba')], [A])).toEqual([{ gastoId: A, resultado: 'ya_estaba' }]);
    // Pedido en las dos escrituras: es UN gasto.
    expect(parsearResultadosVinculo([fila(A, 'vinculado')], [A, A.toUpperCase()])).toHaveLength(1);
  });

  it('otras formas de escribir el uuid (con llaves, sin guiones) no se reconocen: «no_se_pudo», el lado seguro', () => {
    expect(resultadoDe(parsearResultadosVinculo([fila(A, 'vinculado')], [`{${A}}`]), `{${A}}`)).toBe('no_se_pudo');
    expect(resultadoDe(parsearResultadosVinculo([fila(A, 'vinculado')], [A.replace(/-/g, '')]), A.replace(/-/g, ''))).toBe('no_se_pudo');
  });

  it('ids con nombres de propiedades del prototipo («__proto__», «constructor») no rompen ni se confunden', () => {
    const lista = parsearResultadosVinculo([fila('__proto__', 'vinculado'), fila('constructor', 'ya_estaba')], ['constructor', '__proto__', 'toString']);
    expect(lista).toEqual([
      { gastoId: 'constructor', resultado: 'ya_estaba' },
      { gastoId: '__proto__', resultado: 'vinculado' },
      { gastoId: 'toString', resultado: 'no_se_pudo' },
    ]);
  });

  it('sin ids pedidos: lista vacía (aunque la respuesta traiga filas)', () => {
    expect(parsearResultadosVinculo([fila(A, 'vinculado')], [])).toEqual([]);
    expect(parsearResultadosVinculo(null, [])).toEqual([]);
  });

  it('los campos de más de una fila no importan, y 100 filas se leen igual', () => {
    expect(parsearResultadosVinculo([{ gasto_id: A, resultado: 'vinculado', extra: 'x', otro: 1 }], [A])).toEqual([{ gastoId: A, resultado: 'vinculado' }]);
    const ids = Array.from({ length: 100 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    const lista = parsearResultadosVinculo(
      ids.map((id) => fila(id, 'vinculado')),
      ids,
    );
    expect(lista).toHaveLength(100);
    expect(lista.every((r) => r.resultado === 'vinculado')).toBe(true);
    expect(lista.map((r) => r.gastoId)).toEqual(ids);
  });

  it('no cambia lo que recibe (datos y pedidos congelados no hacen tirar nada)', () => {
    const data = Object.freeze([Object.freeze(fila(A, 'vinculado')), Object.freeze(fila(B, null))]);
    const pedidos = Object.freeze([A, B, A]);
    expect(() => parsearResultadosVinculo(data, pedidos)).not.toThrow();
    expect(pedidos).toEqual([A, B, A]);
    expect(data).toHaveLength(2);
  });
});

describe('resumirResultados', () => {
  const lista = (...resultados: ResultadoVinculo[]): ResultadoDeGasto[] => resultados.map((resultado, i) => ({ gastoId: `g${i}`, resultado }));

  it('cuenta los sumados (`vinculado`) y los que ya estaban (`ya_estaba`) y lista los demás con su motivo, en orden', () => {
    const resumen = resumirResultados(lista('vinculado', 'en_otro_viaje', 'ya_estaba', 'vinculado', 'camion_distinto', 'no_encontrado', 'no_se_pudo', 'ya_estaba'));
    expect(resumen).toEqual({
      sumados: 2,
      yaEstaban: 2,
      noSumados: [
        { gastoId: 'g1', motivo: 'en_otro_viaje' },
        { gastoId: 'g4', motivo: 'camion_distinto' },
        { gastoId: 'g5', motivo: 'no_encontrado' },
        { gastoId: 'g6', motivo: 'no_se_pudo' },
      ],
    });
  });

  it('sin resultados: todo en cero', () => {
    expect(resumirResultados([])).toEqual({ sumados: 0, yaEstaban: 0, noSumados: [] });
  });

  it('todo sumado, todo ya estaba, y todo sin sumar', () => {
    expect(resumirResultados(lista('vinculado', 'vinculado'))).toEqual({ sumados: 2, yaEstaban: 0, noSumados: [] });
    expect(resumirResultados(lista('ya_estaba'))).toEqual({ sumados: 0, yaEstaban: 1, noSumados: [] });
    expect(resumirResultados(lista('no_encontrado', 'no_encontrado')).noSumados.map((n) => n.motivo)).toEqual(['no_encontrado', 'no_encontrado']);
  });

  it('un valor que no debería existir (si alguien arma la lista a mano) cuenta como «no_se_pudo», nunca como éxito', () => {
    const rara = [{ gastoId: 'x', resultado: 'exito' as unknown as ResultadoVinculo }, { gastoId: 'y', resultado: null as unknown as ResultadoVinculo }];
    expect(resumirResultados(rara)).toEqual({
      sumados: 0,
      yaEstaban: 0,
      noSumados: [
        { gastoId: 'x', motivo: 'no_se_pudo' },
        { gastoId: 'y', motivo: 'no_se_pudo' },
      ],
    });
  });

  it('no tiene textos de pantalla: solo números, ids y motivos', () => {
    const resumen = resumirResultados(lista('vinculado', 'camion_distinto'));
    expect(Object.keys(resumen).sort()).toEqual(['noSumados', 'sumados', 'yaEstaban']);
    expect(Object.keys(resumen.noSumados[0]!).sort()).toEqual(['gastoId', 'motivo']);
  });

  it('no cambia la lista que recibe', () => {
    const entrada = Object.freeze(lista('vinculado', 'ya_estaba').map((r) => Object.freeze(r)));
    expect(() => resumirResultados(entrada)).not.toThrow();
  });
});

describe('parsearIdsQuitados: los ids que REALMENTE se quitaron', () => {
  it('devuelve los pedidos que aparecen en lo devuelto por el UPDATE, en el orden en que se pidieron', () => {
    expect(parsearIdsQuitados([{ id: C }, { id: A }], [A, B, C])).toEqual([A, C]);
    expect(parsearIdsQuitados([{ id: B }, { id: A }, { id: C }], [C, B, A])).toEqual([C, B, A]);
  });

  it('0 filas no es un error: lista vacía; menos de los pedidos tampoco', () => {
    expect(parsearIdsQuitados([], [A, B])).toEqual([]);
    expect(parsearIdsQuitados([{ id: B }], [A, B, C])).toEqual([B]);
  });

  it('una fila con un id que NO se pidió se ignora', () => {
    expect(parsearIdsQuitados([{ id: A }, { id: E }], [A, B])).toEqual([A]);
  });

  it('lo que no es un arreglo, o filas sin `id` de texto, no cuentan', () => {
    for (const data of [null, undefined, {}, 'x', 5, { id: A }]) expect(parsearIdsQuitados(data, [A]), String(data)).toEqual([]);
    expect(parsearIdsQuitados([null, 'x', 3, [], {}, { id: 7 }, { id: null }, { id: A }], [A, B])).toEqual([A]);
  });

  it('sin repetidos (aunque se pidan o devuelvan repetidos) y sin importar mayúsculas', () => {
    expect(parsearIdsQuitados([{ id: A }, { id: A }], [A, A])).toEqual([A]);
    expect(parsearIdsQuitados([{ id: A }], [A.toUpperCase()])).toEqual([A.toUpperCase()]);
  });
});

describe('esDeOtroCamion: la misma regla que el trigger de la base (solo choca si los DOS tienen camión y son distintos)', () => {
  const CAMION_1 = '11111111-1111-4111-8111-111111111111';
  const CAMION_2 = '22222222-2222-4222-8222-222222222222';

  it.each([
    ['gasto con camión, viaje con OTRO camión', CAMION_1, CAMION_2, true],
    ['gasto con camión, viaje con el MISMO camión', CAMION_1, CAMION_1, false],
    ['gasto con camión, viaje SIN camión', CAMION_1, null, false],
    ['gasto SIN camión, viaje con camión', null, CAMION_1, false],
    ['gasto SIN camión, viaje SIN camión', null, null, false],
  ] as const)('%s', (_nombre, camionDelGasto, camionDelViaje, esperado) => {
    expect(esDeOtroCamion({ camion_id: camionDelGasto }, { camion_id: camionDelViaje })).toBe(esperado);
  });

  it('un gasto SIN la propiedad `camion_id` (opcional) es un gasto sin camión', () => {
    expect(esDeOtroCamion({}, { camion_id: CAMION_1 })).toBe(false);
    expect(esDeOtroCamion({ camion_id: undefined }, { camion_id: CAMION_1 })).toBe(false);
    expect(esDeOtroCamion({}, { camion_id: null })).toBe(false);
  });

  it('un viaje cuyo camión no se cargó (sin la propiedad) no se toma como «otro camión»', () => {
    expect(esDeOtroCamion({ camion_id: CAMION_1 }, {} as { camion_id: string | null })).toBe(false);
  });

  it('es simétrica en los casos con camión en ambos', () => {
    expect(esDeOtroCamion({ camion_id: CAMION_2 }, { camion_id: CAMION_1 })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Fechas
// ---------------------------------------------------------------------------

/** Días desde 1970-01-01 con aritmética entera (algoritmo «days from civil»), SIN `Date`: es el oráculo independiente de las pruebas. */
function diasDesdeCivil(anio: number, mes: number, dia: number): number {
  const y = mes <= 2 ? anio - 1 : anio;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (mes + (mes > 2 ? -3 : 9)) + 2) / 5) + dia - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

const oraculo = (a: string, b: string) => {
  const [ya, ma, da] = a.split('-').map(Number);
  const [yb, mb, db] = b.split('-').map(Number);
  return Math.abs(diasDesdeCivil(ya!, ma!, da!) - diasDesdeCivil(yb!, mb!, db!));
};

/** Suma días a una fecha con `Date` en UTC (solo para armar datos de prueba). */
function sumarDias(fecha: string, dias: number): string {
  const [y, m, d] = fecha.split('-').map(Number);
  const instante = new Date(0);
  instante.setUTCFullYear(y!, m! - 1, d! + dias);
  return `${String(instante.getUTCFullYear()).padStart(4, '0')}-${String(instante.getUTCMonth() + 1).padStart(2, '0')}-${String(instante.getUTCDate()).padStart(2, '0')}`;
}

/** Pares con su distancia, calculada a mano y comprobada con el oráculo. */
const PARES: ReadonlyArray<readonly [string, string, number]> = [
  ['2026-11-13', '2026-11-13', 0],
  ['2026-11-13', '2026-11-14', 1],
  ['2026-11-14', '2026-11-13', 1],
  ['2020-07-15', '2020-07-17', 2],
  ['2020-07-15', '2020-07-13', 2],
  ['2020-07-15', '2020-07-10', 5],
  ['2020-07-15', '2020-07-01', 14],
  ['2020-07-15', '2020-08-31', 47],
  ['2020-07-15', '2019-12-01', 227],
  // Fin de mes, de año y años bisiestos.
  ['2026-01-31', '2026-02-01', 1],
  ['2026-02-28', '2026-03-01', 1], // 2026 no es bisiesto
  ['2024-02-28', '2024-03-01', 2], // 2024 sí
  ['2024-02-29', '2024-03-01', 1],
  ['2026-04-30', '2026-05-01', 1],
  ['2025-12-31', '2026-01-01', 1],
  ['2024-12-31', '2025-01-01', 1],
  ['1900-02-28', '1900-03-01', 1], // 1900 no es bisiesto (divisible por 100 y no por 400)
  ['2000-02-28', '2000-03-01', 2], // 2000 sí (divisible por 400)
  ['2020-02-29', '2021-02-28', 365],
  ['2020-02-29', '2024-02-29', 1461],
  ['2026-01-01', '2026-12-31', 364],
  ['2024-01-01', '2024-12-31', 365],
  ['2000-01-01', '2026-11-13', 9813],
  // Extremos que acepta el calendario de la pantalla.
  ['0001-01-01', '0001-01-02', 1],
  ['9999-12-31', '9999-12-30', 1],
  ['0001-01-01', '9999-12-31', 3652058],
  // Días donde cambia el horario de verano en varios países (el día dura 23 o 25 horas en hora local).
  ['2026-03-07', '2026-03-10', 3],
  ['2026-03-08', '2026-03-09', 1],
  ['2026-10-31', '2026-11-02', 2],
  ['2026-11-01', '2026-11-02', 1],
  ['2026-03-28', '2026-03-30', 2],
  ['2026-10-24', '2026-10-26', 2],
  ['2026-04-04', '2026-04-07', 3],
  ['2026-10-03', '2026-10-05', 2],
  ['2026-09-05', '2026-09-07', 2],
  ['2026-04-04', '2026-04-06', 2],
];

describe('distanciaEnDias', () => {
  it.each(PARES)('%s y %s: %i días', (a, b, esperado) => {
    expect(distanciaEnDias(a, b)).toBe(esperado);
    expect(oraculo(a, b)).toBe(esperado); // el valor escrito a mano coincide con el cálculo independiente
  });

  it('es siempre positiva o cero y simétrica: no dice cuál es anterior', () => {
    for (const [a, b] of PARES) {
      expect(distanciaEnDias(a, b)).toBe(distanciaEnDias(b, a));
      expect(distanciaEnDias(a, b)!).toBeGreaterThanOrEqual(0);
    }
  });

  it('el mismo día es 0 (un número, no -0)', () => {
    expect(Object.is(distanciaEnDias('2026-10-01', '2026-10-01'), 0)).toBe(true);
  });

  it('un formato inválido o una fecha que no existe da `null` (explícito, no tira ni inventa un número)', () => {
    const invalidas = [
      '',
      ' ',
      'hoy',
      '2026-1-5',
      '2026-01-5',
      '26-01-05',
      '2026/01/05',
      '05-01-2026',
      '20260105',
      '2026-01-05T00:00:00Z',
      '2026-01-05 ',
      ' 2026-01-05',
      '2026-13-01',
      '2026-00-10',
      '2026-02-30',
      '2026-04-31',
      '2023-02-29',
      '1900-02-29',
      '2026-01-00',
      '0000-01-01',
      'infinity',
      '-infinity',
      '10000-01-01',
      '0044-03-15 BC',
      'NaN',
      'null',
      'undefined',
    ];
    for (const invalida of invalidas) {
      expect(distanciaEnDias(invalida, '2026-01-01'), invalida).toBeNull();
      expect(distanciaEnDias('2026-01-01', invalida), invalida).toBeNull();
    }
    expect(distanciaEnDias(undefined as unknown as string, '2026-01-01')).toBeNull();
    expect(distanciaEnDias('2026-01-01', null as unknown as string)).toBeNull();
    expect(distanciaEnDias('2024-02-29', '2024-02-29')).toBe(0); // 29 de febrero de un año bisiesto SÍ existe
  });

  it('coincide con el cálculo independiente (enteros, sin Date) en 600 pares al azar entre 1950 y 2100', () => {
    let semilla = 20_261_113;
    const azar = () => {
      semilla = (Math.imul(semilla, 1_664_525) + 1_013_904_223) >>> 0;
      return semilla / 2 ** 32;
    };
    const fechaAlAzar = () => sumarDias('1950-01-01', Math.floor(azar() * 54_788)); // ~150 años
    for (let i = 0; i < 600; i++) {
      const a = fechaAlAzar();
      const b = fechaAlAzar();
      expect(distanciaEnDias(a, b), `${a} ${b}`).toBe(oraculo(a, b));
    }
  });
});

describe('distanciaEnDias no depende de la zona horaria ni del horario de verano', () => {
  // [zona, desfase de julio de 2026 en minutos según `Date#getTimezoneOffset`]: sirve para comprobar que el cambio de zona tomó efecto.
  const ZONAS: ReadonlyArray<readonly [string, number]> = [
    ['UTC', 0],
    ['America/Argentina/Buenos_Aires', 180],
    ['America/New_York', 240],
    ['Europe/Madrid', -120],
    ['Australia/Lord_Howe', -630], // 30 minutos de cambio de horario
    ['Pacific/Auckland', -720],
    ['Asia/Kolkata', -330],
    ['America/Santiago', 240], // cambia el horario a la medianoche: la 00:00 de ese día no existe
  ];
  const zonaOriginal = process.env.TZ;

  afterEach(() => {
    if (zonaOriginal === undefined) delete process.env.TZ;
    else process.env.TZ = zonaOriginal;
  });

  it.each(ZONAS)('%s: mismos resultados que con cualquier otra zona', (zona, desfaseDeJulio) => {
    process.env.TZ = zona;
    // Sin esto la prueba no probaría nada: si el entorno no deja cambiar la zona, falla acá y no pasa en falso.
    expect(new Date(2026, 6, 1).getTimezoneOffset(), `la zona ${zona} no se aplicó`).toBe(desfaseDeJulio);
    for (const [a, b, esperado] of PARES) {
      const resultado = distanciaEnDias(a, b);
      expect(resultado, `${zona}: ${a} y ${b}`).toBe(esperado);
      expect(Number.isInteger(resultado), `${zona}: ${a} y ${b} es entero`).toBe(true);
    }
  });

  it('el orden por cercanía tampoco cambia con la zona', () => {
    const gastos = [
      { id: A, fecha: '2026-03-10', created_at: '2026-03-10T10:00:00+00:00' },
      { id: B, fecha: '2026-03-06', created_at: '2026-03-06T10:00:00+00:00' },
      { id: C, fecha: '2026-03-08', created_at: '2026-03-08T10:00:00+00:00' },
      { id: D, fecha: '2026-03-09', created_at: '2026-03-09T10:00:00+00:00' },
    ];
    const esperado = [C, D, A, B]; // 0, 1, 2 y 2 días del 8/3 (a igual distancia, el más reciente primero)
    for (const [zona] of ZONAS) {
      process.env.TZ = zona;
      expect(ordenarPorCercania(gastos, '2026-03-08').map((x) => x.id), zona).toEqual(esperado);
    }
  });
});

// ---------------------------------------------------------------------------
// Orden por cercanía
// ---------------------------------------------------------------------------

describe('ordenarPorCercania: abs(fecha - fechaViaje), fecha desc, created_at desc, id (el orden del caso 27.22 de la base)', () => {
  const VIAJE = '2020-07-15';
  const T = '2026-11-01T10:00:00+00:00';
  const g = (id: string, fecha: string, created_at = T) => ({ id, fecha, created_at });
  const ids = (lista: ReadonlyArray<{ id: string }>) => lista.map((x) => x.id);

  it('el caso 27.22: 0 días, 2 [17/7], 2 [13/7], 5, 14, 47 y 227 — sin ventana de días: el de 227 también sale', () => {
    const d001 = g('d001', '2020-07-15');
    const d002 = g('d002', '2020-07-17');
    const d003 = g('d003', '2020-07-13');
    const d004 = g('d004', '2020-07-10');
    const d005 = g('d005', '2020-07-01');
    const d006 = g('d006', '2020-08-31');
    const d007 = g('d007', '2019-12-01');
    const mezclados = [d007, d003, d006, d001, d005, d002, d004];
    expect(ids(ordenarPorCercania(mezclados, VIAJE))).toEqual(['d001', 'd002', 'd003', 'd004', 'd005', 'd006', 'd007']);
  });

  it('los más cercanos primero, vengan del lado que vengan', () => {
    const lista = [g('lejos-antes', '2020-06-01'), g('cerca-despues', '2020-07-16'), g('cerca-antes', '2020-07-14'), g('lejos-despues', '2020-09-01'), g('medio', '2020-07-25')];
    expect(ids(ordenarPorCercania(lista, VIAJE))).toEqual(['cerca-despues', 'cerca-antes', 'medio', 'lejos-antes', 'lejos-despues']);
  });

  it('empate de distancia entre un lado y el otro: primero la fecha MÁS RECIENTE (la posterior)', () => {
    const lista = [g('antes', '2020-07-12'), g('despues', '2020-07-18')];
    expect(ids(ordenarPorCercania(lista, VIAJE))).toEqual(['despues', 'antes']);
    expect(ids(ordenarPorCercania([...lista].reverse(), VIAJE))).toEqual(['despues', 'antes']);
  });

  it('empate en distancia y en fecha: el creado más tarde primero (`created_at` descendente)', () => {
    const lista = [
      g('viejo', '2020-07-14', '2026-11-01T10:00:00+00:00'),
      g('nuevo', '2020-07-14', '2026-11-01T12:00:00+00:00'),
      g('medio', '2020-07-14', '2026-11-01T11:00:00+00:00'),
    ];
    expect(ids(ordenarPorCercania(lista, VIAJE))).toEqual(['nuevo', 'medio', 'viejo']);
  });

  it('empate en todo lo anterior: por `id` ascendente (el mismo orden que el uuid en la base)', () => {
    const lista = [g('c', '2020-07-14'), g('a', '2020-07-14'), g('b', '2020-07-14')];
    expect(ids(ordenarPorCercania(lista, VIAJE))).toEqual(['a', 'b', 'c']);
    expect(ids(ordenarPorCercania([B, A, C].map((id) => g(id, '2020-07-14')), VIAJE))).toEqual([A, B, C]);
  });

  it('`created_at` se compara como INSTANTE, no como texto: zonas distintas, fracciones de largo distinto y microsegundos', () => {
    // Todos del mismo día: lo único que los distingue es cuándo se crearon. Orden esperado, del más nuevo al más viejo:
    const lista = [
      g('a-12-00-00', '2020-07-14', '2026-11-13T12:00:00Z'), // 12:00:00 UTC
      g('b-12-30', '2020-07-14', '2026-11-13T09:30:00-03:00'), // 12:30:00 UTC (texto «más chico», instante más nuevo)
      g('c-1us', '2020-07-14', '2026-11-13T12:00:00.000001+00:00'), // 1 microsegundo después de a
      g('d-medio-seg', '2020-07-14', '2026-11-13 12:00:00.5+00'), // con espacio, fracción corta y zona «+00»
      g('e-11-59', '2020-07-14', '2026-11-13T11:59:59.999999+00:00'), // 1 microsegundo antes de a
    ];
    expect(ids(ordenarPorCercania(lista, VIAJE))).toEqual(['b-12-30', 'd-medio-seg', 'c-1us', 'a-12-00-00', 'e-11-59']);
  });

  it('una fracción corta vale lo que dice (`.5` es medio segundo, `.12` doce centésimas): Postgres omite los ceros del final y no se rellena por la izquierda', () => {
    const lista = [
      g('a-123456', '2020-07-14', '2026-11-13T12:00:00.123456+00:00'),
      g('b-medio', '2020-07-14', '2026-11-13T12:00:00.5+00:00'), // .500000
      g('c-12-cs', '2020-07-14', '2026-11-13T12:00:00.12+00:00'), // .120000
      g('d-1-ms', '2020-07-14', '2026-11-13T12:00:00.001+00:00'), // .001000
      g('e-entero', '2020-07-14', '2026-11-13T12:00:00+00:00'), // sin fracción
    ];
    // Del más nuevo al más viejo: .5 > .123456 > .12 > .001 > sin fracción. Con la fracción rellenada por la izquierda, `.5` valdría
    // 5 millonésimas y quedaría detrás de `.123456` y de `.12`.
    const esperado = ['b-medio', 'a-123456', 'c-12-cs', 'd-1-ms', 'e-entero'];
    expect(ids(ordenarPorCercania(lista, VIAJE))).toEqual(esperado);
    expect(ids(ordenarPorCercania([...lista].reverse(), VIAJE))).toEqual(esperado);
  });

  it('el mismo instante escrito de distintas maneras empata y se desempata por `id`', () => {
    const lista = [
      g('c', '2020-07-14', '2026-11-13T09:00:00-03:00'),
      g('a', '2020-07-14', '2026-11-13T12:00:00Z'),
      g('b', '2020-07-14', '2026-11-13T12:00:00.000000+00:00'),
      g('d', '2020-07-14', '2026-11-13T17:30:00+05:30'),
    ];
    expect(ids(ordenarPorCercania(lista, VIAJE))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('un `created_at` con un año de 0 a 99 es ESE año, no 19xx (`Date.UTC` lo leería así): el de 1980 es más nuevo que el de 0099', () => {
    const lista = [g('a-0099', '2020-07-14', '0099-06-15T10:00:00+00:00'), g('b-1980', '2020-07-14', '1980-06-15T10:00:00+00:00')];
    expect(ids(ordenarPorCercania(lista, VIAJE))).toEqual(['b-1980', 'a-0099']);
    expect(ids(ordenarPorCercania([...lista].reverse(), VIAJE))).toEqual(['b-1980', 'a-0099']);
    // Y toda la franja de años chicos queda en su lugar, del más nuevo al más viejo.
    const anios = ['1980', '0100', '0099', '0050', '0001', '0000'];
    const porAnio = anios.map((anio) => g(`y${anio}`, '2020-07-14', `${anio}-06-15T10:00:00Z`));
    expect(ids(ordenarPorCercania([...porAnio].reverse(), VIAJE))).toEqual(anios.map((anio) => `y${anio}`));
  });

  it('un `created_at` que no se entiende va después de los que sí, sin romper el orden', () => {
    const lista = [g('x-basura', '2020-07-14', 'basura'), g('y-bueno', '2020-07-14', '2026-11-13T12:00:00+00:00'), g('z-vacio', '2020-07-14', '')];
    const orden = ids(ordenarPorCercania(lista, VIAJE));
    expect(orden[0]).toBe('y-bueno');
    expect(orden.slice(1).sort()).toEqual(['x-basura', 'z-vacio']);
    expect(ids(ordenarPorCercania([...lista].reverse(), VIAJE))).toEqual(orden); // y el orden no depende de cómo llegaron
  });

  it('una fecha de gasto que no se entiende (la base no la limita) no rompe la lista: va al final, en orden fijo', () => {
    const lista = [
      g('inf', 'infinity'),
      g('bien-lejos', '2019-01-01'),
      g('ac', '0044-03-15 BC'),
      g('grande', '10000-01-01'),
      g('menos-inf', '-infinity'),
      g('bien-cerca', '2020-07-15'),
    ];
    const esperado = ['bien-cerca', 'bien-lejos', 'inf', 'grande', 'ac', 'menos-inf'];
    expect(() => ordenarPorCercania(lista, VIAJE)).not.toThrow();
    expect(ids(ordenarPorCercania(lista, VIAJE))).toEqual(esperado);
    expect(ids(ordenarPorCercania([...lista].reverse(), VIAJE))).toEqual(esperado);
  });

  it('una fecha de VIAJE inválida es un error de quien llama: tira RangeError (aunque la lista esté vacía)', () => {
    for (const mala of ['', 'hoy', '2020-02-30', '2020-7-15', 'infinity', undefined as unknown as string]) {
      expect(() => ordenarPorCercania([g('a', '2020-07-15')], mala), String(mala)).toThrow(RangeError);
      expect(() => ordenarPorCercania([], mala), String(mala)).toThrow(RangeError);
    }
  });

  it('sin gastos: lista vacía', () => {
    expect(ordenarPorCercania([], VIAJE)).toEqual([]);
  });

  it('no cambia la lista que recibe y devuelve una lista nueva (aunque ya esté ordenada)', () => {
    const entrada = Object.freeze([g('b', '2020-07-01'), g('a', '2020-07-15')]);
    const salida = ordenarPorCercania(entrada, VIAJE);
    expect(ids(entrada)).toEqual(['b', 'a']);
    expect(ids(salida)).toEqual(['a', 'b']);
    const yaOrdenada = [g('a', '2020-07-15'), g('b', '2020-07-01')];
    expect(ordenarPorCercania(yaOrdenada, VIAJE)).not.toBe(yaOrdenada);
    expect(ordenarPorCercania(yaOrdenada, VIAJE)).toEqual(yaOrdenada);
  });

  it('conserva los demás campos del gasto, tal cual (devuelve los mismos objetos)', () => {
    const original = { id: 'a', fecha: '2020-07-15', created_at: T, monto: 1234.5, descripcion: 'peaje', camion_id: null };
    const [salida] = ordenarPorCercania([original], VIAJE);
    expect(salida).toBe(original);
  });

  it('el resultado NO depende del orden en que llegan (las 120 permutaciones de 5 gastos con empates dan lo mismo)', () => {
    const base = [
      g('uno', '2020-07-15', '2026-11-13T12:00:00+00:00'),
      g('dos', '2020-07-17', '2026-11-13T11:00:00+00:00'),
      g('tres', '2020-07-13', '2026-11-13T11:00:00+00:00'),
      g('cuatro', '2020-07-13', '2026-11-13T11:00:00+00:00'),
      g('cinco', '2020-07-20', '2026-11-13T09:00:00+00:00'),
    ];
    const esperado = ['uno', 'dos', 'cuatro', 'tres', 'cinco']; // 0, 2 (posterior), 2 (anterior; mismo created_at: id «cuatro» < «tres»), 5
    const permutaciones = (lista: typeof base): Array<typeof base> =>
      lista.length <= 1 ? [lista] : lista.flatMap((x, i) => permutaciones([...lista.slice(0, i), ...lista.slice(i + 1)]).map((resto) => [x, ...resto]));
    const todas = permutaciones(base);
    expect(todas).toHaveLength(120);
    for (const permutacion of todas) expect(ids(ordenarPorCercania(permutacion, VIAJE))).toEqual(esperado);
  });

  it('coincide con un orden calculado aparte (enteros y texto, sin Date) en 60 listas al azar con muchos empates', () => {
    let semilla = 13_112_026;
    const azar = () => {
      semilla = (Math.imul(semilla, 1_664_525) + 1_013_904_223) >>> 0;
      return semilla / 2 ** 32;
    };
    const entero = (n: number) => Math.floor(azar() * n);
    for (let ronda = 0; ronda < 60; ronda++) {
      const fechaViaje = sumarDias('2024-01-01', entero(900));
      const cantidad = 5 + entero(60);
      const gastos = Array.from({ length: cantidad }, (_, i) => ({
        id: `00000000-0000-4000-8000-${String(entero(1e6)).padStart(6, '0')}${String(i).padStart(6, '0')}`,
        fecha: sumarDias(fechaViaje, entero(21) - 10), // ±10 días: muchos empates de distancia
        // Un solo formato (zona +00:00, 6 decimales): con ese formato el texto SÍ ordena igual que el instante.
        created_at: `2026-11-13T1${entero(3)}:00:00.${String(entero(3) * 111_111).padStart(6, '0')}+00:00`,
      }));
      const [anio, mes, dia] = fechaViaje.split('-').map(Number);
      const diaViaje = diasDesdeCivil(anio!, mes!, dia!);
      const referencia = [...gastos].sort((x, y) => {
        const dx = Math.abs(diasDesdeCivil(...(x.fecha.split('-').map(Number) as [number, number, number])) - diaViaje);
        const dy = Math.abs(diasDesdeCivil(...(y.fecha.split('-').map(Number) as [number, number, number])) - diaViaje);
        if (dx !== dy) return dx - dy;
        if (x.fecha !== y.fecha) return x.fecha < y.fecha ? 1 : -1;
        if (x.created_at !== y.created_at) return x.created_at < y.created_at ? 1 : -1;
        return x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
      });
      const mezclados = [...gastos].sort(() => azar() - 0.5);
      expect(ids(ordenarPorCercania(mezclados, fechaViaje)), `ronda ${ronda}`).toEqual(ids(referencia));
    }
  });
});

// ---------------------------------------------------------------------------
// Candidatos
// ---------------------------------------------------------------------------

describe('mezclarCandidatos: las dos consultas (desde la fecha del viaje y antes) en una sola lista de candidatos', () => {
  const VIAJE = '2026-06-15';
  const T = '2026-11-01T10:00:00+00:00';
  const g = (id: string, fecha: string, created_at = T) => ({ id, fecha, created_at });
  const ids = (lista: ReadonlyArray<{ id: string }>) => lista.map((x) => x.id);
  /** `n` gastos con id único, uno por día, empezando `desde` días de la fecha del viaje y yendo en la dirección `paso` (+1 o -1). */
  const tanda = (prefijo: string, n: number, desde: number, paso: 1 | -1) =>
    Array.from({ length: n }, (_, i) => g(`${prefijo}${String(i).padStart(3, '0')}`, sumarDias(VIAJE, desde + paso * i)));

  it('sin gastos en ninguna de las dos: lista vacía y nada más', () => {
    expect(mezclarCandidatos([], [], VIAJE)).toEqual({ items: [], hayMas: false });
  });

  it('con gastos de un solo lado (el otro vacío)', () => {
    const posteriores = [g('p1', '2026-06-20'), g('p0', '2026-06-16')];
    expect(mezclarCandidatos(posteriores, [], VIAJE)).toEqual({ items: [posteriores[1], posteriores[0]], hayMas: false });
    const anteriores = [g('a1', '2026-06-01'), g('a0', '2026-06-14')];
    expect(mezclarCandidatos([], anteriores, VIAJE)).toEqual({ items: [anteriores[1], anteriores[0]], hayMas: false });
  });

  it('junta y ordena todo por cercanía, sin importar de qué consulta vino cada gasto', () => {
    const posteriores = [g('p3', '2026-06-18'), g('p1', '2026-06-15'), g('p9', '2026-06-24')];
    const anteriores = [g('a2', '2026-06-13'), g('a1', '2026-06-14'), g('a8', '2026-06-07')];
    const { items, hayMas } = mezclarCandidatos(posteriores, anteriores, VIAJE);
    expect(ids(items)).toEqual(['p1', 'a1', 'a2', 'p3', 'a8', 'p9']);
    expect(hayMas).toBe(false);
  });

  it('empate de distancia entre los dos lados: el posterior (fecha más reciente) primero; y lo mismo con cualquier distancia', () => {
    for (const distancia of [1, 2, 7, 30, 200]) {
      const { items } = mezclarCandidatos([g('despues', sumarDias(VIAJE, distancia))], [g('antes', sumarDias(VIAJE, -distancia))], VIAJE);
      expect(ids(items), String(distancia)).toEqual(['despues', 'antes']);
    }
  });

  it('el tope por defecto es MAX_GASTOS_POR_VEZ (100): con exactamente 100 en total no hay «más»', () => {
    const { items, hayMas } = mezclarCandidatos(tanda('p', 60, 0, 1), tanda('a', 40, -1, -1), VIAJE);
    expect(items).toHaveLength(100);
    expect(hayMas).toBe(false);
  });

  it('con 101 en total se muestran 100 y hay más (el que sobra es el MÁS LEJANO)', () => {
    const posteriores = tanda('p', 60, 0, 1); // distancias 0..59
    const anteriores = tanda('a', 41, -1, -1); // distancias 1..41
    const { items, hayMas } = mezclarCandidatos(posteriores, anteriores, VIAJE);
    expect(items).toHaveLength(100);
    expect(hayMas).toBe(true);
    expect(ids(items)).not.toContain('p059'); // la distancia 59 es la más lejana de las 101
    expect(items.every((x) => distanciaEnDias(x.fecha, VIAJE)! <= 58)).toBe(true);
  });

  it('cada lado trae 101 (lo que pide la consulta): quedan los 100 más cercanos de entre los dos y hay más', () => {
    const posteriores = tanda('p', 101, 0, 1); // distancias 0..100
    const anteriores = tanda('a', 101, -1, -1); // distancias 1..101
    const { items, hayMas } = mezclarCandidatos(posteriores, anteriores, VIAJE);
    expect(items).toHaveLength(100);
    expect(hayMas).toBe(true);
    // Distancia 0: 1 gasto. Distancias 1 a 49: 2 por día (98). Suman 99; el lugar 100 es de la distancia 50, y de las dos se queda la posterior.
    expect(ids(items).slice(0, 3)).toEqual(['p000', 'p001', 'a000']);
    expect(ids(items)[99]).toBe('p050');
    expect(ids(items)).not.toContain('a049'); // la anterior a la misma distancia (50) queda afuera
    // Lo que quedó fuera es todo más lejano que lo que entró.
    const mayorDistanciaMostrada = Math.max(...items.map((x) => distanciaEnDias(x.fecha, VIAJE)!));
    expect(mayorDistanciaMostrada).toBe(50);
  });

  it('un solo lado con 101: se muestran 100 y hay más', () => {
    const { items, hayMas } = mezclarCandidatos(tanda('p', 101, 0, 1), [], VIAJE);
    expect(items).toHaveLength(100);
    expect(hayMas).toBe(true);
    expect(ids(items)).not.toContain('p100');
    const solo = mezclarCandidatos([], tanda('a', 101, -1, -1), VIAJE);
    expect(solo.items).toHaveLength(100);
    expect(solo.hayMas).toBe(true);
  });

  it('un tope propio: corta ahí y `hayMas` solo es true si había más que ese tope', () => {
    const lista = tanda('p', 5, 0, 1);
    expect(mezclarCandidatos(lista, [], VIAJE, 3)).toEqual({ items: lista.slice(0, 3), hayMas: true });
    expect(mezclarCandidatos(lista, [], VIAJE, 5)).toEqual({ items: lista, hayMas: false });
    expect(mezclarCandidatos(lista, [], VIAJE, 6)).toEqual({ items: lista, hayMas: false });
    expect(mezclarCandidatos(lista, [], VIAJE, 4).hayMas).toBe(true);
  });

  it('tope 0: no se muestra nada y hay más solo si hay algo', () => {
    expect(mezclarCandidatos(tanda('p', 2, 0, 1), [], VIAJE, 0)).toEqual({ items: [], hayMas: true });
    expect(mezclarCandidatos([], [], VIAJE, 0)).toEqual({ items: [], hayMas: false });
  });

  it('un tope que no es un entero mayor o igual a 0 es un error de quien llama: tira RangeError (un -1 cortaría el último sin avisar)', () => {
    for (const malo of [-1, -100, 1.5, NaN, Infinity, -Infinity]) {
      expect(() => mezclarCandidatos(tanda('p', 3, 0, 1), [], VIAJE, malo), String(malo)).toThrow(RangeError);
    }
  });

  it('una fecha de viaje inválida tira RangeError', () => {
    expect(() => mezclarCandidatos([], [], '2026-02-30')).toThrow(RangeError);
    expect(() => mezclarCandidatos([g('a', '2026-06-15')], [], 'hoy')).toThrow(RangeError);
  });

  it('un gasto que llega en las dos listas (se le cambió la fecha entre una consulta y la otra) se cuenta UNA vez', () => {
    const repetido = g('r', '2026-06-15');
    const { items, hayMas } = mezclarCandidatos([repetido, g('p', '2026-06-20')], [{ ...repetido }, g('a', '2026-06-10')], VIAJE);
    expect(ids(items)).toEqual(['r', 'p', 'a']);
    expect(hayMas).toBe(false);
    // Y no infla el «hay más»: 100 distintos + 1 repetido no son 101.
    const cien = tanda('p', 100, 0, 1);
    expect(mezclarCandidatos(cien, [{ ...cien[0]! }], VIAJE).hayMas).toBe(false);
  });

  it('el resultado no depende del orden en que llega cada lista', () => {
    const posteriores = [g('p1', '2026-06-16'), g('p2', '2026-06-18'), g('p3', '2026-06-18', '2026-11-02T10:00:00+00:00')];
    const anteriores = [g('a1', '2026-06-14'), g('a2', '2026-06-12'), g('a3', '2026-06-12')];
    const esperado = mezclarCandidatos(posteriores, anteriores, VIAJE);
    expect(mezclarCandidatos([...posteriores].reverse(), [...anteriores].reverse(), VIAJE)).toEqual(esperado);
  });

  it('no cambia las listas que recibe', () => {
    const posteriores = Object.freeze([g('p2', '2026-06-20'), g('p1', '2026-06-16')]);
    const anteriores = Object.freeze([g('a2', '2026-06-01'), g('a1', '2026-06-14')]);
    expect(() => mezclarCandidatos(posteriores, anteriores, VIAJE)).not.toThrow();
    expect(ids(posteriores)).toEqual(['p2', 'p1']);
    expect(ids(anteriores)).toEqual(['a2', 'a1']);
  });

  it('lo devuelto es una lista nueva con los mismos objetos de los gastos', () => {
    const uno = g('uno', '2026-06-15');
    const { items } = mezclarCandidatos([uno], [], VIAJE);
    expect(items[0]).toBe(uno);
  });
});
