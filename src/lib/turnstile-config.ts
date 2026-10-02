/**
 * Interruptor de Cloudflare Turnstile (el captcha de login, registro y
 * "olvidé mi contraseña").
 *
 * Con `false`, el front NO pide ni manda token de captcha, NO carga el script
 * de Cloudflare, NO muestra el widget y NO exige `VITE_TURNSTILE_SITE_KEY`
 * (ni en runtime ni en el build). Está en `false` A PROPÓSITO: Turnstile queda
 * pausado mientras la app se termina, y se reactiva antes de tener usuarios
 * reales.
 *
 * Para reactivarlo hacen falta TODOS estos pasos, y los tres tienen que
 * quedar alineados:
 *   1. Poner `true` acá.
 *   2. Volver a activar "Enable Captcha protection" en Supabase
 *      (Authentication → Attack Protection).
 *   3. Tener `VITE_TURNSTILE_SITE_KEY` cargada en Vercel (y en `.env.local`
 *      para probar en local).
 *
 * Si Supabase tiene el captcha encendido y acá está en `false`, todos los
 * ingresos y registros fallan con `captcha_failed`. Si es al revés (acá
 * `true` y Supabase apagado), el front pide un captcha que nadie valida.
 *
 * Este archivo no tiene imports a propósito: lo lee `vite.config.ts` (el
 * build lo usa para decidir si exige la site key) y no debe arrastrar nada
 * del código de la app.
 */
export const TURNSTILE_ENABLED: boolean = false;
