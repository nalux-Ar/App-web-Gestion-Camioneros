import type { DataErrorContext } from '@/lib/data-errors';
import type { MotivoDevolucion } from '@/lib/db';

/**
 * Motivos de una devolución (enum `motivo_devolucion` de la base) en el orden en que se muestran, y sus etiquetas
 * en español.
 */
export const MOTIVO_ORDER: readonly MotivoDevolucion[] = ['rotura_danio', 'vencimiento', 'mercaderia_incorrecta', 'otro'];

export const MOTIVO_LABELS: Record<MotivoDevolucion, string> = {
  rotura_danio: 'Rotura o daño',
  vencimiento: 'Vencimiento',
  mercaderia_incorrecta: 'Mercadería incorrecta',
  otro: 'Otro',
};

/** Largo máximo de la descripción: mismo valor que `devoluciones_descripcion_chk` (length <= 2000). */
export const MAX_DESCRIPCION = 2000;

/** Desde cuántos caracteres se muestra el contador de la descripción (igual que en Gastos). */
export const DESCRIPCION_COUNTER_FROM = 1800;

/**
 * Tope de devoluciones que muestra el detalle de un viaje y la lista de un mes (pestaña Devoluciones de `/viajes`).
 * Se pide una más (`LIST_LIMIT + 1`) para saber si se alcanzó.
 */
export const LIST_LIMIT = 200;

// Nombres de los constraints de la base que el front reconoce SOLO para elegir un mensaje o decidir un flujo
// (001_schema.sql y 008_devoluciones_client_ref.sql). Nunca se muestran.

/** Índice único del `client_ref` (migración 008): un 23505 de este índice significa "esta devolución ya estaba guardada". */
export const DEVOLUCIONES_CLIENT_REF_CONSTRAINT = 'devoluciones_transportista_client_ref_uidx';
/** FK compuesta devolución → cliente (ON DELETE RESTRICT). */
export const DEVOLUCIONES_CLIENTE_FK = 'devoluciones_cliente_fk';
/** FK compuesta devolución → viaje (ON DELETE CASCADE). */
export const DEVOLUCIONES_VIAJE_FK = 'devoluciones_viaje_fk';

/**
 * Mensajes propios de los errores de la base al GUARDAR una devolución (constante de módulo: la usa
 * `useSubmitFeedback`). Nunca se muestra el nombre de un constraint ni el texto del servidor.
 */
export const GUARDAR_DEVOLUCION_CONTEXT: DataErrorContext = {
  // 23503 de un constraint que no reconocemos (no debería pasar: son solo estos dos).
  foreignKey: 'Alguno de los datos de la devolución ya no existe. Vuelve al viaje y revisa.',
  // 23503: el mismo código viene de dos constraints distintos; se distingue por el nombre. Ninguno de los dos se
  // arregla reintentando con lo mismo: hay que elegir otro cliente o volver a la lista de viajes.
  foreignKeyByConstraint: {
    [DEVOLUCIONES_CLIENTE_FK]: 'El cliente elegido ya no existe. Elige otro.',
    [DEVOLUCIONES_VIAJE_FK]: 'Este viaje ya no existe. Vuelve a la lista de viajes.',
  },
  // 23514 (check de largo), 22P02 (valor con formato inválido) y 23502 (dato obligatorio vacío): el front ya valida
  // todo esto antes de enviar, así que llegar acá es raro (otra versión de la app, o un dato al límite).
  invalidData: 'Alguno de los datos de la devolución no es válido. Revísalos e inténtalo de nuevo.',
  // Solo se ve al CREAR: se quiso actualizar la devolución ya guardada (reintento con datos cambiados) y ya no está.
  // Tocar "Guardar devolución" de nuevo la vuelve a crear. (Al EDITAR, 0 filas muestra la pantalla "Devolución no encontrada".)
  notFound: 'La devolución que se había guardado ya no está. Toca "Guardar devolución" para guardarla de nuevo.',
};

/** Ídem al ELIMINAR. */
export const ELIMINAR_DEVOLUCION_CONTEXT: DataErrorContext = {
  foreignKey: 'No se puede eliminar esta devolución porque está vinculada a otros datos.',
};

/** Texto cuando el transportista todavía no tiene ningún cliente (se crean al cargar una entrega en un viaje). */
export const SIN_CLIENTES_MESSAGE = 'Todavía no tienes clientes: se crean al cargar una entrega en un viaje.';

/** Títulos de los grupos del selector de cliente. */
export const GRUPO_CLIENTES_DEL_VIAJE = 'Clientes de este viaje';
export const GRUPO_OTROS_CLIENTES = 'Otros clientes';
export const GRUPO_CLIENTES = 'Clientes';

/** Textos de la sección "Devoluciones" del detalle de un viaje. */
export const SIN_DEVOLUCIONES_MESSAGE = 'Este viaje no tiene devoluciones.';
export const LIMITE_ALCANZADO_MESSAGE = `Hay más de ${LIST_LIMIT} devoluciones en este viaje. Se muestran las ${LIST_LIMIT} más recientes.`;

/** Textos de la pestaña Devoluciones de `/viajes` (la lista de un mes). */
export const LIMITE_MES_ALCANZADO_MESSAGE = `Hay más de ${LIST_LIMIT} devoluciones en este mes. Se muestran las ${LIST_LIMIT} más recientes y el resumen solo suma esas.`;
export const SIN_DEVOLUCIONES_EN_EL_MES_DESCRIPTION = 'Las devoluciones se cargan desde el detalle de un viaje.';
