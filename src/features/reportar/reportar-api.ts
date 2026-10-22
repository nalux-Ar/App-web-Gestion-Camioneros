import { isClientRefDuplicate } from '@/features/gastos/client-ref';
import { DataRequestError, UserMessageError, type DataErrorContext } from '@/lib/data-errors';
import { writeTimeoutSignal } from '@/lib/db';
import { supabase } from '@/lib/supabase';
import type { ContextoDelReporte } from './contexto';
import { MENSAJE_RECHAZADO, PROBLEMA_DE_LA_APP, TOPE_ALCANZADO } from './reportar-textos';

/**
 * Envío de un reporte de problema a `public.reportes`.
 *
 * La tabla es SOLO-INSERT para las cuentas: no hay SELECT, UPDATE ni DELETE para nadie. Por eso el INSERT va SIN
 * `.select()` (con `.select()`, upsert u `onConflict` la base responde 42501) y el front NUNCA lee la tabla, ni siquiera
 * los reportes propios. Ninguna consulta lee `reportes`: no hay nada que invalidar.
 *
 * Se mandan SOLO cuatro columnas (lista blanca armada acá, nunca un spread): `mensaje`, `pantalla`, `contexto` y
 * `client_ref`. Lo demás (`id`, `created_at`, `transportista_id`, `user_id`, `estado`, `nota`) lo pone la base.
 *
 * Idempotencia (el mismo patrón que gastos, viajes y clientes): el formulario genera un `client_ref` al abrirse y lo
 * repite en cada "Reintentar". Si un intento anterior llegó y se perdió la respuesta, la base contesta 23505 sobre el
 * índice único del `client_ref`: eso es ÉXITO ("ya lo teníamos").
 */

/** El índice único del `client_ref` (migración 016): un 23505 de ESTE índice es "ya estaba guardado". */
export const REPORTES_CLIENT_REF_CONSTRAINT = 'reportes_transportista_client_ref_uidx';

/**
 * El tope anti-spam de la base (el reporte número 31 de un usuario en 24 horas, migración 016) responde el SQLSTATE propio
 * `PT429`, que PostgREST devuelve como HTTP 429. Se reconoce por el CÓDIGO o por el status (no por el texto, que es de la
 * base: la pantalla muestra el suyo).
 */
export const REPORTES_TOPE_SQLSTATE = 'PT429';
export const REPORTES_TOPE_STATUS = 429;

/** Los `check` de la 016. Si alguno salta (no debería: la pantalla valida y recorta antes), un mensaje propio, sin reintento. */
export const REPORTES_MENSAJE_CHECK = 'reportes_mensaje_chk';
export const REPORTES_PANTALLA_CHECK = 'reportes_pantalla_chk';
export const REPORTES_CONTEXTO_CHECK = 'reportes_contexto_chk';

/** Mensajes propios del envío (para `useSubmitFeedback`): por constraint, nunca reintentables. */
export const ENVIAR_REPORTE_CONTEXT: DataErrorContext = {
  messagesByConstraint: {
    [REPORTES_MENSAJE_CHECK]: MENSAJE_RECHAZADO,
    [REPORTES_PANTALLA_CHECK]: PROBLEMA_DE_LA_APP,
    [REPORTES_CONTEXTO_CHECK]: PROBLEMA_DE_LA_APP,
  },
};

/** Las columnas de un reporte que manda el cliente (el resto lo pone la base). */
export type NuevoReporte = {
  mensaje: string;
  /** La última pantalla de trabajo, ya saneada (o null). */
  pantalla: string | null;
  contexto: ContextoDelReporte;
  clientRef: string;
};

/**
 * Inserta el reporte. Resuelve si quedó guardado (también si ya estaba: 23505 del `client_ref`); tira el error si no.
 * El tope de la base se convierte en un `UserMessageError` NO reintentable (con los mismos datos daría lo mismo).
 */
export async function enviarReporte(reporte: NuevoReporte): Promise<void> {
  const { error, status } = await supabase
    .from('reportes')
    .insert({
      mensaje: reporte.mensaje,
      pantalla: reporte.pantalla,
      contexto: reporte.contexto,
      client_ref: reporte.clientRef,
    })
    .abortSignal(writeTimeoutSignal());
  if (error === null) return;
  const falla = new DataRequestError(error, status);
  // Primero el client_ref: un reintento de un reporte que ya llegó da 23505 aunque la persona esté en el tope (es éxito).
  if (isClientRefDuplicate(falla, REPORTES_CLIENT_REF_CONSTRAINT)) return;
  if (falla.code === REPORTES_TOPE_SQLSTATE || falla.status === REPORTES_TOPE_STATUS) {
    throw new UserMessageError(TOPE_ALCANZADO, { retryable: false, cause: falla });
  }
  throw falla;
}
