import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';
import './index.css';
import { DEFAULT_THEME, applyAccentColor, applyTheme, resetAccentColor } from './lib/theme';
import { clearCachedThemePreference, readCachedThemePreference } from './lib/theme-cache';
import { processAuthRedirect, type AuthRedirectResult } from './lib/process-auth-redirect';
import { clearRecoveryPending, isRecoveryPending } from './lib/recovery-lock';
import { supabase } from './lib/supabase';

/**
 * Aplica la última preferencia CONOCIDA (tema + acento) antes del primer
 * render, para evitar el flash "oscuro/dorado por defecto -> lo que el
 * usuario eligió" al recargar la página. La base (`miembros.tema` /
 * `miembros.color_acento`) sigue siendo la fuente de verdad: esto es solo
 * una copia de lectura rápida en localStorage, y el hex ya viene validado
 * por `readCachedThemePreference` (ver src/lib/theme-cache.ts).
 */
const cachedPreference = readCachedThemePreference();
if (cachedPreference) {
  applyTheme(cachedPreference.tema);
  if (cachedPreference.colorAcento) {
    applyAccentColor(cachedPreference.colorAcento);
  }
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('No se encontró el elemento #root en index.html');
}

/**
 * Orden de arranque (todo esto corre ANTES de montar <App/>, y por lo tanto
 * antes de que AuthProvider llame a `getSession()`):
 *   1. `processAuthRedirect()`: interpreta el enlace del correo, sea
 *      `?token_hash=...&type=recovery` (canje con `verifyOtp`) o el
 *      fragmento `#access_token=...` (canje con `setSession`). Limpia la URL
 *      de forma síncrona antes de cualquier `await` (ver ese módulo).
 *   2. Si ese enlace era de recuperación, ya quedó la sesión guardada y el
 *      marcador de recuperación pendiente puesto.
 *   3. Cierre de la recuperación ABANDONADA (abajo), solo si este arranque
 *      NO procesó un enlace de recuperación nuevo.
 *   4. Recién entonces se monta <App/>.
 * Es a propósito en este orden: si se montara primero y se procesara el
 * enlace después, habría una ventana en la que `getSession()` contesta "sin
 * sesión" de forma incorrecta, justo antes de que aparezca la sesión de
 * recuperación.
 */
async function bootstrap(container: HTMLElement) {
  // <App/> tiene que montarse SIEMPRE: si el procesamiento del enlace
  // tirara una excepción inesperada, el resultado por defecto es "sin
  // recuperación pendiente, con error" (falla cerrado: si había una
  // recuperación abandonada, igual se cierra abajo) y la app arranca.
  let redirectResult: AuthRedirectResult = { recoveryPending: false, hadError: true };
  try {
    redirectResult = await processAuthRedirect();
  } catch {
    // Se queda con el resultado por defecto.
  }

  // Marcador de recuperación pendiente de un arranque ANTERIOR (el
  // usuario cerró la pestaña en `/restablecer-contrasena` sin elegir
  // contraseña ni cancelar) Y este arranque no acaba de procesar un enlace
  // de recuperación nuevo (`redirectResult.recoveryPending`, que vale tanto
  // para `token_hash` como para el fragmento): es una sesión de recuperación
  // abandonada, capaz de navegar a toda la app sin haber elegido contraseña.
  // Se cierra antes de fijar cualquier estado de auth/routing, para que la
  // app nunca llegue a mostrarse con esa sesión viva. Si el enlace nuevo
  // falló (vencido/ya usado), también se cierra: el marcador viejo sigue
  // siendo una recuperación abandonada.
  if (isRecoveryPending() && !redirectResult.recoveryPending) {
    try {
      // scope: 'local' = cierra solo la sesión de este navegador. Si hay
      // señal, además la revoca en el servidor; si no hay, supabase-js
      // (auth-js 2.117, _signOut) igual borra la sesión local y devuelve
      // el error de red, así que no depende de tener señal.
      await supabase.auth.signOut({ scope: 'local' });
      // El marcador solo se limpia si el signOut realmente pasó: si
      // fallara (storage bloqueado, error inesperado), es más seguro
      // dejarlo pendiente y que RecoveryGuard (src/app/guards.tsx) mande
      // igual a /restablecer-contrasena en cuanto la app arranque — ahí
      // el botón "Cancelar" puede resolverlo a mano — que asumir que la
      // sesión de recuperación quedó cerrada cuando en realidad no.
      clearRecoveryPending();
      resetAccentColor();
      applyTheme(DEFAULT_THEME);
      clearCachedThemePreference();
    } catch {
      // Ver comentario de arriba: no limpiamos nada acá a propósito.
    }
  }

  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap(rootElement);
