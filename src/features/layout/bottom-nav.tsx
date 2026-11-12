import { NavLink } from 'react-router';

import { cn } from '@/lib/utils';
import { PRIMARY_NAV_ITEMS } from './nav-items';

/**
 * Barra inferior fija en mobile con las 5 secciones de uso diario
 * (Configuración queda en el header, ver nav-items.ts). Safe-area para no
 * quedar tapada por la barra de gestos/home indicator. Cada ítem tiene
 * ≥64px de alto (piso táctil del proyecto es 48px) e ícono de 24px + rótulo
 * de 14px: el estado activo no depende solo del color (también queda en
 * negrita y `aria-current="page"`, que pone NavLink automáticamente).
 *
 * ALTO DE LA BARRA = 4rem (el `min-h-16` del ítem) + 1px del borde + el
 * safe-area. Dos lugares dependen de ese número y se ajustan juntos si
 * cambia: el `bottom` de `FixedActionBar` y el `pb` del `<main>` en
 * `AppShell`.
 *
 * El rótulo va en 14px (antes 11px). Medido a 360px de ancho (ítem de 72px):
 * "Resumen" en negrita ocupa ~58px (Segoe UI) a ~63px (Arial, parecida a
 * Roboto) y entra sin cortarse. Por eso el ítem no lleva padding horizontal
 * (más lugar para el texto sin achicar el área táctil, que es todo el
 * ítem) y el rótulo lleva `max-w-full`: si en un equipo muy angosto (320px)
 * o con otra tipografía no entra, se recorta con "…" en vez de pisar al
 * vecino.
 */
export function BottomNav() {
  return (
    <nav
      aria-label="Navegación principal"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul className="flex">
        {PRIMARY_NAV_ITEMS.map((item) => (
          <li key={item.to} className="min-w-0 flex-1">
            <NavLink
              to={item.to}
              end={item.to === '/'}
              data-ayuda={item.ayuda}
              className={({ isActive }) =>
                cn(
                  'flex min-h-16 flex-col items-center justify-center gap-1 py-2 text-center text-sm font-medium leading-tight transition-colors',
                  isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <item.icon className="size-6 shrink-0" aria-hidden="true" />
                  <span className={cn('max-w-full truncate', isActive && 'font-semibold')}>{item.label}</span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
