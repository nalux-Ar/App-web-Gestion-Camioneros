import { useQuery } from '@tanstack/react-query';

import { useTenantId } from '@/features/member/use-tenant-id';
import { CATEGORIAS_STALE_TIME_MS } from './constants';
import { fetchCategorias, fetchGasto, fetchGastosDelRango, fetchGastosDelViaje } from './gastos-api';
import { rangoDelFiltro, type GastosFiltro } from './gastos-filters';
import { gastosKeys } from './gastos-keys';

/**
 * Queries de Gastos. Cada key lleva el tenant (`gastosKeys`) y cada `queryFn`
 * pasa la `signal` de TanStack a la consulta, así salir de la pantalla o cerrar
 * sesión corta el pedido de verdad.
 */

/** Categorías (globales + propias). Cambian poco: frescas 10 minutos. */
export function useCategorias() {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: gastosKeys.categorias(tenantId),
    queryFn: ({ signal }) => fetchCategorias(signal),
    staleTime: CATEGORIAS_STALE_TIME_MS,
  });
}

/**
 * Gastos del mes del filtro. `enabled: false` mientras se espera algo
 * (p.ej. a validar la categoría de la URL contra las categorías cargadas).
 */
export function useGastosDelMes(filtro: GastosFiltro, enabled: boolean) {
  const tenantId = useTenantId();
  const { desde, hasta } = rangoDelFiltro(filtro);
  return useQuery({
    queryKey: gastosKeys.list(tenantId, desde, hasta, filtro.categoriaId),
    queryFn: ({ signal }) => fetchGastosDelRango({ desde, hasta, categoriaId: filtro.categoriaId, signal }),
    enabled,
  });
}

/**
 * Un gasto para editar. `id` es null si el de la URL no es un uuid: no se consulta nada.
 * `gcTime: 0`: no se guarda en caché al salir de la pantalla, así cada vez que se abre el formulario
 * de edición se pide el gasto fresco (el formulario se inicializa UNA vez con lo que vino: si arrancara
 * con una copia vieja, guardar pisaría con datos desactualizados lo que se cambió desde otro lado).
 *
 * Se lee UNA vez: el formulario no vuelve a leer el gasto, así que refrescarlo al volver la señal no sirve
 * de nada (`refetchOnReconnect: false`; `refetchOnWindowFocus` ya está apagado en `query-client.ts`).
 */
export function useGasto(id: string | null) {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: gastosKeys.detail(tenantId, id ?? 'sin-id'),
    queryFn: ({ signal }) => (id === null ? Promise.resolve(null) : fetchGasto(id, signal)),
    enabled: id !== null,
    gcTime: 0,
    refetchOnReconnect: false,
  });
}

/**
 * Los gastos de un viaje (el detalle del viaje). `viajeId` es null si el de la URL no es un uuid: no se consulta
 * nada. La key cuelga de `gastosKeys.all`: cualquier alta, edición o borrado de un gasto la invalida. Sin caché
 * (`gcTime: 0`): al volver de cargar o editar un gasto el total tiene que ser el de ahora, no el de la última vez
 * que se vio la pantalla.
 */
export function useGastosDelViaje(viajeId: string | null) {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: gastosKeys.delViaje(tenantId, viajeId ?? 'sin-id'),
    queryFn: ({ signal }) =>
      viajeId === null ? Promise.resolve({ items: [], truncado: false }) : fetchGastosDelViaje(viajeId, signal),
    enabled: viajeId !== null,
    gcTime: 0,
  });
}
