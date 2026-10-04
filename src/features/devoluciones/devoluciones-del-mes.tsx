import { Link } from 'react-router';
import { Info, PackageX } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/shared/empty-state';
import { InlineError } from '@/components/shared/inline-error';
import { ListSkeleton } from '@/components/shared/list-skeleton';
import { filtroToSearch, type ViajesFiltro } from '@/features/viajes/viajes-filters';
import { mapDataError } from '@/lib/data-errors';
import { formatMonthLabel } from '@/lib/dates';
import { LIMITE_MES_ALCANZADO_MESSAGE, SIN_DEVOLUCIONES_EN_EL_MES_DESCRIPTION } from './constants';
import { DevolucionDelMesItem } from './devolucion-del-mes-item';
import { resumenDelMes, textoPorMotivo, textoTotalDevoluciones } from './devoluciones-list';
import { useDevolucionesDelMes } from './use-devoluciones';

/**
 * La pestaña Devoluciones de `/viajes`: resumen del mes (total y conteo por motivo) y las devoluciones del mes, la más
 * reciente primero. Es un componente aparte de la lista de viajes a propósito: `ViajesPage` renderiza uno u otro, así la
 * consulta de devoluciones se pide SOLO con esta pestaña activa (y la de viajes solo con la suya) y no hay hooks
 * condicionales.
 *
 * Sin buscador ni filtro. El mes es el de la fecha del VIAJE (la devolución no tiene fecha propia). Sin acción de alta: las
 * devoluciones se cargan desde el detalle de un viaje, y el estado vacío lo explica y lleva a la pestaña Viajes del mismo mes.
 */
export function DevolucionesDelMes({ filtro }: { filtro: ViajesFiltro }) {
  const devolucionesQuery = useDevolucionesDelMes(filtro);

  // `search` actual (ya normalizado): a la edición y al detalle del viaje, para que "volver" conserve la pestaña y el mes.
  const volver = filtroToSearch(filtro);

  const items = devolucionesQuery.data?.items ?? [];
  const truncado = devolucionesQuery.data?.truncado ?? false;
  const resumen = resumenDelMes(items);
  const mesLabel = formatMonthLabel(filtro.mes);

  // Si falla (red, servidor) se avisa con "Reintentar"; si ya había una lista cargada (p.ej. falla al refrescar al volver
  // sin señal) se la sigue mostrando debajo del aviso, en vez de taparla.
  const errorLista = devolucionesQuery.isError ? (
    <InlineError
      message={mapDataError(devolucionesQuery.error)}
      onRetry={() => void devolucionesQuery.refetch()}
      retrying={devolucionesQuery.isFetching}
    />
  ) : null;

  if (devolucionesQuery.data === undefined) return errorLista ?? <ListSkeleton rows={5} />;

  if (items.length === 0) {
    return (
      <>
        {errorLista}
        <EmptyState
          icon={PackageX}
          title={`No hay devoluciones en ${mesLabel}`}
          description={SIN_DEVOLUCIONES_EN_EL_MES_DESCRIPTION}
          // Sin `actionDesktopOnly`: acá no hay barra fija abajo en el celular, el enlace tiene que verse en todos los anchos.
          action={
            <Button asChild size="lg" variant="outline">
              <Link to={{ pathname: '/viajes', search: filtroToSearch({ ...filtro, vista: 'viajes' }) }} replace>
                Ir a Viajes
              </Link>
            </Button>
          }
        />
      </>
    );
  }

  return (
    <>
      {errorLista}
      <section aria-labelledby="devoluciones-resumen-titulo" className="rounded-lg border border-border bg-card p-4">
        <h2 id="devoluciones-resumen-titulo" className="text-sm font-medium text-muted-foreground">
          Resumen de {mesLabel}
        </h2>
        <p className="mt-1 text-3xl font-semibold tabular-nums">{textoTotalDevoluciones(resumen.total, truncado)}</p>
        <p className="mt-2 text-base">{textoPorMotivo(resumen.porMotivo)}</p>
      </section>

      {truncado ? (
        <Alert>
          <Info aria-hidden="true" />
          <AlertDescription>{LIMITE_MES_ALCANZADO_MESSAGE}</AlertDescription>
        </Alert>
      ) : null}

      <ul className="space-y-2">
        {items.map((devolucion) => (
          <DevolucionDelMesItem key={devolucion.id} devolucion={devolucion} volver={volver} />
        ))}
      </ul>
    </>
  );
}
