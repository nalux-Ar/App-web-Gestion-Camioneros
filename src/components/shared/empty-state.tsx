import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  /** Acción principal para salir del vacío: p.ej. el botón "Cargar gasto". */
  action?: ReactNode;
}

/** "No hay nada todavía": dice qué pasa y ofrece el siguiente paso. Mismo
 *  lenguaje visual que `ComingSoonPage` (borde punteado, ícono apagado). */
export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-6 py-12 text-center">
      {Icon ? <Icon className="size-10 text-muted-foreground" aria-hidden="true" /> : null}
      <p className="text-lg font-semibold">{title}</p>
      {description ? <p className="max-w-sm text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-2 w-full sm:w-auto [&>*]:w-full sm:[&>*]:w-auto">{action}</div> : null}
    </div>
  );
}
