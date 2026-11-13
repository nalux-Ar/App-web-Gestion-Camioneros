import { describe, expect, it } from 'vitest';

import {
  DataRequestError,
  NETWORK_CAMION_ESTADO_ERROR_MESSAGE,
  NETWORK_DELETE_ERROR_MESSAGE,
  NETWORK_SAVE_ERROR_MESSAGE,
  RecordNotFoundError,
  TIMEOUT_CAMION_ESTADO_ERROR_MESSAGE,
  TIMEOUT_DELETE_ERROR_MESSAGE,
  TIMEOUT_ERROR_MESSAGE,
  UserMessageError,
  classifyDataError,
  isForeignKeyViolationOf,
  isRetryableDataError,
  mapDataError,
  mentionsConstraint,
  type DataErrorContext,
} from '@/lib/data-errors';
import { NETWORK_ERROR_MESSAGE } from '@/features/auth/auth-errors';
import { ARCHIVAR_CAMION_CONTEXT, GUARDAR_CAMION_CONTEXT, REACTIVAR_CAMION_REPETIDO_CONTEXT } from '@/features/camiones/constants';
import { ELIMINAR_VIAJE_CONTEXT, GUARDAR_VIAJE_CONTEXT } from '@/features/viajes/constants';
import { ELIMINAR_DEVOLUCION_CONTEXT } from '@/features/devoluciones/constants';
import { ELIMINAR_GASTO_CONTEXT, GASTOS_VIAJE_FK, GUARDAR_GASTO_CONTEXT } from '@/features/gastos/constants';

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
    expect(mapDataError({ message: 'TypeError: Failed to fetch', code: '' }, GUARDAR_GASTO_CONTEXT)).toBe(NETWORK_ERROR_MESSAGE);
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
  const MENSAJE = 'Mientras lo borrabas, se le agregó un gasto a este viaje. Vuelve a intentarlo.';

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
    expect(mapDataError({ message: 'TypeError: Failed to fetch', code: '' }, ELIMINAR_VIAJE_CONTEXT)).toBe(NETWORK_ERROR_MESSAGE);
    expect(isRetryableDataError({ message: 'TypeError: Failed to fetch', code: '' }, ELIMINAR_VIAJE_CONTEXT)).toBe(true);
    expect(isRetryableDataError(fk('x', '', '42501'), ELIMINAR_VIAJE_CONTEXT)).toBe(false);
    expect(mapDataError(fk('x', '', '23514'), ELIMINAR_VIAJE_CONTEXT)).toBe(mapDataError(fk('x', '', '23514')));
  });
});

describe('messagesByConstraint: un mensaje por constraint, para cualquier clase de error (010)', () => {
  /** Los textos reales de la migración 010 (el del trigger y los de los constraints). */
  // `DataRequestError` no guarda el `hint` de PostgREST (nunca se muestra): el error crudo sí lo trae.
  const ARCHIVADO_CRUDO = { code: '55000', message: 'El camión está archivado (camion_archivado)', details: '', hint: 'Reactivalo o elegí otro camión.' };
  const ARCHIVADO = new DataRequestError(ARCHIVADO_CRUDO, 400);
  const NO_COINCIDE = new DataRequestError({ code: '23514', message: 'El camión del gasto no coincide con el del viaje (gastos_camion_viaje_chk)' }, 400);
  const FK_CAMION_GASTO = fk(
    'insert or update on table "gastos" violates foreign key constraint "gastos_camion_fk"',
    'Key (transportista_id, camion_id)=(11111111-1111-4111-8111-111111111111, 33333333-3333-4333-8333-333333333333) is not present in table "camiones".',
  );
  const FK_CAMION_VIAJE = fk('insert or update on table "viajes" violates foreign key constraint "viajes_camion_fk"');
  const CONTEXTO: DataErrorContext = {
    messagesByConstraint: { camion_archivado: 'archivado', gastos_camion_viaje_chk: 'no coincide', camiones_transportista_patente_key: 'repetida' },
    invalidData: 'datos',
    unique: 'único',
  };

  it('elige el mensaje por el constraint (o el texto fijo) en 55000, 23514 y 23505', () => {
    expect(mapDataError(ARCHIVADO, CONTEXTO)).toBe('archivado');
    expect(mapDataError(NO_COINCIDE, CONTEXTO)).toBe('no coincide');
    const repetida = new DataRequestError({ code: '23505', message: 'duplicate key value violates unique constraint "camiones_transportista_patente_key"' }, 409);
    expect(mapDataError(repetida, CONTEXTO)).toBe('repetida');
  });

  it('gana sobre el mensaje de la clase; si no nombra ninguno, sigue la clase', () => {
    expect(mapDataError(new DataRequestError({ code: '23514', message: 'violates check constraint "otro_chk"' }, 400), CONTEXTO)).toBe('datos');
    expect(mapDataError(new DataRequestError({ code: '23505', message: 'duplicate key "otra_key"' }, 409), CONTEXTO)).toBe('único');
  });

  it('nunca se reintenta (aunque la clase sí se reintentaría): con lo mismo da lo mismo', () => {
    // 55000 es "otro" (unknown, reintentable) sin el contexto: con el contexto deja de serlo.
    expect(isRetryableDataError(ARCHIVADO)).toBe(true);
    expect(isRetryableDataError(ARCHIVADO, CONTEXTO)).toBe(false);
    expect(isRetryableDataError(NO_COINCIDE, CONTEXTO)).toBe(false);
  });

  it('coincide por palabra entera: un nombre que lo contiene no cuenta', () => {
    const parecido = new DataRequestError({ code: '55000', message: 'El camión está archivado (camion_archivado_v2)' }, 400);
    expect(mapDataError(parecido, CONTEXTO)).not.toBe('archivado');
  });

  it('el texto del constraint ni el hint del trigger se muestran nunca', () => {
    for (const error of [ARCHIVADO, ARCHIVADO_CRUDO, NO_COINCIDE, FK_CAMION_GASTO]) {
      const texto = mapDataError(error, GUARDAR_GASTO_CONTEXT);
      expect(texto).not.toMatch(/camion_|_chk|_fk|Reactivalo/);
    }
  });

  it('GUARDAR un gasto: FK del camión, camión archivado y no coincide con el viaje; la FK del viaje y la de categoría siguen igual', () => {
    expect(mapDataError(FK_CAMION_GASTO, GUARDAR_GASTO_CONTEXT)).toBe('El camión elegido ya no existe. Elige otro.');
    expect(mapDataError(ARCHIVADO, GUARDAR_GASTO_CONTEXT)).toBe('Ese camión ya no se usa. Elige otro camión o reactívalo desde Camiones.');
    expect(mapDataError(NO_COINCIDE, GUARDAR_GASTO_CONTEXT)).toBe(
      'El camión no coincide con el del viaje: el viaje cambió de camión. Vuelve a elegir el viaje.',
    );
    expect(mapDataError(fk(MSG_FK_VIAJE, DETALLE_FK_VIAJE), GUARDAR_GASTO_CONTEXT)).toBe('El viaje elegido ya no existe. Elige otro o déjalo sin viaje.');
    expect(mapDataError(fk(MSG_TRIGGER_CATEGORIA), GUARDAR_GASTO_CONTEXT)).toBe('La categoría elegida ya no está disponible. Elige otra.');
    for (const error of [FK_CAMION_GASTO, ARCHIVADO, NO_COINCIDE]) expect(isRetryableDataError(error, GUARDAR_GASTO_CONTEXT)).toBe(false);
  });

  it('GUARDAR un gasto: litros sin camión (23514 de la 011) tiene su mensaje, no se reintenta y no se confunde con el del viaje', () => {
    const LITROS_SIN_CAMION = new DataRequestError(
      { code: '23514', message: 'new row for relation "gastos" violates check constraint "gastos_litros_camion_chk"' },
      400,
    );
    const texto = mapDataError(LITROS_SIN_CAMION, GUARDAR_GASTO_CONTEXT);
    expect(texto).toBe('La carga de combustible necesita un camión. Elige el camión y guarda de nuevo.');
    expect(texto).not.toMatch(/_chk/);
    expect(isRetryableDataError(LITROS_SIN_CAMION, GUARDAR_GASTO_CONTEXT)).toBe(false);
    expect(mapDataError(NO_COINCIDE, GUARDAR_GASTO_CONTEXT)).not.toBe(texto);
    expect(mapDataError(LITROS_SIN_CAMION, GUARDAR_GASTO_CONTEXT)).not.toBe(mapDataError(NO_COINCIDE, GUARDAR_GASTO_CONTEXT));
  });

  it('el detalle de la FK del camión nombra "camiones" y no "viajes": no se confunde con la del viaje', () => {
    expect(mentionsConstraint(FK_CAMION_GASTO, GASTOS_VIAJE_FK)).toBe(false);
  });

  it('GUARDAR un viaje: FK del camión y camión archivado; la FK de un cliente sigue con su mensaje', () => {
    expect(mapDataError(FK_CAMION_VIAJE, GUARDAR_VIAJE_CONTEXT)).toBe('El camión elegido ya no existe. Elige otro.');
    expect(mapDataError(ARCHIVADO, GUARDAR_VIAJE_CONTEXT)).toBe('Ese camión ya no se usa. Elige otro camión o reactívalo desde Camiones.');
    expect(mapDataError(fk('El cliente no existe'), GUARDAR_VIAJE_CONTEXT)).toBe('Alguno de los clientes ya no existe: actualiza la lista y elígelo de nuevo.');
    expect(isRetryableDataError(FK_CAMION_VIAJE, GUARDAR_VIAJE_CONTEXT)).toBe(false);
  });

  it('sin messagesByConstraint todo sigue como antes (contexto vacío)', () => {
    expect(mapDataError(ARCHIVADO)).toBe(mapDataError(new DataRequestError({ code: '55000', message: 'x' }, 400)));
    expect(isRetryableDataError(NO_COINCIDE)).toBe(false);
  });
});

describe('eliminar un gasto o una devolución: un error de FK dice «No se pudo eliminar. Prueba de nuevo.» (sin «vinculado a otros datos»)', () => {
  it.each([
    ['gasto', ELIMINAR_GASTO_CONTEXT],
    ['devolución', ELIMINAR_DEVOLUCION_CONTEXT],
  ])('%s', (_nombre, contexto) => {
    const error = fk('update or delete violates foreign key constraint "algo_fk"');
    expect(mapDataError(error, contexto)).toBe('No se pudo eliminar. Prueba de nuevo.');
    expect(mapDataError(error, contexto)).not.toMatch(/vincul|relacionad/i);
    expect(isRetryableDataError(error, contexto)).toBe(false); // sigue sin ofrecer «Reintentar»: daría lo mismo
  });
});

describe('sin señal y timeout: un texto para LEER y otro para GUARDAR', () => {
  const SIN_RED = { message: 'TypeError: Failed to fetch', code: '' };
  const TIMEOUT = new DOMException('signal timed out', 'TimeoutError');

  it('al LEER (sin contexto) y en Auth: «No hay señal…», sin hablar de guardar (una lista que no cargó no perdió nada)', () => {
    expect(mapDataError(SIN_RED)).toBe(NETWORK_ERROR_MESSAGE);
    expect(NETWORK_ERROR_MESSAGE).toBe('No hay señal. Revisa la conexión y prueba de nuevo.');
    expect(NETWORK_ERROR_MESSAGE).not.toMatch(/guard|escrito|Reintentar/i);
  });

  it('al GUARDAR: todavía NO se guardó, lo escrito sigue aquí y qué tocar (el contexto pone su texto de red)', () => {
    expect(NETWORK_SAVE_ERROR_MESSAGE).toBe('No hay señal. Todavía NO se guardó, pero lo escrito sigue aquí. Cuando vuelva, toca Reintentar.');
    expect(mapDataError(SIN_RED, { network: NETWORK_SAVE_ERROR_MESSAGE })).toBe(NETWORK_SAVE_ERROR_MESSAGE);
    // Mezclado con el contexto de una pantalla que no define `network` (así lo arma `useSubmitFeedback`).
    expect(mapDataError(SIN_RED, { network: NETWORK_SAVE_ERROR_MESSAGE, ...GUARDAR_GASTO_CONTEXT })).toBe(NETWORK_SAVE_ERROR_MESSAGE);
  });

  it('el texto de red del contexto solo afecta a la red: los demás errores siguen igual', () => {
    const contexto: DataErrorContext = { network: 'RED' };
    expect(mapDataError(fk('x', '', '42501'), contexto)).toBe('No tienes permiso para hacer esto.');
    expect(mapDataError(fk('x', '', '23505'), contexto)).toBe('Ya existe un registro con esos datos.');
    expect(mapDataError(TIMEOUT, contexto)).toBe(TIMEOUT_ERROR_MESSAGE);
    expect(isRetryableDataError(SIN_RED, contexto)).toBe(true);
  });

  it('timeout (solo las escrituras lo tienen): la señal está lenta, no sabemos si se guardó y reintentar no duplica', () => {
    expect(classifyDataError(TIMEOUT)).toBe('timeout');
    expect(mapDataError(TIMEOUT)).toBe('La señal está lenta y no sabemos si se guardó. Toca Reintentar: no se duplica.');
    expect(isRetryableDataError(TIMEOUT)).toBe(true);
  });

  it('`context.timeout` pisa el texto de timeout; sin él vale el de guardar; y no toca a la red ni a los demás errores', () => {
    expect(mapDataError(TIMEOUT)).toBe(TIMEOUT_ERROR_MESSAGE);
    expect(mapDataError(TIMEOUT, {})).toBe(TIMEOUT_ERROR_MESSAGE);
    expect(mapDataError(TIMEOUT, { timeout: 'Texto propio.' })).toBe('Texto propio.');
    // Cada uno en lo suyo, también con los dos en el mismo contexto.
    expect(mapDataError(TIMEOUT, { network: 'RED', timeout: 'TIEMPO' })).toBe('TIEMPO');
    expect(mapDataError(SIN_RED, { network: 'RED', timeout: 'TIEMPO' })).toBe('RED');
    // Un contexto con `timeout` no cambia la red ni los demás errores.
    expect(mapDataError(SIN_RED, { timeout: 'TIEMPO' })).toBe(NETWORK_ERROR_MESSAGE);
    expect(mapDataError(fk('x', '', '42501'), { timeout: 'TIEMPO' })).toBe('No tienes permiso para hacer esto.');
    // Con otro texto el timeout sigue siendo reintentable, venga como `TimeoutError` o como el mensaje de postgrest-js.
    expect(isRetryableDataError(TIMEOUT, { timeout: 'TIEMPO' })).toBe(true);
    const crudo = new DataRequestError({ code: '', message: 'TimeoutError: signal timed out' }, 0);
    expect(mapDataError(crudo, { timeout: 'TIEMPO' })).toBe('TIEMPO');
    expect(mapDataError(crudo)).toBe(TIMEOUT_ERROR_MESSAGE);
  });

  it('ningún texto de red o de timeout lleva «$», voseo ni «acá»', () => {
    for (const texto of [NETWORK_ERROR_MESSAGE, NETWORK_SAVE_ERROR_MESSAGE, TIMEOUT_ERROR_MESSAGE]) {
      expect(texto).not.toMatch(/\$|\bacá\b|\b(?:tocá|revisá|probá|esperá)\b/i);
    }
  });
});

describe('eliminar y cambiar el estado de un camión: textos de red y de timeout que no hablan de guardar un formulario ni nombran un botón', () => {
  const SIN_RED = { message: 'TypeError: Failed to fetch', code: '' };
  const TIMEOUT = new DOMException('signal timed out', 'TimeoutError');
  const CUATRO = [
    NETWORK_DELETE_ERROR_MESSAGE,
    TIMEOUT_DELETE_ERROR_MESSAGE,
    NETWORK_CAMION_ESTADO_ERROR_MESSAGE,
    TIMEOUT_CAMION_ESTADO_ERROR_MESSAGE,
  ];

  it('los cuatro textos, exactos', () => {
    expect(NETWORK_DELETE_ERROR_MESSAGE).toBe('No hay señal. Todavía NO se eliminó. Cuando tengas señal, inténtalo de nuevo.');
    expect(TIMEOUT_DELETE_ERROR_MESSAGE).toBe('La señal está lenta y no sabemos si se eliminó. Inténtalo de nuevo.');
    expect(NETWORK_CAMION_ESTADO_ERROR_MESSAGE).toBe('No hay señal. Todavía NO se guardó. Cuando tengas señal, inténtalo de nuevo.');
    expect(TIMEOUT_CAMION_ESTADO_ERROR_MESSAGE).toBe('La señal está lenta y no sabemos si se guardó. Inténtalo de nuevo.');
  });

  it('ninguno nombra un botón («Reintentar») ni habla de «lo escrito» (no hay nada escrito que se conserve)', () => {
    for (const texto of CUATRO) expect(texto).not.toMatch(/Reintentar|lo escrito|no se duplica/i);
  });

  it('los de eliminar no dicen «guardó»; los de cambiar el estado no dicen «eliminó»; son distintos de los de guardar un formulario', () => {
    for (const texto of [NETWORK_DELETE_ERROR_MESSAGE, TIMEOUT_DELETE_ERROR_MESSAGE]) expect(texto).not.toMatch(/guard/i);
    for (const texto of [NETWORK_CAMION_ESTADO_ERROR_MESSAGE, TIMEOUT_CAMION_ESTADO_ERROR_MESSAGE]) expect(texto).not.toMatch(/elimin/i);
    for (const texto of CUATRO) expect([NETWORK_SAVE_ERROR_MESSAGE, TIMEOUT_ERROR_MESSAGE]).not.toContain(texto);
  });

  it('puestos en el contexto, la red y el timeout salen con su texto y siguen siendo reintentables', () => {
    for (const [red, tiempo] of [
      [NETWORK_DELETE_ERROR_MESSAGE, TIMEOUT_DELETE_ERROR_MESSAGE],
      [NETWORK_CAMION_ESTADO_ERROR_MESSAGE, TIMEOUT_CAMION_ESTADO_ERROR_MESSAGE],
    ] as const) {
      const contexto: DataErrorContext = { network: red, timeout: tiempo };
      expect(mapDataError(SIN_RED, contexto)).toBe(red);
      expect(mapDataError(TIMEOUT, contexto)).toBe(tiempo);
      expect(isRetryableDataError(SIN_RED, contexto)).toBe(true);
      expect(isRetryableDataError(TIMEOUT, contexto)).toBe(true);
    }
  });

  it('ARCHIVAR_CAMION_CONTEXT (archivar y reactivar) los trae y conserva su mensaje de «no encontrado»', () => {
    expect(mapDataError(SIN_RED, ARCHIVAR_CAMION_CONTEXT)).toBe(NETWORK_CAMION_ESTADO_ERROR_MESSAGE);
    expect(mapDataError(TIMEOUT, ARCHIVAR_CAMION_CONTEXT)).toBe(TIMEOUT_CAMION_ESTADO_ERROR_MESSAGE);
    expect(mapDataError(new RecordNotFoundError(), ARCHIVAR_CAMION_CONTEXT)).toContain('No pudimos cambiar ese camión');
  });

  it('REACTIVAR_CAMION_REPETIDO_CONTEXT (el «Reactivarlo» del aviso de patente repetida): esos textos, y todo lo demás como guardar un camión', () => {
    expect(mapDataError(SIN_RED, REACTIVAR_CAMION_REPETIDO_CONTEXT)).toBe(NETWORK_CAMION_ESTADO_ERROR_MESSAGE);
    expect(mapDataError(TIMEOUT, REACTIVAR_CAMION_REPETIDO_CONTEXT)).toBe(TIMEOUT_CAMION_ESTADO_ERROR_MESSAGE);
    for (const codigo of ['42501', 'P0002', '23505', '23514']) {
      expect(mapDataError(fk('x', '', codigo), REACTIVAR_CAMION_REPETIDO_CONTEXT), codigo).toBe(mapDataError(fk('x', '', codigo), GUARDAR_CAMION_CONTEXT));
    }
    // Guardar un camión (el formulario, con su «Reintentar») NO cambia: sigue con el texto de guardar.
    expect(GUARDAR_CAMION_CONTEXT.network).toBeUndefined();
    expect(GUARDAR_CAMION_CONTEXT.timeout).toBeUndefined();
    expect(mapDataError(SIN_RED, { network: NETWORK_SAVE_ERROR_MESSAGE, ...GUARDAR_CAMION_CONTEXT })).toBe(NETWORK_SAVE_ERROR_MESSAGE);
    expect(mapDataError(TIMEOUT, GUARDAR_CAMION_CONTEXT)).toBe(TIMEOUT_ERROR_MESSAGE);
  });

  it('sin «$», voseo ni «acá»', () => {
    for (const texto of CUATRO) expect(texto).not.toMatch(/\$|\bacá\b|\b(?:tocá|revisá|probá|esperá|intentá|inténtalo vos)\b/i);
  });
});
