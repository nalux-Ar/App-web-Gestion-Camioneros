import { supabase } from '@/lib/supabase';
import { unwrap, writeTimeoutSignal } from '@/lib/db';
import { RecordNotFoundError } from '@/lib/data-errors';

/**
 * Acceso a datos del nombre de la cuenta. Reglas (src/lib/db.ts):
 *  - ESCRITURAS: `.abortSignal(writeTimeoutSignal())` (20 s) y `unwrap()`.
 *  - `transportistas` está fuera de `BusinessTable` a propósito: no se usa
 *    `updatePayload`. Se arma `{ nombre }` directo, que es la ÚNICA columna con
 *    `grant update` para `authenticated` (el resto de la fila no se puede tocar).
 *  - Permisos reales: solo un miembro `admin` de ese tenant pasa la policy
 *    `transportistas_update_nombre_admin`. Para cualquier otro el UPDATE NO
 *    falla: devuelve 0 filas. Por eso se pide la fila de vuelta (`.select`).
 */

/**
 * 0 filas al actualizar el nombre: no es admin de esa cuenta (o la cuenta ya no
 * existe: la base no distingue, a propósito). Reintentar da lo mismo.
 *
 * Extiende `RecordNotFoundError` para que `classifyDataError` lo reconozca como
 * 'not-found' (no reintentable, nunca "No hay conexión") y `mapDataError` use el
 * mensaje de `GUARDAR_NOMBRE_CONTEXT.notFound`, igual que en Gastos.
 */
export class NombreNoEditableError extends RecordNotFoundError {
  constructor() {
    super();
    this.name = 'NombreNoEditableError';
  }
}

/**
 * Cambia el nombre de la cuenta y devuelve el nombre que guardó la base (lo que
 * hay que mostrar, no lo que se mandó). 0 filas = `NombreNoEditableError`.
 * El UPDATE es idempotente (mismo valor, mismo resultado): reintentarlo es seguro.
 */
export async function actualizarNombreTransportista(transportistaId: string, nombre: string): Promise<string> {
  const rows = unwrap(
    await supabase
      .from('transportistas')
      .update({ nombre })
      .eq('id', transportistaId)
      .select('id, nombre')
      .abortSignal(writeTimeoutSignal()),
  );
  if (rows.length === 0) throw new NombreNoEditableError();
  return rows[0].nombre;
}
