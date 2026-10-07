import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock de supabase: registra cada pedido (tabla o rpc + operaciones encadenadas) y responde según cada test.
type Op = { m: string; args: unknown[] };
type Call = { target: string; ops: Op[] };

const h = vi.hoisted(() => {
  const calls: Array<{ target: string; ops: Array<{ m: string; args: unknown[] }> }> = [];
  const state = { responder: null as null | ((call: { target: string; ops: Array<{ m: string; args: unknown[] }> }) => unknown) };
  function builder(target: string, firstOp?: { m: string; args: unknown[] }) {
    const call = { target, ops: firstOp ? [firstOp] : ([] as Array<{ m: string; args: unknown[] }>) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {};
    for (const m of ['select', 'update', 'insert', 'delete', 'eq', 'neq', 'is', 'not', 'abortSignal', 'order', 'limit', 'maybeSingle', 'single']) {
      b[m] = (...args: unknown[]) => {
        call.ops.push({ m, args });
        return b;
      };
    }
    b.then = (onF: (v: unknown) => unknown, onR: (e: unknown) => unknown) => {
      calls.push(call);
      return Promise.resolve()
        .then(() => state.responder?.(call))
        .then(onF, onR);
    };
    return b;
  }
  return {
    calls,
    state,
    from: (table: string) => builder(table),
    rpc: (fn: string, args: unknown) => builder(`rpc:${fn}`, { m: 'rpc', args: [args] }),
  };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from: h.from, rpc: h.rpc } }));

import {
  actualizarCamion,
  cambiarActivaCamion,
  contarCamionesActivos,
  contarGastosAMover,
  contarSinCamion,
  crearCamion,
  fetchCamion,
  fetchCamiones,
} from '@/features/camiones/camiones-api';
import { camionesKeys } from '@/features/camiones/camiones-keys';
import {
  ARCHIVAR_CAMION_CONTEXT,
  CAMIONES_LIMIT,
  GUARDAR_CAMION_CONTEXT,
  PATENTE_REPETIDA_MESSAGE,
} from '@/features/camiones/constants';
import { DataRequestError, RecordNotFoundError, isRetryableDataError, mapDataError } from '@/lib/data-errors';

const ok = (data: unknown) => ({ data, error: null, status: 200 });
const conteo = (count: unknown) => ({ data: null, count, error: null, status: 200 });
const fail = (code: string, message = 'falla', status = 400) => ({ data: null, error: { code, message, details: '', hint: '' }, status });

const CAMION = 'c0000000-0000-4000-8000-000000000001';
const VIAJE = 'b0000000-0000-4000-8000-000000000001';
const signal = () => new AbortController().signal;
const ops = (call: Call) => call.ops.map((o) => o.m);
const op = (call: Call, m: string) => call.ops.filter((o) => o.m === m);
const fila = (over: Record<string, unknown> = {}) => ({ id: CAMION, patente: 'AB123CD', marca: null, modelo: null, anio: null, activa: true, ...over });

beforeEach(() => {
  h.calls.length = 0;
  h.state.responder = null;
});

describe('fetchCamiones', () => {
  it('todos (activos y archivados) con las columnas justas, por patente e id, tope + 1 y la señal de TanStack', async () => {
    h.state.responder = () => ok([]);
    const s = signal();
    await fetchCamiones(s);
    const [call] = h.calls;
    expect(call!.target).toBe('camiones');
    expect(op(call!, 'select')[0]!.args).toEqual(['id, patente, marca, modelo, anio, activa']);
    expect(op(call!, 'order').map((o) => o.args)).toEqual([
      ['patente', { ascending: true }],
      ['id', { ascending: true }],
    ]);
    expect(op(call!, 'limit')[0]!.args).toEqual([CAMIONES_LIMIT + 1]);
    expect(op(call!, 'abortSignal')[0]!.args[0]).toBe(s);
    // Sin filtro por activa: la lista trae también los archivados (para etiquetar registros viejos).
    for (const m of ['eq', 'is', 'insert', 'update', 'delete']) expect(ops(call!)).not.toContain(m);
  });

  it('marca el tope y ordena por patente', async () => {
    h.state.responder = () => ok([fila({ id: 'b', patente: 'ZZ1' }), fila({ id: 'a', patente: 'AA1' })]);
    expect((await fetchCamiones(signal())).items.map((c) => c.id)).toEqual(['a', 'b']);
    h.state.responder = () => ok(Array.from({ length: 101 }, (_, i) => fila({ id: `c${i}`, patente: `P${String(i).padStart(3, '0')}` })));
    const r = await fetchCamiones(signal());
    expect(r.items).toHaveLength(100);
    expect(r.truncado).toBe(true);
  });

  it('un error se propaga como DataRequestError', async () => {
    h.state.responder = () => fail('', 'TypeError: Failed to fetch', 0);
    await expect(fetchCamiones(signal())).rejects.toBeInstanceOf(DataRequestError);
  });
});

describe('fetchCamion', () => {
  it('uno por id con maybeSingle; null si no existe (o es de otro: la base no distingue)', async () => {
    h.state.responder = () => ok(null);
    await expect(fetchCamion(CAMION, signal())).resolves.toBeNull();
    const [call] = h.calls;
    expect(op(call!, 'eq')[0]!.args).toEqual(['id', CAMION]);
    expect(ops(call!)).toContain('maybeSingle');
  });
});

describe('crearCamion (RPC crear_camion)', () => {
  it('manda la patente y solo los opcionales que hay (los vacíos quedan en su default null), con timeout', async () => {
    h.state.responder = () => ok([{ camion_id: CAMION, creado: true, viajes_asignados: 6, gastos_asignados: 2, activa: true }]);
    const r = await crearCamion({ patente: 'AB123CD', marca: 'Scania', modelo: null, anio: 2019 });
    expect(r).toEqual({ camionId: CAMION, creado: true, viajesAsignados: 6, gastosAsignados: 2, activa: true });
    const [call] = h.calls;
    expect(call!.target).toBe('rpc:crear_camion');
    expect(op(call!, 'rpc')[0]!.args[0]).toEqual({ p_patente: 'AB123CD', p_marca: 'Scania', p_anio: 2019 });
    expect(op(call!, 'abortSignal')[0]!.args[0]).toBeInstanceOf(AbortSignal);
  });

  it('solo patente: un solo parámetro; nunca transportista_id ni id', async () => {
    h.state.responder = () => ok([{ camion_id: CAMION, creado: true, viajes_asignados: 0, gastos_asignados: 0, activa: true }]);
    await crearCamion({ patente: 'ABC123', marca: null, modelo: null, anio: null });
    const enviado = op(h.calls[0]!, 'rpc')[0]!.args[0] as Record<string, unknown>;
    expect(enviado).toEqual({ p_patente: 'ABC123' });
  });

  it('creado = false (ya existía) se devuelve tal cual, con activa', async () => {
    h.state.responder = () => ok([{ camion_id: CAMION, creado: false, viajes_asignados: 0, gastos_asignados: 0, activa: false }]);
    await expect(crearCamion({ patente: 'AB123CD', marca: null, modelo: null, anio: null })).resolves.toMatchObject({ creado: false, activa: false });
  });

  it('una respuesta con otra forma es un error genérico y reintentable (seguro: la función es idempotente por patente)', async () => {
    for (const rara of [[], [{ camion_id: CAMION }], [{ camion_id: 1, creado: true, viajes_asignados: 0, gastos_asignados: 0, activa: true }], null, {}]) {
      h.state.responder = () => ok(rara);
      const error = await crearCamion({ patente: 'AB123CD', marca: null, modelo: null, anio: null }).then(() => null, (e: unknown) => e);
      expect(error, JSON.stringify(rara)).toBeInstanceOf(DataRequestError);
      expect(isRetryableDataError(error)).toBe(true);
      expect(mapDataError(error, GUARDAR_CAMION_CONTEXT)).not.toContain('crear_camion');
    }
  });

  it('42501 (no es administrador): mensaje propio, sin reintento', async () => {
    h.state.responder = () => fail('42501', 'Solo el administrador puede crear camiones', 403);
    const error = await crearCamion({ patente: 'AB123CD', marca: null, modelo: null, anio: null }).then(() => null, (e: unknown) => e);
    expect(mapDataError(error, GUARDAR_CAMION_CONTEXT)).toBe('Solo el administrador de la cuenta puede cargar o cambiar camiones.');
    expect(isRetryableDataError(error, GUARDAR_CAMION_CONTEXT)).toBe(false);
  });
});

describe('actualizarCamion y cambiarActivaCamion (UPDATE directo)', () => {
  it('editar: UPDATE por id con las cuatro columnas, select("id") y timeout', async () => {
    h.state.responder = () => ok([{ id: CAMION }]);
    await actualizarCamion(CAMION, { patente: 'AB123CD', marca: 'Scania', modelo: null, anio: null });
    const [call] = h.calls;
    expect(ops(call!)).toEqual(['update', 'eq', 'select', 'abortSignal']);
    expect(op(call!, 'update')[0]!.args[0]).toEqual({ patente: 'AB123CD', marca: 'Scania', modelo: null, anio: null });
    expect(op(call!, 'eq')[0]!.args).toEqual(['id', CAMION]);
  });

  it('nunca manda id, transportista_id ni activa al editar, aunque alguien los cuele', async () => {
    h.state.responder = () => ok([{ id: CAMION }]);
    await actualizarCamion(CAMION, { patente: 'AB123CD', marca: null, modelo: null, anio: null, id: 'x', transportista_id: 't', activa: false } as never);
    expect(op(h.calls[0]!, 'update')[0]!.args[0]).toEqual({ patente: 'AB123CD', marca: null, modelo: null, anio: null });
  });

  it('0 filas (no existe, es de otro o quien edita no es admin) -> RecordNotFoundError', async () => {
    h.state.responder = () => ok([]);
    await expect(actualizarCamion(CAMION, { patente: 'AB123CD', marca: null, modelo: null, anio: null })).rejects.toBeInstanceOf(RecordNotFoundError);
    await expect(cambiarActivaCamion(CAMION, false)).rejects.toBeInstanceOf(RecordNotFoundError);
  });

  it('archivar / reactivar: solo activa', async () => {
    h.state.responder = () => ok([{ id: CAMION }]);
    await cambiarActivaCamion(CAMION, false);
    await cambiarActivaCamion(CAMION, true);
    expect(h.calls.map((c) => op(c, 'update')[0]!.args[0])).toEqual([{ activa: false }, { activa: true }]);
    expect(op(h.calls[0]!, 'eq')[0]!.args).toEqual(['id', CAMION]);
  });

  it('patente repetida (23505) y no normalizada (23514): mensajes propios, sin reintento y sin nombres internos', () => {
    const repetida = new DataRequestError({ code: '23505', message: 'duplicate key value violates unique constraint "camiones_transportista_patente_key"' }, 409);
    expect(mapDataError(repetida, GUARDAR_CAMION_CONTEXT)).toBe(PATENTE_REPETIDA_MESSAGE);
    expect(isRetryableDataError(repetida, GUARDAR_CAMION_CONTEXT)).toBe(false);
    const sinNormalizar = new DataRequestError({ code: '23514', message: 'violates check constraint "camiones_patente_normalizada_chk"' }, 400);
    expect(mapDataError(sinNormalizar, GUARDAR_CAMION_CONTEXT)).toBe('Revisa la patente: solo puede tener letras y números.');
    expect(mapDataError(new RecordNotFoundError(), ARCHIVAR_CAMION_CONTEXT)).toContain('No pudimos cambiar ese camión');
  });
});

describe('conteos (sin traer filas)', () => {
  it('contarSinCamion: viajes sin camión y gastos CON litros sin camión, a la vez', async () => {
    h.state.responder = (call: Call) => conteo(call.target === 'viajes' ? 6 : 2);
    await expect(contarSinCamion(signal())).resolves.toEqual({ viajes: 6, gastos: 2 });
    const viajes = h.calls.find((c) => c.target === 'viajes')!;
    const gastos = h.calls.find((c) => c.target === 'gastos')!;
    expect(op(viajes, 'select')[0]!.args).toEqual(['id', { count: 'exact', head: true }]);
    expect(op(viajes, 'is')[0]!.args).toEqual(['camion_id', null]);
    expect(op(gastos, 'is')[0]!.args).toEqual(['camion_id', null]);
    expect(op(gastos, 'not')[0]!.args).toEqual(['litros', 'is', null]);
  });

  it('contarSinCamion: si cualquiera falla o no trae un número, falla todo', async () => {
    h.state.responder = (call: Call) => (call.target === 'viajes' ? conteo(1) : fail('', 'TypeError: Failed to fetch', 0));
    await expect(contarSinCamion(signal())).rejects.toBeInstanceOf(DataRequestError);
    h.state.responder = () => conteo(null);
    await expect(contarSinCamion(signal())).rejects.toBeInstanceOf(DataRequestError);
  });

  it('contarGastosAMover: los gastos del viaje con OTRO camión (neq deja afuera los que no tienen)', async () => {
    h.state.responder = () => conteo(3);
    await expect(contarGastosAMover(VIAJE, CAMION, signal())).resolves.toBe(3);
    const [call] = h.calls;
    expect(call!.target).toBe('gastos');
    expect(op(call!, 'eq')[0]!.args).toEqual(['viaje_id', VIAJE]);
    expect(op(call!, 'neq')[0]!.args).toEqual(['camion_id', CAMION]);
  });

  it('contarCamionesActivos: camiones con activa = true', async () => {
    h.state.responder = () => conteo(2);
    await expect(contarCamionesActivos(signal())).resolves.toBe(2);
    expect(op(h.calls[0]!, 'eq')[0]!.args).toEqual(['activa', true]);
  });
});

describe('keys', () => {
  const empiezaCon = (key: readonly unknown[], prefijo: readonly unknown[]) => prefijo.every((parte, i) => key[i] === parte);

  it('forma de cada key, todas con el tenant', () => {
    expect(camionesKeys.all('t')).toEqual(['tenant', 't', 'camiones']);
    expect(camionesKeys.list('t')).toEqual(['tenant', 't', 'camiones', 'lista']);
    expect(camionesKeys.detail('t', CAMION)).toEqual(['tenant', 't', 'camiones', 'detalle', CAMION]);
    expect(camionesKeys.sinCamion('t')).toEqual(['tenant', 't', 'camiones', 'conteo-sin-camion']);
    expect(camionesKeys.gastosAMover('t', VIAJE, CAMION)).toEqual(['tenant', 't', 'camiones', 'conteo-gastos-a-mover', VIAJE, CAMION]);
  });

  it('el detalle de edición y los conteos NO cuelgan de la lista (lo que invalidan las mutaciones)', () => {
    for (const key of [camionesKeys.detail('t', CAMION), camionesKeys.sinCamion('t'), camionesKeys.gastosAMover('t', VIAJE, CAMION)]) {
      expect(empiezaCon(key, camionesKeys.list('t'))).toBe(false);
    }
  });

  it('sin tenant falla', () => {
    expect(() => camionesKeys.list('')).toThrow();
  });
});
