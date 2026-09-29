import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import type { Session } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';
import { DEFAULT_THEME, applyTheme, resetAccentColor } from '@/lib/theme';
import { clearCachedThemePreference } from '@/lib/theme-cache';
import { AuthContext, type AuthContextValue, type AuthStatus } from './auth-context';

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

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setStatus('ready');
    });

    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!active) return;
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
  }, [navigate]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    // La limpieza de tema/acento/caché corre en `onAuthStateChange` de
    // arriba (dispara con CUALQUIER sesión->null, no solo esta), así que
    // acá no hace falta repetirla: solo llevar a /ingresar.
    navigate('/ingresar', { replace: true });
  }, [navigate]);

  const value = useMemo<AuthContextValue>(
    () => ({ session, user: session?.user ?? null, status, signOut }),
    [session, status, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
