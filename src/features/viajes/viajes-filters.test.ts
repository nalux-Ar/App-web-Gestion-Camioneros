import { describe, expect, it } from 'vitest';

import {
  VISTAS,
  filtroToParams,
  filtroToSearch,
  rangoDelFiltro,
  readFiltro,
  sanitizeVolver,
  searchDelMesDeFecha,
  searchEnVista,
  type ViajesFiltro,
} from '@/features/viajes/viajes-filters';

// Los meses (rango, valores inválidos, mes actual) se prueban en viajes-list.test.ts; acá, la pestaña (`vista`) y cómo
// viaja junto con el mes por la URL y por el `volver`.
const NOW = new Date(2026, 9, 2, 22, 30); // 2 de octubre de 2026, de noche (hora local)
const OCTUBRE = { year: 2026, month: 10 };
const AGOSTO = { year: 2026, month: 8 };

const params = (texto: string) => new URLSearchParams(texto);

describe('vista (la pestaña) en la URL', () => {
  it('las pestañas son exactamente dos: viajes y devoluciones', () => {
    expect([...VISTAS]).toEqual(['viajes', 'devoluciones']);
  });

  it('sin parámetro, la pestaña es Viajes', () => {
    expect(readFiltro(params(''), NOW).vista).toBe('viajes');
    expect(readFiltro(params('mes=2026-08'), NOW).vista).toBe('viajes');
  });

  it('?vista=devoluciones y ?vista=viajes se respetan', () => {
    expect(readFiltro(params('vista=devoluciones'), NOW).vista).toBe('devoluciones');
    expect(readFiltro(params('vista=viajes'), NOW).vista).toBe('viajes');
  });

  it('un valor inválido se ignora y cae en Viajes (lista blanca: mayúsculas, espacios, texto pegado, claves de objeto)', () => {
    for (const raro of [
      '',
      'Devoluciones',
      'DEVOLUCIONES',
      ' devoluciones',
      'devoluciones ',
      'devoluciones,viajes',
      'devoluciones/../x',
      'gastos',
      '<script>',
      'toString',
      '__proto__',
      'constructor',
      '1',
      'null',
      'undefined',
    ]) {
      expect(readFiltro(params(`vista=${encodeURIComponent(raro)}`), NOW).vista, JSON.stringify(raro)).toBe('viajes');
    }
  });

  it('con el parámetro repetido manda el primero (el que lee URLSearchParams.get)', () => {
    expect(readFiltro(params('vista=devoluciones&vista=viajes'), NOW).vista).toBe('devoluciones');
    expect(readFiltro(params('vista=basura&vista=devoluciones'), NOW).vista).toBe('viajes');
  });

  it('la pestaña y el mes se leen juntos, cada uno con su propia validación', () => {
    expect(readFiltro(params('vista=devoluciones&mes=2026-08'), NOW)).toEqual({ vista: 'devoluciones', mes: AGOSTO });
    // Mes inválido con pestaña válida: se conserva la pestaña y el mes cae en el actual.
    expect(readFiltro(params('vista=devoluciones&mes=2999-01'), NOW)).toEqual({ vista: 'devoluciones', mes: OCTUBRE });
    // Pestaña inválida con mes válido: se conserva el mes y la pestaña cae en Viajes.
    expect(readFiltro(params('vista=otra&mes=2026-08'), NOW)).toEqual({ vista: 'viajes', mes: AGOSTO });
  });

  it('Viajes (el valor por defecto) NO se escribe en la URL; Devoluciones sí, ANTES del mes', () => {
    expect(filtroToParams({ mes: OCTUBRE, vista: 'viajes' }, NOW).toString()).toBe('');
    expect(filtroToSearch({ mes: OCTUBRE, vista: 'viajes' }, NOW)).toBe('');
    expect(filtroToSearch({ mes: AGOSTO, vista: 'viajes' }, NOW)).toBe('?mes=2026-08');
    expect(filtroToSearch({ mes: OCTUBRE, vista: 'devoluciones' }, NOW)).toBe('?vista=devoluciones');
    expect(filtroToSearch({ mes: AGOSTO, vista: 'devoluciones' }, NOW)).toBe('?vista=devoluciones&mes=2026-08');
  });

  it('ida y vuelta por la URL: lo que se escribe se lee igual', () => {
    for (const vista of VISTAS) {
      for (const mes of [OCTUBRE, AGOSTO, { year: 2025, month: 12 }, { year: 2000, month: 1 }]) {
        const filtro: ViajesFiltro = { mes, vista };
        const search = filtroToSearch(filtro, NOW);
        expect(readFiltro(params(search.slice(1)), NOW), search).toEqual(filtro);
      }
    }
  });

  it('el rango del mes no cambia con la pestaña (las dos listas son del mismo mes)', () => {
    expect(rangoDelFiltro({ mes: AGOSTO })).toEqual({ desde: '2026-08-01', hasta: '2026-09-01' });
    const rango = (vista: ViajesFiltro['vista']) => {
      const filtro: ViajesFiltro = { mes: AGOSTO, vista };
      return rangoDelFiltro(filtro);
    };
    expect(rango('viajes')).toEqual(rango('devoluciones'));
  });
});

describe('sanitizeVolver conserva la pestaña (viaja en el `volver` sin lógica aparte)', () => {
  it('la pestaña Devoluciones y el mes sobreviven', () => {
    expect(sanitizeVolver('?vista=devoluciones&mes=2026-08', NOW)).toBe('?vista=devoluciones&mes=2026-08');
    expect(sanitizeVolver('vista=devoluciones&mes=2026-08', NOW)).toBe('?vista=devoluciones&mes=2026-08');
    expect(sanitizeVolver('?vista=devoluciones', NOW)).toBe('?vista=devoluciones');
  });

  it('el orden de los parámetros se normaliza (siempre la pestaña primero)', () => {
    expect(sanitizeVolver('?mes=2026-08&vista=devoluciones', NOW)).toBe('?vista=devoluciones&mes=2026-08');
  });

  it('la pestaña Viajes y el mes actual no se escriben: el volver queda vacío', () => {
    expect(sanitizeVolver('?vista=viajes', NOW)).toBe('');
    expect(sanitizeVolver('?vista=viajes&mes=2026-10', NOW)).toBe('');
    expect(sanitizeVolver('?vista=viajes&mes=2026-08', NOW)).toBe('?mes=2026-08');
  });

  it('una pestaña inválida se pierde (cae en Viajes) y el mes válido se conserva', () => {
    expect(sanitizeVolver('?vista=gastos&mes=2026-08', NOW)).toBe('?mes=2026-08');
    expect(sanitizeVolver('?vista=<script>', NOW)).toBe('');
  });

  it('los parámetros ajenos se descartan y lo que no es texto da vacío', () => {
    expect(sanitizeVolver('?vista=devoluciones&evil=1&mes=2026-08', NOW)).toBe('?vista=devoluciones&mes=2026-08');
    for (const raro of [42, null, undefined, {}, [], { vista: 'devoluciones' }, '', '//evil.test', 'https://evil.test']) {
      expect(sanitizeVolver(raro, NOW), JSON.stringify(raro)).toBe('');
    }
  });
});

describe('searchEnVista: el `search` de la lista en una pestaña que fija el código', () => {
  it('pone la pestaña pedida y conserva el mes del `volver`', () => {
    expect(searchEnVista('?mes=2026-08', 'devoluciones', NOW)).toBe('?vista=devoluciones&mes=2026-08');
    expect(searchEnVista('?vista=devoluciones&mes=2026-08', 'viajes', NOW)).toBe('?mes=2026-08');
  });

  it('no se fía de la pestaña que traiga el texto: la que manda es la pedida', () => {
    expect(searchEnVista('?vista=viajes&mes=2026-08', 'devoluciones', NOW)).toBe('?vista=devoluciones&mes=2026-08');
    expect(searchEnVista('?vista=<script>', 'devoluciones', NOW)).toBe('?vista=devoluciones');
  });

  it('un volver vacío o raro usa el mes actual', () => {
    for (const raro of ['', '//evil.test', 'https://evil.test', 42, null, undefined, {}, '?mes=2999-01']) {
      expect(searchEnVista(raro, 'devoluciones', NOW), JSON.stringify(raro)).toBe('?vista=devoluciones');
    }
  });
});

describe('searchDelMesDeFecha (viaje recién guardado) siempre es la pestaña Viajes', () => {
  it('no escribe la pestaña', () => {
    expect(searchDelMesDeFecha('2026-08-15', NOW)).toBe('?mes=2026-08');
    expect(searchDelMesDeFecha('2026-10-02', NOW)).toBe('');
    expect(searchDelMesDeFecha('2026-08-15', NOW)).not.toContain('vista');
  });
});
