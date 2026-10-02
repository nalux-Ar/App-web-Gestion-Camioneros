import type { DataErrorContext } from '@/lib/data-errors';

/**
 * Lógica PURA de la tarjeta "Nombre" de Configuración (sin React ni Supabase;
 * `DataErrorContext` es solo un tipo). Está aparte para poder probarla suelta.
 *
 * El nombre es el de la CUENTA (el transportista), no un nombre personal:
 * vive en `transportistas.nombre`, cuyo check en la base es
 * `length(trim(nombre)) between 1 and 200`. La base sigue siendo la
 * autoridad; esto es el espejo en el front para avisar antes de enviar.
 */

/** Largo máximo del nombre, en caracteres: mismo valor que el check de la base (y que el onboarding). */
export const MAX_NOMBRE = 200;

/** Misma redacción que el onboarding (welcome-page.tsx) cuando la base rechaza el largo. */
export const NOMBRE_INVALIDO_MESSAGE = `Escribe un nombre entre 1 y ${MAX_NOMBRE} caracteres.`;

/** Se muestra cuando la base no dejó cambiar el nombre (0 filas, o permiso negado). */
export const NOMBRE_NO_EDITABLE_MESSAGE =
  'No pudimos cambiar el nombre. Solo el administrador de la cuenta puede hacerlo.';

/** Mensajes propios de los errores de la base al GUARDAR el nombre (constante de módulo: la usa `useSubmitFeedback`). */
export const GUARDAR_NOMBRE_CONTEXT: DataErrorContext = {
  // 0 filas (`NombreNoEditableError`) o 404: la base no distingue "no existe" de "no tienes permiso".
  notFound: NOMBRE_NO_EDITABLE_MESSAGE,
  // 42501 / 403: sin permiso explícito.
  permission: NOMBRE_NO_EDITABLE_MESSAGE,
  // Check de la base (23514, clase 22): el largo del nombre.
  invalidData: NOMBRE_INVALIDO_MESSAGE,
};

export type NombreValidation = { ok: true; value: string } | { ok: false; message: string };

/**
 * Largo como cuenta Postgres (`length()`): en caracteres (code points), no en
 * unidades UTF-16 (un emoji es 1, no 2). Mismo criterio que `charLength` de
 * features/gastos/gasto-form.ts; se repite acá (3 líneas) para no acoplar
 * Configuración al formulario de Gastos.
 *
 * Con `cap` no recorre un texto gigante (un pegado de megabytes): cada carácter
 * ocupa a lo sumo 2 unidades UTF-16, así que si `text.length > 2 * cap` ya pasa
 * de `cap` caracteres y devuelve `cap + 1` sin contar. Nunca supera `cap + 1`.
 */
function charLength(text: string, cap: number): number {
  if (text.length > 2 * cap) return cap + 1;
  return Math.min(Array.from(text).length, cap + 1);
}

/**
 * Recorta los espacios y exige de 1 a `MAX_NOMBRE` caracteres. Devuelve el
 * valor recortado, que es el que se manda a la base.
 *
 * El atajo de "más de 2 × el tope" se aplica al texto YA recortado: aplicarlo
 * al crudo rechazaría un nombre válido pegado con muchísimo espacio alrededor.
 * `trim()` es lineal y no arma arrays, así que un pegado enorme no cuesta
 * (lo caro, `Array.from`, no se ejecuta con más de 2 × `MAX_NOMBRE`).
 */
export function validateNombre(raw: string): NombreValidation {
  const value = raw.trim();
  const length = charLength(value, MAX_NOMBRE);
  if (length < 1 || length > MAX_NOMBRE) return { ok: false, message: NOMBRE_INVALIDO_MESSAGE };
  return { ok: true, value };
}
