import { supabase } from '@/lib/supabase';
import { unwrap, writeTimeoutSignal } from '@/lib/db';
import { RecordNotFoundError } from '@/lib/data-errors';
import { isUuid } from '@/lib/uuid';

/**
 * Escritura del camión activo (migración 012). Reglas (src/lib/db.ts):
 *  - ESCRITURA: `.abortSignal(writeTimeoutSignal())` (20 s) y `unwrap()`.
 *  - `miembros` está fuera de `BusinessTable` a propósito: no hay `updatePayload`. Se arma `{ camion_activo_id }` directo y
 *    NADA más: es una de las tres columnas con `grant update` para `authenticated` (con `tema` y `color_acento`); cualquier
 *    otra (`transportista_id`, `rol`, `user_id`…) la rechaza la base con 42501.
 *  - Solo la fila PROPIA: `.eq('user_id', <usuario de la sesión>)`. La policy de 003 limita igual a la fila propia: el
 *    UPDATE de otra fila no falla, afecta 0 filas. Por eso se pide la fila de vuelta (`.select`).
 */

/**
 * Guarda (o quita, con `null`) el camión activo del usuario y devuelve lo que guardó la base (lo que hay que reflejar en
 * pantalla, no lo que se mandó). 0 filas = `RecordNotFoundError`. Es idempotente: reenviar el mismo valor no falla.
 */
export async function guardarCamionActivo(userId: string, camionId: string | null): Promise<string | null> {
  const rows = unwrap(
    await supabase
      .from('miembros')
      .update({ camion_activo_id: camionId })
      .eq('user_id', userId)
      .select('camion_activo_id')
      .abortSignal(writeTimeoutSignal()),
  );
  if (rows.length === 0) throw new RecordNotFoundError();
  const guardado: unknown = rows[0].camion_activo_id;
  return isUuid(guardado) ? guardado.toLowerCase() : null;
}
