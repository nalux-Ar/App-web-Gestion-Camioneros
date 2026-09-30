/**
 * Cloudflare Turnstile (captcha) para login, registro y "olvidé mi
 * contraseña". Este módulo SOLO se importa desde el widget
 * (src/components/shared/turnstile-widget.tsx), que solo usan esas tres
 * pantallas: ni `/restablecer-contrasena` (ahí llega el `token_hash` y no
 * queremos scripts de terceros) ni el resto de la app cargan nada de esto.
 *
 * Igual que src/lib/supabase.ts, valida su variable de entorno al cargar el
 * módulo y falla fuerte y claro si falta, en vez de mostrar un captcha que
 * nunca va a poder validarse.
 */

function requireEnv(name: keyof ImportMetaEnv, value: string): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`Falta la variable de entorno ${name}. Revisa .env.local (ver .env.example).`);
  }
  return value.trim();
}

/** Site key PÚBLICA (va en el bundle por diseño). La secret key vive solo en
 *  la configuración de Supabase Auth, nunca en el front. */
export const TURNSTILE_SITE_KEY = requireEnv('VITE_TURNSTILE_SITE_KEY', import.meta.env.VITE_TURNSTILE_SITE_KEY);

/** Tipado mínimo de `window.turnstile`: solo lo que usa el widget. */
export interface TurnstileRenderOptions {
  sitekey: string;
  appearance?: 'always' | 'execute' | 'interaction-only';
  theme?: 'auto' | 'light' | 'dark';
  language?: string;
  /** `auto` (el default de Cloudflare): el widget se renueva solo cuando vence el token. */
  'refresh-expired'?: 'auto' | 'manual' | 'never';
  /** `auto` (el default de Cloudflare): ante un fallo reintentable del
   *  desafío, Cloudflare reintenta solo; `error-callback` puede dispararse
   *  igual mientras tanto. */
  retry?: 'auto' | 'never';
  callback?: (token: string) => void;
  'expired-callback'?: () => void;
  /** Recibe el código de error de Cloudflare como string de 6 dígitos
   *  (p. ej. `'600010'`). Las familias 300xxx y 600xxx son reintentables. */
  'error-callback'?: (errorCode: string) => void;
  'timeout-callback'?: () => void;
  /** Cloudflare va a pedir interacción: la casilla se hace visible. */
  'before-interactive-callback'?: () => void;
  /** La casilla salió del modo interactivo (el usuario la completó o se cerró). */
  'after-interactive-callback'?: () => void;
}

export interface TurnstileApi {
  /** Devuelve el id del widget; en la práctica puede volver `undefined` si
   *  Cloudflare no logra renderizarlo, así que quien llama debe chequearlo. */
  render: (container: HTMLElement, options: TurnstileRenderOptions) => string | undefined;
  reset: (widgetId?: string) => void;
  remove: (widgetId?: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const TURNSTILE_SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/** Si `api.js` no dispara ni `load` ni `error` en este tiempo (portal
 *  cautivo, 2G que se cuelga), se da por fallido para no dejar el botón en
 *  "Verificando…" para siempre. */
const SCRIPT_LOAD_TIMEOUT_MS = 15_000;

let scriptPromise: Promise<TurnstileApi> | null = null;

/**
 * Carga el script de Turnstile UNA sola vez por sesión de la página: la
 * promesa es compartida, así que si el widget se monta en varias pantallas
 * (o se monta, se desmonta y se vuelve a montar) no se duplica el `<script>`.
 * Si la carga falla (sin red, bloqueado por un adblock, o se cuelga más de
 * 15 s), la promesa se descarta y se saca la etiqueta, para que un reintento
 * vuelva a intentar de cero.
 */
export function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = TURNSTILE_SCRIPT_URL;
    script.async = true;

    // Solo el primero de load / error / timeout cuenta: si el script termina
    // de bajar tarde, DESPUÉS del timeout, no debe pisar la promesa de un
    // reintento que ya haya arrancado.
    let settled = false;
    const timeoutId = window.setTimeout(fail, SCRIPT_LOAD_TIMEOUT_MS);

    function fail(): void {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      scriptPromise = null;
      script.remove();
      reject(new Error('No se pudo cargar el verificador.'));
    }

    script.onload = () => {
      if (settled) return;
      if (!window.turnstile) {
        fail();
        return;
      }
      settled = true;
      window.clearTimeout(timeoutId);
      resolve(window.turnstile);
    };
    script.onerror = fail;

    document.head.appendChild(script);
  });

  return scriptPromise;
}
