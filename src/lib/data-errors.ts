import { isAuthApiError, isAuthRetryableFetchError, isAuthSessionMissingError } from '@supabase/supabase-js';

import {
  GENERIC_ERROR_MESSAGE,
  INVALID_DATA_MESSAGE,
  NETWORK_ERROR_MESSAGE,
  NETWORK_MESSAGE_PATTERN,
  SERVER_ERROR_MESSAGE,
  SESSION_EXPIRED_MESSAGE,
} from '@/features/auth/auth-errors';

/**
 * Errores al leer/escribir datos (PostgREST, funciones RPC): nunca se muestra
 * el texto crudo del servidor (puede traer nombres de tablas, constraints o
 * SQL). Todo pasa por `mapDataError`. Para Auth existe `mapAuthError`
 * (features/auth/auth-errors.ts); esto es el equivalente para los datos.
 *
 * Qué llega acá desde supabase-js:
 *  - Consultas (`supabase.from(...)`): un objeto `{ message, details, hint,
 *    code }` (plano, NO `Error`; con `.throwOnError()` es un `PostgrestError`).
 *    `code` es el SQLSTATE de Postgres ("23514") o el código de PostgREST
 *    ("PGRST116"). Una falla de red llega como `{ message: 'TypeError: Failed
 *    to fetch', code: '' }`. El status HTTP NO viaja dentro del error: por eso
 *    existe `unwrap()` (src/lib/db.ts), que lo copia a un `DataRequestError`.
 *  - Auth: `AuthApiError` (con `code` tipo 'session_expired') o
 *    `AuthSessionMissingError`.
 *  - Errores propios (`RecordNotFoundError`, `DataRequestError`, `UserMessageError`).
 */

export type DataErrorKind =
  | 'network'
  | 'timeout'
  | 'session'
  | 'invalid-data'
  | 'foreign-key'
  | 'unique'
  | 'permission'
  | 'not-found'
  | 'server'
  | 'unknown';

/** Mensajes propios de la pantalla para los casos que dependen del contexto. */
export interface DataErrorContext {
  /** Violación de FK (23503). Al ELIMINAR: "No se puede eliminar porque tiene gastos asociados." */
  foreignKey?: string;
  /**
   * La MISMA clase 23503 puede venir de constraints distintos (en un gasto: la FK del viaje, o el trigger de la
   * categoría, que no nombra ningún constraint). Mapa `nombre del constraint → mensaje`: si el `message` o los
   * `details` del error nombran ese constraint, gana este mensaje; si no, vale `foreignKey`. El nombre del
   * constraint solo se usa para elegir el mensaje: nunca se muestra.
   */
  foreignKeyByConstraint?: Readonly<Record<string, string>>;
  /** Con `true`, una violación de FK se considera reintentable (`isRetryableDataError`): para un borrado que puede
   *  chocar con una carrera y que es seguro repetir. Por defecto una FK no se reintenta (daría lo mismo). */
  foreignKeyRetryable?: boolean;
  /**
   * Lo mismo que `foreignKeyByConstraint`, pero para CUALQUIER clase de error: un check (23514), un único (23505), una FK
   * (23503) o un error propio de un trigger que pone un texto fijo en el mensaje (p. ej. el 55000 con `camion_archivado` de
   * la migración 010). Mapa `nombre del constraint (o texto fijo) → mensaje`: si el `message` o los `details` del error lo
   * nombran (`mentionsConstraint`), gana ese mensaje y el error NO se reintenta (con los mismos datos daría lo mismo:
   * hay que cambiar algo). Se mira antes que todo lo demás. El nombre solo sirve para elegir el mensaje: nunca se muestra.
   */
  messagesByConstraint?: Readonly<Record<string, string>>;
  /**
   * PostgreSQL 18 devuelve 23001 (`restrict_violation`) en vez de 23503 cuando un DELETE choca con un
   * `ON DELETE RESTRICT` (la base real hoy es PG 17 y da 23503). Con `true`, en ESTA pantalla un 23001 se trata
   * exactamente igual que una violación de FK: mismo mensaje (`foreignKey`) y mismo reintento
   * (`foreignKeyRetryable`). Sin el flag, 23001 se sigue clasificando como el resto de la clase 23 ("datos
   * inválidos"): es una decisión de la pantalla, no un cambio global.
   */
  restrictAsForeignKey?: boolean;
  /** Violación de único (23505). */
  unique?: string;
  /** No encontrado (PGRST116, P0002 de las funciones de la base, o 0 filas). */
  notFound?: string;
  /** Sin permiso (42501). */
  permission?: string;
  /** Check, datos faltantes o con formato inválido (23514, 23502, clase 22). */
  invalidData?: string;
}

/**
 * Para lanzar cuando un UPDATE/DELETE no afectó ninguna fila. PostgREST no
 * falla en ese caso: con RLS, tocar un registro ajeno (o que ya no existe)
 * da "0 filas" sin error. Pedir `.select()` en la mutación y, si vuelve
 * vacío, `throw new RecordNotFoundError()`. A propósito no distingue "no
 * existe" de "es de otro tenant" (regla de seguridad del proyecto).
 *
 * En un BORRADO conviene tratarlo como éxito ("ya no está", que es lo que se
 * quería): `ConfirmDelete` lo hace solo. En una EDICIÓN no: ahí sí hay que
 * avisar "No encontramos ese registro".
 */
export class RecordNotFoundError extends Error {
  constructor() {
    super('Registro no encontrado');
    this.name = 'RecordNotFoundError';
  }
}

/**
 * Error propio cuyo mensaje para el usuario ya viene armado (en español, sin texto del servidor), para los casos
 * que ninguna clase de error describe bien: p. ej. "los gastos ya quedaron sin viaje, pero el viaje no se borró".
 * `mapDataError` devuelve `userMessage` tal cual y `isRetryableDataError` respeta `retryable`, con cualquier
 * contexto. El error original, si lo hay, va en `cause` (interno: no se muestra).
 */
export class UserMessageError extends Error {
  readonly userMessage: string;
  readonly retryable: boolean;

  constructor(userMessage: string, options: { retryable: boolean; cause?: unknown }) {
    super(userMessage, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'UserMessageError';
    this.userMessage = userMessage;
    this.retryable = options.retryable;
  }
}

/**
 * Error de una consulta de supabase-js ({ data, error, status }) convertido
 * en `Error` real, conservando el `code` y el `status` HTTP (que el objeto
 * `error` de supabase-js no trae). Lo arma `unwrap()`. El `message` es
 * interno (para depurar): a la pantalla solo llega `mapDataError(...)`.
 */
export class DataRequestError extends Error {
  readonly code: string;
  readonly status: number | undefined;
  /** `details` de PostgREST (a veces trae el nombre del constraint). Interno: no se muestra. */
  readonly details: string;

  constructor(source: { message?: unknown; code?: unknown; details?: unknown }, status?: number) {
    super(typeof source.message === 'string' ? source.message : 'Error de datos');
    this.name = 'DataRequestError';
    this.code = typeof source.code === 'string' ? source.code : '';
    this.details = typeof source.details === 'string' ? source.details : '';
    this.status = status;
  }
}

interface ErrorInfo {
  code: string;
  message: string;
  name: string;
  status: number | undefined;
}

function readErrorInfo(error: unknown): ErrorInfo {
  if (typeof error !== 'object' || error === null) return { code: '', message: '', name: '', status: undefined };
  const record = error as Record<string, unknown>;
  return {
    code: typeof record.code === 'string' ? record.code : '',
    message: typeof record.message === 'string' ? record.message : '',
    name: typeof record.name === 'string' ? record.name : '',
    status: typeof record.status === 'number' ? record.status : undefined,
  };
}

const SQLSTATE = /^[0-9A-Z]{5}$/;
const POSTGREST_CODE = /^PGRST\d{3}$/;

/** Códigos de sesión de Auth (ver @supabase/auth-js/src/lib/error-codes.ts). */
const AUTH_SESSION_CODES = new Set([
  'session_expired',
  'session_not_found',
  'refresh_token_not_found',
  'refresh_token_already_used',
  'bad_jwt',
  'no_authorization',
]);

/** Pedido cortado por timeout o abortado (`AbortSignal.timeout`, ver `writeTimeoutSignal` en db.ts).
 *  postgrest-js lo devuelve como `{ message: 'TimeoutError: ...' }`. */
const TIMEOUT_PATTERN = /^(TimeoutError|AbortError)\b/;

function classifyByCode(code: string): DataErrorKind | null {
  if (POSTGREST_CODE.test(code)) {
    if (code === 'PGRST116') return 'not-found'; // .single() sin exactamente 1 fila
    if (code === 'PGRST301' || code === 'PGRST302' || code === 'PGRST303') return 'session'; // JWT vencido / ausente / inválido
    if (code.startsWith('PGRST0')) return 'server'; // PGRST000-003: sin conexión a la base, timeout de pool
    return 'unknown'; // PGRST1xx/2xx: pedido mal armado o esquema desactualizado (bug, no del usuario)
  }

  if (!SQLSTATE.test(code)) return null;

  if (code === '23503') return 'foreign-key';
  if (code === '23505') return 'unique';
  // P0002 (no_data_found) lo levantan las funciones de la base cuando el registro (o una de sus entregas) no
  // existe o cambió: `actualizar_viaje_con_entregas`. Reintentar con los mismos datos da lo mismo.
  if (code === 'P0002') return 'not-found';
  if (code === '42501') return 'permission'; // RLS o trigger de la base
  if (code === '28000' || code === '28P01') return 'session'; // autorización inválida
  const sqlClass = code.slice(0, 2);
  if (sqlClass === '22' || sqlClass === '23') return 'invalid-data'; // datos fuera de rango/formato; check (23514), not null (23502)
  if (['08', '40', '53', '54', '55', '57', '58', 'XX'].includes(sqlClass)) return 'server'; // conexión, deadlock, recursos, timeout
  return 'unknown';
}

/**
 * ¿Falló la conexión (no hubo respuesta del servidor)? Más estricto que
 * `isNetworkError` de auth-errors.ts, que trata CUALQUIER `TypeError` como
 * red: acá un `TypeError` de programación ("Cannot read properties of
 * undefined") NO se muestra como "No hay conexión". Solo cuenta si no hay
 * conexión según el navegador, si es el error de fetch de Auth, o si el
 * mensaje es el de un fetch fallido ("Failed to fetch", "Load failed",
 * "NetworkError…") en un error SIN código de servidor.
 */
function isConnectionFailure(error: unknown, code: string, message: string): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true;
  if (isAuthRetryableFetchError(error)) return true;
  // Un AuthApiError es una respuesta del servidor: hubo red.
  if (isAuthApiError(error)) return false;
  if (code) return false;
  return NETWORK_MESSAGE_PATTERN.test(message);
}

/** Qué clase de problema es, sin texto. Para decidir mensajes, reintentos, etc. */
export function classifyDataError(error: unknown): DataErrorKind {
  if (error instanceof RecordNotFoundError) return 'not-found';

  const { code, message, name, status } = readErrorInfo(error);

  const byCode = code ? classifyByCode(code) : null;
  if (byCode && byCode !== 'unknown') return byCode;

  if (isAuthSessionMissingError(error)) return 'session';
  if (isAuthApiError(error) && AUTH_SESSION_CODES.has(error.code ?? '')) return 'session';

  // Timeout/abort del lado del cliente (antes que "red": si el pedido salió
  // pero no volvió a tiempo, puede haber llegado al servidor).
  if (name === 'TimeoutError' || name === 'AbortError' || (!code && TIMEOUT_PATTERN.test(message))) return 'timeout';

  if (isConnectionFailure(error, code, message)) return 'network';

  if (status !== undefined) {
    if (status === 401) return 'session';
    if (status === 403) return 'permission';
    if (status === 404) return 'not-found';
    if (status >= 500) return 'server'; // 502/504 de un gateway: no traen código de PostgREST
  }

  return byCode ?? 'unknown';
}

/**
 * ¿El `message` o los `details` del error nombran este constraint? Postgres lo escribe entre comillas
 * ("... violates foreign key constraint "gastos_viaje_fk"") y PostgREST copia ambos campos. Compara el nombre
 * COMPLETO (por tokens): `gastos_viaje_fk` no coincide con `gastos_viaje_fk_viejo`. Solo sirve para decidir
 * qué mensaje mostrar: el nombre nunca llega a la pantalla.
 */
export function mentionsConstraint(error: unknown, constraint: string): boolean {
  if (typeof error !== 'object' || error === null || constraint === '') return false;
  const { message, details } = error as Record<string, unknown>;
  const text = [message, details].filter((part): part is string => typeof part === 'string').join('\n');
  return text.split(/[^\w]+/).includes(constraint);
}

/** ¿Es una violación de FK (23503) de ESE constraint? */
export function isForeignKeyViolationOf(error: unknown, constraint: string): boolean {
  return classifyDataError(error) === 'foreign-key' && mentionsConstraint(error, constraint);
}

/** SQLSTATE `restrict_violation`: un DELETE choca con un `ON DELETE RESTRICT` en PostgreSQL 18 (en 17 es 23503). */
const RESTRICT_VIOLATION = '23001';

/** La clase del error EN ESTA pantalla: igual a `classifyDataError`, salvo que con `restrictAsForeignKey` un 23001
 *  cuenta como violación de FK. Sin ese flag no cambia nada. */
function kindInContext(error: unknown, context: DataErrorContext): DataErrorKind {
  const kind = classifyDataError(error);
  if (context.restrictAsForeignKey === true && readErrorInfo(error).code === RESTRICT_VIOLATION) return 'foreign-key';
  return kind;
}

/** El mensaje propio del contexto para el constraint (o texto fijo) que nombra el error, si lo hay. */
function messageByConstraint(error: unknown, context: DataErrorContext): string | undefined {
  return Object.entries(context.messagesByConstraint ?? {}).find(([constraint]) => mentionsConstraint(error, constraint))?.[1];
}

/** ¿Tiene sentido ofrecer "Reintentar" con los mismos datos? Con un check
 *  violado, un permiso negado o un registro inexistente, reintentar da lo mismo.
 *  Con el `context` de la pantalla, una FK puede declararse reintentable (`foreignKeyRetryable`), y un error que nombra
 *  un constraint de `messagesByConstraint` nunca se reintenta. */
export function isRetryableDataError(error: unknown, context: DataErrorContext = {}): boolean {
  if (error instanceof UserMessageError) return error.retryable;
  if (messageByConstraint(error, context) !== undefined) return false;
  const kind = kindInContext(error, context);
  if (kind === 'foreign-key' && context.foreignKeyRetryable === true) return true;
  return kind === 'network' || kind === 'timeout' || kind === 'server' || kind === 'unknown';
}

const DEFAULT_MESSAGES: Record<DataErrorKind, string> = {
  network: NETWORK_ERROR_MESSAGE,
  timeout: 'Tardó demasiado en responder. Revisa tu conexión e inténtalo de nuevo.',
  session: SESSION_EXPIRED_MESSAGE,
  'invalid-data': INVALID_DATA_MESSAGE,
  'foreign-key': 'No se puede completar la acción porque este registro está relacionado con otros datos.',
  unique: 'Ya existe un registro con esos datos.',
  permission: 'No tienes permiso para hacer esto.',
  'not-found': 'No encontramos ese registro.',
  server: SERVER_ERROR_MESSAGE,
  unknown: GENERIC_ERROR_MESSAGE,
};

/** Mensaje en español neutro para mostrar al usuario. Nunca texto del servidor. */
export function mapDataError(error: unknown, context: DataErrorContext = {}): string {
  if (error instanceof UserMessageError) return error.userMessage;
  const porConstraint = messageByConstraint(error, context);
  if (porConstraint !== undefined) return porConstraint;
  const kind = kindInContext(error, context);
  switch (kind) {
    case 'foreign-key': {
      const porConstraint = Object.entries(context.foreignKeyByConstraint ?? {}).find(([constraint]) =>
        mentionsConstraint(error, constraint),
      );
      return porConstraint?.[1] ?? context.foreignKey ?? DEFAULT_MESSAGES[kind];
    }
    case 'unique':
      return context.unique ?? DEFAULT_MESSAGES[kind];
    case 'not-found':
      return context.notFound ?? DEFAULT_MESSAGES[kind];
    case 'permission':
      return context.permission ?? DEFAULT_MESSAGES[kind];
    case 'invalid-data':
      return context.invalidData ?? DEFAULT_MESSAGES[kind];
    default:
      return DEFAULT_MESSAGES[kind];
  }
}
