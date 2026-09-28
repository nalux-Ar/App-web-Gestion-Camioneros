import { Suspense } from 'react';
import { Outlet } from 'react-router';

import logoLogin from '@/assets/branding/logo-login.webp';
import { Spinner } from '@/components/shared/spinner';

/**
 * Layout compartido de las pantallas de autenticación (login, registro,
 * recuperar/restablecer contraseña, bienvenida): siempre oscuro y dorado,
 * sin importar el tema/acento que el usuario tenga guardado. La clase
 * `theme-auth` (ver src/index.css) fija los tokens de color acá adentro;
 * `dark` además habilita cualquier utilidad `dark:` que se use más
 * adelante en componentes compartidos.
 *
 * El logo tiene fondo negro sólido (no transparente): va sobre una placa
 * fija casi negra con borde dorado sutil (`brand-plate` /
 * `brand-plate-border`), no sobre el fondo de la página directamente.
 */
export function AuthShell() {
  return (
    <div className="dark theme-auth flex min-h-dvh flex-col items-center justify-center gap-8 bg-background px-4 py-10 text-foreground">
      <div className="flex w-full max-w-sm items-center justify-center rounded-2xl border border-brand-plate-border bg-brand-plate p-6 shadow-lg">
        <img src={logoLogin} alt="Elan" width={960} height={215} className="h-auto w-full" />
      </div>
      <div className="w-full max-w-sm">
        {/* El Suspense va acá adentro (no envolviendo todo el router en
            App.tsx) para que la placa del logo quede fija durante la carga
            del chunk de cada pantalla (login/registro/etc, ver
            src/app/router.tsx): solo el contenido de la tarjeta muestra el
            loader, no toda la pantalla. */}
        <Suspense
          fallback={
            <div className="flex justify-center py-10" role="status" aria-live="polite">
              <Spinner className="size-8 text-primary" />
              <span className="sr-only">Cargando…</span>
            </div>
          }
        >
          <Outlet />
        </Suspense>
      </div>
    </div>
  );
}
