import { tenantKey } from '@/lib/query-keys';

/**
 * Query keys de Viajes. Todas empiezan con el tenant (`tenantKey`, ver src/lib/query-keys.ts). Invalidar
 * `all` cubre la lista y el detalle; `lists` cubre solo las listas por mes.
 *
 * Tras guardar o borrar se invalida `lists`, NO `all`: el detalle lo tiene activo la pantalla de edición, y
 * refrescarlo mientras el formulario está abierto no sirve (se lee una sola vez para inicializarlo) y, con
 * señal mala, un refresco fallido lo dejaba en error y desmontaba el formulario con lo tipeado.
 */
export const viajesKeys = {
  all: (tenantId: string) => tenantKey(tenantId, 'viajes'),
  lists: (tenantId: string) => tenantKey(tenantId, 'viajes', 'lista'),
  list: (tenantId: string, desde: string, hasta: string) => tenantKey(tenantId, 'viajes', 'lista', desde, hasta),
  detail: (tenantId: string, id: string) => tenantKey(tenantId, 'viajes', 'detalle', id),
};
