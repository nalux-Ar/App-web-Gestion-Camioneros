import { MAX_GASTOS_POR_CARGA } from './constants';

/**
 * Los textos de «Nuevo gasto» cuando se marca MÁS DE UNA categoría (cada una se guarda como un gasto). Todos juntos acá para
 * poder revisarlos de una vez: español neutro de «tú» (nunca voseo), en palabras de todos los días (nada de «lote», «client_ref»
 * ni nombres de la base) y sin ningún texto que venga del servidor.
 */

/** Debajo de «Categoría» en el alta: dice que se puede marcar más de una y qué pasa con cada una. */
export const AYUDA_VARIAS_CATEGORIAS = 'Puedes marcar más de una: cada una se guarda como un gasto.';

/** Con el tope de categorías marcadas, las que faltan se apagan y esto explica por qué. */
export const AVISO_TOPE_DE_CATEGORIAS = `Marcaste el máximo: ${MAX_GASTOS_POR_CARGA} categorías por vez. Desmarca una para elegir otra.`;

/** Tras un intento de guardar VARIOS gastos que no terminó bien, las categorías quedan fijas (se explica debajo de «Categoría»). */
export const AVISO_CATEGORIAS_FIJAS = 'Ya intentamos guardar. Para cambiar las categorías, empieza de nuevo.';

/**
 * Tras un intento de guardar UN gasto que no terminó bien: la categoría se puede cambiar (el reintento corrige el gasto, sin
 * duplicarlo), pero no sumar otras. Para sumar otras hay que empezar de nuevo.
 */
export const AVISO_CATEGORIA_CAMBIABLE = 'Ya intentamos guardar. Para cambiar la categoría, desmarca la actual y marca otra; para sumar otra, empieza de nuevo.';

/** La salida: borra la marca de «ya se intentó» y deja volver a elegir las categorías (lo escrito se conserva). */
export const EMPEZAR_DE_NUEVO = 'Empezar de nuevo';
export const CONFIRMAR_EMPEZAR_DE_NUEVO = 'Sí, empezar de nuevo';
export const CANCELAR_EMPEZAR_DE_NUEVO = 'Cancelar';

/** La pregunta del segundo toque: lo que ya se intentó guardar pudo haber llegado. Lo primero es mirar la lista. */
export const PREGUNTA_EMPEZAR_DE_NUEVO = 'Antes de empezar de nuevo, revisa la lista de Gastos: puede que ya se hayan guardado.';

/** El botón de guardar cuando hay dos o más gastos. Con uno sigue diciendo «Guardar gasto». */
export function botonGuardarGastos(cantidad: number): string {
  return `Guardar ${cantidad} gastos`;
}

/** «Combustible», «Combustible y Peajes», «Combustible, Peajes y Gastos varios». */
export function unirNombres(nombres: readonly string[]): string {
  if (nombres.length <= 1) return nombres.join('');
  return `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`;
}

/** Lo que oye el lector de pantalla al marcar o desmarcar: cuántos gastos se van a guardar y de qué. Sin nada marcado, no dice nada. */
export function anuncioDeGastos(nombres: readonly string[]): string {
  if (nombres.length === 0) return '';
  const gastos = nombres.length === 1 ? '1 gasto' : `${nombres.length} gastos`;
  return `Vas a guardar ${gastos}: ${unirNombres(nombres)}.`;
}

/** El método de pago de cada gasto, con el nombre de su categoría. */
export function etiquetaMetodoDePago(nombreDeCategoria: string): string {
  return `Método de pago de ${nombreDeCategoria}`;
}

/** El título de la parte de abajo, donde se elige cómo se pagó cada gasto. */
export const TITULO_COMO_PAGASTE = '¿Cómo pagaste cada gasto?';

/** El título del recuadro del combustible cuando hay varios gastos (el título del bloque ya es «Combustible»). */
export const TITULO_DATOS_DEL_COMBUSTIBLE = 'Datos del combustible';

/** «Guardaste 3 gastos.» (la lista de Gastos y el detalle del viaje lo muestran al volver). Solo con 2 o más: con uno es «Gasto guardado.». */
export function textoGastosGuardados(cantidad: number): string {
  return `Guardaste ${cantidad} gastos.`;
}
