import { describe, expect, it } from 'vitest';

import {
  CAMION_FIELD_ORDER,
  MARCA_LARGA_MESSAGE,
  MODELO_LARGO_MESSAGE,
  anioInvalidoMessage,
  avisoFormatoPatente,
  emptyCamionValues,
  maxAnio,
  validateCamionForm,
  valuesFromCamion,
} from '@/features/camiones/camion-form';
import { PATENTE_VACIA_MESSAGE } from '@/features/camiones/patente';

const HOY = new Date(2026, 9, 6); // 6 de octubre de 2026
const valores = (over: Partial<ReturnType<typeof emptyCamionValues>> = {}) => ({ ...emptyCamionValues(), patente: 'AB123CD', ...over });

describe('valores del formulario de camión', () => {
  it('uno nuevo arranca vacío; los campos van en el orden de la pantalla', () => {
    expect(emptyCamionValues()).toEqual({ patente: '', marca: '', modelo: '', anio: '' });
    expect(CAMION_FIELD_ORDER).toEqual(['patente', 'marca', 'modelo', 'anio']);
  });

  it('al editar, los datos guardados pasan a texto (null = vacío)', () => {
    expect(valuesFromCamion({ patente: 'AB123CD', marca: 'Scania', modelo: null, anio: 2019 })).toEqual({
      patente: 'AB123CD',
      marca: 'Scania',
      modelo: '',
      anio: '2019',
    });
    expect(valuesFromCamion({ patente: 'ABC123', marca: null, modelo: 'R450', anio: null }).anio).toBe('');
  });
});

describe('validateCamionForm', () => {
  it('solo la patente: las cuatro columnas explícitas, la patente NORMALIZADA y null lo vacío', () => {
    expect(validateCamionForm(valores({ patente: ' ab-123 cd ' }), HOY)).toEqual({
      ok: true,
      columns: { patente: 'AB123CD', marca: null, modelo: null, anio: null },
    });
  });

  it('todo cargado: marca y modelo recortados, año como número', () => {
    expect(validateCamionForm(valores({ marca: '  Scania ', modelo: ' R450  ', anio: ' 2019 ' }), HOY)).toEqual({
      ok: true,
      columns: { patente: 'AB123CD', marca: 'Scania', modelo: 'R450', anio: 2019 },
    });
  });

  it('una patente sin formato argentino se acepta (solo se avisa)', () => {
    expect(validateCamionForm(valores({ patente: 'xyz9999' }), HOY)).toMatchObject({ ok: true, columns: { patente: 'XYZ9999' } });
  });

  it('patente vacía: error y foco en la patente', () => {
    const r = validateCamionForm(valores({ patente: ' - ' }), HOY);
    expect(r).toEqual({ ok: false, errors: { patente: PATENTE_VACIA_MESSAGE }, firstField: 'patente' });
  });

  it('marca y modelo de hasta 100 caracteres', () => {
    expect(validateCamionForm(valores({ marca: 'a'.repeat(100), modelo: 'b'.repeat(100) }), HOY).ok).toBe(true);
    const r = validateCamionForm(valores({ marca: 'a'.repeat(101), modelo: 'b'.repeat(101) }), HOY);
    expect(r).toMatchObject({ ok: false, errors: { marca: MARCA_LARGA_MESSAGE, modelo: MODELO_LARGO_MESSAGE }, firstField: 'marca' });
  });

  it(`año: de 1950 al año que viene (${maxAnio(HOY)}); fuera de eso, error`, () => {
    expect(maxAnio(HOY)).toBe(2027);
    for (const anio of ['1950', '2000', '2026', '2027']) {
      expect(validateCamionForm(valores({ anio }), HOY).ok, anio).toBe(true);
    }
    for (const anio of ['1949', '2028', '20', '2019.5', '2o19', '-2019', '19 50', '12345', 'dos mil']) {
      const r = validateCamionForm(valores({ anio }), HOY);
      expect(r, anio).toMatchObject({ ok: false, errors: { anio: anioInvalidoMessage(HOY) }, firstField: 'anio' });
    }
    expect(anioInvalidoMessage(HOY)).toBe('Escribe un año entre 1950 y 2027, o déjalo vacío.');
  });

  it('con varios errores marca todos y el foco va al PRIMERO en el orden de la pantalla', () => {
    const r = validateCamionForm({ patente: '', marca: 'a'.repeat(101), modelo: '', anio: '1900' }, HOY);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(Object.keys(r.errors).sort()).toEqual(['anio', 'marca', 'patente']);
      expect(r.firstField).toBe('patente');
    }
  });
});

describe('avisoFormatoPatente (no bloqueante)', () => {
  it('avisa solo si lo tipeado, ya normalizado, no tiene formato argentino', () => {
    expect(avisoFormatoPatente('ab 123 cd')).toBe(false);
    expect(avisoFormatoPatente('ABC-123')).toBe(false);
    expect(avisoFormatoPatente('AB12CD')).toBe(true);
    expect(avisoFormatoPatente('XYZ9999')).toBe(true);
  });

  it('sin nada tipeado no avisa', () => {
    expect(avisoFormatoPatente('')).toBe(false);
    expect(avisoFormatoPatente('  - ')).toBe(false);
  });
});
