import { describe, expect, it } from 'vitest';

import {
  parseResumenCombustible,
  parseResumenGastos,
  parseResumenMensual,
  parseResumenViajes,
} from '@/features/resumen/resumen-parse';
import { RESUMEN_ERROR_INESPERADO, ResumenRespuestaInesperadaError, mensajeErrorResumen } from '@/features/resumen/resumen-textos';
import { isRetryableDataError } from '@/lib/data-errors';

const CAT_A = 'a1000000-0000-4000-8000-000000000001';
const CAT_B = 'a1000000-0000-4000-8000-000000000002';
const CAM_X = 'c1000000-0000-4000-8000-000000000001';
const CAM_W = 'c1000000-0000-4000-8000-000000000002';
const V1 = 'b1000000-0000-4000-8000-000000000001';
const V2 = 'b1000000-0000-4000-8000-000000000002';

/** La fila sin una columna (para probar las que faltan). */
function sin(fila: Record<string, unknown>, campo: string): Record<string, unknown> {
  const copia = { ...fila };
  delete copia[campo];
  return copia;
}

/** Corre `fn` y devuelve el motivo del error de contrato (o falla la prueba si no lo hubo). */
function motivo(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ResumenRespuestaInesperadaError);
    return (error as ResumenRespuestaInesperadaError).motivo;
  }
  throw new Error('se esperaba un error de contrato');
}

// ---------------------------------------------------------------------------
// resumen_gastos
// ---------------------------------------------------------------------------
const total = (over: Record<string, unknown> = {}) => ({ grupo: 'total', clave: null, nombre: null, activa: null, cantidad: 7, monto: 12500.5, ...over });
const categoria = (over: Record<string, unknown> = {}) => ({ grupo: 'categoria', clave: CAT_A, nombre: 'Combustible', activa: null, cantidad: 3, monto: 9000, ...over });
const metodo = (over: Record<string, unknown> = {}) => ({ grupo: 'metodo_pago', clave: 'efectivo', nombre: null, activa: null, cantidad: 2, monto: 500, ...over });
const camion = (over: Record<string, unknown> = {}) => ({ grupo: 'camion', clave: CAM_X, nombre: 'AB123CD', activa: true, cantidad: 4, monto: 9500, ...over });

describe('parseResumenGastos: respuesta válida', () => {
  it('arma el total y los desgloses, en el orden de la base', () => {
    const r = parseResumenGastos([
      total(),
      categoria(),
      categoria({ clave: CAT_B, nombre: 'Peajes', cantidad: 4, monto: 3500.5 }),
      metodo({ clave: null, cantidad: 5, monto: 12000.5 }),
      metodo(),
      camion(),
      camion({ clave: null, nombre: null, activa: null, cantidad: 3, monto: 3000.5 }),
    ]);
    expect(r.total).toEqual({ cantidad: 7, monto: 12500.5 });
    expect(r.porCategoria).toEqual([
      { categoriaId: CAT_A, nombre: 'Combustible', cantidad: 3, monto: 9000 },
      { categoriaId: CAT_B, nombre: 'Peajes', cantidad: 4, monto: 3500.5 },
    ]);
    expect(r.porMetodo).toEqual([
      { metodo: null, cantidad: 5, monto: 12000.5 },
      { metodo: 'efectivo', cantidad: 2, monto: 500 },
    ]);
    expect(r.porCamion).toEqual([
      { camionId: CAM_X, patente: 'AB123CD', activa: true, cantidad: 4, monto: 9500 },
      { camionId: null, patente: null, activa: null, cantidad: 3, monto: 3000.5 },
    ]);
  });

  it('un período sin gastos: SOLO la fila total en 0 y desgloses vacíos', () => {
    expect(parseResumenGastos([total({ cantidad: 0, monto: 0 })])).toEqual({
      total: { cantidad: 0, monto: 0 },
      porCategoria: [],
      porMetodo: [],
      porCamion: [],
    });
  });

  it('los numeric pueden llegar como texto (según PostgREST); los ids, en mayúsculas', () => {
    const r = parseResumenGastos([total({ monto: '12500.50', cantidad: '7' }), categoria({ clave: CAT_A.toUpperCase(), monto: '9000.00' })]);
    expect(r.total).toEqual({ cantidad: 7, monto: 12500.5 });
    expect(r.porCategoria[0]).toMatchObject({ categoriaId: CAT_A, monto: 9000 });
  });

  it('camión archivado: activa false', () => {
    expect(parseResumenGastos([total(), camion({ activa: false })]).porCamion[0]!.activa).toBe(false);
  });

  it('los cuatro métodos de pago conocidos', () => {
    const r = parseResumenGastos([
      total(),
      ...['efectivo', 'tarjeta_credito', 'tarjeta_debito', 'transferencia'].map((clave) => metodo({ clave })),
    ]);
    expect(r.porMetodo.map((fila) => fila.metodo)).toEqual(['efectivo', 'tarjeta_credito', 'tarjeta_debito', 'transferencia']);
  });

  it('columnas de más se ignoran', () => {
    expect(parseResumenGastos([total({ extra: 'x' })]).total).toEqual({ cantidad: 7, monto: 12500.5 });
  });
});

describe('parseResumenGastos: fuera de contrato -> error (nunca datos a medias)', () => {
  it.each([
    ['no es una lista', { filas: [] }, 'la respuesta no es una lista de filas'],
    ['null', null, 'la respuesta no es una lista de filas'],
    ['fila que no es objeto', [total(), 'x'], 'la fila 1 no es un objeto'],
    ['fila que es una lista', [total(), []], 'la fila 1 no es un objeto'],
    ['sin fila total', [categoria()], 'falta la fila total'],
    ['lista vacía (sin total)', [], 'falta la fila total'],
    ['dos filas total', [total(), total()], 'más de una fila total'],
    ['grupo desconocido', [total(), { ...categoria(), grupo: 'proveedor' }], 'grupo desconocido'],
    ['grupo con mayúsculas', [total(), { ...categoria(), grupo: 'Categoria' }], 'grupo desconocido'],
    ['grupo toString', [total(), { ...categoria(), grupo: 'toString' }], 'grupo desconocido'],
    ['grupo nulo', [total(), { ...categoria(), grupo: null }], 'grupo desconocido'],
    ['método de pago desconocido', [total(), metodo({ clave: 'cheque' })], 'método de pago desconocido'],
    ['método de pago como número', [total(), metodo({ clave: 1 })], 'clave no es un texto'],
    ['monto NaN', [total({ monto: Number.NaN })], 'monto no es un número'],
    ['monto Infinity', [total({ monto: Number.POSITIVE_INFINITY })], 'monto no es un número'],
    ['monto texto raro', [total({ monto: '1e3' })], 'monto no es un número'],
    ['monto hex', [total({ monto: '0x10' })], 'monto no es un número'],
    ['monto con espacios', [total({ monto: ' 12 ' })], 'monto no es un número'],
    ['monto nulo', [total({ monto: null })], 'monto no es un número'],
    ['monto negativo', [total({ monto: -1 })], 'monto es menor que 0'],
    ['cantidad con decimales', [total({ cantidad: 1.5 })], 'cantidad no es un entero'],
    ['cantidad negativa', [total({ cantidad: -1 })], 'cantidad es menor que 0'],
    ['categoría con cantidad 0', [total(), categoria({ cantidad: 0 })], 'cantidad es menor que 1'],
    ['total con clave', [total({ clave: CAT_A })], 'clave tendría que ser nulo'],
    ['total sin la columna activa', [{ grupo: 'total', clave: null, nombre: null, cantidad: 1, monto: 1 }], 'activa tendría que ser nulo'],
    ['categoría sin id', [total(), categoria({ clave: null })], 'clave no es un uuid'],
    ['categoría con id que no es uuid', [total(), categoria({ clave: '42' })], 'clave no es un uuid'],
    ['categoría sin nombre', [total(), categoria({ nombre: null })], 'nombre no es un texto'],
    ['categoría con nombre vacío', [total(), categoria({ nombre: '  ' })], 'nombre está vacío'],
    ['categoría repetida', [total(), categoria(), categoria()], 'categoría repetido'],
    ['método repetido', [total(), metodo({ clave: null }), metodo({ clave: null })], 'método de pago repetido'],
    ['camión con id y patente nula', [total(), camion({ nombre: null })], 'nombre no es un texto'],
    ['camión con id y patente vacía', [total(), camion({ nombre: '' })], 'nombre está vacío'],
    ['camión con id y patente de solo espacios', [total(), camion({ nombre: '   ' })], 'nombre está vacío'],
    ['camión con id y activa nula', [total(), camion({ activa: null })], 'activa no es verdadero o falso'],
    ['"sin camión" con patente', [total(), camion({ clave: null })], 'nombre tendría que ser nulo'],
    ['camión repetido', [total(), camion(), camion()], 'camión repetido'],
    ['dos "sin camión"', [total(), camion({ clave: null, nombre: null, activa: null }), camion({ clave: null, nombre: null, activa: null })], 'camión repetido'],
  ])('%s', (_caso, datos, esperado) => {
    expect(motivo(() => parseResumenGastos(datos))).toBe(esperado);
  });

  it('el error se muestra como "inesperado" y se puede reintentar', () => {
    let error: unknown = null;
    try {
      parseResumenGastos({});
    } catch (failure) {
      error = failure;
    }
    expect(mensajeErrorResumen(error)).toBe(RESUMEN_ERROR_INESPERADO);
    expect(isRetryableDataError(error)).toBe(true);
    expect((error as ResumenRespuestaInesperadaError).rpc).toBe('resumen_gastos');
  });
});

// ---------------------------------------------------------------------------
// resumen_mensual
// ---------------------------------------------------------------------------
const fila = (mes: string, over: Record<string, unknown> = {}) => ({
  mes,
  gastos_cantidad: 10,
  gastos_monto: 50000,
  combustible_cargas: 3,
  combustible_litros: 300.25,
  combustible_monto: 30000,
  viajes_cantidad: 4,
  viajes_km: 1250.5,
  viajes_con_ingreso: 3,
  viajes_sin_ingreso: 1,
  viajes_ingreso: 90000,
  resultado: 40000,
  ...over,
});
const vacio = (mes: string) =>
  fila(mes, {
    gastos_cantidad: 0,
    gastos_monto: 0,
    combustible_cargas: 0,
    combustible_litros: 0,
    combustible_monto: 0,
    viajes_cantidad: 0,
    viajes_km: 0,
    viajes_con_ingreso: 0,
    viajes_sin_ingreso: 0,
    viajes_ingreso: 0,
    resultado: null,
  });
const OCT = { mesDesde: { year: 2026, month: 10 }, meses: 1 };

describe('parseResumenMensual', () => {
  it('una fila válida', () => {
    expect(parseResumenMensual([fila('2026-10-01')], OCT)).toEqual([
      {
        mes: '2026-10-01',
        gastosCantidad: 10,
        gastosMonto: 50000,
        combustibleCargas: 3,
        combustibleLitros: 300.25,
        combustibleMonto: 30000,
        viajesCantidad: 4,
        viajesKm: 1250.5,
        viajesConIngreso: 3,
        viajesSinIngreso: 1,
        viajesIngreso: 90000,
        resultado: 40000,
      },
    ]);
  });

  it('resultado NULL cuando ningún viaje tiene ingreso (y la fila vacía de un mes sin nada)', () => {
    expect(parseResumenMensual([vacio('2026-10-01')], OCT)[0]!.resultado).toBeNull();
    expect(parseResumenMensual([fila('2026-10-01', { viajes_con_ingreso: 0, viajes_sin_ingreso: 4, viajes_ingreso: 0, resultado: null })], OCT)[0]!.resultado).toBeNull();
  });

  it('resultado negativo (pérdida) y un ingreso 0 cargado', () => {
    expect(parseResumenMensual([fila('2026-10-01', { resultado: -15000.5 })], OCT)[0]!.resultado).toBe(-15000.5);
    expect(parseResumenMensual([fila('2026-10-01', { viajes_ingreso: 0, resultado: -50000 })], OCT)[0]!.viajesIngreso).toBe(0);
  });

  it('12 meses de un año, en orden', () => {
    const meses = Array.from({ length: 12 }, (_, i) => vacio(`2026-${String(i + 1).padStart(2, '0')}-01`));
    expect(parseResumenMensual(meses, { mesDesde: { year: 2026, month: 1 }, meses: 12 }).map((m) => m.mes)).toHaveLength(12);
  });

  it.each([
    ['menos filas que meses', [], 'se esperaban 1 meses y llegaron 0'],
    ['más filas que meses', [fila('2026-10-01'), fila('2026-11-01')], 'se esperaban 1 meses y llegaron 2'],
    ['otro mes', [fila('2026-09-01')], 'el mes 0 no es 2026-10-01'],
    ['mes que no es el día 1', [fila('2026-10-02')], 'el mes 0 no es 2026-10-01'],
    ['mes inválido', [fila('2026-10-32')], 'mes no es una fecha'],
    ['resultado presente sin viajes con ingreso', [fila('2026-10-01', { viajes_con_ingreso: 0, viajes_sin_ingreso: 4 })], 'resultado no coincide con los viajes con ingreso'],
    ['resultado NULL con viajes con ingreso', [fila('2026-10-01', { resultado: null })], 'resultado no coincide con los viajes con ingreso'],
    ['falta la columna resultado', [sin(fila('2026-10-01'), 'resultado')], 'falta resultado'],
    ['viajes que no suman', [fila('2026-10-01', { viajes_sin_ingreso: 2 })], 'los viajes con y sin ingreso no suman el total'],
    ['gastos_monto negativo', [fila('2026-10-01', { gastos_monto: -1 })], 'gastos_monto es menor que 0'],
    ['litros nulos', [fila('2026-10-01', { combustible_litros: null })], 'combustible_litros no es un número'],
    ['cargas con decimales', [fila('2026-10-01', { combustible_cargas: 2.5 })], 'combustible_cargas no es un entero'],
    ['resultado no numérico', [fila('2026-10-01', { resultado: 'mucho' })], 'resultado no es un número'],
  ])('%s', (_caso, datos, esperado) => {
    expect(motivo(() => parseResumenMensual(datos, OCT))).toBe(esperado);
  });

  it('meses desordenados en una serie', () => {
    expect(motivo(() => parseResumenMensual([vacio('2026-02-01'), vacio('2026-01-01')], { mesDesde: { year: 2026, month: 1 }, meses: 2 }))).toBe(
      'el mes 0 no es 2026-01-01',
    );
  });
});

// ---------------------------------------------------------------------------
// resumen_combustible
// ---------------------------------------------------------------------------
const comb = (over: Record<string, unknown> = {}) => ({
  camion_id: CAM_X,
  patente: 'AB123CD',
  activa: true,
  cargas: 4,
  litros: 520.5,
  monto: 520500,
  precio_promedio: 1000,
  llenas_con_odometro: 3,
  tramos: 2,
  tramos_km: 1500,
  tramos_litros: 500,
  tramos_monto: 500000,
  km_por_litro: 3,
  litros_100km: 33.33,
  costo_por_km: 333.33,
  descartados_retroceso: 0,
  descartados_sin_avance: 1,
  descartados_fuera_de_rango: 0,
  ...over,
});
const sinTramos = (over: Record<string, unknown> = {}) =>
  comb({ tramos: 0, tramos_km: null, tramos_litros: null, tramos_monto: null, km_por_litro: null, litros_100km: null, costo_por_km: null, ...over });

describe('parseResumenCombustible', () => {
  it('un camión con tramos válidos', () => {
    expect(parseResumenCombustible([comb()])).toEqual([
      {
        camionId: CAM_X,
        patente: 'AB123CD',
        activa: true,
        cargas: 4,
        litros: 520.5,
        monto: 520500,
        precioPromedio: 1000,
        llenasConOdometro: 3,
        tramos: 2,
        tramosKm: 1500,
        tramosLitros: 500,
        tramosMonto: 500000,
        kmPorLitro: 3,
        litros100km: 33.33,
        costoPorKm: 333.33,
        descartados: { retroceso: 0, sinAvance: 1, fueraDeRango: 0 },
      },
    ]);
  });

  it('sin tramos válidos: todo lo del rendimiento en null, y los descartes contados', () => {
    const [fila0] = parseResumenCombustible([sinTramos({ descartados_retroceso: 1, descartados_fuera_de_rango: 2 })]);
    expect(fila0).toMatchObject({ tramos: 0, tramosKm: null, kmPorLitro: null, litros100km: null, costoPorKm: null });
    expect(fila0!.descartados).toEqual({ retroceso: 1, sinAvance: 1, fueraDeRango: 2 });
  });

  it('un camión sin cargas en el período pero con un tramo que cierra en él (o solo descartes): precio null', () => {
    const [fila0] = parseResumenCombustible([sinTramos({ cargas: 0, litros: 0, monto: 0, precio_promedio: null, llenas_con_odometro: 0 })]);
    expect(fila0!.precioPromedio).toBeNull();
  });

  it('archivado, varios camiones, sin filas', () => {
    expect(parseResumenCombustible([comb(), comb({ camion_id: CAM_W, patente: 'ABC123', activa: false })]).map((f) => f.activa)).toEqual([true, false]);
    expect(parseResumenCombustible([])).toEqual([]);
  });

  it('con un camión pedido: solo filas de ese camión', () => {
    expect(parseResumenCombustible([comb()], { camionId: CAM_X })).toHaveLength(1);
    expect(motivo(() => parseResumenCombustible([comb({ camion_id: CAM_W })], { camionId: CAM_X }))).toBe('fila de otro camión');
  });

  it.each([
    ['km/L nulo con tramos', [comb({ km_por_litro: null })], 'tramos sin rendimiento'],
    ['costo por km nulo con tramos', [comb({ costo_por_km: null })], 'tramos sin rendimiento'],
    ['L/100 km presente sin tramos', [sinTramos({ litros_100km: 33 })], 'rendimiento sin tramos'],
    ['precio nulo con cargas', [comb({ precio_promedio: null })], 'precio_promedio no coincide con las cargas'],
    ['precio presente sin cargas', [comb({ cargas: 0 })], 'precio_promedio no coincide con las cargas'],
    ['cargas sin litros', [comb({ litros: 0 })], 'cargas sin litros'],
    ['camión sin id', [comb({ camion_id: null })], 'camion_id no es un uuid'],
    ['patente nula', [comb({ patente: null })], 'patente no es un texto'],
    ['patente vacía', [comb({ patente: '' })], 'patente está vacío'],
    ['patente de solo espacios', [comb({ patente: '  ' })], 'patente está vacío'],
    ['activa nula', [comb({ activa: null })], 'activa no es verdadero o falso'],
    ['activa como texto', [comb({ activa: 'true' })], 'activa no es verdadero o falso'],
    ['tramos negativo', [comb({ tramos: -1 })], 'tramos es menor que 0'],
    ['descartes con decimales', [comb({ descartados_retroceso: 0.5 })], 'descartados_retroceso no es un entero'],
    ['falta una columna de descarte', [sin(comb(), 'descartados_sin_avance')], 'descartados_sin_avance no es un número'],
    ['falta km_por_litro', [sin(comb(), 'km_por_litro')], 'falta km_por_litro'],
    ['camión repetido', [comb(), comb()], 'camión repetido'],
    ['km/L negativo', [comb({ km_por_litro: -3 })], 'km_por_litro es menor que 0'],
  ])('%s', (_caso, datos, esperado) => {
    expect(motivo(() => parseResumenCombustible(datos))).toBe(esperado);
  });
});

// ---------------------------------------------------------------------------
// resumen_viajes
// ---------------------------------------------------------------------------
const viaje = (over: Record<string, unknown> = {}) => ({
  viaje_id: V1,
  fecha: '2026-10-12',
  origen: 'Rosario',
  destino: 'Córdoba',
  camion_id: CAM_X,
  patente: 'AB123CD',
  km: 400,
  ingreso: 150000,
  gastos_cantidad: 2,
  gastos_monto: 30000,
  ganancia: 120000,
  total_viajes: 2,
  ...over,
});

describe('parseResumenViajes', () => {
  it('viajes válidos, con y sin ingreso, con y sin camión ni km', () => {
    const r = parseResumenViajes([
      viaje(),
      viaje({ viaje_id: V2, camion_id: null, patente: null, km: null, ingreso: null, ganancia: null, gastos_cantidad: 0, gastos_monto: 0 }),
    ]);
    expect(r.total).toBe(2);
    expect(r.cortada).toBe(false);
    expect(r.viajes[0]).toEqual({
      viajeId: V1,
      fecha: '2026-10-12',
      origen: 'Rosario',
      destino: 'Córdoba',
      camionId: CAM_X,
      patente: 'AB123CD',
      km: 400,
      ingreso: 150000,
      gastosCantidad: 2,
      gastosMonto: 30000,
      ganancia: 120000,
    });
    expect(r.viajes[1]).toMatchObject({ camionId: null, patente: null, km: null, ingreso: null, ganancia: null });
  });

  it('un ingreso 0 sí cuenta: ganancia = −gastos', () => {
    expect(parseResumenViajes([viaje({ ingreso: 0, ganancia: -30000, total_viajes: 1 })]).viajes[0]!.ganancia).toBe(-30000);
  });

  it('sin viajes: lista vacía, total 0', () => {
    expect(parseResumenViajes([])).toEqual({ viajes: [], total: 0, cortada: false });
  });

  it('la lista cortada: total_viajes mayor que las filas', () => {
    const r = parseResumenViajes([viaje({ total_viajes: 640 })]);
    expect(r).toMatchObject({ total: 640, cortada: true });
  });

  it.each([
    ['ganancia sin ingreso', [viaje({ ingreso: null, total_viajes: 1 })], 'ganancia no coincide con el ingreso'],
    ['ingreso sin ganancia', [viaje({ ganancia: null, total_viajes: 1 })], 'ganancia no coincide con el ingreso'],
    ['camión con patente nula', [viaje({ patente: null, total_viajes: 1 })], 'patente no es un texto'],
    ['camión con patente vacía', [viaje({ patente: '', total_viajes: 1 })], 'patente está vacío'],
    ['camión con patente de solo espacios', [viaje({ patente: ' ', total_viajes: 1 })], 'patente está vacío'],
    ['sin camión pero con patente', [viaje({ camion_id: null, total_viajes: 1 })], 'patente tendría que ser nulo'],
    ['total distinto entre filas', [viaje(), viaje({ viaje_id: V2, total_viajes: 3 })], 'total_viajes distinto entre filas'],
    ['total menor que las filas', [viaje({ total_viajes: 1 }), viaje({ viaje_id: V2, total_viajes: 1 })], 'total_viajes menor que las filas'],
    ['total 0 con filas', [viaje({ total_viajes: 0 })], 'total_viajes es menor que 1'],
    ['viaje repetido', [viaje(), viaje()], 'viaje repetido'],
    ['fecha inválida', [viaje({ fecha: '2026-02-30', total_viajes: 1 })], 'fecha no es una fecha'],
    ['origen nulo', [viaje({ origen: null, total_viajes: 1 })], 'origen no es un texto'],
    ['km negativo', [viaje({ km: -5, total_viajes: 1 })], 'km es menor que 0'],
    ['falta km', [sin(viaje({ total_viajes: 1 }), 'km')], 'falta km'],
    ['viaje sin uuid', [viaje({ viaje_id: 'v1', total_viajes: 1 })], 'viaje_id no es un uuid'],
  ])('%s', (_caso, datos, esperado) => {
    expect(motivo(() => parseResumenViajes(datos))).toBe(esperado);
  });

  it('más de 500 filas es fuera de contrato', () => {
    const filas = Array.from({ length: 501 }, (_, i) => viaje({ viaje_id: `b1000000-0000-4000-8000-${String(i).padStart(12, '0')}`, total_viajes: 600 }));
    expect(motivo(() => parseResumenViajes(filas))).toBe('más de 500 filas');
  });
});
