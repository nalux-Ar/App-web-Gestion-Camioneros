import { Link, useLocation, useParams } from 'react-router';
import { ChevronLeft } from 'lucide-react';

import { InlineError } from '@/components/shared/inline-error';
import { ListSkeleton } from '@/components/shared/list-skeleton';
import { mapDataError } from '@/lib/data-errors';
import { useScrollToTopOnMount } from '@/lib/use-scroll-to-top';
import { isUuid } from '@/lib/uuid';
import { GastoFormulario } from './gasto-formulario';
import { GastoNoEncontrado } from './gasto-no-encontrado';
import { sanitizeVolver } from './gastos-filters';
import { useCategorias, useGasto } from './use-gastos';

interface GastoFormPageProps {
  modo: 'nuevo' | 'editar';
}

/**
 * Pantalla de alta (`/gastos/nuevo`) y de edición (`/gastos/:id/editar`).
 * Carga lo que el formulario necesita (categorías y, al editar, el gasto)
 * antes de mostrarlo, así el formulario se inicializa UNA vez con datos
 * completos y nunca se pisa lo que el usuario tipea.
 */
export function GastoFormPage({ modo }: GastoFormPageProps) {
  useScrollToTopOnMount();
  const params = useParams();
  const location = useLocation();
  const volver = sanitizeVolver((location.state as { volver?: unknown } | null)?.volver);

  // Un id que no es uuid no se consulta: es "no encontrado" sin pedir nada.
  const id = modo === 'editar' && isUuid(params.id) ? params.id : null;
  const idInvalido = modo === 'editar' && id === null;

  const categorias = useCategorias();
  const gasto = useGasto(id);

  const titulo = modo === 'nuevo' ? 'Nuevo gasto' : 'Editar gasto';

  let contenido;
  if (idInvalido) {
    contenido = <GastoNoEncontrado volver={volver} />;
  } else if (categorias.isError && categorias.data === undefined) {
    // Los errores de carga solo ocupan la pantalla si NO hay datos: un refresco fallido (típico al volver la
    // señal) con el formulario ya abierto no lo desmonta, porque se llevaría lo que el usuario tipeó.
    contenido = (
      <InlineError
        message={mapDataError(categorias.error)}
        onRetry={() => void categorias.refetch()}
        retrying={categorias.isFetching}
      />
    );
  } else if (modo === 'editar' && gasto.isError && gasto.data === undefined) {
    contenido = (
      <InlineError
        message={mapDataError(gasto.error)}
        onRetry={() => void gasto.refetch()}
        retrying={gasto.isFetching}
      />
    );
  } else if (categorias.isPending || (modo === 'editar' && gasto.isPending)) {
    contenido = <ListSkeleton rows={5} />;
  } else if (modo === 'editar' && gasto.data === null) {
    contenido = <GastoNoEncontrado volver={volver} />;
  } else if (modo === 'editar' && gasto.data) {
    contenido = <GastoFormulario key={gasto.data.id} categorias={categorias.data} gasto={gasto.data} volver={volver} />;
  } else {
    contenido = <GastoFormulario categorias={categorias.data} volver={volver} />;
  }

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <Link
          to={`/gastos${volver}`}
          className="-ml-2 inline-flex min-h-12 items-center gap-1 rounded-md px-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <ChevronLeft className="size-5" aria-hidden="true" /> Gastos
        </Link>
        <h1 className="text-2xl font-semibold">{titulo}</h1>
      </div>
      {contenido}
    </div>
  );
}
