import { supabase } from './supabase';
import { markRecoveryPending } from './recovery-lock';

/**
 * Con `detectSessionInUrl: false` (ver src/lib/supabase.ts), supabase-js
 * ya NO procesa el fragmento `#access_token=...` de la URL por su cuenta.
 * Lo hacemos acá, a propósito, por un motivo concreto: la implementación
 * de supabase-js limpia el fragmento con `window.location.hash = ''`, que
 * en la mayoría de los navegadores CREA UNA ENTRADA NUEVA en el historial
 * (no reemplaza la actual). Resultado: apretando "atrás" una vez se vuelve
 * a la URL con `access_token`/`refresh_token` en texto plano en la barra
 * de direcciones (y en el historial del navegador). Achicar esa ventana
 * es el único propósito de este archivo: leer el hash, sacarlo de la URL
 * con `history.replaceState` (no agrega entrada) ANTES de cualquier otra
 * cosa, y recién después validar/usar los tokens.
 *
 * Sigue siendo flujo IMPLÍCITO (no PKCE, no `token_hash`): los tokens
 * siguen viajando en el fragmento del link del mail, tal cual antes. Lo
 * único que cambia es quién los lee de la URL y cuándo se limpian.
 */

type RecoveryHashType = 'recovery' | 'signup' | 'email_change' | 'magiclink' | 'invite' | (string & {});

interface ParsedAuthHash {
  accessToken?: string;
  refreshToken?: string;
  type?: RecoveryHashType;
  errorCode?: string;
  error?: string;
}

function parseAuthHash(hash: string): ParsedAuthHash {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const params = new URLSearchParams(raw);

  return {
    accessToken: params.get('access_token') ?? undefined,
    refreshToken: params.get('refresh_token') ?? undefined,
    type: (params.get('type') ?? undefined) as RecoveryHashType | undefined,
    errorCode: params.get('error_code') ?? undefined,
    error: params.get('error') ?? undefined,
    // OJO: nunca leemos/guardamos `error_description` en ningún lado más
    // que para descartarla: puede traer texto arbitrario del servidor y
    // la regla del proyecto es no mostrar mensajes crudos del backend.
  };
}

export interface AuthHashResult {
  /** true si el hash traía un link de recuperación y se pudo abrir sesión. */
  recoveryPending: boolean;
  /** true si el hash traía un error (link vencido/ya usado/inválido). */
  hadError: boolean;
}

const NO_OP_RESULT: AuthHashResult = { recoveryPending: false, hadError: false };

/**
 * Se llama una única vez, apenas arranca la app (ver src/main.tsx), antes
 * de montar cualquier pantalla. Nunca hace `console.log`/`console.warn`
 * con el contenido del hash (ni con los tokens ni con `error_description`):
 * en consola de un navegador compartido eso sería tan filtración como
 * dejarlo en la URL.
 */
export async function processAuthHash(): Promise<AuthHashResult> {
  const hash = window.location.hash;
  if (!hash || hash === '#') return NO_OP_RESULT;

  const parsed = parseAuthHash(hash);
  const hasTokens = Boolean(parsed.accessToken && parsed.refreshToken);
  const hasError = Boolean(parsed.error || parsed.errorCode);

  if (!hasTokens && !hasError) return NO_OP_RESULT;

  // Síncrono y antes de cualquier `await`: saca los tokens/el error de la
  // URL ya mismo, sin agregar una entrada nueva al historial.
  const cleanUrl = `${window.location.pathname}${window.location.search}`;
  window.history.replaceState(window.history.state, '', cleanUrl);

  if (hasError) {
    return { recoveryPending: false, hadError: true };
  }

  if (!parsed.accessToken || !parsed.refreshToken) return NO_OP_RESULT;

  const { error } = await supabase.auth.setSession({
    access_token: parsed.accessToken,
    refresh_token: parsed.refreshToken,
  });

  if (error) {
    return { recoveryPending: false, hadError: true };
  }

  if (parsed.type === 'recovery') {
    markRecoveryPending();
    return { recoveryPending: true, hadError: false };
  }

  // Otros `type` (signup, email_change, magiclink, invite): sesión normal,
  // no hay nada especial que bloquear.
  return { recoveryPending: false, hadError: false };
}
