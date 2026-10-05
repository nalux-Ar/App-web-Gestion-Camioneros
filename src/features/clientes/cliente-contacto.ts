import { MAX_EMAIL, MAX_TELEFONO } from './constants';

/**
 * Enlaces de contacto de un cliente (`tel:` para llamar, `mailto:` para escribir). Lógica PURA.
 *
 * Regla de seguridad: el teléfono y el email son texto que escribió el usuario (o que llegó de la base) y van a parar al
 * `href` de un enlace. Un `href` armado con texto sin validar puede ser `javascript:...` o colar parámetros
 * (`mailto:a@b.test?bcc=...`). Por eso:
 *  - el esquema lo fija el código (`tel:` o `mailto:`), nunca el texto;
 *  - el enlace se arma SOLO si el texto pasa una validación estricta (lista blanca de caracteres);
 *  - en el `tel:` van únicamente los dígitos (y un `+` inicial), no el texto tal cual.
 * Si no pasa, la pantalla muestra el dato como texto, sin enlace (nada se pierde: se ve igual).
 */

/** Un teléfono "limpio": un `+` opcional al principio y después solo dígitos, espacios, guiones, puntos y paréntesis. */
const TELEFONO_LIMPIO = /^\+?[0-9 ().-]+$/;
/** Un número de teléfono tiene entre 6 y 15 dígitos (15 es el máximo internacional, E.164). */
const MIN_DIGITOS = 6;
const MAX_DIGITOS = 15;

/**
 * El `href` para llamar a ese teléfono (`tel:+5493515551234`), o `null` si el texto no es un número limpio: con letras
 * ("351 555-1234 Juan"), con otros símbolos (`*`, `#`, `;`, `:`), con saltos de línea o con menos de 6 o más de 15
 * dígitos. Ahí el teléfono se muestra como texto.
 */
export function hrefTelefono(telefono: unknown): string | null {
  if (typeof telefono !== 'string') return null;
  const texto = telefono.trim();
  if (texto === '' || texto.length > MAX_TELEFONO || !TELEFONO_LIMPIO.test(texto)) return null;
  const digitos = texto.replace(/[^0-9]/g, '');
  if (digitos.length < MIN_DIGITOS || digitos.length > MAX_DIGITOS) return null;
  return `tel:${texto.startsWith('+') ? '+' : ''}${digitos}`;
}

/**
 * Email "estricto": parte local con letras, dígitos, punto, guion, guion bajo y `+` (sin `%`, que en un `mailto:` abre un
 * escape); una arroba; un dominio de etiquetas de letras, dígitos y guiones (sin guion al principio ni al final de cada
 * una) y un final de 2 o más letras. Nada de espacios, `?`, `&`, `#`, `:`, `/`, comillas ni caracteres fuera de ASCII.
 */
const EMAIL_ESTRICTO = /^[A-Za-z0-9._+-]{1,64}@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;

/**
 * El `href` para escribirle a ese email (`mailto:ventas@empresa.test`), o `null` si el texto no pasa la forma estricta (ahí
 * se muestra como texto). Un punto al principio o al final de la parte local, o dos seguidos, tampoco pasan.
 */
export function hrefEmail(email: unknown): string | null {
  if (typeof email !== 'string') return null;
  const texto = email.trim();
  if (texto === '' || texto.length > MAX_EMAIL || !EMAIL_ESTRICTO.test(texto)) return null;
  const local = texto.slice(0, texto.indexOf('@'));
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) return null;
  return `mailto:${texto}`;
}
