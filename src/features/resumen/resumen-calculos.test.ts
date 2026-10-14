import { describe, expect, it } from 'vitest';

import { CLAVE_OTRAS, compararGasto, filasDeBarras, porcentajesEnteros, principalesYOtras, type EntradaDeBarra } from './resumen-calculos';

const entrada = (clave: string, monto: number, cantidad = 1): EntradaDeBarra => ({ clave, etiqueta: clave.toUpperCase(), monto, cantidad });

describe('compararGasto', () => {
  it('más que el anterior: diferencia y % (redondeado) en valor absoluto', () => {
    expect(compararGasto(10000, 8000)).toEqual({ sentido: 'mas', diferencia: 2000, porcentaje: 25 });
    expect(compararGasto(10000, 3000)).toEqual({ sentido: 'mas', diferencia: 7000, porcentaje: 233 });
  });

  it('menos que el anterior', () => {
    expect(compararGasto(6000, 8000)).toEqual({ sentido: 'menos', diferencia: 2000, porcentaje: 25 });
    expect(compararGasto(1, 3)).toEqual({ sentido: 'menos', diferencia: 2, porcentaje: 67 });
  });

  it('igual: diferencia 0 y 0 %', () => {
    expect(compararGasto(5000, 5000)).toEqual({ sentido: 'igual', diferencia: 0, porcentaje: 0 });
  });

  it('el anterior en 0: hay diferencia pero NO porcentaje', () => {
    expect(compararGasto(5000, 0)).toEqual({ sentido: 'mas', diferencia: 5000, porcentaje: null });
    expect(compararGasto(0, 0)).toEqual({ sentido: 'igual', diferencia: 0, porcentaje: null });
  });

  it('a centavos, sin ruido de coma flotante (10000,10 − 8000,05 = 2000,05)', () => {
    expect(compararGasto(10000.1, 8000.05).diferencia).toBe(2000.05);
    expect(compararGasto(0.3, 0.1 + 0.2)).toEqual({ sentido: 'igual', diferencia: 0, porcentaje: 0 });
  });

  it('una diferencia chica redondea a 0 % (el texto lo dice como "menos de 1 %")', () => {
    expect(compararGasto(10040, 10000)).toEqual({ sentido: 'mas', diferencia: 40, porcentaje: 0 });
    expect(compararGasto(9960, 10000)).toEqual({ sentido: 'menos', diferencia: 40, porcentaje: 0 });
  });

  it('el % redondea igual para arriba y para abajo (12,5 % → 13 en los dos sentidos)', () => {
    expect(compararGasto(1125, 1000).porcentaje).toBe(13);
    expect(compararGasto(875, 1000).porcentaje).toBe(13);
  });
});

describe('porcentajesEnteros', () => {
  it('exactos: tal cual', () => {
    expect(porcentajesEnteros([70, 20, 10], 100)).toEqual([70, 20, 10]);
  });

  it('tercios: suman 100 (el resto va al primero)', () => {
    expect(porcentajesEnteros([1, 1, 1], 3)).toEqual([34, 33, 33]);
  });

  it('mayor resto: el punto que falta va al de mayor parte decimal, no al primero', () => {
    // 66,6 / 16,7 / 16,7 → 66 / 16 / 16 = 98: faltan 2 → al 66,6 (0,67) y al primer 16,67 (0,67, empate: el primero).
    expect(porcentajesEnteros([4, 1, 1], 6)).toEqual([67, 17, 16]);
    // 48,4 / 25,8 / 25,8 → 48 / 25 / 25 = 98: los dos 25,8 se llevan los puntos (no el 48,4).
    expect(porcentajesEnteros([15, 8, 8], 31)).toEqual([48, 26, 26]);
  });

  it('siempre suman 100 cuando los montos suman el total', () => {
    const casos = [
      [1, 2, 3, 4, 5, 6, 7],
      [9999.99, 0.01],
      [33.33, 33.33, 33.34],
      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      [12.5, 12.5, 25, 50],
    ];
    for (const montos of casos) {
      const total = montos.reduce((a, b) => a + b, 0);
      expect(porcentajesEnteros(montos, total).reduce((a, b) => a + b, 0), String(montos)).toBe(100);
    }
  });

  it('total 0 (o inválido): todo en 0', () => {
    expect(porcentajesEnteros([0, 0], 0)).toEqual([0, 0]);
    expect(porcentajesEnteros([5], Number.NaN)).toEqual([0]);
    expect(porcentajesEnteros([], 100)).toEqual([]);
  });

  it('un monto negativo (no debería venir) cuenta como 0', () => {
    expect(porcentajesEnteros([-10, 100], 100)).toEqual([0, 100]);
  });
});

describe('filasDeBarras', () => {
  it('el % entero y el ancho EXACTO (% del total), en el mismo orden', () => {
    const filas = filasDeBarras([entrada('a', 2, 1), entrada('b', 1, 4)], 3);
    expect(filas.map((f) => [f.clave, f.porcentaje, f.cantidad])).toEqual([
      ['a', 67, 1],
      ['b', 33, 4],
    ]);
    expect(filas[0]!.ancho).toBeCloseTo(66.667, 2);
    expect(filas[1]!.ancho).toBeCloseTo(33.333, 2);
  });

  it('el ancho nunca pasa de 0–100', () => {
    const filas = filasDeBarras([entrada('a', 150), entrada('b', -5)], 100);
    expect(filas.map((f) => f.ancho)).toEqual([100, 0]);
  });

  it('total 0: barras vacías', () => {
    expect(filasDeBarras([entrada('a', 0)], 0)).toEqual([{ ...entrada('a', 0), porcentaje: 0, ancho: 0 }]);
  });
});

describe('principalesYOtras', () => {
  const etiqueta = (n: number) => `Otras (${n})`;

  it('con 5 o menos: todas, de mayor a menor', () => {
    const filas = principalesYOtras([entrada('a', 1), entrada('b', 3), entrada('c', 2)], 5, etiqueta);
    expect(filas.map((f) => f.clave)).toEqual(['b', 'c', 'a']);
  });

  it('con 6: las 6 (una "Otras" de una sola escondería su nombre)', () => {
    const entradas = [6, 5, 4, 3, 2, 1].map((m) => entrada(`c${m}`, m));
    const filas = principalesYOtras(entradas, 5, etiqueta);
    expect(filas.map((f) => f.clave)).toEqual(['c6', 'c5', 'c4', 'c3', 'c2', 'c1']);
  });

  it('con 7 o más: las 5 de mayor monto + "Otras" con la suma de monto y de cantidad del resto', () => {
    const entradas = [10, 70, 30, 20, 60, 50, 40, 5].map((m, i) => entrada(`c${m}`, m, i + 1));
    const filas = principalesYOtras(entradas, 5, etiqueta);
    expect(filas.map((f) => f.clave)).toEqual(['c70', 'c60', 'c50', 'c40', 'c30', CLAVE_OTRAS]);
    // Afuera: 20 (cantidad 4), 10 (cantidad 1) y 5 (cantidad 8).
    expect(filas[5]).toEqual({ clave: CLAVE_OTRAS, etiqueta: 'Otras (3)', monto: 35, cantidad: 13 });
  });

  it('la suma de "Otras" va a centavos', () => {
    const entradas = [100, 90, 80, 70, 60, 0.1, 0.2].map((m) => entrada(`c${m}`, m));
    expect(principalesYOtras(entradas, 5, etiqueta)[5]!.monto).toBe(0.3);
  });

  it('a igual monto, el orden en que vinieron (orden estable)', () => {
    const filas = principalesYOtras([entrada('x', 1), entrada('y', 1), entrada('z', 2)], 5, etiqueta);
    expect(filas.map((f) => f.clave)).toEqual(['z', 'x', 'y']);
  });

  it('no modifica el arreglo recibido', () => {
    const entradas = [entrada('a', 1), entrada('b', 2)];
    principalesYOtras(entradas, 5, etiqueta);
    expect(entradas.map((e) => e.clave)).toEqual(['a', 'b']);
  });
});
