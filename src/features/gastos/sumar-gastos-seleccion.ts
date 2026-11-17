import { esDeOtroCamion } from './sumar-gastos';
import { sumMontos } from './gastos-list';

/**
 * Lógica pura de la selección de gastos de «Sumar gastos que ya cargué» (y, más adelante, de «Quitar»): qué hay marcado, qué se
 * manda, cuánto suma y cómo se parte la lista. Sin React ni base. La pieza de React que la usa es `use-seleccion-de-gastos.ts`.
 *
 * La regla de fondo: lo que se manda es SIEMPRE «lo marcado que sigue en la lista de ahora», nunca un conjunto guardado de antes.
 * La lista se refresca sola (al volver la señal, o después de sumar) y un gasto puede desaparecer de ella; mandarlo igual daría
 * un resultado confuso, y reenviar una selección vieja después de otra operación sobre los mismos gastos los volvería a tocar.
 */

/** Los ids de una lista de gastos, en su orden. */
export function idsDe(gastos: ReadonlyArray<{ id: string }>): string[] {
  return gastos.map((gasto) => gasto.id);
}

/**
 * Lo marcado que SIGUE en la lista de ahora (selección ∩ lista), en el orden de la lista (el de cercanía a la fecha del viaje),
 * no en el que se fueron tocando las casillas. Es lo que se manda: un id marcado que ya no está en la lista no sale nunca.
 */
export function marcadosVigentes(vigentes: readonly string[], marcados: ReadonlySet<string>): string[] {
  return vigentes.filter((id) => marcados.has(id));
}

/**
 * La selección recortada a lo que sigue en la lista. Si no se pierde nada devuelve el MISMO conjunto (la misma referencia): así
 * guardarlo en un estado de React no provoca un render de más.
 */
export function recortarSeleccion(marcados: ReadonlySet<string>, vigentes: readonly string[]): ReadonlySet<string> {
  const enLaLista = new Set(vigentes);
  const quedan = [...marcados].filter((id) => enLaLista.has(id));
  return quedan.length === marcados.size ? marcados : new Set(quedan);
}

/** Marca el gasto si estaba sin marcar y lo desmarca si estaba marcado. Devuelve un conjunto nuevo: no cambia el que recibe. */
export function alternarMarca(marcados: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const siguiente = new Set(marcados);
  if (siguiente.has(id)) siguiente.delete(id);
  else siguiente.add(id);
  return siguiente;
}

/** ¿Está marcado TODO lo de la lista? Con la lista vacía no: no hay nada que estar marcado. */
export function todosMarcados(vigentes: readonly string[], marcados: ReadonlySet<string>): boolean {
  return vigentes.length > 0 && vigentes.every((id) => marcados.has(id));
}

/** Lo que suman los gastos marcados, en CENTAVOS enteros (como `sumMontos`: 0,1 + 0,2 da 0,3 y no 0,30000000000000004). */
export function totalDeMarcados(gastos: ReadonlyArray<{ id: string; monto: number }>, marcados: ReadonlySet<string>): number {
  return sumMontos(gastos.filter((gasto) => marcados.has(gasto.id)));
}

/**
 * Parte los gastos sueltos en los que se pueden sumar a este viaje y los que NO, por ser de otro camión (la misma regla que la
 * base: solo choca si el gasto y el viaje tienen camión y son distintos). Cada grupo conserva el orden en que llegaron (el de
 * cercanía a la fecha del viaje). La que decide, de todos modos, es la base.
 */
export function partirPorCamion<T extends { camion_id?: string | null }>(
  gastos: readonly T[],
  viaje: { camion_id: string | null },
): { sumables: T[]; deOtroCamion: T[] } {
  const sumables: T[] = [];
  const deOtroCamion: T[] = [];
  for (const gasto of gastos) (esDeOtroCamion(gasto, viaje) ? deOtroCamion : sumables).push(gasto);
  return { sumables, deOtroCamion };
}
