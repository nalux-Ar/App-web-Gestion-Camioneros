import type { NewRow } from '@/lib/db';
import { charLength } from '@/lib/text';
import { validateNombreCliente } from './cliente-nombre';
import { MAX_DIRECCION, MAX_EMAIL, MAX_TELEFONO } from './constants';

/**
 * Lógica PURA del formulario de cliente (sin React ni Supabase): validación, armado de lo que se manda a la base y la
 * huella de los reintentos. Está aparte a propósito para poder probarla suelta.
 *
 * La base sigue siendo la autoridad (RLS + checks de `clientes`: nombre de 1 a 200 caracteres recortado, teléfono
 * <= 50, email <= 254, dirección <= 300): esto es el espejo en el front para avisar antes de enviar, con mensajes en
 * español. El nombre se valida igual que en el "+ Nuevo cliente" del viaje (`validateNombreCliente`).
 */

// ---------------------------------------------------------------------------
// Valores del formulario (todo texto, tal cual lo tipeó el usuario)
// ---------------------------------------------------------------------------

export interface ClienteFormValues {
  nombre: string;
  telefono: string;
  email: string;
  direccion: string;
}

export type ClienteFormField = keyof ClienteFormValues;

/** Orden en pantalla: se usa para llevar el foco al PRIMER campo con error. */
export const CLIENTE_FIELD_ORDER: readonly ClienteFormField[] = ['nombre', 'telefono', 'email', 'direccion'];

export type ClienteFormErrors = Partial<Record<ClienteFormField, string>>;

/** Valores de un cliente nuevo: todo vacío. */
export function emptyClienteValues(): ClienteFormValues {
  return { nombre: '', telefono: '', email: '', direccion: '' };
}

/** Lo que el formulario necesita de un cliente guardado para editarlo. */
export interface ClienteEditable {
  nombre: string;
  contacto_telefono: string | null;
  contacto_email: string | null;
  direccion: string | null;
}

export function valuesFromCliente(cliente: ClienteEditable): ClienteFormValues {
  return {
    nombre: cliente.nombre,
    telefono: cliente.contacto_telefono ?? '',
    email: cliente.contacto_email ?? '',
    direccion: cliente.direccion ?? '',
  };
}

// ---------------------------------------------------------------------------
// Lo que se manda a la base
// ---------------------------------------------------------------------------

/**
 * Columnas de `clientes` que escribe el formulario, TODAS explícitas (un `null` vacía el dato al EDITAR). No incluye
 * `client_ref` (solo se manda al crear) ni `id`/`transportista_id`/timestamps (los pone la base).
 */
export interface ClienteColumns {
  nombre: string;
  contacto_telefono: string | null;
  contacto_email: string | null;
  direccion: string | null;
}

/**
 * Lo que se guarda al CREAR un cliente: el nombre y, si vienen, los datos de contacto. El formulario de Clientes manda las
 * cuatro columnas; el "+ Nuevo cliente" del viaje, solo el nombre (el resto queda en el default de la base, `null`).
 */
export type ClienteDatos = Pick<ClienteColumns, 'nombre'> & Partial<Omit<ClienteColumns, 'nombre'>>;

/** Fila para INSERT: los datos + la clave de idempotencia. `insertPayload` quita lo que pone la base. */
export function buildInsertRow(datos: ClienteDatos, clientRef: string): NewRow<'clientes'> {
  return { ...datos, client_ref: clientRef };
}

/**
 * Huella de lo que se manda al crear (orden fijo de claves): sirve para saber si entre dos intentos de guardar el usuario
 * cambió algo (ver `crearClienteIdempotente`). Un dato de contacto que no viene cuenta como `null`, igual que en la base.
 * El `client_ref` no entra: es lo que une los intentos.
 */
export function fingerprintOf(datos: ClienteDatos): string {
  return JSON.stringify([datos.nombre, datos.contacto_telefono ?? null, datos.contacto_email ?? null, datos.direccion ?? null]);
}

// ---------------------------------------------------------------------------
// Validación
// ---------------------------------------------------------------------------

export const TELEFONO_LARGO_MESSAGE = `El teléfono puede tener hasta ${MAX_TELEFONO} caracteres.`;
export const EMAIL_LARGO_MESSAGE = `El email puede tener hasta ${MAX_EMAIL} caracteres.`;
export const EMAIL_INVALIDO_MESSAGE = 'Escribe un email válido, como nombre@empresa.test.';
export const DIRECCION_LARGA_MESSAGE = `La dirección puede tener hasta ${MAX_DIRECCION} caracteres.`;

/**
 * Forma MÍNIMA de un email para poder guardarlo: algo, una arroba, algo, un punto y algo, sin espacios. Es a propósito
 * más permisiva que la que decide si se muestra como enlace `mailto:` (`hrefEmail`, src/features/clientes/cliente-contacto.ts):
 * acá solo se frena lo que claramente no es un email ("no tiene", "351 555-1234"); un email con caracteres raros se
 * guarda igual y se muestra como texto.
 */
const EMAIL_MINIMO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type ClienteValidation =
  | { ok: true; columns: ClienteColumns }
  | { ok: false; errors: ClienteFormErrors; firstField: ClienteFormField };

type OpcionalValidation = { ok: true; value: string | null } | { ok: false; message: string };

/** Texto opcional recortado de hasta `max` caracteres (code points, como `length()` de Postgres); vacío = null. */
function validateOpcional(raw: string, max: number, largo: string): OpcionalValidation {
  const value = raw.trim();
  if (charLength(value, max) > max) return { ok: false, message: largo };
  return { ok: true, value: value === '' ? null : value };
}

/**
 * Valida el formulario completo y arma las columnas listas para enviar (todas, con `null` explícito en las vacías).
 *
 *  - nombre: obligatorio, recortado, de 1 a 200 caracteres (`validateNombreCliente`).
 *  - teléfono: opcional, hasta 50 caracteres. Texto libre (se puede anotar "int. 23" o a quién llamar); solo se muestra
 *    como enlace para llamar si es un número limpio (`hrefTelefono`).
 *  - email: opcional, hasta 254 caracteres y con la forma mínima de un email (`EMAIL_MINIMO`).
 *  - dirección: opcional, hasta 300 caracteres.
 */
export function validateClienteForm(values: ClienteFormValues): ClienteValidation {
  const errors: ClienteFormErrors = {};

  const nombre = validateNombreCliente(values.nombre);
  if (!nombre.ok) errors.nombre = nombre.message;

  const telefono = validateOpcional(values.telefono, MAX_TELEFONO, TELEFONO_LARGO_MESSAGE);
  if (!telefono.ok) errors.telefono = telefono.message;

  const email = validateOpcional(values.email, MAX_EMAIL, EMAIL_LARGO_MESSAGE);
  if (!email.ok) errors.email = email.message;
  else if (email.value !== null && !EMAIL_MINIMO.test(email.value)) errors.email = EMAIL_INVALIDO_MESSAGE;

  const direccion = validateOpcional(values.direccion, MAX_DIRECCION, DIRECCION_LARGA_MESSAGE);
  if (!direccion.ok) errors.direccion = direccion.message;

  const firstField = CLIENTE_FIELD_ORDER.find((field) => errors[field] !== undefined);
  if (firstField !== undefined || !nombre.ok || !telefono.ok || !email.ok || !direccion.ok) {
    return { ok: false, errors, firstField: firstField ?? 'nombre' };
  }

  return {
    ok: true,
    columns: {
      nombre: nombre.value,
      contacto_telefono: telefono.value,
      contacto_email: email.value,
      direccion: direccion.value,
    },
  };
}
