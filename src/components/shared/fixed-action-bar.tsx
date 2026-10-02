import type { ReactNode } from 'react';

interface FixedActionBarProps {
  /** El botón de la acción primaria (p.ej. `<Button asChild size="lg"><Link …>Nuevo gasto</Link></Button>`). */
  children: ReactNode;
}

/**
 * Acción primaria de una lista, FIJA abajo en el celular: queda a la vista
 * aunque la lista sea larga y se alcanza con el pulgar, justo arriba de la
 * barra de navegación inferior (`BottomNav`, 3.5 rem + borde + safe-area).
 *
 * Solo existe debajo de `md` (donde está la barra inferior). Desde `md` no se
 * dibuja: la acción vive en el encabezado (`PageHeader` con `actionDesktopOnly`)
 * y en el estado vacío (`EmptyState` con `actionDesktopOnly`), para que en cada
 * ancho haya UN solo botón.
 *
 * Es `fixed`, no `sticky`: en una lista corta (o vacía) un `sticky` quedaría
 * pegado al último elemento en vez de al borde de la pantalla. Como `fixed` no
 * ocupa lugar, un separador en el flujo deja que el último ítem de la lista
 * suba por encima del botón en vez de quedar tapado. Ponerlo como ÚLTIMO hijo
 * de la pantalla. Sin colores propios: el botón trae los suyos.
 */
export function FixedActionBar({ children }: FixedActionBarProps) {
  return (
    <div className="md:hidden">
      <div aria-hidden="true" className="h-12" />
      <div className="fixed inset-x-4 bottom-[calc(3.5rem+1px+env(safe-area-inset-bottom)+0.75rem)] z-30 [&>*]:w-full [&>*]:shadow-lg">
        {children}
      </div>
    </div>
  );
}
