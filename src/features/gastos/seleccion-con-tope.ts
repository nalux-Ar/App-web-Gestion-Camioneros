import { alternarMarca } from './sumar-gastos-seleccion';

/**
 * Lógica pura de una selección de gastos con TOPE: como mucho `tope` marcados a la vez. La necesita «Quitar gastos del viaje»,
 * donde la lista puede traer hasta `LIST_LIMIT` (500) gastos pero la capa de datos solo acepta `MAX_GASTOS_POR_VEZ` (100) por
 * pedido (en «Sumar» la lista ya viene recortada a ese tope y no hace falta). Sin React ni base. Completa a
 * `sumar-gastos-seleccion.ts` (que no se toca): usa sus mismas piezas (`alternarMarca`) y agrega solo lo del tope.
 *
 * `tope` es un entero mayor o igual a 0; si no, tira `RangeError` (un `slice` con un negativo cortaría de más sin avisar).
 */

function asegurarTope(tope: number): void {
  if (!Number.isInteger(tope) || tope < 0) throw new RangeError('El tope tiene que ser un número entero mayor o igual a 0.');
}

/**
 * Marca el gasto si hay lugar y lo desmarca si estaba marcado. Si el gasto está SIN marcar y ya hay `tope` marcados, no hay lugar:
 * devuelve el MISMO conjunto (la misma referencia: guardarlo en un estado de React no provoca un dibujo de más). Pensada para
 * usarse en una actualización de estado con función (`setGuardados((previos) => …)`): así el tope se mide contra lo marcado de
 * ESE momento y no contra el de un dibujo anterior, y dos toques seguidos no pueden pasarlo.
 */
export function alternarMarcaConTope(marcados: ReadonlySet<string>, id: string, tope: number): ReadonlySet<string> {
  asegurarTope(tope);
  if (!marcados.has(id) && marcados.size >= tope) return marcados;
  return alternarMarca(marcados, id);
}

/**
 * Lo que marca «Marcar todos»: los primeros `tope` de la lista, en su orden (con una lista más corta que el tope, todos). Es la
 * selección ENTERA (reemplaza a la anterior), no un agregado a lo ya marcado: así el rótulo «Marcar los primeros 100» es siempre
 * verdad. Con una lista de hasta `tope` gastos es lo mismo que marcar todos, como en «Sumar».
 */
export function primerosParaMarcar(vigentes: readonly string[], tope: number): ReadonlySet<string> {
  asegurarTope(tope);
  return new Set(vigentes.slice(0, tope));
}

/**
 * ¿Está marcado TODO lo que se puede marcar? Es todo lo de la lista, o `tope` si la lista es más larga. Con la lista vacía, no
 * (no hay nada que estar marcado). Decide si el botón dice «Marcar todos» o «Desmarcar todos».
 */
export function todoLoMarcableEstaMarcado(cantidadMarcados: number, cantidadEnLista: number, tope: number): boolean {
  asegurarTope(tope);
  return cantidadEnLista > 0 && cantidadMarcados >= Math.min(cantidadEnLista, tope);
}

/**
 * ¿Se llegó al tope y todavía quedan gastos SIN marcar? Entonces esos ya no se pueden marcar (las casillas se apagan y se avisa).
 * Con la lista justo del tamaño del tope y toda marcada no hay nada que apagar: da `false`.
 */
export function sinCupoParaMarcar(cantidadMarcados: number, cantidadEnLista: number, tope: number): boolean {
  asegurarTope(tope);
  return cantidadMarcados >= tope && cantidadEnLista > cantidadMarcados;
}
