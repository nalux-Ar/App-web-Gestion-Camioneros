import { isUuid } from '@/lib/uuid';
import { sanitizeVolver } from './viajes-filters';

/**
 * Navegación entre el DETALLE de un viaje y los formularios que se abren desde él (cargar o editar un gasto de
 * ese viaje, editar el viaje). Lógica pura.
 *
 * Regla de seguridad: el `location.state` NO es de confianza. Nunca se navega a una URL ni a un path que venga del
 * estado o de la URL: del estado se acepta SOLO un uuid (y un `search` que `sanitizeVolver` reescribe), y la ruta
 * se arma acá, en el código (`/viajes/${id}`). Cualquier otra cosa se ignora y la pantalla se comporta como si no
 * viniera del detalle (vuelve a su lista de siempre).
 */

/** Desde qué viaje se abrió la pantalla, ya validado. */
export interface DesdeViaje {
  /** uuid en minúsculas. */
  id: string;
  /** `search` de la lista de viajes ('' o '?mes=...'), ya saneado: el detalle lo necesita para su enlace "Viajes". */
  volver: string;
}

/** El `state` con el que el detalle abre un formulario. Es un dato (un uuid y un `search`), nunca una ruta. */
export function estadoDesdeViaje(id: string, volver: string): { desdeViaje: string; volverViaje: string } {
  return { desdeViaje: id, volverViaje: volver };
}

/** Lee y valida el `state` de navegación: solo un uuid válido cuenta; todo lo demás (rutas, URLs, objetos) da `null`. */
export function leerDesdeViaje(state: unknown): DesdeViaje | null {
  if (typeof state !== 'object' || state === null) return null;
  const { desdeViaje, volverViaje } = state as Record<string, unknown>;
  if (!isUuid(desdeViaje)) return null;
  return { id: desdeViaje.toLowerCase(), volver: sanitizeVolver(volverViaje) };
}

/** La ruta del detalle de un viaje. Solo se llama con un id ya validado (`isUuid`): no se escapa nada porque un
 *  uuid no tiene caracteres especiales. */
export function rutaDelViaje(id: string): string {
  return `/viajes/${id}`;
}

/** Avisos breves que el detalle muestra al volver de guardar o borrar algo (viajan en `location.state`). */
export type DetalleAviso = 'gasto-guardado' | 'gasto-eliminado' | 'viaje-guardado';

export const DETALLE_AVISO_MENSAJES: Record<DetalleAviso, string> = {
  'gasto-guardado': 'Gasto guardado.',
  'gasto-eliminado': 'Gasto eliminado.',
  'viaje-guardado': 'Viaje guardado.',
};

/** Lista blanca: solo estos valores; cualquier otro (o un estado que no es un objeto) no muestra nada. */
export function leerAvisoDetalle(state: unknown): DetalleAviso | null {
  if (typeof state !== 'object' || state === null) return null;
  const aviso = (state as { aviso?: unknown }).aviso;
  return aviso === 'gasto-guardado' || aviso === 'gasto-eliminado' || aviso === 'viaje-guardado' ? aviso : null;
}
