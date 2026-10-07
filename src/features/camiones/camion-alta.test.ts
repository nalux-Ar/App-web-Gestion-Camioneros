import { describe, expect, it, vi } from 'vitest';

import {
  UNICO_ACTIVO_MESSAGE,
  altaCamion,
  estadoInicialAltaCamion,
  verificarPuedeArchivar,
  type AltaCamionIO,
} from '@/features/camiones/camion-alta';
import type { ResultadoCrearCamion } from '@/features/camiones/camiones-api';
import { DataRequestError, UserMessageError, isRetryableDataError, mapDataError } from '@/lib/data-errors';

const COLUMNS = { patente: 'AB123CD', marca: 'Scania', modelo: null, anio: 2019 };
const resultado = (over: Partial<ResultadoCrearCamion> = {}): ResultadoCrearCamion => ({
  camionId: 'c-1',
  creado: true,
  viajesAsignados: 0,
  gastosAsignados: 0,
  activa: true,
  ...over,
});
const redCaida = () => new DataRequestError({ message: 'TypeError: Failed to fetch', code: '' });

function fakeIO(crear: AltaCamionIO['crear']) {
  const io = { crear: vi.fn<AltaCamionIO['crear']>(crear), actualizar: vi.fn<AltaCamionIO['actualizar']>(async () => {}) };
  return io;
}

describe('altaCamion', () => {
  it('creado: devuelve el id y lo que se le asignó (primer camión), y no actualiza nada', async () => {
    const io = fakeIO(async () => resultado({ viajesAsignados: 6, gastosAsignados: 2 }));
    const r = await altaCamion({ columns: COLUMNS, estado: estadoInicialAltaCamion(), io });
    expect(r).toEqual({ tipo: 'creado', camionId: 'c-1', viajesAsignados: 6, gastosAsignados: 2 });
    expect(io.crear).toHaveBeenCalledWith(COLUMNS);
    expect(io.actualizar).not.toHaveBeenCalled();
  });

  it('patente repetida (sin un intento anterior en duda): "duplicado", con si está activo o archivado, y no toca nada', async () => {
    for (const activa of [true, false]) {
      const io = fakeIO(async () => resultado({ creado: false, activa, camionId: 'viejo' }));
      const r = await altaCamion({ columns: COLUMNS, estado: estadoInicialAltaCamion(), io });
      expect(r, String(activa)).toEqual({ tipo: 'duplicado', camionId: 'viejo', activa });
      expect(io.actualizar).not.toHaveBeenCalled();
    }
  });

  it('REINTENTO tras una respuesta perdida: el 1er intento falla por red (queda la duda) y el 2º devuelve creado = false -> "ya-guardado"', async () => {
    let intento = 0;
    const io = fakeIO(async () => {
      intento += 1;
      if (intento === 1) throw redCaida();
      return resultado({ creado: false, camionId: 'c-1' });
    });
    const estado = estadoInicialAltaCamion();
    await expect(altaCamion({ columns: COLUMNS, estado, io })).rejects.toBeInstanceOf(DataRequestError);
    expect([...estado.patentesEnDuda]).toEqual(['AB123CD']);
    const r = await altaCamion({ columns: COLUMNS, estado, io });
    expect(r).toEqual({ tipo: 'ya-guardado', camionId: 'c-1' });
    // Con lo mismo que se mandó en el intento perdido no hay nada que escribir: si el camión es el nuestro ya lo tiene, y
    // si era uno que ya existía, no se le pisan los datos (ver la prueba del escenario de la auditoría, más abajo).
    expect(io.actualizar).not.toHaveBeenCalled();
    expect(estado.patentesEnDuda.size).toBe(0);
    expect(estado.enviadosEnDuda.size).toBe(0);
  });

  it('REINTENTO con la marca, el modelo o el año CAMBIADOS entre intentos: se deja con lo que está en pantalla', async () => {
    let intento = 0;
    const io = fakeIO(async () => {
      intento += 1;
      if (intento === 1) throw redCaida();
      return resultado({ creado: false, camionId: 'c-1' });
    });
    const estado = estadoInicialAltaCamion();
    await expect(altaCamion({ columns: COLUMNS, estado, io })).rejects.toThrow();
    const corregidas = { ...COLUMNS, marca: 'Mercedes', modelo: '1634', anio: 2021 };
    expect(await altaCamion({ columns: corregidas, estado, io })).toEqual({ tipo: 'ya-guardado', camionId: 'c-1' });
    expect(io.actualizar).toHaveBeenCalledTimes(1);
    expect(io.actualizar).toHaveBeenCalledWith('c-1', corregidas);
  });

  it('AUDITORÍA: un camión que YA existía con esa patente no se pisa si el reintento manda lo mismo que el intento perdido (alta en línea con todo vacío)', async () => {
    // El primer intento se cortó antes de llegar a la base; en la base ya estaba "AB123CD" con marca, modelo y año.
    // El reintento devuelve creado = false y activo: no se distingue de "lo creó el intento perdido". Sin tocar nada.
    const EN_LINEA = { patente: 'AB123CD', marca: null, modelo: null, anio: null };
    let intento = 0;
    const io = fakeIO(async () => {
      intento += 1;
      if (intento === 1) throw redCaida();
      return resultado({ creado: false, camionId: 'viejo' });
    });
    const estado = estadoInicialAltaCamion();
    await expect(altaCamion({ columns: EN_LINEA, estado, io })).rejects.toThrow();
    expect(await altaCamion({ columns: EN_LINEA, estado, io })).toEqual({ tipo: 'ya-guardado', camionId: 'viejo' });
    expect(io.actualizar).not.toHaveBeenCalled(); // nada de UPDATE con marca = null, modelo = null, anio = null
  });

  it('varios intentos dudosos con valores DISTINTOS: el camión pudo quedar con los de cualquiera -> se actualiza aunque el último reintento coincida con uno', async () => {
    let intento = 0;
    const io = fakeIO(async () => {
      intento += 1;
      if (intento <= 2) throw redCaida();
      return resultado({ creado: false, camionId: 'c-1' });
    });
    const estado = estadoInicialAltaCamion();
    const otra = { ...COLUMNS, marca: 'Volvo' };
    await expect(altaCamion({ columns: COLUMNS, estado, io })).rejects.toThrow();
    await expect(altaCamion({ columns: otra, estado, io })).rejects.toThrow();
    expect(estado.enviadosEnDuda.get('AB123CD')?.size).toBe(2);
    expect(await altaCamion({ columns: otra, estado, io })).toEqual({ tipo: 'ya-guardado', camionId: 'c-1' });
    expect(io.actualizar).toHaveBeenCalledWith('c-1', otra);
  });

  it('si esa actualización falla, la duda sigue y el próximo reintento vuelve a actualizar', async () => {
    let intento = 0;
    const io = fakeIO(async () => {
      intento += 1;
      if (intento === 1) throw redCaida();
      return resultado({ creado: false });
    });
    io.actualizar.mockRejectedValueOnce(redCaida());
    const estado = estadoInicialAltaCamion();
    const corregidas = { ...COLUMNS, anio: 2022 };
    await expect(altaCamion({ columns: COLUMNS, estado, io })).rejects.toThrow();
    await expect(altaCamion({ columns: corregidas, estado, io })).rejects.toThrow();
    expect(estado.patentesEnDuda.has('AB123CD')).toBe(true);
    expect(await altaCamion({ columns: corregidas, estado, io })).toEqual({ tipo: 'ya-guardado', camionId: 'c-1' });
    expect(io.actualizar).toHaveBeenCalledTimes(2);
  });

  it('en duda pero el camión existente está ARCHIVADO: no es el nuestro (el nuestro nacería activo) -> "duplicado"', async () => {
    let intento = 0;
    const io = fakeIO(async () => {
      intento += 1;
      if (intento === 1) throw redCaida();
      return resultado({ creado: false, activa: false });
    });
    const estado = estadoInicialAltaCamion();
    await expect(altaCamion({ columns: COLUMNS, estado, io })).rejects.toThrow();
    expect(await altaCamion({ columns: COLUMNS, estado, io })).toEqual({ tipo: 'duplicado', camionId: 'c-1', activa: false });
  });

  it('la duda es por patente: otra patente repetida no se toma por el reintento', async () => {
    let intento = 0;
    const io = fakeIO(async () => {
      intento += 1;
      if (intento === 1) throw redCaida();
      return resultado({ creado: false });
    });
    const estado = estadoInicialAltaCamion();
    await expect(altaCamion({ columns: COLUMNS, estado, io })).rejects.toThrow();
    expect(await altaCamion({ columns: { ...COLUMNS, patente: 'ZZ999ZZ' }, estado, io })).toMatchObject({ tipo: 'duplicado' });
  });

  it('un error que no se arregla reintentando (patente inválida, sin permiso) NO deja duda', async () => {
    for (const code of ['23514', '42501']) {
      const io = fakeIO(async () => {
        throw new DataRequestError({ message: 'x', code }, 400);
      });
      const estado = estadoInicialAltaCamion();
      await expect(altaCamion({ columns: COLUMNS, estado, io })).rejects.toThrow();
      expect(estado.patentesEnDuda.size, code).toBe(0);
    }
  });

  it('crear bien limpia la duda', async () => {
    const estado = estadoInicialAltaCamion();
    estado.patentesEnDuda.add('OTRA');
    estado.enviadosEnDuda.set('OTRA', new Set(['x']));
    await altaCamion({ columns: COLUMNS, estado, io: fakeIO(async () => resultado()) });
    expect(estado.patentesEnDuda.size).toBe(0);
    expect(estado.enviadosEnDuda.size).toBe(0);
  });
});

describe('verificarPuedeArchivar (regla del front: el único activo no se archiva)', () => {
  it('con 2 o más activos (contados FRESCOS) se puede', async () => {
    await expect(verificarPuedeArchivar(async () => 2)).resolves.toBeUndefined();
    await expect(verificarPuedeArchivar(async () => 7)).resolves.toBeUndefined();
  });

  it('con 1 (o 0) no: UserMessageError NO reintentable con el mensaje', async () => {
    for (const activos of [1, 0]) {
      const error = await verificarPuedeArchivar(async () => activos).then(() => null, (e: unknown) => e);
      expect(error, String(activos)).toBeInstanceOf(UserMessageError);
      expect(mapDataError(error)).toBe(UNICO_ACTIVO_MESSAGE);
      expect(isRetryableDataError(error)).toBe(false);
    }
    expect(UNICO_ACTIVO_MESSAGE).toBe('Es tu único camión activo: primero carga el camión que lo reemplaza.');
  });

  it('si el conteo falla, el error se propaga (no se archiva a ciegas)', async () => {
    const error = redCaida();
    await expect(verificarPuedeArchivar(async () => Promise.reject(error))).rejects.toBe(error);
  });
});
