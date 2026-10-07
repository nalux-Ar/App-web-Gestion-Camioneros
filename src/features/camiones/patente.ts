/**
 * Patentes de camiones. Lógica PURA (sin React ni Supabase).
 *
 * La base guarda la patente NORMALIZADA: solo A-Z y 0-9 ASCII, de 1 a 20 caracteres (`camiones_patente_normalizada_chk`,
 * migración 010). `crear_camion` normaliza sola; en un UPDATE directo la manda normalizada el front (si no, 23514). La
 * normalización de acá es el espejo EXACTO de la de la base: `upper(regexp_replace(p, '[^0-9A-Za-z]', '', 'g'))`, en ese
 * orden (primero se quita todo lo que no sea letra o dígito ASCII y recién después se pasa a mayúsculas: así una "ß" no
 * se convierte en "SS" ni una "ñ" en "Ñ").
 *
 * Para mostrarla se separan los bloques ("AB 123 CD", "ABC 123"). El formato argentino (AB123CD, del Mercosur, o ABC123,
 * el anterior) solo se AVISA: no se bloquea una patente distinta (un acoplado viejo, una patente de otro país).
 */

/** Largo máximo de una patente normalizada: mismo valor que `camiones_patente_chk` (001). */
export const MAX_PATENTE = 20;

export const PATENTE_VACIA_MESSAGE = 'Escribe la patente.';
export const PATENTE_LARGA_MESSAGE = `La patente puede tener hasta ${MAX_PATENTE} letras y números.`;
export const PATENTE_FORMATO_AVISO = 'No tiene el formato de una patente argentina (AB 123 CD o ABC 123): revísala.';

const NO_ALFANUMERICO = /[^0-9A-Za-z]/g;
const MERCOSUR = /^([A-Z]{2})([0-9]{3})([A-Z]{2})$/;
const ANTERIOR = /^([A-Z]{3})([0-9]{3})$/;

/** "ab 123-cd" -> "AB123CD". Lo que no es texto da ''. */
export function normalizarPatente(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(NO_ALFANUMERICO, '').toUpperCase();
}

export type PatenteValidation = { ok: true; value: string } | { ok: false; message: string };

/** Normaliza y exige de 1 a 20 caracteres. Devuelve la patente normalizada (la que se manda a la base). */
export function validarPatente(raw: string): PatenteValidation {
  const value = normalizarPatente(raw);
  if (value.length < 1) return { ok: false, message: PATENTE_VACIA_MESSAGE };
  if (value.length > MAX_PATENTE) return { ok: false, message: PATENTE_LARGA_MESSAGE };
  return { ok: true, value };
}

/** ¿Tiene formato de patente argentina (AB123CD o ABC123)? Recibe la patente YA normalizada. */
export function esPatenteArgentina(normalizada: string): boolean {
  return MERCOSUR.test(normalizada) || ANTERIOR.test(normalizada);
}

/** "AB123CD" -> "AB 123 CD"; "ABC123" -> "ABC 123"; cualquier otra, tal cual. Solo para mostrar. */
export function formatearPatente(normalizada: string): string {
  const mercosur = MERCOSUR.exec(normalizada);
  if (mercosur) return `${mercosur[1]} ${mercosur[2]} ${mercosur[3]}`;
  const anterior = ANTERIOR.exec(normalizada);
  if (anterior) return `${anterior[1]} ${anterior[2]}`;
  return normalizada;
}
