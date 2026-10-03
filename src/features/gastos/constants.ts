import type { DataErrorContext } from '@/lib/data-errors';
import type { MetodoPago } from '@/lib/db';

/**
 * Id de la categoría GLOBAL "Combustible" (sembrada en 001_schema.sql). El
 * modo combustible (litros, km, tanque lleno) se activa por este id Y porque
 * la fila tenga `transportista_id` NULL: un transportista puede crear una
 * categoría propia llamada "Combustible" y esa NO activa el modo (ver
 * `isCombustible` en categorias.ts).
 */
export const COMBUSTIBLE_CATEGORIA_ID = '549e5f96-e2b5-4b00-a2a7-1fce891e3d51';

/**
 * Id de la categoría GLOBAL "Gastos varios" (sembrada en 001_schema.sql). Es la más ambigua: sin una
 * descripción queda un gasto "fantasma", así que en ella la descripción es OBLIGATORIA (regla del front,
 * como la de los litros en Combustible: la base no la exige). Igual que Combustible, se identifica por
 * este id Y porque la fila tenga `transportista_id` NULL: una categoría propia que alguien llame
 * "Gastos varios" tiene otro id y NO dispara la regla (ver `isGastosVarios` en categorias.ts).
 * Como el de Combustible, es el uuid de la base real; en otro ambiente sería otro y la regla no se
 * activaría (falla seguro).
 */
export const GASTOS_VARIOS_CATEGORIA_ID = '573c7482-ac79-47f7-9767-1f8162ff2027';

// `MIN_YEAR` (primer año que acepta la pantalla: lo más viejo que alcanzan el selector de mes y `?mes=`) y
// `MIN_FECHA` (fecha mínima de un gasto) viven en `src/lib/dates.ts`: Viajes usa la misma cota. Se
// re-exportan acá para no cambiar los imports de Gastos.
export { MIN_YEAR, MIN_FECHA } from '@/lib/dates';

/** Tope de gastos que trae la lista de un mes. Se pide uno más para saber si se alcanzó. */
export const LIST_LIMIT = 500;

/** Largo máximo de la descripción: mismo valor que `gastos_descripcion_chk` (length <= 2000). */
export const MAX_DESCRIPCION = 2000;

/** Desde cuántos caracteres se muestra el contador de la descripción. */
export const DESCRIPCION_COUNTER_FROM = 1800;

/** Las categorías cambian muy poco: se consideran frescas 10 minutos. */
export const CATEGORIAS_STALE_TIME_MS = 10 * 60_000;

/** Etiquetas en español de los métodos de pago (enum `metodo_pago`). */
export const METODO_PAGO_LABELS: Record<MetodoPago, string> = {
  efectivo: 'Efectivo',
  tarjeta_credito: 'Tarjeta de crédito',
  tarjeta_debito: 'Tarjeta de débito',
  transferencia: 'Transferencia',
};

export const METODO_PAGO_ORDER: readonly MetodoPago[] = ['efectivo', 'tarjeta_credito', 'tarjeta_debito', 'transferencia'];

/** Mensajes propios de los errores de la base al GUARDAR un gasto (constante de módulo: la usa `useSubmitFeedback`). */
/** Nombre del constraint de la FK compuesta gasto → viaje (001_schema.sql). Solo sirve para distinguir el 23503 del viaje
 *  del de la categoría: nunca se muestra. */
export const GASTOS_VIAJE_FK = 'gastos_viaje_fk';

export const GUARDAR_GASTO_CONTEXT: DataErrorContext = {
  // 23503: el trigger rechaza una categoría que no es del transportista ni global (su mensaje no nombra ningún
  // constraint, así que es el caso "por defecto").
  foreignKey: 'La categoría elegida ya no está disponible. Elige otra.',
  // 23503 de `gastos_viaje_fk`: el viaje elegido (o el que ya tenía el gasto) ya no existe. No se reintenta con lo
  // mismo: hay que elegir otro o dejarlo sin viaje.
  foreignKeyByConstraint: {
    [GASTOS_VIAJE_FK]: 'El viaje elegido ya no existe. Elige otro o déjalo sin viaje.',
  },
  // Solo se ve al CREAR: se quiso actualizar el gasto ya guardado (reintento con datos cambiados) y ya no está.
  // Tocar "Guardar gasto" de nuevo lo vuelve a crear. (Al EDITAR, 0 filas muestra la pantalla "Gasto no encontrado".)
  notFound: 'El gasto que se había guardado ya no está. Toca "Guardar gasto" para guardarlo de nuevo.',
};

/** Ídem al ELIMINAR. */
export const ELIMINAR_GASTO_CONTEXT: DataErrorContext = {
  foreignKey: 'No se puede eliminar este gasto porque está vinculado a otros datos.',
};

/** Avisos breves que la lista muestra al volver de guardar o eliminar (viajan en `location.state`). */
export type GastoAviso = 'guardado' | 'eliminado';

export const AVISO_MENSAJES: Record<GastoAviso, string> = {
  guardado: 'Gasto guardado.',
  eliminado: 'Gasto eliminado.',
};
