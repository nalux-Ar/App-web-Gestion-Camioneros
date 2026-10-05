import type { DataErrorContext } from '@/lib/data-errors';

/**
 * Constantes de la pantalla de Clientes (lista, detalle, alta y edición).
 */

/** Largos máximos de los datos de contacto: mismos valores que los checks de `clientes` (001_schema.sql). */
export const MAX_TELEFONO = 50;
export const MAX_EMAIL = 254;
export const MAX_DIRECCION = 300;

/**
 * Índice único del `client_ref` de clientes (migración 009). Un 23505 de ESTE índice al crear significa "este cliente ya
 * estaba guardado" (un intento anterior llegó a la base y se perdió la respuesta). Se reconoce por el nombre, que nunca
 * se muestra.
 */
export const CLIENTES_CLIENT_REF_CONSTRAINT = 'clientes_transportista_client_ref_uidx';

/**
 * Cuántos viajes y cuántas devoluciones muestra el detalle de un cliente (los más recientes). Se pide uno más para saber
 * si hay más de los que se muestran.
 */
export const DETALLE_LIMIT = 50;

/**
 * Mensajes propios de los errores de la base al GUARDAR un cliente desde su formulario (constante de módulo: la usa
 * `useSubmitFeedback`). Nunca se muestra el nombre de un constraint ni el texto del servidor.
 */
export const GUARDAR_CLIENTE_CONTEXT: DataErrorContext = {
  // 23514 (checks de largo) y 23502 (nombre vacío): el front ya valida todo esto antes de enviar, así que llegar acá es
  // raro (otra versión de la app, o un dato al límite).
  invalidData: 'Alguno de los datos del cliente no es válido. Revísalos e inténtalo de nuevo.',
  // Solo se ve al CREAR: el cliente que guardó un intento anterior (respuesta perdida) ya no está. Guardar de nuevo lo vuelve
  // a crear. (Al EDITAR, 0 filas muestra la pantalla "Cliente no encontrado".)
  notFound: 'El cliente que se había guardado ya no está. Toca "Guardar cliente" para guardarlo de nuevo.',
};

/**
 * Ídem al ELIMINAR. Un cliente con entregas o devoluciones no se puede borrar: `entregas_cliente_fk` y
 * `devoluciones_cliente_fk` son ON DELETE RESTRICT. PostgreSQL 17 (la base real) responde 23503 y PostgreSQL 18 responde
 * 23001 (`restrict_violation`): con `restrictAsForeignKey` los dos dan este mismo mensaje. No se ofrece "Reintentar": con
 * los mismos datos da lo mismo (el que se puede hacer es renombrarlo).
 */
export const ELIMINAR_CLIENTE_CONTEXT: DataErrorContext = {
  foreignKey: 'No se puede eliminar: este cliente tiene entregas o devoluciones. Puedes renombrarlo.',
  restrictAsForeignKey: true,
};
