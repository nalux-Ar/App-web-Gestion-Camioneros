import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));

import {
  GUARDAR_NOMBRE_CONTEXT,
  MAX_NOMBRE,
  NOMBRE_INVALIDO_MESSAGE,
  NOMBRE_NO_EDITABLE_MESSAGE,
  validateNombre,
} from '@/features/configuracion/nombre';
import { NombreNoEditableError } from '@/features/configuracion/nombre-api';
import { classifyDataError, isRetryableDataError, mapDataError, RecordNotFoundError } from '@/lib/data-errors';

describe('validateNombre (lógica pura)', () => {
  it('constante del tope = 200 y mensaje igual al del onboarding', () => {
    expect(MAX_NOMBRE).toBe(200);
    expect(NOMBRE_INVALIDO_MESSAGE).toBe('Escribe un nombre entre 1 y 200 caracteres.');
  });

  it('vacío -> inválido', () => {
    expect(validateNombre('')).toEqual({ ok: false, message: NOMBRE_INVALIDO_MESSAGE });
  });

  it('solo espacios / tabs / NBSP / saltos -> inválido', () => {
    for (const raw of ['   ', '\t', '  ', ' \n ', ' ']) {
      expect(validateNombre(raw)).toEqual({ ok: false, message: NOMBRE_INVALIDO_MESSAGE });
    }
  });

  it('1 carácter -> válido', () => {
    expect(validateNombre('A')).toEqual({ ok: true, value: 'A' });
  });

  it('recorta los costados y conserva el interior', () => {
    expect(validateNombre('  Transportes  Pérez SRL \n')).toEqual({ ok: true, value: 'Transportes  Pérez SRL' });
  });

  it('200 exactos -> válido; 201 -> inválido', () => {
    expect(validateNombre('a'.repeat(200))).toEqual({ ok: true, value: 'a'.repeat(200) });
    expect(validateNombre('a'.repeat(201))).toEqual({ ok: false, message: NOMBRE_INVALIDO_MESSAGE });
  });

  it('el espacio de los costados no cuenta para el tope', () => {
    expect(validateNombre(`  ${'a'.repeat(200)}  `).ok).toBe(true);
    expect(validateNombre(`  ${'a'.repeat(201)}  `).ok).toBe(false);
  });

  it('emojis cuentan como 1 code point (no 2 unidades UTF-16)', () => {
    expect(validateNombre('😀'.repeat(100)).ok).toBe(true);
    // 200 emojis = 400 unidades UTF-16 pero 200 caracteres: válido (como length() de Postgres).
    expect(validateNombre('😀'.repeat(200)).ok).toBe(true);
    expect(validateNombre('😀'.repeat(201)).ok).toBe(false);
    // 199 'a' + 1 emoji = 200 code points (201 unidades UTF-16): válido.
    expect(validateNombre(`${'a'.repeat(199)}😀`).ok).toBe(true);
    expect(validateNombre(`${'a'.repeat(200)}😀`).ok).toBe(false);
  });

  it('texto pegado gigante -> inválido SIN recorrer con Array.from y rápido', () => {
    const giant = 'a'.repeat(5_000_000);
    const spy = vi.spyOn(Array, 'from');
    const t0 = performance.now();
    const result = validateNombre(giant);
    const ms = performance.now() - t0;
    expect(result).toEqual({ ok: false, message: NOMBRE_INVALIDO_MESSAGE });
    expect(spy).not.toHaveBeenCalled();
    expect(ms).toBeLessThan(250);
    // Justo sobre 2 x tope (401 unidades): ya es inválido sin Array.from.
    spy.mockClear();
    expect(validateNombre('a'.repeat(401)).ok).toBe(false);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('un nombre válido con muchísimo espacio alrededor NO se rechaza por el atajo', () => {
    const padded = `${' '.repeat(5000)}Juan Pérez${' '.repeat(5000)}`;
    expect(validateNombre(padded)).toEqual({ ok: true, value: 'Juan Pérez' });
  });

  it('el atajo de 2 x tope nunca rechaza algo válido (fuzz contra el conteo por code points)', () => {
    const alphabet = ['a', 'Z', 'ñ', ' ', ' ', '😀', '🚚', '👨‍👩‍👧', 'é', '\t', '汉'];
    let seed = 12345;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    for (let i = 0; i < 3000; i++) {
      const n = Math.floor(rnd() * 520);
      let raw = '';
      for (let j = 0; j < n; j++) raw += alphabet[Math.floor(rnd() * alphabet.length)];
      const trimmed = raw.trim();
      const expectedLen = Array.from(trimmed).length;
      const expectedOk = expectedLen >= 1 && expectedLen <= 200;
      const result = validateNombre(raw);
      expect(result.ok).toBe(expectedOk);
      if (result.ok) expect(result.value).toBe(trimmed);
    }
  });
});

describe('NombreNoEditableError + mensajes de error', () => {
  it('es un error tipado, NO un error de red, y no es reintentable', () => {
    const e = new NombreNoEditableError();
    expect(e).toBeInstanceOf(NombreNoEditableError);
    expect(e).toBeInstanceOf(RecordNotFoundError);
    expect(e.name).toBe('NombreNoEditableError');
    expect(classifyDataError(e)).toBe('not-found');
    expect(isRetryableDataError(e)).toBe(false);
    expect(mapDataError(e, GUARDAR_NOMBRE_CONTEXT)).toBe(
      'No pudimos cambiar el nombre. Solo el administrador de la cuenta puede hacerlo.',
    );
    expect(NOMBRE_NO_EDITABLE_MESSAGE).toBe(mapDataError(e, GUARDAR_NOMBRE_CONTEXT));
  });

  it('el resto pasa por mapDataError (nunca texto crudo del servidor)', () => {
    const raw = { message: 'new row for relation "transportistas" violates check constraint "x"', code: '23514' };
    expect(mapDataError(raw, GUARDAR_NOMBRE_CONTEXT)).toBe(NOMBRE_INVALIDO_MESSAGE);
    expect(mapDataError({ message: 'permission denied for table transportistas', code: '42501' }, GUARDAR_NOMBRE_CONTEXT)).toBe(
      NOMBRE_NO_EDITABLE_MESSAGE,
    );
    expect(mapDataError({ message: 'TypeError: Failed to fetch', code: '' }, GUARDAR_NOMBRE_CONTEXT)).toBe(
      'No hay conexión. Revisa la señal y prueba de nuevo.',
    );
  });
});
