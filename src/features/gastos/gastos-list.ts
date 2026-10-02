import { fromDbNumber } from '@/lib/numbers';
import { LIST_LIMIT } from './constants';

/** Lógica pura de la lista de gastos: total y recorte al tope. */

/** Suma de montos en CENTAVOS enteros (sin acumular error de coma flotante: 0,1 + 0,2 no da 0,30000000000000004). */
export function sumMontos(rows: ReadonlyArray<{ monto: number | string }>): number {
  let cents = 0;
  for (const row of rows) {
    const monto = fromDbNumber(row.monto);
    if (monto !== null) cents += Math.round(monto * 100);
  }
  return cents / 100;
}

export interface ListaAcotada<T> {
  items: T[];
  /** true si había más gastos que el tope: la lista y el total son parciales. */
  truncado: boolean;
}

/** La consulta pide `LIST_LIMIT + 1`: si vino uno de más, había más que mostrar. */
export function acotarLista<T>(rows: readonly T[], limit: number = LIST_LIMIT): ListaAcotada<T> {
  return rows.length > limit ? { items: rows.slice(0, limit), truncado: true } : { items: [...rows], truncado: false };
}
