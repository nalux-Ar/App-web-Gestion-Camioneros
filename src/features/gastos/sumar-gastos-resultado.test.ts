import { describe, expect, it } from 'vitest';

import type { Categoria } from './categorias';
import type { GastoDeFila } from './gastos-api';
import type { ResultadoDeGasto } from './sumar-gastos';
import { armarResultado } from './sumar-gastos-resultado';

// Lo que muestra el aviso del resultado de un «Sumar»: los números y, de lo que no se pudo sumar, una línea por gasto.

const A = 'e1000000-0000-4000-8000-00000000000a';
const B = 'e1000000-0000-4000-8000-00000000000b';
const C = 'e1000000-0000-4000-8000-00000000000c';
const D = 'e1000000-0000-4000-8000-00000000000d';
const E = 'e1000000-0000-4000-8000-00000000000e';
const PEAJES = 'a1000000-0000-4000-8000-000000000001';
const LAVADO = 'a1000000-0000-4000-8000-000000000002';

const CATEGORIAS = new Map<string, Categoria>([
  [PEAJES, { id: PEAJES, nombre: 'Peajes', activa: true, transportista_id: null }],
  [LAVADO, { id: LAVADO, nombre: 'Lavado', activa: false, transportista_id: 'tenant-a' }],
]);

const gasto = (id: string, categoria: string, fecha: string): GastoDeFila => ({
  id,
  categoria_id: categoria,
  fecha,
  monto: 100,
  descripcion: null,
  litros: null,
  camion_id: null,
  created_at: '2026-11-01T10:00:00+00:00',
});

const ENVIADOS = [gasto(A, PEAJES, '2026-06-15'), gasto(B, PEAJES, '2026-06-14'), gasto(C, LAVADO, '2026-06-10'), gasto(D, 'a1000000-0000-4000-8000-0000000000ff', '2026-06-09')];

describe('armarResultado', () => {
  it('cuenta lo sumado, lo que ya estaba y lo que no se pudo sumar', () => {
    const resultados: ResultadoDeGasto[] = [
      { gastoId: A, resultado: 'vinculado' },
      { gastoId: B, resultado: 'vinculado' },
      { gastoId: C, resultado: 'ya_estaba' },
      { gastoId: D, resultado: 'en_otro_viaje' },
    ];
    const r = armarResultado(resultados, ENVIADOS, CATEGORIAS);
    expect(r.sumados).toBe(2);
    expect(r.yaEstaban).toBe(1);
    expect(r.noSumados).toHaveLength(1);
  });

  it('cada gasto no sumado sale como «Categoría · fecha con año: motivo», en el orden en que se mandaron', () => {
    const resultados: ResultadoDeGasto[] = [
      { gastoId: B, resultado: 'camion_distinto' },
      { gastoId: A, resultado: 'en_otro_viaje' },
      { gastoId: C, resultado: 'no_encontrado' },
      { gastoId: D, resultado: 'no_se_pudo' },
    ];
    const { noSumados } = armarResultado(resultados, ENVIADOS, CATEGORIAS);
    expect(noSumados).toEqual([
      { gastoId: B, texto: 'Peajes · 14 jun 2026: Es de otro camión.' },
      { gastoId: A, texto: 'Peajes · 15 jun 2026: Ya está en otro viaje.' },
      { gastoId: C, texto: 'Lavado (inactiva) · 10 jun 2026: Ya no está disponible.' },
      { gastoId: D, texto: 'Gasto · 9 jun 2026: No se pudo sumar. Inténtalo de nuevo.' }, // categoría que no se conoce: nombre genérico
    ]);
  });

  it('un resultado que no es ni «vinculado» ni «ya_estaba» NUNCA cuenta como sumado', () => {
    const r = armarResultado(
      [
        { gastoId: A, resultado: 'no_se_pudo' },
        { gastoId: B, resultado: 'no_encontrado' },
        { gastoId: C, resultado: 'camion_distinto' },
        { gastoId: D, resultado: 'en_otro_viaje' },
      ],
      ENVIADOS,
      CATEGORIAS,
    );
    expect(r.sumados).toBe(0);
    expect(r.yaEstaban).toBe(0);
    expect(r.noSumados).toHaveLength(4);
  });

  it('un gasto que no está entre los enviados (no debería pasar) sale con el nombre genérico y sin fecha, sin romper', () => {
    const r = armarResultado([{ gastoId: E, resultado: 'no_encontrado' }], ENVIADOS, CATEGORIAS);
    expect(r.noSumados).toEqual([{ gastoId: E, texto: 'Gasto: Ya no está disponible.' }]);
  });

  it('con una fecha rara en un gasto (`infinity`, año de cinco cifras) no rompe: la muestra tal cual', () => {
    const raros = [gasto(A, PEAJES, 'infinity'), gasto(B, PEAJES, '10000-01-01')];
    const r = armarResultado(
      [
        { gastoId: A, resultado: 'en_otro_viaje' },
        { gastoId: B, resultado: 'en_otro_viaje' },
      ],
      raros,
      CATEGORIAS,
    );
    expect(r.noSumados.map((n) => n.texto)).toEqual(['Peajes · infinity: Ya está en otro viaje.', 'Peajes · 10000-01-01: Ya está en otro viaje.']);
  });

  it('sin resultados: todo en cero, y no cambia lo que recibe', () => {
    const enviados = Object.freeze([...ENVIADOS]);
    expect(armarResultado([], enviados, CATEGORIAS)).toEqual({ sumados: 0, yaEstaban: 0, noSumados: [] });
  });
});
