import { useCallback, useEffect, useMemo } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { CheckCircle2, Info, Plus, Receipt, X } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/shared/empty-state';
import { FixedActionBar } from '@/components/shared/fixed-action-bar';
import { InlineError } from '@/components/shared/inline-error';
import { ListSkeleton } from '@/components/shared/list-skeleton';
import { MonthPicker } from '@/components/shared/month-picker';
import { PageHeader } from '@/components/shared/page-header';
import { SelectField } from '@/components/shared/select-field';
import { mapDataError } from '@/lib/data-errors';
import { formatMonthLabel } from '@/lib/dates';
import { formatNumber } from '@/lib/numbers';
import { useScrollToTopOnMount } from '@/lib/use-scroll-to-top';
import { categoriasParaElegir, nombreParaMostrar, type Categoria } from './categorias';
import { AVISO_MENSAJES, LIST_LIMIT, type GastoAviso } from './constants';
import { GastoItem } from './gasto-item';
import { filtroToParams, filtroToSearch, readFiltro, type GastosFiltro } from './gastos-filters';
import { sumMontos } from './gastos-list';
import { useCategorias, useGastosDelMes } from './use-gastos';

const AVISO_AUTOCIERRE_MS = 5000;

function leerAviso(state: unknown): GastoAviso | null {
  const aviso = (state as { aviso?: unknown } | null)?.aviso;
  return aviso === 'guardado' || aviso === 'eliminado' ? aviso : null;
}

/**
 * Lista de gastos de un mes (`/gastos`): selector de mes, filtro por categoría, total y los gastos
 * del más nuevo al más viejo. Los filtros viven en la URL (`?mes=2026-08&categoria=<uuid>`), validados:
 * si un parámetro es inválido se ignora y se usa el valor por defecto (mes actual, todas las categorías).
 */
export function GastosPage() {
  useScrollToTopOnMount();
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();

  const filtroUrl = readFiltro(searchParams);
  const categoriasQuery = useCategorias();
  const categorias = useMemo<readonly Categoria[]>(() => categoriasQuery.data ?? [], [categoriasQuery.data]);

  // "Cargadas" = hay datos de categorías (aunque un refresco posterior haya fallado: `isSuccess` sería false).
  const categoriasCargadas = categoriasQuery.data !== undefined;

  // Una categoría de la URL que no existe (o es de otro lado) se ignora, apenas se sabe cuáles hay.
  const categoriaValida =
    filtroUrl.categoriaId === null ||
    !categoriasCargadas ||
    categorias.some((categoria) => categoria.id === filtroUrl.categoriaId);
  const filtro: GastosFiltro = categoriaValida ? filtroUrl : { ...filtroUrl, categoriaId: null };

  // Con una categoría en la URL, la lista ESPERA a que carguen las categorías (para validarla) antes de pedir.
  // Si las categorías fallan, sigue esperando (no se pide una lista filtrada por un valor sin validar): se
  // avisa con "Reintentar" y, al recuperarse, se valida y se pide. Sin categoría en la URL no hace falta esperar.
  const esperandoCategorias = filtro.categoriaId !== null && !categoriasCargadas;
  const gastosQuery = useGastosDelMes(filtro, !esperandoCategorias);

  const categoriasPorId = useMemo(() => new Map(categorias.map((categoria) => [categoria.id, categoria])), [categorias]);
  const opcionesFiltro = useMemo(
    () => [
      { value: '', label: 'Todas las categorías' },
      ...categoriasParaElegir(categorias, filtro.categoriaId).map((categoria) => ({
        value: categoria.id,
        label: nombreParaMostrar(categoria),
      })),
    ],
    [categorias, filtro.categoriaId],
  );

  // `search` actual (ya normalizado): a la edición y al nuevo gasto para que "volver" conserve los filtros.
  const volver = filtroToSearch(filtro);

  // Aviso de "Gasto guardado/eliminado" que llega desde el formulario en `location.state`.
  const aviso = leerAviso(location.state);
  const cerrarAviso = useCallback(() => {
    navigate({ pathname: location.pathname, search: location.search }, { replace: true, state: null });
  }, [navigate, location.pathname, location.search]);
  useEffect(() => {
    if (!aviso) return;
    const timeoutId = window.setTimeout(cerrarAviso, AVISO_AUTOCIERRE_MS);
    return () => window.clearTimeout(timeoutId);
  }, [aviso, cerrarAviso]);

  function cambiarFiltro(siguiente: GastosFiltro) {
    setSearchParams(filtroToParams(siguiente), { replace: true });
  }

  const items = gastosQuery.data?.items ?? [];
  const truncado = gastosQuery.data?.truncado ?? false;
  const total = sumMontos(items);
  const mesLabel = formatMonthLabel(filtro.mes);
  const categoriaFiltrada = filtro.categoriaId ? categoriasPorId.get(filtro.categoriaId) : undefined;

  // El mismo botón se ofrece en el encabezado y el estado vacío (desde `md`) y fijo abajo (celular).
  const nuevoGasto = (
    <Button asChild size="lg">
      <Link to="/gastos/nuevo" state={{ volver }}>
        <Plus aria-hidden="true" /> Nuevo gasto
      </Link>
    </Button>
  );

  // Si falla (red, servidor) se avisa con "Reintentar"; si ya había una lista cargada (p.ej. falla al
  // refrescar al volver sin señal) se la sigue mostrando debajo del aviso, en vez de taparla.
  const errorLista = gastosQuery.isError ? (
    <InlineError
      message={mapDataError(gastosQuery.error)}
      onRetry={() => void gastosQuery.refetch()}
      retrying={gastosQuery.isFetching}
    />
  ) : null;

  // Las categorías no cargaron (y no hay una copia anterior): la lista igual se muestra, pero con nombres
  // genéricos y sin poder filtrar; se avisa con "Reintentar".
  const errorCategorias =
    categoriasQuery.isError && !categoriasCargadas ? (
      <InlineError
        message={`No pudimos cargar las categorías. ${mapDataError(categoriasQuery.error)}`}
        onRetry={() => void categoriasQuery.refetch()}
        retrying={categoriasQuery.isFetching}
      />
    ) : null;

  let contenido;
  if (esperandoCategorias && categoriasQuery.isError) {
    contenido = null; // el aviso de las categorías (arriba) ya lo explica; no hay nada que listar todavía
  } else if (gastosQuery.data === undefined) {
    contenido = errorLista ?? <ListSkeleton rows={5} />;
  } else if (items.length === 0) {
    contenido = (
      <>
        {errorLista}
        <EmptyState
          icon={Receipt}
          title={filtro.categoriaId ? 'No hay gastos de esta categoría' : `Todavía no hay gastos en ${mesLabel}`}
          description={
            filtro.categoriaId
              ? `No hay gastos de ${categoriaFiltrada ? nombreParaMostrar(categoriaFiltrada) : 'esa categoría'} en ${mesLabel}.`
              : 'Carga el primero para empezar a llevar el control.'
          }
          action={nuevoGasto}
          actionDesktopOnly
        />
      </>
    );
  } else {
    contenido = (
      <>
        {errorLista}
        <section aria-labelledby="gastos-total-titulo" className="rounded-lg border border-border bg-card p-4">
          <h2 id="gastos-total-titulo" className="text-sm font-medium text-muted-foreground">
            Total de {mesLabel}
            {categoriaFiltrada ? ` · ${nombreParaMostrar(categoriaFiltrada)}` : ''}
          </h2>
          <p className="mt-1 text-3xl font-semibold tabular-nums">{formatNumber(total, { decimales: 2 })}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {items.length === 1 ? '1 gasto' : truncado ? `${items.length} gastos (los más recientes)` : `${items.length} gastos`}
          </p>
        </section>

        {truncado ? (
          <Alert>
            <Info aria-hidden="true" />
            <AlertDescription>
              Hay más de {LIST_LIMIT} gastos en este mes. Se muestran los {LIST_LIMIT} más recientes y el total solo
              suma esos. Filtra por categoría para ver el resto.
            </AlertDescription>
          </Alert>
        ) : null}

        <ul className="space-y-2">
          {items.map((gasto) => (
            <GastoItem key={gasto.id} gasto={gasto} categoria={categoriasPorId.get(gasto.categoria_id)} volver={volver} />
          ))}
        </ul>
      </>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Gastos" action={nuevoGasto} actionDesktopOnly />

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

      <MonthPicker value={filtro.mes} onChange={(mes) => cambiarFiltro({ ...filtro, mes })} />

      <SelectField
        label="Categoría"
        value={filtro.categoriaId ?? ''}
        onChange={(value) => cambiarFiltro({ ...filtro, categoriaId: value === '' ? null : value })}
        options={opcionesFiltro}
        disabled={!categoriasCargadas}
      />

      {errorCategorias}

      {contenido}

      {/* En el celular el botón queda fijo abajo (en escritorio vive en el encabezado). */}
      <FixedActionBar>{nuevoGasto}</FixedActionBar>
    </div>
  );
}
