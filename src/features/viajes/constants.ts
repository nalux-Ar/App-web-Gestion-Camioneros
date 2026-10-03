import type { DataErrorContext } from '@/lib/data-errors';

/** Tope de viajes que trae la lista de un mes. Se pide uno más para saber si se alcanzó. */
export const LIST_LIMIT = 500;

/** Largo máximo de origen y destino: mismo valor que `viajes_origen_chk` / `viajes_destino_chk`. */
export const MAX_TEXTO = 200;

/** Largo máximo de las observaciones: mismo valor que `viajes_observaciones_chk`. */
export const MAX_OBSERVACIONES = 2000;

/** Largo máximo de las incidencias de una entrega: mismo valor que `entregas_incidencias_chk`. */
export const MAX_INCIDENCIAS = 2000;

/** Entregas por viaje: el máximo que aceptan las funciones de la base (`c_max_entregas`, migración 007). */
export const MAX_ENTREGAS = 100;

/** Desde cuántos caracteres se muestra el contador de observaciones / incidencias. */
export const TEXTO_COUNTER_FROM = 1800;

/** Mensajes propios de los errores de la base al GUARDAR un viaje (constante de módulo: la usa `useSubmitFeedback`).
 *  Nunca se muestra el nombre de un constraint ni el texto del servidor. */
export const GUARDAR_VIAJE_CONTEXT: DataErrorContext = {
  // 23503: algún cliente_id (o el camión) no existe o no es del transportista. Mismo error para "no existe" y "es de otro tenant".
  foreignKey: 'Alguno de los clientes ya no existe: actualiza la lista y elígelo de nuevo.',
  // P0002: el viaje (o una de sus entregas) no se encontró al actualizar. Reintentar con lo mismo da lo mismo.
  notFound: 'El viaje cambió o ya no existe. Vuelve a la lista y actualízala.',
  // 22023 (parámetros inválidos), 23514 (checks), 22003 (número fuera de rango), 23502 (not null): el front ya
  // valida todo esto antes de enviar, así que llegar acá es raro (otra versión de la app, o un dato al límite).
  invalidData: 'Alguno de los datos del viaje no es válido. Revísalos e inténtalo de nuevo.',
};

/** Ídem al ELIMINAR. */
export const ELIMINAR_VIAJE_CONTEXT: DataErrorContext = {
  // 23503: `gastos_viaje_fk` es ON DELETE RESTRICT: el viaje tiene gastos vinculados. El mismo código que una
  // referencia inválida al guardar, por eso se mapea por el contexto del borrado.
  foreignKey: 'Este viaje tiene gastos vinculados. Cambia o quita esos gastos antes de borrarlo.',
};

/** Avisos breves que la lista muestra al volver de guardar o eliminar (viajan en `location.state`). */
export type ViajeAviso = 'guardado' | 'eliminado';

export const AVISO_MENSAJES: Record<ViajeAviso, string> = {
  guardado: 'Viaje guardado.',
  eliminado: 'Viaje eliminado.',
};
