import { isUuid } from '@/lib/uuid';
import { sanitizeVolverClientes } from './cliente-busqueda';

/**
 * Navegación de Clientes: las rutas (armadas en el código), el "volver al cliente" que viaja a las pantallas de viajes y
 * devoluciones, y los avisos breves de la lista y del detalle. Lógica PURA.
 *
 * Regla de seguridad (la de siempre): el `location.state` NO es de confianza. Del estado se acepta SOLO un uuid
 * (`desdeCliente`), un `search` que `sanitizeVolverClientes` reescribe (`volverCliente`) o un literal de una lista blanca
 * (los avisos). Las rutas se arman acá con el uuid validado; nunca se navega a algo que venga del estado o de la URL.
 */

/** Ruta del detalle de un cliente. Solo se llama con un id ya validado (`isUuid`): un uuid no tiene caracteres especiales. */
export function rutaDelCliente(id: string): string {
  return `/clientes/${id}`;
}

/** Ruta de la edición de un cliente (id ya validado). */
export function rutaEditarCliente(id: string): string {
  return `/clientes/${id}/editar`;
}

// ---------------------------------------------------------------------------
// "Volver al cliente": viaja por las pantallas de un viaje abierto desde el detalle de un cliente
// ---------------------------------------------------------------------------

/** Desde qué cliente se llegó (al detalle de un viaje, a la edición de una devolución…), ya validado. */
export interface DesdeCliente {
  /** uuid en minúsculas. */
  id: string;
  /** `search` de la lista de Clientes ('' o '?q=...'), ya saneado: el detalle del cliente lo necesita para su enlace "Clientes". */
  volver: string;
}

/**
 * Las claves del `state` con las que viaja el cliente: `desdeCliente` (el uuid) y `volverCliente` (la búsqueda de la lista).
 * Sin cliente no agrega NADA (ni claves con `undefined`): el `state` queda exactamente como era antes de existir Clientes.
 */
export function estadoDesdeCliente(cliente: DesdeCliente | null | undefined): { desdeCliente?: string; volverCliente?: string } {
  return cliente ? { desdeCliente: cliente.id, volverCliente: cliente.volver } : {};
}

/** Lee y valida el cliente del `state`: solo un uuid válido cuenta; todo lo demás (rutas, URLs, objetos) da `null`. */
export function leerDesdeCliente(state: unknown): DesdeCliente | null {
  if (typeof state !== 'object' || state === null) return null;
  const { desdeCliente, volverCliente } = state as Record<string, unknown>;
  if (!isUuid(desdeCliente)) return null;
  return { id: desdeCliente.toLowerCase(), volver: sanitizeVolverClientes(volverCliente) };
}

// ---------------------------------------------------------------------------
// Avisos (viajan en `location.state`; lista blanca)
// ---------------------------------------------------------------------------

/** Avisos de la lista de Clientes. */
export type ListaClientesAviso = 'cliente-eliminado';

export const LISTA_CLIENTES_AVISO_MENSAJES: Record<ListaClientesAviso, string> = {
  'cliente-eliminado': 'Cliente eliminado.',
};

const AVISOS_LISTA: readonly ListaClientesAviso[] = ['cliente-eliminado'];

/** Lista blanca explícita (no las claves de un objeto: `'toString'` no pasa). Cualquier otro valor no muestra nada. */
export function leerAvisoListaClientes(state: unknown): ListaClientesAviso | null {
  if (typeof state !== 'object' || state === null) return null;
  const aviso = (state as { aviso?: unknown }).aviso;
  return AVISOS_LISTA.find((permitido) => permitido === aviso) ?? null;
}

/**
 * Avisos del detalle de un cliente: al volver de guardarlo (alta o edición) o de guardar o borrar una devolución abierta
 * desde él. Los de devolución usan el mismo texto que el detalle del viaje.
 */
export type DetalleClienteAviso = 'cliente-guardado' | 'devolucion-guardada' | 'devolucion-eliminada';

export const DETALLE_CLIENTE_AVISO_MENSAJES: Record<DetalleClienteAviso, string> = {
  'cliente-guardado': 'Cliente guardado.',
  'devolucion-guardada': 'Devolución guardada.',
  'devolucion-eliminada': 'Devolución eliminada.',
};

const AVISOS_DETALLE: readonly DetalleClienteAviso[] = ['cliente-guardado', 'devolucion-guardada', 'devolucion-eliminada'];

/** Lista blanca explícita: cualquier otro valor (o un estado que no es un objeto) no muestra nada. */
export function leerAvisoDetalleCliente(state: unknown): DetalleClienteAviso | null {
  if (typeof state !== 'object' || state === null) return null;
  const aviso = (state as { aviso?: unknown }).aviso;
  return AVISOS_DETALLE.find((permitido) => permitido === aviso) ?? null;
}
