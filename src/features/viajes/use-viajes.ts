import { useQuery } from '@tanstack/react-query';

import { useTenantId } from '@/features/member/use-tenant-id';
import {
  contarDelViaje,
  fetchViaje,
  fetchViajeOpcion,
  fetchViajesDelRango,
  fetchViajesRecientes,
  fetchViajeVista,
} from './viajes-api';
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

/**
 * Los viajes más recientes para el selector "Viaje" del formulario de gastos. La key cuelga de `viajesKeys.lists`:
 * guardar o borrar un viaje la deja vieja sola. No inicializa ningún campo (solo arma las opciones), así que sí
 * se puede refrescar con el formulario abierto; la pantalla solo muestra el error si no hay datos. Dos pantallas
 * pueden llamar a este hook a la vez (comparten la misma key): se pide una sola vez.
 */
export function useViajesRecientes({ enabled = true }: { enabled?: boolean } = {}) {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: viajesKeys.recientes(tenantId),
    queryFn: ({ signal }) => fetchViajesRecientes(signal),
    enabled,
  });
}

/**
 * El viaje que llega preseleccionado a un gasto nuevo (`/gastos/nuevo?viaje=<uuid>`). `id` es null si no hay
 * parámetro o no es un uuid: no se consulta nada. Como el formulario se inicializa UNA vez con lo que vino
 * (mismo criterio que `useGasto` y `useViaje`): sin caché y sin refresco al reconectar.
 */
export function useViajeOpcion(id: string | null) {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: viajesKeys.opcion(tenantId, id ?? 'sin-id'),
    queryFn: ({ signal }) => (id === null ? Promise.resolve(null) : fetchViajeOpcion(id, signal)),
    enabled: id !== null,
    gcTime: 0,
    refetchOnReconnect: false,
  });
}

/**
 * La pantalla de solo lectura de un viaje, con sus entregas y los nombres de los clientes. `id` es null si el
 * de la URL no es un uuid. No inicializa ningún formulario, así que se refresca con normalidad al reconectar. Sin
 * caché (`gcTime: 0`) a propósito: al volver de editar el viaje (o de cargar un gasto) se ve el estado de ahora, no
 * una copia vieja que, si el pedido fallara, quedaría a la vista junto a un "Viaje guardado." que no la refleja. Igual
 * que los gastos del viaje. Los guardados además la marcan vieja (`viajesKeys.vistas`).
 */
export function useViajeVista(id: string | null) {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: viajesKeys.vista(tenantId, id ?? 'sin-id'),
    queryFn: ({ signal }) => (id === null ? Promise.resolve(null) : fetchViajeVista(id, signal)),
    enabled: id !== null,
    gcTime: 0,
  });
}

/**
 * Cuántos gastos y cuántas devoluciones tiene un viaje, para la confirmación de borrarlo (los dos conteos en una
 * misma consulta: si cualquiera falla, falla el conjunto y la confirmación cae en su texto genérico). Solo se pide
 * con `enabled` (cuando se abre la confirmación) y SIEMPRE fresco (sin caché ni reuso): los números que se muestran
 * tienen que ser los de ahora.
 */
export function useConteosDelViaje(viajeId: string, enabled: boolean) {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: viajesKeys.conteos(tenantId, viajeId),
    queryFn: ({ signal }) => contarDelViaje(viajeId, signal),
    enabled,
    staleTime: 0,
    gcTime: 0,
    refetchOnReconnect: false,
  });
}
