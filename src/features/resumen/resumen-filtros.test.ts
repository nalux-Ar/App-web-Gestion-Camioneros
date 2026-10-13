import { describe, expect, it } from 'vitest';

import {
  filtroEnVista,
  parseAnioParam,
  readResumenFiltro,
  resumenFiltroToParams,
  resumenFiltroToSearch,
  type ResumenFiltro,
} from '@/features/resumen/resumen-filtros';

// "Ahora" fijo (hora local): 13 de octubre de 2026.
const NOW = new Date(2026, 9, 13, 10, 0);
const leer = (search: string) => readResumenFiltro(new URLSearchParams(search), NOW);
const MES_ACTUAL: ResumenFiltro = { vista: 'mes', mes: { year: 2026, month: 10 } };

describe('readResumenFiltro: valores válidos', () => {
  it('sin nada: la vista Mes y el mes actual', () => {
    expect(leer('')).toEqual(MES_ACTUAL);
  });

  it('?mes= válido', () => {
    expect(leer('mes=2026-08')).toEqual({ vista: 'mes', mes: { year: 2026, month: 8 } });
    expect(leer('mes=2000-01')).toEqual({ vista: 'mes', mes: { year: 2000, month: 1 } });
    expect(leer('mes=2026-10')).toEqual(MES_ACTUAL);
  });

  it('?vista=anio con y sin año', () => {
    expect(leer('vista=anio&anio=2025')).toEqual({ vista: 'anio', anio: 2025 });
    expect(leer('vista=anio')).toEqual({ vista: 'anio', anio: 2026 });
    expect(leer('vista=anio&anio=2000')).toEqual({ vista: 'anio', anio: 2000 });
  });

  it('solo cuenta el parámetro de la vista elegida', () => {
    expect(leer('mes=2026-08&anio=2020')).toEqual({ vista: 'mes', mes: { year: 2026, month: 8 } });
    expect(leer('vista=anio&mes=2024-05')).toEqual({ vista: 'anio', anio: 2026 });
  });
});

describe('readResumenFiltro: URL hostil -> valor por defecto', () => {
  it.each([
    'mes=2026-13',
    'mes=2026-00',
    'mes=2026-9',
    'mes=26-09',
    'mes=1999-12', // antes de 2000
    'mes=2026-11', // futuro
    'mes=2026-10-01',
    'mes=%20 2026-08',
    'mes=',
    'mes=toString',
  ])('%s', (search) => {
    expect(leer(search)).toEqual(MES_ACTUAL);
  });

  it.each([
    'vista=anio&anio=1999',
    'vista=anio&anio=2027', // futuro
    'vista=anio&anio=02026',
    'vista=anio&anio=2026.0',
    'vista=anio&anio=+2026',
    'vista=anio&anio= 2026',
    'vista=anio&anio=2e3',
    'vista=anio&anio=0x7EA',
    'vista=anio&anio=２０２６', // dígitos de ancho completo: no son ASCII
    'vista=anio&anio=',
  ])('%s -> el año actual', (search) => {
    expect(leer(search)).toEqual({ vista: 'anio', anio: 2026 });
  });

  it.each(['vista=ANIO', 'vista=año', 'vista=toString', 'vista=__proto__', 'vista=', 'vista=mes%00', 'vista=devoluciones'])(
    '%s -> la vista Mes',
    (search) => {
      expect(leer(`${search}&anio=2025`)).toEqual(MES_ACTUAL);
    },
  );

  it('un parámetro repetido: vale el primero (URLSearchParams.get), y se valida igual', () => {
    expect(leer('vista=anio&vista=mes&anio=2024')).toEqual({ vista: 'anio', anio: 2024 });
    expect(leer('mes=2099-01&mes=2026-08')).toEqual(MES_ACTUAL);
  });

  it('parseAnioParam suelto', () => {
    expect(parseAnioParam('2026', NOW)).toBe(2026);
    expect(parseAnioParam(null, NOW)).toBeNull();
    expect(parseAnioParam(undefined, NOW)).toBeNull();
    expect(parseAnioParam('2027', NOW)).toBeNull();
  });
});

describe('a la URL: lo que es por defecto no se escribe', () => {
  it('mes actual: nada; otro mes: ?mes=', () => {
    expect(resumenFiltroToSearch(MES_ACTUAL, NOW)).toBe('');
    expect(resumenFiltroToSearch({ vista: 'mes', mes: { year: 2026, month: 8 } }, NOW)).toBe('?mes=2026-08');
    expect(resumenFiltroToSearch({ vista: 'mes', mes: { year: 2025, month: 10 } }, NOW)).toBe('?mes=2025-10');
  });

  it('vista Año: siempre la vista; el año solo si no es el actual', () => {
    expect(resumenFiltroToSearch({ vista: 'anio', anio: 2026 }, NOW)).toBe('?vista=anio');
    expect(resumenFiltroToSearch({ vista: 'anio', anio: 2025 }, NOW)).toBe('?vista=anio&anio=2025');
    expect(resumenFiltroToParams({ vista: 'anio', anio: 2025 }, NOW).has('mes')).toBe(false);
  });

  it('ida y vuelta: lo que se escribe se lee igual', () => {
    const filtros: ResumenFiltro[] = [
      MES_ACTUAL,
      { vista: 'mes', mes: { year: 2026, month: 1 } },
      { vista: 'mes', mes: { year: 2000, month: 12 } },
      { vista: 'anio', anio: 2026 },
      { vista: 'anio', anio: 2019 },
    ];
    for (const filtro of filtros) {
      expect(leer(resumenFiltroToSearch(filtro, NOW).replace(/^\?/, '')), JSON.stringify(filtro)).toEqual(filtro);
    }
  });
});

describe('filtroEnVista: cambiar de vista conserva el período', () => {
  it('de un mes, al año de ese mes', () => {
    expect(filtroEnVista({ vista: 'mes', mes: { year: 2024, month: 5 } }, 'anio', NOW)).toEqual({ vista: 'anio', anio: 2024 });
  });

  it('del año actual, al mes actual; de un año pasado, a su diciembre', () => {
    expect(filtroEnVista({ vista: 'anio', anio: 2026 }, 'mes', NOW)).toEqual(MES_ACTUAL);
    expect(filtroEnVista({ vista: 'anio', anio: 2023 }, 'mes', NOW)).toEqual({ vista: 'mes', mes: { year: 2023, month: 12 } });
  });

  it('a la misma vista: el mismo filtro', () => {
    const filtro: ResumenFiltro = { vista: 'mes', mes: { year: 2026, month: 3 } };
    expect(filtroEnVista(filtro, 'mes', NOW)).toBe(filtro);
  });
});
