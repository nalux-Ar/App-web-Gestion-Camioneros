import { tenantKey } from '@/lib/query-keys';

/**
 * Query keys de Clientes. Todas empiezan con el tenant (`tenantKey`, ver src/lib/query-keys.ts). Invalidar `all` cubre
 * todo lo que cuelgue de 'clientes'.
 *
 * Mismo criterio que `viajes-keys.ts`: tras guardar o borrar se invalidan la LISTA (`list`) y las VISTAS de solo lectura
 * (`vistas`: el detalle de un cliente y sus listas de viajes y devoluciones), NO `all`. El detalle de EDICIÓN (`detail`) lo
 * tiene activo la pantalla de edición y se lee una sola vez para inicializar el formulario: refrescarlo con el formulario
 * abierto no sirve y, con señal mala, un refresco fallido lo dejaba en error y desmontaba el formulario con lo tipeado
 * (hallazgo de la auditoría de Viajes). Los conteos de la confirmación de borrar (`conteos`) tampoco cuelgan de lo que
 * invalida el borrado: cambiarían el texto mientras se está borrando.
 */
export const clientesKeys = {
  all: (tenantId: string) => tenantKey(tenantId, 'clientes'),
  /** La lista de clientes: la de la pantalla de Clientes y la de los selectores de entregas y devoluciones (comparten caché). */
  list: (tenantId: string) => tenantKey(tenantId, 'clientes', 'lista'),
  /** Todas las pantallas de solo lectura de clientes (para invalidarlas juntas). */
  vistas: (tenantId: string) => tenantKey(tenantId, 'clientes', 'vista'),
  /** Los datos de un cliente en su detalle. */
  vista: (tenantId: string, id: string) => tenantKey(tenantId, 'clientes', 'vista', id, 'datos'),
  /** Los viajes de un cliente (los que tienen una entrega suya), en su detalle. */
  viajesDelCliente: (tenantId: string, id: string) => tenantKey(tenantId, 'clientes', 'vista', id, 'viajes'),
  /** Las devoluciones de un cliente, en su detalle. */
  devolucionesDelCliente: (tenantId: string, id: string) => tenantKey(tenantId, 'clientes', 'vista', id, 'devoluciones'),
  /** Un cliente para editarlo (el formulario se inicializa UNA vez con esto). */
  detail: (tenantId: string, id: string) => tenantKey(tenantId, 'clientes', 'detalle', id),
  /** Cuántas entregas y devoluciones tiene un cliente (la confirmación de borrarlo). Se pide fresco cada vez que se abre. */
  conteos: (tenantId: string, id: string) => tenantKey(tenantId, 'clientes', 'conteos-del-borrado', id),
};
