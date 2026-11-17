import { formatDateWithYear } from '@/lib/dates';
import { nombreParaMostrar, type Categoria } from './categorias';
import type { GastoDeFila } from './gastos-api';
import { resumirResultados, type ResultadoDeGasto } from './sumar-gastos';
import { NOMBRE_GENERICO_DE_GASTO, textoGastoNoSumado } from './sumar-gastos-textos';

/**
 * Lo que muestra el aviso del resultado de un «Sumar» (`ResultadoDeSumar`): qué se sumó, qué ya estaba y, de lo que no se pudo
 * sumar, cuál y por qué. Lógica pura: arma los números y las líneas; el aviso solo las dibuja.
 */

/** Lo que el aviso necesita, con el texto de cada gasto no sumado ya armado. */
export interface ResultadoParaMostrar {
  /** Cuántos estaban sueltos y ahora están en el viaje. */
  sumados: number;
  /** Cuántos ya eran de este viaje. */
  yaEstaban: number;
  /** Los que no se sumaron, en el orden en que se mandaron, cada uno con su línea lista («Peajes · 15 jun 2025: Ya está en otro viaje.»). */
  noSumados: Array<{ gastoId: string; texto: string }>;
}

/**
 * Arma lo que se muestra a partir de lo que contestó la base (`resultados`, ya leído) y de los gastos que se MANDARON (`enviados`:
 * las filas de la lista tal como estaban al tocar «Sumar»; de ahí salen la categoría y la fecha de cada línea, porque la lista de
 * ahora ya no tiene los que se sumaron ni los que se borraron). Un gasto que no está entre los enviados (no debería pasar) sale
 * con el nombre genérico y sin fecha.
 */
export function armarResultado(
  resultados: readonly ResultadoDeGasto[],
  enviados: readonly GastoDeFila[],
  categoriasPorId: ReadonlyMap<string, Categoria>,
): ResultadoParaMostrar {
  const resumen = resumirResultados(resultados);
  const porId = new Map(enviados.map((gasto) => [gasto.id, gasto]));
  return {
    sumados: resumen.sumados,
    yaEstaban: resumen.yaEstaban,
    noSumados: resumen.noSumados.map(({ gastoId, motivo }) => {
      const gasto = porId.get(gastoId);
      const categoria = gasto ? categoriasPorId.get(gasto.categoria_id) : undefined;
      const nombre = categoria ? nombreParaMostrar(categoria) : NOMBRE_GENERICO_DE_GASTO;
      return { gastoId, texto: textoGastoNoSumado(nombre, gasto ? formatDateWithYear(gasto.fecha) : null, motivo) };
    }),
  };
}
