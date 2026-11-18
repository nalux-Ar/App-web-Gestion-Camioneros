import { esDeOtroCamion } from './sumar-gastos';

/**
 * Lógica pura de «Sumar varios a un viaje» (la pantalla que se abre desde la lista de Gastos): qué gastos se ofrecen, cuáles de los
 * marcados caben en un viaje por su camión y qué mes de viajes se muestra al buscar uno. Sin React ni base. La selección en sí
 * (qué está marcado, el tope de 100) es de `useSeleccionConTope`; el envío, de `useVincularGastos`.
 */

/** Lo mínimo que hace falta de un gasto para saber si está suelto. */
export interface GastoConViaje {
  id: string;
  viaje_id: string | null;
}

/**
 * Los gastos SIN viaje de la lista, en su orden. Los que ya están en un viaje no se ofrecen (esta pantalla no mueve gastos de un
 * viaje a otro: sacarlos se hace desde el viaje). Un `viaje_id` ausente no es «sin viaje»: solo cuenta el `null` explícito.
 */
export function gastosSinViaje<T extends GastoConViaje>(gastos: readonly T[]): T[] {
  return gastos.filter((gasto) => gasto.viaje_id === null);
}

/** ¿Hay al menos un gasto sin viaje? Es lo que decide si la lista de Gastos ofrece «Sumar varios a un viaje». */
export function hayGastosSinViaje(gastos: readonly GastoConViaje[]): boolean {
  return gastos.some((gasto) => gasto.viaje_id === null);
}

/** Los gastos de la lista que están marcados (los ids), en el orden de la lista. Un id marcado que no está en la lista no sale. */
export function gastosMarcados<T extends { id: string }>(gastos: readonly T[], marcados: readonly string[]): T[] {
  const ids = new Set(marcados);
  return gastos.filter((gasto) => ids.has(gasto.id));
}

/** Cómo quedan los gastos marcados frente a UN viaje, por el camión. */
export interface ReparteDeCamion<T> {
  /** Los que se pueden sumar a ese viaje (los que no son de otro camión), en el orden recibido. Es lo que se manda. */
  aEnviar: T[];
  /** Cuántos de los marcados son de otro camión que el viaje: no se suman. */
  deOtroCamion: number;
  /** Hay marcados y TODOS son de otro camión: el viaje no se puede elegir. Sin nada marcado, no. */
  todosDeOtroCamion: boolean;
}

/**
 * Parte los gastos marcados frente a un viaje con la misma regla que la base (`esDeOtroCamion`: solo choca si el gasto y el viaje
 * tienen camión y son distintos). Es una ayuda para la pantalla (no ofrecer lo que la base va a rechazar): la que decide es la base.
 */
export function repartirPorCamionDelViaje<T extends { camion_id?: string | null }>(
  marcados: readonly T[],
  viaje: { camion_id: string | null },
): ReparteDeCamion<T> {
  const aEnviar: T[] = [];
  let deOtroCamion = 0;
  for (const gasto of marcados) {
    if (esDeOtroCamion(gasto, viaje)) deOtroCamion += 1;
    else aEnviar.push(gasto);
  }
  return { aEnviar, deOtroCamion, todosDeOtroCamion: marcados.length > 0 && aEnviar.length === 0 };
}
