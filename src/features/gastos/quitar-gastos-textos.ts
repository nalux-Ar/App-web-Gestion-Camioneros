import type { DataErrorContext } from '@/lib/data-errors';
import { LIST_LIMIT, MAX_GASTOS_POR_VEZ } from './constants';

/**
 * TODOS los textos NUEVOS de «Quitar gastos del viaje», juntos para revisarlos de un vistazo. Español neutro, de «tú», en palabras
 * de todos los días (nada de «vincular», «asociar» ni «lote»). Los montos van sin símbolo de moneda, como en toda la app. Lo que es
 * idéntico a «Sumar gastos que ya cargué» NO se repite acá: la pantalla lo toma de `sumar-gastos-textos.ts` (`VOLVER_AL_VIAJE`,
 * `NOMBRE_GENERICO_DE_GASTO`, `ERROR_CATEGORIAS`, `MARCAR_TODOS_DESMARCADO`, `UN_MOMENTO`, `textoMarcarTodos`, `textoTotalMarcado`). La ayuda de
 * la pantalla (el botón «Ayuda») está con las demás ayudas, en `src/features/ayuda/ayuda-pantallas.ts`.
 */

// ---------------------------------------------------------------------------
// Entrada y encabezado
// ---------------------------------------------------------------------------

/** El título de la pantalla. */
export const TITULO_QUITAR_GASTOS = 'Quitar gastos del viaje';
/** El botón del detalle del viaje que lleva a la pantalla. */
export const BOTON_ENTRADA_QUITAR_GASTOS = 'Quitar gastos del viaje';

// ---------------------------------------------------------------------------
// La lista
// ---------------------------------------------------------------------------

export const TITULO_LISTA_DEL_VIAJE = 'Gastos del viaje';
export const AYUDA_DE_LA_LISTA_QUITAR = 'Marca los que quieres quitar de este viaje.';

/** Cuando el viaje tiene más gastos de los que se pueden quitar en un pedido. El número es el tope (`MAX_GASTOS_POR_VEZ`). */
export const AVISO_TOPE_POR_VEZ = `Puedes quitar hasta ${MAX_GASTOS_POR_VEZ} gastos por vez. Cuando termines, puedes seguir con los demás.`;

/** Cuando la lista trae el máximo y había más. El número es el de la lista (`LIST_LIMIT`). */
export const AVISO_HAY_MAS_GASTOS = `Hay más de ${LIST_LIMIT} gastos en este viaje; aquí se ven los ${LIST_LIMIT} más recientes.`;

/** «Marcar los primeros 100»: en lugar de «Marcar todos (N)» cuando el viaje tiene más gastos de los que se pueden quitar por vez. */
export function textoMarcarPrimeros(cantidad: number): string {
  return `Marcar los primeros ${cantidad}`;
}

/** Junto al total, cuando ya se marcó el máximo y quedan gastos sin marcar (esas casillas se apagan): dice por qué y qué hacer. */
export const AVISO_MAXIMO_MARCADO = `Marcaste ${MAX_GASTOS_POR_VEZ}, el máximo por vez. Desmarca uno para elegir otro.`;

// ---------------------------------------------------------------------------
// Sin gastos
// ---------------------------------------------------------------------------

export const TITULO_SIN_GASTOS_EN_EL_VIAJE = 'Este viaje no tiene gastos.';

// ---------------------------------------------------------------------------
// El botón principal
// ---------------------------------------------------------------------------

/** «Quitar 3 gastos del viaje» / «Quitar 1 gasto del viaje». Sin nada marcado (el botón está apagado): «Quitar gastos del viaje». */
export function textoBotonQuitar(cantidad: number): string {
  if (cantidad <= 0) return 'Quitar gastos del viaje';
  return cantidad === 1 ? 'Quitar 1 gasto del viaje' : `Quitar ${cantidad} gastos del viaje`;
}

/** Mientras corre ESTE pedido. */
export const QUITANDO = 'Quitando…';
// Mientras corre OTRA operación (un «Sumar», por ejemplo): `UN_MOMENTO`, compartido con «Sumar» en `sumar-gastos-textos.ts`.

/** En lugar del total, cuando no hay nada marcado: dice por qué el botón está apagado. */
export const MARCA_ALGUNO_QUITAR = 'Marca los que quieres quitar.';

// ---------------------------------------------------------------------------
// El resultado de «Quitar»
// ---------------------------------------------------------------------------

export function textoQuitaste(cantidad: number): string {
  return cantidad === 1 ? 'Quitaste 1 gasto del viaje.' : `Quitaste ${cantidad} gastos del viaje.`;
}
/** Cuando de lo que se mandó no se quitó nada (y nada «ya no estaba»; no debería pasar: lo que se manda es siempre algo). */
export const NINGUNO_QUITADO = 'No se quitó ningún gasto.';
/** Los marcados que ya no eran de este viaje (otro dispositivo los quitó o los movió, o se borraron). */
export function textoYaNoEstaban(cantidad: number): string {
  return cantidad === 1 ? '1 ya no estaba en este viaje.' : `${cantidad} ya no estaban en este viaje.`;
}
/** Lo que tranquiliza: quitar NO borra. `cantidad` es cuántos se quitaron. */
export function textoNoSeBorraron(cantidad: number): string {
  return cantidad === 1 ? 'El gasto no se borró: quedó sin viaje.' : 'Los gastos no se borraron: quedaron sin viaje.';
}

// ---------------------------------------------------------------------------
// Errores al quitar
// ---------------------------------------------------------------------------

/**
 * Los textos de los errores de «Quitar» (los demás, los de siempre: `mapDataError`). Nunca sale el texto del servidor. Sin señal y
 * con el tiempo vencido no nombran ningún botón ni hablan de «lo escrito» (no hay nada escrito): lo marcado sigue marcado. Quitar
 * es idempotente (repetirlo no cambia nada de lo ya quitado), por eso con el tiempo vencido se puede volver a intentar sin riesgo.
 * La clase `payment` (cuenta en solo lectura) usa el mensaje general y no ofrece «Reintentar».
 */
export const QUITAR_GASTOS_CONTEXT: DataErrorContext = {
  network: 'No hay señal. Todavía NO se quitaron. Cuando tengas señal, inténtalo de nuevo.',
  timeout: 'La señal está lenta y no sabemos si se quitaron. Revisa el viaje o inténtalo de nuevo: si ya estaban quitados, no pasa nada.',
  notFound: 'Este viaje ya no existe.',
  invalidData: 'No se pudo quitar. Vuelve al viaje y prueba de nuevo.',
};
