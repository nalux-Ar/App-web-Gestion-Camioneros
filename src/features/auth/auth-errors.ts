import { isAuthApiError, isAuthRetryableFetchError } from '@supabase/supabase-js';

/**
 * Nunca se muestra el mensaje crudo del servidor: siempre pasa por acá.
 * Mapea los códigos de error de Supabase Auth (ver
 * @supabase/auth-js/src/lib/error-codes.ts) a mensajes propios, amables y
 * en español neutro y simple.
 */
export function isNetworkError(error: unknown): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true;
  if (isAuthRetryableFetchError(error)) return true;
  if (error instanceof TypeError) return true; // fetch() tira TypeError si no hay red
  if (error instanceof Error && /network|fetch/i.test(error.message)) return true;
  return false;
}

export const NETWORK_ERROR_MESSAGE = 'No hay conexión. Revisa la señal y prueba de nuevo.';
const GENERIC_MESSAGE = 'Ocurrió un problema. Prueba de nuevo en un momento.';

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
      return 'Tu sesión venció. Vuelve a ingresar.';
    case 'email_address_invalid':
    case 'validation_failed':
    case 'bad_json':
      return 'Revisa los datos que ingresaste.';
    case 'otp_expired':
      return 'El enlace venció. Pide uno nuevo.';
    default:
      break;
  }

  if (typeof status === 'number' && status >= 500) {
    return 'El servicio no está disponible en este momento. Prueba de nuevo en un rato.';
  }

  return GENERIC_MESSAGE;
}
