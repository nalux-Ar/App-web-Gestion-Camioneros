import type { DataErrorContext } from '@/lib/data-errors';
import { GUARDAR_GASTO_CONTEXT } from './constants';
import { LOTE_DISTINTO } from './gasto-lote-errores';

/**
 * Textos de los errores de cargar VARIOS gastos de una vez que ninguna clase de error describe bien. Español neutro de «tú», sin el
 * texto del servidor y sin nombrar ningún botón (la pantalla decide cómo se llama cada salida).
 */

/**
 * `LoteDeGastosDistintoError`: ya se mandó un pedido sin confirmar con otras categorías (se destildó o se agregó una después de un
 * intento sin respuesta). Con la pantalla bloqueando las categorías no debería verse; si pasa, hay que empezar de nuevo, y como el
 * intento anterior pudo haberse guardado, revisar la lista antes de volver a cargar.
 */
export const LOTE_DISTINTO_MESSAGE =
  'Antes se intentó guardar con otras categorías y no sabemos si llegó. Empieza de nuevo y revisa la lista de Gastos antes de volver a cargar.';

/**
 * Al reintentar con datos cambiados se actualiza cada gasto que se había guardado, y uno de ellos ya no está (por ejemplo, se
 * eliminó desde otro dispositivo). Volver a tocar guardar no lo arregla: con los otros gastos ya guardados el pedido chocaría de
 * nuevo. Hay que empezar de nuevo, revisando la lista para no repetir los que sí están.
 */
export const LOTE_NO_ENCONTRADO_MESSAGE = 'Uno de los gastos que se había guardado ya no está. Revisa la lista de Gastos antes de volver a cargarlos.';

/**
 * El contexto de errores de GUARDAR varios gastos de una vez: el de un gasto solo (camión, viaje y categoría) con el texto de «ya
 * no está» en plural y el de `LoteDeGastosDistintoError`, que se reconoce por el texto fijo de su `message` (`LOTE_DISTINTO`) y
 * por eso tampoco se reintenta.
 */
export const GUARDAR_LOTE_CONTEXT: DataErrorContext = {
  ...GUARDAR_GASTO_CONTEXT,
  messagesByConstraint: {
    ...GUARDAR_GASTO_CONTEXT.messagesByConstraint,
    [LOTE_DISTINTO]: LOTE_DISTINTO_MESSAGE,
  },
  notFound: LOTE_NO_ENCONTRADO_MESSAGE,
};
