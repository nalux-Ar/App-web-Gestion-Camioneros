import { supabase } from './supabase';
import { markRecoveryPending } from './recovery-lock';

/**
 * Único punto de entrada que interpreta cómo vuelve el usuario a la app
 * desde un correo de Supabase Auth. Se llama una sola vez, al arrancar
 * (ver src/main.tsx), antes de montar cualquier pantalla. Maneja DOS
 * formatos de enlace:
 *
 * 1) RECUPERACIÓN DE CONTRASEÑA — `?token_hash=...&type=recovery` (query).
 *    La plantilla del correo de recuperación es
 *    `{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=recovery`, y el
 *    token se canjea con `supabase.auth.verifyOtp(...)`.
 *
 *    Por qué no `{{ .ConfirmationURL }}`: ese enlace pasa primero por el
 *    endpoint /verify de Supabase, que consume el token de un solo uso con
 *    un simple GET. Gmail y otros clientes/antivirus PRECARGAN los enlaces
 *    de los correos para escanearlos, así que el token se gastaba antes
 *    del clic real y el usuario veía "el enlace venció o ya se usó" en su
 *    primer clic. Con `token_hash` en el query, el GET del escáner solo
 *    descarga el HTML estático de la app: no ejecuta JavaScript, y el token
 *    se consume recién cuando el navegador del usuario corre este módulo y
 *    llama a `verifyOtp`.
 *
 * 2) FRAGMENTO — `#access_token=...&refresh_token=...&type=...` o
 *    `#error=...&error_code=...`. Es lo que siguen usando los correos que
 *    todavía van con `{{ .ConfirmationURL }}` (confirmación de registro si
 *    se activa "Confirm email", cambio de email) y cualquier correo viejo de
 *    recuperación que haya quedado en una bandeja de entrada.
 *
 * Con `detectSessionInUrl: false` (ver src/lib/supabase.ts) supabase-js ya
 * NO lee la URL por su cuenta. Lo hacemos acá porque la limpieza de
 * supabase-js para el fragmento (`location.hash = ''`) agrega una entrada
 * nueva al historial y deja los tokens visibles al apretar "atrás". Acá, en
 * cambio, lo sensible se saca de la URL con `history.replaceState` (no
 * agrega entrada) de forma SÍNCRONA y ANTES de cualquier `await`; recién
 * después se usan los valores ya leídos.
 *
 * Reglas que este módulo respeta a propósito:
 * - Nunca hace `console.*` con `token_hash`, tokens ni `error_description`
 *   (en un navegador compartido la consola filtra tanto como la URL).
 * - Nunca guarda `token_hash` ni tokens en storage propio ni los propaga a
 *   otra URL (por ejemplo, `?volver=`): solo viven en variables locales
 *   hasta que se canjean.
 * - No lee `error_description`: puede traer texto arbitrario del servidor y
 *   la regla del proyecto es no mostrar mensajes crudos del backend.
 * - Cualquier fallo (enlace vencido/usado, sin red, excepción inesperada)
 *   termina en "no hay sesión": la pantalla de restablecer contraseña
 *   muestra su mensaje genérico de enlace vencido. Nunca se rompe el
 *   arranque de la app por esto.
 */

interface ParsedAuthFragment {
  accessToken?: string;
  refreshToken?: string;
  type?: string;
  errorCode?: string;
  error?: string;
}

function parseAuthFragment(hash: string): ParsedAuthFragment {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const params = new URLSearchParams(raw);

  return {
    accessToken: params.get('access_token') ?? undefined,
    refreshToken: params.get('refresh_token') ?? undefined,
    type: params.get('type') ?? undefined,
    errorCode: params.get('error_code') ?? undefined,
    error: params.get('error') ?? undefined,
  };
}

export interface AuthRedirectResult {
  /** true si el enlace era de recuperación y se pudo abrir sesión. */
  recoveryPending: boolean;
  /** true si el enlace traía un error o no se pudo canjear (vencido/usado). */
  hadError: boolean;
}

const NO_OP_RESULT: AuthRedirectResult = { recoveryPending: false, hadError: false };
const ERROR_RESULT: AuthRedirectResult = { recoveryPending: false, hadError: true };

interface UrlInspection {
  /** `token_hash` a canjear: solo si vino con `type=recovery` exacto. */
  recoveryTokenHash: string | null;
  /** Fragmento con tokens o error (solo si trae algo de eso). */
  fragment: ParsedAuthFragment | null;
  /** URL ya sin nada sensible, para `history.replaceState`. */
  cleanUrl: string;
}

/** Clave de query decodificada como lo hace `URLSearchParams` (`+` = espacio,
 *  secuencias `%XX`), pero sin tirar si hay una secuencia inválida, y en
 *  minúsculas: sirve para decidir qué pares BORRAR de la URL, no para leer
 *  valores. Así `%74oken_hash`, `TOKEN_HASH` o `token%5Fhash` no sobreviven en
 *  la barra de direcciones aunque no sean la clave canónica que se canjea. */
function normalizedQueryKey(rawPair: string): string {
  const separator = rawPair.indexOf('=');
  const rawKey = (separator === -1 ? rawPair : rawPair.slice(0, separator)).replace(/\+/g, ' ');
  try {
    return decodeURIComponent(rawKey).toLowerCase();
  } catch {
    return rawKey.toLowerCase();
  }
}

/** Lee la URL actual (sin efectos) y decide qué hay que procesar y limpiar.
 *  Devuelve `null` si la URL no trae nada de esto (el caso de casi todos los
 *  arranques). */
function inspectCurrentUrl(): UrlInspection | null {
  const { pathname, search, hash } = window.location;

  // Query: cualquier `token_hash` presente se limpia SIEMPRE, junto con
  // `type` (aunque `type` falte, valga otra cosa o venga en mayúsculas):
  // un token que no se va a canjear tampoco tiene por qué quedar visible en
  // la barra de direcciones ni en el historial. Solo se CANJEA si `type` es
  // exactamente `recovery`.
  const rawPairs = search
    .replace(/^\?/, '')
    .split('&')
    .filter((pair) => pair !== '');
  const hasTokenHash = rawPairs.some((pair) => normalizedQueryKey(pair) === 'token_hash');

  const query = new URLSearchParams(search);
  const tokenHash = query.get('token_hash');
  const recoveryTokenHash = query.get('type') === 'recovery' && tokenHash ? tokenHash : null;

  const parsedFragment = parseAuthFragment(hash);
  const hasFragmentTokens = Boolean(parsedFragment.accessToken && parsedFragment.refreshToken);
  const hasFragmentError = Boolean(parsedFragment.error || parsedFragment.errorCode);
  const fragmentIsSensitive = hasFragmentTokens || hasFragmentError;

  if (!hasTokenHash && !fragmentIsSensitive) return null;

  // Se filtra el string crudo (no se reserializa con URLSearchParams) para
  // conservar los demás parámetros tal cual venían.
  let cleanSearch = search;
  if (hasTokenHash) {
    const kept = rawPairs.filter((pair) => {
      const key = normalizedQueryKey(pair);
      return key !== 'token_hash' && key !== 'type';
    });
    cleanSearch = kept.length > 0 ? `?${kept.join('&')}` : '';
  }

  // Fragmento: si trae tokens o error se descarta entero; si no, se
  // conserva (podría ser un ancla común).
  const cleanHash = fragmentIsSensitive ? '' : hash;

  // Un path que empieza con `//` haría que `replaceState` interprete la URL
  // como "scheme-relative" hacia otro origen y tire SecurityError.
  const safePathname = pathname.replace(/^\/{2,}/, '/');

  return {
    recoveryTokenHash,
    fragment: fragmentIsSensitive ? parsedFragment : null,
    cleanUrl: `${safePathname}${cleanSearch}${cleanHash}`,
  };
}

async function redeemRecoveryTokenHash(tokenHash: string): Promise<AuthRedirectResult> {
  // A diferencia de `setSession`/`signOut`, `verifyOtp` NO espera la
  // inicialización interna de supabase-js (`initializePromise`, que arranca
  // sola al crear el cliente y puede terminar borrando/refrescando una
  // sesión vieja del storage). Si canjeáramos sin esperar, esa
  // inicialización podría pisar la sesión de recuperación recién guardada.
  // `initialize()` es idempotente: si ya terminó, devuelve al toque.
  await supabase.auth.initialize();

  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' });
  if (error) return ERROR_RESULT;

  markRecoveryPending();
  return { recoveryPending: true, hadError: false };
}

async function redeemFragment(fragment: ParsedAuthFragment): Promise<AuthRedirectResult> {
  if (fragment.error || fragment.errorCode) return ERROR_RESULT;
  if (!fragment.accessToken || !fragment.refreshToken) return NO_OP_RESULT;

  // `setSession` ya espera `initializePromise` por dentro (verificado en
  // @supabase/auth-js, GoTrueClient.setSession): no hace falta
  // `initialize()` acá como en `verifyOtp`.
  const { error } = await supabase.auth.setSession({
    access_token: fragment.accessToken,
    refresh_token: fragment.refreshToken,
  });
  if (error) return ERROR_RESULT;

  if (fragment.type === 'recovery') {
    markRecoveryPending();
    return { recoveryPending: true, hadError: false };
  }

  // Otros `type` (signup, email_change, magiclink, invite): sesión normal,
  // no hay nada especial que bloquear.
  return NO_OP_RESULT;
}

/**
 * Orden de procesamiento (todo lo anterior al primer `await` corre de forma
 * síncrona al llamar a la función):
 *   1. Inspeccionar `location.search` y `location.hash` una sola vez.
 *   2. Si hay algo sensible, `history.replaceState` YA, conservando el path
 *      (normalizado) y los demás parámetros del query. Si `replaceState`
 *      fallara igual se sigue y se canjea: no romper el arranque pesa más
 *      que la limpieza de la barra de direcciones.
 *   3. Canjear: `token_hash` de recuperación con `verifyOtp` (antes,
 *      `initialize()`); si no hay, el fragmento con `setSession`. Si
 *      vinieran los dos (no pasa con enlaces legítimos), gana `token_hash` y
 *      el fragmento se descarta sin usarse. Un `token_hash` que no es de
 *      recuperación se limpia de la URL pero no se canjea.
 */
export async function processAuthRedirect(): Promise<AuthRedirectResult> {
  const inspection = inspectCurrentUrl();
  if (!inspection) return NO_OP_RESULT;

  try {
    window.history.replaceState(window.history.state, '', inspection.cleanUrl);
  } catch {
    // Seguimos y canjeamos igual (ver comentario de arriba).
  }

  try {
    if (inspection.recoveryTokenHash) {
      return await redeemRecoveryTokenHash(inspection.recoveryTokenHash);
    }
    if (inspection.fragment) {
      return await redeemFragment(inspection.fragment);
    }
    // Había un `token_hash` que no es de recuperación: ya se sacó de la URL,
    // pero este flujo no lo canjea.
    return ERROR_RESULT;
  } catch {
    return ERROR_RESULT;
  }
}
