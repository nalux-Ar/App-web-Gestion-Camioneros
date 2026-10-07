import { describe, expect, it } from 'vitest';

import { acotarLista } from '@/lib/lista-acotada';
import { fromScaledInt, toScaledInt } from '@/lib/numbers';
import { LIST_LIMIT } from '@/features/viajes/constants';
import {
  aViajeDeLista,
  contarEntregas,
  kmDelViaje,
  kmEnDecimas,
  totalesDelMes,
  type FilaViajeDeLista,
  type ViajeDeLista,
} from '@/features/viajes/viajes-list';
import {
  filtroToParams,
  filtroToSearch,
  rangoDelFiltro,
  readFiltro,
  sanitizeVolver,
  searchDelMesDeFecha,
} from '@/features/viajes/viajes-filters';

const viaje = (over: Partial<ViajeDeLista> = {}): ViajeDeLista => ({
  id: 'v1',
  fecha: '2026-10-01',
  origen: 'A',
  destino: 'B',
  camion_id: null,
  km_inicial: null,
  km_final: null,
  km_recorridos: null,
  ingreso: null,
  created_at: '2026-10-01T10:00:00Z',
  cantidad_entregas: 0,
  ...over,
});

describe('kmDelViaje / kmEnDecimas', () => {
  it('con km_recorridos: ese valor', () => {
    expect(kmDelViaje(viaje({ km_recorridos: 640.5 }))).toEqual({ tipo: 'km', km: 640.5 });
    expect(kmDelViaje(viaje({ km_recorridos: 0 }))).toEqual({ tipo: 'km', km: 0 });
  });

  it('con inicial y final: la resta (sin ruido de coma flotante)', () => {
    expect(kmDelViaje(viaje({ km_inicial: 1200, km_final: 1850.5 }))).toEqual({ tipo: 'km', km: 650.5 });
    expect(kmDelViaje(viaje({ km_inicial: 0.1, km_final: 0.3 }))).toEqual({ tipo: 'km', km: 0.2 }); // 0,3 - 0,1 = 0,19999999999999998 en floats
    expect(kmDelViaje(viaje({ km_inicial: 1200, km_final: 1200 }))).toEqual({ tipo: 'km', km: 0 });
  });

  it('solo el inicial (viaje en curso) -> "Km final sin cargar"', () => {
    expect(kmDelViaje(viaje({ km_inicial: 300 }))).toEqual({ tipo: 'sin-final' });
    expect(kmDelViaje(viaje({ km_inicial: 0 }))).toEqual({ tipo: 'sin-final' }); // 0 es un valor cargado
  });

  it('sin km -> nada', () => {
    expect(kmDelViaje(viaje())).toEqual({ tipo: 'sin-km' });
  });

  it('recorridos gana si (caso imposible en la base) vinieran los dos modos', () => {
    expect(kmEnDecimas(viaje({ km_recorridos: 5, km_inicial: 1, km_final: 100 }))).toBe(50);
  });
});

describe('totalesDelMes: sumas en enteros (décimas de km y centavos)', () => {
  it('sin viajes: 0 viajes, km e ingreso null', () => {
    expect(totalesDelMes([])).toEqual({ viajes: 0, km: null, ingreso: null });
  });

  it('suma km (recorridos + diferencias) e ingresos', () => {
    const t = totalesDelMes([
      viaje({ km_recorridos: 500, ingreso: 1000 }),
      viaje({ km_inicial: 1000, km_final: 1250.5, ingreso: 2500.25 }),
      viaje({ km_inicial: 300 }), // en curso: no suma km
    ]);
    expect(t).toEqual({ viajes: 3, km: 750.5, ingreso: 3500.25 });
  });

  it('0,1 + 0,2 da EXACTAMENTE 0,3 (en floats daría 0,30000000000000004), en km y en ingresos', () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    const t = totalesDelMes([viaje({ km_recorridos: 0.1, ingreso: 0.1 }), viaje({ km_recorridos: 0.2, ingreso: 0.2 })]);
    expect(t.km).toBe(0.3);
    expect(t.ingreso).toBe(0.3);
  });

  it('muchos decimales acumulados no se desvían (500 viajes de 0,1 km y 0,01 de ingreso)', () => {
    const muchos = Array.from({ length: 500 }, () => viaje({ km_recorridos: 0.1, ingreso: 0.01 }));
    const t = totalesDelMes(muchos);
    expect(t.km).toBe(50);
    expect(t.ingreso).toBe(5);
  });

  it('un viaje sin ingreso no suma, pero ingreso 0 sí cuenta como cargado (total 0, no vacío)', () => {
    expect(totalesDelMes([viaje(), viaje()]).ingreso).toBeNull();
    expect(totalesDelMes([viaje({ ingreso: 0 }), viaje()]).ingreso).toBe(0);
  });

  it('sin ningún km calculable el total de km es null (no 0); con recorridos 0 es 0', () => {
    expect(totalesDelMes([viaje({ km_inicial: 5 }), viaje()]).km).toBeNull();
    expect(totalesDelMes([viaje({ km_recorridos: 0 })]).km).toBe(0);
  });

  it('valores grandes: el máximo de cada columna sigue siendo un entero seguro al sumar 500', () => {
    const grande = viaje({ km_recorridos: 9999999.9, ingreso: 9999999999.99 });
    const t = totalesDelMes(Array.from({ length: 500 }, () => grande));
    expect(Number.isSafeInteger(toScaledInt(9999999999.99, 'dinero') * 500)).toBe(true);
    expect(t.km).toBe(fromScaledInt(99999999 * 500, 'km'));
    expect(t.ingreso).toBe(fromScaledInt(999999999999 * 500, 'dinero'));
  });
});

describe('escalas enteras de numbers.ts', () => {
  it('toScaledInt / fromScaledInt: km en décimas, dinero en centavos, litros en mililitros', () => {
    expect(toScaledInt(1.1, 'km')).toBe(11); // 1,1 × 10 = 11.000000000000002 en floats
    expect(toScaledInt(0.29, 'dinero')).toBe(29); // 0,29 × 100 = 28.999999999999996 en floats
    expect(toScaledInt(1.005, 'litros')).toBe(1005);
    expect(fromScaledInt(12345, 'dinero')).toBe(123.45);
    expect(fromScaledInt(0, 'km')).toBe(0);
    expect(Object.is(fromScaledInt(-0, 'km'), 0)).toBe(true); // nunca -0
  });
});

describe('contarEntregas / aViajeDeLista (embed entregas(count))', () => {
  it('lee [{ count: n }]; cero entregas = [{ count: 0 }]', () => {
    expect(contarEntregas([{ count: 3 }])).toBe(3);
    expect(contarEntregas([{ count: 0 }])).toBe(0);
    expect(contarEntregas([{ count: '4' }])).toBe(4);
  });

  it('cualquier forma inesperada cuenta como 0 en vez de romper la lista', () => {
    for (const raro of [[], undefined, null, [{ count: 'x' }], [{ count: -2 }], [{ count: 1.5 }]]) {
      expect(contarEntregas(raro as never)).toBe(0);
    }
  });

  it('convierte los numéricos (que PostgREST puede mandar como texto) y cuenta las entregas', () => {
    const fila: FilaViajeDeLista = {
      id: 'v9',
      fecha: '2026-10-02',
      origen: 'Rosario',
      destino: 'Córdoba',
      km_inicial: '1200.5',
      km_final: 1850,
      km_recorridos: null,
      ingreso: '2500.25',
      created_at: '2026-10-02T09:00:00Z',
      entregas: [{ count: 2 }],
    };
    expect(aViajeDeLista(fila)).toEqual({
      id: 'v9',
      fecha: '2026-10-02',
      origen: 'Rosario',
      destino: 'Córdoba',
      camion_id: null, // la fila no lo trajo: queda null (sin camión)
      km_inicial: 1200.5,
      km_final: 1850,
      km_recorridos: null,
      ingreso: 2500.25,
      created_at: '2026-10-02T09:00:00Z',
      cantidad_entregas: 2,
    });
  });
});

describe('tope de la lista (501 pedidas, 500 mostradas)', () => {
  it('el tope es 500', () => {
    expect(LIST_LIMIT).toBe(500);
  });

  it('501 filas -> se muestran 500 y se marca truncado; 500 o menos -> completo', () => {
    const filas = Array.from({ length: 501 }, (_, i) => i);
    const r = acotarLista(filas, LIST_LIMIT);
    expect(r.items).toHaveLength(500);
    expect(r.items[499]).toBe(499);
    expect(r.truncado).toBe(true);
    expect(acotarLista(filas.slice(0, 500), LIST_LIMIT)).toEqual({ items: filas.slice(0, 500), truncado: false });
    expect(acotarLista([], LIST_LIMIT)).toEqual({ items: [], truncado: false });
  });
});

describe('filtro por mes en la URL', () => {
  const NOW = new Date(2026, 9, 2, 22, 30); // 2 de octubre de 2026, de noche (hora local)

  it('sin parámetro o inválido -> el mes actual', () => {
    for (const mes of [null, '', 'abc', '2026-13', '2026-00', '2026-9', '26-10', '2026-10-01', '2026-10 ', 'x2026-10']) {
      const params = new URLSearchParams(mes === null ? '' : `mes=${encodeURIComponent(mes)}`);
      expect(readFiltro(params, NOW).mes, String(mes)).toEqual({ year: 2026, month: 10 });
    }
  });

  it('un mes futuro o anterior al 2000 se ignora', () => {
    expect(readFiltro(new URLSearchParams('mes=2026-11'), NOW).mes).toEqual({ year: 2026, month: 10 });
    expect(readFiltro(new URLSearchParams('mes=2027-01'), NOW).mes).toEqual({ year: 2026, month: 10 });
    expect(readFiltro(new URLSearchParams('mes=1999-12'), NOW).mes).toEqual({ year: 2026, month: 10 });
    expect(readFiltro(new URLSearchParams('mes=2000-01'), NOW).mes).toEqual({ year: 2000, month: 1 });
  });

  it('un mes válido pasado se respeta', () => {
    expect(readFiltro(new URLSearchParams('mes=2026-08'), NOW).mes).toEqual({ year: 2026, month: 8 });
  });

  it('el mes actual no se escribe en la URL; los demás sí (YYYY-MM)', () => {
    expect(filtroToParams({ mes: { year: 2026, month: 10 }, vista: 'viajes' }, NOW).toString()).toBe('');
    expect(filtroToSearch({ mes: { year: 2026, month: 10 }, vista: 'viajes' }, NOW)).toBe('');
    expect(filtroToSearch({ mes: { year: 2026, month: 8 }, vista: 'viajes' }, NOW)).toBe('?mes=2026-08');
    expect(filtroToSearch({ mes: { year: 2025, month: 12 }, vista: 'viajes' }, NOW)).toBe('?mes=2025-12');
  });

  it('volver: solo acepta lo que la propia pantalla podría haber escrito; todo lo demás se descarta', () => {
    expect(sanitizeVolver('?mes=2026-08', NOW)).toBe('?mes=2026-08');
    expect(sanitizeVolver('mes=2026-08', NOW)).toBe('?mes=2026-08');
    expect(sanitizeVolver('?mes=2026-10', NOW)).toBe(''); // el mes actual no se escribe
    expect(sanitizeVolver('?mes=2026-08&evil=1', NOW)).toBe('?mes=2026-08'); // parámetros ajenos se pierden
    for (const raro of ['https://evil.test', '//evil.test', '?mes=<script>', 42, null, undefined, {}, '?mes=2999-01']) {
      expect(sanitizeVolver(raro, NOW), String(raro)).toBe('');
    }
  });

  it('el mes de una fecha guardada (para mostrar el viaje recién cargado)', () => {
    expect(searchDelMesDeFecha('2026-08-15', NOW)).toBe('?mes=2026-08');
    expect(searchDelMesDeFecha('2026-10-02', NOW)).toBe('');
    expect(searchDelMesDeFecha('basura', NOW)).toBe('');
  });

  it('el rango del mes usa fechas locales, medio abierto, y cruza el año en diciembre', () => {
    expect(rangoDelFiltro({ mes: { year: 2026, month: 2 } })).toEqual({ desde: '2026-02-01', hasta: '2026-03-01' });
    expect(rangoDelFiltro({ mes: { year: 2026, month: 12 } })).toEqual({ desde: '2026-12-01', hasta: '2027-01-01' });
    expect(rangoDelFiltro({ mes: { year: 2024, month: 2 } })).toEqual({ desde: '2024-02-01', hasta: '2024-03-01' });
  });
});
