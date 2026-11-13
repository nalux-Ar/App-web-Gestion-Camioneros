import { AuthApiError } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';

import {
  ACCOUNT_MAYBE_EXISTS_MESSAGE,
  CREDENCIALES_MESSAGE,
  NETWORK_ERROR_MESSAGE,
  SESSION_EXPIRED_MESSAGE,
  mapAuthError,
} from './auth-errors';

// Los textos de los errores de acceso (revisión de usabilidad, fila A12): dicen qué hacer a continuación, sin palabras difíciles
// («sesión», «email», «spam» a secas) y sin revelar si un correo tiene cuenta.
const api = (code: string, status = 400) => new AuthApiError('texto crudo del servidor', status, code);

const CODIGOS = [
  'captcha_failed',
  'invalid_credentials',
  'email_not_confirmed',
  'user_not_found',
  'over_request_rate_limit',
  'over_email_send_rate_limit',
  'over_sms_send_rate_limit',
  'user_already_exists',
  'email_exists',
  'identity_already_exists',
  'weak_password',
  'same_password',
  'signup_disabled',
  'email_provider_disabled',
  'session_expired',
  'session_not_found',
  'refresh_token_not_found',
  'refresh_token_already_used',
  'email_address_invalid',
  'validation_failed',
  'bad_json',
  'otp_expired',
];

describe('mapAuthError: credenciales', () => {
  it('contraseña o correo malos: el texto dice qué hacer a continuación y cita el botón por su nombre', () => {
    expect(mapAuthError(api('invalid_credentials', 400))).toBe(
      'El correo o la contraseña no coinciden. Revísalos o toca «Olvidé mi contraseña».',
    );
    expect(CREDENCIALES_MESSAGE).toContain('«Olvidé mi contraseña»');
  });

  it('una cuenta que no existe da EXACTAMENTE el mismo texto (no revela si un correo tiene cuenta)', () => {
    expect(mapAuthError(api('user_not_found'))).toBe(mapAuthError(api('invalid_credentials')));
  });

  it('no manda a nadie en particular: no nombra a quien dio la cuenta ni habla de cuentas cerradas o borradas', () => {
    expect(CREDENCIALES_MESSAGE).not.toMatch(/avisa|quien|administrador|cerr|borr|elimin/i);
  });

  it('el texto del servidor no se filtra nunca', () => {
    for (const codigo of CODIGOS) expect(mapAuthError(api(codigo)), codigo).not.toContain('texto crudo del servidor');
  });
});

describe('mapAuthError: sesión que ya no sirve', () => {
  it('«Por seguridad, ingresa de nuevo.» para todos los códigos de sesión vencida', () => {
    for (const codigo of ['session_expired', 'session_not_found', 'refresh_token_not_found', 'refresh_token_already_used']) {
      expect(mapAuthError(api(codigo, 401)), codigo).toBe(SESSION_EXPIRED_MESSAGE);
    }
    expect(SESSION_EXPIRED_MESSAGE).toBe('Por seguridad, ingresa de nuevo.');
  });

  it('no se puede leer como «tu cuenta se cerró» ni «se borró»: no nombra la cuenta ni dice que algo se cerró o venció', () => {
    expect(SESSION_EXPIRED_MESSAGE).not.toMatch(/cuenta|cerr|borr|elimin|venci|sesi[oó]n/i);
  });
});

describe('mapAuthError: correo y red', () => {
  it('correo sin confirmar: dónde buscar el mensaje, con los nombres de las carpetas', () => {
    expect(mapAuthError(api('email_not_confirmed'))).toBe(
      'Todavía no confirmaste tu cuenta. Busca el correo de confirmación en Recibidos, Spam o Correo no deseado.',
    );
  });

  it('sin señal: el texto neutro, que sirve para ingresar y para leer (no habla de guardar ni de «Reintentar»)', () => {
    expect(mapAuthError(new TypeError('Failed to fetch'))).toBe(NETWORK_ERROR_MESSAGE);
    expect(NETWORK_ERROR_MESSAGE).toBe('No hay señal. Revisa la conexión y prueba de nuevo.');
    expect(NETWORK_ERROR_MESSAGE).not.toMatch(/guard|escrito|Reintentar/i);
  });

  it('crear una cuenta con un correo que quizá ya existe: no confirma que exista', () => {
    expect(mapAuthError(api('user_already_exists'))).toBe(ACCOUNT_MAYBE_EXISTS_MESSAGE);
    expect(ACCOUNT_MAYBE_EXISTS_MESSAGE).not.toMatch(/ya existe/i);
  });
});

describe('mapAuthError: el idioma de todos los mensajes', () => {
  it('español neutro de «tú»: nada de «email», voseo, «acá», «sesión», «spam» solo ni «$»', () => {
    const textos = [...CODIGOS.map((codigo) => mapAuthError(api(codigo))), mapAuthError(api('x', 503)), mapAuthError(new Error('otra cosa'))];
    for (const texto of textos) {
      expect(texto).not.toMatch(/\bemail\b|\bacá\b|\$|sesi[oó]n/i);
      expect(texto).not.toMatch(/\b(?:tenés|podés|revisá|probá|esperá|ingresá|elegí|tocá|usá|escribí)\b/i);
      // «Spam» solo aparece acompañado de «Recibidos» y de «Correo no deseado», como lo ve la persona en su correo.
      if (/spam/i.test(texto)) expect(texto).toContain('Recibidos, Spam o Correo no deseado');
    }
  });
});
