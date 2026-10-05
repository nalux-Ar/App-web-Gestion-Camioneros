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
  isRetryableDataError,
  mapDataError,
} from '@/lib/data-errors';
import {
  CLIENTES_LIMIT,
  actualizarCliente,
  clienteWriteIO,
  contarDelCliente,
  eliminarCliente,
  fetchCliente,
  fetchClientes,
  fetchDevolucionesDelCliente,
  fetchViajesDelCliente,
} from '@/features/clientes/clientes-api';
import { clientesKeys } from '@/features/clientes/clientes-keys';
import { DETALLE_LIMIT, ELIMINAR_CLIENTE_CONTEXT, GUARDAR_CLIENTE_CONTEXT } from '@/features/clientes/constants';

const ok = (data: unknown) => ({ data, error: null, status: 200 });
const conteo = (count: unknown) => ({ data: null, count, error: null, status: 200 });
const fail = (code: string, message = 'falla', status = 400) => ({ data: null, error: { code, message, details: '', hint: '' }, status });

const CLIENTE = 'a0000000-0000-4000-8000-000000000001';
const REF = '55555555-5555-4555-8555-555555555555';
const signal = () => new AbortController().signal;

const ops = (call: Call) => call.ops.map((o) => o.m);
const op = (call: Call, m: string) => call.ops.filter((o) => o.m === m);

beforeEach(() => {
  h.calls.length = 0;
  h.state.responder = null;
});

describe('fetchClientes (la lista que comparten la pantalla y los selectores)', () => {
  it('pide id y nombre, por nombre e id, con tope 500 + 1 y la señal de TanStack', async () => {
    h.state.responder = () => ok([]);
    const s = signal();
    await fetchClientes(s);
    const [call] = h.calls;
    expect(call!.target).toBe('clientes');
    expect(op(call!, 'select')[0]!.args).toEqual(['id, nombre']);
    expect(op(call!, 'order').map((o) => o.args)).toEqual([
      ['nombre', { ascending: true }],
      ['id', { ascending: true }],
    ]);
    expect(op(call!, 'limit')[0]!.args).toEqual([CLIENTES_LIMIT + 1]);
    expect(op(call!, 'abortSignal')[0]!.args[0]).toBe(s);
  });

  it('reordena en español sin distinguir mayúsculas ni tildes y marca el tope', async () => {
    h.state.responder = () => ok([{ id: '2', nombre: 'bodega' }, { id: '1', nombre: 'Álamo' }]);
    expect((await fetchClientes(signal())).items.map((c) => c.id)).toEqual(['1', '2']);
    h.state.responder = () => ok(Array.from({ length: 501 }, (_, i) => ({ id: String(i), nombre: `C${String(i).padStart(3, '0')}` })));
    const r = await fetchClientes(signal());
    expect(r.items).toHaveLength(500);
    expect(r.truncado).toBe(true);
  });
});

describe('fetchCliente', () => {
  it('UNO por id con los datos de contacto (sin client_ref), maybeSingle y la señal de TanStack', async () => {
    h.state.responder = () => ok(null);
    const s = signal();
    await expect(fetchCliente(CLIENTE, s)).resolves.toBeNull();
    const [call] = h.calls;
    expect(call!.target).toBe('clientes');
    expect(op(call!, 'select')[0]!.args).toEqual(['id, nombre, contacto_telefono, contacto_email, direccion']);
    expect(op(call!, 'eq')[0]!.args).toEqual(['id', CLIENTE]);
    expect(ops(call!)).toContain('maybeSingle');
    expect(op(call!, 'abortSignal')[0]!.args[0]).toBe(s);
    expect(op(call!, 'select')[0]!.args[0]).not.toContain('client_ref');
  });

  it('0 filas (no existe o es de otro transportista: la base no distingue) -> null, no un error', async () => {
    h.state.responder = () => ok(null);
    await expect(fetchCliente(CLIENTE, signal())).resolves.toBeNull();
  });
});

describe('fetchViajesDelCliente (los viajes con alguna entrega del cliente)', () => {
  it('UNA consulta sobre viajes con entregas!inner y el filtro por entregas.cliente_id: cada viaje una sola vez', async () => {
    h.state.responder = () => ok([]);
    const s = signal();
    await fetchViajesDelCliente(CLIENTE, s);
    expect(h.calls).toHaveLength(1);
    const [call] = h.calls;
    expect(call!.target).toBe('viajes');
    expect(op(call!, 'select')[0]!.args).toEqual(['id, fecha, origen, destino, entregas!inner(id, incidencias)']);
    expect(op(call!, 'eq').map((o) => o.args)).toEqual([['entregas.cliente_id', CLIENTE]]);
    expect(op(call!, 'abortSignal')[0]!.args[0]).toBe(s);
    for (const m of ['insert', 'update', 'delete', 'maybeSingle']) expect(ops(call!)).not.toContain(m);
  });

  it('orden fecha, created_at e id descendentes (de los viajes, no de las entregas) y tope 50 + 1', async () => {
    h.state.responder = () => ok([]);
    await fetchViajesDelCliente(CLIENTE, signal());
    const orden = op(h.calls[0]!, 'order').map((o) => o.args);
    expect(orden).toEqual([
      ['fecha', { ascending: false }],
      ['created_at', { ascending: false }],
      ['id', { ascending: false }],
    ]);
    for (const [, opciones] of orden) expect(opciones).not.toHaveProperty('referencedTable');
    expect(op(h.calls[0]!, 'limit')[0]!.args).toEqual([DETALLE_LIMIT + 1]);
    expect(DETALLE_LIMIT).toBe(50);
  });

  it('con 51 se queda con los primeros 50 y avisa; con 50, no', async () => {
    h.state.responder = () => ok(Array.from({ length: 51 }, (_, i) => ({ id: `v-${i}` })));
    const r = await fetchViajesDelCliente(CLIENTE, signal());
    expect(r.items).toHaveLength(50);
    expect(r.items[49]!.id).toBe('v-49');
    expect(r.truncado).toBe(true);
    h.state.responder = () => ok(Array.from({ length: 50 }, (_, i) => ({ id: `v-${i}` })));
    expect((await fetchViajesDelCliente(CLIENTE, signal())).truncado).toBe(false);
  });

  it('un error de la base se propaga como DataRequestError', async () => {
    h.state.responder = () => fail('', 'TypeError: Failed to fetch', 0);
    await expect(fetchViajesDelCliente(CLIENTE, signal())).rejects.toBeInstanceOf(DataRequestError);
  });
});

describe('fetchDevolucionesDelCliente', () => {
  it('las del cliente con el viaje embebido (viajes!inner), sin el cliente ni rango de fechas', async () => {
    h.state.responder = () => ok([]);
    const s = signal();
    await fetchDevolucionesDelCliente(CLIENTE, s);
    const [call] = h.calls;
    expect(call!.target).toBe('devoluciones');
    expect(op(call!, 'select')[0]!.args).toEqual(['id, motivo, descripcion, viaje_id, created_at, viajes!inner(fecha, origen, destino)']);
    expect(op(call!, 'eq').map((o) => o.args)).toEqual([['cliente_id', CLIENTE]]);
    for (const m of ['gte', 'lt', 'insert', 'update', 'delete', 'maybeSingle']) expect(ops(call!)).not.toContain(m);
    expect(op(call!, 'abortSignal')[0]!.args[0]).toBe(s);
  });

  it('orden en la base por la fecha del viaje (viajes(fecha), sin referencedTable), luego created_at e id; tope 50 + 1', async () => {
    h.state.responder = () => ok([]);
    await fetchDevolucionesDelCliente(CLIENTE, signal());
    const orden = op(h.calls[0]!, 'order').map((o) => o.args);
    expect(orden).toEqual([
      ['viajes(fecha)', { ascending: false }],
      ['created_at', { ascending: false }],
      ['id', { ascending: false }],
    ]);
    for (const [, opciones] of orden) expect(opciones).not.toHaveProperty('referencedTable');
    expect(op(h.calls[0]!, 'limit')[0]!.args).toEqual([51]);
  });

  it('con 51 se queda con las primeras 50 y avisa', async () => {
    h.state.responder = () => ok(Array.from({ length: 51 }, (_, i) => ({ id: `d-${i}` })));
    const r = await fetchDevolucionesDelCliente(CLIENTE, signal());
    expect(r.items).toHaveLength(50);
    expect(r.truncado).toBe(true);
  });
});

describe('contarDelCliente (lo que impide borrarlo)', () => {
  it('dos conteos sin traer filas (count exact + head), uno por tabla, filtrados por cliente_id', async () => {
    h.state.responder = (call: Call) => conteo(call.target === 'entregas' ? 3 : 1);
    const s = signal();
    await expect(contarDelCliente(CLIENTE, s)).resolves.toEqual({ entregas: 3, devoluciones: 1 });
    expect(h.calls.map((c) => c.target).sort()).toEqual(['devoluciones', 'entregas']);
    for (const call of h.calls) {
      expect(op(call, 'select')[0]!.args).toEqual(['id', { count: 'exact', head: true }]);
      expect(op(call, 'eq')[0]!.args).toEqual(['cliente_id', CLIENTE]);
      expect(op(call, 'abortSignal')[0]!.args[0]).toBe(s);
    }
  });

  it('si cualquiera de los dos falla (o no trae un número), falla todo: nunca un número a medias', async () => {
    h.state.responder = (call: Call) => (call.target === 'entregas' ? conteo(2) : fail('', 'TypeError: Failed to fetch', 0));
    await expect(contarDelCliente(CLIENTE, signal())).rejects.toBeInstanceOf(DataRequestError);
    for (const raro of [null, -1, 1.5, '3']) {
      h.state.responder = (call: Call) => (call.target === 'entregas' ? conteo(raro) : conteo(0));
      await expect(contarDelCliente(CLIENTE, signal()), JSON.stringify(raro)).rejects.toBeInstanceOf(DataRequestError);
    }
  });
});

describe('clienteWriteIO.insertar', () => {
  it('INSERT con client_ref, devuelve id y nombre (select + single) y lleva timeout de escritura', async () => {
    h.state.responder = () => ok({ id: CLIENTE, nombre: 'Almacén Central' });
    await expect(clienteWriteIO.insertar({ nombre: 'Almacén Central', client_ref: REF })).resolves.toEqual({ id: CLIENTE, nombre: 'Almacén Central' });
    const [call] = h.calls;
    expect(call!.target).toBe('clientes');
    expect(ops(call!)).toEqual(['insert', 'select', 'abortSignal', 'single']);
    expect(op(call!, 'insert')[0]!.args[0]).toEqual({ nombre: 'Almacén Central', client_ref: REF });
    expect(op(call!, 'select')[0]!.args).toEqual(['id, nombre']);
    expect(op(call!, 'abortSignal')[0]!.args[0]).toBeInstanceOf(AbortSignal);
  });

  it('aunque alguien arme la fila con id o transportista_id de más, no salen', async () => {
    h.state.responder = () => ok({ id: CLIENTE, nombre: 'X' });
    await clienteWriteIO.insertar({ nombre: 'X', client_ref: REF, id: 'x', transportista_id: 'otro' } as never);
    const enviado = op(h.calls[0]!, 'insert')[0]!.args[0] as Record<string, unknown>;
    expect(enviado).toEqual({ nombre: 'X', client_ref: REF });
  });

  it('un error se propaga con su code y el nombre del índice (para reconocer el 23505 del client_ref)', async () => {
    h.state.responder = () => fail('23505', 'duplicate key value violates unique constraint "clientes_transportista_client_ref_uidx"', 409);
    const error = await clienteWriteIO.insertar({ nombre: 'X', client_ref: REF }).then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(DataRequestError);
    expect((error as DataRequestError).code).toBe('23505');
    expect((error as DataRequestError).message).toContain('clientes_transportista_client_ref_uidx');
  });
});

describe('clienteWriteIO.leerPorClientRef y actualizarPorClientRef', () => {
  it('leer: select id, nombre por client_ref, maybeSingle, con timeout (es parte de un guardado)', async () => {
    h.state.responder = () => ok({ id: CLIENTE, nombre: 'X' });
    await expect(clienteWriteIO.leerPorClientRef(REF)).resolves.toEqual({ id: CLIENTE, nombre: 'X' });
    const [call] = h.calls;
    expect(ops(call!)).toEqual(['select', 'eq', 'abortSignal', 'maybeSingle']);
    expect(op(call!, 'eq')[0]!.args).toEqual(['client_ref', REF]);
    expect(op(call!, 'abortSignal')[0]!.args[0]).toBeInstanceOf(AbortSignal);
  });

  it('leer: 0 filas -> null', async () => {
    h.state.responder = () => ok(null);
    await expect(clienteWriteIO.leerPorClientRef(REF)).resolves.toBeNull();
  });

  it('actualizar: UPDATE ... WHERE client_ref = ? con los datos, devuelve id y nombre', async () => {
    h.state.responder = () => ok([{ id: CLIENTE, nombre: 'Nuevo' }]);
    const datos = { nombre: 'Nuevo', contacto_telefono: '1', contacto_email: null, direccion: null };
    await expect(clienteWriteIO.actualizarPorClientRef(REF, datos)).resolves.toEqual({ id: CLIENTE, nombre: 'Nuevo' });
    const [call] = h.calls;
    expect(ops(call!)).toEqual(['update', 'eq', 'select', 'abortSignal']);
    expect(op(call!, 'update')[0]!.args[0]).toEqual(datos);
    expect(op(call!, 'eq')[0]!.args).toEqual(['client_ref', REF]);
  });

  it('actualizar: el client_ref NUNCA sale en el UPDATE (ni id ni transportista_id), aunque alguien lo cuele', async () => {
    h.state.responder = () => ok([{ id: CLIENTE, nombre: 'N' }]);
    await clienteWriteIO.actualizarPorClientRef(REF, { nombre: 'N', client_ref: 'otro', id: 'x', transportista_id: 't' } as never);
    expect(op(h.calls[0]!, 'update')[0]!.args[0]).toEqual({ nombre: 'N' });
  });

  it('actualizar: 0 filas -> RecordNotFoundError', async () => {
    h.state.responder = () => ok([]);
    await expect(clienteWriteIO.actualizarPorClientRef(REF, { nombre: 'N' })).rejects.toBeInstanceOf(RecordNotFoundError);
  });
});

describe('actualizarCliente (edición)', () => {
  it('UPDATE por id (nunca upsert) con las cuatro columnas, select("id") y timeout de escritura', async () => {
    h.state.responder = () => ok([{ id: CLIENTE }]);
    const columns = { nombre: 'Bodega', contacto_telefono: null, contacto_email: 'a@b.co', direccion: null };
    await expect(actualizarCliente(CLIENTE, columns)).resolves.toBeUndefined();
    const [call] = h.calls;
    expect(ops(call!)).toEqual(['update', 'eq', 'select', 'abortSignal']);
    expect(op(call!, 'update')[0]!.args[0]).toEqual(columns);
    expect(op(call!, 'eq')[0]!.args).toEqual(['id', CLIENTE]);
    expect(op(call!, 'select')[0]!.args).toEqual(['id']);
  });

  it('la edición NUNCA manda client_ref (es inmutable), aunque alguien lo cuele en las columnas', async () => {
    h.state.responder = () => ok([{ id: CLIENTE }]);
    await actualizarCliente(CLIENTE, { nombre: 'B', contacto_telefono: null, contacto_email: null, direccion: null, client_ref: REF } as never);
    const enviado = op(h.calls[0]!, 'update')[0]!.args[0] as Record<string, unknown>;
    expect(enviado).not.toHaveProperty('client_ref');
    expect(enviado).toEqual({ nombre: 'B', contacto_telefono: null, contacto_email: null, direccion: null });
  });

  it('0 filas (ya no existe o es de otro transportista) -> RecordNotFoundError', async () => {
    h.state.responder = () => ok([]);
    await expect(actualizarCliente(CLIENTE, { nombre: 'B', contacto_telefono: null, contacto_email: null, direccion: null })).rejects.toBeInstanceOf(
      RecordNotFoundError,
    );
  });
});

describe('eliminarCliente', () => {
  it('DELETE por id con select("id") y timeout; devuelve cuántas borró (0 = ya no estaba, no es error)', async () => {
    h.state.responder = () => ok([{ id: CLIENTE }]);
    await expect(eliminarCliente(CLIENTE)).resolves.toBe(1);
    const [call] = h.calls;
    expect(ops(call!)).toEqual(['delete', 'eq', 'select', 'abortSignal']);
    expect(op(call!, 'eq')[0]!.args).toEqual(['id', CLIENTE]);
    h.state.responder = () => ok([]);
    await expect(eliminarCliente(CLIENTE)).resolves.toBe(0);
  });

  it('con entregas o devoluciones: 23503 (PostgreSQL 17) y 23001 (PostgreSQL 18) dicen lo mismo y NO se reintentan', async () => {
    for (const code of ['23503', '23001']) {
      h.state.responder = () => fail(code, `update or delete on table "clientes" violates foreign key constraint "entregas_cliente_fk" on table "entregas"`, 409);
      const error = await eliminarCliente(CLIENTE).then(() => null, (e: unknown) => e);
      expect(error, code).toBeInstanceOf(DataRequestError);
      const mensaje = mapDataError(error, ELIMINAR_CLIENTE_CONTEXT);
      expect(mensaje, code).toBe('No se puede eliminar: este cliente tiene entregas o devoluciones. Puedes renombrarlo.');
      expect(mensaje).not.toContain('entregas_cliente_fk');
      expect(isRetryableDataError(error, ELIMINAR_CLIENTE_CONTEXT), code).toBe(false);
    }
  });

  it('sin el contexto del borrado, un 23001 sigue siendo "datos inválidos" (la regla es de esta pantalla)', () => {
    expect(classifyDataError(new DataRequestError({ code: '23001', message: 'x' }, 409))).toBe('invalid-data');
  });

  it('una falla de red al borrar SÍ se reintenta', () => {
    expect(isRetryableDataError(new DataRequestError({ code: '', message: 'TypeError: Failed to fetch' }, 0), ELIMINAR_CLIENTE_CONTEXT)).toBe(true);
  });
});

describe('errores al guardar un cliente', () => {
  it('checks de la base: mensaje propio, sin texto del servidor ni reintento', () => {
    const error = new DataRequestError({ code: '23514', message: 'new row violates check constraint "clientes_contacto_email_chk"' }, 400);
    expect(mapDataError(error, GUARDAR_CLIENTE_CONTEXT)).toBe('Alguno de los datos del cliente no es válido. Revísalos e inténtalo de nuevo.');
    expect(isRetryableDataError(error, GUARDAR_CLIENTE_CONTEXT)).toBe(false);
  });
});

describe('keys: todas con el tenant; los conteos y el detalle de edición NO cuelgan de lo que invalidan las mutaciones', () => {
  const empiezaCon = (key: readonly unknown[], prefijo: readonly unknown[]) => prefijo.every((parte, i) => key[i] === parte);

  it('forma de cada key', () => {
    expect(clientesKeys.all('t')).toEqual(['tenant', 't', 'clientes']);
    expect(clientesKeys.list('t')).toEqual(['tenant', 't', 'clientes', 'lista']);
    expect(clientesKeys.vistas('t')).toEqual(['tenant', 't', 'clientes', 'vista']);
    expect(clientesKeys.vista('t', CLIENTE)).toEqual(['tenant', 't', 'clientes', 'vista', CLIENTE, 'datos']);
    expect(clientesKeys.viajesDelCliente('t', CLIENTE)).toEqual(['tenant', 't', 'clientes', 'vista', CLIENTE, 'viajes']);
    expect(clientesKeys.devolucionesDelCliente('t', CLIENTE)).toEqual(['tenant', 't', 'clientes', 'vista', CLIENTE, 'devoluciones']);
    expect(clientesKeys.detail('t', CLIENTE)).toEqual(['tenant', 't', 'clientes', 'detalle', CLIENTE]);
    expect(clientesKeys.conteos('t', CLIENTE)).toEqual(['tenant', 't', 'clientes', 'conteos-del-borrado', CLIENTE]);
  });

  it('el detalle y sus dos listas cuelgan de `vistas`; el detalle de edición y los conteos, NO (ni de la lista)', () => {
    for (const key of [clientesKeys.vista('t', CLIENTE), clientesKeys.viajesDelCliente('t', CLIENTE), clientesKeys.devolucionesDelCliente('t', CLIENTE)]) {
      expect(empiezaCon(key, clientesKeys.vistas('t'))).toBe(true);
    }
    for (const key of [clientesKeys.detail('t', CLIENTE), clientesKeys.conteos('t', CLIENTE)]) {
      expect(empiezaCon(key, clientesKeys.vistas('t'))).toBe(false);
      expect(empiezaCon(key, clientesKeys.list('t'))).toBe(false);
    }
  });

  it('sin tenant falla (nunca una key compartida entre tenants)', () => {
    expect(() => clientesKeys.list('')).toThrow();
  });
});
