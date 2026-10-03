import { useQuery } from '@tanstack/react-query';

import { useTenantId } from '@/features/member/use-tenant-id';
import { fetchViaje, fetchViajesDelRango } from './viajes-api';
import { rangoDelFiltro, type ViajesFiltro } from './viajes-filters';
import { viajesKeys } from './viajes-keys';

/**
 * Queries de Viajes. Cada key lleva el tenant (`viajesKeys`) y cada `queryFn` pasa la `signal` de TanStack
 * a la consulta, así salir de la pantalla o cerrar sesión corta el pedido de verdad.
 */

/** Viajes del mes del filtro (con el conteo de entregas de cada uno). */
export function useViajesDelMes(filtro: ViajesFiltro) {
  const tenantId = useTenantId();
  const { desde, hasta } = rangoDelFiltro(filtro);
  return useQuery({
    queryKey: viajesKeys.list(tenantId, desde, hasta),
    queryFn: ({ signal }) => fetchViajesDelRango({ desde, hasta, signal }),
  });
}

/**
 * Un viaje con sus entregas para editar. `id` es null si el de la URL no es un uuid: no se consulta nada.
 * `gcTime: 0`: no se guarda en caché al salir de la pantalla, así cada vez que se abre el formulario de
 * edición se pide el viaje fresco (el formulario se inicializa UNA vez con lo que vino: si arrancara con una
 * copia vieja, guardar pisaría con datos desactualizados lo que se cambió desde otro lado; la edición es un
 * reemplazo completo de las entregas).
 *
 * Se lee UNA vez: el formulario se inicializa con lo que vino y no vuelve a leer el viaje, así que refrescarlo
 * al volver la señal no sirve de nada y, si fallaba, ponía la query en error con el formulario ya abierto
 * (`refetchOnReconnect: false`; el `refetchOnWindowFocus` ya está apagado en `query-client.ts`).
 */
export function useViaje(id: string | null) {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: viajesKeys.detail(tenantId, id ?? 'sin-id'),
    queryFn: ({ signal }) => (id === null ? Promise.resolve(null) : fetchViaje(id, signal)),
    enabled: id !== null,
    gcTime: 0,
    refetchOnReconnect: false,
  });
}
