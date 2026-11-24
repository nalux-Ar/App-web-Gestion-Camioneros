import { describe, expect, it } from 'vitest';

import {
  emptyViajeValues,
  validateKm,
  validateViajeForm,
  valuesFromViaje,
  type ViajeEditable,
  type ViajeFormValues,
} from '@/features/viajes/viaje-form';
import { textoSeLee } from '@/lib/numbers';

// Los números del formulario de viaje con el punto de miles («45.230» km, «150.000» pesos) y lo que se precarga al editar.
// Lo que dice la línea «Se lee: …» es lo que se guarda.

const TODAY = '2026-10-02';
const ctx = { today: TODAY, clientes: [] };
const base = (over: Partial<ViajeFormValues> = {}): ViajeFormValues => ({
  ...emptyViajeValues(TODAY),
  origen: 'Rosario',
  destino: 'Córdoba',
  ...over,
});
const columnas = (v: ViajeFormValues) => {
  const r = validateViajeForm(v, ctx);
  if (!r.ok) throw new Error(`no es válido: ${JSON.stringify(r.errors)}`);
  return r.datos.columns;
};

describe('lo que cobraste (ingreso) con punto de miles', () => {
  it('«150.000» se guarda como 150000 (y «Se lee» dice lo mismo)', () => {
    expect(columnas(base({ ingreso: '150.000' })).ingreso).toBe(150000);
    expect(textoSeLee('150.000', 'dinero', { allowZero: true })).toBe('Se lee: $\xa0150.000');
  });

  it('«1.234.567» y «150.000,50» también; «0» se admite; vacío es null', () => {
    expect(columnas(base({ ingreso: '1.234.567' })).ingreso).toBe(1234567);
    expect(columnas(base({ ingreso: '150.000,50' })).ingreso).toBe(150000.5);
    expect(columnas(base({ ingreso: '0' })).ingreso).toBe(0);
    expect(columnas(base({ ingreso: '' })).ingreso).toBeNull();
  });

  it('un punto que no es de miles sigue siendo el decimal («15.5») y «0.500» sobra un decimal', () => {
    expect(columnas(base({ ingreso: '15.5' })).ingreso).toBe(15.5);
    const r = validateViajeForm(base({ ingreso: '0.500' }), ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.campos.ingreso).toBe('Usa hasta 2 decimales.');
  });

  it('texto que no es número: el mensaje del monto (el campo es opcional: vacío no da error)', () => {
    const r = validateViajeForm(base({ ingreso: 'abc' }), ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.campos.ingreso).toBe('Escribe solo números. Ej.: 12500 o 12500,50.');
  });
});

describe('los kilómetros del viaje con punto de miles', () => {
  it('modo «Recorridos»: «45.230» se guarda como 45230 km', () => {
    const r = validateKm({ kmModo: 'recorridos', kmInicial: '', kmFinal: '', kmRecorridos: '45.230' });
    expect(r).toEqual({ errors: {}, km_inicial: null, km_final: null, km_recorridos: 45230 });
    expect(textoSeLee('45.230', 'km', { allowZero: true })).toBe('Se lee: 45.230 km');
  });

  it('modo «inicial y final»: «452.310» y «453.210,5» se leen y la resta sale bien', () => {
    const r = validateKm({ kmModo: 'inicial-final', kmInicial: '452.310', kmFinal: '453.210,5', kmRecorridos: '' });
    expect(r).toEqual({ errors: {}, km_inicial: 452310, km_final: 453210.5, km_recorridos: null });
  });

  it('el final menor que el inicial se detecta con los números ya leídos («452.310» contra «45.231»)', () => {
    const r = validateKm({ kmModo: 'inicial-final', kmInicial: '452.310', kmFinal: '45.231', kmRecorridos: '' });
    expect(r.errors.kmFinal).toBe('El km final no puede ser menor que el inicial.');
  });

  it('«45.55» sobra un decimal y un texto que no es número da el mensaje de los km; «100.000.000» no entra', () => {
    const a = validateKm({ kmModo: 'recorridos', kmInicial: '', kmFinal: '', kmRecorridos: '45.55' });
    expect(a.errors.kmRecorridos).toBe('Usa hasta 1 decimal.');
    const b = validateKm({ kmModo: 'recorridos', kmInicial: '', kmFinal: '', kmRecorridos: 'x' });
    expect(b.errors.kmRecorridos).toBe('Escribe solo números. Ej.: 45230.');
    const c = validateKm({ kmModo: 'recorridos', kmInicial: '', kmFinal: '', kmRecorridos: '100.000.000' });
    expect(c.errors.kmRecorridos).toBe('El número es demasiado grande. El máximo es 99.999.999,9.');
  });
});

describe('valuesFromViaje: lo que se precarga al editar va con coma y sin miles', () => {
  const viaje = (over: Partial<ViajeEditable> = {}): ViajeEditable => ({
    fecha: '2026-10-01',
    origen: 'Rosario',
    destino: 'Córdoba',
    camion_id: null,
    km_inicial: 452310,
    km_final: 453210.5,
    km_recorridos: null,
    ingreso: 150000.5,
    observaciones: null,
    entregas: [],
    ...over,
  });

  it('km e ingreso con coma, sin puntos', () => {
    const v = valuesFromViaje(viaje(), () => 'k');
    expect(v.kmInicial).toBe('452310');
    expect(v.kmFinal).toBe('453210,5');
    expect(v.ingreso).toBe('150000,5');
    expect(`${v.kmInicial}${v.kmFinal}${v.ingreso}`).not.toContain('.');
  });

  it('lo precargado vuelve a leerse igual (editar y guardar sin tocar no cambia nada)', () => {
    const v = valuesFromViaje(viaje(), () => 'k');
    expect(columnas({ ...v, kmModo: 'inicial-final' })).toMatchObject({ km_inicial: 452310, km_final: 453210.5, ingreso: 150000.5 });
  });
});
