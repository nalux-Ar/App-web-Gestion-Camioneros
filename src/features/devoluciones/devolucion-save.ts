import { isClientRefDuplicate } from '@/features/gastos/client-ref';
import type { NewRow, RowChanges } from '@/lib/db';
import { DEVOLUCIONES_CLIENT_REF_CONSTRAINT } from './constants';
import { buildInsertRow, fingerprintOf, type DevolucionColumns } from './devolucion-form';

/**
 * Guardar una devolución NUEVA con idempotencia (`client_ref`, migración 008). Lógica pura: la escritura real se
 * inyecta (`io`), así se puede probar sin Supabase. Es el mismo patrón que `crearGasto`
 * (src/features/gastos/gasto-save.ts): con mala señal el INSERT puede llegar a la base y perderse la respuesta; sin
 * esto, "Reintentar" duplicaría la devolución.
 */

export interface DevolucionWriteIO {
  /** INSERT. Tira el error si falla (con el `code` y el mensaje de PostgREST). */
  insert(row: NewRow<'devoluciones'>): Promise<void>;
  /** UPDATE ... WHERE client_ref = ?. Tira `RecordNotFoundError` si no afectó ninguna fila.
   *  NUNCA debe mandar `client_ref` (es inmutable: el trigger rechaza el cambio con 42501) ni `viaje_id`
   *  (una devolución no se mueve a otro viaje). */
  updateByClientRef(clientRef: string, changes: RowChanges<'devoluciones'>): Promise<void>;
}

/**
 * - `creado`: el INSERT salió bien.
 * - `ya-guardado`: el INSERT dio "ya existe ese client_ref" y lo que se mandó antes es lo mismo que hay en
 *   pantalla: la devolución ya estaba guardada tal cual. Éxito, no error.
 * - `ya-guardado-actualizado`: ya existía, pero el usuario cambió datos entre intentos: se actualizó con lo que hay
 *   en pantalla.
 */
export type CrearDevolucionResultado = 'creado' | 'ya-guardado' | 'ya-guardado-actualizado';

interface CrearDevolucionArgs {
  /** El viaje (de la URL, ya validado como uuid). */
  viajeId: string;
  columns: DevolucionColumns;
  clientRef: string;
  /**
   * Huellas de TODO lo que se mandó a la base con este `clientRef` (INSERT o UPDATE), aunque no se haya confirmado:
   * un pedido sin respuesta pudo haberse aplicado. Vive mientras vive el formulario y se vacía al regenerar el
   * `clientRef`. Esta función la modifica.
   */
  sent: Set<string>;
  io: DevolucionWriteIO;
}

/**
 * INSERT con `client_ref`. Si la base dice que ese `client_ref` ya existe (23505 del índice único), la devolución YA
 * está guardada:
 *
 *  - si lo único que se mandó hasta ahora (en todos los intentos) es lo mismo que hay en pantalla, no hace falta
 *    nada más;
 *  - si en algún intento se mandó otra cosa (el usuario cambió datos entre intentos), la fila guardada puede tener
 *    esos datos viejos: se hace un UPDATE por `client_ref` con lo actual. Es conservador a propósito: si ese UPDATE
 *    falla (red), el próximo reintento vuelve a actualizar en vez de dar por bueno un estado que no se confirmó.
 *
 * Cualquier otro error (incluido otro 23505, de otro índice) se propaga tal cual. Nunca upsert: el índice es
 * parcial y PostgREST no puede apuntar a un índice parcial en `on_conflict` (42P10).
 */
export async function crearDevolucion({
  viajeId,
  columns,
  clientRef,
  sent,
  io,
}: CrearDevolucionArgs): Promise<CrearDevolucionResultado> {
  const fingerprint = fingerprintOf(viajeId, columns);
  sent.add(fingerprint);

  try {
    await io.insert(buildInsertRow(viajeId, columns, clientRef));
    return 'creado';
  } catch (error) {
    if (!isClientRefDuplicate(error, DEVOLUCIONES_CLIENT_REF_CONSTRAINT)) throw error;
  }

  const sameAsEverythingSent = sent.size === 1 && sent.has(fingerprint);
  if (sameAsEverythingSent) return 'ya-guardado';

  await io.updateByClientRef(clientRef, columns);
  return 'ya-guardado-actualizado';
}
