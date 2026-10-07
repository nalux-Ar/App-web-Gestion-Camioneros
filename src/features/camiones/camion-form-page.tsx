import { Link, useParams } from 'react-router';
import { ChevronLeft } from 'lucide-react';

import { InlineError } from '@/components/shared/inline-error';
import { ListSkeleton } from '@/components/shared/list-skeleton';
import { useMember } from '@/features/member/use-member';
import { mapDataError } from '@/lib/data-errors';
import { useScrollToTopOnMount } from '@/lib/use-scroll-to-top';
import { isUuid } from '@/lib/uuid';
import { CamionFormulario } from './camion-formulario';
import { RUTA_CAMIONES } from './camion-navegacion';
import { CamionNoEncontrado } from './camion-no-encontrado';
import { SOLO_ADMIN_CAMIONES_MESSAGE } from './constants';
import { useCamionParaEditar, useCamiones } from './use-camiones';

interface CamionFormPageProps {
  modo: 'nuevo' | 'editar';
}

/**
 * Pantalla de alta (`/camiones/nuevo`) y de edición (`/camiones/:id/editar`). Carga lo que el formulario necesita (la lista
 * de camiones, para saber si es el primero y si es el único activo, y al editar, el camión) antes de mostrarlo: así el
 * formulario se inicializa UNA vez con datos completos. Los errores de carga solo ocupan la pantalla si NO hay datos.
 *
 * Solo el administrador escribe camiones (la base lo exige: `crear_camion` da 42501 y un UPDATE afecta 0 filas). A un
 * chofer que llega por la URL se le explica, sin formulario y sin pedir nada.
 */
export function CamionFormPage({ modo }: CamionFormPageProps) {
  useScrollToTopOnMount();
  const params = useParams();
  const { member } = useMember();
  const esAdmin = member?.rol === 'admin';

  // Un id que no es uuid no se consulta: es "no encontrado" sin pedir nada.
  const id = modo === 'editar' && isUuid(params.id) ? params.id.toLowerCase() : null;
  const idInvalido = modo === 'editar' && id === null;

  const camiones = useCamiones({ enabled: esAdmin && !idInvalido });
  const camion = useCamionParaEditar(esAdmin ? id : null);

  const titulo = modo === 'nuevo' ? 'Nuevo camión' : 'Editar camión';

  let contenido;
  if (!esAdmin) {
    contenido = <p className="text-muted-foreground">{SOLO_ADMIN_CAMIONES_MESSAGE}</p>;
  } else if (idInvalido) {
    contenido = <CamionNoEncontrado />;
  } else if (camiones.isError && camiones.data === undefined) {
    contenido = (
      <InlineError
        message={`No pudimos cargar tus camiones. ${mapDataError(camiones.error)}`}
        onRetry={() => void camiones.refetch()}
        retrying={camiones.isFetching}
      />
    );
  } else if (modo === 'editar' && camion.isError && camion.data === undefined) {
    contenido = <InlineError message={mapDataError(camion.error)} onRetry={() => void camion.refetch()} retrying={camion.isFetching} />;
  } else if (camiones.data === undefined || (modo === 'editar' && camion.isPending)) {
    contenido = <ListSkeleton rows={4} />;
  } else if (modo === 'editar' && camion.data === null) {
    contenido = <CamionNoEncontrado />;
  } else if (modo === 'editar' && camion.data) {
    contenido = <CamionFormulario key={camion.data.id} camion={camion.data} camiones={camiones.data.items} />;
  } else {
    contenido = <CamionFormulario camiones={camiones.data.items} />;
  }

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <Link
          to={RUTA_CAMIONES}
          className="-ml-2 inline-flex min-h-12 items-center gap-1 rounded-md px-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <ChevronLeft className="size-5" aria-hidden="true" /> Camiones
        </Link>
        <h1 className="text-2xl font-semibold">{titulo}</h1>
      </div>
      {contenido}
    </div>
  );
}
