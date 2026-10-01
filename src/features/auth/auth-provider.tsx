import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';
import { DEFAULT_THEME, applyTheme, resetAccentColor } from '@/lib/theme';
import { clearCachedThemePreference } from '@/lib/theme-cache';
import { AuthContext, type AuthContextValue, type AuthStatus, type SignOutResult } from './auth-context';

const SIGN_OUT_FAILED_MESSAGE = 'No pudimos cerrar tu sesión. Revisa tu conexión e inténtalo de nuevo.';

/**
 * Sesión: `getSession()` inicial + un único listener `onAuthStateChange`
 * para toda la app (nada de listeners duplicados por componente). Vive
 * dentro de <BrowserRouter> porque necesita `useNavigate` para el logout
 * y para el evento `PASSWORD_RECOVERY`. Ojo: el enlace de recuperación del
 * correo se canjea al arrancar (src/lib/process-auth-redirect.ts), ANTES
 * de montar este provider, así que ese evento normalmente ya pasó cuando
 * se suscribe el listener; quien mantiene al usuario en
 * `/restablecer-contrasena` es RecoveryGuard (src/app/guards.tsx). El
 * manejo del evento queda como red de seguridad por si otro flujo lo
 * dispara con la app ya montada.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // Último usuario que vio este provider: `undefined` = todavía ninguno,
  // `null` = sin sesión, string = id del usuario. Es un ref y no estado
  // porque solo lo lee el listener de abajo y no debe provocar renders.
  const lastUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    let active = true;

    /**
     * SEGURIDAD: la caché de datos (TanStack Query) es del usuario que la
     * llenó. Se vacía TODA (`clear()`, no solo invalidar) en cualquier
     * transición a "sin sesión" y cada vez que cambia el usuario:
     *  - logout manual, sesión vencida (refresh token inválido) y logout
     *    hecho desde otra pestaña: todos llegan acá como sesión `null`;
     *  - otra pestaña inicia sesión con otra cuenta: llega un usuario
     *    distinto del anterior, sin pasar por `null`.
     * Un dispositivo compartido nunca debe mostrar lo del usuario anterior.
     * Se compara el id del usuario, no el evento: supabase-js re-emite
     * `SIGNED_IN` (p.ej. al volver a la pestaña) con el MISMO usuario, y ahí
     * vaciar la caché solo haría perder datos y forzar pedidos de más.
     * Es síncrono y no llama a Supabase, así que es seguro dentro del
     * callback de `onAuthStateChange`.
     */
    function syncQueryCache(nextSession: Session | null) {
      const nextUserId = nextSession?.user.id ?? null;
      const userChanged = nextUserId !== lastUserIdRef.current;
      lastUserIdRef.current = nextUserId;
      if (nextUserId === null || userChanged) queryClient.clear();
    }

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      syncQueryCache(data.session);
      setSession(data.session);
      setStatus('ready');
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return;
      syncQueryCache(nextSession);
      setSession(nextSession);
      setStatus('ready');

      if (event === 'PASSWORD_RECOVERY') {
        navigate('/restablecer-contrasena', { replace: true });
      }

      if (!nextSession) {
        // Cualquier transición a "sin sesión" limpia las preferencias
        // visuales de la sesión anterior: no solo cuando se toca "Salir"
        // a mano, también un logout automático (refresh token vencido,
        // usuario borrado, "cerrar sesión" hecho desde otra pestaña). Un
        // dispositivo compartido no debería seguir mostrando el tema/
        // acento de alguien cuya sesión ya terminó por su cuenta. El
        // estado del miembro (nombre del transportista, rol, etc.) se
        // limpia solo: MemberProvider reacciona a que `user` pasó a null.
        resetAccentColor();
        applyTheme(DEFAULT_THEME);
        clearCachedThemePreference();
      }
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [navigate, queryClient]);

  const signOut = useCallback(async (): Promise<SignOutResult> => {
    let failed = false;
    try {
      const { error } = await supabase.auth.signOut();
      failed = error !== null;
    } catch {
      failed = true;
    }

    if (failed) {
      // `signOut` puede fallar y aun así haber borrado la sesión local (si
      // falla la llamada al servidor, auth-js igual la quita), o fallar ANTES
      // de borrarla (storage roto). Se mira qué quedó: si la sesión sigue
      // viva, navegar a /ingresar sería mentira (RequireGuest rebotaría a "/")
      // y el usuario creería que salió. Mejor avisar y no navegar.
      let stillSignedIn = true;
      try {
        const { data, error } = await supabase.auth.getSession();
        stillSignedIn = error !== null || data.session !== null;
      } catch {
        // No se puede confirmar: se asume que sigue adentro.
      }
      if (stillSignedIn) return { ok: false, message: SIGN_OUT_FAILED_MESSAGE };
    }

    // La limpieza de tema/acento y de la caché de datos corre en
    // `onAuthStateChange` de arriba (dispara con CUALQUIER sesión->null, no
    // solo esta). Acá se vuelve a vaciar la caché de datos por las dudas,
    // porque es el logout manual y lo más delicado: si el evento no llegara,
    // igual no queda nada del usuario que se va. Vaciar dos veces es gratis.
    queryClient.clear();
    navigate('/ingresar', { replace: true });
    return { ok: true };
  }, [navigate, queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({ session, user: session?.user ?? null, status, signOut }),
    [session, status, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
