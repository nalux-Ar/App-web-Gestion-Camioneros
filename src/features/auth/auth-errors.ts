import { isAuthApiError, isAuthRetryableFetchError } from '@supabase/supabase-js';

/**
 * Nunca se muestra el mensaje crudo del servidor: siempre pasa por acá.
 * Mapea los códigos de error de Supabase Auth (ver
 * @supabase/auth-js/src/lib/error-codes.ts) a mensajes propios, amables y
 * en español neutro y simple.
 */
/** Mensajes de fetch() cuando no hay red, según el navegador: Chrome "Failed
 *  to fetch", Firefox "NetworkError when attempting to fetch resource",
 *  Safari/iOS "Load failed". Exportado para que `data-errors.ts` reconozca
 *  también los errores de red que supabase-js devuelve como objetos planos
 *  (no `Error`) en las consultas a la base. */
export const NETWORK_MESSAGE_PATTERN = /network|fetch|load failed/i;

export function isNetworkError(error: unknown): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true;
  if (isAuthRetryableFetchError(error)) return true;
  // Un AuthApiError es una RESPUESTA del servidor (hubo red): su mensaje no
  // dice nada de la conexión, aunque contenga "fetch" o "network".
  if (isAuthApiError(error)) return false;
  if (error instanceof TypeError) return true; // fetch() tira TypeError si no hay red
  if (error instanceof Error && NETWORK_MESSAGE_PATTERN.test(error.message)) return true;
  return false;
}

export const NETWORK_ERROR_MESSAGE = 'No hay conexión. Revisa la señal y prueba de nuevo.';
export const GENERIC_ERROR_MESSAGE = 'Ocurrió un problema. Prueba de nuevo en un momento.';
export const SESSION_EXPIRED_MESSAGE = 'Tu sesión venció. Vuelve a ingresar.';
export const INVALID_DATA_MESSAGE = 'Revisa los datos que ingresaste.';
export const SERVER_ERROR_MESSAGE = 'El servicio no está disponible en este momento. Prueba de nuevo en un rato.';

export const CAPTCHA_ERROR_MESSAGE = 'No pudimos verificar que no eres un robot. Prueba de nuevo.';

/** Supabase Auth rechazó el token de Turnstile (código `captcha_failed`:
 *  token vencido, ya usado o inválido). */
export function isCaptchaError(error: unknown): boolean {
  return isAuthApiError(error) && error.code === 'captcha_failed';
}

/**
 * Mensaje neutral para "puede que este email ya tenga cuenta", usado cuando
 * Supabase tira un error explícito (`user_already_exists` y variantes; pasa
 * con "Confirm email" desactivado). Con la confirmación activada el registro
 * no da error y RegisterPage muestra "Revisa tu correo" para ambos casos.
 * A propósito NO dice "ya existe una cuenta":
 * eso confirmaría la existencia del email de forma explícita. El texto
 * sugiere ingresar o recuperar contraseña sin afirmar nada.
 */
export const ACCOUNT_MAYBE_EXISTS_MESSAGE =
  'No pudimos crear la cuenta con esos datos. Si ya te registraste antes, intenta ingresar o recuperar la contraseña.';

export function mapAuthError(error: unknown): string {
  if (isNetworkError(error)) return NETWORK_ERROR_MESSAGE;

  const code = isAuthApiError(error) ? error.code : undefined;
  const status = isAuthApiError(error) ? error.status : undefined;

  switch (code) {
    case 'captcha_failed':
      return CAPTCHA_ERROR_MESSAGE;
    case 'invalid_credentials':
      return 'El email o la contraseña no son correctos.';
    case 'email_not_confirmed':
      return 'Todavía no confirmaste tu cuenta. Revisa tu correo (y la carpeta de spam).';
    case 'user_not_found':
      return 'El email o la contraseña no son correctos.';
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
    case 'over_sms_send_rate_limit':
      return 'Hiciste muchos intentos. Espera unos minutos y prueba de nuevo.';
    case 'user_already_exists':
    case 'email_exists':
    case 'identity_already_exists':
      return ACCOUNT_MAYBE_EXISTS_MESSAGE;
    case 'weak_password':
      return 'La contraseña es muy débil. Usa al menos 8 caracteres, con una letra y un número.';
    case 'same_password':
      return 'La contraseña nueva tiene que ser distinta de la que ya tenías.';
    case 'signup_disabled':
    case 'email_provider_disabled':
      return 'No se pueden crear cuentas nuevas en este momento. Prueba más tarde.';
    case 'session_expired':
    case 'session_not_found':
    case 'refresh_token_not_found':
    case 'refresh_token_already_used':
      return SESSION_EXPIRED_MESSAGE;
    case 'email_address_invalid':
    case 'validation_failed':
    case 'bad_json':
      return INVALID_DATA_MESSAGE;
    case 'otp_expired':
      return 'El enlace venció. Pide uno nuevo.';
    default:
      break;
  }

  if (typeof status === 'number' && status >= 500) {
    return SERVER_ERROR_MESSAGE;
  }

  return GENERIC_ERROR_MESSAGE;
}
