import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { clientesKeys } from '@/features/clientes/clientes-keys';
import { viajesKeys } from '@/features/viajes/viajes-keys';
import { isForeignKeyViolationOf } from '@/lib/data-errors';
import type { RowChanges } from '@/lib/db';
import { DEVOLUCIONES_CLIENTE_FK, DEVOLUCIONES_VIAJE_FK } from './constants';
import type { DevolucionColumns } from './devolucion-form';
import { crearDevolucion, type CrearDevolucionResultado } from './devolucion-save';
import { actualizarDevolucion, devolucionWriteIO, eliminarDevolucion } from './devoluciones-api';
import { devolucionesKeys } from './devoluciones-keys';

/**
 * Mutaciones de Devoluciones. Reglas:
 *  - NO se configura `retry` ni `networkMode` acá (regla de ESLint): el default global es `retry: 0` +
 *    `networkMode: 'always'`. El reintento es manual (`useSubmitFeedback` + "Reintentar") y, al crear, seguro porque
 *    `crearDevolucion` es idempotente (`client_ref`).
 *  - `scope`: las mutaciones con el mismo `scope.id` corren de a una (un doble toque no guarda dos veces en paralelo).
 *  - El `tenantId` viaja en las variables: se captura al empezar la mutación y es ESE el que se invalida, aunque
 *    mientras tanto cambie el usuario (la caché se vacía al cambiar de usuario; invalidar la key de otro tenant no
 *    toca nada ajeno).
 *  - Se invalida en `onSettled` (no solo si salió bien): con un timeout la escritura pudo haberse aplicado igual
 *    (respuesta perdida). Se invalidan las LISTAS de devoluciones de los viajes (`devolucionesKeys.delosViajes`), NO
 *    el detalle de edición: ese lo observa la pantalla de edición y, si el refresco fallaba por mala señal, era el
 *    origen del hallazgo de la auditoría de Viajes. No se espera la invalidación (`void`).
 *  - Si guardar falla porque ya no existe una de las dos cosas a las que apunta (23503, se distingue por el nombre del
 *    constraint): el cliente → se vuelve a pedir la lista de clientes (si no, el cliente borrado seguiría en el
 *    selector y el error se repetiría); el viaje → se marcan viejas las listas de viajes.
 */

/** Marca viejas las listas de devoluciones de los viajes. */
function invalidarDevoluciones(queryClient: QueryClient, tenantId: string) {
  void queryClient.invalidateQueries({ queryKey: devolucionesKeys.delosViajes(tenantId) });
}

/** Tras guardar (bien o mal): las listas y, según el error, la de clientes o la de viajes. */
function invalidarTrasGuardar(queryClient: QueryClient, tenantId: string, error: Error | null) {
  invalidarDevoluciones(queryClient, tenantId);
  if (error === null) return;
  if (isForeignKeyViolationOf(error, DEVOLUCIONES_CLIENTE_FK)) {
    void queryClient.invalidateQueries({ queryKey: clientesKeys.all(tenantId) });
  }
  if (isForeignKeyViolationOf(error, DEVOLUCIONES_VIAJE_FK)) {
    void queryClient.invalidateQueries({ queryKey: viajesKeys.lists(tenantId) });
  }
}

export interface CrearDevolucionVariables {
  tenantId: string;
  /** El viaje (de la URL, ya validado como uuid). */
  viajeId: string;
  columns: DevolucionColumns;
  clientRef: string;
  /** Huellas de lo ya mandado con este `clientRef` (ver `crearDevolucion`). Se modifica. */
  sent: Set<string>;
}

export function useCrearDevolucion() {
  const queryClient = useQueryClient();
  return useMutation<CrearDevolucionResultado, Error, CrearDevolucionVariables>({
    scope: { id: 'crear-devolucion' },
    mutationFn: ({ viajeId, columns, clientRef, sent }) =>
      crearDevolucion({ viajeId, columns, clientRef, sent, io: devolucionWriteIO }),
    onSettled: (_resultado, error, { tenantId }) => invalidarTrasGuardar(queryClient, tenantId, error),
  });
}

export interface ActualizarDevolucionVariables {
  tenantId: string;
  id: string;
  changes: RowChanges<'devoluciones'>;
}

export function useActualizarDevolucion() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, ActualizarDevolucionVariables>({
    scope: { id: 'actualizar-devolucion' },
    mutationFn: ({ id, changes }) => actualizarDevolucion(id, changes),
    onSettled: (_resultado, error, { tenantId }) => invalidarTrasGuardar(queryClient, tenantId, error),
  });
}

export interface EliminarDevolucionVariables {
  tenantId: string;
  id: string;
}

/** Devuelve cuántas filas borró; 0 = ya no estaba, que para un borrado es lo mismo que éxito. */
export function useEliminarDevolucion() {
  const queryClient = useQueryClient();
  return useMutation<number, Error, EliminarDevolucionVariables>({
    scope: { id: 'eliminar-devolucion' },
    mutationFn: ({ id }) => eliminarDevolucion(id),
    onSettled: (_borradas, _error, { tenantId }) => invalidarDevoluciones(queryClient, tenantId),
  });
}
