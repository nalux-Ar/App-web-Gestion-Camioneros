import { describe, expect, it } from 'vitest';

import { DEVOLUCIONES_CLIENT_REF_CONSTRAINT } from '@/features/devoluciones/constants';
import type { DevolucionColumns } from '@/features/devoluciones/devolucion-form';
import { crearDevolucion, type DevolucionWriteIO } from '@/features/devoluciones/devolucion-save';
import { RecordNotFoundError } from '@/lib/data-errors';
import type { NewRow, RowChanges } from '@/lib/db';

const VIAJE = 'b0000000-0000-4000-8000-000000000001';
const C_1 = 'a0000000-0000-4000-8000-000000000001';
const C_2 = 'a0000000-0000-4000-8000-000000000002';
const REF = '55555555-5555-4555-8555-555555555555';

const columns: DevolucionColumns = { motivo: 'vencimiento', cliente_id: C_1, descripcion: 'Yogures vencidos' };

/** El error que arma `unwrap` cuando el client_ref ya existe (23505 del índice único de devoluciones). */
const duplicadoDeClientRef = (constraint = DEVOLUCIONES_CLIENT_REF_CONSTRAINT) =>
  Object.assign(new Error(`duplicate key value violates unique constraint "${constraint}"`), { code: '23505', details: '' });

interface Registro {
  inserts: Array<NewRow<'devoluciones'>>;
  updates: Array<{ clientRef: string; changes: RowChanges<'devoluciones'> }>;
}

/** Un IO de mentira: cada INSERT / UPDATE se anota y responde lo que diga el guion (`insert`, `update`). */
function ioDeMentira(guion: { insert?: (n: number) => Error | null; update?: (n: number) => Error | null } = {}) {
  const registro: Registro = { inserts: [], updates: [] };
  const io: DevolucionWriteIO = {
    async insert(row) {
      registro.inserts.push(row);
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

describe('crearDevolucion (alta idempotente por client_ref)', () => {
  it('"creado": el INSERT sale bien; manda el viaje, las tres columnas y el client_ref, y no actualiza nada', async () => {
    const { io, registro } = ioDeMentira();
    const sent = new Set<string>();
    await expect(crearDevolucion({ viajeId: VIAJE, columns, clientRef: REF, sent, io })).resolves.toBe('creado');
    expect(registro.inserts).toEqual([{ viaje_id: VIAJE, motivo: 'vencimiento', cliente_id: C_1, descripcion: 'Yogures vencidos', client_ref: REF }]);
    expect(registro.updates).toEqual([]);
    expect(sent.size).toBe(1);
  });

  it('"ya-guardado": el INSERT da 23505 del client_ref y lo mandado es lo mismo que hay en pantalla -> éxito, SIN actualizar', async () => {
    const { io, registro } = ioDeMentira({ insert: () => duplicadoDeClientRef() });
    await expect(crearDevolucion({ viajeId: VIAJE, columns, clientRef: REF, sent: new Set(), io })).resolves.toBe('ya-guardado');
    expect(registro.updates).toEqual([]);
  });

  it('respuesta perdida y reintento SIN cambios: el primer intento "falla" (sin respuesta), el segundo da 23505 -> "ya-guardado", sin duplicar', async () => {
    const sent = new Set<string>();
    const { io, registro } = ioDeMentira({
      insert: (n) => (n === 1 ? new Error('TypeError: Failed to fetch') : duplicadoDeClientRef()),
    });
    await expect(crearDevolucion({ viajeId: VIAJE, columns, clientRef: REF, sent, io })).rejects.toThrow('Failed to fetch');
    await expect(crearDevolucion({ viajeId: VIAJE, columns, clientRef: REF, sent, io })).resolves.toBe('ya-guardado');
    expect(registro.inserts).toHaveLength(2);
    expect(registro.inserts.every((row) => row.client_ref === REF)).toBe(true); // el MISMO client_ref en cada reintento
    expect(registro.updates).toEqual([]);
  });

  it('"ya-guardado-actualizado": el usuario cambió algo entre intentos -> UPDATE por client_ref con lo de pantalla (sin client_ref ni viaje_id)', async () => {
    const sent = new Set<string>();
    const { io, registro } = ioDeMentira({
      insert: (n) => (n === 1 ? new Error('TypeError: Failed to fetch') : duplicadoDeClientRef()),
    });
    await expect(crearDevolucion({ viajeId: VIAJE, columns, clientRef: REF, sent, io })).rejects.toThrow();
    const cambiadas: DevolucionColumns = { ...columns, cliente_id: C_2, descripcion: 'Cambié de idea' };
    await expect(crearDevolucion({ viajeId: VIAJE, columns: cambiadas, clientRef: REF, sent, io })).resolves.toBe('ya-guardado-actualizado');

    expect(registro.updates).toHaveLength(1);
    expect(registro.updates[0]!.clientRef).toBe(REF);
    expect(registro.updates[0]!.changes).toEqual({ motivo: 'vencimiento', cliente_id: C_2, descripcion: 'Cambié de idea' });
    expect(registro.updates[0]!.changes).not.toHaveProperty('client_ref');
    expect(registro.updates[0]!.changes).not.toHaveProperty('viaje_id');
  });

  it('cambiar SOLO el motivo, SOLO el cliente o SOLO la descripción entre intentos también actualiza (la huella cubre cada campo)', async () => {
    const cambios: Array<[string, DevolucionColumns]> = [
      ['motivo', { ...columns, motivo: 'otro' }],
      ['cliente', { ...columns, cliente_id: C_2 }],
      ['descripción', { ...columns, descripcion: 'Distinta' }],
      ['descripción a null', { ...columns, descripcion: null }],
    ];
    for (const [nombre, cambiadas] of cambios) {
      const sent = new Set<string>();
      const { io, registro } = ioDeMentira({
        insert: (n) => (n === 1 ? new Error('TypeError: Failed to fetch') : duplicadoDeClientRef()),
      });
      await expect(crearDevolucion({ viajeId: VIAJE, columns, clientRef: REF, sent, io })).rejects.toThrow();
      await expect(crearDevolucion({ viajeId: VIAJE, columns: cambiadas, clientRef: REF, sent, io }), nombre).resolves.toBe('ya-guardado-actualizado');
      expect(registro.updates, nombre).toHaveLength(1);
    }
  });

  it('el VIAJE también cuenta en la huella: con otro viaje entre intentos se actualiza en vez de dar por bueno lo guardado', async () => {
    const sent = new Set<string>();
    const { io, registro } = ioDeMentira({
      insert: (n) => (n === 1 ? new Error('TypeError: Failed to fetch') : duplicadoDeClientRef()),
    });
    await expect(crearDevolucion({ viajeId: VIAJE, columns, clientRef: REF, sent, io })).rejects.toThrow();
    await expect(
      crearDevolucion({ viajeId: 'b0000000-0000-4000-8000-000000000002', columns, clientRef: REF, sent, io }),
    ).resolves.toBe('ya-guardado-actualizado');
    expect(registro.updates).toHaveLength(1);
  });

  it('es conservador: tras un UPDATE que falló, el siguiente reintento VUELVE a actualizar (no da por bueno un estado sin confirmar)', async () => {
    const sent = new Set<string>();
    const cambiadas: DevolucionColumns = { ...columns, descripcion: 'Otra' };
    const { io, registro } = ioDeMentira({
      insert: (n) => (n === 1 ? new Error('TypeError: Failed to fetch') : duplicadoDeClientRef()),
      update: (n) => (n === 1 ? new Error('TypeError: Failed to fetch') : null),
    });
    await expect(crearDevolucion({ viajeId: VIAJE, columns, clientRef: REF, sent, io })).rejects.toThrow(); // 1) sin respuesta
    await expect(crearDevolucion({ viajeId: VIAJE, columns: cambiadas, clientRef: REF, sent, io })).rejects.toThrow(); // 2) 23505 + UPDATE que falla
    await expect(crearDevolucion({ viajeId: VIAJE, columns: cambiadas, clientRef: REF, sent, io })).resolves.toBe('ya-guardado-actualizado'); // 3)
    expect(registro.updates).toHaveLength(2);
  });

  it('cambiar algo y volver al valor original: ya se mandaron DOS huellas distintas, así que se actualiza otra vez en vez de dar por bueno lo guardado', async () => {
    const sent = new Set<string>();
    const { io, registro } = ioDeMentira({
      insert: (n) => (n === 1 ? new Error('TypeError: Failed to fetch') : duplicadoDeClientRef()),
    });
    await expect(crearDevolucion({ viajeId: VIAJE, columns, clientRef: REF, sent, io })).rejects.toThrow();
    // Cambió y volvió al valor original: se mandaron DOS huellas distintas, así que no se puede dar por bueno lo guardado.
    const otra: DevolucionColumns = { ...columns, motivo: 'otro' };
    await expect(crearDevolucion({ viajeId: VIAJE, columns: otra, clientRef: REF, sent, io })).resolves.toBe('ya-guardado-actualizado');
    await expect(crearDevolucion({ viajeId: VIAJE, columns, clientRef: REF, sent, io })).resolves.toBe('ya-guardado-actualizado');
    expect(registro.updates).toHaveLength(2);
    expect(registro.updates[1]!.changes).toEqual({ motivo: 'vencimiento', cliente_id: C_1, descripcion: 'Yogures vencidos' });
  });

  it('el UPDATE por client_ref sin filas (la devolución ya no está) propaga RecordNotFoundError', async () => {
    const sent = new Set<string>();
    const { io } = ioDeMentira({
      insert: (n) => (n === 1 ? new Error('TypeError: Failed to fetch') : duplicadoDeClientRef()),
      update: () => new RecordNotFoundError(),
    });
    await expect(crearDevolucion({ viajeId: VIAJE, columns, clientRef: REF, sent, io })).rejects.toThrow();
    await expect(
      crearDevolucion({ viajeId: VIAJE, columns: { ...columns, descripcion: 'x' }, clientRef: REF, sent, io }),
    ).rejects.toBeInstanceOf(RecordNotFoundError);
  });

  it('errores propagados tal cual: red, 23503, 23514 y un 23505 de OTRO índice (que NO es "ya guardado")', async () => {
    const errores = [
      Object.assign(new Error('TypeError: Failed to fetch'), { code: '' }),
      Object.assign(new Error('violates foreign key constraint "devoluciones_cliente_fk"'), { code: '23503' }),
      Object.assign(new Error('violates check constraint "devoluciones_descripcion_chk"'), { code: '23514' }),
      duplicadoDeClientRef('gastos_transportista_client_ref_uidx'), // el índice de GASTOS: no es el nuestro
      duplicadoDeClientRef('devoluciones_pkey'),
      Object.assign(new Error('duplicate key'), { code: '23505' }), // sin nombre de constraint
    ];
    for (const error of errores) {
      const { io, registro } = ioDeMentira({ insert: () => error });
      await expect(crearDevolucion({ viajeId: VIAJE, columns, clientRef: REF, sent: new Set(), io })).rejects.toBe(error);
      expect(registro.updates, error.message).toEqual([]);
    }
  });

  it('un error que NO es 23505 con el nombre del índice (p. ej. 23503 que lo menciona) tampoco es "ya guardado"', async () => {
    const raro = Object.assign(new Error(`algo con ${DEVOLUCIONES_CLIENT_REF_CONSTRAINT}`), { code: '23503' });
    const { io } = ioDeMentira({ insert: () => raro });
    await expect(crearDevolucion({ viajeId: VIAJE, columns, clientRef: REF, sent: new Set(), io })).rejects.toBe(raro);
  });

  it('el nombre del índice también se reconoce en `details`', async () => {
    const enDetails = Object.assign(new Error('duplicate key value'), {
      code: '23505',
      details: `Key (transportista_id, client_ref) already exists. ${DEVOLUCIONES_CLIENT_REF_CONSTRAINT}`,
    });
    const { io } = ioDeMentira({ insert: () => enDetails });
    await expect(crearDevolucion({ viajeId: VIAJE, columns, clientRef: REF, sent: new Set(), io })).resolves.toBe('ya-guardado');
  });

  it('el índice es el de devoluciones (008)', () => {
    expect(DEVOLUCIONES_CLIENT_REF_CONSTRAINT).toBe('devoluciones_transportista_client_ref_uidx');
  });

  it('tras guardar bien y regenerar el client_ref (huellas vaciadas), el siguiente alta no arrastra lo anterior', async () => {
    const sent = new Set<string>();
    const { io: io1 } = ioDeMentira();
    await crearDevolucion({ viajeId: VIAJE, columns, clientRef: REF, sent, io: io1 });
    sent.clear(); // el formulario hace esto tras guardar bien
    const REF2 = '66666666-6666-4666-8666-666666666666';
    const { io, registro } = ioDeMentira({ insert: () => duplicadoDeClientRef() });
    await expect(crearDevolucion({ viajeId: VIAJE, columns: { ...columns, cliente_id: C_2 }, clientRef: REF2, sent, io })).resolves.toBe('ya-guardado');
    expect(registro.updates).toEqual([]);
  });
});
