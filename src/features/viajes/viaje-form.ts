import { validateFechaDeRegistro } from '@/lib/dates';
import {
  formatForInput,
  fromDbNumber,
  toDbNumberOrNull,
  toScaledInt,
  validateOptionalNumber,
} from '@/lib/numbers';
import { charLength } from '@/lib/text';
import { generateUuid } from '@/lib/uuid';
import { MAX_ENTREGAS, MAX_INCIDENCIAS, MAX_OBSERVACIONES, MAX_TEXTO } from './constants';

/**
 * Lógica PURA del formulario de viajes (sin React ni Supabase): validación, reglas de kilometraje,
 * armado de lo que se manda y deducción del modo al editar. Está aparte para poder probarla suelta.
 *
 * La base sigue siendo la autoridad (RLS + checks de `viajes` y `entregas`): esto es el espejo en el
 * front para avisar antes de enviar, con mensajes en español.
 */

// ---------------------------------------------------------------------------
// Valores del formulario (todo texto, tal cual lo tipeó el usuario)
// ---------------------------------------------------------------------------

/**
 * Kilometraje: la base NO deja mezclar los dos modos en una misma fila (`viajes_chk_modo_km`: o inicial /
 * final, o recorridos). El formulario muestra uno a la vez y del inactivo manda `null`.
 */
export type KmModo = 'inicial-final' | 'recorridos';

export const KM_MODO_OPTIONS: ReadonlyArray<{ value: KmModo; label: string }> = [
  { value: 'inicial-final', label: 'Inicial y final' },
  { value: 'recorridos', label: 'Recorridos' },
];

/** Una fila de la sección "Entregas". */
export interface EntregaFormRow {
  /** Clave local estable (para React, el foco y los errores de la fila). Nunca va a la base. */
  key: string;
  /** id de la base si la entrega YA existía (solo al editar: la función de la base lo necesita para
   *  actualizarla en vez de borrarla y crearla de nuevo); null si es nueva. */
  id: string | null;
  /** '' = todavía no eligió. */
  clienteId: string;
  incidencias: string;
}

export interface ViajeFormValues {
  /** 'YYYY-MM-DD' */
  fecha: string;
  origen: string;
  destino: string;
  kmModo: KmModo;
  // Los tres textos se CONSERVAN si la persona cambia de modo y vuelve, pero solo se envían los del modo activo.
  kmInicial: string;
  kmFinal: string;
  kmRecorridos: string;
  ingreso: string;
  observaciones: string;
  entregas: EntregaFormRow[];
}

/** Campos sueltos del formulario (los de las entregas se anclan a su fila). */
export type ViajeFormField =
  | 'fecha'
  | 'origen'
  | 'destino'
  | 'kmInicial'
  | 'kmFinal'
  | 'kmRecorridos'
  | 'ingreso'
  | 'observaciones';

/** Orden en pantalla: se usa para llevar el foco al PRIMER campo con error (las entregas van después). */
export const VIAJE_FIELD_ORDER: readonly ViajeFormField[] = [
  'fecha',
  'origen',
  'destino',
  'kmInicial',
  'kmFinal',
  'kmRecorridos',
  'ingreso',
  'observaciones',
];

export type EntregaField = 'clienteId' | 'incidencias';

/** Orden dentro de una fila de entrega. */
export const ENTREGA_FIELD_ORDER: readonly EntregaField[] = ['clienteId', 'incidencias'];

export interface EntregaErrors {
  clienteId?: string;
  incidencias?: string;
}

export interface ViajeFormErrors {
  campos: Partial<Record<ViajeFormField, string>>;
  /** Error de la sección de entregas en conjunto (más de 100, o la lista de clientes sin cargar). */
  entregasGeneral?: string;
  /** Errores por fila, por la `key` local de la fila. */
  entregas: Record<string, EntregaErrors>;
}

export const SIN_ERRORES: ViajeFormErrors = { campos: {}, entregas: {} };

/** A dónde va el foco cuando falla la validación. */
export type ViajeFocusTarget =
  | { tipo: 'campo'; field: ViajeFormField }
  | { tipo: 'entregas' }
  | { tipo: 'entrega'; key: string; field: EntregaField };

export function emptyViajeValues(today: string): ViajeFormValues {
  return {
    fecha: today,
    origen: '',
    destino: '',
    kmModo: 'inicial-final',
    kmInicial: '',
    kmFinal: '',
    kmRecorridos: '',
    ingreso: '',
    observaciones: '',
    entregas: [],
  };
}

/** Una fila nueva (sin cliente elegido y sin `id`: todavía no existe en la base). */
export function newEntregaRow(newKey: () => string = generateUuid): EntregaFormRow {
  return { key: newKey(), id: null, clienteId: '', incidencias: '' };
}

/** Lo que el formulario necesita de un viaje guardado para editarlo. */
export interface ViajeEditable {
  fecha: string;
  origen: string;
  destino: string;
  km_inicial: number | string | null;
  km_final: number | string | null;
  km_recorridos: number | string | null;
  ingreso: number | string | null;
  observaciones: string | null;
  entregas: ReadonlyArray<{ id: string; cliente_id: string; incidencias: string | null }>;
}

/**
 * Al editar, el modo se deduce de lo guardado: si `km_recorridos` no es null → "Recorridos"; si no
 * (inicial / final, o sin km) → "Inicial y final", que es el modo por defecto.
 */
export function kmModoDe(viaje: Pick<ViajeEditable, 'km_recorridos'>): KmModo {
  return fromDbNumber(viaje.km_recorridos) !== null ? 'recorridos' : 'inicial-final';
}

export function valuesFromViaje(viaje: ViajeEditable, newKey: () => string = generateUuid): ViajeFormValues {
  return {
    fecha: viaje.fecha,
    origen: viaje.origen,
    destino: viaje.destino,
    kmModo: kmModoDe(viaje),
    // Km (1 decimal) e ingreso (2) con el separador del dispositivo: un solo separador se lee como decimal
    // y nunca caen en la regla de ambigüedad (solo aplica a litros).
    kmInicial: formatForInput(fromDbNumber(viaje.km_inicial)),
    kmFinal: formatForInput(fromDbNumber(viaje.km_final)),
    kmRecorridos: formatForInput(fromDbNumber(viaje.km_recorridos)),
    ingreso: formatForInput(fromDbNumber(viaje.ingreso)),
    observaciones: viaje.observaciones ?? '',
    entregas: viaje.entregas.map((entrega) => ({
      key: newKey(),
      id: entrega.id,
      clienteId: entrega.cliente_id,
      incidencias: entrega.incidencias ?? '',
    })),
  };
}

// ---------------------------------------------------------------------------
// Lo que se manda a la base (ya validado)
// ---------------------------------------------------------------------------

/** Columnas de `viajes` que escribe el formulario, TODAS explícitas (los `null` vacían el campo al editar).
 *  No incluye `camion_id` (se conserva el que ya tenía), `client_ref` (solo se manda al crear) ni lo que pone la base. */
export interface ViajeColumns {
  fecha: string;
  origen: string;
  destino: string;
  km_inicial: number | null;
  km_final: number | null;
  km_recorridos: number | null;
  observaciones: string | null;
  ingreso: number | null;
}

/** Una entrega lista para enviar. `id` null = nueva. */
export interface EntregaDato {
  id: string | null;
  cliente_id: string;
  incidencias: string | null;
}

export interface ViajeDatos {
  columns: ViajeColumns;
  entregas: EntregaDato[];
}

// ---------------------------------------------------------------------------
// Validación
// ---------------------------------------------------------------------------

export interface ValidarViajeContext {
  /** Hoy en hora local, 'YYYY-MM-DD'. La fecha no puede ser posterior. */
  today: string;
  /**
   * Los clientes conocidos (ya cargados), o `null` si la lista todavía no cargó (o falló). Con entregas y
   * sin lista no se puede comprobar que cada cliente exista, y la pantalla ni siquiera puede mostrar
   * cuál eligió cada fila: se pide cargarla antes de guardar.
   */
  clientes: ReadonlyArray<{ id: string }> | null;
}

export type ViajeValidation =
  | { ok: true; datos: ViajeDatos }
  | { ok: false; errors: ViajeFormErrors; focus: ViajeFocusTarget };

export const ORIGEN_VACIO_MESSAGE = 'Escribe el origen del viaje.';
export const DESTINO_VACIO_MESSAGE = 'Escribe el destino del viaje.';
export const origenLargoMessage = () => `El origen puede tener hasta ${MAX_TEXTO} caracteres.`;
export const destinoLargoMessage = () => `El destino puede tener hasta ${MAX_TEXTO} caracteres.`;
export const OBSERVACIONES_LARGO_MESSAGE = `Las observaciones pueden tener hasta ${MAX_OBSERVACIONES} caracteres.`;
export const INCIDENCIAS_LARGO_MESSAGE = `Las incidencias pueden tener hasta ${MAX_INCIDENCIAS} caracteres.`;
export const KM_INICIAL_FALTA_MESSAGE = 'Carga el km inicial.';
export const KM_FINAL_MENOR_MESSAGE = 'El km final no puede ser menor que el inicial.';
export const CLIENTE_FALTA_MESSAGE = 'Elige un cliente.';
export const ENTREGAS_DEMASIADAS_MESSAGE = `Un viaje admite hasta ${MAX_ENTREGAS} entregas.`;
export const CLIENTES_SIN_CARGAR_MESSAGE = 'Falta cargar la lista de clientes. Revisa la sección Entregas.';

type TextoValidation = { ok: true; value: string } | { ok: false; message: string };

/** Texto obligatorio recortado de 1 a `MAX_TEXTO` caracteres (code points, como `length()` de Postgres). */
function validateTextoObligatorio(raw: string, vacio: string, largo: string): TextoValidation {
  const value = raw.trim();
  const length = charLength(value, MAX_TEXTO);
  if (length < 1) return { ok: false, message: vacio };
  if (length > MAX_TEXTO) return { ok: false, message: largo };
  return { ok: true, value };
}

/** Texto opcional recortado de hasta `max` caracteres; vacío = null. */
function validateTextoOpcional(raw: string, max: number, largo: string): { ok: true; value: string | null } | { ok: false; message: string } {
  const value = raw.trim();
  if (charLength(value, max) > max) return { ok: false, message: largo };
  return { ok: true, value: value === '' ? null : value };
}

interface KmResult {
  errors: Partial<Record<'kmInicial' | 'kmFinal' | 'kmRecorridos', string>>;
  km_inicial: number | null;
  km_final: number | null;
  km_recorridos: number | null;
}

/**
 * Reglas de kilometraje (espejo de `viajes_chk_modo_km` y `viajes_chk_km_coherentes`):
 *  - Se valida y se envía SOLO el modo activo; los textos del otro quedan en `null` aunque tengan algo.
 *  - "Inicial y final": los dos son opcionales entre sí, pero no se puede cargar el final sin el inicial
 *    (el error se muestra en el inicial, que es el que falta) y el final no puede ser menor que el inicial.
 *    Solo el inicial es válido (viaje en curso).
 *  - "Recorridos": un solo campo, opcional, >= 0.
 *  - Cada valor es >= 0 con un decimal (`numeric(9,1)`).
 */
export function validateKm(values: Pick<ViajeFormValues, 'kmModo' | 'kmInicial' | 'kmFinal' | 'kmRecorridos'>): KmResult {
  const result: KmResult = { errors: {}, km_inicial: null, km_final: null, km_recorridos: null };

  if (values.kmModo === 'recorridos') {
    const recorridos = validateOptionalNumber(values.kmRecorridos, 'km', { allowZero: true });
    if (recorridos.ok) result.km_recorridos = toDbNumberOrNull(recorridos.value, 'km');
    else result.errors.kmRecorridos = recorridos.message;
    return result;
  }

  const inicial = validateOptionalNumber(values.kmInicial, 'km', { allowZero: true });
  const final = validateOptionalNumber(values.kmFinal, 'km', { allowZero: true });
  if (!inicial.ok) result.errors.kmInicial = inicial.message;
  if (!final.ok) result.errors.kmFinal = final.message;
  if (!inicial.ok || !final.ok) return result;

  if (final.value !== null && inicial.value === null) {
    result.errors.kmInicial = KM_INICIAL_FALTA_MESSAGE;
    return result;
  }
  // Se compara en décimas de km (enteros): sin ruido de coma flotante en la igualdad.
  if (final.value !== null && inicial.value !== null && toScaledInt(final.value, 'km') < toScaledInt(inicial.value, 'km')) {
    result.errors.kmFinal = KM_FINAL_MENOR_MESSAGE;
    return result;
  }

  result.km_inicial = toDbNumberOrNull(inicial.value, 'km');
  result.km_final = toDbNumberOrNull(final.value, 'km');
  return result;
}

/** Dónde poner el foco: el primer error en el orden VISUAL (campos, después la sección de entregas fila por fila). */
export function firstFocusTarget(errors: ViajeFormErrors, entregas: readonly EntregaFormRow[]): ViajeFocusTarget | null {
  const field = VIAJE_FIELD_ORDER.find((candidate) => errors.campos[candidate] !== undefined);
  if (field) return { tipo: 'campo', field };
  if (errors.entregasGeneral !== undefined) return { tipo: 'entregas' };
  for (const row of entregas) {
    const rowErrors = errors.entregas[row.key];
    if (!rowErrors) continue;
    const entregaField = ENTREGA_FIELD_ORDER.find((candidate) => rowErrors[candidate] !== undefined);
    if (entregaField) return { tipo: 'entrega', key: row.key, field: entregaField };
  }
  return null;
}

/**
 * Valida el formulario completo (espejo de los checks de la base) y arma los datos listos para enviar.
 *
 *  - fecha: válida, desde el 2000-01-01 hasta hoy (misma regla que Gastos).
 *  - origen y destino: obligatorios, recortados, 1 a 200 caracteres.
 *  - kilometraje: ver `validateKm`.
 *  - ingreso: opcional, >= 0 (0 es válido), `numeric(12,2)`.
 *  - observaciones: opcional, hasta 2000 caracteres (recortadas; vacías = null).
 *  - entregas: de 0 a 100 (cero es válido: no se exige una mínima); cada una con un cliente de la lista
 *    cargada e incidencias opcionales de hasta 2000 caracteres. Un mismo cliente puede estar en dos filas.
 */
export function validateViajeForm(values: ViajeFormValues, context: ValidarViajeContext): ViajeValidation {
  const campos: ViajeFormErrors['campos'] = {};
  const entregasErrors: ViajeFormErrors['entregas'] = {};
  let entregasGeneral: string | undefined;

  const fecha = validateFechaDeRegistro(values.fecha, context.today);
  if (!fecha.ok) campos.fecha = fecha.message;

  const origen = validateTextoObligatorio(values.origen, ORIGEN_VACIO_MESSAGE, origenLargoMessage());
  if (!origen.ok) campos.origen = origen.message;

  const destino = validateTextoObligatorio(values.destino, DESTINO_VACIO_MESSAGE, destinoLargoMessage());
  if (!destino.ok) campos.destino = destino.message;

  const km = validateKm(values);
  Object.assign(campos, km.errors);

  const ingreso = validateOptionalNumber(values.ingreso, 'dinero', { allowZero: true });
  if (!ingreso.ok) campos.ingreso = ingreso.message;

  const observaciones = validateTextoOpcional(values.observaciones, MAX_OBSERVACIONES, OBSERVACIONES_LARGO_MESSAGE);
  if (!observaciones.ok) campos.observaciones = observaciones.message;

  const entregas: EntregaDato[] = [];
  if (values.entregas.length > MAX_ENTREGAS) {
    entregasGeneral = ENTREGAS_DEMASIADAS_MESSAGE;
  } else if (values.entregas.length > 0 && context.clientes === null) {
    entregasGeneral = CLIENTES_SIN_CARGAR_MESSAGE;
  } else {
    const conocidos = new Set((context.clientes ?? []).map((cliente) => cliente.id));
    for (const row of values.entregas) {
      const rowErrors: EntregaErrors = {};
      if (row.clienteId === '' || !conocidos.has(row.clienteId)) rowErrors.clienteId = CLIENTE_FALTA_MESSAGE;
      const incidencias = validateTextoOpcional(row.incidencias, MAX_INCIDENCIAS, INCIDENCIAS_LARGO_MESSAGE);
      if (!incidencias.ok) rowErrors.incidencias = incidencias.message;
      if (rowErrors.clienteId !== undefined || rowErrors.incidencias !== undefined) {
        entregasErrors[row.key] = rowErrors;
      } else if (incidencias.ok) {
        entregas.push({ id: row.id, cliente_id: row.clienteId, incidencias: incidencias.value });
      }
    }
  }

  const errors: ViajeFormErrors = { campos, entregas: entregasErrors, ...(entregasGeneral ? { entregasGeneral } : {}) };
  const focus = firstFocusTarget(errors, values.entregas);
  if (focus) return { ok: false, errors, focus };

  // Si llegó hasta acá, fecha, origen, destino, ingreso y observaciones son válidos (TypeScript no lo sabe).
  if (!fecha.ok || !origen.ok || !destino.ok || !ingreso.ok || !observaciones.ok) {
    throw new Error('validateViajeForm: estado inconsistente');
  }

  return {
    ok: true,
    datos: {
      columns: {
        fecha: fecha.value,
        origen: origen.value,
        destino: destino.value,
        km_inicial: km.km_inicial,
        km_final: km.km_final,
        km_recorridos: km.km_recorridos,
        observaciones: observaciones.value,
        ingreso: toDbNumberOrNull(ingreso.value, 'dinero'),
      },
      entregas,
    },
  };
}
