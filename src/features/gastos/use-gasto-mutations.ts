import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { viajesKeys } from '@/features/viajes/viajes-keys';
import { isForeignKeyViolationOf } from '@/lib/data-errors';
import type { RowChanges } from '@/lib/db';
import { GASTOS_VIAJE_FK } from './constants';
import { crearGasto, type CrearGastoResultado } from './gasto-save';
import type { GastoColumns } from './gasto-form';
import { actualizarGasto, eliminarGasto, gastoWriteIO } from './gastos-api';
import { gastosKeys } from './gastos-keys';

/**
 * Mutaciones de Gastos. Reglas:
 *  - NO se configura `retry` ni `networkMode` acá (regla de ESLint): el default
 *    global es `retry: 0` + `networkMode: 'always'`. El reintento es manual
 *    (`useSubmitFeedback` + "Reintentar") y, al crear, seguro porque `crearGasto`
 *    es idempotente (client_ref).
 *  - El `tenantId` viaja en las variables: se captura al empezar la mutación y
 *    es ESE el que se invalida en `onSuccess`, aunque mientras tanto cambie el
 *    usuario (la caché se vacía al cambiar de usuario; invalidar la key de otro
 *    tenant no toca nada ajeno).
 *  - `onSuccess` no espera la invalidación (`void`): la lista no está montada
 *    mientras se edita, así que solo queda marcada como vieja y se refresca al volver.
 *  - Si guardar falla porque el viaje elegido ya no existe (23503 de `gastos_viaje_fk`), también se
 *    invalida la lista de viajes recientes del selector: si no, el viaje borrado seguiría ofreciéndose.
 */

/** Un viaje que ya no existe: la lista de recientes que muestra el selector quedó vieja. */
function invalidarViajesSiNoExiste(queryClient: QueryClient, tenantId: string, error: Error) {
  if (isForeignKeyViolationOf(error, GASTOS_VIAJE_FK)) {
    void queryClient.invalidateQueries({ queryKey: viajesKeys.recientes(tenantId) });
  }
}

export interface CrearGastoVariables {
  tenantId: string;
  columns: GastoColumns;
  clientRef: string;
  /** Huellas de lo ya mandado con este `clientRef` (ver `crearGasto`). Se modifica. */
  sent: Set<string>;
}

export function useCrearGasto() {
  const queryClient = useQueryClient();
  return useMutation<CrearGastoResultado, Error, CrearGastoVariables>({
    mutationFn: ({ columns, clientRef, sent }) => crearGasto({ columns, clientRef, sent, io: gastoWriteIO }),
    onSuccess: (_resultado, { tenantId }) => {
      void queryClient.invalidateQueries({ queryKey: gastosKeys.all(tenantId) });
    },
    onError: (error, { tenantId }) => invalidarViajesSiNoExiste(queryClient, tenantId, error),
  });
}

export interface ActualizarGastoVariables {
  tenantId: string;
  id: string;
  changes: RowChanges<'gastos'>;
}

export function useActualizarGasto() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, ActualizarGastoVariables>({
    mutationFn: ({ id, changes }) => actualizarGasto(id, changes),
    onSuccess: (_resultado, { tenantId }) => {
      void queryClient.invalidateQueries({ queryKey: gastosKeys.all(tenantId) });
    },
    onError: (error, { tenantId }) => invalidarViajesSiNoExiste(queryClient, tenantId, error),
  });
}

export interface EliminarGastoVariables {
  tenantId: string;
  id: string;
}

/** Devuelve cuántas filas borró; 0 = ya no estaba, que para un borrado es lo mismo que éxito. */
export function useEliminarGasto() {
  const queryClient = useQueryClient();
  return useMutation<number, Error, EliminarGastoVariables>({
    mutationFn: ({ id }) => eliminarGasto(id),
    onSuccess: (_borradas, { tenantId }) => {
      void queryClient.invalidateQueries({ queryKey: gastosKeys.all(tenantId) });
    },
  });
}
