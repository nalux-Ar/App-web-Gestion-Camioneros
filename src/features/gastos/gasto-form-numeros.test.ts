import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Categoria } from '@/features/gastos/categorias';
import { COMBUSTIBLE_CATEGORIA_ID } from '@/features/gastos/constants';
import {
  emptyGastoValues,
  previewPrecioPorLitro,
  validateGastoForm,
  valuesFromGasto,
  type GastoEditable,
  type GastoFormValues,
} from '@/features/gastos/gasto-form';
import { textoSeLee } from '@/lib/numbers';

// Los números del formulario de gasto con el punto de miles («12.500» = 12500) en monto y kilómetros, y litros SIN ese cambio.
// Lo que dice la línea «Se lee: …» es lo que se guarda.

const TODAY = '2026-10-02';
const PEAJES = '210b4f00-fdb4-499b-bf15-79ebe2aaf3c3';
const CATS: Categoria[] = [
  { id: COMBUSTIBLE_CATEGORIA_ID, nombre: 'Combustible', activa: true, transportista_id: null },
  { id: PEAJES, nombre: 'Peajes', activa: true, transportista_id: null },
];
const CAMION = 'c0000000-0000-4000-8000-000000000001';
const ctx = { categorias: CATS, today: TODAY, viajes: [], camion: { ok: true as const, camionId: CAMION } };

afterEach(() => {
  vi.restoreAllMocks();
});

const peaje = (over: Partial<GastoFormValues> = {}): GastoFormValues => ({
  ...emptyGastoValues(TODAY),
  metodoPago: 'efectivo',
  categoriaId: PEAJES,
  monto: '5000',
  ...over,
});
const combustible = (over: Partial<GastoFormValues> = {}): GastoFormValues => ({
  ...peaje({ categoriaId: COMBUSTIBLE_CATEGORIA_ID, monto: '40000', litros: '40' }),
  ...over,
});

describe('validateGastoForm: el monto con punto de miles', () => {
  it('«12.500» se guarda como 12500 (y «Se lee» dice lo mismo)', () => {
    const r = validateGastoForm(peaje({ monto: '12.500' }), ctx);
    expect(r.ok && r.columns.monto).toBe(12500);
    expect(textoSeLee('12.500', 'dinero')).toBe('Se lee: $\xa012.500');
  });

  it('«1.234.567» se guarda como 1234567; con coma, como siempre', () => {
    expect(validateGastoForm(peaje({ monto: '1.234.567' }), ctx)).toMatchObject({ ok: true, columns: { monto: 1234567 } });
    expect(validateGastoForm(peaje({ monto: '12.500,50' }), ctx)).toMatchObject({ ok: true, columns: { monto: 12500.5 } });
    expect(validateGastoForm(peaje({ monto: '12500,5' }), ctx)).toMatchObject({ ok: true, columns: { monto: 12500.5 } });
  });

  it('un punto que no es de miles sigue siendo el decimal: «12.5» es 12,5 y «0.500» sobra un decimal', () => {
    expect(validateGastoForm(peaje({ monto: '12.5' }), ctx)).toMatchObject({ ok: true, columns: { monto: 12.5 } });
    const r = validateGastoForm(peaje({ monto: '0.500' }), ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.monto).toBe('Usa hasta 2 decimales.');
  });

  it('vacío y texto que no es número: los mensajes del monto', () => {
    const vacio = validateGastoForm(peaje({ monto: '' }), ctx);
    expect(vacio.ok).toBe(false);
    if (!vacio.ok) expect(vacio.errors.monto).toBe('Escribe el monto.');
    const letras = validateGastoForm(peaje({ monto: 'abc' }), ctx);
    expect(letras.ok).toBe(false);
    if (!letras.ok) expect(letras.errors.monto).toBe('Escribe solo números. Ej.: 12500 o 12500,50.');
  });

  it('un monto de 11 dígitos no entra: «demasiado grande», sin Infinity ni NaN', () => {
    const r = validateGastoForm(peaje({ monto: '10.000.000.000' }), ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.monto).toBe('El número es demasiado grande. El máximo es $\xa09.999.999.999,99.');
  });
});

describe('validateGastoForm: los kilómetros del camión con punto de miles', () => {
  it('«452.310» se guarda como 452310 km', () => {
    const r = validateGastoForm(combustible({ kmOdometro: '452.310' }), ctx);
    expect(r.ok && r.columns.km_odometro).toBe(452310);
    expect(textoSeLee('452.310', 'km', { allowZero: true })).toBe('Se lee: 452.310 km');
  });

  it('«452.310,5» y «452310,5» se guardan igual; vacío es opcional', () => {
    expect(validateGastoForm(combustible({ kmOdometro: '452.310,5' }), ctx)).toMatchObject({ ok: true, columns: { km_odometro: 452310.5 } });
    expect(validateGastoForm(combustible({ kmOdometro: '452310,5' }), ctx)).toMatchObject({ ok: true, columns: { km_odometro: 452310.5 } });
    expect(validateGastoForm(combustible({ kmOdometro: '' }), ctx)).toMatchObject({ ok: true, columns: { km_odometro: null } });
  });

  it('«45.55» sobra un decimal y un texto que no es número da el mensaje de los km', () => {
    const dec = validateGastoForm(combustible({ kmOdometro: '45.55' }), ctx);
    expect(dec.ok).toBe(false);
    if (!dec.ok) expect(dec.errors.kmOdometro).toBe('Usa hasta 1 decimal.');
    const letras = validateGastoForm(combustible({ kmOdometro: 'x' }), ctx);
    expect(letras.ok).toBe(false);
    if (!letras.ok) expect(letras.errors.kmOdometro).toBe('Escribe solo números. Ej.: 45230.');
  });
});

describe('validateGastoForm: los litros NO cambian', () => {
  it('«1.200» litros sigue rechazado como ambiguo (no es 1200)', () => {
    const r = validateGastoForm(combustible({ litros: '1.200' }), ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.litros).toBe('Escribe los litros con coma para los decimales (ej. 40,5) o sin separador de miles (ej. 1200).');
    }
  });

  it('«40,5», «40.5» y «1200» litros se leen como siempre; vacío: «Escribe un número.»', () => {
    expect(validateGastoForm(combustible({ litros: '40,5' }), ctx)).toMatchObject({ ok: true, columns: { litros: 40.5 } });
    expect(validateGastoForm(combustible({ litros: '40.5' }), ctx)).toMatchObject({ ok: true, columns: { litros: 40.5 } });
    expect(validateGastoForm(combustible({ litros: '1200', monto: '1800000' }), ctx)).toMatchObject({ ok: true, columns: { litros: 1200 } });
    const vacio = validateGastoForm(combustible({ litros: '' }), ctx);
    expect(vacio.ok).toBe(false);
    if (!vacio.ok) expect(vacio.errors.litros).toBe('Escribe un número.');
  });

  it('el precio por litro sale del monto y los litros ya leídos (con miles en el monto)', () => {
    const r = validateGastoForm(combustible({ monto: '40.000', litros: '40' }), ctx);
    expect(r.ok && r.columns.precio_por_litro).toBe(1000);
  });
});

describe('previewPrecioPorLitro: el «Sale a $ … el litro» que se ve mientras se tipea lee el monto igual que el guardado', () => {
  it('con miles en el monto: «12.500» entre 100 litros sale 125, lo mismo que se guarda', () => {
    expect(previewPrecioPorLitro('12.500', '100')).toBe(125);
    const r = validateGastoForm(combustible({ monto: '12.500', litros: '100' }), ctx);
    expect(r.ok && r.columns.precio_por_litro).toBe(125);
  });

  it('«40.000» entre 40 litros sale 1000; con coma, como siempre', () => {
    expect(previewPrecioPorLitro('40.000', '40')).toBe(1000);
    expect(previewPrecioPorLitro('12500,5', '50')).toBe(250.01);
  });

  it('si el monto o los litros no se leen bien, no hay precio: «0.500», «1.200» litros (ambiguo) y vacío', () => {
    expect(previewPrecioPorLitro('0.500', '100')).toBeNull();
    expect(previewPrecioPorLitro('12.500', '1.200')).toBeNull();
    expect(previewPrecioPorLitro('', '100')).toBeNull();
    expect(previewPrecioPorLitro('12.500', '')).toBeNull();
  });
});

describe('valuesFromGasto: lo que se precarga al editar va siempre con coma y sin miles', () => {
  const gasto = (over: Partial<GastoEditable> = {}): GastoEditable => ({
    categoria_id: COMBUSTIBLE_CATEGORIA_ID,
    monto: 12500.5,
    fecha: '2026-10-01',
    descripcion: null,
    metodo_pago: 'efectivo',
    litros: 40.125,
    km_odometro: 452310.5,
    tanque_lleno: true,
    viaje_id: null,
    ...over,
  });

  it('monto, litros y km con coma, sin puntos', () => {
    const v = valuesFromGasto(gasto());
    expect(v.monto).toBe('12500,5');
    expect(v.litros).toBe('40,125');
    expect(v.kmOdometro).toBe('452310,5');
    expect(`${v.monto}${v.litros}${v.kmOdometro}`).not.toContain('.');
  });

  it('un valor entero y grande se precarga sin punto («12500», no «12.500»): el campo se edita sin separador de miles', () => {
    const v = valuesFromGasto(gasto({ monto: 12500, litros: 1200, km_odometro: 452310 }));
    expect(v.monto).toBe('12500');
    expect(v.litros).toBe('1200');
    expect(v.kmOdometro).toBe('452310');
  });

  it('lo precargado vuelve a leerse igual (editar y guardar sin tocar no cambia nada)', () => {
    const v = valuesFromGasto(gasto());
    const r = validateGastoForm(
      { ...emptyGastoValues(TODAY), ...v, metodoPago: 'efectivo' },
      { ...ctx, categorias: CATS },
    );
    expect(r).toMatchObject({ ok: true, columns: { monto: 12500.5, litros: 40.125, km_odometro: 452310.5 } });
  });

  it('el idioma del teléfono no cambia lo que se precarga', () => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-US');
    const v = valuesFromGasto(gasto());
    expect([v.monto, v.litros, v.kmOdometro]).toEqual(['12500,5', '40,125', '452310,5']);
  });
});
