import { describe, expect, it } from 'vitest';

import {
  DataRequestError,
  UserMessageError,
  classifyDataError,
  isForeignKeyViolationOf,
  isRetryableDataError,
  mapDataError,
  mentionsConstraint,
  type DataErrorContext,
} from '@/lib/data-errors';
import { ELIMINAR_VIAJE_CONTEXT, GUARDAR_VIAJE_CONTEXT } from '@/features/viajes/constants';
import { GASTOS_VIAJE_FK, GUARDAR_GASTO_CONTEXT } from '@/features/gastos/constants';

/** Lo que devuelve PostgREST (con el status que copia `unwrap`). */
const fk = (message: string, details = '', code = '23503') => new DataRequestError({ message, details, code }, 409);

const MSG_FK_VIAJE = 'insert or update on table "gastos" violates foreign key constraint "gastos_viaje_fk"';
const DETALLE_FK_VIAJE = 'Key (transportista_id, viaje_id)=(11111111-1111-4111-8111-111111111111, 22222222-2222-4222-8222-222222222222) is not present in table "viajes".';
/** El trigger de la categoría (002_functions.sql): 23503 con su propio texto, SIN nombre de constraint. */
const MSG_TRIGGER_CATEGORIA = 'La categoría de gasto no es válida para este transportista';

describe('UserMessageError: el mensaje ya viene armado', () => {
  it('mapDataError devuelve su texto tal cual, con cualquier contexto (no lo pisa ni el de FK ni el genérico)', () => {
    const error = new UserMessageError('Los 2 gastos ya quedaron sin viaje, pero el viaje no se borró.', { retryable: true });
    for (const context of [undefined, {}, ELIMINAR_VIAJE_CONTEXT, GUARDAR_GASTO_CONTEXT]) {
      expect(mapDataError(error, context)).toBe('Los 2 gastos ya quedaron sin viaje, pero el viaje no se borró.');
    }
  });

  it('isRetryableDataError respeta su `retryable`, también con un contexto que declara las FK reintentables', () => {
    expect(isRetryableDataError(new UserMessageError('x', { retryable: true }))).toBe(true);
    expect(isRetryableDataError(new UserMessageError('x', { retryable: false }))).toBe(false);
    expect(isRetryableDataError(new UserMessageError('x', { retryable: false }), ELIMINAR_VIAJE_CONTEXT)).toBe(false);
  });

  it('guarda el error original en `cause` (no se muestra) y sin causa no la inventa', () => {
    const original = fk(MSG_FK_VIAJE);
    expect(new UserMessageError('x', { retryable: true, cause: original }).cause).toBe(original);
    expect('cause' in new UserMessageError('x', { retryable: true })).toBe(false);
  });

  it('el texto interno del error original nunca se filtra al mensaje', () => {
    const error = new UserMessageError('Aviso propio.', { retryable: false, cause: fk(MSG_FK_VIAJE, DETALLE_FK_VIAJE) });
    expect(mapDataError(error)).not.toContain('gastos_viaje_fk');
    expect(mapDataError(error)).not.toContain('Key (');
  });
});

describe('mentionsConstraint', () => {
  it('encuentra el nombre en el message (entre comillas, como lo escribe Postgres)', () => {
    expect(mentionsConstraint(fk(MSG_FK_VIAJE), 'gastos_viaje_fk')).toBe(true);
  });

  it('encuentra el nombre en los details cuando el message no lo trae', () => {
    const error = { message: 'violates foreign key', details: 'Key is not present: constraint "gastos_viaje_fk"', code: '23503' };
    expect(mentionsConstraint(error, 'gastos_viaje_fk')).toBe(true);
  });

  it('compara el nombre COMPLETO: un prefijo o un sufijo no cuentan', () => {
    expect(mentionsConstraint(fk('violates constraint "gastos_viaje_fk_viejo"'), 'gastos_viaje_fk')).toBe(false);
    expect(mentionsConstraint(fk('violates constraint "otros_gastos_viaje_fk"'), 'gastos_viaje_fk')).toBe(false);
    expect(mentionsConstraint(fk('violates constraint "gastos_categoria_id_fkey"'), 'gastos_viaje_fk')).toBe(false);
  });

  it('sin el nombre, con valores raros o con un constraint vacío da false (nunca tira)', () => {
    expect(mentionsConstraint(fk(MSG_TRIGGER_CATEGORIA), 'gastos_viaje_fk')).toBe(false);
    for (const raro of [null, undefined, 'gastos_viaje_fk', 42, {}, { message: 7, details: null }]) {
      expect(mentionsConstraint(raro, 'gastos_viaje_fk'), String(raro)).toBe(false);
    }
    expect(mentionsConstraint(fk(MSG_FK_VIAJE), '')).toBe(false);
  });
});

describe('isForeignKeyViolationOf', () => {
  it('solo es true para un 23503 que nombra ese constraint', () => {
    expect(isForeignKeyViolationOf(fk(MSG_FK_VIAJE, DETALLE_FK_VIAJE), GASTOS_VIAJE_FK)).toBe(true);
    expect(isForeignKeyViolationOf(fk(MSG_TRIGGER_CATEGORIA), GASTOS_VIAJE_FK)).toBe(false); // 23503 de la categoría
    // El mismo texto con otro código (p. ej. un check) no cuenta como FK.
    expect(isForeignKeyViolationOf(fk(MSG_FK_VIAJE, '', '23514'), GASTOS_VIAJE_FK)).toBe(false);
    expect(isForeignKeyViolationOf({ message: MSG_FK_VIAJE, code: '' }, GASTOS_VIAJE_FK)).toBe(false);
  });
});

describe('mapDataError al GUARDAR un gasto: el mismo 23503 según el constraint', () => {
  it('23503 de gastos_viaje_fk (en el message): "El viaje elegido ya no existe. Elige otro o déjalo sin viaje."', () => {
    expect(mapDataError(fk(MSG_FK_VIAJE), GUARDAR_GASTO_CONTEXT)).toBe('El viaje elegido ya no existe. Elige otro o déjalo sin viaje.');
  });

  it('también si el nombre solo viene en los details', () => {
    const error = fk('violates foreign key constraint', 'Key (viaje_id) ... constraint "gastos_viaje_fk"');
    expect(mapDataError(error, GUARDAR_GASTO_CONTEXT)).toBe('El viaje elegido ya no existe. Elige otro o déjalo sin viaje.');
  });

  it('23503 del trigger de la categoría (sin nombre de constraint): el mensaje de siempre, "La categoría elegida ya no está disponible. Elige otra."', () => {
    expect(mapDataError(fk(MSG_TRIGGER_CATEGORIA), GUARDAR_GASTO_CONTEXT)).toBe('La categoría elegida ya no está disponible. Elige otra.');
  });

  it('23503 de otro constraint (la FK de la categoría o del tenant) tampoco se confunde con el del viaje', () => {
    const error = fk('insert or update on table "gastos" violates foreign key constraint "gastos_categoria_id_fkey"');
    expect(mapDataError(error, GUARDAR_GASTO_CONTEXT)).toBe('La categoría elegida ya no está disponible. Elige otra.');
  });

  it('el nombre del constraint nunca llega a la pantalla', () => {
    for (const error of [fk(MSG_FK_VIAJE, DETALLE_FK_VIAJE), fk(MSG_TRIGGER_CATEGORIA)]) {
      const texto = mapDataError(error, GUARDAR_GASTO_CONTEXT);
      expect(texto).not.toMatch(/gastos_|constraint|fk/i);
    }
  });

  it('ninguno de los dos es reintentable (reintentar con lo mismo da lo mismo)', () => {
    expect(isRetryableDataError(fk(MSG_FK_VIAJE), GUARDAR_GASTO_CONTEXT)).toBe(false);
    expect(isRetryableDataError(fk(MSG_TRIGGER_CATEGORIA), GUARDAR_GASTO_CONTEXT)).toBe(false);
  });

  it('el resto de los errores de un gasto sigue igual (red, check, permiso, único)', () => {
    expect(mapDataError({ message: 'TypeError: Failed to fetch', code: '' }, GUARDAR_GASTO_CONTEXT)).toContain('conexión');
    expect(mapDataError(fk('x', '', '23514'), GUARDAR_GASTO_CONTEXT)).toBe(mapDataError(fk('x', '', '23514')));
    expect(mapDataError(fk('x', '', '42501'), GUARDAR_GASTO_CONTEXT)).toBe('No tienes permiso para hacer esto.');
    expect(mapDataError(fk('x', '', '23505'), GUARDAR_GASTO_CONTEXT)).toBe('Ya existe un registro con esos datos.');
  });
});

describe('lo que NO cambia para el resto de las pantallas', () => {
  it('sin foreignKeyByConstraint ni foreignKeyRetryable, un 23503 se mapea y se reintenta como siempre', () => {
    const contexto: DataErrorContext = { foreignKey: 'Mensaje de la pantalla.' };
    const error = fk(MSG_FK_VIAJE);
    expect(mapDataError(error, contexto)).toBe('Mensaje de la pantalla.');
    expect(isRetryableDataError(error, contexto)).toBe(false);
    expect(isRetryableDataError(error)).toBe(false);
    // Y sin contexto, el mensaje genérico de FK.
    expect(mapDataError(error)).toBe('No se puede completar la acción porque este registro está relacionado con otros datos.');
  });

  it('el guardado de un viaje sigue con su mensaje de FK y no reintenta', () => {
    const error = fk('Alguno de los clientes no es válido para este transportista');
    expect(mapDataError(error, GUARDAR_VIAJE_CONTEXT)).toBe('Alguno de los clientes ya no existe: actualiza la lista y elígelo de nuevo.');
    expect(isRetryableDataError(error, GUARDAR_VIAJE_CONTEXT)).toBe(false);
  });

  it('las clases de error no cambiaron', () => {
    expect(classifyDataError({ message: 'x', code: '23503' })).toBe('foreign-key');
    expect(classifyDataError({ message: 'x', code: '23505' })).toBe('unique');
    expect(classifyDataError({ message: 'x', code: '23514' })).toBe('invalid-data');
    expect(classifyDataError({ message: 'x', code: 'P0002' })).toBe('not-found');
    expect(isRetryableDataError({ message: 'TypeError: Failed to fetch', code: '' })).toBe(true);
    expect(isRetryableDataError({ message: 'x', code: '42501' })).toBe(false);
  });
});

describe('borrar un viaje: 23001 (PostgreSQL 18) es lo mismo que 23503', () => {
  const MSG_RESTRICT = 'update or delete on table "viajes" violates RESTRICT setting of foreign key constraint "gastos_viaje_fk" on table "gastos"';
  const MENSAJE = 'Se vinculó un gasto a este viaje mientras lo borrabas. Vuelve a intentarlo.';

  it('23503 (PostgreSQL 17, la base real hoy): el mensaje de la carrera y reintentable', () => {
    const error = fk(MSG_RESTRICT, '', '23503');
    expect(mapDataError(error, ELIMINAR_VIAJE_CONTEXT)).toBe(MENSAJE);
    expect(isRetryableDataError(error, ELIMINAR_VIAJE_CONTEXT)).toBe(true);
  });

  it('23001 (PostgreSQL 18): EXACTAMENTE el mismo mensaje y también reintentable', () => {
    const error = fk(MSG_RESTRICT, '', '23001');
    expect(mapDataError(error, ELIMINAR_VIAJE_CONTEXT)).toBe(MENSAJE);
    expect(isRetryableDataError(error, ELIMINAR_VIAJE_CONTEXT)).toBe(true);
    expect(mapDataError(error, ELIMINAR_VIAJE_CONTEXT)).not.toContain('gastos_viaje_fk');
  });

  it('el 23001 solo se trata así donde la pantalla lo pide: en cualquier otro contexto sigue siendo "datos inválidos" (clase 23), como antes', () => {
    const error = fk(MSG_RESTRICT, '', '23001');
    expect(classifyDataError(error)).toBe('invalid-data');
    expect(isRetryableDataError(error)).toBe(false);
    expect(isRetryableDataError(error, GUARDAR_VIAJE_CONTEXT)).toBe(false);
    expect(isRetryableDataError(error, GUARDAR_GASTO_CONTEXT)).toBe(false);
    expect(mapDataError(error)).toBe(mapDataError(fk('x', '', '23514'))); // el mismo texto genérico de datos inválidos
    expect(mapDataError(error, GUARDAR_VIAJE_CONTEXT)).toBe('Alguno de los datos del viaje no es válido. Revísalos e inténtalo de nuevo.');
    expect(mapDataError(error, { foreignKey: 'FK', foreignKeyRetryable: true })).not.toBe('FK');
  });

  it('en el borrado, los demás errores no se alteran (red, permiso, check)', () => {
    expect(mapDataError({ message: 'TypeError: Failed to fetch', code: '' }, ELIMINAR_VIAJE_CONTEXT)).toContain('conexión');
    expect(isRetryableDataError({ message: 'TypeError: Failed to fetch', code: '' }, ELIMINAR_VIAJE_CONTEXT)).toBe(true);
    expect(isRetryableDataError(fk('x', '', '42501'), ELIMINAR_VIAJE_CONTEXT)).toBe(false);
    expect(mapDataError(fk('x', '', '23514'), ELIMINAR_VIAJE_CONTEXT)).toBe(mapDataError(fk('x', '', '23514')));
  });
});
