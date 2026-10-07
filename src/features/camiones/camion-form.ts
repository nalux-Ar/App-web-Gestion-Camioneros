import { charLength } from '@/lib/text';
import { MAX_MARCA, MAX_MODELO, MIN_ANIO } from './constants';
import { esPatenteArgentina, normalizarPatente, validarPatente } from './patente';

/**
 * Lógica PURA del formulario de camión (alta y edición): validación y armado de lo que se manda a la base. La base sigue
 * siendo la autoridad (checks de `camiones`: patente normalizada de 1 a 20, marca y modelo <= 100, año 1950..2100): esto
 * es el espejo en el front para avisar antes de enviar, con mensajes en español.
 */

export interface CamionFormValues {
  patente: string;
  marca: string;
  modelo: string;
  /** Texto tal cual se tipeó ('' = sin año). */
  anio: string;
}

export type CamionFormField = keyof CamionFormValues;

/** Orden en pantalla: se usa para llevar el foco al PRIMER campo con error. */
export const CAMION_FIELD_ORDER: readonly CamionFormField[] = ['patente', 'marca', 'modelo', 'anio'];

export type CamionFormErrors = Partial<Record<CamionFormField, string>>;

export function emptyCamionValues(): CamionFormValues {
  return { patente: '', marca: '', modelo: '', anio: '' };
}

/** Lo que el formulario necesita de un camión guardado para editarlo. */
export interface CamionEditable {
  patente: string;
  marca: string | null;
  modelo: string | null;
  anio: number | null;
}

export function valuesFromCamion(camion: CamionEditable): CamionFormValues {
  return {
    patente: camion.patente,
    marca: camion.marca ?? '',
    modelo: camion.modelo ?? '',
    anio: camion.anio === null ? '' : String(camion.anio),
  };
}

/** Columnas que escribe el formulario, TODAS explícitas (un `null` vacía el dato al EDITAR). La patente, normalizada. */
export interface CamionColumns {
  patente: string;
  marca: string | null;
  modelo: string | null;
  anio: number | null;
}

export const MARCA_LARGA_MESSAGE = `La marca puede tener hasta ${MAX_MARCA} caracteres.`;
export const MODELO_LARGO_MESSAGE = `El modelo puede tener hasta ${MAX_MODELO} caracteres.`;

/** El año máximo que se acepta: el que viene (un camión 0 km puede ser modelo del año siguiente). */
export function maxAnio(today: Date = new Date()): number {
  return today.getFullYear() + 1;
}

export function anioInvalidoMessage(today: Date = new Date()): string {
  return `Escribe un año entre ${MIN_ANIO} y ${maxAnio(today)}, o déjalo vacío.`;
}

/**
 * El aviso NO bloqueante del formato de la patente: si lo tipeado (ya normalizado) no tiene formato argentino. Sin nada
 * tipeado no avisa.
 */
export function avisoFormatoPatente(raw: string): boolean {
  const normalizada = normalizarPatente(raw);
  return normalizada !== '' && !esPatenteArgentina(normalizada);
}

export type CamionValidation =
  | { ok: true; columns: CamionColumns }
  | { ok: false; errors: CamionFormErrors; firstField: CamionFormField };

type TextoOpcional = { ok: true; value: string | null } | { ok: false; message: string };

function validarOpcional(raw: string, max: number, largo: string): TextoOpcional {
  const value = raw.trim();
  if (charLength(value, max) > max) return { ok: false, message: largo };
  return { ok: true, value: value === '' ? null : value };
}

/**
 * Valida el formulario completo y arma las columnas listas para enviar.
 *
 *  - patente: obligatoria; se normaliza (mayúsculas, solo letras y números ASCII) y tiene que quedar de 1 a 20. Si no
 *    tiene formato argentino solo se avisa (`avisoFormatoPatente`), no se bloquea.
 *  - marca y modelo: opcionales, recortados, hasta 100 caracteres; vacíos = null.
 *  - año: opcional, entero de 4 cifras entre 1950 y el año que viene.
 */
export function validateCamionForm(values: CamionFormValues, today: Date = new Date()): CamionValidation {
  const errors: CamionFormErrors = {};

  const patente = validarPatente(values.patente);
  if (!patente.ok) errors.patente = patente.message;

  const marca = validarOpcional(values.marca, MAX_MARCA, MARCA_LARGA_MESSAGE);
  if (!marca.ok) errors.marca = marca.message;

  const modelo = validarOpcional(values.modelo, MAX_MODELO, MODELO_LARGO_MESSAGE);
  if (!modelo.ok) errors.modelo = modelo.message;

  let anio: number | null = null;
  const anioTexto = values.anio.trim();
  if (anioTexto !== '') {
    const numero = /^[0-9]{4}$/.test(anioTexto) ? Number(anioTexto) : Number.NaN;
    if (Number.isInteger(numero) && numero >= MIN_ANIO && numero <= maxAnio(today)) anio = numero;
    else errors.anio = anioInvalidoMessage(today);
  }

  const firstField = CAMION_FIELD_ORDER.find((field) => errors[field] !== undefined);
  if (firstField !== undefined || !patente.ok || !marca.ok || !modelo.ok) {
    return { ok: false, errors, firstField: firstField ?? 'patente' };
  }

  return { ok: true, columns: { patente: patente.value, marca: marca.value, modelo: modelo.value, anio } };
}
