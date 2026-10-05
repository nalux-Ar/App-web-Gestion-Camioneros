import { Link, useLocation, useParams } from 'react-router';
import { ChevronLeft } from 'lucide-react';

import { InlineError } from '@/components/shared/inline-error';
import { ListSkeleton } from '@/components/shared/list-skeleton';
import { mapDataError } from '@/lib/data-errors';
import { useScrollToTopOnMount } from '@/lib/use-scroll-to-top';
import { isUuid } from '@/lib/uuid';
import { sanitizeVolverClientes } from './cliente-busqueda';
import { ClienteFormulario } from './cliente-formulario';
import { rutaDelCliente } from './cliente-navegacion';
import { ClienteNoEncontrado } from './cliente-no-encontrado';
import { useClienteParaEditar, useClientes } from './use-clientes';

interface ClienteFormPageProps {
  modo: 'nuevo' | 'editar';
}

/**
 * Pantalla de alta (`/clientes/nuevo`) y de edición (`/clientes/:id/editar`). Carga lo que el formulario necesita (la lista
 * de clientes, para el aviso de duplicado, y al editar, el cliente) antes de mostrarlo, así el formulario se inicializa UNA
 * vez con datos completos y nunca se pisa lo que el usuario tipea. Los errores de carga solo ocupan la pantalla si NO hay
 * datos.
 *
 * Volver: el alta vuelve a la lista de Clientes con su búsqueda (`state.volver`, saneado); la edición, al detalle del
 * cliente (ruta armada acá con el uuid validado de la URL). Nunca se navega a algo que venga del estado o de la URL.
 */
export function ClienteFormPage({ modo }: ClienteFormPageProps) {
  useScrollToTopOnMount();
  const params = useParams();
  const location = useLocation();
  const volver = sanitizeVolverClientes((location.state as { volver?: unknown } | null)?.volver);

  // Un id que no es uuid no se consulta: es "no encontrado" sin pedir nada.
  const id = modo === 'editar' && isUuid(params.id) ? params.id.toLowerCase() : null;
  const idInvalido = modo === 'editar' && id === null;

  const clientes = useClientes({ enabled: !idInvalido });
  const cliente = useClienteParaEditar(id);

  const titulo = modo === 'nuevo' ? 'Nuevo cliente' : 'Editar cliente';

  let contenido;
  if (idInvalido) {
    contenido = <ClienteNoEncontrado volver={volver} />;
  } else if (clientes.isError && clientes.data === undefined) {
    // Solo si NO hay datos: un refresco fallido (típico al volver la señal) con el formulario ya abierto no lo desmonta,
    // porque se llevaría lo que el usuario tipeó.
    contenido = (
      <InlineError
        message={`No pudimos cargar tus clientes. ${mapDataError(clientes.error)}`}
        onRetry={() => void clientes.refetch()}
        retrying={clientes.isFetching}
      />
    );
  } else if (modo === 'editar' && cliente.isError && cliente.data === undefined) {
    contenido = (
      <InlineError message={mapDataError(cliente.error)} onRetry={() => void cliente.refetch()} retrying={cliente.isFetching} />
    );
  } else if (clientes.data === undefined || (modo === 'editar' && cliente.isPending)) {
    contenido = <ListSkeleton rows={4} />;
  } else if (modo === 'editar' && cliente.data === null) {
    contenido = <ClienteNoEncontrado volver={volver} />;
  } else if (modo === 'editar' && cliente.data) {
    contenido = <ClienteFormulario key={cliente.data.id} cliente={cliente.data} clientes={clientes.data.items} volver={volver} />;
  } else {
    contenido = <ClienteFormulario clientes={clientes.data.items} volver={volver} />;
  }

  // El enlace de volver: al detalle del cliente al editar (si el id de la URL es válido) y a la lista al crear.
  const enlaceVolver =
    id !== null
      ? { to: rutaDelCliente(id), state: { volver }, texto: 'Cliente' }
      : { to: `/clientes${volver}`, state: undefined, texto: 'Clientes' };

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <Link
          to={enlaceVolver.to}
          state={enlaceVolver.state}
          className="-ml-2 inline-flex min-h-12 items-center gap-1 rounded-md px-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <ChevronLeft className="size-5" aria-hidden="true" /> {enlaceVolver.texto}
        </Link>
        <h1 className="text-2xl font-semibold">{titulo}</h1>
      </div>
      {contenido}
    </div>
  );
}
