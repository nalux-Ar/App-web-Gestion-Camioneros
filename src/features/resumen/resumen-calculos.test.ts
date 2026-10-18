import { describe, expect, it } from 'vitest';

import {
  CLAVE_OTRAS,
  compararGasto,
  filasDeBarras,
  gastoPorMes,
  mesesYaTranscurridos,
  porcentajesEnteros,
  principalesYOtras,
  promedioPorMes,
  totalesDelAnio,
  type EntradaDeBarra,
} from './resumen-calculos';
import type { ResumenDelMes } from './resumen-parse';

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

describe('promedioPorMes (vista Año)', () => {
  it('total / meses, a centavos', () => {
    expect(promedioPorMes(78000, 12)).toBe(6500);
    expect(promedioPorMes(55000, 10)).toBe(5500);
    expect(promedioPorMes(10000, 3)).toBe(3333.33);
    expect(promedioPorMes(2, 3)).toBe(0.67);
  });

  it('un solo mes: el promedio es el total', () => {
    expect(promedioPorMes(1234.5, 1)).toBe(1234.5);
  });

  it('0 meses (o menos): sin promedio', () => {
    expect(promedioPorMes(1000, 0)).toBeNull();
    expect(promedioPorMes(0, 0)).toBeNull();
    expect(promedioPorMes(1000, -1)).toBeNull();
  });

  it('sin gastos: 0', () => {
    expect(promedioPorMes(0, 12)).toBe(0);
  });
});

describe('gastoPorMes (vista Año)', () => {
  const fila = (m: number, monto: number, cantidad = 1) => ({ mes: `2026-${String(m).padStart(2, '0')}-01`, gastosMonto: monto, gastosCantidad: cantidad });
  const anio = [1000, 2000, 0, 4000, 500, 0, 0, 0, 0, 0, 0, 0].map((monto, i) => fila(i + 1, monto, monto > 0 ? i + 1 : 0));

  it('solo los meses transcurridos, en orden', () => {
    expect(gastoPorMes(anio, 5).map((m) => m.mes)).toEqual(['2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01']);
    expect(gastoPorMes(anio, 12)).toHaveLength(12);
    expect(gastoPorMes(anio, 0)).toEqual([]);
  });

  it('el ancho es relativo al MES DE MAYOR GASTO (ese mide 100), no al total', () => {
    expect(gastoPorMes(anio, 5).map((m) => m.ancho)).toEqual([25, 50, 0, 100, 12.5]);
  });

  it('un mes futuro (fuera de los transcurridos) no cuenta para el máximo', () => {
    const conFuturo = [fila(1, 1000), fila(2, 2000), fila(3, 999999)];
    expect(gastoPorMes(conFuturo, 2).map((m) => m.ancho)).toEqual([50, 100]);
  });

  it('monto y cantidad tal cual; un año sin gastos da todo en 0 (sin dividir por 0)', () => {
    expect(gastoPorMes(anio, 2)).toEqual([
      { mes: '2026-01-01', monto: 1000, cantidad: 1, ancho: 50 },
      { mes: '2026-02-01', monto: 2000, cantidad: 2, ancho: 100 },
    ]);
    expect(gastoPorMes([fila(1, 0, 0), fila(2, 0, 0)], 2).map((m) => m.ancho)).toEqual([0, 0]);
  });
});

describe('totalesDelAnio y mesesYaTranscurridos (vista Año)', () => {
  const fila = (m: number, over: Partial<ResumenDelMes> = {}): ResumenDelMes => ({
    mes: `2026-${String(m).padStart(2, '0')}-01`,
    gastosCantidad: m,
    gastosMonto: m * 1000,
    combustibleCargas: 0,
    combustibleLitros: 0,
    combustibleMonto: 0,
    viajesCantidad: 2,
    viajesKm: 400.5,
    viajesConIngreso: 2,
    viajesSinIngreso: 0,
    viajesIngreso: m * 1500,
    resultado: m * 500,
    ...over,
  });
  const sinIngreso = { viajesConIngreso: 0, viajesSinIngreso: 2, viajesIngreso: 0, resultado: null };

  it('suma ingresos, gastos, viajes y km de todas las filas; resultado = ingresos − gastos', () => {
    expect(totalesDelAnio([fila(1), fila(2), fila(3)])).toEqual({
      ingresos: 9000,
      gastos: 6000,
      viajesCantidad: 6,
      viajesKm: 1201.5,
      viajesConIngreso: 6,
      viajesSinIngreso: 0,
      resultado: 3000,
    });
  });

  it('pérdida: resultado negativo', () => {
    expect(totalesDelAnio([fila(1, { viajesIngreso: 200 })]).resultado).toBe(-800);
  });

  it('ningún viaje con ingreso en todo el año: resultado null (no "−gastos")', () => {
    const totales = totalesDelAnio([fila(1, sinIngreso), fila(2, sinIngreso)]);
    expect(totales.resultado).toBeNull();
    expect(totales.viajesSinIngreso).toBe(4);
    expect(totales.gastos).toBe(3000);
  });

  it('mezcla de meses con y sin ingreso: resta TODOS los gastos del año (no suma los resultados de los meses con ingreso)', () => {
    const totales = totalesDelAnio([fila(1), fila(2, sinIngreso), fila(3, sinIngreso)]);
    // Ingresos 1.500; gastos 1.000 + 2.000 + 3.000. La suma de resultados de los meses daría +500.
    expect(totales.resultado).toBe(-4500);
    expect(totales.viajesConIngreso).toBe(2);
    expect(totales.viajesSinIngreso).toBe(4);
  });

  it('un ingreso 0 cuenta como cargado: hay resultado (= −gastos)', () => {
    const totales = totalesDelAnio([fila(1, sinIngreso), fila(2, { viajesConIngreso: 1, viajesSinIngreso: 1, viajesIngreso: 0, resultado: -2000 })]);
    expect(totales.resultado).toBe(-3000);
  });

  it('a centavos, sin ruido de coma flotante; sin filas, todo 0 y sin resultado', () => {
    const totales = totalesDelAnio([fila(1, { viajesIngreso: 0.1, gastosMonto: 0.3 }), fila(2, { viajesIngreso: 0.2, gastosMonto: 0 })]);
    expect(totales.ingresos).toBe(0.3);
    expect(totales.resultado).toBe(0);
    expect(totalesDelAnio([])).toEqual({ ingresos: 0, gastos: 0, viajesCantidad: 0, viajesKm: 0, viajesConIngreso: 0, viajesSinIngreso: 0, resultado: null });
  });

  it('mesesYaTranscurridos: los primeros N, en orden; nunca negativos', () => {
    const anio = Array.from({ length: 12 }, (_, i) => fila(i + 1));
    expect(mesesYaTranscurridos(anio, 10).map((f) => f.mes.slice(5, 7))).toEqual(['01', '02', '03', '04', '05', '06', '07', '08', '09', '10']);
    expect(mesesYaTranscurridos(anio, 12)).toHaveLength(12);
    expect(mesesYaTranscurridos(anio, 0)).toEqual([]);
    expect(mesesYaTranscurridos(anio, -3)).toEqual([]);
  });
});
