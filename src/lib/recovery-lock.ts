import { useSyncExternalStore } from 'react';

/**
 * Marcador NO sensible (solo '1'/ausente, nunca tokens) de "hay una sesión
 * de recuperación de contraseña en curso, todavía no se eligió la
 * contraseña nueva ni se canceló". Se usa para: 1) bloquear el resto de la
 * app mientras esa sesión esté viva (ver RecoveryGuard en src/app/guards.tsx)
 * y 2) detectar en el arranque siguiente que quedó una sesión de
 * recuperación abandonada (el usuario cerró la pestaña sin elegir
 * contraseña ni cancelar) para cerrarla (ver src/main.tsx).
 *
 * Todo el acceso a localStorage va envuelto en try/catch: si el storage
 * está bloqueado, la app sigue funcionando, solo sin este resguardo extra
 * (el flujo normal de login/onboarding no depende de esto).
 */
const STORAGE_KEY = 'elan:recovery-pending';

type Listener = () => void;
const listeners = new Set<Listener>();

function notify(): void {
  for (const listener of listeners) listener();
}

export function markRecoveryPending(): void {
  try {
    localStorage.setItem(STORAGE_KEY, '1');
  } catch {
    // Sin storage disponible: seguimos sin marcador persistente.
  }
  notify();
}

export function clearRecoveryPending(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // idem arriba
  }
  notify();
}

export function isRecoveryPending(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function subscribeRecoveryPending(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Versión reactiva de `isRecoveryPending()` para componentes: se
 *  re-renderiza cuando `markRecoveryPending`/`clearRecoveryPending` se
 *  llaman desde cualquier parte (p.ej. ResetPasswordPage limpiando el
 *  marcador al cancelar o al guardar la contraseña nueva). Con
 *  `useSyncExternalStore` en vez de leer localStorage directo en el
 *  render: localStorage es estado externo mutable, leerlo "a mano" en
 *  cada render no garantiza que React se entere de los cambios. */
export function useRecoveryPending(): boolean {
  return useSyncExternalStore(subscribeRecoveryPending, isRecoveryPending, isRecoveryPending);
}
