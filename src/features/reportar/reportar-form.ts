import { MAX_MENSAJE, MENSAJE_VACIO, textoMensajeLargo } from './reportar-textos';

/**
 * Validación del mensaje de un reporte. Lógica pura.
 *
 * Lo que se manda es el texto LIMPIO (`limpiarMensaje`): sin caracteres de control (salvo salto de línea y tabulación; el
 * NUL, además, PostgREST lo rechazaría con 22P05) y sin los espacios de los extremos. Se cuenta por caracteres reales (un
 * emoji es 1, como cuenta Postgres), así el contador dice exactamente lo que va a medir la base. El mismo `check` que la
 * base (`reportes_mensaje_chk`): hasta 2000 caracteres y AL MENOS UNO que no sea espacio (solo saltos de línea o tabs no
 * alcanza). El texto viaja como DATO: nunca se interpreta como HTML ni va a SQL armado a mano (es un parámetro del INSERT).
 */

const SALTO_DE_LINEA = 0x0a;
const TABULACION = 0x09;

/** ¿Es un caracter de control (C0, DEL o C1) que no sea salto de línea ni tabulación? */
function esControl(caracter: string): boolean {
  const code = caracter.codePointAt(0) ?? 0;
  if (code === SALTO_DE_LINEA || code === TABULACION) return false;
  return code < 0x20 || (code >= 0x7f && code < 0xa0);
}

/**
 * ¿Es la mitad suelta de un par sustituto (0xD800–0xDFFF)? `Array.from` junta los pares válidos (un emoji) en un solo
 * caracter, así que lo que queda en ese rango está suelto: no es UTF-8 válido y PostgREST rechazaría SIEMPRE el envío.
 */
function esSustitutoSuelto(caracter: string): boolean {
  const code = caracter.codePointAt(0) ?? 0;
  return code >= 0xd800 && code <= 0xdfff;
}

/** Caracteres que no se ven (espacios de ancho cero, unión de palabras, BOM, relleno Hangul): no cuentan como texto. */
const INVISIBLES = new Set([0x200b, 0x200c, 0x200d, 0x2060, 0xfeff, 0x3164]);

/** ¿Hay al menos un caracter visible (que no sea espacio ni invisible)? */
function tieneTextoVisible(texto: string): boolean {
  return Array.from(texto).some((caracter) => !INVISIBLES.has(caracter.codePointAt(0) ?? 0) && /\S/.test(caracter));
}

/**
 * El texto que se envía: sin caracteres de control (salvo salto de línea y tab), sin sustitutos sueltos y sin los espacios
 * de los extremos. Los invisibles NO se quitan (el de unión, U+200D, es parte de muchos emoji): solo no cuentan como texto.
 */
export function limpiarMensaje(texto: string): string {
  return Array.from(texto)
    .filter((caracter) => !esControl(caracter) && !esSustitutoSuelto(caracter))
    .join('')
    .trim();
}

/** Cuántos caracteres se van a enviar. */
export function caracteresDelMensaje(texto: string): number {
  return Array.from(limpiarMensaje(texto)).length;
}

export type ValidacionMensaje = { ok: true; mensaje: string } | { ok: false; error: string };

/** Sin ningún caracter visible (solo espacios o invisibles): error. Más de 2000: error con cuántos tiene. Si no, el mensaje limpio. */
export function validarMensaje(texto: string): ValidacionMensaje {
  const mensaje = limpiarMensaje(texto);
  if (!tieneTextoVisible(mensaje)) return { ok: false, error: MENSAJE_VACIO };
  const caracteres = Array.from(mensaje).length;
  if (caracteres > MAX_MENSAJE) return { ok: false, error: textoMensajeLargo(caracteres) };
  return { ok: true, mensaje };
}
