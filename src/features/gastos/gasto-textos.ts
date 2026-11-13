import { formatDateShort } from '@/lib/dates';
import { formatNumber } from '@/lib/numbers';
import type { Categoria } from './categorias';

/**
 * La pregunta de eliminar un gasto: dice CUÁL es (categoría, monto y fecha), para que quien toca «Eliminar gasto» sepa qué va
 * a borrar:
 *
 *   "¿Eliminar el gasto de Peajes por 5.000,00 del 12 oct? Esto no se puede deshacer."
 *
 * Los montos van sin símbolo de moneda, como en toda la app. Sin la categoría a mano (todavía no llegaron las categorías, o
 * ya no existe) la frase sigue completa: "¿Eliminar el gasto por 5.000,00 del 12 oct? …". Lógica pura.
 */
export function textoPreguntaEliminar(
  gasto: { categoria_id: string; monto: number; fecha: string },
  categorias: readonly Pick<Categoria, 'id' | 'nombre'>[],
): string {
  const categoria = categorias.find((candidata) => candidata.id === gasto.categoria_id);
  const de = categoria ? ` de ${categoria.nombre}` : '';
  return `¿Eliminar el gasto${de} por ${formatNumber(gasto.monto, { decimales: 2 })} del ${formatDateShort(gasto.fecha)}? Esto no se puede deshacer.`;
}
