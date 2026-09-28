import { Construction } from 'lucide-react';

interface ComingSoonPageProps {
  title: string;
}

/** Pantalla "próximamente" para las secciones que llegan en los próximos
 *  bloques (Viajes, Gastos, Clientes, Reportes). */
export function ComingSoonPage({ title }: ComingSoonPageProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border px-6 py-16 text-center">
      <Construction className="size-10 text-muted-foreground" aria-hidden="true" />
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="max-w-sm text-muted-foreground">
        Todavía estamos armando esta sección. Pronto vas a poder usarla acá.
      </p>
    </div>
  );
}
