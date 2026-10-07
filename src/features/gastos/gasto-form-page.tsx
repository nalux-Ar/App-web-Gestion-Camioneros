import { Link, useLocation, useParams, useSearchParams } from 'react-router';
import { ChevronLeft } from 'lucide-react';

import { InlineError } from '@/components/shared/inline-error';
import { ListSkeleton } from '@/components/shared/list-skeleton';
import { useCamiones } from '@/features/camiones/use-camiones';
import { estadoDesdeCliente } from '@/features/clientes/cliente-navegacion';
import { useViajeOpcion, useViajesRecientes } from '@/features/viajes/use-viajes';
import { leerDesdeViaje, rutaDelViaje } from '@/features/viajes/viaje-navegacion';
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
 * Carga lo que el formulario necesita (categorías y, al editar, el gasto; y, en el alta con `?viaje=`, el
 * viaje preseleccionado) antes de mostrarlo, así el formulario se inicializa UNA vez con datos
 * completos y nunca se pisa lo que el usuario tipea.
 *
 * `?viaje=<uuid>`: el gasto nuevo llega con ese viaje elegido. Un valor que no es uuid se ignora; si lo es, se
 * pide el viaje por id (consulta chica) y, si no existe (o es de otro transportista: la base no distingue), se
 * ignora y el formulario queda sin viaje.
 *
 * Volver: de la lista de Gastos con sus filtros (`state.volver`, saneado) o, si se llegó desde el detalle de un
 * viaje (`state.desdeViaje`, un uuid validado), a ESE viaje. Nunca se navega a algo que venga del estado o de la URL.
 */
export function GastoFormPage({ modo }: GastoFormPageProps) {
  useScrollToTopOnMount();
  const params = useParams();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const volver = sanitizeVolver((location.state as { volver?: unknown } | null)?.volver);
  const desdeViaje = leerDesdeViaje(location.state);

  // Un id que no es uuid no se consulta: es "no encontrado" sin pedir nada.
  const id = modo === 'editar' && isUuid(params.id) ? params.id : null;
  const idInvalido = modo === 'editar' && id === null;

  // El viaje preseleccionado: solo en el alta y solo con un uuid válido (cualquier otra cosa se ignora).
  const viajeParam = searchParams.get('viaje');
  const viajeId = modo === 'nuevo' && isUuid(viajeParam) ? viajeParam.toLowerCase() : null;

  const categorias = useCategorias();
  const gasto = useGasto(id);
  const viajePreseleccionado = useViajeOpcion(viajeId);
  // Los viajes recientes los usa el formulario (comparte esta misma consulta): pedirlos acá los trae EN PARALELO con las
  // categorías y el gasto en vez de después, que con mala señal ahorra una espera entera. No bloquea la pantalla ni se espera:
  // si falla, el error con "Reintentar" va junto al campo y el gasto se puede guardar igual.
  useViajesRecientes({ enabled: !idInvalido });
  // Lo mismo con los camiones (el bloque Combustible los necesita para el camión de la carga); `fresca`: igual que en el formulario.
  useCamiones({ enabled: !idInvalido, fresca: true });

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
  } else if (viajeId !== null && viajePreseleccionado.isError && viajePreseleccionado.data === undefined) {
    // El gasto iba a quedar vinculado a ESE viaje: si no se pudo averiguar si existe, no se abre el formulario sin él
    // (se guardaría un gasto suelto sin avisar). Con "Reintentar".
    contenido = (
      <InlineError
        message={mapDataError(viajePreseleccionado.error)}
        onRetry={() => void viajePreseleccionado.refetch()}
        retrying={viajePreseleccionado.isFetching}
      />
    );
  } else if (categorias.isPending || (modo === 'editar' && gasto.isPending) || (viajeId !== null && viajePreseleccionado.isPending)) {
    contenido = <ListSkeleton rows={5} />;
  } else if (modo === 'editar' && gasto.data === null) {
    contenido = <GastoNoEncontrado volver={volver} />;
  } else if (modo === 'editar' && gasto.data) {
    contenido = (
      <GastoFormulario
        key={gasto.data.id}
        categorias={categorias.data}
        gasto={gasto.data}
        volver={volver}
        desdeViaje={desdeViaje}
      />
    );
  } else {
    contenido = (
      <GastoFormulario
        key={viajePreseleccionado.data?.id ?? 'nuevo'}
        categorias={categorias.data}
        volver={volver}
        desdeViaje={desdeViaje}
        viajePreseleccionado={viajeId !== null ? (viajePreseleccionado.data ?? null) : null}
      />
    );
  }

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <Link
          to={desdeViaje ? rutaDelViaje(desdeViaje.id) : `/gastos${volver}`}
          state={desdeViaje ? { volver: desdeViaje.volver, ...estadoDesdeCliente(desdeViaje.cliente) } : undefined}
          className="-ml-2 inline-flex min-h-12 items-center gap-1 rounded-md px-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <ChevronLeft className="size-5" aria-hidden="true" /> {desdeViaje ? 'Viaje' : 'Gastos'}
        </Link>
        <h1 className="text-2xl font-semibold">{titulo}</h1>
      </div>
      {contenido}
    </div>
  );
}
