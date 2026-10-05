import { useCallback, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import { CheckCircle2, ChevronRight, Info, Plus, SearchX, Users, X } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/shared/empty-state';
import { FieldShell } from '@/components/shared/field-shell';
import { FixedActionBar } from '@/components/shared/fixed-action-bar';
import { InlineError } from '@/components/shared/inline-error';
import { ListSkeleton } from '@/components/shared/list-skeleton';
import { PageHeader } from '@/components/shared/page-header';
import { mapDataError } from '@/lib/data-errors';
import { useScrollToTopOnMount } from '@/lib/use-scroll-to-top';
import {
  MAX_BUSQUEDA,
  busquedaToParams,
  busquedaToSearch,
  filtrarClientes,
  hayBusqueda,
  leerBusqueda,
  textoCantidadClientes,
} from './cliente-busqueda';
import { LISTA_CLIENTES_AVISO_MENSAJES, leerAvisoListaClientes, rutaDelCliente } from './cliente-navegacion';
import { CLIENTES_LIMIT } from './clientes-api';
import { useClientes } from './use-clientes';

const AVISO_AUTOCIERRE_MS = 5000;
const BUSCAR_ID = 'clientes-buscar';

/**
 * Pantalla de Clientes (`/clientes`): todos los clientes por orden alfabético (en español, sin distinguir mayúsculas ni
 * tildes), un buscador por nombre y "Nuevo cliente" (en el encabezado desde `md`; fijo abajo en el celular).
 *
 * La búsqueda es LOCAL (filtra la lista ya cargada, sin pedir nada) e ignora tildes y mayúsculas. Vive en la URL
 * (`?q=almacen`, saneada: ver `cliente-busqueda.ts`), así que volver del detalle de un cliente vuelve con la misma búsqueda.
 * La lista es la misma que usan los selectores de entregas y devoluciones (misma caché) y tiene el mismo tope: con más de
 * 500 clientes se avisa que se muestran (y se buscan) los primeros 500.
 */
export function ClientesPage() {
  useScrollToTopOnMount();
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const buscarRef = useRef<HTMLInputElement>(null);

  const q = leerBusqueda(searchParams);
  const conBusqueda = hayBusqueda(q);
  // `search` actual (ya saneado): viaja al detalle y al alta para que "volver" conserve la búsqueda.
  const volver = busquedaToSearch(q);

  // Aviso de "Cliente eliminado" que llega en `location.state` (lista blanca: ver `leerAvisoListaClientes`).
  const aviso = leerAvisoListaClientes(location.state);
  const cerrarAviso = useCallback(() => {
    // Con el `search` de ahora: no se pierde la búsqueda.
    navigate({ pathname: location.pathname, search: location.search }, { replace: true, state: null });
  }, [navigate, location.pathname, location.search]);
  useEffect(() => {
    if (!aviso) return;
    const timeoutId = window.setTimeout(cerrarAviso, AVISO_AUTOCIERRE_MS);
    return () => window.clearTimeout(timeoutId);
  }, [aviso, cerrarAviso]);

  const clientesQuery = useClientes();
  const todos = clientesQuery.data?.items;
  // Sin `useMemo`: filtrar hasta 500 nombres en memoria es barato y la regla del compilador de React no puede asegurar que
  // la búsqueda (sale de `useSearchParams`) no cambie por debajo.
  const visibles = filtrarClientes(todos ?? [], q);
  const truncado = clientesQuery.data?.truncado ?? false;

  function buscar(texto: string) {
    // `replace`: tipear no apila una entrada de historial por letra.
    setSearchParams(busquedaToParams(texto), { replace: true });
  }

  function limpiarBusqueda() {
    buscar('');
    buscarRef.current?.focus();
  }

  // El mismo botón se ofrece en el encabezado y el estado vacío (desde `md`) y fijo abajo (celular).
  const nuevoCliente = (
    <Button asChild size="lg">
      <Link to="/clientes/nuevo" state={{ volver }}>
        <Plus aria-hidden="true" /> Nuevo cliente
      </Link>
    </Button>
  );

  // Si falla (red, servidor) se avisa con "Reintentar"; si ya había una lista cargada se la sigue mostrando debajo.
  const errorLista = clientesQuery.isError ? (
    <InlineError
      message={mapDataError(clientesQuery.error)}
      onRetry={() => void clientesQuery.refetch()}
      retrying={clientesQuery.isFetching}
    />
  ) : null;

  let contenido;
  if (todos === undefined) {
    contenido = errorLista ?? <ListSkeleton rows={5} />;
  } else if (todos.length === 0) {
    contenido = (
      <>
        {errorLista}
        <EmptyState
          icon={Users}
          title="Todavía no tienes clientes"
          description="Crea el primero aquí, o con «Nuevo cliente» al cargar una entrega en un viaje."
          action={nuevoCliente}
          actionDesktopOnly
        />
      </>
    );
  } else {
    contenido = (
      <>
        {errorLista}

        {/* La búsqueda es de la lista ya cargada: no pide nada a la base. `maxLength`: es un buscador, no un dato que se
            guarde (cortar acá no pierde nada); el texto de la URL se sanea igual. */}
        <FieldShell id={BUSCAR_ID} label="Buscar cliente">
          {(control) => (
            <Input
              {...control}
              ref={buscarRef}
              type="search"
              value={q}
              onChange={(event) => buscar(event.target.value)}
              maxLength={MAX_BUSQUEDA}
              autoComplete="off"
              enterKeyHint="search"
              placeholder="Escribe parte del nombre"
            />
          )}
        </FieldShell>

        {/* Siempre en el DOM: los lectores de pantalla anuncian cuántos quedan al tipear. */}
        <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
          {textoCantidadClientes(visibles.length, todos.length, conBusqueda)}
        </p>

        {truncado ? (
          <Alert>
            <Info aria-hidden="true" />
            <AlertDescription>
              Tienes más de {CLIENTES_LIMIT} clientes: aquí se muestran (y se buscan) los primeros {CLIENTES_LIMIT}, por orden
              alfabético.
            </AlertDescription>
          </Alert>
        ) : null}

        {visibles.length === 0 ? (
          <EmptyState
            icon={SearchX}
            // Título FIJO: lo tipeado ya se ve en el buscador. El `?q=` viene de la URL (entrada no confiable) y no se
            // refleja en un encabezado: un enlace armado no puede hacer que la pantalla muestre un mensaje elegido por otro.
            title="Ningún cliente coincide con tu búsqueda"
            description="Revisa cómo lo escribiste o busca otra parte del nombre."
            action={
              <Button type="button" size="lg" variant="outline" onClick={limpiarBusqueda}>
                Limpiar búsqueda
              </Button>
            }
          />
        ) : (
          <ul className="space-y-2">
            {visibles.map((cliente) => (
              <li key={cliente.id}>
                <Link
                  to={rutaDelCliente(cliente.id)}
                  state={{ volver }}
                  className="flex min-h-14 items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  <span className="min-w-0 flex-1 break-words font-medium">{cliente.nombre}</span>
                  <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Clientes" action={nuevoCliente} actionDesktopOnly />

      {aviso ? (
        <Alert role="status" className="border-primary/50 bg-primary/10">
          <CheckCircle2 aria-hidden="true" className="text-primary" />
          <div className="flex items-center gap-2">
            <AlertDescription className="flex-1 font-medium">{LISTA_CLIENTES_AVISO_MENSAJES[aviso]}</AlertDescription>
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
      <FixedActionBar>{nuevoCliente}</FixedActionBar>
    </div>
  );
}
