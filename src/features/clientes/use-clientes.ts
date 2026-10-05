import { useQuery } from '@tanstack/react-query';

import { useTenantId } from '@/features/member/use-tenant-id';
import {
  contarDelCliente,
  fetchCliente,
  fetchClientes,
  fetchDevolucionesDelCliente,
  fetchViajesDelCliente,
} from './clientes-api';
import { clientesKeys } from './clientes-keys';

/**
 * Queries de Clientes. Cada key lleva el tenant (`clientesKeys`) y cada `queryFn` pasa la `signal` de TanStack a la
 * consulta: salir de la pantalla o cerrar sesión corta el pedido de verdad.
 */

/**
 * Lista de clientes del transportista (con tope, ver `fetchClientes`). La comparten la pantalla de Clientes y los selectores
 * de entregas y devoluciones (misma key): se pide una sola vez.
 *
 * `enabled: false` para no pedirla cuando todavía no hace falta.
 */
export function useClientes({ enabled = true }: { enabled?: boolean } = {}) {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: clientesKeys.list(tenantId),
    queryFn: ({ signal }) => fetchClientes(signal),
    enabled,
  });
}

/**
 * Los datos de un cliente para su DETALLE (solo lectura). `id` es null si el de la URL no es un uuid: no se consulta nada.
 * Sin caché (`gcTime: 0`), como el detalle de un viaje: al volver de editar el cliente se ve el estado de ahora, no una
 * copia vieja. No inicializa ningún formulario, así que se refresca con normalidad al reconectar.
 */
export function useClienteVista(id: string | null) {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: clientesKeys.vista(tenantId, id ?? 'sin-id'),
    queryFn: ({ signal }) => (id === null ? Promise.resolve(null) : fetchCliente(id, signal)),
    enabled: id !== null,
    gcTime: 0,
  });
}

/**
 * Un cliente para EDITAR. `gcTime: 0`: cada vez que se abre el formulario se pide fresco (se inicializa UNA vez con lo
 * que vino: si arrancara con una copia vieja, guardar pisaría lo que se cambió desde otro lado). Se lee UNA vez: refrescarlo
 * al volver la señal no sirve y, si fallaba, ponía la query en error con el formulario abierto (`refetchOnReconnect: false`;
 * el `refetchOnWindowFocus` ya está apagado en `query-client.ts`). Las mutaciones NO invalidan esta key.
 */
export function useClienteParaEditar(id: string | null) {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: clientesKeys.detail(tenantId, id ?? 'sin-id'),
    queryFn: ({ signal }) => (id === null ? Promise.resolve(null) : fetchCliente(id, signal)),
    enabled: id !== null,
    gcTime: 0,
    refetchOnReconnect: false,
  });
}

/**
 * Los viajes de un cliente (su detalle). Sin caché (`gcTime: 0`): al volver de editar un viaje, cargar una entrega o borrar
 * un viaje, la lista tiene que ser la de ahora (ninguna de esas mutaciones conoce esta key).
 */
export function useViajesDelCliente(id: string | null) {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: clientesKeys.viajesDelCliente(tenantId, id ?? 'sin-id'),
    queryFn: ({ signal }) => (id === null ? Promise.resolve({ items: [], truncado: false }) : fetchViajesDelCliente(id, signal)),
    enabled: id !== null,
    gcTime: 0,
  });
}

/** Las devoluciones de un cliente (su detalle). Sin caché, por lo mismo que sus viajes. */
export function useDevolucionesDelCliente(id: string | null) {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: clientesKeys.devolucionesDelCliente(tenantId, id ?? 'sin-id'),
    queryFn: ({ signal }) =>
      id === null ? Promise.resolve({ items: [], truncado: false }) : fetchDevolucionesDelCliente(id, signal),
    enabled: id !== null,
    gcTime: 0,
  });
}

/**
 * Cuántas entregas y devoluciones tiene un cliente, para la confirmación de borrarlo. Solo se pide con `enabled` (cuando
 * se abre la confirmación) y SIEMPRE fresco (sin caché ni reuso): los números que se muestran tienen que ser los de ahora.
 */
export function useConteosDelCliente(clienteId: string, enabled: boolean) {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: clientesKeys.conteos(tenantId, clienteId),
    queryFn: ({ signal }) => contarDelCliente(clienteId, signal),
    enabled,
    staleTime: 0,
    gcTime: 0,
    refetchOnReconnect: false,
  });
}
