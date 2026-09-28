import { NavLink } from 'react-router';

import { cn } from '@/lib/utils';
import { PRIMARY_NAV_ITEMS } from './nav-items';

/**
 * Barra inferior fija en mobile con las 5 secciones de uso diario
 * (Configuración queda en el header, ver nav-items.ts). Safe-area para no
 * quedar tapada por la barra de gestos/home indicator. Cada ítem tiene
 * ≥56px de alto (piso táctil del proyecto es 48px) e ícono + texto: el
 * estado activo no depende solo del color (también queda en negrita y
 * `aria-current="page"`, que pone NavLink automáticamente).
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
              className={({ isActive }) =>
                cn(
                  'flex min-h-14 flex-col items-center justify-center gap-1 px-1 py-2 text-center text-[11px] font-medium leading-tight transition-colors',
                  isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <item.icon className="size-5 shrink-0" aria-hidden="true" />
                  <span className={cn('truncate', isActive && 'font-semibold')}>{item.label}</span>
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
