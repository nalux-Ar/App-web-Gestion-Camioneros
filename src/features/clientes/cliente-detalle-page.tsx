import { useCallback, useEffect, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { CheckCircle2, ChevronLeft, ChevronRight, Info, Pencil, Truck, X } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { InlineError } from '@/components/shared/inline-error';
import { ListSkeleton } from '@/components/shared/list-skeleton';
import { PageHeader } from '@/components/shared/page-header';
import { MOTIVO_LABELS } from '@/features/devoluciones/constants';
import { estadoEditarDesdeCliente, rutaDelViaje, rutaEditarDevolucion } from '@/features/viajes/viaje-navegacion';
import { mapDataError } from '@/lib/data-errors';
import { formatDateWithYear } from '@/lib/dates';
import { useScrollToTopOnMount } from '@/lib/use-scroll-to-top';
import { cn } from '@/lib/utils';
import { isUuid } from '@/lib/uuid';
import { sanitizeVolverClientes } from './cliente-busqueda';
import { hrefEmail, hrefTelefono } from './cliente-contacto';
import {
  DETALLE_CLIENTE_AVISO_MENSAJES,
  estadoDesdeCliente,
  leerAvisoDetalleCliente,
  rutaEditarCliente,
  type DesdeCliente,
} from './cliente-navegacion';
import { ClienteNoEncontrado } from './cliente-no-encontrado';
import type { ClienteDetalle, DevolucionDelCliente, ViajeDelCliente } from './clientes-api';
import { DETALLE_LIMIT } from './constants';
import { useClienteVista, useDevolucionesDelCliente, useViajesDelCliente } from './use-clientes';

const AVISO_AUTOCIERRE_MS = 5000;

// Foco visible de los enlaces de las filas (los de la fila de devolución son dos hermanos y se dibuja HACIA ADENTRO).
const FOCO = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';
const FOCO_ADENTRO = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring';

/** "Rosario → Córdoba": la flecha es decorativa y el lector de pantalla oye "a" entre origen y destino. */
function Recorrido({ origen, destino }: { origen: string; destino: string }) {
  return (
    <>
      {origen} <span aria-hidden="true">→</span>
      <span className="sr-only"> a </span> {destino}
    </>
  );
}

/**
 * Detalle de un cliente (`/clientes/:id`), de SOLO LECTURA: sus datos de contacto, los viajes en los que tiene alguna
 * entrega (los últimos 50) y sus devoluciones (las últimas 50). Desde acá se edita el cliente, se abre el detalle de un
 * viaje o la edición de una devolución.
 *
 * Volver: a la lista de Clientes con su búsqueda (`state.volver`, saneado con `sanitizeVolverClientes`). Al abrir un viaje
 * o una devolución, el cliente viaja en el `state` (`desdeCliente`, un uuid; ver `estadoDesdeCliente`) para que esas
 * pantallas vuelvan acá. Nada se navega con texto del estado o de la URL: las rutas se arman en el código con ids
 * validados, y el aviso es una lista blanca.
 *
 * Cada sección tiene su propio error con "Reintentar" y no tapa lo que ya estaba cargado. Un id inexistente (o de otro
 * transportista: la base no distingue) muestra "Cliente no encontrado".
 */
export function ClienteDetallePage() {
  useScrollToTopOnMount();
  const params = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  const volver = sanitizeVolverClientes((location.state as { volver?: unknown } | null)?.volver);
  // Un id que no es uuid no se consulta: es "no encontrado" sin pedir nada.
  const id = isUuid(params.id) ? params.id.toLowerCase() : null;

  const clienteQuery = useClienteVista(id);
  const viajesQuery = useViajesDelCliente(id);
  const devolucionesQuery = useDevolucionesDelCliente(id);

  // Aviso de "Cliente guardado" o "Devolución guardada/eliminada" que llega en `location.state` (lista blanca).
  const aviso = leerAvisoDetalleCliente(location.state);
  const cerrarAviso = useCallback(() => {
    // Se conserva el `volver`: sin él, el enlace "Clientes" perdería la búsqueda.
    navigate({ pathname: location.pathname, search: location.search }, { replace: true, state: { volver } });
  }, [navigate, location.pathname, location.search, volver]);
  useEffect(() => {
    if (!aviso) return;
    const timeoutId = window.setTimeout(cerrarAviso, AVISO_AUTOCIERRE_MS);
    return () => window.clearTimeout(timeoutId);
  }, [aviso, cerrarAviso]);

  const cliente = clienteQuery.data ?? null;

  let contenido;
  if (id === null) {
    contenido = <ClienteNoEncontrado volver={volver} />;
  } else if (clienteQuery.isError && clienteQuery.data === undefined) {
    // Solo si NO hay datos: un refresco fallido con el cliente ya a la vista no lo reemplaza por el error.
    contenido = (
      <InlineError
        message={mapDataError(clienteQuery.error)}
        onRetry={() => void clienteQuery.refetch()}
        retrying={clienteQuery.isFetching}
      />
    );
  } else if (clienteQuery.isPending) {
    contenido = <ListSkeleton rows={4} />;
  } else if (cliente === null) {
    contenido = <ClienteNoEncontrado volver={volver} />;
  } else {
    const desdeCliente: DesdeCliente = { id: cliente.id, volver };
    contenido = (
      <>
        <DatosDelCliente cliente={cliente} volver={volver} />
        <ViajesDelCliente desdeCliente={desdeCliente} viajesQuery={viajesQuery} />
        <DevolucionesDelCliente desdeCliente={desdeCliente} devolucionesQuery={devolucionesQuery} />
      </>
    );
  }

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <Link
          to={`/clientes${volver}`}
          className={cn(
            '-ml-2 inline-flex min-h-12 items-center gap-1 rounded-md px-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground',
            FOCO,
          )}
        >
          <ChevronLeft className="size-5" aria-hidden="true" /> Clientes
        </Link>
        <PageHeader title={cliente ? cliente.nombre : 'Cliente'} />
      </div>

      {aviso ? (
        <Alert role="status" className="border-primary/50 bg-primary/10">
          <CheckCircle2 aria-hidden="true" className="text-primary" />
          <div className="flex items-center gap-2">
            <AlertDescription className="flex-1 font-medium">{DETALLE_CLIENTE_AVISO_MENSAJES[aviso]}</AlertDescription>
            <button
              type="button"
              onClick={cerrarAviso}
              aria-label="Cerrar aviso"
              className="-my-3 -mr-2 flex h-12 w-12 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="size-5" aria-hidden="true" />
            </button>
          </div>
        </Alert>
      ) : null}

      {contenido}
    </div>
  );
}

/**
 * Teléfono, email y dirección, y el acceso a editar el cliente. El teléfono y el email son enlaces (`tel:` / `mailto:`)
 * SOLO si pasan la validación estricta de `cliente-contacto.ts`; si no, se muestran como texto. Todo lo que escribió el
 * usuario se muestra como texto (nunca como HTML).
 */
function DatosDelCliente({ cliente, volver }: { cliente: ClienteDetalle; volver: string }) {
  const telefono = cliente.contacto_telefono;
  const email = cliente.contacto_email;
  const direccion = cliente.direccion;
  const hrefTel = hrefTelefono(telefono);
  const hrefMail = hrefEmail(email);
  const sinDatos = !telefono && !email && !direccion;
  const enlace = cn(
    'inline-flex min-h-12 items-center break-all rounded-md font-semibold text-primary underline underline-offset-4',
    FOCO,
  );

  return (
    <section aria-labelledby="cliente-datos-titulo" className="space-y-4 rounded-lg border border-border bg-card p-4">
      <h2 id="cliente-datos-titulo" className="text-sm font-medium text-muted-foreground">
        Datos de contacto
      </h2>
      {sinDatos ? (
        <p className="text-muted-foreground">Sin datos de contacto.</p>
      ) : (
        <dl className="space-y-3">
          {telefono ? (
            <div>
              <dt className="text-sm text-muted-foreground">Teléfono</dt>
              <dd className="text-base">
                {hrefTel ? (
                  <a href={hrefTel} className={enlace} aria-label={`Llamar al ${telefono}`}>
                    {telefono}
                  </a>
                ) : (
                  <span className="break-words font-semibold">{telefono}</span>
                )}
              </dd>
            </div>
          ) : null}
          {email ? (
            <div>
              <dt className="text-sm text-muted-foreground">Email</dt>
              <dd className="text-base">
                {hrefMail ? (
                  <a href={hrefMail} className={enlace} aria-label={`Escribir a ${email}`}>
                    {email}
                  </a>
                ) : (
                  <span className="break-all font-semibold">{email}</span>
                )}
              </dd>
            </div>
          ) : null}
          {direccion ? (
            <div>
              <dt className="text-sm text-muted-foreground">Dirección</dt>
              <dd className="whitespace-pre-line break-words text-base font-semibold">{direccion}</dd>
            </div>
          ) : null}
        </dl>
      )}

      <Button asChild variant="outline" className="w-full sm:w-auto">
        <Link to={rutaEditarCliente(cliente.id)} state={{ volver }}>
          <Pencil aria-hidden="true" /> Editar cliente
        </Link>
      </Button>
    </section>
  );
}

interface ViajesDelClienteProps {
  desdeCliente: DesdeCliente;
  viajesQuery: ReturnType<typeof useViajesDelCliente>;
}

/** El texto de las incidencias del cliente en un viaje (puede tener más de una entrega en el mismo viaje), o null. */
function incidenciasDe(viaje: ViajeDelCliente): string | null {
  const textos = viaje.entregas.map((entrega) => entrega.incidencias?.trim() ?? '').filter((texto) => texto !== '');
  return textos.length > 0 ? textos.join(' · ') : null;
}

/** Los viajes con alguna entrega de este cliente (del más nuevo al más viejo). Cada uno lleva a su detalle. */
function ViajesDelCliente({ desdeCliente, viajesQuery }: ViajesDelClienteProps) {
  const items = viajesQuery.data?.items ?? [];
  const truncado = viajesQuery.data?.truncado ?? false;

  return (
    <SeccionDelCliente
      id="cliente-viajes-titulo"
      titulo="Viajes"
      cantidad={items.length}
      truncado={truncado}
      query={viajesQuery}
      vacio="Todavía no hay viajes con entregas a este cliente."
      aviso={`Se muestran los ${DETALLE_LIMIT} viajes más recientes.`}
    >
      <ul className="space-y-2">
        {items.map((viaje) => {
          const incidencias = incidenciasDe(viaje);
          return (
            <li key={viaje.id}>
              <Link
                to={rutaDelViaje(viaje.id)}
                state={estadoDesdeCliente(desdeCliente)}
                className={cn(
                  'flex min-h-16 items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:bg-accent',
                  FOCO,
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 break-words font-medium">
                    <Recorrido origen={viaje.origen} destino={viaje.destino} />
                  </p>
                  <p className="text-sm text-muted-foreground">{formatDateWithYear(viaje.fecha)}</p>
                  {incidencias ? (
                    <p className="line-clamp-2 break-words text-sm text-muted-foreground">Incidencias: {incidencias}</p>
                  ) : null}
                </div>
                <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
              </Link>
            </li>
          );
        })}
      </ul>
    </SeccionDelCliente>
  );
}

interface DevolucionesDelClienteProps {
  desdeCliente: DesdeCliente;
  devolucionesQuery: ReturnType<typeof useDevolucionesDelCliente>;
}

/**
 * Las devoluciones de este cliente (la más reciente primero, por la fecha de su viaje). Cada fila tiene DOS enlaces
 * hermanos (nunca uno dentro de otro): lo principal (motivo y descripción) abre la edición de la devolución con el origen
 * `cliente` (guardar o borrar vuelve acá), y la franja de abajo (el viaje) abre el detalle del viaje.
 */
function DevolucionesDelCliente({ desdeCliente, devolucionesQuery }: DevolucionesDelClienteProps) {
  const items = devolucionesQuery.data?.items ?? [];
  const truncado = devolucionesQuery.data?.truncado ?? false;

  return (
    <SeccionDelCliente
      id="cliente-devoluciones-titulo"
      titulo="Devoluciones"
      cantidad={items.length}
      truncado={truncado}
      query={devolucionesQuery}
      vacio="Este cliente no tiene devoluciones."
      aviso={`Se muestran las ${DETALLE_LIMIT} devoluciones más recientes.`}
    >
      <ul className="space-y-2">
        {items.map((devolucion) => (
          <DevolucionDelClienteItem key={devolucion.id} devolucion={devolucion} desdeCliente={desdeCliente} />
        ))}
      </ul>
    </SeccionDelCliente>
  );
}

function DevolucionDelClienteItem({ devolucion, desdeCliente }: { devolucion: DevolucionDelCliente; desdeCliente: DesdeCliente }) {
  const { viajes: viaje } = devolucion;
  return (
    <li className="rounded-lg border border-border bg-card">
      <Link
        to={rutaEditarDevolucion(devolucion.viaje_id, devolucion.id)}
        state={estadoEditarDesdeCliente(desdeCliente)}
        className={cn('flex min-h-16 items-center gap-3 rounded-t-lg px-4 py-3 transition-colors hover:bg-accent', FOCO_ADENTRO)}
      >
        <div className="min-w-0 flex-1">
          <p className="font-medium">{MOTIVO_LABELS[devolucion.motivo]}</p>
          {devolucion.descripcion ? (
            <p className="line-clamp-2 break-words text-sm text-muted-foreground">{devolucion.descripcion}</p>
          ) : null}
        </div>
        <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      </Link>
      <Link
        to={rutaDelViaje(devolucion.viaje_id)}
        state={estadoDesdeCliente(desdeCliente)}
        className={cn(
          'flex min-h-12 items-center gap-2 rounded-b-lg border-t border-border px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
          FOCO_ADENTRO,
        )}
      >
        <Truck className="size-4 shrink-0" aria-hidden="true" />
        <span className="line-clamp-2 min-w-0 flex-1 break-words">
          <Recorrido origen={viaje.origen} destino={viaje.destino} />
        </span>
        <span className="shrink-0 tabular-nums">{formatDateWithYear(viaje.fecha)}</span>
        <ChevronRight className="size-4 shrink-0" aria-hidden="true" />
      </Link>
    </li>
  );
}

interface SeccionDelClienteProps {
  id: string;
  titulo: string;
  cantidad: number;
  truncado: boolean;
  query: {
    data: unknown;
    isError: boolean;
    error: unknown;
    isFetching: boolean;
    refetch: () => unknown;
  };
  vacio: string;
  aviso: string;
  children: ReactNode;
}

/**
 * Esqueleto común de las dos secciones: título con la cantidad ("+" si hay más de las que se muestran), error con
 * "Reintentar" (sin tapar lo ya cargado), carga, vacío y el aviso del tope.
 */
function SeccionDelCliente({ id, titulo, cantidad, truncado, query, vacio, aviso, children }: SeccionDelClienteProps) {
  const errorLista = query.isError ? (
    <InlineError message={mapDataError(query.error)} onRetry={() => void query.refetch()} retrying={query.isFetching} />
  ) : null;

  let contenido;
  if (query.data === undefined) {
    contenido = errorLista ?? <ListSkeleton rows={2} />;
  } else if (cantidad === 0) {
    contenido = (
      <>
        {errorLista}
        <p className="text-muted-foreground">{vacio}</p>
      </>
    );
  } else {
    contenido = (
      <>
        {errorLista}
        {truncado ? (
          <Alert>
            <Info aria-hidden="true" />
            <AlertDescription>{aviso}</AlertDescription>
          </Alert>
        ) : null}
        {children}
      </>
    );
  }

  return (
    <section aria-labelledby={id} className="space-y-3">
      <h2 id={id} className="text-lg font-semibold">
        {cantidad > 0 ? `${titulo} (${cantidad}${truncado ? '+' : ''})` : titulo}
      </h2>
      {contenido}
    </section>
  );
}
