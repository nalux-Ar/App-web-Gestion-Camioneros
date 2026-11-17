import type { DataErrorContext } from '@/lib/data-errors';
import { MAX_GASTOS_POR_VEZ } from './constants';
import type { MotivoNoSumado } from './sumar-gastos';

/**
 * TODOS los textos de «Sumar gastos que ya cargué», juntos para revisarlos de un vistazo. Español neutro, de «tú», en palabras de
 * todos los días (nada de «vincular», «asociar» ni «lote»). Los montos van sin símbolo de moneda, como en toda la app. La ayuda
 * de la pantalla (el botón «Ayuda») está con las demás ayudas, en `src/features/ayuda/ayuda-pantallas.ts`.
 */

// ---------------------------------------------------------------------------
// Entrada y encabezado
// ---------------------------------------------------------------------------

/** El título de la pantalla. */
export const TITULO_SUMAR_GASTOS = 'Sumar gastos que ya cargué';
/** El botón del detalle del viaje que lleva a la pantalla. */
export const BOTON_ENTRADA_SUMAR_GASTOS = 'Sumar gastos que ya cargué';

// ---------------------------------------------------------------------------
// La lista
// ---------------------------------------------------------------------------

export const TITULO_LISTA_SUELTOS = 'Gastos sin viaje';
export const AYUDA_DE_LA_LISTA = 'Marca los que fueron de este viaje.';

/** Cuando la lista trae el máximo y había más. El número es el tope de la base (`MAX_GASTOS_POR_VEZ`). */
export const AVISO_HAY_MAS = `Hay más gastos sin viaje; aquí se ven los ${MAX_GASTOS_POR_VEZ} más cercanos a la fecha del viaje.`;

/** El nombre de un gasto cuya categoría no llegó (o ya no existe). */
export const NOMBRE_GENERICO_DE_GASTO = 'Gasto';

/** Si no cargaron las categorías: se avisa y los gastos se ven con el nombre genérico. Va seguido del mensaje del error. */
export const ERROR_CATEGORIAS = 'No pudimos cargar las categorías.';

export const MARCAR_TODOS_DESMARCADO = 'Desmarcar todos';
/** «Marcar todos (12)»: el número es cuántos gastos se pueden sumar. */
export function textoMarcarTodos(cantidad: number): string {
  return `Marcar todos (${cantidad})`;
}

// ---------------------------------------------------------------------------
// Los que no se pueden sumar
// ---------------------------------------------------------------------------

export const TITULO_NO_SE_PUEDEN_SUMAR = 'No se pueden sumar';

/** Cuando TODO lo que hay sin viaje es de otro camión: no queda nada para marcar. */
export const NADA_PARA_SUMAR = 'Ninguno de estos gastos se puede sumar a este viaje.';

/** El motivo de un gasto de otro camión. `patente` ya viene con espacios («AB 123 CD»); sin ella (no se conoce), sin paréntesis. */
export function textoOtroCamion(patente: string | null): string {
  return patente === null ? 'Es de otro camión' : `Es de otro camión (${patente})`;
}

// ---------------------------------------------------------------------------
// Sin gastos sueltos
// ---------------------------------------------------------------------------

export const TITULO_SIN_GASTOS_SUELTOS = 'No tienes gastos sin viaje.';
export const DETALLE_SIN_GASTOS_SUELTOS = 'Los gastos que anotes sin elegir un viaje aparecerán aquí.';
export const VOLVER_AL_VIAJE = 'Volver al viaje';

// ---------------------------------------------------------------------------
// El botón principal
// ---------------------------------------------------------------------------

/** «Sumar 3 gastos al viaje» / «Sumar 1 gasto al viaje». Sin nada marcado (el botón está apagado): «Sumar gastos al viaje». */
export function textoBotonSumar(cantidad: number): string {
  if (cantidad <= 0) return 'Sumar gastos al viaje';
  return cantidad === 1 ? 'Sumar 1 gasto al viaje' : `Sumar ${cantidad} gastos al viaje`;
}

export const SUMANDO = 'Sumando…';

/** «Suman 12.345,00»: `monto` ya viene formateado, sin símbolo de moneda. */
export function textoTotalMarcado(monto: string): string {
  return `Suman ${monto}`;
}
/** En lugar del total, cuando no hay nada marcado: dice por qué el botón está apagado. */
export const MARCA_ALGUNO = 'Marca los que quieres sumar.';

// ---------------------------------------------------------------------------
// El resultado de «Sumar»
// ---------------------------------------------------------------------------

export function textoSumaste(cantidad: number): string {
  return cantidad === 1 ? 'Sumaste 1 gasto al viaje.' : `Sumaste ${cantidad} gastos al viaje.`;
}
/** Cuando de lo que se mandó no se sumó nada (y nada estaba ya sumado). */
export const NINGUNO_SUMADO = 'No se sumó ningún gasto.';
export function textoYaEstaban(cantidad: number): string {
  return cantidad === 1 ? '1 ya estaba en este viaje.' : `${cantidad} ya estaban en este viaje.`;
}
export function textoNoSeSumaron(cantidad: number): string {
  return cantidad === 1 ? '1 no se pudo sumar:' : `${cantidad} no se pudieron sumar:`;
}

/**
 * Por qué un gasto no se sumó. `no_encontrado` es UN solo texto para «ya no existe» y para «es de otra cuenta»: la base contesta
 * igual a las dos cosas y la pantalla no tiene que distinguirlas jamás.
 */
export const MOTIVOS_NO_SUMADO: Record<MotivoNoSumado, string> = {
  en_otro_viaje: 'Ya está en otro viaje.',
  camion_distinto: 'Es de otro camión.',
  no_encontrado: 'Ya no está disponible.',
  no_se_pudo: 'No se pudo sumar. Inténtalo de nuevo.',
};

/** Una línea de «los que no se pudieron sumar»: «Peajes · 15 jun 2025: Ya está en otro viaje.». Sin fecha (no se sabe cuál era): «Gasto: …». */
export function textoGastoNoSumado(nombre: string, fecha: string | null, motivo: MotivoNoSumado): string {
  return `${fecha === null ? nombre : `${nombre} · ${fecha}`}: ${MOTIVOS_NO_SUMADO[motivo]}`;
}

// ---------------------------------------------------------------------------
// Errores al sumar
// ---------------------------------------------------------------------------

/**
 * Los textos de los errores de «Sumar» (los demás, los de siempre: `mapDataError`). Nunca sale el texto del servidor. Sin señal y
 * con el tiempo vencido no nombran ningún botón ni hablan de «lo escrito» (no hay nada escrito): lo marcado sigue marcado. La
 * clase `payment` (cuenta en solo lectura) usa el mensaje general y no ofrece «Reintentar».
 */
export const SUMAR_GASTOS_CONTEXT: DataErrorContext = {
  network: 'No hay señal. Todavía NO se sumaron. Cuando tengas señal, inténtalo de nuevo.',
  timeout: 'La señal está lenta y no sabemos si se sumaron. Revisa el viaje o inténtalo de nuevo: si ya estaban sumados, no pasa nada.',
  notFound: 'Este viaje ya no existe.',
  invalidData: 'No se pudo sumar. Vuelve al viaje y prueba de nuevo.',
};
