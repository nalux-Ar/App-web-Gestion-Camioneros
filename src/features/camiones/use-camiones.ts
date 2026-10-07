import { useQuery } from '@tanstack/react-query';

import { useTenantId } from '@/features/member/use-tenant-id';
import { contarGastosAMover, contarSinCamion, fetchCamion, fetchCamiones } from './camiones-api';
import { camionesKeys } from './camiones-keys';
import { CAMIONES_STALE_TIME_MS } from './constants';

/**
 * Queries de Camiones. Cada key lleva el tenant (`camionesKeys`) y cada `queryFn` pasa la `signal` de TanStack a la
 * consulta: salir de la pantalla o cerrar sesión corta el pedido de verdad.
 */

/**
 * Todos los camiones del tenant (activos y archivados). La comparten la pantalla de Camiones, las tarjetas de Inicio y
 * Configuración, los selectores de viaje y combustible y todas las etiquetas ("AB 123 CD"): se pide una vez. Cambia poco:
 * se considera fresca 10 minutos (como las categorías); las mutaciones de camiones la invalidan.
 *
 * `fresca`: para los formularios que DECIDEN con esta lista qué camión mandar (viaje y combustible). Cada vez que se
 * abren la piden de nuevo aunque la de la caché tenga menos de 10 minutos. Si no, con 1 camión activo en la caché el
 * formulario asigna ese solo (`decidirCamion` → `auto`), sin mostrar el selector, aunque desde otro dispositivo ya se haya
 * cargado el segundo: quedaría un viaje o una carga asignados al camión equivocado. Comparte la key (y el pedido en
 * vuelo) con las demás pantallas: no duplica consultas.
 */
export function useCamiones({ enabled = true, fresca = false }: { enabled?: boolean; fresca?: boolean } = {}) {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: camionesKeys.list(tenantId),
    queryFn: ({ signal }) => fetchCamiones(signal),
    enabled,
    staleTime: fresca ? 0 : CAMIONES_STALE_TIME_MS,
    refetchOnMount: fresca ? 'always' : true,
  });
}

/**
 * Un camión para EDITAR. `gcTime: 0`: cada vez que se abre el formulario se pide fresco (se inicializa UNA vez con lo que
 * vino). Se lee UNA vez: refrescarlo al volver la señal no sirve y, si fallaba, ponía la query en error con el formulario
 * abierto (`refetchOnReconnect: false`). Las mutaciones NO invalidan esta key.
 */
export function useCamionParaEditar(id: string | null) {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: camionesKeys.detail(tenantId, id ?? 'sin-id'),
    queryFn: ({ signal }) => (id === null ? Promise.resolve(null) : fetchCamion(id, signal)),
    enabled: id !== null,
    gcTime: 0,
    refetchOnReconnect: false,
  });
}

/**
 * Cuántos viajes sin camión y cuántos gastos con litros sin camión hay: el aviso ANTES de cargar el primer camión (se le
 * asignan todos). Solo con `enabled` y SIEMPRE fresco: los números que se muestran tienen que ser los de ahora.
 */
export function useConteoSinCamion(enabled: boolean) {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: camionesKeys.sinCamion(tenantId),
    queryFn: ({ signal }) => contarSinCamion(signal),
    enabled,
    staleTime: 0,
    gcTime: 0,
    refetchOnReconnect: false,
  });
}

/**
 * Cuántos gastos de un viaje pasarían al camión elegido si se guarda el viaje con ese camión (el botón lo dice antes de
 * guardar). Solo con `enabled` (el camión cambió) y SIEMPRE fresco.
 */
export function useGastosAMover(viajeId: string | null, camionId: string | null, enabled: boolean) {
  const tenantId = useTenantId();
  const habilitada = enabled && viajeId !== null && camionId !== null;
  return useQuery({
    queryKey: camionesKeys.gastosAMover(tenantId, viajeId ?? 'sin-viaje', camionId ?? 'sin-camion'),
    queryFn: ({ signal }) => (viajeId !== null && camionId !== null ? contarGastosAMover(viajeId, camionId, signal) : Promise.resolve(0)),
    enabled: habilitada,
    staleTime: 0,
    gcTime: 0,
    refetchOnReconnect: false,
  });
}
