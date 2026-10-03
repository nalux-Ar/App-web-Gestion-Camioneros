import { generateUuid } from '@/lib/uuid';

/**
 * Idempotencia de los reintentos al CREAR un gasto (migración 006).
 *
 * El problema: con mala señal, el INSERT puede llegar a la base y perderse la
 * respuesta. El usuario toca "Reintentar" y, sin esto, quedaría el gasto
 * duplicado. La solución: el formulario genera un uuid (`client_ref`) al
 * abrirse, lo manda en el INSERT y lo mantiene IGUAL en cada reintento; la
 * base tiene un índice único por (transportista, client_ref), así que el
 * segundo INSERT falla con 23505 en vez de duplicar, y ese error se interpreta
 * como "ya estaba guardado" (éxito).
 *
 * No se usa upsert: el índice es PARCIAL (`where client_ref is not null`) y
 * PostgREST no puede apuntar a un índice parcial en `on_conflict` (da 42P10).
 */

/** Índice único que protege el `client_ref` (006_gastos_client_ref.sql). */
export const CLIENT_REF_CONSTRAINT = 'gastos_transportista_client_ref_uidx';

/** Un `client_ref` nuevo (uuid v4). Una vez al abrir el formulario de alta; otra tras guardar bien. */
export function generateClientRef(): string {
  return generateUuid();
}

/**
 * ¿Este error es "ya existe un gasto con este client_ref"? Es 23505 (unique_violation) Y el
 * constraint es el del client_ref. Cualquier OTRO 23505 (otro índice único) es un error normal.
 *
 * `constraint` es el nombre del índice a buscar; por defecto el de gastos. Devoluciones usa el mismo patrón con
 * su propio índice (`devoluciones_transportista_client_ref_uidx`, migración 008) y lo pasa acá: así no se
 * duplica la lógica de leer el error.
 *
 * Qué forma tiene el error: PostgREST responde `{ code: '23505', message:
 * 'duplicate key value violates unique constraint "<constraint>"', details,
 * hint }`; `unwrap()` lo convierte en un `DataRequestError` con `code`,
 * `message` y `details`. Con RLS activo Postgres no pone los valores de la clave
 * en `details`, pero el NOMBRE del constraint va en `message`. Se busca en los tres
 * textos por si alguna versión lo mueve de lugar.
 */
export function isClientRefDuplicate(error: unknown, constraint: string = CLIENT_REF_CONSTRAINT): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const record = error as Record<string, unknown>;
  if (record.code !== '23505') return false;
  return [record.message, record.details, record.hint].some(
    (text) => typeof text === 'string' && text.includes(constraint),
  );
}
