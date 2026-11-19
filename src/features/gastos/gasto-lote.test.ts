import { describe, expect, it } from 'vitest';

import { decidirCamion, resolverCamion, type ResolucionCamion } from '@/features/camiones/camion-seleccion';
import type { Categoria } from '@/features/gastos/categorias';
import { COMBUSTIBLE_CATEGORIA_ID, GASTOS_VARIOS_CATEGORIA_ID, MAX_GASTOS_POR_CARGA } from '@/features/gastos/constants';
import {
  DESCRIPCION_OBLIGATORIA_MESSAGE,
  METODO_PAGO_OBLIGATORIO_MESSAGE,
  VIAJE_INVALIDO_MESSAGE,
  emptyGastoValues,
  validateGastoForm,
  type GastoFormValues,
} from '@/features/gastos/gasto-form';
import { LoteDeGastosInvalidoError } from '@/features/gastos/gasto-lote-errores';
import {
  CAMPOS_COMPARTIDOS,
  esCampoCompartido,
  validateLoteDeGastos,
  type BloqueDeGasto,
  type CompartidoDelLote,
  type LoteValidation,
} from '@/features/gastos/gasto-lote';
import { classifyDataError, isRetryableDataError, mapDataError } from '@/lib/data-errors';
import { INVALID_DATA_MESSAGE } from '@/features/auth/auth-errors';

// La validación de cargar varios gastos de una vez: cada bloque se valida con `validateGastoForm` (no se repite ninguna regla) y
// esto junta los resultados. Todos los datos son inventados.
const TODAY = '2026-10-02';
const PEAJES = '2a000000-0000-4000-8000-000000000001';
const COMIDA = '2a000000-0000-4000-8000-000000000002';
const PROPIA_GASTOS_VARIOS = '2a000000-0000-4000-8000-000000000003'; // una categoría PROPIA que alguien llamó «Gastos varios»
const INACTIVA = '2a000000-0000-4000-8000-000000000004';
const DESCONOCIDA = '2a000000-0000-4000-8000-0000000000ff';
const CAMION = 'c0000000-0000-4000-8000-000000000001';
const VIAJE = 'b0000000-0000-4000-8000-000000000001';

const CATS: Categoria[] = [
  { id: COMBUSTIBLE_CATEGORIA_ID, nombre: 'Combustible', activa: true, transportista_id: null },
  { id: GASTOS_VARIOS_CATEGORIA_ID, nombre: 'Gastos varios', activa: true, transportista_id: null },
  { id: PEAJES, nombre: 'Peajes', activa: true, transportista_id: null },
  { id: COMIDA, nombre: 'Comida', activa: true, transportista_id: null },
  { id: PROPIA_GASTOS_VARIOS, nombre: 'Gastos varios', activa: true, transportista_id: 'transportista-de-prueba' },
  { id: INACTIVA, nombre: 'Vieja', activa: false, transportista_id: null },
];
const ctx = { categorias: CATS, today: TODAY, viajes: [{ id: VIAJE }] };
const compartido: CompartidoDelLote = { fecha: TODAY, viajeId: '' };
const CAMION_OK: ResolucionCamion = { ok: true, camionId: CAMION };

const bloque = (over: Partial<BloqueDeGasto> = {}): BloqueDeGasto => ({
  categoriaId: PEAJES,
  monto: '5000',
  descripcion: '',
  metodoPago: 'efectivo',
  litros: '',
  kmOdometro: '',
  tanqueLleno: '',
  ...over,
});
const combustible = (over: Partial<BloqueDeGasto> = {}): BloqueDeGasto =>
  bloque({ categoriaId: COMBUSTIBLE_CATEGORIA_ID, monto: '40000', litros: '40', camion: CAMION_OK, ...over });
const varios = (over: Partial<BloqueDeGasto> = {}): BloqueDeGasto =>
  bloque({ categoriaId: GASTOS_VARIOS_CATEGORIA_ID, monto: '1200', descripcion: 'Lavado', ...over });

function mal(r: LoteValidation) {
  if (r.ok) throw new Error('debería haber errores');
  return r;
}
function bien(r: LoteValidation) {
  if (!r.ok) throw new Error(`debería ser válido: ${JSON.stringify(r)}`);
  return r;
}
function rechazo(fn: () => unknown): LoteDeGastosInvalidoError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(LoteDeGastosInvalidoError);
    return error as LoteDeGastosInvalidoError;
  }
  throw new Error('debería haber tirado LoteDeGastosInvalidoError');
}

describe('validateLoteDeGastos: lo que sale bien', () => {
  it('un bloque: un gasto con sus columnas y la fecha y el viaje compartidos', () => {
    const r = bien(validateLoteDeGastos({ fecha: TODAY, viajeId: VIAJE }, [bloque({ monto: '5000,50', descripcion: ' Autopista ' })], ctx));
    expect(r.gastos).toEqual([
      {
        categoriaId: PEAJES,
        columns: {
          categoria_id: PEAJES,
          monto: 5000.5,
          fecha: TODAY,
          viaje_id: VIAJE,
          descripcion: 'Autopista',
          metodo_pago: 'efectivo',
          litros: null,
          precio_por_litro: null,
          km_odometro: null,
          tanque_lleno: null,
          camion_id: null,
        },
      },
    ]);
  });

  it('varios bloques: un gasto por bloque, en el MISMO orden, cada uno con su monto, descripción y método de pago (el método es por gasto)', () => {
    const r = bien(
      validateLoteDeGastos(
        compartido,
        [
          bloque({ categoriaId: PEAJES, monto: '300', metodoPago: 'efectivo' }),
          bloque({ categoriaId: COMIDA, monto: '1500', descripcion: 'Almuerzo', metodoPago: 'tarjeta_credito' }),
          combustible({ metodoPago: 'transferencia' }),
        ],
        ctx,
      ),
    );
    expect(r.gastos.map((g) => g.categoriaId)).toEqual([PEAJES, COMIDA, COMBUSTIBLE_CATEGORIA_ID]);
    expect(r.gastos.map((g) => g.columns.categoria_id)).toEqual([PEAJES, COMIDA, COMBUSTIBLE_CATEGORIA_ID]);
    expect(r.gastos.map((g) => g.columns.monto)).toEqual([300, 1500, 40000]);
    expect(r.gastos.map((g) => g.columns.descripcion)).toEqual([null, 'Almuerzo', null]);
    expect(r.gastos.map((g) => g.columns.metodo_pago)).toEqual(['efectivo', 'tarjeta_credito', 'transferencia']);
  });

  it('la fecha y el viaje son UNO solo y valen para todos los gastos', () => {
    const r = bien(
      validateLoteDeGastos({ fecha: '2026-09-30', viajeId: VIAJE }, [bloque(), bloque({ categoriaId: COMIDA }), varios()], ctx),
    );
    expect(r.gastos.map((g) => g.columns.fecha)).toEqual(['2026-09-30', '2026-09-30', '2026-09-30']);
    expect(r.gastos.map((g) => g.columns.viaje_id)).toEqual([VIAJE, VIAJE, VIAJE]);
  });

  it('sin viaje: todos van con viaje_id null explícito', () => {
    const r = bien(validateLoteDeGastos(compartido, [bloque(), bloque({ categoriaId: COMIDA })], ctx));
    expect(r.gastos.map((g) => g.columns.viaje_id)).toEqual([null, null]);
  });

  it('Combustible: litros, km, tanque lleno, precio por litro y el camión del bloque; las otras categorías van con esas columnas en null aunque tengan algo tipeado', () => {
    const r = bien(
      validateLoteDeGastos(
        compartido,
        [
          combustible({ monto: '40000', litros: '40', kmOdometro: '15000,5', tanqueLleno: 'si' }),
          // Un bloque que no es Combustible ignora lo de combustible (el formulario lo conserva si se cambia de categoría y se vuelve).
          bloque({ categoriaId: PEAJES, litros: '99', kmOdometro: '1', tanqueLleno: 'no', camion: CAMION_OK }),
        ],
        ctx,
      ),
    );
    expect(r.gastos[0]!.columns).toMatchObject({ litros: 40, precio_por_litro: 1000, km_odometro: 15000.5, tanque_lleno: true, camion_id: CAMION });
    expect(r.gastos[1]!.columns).toMatchObject({ litros: null, precio_por_litro: null, km_odometro: null, tanque_lleno: null, camion_id: null });
  });

  it('el camión de CADA bloque va a su gasto: el de Combustible lo usa, el resto lo ignora', () => {
    const r = bien(
      validateLoteDeGastos(compartido, [bloque({ camion: { ok: false, message: 'Elige el camión.' } }), combustible()], ctx),
    );
    expect(r.gastos.map((g) => g.columns.camion_id)).toEqual([null, CAMION]);
  });

  it('«Gastos varios» con descripción es válido; la descripción de las demás es opcional', () => {
    const r = bien(validateLoteDeGastos(compartido, [varios({ descripcion: 'Lavado de lona' }), bloque()], ctx));
    expect(r.gastos[0]!.columns.descripcion).toBe('Lavado de lona');
    expect(r.gastos[1]!.columns.descripcion).toBeNull();
  });

  it(`el tope: exactamente ${MAX_GASTOS_POR_CARGA} categorías distintas se acepta`, () => {
    const categorias = Array.from({ length: MAX_GASTOS_POR_CARGA }, (_, i) => ({
      id: `3a000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
      nombre: `Categoría ${i + 1}`,
      activa: true,
      transportista_id: null,
    }));
    const r = bien(validateLoteDeGastos(compartido, categorias.map((c) => bloque({ categoriaId: c.id })), { ...ctx, categorias }));
    expect(r.gastos).toHaveLength(MAX_GASTOS_POR_CARGA);
  });

  it('no modifica lo que recibe', () => {
    const bloques = Object.freeze([Object.freeze(bloque()), Object.freeze(combustible())]);
    const comp = Object.freeze({ ...compartido });
    expect(() => validateLoteDeGastos(comp, bloques, { ...ctx, viajes: Object.freeze([{ id: VIAJE }]) })).not.toThrow();
  });
});

describe('validateLoteDeGastos: lo que rechaza (error propio, antes de validar nada)', () => {
  it('un lote vacío', () => {
    expect(rechazo(() => validateLoteDeGastos(compartido, [], ctx)).motivo).toBe('vacio');
  });

  it('una categoría repetida (una categoría, un gasto por carga)', () => {
    expect(rechazo(() => validateLoteDeGastos(compartido, [bloque(), bloque({ categoriaId: COMIDA }), bloque({ monto: '7' })], ctx)).motivo).toBe('repetida');
    expect(rechazo(() => validateLoteDeGastos(compartido, [bloque(), bloque()], ctx)).motivo).toBe('repetida');
  });

  it('la repetida se rechaza aunque no sea una categoría conocida (dos bloques sin categoría)', () => {
    expect(rechazo(() => validateLoteDeGastos(compartido, [bloque({ categoriaId: '' }), bloque({ categoriaId: '' })], ctx)).motivo).toBe('repetida');
    expect(rechazo(() => validateLoteDeGastos(compartido, [bloque({ categoriaId: DESCONOCIDA }), bloque({ categoriaId: DESCONOCIDA })], ctx)).motivo).toBe('repetida');
  });

  it(`más categorías que el tope (${MAX_GASTOS_POR_CARGA + 1})`, () => {
    const categorias = Array.from({ length: MAX_GASTOS_POR_CARGA + 1 }, (_, i) => ({
      id: `3a000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
      nombre: `Categoría ${i + 1}`,
      activa: true,
      transportista_id: null,
    }));
    expect(rechazo(() => validateLoteDeGastos(compartido, categorias.map((c) => bloque({ categoriaId: c.id })), { ...ctx, categorias })).motivo).toBe(
      'demasiadas',
    );
  });

  it('el tope es 10 (MAX_GASTOS_POR_CARGA)', () => {
    expect(MAX_GASTOS_POR_CARGA).toBe(10);
  });

  it('se rechaza ANTES de validar los campos: con un lote repetido y un monto inválido tira el error, no devuelve errores de campo', () => {
    expect(rechazo(() => validateLoteDeGastos(compartido, [bloque({ monto: '' }), bloque({ monto: 'abc' })], ctx)).motivo).toBe('repetida');
    expect(rechazo(() => validateLoteDeGastos({ fecha: '', viajeId: '' }, [], ctx)).motivo).toBe('vacio');
  });

  it('es un error de DATOS INVÁLIDOS (22023) que no se reintenta, como SeleccionDeGastosInvalidaError; el mensaje no lleva ningún dato recibido', () => {
    for (const motivo of ['vacio', 'repetida', 'demasiadas'] as const) {
      const bloques = motivo === 'vacio' ? [] : motivo === 'repetida' ? [bloque(), bloque()] : Array.from({ length: MAX_GASTOS_POR_CARGA + 1 }, (_, i) => bloque({ categoriaId: `x-${i}` }));
      const error = rechazo(() => validateLoteDeGastos(compartido, bloques, ctx));
      expect(error.motivo).toBe(motivo);
      expect(error.name).toBe('LoteDeGastosInvalidoError');
      expect(error.code).toBe('22023');
      expect(classifyDataError(error), motivo).toBe('invalid-data');
      expect(isRetryableDataError(error), motivo).toBe(false);
      expect(mapDataError(error), motivo).toBe(INVALID_DATA_MESSAGE);
      expect(error.message, motivo).not.toContain(PEAJES);
    }
  });
});

describe('validateLoteDeGastos: errores por categoría y el primero con error', () => {
  it('el error de un bloque aparece SOLO en ese bloque: los demás no figuran', () => {
    const r = mal(validateLoteDeGastos(compartido, [bloque(), bloque({ categoriaId: COMIDA, monto: '' }), varios()], ctx));
    expect(r.bloques.map((b) => b.categoriaId)).toEqual([COMIDA]);
    expect(r.bloques[0]!.errors).toEqual({ monto: expect.any(String) });
    expect(r.compartidos).toEqual({});
    expect(r.primero).toEqual({ categoriaId: COMIDA, field: 'monto' });
  });

  it('varios bloques con error: salen en el orden de los bloques, cada uno con SUS errores', () => {
    const r = mal(
      validateLoteDeGastos(
        compartido,
        [bloque({ categoriaId: COMIDA, monto: '0' }), bloque(), varios({ descripcion: '  ', metodoPago: '' }), combustible({ litros: '' })],
        ctx,
      ),
    );
    expect(r.bloques.map((b) => b.categoriaId)).toEqual([COMIDA, GASTOS_VARIOS_CATEGORIA_ID, COMBUSTIBLE_CATEGORIA_ID]);
    expect(Object.keys(r.bloques[0]!.errors)).toEqual(['monto']);
    expect(Object.keys(r.bloques[1]!.errors).sort()).toEqual(['descripcion', 'metodoPago']);
    expect(Object.keys(r.bloques[2]!.errors)).toEqual(['litros']);
  });

  it('el primero con error es el primer BLOQUE que falla (no el que tiene más errores) y su primer campo en el orden del formulario', () => {
    const r = mal(
      validateLoteDeGastos(
        compartido,
        [bloque(), varios({ descripcion: '', metodoPago: '' }), bloque({ categoriaId: COMIDA, monto: '' })],
        ctx,
      ),
    );
    // En el bloque «Gastos varios» el orden es: descripción antes que método de pago.
    expect(r.primero).toEqual({ categoriaId: GASTOS_VARIOS_CATEGORIA_ID, field: 'descripcion' });
  });

  it('si falla el primer bloque, el foco es el suyo aunque otro bloque tenga errores más arriba en el formulario', () => {
    const r = mal(validateLoteDeGastos(compartido, [bloque({ metodoPago: '' }), varios({ descripcion: '' })], ctx));
    expect(r.primero).toEqual({ categoriaId: PEAJES, field: 'metodoPago' });
  });

  it('un método de pago que falta es un error de ESE bloque (cada bloque trae el suyo)', () => {
    const r = mal(validateLoteDeGastos(compartido, [bloque({ metodoPago: 'efectivo' }), bloque({ categoriaId: COMIDA, metodoPago: '' })], ctx));
    expect(r.bloques).toEqual([{ categoriaId: COMIDA, errors: { metodoPago: METODO_PAGO_OBLIGATORIO_MESSAGE } }]);
  });

  it('un método de pago que no es de la lista también es un error del bloque', () => {
    const r = mal(validateLoteDeGastos(compartido, [bloque({ metodoPago: 'cheque' as never })], ctx));
    expect(r.bloques[0]!.errors.metodoPago).toBe('Elige un método de pago de la lista.');
  });

  it('«Gastos varios» sin descripción es un error del bloque; con una categoría propia que se llama igual, no', () => {
    const r = mal(validateLoteDeGastos(compartido, [varios({ descripcion: '' })], ctx));
    expect(r.bloques).toEqual([{ categoriaId: GASTOS_VARIOS_CATEGORIA_ID, errors: { descripcion: DESCRIPCION_OBLIGATORIA_MESSAGE } }]);
    expect(validateLoteDeGastos(compartido, [bloque({ categoriaId: PROPIA_GASTOS_VARIOS, descripcion: '' })], ctx).ok).toBe(true);
  });

  it('Combustible: el camión sin resolver es un error del bloque (camionId) y va ANTES que los litros', () => {
    const r = mal(validateLoteDeGastos(compartido, [bloque(), combustible({ litros: '', camion: { ok: false, message: 'Elige el camión.' } })], ctx));
    expect(r.bloques).toEqual([{ categoriaId: COMBUSTIBLE_CATEGORIA_ID, errors: { camionId: 'Elige el camión.', litros: expect.any(String) } }]);
    expect(r.primero).toEqual({ categoriaId: COMBUSTIBLE_CATEGORIA_ID, field: 'camionId' });
  });

  it('Combustible sin litros es un error del bloque', () => {
    const r = mal(validateLoteDeGastos(compartido, [combustible({ litros: '' })], ctx));
    expect(Object.keys(r.bloques[0]!.errors)).toEqual(['litros']);
  });

  it('los errores de la fecha y del viaje son de TODA la carga: salen una sola vez, no en cada bloque', () => {
    const r = mal(validateLoteDeGastos({ fecha: '2026-10-03', viajeId: 'v-que-no-existe' }, [bloque(), bloque({ categoriaId: COMIDA }), varios()], ctx));
    expect(Object.keys(r.compartidos).sort()).toEqual(['fecha', 'viajeId']);
    expect(r.compartidos.viajeId).toBe(VIAJE_INVALIDO_MESSAGE);
    expect(r.bloques).toEqual([]);
  });

  it('un bloque con su propio error no repite los errores de lo compartido: ahí solo van los suyos', () => {
    const r = mal(validateLoteDeGastos({ fecha: '2026-10-03', viajeId: 'v-que-no-existe' }, [bloque({ monto: '' }), bloque({ categoriaId: COMIDA, monto: '' })], ctx));
    expect(Object.keys(r.compartidos).sort()).toEqual(['fecha', 'viajeId']);
    expect(r.bloques.map((b) => b.categoriaId)).toEqual([PEAJES, COMIDA]);
    for (const { errors } of r.bloques) {
      expect(Object.keys(errors)).toEqual(['monto']);
      expect(Object.keys(errors).some((campo) => esCampoCompartido(campo as never))).toBe(false);
    }
  });

  it('si lo único que falla es lo compartido, el foco es el primer bloque con un campo compartido', () => {
    const r = mal(validateLoteDeGastos({ fecha: '', viajeId: '' }, [bloque(), bloque({ categoriaId: COMIDA })], ctx));
    expect(r.primero.categoriaId).toBe(PEAJES);
    expect(esCampoCompartido(r.primero.field)).toBe(true);
  });

  it('un error de lo compartido y otro de un bloque: salen cada uno en su lugar', () => {
    const r = mal(validateLoteDeGastos({ fecha: TODAY, viajeId: 'otro' }, [bloque(), bloque({ categoriaId: COMIDA, monto: 'x' })], ctx));
    expect(r.compartidos).toEqual({ viajeId: VIAJE_INVALIDO_MESSAGE });
    expect(r.bloques).toEqual([{ categoriaId: COMIDA, errors: { monto: expect.any(String) } }]);
  });

  it('una categoría que no existe NO tira: es un error de la categoría de ese bloque, como en el formulario de un solo gasto', () => {
    for (const categoriaId of ['', DESCONOCIDA]) {
      const r = mal(validateLoteDeGastos(compartido, [bloque(), bloque({ categoriaId })], ctx));
      expect(r.bloques).toEqual([{ categoriaId, errors: { categoriaId: 'Elige una categoría.' } }]);
    }
  });

  it('una categoría inactiva es válida (igual que en validateGastoForm: al editar puede ser la que ya tenía)', () => {
    expect(validateLoteDeGastos(compartido, [bloque({ categoriaId: INACTIVA })], ctx).ok).toBe(true);
  });

  it('la descripción de más de 2000 caracteres es un error del bloque', () => {
    const r = mal(validateLoteDeGastos(compartido, [bloque({ descripcion: 'x'.repeat(2001) })], ctx));
    expect(Object.keys(r.bloques[0]!.errors)).toEqual(['descripcion']);
  });

  it('un error en un bloque no impide validar los demás: todos los errores salen juntos', () => {
    const r = mal(validateLoteDeGastos(compartido, [bloque({ monto: '' }), bloque({ categoriaId: COMIDA, monto: '' }), bloque({ categoriaId: INACTIVA, monto: '' })], ctx));
    expect(r.bloques.map((b) => b.categoriaId)).toEqual([PEAJES, COMIDA, INACTIVA]);
  });
});

describe('validateLoteDeGastos con UN solo bloque es validateGastoForm (equivalencia)', () => {
  const valoresDe = (comp: CompartidoDelLote, b: BloqueDeGasto): GastoFormValues => ({
    ...emptyGastoValues(comp.fecha, comp.viajeId),
    categoriaId: b.categoriaId,
    monto: b.monto,
    descripcion: b.descripcion,
    metodoPago: b.metodoPago,
    litros: b.litros,
    kmOdometro: b.kmOdometro,
    tanqueLleno: b.tanqueLleno,
  });

  const CASOS: Array<[string, CompartidoDelLote, BloqueDeGasto]> = [
    ['peaje válido', compartido, bloque()],
    ['peaje con descripción y viaje', { fecha: '2026-09-15', viajeId: VIAJE }, bloque({ descripcion: '  Autopista  ', monto: '1.234,56' })],
    ['peaje con lo de combustible tipeado de antes', compartido, bloque({ litros: '40', kmOdometro: '10', tanqueLleno: 'si', camion: CAMION_OK })],
    ['combustible completo', compartido, combustible({ kmOdometro: '120000', tanqueLleno: 'si' })],
    ['combustible con tanque «no» y km con decimales', compartido, combustible({ kmOdometro: '120000,5', tanqueLleno: 'no' })],
    ['combustible con camión sin resolver', compartido, combustible({ camion: undefined })],
    ['combustible sin camión elegido', compartido, combustible({ camion: { ok: false, message: 'Elige el camión.' } })],
    ['combustible sin litros', compartido, combustible({ litros: '' })],
    ['combustible con litros inválidos', compartido, combustible({ litros: '0' })],
    ['combustible con km inválidos', compartido, combustible({ kmOdometro: '-5' })],
    ['gastos varios sin descripción', compartido, varios({ descripcion: '' })],
    ['gastos varios con descripción', compartido, varios()],
    ['monto vacío', compartido, bloque({ monto: '' })],
    ['monto cero', compartido, bloque({ monto: '0' })],
    ['monto enorme', compartido, bloque({ monto: '99999999999' })],
    ['método de pago faltante', compartido, bloque({ metodoPago: '' })],
    ['método de pago fuera de la lista', compartido, bloque({ metodoPago: 'cheque' as never })],
    ['categoría desconocida', compartido, bloque({ categoriaId: DESCONOCIDA })],
    ['sin categoría', compartido, bloque({ categoriaId: '' })],
    ['fecha futura', { fecha: '2026-10-03', viajeId: '' }, bloque()],
    ['fecha vacía', { fecha: '', viajeId: '' }, bloque()],
    ['viaje desconocido', { fecha: TODAY, viajeId: 'zzz' }, bloque()],
    ['descripción demasiado larga', compartido, bloque({ descripcion: 'x'.repeat(2001) })],
    ['varios errores a la vez', { fecha: '2026-10-03', viajeId: 'zzz' }, varios({ descripcion: '', monto: '', metodoPago: '' })],
    ['combustible con varios errores a la vez', { fecha: '', viajeId: 'zzz' }, combustible({ monto: 'x', litros: '', kmOdometro: 'y', camion: { ok: false, message: 'Elige el camión.' } })],
  ];

  it.each(CASOS)('%s', (_nombre, comp, b) => {
    const esperado = validateGastoForm(valoresDe(comp, b), { ...ctx, camion: b.camion });
    const r = validateLoteDeGastos(comp, [b], ctx);
    expect(r.ok).toBe(esperado.ok);
    if (esperado.ok) {
      expect(r.ok && r.gastos).toHaveLength(1);
      // Las MISMAS columnas, ni una más ni una menos (toStrictEqual mira también las claves con undefined).
      expect(r.ok && r.gastos[0]!.columns).toStrictEqual(esperado.columns);
      expect(r.ok && r.gastos[0]!.categoriaId).toBe(b.categoriaId);
    } else if (!r.ok) {
      // Los mismos errores (lo compartido + lo del bloque) y el mismo primer campo.
      expect({ ...r.compartidos, ...(r.bloques[0]?.errors ?? {}) }).toEqual(esperado.errors);
      expect(r.primero.field).toBe(esperado.firstField);
      expect(r.primero.categoriaId).toBe(b.categoriaId);
    }
  });

  it('con la decisión real del camión: el mismo resultado que el formulario de un solo gasto en cualquier combinación', () => {
    const camiones = [
      [],
      [{ id: CAMION, patente: 'AB123CD', marca: null, modelo: null, anio: null, activa: true }],
      [{ id: CAMION, patente: 'AB123CD', marca: null, modelo: null, anio: null, activa: false }],
    ];
    for (const lista of camiones) {
      for (const valor of ['', CAMION]) {
        for (const modo of ['nuevo', 'edicion'] as const) {
          const camion = resolverCamion(decidirCamion({ camiones: lista, original: null, contexto: 'combustible', modo, camionActivoId: null }), valor);
          const b = combustible({ camion });
          const esperado = validateGastoForm(valoresDe(compartido, b), { ...ctx, camion });
          const r = validateLoteDeGastos(compartido, [b], ctx);
          expect(r.ok, JSON.stringify({ lista, valor, modo })).toBe(esperado.ok);
          if (esperado.ok && r.ok) expect(r.gastos[0]!.columns).toStrictEqual(esperado.columns);
        }
      }
    }
  });

  it('el mismo bloque da las MISMAS columnas solo o acompañado de otros (un bloque no se contagia de los demás)', () => {
    const solo = bien(validateLoteDeGastos(compartido, [combustible({ tanqueLleno: 'si' })], ctx));
    const acompanado = bien(validateLoteDeGastos(compartido, [bloque(), varios(), combustible({ tanqueLleno: 'si' })], ctx));
    expect(acompanado.gastos[2]!.columns).toStrictEqual(solo.gastos[0]!.columns);
  });
});

describe('los campos compartidos', () => {
  it('son la fecha y el viaje, y el resto de los campos son de cada bloque', () => {
    expect([...CAMPOS_COMPARTIDOS]).toEqual(['fecha', 'viajeId']);
    for (const campo of ['categoriaId', 'monto', 'descripcion', 'metodoPago', 'litros', 'kmOdometro', 'tanqueLleno', 'camionId'] as const) {
      expect(esCampoCompartido(campo)).toBe(false);
    }
    expect(esCampoCompartido('fecha')).toBe(true);
    expect(esCampoCompartido('viajeId')).toBe(true);
  });
});
