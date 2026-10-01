import type { ReactNode } from 'react';

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
}

/** Encabezado de pantalla: título (`h1`) + acción primaria. */
export function PageHeader({ title, description, action }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-1">
        <h1 className="text-2xl font-semibold">{title}</h1>
        {description ? <p className="text-muted-foreground">{description}</p> : null}
      </div>
      {action ? <div className="w-full shrink-0 sm:w-auto [&>*]:w-full sm:[&>*]:w-auto">{action}</div> : null}
    </div>
  );
}
