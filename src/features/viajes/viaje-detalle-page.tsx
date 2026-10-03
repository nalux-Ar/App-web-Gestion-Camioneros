import { useCallback, useEffect, useMemo, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { CheckCircle2, ChevronLeft, Info, Pencil, Plus, X } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FixedActionBar } from '@/components/shared/fixed-action-bar';
import { InlineError } from '@/components/shared/inline-error';
import { ListSkeleton } from '@/components/shared/list-skeleton';
import { PageHeader } from '@/components/shared/page-header';
import type { Categoria } from '@/features/gastos/categorias';
import { GastoItem } from '@/features/gastos/gasto-item';
import { LIST_LIMIT as GASTOS_LIST_LIMIT } from '@/features/gastos/constants';
import { sumMontos } from '@/features/gastos/gastos-list';
import { useCategorias, useGastosDelViaje } from '@/features/gastos/use-gastos';
import { mapDataError } from '@/lib/data-errors';
import { formatDateWithYear } from '@/lib/dates';
import { formatNumber } from '@/lib/numbers';
import { useScrollToTopOnMount } from '@/lib/use-scroll-to-top';
import { isUuid } from '@/lib/uuid';
import { useViajeVista } from './use-viajes';
import { DETALLE_AVISO_MENSAJES, estadoDesdeViaje, leerAvisoDetalle } from './viaje-navegacion';
import { ViajeNoEncontrado } from './viaje-no-encontrado';
import type { ViajeVista } from './viajes-api';
import { sanitizeVolver } from './viajes-filters';
import { kmDelViaje } from './viajes-list';

const AVISO_AUTOCIERRE_MS = 5000;

/** "Rosario → Córdoba": la flecha es decorativa y el lector de pantalla oye "a" entre origen y destino. */
function Recorrido({ origen, destino }: { origen: string; destino: string }) {
  return (
    <>
      {origen} <span aria-hidden="true">→</span>
      <span className="sr-only"> a </span> {destino}
    </>
  );
}

function textoCantidadGastos(cantidad: number, truncado: boolean): string {
  if (cantidad === 1) return '1 gasto';
  return truncado ? `${cantidad} gastos (los más recientes)` : `${cantidad} gastos`;
}

/**
 * Detalle de un viaje (`/viajes/:id`), de SOLO LECTURA: datos del viaje, sus entregas con el nombre del cliente y sus
 * incidencias, y los gastos vinculados con su total. NO calcula un "resultado" (ingreso menos gastos): eso queda para el
 * Resumen. Desde acá se carga un gasto de este viaje (acción principal) o se edita el viaje.
 *
 * Qué NO hace: navegar a algo que venga del estado o de la URL. El `volver` (el mes de la lista) se sanea con
 * `sanitizeVolver`, el aviso es una lista blanca y a los formularios se les pasa un dato validado
 * (`estadoDesdeViaje`), nunca una ruta.
 */
export function ViajeDetallePage() {
  useScrollToTopOnMount();
  const params = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  const volver = sanitizeVolver((location.state as { volver?: unknown } | null)?.volver);
  // Un id que no es uuid no se consulta: es "no encontrado" sin pedir nada.
  const id = isUuid(params.id) ? params.id.toLowerCase() : null;

  const viajeQuery = useViajeVista(id);
  const gastosQuery = useGastosDelViaje(id);
  const categoriasQuery = useCategorias();
  const categorias = categoriasQuery.data;
  const categoriasPorId = useMemo(() => new Map((categorias ?? []).map((categoria) => [categoria.id, categoria])), [categorias]);

  // Aviso de "Gasto guardado / eliminado" o "Viaje guardado" que llega desde el formulario en `location.state`.
  const aviso = leerAvisoDetalle(location.state);
  const cerrarAviso = useCallback(() => {
    // Se conserva el `volver`: sin él, el enlace "Viajes" perdería el mes de la lista.
    navigate({ pathname: location.pathname, search: location.search }, { replace: true, state: { volver } });
  }, [navigate, location.pathname, location.search, volver]);
  useEffect(() => {
    if (!aviso) return;
    const timeoutId = window.setTimeout(cerrarAviso, AVISO_AUTOCIERRE_MS);
    return () => window.clearTimeout(timeoutId);
  }, [aviso, cerrarAviso]);

  const viaje = viajeQuery.data ?? null;

  // El mismo botón se ofrece en el encabezado (desde `md`) y fijo abajo (celular), como en Gastos y Viajes.
  const cargarGasto = viaje ? (
    <Button asChild size="lg">
      <Link to={`/gastos/nuevo?viaje=${viaje.id}`} state={estadoDesdeViaje(viaje.id, volver)}>
        <Plus aria-hidden="true" /> Cargar gasto de este viaje
      </Link>
    </Button>
  ) : null;

  let contenido;
  if (id === null) {
    contenido = <ViajeNoEncontrado volver={volver} />;
  } else if (viajeQuery.isError && viajeQuery.data === undefined) {
    // Solo si NO hay datos: un refresco fallido con el viaje ya a la vista no lo reemplaza por el error.
    contenido = (
      <InlineError
        message={mapDataError(viajeQuery.error)}
        onRetry={() => void viajeQuery.refetch()}
        retrying={viajeQuery.isFetching}
      />
    );
  } else if (viajeQuery.isPending) {
    contenido = <ListSkeleton rows={4} />;
  } else if (viaje === null) {
    contenido = <ViajeNoEncontrado volver={volver} />;
  } else {
    contenido = (
      <>
        <DatosDelViaje viaje={viaje} volver={volver} />
        <EntregasDelViaje viaje={viaje} />
        <GastosDelViaje
          viajeId={viaje.id}
          volver={volver}
          gastosQuery={gastosQuery}
          categoriasPorId={categoriasPorId}
          errorCategorias={
            categoriasQuery.isError && categorias === undefined ? (
              <InlineError
                message={`No pudimos cargar las categorías. ${mapDataError(categoriasQuery.error)}`}
                onRetry={() => void categoriasQuery.refetch()}
                retrying={categoriasQuery.isFetching}
              />
            ) : null
          }
        />
      </>
    );
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
        <PageHeader
          title={viaje ? <Recorrido origen={viaje.origen} destino={viaje.destino} /> : 'Viaje'}
          action={cargarGasto}
          actionDesktopOnly
        />
      </div>

      {aviso ? (
        <Alert role="status" className="border-primary/50 bg-primary/10">
          <CheckCircle2 aria-hidden="true" className="text-primary" />
          <div className="flex items-center gap-2">
            <AlertDescription className="flex-1 font-medium">{DETALLE_AVISO_MENSAJES[aviso]}</AlertDescription>
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

      {/* En el celular el botón queda fijo abajo (en escritorio vive en el encabezado). Último hijo de la pantalla. */}
      {cargarGasto ? <FixedActionBar>{cargarGasto}</FixedActionBar> : null}
    </div>
  );
}

/** Fecha, kilometraje, ingreso y observaciones, y el acceso a editar el viaje. */
function DatosDelViaje({ viaje, volver }: { viaje: ViajeVista; volver: string }) {
  const km = kmDelViaje(viaje);

  return (
    <section aria-labelledby="viaje-datos-titulo" className="space-y-4 rounded-lg border border-border bg-card p-4">
      <h2 id="viaje-datos-titulo" className="sr-only">
        Datos del viaje
      </h2>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-4">
        <div>
          <dt className="text-sm text-muted-foreground">Fecha</dt>
          <dd className="text-base font-semibold">{formatDateWithYear(viaje.fecha)}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Ingreso</dt>
          <dd className="text-base font-semibold tabular-nums [overflow-wrap:anywhere]">
            {viaje.ingreso !== null ? formatNumber(viaje.ingreso, { decimales: 2 }) : 'Sin cargar'}
          </dd>
        </div>
        <div className="col-span-2">
          <dt className="text-sm text-muted-foreground">Kilometraje</dt>
          <dd className="text-base font-semibold tabular-nums">
            {km.tipo === 'km'
              ? `${formatNumber(km.km, { decimales: 1, fijos: false })} km`
              : km.tipo === 'sin-final'
                ? 'Km final sin cargar'
                : 'Sin cargar'}
          </dd>
        </div>
        {viaje.observaciones ? (
          <div className="col-span-2">
            <dt className="text-sm text-muted-foreground">Observaciones</dt>
            <dd className="whitespace-pre-line break-words text-base">{viaje.observaciones}</dd>
          </div>
        ) : null}
      </dl>

      <Button asChild variant="outline" className="w-full sm:w-auto">
        <Link to={`/viajes/${viaje.id}/editar`} state={estadoDesdeViaje(viaje.id, volver)}>
          <Pencil aria-hidden="true" /> Editar viaje
        </Link>
      </Button>
    </section>
  );
}

/** Las entregas en el orden en que se cargaron, con el nombre del cliente y sus incidencias. */
function EntregasDelViaje({ viaje }: { viaje: ViajeVista }) {
  const cantidad = viaje.entregas.length;

  return (
    <section aria-labelledby="viaje-entregas-titulo" className="space-y-3">
      <h2 id="viaje-entregas-titulo" className="text-lg font-semibold">
        {cantidad > 0 ? `Entregas (${cantidad})` : 'Entregas'}
      </h2>
      {cantidad === 0 ? (
        <p className="text-muted-foreground">Este viaje no tiene entregas cargadas.</p>
      ) : (
        <ul className="space-y-2">
          {viaje.entregas.map((entrega) => (
            <li key={entrega.id} className="rounded-lg border border-border bg-card px-4 py-3">
              <p className="break-words font-medium">{entrega.clientes?.nombre ?? 'Cliente'}</p>
              {entrega.incidencias ? (
                <p className="whitespace-pre-line break-words text-sm text-muted-foreground">
                  Incidencias: {entrega.incidencias}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

interface GastosDelViajeProps {
  viajeId: string;
  volver: string;
  gastosQuery: ReturnType<typeof useGastosDelViaje>;
  categoriasPorId: ReadonlyMap<string, Categoria>;
  errorCategorias: ReactNode;
}

/** Los gastos del viaje (del más nuevo al más viejo) con su total, sumado en centavos enteros. Cada uno enlaza a su edición. */
function GastosDelViaje({ viajeId, volver, gastosQuery, categoriasPorId, errorCategorias }: GastosDelViajeProps) {
  const items = gastosQuery.data?.items ?? [];
  const truncado = gastosQuery.data?.truncado ?? false;
  const total = sumMontos(items);

  // Si falla (red, servidor) se avisa con "Reintentar"; si ya había una lista cargada se la sigue mostrando debajo.
  const errorLista = gastosQuery.isError ? (
    <InlineError
      message={mapDataError(gastosQuery.error)}
      onRetry={() => void gastosQuery.refetch()}
      retrying={gastosQuery.isFetching}
    />
  ) : null;

  let contenido;
  if (gastosQuery.data === undefined) {
    contenido = errorLista ?? <ListSkeleton rows={2} />;
  } else if (items.length === 0) {
    contenido = (
      <>
        {errorLista}
        <p className="text-muted-foreground">Todavía no hay gastos cargados en este viaje.</p>
      </>
    );
  } else {
    contenido = (
      <>
        {errorLista}
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-sm font-medium text-muted-foreground">Total de gastos del viaje</p>
          <p className="mt-1 text-3xl font-semibold tabular-nums [overflow-wrap:anywhere]">
            {formatNumber(total, { decimales: 2 })}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{textoCantidadGastos(items.length, truncado)}</p>
        </div>

        {truncado ? (
          <Alert>
            <Info aria-hidden="true" />
            <AlertDescription>
              Hay más de {GASTOS_LIST_LIMIT} gastos en este viaje. Se muestran los {GASTOS_LIST_LIMIT} más recientes y el
              total solo suma esos.
            </AlertDescription>
          </Alert>
        ) : null}

        {errorCategorias}

        <ul className="space-y-2">
          {items.map((gasto) => (
            <GastoItem
              key={gasto.id}
              gasto={gasto}
              categoria={categoriasPorId.get(gasto.categoria_id)}
              desdeViaje={{ id: viajeId, volver }}
            />
          ))}
        </ul>
      </>
    );
  }

  return (
    <section aria-labelledby="viaje-gastos-titulo" className="space-y-3">
      <h2 id="viaje-gastos-titulo" className="text-lg font-semibold">
        Gastos del viaje
      </h2>
      {contenido}
    </section>
  );
}
