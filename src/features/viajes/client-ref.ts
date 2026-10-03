import { generateUuid } from '@/lib/uuid';

/**
 * Idempotencia de los reintentos al CREAR un viaje (migración 007). Mismo problema y misma idea que en
 * Gastos (`features/gastos/client-ref.ts`): con mala señal, el alta puede llegar a la base y perderse la
 * respuesta; sin una clave, "Reintentar" duplicaría el viaje. El formulario genera un uuid (`client_ref`)
 * al abrirse, lo manda en `crear_viaje_con_entregas` y lo mantiene IGUAL en cada reintento.
 *
 * Diferencia con Gastos: acá NO se interpreta un error 23505. `crear_viaje_con_entregas` es idempotente
 * por dentro: si el `client_ref` ya existe en el propio tenant devuelve `{ viaje_id, creado: false }` en
 * vez de fallar (ver `crearViaje` en viaje-save.ts). Desde `crear` nunca sale un 23505.
 *
 * Hay que regenerarlo tras guardar bien: con un `client_ref` reusado para OTRO viaje, la función devolvería
 * el viaje viejo con `creado = false` y el viaje nuevo no se guardaría.
 */

/** Un `client_ref` nuevo (uuid v4). Una vez al abrir el formulario de alta; otra tras guardar bien. */
export function generateClientRef(): string {
  return generateUuid();
}
