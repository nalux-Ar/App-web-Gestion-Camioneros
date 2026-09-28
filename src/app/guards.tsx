import { useEffect, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';

import { FullScreenLoader } from '@/components/shared/full-screen-loader';
import { ErrorRetry } from '@/components/shared/error-retry';
import { useAuth } from '@/features/auth/use-auth';
import { useMember } from '@/features/member/use-member';
import { clearRecoveryPending, useRecoveryPending } from '@/lib/recovery-lock';

const RESET_PASSWORD_PATH = '/restablecer-contrasena';

/**
 * Guard global (envuelve TODAS las rutas, ver src/app/router.tsx): mientras
 * haya una sesión de recuperación de contraseña pendiente (el usuario
 * abrió el link del mail pero todavía no eligió la contraseña nueva ni
 * canceló), cualquier ruta que no sea `/restablecer-contrasena` redirige
 * ahí — incluidas `/ingresar`, `/registro`, `/recuperar-contrasena`,
 * `/bienvenida` y toda la app. Esa sesión es una sesión válida como
 * cualquier otra para Supabase; sin este guard, alguien con el link de
 * recuperación (pero sin la contraseña real) podría entrar directo a la
 * cuenta sin nunca demostrar que la conoce.
 *
 * Si el marcador quedó pendiente pero ya no hay sesión (venció sola, se
 * cerró en otra pestaña, etc.) no hay nada que proteger: se limpia el
 * marcador huérfano y se deja pasar como cualquier usuario sin sesión.
 *
 * A propósito NO bloquea el render con un loader propio mientras
 * `status === 'loading'` (a diferencia de los guards de abajo): este
 * componente envuelve TODO el árbol de rutas, incluida `AuthShell`: si
 * mostrara acá un `FullScreenLoader`, taparía la placa del logo en cada
 * carga de la app, no solo el contenido interno. Mientras no se sepa si
 * hay sesión, deja pasar; los guards de abajo (ya dentro de AuthShell/
 * AppShell) muestran su propio loader sin tapar el header/logo. El
 * redirect de recuperación recién se evalúa cuando `status === 'ready'`.
 */
export function RecoveryGuard({ children }: { children: ReactNode }) {
  const { session, status } = useAuth();
  const location = useLocation();
  const pending = useRecoveryPending();

  useEffect(() => {
    if (status === 'ready' && pending && !session) {
      clearRecoveryPending();
    }
  }, [status, pending, session]);

  if (status === 'ready' && pending && session && location.pathname !== RESET_PASSWORD_PATH) {
    return <Navigate to={RESET_PASSWORD_PATH} replace />;
  }

  return <>{children}</>;
}

/** Sin sesión → /ingresar, recordando a dónde quería ir con `?volver=`
 *  (sanitizado al leerlo, ver src/lib/safe-redirect.ts). */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, status } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <FullScreenLoader />;

  if (!session) {
    const target = `${location.pathname}${location.search}`;
    const volver = encodeURIComponent(target);
    return <Navigate to={`/ingresar?volver=${volver}`} replace />;
  }

  return <>{children}</>;
}

/** Con sesión, las pantallas de auth (login/registro/recuperar) redirigen
 *  a la app: no tiene sentido mostrárselas a alguien ya logueado. */
export function RequireGuest({ children }: { children: ReactNode }) {
  const { session, status } = useAuth();

  if (status === 'loading') return <FullScreenLoader />;
  if (session) return <Navigate to="/" replace />;

  return <>{children}</>;
}

/** Logueado sin fila en `miembros` → /bienvenida. Un error de red al
 *  pedir el miembro NUNCA se trata como "no tiene miembro": eso mandaría
 *  a alguien con cuenta ya creada de vuelta al onboarding solo por un
 *  corte de señal. */
export function RequireMember({ children }: { children: ReactNode }) {
  const { member, status, error, refetch } = useMember();

  if (status === 'idle' || status === 'loading') return <FullScreenLoader />;

  if (status === 'error') {
    return <ErrorRetry message={error ?? 'No pudimos cargar tu cuenta.'} onRetry={() => void refetch()} />;
  }

  if (status === 'no-member') return <Navigate to="/bienvenida" replace />;

  if (!member) return <FullScreenLoader />;

  return <>{children}</>;
}

/** Para /bienvenida: si ya tiene miembro, no tiene sentido volver a
 *  mostrar el onboarding (ya eligió el nombre del transportista). */
export function RequireNoMember({ children }: { children: ReactNode }) {
  const { status, error, refetch } = useMember();

  if (status === 'idle' || status === 'loading') return <FullScreenLoader />;

  if (status === 'error') {
    return <ErrorRetry message={error ?? 'No pudimos cargar tu cuenta.'} onRetry={() => void refetch()} />;
  }

  if (status === 'ready') return <Navigate to="/" replace />;

  return <>{children}</>;
}
