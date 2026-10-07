import { describe, expect, it } from 'vitest';

import { buscarCamion, descripcionCamion, etiquetaCamion, ordenarCamiones, type CamionDeLista } from '@/features/camiones/camion';

const camion = (over: Partial<CamionDeLista> = {}): CamionDeLista => ({
  id: 'c1',
  patente: 'AB123CD',
  marca: null,
  modelo: null,
  anio: null,
  activa: true,
  ...over,
});

describe('descripcionCamion', () => {
  it('marca, modelo y año, solo lo que haya', () => {
    expect(descripcionCamion(camion({ marca: 'Scania', modelo: 'R450', anio: 2019 }))).toBe('Scania R450 · 2019');
    expect(descripcionCamion(camion({ marca: 'Scania' }))).toBe('Scania');
    expect(descripcionCamion(camion({ anio: 2019 }))).toBe('2019');
    expect(descripcionCamion(camion({ modelo: 'R450', anio: 2019 }))).toBe('R450 · 2019');
  });

  it('sin nada: null (y un texto de solo espacios no cuenta)', () => {
    expect(descripcionCamion(camion())).toBeNull();
    expect(descripcionCamion(camion({ marca: '   ' }))).toBeNull();
  });
});

describe('etiquetaCamion', () => {
  it('la patente con espacios; con la descripción si se pide', () => {
    expect(etiquetaCamion(camion())).toBe('AB 123 CD');
    expect(etiquetaCamion(camion({ marca: 'Scania', anio: 2019 }), { conDescripcion: true })).toBe('AB 123 CD · Scania · 2019');
    expect(etiquetaCamion(camion({ marca: 'Scania' }))).toBe('AB 123 CD'); // sin descripción por defecto
  });

  it('archivado: lo dice', () => {
    expect(etiquetaCamion(camion({ activa: false }))).toBe('AB 123 CD (archivado)');
    expect(etiquetaCamion(camion({ activa: false, marca: 'Fiat' }), { conDescripcion: true })).toBe('AB 123 CD · Fiat (archivado)');
  });

  it('un camión que no está (o sin patente): "Camión no disponible"', () => {
    expect(etiquetaCamion(null)).toBe('Camión no disponible');
    expect(etiquetaCamion(undefined)).toBe('Camión no disponible');
    expect(etiquetaCamion(camion({ patente: '' }))).toBe('Camión no disponible');
  });
});

describe('ordenarCamiones y buscarCamion', () => {
  it('ordena por patente (y por id a igualdad), sin tocar la lista original', () => {
    const lista = [camion({ id: '3', patente: 'ZZ999ZZ' }), camion({ id: '2', patente: 'AA111AA' }), camion({ id: '1', patente: 'AA111AA' })];
    expect(ordenarCamiones(lista).map((c) => c.id)).toEqual(['1', '2', '3']);
    expect(lista.map((c) => c.id)).toEqual(['3', '2', '1']);
  });

  it('busca por id; sin id o sin coincidencia, null', () => {
    const lista = [camion({ id: 'a' }), camion({ id: 'b' })];
    expect(buscarCamion(lista, 'b')?.id).toBe('b');
    expect(buscarCamion(lista, 'x')).toBeNull();
    expect(buscarCamion(lista, null)).toBeNull();
    expect(buscarCamion(lista, '')).toBeNull();
  });
});
