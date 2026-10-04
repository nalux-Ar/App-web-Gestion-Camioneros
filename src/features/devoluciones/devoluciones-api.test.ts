import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock de supabase: registra cada pedido (tabla + operaciones encadenadas) y responde según lo que defina cada test.
// TODO lo demás es código REAL del proyecto.
type Op = { m: string; args: unknown[] };
type Call = { target: string; ops: Op[] };

const h = vi.hoisted(() => {
  const calls: Array<{ target: string; ops: Array<{ m: string; args: unknown[] }> }> = [];
  const state = { responder: null as null | ((call: { target: string; ops: Array<{ m: string; args: unknown[] }> }) => unknown) };
  function builder(target: string) {
    const call = { target, ops: [] as Array<{ m: string; args: unknown[] }> };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {};
    for (const m of ['select', 'update', 'insert', 'delete', 'eq', 'gte', 'lt', 'abortSignal', 'order', 'limit', 'maybeSingle', 'single']) {
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
  return { calls, state, from: (table: string) => builder(table) };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from: h.from } }));

import {
  DataRequestError,
  RecordNotFoundError,
  classifyDataError,
  isForeignKeyViolationOf,
  isRetryableDataError,
  mapDataError,
} from '@/lib/data-errors';
import {
  DEVOLUCIONES_CLIENTE_FK,
  DEVOLUCIONES_VIAJE_FK,
  ELIMINAR_DEVOLUCION_CONTEXT,
  GUARDAR_DEVOLUCION_CONTEXT,
  LIST_LIMIT,
} from '@/features/devoluciones/constants';
import {
  actualizarDevolucion,
  devolucionWriteIO,
  eliminarDevolucion,
  fetchDevolucion,
  fetchDevolucionesDelMes,
  fetchDevolucionesDelViaje,
} from '@/features/devoluciones/devoluciones-api';
import { devolucionesKeys } from '@/features/devoluciones/devoluciones-keys';

const ok = (data: unknown) => ({ data, error: null, status: 200 });
const fail = (code: string, message = 'falla', status = 400, details = '') => ({
  data: null,
  error: { code, message, details, hint: '' },
  status,
});

const VIAJE = 'b0000000-0000-4000-8000-000000000001';
const DEV = 'f0000000-0000-4000-8000-000000000001';
const C_1 = 'a0000000-0000-4000-8000-000000000001';
const REF = '55555555-5555-4555-8555-555555555555';
const signal = () => new AbortController().signal;

const ops = (call: Call) => call.ops.map((o) => o.m);
const op = (call: Call, m: string) => call.ops.filter((o) => o.m === m);

beforeEach(() => {
  h.calls.length = 0;
  h.state.responder = null;
});

describe('fetchDevolucionesDelViaje', () => {
  it('pide las del viaje con el cliente embebido (clientes(nombre)): más nueva primero (created_at desc, id desc), 201 pedidas, con la señal de TanStack', async () => {
    h.state.responder = () => ok([]);
    const s = signal();
    await fetchDevolucionesDelViaje(VIAJE, s);
    expect(h.calls).toHaveLength(1);
    const [call] = h.calls;
    expect(call!.target).toBe('devoluciones');
    expect(op(call!, 'select')[0]!.args).toEqual(['id, motivo, descripcion, cliente_id, created_at, clientes(nombre)']);
    expect(op(call!, 'eq')[0]!.args).toEqual(['viaje_id', VIAJE]);
    expect(op(call!, 'order').map((o) => o.args)).toEqual([
      ['created_at', { ascending: false }],
      ['id', { ascending: false }],
    ]);
    expect(op(call!, 'limit')[0]!.args).toEqual([LIST_LIMIT + 1]);
    expect(op(call!, 'limit')[0]!.args).toEqual([201]);
    expect(op(call!, 'abortSignal')[0]!.args[0]).toBe(s);
    // Lectura: nunca `maybeSingle`, ni escrituras.
    for (const m of ['insert', 'update', 'delete', 'maybeSingle']) expect(ops(call!)).not.toContain(m);
  });

  it('no pide columnas de más: ni client_ref, ni viaje_id, ni fecha (es la del viaje)', async () => {
    h.state.responder = () => ok([]);
    await fetchDevolucionesDelViaje(VIAJE, signal());
    const select = op(h.calls[0]!, 'select')[0]!.args[0] as string;
    for (const columna of ['client_ref', 'viaje_id', 'fecha', 'transportista_id']) expect(select).not.toContain(columna);
  });

  it('con 200 o menos no está truncada', async () => {
    h.state.responder = () => ok(Array.from({ length: 200 }, (_, i) => ({ id: `d-${i}` })));
    const r = await fetchDevolucionesDelViaje(VIAJE, signal());
    expect(r.items).toHaveLength(200);
    expect(r.truncado).toBe(false);
  });

  it('con 201 se queda con las primeras 200 (las más nuevas) y avisa que hay más', async () => {
    h.state.responder = () => ok(Array.from({ length: 201 }, (_, i) => ({ id: `d-${i}` })));
    const r = await fetchDevolucionesDelViaje(VIAJE, signal());
    expect(r.items).toHaveLength(200);
    expect(r.items[0]!.id).toBe('d-0');
    expect(r.items[199]!.id).toBe('d-199');
    expect(r.truncado).toBe(true);
  });

  it('un error de la base se propaga como DataRequestError (no queda cacheado como éxito)', async () => {
    h.state.responder = () => fail('', 'TypeError: Failed to fetch', 0);
    await expect(fetchDevolucionesDelViaje(VIAJE, signal())).rejects.toBeInstanceOf(DataRequestError);
  });
});

describe('fetchDevolucionesDelMes', () => {
  const DESDE = '2026-09-01';
  const HASTA = '2026-10-01';

  it('pide las del mes con el cliente y el viaje embebidos (viajes!inner), con la señal de TanStack', async () => {
    h.state.responder = () => ok([]);
    const s = signal();
    await fetchDevolucionesDelMes({ desde: DESDE, hasta: HASTA, signal: s });
    expect(h.calls).toHaveLength(1);
    const [call] = h.calls;
    expect(call!.target).toBe('devoluciones');
    expect(op(call!, 'select')[0]!.args).toEqual([
      'id, motivo, descripcion, cliente_id, viaje_id, created_at, clientes(nombre), viajes!inner(fecha, origen, destino)',
    ]);
    expect(op(call!, 'abortSignal')[0]!.args[0]).toBe(s);
    // Lectura: nunca escrituras ni maybeSingle.
    for (const m of ['insert', 'update', 'delete', 'maybeSingle', 'eq']) expect(ops(call!)).not.toContain(m);
  });

  it('el mes es el de la fecha del VIAJE: filtra por viajes.fecha, desde inclusive y hasta exclusivo (nunca por una fecha propia de la devolución)', async () => {
    h.state.responder = () => ok([]);
    await fetchDevolucionesDelMes({ desde: DESDE, hasta: HASTA, signal: signal() });
    const [call] = h.calls;
    expect(op(call!, 'gte').map((o) => o.args)).toEqual([['viajes.fecha', DESDE]]);
    expect(op(call!, 'lt').map((o) => o.args)).toEqual([['viajes.fecha', HASTA]]);
    // No hay otro filtro por fecha ni por columnas de la devolución.
    expect(ops(call!).filter((m) => m === 'gte' || m === 'lt')).toHaveLength(2);
  });

  it('el rango del mes cruza el año en diciembre (hasta = 1 de enero)', async () => {
    h.state.responder = () => ok([]);
    await fetchDevolucionesDelMes({ desde: '2026-12-01', hasta: '2027-01-01', signal: signal() });
    expect(op(h.calls[0]!, 'gte')[0]!.args).toEqual(['viajes.fecha', '2026-12-01']);
    expect(op(h.calls[0]!, 'lt')[0]!.args).toEqual(['viajes.fecha', '2027-01-01']);
  });

  it('orden en la base: fecha del viaje desc (por la columna del viaje embebido, NO con referencedTable), luego created_at desc y id desc', async () => {
    h.state.responder = () => ok([]);
    await fetchDevolucionesDelMes({ desde: DESDE, hasta: HASTA, signal: signal() });
    const orden = op(h.calls[0]!, 'order').map((o) => o.args);
    expect(orden).toEqual([
      ['viajes(fecha)', { ascending: false }],
      ['created_at', { ascending: false }],
      ['id', { ascending: false }],
    ]);
    // `referencedTable` ordenaría solo las filas embebidas (una por devolución), no las devoluciones.
    for (const [, opciones] of orden) expect(opciones).not.toHaveProperty('referencedTable');
  });

  it('pide 201 (el tope + 1) para saber si hubo más', async () => {
    h.state.responder = () => ok([]);
    await fetchDevolucionesDelMes({ desde: DESDE, hasta: HASTA, signal: signal() });
    expect(op(h.calls[0]!, 'limit')[0]!.args).toEqual([LIST_LIMIT + 1]);
    expect(op(h.calls[0]!, 'limit')[0]!.args).toEqual([201]);
  });

  it('con 200 o menos no está truncada y conserva el orden en que llegó', async () => {
    h.state.responder = () => ok(Array.from({ length: 200 }, (_, i) => ({ id: `d-${i}` })));
    const r = await fetchDevolucionesDelMes({ desde: DESDE, hasta: HASTA, signal: signal() });
    expect(r.items).toHaveLength(200);
    expect(r.items.map((d) => d.id).slice(0, 3)).toEqual(['d-0', 'd-1', 'd-2']);
    expect(r.truncado).toBe(false);
  });

  it('con 201 se queda con las primeras 200 (las más recientes: el orden es de la base) y avisa que hay más', async () => {
    h.state.responder = () => ok(Array.from({ length: 201 }, (_, i) => ({ id: `d-${i}` })));
    const r = await fetchDevolucionesDelMes({ desde: DESDE, hasta: HASTA, signal: signal() });
    expect(r.items).toHaveLength(200);
    expect(r.items[0]!.id).toBe('d-0');
    expect(r.items[199]!.id).toBe('d-199');
    expect(r.truncado).toBe(true);
  });

  it('un error de la base se propaga como DataRequestError (no queda cacheado como éxito)', async () => {
    h.state.responder = () => fail('', 'TypeError: Failed to fetch', 0);
    await expect(fetchDevolucionesDelMes({ desde: DESDE, hasta: HASTA, signal: signal() })).rejects.toBeInstanceOf(DataRequestError);
  });
});

describe('fetchDevolucion', () => {
  it('pide UNA por id Y por viaje (dos .eq), con maybeSingle y la señal de TanStack', async () => {
    h.state.responder = () => ok(null);
    const s = signal();
    await fetchDevolucion(DEV, VIAJE, s);
    const [call] = h.calls;
    expect(call!.target).toBe('devoluciones');
    expect(op(call!, 'select')[0]!.args).toEqual(['id, viaje_id, cliente_id, motivo, descripcion']);
    expect(op(call!, 'eq').map((o) => o.args)).toEqual([
      ['id', DEV],
      ['viaje_id', VIAJE],
    ]);
    expect(ops(call!)).toContain('maybeSingle');
    expect(op(call!, 'abortSignal')[0]!.args[0]).toBe(s);
  });

  it('0 filas (no existe, es de OTRO viaje o de otro transportista: la base no distingue) -> null, no un error', async () => {
    h.state.responder = () => ok(null);
    await expect(fetchDevolucion(DEV, VIAJE, signal())).resolves.toBeNull();
  });

  it('devuelve la fila tal cual', async () => {
    const fila = { id: DEV, viaje_id: VIAJE, cliente_id: C_1, motivo: 'otro', descripcion: 'x' };
    h.state.responder = () => ok(fila);
    await expect(fetchDevolucion(DEV, VIAJE, signal())).resolves.toEqual(fila);
  });

  it('no pide client_ref (no se usa al editar)', async () => {
    h.state.responder = () => ok(null);
    await fetchDevolucion(DEV, VIAJE, signal());
    expect(op(h.calls[0]!, 'select')[0]!.args[0]).not.toContain('client_ref');
  });
});

describe('devolucionWriteIO.insert', () => {
  it('INSERT sin .select(), con timeout de escritura; manda el viaje, el motivo, el cliente, la descripción y el client_ref, y nunca id ni transportista_id', async () => {
    h.state.responder = () => ok(null);
    await devolucionWriteIO.insert({ viaje_id: VIAJE, motivo: 'otro', cliente_id: C_1, descripcion: 'x', client_ref: REF });
    const [call] = h.calls;
    expect(call!.target).toBe('devoluciones');
    expect(ops(call!)).toEqual(['insert', 'abortSignal']);
    expect(op(call!, 'abortSignal')[0]!.args[0]).toBeInstanceOf(AbortSignal);
    expect(op(call!, 'insert')[0]!.args[0]).toEqual({ viaje_id: VIAJE, motivo: 'otro', cliente_id: C_1, descripcion: 'x', client_ref: REF });
  });

  it('aunque alguien arme la fila con un id o transportista_id de más (un spread), no salen', async () => {
    h.state.responder = () => ok(null);
    const conDeMas = { viaje_id: VIAJE, motivo: 'otro', cliente_id: C_1, descripcion: null, client_ref: REF, id: 'x', transportista_id: 'otro-tenant' };
    await devolucionWriteIO.insert(conDeMas as never);
    const enviado = op(h.calls[0]!, 'insert')[0]!.args[0] as Record<string, unknown>;
    expect(enviado).not.toHaveProperty('id');
    expect(enviado).not.toHaveProperty('transportista_id');
    expect(enviado.client_ref).toBe(REF);
  });

  it('un error de la base se propaga con su code y el nombre del constraint (para que el flujo reconozca el 23505 del client_ref)', async () => {
    h.state.responder = () => fail('23505', 'duplicate key value violates unique constraint "devoluciones_transportista_client_ref_uidx"', 409);
    const error = await devolucionWriteIO
      .insert({ viaje_id: VIAJE, motivo: 'otro', cliente_id: C_1, client_ref: REF })
      .then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(DataRequestError);
    expect((error as DataRequestError).code).toBe('23505');
    expect((error as DataRequestError).message).toContain('devoluciones_transportista_client_ref_uidx');
  });
});

describe('devolucionWriteIO.updateByClientRef', () => {
  it('UPDATE ... WHERE client_ref = ? con .select("id") y timeout de escritura; manda solo motivo, cliente y descripción', async () => {
    h.state.responder = () => ok([{ id: DEV }]);
    await devolucionWriteIO.updateByClientRef(REF, { motivo: 'vencimiento', cliente_id: C_1, descripcion: null });
    const [call] = h.calls;
    expect(call!.target).toBe('devoluciones');
    expect(ops(call!)).toEqual(['update', 'eq', 'select', 'abortSignal']);
    expect(op(call!, 'eq')[0]!.args).toEqual(['client_ref', REF]);
    expect(op(call!, 'select')[0]!.args).toEqual(['id']);
    expect(op(call!, 'abortSignal')[0]!.args[0]).toBeInstanceOf(AbortSignal);
    expect(op(call!, 'update')[0]!.args[0]).toEqual({ motivo: 'vencimiento', cliente_id: C_1, descripcion: null });
  });

  it('el client_ref es inmutable: aunque alguien lo cuele en lo que cambia (junto con id y transportista_id), NO sale en el UPDATE', async () => {
    h.state.responder = () => ok([{ id: DEV }]);
    const conDeMas = { motivo: 'vencimiento', client_ref: 'otro', id: 'x', transportista_id: 't' };
    await devolucionWriteIO.updateByClientRef(REF, conDeMas as never);
    const enviado = op(h.calls[0]!, 'update')[0]!.args[0] as Record<string, unknown>;
    expect(enviado).toEqual({ motivo: 'vencimiento' });
    expect(enviado).not.toHaveProperty('client_ref');
    expect(enviado).not.toHaveProperty('id');
    expect(enviado).not.toHaveProperty('transportista_id');
  });

  it('0 filas -> RecordNotFoundError', async () => {
    h.state.responder = () => ok([]);
    await expect(devolucionWriteIO.updateByClientRef(REF, { descripcion: 'x' })).rejects.toBeInstanceOf(RecordNotFoundError);
  });
});

describe('actualizarDevolucion', () => {
  it('UPDATE por id (nunca upsert) con .select("id") y timeout de escritura', async () => {
    h.state.responder = () => ok([{ id: DEV }]);
    await expect(actualizarDevolucion(DEV, { motivo: 'otro', cliente_id: C_1, descripcion: 'x' })).resolves.toBeUndefined();
    const [call] = h.calls;
    expect(call!.target).toBe('devoluciones');
    expect(ops(call!)).toEqual(['update', 'eq', 'select', 'abortSignal']);
    expect(op(call!, 'eq')[0]!.args).toEqual(['id', DEV]);
    expect(op(call!, 'select')[0]!.args).toEqual(['id']);
    expect(op(call!, 'abortSignal')[0]!.args[0]).toBeInstanceOf(AbortSignal);
    expect(op(call!, 'update')[0]!.args[0]).toEqual({ motivo: 'otro', cliente_id: C_1, descripcion: 'x' });
  });

  it('0 filas (ya no existe, o no es de este transportista) -> RecordNotFoundError', async () => {
    h.state.responder = () => ok([]);
    await expect(actualizarDevolucion(DEV, { descripcion: 'x' })).rejects.toBeInstanceOf(RecordNotFoundError);
  });
});

describe('eliminarDevolucion', () => {
  it('DELETE por id con .select("id") y timeout de escritura; devuelve cuántas borró', async () => {
    h.state.responder = () => ok([{ id: DEV }]);
    await expect(eliminarDevolucion(DEV)).resolves.toBe(1);
    const [call] = h.calls;
    expect(call!.target).toBe('devoluciones');
    expect(ops(call!)).toEqual(['delete', 'eq', 'select', 'abortSignal']);
    expect(op(call!, 'eq')[0]!.args).toEqual(['id', DEV]);
    expect(op(call!, 'select')[0]!.args).toEqual(['id']);
    expect(op(call!, 'abortSignal')[0]!.args[0]).toBeInstanceOf(AbortSignal);
  });

  it('0 filas = 0 (ya no estaba): NO es un error, para un borrado es lo mismo que éxito', async () => {
    h.state.responder = () => ok([]);
    await expect(eliminarDevolucion(DEV)).resolves.toBe(0);
  });

  it('un error de la base se propaga', async () => {
    h.state.responder = () => fail('', 'TypeError: Failed to fetch', 0);
    await expect(eliminarDevolucion(DEV)).rejects.toBeInstanceOf(DataRequestError);
  });
});

describe('errores al guardar: el 23503 se distingue por el nombre del constraint y el nombre nunca se muestra', () => {
  const fk = (constraint: string) =>
    new DataRequestError(
      { code: '23503', message: `insert or update on table "devoluciones" violates foreign key constraint "${constraint}"`, details: '' },
      409,
    );

  it('devoluciones_cliente_fk -> "El cliente elegido ya no existe. Elige otro."', () => {
    const error = fk(DEVOLUCIONES_CLIENTE_FK);
    expect(mapDataError(error, GUARDAR_DEVOLUCION_CONTEXT)).toBe('El cliente elegido ya no existe. Elige otro.');
    expect(isForeignKeyViolationOf(error, DEVOLUCIONES_CLIENTE_FK)).toBe(true);
    expect(isForeignKeyViolationOf(error, DEVOLUCIONES_VIAJE_FK)).toBe(false);
  });

  it('devoluciones_viaje_fk -> "Este viaje ya no existe. Vuelve a la lista de viajes."', () => {
    const error = fk(DEVOLUCIONES_VIAJE_FK);
    expect(mapDataError(error, GUARDAR_DEVOLUCION_CONTEXT)).toBe('Este viaje ya no existe. Vuelve a la lista de viajes.');
    expect(isForeignKeyViolationOf(error, DEVOLUCIONES_VIAJE_FK)).toBe(true);
    expect(isForeignKeyViolationOf(error, DEVOLUCIONES_CLIENTE_FK)).toBe(false);
  });

  it('el constraint también se reconoce en `details`', () => {
    const error = new DataRequestError({ code: '23503', message: 'violates foreign key', details: `Key is not present ... "${DEVOLUCIONES_CLIENTE_FK}"` }, 409);
    expect(mapDataError(error, GUARDAR_DEVOLUCION_CONTEXT)).toBe('El cliente elegido ya no existe. Elige otro.');
  });

  it('un 23503 de otro constraint (o sin nombre) cae en un mensaje genérico, sin nombres', () => {
    for (const error of [fk('devoluciones_transportista_id_fkey'), fk('devoluciones_cliente_fk_viejo'), new DataRequestError({ code: '23503', message: 'violates foreign key' }, 409)]) {
      const mensaje = mapDataError(error, GUARDAR_DEVOLUCION_CONTEXT);
      expect(mensaje).toBe('Alguno de los datos de la devolución ya no existe. Vuelve al viaje y revisa.');
      expect(mensaje).not.toContain('devoluciones_');
    }
  });

  it('ningún mensaje de un 23503 muestra el nombre del constraint ni "foreign key"', () => {
    for (const constraint of [DEVOLUCIONES_CLIENTE_FK, DEVOLUCIONES_VIAJE_FK]) {
      const mensaje = mapDataError(fk(constraint), GUARDAR_DEVOLUCION_CONTEXT);
      expect(mensaje).not.toContain(constraint);
      expect(mensaje.toLowerCase()).not.toContain('foreign key');
      expect(mensaje).not.toContain('violates');
    }
  });

  it('un 23503 al guardar NO se reintenta (daría lo mismo): hay que elegir otro cliente o volver', () => {
    for (const constraint of [DEVOLUCIONES_CLIENTE_FK, DEVOLUCIONES_VIAJE_FK]) {
      expect(isRetryableDataError(fk(constraint), GUARDAR_DEVOLUCION_CONTEXT)).toBe(false);
    }
  });

  it('23514, 22P02 y 23502 -> "datos no válidos", sin texto del servidor, y sin reintento', () => {
    for (const [code, message] of [
      ['23514', 'new row for relation "devoluciones" violates check constraint "devoluciones_descripcion_chk"'],
      ['22P02', 'invalid input value for enum motivo_devolucion: "robo"'],
      ['23502', 'null value in column "motivo" of relation "devoluciones" violates not-null constraint'],
    ] as const) {
      const error = new DataRequestError({ code, message }, 400);
      expect(classifyDataError(error), code).toBe('invalid-data');
      const mensaje = mapDataError(error, GUARDAR_DEVOLUCION_CONTEXT);
      expect(mensaje, code).toBe('Alguno de los datos de la devolución no es válido. Revísalos e inténtalo de nuevo.');
      expect(mensaje, code).not.toContain('devoluciones');
      expect(mensaje, code).not.toContain('motivo');
      expect(mensaje, code).not.toContain('enum');
      expect(isRetryableDataError(error, GUARDAR_DEVOLUCION_CONTEXT), code).toBe(false);
    }
  });

  it('red caída y timeout siguen siendo reintentables (el reintento usa el mismo client_ref)', () => {
    expect(isRetryableDataError(new DataRequestError({ code: '', message: 'TypeError: Failed to fetch' }, 0), GUARDAR_DEVOLUCION_CONTEXT)).toBe(true);
    expect(isRetryableDataError(new DataRequestError({ code: '', message: 'TimeoutError: signal timed out' }, 0), GUARDAR_DEVOLUCION_CONTEXT)).toBe(true);
  });

  it('el UPDATE por client_ref sin filas (la guardada ya no está) dice que se guarde de nuevo', () => {
    expect(mapDataError(new RecordNotFoundError(), GUARDAR_DEVOLUCION_CONTEXT)).toBe(
      'La devolución que se había guardado ya no está. Toca "Guardar devolución" para guardarla de nuevo.',
    );
  });

  it('al eliminar hay su propio mensaje de FK', () => {
    expect(mapDataError(fk('lo_que_sea'), ELIMINAR_DEVOLUCION_CONTEXT)).toBe(
      'No se puede eliminar esta devolución porque está vinculada a otros datos.',
    );
  });
});

describe('keys: todas empiezan con el tenant y las listas cuelgan de un prefijo propio de devoluciones', () => {
  it('forma de cada key', () => {
    expect(devolucionesKeys.all('t')).toEqual(['tenant', 't', 'devoluciones']);
    expect(devolucionesKeys.delosViajes('t')).toEqual(['tenant', 't', 'devoluciones', 'viaje']);
    expect(devolucionesKeys.delViaje('t', VIAJE)).toEqual(['tenant', 't', 'devoluciones', 'viaje', VIAJE]);
    expect(devolucionesKeys.delosMeses('t')).toEqual(['tenant', 't', 'devoluciones', 'mes']);
    expect(devolucionesKeys.delMes('t', '2026-09-01', '2026-10-01')).toEqual(['tenant', 't', 'devoluciones', 'mes', '2026-09-01', '2026-10-01']);
    expect(devolucionesKeys.detail('t', DEV, VIAJE)).toEqual(['tenant', 't', 'devoluciones', 'detalle', VIAJE, DEV]);
  });

  it('la lista de un mes cuelga de su propio prefijo (delosMeses la cubre) y de `all`, y NO del de las listas por viaje ni del detalle', () => {
    const empiezaCon = (key: readonly unknown[], prefijo: readonly unknown[]) => prefijo.every((parte, i) => key[i] === parte);
    const delMes = devolucionesKeys.delMes('t', '2026-09-01', '2026-10-01');
    expect(empiezaCon(delMes, devolucionesKeys.delosMeses('t'))).toBe(true);
    expect(empiezaCon(delMes, devolucionesKeys.all('t'))).toBe(true);
    expect(empiezaCon(delMes, devolucionesKeys.delosViajes('t'))).toBe(false);
    expect(empiezaCon(devolucionesKeys.delViaje('t', VIAJE), devolucionesKeys.delosMeses('t'))).toBe(false);
    expect(empiezaCon(devolucionesKeys.detail('t', DEV, VIAJE), devolucionesKeys.delosMeses('t'))).toBe(false);
  });

  it('la lista de un mes de un tenant no cuelga de la de otro', () => {
    expect(devolucionesKeys.delMes('t1', '2026-09-01', '2026-10-01')).not.toEqual(devolucionesKeys.delMes('t2', '2026-09-01', '2026-10-01'));
  });

  it('la lista de un viaje cuelga del prefijo de las listas (invalidar delosViajes la cubre) y el detalle NO', () => {
    const empiezaCon = (key: readonly unknown[], prefijo: readonly unknown[]) => prefijo.every((parte, i) => key[i] === parte);
    expect(empiezaCon(devolucionesKeys.delViaje('t', VIAJE), devolucionesKeys.delosViajes('t'))).toBe(true);
    expect(empiezaCon(devolucionesKeys.detail('t', DEV, VIAJE), devolucionesKeys.delosViajes('t'))).toBe(false);
    expect(empiezaCon(devolucionesKeys.detail('t', DEV, VIAJE), devolucionesKeys.all('t'))).toBe(true);
  });

  it('sin tenant falla (nunca una key compartida entre tenants)', () => {
    expect(() => devolucionesKeys.all('')).toThrow();
  });
});
