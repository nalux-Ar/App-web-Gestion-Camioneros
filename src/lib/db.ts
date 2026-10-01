import type { PostgrestSingleResponse } from '@supabase/supabase-js';

import { DataRequestError } from './data-errors';
import type { Database, Enums, Tables, TablesInsert, TablesUpdate } from './database.types';

/**
 * Alias cómodos sobre `database.types.ts` (archivo generado: no se edita a
 * mano, se regenera cuando cambia el esquema) y helpers para armar lo que se
 * le manda a la base.
 */

// Filas (lo que devuelve un SELECT)
export type Gasto = Tables<'gastos'>;
export type Viaje = Tables<'viajes'>;
export type Cliente = Tables<'clientes'>;
export type Entrega = Tables<'entregas'>;
export type Devolucion = Tables<'devoluciones'>;
export type CategoriaGasto = Tables<'categorias_gasto'>;
export type Camion = Tables<'camiones'>;

// Enums
export type MetodoPago = Enums<'metodo_pago'>;
export type MotivoDevolucion = Enums<'motivo_devolucion'>;

/** Tablas de negocio (las que el front crea/edita con insertPayload/updatePayload).
 *  `miembros` y `transportistas` quedan afuera a propósito: no se insertan
 *  desde el cliente (solo vía `create_transportista`) y de `miembros` solo se
 *  edita `tema`/`color_acento` por su propio camino. */
type BusinessTable = Exclude<keyof Database['public']['Tables'], 'miembros' | 'transportistas'>;

/** Columnas que completa la base y el cliente nunca manda. */
const SERVER_MANAGED_COLUMNS = ['id', 'transportista_id', 'created_at', 'updated_at'] as const;
type ServerManagedColumn = (typeof SERVER_MANAGED_COLUMNS)[number];

/** Datos para CREAR: el Insert generado, sin `id`, `transportista_id` ni timestamps. */
export type NewRow<T extends BusinessTable> = Omit<TablesInsert<T>, ServerManagedColumn>;

/** Datos para EDITAR: el Update generado, sin `id`, `transportista_id` ni timestamps. */
export type RowChanges<T extends BusinessTable> = Omit<TablesUpdate<T>, ServerManagedColumn>;

function withoutServerManaged<V extends object>(values: V): V {
  return Object.fromEntries(
    Object.entries(values).filter(([key]) => !(SERVER_MANAGED_COLUMNS as readonly string[]).includes(key)),
  ) as V;
}

/**
 * Payload para `.insert(...)`. Regla de seguridad del proyecto: el cliente
 * NUNCA manda `transportista_id` ni `id` (un trigger BEFORE INSERT los pisa
 * con `get_mi_transportista_id()` y `gen_random_uuid()`). El tipo `NewRow` ya
 * no los acepta, y además acá se quitan en runtime por si alguien arma el
 * objeto con un spread de una fila leída (`{ ...gasto, monto }`).
 *
 * El único cast del proyecto: los tipos generados marcan `transportista_id`
 * como obligatorio en Insert aunque lo complete la base.
 *
 *   await supabase.from('gastos').insert(insertPayload<'gastos'>({ categoria_id, monto, fecha }))
 */
export function insertPayload<T extends BusinessTable>(values: NewRow<T>): TablesInsert<T> {
  return withoutServerManaged(values) as unknown as TablesInsert<T>;
}

/**
 * Payload para `.update(...)`. Las ediciones van SIEMPRE por UPDATE con
 * `.eq('id', id)` (nunca upsert por id: la base es la dueña de los ids). Quita
 * `id`, `transportista_id` y timestamps aunque vengan en el objeto.
 *
 *   await supabase.from('gastos').update(updatePayload<'gastos'>({ monto })).eq('id', id).select()
 */
export function updatePayload<T extends BusinessTable>(values: RowChanges<T>): TablesUpdate<T> {
  return withoutServerManaged(values) as TablesUpdate<T>;
}

// ---------------------------------------------------------------------------
// Resultados de consultas y cancelación / timeouts
// ---------------------------------------------------------------------------

/**
 * Convierte el `{ data, error, status }` de supabase-js en "devuelve los datos
 * o TIRA". Una `queryFn`/`mutationFn` que devuelve `{ data, error }` tal cual
 * haría que TanStack lo guarde como ÉXITO (la consulta "salió bien" aunque
 * falló: sin reintento ni `isError`, el error queda adentro de los datos).
 * También copia el `status` HTTP, que el `error` de supabase-js no trae y que
 * `mapDataError` necesita para reconocer un 502/504 de gateway.
 *
 * Con `maybeSingle()` el tipo es `Fila | null` (0 filas no es un error); con
 * listas es `Fila[]`.
 *
 *   queryFn: async ({ signal }) =>
 *     unwrap(await supabase.from('gastos').select('*').gte('fecha', desde).lt('fecha', hasta).abortSignal(signal)),
 */
export function unwrap<T>(result: PostgrestSingleResponse<T>): T {
  if (result.error !== null) throw new DataRequestError(result.error, result.status);
  return result.data;
}

/**
 * Cancelación y timeouts de los pedidos a la base. TanStack cancela una query
 * (`queryClient.clear()` al cerrar sesión, salir de la pantalla) pero el
 * pedido HTTP sigue hasta terminar si no se le pasa la señal:
 *
 *  - LECTURAS: pasar la `signal` que TanStack da a la `queryFn` con
 *    `.abortSignal(signal)` (ejemplo de `unwrap` arriba). Así un logout o un
 *    cambio de pantalla corta el pedido de verdad.
 *  - ESCRITURAS: `.abortSignal(writeTimeoutSignal())`. Sin timeout, con señal
 *    mala el botón "Guardando…" puede quedar colgado minutos. El aborto llega
 *    a `mapDataError` como `timeout` ("Tardó demasiado en responder…"), que
 *    es reintentable.
 *
 *      await supabase.from('gastos').insert(insertPayload<'gastos'>(values))
 *        .select().abortSignal(writeTimeoutSignal())
 *
 * OJO: un timeout de ESCRITURA es el caso "respuesta perdida": el pedido pudo
 * haber llegado al servidor y guardarse igual. "Reintentar" puede duplicar el
 * registro. La idempotencia (columna `client_ref` UNIQUE por tenant) se cierra
 * en la Etapa 1, no acá.
 */
export const WRITE_TIMEOUT_MS = 20_000;

/** Señal que aborta sola pasado el tiempo. `AbortSignal.timeout` no existe en
 *  iOS/Safari < 16: ahí se arma a mano con un `AbortController`. */
export function writeTimeoutSignal(timeoutMs: number = WRITE_TIMEOUT_MS): AbortSignal {
  if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(timeoutMs);
  const controller = new AbortController();
  setTimeout(() => controller.abort(new DOMException('signal timed out', 'TimeoutError')), timeoutMs);
  return controller.signal;
}
