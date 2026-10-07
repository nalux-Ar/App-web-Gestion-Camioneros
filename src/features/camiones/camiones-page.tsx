import { useCallback, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { CheckCircle2, ChevronLeft, ChevronRight, Info, Plus, Truck, X } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/shared/empty-state';
import { FixedActionBar } from '@/components/shared/fixed-action-bar';
import { InlineError } from '@/components/shared/inline-error';
import { ListSkeleton } from '@/components/shared/list-skeleton';
import { PageHeader } from '@/components/shared/page-header';
import { useMember } from '@/features/member/use-member';
import { mapDataError } from '@/lib/data-errors';
import { useScrollToTopOnMount } from '@/lib/use-scroll-to-top';
import { descripcionCamion, type CamionDeLista } from './camion';
import { RUTA_NUEVO_CAMION, leerAvisoCamiones, rutaEditarCamion, textoAvisoCamiones } from './camion-navegacion';
import { CAMIONES_LIMIT } from './constants';
import { formatearPatente } from './patente';
import { useCamiones } from './use-camiones';

const AVISO_AUTOCIERRE_MS = 5000;
const FILA = 'flex min-h-16 items-center gap-3 rounded-lg border border-border bg-card px-4 py-3';
const FOCO = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background';

/**
 * Pantalla de Camiones (`/camiones`): los activos y, plegados, los archivados. Se llega desde la tarjeta "Camiones" de
 * Configuración (y desde "Carga tu camión" en Inicio mientras no haya ninguno): no está en la barra de abajo.
 *
 * Solo el administrador escribe camiones: a él se le ofrecen "Nuevo camión" (en el encabezado desde `md`, fijo abajo en el
 * celular) y cada fila abre la edición. Un chofer ve la lista (la necesita para saber qué camiones hay), sin acciones.
 */
export function CamionesPage() {
  useScrollToTopOnMount();
  const location = useLocation();
  const navigate = useNavigate();
  const { member } = useMember();
  const esAdmin = member?.rol === 'admin';

  // Aviso que llega en `location.state` al volver de guardar, archivar o reactivar (lista blanca: `leerAvisoCamiones`).
  const aviso = leerAvisoCamiones(location.state);
  const cerrarAviso = useCallback(() => {
    navigate({ pathname: location.pathname, search: location.search }, { replace: true, state: null });
  }, [navigate, location.pathname, location.search]);
  useEffect(() => {
    if (!aviso) return;
    const timeoutId = window.setTimeout(cerrarAviso, AVISO_AUTOCIERRE_MS);
    return () => window.clearTimeout(timeoutId);
  }, [aviso, cerrarAviso]);

  const camionesQuery = useCamiones();
  const todos = camionesQuery.data?.items;
  const activos = (todos ?? []).filter((camion) => camion.activa);
  const archivados = (todos ?? []).filter((camion) => !camion.activa);

  const nuevoCamion = esAdmin ? (
    <Button asChild size="lg">
      <Link to={RUTA_NUEVO_CAMION}>
        <Plus aria-hidden="true" /> Nuevo camión
      </Link>
    </Button>
  ) : null;

  const errorLista = camionesQuery.isError ? (
    <InlineError
      message={mapDataError(camionesQuery.error)}
      onRetry={() => void camionesQuery.refetch()}
      retrying={camionesQuery.isFetching}
    />
  ) : null;

  let contenido;
  if (todos === undefined) {
    contenido = errorLista ?? <ListSkeleton rows={3} />;
  } else if (todos.length === 0) {
    contenido = (
      <>
        {errorLista}
        <EmptyState
          icon={Truck}
          title="Todavía no hay camiones cargados"
          description={
            esAdmin
              ? 'Carga tu camión para que cada carga de combustible quede asociada a él y se pueda calcular el rendimiento.'
              : 'El administrador de la cuenta todavía no cargó camiones.'
          }
          action={nuevoCamion ?? undefined}
          actionDesktopOnly
        />
      </>
    );
  } else {
    contenido = (
      <>
        {errorLista}
        {camionesQuery.data?.truncado ? (
          <Alert>
            <Info aria-hidden="true" />
            <AlertDescription>Tienes más de {CAMIONES_LIMIT} camiones: aquí se muestran los primeros {CAMIONES_LIMIT}.</AlertDescription>
          </Alert>
        ) : null}

        <section aria-labelledby="camiones-activos-titulo" className="space-y-3">
          <h2 id="camiones-activos-titulo" className="text-lg font-semibold">
            Activos ({activos.length})
          </h2>
          {activos.length === 0 ? (
            <p className="text-muted-foreground">No tienes camiones activos.</p>
          ) : (
            <ul className="space-y-2">
              {activos.map((camion) => (
                <FilaCamion key={camion.id} camion={camion} esAdmin={esAdmin} />
              ))}
            </ul>
          )}
        </section>

        {archivados.length > 0 ? (
          <details className="group space-y-3">
            <summary
              className={`flex min-h-12 cursor-pointer items-center gap-2 rounded-md text-lg font-semibold marker:content-none ${FOCO}`}
            >
              <ChevronRight className="size-5 shrink-0 transition-transform group-open:rotate-90" aria-hidden="true" />
              Archivados ({archivados.length})
            </summary>
            <ul className="space-y-2 pt-3">
              {archivados.map((camion) => (
                <FilaCamion key={camion.id} camion={camion} esAdmin={esAdmin} />
              ))}
            </ul>
          </details>
        ) : null}
      </>
    );
  }

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <Link
          to="/configuracion"
          className={`-ml-2 inline-flex min-h-12 items-center gap-1 rounded-md px-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground ${FOCO}`}
        >
          <ChevronLeft className="size-5" aria-hidden="true" /> Configuración
        </Link>
        <PageHeader title="Camiones" action={nuevoCamion ?? undefined} actionDesktopOnly />
      </div>

      {aviso ? (
        <Alert role="status" className="border-primary/50 bg-primary/10">
          <CheckCircle2 aria-hidden="true" className="text-primary" />
          <div className="flex items-center gap-2">
            <AlertDescription className="flex-1 font-medium">{textoAvisoCamiones(aviso)}</AlertDescription>
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
      {nuevoCamion ? <FixedActionBar>{nuevoCamion}</FixedActionBar> : null}
    </div>
  );
}

/** Una fila: la patente con espacios y, debajo, marca, modelo y año. Para el administrador es un enlace a la edición. */
function FilaCamion({ camion, esAdmin }: { camion: CamionDeLista; esAdmin: boolean }) {
  const descripcion = descripcionCamion(camion);
  const contenido = (
    <>
      <Truck className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold tabular-nums">
          {formatearPatente(camion.patente)}
          {camion.activa ? null : <span className="font-normal text-muted-foreground"> (archivado)</span>}
        </p>
        {descripcion ? <p className="break-words text-sm text-muted-foreground">{descripcion}</p> : null}
      </div>
    </>
  );

  return (
    <li>
      {esAdmin ? (
        <Link to={rutaEditarCamion(camion.id)} className={`${FILA} transition-colors hover:bg-accent ${FOCO}`}>
          {contenido}
          <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        </Link>
      ) : (
        <div className={FILA}>{contenido}</div>
      )}
    </li>
  );
}
