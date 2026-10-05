import {
  estadoDesdeCliente,
  leerDesdeCliente,
  rutaDelCliente,
  type DesdeCliente,
} from '@/features/clientes/cliente-navegacion';
import { isUuid } from '@/lib/uuid';
import { AVISO_MENSAJES, type ViajeAviso } from './constants';
import { sanitizeVolver, searchEnVista } from './viajes-filters';

/**
 * Navegación entre el DETALLE de un viaje y los formularios que se abren desde él (cargar o editar un gasto de
 * ese viaje, editar el viaje, cargar o editar una devolución), y entre la lista de Devoluciones de `/viajes` (o el
 * detalle de un cliente) y la edición de una devolución. Lógica pura.
 *
 * Los gastos y la edición del viaje reciben el viaje en el `state` (`estadoDesdeViaje` / `leerDesdeViaje`). Las
 * devoluciones NO lo necesitan: llevan el viaje en la URL (`/viajes/:viajeId/devoluciones/...`) y del `state` solo
 * toman el `volver` (el mes y la pestaña de la lista, saneados) y, desde la lista de Devoluciones o desde el detalle de un
 * cliente, el origen (`leerOrigenDevolucion`); sus rutas se arman acá (`rutaNuevaDevolucion`, `rutaEditarDevolucion`).
 *
 * "Volver al cliente": si el detalle del viaje se abrió desde el detalle de un cliente, el cliente viaja en el `state`
 * (`desdeCliente` + `volverCliente`, ver `estadoDesdeCliente` en src/features/clientes/cliente-navegacion.ts) y pasa por
 * todas las pantallas que se abren desde ese detalle (editar el viaje, cargar o editar un gasto o una devolución), que lo
 * devuelven al volver. Así el enlace de volver del detalle sigue diciendo "Cliente" después de editar algo.
 *
 * Regla de seguridad: el `location.state` NO es de confianza. Nunca se navega a una URL ni a un path que venga del
 * estado o de la URL: del estado se acepta SOLO un uuid (y un `search` que `sanitizeVolver` reescribe) o un literal de
 * una lista blanca, y la ruta se arma acá, en el código (`/viajes/${id}`). Cualquier otra cosa se ignora y la
 * pantalla se comporta como si no viniera de ahí (vuelve a su lista de siempre).
 */

/** Desde qué viaje se abrió la pantalla, ya validado. */
export interface DesdeViaje {
  /** uuid en minúsculas. */
  id: string;
  /** `search` de la lista de viajes ('' o '?mes=...'), ya saneado: el detalle lo necesita para su enlace "Viajes". */
  volver: string;
  /** Si el detalle del viaje se abrió desde el detalle de un cliente: ese cliente (ya validado). Si no, no viene. */
  cliente?: DesdeCliente;
}

/**
 * El `state` con el que el detalle abre un formulario. Es un dato (un uuid y un `search`, y el cliente si el detalle se abrió
 * desde uno), nunca una ruta. Sin cliente no agrega claves: queda igual que antes de existir Clientes.
 */
export function estadoDesdeViaje(
  id: string,
  volver: string,
  cliente?: DesdeCliente | null,
): { desdeViaje: string; volverViaje: string; desdeCliente?: string; volverCliente?: string } {
  return { desdeViaje: id, volverViaje: volver, ...estadoDesdeCliente(cliente) };
}

/** Lee y valida el `state` de navegación: solo un uuid válido cuenta; todo lo demás (rutas, URLs, objetos) da `null`. */
export function leerDesdeViaje(state: unknown): DesdeViaje | null {
  if (typeof state !== 'object' || state === null) return null;
  const { desdeViaje, volverViaje } = state as Record<string, unknown>;
  if (!isUuid(desdeViaje)) return null;
  const cliente = leerDesdeCliente(state);
  const leido: DesdeViaje = { id: desdeViaje.toLowerCase(), volver: sanitizeVolver(volverViaje) };
  return cliente ? { ...leido, cliente } : leido;
}

/** La ruta del detalle de un viaje. Solo se llama con un id ya validado (`isUuid`): no se escapa nada porque un
 *  uuid no tiene caracteres especiales. */
export function rutaDelViaje(id: string): string {
  return `/viajes/${id}`;
}

/** Ruta de "Cargar devolución" de un viaje. Solo se llama con un id ya validado (`isUuid`): se arma acá, en el código. */
export function rutaNuevaDevolucion(viajeId: string): string {
  return `/viajes/${viajeId}/devoluciones/nueva`;
}

/** Ruta de la edición de una devolución de un viaje. Los dos ids ya validados (`isUuid`); se arma acá, en el código. */
export function rutaEditarDevolucion(viajeId: string, devolucionId: string): string {
  return `/viajes/${viajeId}/devoluciones/${devolucionId}/editar`;
}

/** Avisos breves que el detalle muestra al volver de guardar o borrar algo (viajan en `location.state`). */
export type DetalleAviso =
  | 'gasto-guardado'
  | 'gasto-eliminado'
  | 'viaje-guardado'
  | 'devolucion-guardada'
  | 'devolucion-eliminada';

export const DETALLE_AVISO_MENSAJES: Record<DetalleAviso, string> = {
  'gasto-guardado': 'Gasto guardado.',
  'gasto-eliminado': 'Gasto eliminado.',
  'viaje-guardado': 'Viaje guardado.',
  'devolucion-guardada': 'Devolución guardada.',
  'devolucion-eliminada': 'Devolución eliminada.',
};

/** Lista blanca explícita (no las claves de un objeto: `'toString'` no pasa). */
const AVISOS_DETALLE: readonly DetalleAviso[] = [
  'gasto-guardado',
  'gasto-eliminado',
  'viaje-guardado',
  'devolucion-guardada',
  'devolucion-eliminada',
];

/** Lista blanca: solo estos valores; cualquier otro (o un estado que no es un objeto) no muestra nada. */
export function leerAvisoDetalle(state: unknown): DetalleAviso | null {
  if (typeof state !== 'object' || state === null) return null;
  const aviso = (state as { aviso?: unknown }).aviso;
  return AVISOS_DETALLE.find((permitido) => permitido === aviso) ?? null;
}

/** Los avisos de devolución, que llegan al detalle del viaje o a la lista de Devoluciones según de dónde se abrió la edición. */
export type AvisoDevolucion = Extract<DetalleAviso, 'devolucion-guardada' | 'devolucion-eliminada'>;

/**
 * Avisos que la LISTA de `/viajes` muestra al volver: los de viaje (`guardado` / `eliminado`, desde el formulario del viaje)
 * y los de devolución (desde la edición abierta desde la pestaña Devoluciones). Los textos de los de devolución son los
 * mismos que muestra el detalle del viaje.
 */
export type ListaAviso = ViajeAviso | AvisoDevolucion;

export const LISTA_AVISO_MENSAJES: Record<ListaAviso, string> = {
  ...AVISO_MENSAJES,
  'devolucion-guardada': DETALLE_AVISO_MENSAJES['devolucion-guardada'],
  'devolucion-eliminada': DETALLE_AVISO_MENSAJES['devolucion-eliminada'],
};

const AVISOS_LISTA: readonly ListaAviso[] = ['guardado', 'eliminado', 'devolucion-guardada', 'devolucion-eliminada'];

/** Lista blanca: solo estos valores; cualquier otro (o un estado que no es un objeto) no muestra nada. */
export function leerAvisoLista(state: unknown): ListaAviso | null {
  if (typeof state !== 'object' || state === null) return null;
  const aviso = (state as { aviso?: unknown }).aviso;
  return AVISOS_LISTA.find((permitido) => permitido === aviso) ?? null;
}

// ---------------------------------------------------------------------------
// Edición de una devolución abierta desde la lista de Devoluciones o desde el detalle de un cliente
// ---------------------------------------------------------------------------

/**
 * De dónde se abrió la edición de una devolución. Marca de ORIGEN explícita en el `location.state`, de lista blanca:
 *  - `lista-devoluciones`: la pone SOLO el enlace de la fila de la pestaña Devoluciones de `/viajes`; guardar o borrar
 *    vuelve a esa lista.
 *  - `cliente`: la pone SOLO el enlace de la fila de devoluciones del detalle de un cliente, junto con el cliente
 *    (`desdeCliente`, un uuid); guardar o borrar vuelve al detalle de ESE cliente. Sin un cliente válido en el mismo
 *    `state`, la marca no cuenta.
 * Sin marca, se vuelve al detalle del viaje, como siempre.
 *
 * El `volver` NO alcanza como señal: la edición también se abre desde el detalle del viaje, que a su vez puede haberse
 * abierto desde esa pestaña (su `volver` trae `vista=devoluciones`) o desde un cliente (trae `desdeCliente`), y ahí
 * corresponde volver al detalle del viaje. Por eso el origen es un literal propio y no se deduce de lo que traiga el estado.
 */
export const ORIGEN_LISTA_DEVOLUCIONES = 'lista-devoluciones';
export const ORIGEN_CLIENTE = 'cliente';
export type OrigenDevolucion = typeof ORIGEN_LISTA_DEVOLUCIONES | typeof ORIGEN_CLIENTE;

/** Lista blanca explícita: cualquier otro valor (o un estado que no es un objeto) no es un origen. */
const ORIGENES_DEVOLUCION: readonly OrigenDevolucion[] = [ORIGEN_LISTA_DEVOLUCIONES, ORIGEN_CLIENTE];

/** El `state` con el que la fila de la lista abre la edición de una devolución: el mes y la pestaña (`volver`) y el origen. Datos, nunca una ruta. */
export function estadoEditarDesdeLista(volver: string): { volver: string; origen: OrigenDevolucion } {
  return { volver, origen: ORIGEN_LISTA_DEVOLUCIONES };
}

/**
 * El `state` con el que el detalle de un cliente abre la edición de una de sus devoluciones: el origen y el cliente (su uuid
 * y la búsqueda de la lista de Clientes). Datos, nunca una ruta.
 */
export function estadoEditarDesdeCliente(cliente: DesdeCliente): {
  origen: OrigenDevolucion;
  desdeCliente?: string;
  volverCliente?: string;
} {
  return { origen: ORIGEN_CLIENTE, ...estadoDesdeCliente(cliente) };
}

/**
 * Lee el origen del `state` de navegación: solo un literal de la lista blanca cuenta; todo lo demás da `null`. El origen
 * `cliente` además exige un cliente válido (`leerDesdeCliente`) en el mismo `state`: sin él no habría a dónde volver.
 */
export function leerOrigenDevolucion(state: unknown): OrigenDevolucion | null {
  if (typeof state !== 'object' || state === null) return null;
  const origen = (state as { origen?: unknown }).origen;
  const leido = ORIGENES_DEVOLUCION.find((permitido) => permitido === origen) ?? null;
  if (leido === ORIGEN_CLIENTE && leerDesdeCliente(state) === null) return null;
  return leido;
}

/**
 * La ruta de la pestaña Devoluciones de la lista, en el mes del `volver` (saneado). Se arma acá: la pestaña la fija el
 * código (`searchEnVista`), no el texto que traiga el estado.
 */
export function rutaListaDevoluciones(volver: unknown): string {
  return `/viajes${searchEnVista(volver, 'devoluciones')}`;
}

/** A dónde se vuelve tras guardar o borrar una devolución, con el `state` que lleva. */
export interface DestinoDevolucion {
  to: string;
  state: { aviso: AvisoDevolucion; volver?: string; desdeCliente?: string; volverCliente?: string };
}

/**
 * Destino tras guardar o borrar una devolución:
 *  - abierta desde la lista de Devoluciones (origen): a esa lista (misma pestaña y mismo mes) con el aviso;
 *  - abierta desde el detalle de un cliente (origen `cliente` + el cliente): al detalle de ESE cliente, con el aviso y la
 *    búsqueda de la lista de Clientes. Riesgo conocido y aceptado: si la persona cambió el cliente de la devolución, vuelve
 *    al cliente ANTERIOR (desde donde la abrió), donde la devolución ya no aparece;
 *  - si no, al detalle del viaje, como siempre (con el cliente, si el detalle del viaje se había abierto desde uno: así su
 *    enlace de volver sigue diciendo "Cliente").
 * `viajeId` es un uuid ya validado; `volver` y `cliente` ya están saneados. Todo se arma acá, nada viene del estado ni de la URL.
 */
export function destinoTrasDevolucion(args: {
  viajeId: string;
  volver: string;
  origen: OrigenDevolucion | null;
  aviso: AvisoDevolucion;
  cliente?: DesdeCliente | null;
}): DestinoDevolucion {
  const { viajeId, volver, origen, aviso, cliente = null } = args;
  // La lista arma su `volver` desde la URL: el estado solo lleva el aviso.
  if (origen === ORIGEN_LISTA_DEVOLUCIONES) return { to: rutaListaDevoluciones(volver), state: { aviso } };
  if (origen === ORIGEN_CLIENTE && cliente !== null) {
    return { to: rutaDelCliente(cliente.id), state: { aviso, volver: cliente.volver } };
  }
  return { to: rutaDelViaje(viajeId), state: { aviso, volver, ...estadoDesdeCliente(cliente) } };
}
