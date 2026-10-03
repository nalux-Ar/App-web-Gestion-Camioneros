import { Link, useLocation, useParams } from 'react-router';
import { ChevronLeft } from 'lucide-react';

import { InlineError } from '@/components/shared/inline-error';
import { ListSkeleton } from '@/components/shared/list-skeleton';
import { useClientes } from '@/features/clientes/use-clientes';
import { mapDataError } from '@/lib/data-errors';
import { useScrollToTopOnMount } from '@/lib/use-scroll-to-top';
import { isUuid } from '@/lib/uuid';
import { useViaje } from './use-viajes';
import { ViajeFormulario } from './viaje-formulario';
import { ViajeNoEncontrado } from './viaje-no-encontrado';
import { sanitizeVolver } from './viajes-filters';

interface ViajeFormPageProps {
  modo: 'nuevo' | 'editar';
}

/**
 * Pantalla de alta (`/viajes/nuevo`) y de edición (`/viajes/:id/editar`). Al editar, carga el viaje con
 * sus entregas antes de mostrar el formulario, así el formulario se inicializa UNA vez con datos
 * completos y nunca se pisa lo que el usuario tipea. Los clientes los pide el propio formulario: su
 * carga no bloquea la pantalla (si falla, el error con "Reintentar" va dentro de la sección de entregas).
 */
export function ViajeFormPage({ modo }: ViajeFormPageProps) {
  useScrollToTopOnMount();
  const params = useParams();
  const location = useLocation();
  const volver = sanitizeVolver((location.state as { volver?: unknown } | null)?.volver);

  // Un id que no es uuid no se consulta: es "no encontrado" sin pedir nada.
  const id = modo === 'editar' && isUuid(params.id) ? params.id : null;
  const idInvalido = modo === 'editar' && id === null;

  const viaje = useViaje(id);
  // Los clientes los usa el formulario (comparte esta misma consulta): pedirlos acá los trae EN PARALELO con el
  // viaje en vez de después, que con mala señal ahorra una espera entera. No bloquea la pantalla ni se espera.
  useClientes({ enabled: !idInvalido });

  const titulo = modo === 'nuevo' ? 'Nuevo viaje' : 'Editar viaje';

  let contenido;
  if (idInvalido) {
    contenido = <ViajeNoEncontrado volver={volver} />;
  } else if (modo === 'editar' && viaje.isError && viaje.data === undefined) {
    // Solo si NO hay datos: un refresco fallido con el formulario ya abierto no lo desmonta (se llevaría lo tipeado).
    contenido = (
      <InlineError message={mapDataError(viaje.error)} onRetry={() => void viaje.refetch()} retrying={viaje.isFetching} />
    );
  } else if (modo === 'editar' && viaje.isPending) {
    contenido = <ListSkeleton rows={5} />;
  } else if (modo === 'editar' && viaje.data === null) {
    contenido = <ViajeNoEncontrado volver={volver} />;
  } else if (modo === 'editar' && viaje.data) {
    contenido = <ViajeFormulario key={viaje.data.id} viaje={viaje.data} volver={volver} />;
  } else {
    contenido = <ViajeFormulario volver={volver} />;
  }

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <Link
          to={`/viajes${volver}`}
          className="-ml-2 inline-flex min-h-12 items-center gap-1 rounded-md px-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <ChevronLeft className="size-5" aria-hidden="true" /> Viajes
        </Link>
        <h1 className="text-2xl font-semibold">{titulo}</h1>
      </div>
      {contenido}
    </div>
  );
}
