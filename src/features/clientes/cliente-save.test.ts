import { describe, expect, it, vi } from 'vitest';

import { crearClienteIdempotente, type ClienteWriteIO } from '@/features/clientes/cliente-save';
import type { ClienteDatos } from '@/features/clientes/cliente-form';
import { DataRequestError, RecordNotFoundError, mapDataError } from '@/lib/data-errors';
import { GUARDAR_CLIENTE_CONTEXT } from '@/features/clientes/constants';

const REF = '55555555-5555-4555-8555-555555555555';
const GUARDADO = { id: 'a0000000-0000-4000-8000-000000000001', nombre: 'Almacén Central' };

/** El 23505 del índice del client_ref, como lo arma `unwrap()`. */
const duplicadoDelRef = () =>
  new DataRequestError({ code: '23505', message: 'duplicate key value violates unique constraint "clientes_transportista_client_ref_uidx"' }, 409);

function fakeIO(over: Partial<ClienteWriteIO> = {}) {
  const insertar = vi.fn<ClienteWriteIO['insertar']>(over.insertar ?? (async (fila) => ({ id: GUARDADO.id, nombre: fila.nombre })));
  const leerPorClientRef = vi.fn<ClienteWriteIO['leerPorClientRef']>(over.leerPorClientRef ?? (async () => GUARDADO));
  const actualizarPorClientRef = vi.fn<ClienteWriteIO['actualizarPorClientRef']>(
    over.actualizarPorClientRef ?? (async (_ref, datos) => ({ id: GUARDADO.id, nombre: datos.nombre })),
  );
  return { io: { insertar, leerPorClientRef, actualizarPorClientRef } satisfies ClienteWriteIO, insertar, leerPorClientRef, actualizarPorClientRef };
}

const datos = (over: Partial<ClienteDatos> = {}): ClienteDatos => ({
  nombre: 'Almacén Central',
  contacto_telefono: null,
  contacto_email: null,
  direccion: null,
  ...over,
});

describe('crearClienteIdempotente', () => {
  it('INSERT con el client_ref: devuelve "creado" con el cliente que guardó la base', async () => {
    const { io, insertar, leerPorClientRef, actualizarPorClientRef } = fakeIO();
    const r = await crearClienteIdempotente({ datos: datos(), clientRef: REF, sent: new Set(), io });
    expect(r).toEqual({ tipo: 'creado', cliente: GUARDADO });
    expect(insertar).toHaveBeenCalledWith({ ...datos(), client_ref: REF });
    expect(leerPorClientRef).not.toHaveBeenCalled();
    expect(actualizarPorClientRef).not.toHaveBeenCalled();
  });

  it('el alta al vuelo manda solo el nombre y el client_ref', async () => {
    const { io, insertar } = fakeIO();
    await crearClienteIdempotente({ datos: { nombre: 'Bodega' }, clientRef: REF, sent: new Set(), io });
    expect(insertar).toHaveBeenCalledWith({ nombre: 'Bodega', client_ref: REF });
  });

  it('23505 del client_ref y lo mismo de siempre: "ya-guardado", leyendo el cliente por client_ref (sin UPDATE)', async () => {
    const { io, leerPorClientRef, actualizarPorClientRef } = fakeIO({
      insertar: async () => {
        throw duplicadoDelRef();
      },
    });
    const sent = new Set<string>();
    const r = await crearClienteIdempotente({ datos: datos(), clientRef: REF, sent, io });
    expect(r).toEqual({ tipo: 'ya-guardado', cliente: GUARDADO });
    expect(leerPorClientRef).toHaveBeenCalledWith(REF);
    expect(actualizarPorClientRef).not.toHaveBeenCalled();
  });

  it('reintento tras una respuesta perdida con los MISMOS datos: "ya-guardado"', async () => {
    let intento = 0;
    const { io, actualizarPorClientRef } = fakeIO({
      insertar: async () => {
        intento += 1;
        if (intento === 1) throw new DataRequestError({ code: '', message: 'TypeError: Failed to fetch' });
        throw duplicadoDelRef();
      },
    });
    const sent = new Set<string>();
    await expect(crearClienteIdempotente({ datos: datos(), clientRef: REF, sent, io })).rejects.toBeInstanceOf(DataRequestError);
    const r = await crearClienteIdempotente({ datos: datos(), clientRef: REF, sent, io });
    expect(r.tipo).toBe('ya-guardado');
    expect(actualizarPorClientRef).not.toHaveBeenCalled();
  });

  it('el usuario CAMBIÓ datos entre intentos: UPDATE por client_ref con lo de ahora ("ya-guardado-actualizado")', async () => {
    let intento = 0;
    const { io, leerPorClientRef, actualizarPorClientRef } = fakeIO({
      insertar: async () => {
        intento += 1;
        if (intento === 1) throw new DataRequestError({ code: '', message: 'TimeoutError: signal timed out' });
        throw duplicadoDelRef();
      },
    });
    const sent = new Set<string>();
    await expect(crearClienteIdempotente({ datos: datos(), clientRef: REF, sent, io })).rejects.toThrow();
    const nuevos = datos({ nombre: 'Almacén Central Hnos', contacto_telefono: '351 555-1234' });
    const r = await crearClienteIdempotente({ datos: nuevos, clientRef: REF, sent, io });
    expect(r).toEqual({ tipo: 'ya-guardado-actualizado', cliente: { id: GUARDADO.id, nombre: 'Almacén Central Hnos' } });
    expect(actualizarPorClientRef).toHaveBeenCalledWith(REF, nuevos);
    // Lo que va al UPDATE no lleva client_ref (es inmutable): solo los datos.
    expect(actualizarPorClientRef.mock.calls[0]![1]).not.toHaveProperty('client_ref');
    expect(leerPorClientRef).not.toHaveBeenCalled();
  });

  it('volver a lo de antes después de cambiar también actualiza (se mandaron dos cosas distintas con esta clave)', async () => {
    let intento = 0;
    const { io, actualizarPorClientRef } = fakeIO({
      insertar: async () => {
        intento += 1;
        if (intento <= 2) throw new DataRequestError({ code: '', message: 'TypeError: Failed to fetch' });
        throw duplicadoDelRef();
      },
    });
    const sent = new Set<string>();
    await expect(crearClienteIdempotente({ datos: datos(), clientRef: REF, sent, io })).rejects.toThrow();
    await expect(crearClienteIdempotente({ datos: datos({ nombre: 'Otro' }), clientRef: REF, sent, io })).rejects.toThrow();
    const r = await crearClienteIdempotente({ datos: datos(), clientRef: REF, sent, io });
    expect(r.tipo).toBe('ya-guardado-actualizado');
    expect(actualizarPorClientRef).toHaveBeenCalledTimes(1);
  });

  it('"ya-guardado" pero el cliente ya no está (lo borraron entre medio): RecordNotFoundError con un mensaje que pide guardar de nuevo', async () => {
    const { io } = fakeIO({
      insertar: async () => {
        throw duplicadoDelRef();
      },
      leerPorClientRef: async () => null,
    });
    const error = await crearClienteIdempotente({ datos: datos(), clientRef: REF, sent: new Set(), io }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(RecordNotFoundError);
    expect(mapDataError(error, GUARDAR_CLIENTE_CONTEXT)).toBe(
      'El cliente que se había guardado ya no está. Toca "Guardar cliente" para guardarlo de nuevo.',
    );
  });

  it('un 23505 de OTRO índice no es "ya guardado": se propaga tal cual', async () => {
    const otro = new DataRequestError({ code: '23505', message: 'duplicate key value violates unique constraint "clientes_pkey"' }, 409);
    const { io, leerPorClientRef } = fakeIO({
      insertar: async () => {
        throw otro;
      },
    });
    await expect(crearClienteIdempotente({ datos: datos(), clientRef: REF, sent: new Set(), io })).rejects.toBe(otro);
    expect(leerPorClientRef).not.toHaveBeenCalled();
  });

  it('cualquier otro error (check, permiso, red) se propaga tal cual y deja la huella anotada', async () => {
    for (const error of [
      new DataRequestError({ code: '23514', message: 'check' }, 400),
      new DataRequestError({ code: '42501', message: 'permiso' }, 403),
      new DataRequestError({ code: '', message: 'TypeError: Failed to fetch' }),
    ]) {
      const sent = new Set<string>();
      const { io } = fakeIO({
        insertar: async () => {
          throw error;
        },
      });
      await expect(crearClienteIdempotente({ datos: datos(), clientRef: REF, sent, io })).rejects.toBe(error);
      expect(sent.size).toBe(1);
    }
  });

  it('nunca hace upsert: solo INSERT, y lectura o UPDATE por client_ref', async () => {
    const { io } = fakeIO();
    expect(Object.keys(io).sort()).toEqual(['actualizarPorClientRef', 'insertar', 'leerPorClientRef']);
  });
});
