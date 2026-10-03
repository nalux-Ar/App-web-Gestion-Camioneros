import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock de supabase: registra cada pedido (tabla o función + operaciones encadenadas) y responde según lo que
// defina cada test. TODO lo demás es código REAL del proyecto.
type Op = { m: string; args: unknown[] };
type Call = { target: string; ops: Op[] };

const h = vi.hoisted(() => {
  const calls: Array<{ target: string; ops: Array<{ m: string; args: unknown[] }> }> = [];
  const state = { responder: null as null | ((call: { target: string; ops: Array<{ m: string; args: unknown[] }> }) => unknown) };
  function builder(target: string, firstOp?: { m: string; args: unknown[] }) {
    const call = { target, ops: firstOp ? [firstOp] : ([] as Array<{ m: string; args: unknown[] }>) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {};
    for (const m of ['select', 'update', 'insert', 'delete', 'eq', 'abortSignal', 'order', 'limit', 'gte', 'lt', 'maybeSingle', 'single']) {
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

import { DataRequestError, RecordNotFoundError, classifyDataError, isRetryableDataError, mapDataError } from '@/lib/data-errors';
import { ELIMINAR_VIAJE_CONTEXT, GUARDAR_VIAJE_CONTEXT } from '@/features/viajes/constants';
import { buildActualizarArgs, buildCrearArgs } from '@/features/viajes/viaje-save';
import { eliminarViaje, fetchViaje, fetchViajesDelRango, viajeWriteIO } from '@/features/viajes/viajes-api';

const ok = (data: unknown) => ({ data, error: null, status: 200 });
const fail = (code: string, message = 'falla', status = 400) => ({ data: null, error: { code, message, details: '', hint: '' }, status });

const VIAJE_ID = '33333333-3333-4333-8333-333333333333';
const REF = '55555555-5555-4555-8555-555555555555';
const columns = {
  fecha: '2026-10-02',
  origen: 'Rosario',
  destino: 'Córdoba',
  km_inicial: null,
  km_final: null,
  km_recorridos: null,
  observaciones: null,
  ingreso: null,
};

const ops = (call: Call) => call.ops.map((o) => o.m);
const op = (call: Call, m: string) => call.ops.filter((o) => o.m === m);

beforeEach(() => {
  h.calls.length = 0;
  h.state.responder = null;
});

describe('eliminarViaje', () => {
  it('DELETE por id con .select("id") y timeout de escritura; 1 fila borrada -> listo', async () => {
    h.state.responder = () => ok([{ id: VIAJE_ID }]);
    await expect(eliminarViaje(VIAJE_ID)).resolves.toBeUndefined();
    const [call] = h.calls;
    expect(call!.target).toBe('viajes');
    expect(ops(call!)).toEqual(['delete', 'eq', 'select', 'abortSignal']);
    expect(op(call!, 'eq')[0]!.args).toEqual(['id', VIAJE_ID]);
    expect(op(call!, 'select')[0]!.args).toEqual(['id']);
    expect(op(call!, 'abortSignal')[0]!.args[0]).toBeInstanceOf(AbortSignal);
  });

  it('0 filas = RecordNotFoundError (el viaje ya no existe)', async () => {
    h.state.responder = () => ok([]);
    await expect(eliminarViaje(VIAJE_ID)).rejects.toBeInstanceOf(RecordNotFoundError);
  });

  it('23503 (gastos vinculados, FK RESTRICT): se traduce POR EL CONTEXTO del borrado; no es reintentable', async () => {
    h.state.responder = () => fail('23503', 'update or delete on table "viajes" violates foreign key constraint "gastos_viaje_fk" on table "gastos"', 409);
    const error = await eliminarViaje(VIAJE_ID).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(DataRequestError);
    expect(classifyDataError(error)).toBe('foreign-key');
    expect(isRetryableDataError(error)).toBe(false);

    const mensaje = mapDataError(error, ELIMINAR_VIAJE_CONTEXT);
    expect(mensaje).toBe('Este viaje tiene gastos vinculados. Cambia o quita esos gastos antes de borrarlo.');
    expect(mensaje).not.toContain('gastos_viaje_fk'); // nunca el nombre del constraint

    // El MISMO código al GUARDAR significa otra cosa (un cliente inválido): el contexto decide.
    expect(mapDataError(error, GUARDAR_VIAJE_CONTEXT)).toBe('Alguno de los clientes ya no existe: actualiza la lista y elígelo de nuevo.');
    expect(mapDataError(error, GUARDAR_VIAJE_CONTEXT)).not.toBe(mensaje);
  });
});

describe('viajeWriteIO.crear (rpc crear_viaje_con_entregas)', () => {
  it('llama a la función con los argumentos tal cual (null explícito), con timeout de escritura, y devuelve { viajeId, creado }', async () => {
    h.state.responder = () => ok([{ viaje_id: VIAJE_ID, creado: true }]);
    const args = buildCrearArgs({ columns, entregas: [{ id: null, cliente_id: 'c1', incidencias: null }] }, REF);
    const r = await viajeWriteIO.crear(args);
    expect(r).toEqual({ viajeId: VIAJE_ID, creado: true });
    const [call] = h.calls;
    expect(call!.target).toBe('rpc:crear_viaje_con_entregas');
    expect(op(call!, 'rpc')[0]!.args[0]).toEqual(args);
    expect(op(call!, 'rpc')[0]!.args[0]).toHaveProperty('p_km_inicial', null);
    expect(Object.keys(op(call!, 'rpc')[0]!.args[0] as object)).not.toContain('p_camion_id');
    expect(op(call!, 'abortSignal')[0]!.args[0]).toBeInstanceOf(AbortSignal);
  });

  it('creado = false se devuelve tal cual (el flujo de crearViaje lo trata como "ya guardado")', async () => {
    h.state.responder = () => ok([{ viaje_id: VIAJE_ID, creado: false }]);
    await expect(viajeWriteIO.crear(buildCrearArgs({ columns, entregas: [] }, REF))).resolves.toEqual({ viajeId: VIAJE_ID, creado: false });
  });

  it('una respuesta con otra forma (sin filas, varias, campos faltantes) es un error genérico y REINTENTABLE (seguro: el client_ref hace el alta idempotente)', async () => {
    for (const rara of [[], [{ viaje_id: VIAJE_ID, creado: true }, { viaje_id: 'x', creado: true }], [{ viaje_id: VIAJE_ID }], [{ creado: true }], null, {}]) {
      h.state.responder = () => ok(rara);
      const error = await viajeWriteIO.crear(buildCrearArgs({ columns, entregas: [] }, REF)).then(
        () => null,
        (e: unknown) => e,
      );
      expect(error, JSON.stringify(rara)).toBeInstanceOf(DataRequestError);
      expect(isRetryableDataError(error)).toBe(true);
      expect(mapDataError(error, GUARDAR_VIAJE_CONTEXT)).not.toContain('crear_viaje_con_entregas');
    }
  });

  it('un error de la base se propaga con su code', async () => {
    h.state.responder = () => fail('23503', 'Alguno de los clientes no es válido para este transportista');
    await expect(viajeWriteIO.crear(buildCrearArgs({ columns, entregas: [] }, REF))).rejects.toMatchObject({ code: '23503' });
  });
});

describe('viajeWriteIO.actualizar (rpc actualizar_viaje_con_entregas)', () => {
  it('manda el reemplazo completo, con p_camion_id preservado y las entregas con/sin id', async () => {
    h.state.responder = () => ok(null);
    const args = buildActualizarArgs(
      VIAJE_ID,
      'camion-1',
      { columns, entregas: [{ id: 'e1', cliente_id: 'c1', incidencias: null }, { id: null, cliente_id: 'c2', incidencias: 'x' }] },
    );
    await viajeWriteIO.actualizar(args);
    const [call] = h.calls;
    expect(call!.target).toBe('rpc:actualizar_viaje_con_entregas');
    const enviado = op(call!, 'rpc')[0]!.args[0] as Record<string, unknown>;
    expect(enviado).toEqual(args);
    expect(enviado.p_camion_id).toBe('camion-1');
    expect(Object.keys(enviado)).toHaveLength(11);
    expect(op(call!, 'abortSignal')[0]!.args[0]).toBeInstanceOf(AbortSignal);
  });

  it('cada error de la base se traduce a un mensaje en español sin nombres de constraints; los reintentables siguen siéndolo', async () => {
    const casos: Array<{ code: string; mensaje: string; reintentable: boolean }> = [
      { code: '23503', mensaje: 'Alguno de los clientes ya no existe: actualiza la lista y elígelo de nuevo.', reintentable: false },
      { code: 'P0002', mensaje: 'El viaje cambió o ya no existe. Vuelve a la lista y actualízala.', reintentable: false },
      { code: '22023', mensaje: 'Alguno de los datos del viaje no es válido. Revísalos e inténtalo de nuevo.', reintentable: false },
      { code: '23514', mensaje: 'Alguno de los datos del viaje no es válido. Revísalos e inténtalo de nuevo.', reintentable: false },
      { code: '22003', mensaje: 'Alguno de los datos del viaje no es válido. Revísalos e inténtalo de nuevo.', reintentable: false },
      { code: '23502', mensaje: 'Alguno de los datos del viaje no es válido. Revísalos e inténtalo de nuevo.', reintentable: false },
      { code: '42501', mensaje: 'No tienes permiso para hacer esto.', reintentable: false },
    ];
    for (const { code, mensaje, reintentable } of casos) {
      h.state.responder = () => fail(code, 'new row for relation "viajes" violates check constraint "viajes_chk_km_coherentes"');
      const error = await viajeWriteIO.actualizar(buildActualizarArgs(VIAJE_ID, null, { columns, entregas: [] })).then(
        () => null,
        (e: unknown) => e,
      );
      expect(mapDataError(error, GUARDAR_VIAJE_CONTEXT), code).toBe(mensaje);
      expect(isRetryableDataError(error), code).toBe(reintentable);
      expect(mapDataError(error, GUARDAR_VIAJE_CONTEXT)).not.toMatch(/viajes_|chk|constraint/i);
    }
  });
});

describe('clasificación de errores que NO se rompió', () => {
  it('red caída, timeout y errores de servidor siguen siendo reintentables', () => {
    expect(isRetryableDataError({ message: 'TypeError: Failed to fetch', code: '' })).toBe(true);
    expect(isRetryableDataError({ message: 'TimeoutError: signal timed out', code: '' })).toBe(true);
    expect(isRetryableDataError(new DataRequestError({ message: 'x', code: '' }, 503))).toBe(true);
    expect(isRetryableDataError({ message: 'x', code: '40P01' })).toBe(true); // deadlock
    expect(isRetryableDataError({ message: 'x', code: '' })).toBe(true); // desconocido
  });

  it('P0002 es "no encontrado" y no se reintenta; 23505 sigue siendo "unique"; un SQLSTATE sin mapear sigue siendo desconocido', () => {
    expect(classifyDataError({ message: 'x', code: 'P0002' })).toBe('not-found');
    expect(classifyDataError({ message: 'x', code: '23505' })).toBe('unique');
    expect(classifyDataError({ message: 'x', code: 'P0001' })).toBe('unknown');
    expect(isRetryableDataError({ message: 'x', code: 'P0001' })).toBe(true);
    expect(classifyDataError({ message: 'x', code: 'PGRST116' })).toBe('not-found');
  });
});

describe('lecturas', () => {
  it('fetchViaje: una sola consulta por id con las entregas embebidas y ordenadas por (created_at, id); maybeSingle', async () => {
    h.state.responder = () => ok(null);
    const r = await fetchViaje(VIAJE_ID, new AbortController().signal);
    expect(r).toBeNull(); // no existe -> null (pantalla "no encontrado"), no un error
    const [call] = h.calls;
    expect(call!.target).toBe('viajes');
    const select = op(call!, 'select')[0]!.args[0] as string;
    expect(select).toContain('camion_id'); // la edición lo necesita para no borrarlo
    expect(select).toContain('entregas(id, cliente_id, incidencias, created_at)');
    expect(select).not.toContain('client_ref');
    expect(op(call!, 'eq')[0]!.args).toEqual(['id', VIAJE_ID]);
    expect(op(call!, 'order').map((o) => o.args)).toEqual([
      ['created_at', { ascending: true, referencedTable: 'entregas' }],
      ['id', { ascending: true, referencedTable: 'entregas' }],
    ]);
    expect(ops(call!)).toContain('maybeSingle');
    expect(h.calls).toHaveLength(1);
  });

  it('fetchViajesDelRango: embed entregas(count) en la MISMA consulta, rango del mes, orden fecha desc + created_at desc, 501 pedidas', async () => {
    const filas = Array.from({ length: 501 }, (_, i) => ({
      id: `v${i}`,
      fecha: '2026-10-01',
      origen: 'A',
      destino: 'B',
      km_inicial: null,
      km_final: null,
      km_recorridos: null,
      ingreso: null,
      created_at: '2026-10-01T10:00:00Z',
      entregas: [{ count: i % 3 }],
    }));
    h.state.responder = () => ok(filas);
    const r = await fetchViajesDelRango({ desde: '2026-10-01', hasta: '2026-11-01', signal: new AbortController().signal });
    expect(r.items).toHaveLength(500);
    expect(r.truncado).toBe(true);
    expect(r.items[2]!.cantidad_entregas).toBe(2);
    expect(h.calls).toHaveLength(1); // nada de una consulta por viaje
    const [call] = h.calls;
    expect(op(call!, 'select')[0]!.args[0]).toContain('entregas(count)');
    expect(op(call!, 'gte')[0]!.args).toEqual(['fecha', '2026-10-01']);
    expect(op(call!, 'lt')[0]!.args).toEqual(['fecha', '2026-11-01']);
    expect(op(call!, 'order').map((o) => o.args)).toEqual([
      ['fecha', { ascending: false }],
      ['created_at', { ascending: false }],
    ]);
    expect(op(call!, 'limit')[0]!.args).toEqual([501]);
  });

  it('un mes con 500 viajes o menos no está truncado', async () => {
    h.state.responder = () => ok([]);
    const r = await fetchViajesDelRango({ desde: '2026-10-01', hasta: '2026-11-01', signal: new AbortController().signal });
    expect(r).toEqual({ items: [], truncado: false });
  });
});
