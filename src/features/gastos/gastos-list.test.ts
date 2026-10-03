import { describe, expect, it } from 'vitest';

import { acotarLista, sumMontos } from '@/features/gastos/gastos-list';

describe('sumMontos: el total (de un mes o de un viaje) se suma en centavos enteros', () => {
  it('0,1 + 0,2 da 0,3 (en coma flotante da 0,30000000000000004)', () => {
    expect(0.1 + 0.2).not.toBe(0.3); // el problema que se evita
    expect(sumMontos([{ monto: 0.1 }, { monto: 0.2 }])).toBe(0.3);
  });

  it('muchos montos con decimales no acumulan error: 100 × 0,1 = 10', () => {
    expect(sumMontos(Array.from({ length: 100 }, () => ({ monto: 0.1 })))).toBe(10);
    expect(sumMontos(Array.from({ length: 3 }, () => ({ monto: 1000.1 })))).toBe(3000.3);
  });

  it('acepta montos como texto (PostgREST puede devolver numeric como string) y números', () => {
    expect(sumMontos([{ monto: '1234.56' }, { monto: 0.44 }, { monto: '10' }])).toBe(1245);
  });

  it('un monto ilegible no suma ni rompe', () => {
    expect(sumMontos([{ monto: 'abc' }, { monto: '' }, { monto: 5.25 }])).toBe(5.25);
  });

  it('sin gastos el total es 0', () => {
    expect(sumMontos([])).toBe(0);
  });

  it('el total de un viaje: tres gastos con centavos', () => {
    expect(sumMontos([{ monto: 15300.75 }, { monto: 2400.1 }, { monto: 99.15 }])).toBe(17800);
  });
});

describe('acotarLista: se piden 501 y se muestran 500', () => {
  const filas = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i }));

  it('501 filas: se muestran 500 y se marca como truncada (el total solo suma esas)', () => {
    const r = acotarLista(filas(501));
    expect(r.items).toHaveLength(500);
    expect(r.truncado).toBe(true);
    expect(r.items[499]).toEqual({ id: 499 });
  });

  it('500 o menos: sin aviso', () => {
    expect(acotarLista(filas(500))).toMatchObject({ truncado: false });
    expect(acotarLista(filas(500)).items).toHaveLength(500);
    expect(acotarLista(filas(0))).toEqual({ items: [], truncado: false });
  });
});
