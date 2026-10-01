import { useState } from 'react';
import { Link } from 'react-router';
import { AlertTriangle, LogOut, Settings, X } from 'lucide-react';

import logoHeader from '@/assets/branding/logo-header.webp';
import { useAuth } from '@/features/auth/use-auth';
import { useMember } from '@/features/member/use-member';

const SIGN_OUT_FALLBACK_MESSAGE = 'No pudimos cerrar tu sesión. Revisa tu conexión e inténtalo de nuevo.';

/**
 * Header fijo, sobre la placa de marca (`brand-plate`, casi negra con
 * borde dorado sutil): el logo tiene fondo negro sólido, así que necesita
 * ese fondo fijo tanto en modo claro como oscuro. Por eso el texto usa
 * `brand-plate-foreground` (fijo, no `foreground`, que sí cambia con el
 * modo y quedaría oscuro-sobre-oscuro en modo claro).
 *
 * Configuración solo aparece acá en mobile (`md:hidden`): en escritorio ya
 * está como sexto ítem de la barra lateral, y duplicarla sería ruido. El
 * botón de salir sí va siempre en el header, en los dos tamaños.
 *
 * Si no se pudo cerrar la sesión (`signOut` devuelve `ok: false`: la sesión
 * sigue viva), se avisa acá abajo en vez de navegar a /ingresar. El aviso usa
 * `destructive`/`destructive-foreground` (contraste fijo, igual en claro y en
 * oscuro) porque el header es siempre oscuro.
 */
export function Header() {
  const { signOut } = useAuth();
  const { member } = useMember();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    setSignOutError(null);
    try {
      const result = await signOut();
      if (!result.ok) setSignOutError(result.message);
    } catch {
      // `signOut` no debería rechazar nunca; por las dudas, nunca queda un
      // rechazo sin manejar ni un botón que no responde.
      setSignOutError(SIGN_OUT_FALLBACK_MESSAGE);
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <header className="sticky top-0 z-40 border-b border-brand-plate-border bg-brand-plate">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-3 px-4">
        <div className="flex min-w-0 items-center gap-3">
          <img src={logoHeader} alt="Elan" width={640} height={143} className="h-9 w-auto shrink-0" />
          {member?.transportistaNombre ? (
            <span className="hidden truncate text-sm font-medium text-brand-plate-foreground/90 sm:inline">
              {member.transportistaNombre}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          <Link
            to="/configuracion"
            className="flex h-12 w-12 items-center justify-center rounded-md text-brand-plate-foreground transition-colors hover:bg-brand-plate-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-brand-plate md:hidden"
            aria-label="Configuración"
          >
            <Settings className="size-5" aria-hidden="true" />
          </Link>
          <button
            type="button"
            onClick={() => void handleSignOut()}
            disabled={signingOut}
            className="flex h-12 items-center gap-2 rounded-md px-3 text-brand-plate-foreground transition-colors hover:bg-brand-plate-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-brand-plate disabled:opacity-50"
            aria-label="Salir"
          >
            <LogOut className="size-5" aria-hidden="true" />
            <span className="hidden sm:inline">Salir</span>
          </button>
        </div>
      </div>
      {signOutError ? (
        <div role="alert" className="border-t border-brand-plate-border bg-destructive text-destructive-foreground">
          <div className="mx-auto flex max-w-5xl items-center gap-2 px-4 text-sm">
            <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
            <p className="flex-1 py-2">{signOutError}</p>
            <button
              type="button"
              onClick={() => setSignOutError(null)}
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-destructive-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-destructive"
              aria-label="Cerrar aviso"
            >
              <X className="size-5" aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : null}
    </header>
  );
}
