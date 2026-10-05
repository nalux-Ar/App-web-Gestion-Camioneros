import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { devolucionesKeys } from '@/features/devoluciones/devoluciones-keys';
import { viajesKeys } from '@/features/viajes/viajes-keys';
import type { ClienteColumns } from './cliente-form';
import { actualizarCliente, eliminarCliente } from './clientes-api';
import { clientesKeys } from './clientes-keys';

/**
 * Mutaciones de la EDICIÓN y el BORRADO de un cliente (el alta está en `use-crear-cliente.ts`). Reglas:
 *  - NO se configura `retry` ni `networkMode` acá (regla de ESLint): el default global es `retry: 0` +
 *    `networkMode: 'always'`. El reintento es manual (`useSubmitFeedback` + "Reintentar").
 *  - `scope`: las mutaciones con el mismo `scope.id` corren de a una (un doble toque no guarda dos veces en paralelo).
 *  - El `tenantId` viaja en las variables: se captura al empezar la mutación y es ESE el que se invalida.
 *  - Se invalida en `onSettled` (no solo si salió bien): con un timeout la escritura pudo haberse aplicado igual (respuesta
 *    perdida). No se espera la invalidación (`void`). Nunca se invalida el detalle de EDICIÓN (`clientesKeys.detail`): lo
 *    observa la pantalla de edición (ver `clientesKeys`).
 */

/**
 * Tras editar un cliente: el nombre va EMBEBIDO (`clientes(nombre)`) en otras pantallas, que quedan viejas:
 *  - la lista de clientes (la de la pantalla y la de los selectores) y las vistas de clientes (su detalle);
 *  - el detalle de solo lectura de los viajes (sus entregas muestran el nombre del cliente): `viajesKeys.vistas`;
 *  - las devoluciones de cada viaje y las de cada mes (pestaña Devoluciones de `/viajes`): `devolucionesKeys.delosViajes` y
 *    `devolucionesKeys.delosMeses`.
 * NO hace falta `viajesKeys.lists` (la lista de viajes solo CUENTA entregas, no muestra nombres) ni nada de gastos.
 */
export function invalidarTrasEditarCliente(queryClient: QueryClient, tenantId: string) {
  void queryClient.invalidateQueries({ queryKey: clientesKeys.list(tenantId) });
  void queryClient.invalidateQueries({ queryKey: clientesKeys.vistas(tenantId) });
  void queryClient.invalidateQueries({ queryKey: viajesKeys.vistas(tenantId) });
  void queryClient.invalidateQueries({ queryKey: devolucionesKeys.delosViajes(tenantId) });
  void queryClient.invalidateQueries({ queryKey: devolucionesKeys.delosMeses(tenantId) });
}

/**
 * Tras borrar un cliente: la lista (pantalla y selectores) y las vistas de clientes. Un cliente borrado no tenía entregas
 * ni devoluciones (si no, la base no lo deja borrar), así que nada más lo mostraba. Los conteos de la confirmación NO se
 * invalidan: cambiarían el texto mientras se está borrando.
 */
export function invalidarTrasBorrarCliente(queryClient: QueryClient, tenantId: string) {
  void queryClient.invalidateQueries({ queryKey: clientesKeys.list(tenantId) });
  void queryClient.invalidateQueries({ queryKey: clientesKeys.vistas(tenantId) });
}

export interface ActualizarClienteVariables {
  tenantId: string;
  id: string;
  /** Todas las columnas del formulario, con `null` explícito en las vacías. */
  columns: ClienteColumns;
}

export function useActualizarCliente() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, ActualizarClienteVariables>({
    scope: { id: 'actualizar-cliente' },
    mutationFn: ({ id, columns }) => actualizarCliente(id, columns),
    onSettled: (_resultado, _error, { tenantId }) => invalidarTrasEditarCliente(queryClient, tenantId),
  });
}

export interface EliminarClienteVariables {
  tenantId: string;
  id: string;
}

/** Devuelve cuántas filas borró; 0 = ya no estaba, que para un borrado es lo mismo que éxito. */
export function useEliminarCliente() {
  const queryClient = useQueryClient();
  return useMutation<number, Error, EliminarClienteVariables>({
    scope: { id: 'eliminar-cliente' },
    mutationFn: ({ id }) => eliminarCliente(id),
    onSettled: (_borradas, _error, { tenantId }) => invalidarTrasBorrarCliente(queryClient, tenantId),
  });
}
