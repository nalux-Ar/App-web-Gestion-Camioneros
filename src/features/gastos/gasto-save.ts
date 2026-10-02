import type { NewRow, RowChanges } from '@/lib/db';
import { isClientRefDuplicate } from './client-ref';
import { buildInsertRow, fingerprintOf, type GastoColumns } from './gasto-form';

/**
 * Guardar un gasto NUEVO con idempotencia (client_ref). Lógica pura: la
 * escritura real se inyecta (`io`), así se puede probar sin Supabase.
 */

export interface GastoWriteIO {
  /** INSERT. Tira el error si falla (con el `code` y el mensaje de PostgREST). */
  insert(row: NewRow<'gastos'>): Promise<void>;
  /** UPDATE ... WHERE client_ref = ?. Tira `RecordNotFoundError` si no afectó ninguna fila.
   *  NUNCA debe mandar `client_ref` (es inmutable: el trigger rechaza el cambio con 42501). */
  updateByClientRef(clientRef: string, changes: RowChanges<'gastos'>): Promise<void>;
}

/**
 * - `creado`: el INSERT salió bien.
 * - `ya-guardado`: el INSERT dio "ya existe ese client_ref" y lo que se mandó antes es lo mismo que hay
 *   en pantalla: el gasto ya estaba guardado tal cual. Éxito, no error.
 * - `ya-guardado-actualizado`: ya existía, pero el usuario cambió datos entre intentos: se actualizó
 *   con lo que hay en pantalla.
 */
export type CrearGastoResultado = 'creado' | 'ya-guardado' | 'ya-guardado-actualizado';

interface CrearGastoArgs {
  columns: GastoColumns;
  clientRef: string;
  /**
   * Huellas de TODO lo que se mandó a la base con este `clientRef` (INSERT o
   * UPDATE), aunque no se haya confirmado: un pedido sin respuesta pudo haberse
   * aplicado. Vive mientras vive el formulario y se vacía al regenerar el
   * `clientRef`. Esta función la modifica.
   */
  sent: Set<string>;
  io: GastoWriteIO;
}

/**
 * INSERT con `client_ref`. Si la base dice que ese `client_ref` ya existe
 * (23505 del índice único), el gasto YA está guardado:
 *
 *  - si lo único que se mandó hasta ahora (en todos los intentos) es lo mismo
 *    que hay en pantalla, no hace falta nada más;
 *  - si en algún intento se mandó otra cosa (el usuario cambió datos entre
 *    intentos), la fila guardada puede tener esos datos viejos: se hace un
 *    UPDATE por `client_ref` con lo actual. Es conservador a propósito: si ese
 *    UPDATE falla (red), el próximo reintento vuelve a actualizar en vez de
 *    dar por bueno un estado que no se confirmó.
 *
 * Cualquier otro error (incluido otro 23505) se propaga tal cual.
 */
export async function crearGasto({ columns, clientRef, sent, io }: CrearGastoArgs): Promise<CrearGastoResultado> {
  const fingerprint = fingerprintOf(columns);
  sent.add(fingerprint);

  try {
    await io.insert(buildInsertRow(columns, clientRef));
    return 'creado';
  } catch (error) {
    if (!isClientRefDuplicate(error)) throw error;
  }

  const sameAsEverythingSent = sent.size === 1 && sent.has(fingerprint);
  if (sameAsEverythingSent) return 'ya-guardado';

  await io.updateByClientRef(clientRef, columns);
  return 'ya-guardado-actualizado';
}
