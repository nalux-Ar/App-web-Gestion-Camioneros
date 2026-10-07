import { describe, expect, it, vi } from 'vitest';

import { COMBUSTIBLE_CATEGORIA_ID } from '@/features/gastos/constants';
import type { Categoria } from '@/features/gastos/categorias';
import { CLIENT_REF_CONSTRAINT } from '@/features/gastos/client-ref';
import {
  GASTO_FIELD_ORDER,
  VIAJE_INVALIDO_MESSAGE,
  buildInsertRow,
  emptyGastoValues,
  fingerprintOf,
  validateGastoForm,
  valuesFromGasto,
  type GastoColumns,
  type GastoEditable,
  type GastoFormValues,
} from '@/features/gastos/gasto-form';
import { crearGasto, type GastoWriteIO } from '@/features/gastos/gasto-save';
import { DataRequestError } from '@/lib/data-errors';

const TODAY = '2026-10-02';
const PEAJES = '210b4f00-fdb4-499b-bf15-79ebe2aaf3c3';
const CATS: Categoria[] = [
  { id: COMBUSTIBLE_CATEGORIA_ID, nombre: 'Combustible', activa: true, transportista_id: null },
  { id: PEAJES, nombre: 'Peajes', activa: true, transportista_id: null },
];
const V1 = 'b0000000-0000-4000-8000-000000000001';
const V2 = 'b0000000-0000-4000-8000-000000000002';
const V_FUERA = 'b0000000-0000-4000-8000-0000000000ff';

const base = (over: Partial<GastoFormValues> = {}): GastoFormValues => ({
  ...emptyGastoValues(TODAY),
  categoriaId: PEAJES,
  monto: '1000',
  ...over,
});
const ctx = { categorias: CATS, today: TODAY, viajes: [{ id: V1 }, { id: V2 }] };

function columnasValidas(over: Partial<GastoFormValues> = {}): GastoColumns {
  const r = validateGastoForm(base(over), ctx);
  if (!r.ok) throw new Error(`debería ser válido: ${JSON.stringify(r.errors)}`);
  return r.columns;
}

describe('orden de los campos', () => {
  it('el viaje va después de la fecha y antes del método de pago', () => {
    const orden = [...GASTO_FIELD_ORDER];
    expect(orden.indexOf('viajeId')).toBe(orden.indexOf('fecha') + 1);
    expect(orden.indexOf('viajeId')).toBe(orden.indexOf('metodoPago') - 1);
    expect(orden.slice(-3)).toEqual(['fecha', 'viajeId', 'metodoPago']);
  });

  it('el foco va al viaje antes que al método de pago, y después de la fecha', () => {
    const r = validateGastoForm(base({ viajeId: V_FUERA, metodoPago: 'cheque' as never }), ctx);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.errors).sort()).toEqual(['metodoPago', 'viajeId']);
    expect(r.firstField).toBe('viajeId');

    const conFecha = validateGastoForm(base({ fecha: '2999-01-01', viajeId: V_FUERA }), ctx);
    expect(conFecha.ok).toBe(false);
    if (!conFecha.ok) expect(conFecha.firstField).toBe('fecha');
  });
});

describe('valores iniciales', () => {
  it('un gasto común NO preselecciona ningún viaje', () => {
    expect(emptyGastoValues(TODAY).viajeId).toBe('');
  });

  it('solo cuando se llega desde un viaje queda ese viaje elegido', () => {
    expect(emptyGastoValues(TODAY, V1).viajeId).toBe(V1);
  });

  it('al editar: el viaje vinculado, o "" (Sin viaje) si no tiene', () => {
    const gasto: GastoEditable = {
      categoria_id: PEAJES,
      monto: 900,
      fecha: '2026-10-01',
      descripcion: null,
      metodo_pago: null,
      litros: null,
      km_odometro: null,
      tanque_lleno: null,
      viaje_id: V1,
    };
    expect(valuesFromGasto(gasto).viajeId).toBe(V1);
    expect(valuesFromGasto({ ...gasto, viaje_id: null }).viajeId).toBe('');
  });
});

describe('validación del viaje', () => {
  it('"" (Sin viaje) es válido y manda viaje_id = null EXPLÍCITO', () => {
    const columns = columnasValidas({ viajeId: '' });
    expect(columns.viaje_id).toBeNull();
    expect(Object.prototype.hasOwnProperty.call(columns, 'viaje_id')).toBe(true);
  });

  it('un id que está entre las opciones conocidas es válido y se manda tal cual', () => {
    expect(columnasValidas({ viajeId: V1 }).viaje_id).toBe(V1);
    expect(columnasValidas({ viajeId: V2 }).viaje_id).toBe(V2);
  });

  it('un id que NO está entre las opciones: "Elige un viaje de la lista." y el foco va al viaje', () => {
    const r = validateGastoForm(base({ viajeId: V_FUERA }), ctx);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.viajeId).toBe('Elige un viaje de la lista.');
    expect(r.errors.viajeId).toBe(VIAJE_INVALIDO_MESSAGE);
    expect(r.firstField).toBe('viajeId');
  });

  it('con la lista de opciones vacía (todavía no cargó o falló), un id cualquiera es inválido pero "Sin viaje" sigue guardando', () => {
    const sinLista = { ...ctx, viajes: [] };
    expect(validateGastoForm(base({ viajeId: V1 }), sinLista).ok).toBe(false);
    expect(validateGastoForm(base({ viajeId: '' }), sinLista).ok).toBe(true);
  });

  it('basura (espacios, mayúsculas distintas, texto) no pasa como un id conocido', () => {
    for (const raro of [' ', V1.toUpperCase(), `${V1} `, 'null', 'undefined', '../x', '<b>x</b>']) {
      const r = validateGastoForm(base({ viajeId: raro }), ctx);
      expect(r.ok, JSON.stringify(raro)).toBe(false);
      if (!r.ok) expect(r.errors.viajeId).toBe(VIAJE_INVALIDO_MESSAGE);
    }
  });

  it('el viaje se valida también en un gasto de combustible (no depende de la categoría)', () => {
    const fuel = validateGastoForm(base({ categoriaId: COMBUSTIBLE_CATEGORIA_ID, litros: '40', viajeId: V1 }), ctx);
    expect(fuel.ok).toBe(true);
    if (fuel.ok) expect(fuel.columns.viaje_id).toBe(V1);
    const mal = validateGastoForm(base({ categoriaId: COMBUSTIBLE_CATEGORIA_ID, litros: '40', viajeId: V_FUERA }), ctx);
    expect(mal.ok).toBe(false);
  });
});

describe('columnas, INSERT y huella con viaje_id', () => {
  it('las columnas llevan exactamente estas claves (viaje_id y camion_id incluidos) y nada de transportista_id ni id', () => {
    expect(Object.keys(columnasValidas()).sort()).toEqual(
      [
        'camion_id',
        'categoria_id',
        'descripcion',
        'fecha',
        'km_odometro',
        'litros',
        'metodo_pago',
        'monto',
        'precio_por_litro',
        'tanque_lleno',
        'viaje_id',
      ].sort(),
    );
  });

  it('la fila del INSERT lleva viaje_id y el client_ref, y nunca transportista_id ni id', () => {
    const row = buildInsertRow(columnasValidas({ viajeId: V1 }), 'ref-1');
    expect(row.viaje_id).toBe(V1);
    expect(row.client_ref).toBe('ref-1');
    expect(row).not.toHaveProperty('transportista_id');
    expect(row).not.toHaveProperty('id');
  });

  it('la huella cambia si cambia el viaje: de uno a otro, de uno a ninguno y de ninguno a uno', () => {
    const sin = fingerprintOf(columnasValidas({ viajeId: '' }));
    const v1 = fingerprintOf(columnasValidas({ viajeId: V1 }));
    const v2 = fingerprintOf(columnasValidas({ viajeId: V2 }));
    expect(new Set([sin, v1, v2]).size).toBe(3);
    // Y es estable: lo mismo da la misma huella.
    expect(fingerprintOf(columnasValidas({ viajeId: V1 }))).toBe(v1);
  });

  it('la huella incluye el viaje_id (no es solo una huella de las otras columnas)', () => {
    const columns = columnasValidas({ viajeId: V1 });
    expect(fingerprintOf(columns)).toContain(V1);
    expect(fingerprintOf({ ...columns, viaje_id: null })).not.toContain(V1);
  });
});

describe('reintento idempotente: si entre dos intentos cambia el viaje, se actualiza con el nuevo', () => {
  function duplicado() {
    return new DataRequestError({ message: `duplicate key value violates unique constraint "${CLIENT_REF_CONSTRAINT}"`, code: '23505' }, 409);
  }
  function io(insert: GastoWriteIO['insert']) {
    const updateByClientRef = vi.fn<GastoWriteIO['updateByClientRef']>(async () => {});
    return { io: { insert: vi.fn(insert), updateByClientRef } satisfies GastoWriteIO, updateByClientRef };
  }

  it('mismo viaje en los dos intentos: "ya guardado", sin UPDATE', async () => {
    const sent = new Set<string>();
    const columns = columnasValidas({ viajeId: V1 });
    let intento = 0;
    const { io: fake, updateByClientRef } = io(async () => {
      intento += 1;
      if (intento === 1) throw new DataRequestError({ message: 'TypeError: Failed to fetch', code: '' });
      throw duplicado();
    });
    await expect(crearGasto({ columns, clientRef: 'r', sent, io: fake })).rejects.toBeDefined();
    await expect(crearGasto({ columns, clientRef: 'r', sent, io: fake })).resolves.toBe('ya-guardado');
    expect(updateByClientRef).not.toHaveBeenCalled();
  });

  it('otro viaje en el segundo intento: el INSERT dice "ya existe" y se hace el UPDATE por client_ref con el viaje nuevo', async () => {
    const sent = new Set<string>();
    let intento = 0;
    const { io: fake, updateByClientRef } = io(async () => {
      intento += 1;
      if (intento === 1) throw new DataRequestError({ message: 'TypeError: Failed to fetch', code: '' }); // la respuesta se perdió
      throw duplicado();
    });
    await expect(crearGasto({ columns: columnasValidas({ viajeId: V1 }), clientRef: 'r', sent, io: fake })).rejects.toBeDefined();
    const nuevo = columnasValidas({ viajeId: V2 });
    await expect(crearGasto({ columns: nuevo, clientRef: 'r', sent, io: fake })).resolves.toBe('ya-guardado-actualizado');
    expect(updateByClientRef).toHaveBeenCalledTimes(1);
    expect(updateByClientRef.mock.calls[0]![0]).toBe('r');
    expect(updateByClientRef.mock.calls[0]![1]).toMatchObject({ viaje_id: V2 });
  });

  it('de un viaje a "Sin viaje" también actualiza (con viaje_id = null explícito)', async () => {
    const sent = new Set<string>();
    let intento = 0;
    const { io: fake, updateByClientRef } = io(async () => {
      intento += 1;
      if (intento === 1) throw new DataRequestError({ message: 'TypeError: Failed to fetch', code: '' });
      throw duplicado();
    });
    await expect(crearGasto({ columns: columnasValidas({ viajeId: V1 }), clientRef: 'r', sent, io: fake })).rejects.toBeDefined();
    await expect(crearGasto({ columns: columnasValidas({ viajeId: '' }), clientRef: 'r', sent, io: fake })).resolves.toBe('ya-guardado-actualizado');
    expect(updateByClientRef.mock.calls[0]![1]).toHaveProperty('viaje_id', null);
  });
});
