/**
 * Utilidades de texto compartidas por los formularios (sin React ni Supabase).
 */

/**
 * Largo como cuenta Postgres (`length()`): en caracteres (code points), no en unidades UTF-16 (un emoji
 * es 1, no 2). Es lo que verifican los checks de largo de la base (`length(x) <= N`), así que el
 * front tiene que contar igual.
 *
 * Con `cap` no recorre un texto gigante (un pegado de megabytes en cada tecla): como cada carácter ocupa
 * a lo sumo 2 unidades UTF-16, si `text.length > 2 * cap` ya pasa de `cap` caracteres y devuelve `cap + 1`
 * sin contar. El resultado nunca supera `cap + 1`.
 */
export function charLength(text: string, cap: number = Number.POSITIVE_INFINITY): number {
  if (text.length > 2 * cap) return cap + 1;
  return Math.min(Array.from(text).length, cap + 1);
}
