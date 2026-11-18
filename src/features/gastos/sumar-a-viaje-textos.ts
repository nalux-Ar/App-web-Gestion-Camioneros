import type { DataErrorContext } from '@/lib/data-errors';
import { LIST_LIMIT as LIST_LIMIT_VIAJES } from '@/features/viajes/constants';
import { LIST_LIMIT, MAX_GASTOS_POR_VEZ } from './constants';
import { SUMAR_GASTOS_CONTEXT } from './sumar-gastos-textos';

/**
 * TODOS los textos NUEVOS de «Sumar varios a un viaje» (la pantalla `/gastos/sumar-a-viaje`, que se abre desde la lista de Gastos),
 * juntos para revisarlos de un vistazo. Español neutro, de «tú», en palabras de todos los días (nada de «vincular», «asociar» ni
 * «lote»). Los montos van sin símbolo de moneda, como en toda la app. Lo que es idéntico a «Sumar gastos que ya cargué» o a «Quitar
 * gastos del viaje» NO se repite acá: la pantalla lo toma de `sumar-gastos-textos.ts` (`TITULO_LISTA_SUELTOS`, `MARCAR_TODOS_DESMARCADO`,
 * `textoMarcarTodos`, `textoTotalMarcado`, `MARCA_ALGUNO`, `SUMANDO`, `UN_MOMENTO`, `ERROR_CATEGORIAS`) y de
 * `quitar-gastos-textos.ts` (`textoMarcarPrimeros`, `AVISO_MAXIMO_MARCADO`, que no hablan de quitar). La ayuda de la pantalla (el
 * botón «Ayuda») está con las demás ayudas, en `src/features/ayuda/ayuda-pantallas.ts`.
 */

// ---------------------------------------------------------------------------
// Entrada y encabezado
// ---------------------------------------------------------------------------

/** El título de la pantalla. */
export const TITULO_SUMAR_A_VIAJE = 'Sumar gastos a un viaje';
/** El botón de la lista de Gastos que lleva a la pantalla. */
export const BOTON_ENTRADA_SUMAR_A_VIAJE = 'Sumar varios a un viaje';
/** El «Volver» del segundo paso (vuelve a elegir los gastos). Lo que se ve; lo que oye el lector de pantalla va en `VOLVER_A_ELEGIR_GASTOS`. */
export const BOTON_VOLVER = 'Volver';
export const VOLVER_A_ELEGIR_GASTOS = 'a elegir los gastos';
export const VOLVER_A_GASTOS = 'Volver a Gastos';

// ---------------------------------------------------------------------------
// Primer paso: elegir los gastos
// ---------------------------------------------------------------------------

export const AYUDA_DE_LA_LISTA_A_VIAJE = 'Marca los que quieres poner en un viaje.';
/** Los que ya tienen viaje no se ofrecen: aquí no se pueden mover. */
export const AVISO_YA_EN_UN_VIAJE = 'Los gastos que ya están en un viaje no aparecen aquí. Para sacarlos, entra al viaje.';

/** Cuando hay más sin viaje de los que se pueden sumar en un pedido. El número es el tope (`MAX_GASTOS_POR_VEZ`). */
export const AVISO_TOPE_POR_VEZ_SUMAR = `Puedes sumar hasta ${MAX_GASTOS_POR_VEZ} gastos por vez. Cuando termines, puedes seguir con los demás.`;

/** Cuando el mes trae el máximo de gastos y había más: solo se ven los sin viaje entre los más recientes. El número es el de la lista (`LIST_LIMIT`). */
export const AVISO_HAY_MAS_GASTOS_DEL_MES = `Hay más de ${LIST_LIMIT} gastos en este mes; aquí solo se ven los que no tienen viaje entre los ${LIST_LIMIT} más recientes. Filtra por categoría para ver el resto.`;

/** Al cambiar el mes o la categoría se desmarca todo (así lo que se ve es siempre lo que se manda): se avisa, si había algo marcado. */
export const AVISO_DESMARCADO_POR_MES = 'Cambiaste el mes: se desmarcó lo que habías marcado.';
export const AVISO_DESMARCADO_POR_CATEGORIA = 'Cambiaste la categoría: se desmarcó lo que habías marcado.';

/** El nombre del selector de categoría y su primera opción (la lista sin filtrar). */
export const ETIQUETA_DE_CATEGORIA = 'Categoría';
export const TODAS_LAS_CATEGORIAS = 'Todas las categorías';

/** El botón que pasa al segundo paso. */
export const ELEGIR_EL_VIAJE = 'Elegir el viaje';

// ---------------------------------------------------------------------------
// Sin gastos sin viaje
// ---------------------------------------------------------------------------

/** El mes (con ese filtro) no tiene ningún gasto. `mes` ya viene escrito («septiembre 2026»). */
export function textoSinGastosEnElMes(mes: string, conCategoria: boolean): string {
  return conCategoria ? `No hay gastos de esa categoría en ${mes}.` : `No hay gastos en ${mes}.`;
}
/** El mes tiene gastos, pero todos ya están en un viaje. */
export function textoTodosConViaje(mes: string): string {
  return `Todos los gastos de ${mes} ya están en un viaje.`;
}

// ---------------------------------------------------------------------------
// Segundo paso: ¿a qué viaje?
// ---------------------------------------------------------------------------

export const TITULO_A_QUE_VIAJE = '¿A qué viaje?';
/** El nombre del grupo de opciones, para el lector de pantalla. */
export const NOMBRE_DE_LA_LISTA_DE_VIAJES = 'Viajes del mes';

/** Arriba del segundo paso: cuántos gastos se van a sumar y cuánto suman. `monto` ya viene formateado, sin símbolo de moneda. */
export function textoResumenDeMarcados(cantidad: number, monto: string): string {
  return cantidad === 1 ? `Vas a sumar 1 gasto. Suma ${monto}.` : `Vas a sumar ${cantidad} gastos. Suman ${monto}.`;
}
/** Si en el segundo paso ya no queda nada marcado (la lista de gastos se refrescó y los marcados salieron). */
export const YA_NO_HAY_MARCADOS = 'Ya no hay gastos marcados. Vuelve y marca los que quieres sumar.';

/** `mes` ya viene escrito («septiembre 2026»). */
export function textoNoHayViajes(mes: string): string {
  return `No hay viajes en ${mes}.`;
}
/** Cuando el mes de viajes trae el máximo y había más. El número es el de la lista de viajes (`LIST_LIMIT`). */
export const AVISO_HAY_MAS_VIAJES = `Hay más de ${LIST_LIMIT_VIAJES} viajes en este mes; aquí se ven los ${LIST_LIMIT_VIAJES} más recientes.`;

/** Algunos de los marcados son de otro camión que el viaje: esos no se suman. Va debajo de la opción y repetido en la tarjeta de abajo. */
export function textoOtroCamionEnElViaje(cantidad: number): string {
  return cantidad === 1
    ? '1 de los marcados es de otro camión: no se va a sumar.'
    : `${cantidad} de los marcados son de otro camión: no se van a sumar.`;
}
/** TODOS los marcados son de otro camión que el viaje: la opción no se puede elegir. */
export const MARCADOS_DE_OTRO_CAMION = 'Los marcados son de otro camión.';

/** En lugar del total, mientras no hay viaje elegido: dice por qué el botón está apagado. */
export const ELIGE_UN_VIAJE = 'Elige un viaje para sumar los gastos.';

/** «Sumar 3 gastos a este viaje» / «Sumar 1 gasto a este viaje». Sin nada para sumar (el botón está apagado): «Sumar gastos a este viaje». */
export function textoBotonSumarAEsteViaje(cantidad: number): string {
  if (cantidad <= 0) return 'Sumar gastos a este viaje';
  return cantidad === 1 ? 'Sumar 1 gasto a este viaje' : `Sumar ${cantidad} gastos a este viaje`;
}

// ---------------------------------------------------------------------------
// El resultado
// ---------------------------------------------------------------------------

/** El botón del aviso que lleva al detalle del viaje al que se sumó. */
export const VER_EL_VIAJE = 'Ver el viaje';

// ---------------------------------------------------------------------------
// Errores al sumar
// ---------------------------------------------------------------------------

/**
 * Los textos de los errores de esta pantalla: los de «Sumar gastos que ya cargué» (sin señal, tiempo vencido, el viaje ya no existe)
 * y uno propio para los datos inválidos, porque acá no hay un «viaje» al que volver. Nunca sale el texto del servidor.
 */
export const SUMAR_A_VIAJE_CONTEXT: DataErrorContext = {
  ...SUMAR_GASTOS_CONTEXT,
  invalidData: 'No se pudo sumar. Revisa los gastos y el viaje, y prueba de nuevo.',
};
