import { describe, expect, it } from 'vitest';

import { COMBUSTIBLE_CATEGORIA_ID } from '@/features/gastos/constants';
import type { Categoria } from '@/features/gastos/categorias';
import {
  GASTO_FIELD_ORDER,
  buildInsertRow,
  emptyGastoValues,
  fingerprintOf,
  validateGastoForm,
  valuesFromGasto,
  type GastoEditable,
  type GastoFormValues,
} from '@/features/gastos/gasto-form';
import { decidirCamion, resolverCamion } from '@/features/camiones/camion-seleccion';

// El camión de un gasto (Etapa 5b), en la validación pura: con litros hace falta camión (regla del front hasta la 011);
// fuera de Combustible va NULL.
const TODAY = '2026-10-02';
const PEAJES = '210b4f00-fdb4-499b-bf15-79ebe2aaf3c3';
const CATS: Categoria[] = [
  { id: COMBUSTIBLE_CATEGORIA_ID, nombre: 'Combustible', activa: true, transportista_id: null },
  { id: PEAJES, nombre: 'Peajes', activa: true, transportista_id: null },
];
const CAMION = 'c0000000-0000-4000-8000-000000000001';
const ctx = { categorias: CATS, today: TODAY, viajes: [] };
const base = (over: Partial<GastoFormValues> = {}): GastoFormValues => ({
  ...emptyGastoValues(TODAY),
  categoriaId: COMBUSTIBLE_CATEGORIA_ID,
  monto: '40000',
  litros: '40',
  ...over,
});

describe('validateGastoForm: el camión', () => {
  it('Combustible: el camión resuelto va a camion_id', () => {
    const r = validateGastoForm(base(), { ...ctx, camion: { ok: true, camionId: CAMION } });
    expect(r.ok && r.columns).toMatchObject({ camion_id: CAMION, litros: 40 });
  });

  it('Combustible sin camión (falta elegir, hay que cargar uno o la lista no cargó): error en camionId, nada se guarda', () => {
    const r = validateGastoForm(base(), { ...ctx, camion: { ok: false, message: 'Elige el camión.' } });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.camionId).toBe('Elige el camión.');
    expect(r.firstField).toBe('camionId');
  });

  it('otra categoría: camion_id NULL aunque el formulario tenga uno elegido o la resolución dé error', () => {
    for (const camion of [{ ok: true as const, camionId: CAMION }, { ok: false as const, message: 'x' }, undefined]) {
      const r = validateGastoForm(base({ categoriaId: PEAJES, camionId: CAMION }), { ...ctx, camion });
      expect(r.ok && r.columns.camion_id, JSON.stringify(camion)).toBeNull();
    }
  });

  it('el error del camión va antes que el de los litros (orden en pantalla: camión, litros)', () => {
    const r = validateGastoForm(base({ litros: '' }), { ...ctx, camion: { ok: false, message: 'Elige el camión.' } });
    expect(!r.ok && r.firstField).toBe('camionId');
    expect(GASTO_FIELD_ORDER.indexOf('camionId')).toBe(GASTO_FIELD_ORDER.indexOf('litros') - 1);
    expect(GASTO_FIELD_ORDER.indexOf('camionId')).toBe(GASTO_FIELD_ORDER.indexOf('monto') + 1);
  });

  it('con la decisión real: en Combustible NUNCA sale una carga con litros y sin camión', () => {
    const camiones = [
      [],
      [{ id: CAMION, patente: 'AB123CD', marca: null, modelo: null, anio: null, activa: true }],
      [{ id: CAMION, patente: 'AB123CD', marca: null, modelo: null, anio: null, activa: false }],
    ];
    for (const lista of camiones) {
      for (const valor of ['', CAMION]) {
        const camion = resolverCamion(decidirCamion({ camiones: lista, original: null, contexto: 'combustible' }), valor);
        const r = validateGastoForm(base({ camionId: valor }), { ...ctx, camion });
        if (r.ok) expect(r.columns.camion_id, JSON.stringify({ lista, valor })).not.toBeNull();
      }
    }
  });
});

describe('camion_id en lo que se manda y en la huella', () => {
  it('el INSERT lleva camion_id', () => {
    const r = validateGastoForm(base(), { ...ctx, camion: { ok: true, camionId: CAMION } });
    if (!r.ok) throw new Error('debería ser válido');
    expect(buildInsertRow(r.columns, 'ref-1')).toMatchObject({ camion_id: CAMION, client_ref: 'ref-1' });
  });

  it('cambiar solo el camión cambia la huella (un reintento con otro camión no es "lo mismo")', () => {
    const con = (camionId: string) => {
      const r = validateGastoForm(base(), { ...ctx, camion: { ok: true, camionId } });
      if (!r.ok) throw new Error('debería ser válido');
      return fingerprintOf(r.columns);
    };
    expect(con(CAMION)).not.toBe(con('c0000000-0000-4000-8000-000000000002'));
  });

  it('valuesFromGasto: el camión que tenía (o vacío)', () => {
    const gasto = {
      categoria_id: COMBUSTIBLE_CATEGORIA_ID,
      fecha: TODAY,
      monto: 1,
      descripcion: null,
      metodo_pago: null,
      litros: 40,
      km_odometro: null,
      tanque_lleno: null,
      viaje_id: null,
    } as unknown as GastoEditable;
    expect(valuesFromGasto({ ...gasto, camion_id: CAMION }).camionId).toBe(CAMION);
    expect(valuesFromGasto({ ...gasto, camion_id: null }).camionId).toBe('');
    expect(valuesFromGasto(gasto).camionId).toBe('');
  });
});
