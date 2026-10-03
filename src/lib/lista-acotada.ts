/**
 * Listas con tope. Las pantallas piden `limite + 1` filas: si vino una de más, había más que mostrar
 * y la lista (y cualquier total que se calcule sobre ella) es PARCIAL. Así no hace falta una consulta
 * de conteo aparte.
 */

export interface ListaAcotada<T> {
  items: T[];
  /** true si había más filas que el tope: la lista y sus totales son parciales. */
  truncado: boolean;
}

/** Recorta al tope y marca `truncado` si la consulta trajo una fila de más (`limite + 1`). */
export function acotarLista<T>(rows: readonly T[], limite: number): ListaAcotada<T> {
  return rows.length > limite ? { items: rows.slice(0, limite), truncado: true } : { items: [...rows], truncado: false };
}
