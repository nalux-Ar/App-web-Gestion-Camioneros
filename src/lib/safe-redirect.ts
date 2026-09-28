/**
 * Sanitiza el parámetro `?volver=` que usan las rutas protegidas para
 * recordar a dónde quería ir el usuario antes de mandarlo a /ingresar.
 *
 * Solo se acepta una ruta interna: empieza con "/", el caracter siguiente
 * no es "/" ni "\" (bloquea "//evil.com" y "/\evil.com", que algunos
 * navegadores tratan como protocol-relative a otro host) y no tiene
 * espacios/control chars (bloquea variantes con tabs/saltos de línea
 * pensadas para confundir el parseo). Cualquier otra cosa (URL absoluta,
 * esquema `javascript:`, etc.) cae al fallback "/".
 *
 * Se espera que `value` ya venga decodeURIComponent (p.ej. desde
 * `URLSearchParams.get`, que decodifica solo). No hace falta (ni conviene)
 * decodificar de nuevo acá.
 */
const SAFE_INTERNAL_PATH = /^\/(?!\/|\\)\S*$/;

export function getSafeRedirectPath(value: string | null | undefined): string {
  const FALLBACK = '/';
  if (!value) return FALLBACK;
  if (!SAFE_INTERNAL_PATH.test(value)) return FALLBACK;
  return value;
}
