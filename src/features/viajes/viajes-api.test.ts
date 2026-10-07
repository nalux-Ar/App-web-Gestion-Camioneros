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

import {
  DataRequestError,
  RecordNotFoundError,
  UserMessageError,
  classifyDataError,
  isRetryableDataError,
  mapDataError,
} from '@/lib/data-errors';
import { ELIMINAR_VIAJE_CONTEXT, GUARDAR_VIAJE_CONTEXT } from '@/features/viajes/constants';
import { buildActualizarArgs, buildCrearArgs } from '@/features/viajes/viaje-save';
import {
  contarDelViaje,
  contarDevolucionesDelViaje,
  contarGastosDelViaje,
  desvincularGastosDelViaje,
  eliminarViaje,
  eliminarViajeDesvinculandoGastos,
  fetchViaje,
  fetchViajeOpcion,
  fetchViajesDelRango,
  fetchViajesRecientes,
  fetchViajeVista,
  viajeWriteIO,
} from '@/features/viajes/viajes-api';

const ok = (data: unknown) => ({ data, error: null, status: 200 });
const fail = (code: string, message = 'falla', status = 400) => ({ data: null, error: { code, message, details: '', hint: '' }, status });

const VIAJE_ID = '33333333-3333-4333-8333-333333333333';
const REF = '55555555-5555-4555-8555-555555555555';
const columns = {
  fecha: '2026-10-02',
  origen: 'Rosario',
  destino: 'Córdoba',
  camion_id: null,
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

  it('23503 en el DELETE (solo puede ser una carrera: el borrado ya desvinculó los gastos): mensaje del contexto del borrado, y con ese contexto SÍ se puede reintentar', async () => {
    h.state.responder = () => fail('23503', 'update or delete on table "viajes" violates foreign key constraint "gastos_viaje_fk" on table "gastos"', 409);
    const error = await eliminarViaje(VIAJE_ID).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(DataRequestError);
    expect(classifyDataError(error)).toBe('foreign-key');
    // Sin contexto una FK no se reintenta (daría lo mismo); en el borrado de un viaje sí: repetir los dos pasos es seguro.
    expect(isRetryableDataError(error)).toBe(false);
    expect(isRetryableDataError(error, ELIMINAR_VIAJE_CONTEXT)).toBe(true);
    expect(isRetryableDataError(error, GUARDAR_VIAJE_CONTEXT)).toBe(false);

    const mensaje = mapDataError(error, ELIMINAR_VIAJE_CONTEXT);
    expect(mensaje).toBe('Se vinculó un gasto a este viaje mientras lo borrabas. Vuelve a intentarlo.');
    expect(mensaje).not.toContain('gastos_viaje_fk'); // nunca el nombre del constraint
    expect(mensaje).not.toContain('Cambia o quita esos gastos'); // el mensaje viejo ya no existe

    // El MISMO código al GUARDAR significa otra cosa (un cliente inválido): el contexto decide.
    expect(mapDataError(error, GUARDAR_VIAJE_CONTEXT)).toBe('Alguno de los clientes ya no existe: actualiza la lista y elígelo de nuevo.');
    expect(mapDataError(error, GUARDAR_VIAJE_CONTEXT)).not.toBe(mensaje);
  });
});

/** "tabla.primera operación" de cada pedido, en orden: p. ej. ['gastos.update', 'viajes.delete']. */
const secuencia = () => h.calls.map((c) => `${c.target}.${ops(c)[0]}`);

const RED = () => fail('', 'TypeError: Failed to fetch', 0);
const conteoDe = (n: number) => ({ data: null, count: n, error: null, status: 200 });
const esConteoGastos = (call: Call) => call.target === 'gastos' && !ops(call).includes('update');
const esConteoDevoluciones = (call: Call) => call.target === 'devoluciones';
/**
 * Responde los DOS conteos (el recuento que SIEMPRE precede a la desvinculación) con los números dados, el UPDATE de los
 * gastos con tantas filas como gastos, y el DELETE del viaje con `borrar` (por defecto, borró 1 fila).
 */
const conteos =
  (gastos: number, devoluciones: number, borrar: (call: Call) => unknown = () => ok([{ id: VIAJE_ID }])) =>
  (call: Call) => {
    if (esConteoGastos(call)) return conteoDe(gastos);
    if (esConteoDevoluciones(call)) return conteoDe(devoluciones);
    if (call.target === 'gastos') return ok(Array.from({ length: gastos }, (_, i) => ({ id: `g-${i}` })));
    return borrar(call);
  };
/** Lo que hacen los pedidos de un borrado completo, en orden: el recuento (gastos y devoluciones), el UPDATE y el DELETE. */
const BORRADO_COMPLETO = ['gastos.select', 'devoluciones.select', 'gastos.update', 'viajes.delete'];

describe('borrar un viaje: desvincular los gastos y borrar, SIEMPRE en dos pasos', () => {
  it('desvincularGastosDelViaje: UPDATE gastos SET viaje_id = null WHERE viaje_id = <id>, con timeout de escritura y sin otras columnas; devuelve cuántos desvinculó', async () => {
    h.state.responder = () => ok([{ id: 'g-1' }, { id: 'g-2' }]);
    await expect(desvincularGastosDelViaje(VIAJE_ID)).resolves.toBe(2);
    const [call] = h.calls;
    expect(call!.target).toBe('gastos');
    expect(ops(call!)).toEqual(['update', 'eq', 'select', 'abortSignal']);
    expect(op(call!, 'select')[0]!.args).toEqual(['id']);
    expect(op(call!, 'update')[0]!.args[0]).toEqual({ viaje_id: null }); // null EXPLÍCITO y nada más (ni transportista_id ni id)
    expect(op(call!, 'eq')[0]!.args).toEqual(['viaje_id', VIAJE_ID]);
    expect(op(call!, 'abortSignal')[0]!.args[0]).toBeInstanceOf(AbortSignal);
  });

  it('eliminarViajeDesvinculandoGastos: primero el UPDATE de los gastos y DESPUÉS el DELETE del viaje (en ese orden)', async () => {
    h.state.responder = conteos(0, 0);
    await expect(eliminarViajeDesvinculandoGastos(VIAJE_ID, null)).resolves.toBeUndefined();
    expect(secuencia()).toEqual(BORRADO_COMPLETO);
    expect(op(h.calls[2]!, 'eq')[0]!.args).toEqual(['viaje_id', VIAJE_ID]);
    expect(op(h.calls[3]!, 'eq')[0]!.args).toEqual(['id', VIAJE_ID]);
  });

  it('si el paso 1 falla, NO se intenta borrar el viaje y el error se propaga', async () => {
    h.state.responder = (call) => (esConteoGastos(call) || esConteoDevoluciones(call) ? conteoDe(0) : RED());
    await expect(eliminarViajeDesvinculandoGastos(VIAJE_ID, null)).rejects.toBeDefined();
    expect(secuencia()).toEqual(['gastos.select', 'devoluciones.select', 'gastos.update']);
  });

  it('si se corta entre los pasos (el UPDATE salió y el DELETE no), reintentar repite los dos y completa el borrado', async () => {
    let intento = 0;
    // idempotente: la segunda vez no encuentra nada que desvincular
    h.state.responder = conteos(0, 0, () => {
      intento += 1;
      return intento === 1 ? RED() : ok([{ id: VIAJE_ID }]);
    });
    await expect(eliminarViajeDesvinculandoGastos(VIAJE_ID, null)).rejects.toBeDefined();
    await expect(eliminarViajeDesvinculandoGastos(VIAJE_ID, null)).resolves.toBeUndefined();
    expect(secuencia()).toEqual([...BORRADO_COMPLETO, ...BORRADO_COMPLETO]);
  });

  it('un viaje que ya no existe (0 filas en el DELETE) sigue dando RecordNotFoundError, después de desvincular', async () => {
    h.state.responder = conteos(0, 0, () => ok([]));
    await expect(eliminarViajeDesvinculandoGastos(VIAJE_ID, null)).rejects.toBeInstanceOf(RecordNotFoundError);
    expect(secuencia()).toEqual(BORRADO_COMPLETO);
  });

  it('carrera: el DELETE da 23503 (alguien vinculó un gasto entre los pasos); el reintento desvincula de nuevo y borra', async () => {
    let intento = 0;
    h.state.responder = conteos(0, 0, () => {
      intento += 1;
      return intento === 1
        ? fail('23503', 'update or delete on table "viajes" violates foreign key constraint "gastos_viaje_fk" on table "gastos"', 409)
        : ok([{ id: VIAJE_ID }]);
    });
    const error = await eliminarViajeDesvinculandoGastos(VIAJE_ID, null).then(
      () => null,
      (e: unknown) => e,
    );
    expect(classifyDataError(error)).toBe('foreign-key');
    expect(mapDataError(error, ELIMINAR_VIAJE_CONTEXT)).toContain('Se vinculó un gasto');
    await expect(eliminarViajeDesvinculandoGastos(VIAJE_ID, null)).resolves.toBeUndefined();
    expect(secuencia()).toEqual([...BORRADO_COMPLETO, ...BORRADO_COMPLETO]);
  });
});

describe('borrar un viaje: lo que se desvincula es lo que se mostró, y un corte entre pasos se explica', () => {
  const capturar = (p: Promise<unknown>) =>
    p.then(
      () => null,
      (e: unknown) => e,
    );

  it('con los conteos mostrados: vuelve a contar AMBOS (gastos y devoluciones, con timeout de escritura) ANTES de desvincular y, si coinciden, desvincula y borra', async () => {
    h.state.responder = conteos(3, 2);
    await expect(eliminarViajeDesvinculandoGastos(VIAJE_ID, { gastos: 3, devoluciones: 2 })).resolves.toBeUndefined();
    expect(secuencia()).toEqual(['gastos.select', 'devoluciones.select', 'gastos.update', 'viajes.delete']);
    for (const call of h.calls.slice(0, 2)) {
      expect(op(call, 'select')[0]!.args).toEqual(['id', { count: 'exact', head: true }]);
      expect(op(call, 'eq')[0]!.args).toEqual(['viaje_id', VIAJE_ID]);
      expect(op(call, 'abortSignal')[0]!.args[0]).toBeInstanceOf(AbortSignal);
    }
  });

  it('las devoluciones NO tienen paso propio: se borran en cascada con el viaje (ni un UPDATE ni un DELETE sobre devoluciones)', async () => {
    h.state.responder = conteos(0, 4);
    await expect(eliminarViajeDesvinculandoGastos(VIAJE_ID, { gastos: 0, devoluciones: 4 })).resolves.toBeUndefined();
    const escrituras = h.calls.filter((c) => c.target === 'devoluciones' && (ops(c).includes('update') || ops(c).includes('delete') || ops(c).includes('insert')));
    expect(escrituras).toEqual([]);
    expect(secuencia()).toEqual(['gastos.select', 'devoluciones.select', 'gastos.update', 'viajes.delete']);
  });

  it('si CUALQUIERA de los dos números cambió (solo gastos, solo devoluciones o ambos), NO toca nada: error con los números de AHORA, reintentable', async () => {
    const REVISA = 'Revisa y vuelve a confirmar.';
    for (const [mostrados, ahora, texto] of [
      // solo cambian los gastos
      [{ gastos: 3, devoluciones: 2 }, { gastos: 5, devoluciones: 2 }, `Ahora el viaje tiene 5 gastos y 2 devoluciones. ${REVISA}`],
      [{ gastos: 3, devoluciones: 2 }, { gastos: 0, devoluciones: 2 }, `Ahora el viaje tiene 2 devoluciones. ${REVISA}`],
      // solo cambian las devoluciones
      [{ gastos: 3, devoluciones: 2 }, { gastos: 3, devoluciones: 4 }, `Ahora el viaje tiene 3 gastos y 4 devoluciones. ${REVISA}`],
      [{ gastos: 3, devoluciones: 2 }, { gastos: 3, devoluciones: 0 }, `Ahora el viaje tiene 3 gastos. ${REVISA}`],
      [{ gastos: 0, devoluciones: 0 }, { gastos: 0, devoluciones: 1 }, `Ahora el viaje tiene 1 devolución. ${REVISA}`],
      // cambian los dos
      [{ gastos: 3, devoluciones: 2 }, { gastos: 1, devoluciones: 1 }, `Ahora el viaje tiene 1 gasto y 1 devolución. ${REVISA}`],
      [{ gastos: 3, devoluciones: 2 }, { gastos: 0, devoluciones: 0 }, `Ahora el viaje no tiene gastos ni devoluciones vinculados. ${REVISA}`],
      // lo que sube en uno y baja en el otro (la suma no cambia) también cuenta
      [{ gastos: 2, devoluciones: 3 }, { gastos: 3, devoluciones: 2 }, `Ahora el viaje tiene 3 gastos y 2 devoluciones. ${REVISA}`],
    ] as const) {
      h.calls.length = 0;
      h.state.responder = conteos(ahora.gastos, ahora.devoluciones);
      const error = await capturar(eliminarViajeDesvinculandoGastos(VIAJE_ID, mostrados));
      const nombre = `${mostrados.gastos}/${mostrados.devoluciones} -> ${ahora.gastos}/${ahora.devoluciones}`;
      expect(error, nombre).toBeInstanceOf(UserMessageError);
      expect(mapDataError(error, ELIMINAR_VIAJE_CONTEXT), nombre).toBe(texto);
      expect(isRetryableDataError(error, ELIMINAR_VIAJE_CONTEXT), nombre).toBe(true);
      expect(secuencia(), nombre).toEqual(['gastos.select', 'devoluciones.select']); // ni UPDATE ni DELETE
    }
  });

  it('los mismos números NO son un cambio; los mismos números intercambiados entre gastos y devoluciones SÍ', async () => {
    h.state.responder = conteos(2, 3);
    await expect(eliminarViajeDesvinculandoGastos(VIAJE_ID, { gastos: 2, devoluciones: 3 })).resolves.toBeUndefined();
    h.calls.length = 0;
    h.state.responder = conteos(3, 2);
    await expect(capturar(eliminarViajeDesvinculandoGastos(VIAJE_ID, { gastos: 2, devoluciones: 3 }))).resolves.toBeInstanceOf(UserMessageError);
  });

  // Hallazgo MEDIO de la auditoría de Devoluciones: si el conteo de la confirmación fallaba (mala señal), el borrado
  // seguía por el camino "genérico" y SALTEABA el recuento: las devoluciones se perdían sin que el usuario viera
  // cuántas eran. Ahora el recuento corre SIEMPRE.
  it('sin conteos mostrados (el conteo de la confirmación falló) igual RECUENTA antes de tocar nada; sin devoluciones sigue con los dos pasos', async () => {
    h.state.responder = conteos(2, 0);
    await expect(eliminarViajeDesvinculandoGastos(VIAJE_ID, null)).resolves.toBeUndefined();
    expect(secuencia()).toEqual(BORRADO_COMPLETO); // desvincular gastos no destruye nada: se puede seguir
  });

  it('sin conteos mostrados y con DEVOLUCIONES: NO desvincula ni borra, y avisa con los números de ahora (el usuario no vio cuántas eran)', async () => {
    const REVISA = 'Revisa y vuelve a confirmar.';
    for (const [gastos, devoluciones, texto] of [
      [0, 3, `Ahora el viaje tiene 3 devoluciones. ${REVISA}`],
      [2, 3, `Ahora el viaje tiene 2 gastos y 3 devoluciones. ${REVISA}`],
      [1, 1, `Ahora el viaje tiene 1 gasto y 1 devolución. ${REVISA}`],
    ] as const) {
      h.calls.length = 0;
      h.state.responder = conteos(gastos, devoluciones);
      const error = await capturar(eliminarViajeDesvinculandoGastos(VIAJE_ID, null));
      expect(error, `${gastos}/${devoluciones}`).toBeInstanceOf(UserMessageError);
      expect(mapDataError(error, ELIMINAR_VIAJE_CONTEXT), `${gastos}/${devoluciones}`).toBe(texto);
      expect(isRetryableDataError(error, ELIMINAR_VIAJE_CONTEXT), `${gastos}/${devoluciones}`).toBe(true);
      expect(secuencia(), `${gastos}/${devoluciones}`).toEqual(['gastos.select', 'devoluciones.select']); // ni UPDATE ni DELETE
    }
  });

  it('sin conteos mostrados y el recuento también falla (sin señal): no toca nada y el error es el de la red, reintentable', async () => {
    h.state.responder = (call) => (esConteoGastos(call) ? RED() : esConteoDevoluciones(call) ? conteoDe(0) : ok([]));
    const error = await capturar(eliminarViajeDesvinculandoGastos(VIAJE_ID, null));
    expect(classifyDataError(error)).toBe('network');
    expect(isRetryableDataError(error, ELIMINAR_VIAJE_CONTEXT)).toBe(true);
    expect(secuencia()).not.toContain('gastos.update');
    expect(secuencia()).not.toContain('viajes.delete');
  });

  it('si el recuento de GASTOS falla (sin señal), no toca nada y el error es el de la red, reintentable', async () => {
    h.state.responder = (call) => (esConteoGastos(call) ? RED() : esConteoDevoluciones(call) ? conteoDe(2) : ok([]));
    const error = await capturar(eliminarViajeDesvinculandoGastos(VIAJE_ID, { gastos: 2, devoluciones: 2 }));
    expect(classifyDataError(error)).toBe('network');
    expect(isRetryableDataError(error, ELIMINAR_VIAJE_CONTEXT)).toBe(true);
    expect(secuencia()).not.toContain('gastos.update');
    expect(secuencia()).not.toContain('viajes.delete');
  });

  it('si el recuento de DEVOLUCIONES falla (sin señal), tampoco toca nada: no se desvincula ni se borra con un número a medias', async () => {
    h.state.responder = (call) => (esConteoDevoluciones(call) ? RED() : esConteoGastos(call) ? conteoDe(2) : ok([]));
    const error = await capturar(eliminarViajeDesvinculandoGastos(VIAJE_ID, { gastos: 2, devoluciones: 2 }));
    expect(classifyDataError(error)).toBe('network');
    expect(isRetryableDataError(error, ELIMINAR_VIAJE_CONTEXT)).toBe(true);
    expect(secuencia()).not.toContain('gastos.update');
    expect(secuencia()).not.toContain('viajes.delete');
  });

  it('un recuento con una respuesta rara (sin número) tampoco toca nada', async () => {
    h.state.responder = (call) => (esConteoDevoluciones(call) ? ok(null) : esConteoGastos(call) ? conteoDe(2) : ok([]));
    const error = await capturar(eliminarViajeDesvinculandoGastos(VIAJE_ID, { gastos: 2, devoluciones: 2 }));
    expect(error).toBeInstanceOf(DataRequestError);
    expect(secuencia()).not.toContain('gastos.update');
    expect(secuencia()).not.toContain('viajes.delete');
  });

  it('corte DESPUÉS de desvincular: el error dice cuántos gastos quedaron sin viaje y que el viaje no se borró, más el motivo; conserva el "Reintentar" del error original', async () => {
    h.state.responder = conteos(3, 0, () => RED());
    const error = await capturar(eliminarViajeDesvinculandoGastos(VIAJE_ID, null));
    expect(error).toBeInstanceOf(UserMessageError);
    const mensaje = mapDataError(error, ELIMINAR_VIAJE_CONTEXT);
    expect(mensaje.startsWith('Los 3 gastos ya quedaron sin viaje, pero el viaje no se borró. ')).toBe(true);
    expect(mensaje).toContain(mapDataError(RED().error)); // el motivo: "No hay conexión…"
    expect(isRetryableDataError(error, ELIMINAR_VIAJE_CONTEXT)).toBe(true);
    expect((error as Error).cause).toBeInstanceOf(DataRequestError); // el original queda adentro, sin mostrarse
  });

  it('corte después de desvincular UN gasto: en singular', async () => {
    h.state.responder = conteos(1, 0, () => RED());
    const error = await capturar(eliminarViajeDesvinculandoGastos(VIAJE_ID, null));
    expect(mapDataError(error).startsWith('El gasto ya quedó sin viaje, pero el viaje no se borró. ')).toBe(true);
  });

  it('el corte después de desvincular NO toca las devoluciones: siguen intactas (ninguna escritura sobre ellas) y el aviso no las menciona', async () => {
    h.state.responder = (call) =>
      esConteoGastos(call) ? conteoDe(2) : call.target === 'gastos' ? ok([{ id: 'a' }, { id: 'b' }]) : esConteoDevoluciones(call) ? conteoDe(3) : RED();
    const error = await capturar(eliminarViajeDesvinculandoGastos(VIAJE_ID, { gastos: 2, devoluciones: 3 }));
    expect(error).toBeInstanceOf(UserMessageError);
    expect(mapDataError(error, ELIMINAR_VIAJE_CONTEXT)).toContain('Los 2 gastos ya quedaron sin viaje');
    expect(mapDataError(error, ELIMINAR_VIAJE_CONTEXT)).not.toContain('devolucion');
    expect(h.calls.filter((c) => c.target === 'devoluciones' && !ops(c).includes('select'))).toEqual([]);
  });

  it('si el DELETE falla por algo que no se arregla reintentando (permiso), el aviso lo dice y NO ofrece reintentar', async () => {
    h.state.responder = conteos(2, 0, () => fail('42501', 'permiso', 403));
    const error = await capturar(eliminarViajeDesvinculandoGastos(VIAJE_ID, null));
    expect(mapDataError(error)).toContain('Los 2 gastos ya quedaron sin viaje');
    expect(isRetryableDataError(error, ELIMINAR_VIAJE_CONTEXT)).toBe(false);
  });

  it('carrera después de desvincular (23503 o 23001): el aviso suma el mensaje del borrado y sigue siendo reintentable', async () => {
    for (const code of ['23503', '23001']) {
      h.calls.length = 0;
      h.state.responder = conteos(2, 0, () => fail(code, 'violates foreign key constraint "gastos_viaje_fk"', 409));
      const error = await capturar(eliminarViajeDesvinculandoGastos(VIAJE_ID, null));
      const mensaje = mapDataError(error, ELIMINAR_VIAJE_CONTEXT);
      expect(mensaje, code).toContain('Los 2 gastos ya quedaron sin viaje');
      expect(mensaje, code).toContain('Se vinculó un gasto a este viaje mientras lo borrabas.');
      expect(mensaje, code).not.toContain('gastos_viaje_fk');
      expect(isRetryableDataError(error, ELIMINAR_VIAJE_CONTEXT), code).toBe(true);
    }
  });

  it('el viaje ya no existía (0 filas) después de desvincular gastos: sigue siendo RecordNotFoundError (para un borrado, éxito)', async () => {
    h.state.responder = conteos(1, 0, () => ok([]));
    await expect(eliminarViajeDesvinculandoGastos(VIAJE_ID, null)).rejects.toBeInstanceOf(RecordNotFoundError);
  });

  it('si no había nada que desvincular, el error del DELETE pasa tal cual (sin el aviso de gastos)', async () => {
    h.state.responder = conteos(0, 0, () => RED());
    const error = await capturar(eliminarViajeDesvinculandoGastos(VIAJE_ID, null));
    expect(error).toBeInstanceOf(DataRequestError);
    expect(mapDataError(error, ELIMINAR_VIAJE_CONTEXT)).not.toContain('quedaron sin viaje');
  });
});

describe('contarGastosDelViaje', () => {
  const signal = () => new AbortController().signal;

  it('select("id", { count: "exact", head: true }) filtrado por viaje_id; devuelve el número', async () => {
    h.state.responder = () => ({ data: null, count: 3, error: null, status: 200 });
    await expect(contarGastosDelViaje(VIAJE_ID, signal())).resolves.toBe(3);
    const [call] = h.calls;
    expect(call!.target).toBe('gastos');
    expect(op(call!, 'select')[0]!.args).toEqual(['id', { count: 'exact', head: true }]);
    expect(op(call!, 'eq')[0]!.args).toEqual(['viaje_id', VIAJE_ID]);
  });

  it('0 es un conteo válido', async () => {
    h.state.responder = () => ({ data: null, count: 0, error: null, status: 200 });
    await expect(contarGastosDelViaje(VIAJE_ID, signal())).resolves.toBe(0);
  });

  it('un error de la base se propaga como DataRequestError (con su code y status)', async () => {
    h.state.responder = () => fail('', 'TypeError: Failed to fetch', 0);
    await expect(contarGastosDelViaje(VIAJE_ID, signal())).rejects.toBeInstanceOf(DataRequestError);
  });

  it('una respuesta sin número (null, negativo, decimal, texto) es un error, no un 0 inventado', async () => {
    for (const rara of [null, undefined, -1, 1.5, '3']) {
      h.state.responder = () => ({ data: null, count: rara, error: null, status: 200 });
      await expect(contarGastosDelViaje(VIAJE_ID, signal()), String(rara)).rejects.toBeInstanceOf(DataRequestError);
    }
  });
});

describe('contarDevolucionesDelViaje', () => {
  const signal = () => new AbortController().signal;

  it('select("id", { count: "exact", head: true }) sobre DEVOLUCIONES filtrado por viaje_id; devuelve el número', async () => {
    h.state.responder = () => ({ data: null, count: 4, error: null, status: 200 });
    await expect(contarDevolucionesDelViaje(VIAJE_ID, signal())).resolves.toBe(4);
    const [call] = h.calls;
    expect(call!.target).toBe('devoluciones');
    expect(ops(call!)).toEqual(['select', 'eq', 'abortSignal']);
    expect(op(call!, 'select')[0]!.args).toEqual(['id', { count: 'exact', head: true }]);
    expect(op(call!, 'eq')[0]!.args).toEqual(['viaje_id', VIAJE_ID]);
    expect(op(call!, 'abortSignal')[0]!.args[0]).toBeInstanceOf(AbortSignal);
  });

  it('0 es un conteo válido', async () => {
    h.state.responder = () => ({ data: null, count: 0, error: null, status: 200 });
    await expect(contarDevolucionesDelViaje(VIAJE_ID, signal())).resolves.toBe(0);
  });

  it('un error de la base se propaga como DataRequestError (con su code y status)', async () => {
    h.state.responder = () => fail('', 'TypeError: Failed to fetch', 0);
    await expect(contarDevolucionesDelViaje(VIAJE_ID, signal())).rejects.toBeInstanceOf(DataRequestError);
  });

  it('una respuesta sin número (null, negativo, decimal, texto) es un error, no un 0 inventado', async () => {
    for (const rara of [null, undefined, -1, 1.5, '3']) {
      h.state.responder = () => ({ data: null, count: rara, error: null, status: 200 });
      await expect(contarDevolucionesDelViaje(VIAJE_ID, signal()), String(rara)).rejects.toBeInstanceOf(DataRequestError);
    }
  });
});

describe('contarDelViaje: los dos conteos juntos', () => {
  const signal = () => new AbortController().signal;
  const conteoDe = (n: number) => ({ data: null, count: n, error: null, status: 200 });

  it('devuelve { gastos, devoluciones }, cada número de su tabla', async () => {
    h.state.responder = (call) => conteoDe(call.target === 'gastos' ? 3 : 2);
    await expect(contarDelViaje(VIAJE_ID, signal())).resolves.toEqual({ gastos: 3, devoluciones: 2 });
    expect(h.calls.map((c) => c.target).sort()).toEqual(['devoluciones', 'gastos']);
  });

  it('usa la MISMA señal en los dos pedidos', async () => {
    h.state.responder = () => conteoDe(0);
    const s = signal();
    await contarDelViaje(VIAJE_ID, s);
    for (const call of h.calls) expect(op(call, 'abortSignal')[0]!.args[0]).toBe(s);
  });

  it('si falla cualquiera de los dos, falla todo (nunca un número a medias)', async () => {
    h.state.responder = (call) => (call.target === 'gastos' ? conteoDe(3) : fail('', 'TypeError: Failed to fetch', 0));
    await expect(contarDelViaje(VIAJE_ID, signal())).rejects.toBeInstanceOf(DataRequestError);
    h.state.responder = (call) => (call.target === 'devoluciones' ? conteoDe(3) : fail('', 'TypeError: Failed to fetch', 0));
    await expect(contarDelViaje(VIAJE_ID, signal())).rejects.toBeInstanceOf(DataRequestError);
  });
});

describe('lecturas de viajes para gastos y el detalle', () => {
  const signal = () => new AbortController().signal;

  it('fetchViajesRecientes: id, fecha, origen, destino y camión de los 50 más recientes (fecha desc, created_at desc), sin filtro de mes', async () => {
    h.state.responder = () => ok([{ id: 'v1', fecha: '2026-10-01', origen: 'A', destino: 'B' }]);
    const r = await fetchViajesRecientes(signal());
    expect(r).toEqual([{ id: 'v1', fecha: '2026-10-01', origen: 'A', destino: 'B' }]);
    const [call] = h.calls;
    expect(call!.target).toBe('viajes');
    expect(op(call!, 'select')[0]!.args).toEqual(['id, fecha, origen, destino, camion_id']);
    expect(op(call!, 'order').map((o) => o.args)).toEqual([
      ['fecha', { ascending: false }],
      ['created_at', { ascending: false }],
    ]);
    expect(op(call!, 'limit')[0]!.args).toEqual([50]);
    expect(ops(call!)).not.toContain('gte');
    expect(ops(call!)).not.toContain('lt');
  });

  it('fetchViajeOpcion: por id con maybeSingle; null si no existe (o es de otro: la base no distingue)', async () => {
    h.state.responder = () => ok(null);
    await expect(fetchViajeOpcion(VIAJE_ID, signal())).resolves.toBeNull();
    const [call] = h.calls;
    expect(op(call!, 'select')[0]!.args).toEqual(['id, fecha, origen, destino, camion_id']);
    expect(op(call!, 'eq')[0]!.args).toEqual(['id', VIAJE_ID]);
    expect(ops(call!)).toContain('maybeSingle');
  });

  it('fetchViajeVista: UNA consulta por id con las entregas y el cliente de cada una (clientes(nombre)), entregas ordenadas por (created_at, id)', async () => {
    h.state.responder = () => ok(null);
    await expect(fetchViajeVista(VIAJE_ID, signal())).resolves.toBeNull();
    expect(h.calls).toHaveLength(1);
    const [call] = h.calls;
    expect(call!.target).toBe('viajes');
    const select = op(call!, 'select')[0]!.args[0] as string;
    expect(select).toContain('entregas(id, cliente_id, incidencias, created_at, clientes(nombre))'); // con el cliente_id: el formulario de devoluciones ofrece primero los clientes del viaje
    for (const columna of ['km_inicial', 'km_final', 'km_recorridos', 'ingreso', 'observaciones']) expect(select).toContain(columna);
    expect(select).not.toContain('client_ref');
    // El camión va SOLO como id (la patente se muestra desde la lista de camiones): nunca un embed camiones(...).
    expect(select).toContain('camion_id');
    expect(select).not.toContain('camiones(');
    expect(op(call!, 'eq')[0]!.args).toEqual(['id', VIAJE_ID]);
    expect(op(call!, 'order').map((o) => o.args)).toEqual([
      ['created_at', { ascending: true, referencedTable: 'entregas' }],
      ['id', { ascending: true, referencedTable: 'entregas' }],
    ]);
    expect(ops(call!)).toContain('maybeSingle');
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
    // Desde la Etapa 5 el alta manda el camión (null explícito sin camión).
    expect(op(call!, 'rpc')[0]!.args[0]).toHaveProperty('p_camion_id', null);
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
  it('manda el reemplazo completo, con el p_camion_id del formulario y las entregas con/sin id', async () => {
    h.state.responder = () => ok(null);
    const args = buildActualizarArgs(VIAJE_ID, {
      columns: { ...columns, camion_id: 'camion-1' },
      entregas: [{ id: 'e1', cliente_id: 'c1', incidencias: null }, { id: null, cliente_id: 'c2', incidencias: 'x' }],
    });
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
      const error = await viajeWriteIO.actualizar(buildActualizarArgs(VIAJE_ID, { columns, entregas: [] })).then(
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
    expect(select).toContain('camion_id'); // el formulario arranca con el camión que ya tenía (un null lo borraría)
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
    expect(op(call!, 'select')[0]!.args[0]).toContain('camion_id'); // sin embed: la patente sale de la lista de camiones
    expect(op(call!, 'select')[0]!.args[0]).not.toContain('camiones(');
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
