import { idsDistintos } from './sumar-gastos';

/**
 * Lo que muestra el aviso del resultado de un «Quitar» (`ResultadoDeQuitar`): cuántos gastos se quitaron del viaje y cuántos de los
 * marcados ya no estaban en él. Lógica pura: arma los números; el aviso solo los dibuja.
 */

export interface ResultadoParaMostrarDeQuitar {
  /** Cuántos eran de este viaje y ahora están sin viaje. */
  quitados: number;
  /** Cuántos de los marcados ya no eran de este viaje (otro dispositivo los quitó o los movió, o se borraron). */
  yaNoEstaban: number;
}

/**
 * Arma lo que se muestra a partir de lo que se PIDIÓ (`pedidos`: los ids que se mandaron) y de lo que la base dijo que REALMENTE se
 * quitó (`quitados`: lo que devuelve `quitarGastosDelViaje`, que ya vuelve filtrado a lo pedido). Un gasto que ya no estaba en el
 * viaje no es un error: la base simplemente no lo toca y no vuelve en la respuesta; acá se cuenta como «ya no estaba».
 *
 * Se cuentan los pedidos DISTINTOS que aparecen en la respuesta (no el largo de la respuesta): un id de más o repetido en `quitados`
 * no puede hacer que se «quiten» más de los que se pidieron. Los ids se comparan sin mirar mayúsculas (un uuid es el mismo escrito
 * de las dos formas; la base siempre contesta en minúsculas).
 */
export function armarResultadoDeQuitar(pedidos: readonly string[], quitados: readonly string[]): ResultadoParaMostrarDeQuitar {
  const devueltos = new Set(quitados.map((id) => id.toLowerCase()));
  const distintos = idsDistintos(pedidos);
  const seQuitaron = distintos.filter((id) => devueltos.has(id.toLowerCase())).length;
  return { quitados: seQuitaron, yaNoEstaban: distintos.length - seQuitaron };
}
