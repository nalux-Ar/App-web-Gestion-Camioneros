import type { MotivoDevolucion, NewRow } from '@/lib/db';
import { charLength } from '@/lib/text';
import { MAX_DESCRIPCION, MOTIVO_ORDER } from './constants';

/**
 * Lógica PURA del formulario de devoluciones (sin React ni Supabase): validación, armado de lo que se manda a la
 * base y la huella de los reintentos. Está aparte a propósito para poder probarla suelta.
 *
 * La base sigue siendo la autoridad (RLS + checks + FKs): esto es el espejo en el front para avisar antes de enviar,
 * con mensajes en español. La fecha de la devolución es la del viaje: no hay campo de fecha.
 */

// ---------------------------------------------------------------------------
// Valores del formulario (todo texto, tal cual lo tipeó el usuario)
// ---------------------------------------------------------------------------

export interface DevolucionFormValues {
  /** '' = todavía no eligió (el motivo es obligatorio). */
  motivo: '' | MotivoDevolucion;
  /** Id del cliente elegido, o '' = todavía no eligió (obligatorio). */
  clienteId: string;
  descripcion: string;
}

export type DevolucionFormField = keyof DevolucionFormValues;

/** Orden en pantalla: se usa para llevar el foco al PRIMER campo con error. */
export const DEVOLUCION_FIELD_ORDER: readonly DevolucionFormField[] = ['motivo', 'clienteId', 'descripcion'];

export type DevolucionFormErrors = Partial<Record<DevolucionFormField, string>>;

/** Valores de una devolución nueva: todo vacío (no se preselecciona nada). */
export function emptyDevolucionValues(): DevolucionFormValues {
  return { motivo: '', clienteId: '', descripcion: '' };
}

/** Lo que el formulario necesita de una devolución guardada para editarla. */
export interface DevolucionEditable {
  motivo: MotivoDevolucion;
  cliente_id: string;
  descripcion: string | null;
}

export function valuesFromDevolucion(devolucion: DevolucionEditable): DevolucionFormValues {
  return {
    motivo: devolucion.motivo,
    clienteId: devolucion.cliente_id,
    descripcion: devolucion.descripcion ?? '',
  };
}

// ---------------------------------------------------------------------------
// Validación
// ---------------------------------------------------------------------------

/**
 * Columnas de `devoluciones` que edita el formulario. NO incluye `viaje_id` (una devolución no se mueve a otro viaje:
 * al crear viaja aparte, ver `buildInsertRow`; al editar no se toca), ni `client_ref` (solo se manda al crear), ni
 * `id`/`transportista_id`/timestamps (los pone la base).
 */
export interface DevolucionColumns {
  motivo: MotivoDevolucion;
  cliente_id: string;
  /** Recortada; vacía = `null` explícito (al EDITAR, borra la que hubiera). */
  descripcion: string | null;
}

export interface ValidarDevolucionContext {
  /** Los clientes que se pueden elegir (la lista cargada). Un cliente que no esté acá no es válido. */
  clientes: ReadonlyArray<{ id: string }>;
}

export type DevolucionValidation =
  | { ok: true; columns: DevolucionColumns }
  | { ok: false; errors: DevolucionFormErrors; firstField: DevolucionFormField };

export const MOTIVO_FALTA_MESSAGE = 'Elige un motivo.';
export const CLIENTE_FALTA_MESSAGE = 'Elige un cliente.';
/** Error de la descripción vacía con el motivo "Otro" (regla SOLO del front: la base la deja vacía). */
export const DESCRIPCION_OBLIGATORIA_MESSAGE = 'Escribe qué pasó con esta devolución.';
export const DESCRIPCION_LARGA_MESSAGE = `La descripción puede tener hasta ${MAX_DESCRIPCION} caracteres.`;

/** ¿El motivo elegido es "Otro" (la descripción es obligatoria)? */
export function esMotivoOtro(motivo: DevolucionFormValues['motivo']): boolean {
  return motivo === 'otro';
}

/**
 * Valida el formulario completo (espejo de los checks de la base) y arma las columnas listas para enviar.
 *
 *  - motivo: obligatorio y uno de los cuatro del enum.
 *  - cliente: obligatorio y uno de los clientes conocidos (`context.clientes`). Un cliente guardado que ya no está en
 *    la lista (borrado, o más allá del tope de la lista) NO es válido: hay que elegir otro.
 *  - descripción: <= 2000 caracteres (contados como `length()` de Postgres: code points), recortada; vacía = null.
 *    OBLIGATORIA solo con el motivo "Otro".
 */
export function validateDevolucionForm(values: DevolucionFormValues, context: ValidarDevolucionContext): DevolucionValidation {
  const errors: DevolucionFormErrors = {};

  const motivo = MOTIVO_ORDER.find((candidato) => candidato === values.motivo);
  if (motivo === undefined) errors.motivo = MOTIVO_FALTA_MESSAGE;

  if (values.clienteId === '' || !context.clientes.some((cliente) => cliente.id === values.clienteId)) {
    errors.clienteId = CLIENTE_FALTA_MESSAGE;
  }

  const descripcion = values.descripcion.trim();
  if (charLength(descripcion, MAX_DESCRIPCION) > MAX_DESCRIPCION) {
    errors.descripcion = DESCRIPCION_LARGA_MESSAGE;
  } else if (descripcion === '' && esMotivoOtro(values.motivo)) {
    errors.descripcion = DESCRIPCION_OBLIGATORIA_MESSAGE;
  }

  if (Object.keys(errors).length > 0 || motivo === undefined) {
    const firstField = DEVOLUCION_FIELD_ORDER.find((field) => errors[field] !== undefined) ?? 'motivo';
    return { ok: false, errors, firstField };
  }

  return {
    ok: true,
    columns: {
      motivo,
      cliente_id: values.clienteId,
      descripcion: descripcion === '' ? null : descripcion,
    },
  };
}

// ---------------------------------------------------------------------------
// Lo que se manda a la base
// ---------------------------------------------------------------------------

/**
 * Fila para INSERT: las columnas + el viaje (de la URL, ya validado) + la clave de idempotencia. `insertPayload`
 * quita lo que pone la base.
 */
export function buildInsertRow(viajeId: string, columns: DevolucionColumns, clientRef: string): NewRow<'devoluciones'> {
  return { viaje_id: viajeId, ...columns, client_ref: clientRef };
}

/**
 * Huella de TODO lo que se manda en el INSERT (orden fijo de claves): el viaje y las tres columnas. Sirve para saber
 * si entre dos intentos de guardar el usuario cambió algo (ver `crearDevolucion`). El `client_ref` no entra: es lo
 * que une los intentos.
 */
export function fingerprintOf(viajeId: string, columns: DevolucionColumns): string {
  return JSON.stringify([viajeId, columns.motivo, columns.cliente_id, columns.descripcion]);
}
