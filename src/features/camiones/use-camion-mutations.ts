import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { gastosKeys } from '@/features/gastos/gastos-keys';
import { viajesKeys } from '@/features/viajes/viajes-keys';
import { writeTimeoutSignal } from '@/lib/db';
import { altaCamion, verificarPuedeArchivar, type AltaCamionEstado, type AltaCamionResultado } from './camion-alta';
import type { CamionColumns } from './camion-form';
import { actualizarCamion, cambiarActivaCamion, contarCamionesActivos, crearCamion } from './camiones-api';
import { camionesKeys } from './camiones-keys';

/**
 * Mutaciones de Camiones. Reglas:
 *  - NO se configura `retry` ni `networkMode` acá (regla de ESLint): el default global es `retry: 0` +
 *    `networkMode: 'always'`. El reintento es manual (`useSubmitFeedback` + "Reintentar") y, en el alta, seguro:
 *    `crear_camion` es idempotente por patente.
 *  - `scope`: las mutaciones con el mismo `scope.id` corren de a una (un doble toque no guarda dos veces en paralelo).
 *  - El `tenantId` viaja en las variables: se captura al empezar y es ESE el que se invalida.
 *  - Se invalida en `onSettled` (no solo si salió bien): con un timeout la escritura pudo haberse aplicado igual.
 *  - Qué se invalida: SOLO la lista de camiones (la patente se muestra desde ella en todas partes, sin embeds). Excepto el
 *    alta del PRIMER camión del tenant: `crear_camion` le asigna los viajes sin camión y los gastos con litros sin camión,
 *    así que también quedan viejas las listas y vistas de viajes y TODAS las keys de gastos. Nunca el detalle de edición
 *    de un camión (lo observa la pantalla de edición).
 */

/** Tras dar de alta el primer camión: los registros que `crear_camion` le asignó se ven distintos. */
function invalidarTrasPrimerCamion(queryClient: QueryClient, tenantId: string) {
  void queryClient.invalidateQueries({ queryKey: viajesKeys.lists(tenantId) });
  void queryClient.invalidateQueries({ queryKey: viajesKeys.vistas(tenantId) });
  void queryClient.invalidateQueries({ queryKey: gastosKeys.all(tenantId) });
}

function invalidarLista(queryClient: QueryClient, tenantId: string) {
  void queryClient.invalidateQueries({ queryKey: camionesKeys.list(tenantId) });
}

export interface CrearCamionVariables {
  tenantId: string;
  columns: CamionColumns;
  /** Lo que hay que recordar entre intentos (ver `altaCamion`). Se modifica. */
  estado: AltaCamionEstado;
  /**
   * Si el tenant no tenía NINGÚN camión (contando archivados) al empezar: entonces este alta asigna los registros sin
   * camión (`crear_camion`). Se decide con la lista ANTES de guardar, no con la respuesta: con una respuesta perdida, el
   * reintento devuelve `creado = false` y 0 asignados aunque el relleno ya se haya hecho.
   */
  eraElPrimero: boolean;
}

export function useCrearCamion() {
  const queryClient = useQueryClient();
  return useMutation<AltaCamionResultado, Error, CrearCamionVariables>({
    scope: { id: 'crear-camion' },
    mutationFn: ({ columns, estado }) => altaCamion({ columns, estado, io: { crear: crearCamion, actualizar: actualizarCamion } }),
    onSettled: (resultado, _error, { tenantId, eraElPrimero }) => {
      invalidarLista(queryClient, tenantId);
      const asignados = resultado?.tipo === 'creado' && resultado.viajesAsignados + resultado.gastosAsignados > 0;
      if (eraElPrimero || asignados) invalidarTrasPrimerCamion(queryClient, tenantId);
    },
  });
}

export interface ActualizarCamionVariables {
  tenantId: string;
  id: string;
  columns: CamionColumns;
}

export function useActualizarCamion() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, ActualizarCamionVariables>({
    scope: { id: 'actualizar-camion' },
    mutationFn: ({ id, columns }) => actualizarCamion(id, columns),
    onSettled: (_resultado, _error, { tenantId }) => invalidarLista(queryClient, tenantId),
  });
}

export interface CambiarActivaCamionVariables {
  tenantId: string;
  id: string;
  /** false = archivar; true = reactivar. */
  activa: boolean;
}

/**
 * Archivar o reactivar. Al ARCHIVAR, primero se cuenta fresco cuántos camiones activos hay: el único activo no se archiva
 * (regla del front, `verificarPuedeArchivar`). Reactivar no tiene condición.
 */
export function useCambiarActivaCamion() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, CambiarActivaCamionVariables>({
    scope: { id: 'activa-camion' },
    mutationFn: async ({ id, activa }) => {
      if (!activa) await verificarPuedeArchivar(() => contarCamionesActivos(writeTimeoutSignal()));
      await cambiarActivaCamion(id, activa);
    },
    onSettled: (_resultado, _error, { tenantId }) => invalidarLista(queryClient, tenantId),
  });
}
