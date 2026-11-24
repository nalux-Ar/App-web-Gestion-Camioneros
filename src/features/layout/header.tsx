import { Link } from 'react-router';
import { MessageCircleWarning, Settings } from 'lucide-react';

import logoHeader from '@/assets/branding/logo-header.webp';
import { useMember } from '@/features/member/use-member';
import { REPORTAR_VISIBLE } from '@/features/reportar/reportar-config';
import { ETIQUETA_ATAJO, RUTA_REPORTAR } from '@/features/reportar/reportar-textos';

/**
 * Header fijo, sobre la placa de marca (`brand-plate`, casi negra con
 * borde dorado sutil): el logo tiene fondo negro sólido, así que necesita
 * ese fondo fijo tanto en modo claro como oscuro. Por eso el texto usa
 * `brand-plate-foreground` (fijo, no `foreground`, que sí cambia con el
 * modo y quedaría oscuro-sobre-oscuro en modo claro).
 *
 * Configuración solo aparece acá en mobile (`md:hidden`): en escritorio ya
 * está como sexto ítem de la barra lateral, y duplicarla sería ruido. El
 * atajo a "Reportar un problema" va en los dos tamaños, pero solo si
 * `REPORTAR_VISIBLE` está en `true` (con `false` la función está oculta: ver
 * `reportar-config.ts`).
 *
 * Acá YA NO hay botón de salir: cerraba la sesión de un toque, sin preguntar.
 * «Cerrar sesión» vive en la tarjeta «Tu cuenta» de Configuración, con su
 * confirmación (`CerrarSesion`).
 */
export function Header() {
  const { member } = useMember();

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
          {REPORTAR_VISIBLE ? (
            // Atajo a "Reportar un problema", en los dos tamaños (también está la tarjeta en Configuración).
            <Link
              to={RUTA_REPORTAR}
              data-ayuda="reportar"
              className="flex h-12 w-12 items-center justify-center rounded-md text-brand-plate-foreground transition-colors hover:bg-brand-plate-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-brand-plate"
              aria-label={ETIQUETA_ATAJO}
              title={ETIQUETA_ATAJO}
            >
              <MessageCircleWarning className="size-5" aria-hidden="true" />
            </Link>
          ) : null}
          <Link
            to="/configuracion"
            data-ayuda="nav-configuracion"
            className="flex h-12 w-12 items-center justify-center rounded-md text-brand-plate-foreground transition-colors hover:bg-brand-plate-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-brand-plate md:hidden"
            aria-label="Configuración"
          >
            <Settings className="size-5" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </header>
  );
}
