import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

interface PageHeaderProps {
  title: string;
  description?: string;
  /**
   * Acción primaria de la pantalla. En el celular ocupa todo el ancho (botón
   * grande, fácil de tocar con el pulgar); desde `sm` queda a la derecha:
   *
   *   <Button asChild size="lg">
   *     <Link to="/gastos/nuevo"><Plus aria-hidden="true" /> Cargar gasto</Link>
   *   </Button>
   */
  action?: ReactNode;
  /**
   * La acción solo se muestra desde `md`: en el celular la reemplaza un
   * `FixedActionBar` fijo abajo (así no hay dos botones iguales a la vista).
   */
  actionDesktopOnly?: boolean;
}

/** Encabezado de pantalla: título (`h1`) + acción primaria. */
export function PageHeader({ title, description, action, actionDesktopOnly = false }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-1">
        <h1 className="text-2xl font-semibold">{title}</h1>
        {description ? <p className="text-muted-foreground">{description}</p> : null}
      </div>
      {action ? (
        <div className={cn('w-full shrink-0 sm:w-auto [&>*]:w-full sm:[&>*]:w-auto', actionDesktopOnly && 'max-md:hidden')}>
          {action}
        </div>
      ) : null}
    </div>
  );
}
