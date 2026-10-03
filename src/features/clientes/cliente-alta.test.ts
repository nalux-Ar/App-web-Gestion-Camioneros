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

/** Un error de red como el que arma `unwrap()` desde supabase-js: sin código de servidor. */
const redCaida = () => new DataRequestError({ message: 'TypeError: Failed to fetch', code: '' });
/** Un error que no se arregla reintentando (check de la base). */
const datosInvalidos = () => new DataRequestError({ message: 'check violado', code: '23514' }, 400);

function fakeIO(crearImpl?: AltaClienteIO['crear']) {
  const crear = vi.fn<AltaClienteIO['crear']>(crearImpl ?? (async (nombre) => ({ id: 'c-nuevo', nombre })));
  const refrescar = vi.fn<AltaClienteIO['refrescar']>(async () => [ALMACEN, FRIGO]);
  const io: AltaClienteIO = { crear, refrescar };
  return { io, crear, refrescar };
}

describe('altaCliente', () => {
  it('nombre nuevo: crea y devuelve el cliente que guardó la base; no refresca la lista', async () => {
    const { io, crear, refrescar } = fakeIO();
    const r = await altaCliente({ nombre: 'Distribuidora Norte', forzar: false, clientes: [ALMACEN, FRIGO], estado: estadoInicialAlta(), io });
    expect(r).toEqual({ tipo: 'creado', cliente: { id: 'c-nuevo', nombre: 'Distribuidora Norte' } });
    expect(crear).toHaveBeenCalledTimes(1);
    expect(crear).toHaveBeenCalledWith('Distribuidora Norte');
    expect(refrescar).not.toHaveBeenCalled();
  });

  it('duplicado (ignorando mayúsculas, tildes y espacios): NO crea y devuelve al existente', async () => {
    const { io, crear } = fakeIO();
    const r = await altaCliente({ nombre: ' frigorifico  SUR ', forzar: false, clientes: [ALMACEN, FRIGO], estado: estadoInicialAlta(), io });
    expect(r).toEqual({ tipo: 'duplicado', existente: FRIGO });
    expect(crear).not.toHaveBeenCalled();
  });

  it('"Crear de todos modos": se salta el aviso y crea el homónimo', async () => {
    const { io, crear } = fakeIO();
    const r = await altaCliente({ nombre: 'Almacen Central', forzar: true, clientes: [ALMACEN], estado: estadoInicialAlta(), io });
    expect(r.tipo).toBe('creado');
    expect(crear).toHaveBeenCalledTimes(1);
  });

  it('un error de red al crear se propaga y deja anotado que el próximo intento tiene que verificar', async () => {
    const { io } = fakeIO(async () => {
      throw redCaida();
    });
    const estado = estadoInicialAlta();
    await expect(altaCliente({ nombre: 'Nuevo', forzar: false, clientes: [ALMACEN], estado, io })).rejects.toThrow();
    expect(estado.verificarAntes).toBe(true);
  });

  it('un error que no se arregla reintentando (check de la base) NO deja duda anotada', async () => {
    const { io } = fakeIO(async () => {
      throw datosInvalidos();
    });
    const estado = estadoInicialAlta();
    await expect(altaCliente({ nombre: 'Nuevo', forzar: false, clientes: [], estado, io })).rejects.toThrow();
    expect(estado.verificarAntes).toBe(false);
  });

  it('REINTENTO tras una respuesta perdida: refresca la lista primero y, si el cliente ya está, devuelve duplicado SIN crear otro', async () => {
    const creado: ClienteOpcion = { id: 'c-perdido', nombre: 'Nuevo Cliente' };
    // 1er intento: el INSERT llega a la base pero la respuesta se pierde (la lista local no lo tiene).
    const crear = vi.fn<AltaClienteIO['crear']>(async () => {
      throw redCaida();
    });
    const refrescar = vi.fn<AltaClienteIO['refrescar']>(async () => [ALMACEN, FRIGO, creado]); // la base SÍ lo tiene
    const fake: AltaClienteIO = { crear, refrescar };
    const estado = estadoInicialAlta();

    await expect(altaCliente({ nombre: 'Nuevo Cliente', forzar: false, clientes: [ALMACEN, FRIGO], estado, io: fake })).rejects.toThrow();
    expect(crear).toHaveBeenCalledTimes(1);
    expect(refrescar).not.toHaveBeenCalled();

    // "Reintentar": con la MISMA lista local (vieja). Tiene que mirar la lista fresca.
    const r = await altaCliente({ nombre: 'Nuevo Cliente', forzar: false, clientes: [ALMACEN, FRIGO], estado, io: fake });
    expect(refrescar).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ tipo: 'duplicado', existente: creado });
    expect(crear).toHaveBeenCalledTimes(1); // no se creó un segundo
  });

  it('REINTENTO cuando el primer intento no llegó a la base: refresca, no encuentra nada y recién ahí crea', async () => {
    let intento = 0;
    const crear = vi.fn<AltaClienteIO['crear']>(async (nombre) => {
      intento += 1;
      if (intento === 1) throw redCaida();
      return { id: 'c-ok', nombre };
    });
    const refrescar = vi.fn<AltaClienteIO['refrescar']>(async () => [ALMACEN, FRIGO]);
    const estado = estadoInicialAlta();
    const fake: AltaClienteIO = { crear, refrescar };

    await expect(altaCliente({ nombre: 'Otro', forzar: false, clientes: [ALMACEN, FRIGO], estado, io: fake })).rejects.toThrow();
    const r = await altaCliente({ nombre: 'Otro', forzar: false, clientes: [ALMACEN, FRIGO], estado, io: fake });
    expect(r).toEqual({ tipo: 'creado', cliente: { id: 'c-ok', nombre: 'Otro' } });
    expect(refrescar).toHaveBeenCalledTimes(1);
    expect(crear).toHaveBeenCalledTimes(2);
    // Creado bien: la duda se limpia, el próximo alta no refresca.
    expect(estado.verificarAntes).toBe(false);
  });

  it('si el refresco de la lista falla (sin red) NO se crea nada y la duda sigue en pie', async () => {
    const crear = vi.fn<AltaClienteIO['crear']>(async () => {
      throw redCaida();
    });
    const refrescar = vi.fn<AltaClienteIO['refrescar']>(async () => {
      throw redCaida();
    });
    const estado = estadoInicialAlta();
    const fake: AltaClienteIO = { crear, refrescar };

    await expect(altaCliente({ nombre: 'Nuevo', forzar: false, clientes: [], estado, io: fake })).rejects.toThrow();
    await expect(altaCliente({ nombre: 'Nuevo', forzar: false, clientes: [], estado, io: fake })).rejects.toThrow();
    expect(refrescar).toHaveBeenCalledTimes(1);
    expect(crear).toHaveBeenCalledTimes(1); // el segundo intento no llegó a crear
    expect(estado.verificarAntes).toBe(true);
    // Y un tercero con red vuelve a refrescar antes de crear.
    refrescar.mockResolvedValueOnce([ALMACEN]);
    crear.mockResolvedValueOnce({ id: 'c-3', nombre: 'Nuevo' });
    const r = await altaCliente({ nombre: 'Nuevo', forzar: false, clientes: [], estado, io: fake });
    expect(r.tipo).toBe('creado');
    expect(refrescar).toHaveBeenCalledTimes(2);
  });

  it('"Crear de todos modos" que falla por red: el reintento ignora al homónimo aceptado pero SÍ detecta al que pudo crearse', async () => {
    const aceptado: ClienteOpcion = { id: 'c-viejo', nombre: 'Almacén Central' };
    const huerfano: ClienteOpcion = { id: 'c-respuesta-perdida', nombre: 'Almacén Central' };
    const crear = vi.fn<AltaClienteIO['crear']>(async () => {
      throw redCaida();
    });
    const refrescar = vi.fn<AltaClienteIO['refrescar']>(async () => [aceptado, huerfano]);
    const estado = estadoInicialAlta();
    const fake: AltaClienteIO = { crear, refrescar };

    // La persona vio el aviso (ya había una "Almacén Central") y eligió "Crear de todos modos"; la respuesta se pierde.
    await expect(altaCliente({ nombre: 'Almacén Central', forzar: true, clientes: [aceptado], estado, io: fake })).rejects.toThrow();
    expect([...estado.ignorar]).toEqual(['c-viejo']);

    // Reintentar (sin forzar): el viejo no cuenta, pero el nuevo (que no estaba antes) sí.
    const r = await altaCliente({ nombre: 'Almacén Central', forzar: false, clientes: [aceptado], estado, io: fake });
    expect(r).toEqual({ tipo: 'duplicado', existente: huerfano });
    expect(crear).toHaveBeenCalledTimes(1);
  });

  it('"Crear de todos modos" que falla por red y la base NO lo creó: el reintento crea sin volver a avisar del homónimo viejo', async () => {
    const aceptado: ClienteOpcion = { id: 'c-viejo', nombre: 'Almacén Central' };
    let intento = 0;
    const crear = vi.fn<AltaClienteIO['crear']>(async (nombre) => {
      intento += 1;
      if (intento === 1) throw redCaida();
      return { id: 'c-nuevo-2', nombre };
    });
    const refrescar = vi.fn<AltaClienteIO['refrescar']>(async () => [aceptado]);
    const estado = estadoInicialAlta();
    const fake: AltaClienteIO = { crear, refrescar };

    await expect(altaCliente({ nombre: 'Almacén Central', forzar: true, clientes: [aceptado], estado, io: fake })).rejects.toThrow();
    const r = await altaCliente({ nombre: 'Almacén Central', forzar: false, clientes: [aceptado], estado, io: fake });
    expect(r.tipo).toBe('creado');
    expect(crear).toHaveBeenCalledTimes(2);
    expect(estado.ignorar.size).toBe(0); // tras crear bien, el estado se limpia
  });
});
