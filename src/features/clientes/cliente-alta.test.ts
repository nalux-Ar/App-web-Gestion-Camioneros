import { describe, expect, it, vi } from 'vitest';

import {
  altaCliente,
  estadoInicialAlta,
  type AltaClienteIO,
} from '@/features/clientes/cliente-alta';
import type { ClienteOpcion } from '@/features/clientes/cliente-nombre';
import { DataRequestError } from '@/lib/data-errors';

const ALMACEN: ClienteOpcion = { id: 'c-almacen', nombre: 'Almacén Central' };
const FRIGO: ClienteOpcion = { id: 'c-frigo', nombre: 'Frigorífico Sur' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Un error de red como el que arma `unwrap()` desde supabase-js: sin código de servidor. */
const redCaida = () => new DataRequestError({ message: 'TypeError: Failed to fetch', code: '' });
/** Un error que no se arregla reintentando (check de la base). */
const datosInvalidos = () => new DataRequestError({ message: 'check violado', code: '23514' }, 400);

type CrearArgs = Parameters<AltaClienteIO['crear']>[0];

function fakeIO(crearImpl?: AltaClienteIO['crear']) {
  const crear = vi.fn<AltaClienteIO['crear']>(crearImpl ?? (async ({ datos }) => ({ id: 'c-nuevo', nombre: datos.nombre })));
  const io: AltaClienteIO = { crear };
  return { io, crear };
}

describe('estadoInicialAlta', () => {
  it('arranca con una clave de idempotencia (uuid v4) y sin nada mandado; cada formulario tiene la suya', () => {
    const a = estadoInicialAlta();
    const b = estadoInicialAlta();
    expect(a.clientRef).toMatch(UUID);
    expect(b.clientRef).toMatch(UUID);
    expect(a.clientRef).not.toBe(b.clientRef);
    expect(a.sent.size).toBe(0);
    expect(a.nombresEnviados.size).toBe(0);
  });
});

describe('altaCliente', () => {
  it('nombre nuevo: crea con la clave del estado y devuelve el cliente que guardó la base', async () => {
    const { io, crear } = fakeIO();
    const estado = estadoInicialAlta();
    const r = await altaCliente({ datos: { nombre: 'Distribuidora Norte' }, forzar: false, clientes: [ALMACEN, FRIGO], estado, io });
    expect(r).toEqual({ tipo: 'creado', cliente: { id: 'c-nuevo', nombre: 'Distribuidora Norte' } });
    expect(crear).toHaveBeenCalledTimes(1);
    const args = crear.mock.calls[0]![0] as CrearArgs;
    expect(args.datos).toEqual({ nombre: 'Distribuidora Norte' });
    expect(args.clientRef).toBe(estado.clientRef);
    expect(args.sent).toBe(estado.sent); // el MISMO Set: las huellas sobreviven entre intentos
  });

  it('los datos de contacto viajan tal cual a la creación', async () => {
    const { io, crear } = fakeIO();
    const datos = { nombre: 'Bodega Este', contacto_telefono: '351 555-1234', contacto_email: null, direccion: 'Ruta 9 km 12' };
    await altaCliente({ datos, forzar: false, clientes: [ALMACEN], estado: estadoInicialAlta(), io });
    expect((crear.mock.calls[0]![0] as CrearArgs).datos).toEqual(datos);
  });

  it('duplicado (ignorando mayúsculas, tildes y espacios): NO crea y devuelve al existente', async () => {
    const { io, crear } = fakeIO();
    const r = await altaCliente({ datos: { nombre: ' frigorifico  SUR ' }, forzar: false, clientes: [ALMACEN, FRIGO], estado: estadoInicialAlta(), io });
    expect(r).toEqual({ tipo: 'duplicado', existente: FRIGO });
    expect(crear).not.toHaveBeenCalled();
  });

  it('un aviso de duplicado no "gasta" el nombre: el siguiente intento sin forzar vuelve a avisar', async () => {
    const { io, crear } = fakeIO();
    const estado = estadoInicialAlta();
    await altaCliente({ datos: { nombre: 'Frigorífico Sur' }, forzar: false, clientes: [FRIGO], estado, io });
    const r = await altaCliente({ datos: { nombre: 'Frigorífico Sur' }, forzar: false, clientes: [FRIGO], estado, io });
    expect(r.tipo).toBe('duplicado');
    expect(crear).not.toHaveBeenCalled();
    expect(estado.nombresEnviados.size).toBe(0);
  });

  it('"Crear de todos modos": se salta el aviso y crea el homónimo', async () => {
    const { io, crear } = fakeIO();
    const r = await altaCliente({ datos: { nombre: 'Almacen Central' }, forzar: true, clientes: [ALMACEN], estado: estadoInicialAlta(), io });
    expect(r.tipo).toBe('creado');
    expect(crear).toHaveBeenCalledTimes(1);
  });

  it('un error de red al crear se propaga tal cual y el estado conserva la MISMA clave para reintentar', async () => {
    const error = redCaida();
    const { io } = fakeIO(async () => {
      throw error;
    });
    const estado = estadoInicialAlta();
    const clave = estado.clientRef;
    await expect(altaCliente({ datos: { nombre: 'Nuevo' }, forzar: false, clientes: [ALMACEN], estado, io })).rejects.toBe(error);
    expect(estado.clientRef).toBe(clave);
    expect([...estado.nombresEnviados]).toEqual(['nuevo']);
  });

  it('un error que no se arregla reintentando (check de la base) también se propaga sin tocar la clave', async () => {
    const error = datosInvalidos();
    const { io } = fakeIO(async () => {
      throw error;
    });
    const estado = estadoInicialAlta();
    const clave = estado.clientRef;
    await expect(altaCliente({ datos: { nombre: 'Nuevo' }, forzar: false, clientes: [], estado, io })).rejects.toBe(error);
    expect(estado.clientRef).toBe(clave);
  });

  it('REINTENTO tras una respuesta perdida: aunque la lista ya traiga al cliente creado, NO avisa de duplicado y manda la MISMA clave (la base lo reconoce)', async () => {
    const perdido: ClienteOpcion = { id: 'c-perdido', nombre: 'Nuevo Cliente' };
    let intento = 0;
    const crear = vi.fn<AltaClienteIO['crear']>(async () => {
      intento += 1;
      if (intento === 1) throw redCaida(); // el INSERT llegó, la respuesta se perdió
      return perdido; // 23505 del client_ref -> "ya estaba guardado": devuelve ESE cliente
    });
    const estado = estadoInicialAlta();

    await expect(altaCliente({ datos: { nombre: 'Nuevo Cliente' }, forzar: false, clientes: [ALMACEN], estado, io: { crear } })).rejects.toThrow();
    // La lista se refrescó en segundo plano y ahora trae al que se creó: con el aviso de siempre diría "ya tienes uno así".
    const r = await altaCliente({ datos: { nombre: 'Nuevo Cliente' }, forzar: false, clientes: [ALMACEN, perdido], estado, io: { crear } });
    expect(r).toEqual({ tipo: 'creado', cliente: perdido });
    expect(crear).toHaveBeenCalledTimes(2);
    const [primero, segundo] = crear.mock.calls.map((c) => c[0] as CrearArgs);
    expect(segundo!.clientRef).toBe(primero!.clientRef);
    expect(segundo!.sent).toBe(primero!.sent);
  });

  it('REINTENTO cuando el primer intento no llegó a la base: vuelve a crear con la misma clave', async () => {
    let intento = 0;
    const crear = vi.fn<AltaClienteIO['crear']>(async ({ datos }) => {
      intento += 1;
      if (intento === 1) throw redCaida();
      return { id: 'c-ok', nombre: datos.nombre };
    });
    const estado = estadoInicialAlta();

    await expect(altaCliente({ datos: { nombre: 'Otro' }, forzar: false, clientes: [ALMACEN, FRIGO], estado, io: { crear } })).rejects.toThrow();
    const r = await altaCliente({ datos: { nombre: 'Otro' }, forzar: false, clientes: [ALMACEN, FRIGO], estado, io: { crear } });
    expect(r).toEqual({ tipo: 'creado', cliente: { id: 'c-ok', nombre: 'Otro' } });
    expect(crear).toHaveBeenCalledTimes(2);
    expect((crear.mock.calls[1]![0] as CrearArgs).clientRef).toBe(estado.clientRef);
  });

  it('si la persona CAMBIA el nombre entre intentos, el nombre nuevo sí pasa por el aviso de duplicado', async () => {
    const crear = vi.fn<AltaClienteIO['crear']>(async () => {
      throw redCaida();
    });
    const estado = estadoInicialAlta();
    await expect(altaCliente({ datos: { nombre: 'Nuevo' }, forzar: false, clientes: [FRIGO], estado, io: { crear } })).rejects.toThrow();
    const r = await altaCliente({ datos: { nombre: 'Frigorifico sur' }, forzar: false, clientes: [FRIGO], estado, io: { crear } });
    expect(r).toEqual({ tipo: 'duplicado', existente: FRIGO });
    expect(crear).toHaveBeenCalledTimes(1);
  });

  it('"Crear de todos modos" que falla por red: el "Reintentar" (sin forzar) NO vuelve a avisar del homónimo y usa la misma clave', async () => {
    let intento = 0;
    const crear = vi.fn<AltaClienteIO['crear']>(async ({ datos }) => {
      intento += 1;
      if (intento === 1) throw redCaida();
      return { id: 'c-nuevo-2', nombre: datos.nombre };
    });
    const estado = estadoInicialAlta();

    await expect(altaCliente({ datos: { nombre: 'Almacén Central' }, forzar: true, clientes: [ALMACEN], estado, io: { crear } })).rejects.toThrow();
    const r = await altaCliente({ datos: { nombre: 'Almacén Central' }, forzar: false, clientes: [ALMACEN], estado, io: { crear } });
    expect(r.tipo).toBe('creado');
    expect(crear).toHaveBeenCalledTimes(2);
    expect((crear.mock.calls[1]![0] as CrearArgs).clientRef).toBe((crear.mock.calls[0]![0] as CrearArgs).clientRef);
  });

  it('el reintento de un nombre ya mandado se reconoce aunque se escriba distinto (mayúsculas, tildes, espacios)', async () => {
    const crear = vi.fn<AltaClienteIO['crear']>(async () => {
      throw redCaida();
    });
    const estado = estadoInicialAlta();
    await expect(altaCliente({ datos: { nombre: 'Almacén Central' }, forzar: true, clientes: [ALMACEN], estado, io: { crear } })).rejects.toThrow();
    await expect(altaCliente({ datos: { nombre: '  ALMACEN   central ' }, forzar: false, clientes: [ALMACEN], estado, io: { crear } })).rejects.toThrow();
    expect(crear).toHaveBeenCalledTimes(2); // llegó a crear: no se quedó en el aviso
  });
});
