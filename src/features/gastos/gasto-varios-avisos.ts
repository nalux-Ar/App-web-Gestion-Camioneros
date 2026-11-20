import { MAX_GASTOS_POR_CARGA } from './constants';
import { textoGastosGuardados } from './gasto-varios-textos';

/**
 * El aviso «Guardaste N gastos.» que muestran la lista de Gastos y el detalle de un viaje al volver de «Nuevo gasto» con más de una
 * categoría. Viaja en el `location.state` junto con la cantidad.
 *
 * El `location.state` NO es de confianza: la cantidad solo cuenta si es un número entero entre 2 y `MAX_GASTOS_POR_CARGA` (con uno
 * el aviso es «Gasto guardado.», que no lleva número); cualquier otra cosa (un texto, un decimal, un número enorme, un objeto) se
 * ignora y el aviso no se muestra. Y el texto que se ve sale SIEMPRE de `textoGastosGuardados` con esa cantidad ya validada: nunca
 * se muestra un texto que venga del estado.
 */

/** ¿Es una cantidad de gastos guardados que se puede mostrar? Un entero entre 2 y el máximo de gastos por carga. */
export function esCantidadDeGastosGuardados(valor: unknown): valor is number {
  return typeof valor === 'number' && Number.isInteger(valor) && valor >= 2 && valor <= MAX_GASTOS_POR_CARGA;
}

/** La cantidad del `state` ya validada, o null si falta o no sirve. */
export function leerCantidadDeGastosGuardados(state: unknown): number | null {
  if (typeof state !== 'object' || state === null) return null;
  const { cantidad } = state as { cantidad?: unknown };
  return esCantidadDeGastosGuardados(cantidad) ? cantidad : null;
}

/** «Guardaste 3 gastos.» con la cantidad del `state`, o null si no hay una cantidad válida (entonces no se muestra ningún aviso). */
export function mensajeDeGastosGuardados(state: unknown): string | null {
  const cantidad = leerCantidadDeGastosGuardados(state);
  return cantidad === null ? null : textoGastosGuardados(cantidad);
}
