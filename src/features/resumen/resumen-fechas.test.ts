import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  diasDelMes,
  diferenciaEnDias,
  esBisiesto,
  esMesEnCurso,
  mesDeFecha,
  mesesDeLaSerie,
  mesesTranscurridos,
  partesDeFecha,
  primerDiaDelMes,
  rangoDeComparacion,
  rangoDelAnio,
  rangoDelMes,
  ultimoDiaDelMes,
} from '@/features/resumen/resumen-fechas';

const ym = (year: number, month: number) => ({ year, month });

afterEach(() => {
  vi.useRealTimers();
});

describe('bisiestos y días del mes', () => {
  it.each([
    [2024, true],
    [2023, false],
    [2000, true], // divisible por 400
    [1900, false], // centenario no divisible por 400
    [2100, false],
    [2400, true],
  ])('%i bisiesto: %s', (anio, esperado) => {
    expect(esBisiesto(anio)).toBe(esperado);
  });

  it('días de cada mes (año común y bisiesto)', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((m) => diasDelMes(2026, m))).toEqual([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);
    expect(diasDelMes(2024, 2)).toBe(29);
    expect(diasDelMes(1900, 2)).toBe(28);
    expect(diasDelMes(2000, 2)).toBe(29);
  });
});

describe('rangos INCLUSIVOS (hasta = último día, no el primero del mes siguiente)', () => {
  it('rangoDelMes: del 1 al último día', () => {
    expect(rangoDelMes(ym(2026, 10))).toEqual({ desde: '2026-10-01', hasta: '2026-10-31' });
    expect(rangoDelMes(ym(2026, 9))).toEqual({ desde: '2026-09-01', hasta: '2026-09-30' });
    expect(rangoDelMes(ym(2026, 2))).toEqual({ desde: '2026-02-01', hasta: '2026-02-28' });
    expect(rangoDelMes(ym(2024, 2))).toEqual({ desde: '2024-02-01', hasta: '2024-02-29' });
    expect(rangoDelMes(ym(2026, 12))).toEqual({ desde: '2026-12-01', hasta: '2026-12-31' });
  });

  it('primer y último día', () => {
    expect(primerDiaDelMes(ym(2026, 1))).toBe('2026-01-01');
    expect(ultimoDiaDelMes(ym(2026, 4))).toBe('2026-04-30');
    expect(ultimoDiaDelMes(ym(2000, 2))).toBe('2000-02-29');
  });

  it('rangoDelAnio: 1 de enero a 31 de diciembre', () => {
    expect(rangoDelAnio(2026)).toEqual({ desde: '2026-01-01', hasta: '2026-12-31' });
    expect(rangoDelAnio(2024)).toEqual({ desde: '2024-01-01', hasta: '2024-12-31' });
  });

  it('la diferencia en días es la de la base (p_hasta - p_desde)', () => {
    expect(diferenciaEnDias({ desde: '2026-10-13', hasta: '2026-10-13' })).toBe(0);
    expect(diferenciaEnDias(rangoDelMes(ym(2026, 10)))).toBe(30);
    expect(diferenciaEnDias(rangoDelMes(ym(2024, 2)))).toBe(28);
    expect(diferenciaEnDias(rangoDelAnio(2026))).toBe(364);
    expect(diferenciaEnDias(rangoDelAnio(2024))).toBe(365); // bisiesto: sigue dentro de los 366
    expect(diferenciaEnDias({ desde: '2025-12-31', hasta: '2026-01-01' })).toBe(1);
    expect(diferenciaEnDias({ desde: '2026-03-01', hasta: '2026-02-28' })).toBe(-1);
    expect(diferenciaEnDias({ desde: '2000-01-01', hasta: '2100-01-01' })).toBe(36525);
  });

  it('fechas inválidas: null', () => {
    expect(diferenciaEnDias({ desde: '2026-02-30', hasta: '2026-03-01' })).toBeNull();
    expect(diferenciaEnDias({ desde: '2026-1-01', hasta: '2026-03-01' })).toBeNull();
    expect(partesDeFecha('20261013')).toBeNull();
    expect(mesDeFecha('2026-13-01')).toBeNull();
    expect(mesDeFecha('2026-10-13')).toEqual(ym(2026, 10));
  });
});

describe('rango de comparación (decisión: mes en curso contra los mismos días; mes cerrado contra el anterior completo)', () => {
  it('mes CERRADO: el mes anterior completo, aunque hoy sea cualquier día', () => {
    expect(rangoDeComparacion(ym(2026, 9), '2026-10-13')).toEqual({ desde: '2026-08-01', hasta: '2026-08-31' });
    expect(rangoDeComparacion(ym(2026, 3), '2026-10-31')).toEqual({ desde: '2026-02-01', hasta: '2026-02-28' });
    expect(rangoDeComparacion(ym(2024, 3), '2026-10-13')).toEqual({ desde: '2024-02-01', hasta: '2024-02-29' });
  });

  it('mes EN CURSO: del 1 al mismo número de día del mes anterior', () => {
    expect(rangoDeComparacion(ym(2026, 10), '2026-10-13')).toEqual({ desde: '2026-09-01', hasta: '2026-09-13' });
    expect(rangoDeComparacion(ym(2026, 10), '2026-10-01')).toEqual({ desde: '2026-09-01', hasta: '2026-09-01' });
  });

  it('mes en curso con un día que el mes anterior no tiene: se acota a su último día', () => {
    expect(rangoDeComparacion(ym(2026, 3), '2026-03-31')).toEqual({ desde: '2026-02-01', hasta: '2026-02-28' });
    expect(rangoDeComparacion(ym(2026, 3), '2026-03-29')).toEqual({ desde: '2026-02-01', hasta: '2026-02-28' });
    expect(rangoDeComparacion(ym(2024, 3), '2024-03-31')).toEqual({ desde: '2024-02-01', hasta: '2024-02-29' }); // bisiesto
    expect(rangoDeComparacion(ym(2024, 3), '2024-03-29')).toEqual({ desde: '2024-02-01', hasta: '2024-02-29' });
    expect(rangoDeComparacion(ym(2026, 5), '2026-05-31')).toEqual({ desde: '2026-04-01', hasta: '2026-04-30' });
    expect(rangoDeComparacion(ym(2026, 7), '2026-07-31')).toEqual({ desde: '2026-06-01', hasta: '2026-06-30' });
  });

  it('enero se compara con diciembre del año anterior (en curso y cerrado)', () => {
    expect(rangoDeComparacion(ym(2026, 1), '2026-01-20')).toEqual({ desde: '2025-12-01', hasta: '2025-12-20' });
    expect(rangoDeComparacion(ym(2025, 1), '2026-01-20')).toEqual({ desde: '2024-12-01', hasta: '2024-12-31' });
  });

  it('el mismo mes de OTRO año no está "en curso"', () => {
    expect(esMesEnCurso(ym(2025, 10), '2026-10-13')).toBe(false);
    expect(esMesEnCurso(ym(2026, 10), '2026-10-13')).toBe(true);
    expect(rangoDeComparacion(ym(2025, 10), '2026-10-13')).toEqual({ desde: '2025-09-01', hasta: '2025-09-30' });
  });

  it('con un "hoy" inválido se toma el mes como cerrado', () => {
    expect(rangoDeComparacion(ym(2026, 10), 'cualquier-cosa')).toEqual({ desde: '2026-09-01', hasta: '2026-09-30' });
    expect(esMesEnCurso(ym(2026, 10), '')).toBe(false);
  });

  it('el rango de comparación nunca supera un mes ni sale del mes anterior', () => {
    for (let mes = 1; mes <= 12; mes++) {
      for (let dia = 1; dia <= diasDelMes(2026, mes); dia++) {
        const hoy = `2026-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
        const rango = rangoDeComparacion(ym(2026, mes), hoy);
        const anterior = mes === 1 ? ym(2025, 12) : ym(2026, mes - 1);
        expect(rango.desde, hoy).toBe(primerDiaDelMes(anterior));
        expect(rango.hasta <= ultimoDiaDelMes(anterior), hoy).toBe(true);
        expect(diferenciaEnDias(rango)! + 1, hoy).toBe(Math.min(dia, diasDelMes(anterior.year, anterior.month)));
      }
    }
  });
});

describe('sin zona horaria', () => {
  it('no usa el reloj ni la zona: con el sistema a medianoche UTC en otra fecha, el resultado solo depende de "hoy"', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2031, 0, 1, 2, 30))); // otra fecha, cerca de la medianoche
    expect(rangoDeComparacion(ym(2026, 10), '2026-10-13')).toEqual({ desde: '2026-09-01', hasta: '2026-09-13' });
    expect(rangoDelMes(ym(2026, 10))).toEqual({ desde: '2026-10-01', hasta: '2026-10-31' });
    expect(mesesTranscurridos(2026, '2026-10-13')).toBe(10);
  });
});

describe('vista Año: meses transcurridos y la serie', () => {
  it('meses que ya empezaron (divisor del promedio por mes)', () => {
    expect(mesesTranscurridos(2025, '2026-10-13')).toBe(12);
    expect(mesesTranscurridos(2026, '2026-10-13')).toBe(10);
    expect(mesesTranscurridos(2026, '2026-01-01')).toBe(1);
    expect(mesesTranscurridos(2027, '2026-10-13')).toBe(0);
    expect(mesesTranscurridos(2026, 'mal')).toBe(0);
  });

  it('la serie de resumen_mensual: primeros días consecutivos, cruzando el año', () => {
    expect(mesesDeLaSerie(ym(2026, 1), 12)).toEqual([
      '2026-01-01', '2026-02-01', '2026-03-01', '2026-04-01', '2026-05-01', '2026-06-01',
      '2026-07-01', '2026-08-01', '2026-09-01', '2026-10-01', '2026-11-01', '2026-12-01',
    ]);
    expect(mesesDeLaSerie(ym(2025, 11), 3)).toEqual(['2025-11-01', '2025-12-01', '2026-01-01']);
    expect(mesesDeLaSerie(ym(2026, 10), 1)).toEqual(['2026-10-01']);
  });
});
