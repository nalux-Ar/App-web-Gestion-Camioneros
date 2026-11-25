import { formatDateShort, formatDateWithYear } from '@/lib/dates';

// La fecha de «Nuevo gasto» (y de la edición) va plegada: una fila «Fecha: hoy» con un botón «Cambiar» que despliega el campo de siempre.
// Textos y reglas PURAS de esa fila.

/** El rótulo de la fila plegada: «Fecha: hoy». */
export const ROTULO_FECHA = 'Fecha:';

/** El botón que despliega el campo de la fecha. */
export const BOTON_CAMBIAR_FECHA = 'Cambiar';

/**
 * El nombre accesible del botón: EMPIEZA con el texto que se ve («Cambiar»), así quien habla con la pantalla («tocar Cambiar») lo
 * encuentra y el lector de pantalla dice de qué se trata.
 */
export const NOMBRE_CAMBIAR_FECHA = 'Cambiar la fecha';

/**
 * Lo que dice la fila plegada después de «Fecha:». «hoy» si es la fecha de hoy (`today`, hora local, 'YYYY-MM-DD'); si no, la fecha corta
 * de las listas de gastos ("30 sep", `formatDateShort`). Si es de otro año va con el año ("30 sep 2025"), como las etiquetas de los viajes
 * en el mismo formulario: sin el año, un gasto viejo que se edita se confundiría con uno de este año.
 */
export function textoDeLaFecha(fecha: string, today: string): string {
  if (fecha === today) return 'hoy';
  return fecha.slice(0, 4) === today.slice(0, 4) ? formatDateShort(fecha) : formatDateWithYear(fecha);
}
