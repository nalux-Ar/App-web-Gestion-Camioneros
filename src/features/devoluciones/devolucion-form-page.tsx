import { useMemo } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { ChevronLeft } from 'lucide-react';

import { InlineError } from '@/components/shared/inline-error';
import { ListSkeleton } from '@/components/shared/list-skeleton';
import { useClientes } from '@/features/clientes/use-clientes';
import { useViajeVista } from '@/features/viajes/use-viajes';
import { rutaDelViaje } from '@/features/viajes/viaje-navegacion';
import { ViajeNoEncontrado } from '@/features/viajes/viaje-no-encontrado';
import { sanitizeVolver } from '@/features/viajes/viajes-filters';
import { mapDataError } from '@/lib/data-errors';
import { useScrollToTopOnMount } from '@/lib/use-scroll-to-top';
import { isUuid } from '@/lib/uuid';
import { DevolucionFormulario } from './devolucion-formulario';
import { DevolucionNoEncontrada } from './devolucion-no-encontrada';
import { useDevolucion } from './use-devoluciones';

interface DevolucionFormPageProps {
  modo: 'nuevo' | 'editar';
}

/**
 * Pantalla de alta (`/viajes/:viajeId/devoluciones/nueva`) y de edición
 * (`/viajes/:viajeId/devoluciones/:id/editar`). Las devoluciones se cargan SOLO desde el detalle de un viaje: el viaje
 * va en la URL.
 *
 * Carga lo que el formulario necesita (los clientes, el viaje con sus entregas para ofrecer primero sus clientes y, al
 * editar, la devolución) antes de mostrarlo, así el formulario se inicializa UNA vez con datos completos y nunca se
 * pisa lo que el usuario tipea. Los errores de carga solo ocupan la pantalla si NO hay datos.
 *
 * Qué NO hace: armar rutas con texto de la URL o del estado. El viaje y la devolución de la URL se validan con `isUuid`
 * (si no son uuid no se consulta nada); el "volver" (el mes de la lista de viajes, de `location.state`) se sanea con
 * `sanitizeVolver`; y la ruta de vuelta se arma acá: siempre `/viajes/<viajeId>`, con un uuid validado.
 *
 * Editar: la devolución se pide por id Y por viaje. Si no existe, es de otro viaje o de otro transportista, la pantalla
 * es la misma: "Devolución no encontrada" (la base no distingue los casos y el mensaje tampoco).
 */
export function DevolucionFormPage({ modo }: DevolucionFormPageProps) {
  useScrollToTopOnMount();
  const params = useParams();
  const location = useLocation();
  const volver = sanitizeVolver((location.state as { volver?: unknown } | null)?.volver);

  // Un id que no es uuid no se consulta: no existe. El del viaje, también.
  const viajeId = isUuid(params.viajeId) ? params.viajeId.toLowerCase() : null;
  const devolucionId = modo === 'editar' && isUuid(params.id) ? params.id.toLowerCase() : null;
  const devolucionIdInvalido = modo === 'editar' && devolucionId === null;
  // Con una devolución que no puede existir (id inválido) no se consulta nada más: es "no encontrada" sin pedir nada.
  const consultar = viajeId !== null && !devolucionIdInvalido;

  const clientes = useClientes({ enabled: consultar });
  const viaje = useViajeVista(consultar ? viajeId : null);
  const devolucion = useDevolucion(devolucionId, viajeId);

  const clientesCargados = clientes.data?.items;
  const entregas = viaje.data?.entregas;
  const idsClientesDelViaje = useMemo(() => (entregas ?? []).map((entrega) => entrega.cliente_id), [entregas]);

  const titulo = modo === 'nuevo' ? 'Nueva devolución' : 'Editar devolución';

  let contenido;
  if (viajeId === null) {
    contenido = <ViajeNoEncontrado volver={volver} />;
  } else if (devolucionIdInvalido) {
    contenido = <DevolucionNoEncontrada viajeId={viajeId} volver={volver} />;
  } else if (clientes.isError && clientes.data === undefined) {
    // Los errores de carga solo ocupan la pantalla si NO hay datos: un refresco fallido (típico al volver la señal) con
    // el formulario ya abierto no lo desmonta, porque se llevaría lo que el usuario tipeó.
    contenido = (
      <InlineError
        message={`No pudimos cargar los clientes. ${mapDataError(clientes.error)}`}
        onRetry={() => void clientes.refetch()}
        retrying={clientes.isFetching}
      />
    );
  } else if (viaje.isError && viaje.data === undefined) {
    contenido = (
      <InlineError message={mapDataError(viaje.error)} onRetry={() => void viaje.refetch()} retrying={viaje.isFetching} />
    );
  } else if (modo === 'editar' && devolucion.isError && devolucion.data === undefined) {
    contenido = (
      <InlineError
        message={mapDataError(devolucion.error)}
        onRetry={() => void devolucion.refetch()}
        retrying={devolucion.isFetching}
      />
    );
  } else if (clientes.isPending || viaje.isPending || (modo === 'editar' && devolucion.isPending)) {
    contenido = <ListSkeleton rows={4} />;
  } else if (modo === 'editar' && devolucion.data === null) {
    contenido = <DevolucionNoEncontrada viajeId={viajeId} volver={volver} />;
  } else if (viaje.data === null) {
    // El viaje no existe (o es de otro transportista: la base no distingue): no hay a qué cargarle una devolución.
    contenido = <ViajeNoEncontrado volver={volver} />;
  } else if (clientesCargados === undefined) {
    contenido = <ListSkeleton rows={4} />;
  } else if (modo === 'editar' && devolucion.data) {
    contenido = (
      <DevolucionFormulario
        key={devolucion.data.id}
        viajeId={viajeId}
        devolucion={devolucion.data}
        clientes={clientesCargados}
        clientesTruncado={clientes.data?.truncado ?? false}
        idsClientesDelViaje={idsClientesDelViaje}
        volver={volver}
      />
    );
  } else {
    // El viaje en la `key`: si la URL cambia de viaje con la pantalla abierta, el formulario arranca de cero (y con un
    // `client_ref` nuevo) en vez de arrastrar el del viaje anterior.
    contenido = (
      <DevolucionFormulario
        key={viajeId}
        viajeId={viajeId}
        clientes={clientesCargados}
        clientesTruncado={clientes.data?.truncado ?? false}
        idsClientesDelViaje={idsClientesDelViaje}
        volver={volver}
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <Link
          to={viajeId !== null ? rutaDelViaje(viajeId) : `/viajes${volver}`}
          state={viajeId !== null ? { volver } : undefined}
          className="-ml-2 inline-flex min-h-12 items-center gap-1 rounded-md px-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <ChevronLeft className="size-5" aria-hidden="true" /> {viajeId !== null ? 'Viaje' : 'Viajes'}
        </Link>
        <h1 className="text-2xl font-semibold">{titulo}</h1>
      </div>
      {contenido}
    </div>
  );
}
