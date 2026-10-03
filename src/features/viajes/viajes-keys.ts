import { tenantKey } from '@/lib/query-keys';

/**
 * Query keys de Viajes. Todas empiezan con el tenant (`tenantKey`, ver src/lib/query-keys.ts). Invalidar
 * `all` cubre la lista y el detalle; `lists` cubre solo las listas por mes y los viajes recientes.
 *
 * Tras guardar o borrar se invalida `lists` (y `vistas`), NO `all`: el detalle de EDICIÓN (`detail`) lo tiene
 * activo la pantalla de edición, y refrescarlo mientras el formulario está abierto no sirve (se lee una sola vez
 * para inicializarlo) y, con señal mala, un refresco fallido lo dejaba en error y desmontaba el formulario con
 * lo tipeado. La vista de solo lectura (`vista`) no inicializa ningún formulario: esa sí se refresca.
 */
export const viajesKeys = {
  all: (tenantId: string) => tenantKey(tenantId, 'viajes'),
  lists: (tenantId: string) => tenantKey(tenantId, 'viajes', 'lista'),
  list: (tenantId: string, desde: string, hasta: string) => tenantKey(tenantId, 'viajes', 'lista', desde, hasta),
  /** Los viajes más recientes para el selector del formulario de gastos. Cuelga de `lists`: guardar o borrar un
   *  viaje la invalida sola. */
  recientes: (tenantId: string) => tenantKey(tenantId, 'viajes', 'lista', 'recientes'),
  detail: (tenantId: string, id: string) => tenantKey(tenantId, 'viajes', 'detalle', id),
  /** Un viaje por id para preseleccionarlo en el formulario de gastos (`?viaje=`). */
  opcion: (tenantId: string, id: string) => tenantKey(tenantId, 'viajes', 'opcion', id),
  /** La pantalla de solo lectura de un viaje (con los nombres de los clientes de sus entregas). */
  vistas: (tenantId: string) => tenantKey(tenantId, 'viajes', 'vista'),
  vista: (tenantId: string, id: string) => tenantKey(tenantId, 'viajes', 'vista', id),
  /** Cuántos gastos y cuántas devoluciones tiene un viaje (la confirmación de borrarlo). A propósito NO cuelga de
   *  `lists`, `vistas` ni de las keys de gastos o de devoluciones: el borrado invalida esas, y refrescar el conteo
   *  con la confirmación abierta cambiaría el texto mientras se está borrando. Se pide fresco cada vez que se abre
   *  la confirmación. */
  conteos: (tenantId: string, id: string) => tenantKey(tenantId, 'viajes', 'conteos-del-borrado', id),
};
