import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { camionesKeys } from '@/features/camiones/camiones-keys';
import { CAMION_ARCHIVADO, GASTOS_CAMION_FK, GASTOS_CAMION_VIAJE, GASTOS_LITROS_CAMION } from '@/features/camiones/constants';
import { invalidarResumen } from '@/features/resumen/invalidar-resumen';
import { viajesKeys } from '@/features/viajes/viajes-keys';
import { isForeignKeyViolationOf, mentionsConstraint } from '@/lib/data-errors';
import type { RowChanges } from '@/lib/db';
import { GASTOS_VIAJE_FK } from './constants';
import { crearGasto, type CrearGastoResultado } from './gasto-save';
import type { GastoColumns } from './gasto-form';
import { crearGastos, type CrearGastosResultado, type GastoParaGuardar } from './gasto-lote-save';
import {
  actualizarGasto,
  eliminarGasto,
  gastoLoteWriteIO,
  gastoWriteIO,
  quitarGastosDelViaje,
  vincularGastosAViaje,
} from './gastos-api';
import { gastosKeys } from './gastos-keys';
import type { ResultadoDeGasto } from './sumar-gastos';

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
 *  - El Resumen (`invalidarResumen`) se invalida en `onSettled`, también si falla: con un timeout la escritura pudo
 *    haberse aplicado igual, y sus totales no tienen que quedar con los números de antes.
 */

/**
 * Tras un error al guardar, lo que quedó viejo según el error:
 *  - el viaje ya no existe, o cambió de camión (el camión del gasto ya no coincide): la lista de viajes recientes del
 *    selector (trae el camión de cada viaje);
 *  - el camión ya no existe, se archivó, no coincide con el del viaje o la carga llegó sin camión: la lista de camiones.
 * Si no, el selector seguiría ofreciendo lo viejo y el error se repetiría hasta recargar la página.
 */
function invalidarViajesSiNoExiste(queryClient: QueryClient, tenantId: string, error: Error) {
  if (isForeignKeyViolationOf(error, GASTOS_VIAJE_FK) || mentionsConstraint(error, GASTOS_CAMION_VIAJE)) {
    void queryClient.invalidateQueries({ queryKey: viajesKeys.recientes(tenantId) });
  }
  if ([GASTOS_CAMION_FK, CAMION_ARCHIVADO, GASTOS_CAMION_VIAJE, GASTOS_LITROS_CAMION].some((constraint) => mentionsConstraint(error, constraint))) {
    void queryClient.invalidateQueries({ queryKey: camionesKeys.list(tenantId) });
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
    onSettled: (_resultado, _error, { tenantId }) => invalidarResumen(queryClient, tenantId),
  });
}

export interface CrearGastosVariables {
  tenantId: string;
  /** Un gasto por categoría, cada uno con su `client_ref` (estable entre reintentos: lo guarda quien llama). */
  items: readonly GastoParaGuardar[];
  /** Huellas de lo ya mandado con estos `client_ref` (ver `crearGastos`). Se modifica. */
  sent: Set<string>;
}

/**
 * Cargar VARIOS gastos de una vez (uno por categoría) con `crearGastos`. «Todo o nada» vale solo para el INSERT: va en UN solo pedido
 * (una sola transacción) y quedan todos o ninguno. Los UPDATE de después (cuando entre intentos cambiaron datos y el INSERT chocó con
 * el `client_ref` de un intento anterior que sí llegó) son N pedidos seguidos, uno por gasto, y NO son atómicos: si uno falla quedan
 * algunos actualizados y otros no, y el reintento los vuelve a actualizar a todos hasta que convergen. Mismas invalidaciones que
 * `useCrearGasto`; el reintento manual con los mismos `client_ref` es seguro porque `crearGastos` es idempotente.
 */
export function useCrearGastos() {
  const queryClient = useQueryClient();
  return useMutation<CrearGastosResultado, Error, CrearGastosVariables>({
    mutationFn: ({ items, sent }) => crearGastos({ items, sent, io: gastoLoteWriteIO }),
    onSuccess: (_resultado, { tenantId }) => {
      void queryClient.invalidateQueries({ queryKey: gastosKeys.all(tenantId) });
    },
    onError: (error, { tenantId }) => invalidarViajesSiNoExiste(queryClient, tenantId, error),
    onSettled: (_resultado, _error, { tenantId }) => invalidarResumen(queryClient, tenantId),
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
    onSettled: (_resultado, _error, { tenantId }) => invalidarResumen(queryClient, tenantId),
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
    onSettled: (_borradas, _error, { tenantId }) => invalidarResumen(queryClient, tenantId),
  });
}

/**
 * Sumar y quitar gastos de un viaje (`useVincularGastos`, `useQuitarGastosDelViaje`). Mismas reglas de arriba (sin `retry` ni
 * `networkMode`, el `tenantId` en las variables, el Resumen en `onSettled`) y además:
 *  - `onSettled` invalida `gastosKeys.all`, también si la mutación falla: eso cubre la lista de gastos SUELTOS que ofrece la
 *    pantalla de sumar, los gastos del viaje, la lista de cada mes y el detalle. A diferencia de las demás mutaciones de este
 *    archivo (que invalidan solo en `onSuccess`, porque su lista no está a la vista), acá la lista de candidatos SÍ está a la vista
 *    cuando termina la mutación. Con un timeout o una señal que se corta, la escritura pudo aplicarse igual: sin refrescar, la lista
 *    seguiría ofreciendo como candidatos gastos que ya se sumaron (o, al quitar, sin los que ya quedaron sueltos). Refrescar de más
 *    (por ejemplo si la base rechazó el pedido) solo cuesta una lectura. Igual que el Resumen, no se espera (`void`): la mutación
 *    no queda colgada mientras la lista se vuelve a pedir.
 *  - REINTENTAR (manual: no hay reintento automático) reenvía la MISMA selección y es seguro, porque la función de la base es
 *    idempotente. Lo que NO es seguro es reenviar una selección VIEJA después de un «Quitar» (o al revés): volvería a sumar lo que
 *    se quitó. Por eso la pantalla de «Sumar» tiene que mandar SIEMPRE la selección de AHORA, y nunca guardar una lista para
 *    reenviarla sola más tarde.
 *  - `scope` compartido: sumar y quitar corren de a UNO, en el orden en que se pidieron. Así un «Quitar» que se toca mientras un
 *    «Sumar» sigue en camino (mala señal) no puede llegar a la base antes que él y quedar deshecho. Cubre lo que está en vuelo en
 *    esta pestaña; entre dos dispositivos no hay orden posible desde acá.
 *  - El scope se exporta (`SCOPE_DE_VINCULOS`) para que `useVinculosEnCurso` (la pantalla de sumar) cuente las mutaciones de ESTE
 *    scope sin repetir su id a mano: el id vive en un solo lugar.
 */
export const SCOPE_DE_VINCULOS = { id: 'vincular-gastos' } as const;

export interface VincularGastosVariables {
  tenantId: string;
  viajeId: string;
  /** La selección de AHORA, entre 1 y `MAX_GASTOS_POR_VEZ` (sin repetidos: se juntan antes de mandar). */
  gastoIds: readonly string[];
}

/**
 * Suma los gastos sueltos elegidos a un viaje. Devuelve qué pasó con cada uno (`vinculado`, `ya_estaba`, `en_otro_viaje`,
 * `camion_distinto`, `no_encontrado` o `no_se_pudo`): que algunos no se sumen NO es un error de la mutación, es parte del resultado
 * y la pantalla lo cuenta con `resumirResultados`. Es un error de la mutación lo que rechaza la base (viaje inexistente, sin
 * permiso, cuenta en solo lectura) o la red.
 */
export function useVincularGastos() {
  const queryClient = useQueryClient();
  return useMutation<ResultadoDeGasto[], Error, VincularGastosVariables>({
    scope: SCOPE_DE_VINCULOS,
    mutationFn: ({ viajeId, gastoIds }) => vincularGastosAViaje(viajeId, gastoIds),
    onSettled: (_resultados, _error, { tenantId }) => {
      void queryClient.invalidateQueries({ queryKey: gastosKeys.all(tenantId) });
      invalidarResumen(queryClient, tenantId);
    },
  });
}

export interface QuitarGastosDelViajeVariables {
  tenantId: string;
  viajeId: string;
  /** Los gastos a dejar sin viaje, entre 1 y `MAX_GASTOS_POR_VEZ`. Solo se quitan los que sean de ESTE viaje. */
  gastoIds: readonly string[];
}

/** Quita gastos de un viaje (quedan sin viaje, no se borran). Devuelve los ids que REALMENTE se quitaron; que sean menos, o ninguno, no es un error. */
export function useQuitarGastosDelViaje() {
  const queryClient = useQueryClient();
  return useMutation<string[], Error, QuitarGastosDelViajeVariables>({
    scope: SCOPE_DE_VINCULOS,
    mutationFn: ({ viajeId, gastoIds }) => quitarGastosDelViaje(viajeId, gastoIds),
    onSettled: (_quitados, _error, { tenantId }) => {
      void queryClient.invalidateQueries({ queryKey: gastosKeys.all(tenantId) });
      invalidarResumen(queryClient, tenantId);
    },
  });
}
