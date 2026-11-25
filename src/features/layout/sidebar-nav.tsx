import { NavLink } from 'react-router';

import { cn } from '@/lib/utils';
import { ALL_NAV_ITEMS } from './nav-items';

/** Barra lateral de escritorio (md+): entran los 6 ítems sin problema de
 *  espacio, así que acá sí se incluye Configuración (a diferencia de la
 *  barra inferior de mobile, ver nav-items.ts).
 *
 *  El objetivo `data-ayuda="nav"` del recorrido de bienvenida va en la LISTA
 *  (`<ul>`) y no en el `<nav>`: el `<nav>` se estira a toda la altura de la
 *  página (es hijo de un flex con `stretch`, y su borde derecho es el
 *  separador), y el aro rodearía la columna entera en vez de los ítems. En la
 *  barra de abajo el objetivo es el `<nav>` (mide 65 px). Es el mismo valor en
 *  las dos: el motor señala el que SE VE, y la lista queda oculta en el
 *  celular porque su `<nav>` es `hidden` (un elemento dentro de un ancestro
 *  con `display: none` no tiene cajas de layout, así que no cuenta como visible). */
export function SidebarNav() {
  return (
    <nav
      aria-label="Navegación principal"
      className="hidden w-56 shrink-0 border-r border-border py-6 pr-4 md:block"
    >
      <ul data-ayuda="nav" className="space-y-1">
        {ALL_NAV_ITEMS.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end={item.to === '/'}
              data-ayuda={item.ayuda}
              className={({ isActive }) =>
                cn(
                  'flex min-h-12 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                )
              }
            >
              <item.icon className="size-5 shrink-0" aria-hidden="true" />
              {item.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
