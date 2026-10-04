import { useQuery } from '@tanstack/react-query';

import { useTenantId } from '@/features/member/use-tenant-id';
import { rangoDelFiltro, type ViajesFiltro } from '@/features/viajes/viajes-filters';
import { fetchDevolucion, fetchDevolucionesDelMes, fetchDevolucionesDelViaje } from './devoluciones-api';
import { devolucionesKeys } from './devoluciones-keys';

/**
 * Queries de Devoluciones. Cada key lleva el tenant (`devolucionesKeys`) y cada `queryFn` pasa la `signal` de
 * TanStack a la consulta, así salir de la pantalla o cerrar sesión corta el pedido de verdad.
 */

/**
 * Las devoluciones de un viaje (el detalle del viaje). `viajeId` es null si el de la URL no es un uuid: no se
 * consulta nada. Sin caché (`gcTime: 0`): al volver de cargar o editar una devolución la lista tiene que ser la de
 * ahora, no la de la última vez que se vio la pantalla (igual que los gastos del viaje).
 */
export function useDevolucionesDelViaje(viajeId: string | null) {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: devolucionesKeys.delViaje(tenantId, viajeId ?? 'sin-id'),
    queryFn: ({ signal }) =>
      viajeId === null ? Promise.resolve({ items: [], truncado: false }) : fetchDevolucionesDelViaje(viajeId, signal),
    enabled: viajeId !== null,
    gcTime: 0,
  });
}

/**
 * Las devoluciones del mes del filtro (la pestaña Devoluciones de `/viajes`), con el cliente y el viaje embebidos. El mes
 * es el de la fecha del viaje. Mismos defaults que `useViajesDelMes` (caché de la lista, que las mutaciones marcan vieja
 * con `devolucionesKeys.delosMeses`). Solo la pide el componente de esa pestaña: con la pestaña Viajes no se consulta nada.
 */
export function useDevolucionesDelMes(filtro: Pick<ViajesFiltro, 'mes'>) {
  const tenantId = useTenantId();
  const { desde, hasta } = rangoDelFiltro(filtro);
  return useQuery({
    queryKey: devolucionesKeys.delMes(tenantId, desde, hasta),
    queryFn: ({ signal }) => fetchDevolucionesDelMes({ desde, hasta, signal }),
  });
}

/**
 * Una devolución para editar, pedida por id Y por viaje. Si el id o el viaje de la URL no son uuid (`null`), no se
 * consulta nada. `gcTime: 0`: no se guarda en caché al salir de la pantalla, así cada vez que se abre el formulario
 * de edición se pide la devolución fresca (el formulario se inicializa UNA vez con lo que vino: si arrancara con una
 * copia vieja, guardar pisaría con datos desactualizados lo que se cambió desde otro lado).
 *
 * Se lee UNA vez: el formulario no vuelve a leer la devolución, así que refrescarla al volver la señal no sirve de
 * nada y, si fallaba, ponía la query en error con el formulario ya abierto (`refetchOnReconnect: false`; el
 * `refetchOnWindowFocus` ya está apagado en `query-client.ts`).
 */
export function useDevolucion(id: string | null, viajeId: string | null) {
  const tenantId = useTenantId();
  const habilitada = id !== null && viajeId !== null;
  return useQuery({
    queryKey: devolucionesKeys.detail(tenantId, id ?? 'sin-id', viajeId ?? 'sin-viaje'),
    queryFn: ({ signal }) => (habilitada ? fetchDevolucion(id, viajeId, signal) : Promise.resolve(null)),
    enabled: habilitada,
    gcTime: 0,
    refetchOnReconnect: false,
  });
}
