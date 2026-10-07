import { describe, expect, it } from 'vitest';

import {
  MAX_PATENTE,
  PATENTE_LARGA_MESSAGE,
  PATENTE_VACIA_MESSAGE,
  esPatenteArgentina,
  formatearPatente,
  normalizarPatente,
  validarPatente,
} from '@/features/camiones/patente';

describe('normalizarPatente (espejo exacto de la base: quita todo lo que no sea A-Z/0-9 ASCII y pasa a mayúsculas)', () => {
  it.each([
    ['ab 123 cd', 'AB123CD'],
    ['AB-123-CD', 'AB123CD'],
    ['ab.123.cd', 'AB123CD'],
    ['  abc 123  ', 'ABC123'],
    ['Ab\t123\ncd', 'AB123CD'],
    ['AB_123/CD', 'AB123CD'],
    ['AB123CD', 'AB123CD'],
  ])('%j -> %j', (entrada, salida) => {
    expect(normalizarPatente(entrada)).toBe(salida);
  });

  it('lo que no es ASCII se QUITA antes de pasar a mayúsculas (como la base): ni la ñ ni la ß ni dígitos de otros alfabetos quedan', () => {
    expect(normalizarPatente('ñab123')).toBe('AB123'); // no "ÑAB123"
    expect(normalizarPatente('aß123')).toBe('A123'); // no "ASS123"
    expect(normalizarPatente('ab１２３cd')).toBe('ABCD'); // dígitos de ancho completo
    expect(normalizarPatente('áb123')).toBe('B123');
  });

  it('lo que no es texto da vacío', () => {
    for (const raro of [null, undefined, 123, {}, ['AB123CD']]) expect(normalizarPatente(raro), JSON.stringify(raro)).toBe('');
  });

  it('el resultado siempre cumple el check de la base (solo A-Z y 0-9)', () => {
    for (const entrada of ['ab 123 cd', '<script>', 'AB-12.3/CD', '🚚AB123CD', "AB'123"]) {
      expect(normalizarPatente(entrada)).toMatch(/^[A-Z0-9]*$/);
    }
  });
});

describe('validarPatente', () => {
  it('normaliza y acepta de 1 a 20 caracteres', () => {
    expect(validarPatente(' ab 123 cd ')).toEqual({ ok: true, value: 'AB123CD' });
    expect(validarPatente('A')).toEqual({ ok: true, value: 'A' });
    expect(validarPatente('A'.repeat(MAX_PATENTE))).toEqual({ ok: true, value: 'A'.repeat(20) });
  });

  it('vacía (o que queda vacía al normalizar): "Escribe la patente."', () => {
    for (const raro of ['', '   ', '---', '..', 'ñ', '🚚']) {
      expect(validarPatente(raro), JSON.stringify(raro)).toEqual({ ok: false, message: PATENTE_VACIA_MESSAGE });
    }
  });

  it('de más de 20 (contada ya normalizada): error de largo', () => {
    expect(validarPatente('A'.repeat(21))).toEqual({ ok: false, message: PATENTE_LARGA_MESSAGE });
    // Con separadores entra: lo que cuenta es lo que se guarda.
    expect(validarPatente('AB-123-CD-'.repeat(2)).ok).toBe(true);
  });
});

describe('esPatenteArgentina (solo para AVISAR, no bloquea)', () => {
  it('AB123CD (Mercosur) y ABC123 (anterior) sí', () => {
    expect(esPatenteArgentina('AB123CD')).toBe(true);
    expect(esPatenteArgentina('ABC123')).toBe(true);
  });

  it('cualquier otra forma, no', () => {
    for (const otra of ['AB123C', 'A123BC', 'ABCD123', 'AB1234CD', '123ABC', 'AB12CD', 'ABC12', '', 'ab123cd']) {
      expect(esPatenteArgentina(otra), otra).toBe(false);
    }
  });
});

describe('formatearPatente (solo para mostrar)', () => {
  it('separa los bloques de los formatos argentinos', () => {
    expect(formatearPatente('AB123CD')).toBe('AB 123 CD');
    expect(formatearPatente('ABC123')).toBe('ABC 123');
  });

  it('cualquier otra queda tal cual', () => {
    expect(formatearPatente('ABCD1234')).toBe('ABCD1234');
    expect(formatearPatente('X1')).toBe('X1');
    expect(formatearPatente('')).toBe('');
  });
});
