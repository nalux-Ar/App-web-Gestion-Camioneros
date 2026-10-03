import { useCallback, useEffect } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { CheckCircle2, Info, Plus, Truck, X } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/shared/empty-state';
import { FixedActionBar } from '@/components/shared/fixed-action-bar';
import { InlineError } from '@/components/shared/inline-error';
import { ListSkeleton } from '@/components/shared/list-skeleton';
import { MonthPicker } from '@/components/shared/month-picker';
import { PageHeader } from '@/components/shared/page-header';
import { mapDataError } from '@/lib/data-errors';
import { formatMonthLabel } from '@/lib/dates';
import { formatNumber } from '@/lib/numbers';
import { useScrollToTopOnMount } from '@/lib/use-scroll-to-top';
import { AVISO_MENSAJES, LIST_LIMIT, type ViajeAviso } from './constants';
import { useViajesDelMes } from './use-viajes';
import { ViajeItem } from './viaje-item';
import { filtroToParams, filtroToSearch, readFiltro, type ViajesFiltro } from './viajes-filters';
import { totalesDelMes } from './viajes-list';

const AVISO_AUTOCIERRE_MS = 5000;

function leerAviso(state: unknown): ViajeAviso | null {
  const aviso = (state as { aviso?: unknown } | null)?.aviso;
  return aviso === 'guardado' || aviso === 'eliminado' ? aviso : null;
}

/**
 * Lista de viajes de un mes (`/viajes`): selector de mes, resumen (cantidad, km e ingresos del mes) y los
 * viajes del más nuevo al más viejo. El mes vive en la URL (`?mes=2026-08`), validado: si el parámetro es
 * inválido se ignora y se usa el mes actual.
 */
export function ViajesPage() {
  useScrollToTopOnMount();
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();

  const filtro = readFiltro(searchParams);
  const viajesQuery = useViajesDelMes(filtro);

  // `search` actual (ya normalizado): al detalle de un viaje y al nuevo viaje para que "volver" conserve el mes.
  const volver = filtroToSearch(filtro);

  // Aviso de "Viaje guardado/eliminado" que llega desde el formulario en `location.state`.
  const aviso = leerAviso(location.state);
  const cerrarAviso = useCallback(() => {
    navigate({ pathname: location.pathname, search: location.search }, { replace: true, state: null });
  }, [navigate, location.pathname, location.search]);
  useEffect(() => {
    if (!aviso) return;
    const timeoutId = window.setTimeout(cerrarAviso, AVISO_AUTOCIERRE_MS);
    return () => window.clearTimeout(timeoutId);
  }, [aviso, cerrarAviso]);

  function cambiarFiltro(siguiente: ViajesFiltro) {
    setSearchParams(filtroToParams(siguiente), { replace: true });
  }

  const items = viajesQuery.data?.items ?? [];
  const truncado = viajesQuery.data?.truncado ?? false;
  const totales = totalesDelMes(items);
  const mesLabel = formatMonthLabel(filtro.mes);

  // El mismo botón se ofrece en el encabezado y el estado vacío (desde `md`) y fijo abajo (celular).
  const nuevoViaje = (
    <Button asChild size="lg">
      <Link to="/viajes/nuevo" state={{ volver }}>
        <Plus aria-hidden="true" /> Nuevo viaje
      </Link>
    </Button>
  );

  // Si falla (red, servidor) se avisa con "Reintentar"; si ya había una lista cargada (p.ej. falla al
  // refrescar al volver sin señal) se la sigue mostrando debajo del aviso, en vez de taparla.
  const errorLista = viajesQuery.isError ? (
    <InlineError
      message={mapDataError(viajesQuery.error)}
      onRetry={() => void viajesQuery.refetch()}
      retrying={viajesQuery.isFetching}
    />
  ) : null;

  let contenido;
  if (viajesQuery.data === undefined) {
    contenido = errorLista ?? <ListSkeleton rows={5} />;
  } else if (items.length === 0) {
    contenido = (
      <>
        {errorLista}
        <EmptyState
          icon={Truck}
          title={`Todavía no hay viajes en ${mesLabel}`}
          description="Carga el primero para empezar a llevar el control."
          action={nuevoViaje}
          actionDesktopOnly
        />
      </>
    );
  } else {
    contenido = (
      <>
        {errorLista}
        <section aria-labelledby="viajes-resumen-titulo" className="rounded-lg border border-border bg-card p-4">
          <h2 id="viajes-resumen-titulo" className="text-sm font-medium text-muted-foreground">
            Resumen de {mesLabel}
          </h2>
          <p className="mt-1 text-3xl font-semibold tabular-nums">
            {totales.viajes === 1 ? '1 viaje' : `${totales.viajes} viajes${truncado ? ' (los más recientes)' : ''}`}
          </p>
          <dl className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <dt className="text-sm text-muted-foreground">Km totales</dt>
              <dd className="text-lg font-semibold tabular-nums [overflow-wrap:anywhere]">{formatNumber(totales.km, { decimales: 1, fijos: false })}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Ingresos</dt>
              <dd className="text-lg font-semibold tabular-nums [overflow-wrap:anywhere]">{formatNumber(totales.ingreso, { decimales: 2 })}</dd>
            </div>
          </dl>
        </section>

        {truncado ? (
          <Alert>
            <Info aria-hidden="true" />
            <AlertDescription>
              Hay más de {LIST_LIMIT} viajes en este mes. Se muestran los {LIST_LIMIT} más recientes y el resumen solo
              suma esos.
            </AlertDescription>
          </Alert>
        ) : null}

        <ul className="space-y-2">
          {items.map((viaje) => (
            <ViajeItem key={viaje.id} viaje={viaje} volver={volver} />
          ))}
        </ul>
      </>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Viajes" action={nuevoViaje} actionDesktopOnly />

      {aviso ? (
        <Alert role="status" className="border-primary/50 bg-primary/10">
          <CheckCircle2 aria-hidden="true" className="text-primary" />
          <div className="flex items-center gap-2">
            <AlertDescription className="flex-1 font-medium">{AVISO_MENSAJES[aviso]}</AlertDescription>
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

      <MonthPicker value={filtro.mes} onChange={(mes) => cambiarFiltro({ mes })} />

      {contenido}

      {/* En el celular el botón queda fijo abajo (en escritorio vive en el encabezado). Último hijo de la pantalla. */}
      <FixedActionBar>{nuevoViaje}</FixedActionBar>
    </div>
  );
}
