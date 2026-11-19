import { describe, expect, it } from 'vitest';

import { INVALID_DATA_MESSAGE } from '@/features/auth/auth-errors';
import { CLIENT_REF_CONSTRAINT } from '@/features/gastos/client-ref';
import { COMBUSTIBLE_CATEGORIA_ID, GUARDAR_GASTO_CONTEXT, MAX_GASTOS_POR_CARGA } from '@/features/gastos/constants';
import { buildInsertRow, type GastoColumns } from '@/features/gastos/gasto-form';
import { LoteDeGastosDistintoError, LoteDeGastosInvalidoError } from '@/features/gastos/gasto-lote-errores';
import { crearGastos, type GastoLoteWriteIO, type GastoParaGuardar } from '@/features/gastos/gasto-lote-save';
import { GUARDAR_LOTE_CONTEXT, LOTE_DISTINTO_MESSAGE, LOTE_NO_ENCONTRADO_MESSAGE } from '@/features/gastos/gasto-lote-textos';
import { DataRequestError, RecordNotFoundError, classifyDataError, isRetryableDataError, mapDataError } from '@/lib/data-errors';
import type { NewRow, RowChanges } from '@/lib/db';

// Guardar varios gastos de una vez con el IO inyectado (sin Supabase). Es `crearGasto` para N gastos: UN solo INSERT con todas las
// filas (una sola transacción), un `client_ref` por gasto y la misma idempotencia. Todos los datos son inventados.
const CAT_PEAJES = '2a000000-0000-4000-8000-000000000001';
const CAT_COMIDA = '2a000000-0000-4000-8000-000000000002';
const CAMION = 'c0000000-0000-4000-8000-000000000001';
const REF_A = '5a000000-0000-4000-8000-0000000000a1';
const REF_B = '5a000000-0000-4000-8000-0000000000b2';
const REF_C = '5a000000-0000-4000-8000-0000000000c3';
const REF_D = '5a000000-0000-4000-8000-0000000000d4';

const peaje: GastoColumns = {
  categoria_id: CAT_PEAJES,
  monto: 300,
  fecha: '2026-10-02',
  viaje_id: null,
  descripcion: null,
  metodo_pago: 'efectivo',
  litros: null,
  precio_por_litro: null,
  km_odometro: null,
  tanque_lleno: null,
  camion_id: null,
};
const combustible: GastoColumns = {
  ...peaje,
  categoria_id: COMBUSTIBLE_CATEGORIA_ID,
  monto: 40000,
  metodo_pago: 'tarjeta_credito',
  litros: 40,
  precio_por_litro: 1000,
  km_odometro: 120000,
  tanque_lleno: true,
  camion_id: CAMION,
};
const comida: GastoColumns = { ...peaje, categoria_id: CAT_COMIDA, monto: 1500, descripcion: 'Almuerzo' };

const items = (): GastoParaGuardar[] => [
  { columns: peaje, clientRef: REF_A },
  { columns: combustible, clientRef: REF_B },
];

/** El error que arma `unwrap` cuando el client_ref ya existe (23505 del índice único de gastos). */
const duplicadoDeClientRef = (constraint = CLIENT_REF_CONSTRAINT) =>
  Object.assign(new Error(`duplicate key value violates unique constraint "${constraint}"`), { code: '23505', details: '' });
const sinRed = () => Object.assign(new Error('TypeError: Failed to fetch'), { code: '' });

interface Registro {
  inserts: Array<Array<NewRow<'gastos'>>>;
  updates: Array<{ clientRef: string; changes: RowChanges<'gastos'> }>;
}

/** Un IO de mentira: cada INSERT / UPDATE se anota y responde lo que diga el guion (`insert`, `update`: el número de intento desde 1). */
function ioDeMentira(guion: { insert?: (n: number) => Error | null; update?: (n: number) => Error | null } = {}) {
  const registro: Registro = { inserts: [], updates: [] };
  const io: GastoLoteWriteIO = {
    async insertMany(rows) {
      registro.inserts.push([...rows]);
      const error = guion.insert?.(registro.inserts.length) ?? null;
      if (error) throw error;
    },
    async updateByClientRef(clientRef, changes) {
      registro.updates.push({ clientRef, changes });
      const error = guion.update?.(registro.updates.length) ?? null;
      if (error) throw error;
    },
  };
  return { io, registro };
}

/** El primer intento no tiene respuesta y los demás dan 23505 (el primero SÍ había llegado). */
const primeroSinRespuesta = (n: number) => (n === 1 ? sinRed() : duplicadoDeClientRef());

async function rechazo(promesa: Promise<unknown>): Promise<unknown> {
  try {
    await promesa;
  } catch (error) {
    return error;
  }
  throw new Error('debería haber tirado');
}

describe('crearGastos: el INSERT de todos los gastos en UN solo pedido', () => {
  it('«creados»: UN solo insertMany con una fila por gasto (sus columnas + su client_ref), en el mismo orden, y ningún UPDATE', async () => {
    const { io, registro } = ioDeMentira();
    const sent = new Set<string>();
    await expect(crearGastos({ items: items(), sent, io })).resolves.toBe('creados');
    expect(registro.inserts).toHaveLength(1); // un pedido, no uno por gasto
    expect(registro.inserts[0]).toEqual([buildInsertRow(peaje, REF_A), buildInsertRow(combustible, REF_B)]);
    expect(registro.updates).toEqual([]);
    expect(sent.size).toBe(1);
  });

  it('con UN solo gasto también sale por insertMany (con una sola fila)', async () => {
    const { io, registro } = ioDeMentira();
    await expect(crearGastos({ items: [{ columns: peaje, clientRef: REF_A }], sent: new Set(), io })).resolves.toBe('creados');
    expect(registro.inserts).toEqual([[buildInsertRow(peaje, REF_A)]]);
  });

  it(`con el tope (${MAX_GASTOS_POR_CARGA}) sigue siendo UN solo pedido`, async () => {
    const muchos = Array.from({ length: MAX_GASTOS_POR_CARGA }, (_, i) => ({
      columns: { ...peaje, monto: i + 1 },
      clientRef: `5a000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
    }));
    const { io, registro } = ioDeMentira();
    await expect(crearGastos({ items: muchos, sent: new Set(), io })).resolves.toBe('creados');
    expect(registro.inserts).toHaveLength(1);
    expect(registro.inserts[0]).toHaveLength(MAX_GASTOS_POR_CARGA);
  });

  it('cada fila lleva SU PROPIO client_ref (el que se le pasó, distinto en cada una) y ninguna lleva transportista_id ni id', async () => {
    const { io, registro } = ioDeMentira();
    await crearGastos({ items: [...items(), { columns: comida, clientRef: REF_C }], sent: new Set(), io });
    const filas = registro.inserts[0]!;
    expect(filas.map((fila) => fila.client_ref)).toEqual([REF_A, REF_B, REF_C]);
    expect(new Set(filas.map((fila) => fila.client_ref)).size).toBe(3);
    for (const fila of filas) {
      expect(fila).not.toHaveProperty('transportista_id');
      expect(fila).not.toHaveProperty('id');
    }
  });

  it('cada fila lleva todas las columnas de su gasto (no se mezclan entre filas)', async () => {
    const { io, registro } = ioDeMentira();
    await crearGastos({ items: items(), sent: new Set(), io });
    expect(registro.inserts[0]![0]).toMatchObject({ categoria_id: CAT_PEAJES, monto: 300, metodo_pago: 'efectivo', litros: null, camion_id: null });
    expect(registro.inserts[0]![1]).toMatchObject({ categoria_id: COMBUSTIBLE_CATEGORIA_ID, monto: 40000, metodo_pago: 'tarjeta_credito', litros: 40, camion_id: CAMION });
  });

  it('el client_ref es el MISMO en cada reintento: no se regenera acá', async () => {
    const { io, registro } = ioDeMentira({ insert: primeroSinRespuesta });
    const sent = new Set<string>();
    await rechazo(crearGastos({ items: items(), sent, io }));
    await crearGastos({ items: items(), sent, io });
    expect(registro.inserts).toHaveLength(2);
    expect(registro.inserts[1]!.map((fila) => fila.client_ref)).toEqual(registro.inserts[0]!.map((fila) => fila.client_ref));
    expect(registro.inserts[0]!.map((fila) => fila.client_ref)).toEqual([REF_A, REF_B]);
  });

  it('no modifica los gastos que recibe', async () => {
    const lista = items();
    const copia = structuredClone(lista);
    await crearGastos({ items: lista, sent: new Set(), io: ioDeMentira().io });
    expect(lista).toEqual(copia);
  });
});

describe('crearGastos: el 23505 del client_ref (el pedido anterior SÍ llegó: existen todos)', () => {
  it('«ya-guardados»: da 23505 y lo mandado es lo mismo que hay en pantalla -> éxito, SIN actualizar nada', async () => {
    const { io, registro } = ioDeMentira({ insert: () => duplicadoDeClientRef() });
    await expect(crearGastos({ items: items(), sent: new Set(), io })).resolves.toBe('ya-guardados');
    expect(registro.updates).toEqual([]);
  });

  it('respuesta perdida y reintento SIN cambios: el primer intento falla sin respuesta, el segundo da 23505 -> «ya-guardados», sin duplicar ni actualizar', async () => {
    const sent = new Set<string>();
    const { io, registro } = ioDeMentira({ insert: primeroSinRespuesta });
    await expect(crearGastos({ items: items(), sent, io })).rejects.toThrow('Failed to fetch');
    await expect(crearGastos({ items: items(), sent, io })).resolves.toBe('ya-guardados');
    expect(registro.inserts).toHaveLength(2);
    expect(registro.updates).toEqual([]);
  });

  it('«ya-guardados-actualizados»: el usuario cambió algo entre intentos -> UPDATE por client_ref de CADA gasto con lo de pantalla (sin client_ref)', async () => {
    const sent = new Set<string>();
    const { io, registro } = ioDeMentira({ insert: primeroSinRespuesta });
    await rechazo(crearGastos({ items: items(), sent, io }));
    const cambiados: GastoParaGuardar[] = [
      { columns: { ...peaje, monto: 350 }, clientRef: REF_A },
      { columns: combustible, clientRef: REF_B },
    ];
    await expect(crearGastos({ items: cambiados, sent, io })).resolves.toBe('ya-guardados-actualizados');

    expect(registro.updates.map((u) => u.clientRef)).toEqual([REF_A, REF_B]); // todos, cada uno por SU client_ref
    expect(registro.updates[0]!.changes).toEqual({ ...peaje, monto: 350 });
    expect(registro.updates[1]!.changes).toEqual(combustible);
    for (const { changes } of registro.updates) expect(changes).not.toHaveProperty('client_ref');
  });

  it('cambiar UN solo campo de UN solo gasto entre intentos también actualiza (la huella cubre cada campo de cada gasto)', async () => {
    const cambios: Array<[string, GastoParaGuardar[]]> = [
      ['monto del primero', [{ columns: { ...peaje, monto: 301 }, clientRef: REF_A }, { columns: combustible, clientRef: REF_B }]],
      ['monto del segundo', [{ columns: peaje, clientRef: REF_A }, { columns: { ...combustible, monto: 1 }, clientRef: REF_B }]],
      ['método de pago del segundo', [{ columns: peaje, clientRef: REF_A }, { columns: { ...combustible, metodo_pago: 'efectivo' }, clientRef: REF_B }]],
      ['descripción del primero', [{ columns: { ...peaje, descripcion: 'x' }, clientRef: REF_A }, { columns: combustible, clientRef: REF_B }]],
      ['fecha de los dos', [{ columns: { ...peaje, fecha: '2026-10-01' }, clientRef: REF_A }, { columns: { ...combustible, fecha: '2026-10-01' }, clientRef: REF_B }]],
      ['viaje de los dos', [{ columns: { ...peaje, viaje_id: 'b0000000-0000-4000-8000-000000000001' }, clientRef: REF_A }, { columns: { ...combustible, viaje_id: 'b0000000-0000-4000-8000-000000000001' }, clientRef: REF_B }]],
      ['litros del segundo', [{ columns: peaje, clientRef: REF_A }, { columns: { ...combustible, litros: 41 }, clientRef: REF_B }]],
      ['camión del segundo', [{ columns: peaje, clientRef: REF_A }, { columns: { ...combustible, camion_id: null }, clientRef: REF_B }]],
      ['categoría del primero', [{ columns: { ...peaje, categoria_id: CAT_COMIDA }, clientRef: REF_A }, { columns: combustible, clientRef: REF_B }]],
    ];
    for (const [nombre, cambiados] of cambios) {
      const sent = new Set<string>();
      const { io, registro } = ioDeMentira({ insert: primeroSinRespuesta });
      await rechazo(crearGastos({ items: items(), sent, io }));
      await expect(crearGastos({ items: cambiados, sent, io }), nombre).resolves.toBe('ya-guardados-actualizados');
      expect(registro.updates, nombre).toHaveLength(2);
    }
  });

  it('cada huella ata el contenido a SU client_ref: intercambiar lo que va en cada uno cuenta como un cambio', async () => {
    const sent = new Set<string>();
    const { io, registro } = ioDeMentira({ insert: primeroSinRespuesta });
    await rechazo(crearGastos({ items: items(), sent, io }));
    const intercambiados: GastoParaGuardar[] = [
      { columns: combustible, clientRef: REF_A },
      { columns: peaje, clientRef: REF_B },
    ];
    await expect(crearGastos({ items: intercambiados, sent, io })).resolves.toBe('ya-guardados-actualizados');
    expect(registro.updates).toEqual([
      { clientRef: REF_A, changes: combustible },
      { clientRef: REF_B, changes: peaje },
    ]);
  });

  it('el ORDEN de los gastos no es un cambio: los mismos gastos con los mismos client_ref en otro orden dan «ya-guardados»', async () => {
    const sent = new Set<string>();
    const { io, registro } = ioDeMentira({ insert: primeroSinRespuesta });
    await rechazo(crearGastos({ items: items(), sent, io }));
    await expect(crearGastos({ items: items().reverse(), sent, io })).resolves.toBe('ya-guardados');
    expect(registro.updates).toEqual([]);
  });

  it('cambiar algo y volver al valor original: ya se mandaron DOS huellas distintas, así que se actualiza otra vez en vez de dar por bueno lo guardado', async () => {
    const sent = new Set<string>();
    const { io, registro } = ioDeMentira({ insert: primeroSinRespuesta });
    await rechazo(crearGastos({ items: items(), sent, io }));
    const otros: GastoParaGuardar[] = [{ columns: { ...peaje, monto: 999 }, clientRef: REF_A }, { columns: combustible, clientRef: REF_B }];
    await expect(crearGastos({ items: otros, sent, io })).resolves.toBe('ya-guardados-actualizados');
    await expect(crearGastos({ items: items(), sent, io })).resolves.toBe('ya-guardados-actualizados');
    expect(registro.updates).toHaveLength(4);
    expect(registro.updates.slice(2)).toEqual([
      { clientRef: REF_A, changes: peaje },
      { clientRef: REF_B, changes: combustible },
    ]);
  });

  it('es conservador: si un UPDATE falla (el segundo de los dos) se corta ahí y el siguiente reintento vuelve a actualizar TODOS, no da por bueno un estado sin confirmar', async () => {
    const sent = new Set<string>();
    const cambiados: GastoParaGuardar[] = [{ columns: { ...peaje, monto: 999 }, clientRef: REF_A }, { columns: combustible, clientRef: REF_B }];
    const { io, registro } = ioDeMentira({
      insert: primeroSinRespuesta,
      update: (n) => (n === 2 ? sinRed() : null), // el UPDATE del segundo gasto del primer intento
    });
    await rechazo(crearGastos({ items: items(), sent, io })); // 1) sin respuesta
    await expect(crearGastos({ items: cambiados, sent, io })).rejects.toThrow('Failed to fetch'); // 2) 23505 + UPDATE A ok + UPDATE B que falla
    expect(registro.updates.map((u) => u.clientRef)).toEqual([REF_A, REF_B]);
    await expect(crearGastos({ items: cambiados, sent, io })).resolves.toBe('ya-guardados-actualizados'); // 3) los dos de nuevo
    expect(registro.updates.map((u) => u.clientRef)).toEqual([REF_A, REF_B, REF_A, REF_B]);
  });

  it('si falla el UPDATE del PRIMER gasto no se intenta el resto, y se propaga el error tal cual', async () => {
    const sent = new Set<string>();
    const error = sinRed();
    const { io, registro } = ioDeMentira({ insert: primeroSinRespuesta, update: () => error });
    await rechazo(crearGastos({ items: items(), sent, io }));
    await expect(crearGastos({ items: [{ columns: { ...peaje, monto: 9 }, clientRef: REF_A }, items()[1]!], sent, io })).rejects.toBe(error);
    expect(registro.updates).toHaveLength(1);
  });

  it('un UPDATE sin filas (un gasto ya no está) propaga RecordNotFoundError y no sigue con los demás', async () => {
    const sent = new Set<string>();
    const { io, registro } = ioDeMentira({ insert: primeroSinRespuesta, update: () => new RecordNotFoundError() });
    await rechazo(crearGastos({ items: items(), sent, io }));
    await expect(
      crearGastos({ items: [{ columns: { ...peaje, monto: 9 }, clientRef: REF_A }, items()[1]!], sent, io }),
    ).rejects.toBeInstanceOf(RecordNotFoundError);
    expect(registro.updates).toHaveLength(1);
  });

  it('el 23505 en el PRIMER intento con lo mismo (sin intentos anteriores) también es «ya-guardados»', async () => {
    const { io } = ioDeMentira({ insert: () => duplicadoDeClientRef() });
    await expect(crearGastos({ items: items(), sent: new Set(), io })).resolves.toBe('ya-guardados');
  });

  it('el nombre del índice también se reconoce en `details`', async () => {
    const enDetails = Object.assign(new Error('duplicate key value'), { code: '23505', details: `Key (transportista_id, client_ref) already exists. ${CLIENT_REF_CONSTRAINT}` });
    const { io } = ioDeMentira({ insert: () => enDetails });
    await expect(crearGastos({ items: items(), sent: new Set(), io })).resolves.toBe('ya-guardados');
  });
});

describe('crearGastos: lo que se propaga tal cual', () => {
  it('red, 23503, 23514 y un 23505 de OTRO índice (que NO es «ya guardados»): se propagan y no se actualiza nada', async () => {
    const errores = [
      sinRed(),
      Object.assign(new Error('violates foreign key constraint "gastos_viaje_fk"'), { code: '23503' }),
      Object.assign(new Error('violates check constraint "gastos_monto_chk"'), { code: '23514' }),
      duplicadoDeClientRef('gastos_pkey'),
      duplicadoDeClientRef('devoluciones_transportista_client_ref_uidx'),
      Object.assign(new Error('duplicate key'), { code: '23505' }), // sin nombre de constraint
    ];
    for (const error of errores) {
      const { io, registro } = ioDeMentira({ insert: () => error });
      await expect(crearGastos({ items: items(), sent: new Set(), io }), error.message).rejects.toBe(error);
      expect(registro.updates, error.message).toEqual([]);
    }
  });

  it('un error que NO es 23505 pero nombra el índice (p. ej. un 23503) tampoco es «ya guardados»', async () => {
    const raro = Object.assign(new Error(`algo con ${CLIENT_REF_CONSTRAINT}`), { code: '23503' });
    const { io } = ioDeMentira({ insert: () => raro });
    await expect(crearGastos({ items: items(), sent: new Set(), io })).rejects.toBe(raro);
  });

  it('un otro 23505 después de un intento sin respuesta NO se toma como «ya guardados» aunque lo mandado sea lo mismo', async () => {
    const sent = new Set<string>();
    const otro = duplicadoDeClientRef('gastos_pkey');
    const { io, registro } = ioDeMentira({ insert: (n) => (n === 1 ? sinRed() : otro) });
    await rechazo(crearGastos({ items: items(), sent, io }));
    await expect(crearGastos({ items: items(), sent, io })).rejects.toBe(otro);
    expect(registro.updates).toEqual([]);
  });

  it('lo que sale por la red sin respuesta deja anotada UNA huella (lo mandado), ni más ni menos; un reintento igual no suma otra', async () => {
    const sent = new Set<string>();
    const { io } = ioDeMentira({ insert: () => sinRed() });
    await rechazo(crearGastos({ items: items(), sent, io }));
    expect(sent.size).toBe(1);
    await rechazo(crearGastos({ items: items(), sent, io }));
    expect(sent.size).toBe(1);
    await rechazo(crearGastos({ items: [{ columns: { ...peaje, monto: 2 }, clientRef: REF_A }, items()[1]!], sent, io }));
    expect(sent.size).toBe(2);
  });
});

describe('crearGastos: los client_ref de ahora no son los de un intento anterior sin confirmar', () => {
  async function conUnIntentoSinConfirmar() {
    const sent = new Set<string>();
    const { io, registro } = ioDeMentira({ insert: (n) => (n === 1 ? sinRed() : duplicadoDeClientRef()) });
    await rechazo(crearGastos({ items: items(), sent, io }));
    expect(registro.inserts).toHaveLength(1);
    return { sent, io, registro };
  }

  it('se destildó una categoría (quedan menos): LoteDeGastosDistintoError, SIN tocar la red y sin anotar nada nuevo', async () => {
    const { sent, io, registro } = await conUnIntentoSinConfirmar();
    const antes = [...sent];
    const error = await rechazo(crearGastos({ items: [items()[0]!], sent, io }));
    expect(error).toBeInstanceOf(LoteDeGastosDistintoError);
    expect(registro.inserts).toHaveLength(1);
    expect(registro.updates).toEqual([]);
    expect([...sent]).toEqual(antes);
  });

  it('se agregó una categoría (quedan más): LoteDeGastosDistintoError, SIN tocar la red', async () => {
    const { sent, io, registro } = await conUnIntentoSinConfirmar();
    const error = await rechazo(crearGastos({ items: [...items(), { columns: comida, clientRef: REF_C }], sent, io }));
    expect(error).toBeInstanceOf(LoteDeGastosDistintoError);
    expect(registro.inserts).toHaveLength(1);
    expect(sent.size).toBe(1);
  });

  it('se cambió una categoría por otra con OTRO client_ref (misma cantidad): LoteDeGastosDistintoError', async () => {
    const { sent, io, registro } = await conUnIntentoSinConfirmar();
    const error = await rechazo(crearGastos({ items: [items()[0]!, { columns: comida, clientRef: REF_D }], sent, io }));
    expect(error).toBeInstanceOf(LoteDeGastosDistintoError);
    expect(registro.inserts).toHaveLength(1);
  });

  it('también corta si lo que cambió es un intento ANTERIOR a otro (alguna huella de las ya mandadas tiene otros client_ref)', async () => {
    const sent = new Set<string>();
    const { io, registro } = ioDeMentira({ insert: () => sinRed() });
    await rechazo(crearGastos({ items: items(), sent, io }));
    // Un cambio de datos con los mismos client_ref se manda (no es un conjunto distinto).
    await rechazo(crearGastos({ items: [{ columns: { ...peaje, monto: 2 }, clientRef: REF_A }, items()[1]!], sent, io }));
    expect(registro.inserts).toHaveLength(2);
    expect(await rechazo(crearGastos({ items: [items()[1]!], sent, io }))).toBeInstanceOf(LoteDeGastosDistintoError);
    expect(registro.inserts).toHaveLength(2);
  });

  it('con los MISMOS client_ref (aunque cambien los datos o el orden) NO es un conjunto distinto: se manda', async () => {
    const { sent, io, registro } = await conUnIntentoSinConfirmar();
    await expect(crearGastos({ items: items().reverse(), sent, io })).resolves.toBe('ya-guardados');
    expect(registro.inserts).toHaveLength(2);
  });

  it('tras un error de «conjunto distinto» los mismos client_ref de antes siguen funcionando (no quedó nada marcado de más)', async () => {
    const { sent, io } = await conUnIntentoSinConfirmar();
    await rechazo(crearGastos({ items: [items()[0]!], sent, io }));
    await expect(crearGastos({ items: items(), sent, io })).resolves.toBe('ya-guardados');
  });

  it('«empezar de nuevo»: con las huellas vaciadas y client_ref nuevos se manda sin problema', async () => {
    const { sent, io, registro } = await conUnIntentoSinConfirmar();
    sent.clear();
    const nuevos: GastoParaGuardar[] = [{ columns: peaje, clientRef: REF_C }];
    await expect(crearGastos({ items: nuevos, sent, io })).resolves.toBe('ya-guardados'); // 23505 del guion: lo importante es que SÍ se mandó
    expect(registro.inserts).toHaveLength(2);
    expect(registro.inserts[1]![0]!.client_ref).toBe(REF_C);
  });

  it('tras guardar bien y vaciar las huellas, el siguiente alta no arrastra lo anterior; sin vaciarlas, otros client_ref se rechazan', async () => {
    const sent = new Set<string>();
    const { io } = ioDeMentira();
    await crearGastos({ items: items(), sent, io });
    const siguiente: GastoParaGuardar[] = [{ columns: comida, clientRef: REF_C }];
    await expect(crearGastos({ items: siguiente, sent, io })).rejects.toBeInstanceOf(LoteDeGastosDistintoError);
    sent.clear(); // el formulario lo hace tras guardar bien
    await expect(crearGastos({ items: siguiente, sent, io })).resolves.toBe('creados');
  });

  it('una huella que no es de un lote (por ejemplo, de un gasto solo) nunca coincide: falla seguro', async () => {
    const sent = new Set<string>(['["una-huella-de-un-gasto-solo"]']);
    const { io, registro } = ioDeMentira();
    await expect(crearGastos({ items: items(), sent, io })).rejects.toBeInstanceOf(LoteDeGastosDistintoError);
    expect(registro.inserts).toEqual([]);
  });
});

describe('crearGastos: lo que rechaza antes de tocar la red', () => {
  it('una carga vacía', async () => {
    const { io, registro } = ioDeMentira();
    const sent = new Set<string>();
    const error = await rechazo(crearGastos({ items: [], sent, io }));
    expect(error).toBeInstanceOf(LoteDeGastosInvalidoError);
    expect((error as LoteDeGastosInvalidoError).motivo).toBe('vacio');
    expect(registro.inserts).toEqual([]);
    expect(sent.size).toBe(0);
  });

  it(`más gastos que el tope (${MAX_GASTOS_POR_CARGA + 1})`, async () => {
    const demasiados = Array.from({ length: MAX_GASTOS_POR_CARGA + 1 }, (_, i) => ({
      columns: peaje,
      clientRef: `5a000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
    }));
    const { io, registro } = ioDeMentira();
    const sent = new Set<string>();
    const error = await rechazo(crearGastos({ items: demasiados, sent, io }));
    expect((error as LoteDeGastosInvalidoError).motivo).toBe('demasiadas');
    expect(registro.inserts).toEqual([]);
    expect(sent.size).toBe(0);
  });

  it('dos gastos con el MISMO client_ref (el INSERT chocaría con el índice y se leería como «ya guardados» sin haber guardado nada)', async () => {
    const { io, registro } = ioDeMentira({ insert: () => duplicadoDeClientRef() });
    const sent = new Set<string>();
    const error = await rechazo(
      crearGastos({ items: [{ columns: peaje, clientRef: REF_A }, { columns: comida, clientRef: REF_A }], sent, io }),
    );
    expect((error as LoteDeGastosInvalidoError).motivo).toBe('client-ref-repetido');
    expect(registro.inserts).toEqual([]);
    expect(sent.size).toBe(0);
  });

  it('dos client_ref que solo se distinguen por mayúsculas son el MISMO uuid para la base: también se rechaza', async () => {
    const { io, registro } = ioDeMentira();
    const error = await rechazo(
      crearGastos({ items: [{ columns: peaje, clientRef: REF_A }, { columns: comida, clientRef: REF_A.toUpperCase() }], sent: new Set(), io }),
    );
    expect((error as LoteDeGastosInvalidoError).motivo).toBe('client-ref-repetido');
    expect(registro.inserts).toEqual([]);
  });

  it('un client_ref que no es un uuid', async () => {
    for (const malo of ['', 'x', 'ref-1', ` ${REF_A}`, `${REF_A}\n`, REF_A.replace(/-/g, ''), `{${REF_A}}`]) {
      const { io, registro } = ioDeMentira();
      const error = await rechazo(crearGastos({ items: [{ columns: peaje, clientRef: malo }], sent: new Set(), io }));
      expect((error as LoteDeGastosInvalidoError).motivo, JSON.stringify(malo)).toBe('client-ref-invalido');
      expect(registro.inserts, JSON.stringify(malo)).toEqual([]);
    }
  });

  it('basta UN client_ref que no sea uuid entre varios buenos para rechazar todo el pedido', async () => {
    const { io, registro } = ioDeMentira();
    const error = await rechazo(
      crearGastos({ items: [{ columns: peaje, clientRef: REF_A }, { columns: comida, clientRef: 'ref-2' }, { columns: combustible, clientRef: REF_B }], sent: new Set(), io }),
    );
    expect((error as LoteDeGastosInvalidoError).motivo).toBe('client-ref-invalido');
    expect(registro.inserts).toEqual([]);
  });
});

describe('las clases de error del lote', () => {
  it('LoteDeGastosDistintoError es de DATOS INVÁLIDOS (22023) y no se reintenta, como SeleccionDeGastosInvalidaError', () => {
    const error = new LoteDeGastosDistintoError();
    expect(error).toBeInstanceOf(DataRequestError);
    expect(error.name).toBe('LoteDeGastosDistintoError');
    expect(error.code).toBe('22023');
    expect(classifyDataError(error)).toBe('invalid-data');
    expect(isRetryableDataError(error)).toBe(false);
    expect(mapDataError(error)).toBe(INVALID_DATA_MESSAGE);
  });

  it('con el contexto de guardar varios gastos: LoteDeGastosDistintoError tiene su texto y no se reintenta', () => {
    const error = new LoteDeGastosDistintoError();
    expect(mapDataError(error, GUARDAR_LOTE_CONTEXT)).toBe(LOTE_DISTINTO_MESSAGE);
    expect(isRetryableDataError(error, GUARDAR_LOTE_CONTEXT)).toBe(false);
  });

  it('el contexto de guardar varios gastos: «ya no está» en plural, y lo demás como al guardar un gasto solo', () => {
    expect(mapDataError(new RecordNotFoundError(), GUARDAR_LOTE_CONTEXT)).toBe(LOTE_NO_ENCONTRADO_MESSAGE);
    expect(LOTE_NO_ENCONTRADO_MESSAGE).not.toContain('Guardar gasto');
    expect(mapDataError(Object.assign(new Error('violates foreign key constraint "gastos_viaje_fk"'), { code: '23503' }), GUARDAR_LOTE_CONTEXT)).toBe(
      'El viaje elegido ya no existe. Elige otro o déjalo sin viaje.',
    );
    expect(mapDataError(sinRed(), GUARDAR_LOTE_CONTEXT)).toBe(mapDataError(sinRed()));
  });

  it('el contexto de guardar varios gastos conserva los mensajes de camión del gasto solo (camión inexistente, archivado, otro que el del viaje, carga sin camión) y esos errores no se reintentan', () => {
    const porConstraint = Object.entries(GUARDAR_GASTO_CONTEXT.messagesByConstraint ?? {});
    expect(porConstraint.length).toBeGreaterThanOrEqual(4);
    for (const [constraint, mensaje] of porConstraint) {
      const error = Object.assign(new Error(`falla ${constraint}`), { code: '23514' });
      expect(mapDataError(error, GUARDAR_LOTE_CONTEXT), constraint).toBe(mensaje);
      expect(isRetryableDataError(error, GUARDAR_LOTE_CONTEXT), constraint).toBe(false);
    }
  });

  it('LoteDeGastosInvalidoError con los motivos del guardado: datos inválidos, sin reintento y sin datos en el mensaje', () => {
    for (const motivo of ['vacio', 'demasiadas', 'client-ref-invalido', 'client-ref-repetido'] as const) {
      const error = new LoteDeGastosInvalidoError(motivo);
      expect(classifyDataError(error), motivo).toBe('invalid-data');
      expect(isRetryableDataError(error), motivo).toBe(false);
      expect(error.message, motivo).not.toContain(REF_A);
    }
  });
});
