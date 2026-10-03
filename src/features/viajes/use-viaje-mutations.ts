import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { clientesKeys } from '@/features/clientes/clientes-keys';
import { devolucionesKeys } from '@/features/devoluciones/devoluciones-keys';
import { gastosKeys } from '@/features/gastos/gastos-keys';
import { classifyDataError } from '@/lib/data-errors';
import type { ConteosDelViaje } from './eliminar-viaje-textos';
import type { ViajeDatos } from './viaje-form';
import { actualizarViaje, crearViaje, type CrearViajeResultado } from './viaje-save';
import { eliminarViajeDesvinculandoGastos, viajeWriteIO } from './viajes-api';
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
 *  - Se invalidan las LISTAS (`viajesKeys.lists`, que incluye los viajes recientes del selector de gastos) y las
 *    VISTAS de solo lectura (`viajesKeys.vistas`), no el detalle de edición: ese lo observa la pantalla de
 *    edición y, si el refresco fallaba por mala señal, desmontaba el formulario con lo tipeado (hallazgo de la
 *    auditoría). Se lee una sola vez para inicializar el formulario (`useViaje`).
 *  - Si guardar falla con un error de referencia (23503: un cliente ya no existe) también se invalida la lista
 *    de clientes: el mensaje dice "actualiza la lista" y, si no, el cliente borrado seguiría en el selector y
 *    el error se repetiría hasta recargar la página.
 */

/** Marca viejas las listas de viajes (y los viajes recientes del selector) y las pantallas de solo lectura. */
function invalidarViajes(queryClient: QueryClient, tenantId: string) {
  void queryClient.invalidateQueries({ queryKey: viajesKeys.lists(tenantId) });
  void queryClient.invalidateQueries({ queryKey: viajesKeys.vistas(tenantId) });
}

/** Tras un guardado (bien o mal): marca vieja la lista de viajes y, si el error es de referencia, la de clientes. */
function invalidarTrasGuardar(queryClient: QueryClient, tenantId: string, error: Error | null) {
  invalidarViajes(queryClient, tenantId);
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
    onSettled: (_resultado, error, { tenantId }) => {
      invalidarTrasGuardar(queryClient, tenantId, error);
      // La lista de gastos muestra el recorrido de cada viaje vinculado: si se editó el viaje, está vieja. Ningún
      // formulario de gasto está abierto mientras se edita un viaje, así que no se refresca nada bajo el dedo.
      if (error === null) void queryClient.invalidateQueries({ queryKey: gastosKeys.all(tenantId) });
    },
  });
}

export interface EliminarViajeVariables {
  tenantId: string;
  id: string;
  /** Cuántos gastos y devoluciones le mostró la confirmación (null si no se pudo contar alguno): se vuelven a contar
   *  antes de desvincular. */
  conteosMostrados: ConteosDelViaje | null;
}

/**
 * Borra el viaje en dos pasos (desvincula sus gastos y luego lo borra: `eliminarViajeDesvinculandoGastos`); sus
 * devoluciones se borran en cascada, por la base. Tira `RecordNotFoundError` si el viaje ya no estaba: para un
 * borrado es lo mismo que éxito (lo trata la pantalla). Se invalida en `onSettled`, también si falla: el paso 1 pudo
 * haberse aplicado igual (los gastos ya perdieron el vínculo) y las listas de gastos, de devoluciones y de viajes no
 * tienen que mostrar el estado de antes.
 */
export function useEliminarViaje() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, EliminarViajeVariables>({
    scope: { id: 'eliminar-viaje' },
    mutationFn: ({ id, conteosMostrados }) => eliminarViajeDesvinculandoGastos(id, conteosMostrados),
    onSettled: (_resultado, _error, { tenantId }) => {
      invalidarViajes(queryClient, tenantId);
      // Los gastos cambiaron (perdieron su viaje): también sus listas, el detalle y los conteos.
      void queryClient.invalidateQueries({ queryKey: gastosKeys.all(tenantId) });
      // Las devoluciones del viaje se borraron con él (o, si falló, ya no hay que fiarse de lo que se veía).
      void queryClient.invalidateQueries({ queryKey: devolucionesKeys.all(tenantId) });
    },
    // Si falló (cambió alguna cantidad, o se cortó después de desvincular), la confirmación sigue abierta: sus conteos
    // se vuelven a pedir para que el texto y el "Reintentar" usen los números de AHORA (mientras tanto, el botón espera).
    onError: (_error, { tenantId, id }) => {
      void queryClient.invalidateQueries({ queryKey: viajesKeys.conteos(tenantId, id) });
    },
  });
}
