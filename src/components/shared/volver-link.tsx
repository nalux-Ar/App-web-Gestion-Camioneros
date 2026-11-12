import { Link, type LinkProps } from 'react-router';
import { ChevronLeft } from 'lucide-react';

interface VolverLinkProps {
  to: LinkProps['to'];
  state?: LinkProps['state'];
  /**
   * A dónde lleva, dicho en una frase que sigue a "Volver": "a Gastos", "al viaje". NO se ve (el texto visible es siempre
   * "Volver", igual en todas las pantallas), pero queda en el nombre accesible del enlace ("Volver a Gastos"): un lector de
   * pantalla no tiene el contexto visual de la pantalla anterior.
   */
  destino: string;
}

/**
 * El enlace de "volver" que va arriba del título de las pantallas de detalle y de formulario: «‹ Volver».
 *
 * 16px (antes 14px), área táctil de 48px y SIEMPRE la misma palabra: quien lee despacio o con poca vista no tiene que
 * descifrar un nombre distinto en cada pantalla. El color es el de apoyo (`text-muted-foreground`), igual que antes.
 * El `-ml-2` + `px-2` alinean el ícono con el borde del contenido sin achicar el área táctil.
 */
export function VolverLink({ to, state, destino }: VolverLinkProps) {
  return (
    <Link
      to={to}
      state={state}
      className="-ml-2 inline-flex min-h-12 items-center gap-1 rounded-md px-2 text-base font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <ChevronLeft className="size-5" aria-hidden="true" /> Volver
      <span className="sr-only"> {destino}</span>
    </Link>
  );
}
