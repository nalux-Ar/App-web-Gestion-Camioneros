import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { clientesKeys } from '@/features/clientes/clientes-keys';
import { classifyDataError } from '@/lib/data-errors';
import type { ViajeDatos } from './viaje-form';
import { actualizarViaje, crearViaje, type CrearViajeResultado } from './viaje-save';
import { eliminarViaje, viajeWriteIO } from './viajes-api';
import { viajesKeys } from './viajes-keys';

/**
 * Mutaciones de Viajes. Reglas:
 *  - NO se configura `retry` ni `networkMode` acá (regla de ESLint): el default global es `retry: 0` +
 *    `networkMode: 'always'`. El reintento es manual (`useSubmitFeedback` + "Reintentar") y, al crear,
 *    seguro porque `crearViaje` es idempotente (`client_ref`).
 *  - `scope`: las mutaciones con el mismo `scope.id` corren de a una (un doble toque no guarda dos veces
 *    en paralelo).
 *  - El `tenantId` viaja en las variables: se captura al empezar la mutación y es ESE el que se invalida,
 *    aunque mientras tanto cambie el usuario (la caché se vacía al cambiar de usuario; invalidar la key de
 *    otro tenant no toca nada ajeno).
 *  - Se invalida en `onSettled` (no solo si salió bien): con un timeout la escritura pudo haberse aplicado
 *    igual (respuesta perdida), y la lista no tiene que mostrar el estado de antes si se vuelve a ella
 *    enseguida. La lista no está montada mientras se edita: solo queda marcada como vieja y se refresca al
 *    volver. No se espera la invalidación (`void`).
 *  - Se invalidan las LISTAS (`viajesKeys.lists`), no el detalle: el detalle lo observa la pantalla de edición
 *    y, si el refresco fallaba por mala señal, desmontaba el formulario con lo tipeado (hallazgo de la
 *    auditoría). Se lee una sola vez para inicializar el formulario (`useViaje`).
 *  - Si guardar falla con un error de referencia (23503: un cliente ya no existe) también se invalida la lista
 *    de clientes: el mensaje dice "actualiza la lista" y, si no, el cliente borrado seguiría en el selector y
 *    el error se repetiría hasta recargar la página.
 */

/** Tras un guardado (bien o mal): marca vieja la lista de viajes y, si el error es de referencia, la de clientes. */
function invalidarTrasGuardar(queryClient: QueryClient, tenantId: string, error: Error | null) {
  void queryClient.invalidateQueries({ queryKey: viajesKeys.lists(tenantId) });
  if (error !== null && classifyDataError(error) === 'foreign-key') {
    void queryClient.invalidateQueries({ queryKey: clientesKeys.all(tenantId) });
  }
}

export interface CrearViajeVariables {
  tenantId: string;
  datos: ViajeDatos;
  clientRef: string;
  /** Huellas de lo ya mandado con este `clientRef` (ver `crearViaje`). Se modifica. */
  sent: Set<string>;
}

export function useCrearViaje() {
  const queryClient = useQueryClient();
  return useMutation<CrearViajeResultado, Error, CrearViajeVariables>({
    scope: { id: 'crear-viaje' },
    mutationFn: ({ datos, clientRef, sent }) => crearViaje({ datos, clientRef, sent, io: viajeWriteIO }),
    onSettled: (_resultado, error, { tenantId }) => invalidarTrasGuardar(queryClient, tenantId, error),
  });
}

export interface ActualizarViajeVariables {
  tenantId: string;
  viajeId: string;
  /** El `camion_id` que el viaje ya tenía (leído del detalle). */
  camionId: string | null;
  datos: ViajeDatos;
}

export function useActualizarViaje() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, ActualizarViajeVariables>({
    scope: { id: 'actualizar-viaje' },
    mutationFn: ({ viajeId, camionId, datos }) => actualizarViaje({ viajeId, camionId, datos, io: viajeWriteIO }),
    onSettled: (_resultado, error, { tenantId }) => invalidarTrasGuardar(queryClient, tenantId, error),
  });
}

export interface EliminarViajeVariables {
  tenantId: string;
  id: string;
}

/** Tira `RecordNotFoundError` si el viaje ya no estaba: para un borrado es lo mismo que éxito (lo trata la pantalla). */
export function useEliminarViaje() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, EliminarViajeVariables>({
    scope: { id: 'eliminar-viaje' },
    mutationFn: ({ id }) => eliminarViaje(id),
    onSettled: (_resultado, _error, { tenantId }) => {
      void queryClient.invalidateQueries({ queryKey: viajesKeys.lists(tenantId) });
    },
  });
}
