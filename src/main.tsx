import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';
import './index.css';
import { DEFAULT_THEME, applyAccentColor, applyTheme, resetAccentColor } from './lib/theme';
import { clearCachedThemePreference, readCachedThemePreference } from './lib/theme-cache';
import { processAuthHash } from './lib/process-auth-hash';
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
 * Todo esto corre ANTES de montar <App/> (y por lo tanto antes de que
 * AuthProvider llame a `getSession()`), a propósito: si el link de
 * recuperación que se acaba de abrir crea una sesión nueva, queremos que
 * ya esté guardada cuando el resto de la app arranque a leerla. Si lo
 * hiciéramos al revés (montar primero, procesar el hash después) habría
 * una ventana en la que `getSession()` contesta "sin sesión" de forma
 * incorrecta, apenas antes de que la sesión de recuperación aparezca.
 */
async function bootstrap(container: HTMLElement) {
  const hashResult = await processAuthHash();

  // Marcador de recuperación pendiente de un arranque ANTERIOR (el
  // usuario cerró la pestaña en `/restablecer-contrasena` sin elegir
  // contraseña ni cancelar) Y este arranque no acaba de procesar un link
  // de recuperación nuevo: es una sesión de recuperación abandonada,
  // capaz de navegar a toda la app sin haber elegido contraseña. Se
  // cierra antes de fijar cualquier estado de auth/routing, para que la
  // app nunca llegue a mostrarse con esa sesión viva.
  if (isRecoveryPending() && !hashResult.recoveryPending) {
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
