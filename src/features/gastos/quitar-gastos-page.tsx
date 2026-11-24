import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useParams, type LinkProps } from 'react-router';
import { Info, Receipt } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/shared/empty-state';
import { FixedActionBar } from '@/components/shared/fixed-action-bar';
import { InlineError } from '@/components/shared/inline-error';
import { ListSkeleton } from '@/components/shared/list-skeleton';
import { PageHeader } from '@/components/shared/page-header';
import { Spinner } from '@/components/shared/spinner';
import { VolverLink } from '@/components/shared/volver-link';
import { AYUDA_QUITAR_GASTOS } from '@/features/ayuda/ayuda-pantallas';
import { estadoDesdeCliente, leerDesdeCliente } from '@/features/clientes/cliente-navegacion';
import { useTenantId } from '@/features/member/use-tenant-id';
import { useViajeVista } from '@/features/viajes/use-viajes';
import { rutaDelViaje } from '@/features/viajes/viaje-navegacion';
import { ViajeNoEncontrado } from '@/features/viajes/viaje-no-encontrado';
import type { ViajeVista } from '@/features/viajes/viajes-api';
import { sanitizeVolver } from '@/features/viajes/viajes-filters';
import { mapDataError } from '@/lib/data-errors';
import { formatDateWithYear } from '@/lib/dates';
import { formatMoney } from '@/lib/numbers';
import { useSubmitFeedback } from '@/lib/use-submit-feedback';
import { useScrollToTopOnMount } from '@/lib/use-scroll-to-top';
import { cn } from '@/lib/utils';
import { isUuid } from '@/lib/uuid';
import { MAX_GASTOS_POR_VEZ } from './constants';
import { GastosParaElegir } from './gastos-para-elegir';
import { ResultadoDeQuitar } from './resultado-de-quitar';
import { armarResultadoDeQuitar, type ResultadoParaMostrarDeQuitar } from './quitar-gastos-resultado';
import {
  AVISO_HAY_MAS_GASTOS,
  AVISO_MAXIMO_MARCADO,
  AVISO_TOPE_POR_VEZ,
  AYUDA_DE_LA_LISTA_QUITAR,
  MARCA_ALGUNO_QUITAR,
  QUITANDO,
  QUITAR_GASTOS_CONTEXT,
  TITULO_LISTA_DEL_VIAJE,
  TITULO_QUITAR_GASTOS,
  TITULO_SIN_GASTOS_EN_EL_VIAJE,
  textoBotonQuitar,
  textoMarcarPrimeros,
} from './quitar-gastos-textos';
import { idsDe, totalDeMarcados } from './sumar-gastos-seleccion';
import {
  ERROR_CATEGORIAS,
  MARCAR_TODOS_DESMARCADO,
  UN_MOMENTO,
  VOLVER_AL_VIAJE,
  textoMarcarTodos,
  textoTotalMarcado,
} from './sumar-gastos-textos';
import { useQuitarGastosDelViaje } from './use-gasto-mutations';
import { useCategorias, useGastosDelViaje } from './use-gastos';
import { useSeleccionConTope } from './use-seleccion-con-tope';
import { useVinculosEnCurso } from './use-vinculos-en-curso';

/** A dónde vuelve la pantalla: al detalle del viaje, con el mes de la lista y el cliente (si lo había) como únicos datos del state. */
interface AlViaje {
  to: LinkProps['to'];
  state: LinkProps['state'];
}

/**
 * «Quitar gastos del viaje» (`/viajes/:id/quitar-gastos`): los gastos de este viaje, para sacar varios de una vez. Se llega solo desde
 * el detalle del viaje, y solo si el viaje tiene gastos. Es el inverso de «Sumar gastos que ya cargué» y se arma igual.
 *
 * Qué muestra: los gastos de ESTE viaje (los más nuevos primero; hasta `LIST_LIMIT`, con un aviso si hay más). NINGUNO viene marcado.
 * Abajo, el botón «Quitar N gastos del viaje» con lo que suman los marcados. Los gastos NO se borran: quedan sin viaje y se pueden
 * volver a sumar. Quitar es idempotente: un gasto que ya no está en el viaje no se toca y no es un error.
 *
 * El tope: la capa de datos acepta hasta `MAX_GASTOS_POR_VEZ` (100) por pedido y la lista puede traer más. Nunca se pueden marcar más
 * de 100 a la vez (`useSeleccionConTope`): «Marcar todos» marca los primeros 100 y lo dice en su rótulo; al llegar a 100 las casillas
 * sin marcar se apagan (con un aviso) y las marcadas se pueden desmarcar. Al quitar esos, el resto sigue en la lista (se vuelve a pedir)
 * para otra tanda.
 *
 * Después de quitar la pantalla NO vuelve sola: dice qué se quitó y qué ya no estaba, aclara que no se borró nada y ofrece «Volver al
 * viaje». Lo quitado desaparece de la lista porque se vuelve a pedir.
 *
 * Reglas que esta pantalla no se salta (las de la auditoría de seguridad de la capa de datos y de «Sumar»):
 *  1. Se manda SIEMPRE «lo marcado que sigue en la lista de ahora» (`useSeleccionConTope`), nunca un conjunto guardado. La selección
 *     se vacía después de cada «Quitar» que termina; si falla se conserva (para que «Reintentar» tenga qué mandar) y «Reintentar»
 *     vuelve a calcular desde lo que está marcado AHORA. Se recorta mirando CUÁLES gastos hay, no cuántos.
 *  2. «Quitar» no se puede tocar mientras haya un «Sumar» o un «Quitar» en curso o en cola, de esta pantalla o de un montaje anterior
 *     (`useVinculosEnCurso`: cuenta todo el scope compartido). El botón dice «Quitando…» solo si lo que corre es ESTE pedido; si es
 *     otra operación, un texto neutro («Un momento…»).
 *  3. El estado de la pantalla NO depende de callbacks pasados a `mutate(…)` (no corren si la pantalla se desmonta): se usa
 *     `mutateAsync` dentro de `useSubmitFeedback`, que tiene su propio estado.
 *  4. Las fechas, solo con `formatDateWithYear` (la base acepta `infinity` y `Intl` rompería el dibujo).
 *  5. Nunca se muestra el texto que manda el servidor: todo pasa por `mapDataError`. Con la clase `payment` (cuenta en solo lectura)
 *     no hay «Reintentar».
 *  6. Si el refresco de la lista falla, la lista sigue a la vista (con el aviso y «Reintentar»).
 *
 * Qué NO hace: navegar a algo que venga del estado o de la URL. El viaje de la URL se valida con `isUuid`; el `volver` se sanea con
 * `sanitizeVolver`; el cliente, con `leerDesdeCliente`; y la ruta de vuelta se arma acá con un uuid ya validado. Tampoco manda nunca
 * `transportista_id` ni arma consultas: eso es de la capa de datos y de la base.
 */
export function QuitarGastosPage() {
  useScrollToTopOnMount();
  const params = useParams();
  const location = useLocation();
  const volver = sanitizeVolver((location.state as { volver?: unknown } | null)?.volver);
  const desdeCliente = leerDesdeCliente(location.state);
  // Un id que no es uuid no se consulta: no existe.
  const id = isUuid(params.id) ? params.id.toLowerCase() : null;

  const viajeQuery = useViajeVista(id);
  const viaje = viajeQuery.data ?? null;

  const alViaje: AlViaje | null = id === null ? null : { to: rutaDelViaje(id), state: { volver, ...estadoDesdeCliente(desdeCliente) } };

  let contenido: ReactNode;
  if (id === null || alViaje === null) {
    contenido = <ViajeNoEncontrado volver={volver} />;
  } else if (viajeQuery.isError && viajeQuery.data === undefined) {
    // Solo si NO hay datos: un refresco fallido con el viaje ya a la vista no lo reemplaza por el error.
    contenido = (
      <InlineError message={mapDataError(viajeQuery.error)} onRetry={() => void viajeQuery.refetch()} retrying={viajeQuery.isFetching} />
    );
  } else if (viajeQuery.isPending) {
    contenido = <ListSkeleton rows={4} />;
  } else if (viaje === null) {
    contenido = <ViajeNoEncontrado volver={volver} />;
  } else {
    // El viaje en la `key`: si la URL cambia de viaje con la pantalla abierta, la selección y los avisos arrancan de cero.
    contenido = <QuitarGastosDelViaje key={viaje.id} viaje={viaje} alViaje={alViaje} />;
  }

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <VolverLink
          to={alViaje?.to ?? `/viajes${volver}`}
          state={alViaje?.state}
          destino={alViaje ? 'al viaje' : 'a Viajes'}
        />
        <PageHeader title={TITULO_QUITAR_GASTOS} ayuda={AYUDA_QUITAR_GASTOS} />
        {viaje ? (
          <p className="text-muted-foreground [overflow-wrap:anywhere]">
            {viaje.origen} <span aria-hidden="true">→</span>
            <span className="sr-only"> a </span> {viaje.destino} <span aria-hidden="true">·</span> {formatDateWithYear(viaje.fecha)}
          </p>
        ) : null}
      </div>
      {contenido}
    </div>
  );
}

interface QuitarGastosDelViajeProps {
  viaje: ViajeVista;
  alViaje: AlViaje;
}

/**
 * Todo lo que depende de que el viaje ya se conozca. Devuelve un fragmento (no un contenedor propio) para que sus piezas queden
 * como hijos directos de la pantalla, con la barra fija de abajo como ÚLTIMO hijo (`FixedActionBar`).
 */
function QuitarGastosDelViaje({ viaje, alViaje }: QuitarGastosDelViajeProps) {
  const tenantId = useTenantId();
  const gastosQuery = useGastosDelViaje(viaje.id);
  const categoriasQuery = useCategorias();
  const quitar = useQuitarGastosDelViaje();
  const vinculosEnCurso = useVinculosEnCurso();
  const { run, pending, error, retryable } = useSubmitFeedback({ context: QUITAR_GASTOS_CONTEXT });
  const [resultado, setResultado] = useState<ResultadoParaMostrarDeQuitar | null>(null);

  const categorias = categoriasQuery.data;
  const categoriasPorId = useMemo(() => new Map((categorias ?? []).map((categoria) => [categoria.id, categoria])), [categorias]);

  const items = gastosQuery.data?.items ?? [];
  const truncado = gastosQuery.data?.truncado ?? false;
  const seleccion = useSeleccionConTope(idsDe(items), MAX_GASTOS_POR_VEZ);
  const cantidad = seleccion.idsParaEnviar.length;
  const total = totalDeMarcados(items, seleccion.marcados);
  const hayMasQueElTope = items.length > MAX_GASTOS_POR_VEZ;

  // Hay un «Sumar» o un «Quitar» en curso o en cola (de esta pantalla o de una anterior): nada se puede tocar hasta que termine.
  // `pending` cubre el instante entre el toque y el primer dibujo (y es lo que dice que el pedido en curso es ESTE);
  // `vinculosEnCurso`, todo lo que está en la caché de mutaciones, venga de donde venga.
  const ocupado = pending || vinculosEnCurso;
  const textoOcupado = pending ? QUITANDO : UN_MOMENTO;

  /**
   * Quita lo marcado AHORA. «Reintentar» llama a esta misma función: vuelve a leer la selección de este momento (selección ∩ lista de
   * ahora), no reenvía lo que se mandó antes. Si no queda nada marcado, no manda nada.
   */
  async function quitarMarcados() {
    const gastoIds = seleccion.idsParaEnviar;
    if (ocupado || gastoIds.length === 0) return;
    setResultado(null);
    const intento = await run(() => quitar.mutateAsync({ tenantId, viajeId: viaje.id, gastoIds }), { keepLocked: false });
    if (!intento.ok) return; // el aviso del error lo muestra `useSubmitFeedback`; la selección se conserva
    seleccion.vaciar();
    setResultado(armarResultadoDeQuitar(gastoIds, intento.data));
  }

  // Al terminar un «Quitar» (bien o mal) el aviso es lo que hay que ver: se lleva la vista y el foco ahí. Sin esto, con la lista
  // larga y el botón fijo abajo, quien toca «Quitar» no vería nada cambiar, y el foco se perdería con el botón apagado.
  const avisoRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (resultado === null && error === null) return;
    const aviso = avisoRef.current;
    if (aviso === null) return;
    aviso.focus({ preventScroll: true });
    aviso.scrollIntoView({ block: 'center' });
  }, [resultado, error]);

  // «Reintentar» solo si tiene sentido (la clase del error lo permite) y hay algo marcado AHORA que mandar.
  const puedeReintentar = retryable && cantidad > 0;

  // Si falla (red, servidor) se avisa con «Reintentar»; si ya había una lista cargada (p. ej. falla al refrescar al volver sin
  // señal) se la sigue mostrando debajo del aviso, en vez de taparla.
  const errorLista = gastosQuery.isError ? (
    <InlineError message={mapDataError(gastosQuery.error)} onRetry={() => void gastosQuery.refetch()} retrying={gastosQuery.isFetching} />
  ) : null;

  // Las categorías no cargaron (y no hay una copia anterior): la lista igual se muestra, con nombres genéricos y un aviso.
  const errorCategorias =
    categoriasQuery.isError && categorias === undefined ? (
      <InlineError
        message={`${ERROR_CATEGORIAS} ${mapDataError(categoriasQuery.error)}`}
        onRetry={() => void categoriasQuery.refetch()}
        retrying={categoriasQuery.isFetching}
      />
    ) : null;

  let lista: ReactNode;
  if (gastosQuery.data === undefined) {
    lista = errorLista ?? <ListSkeleton rows={5} />;
  } else if (items.length === 0) {
    lista = (
      <>
        {errorLista}
        <EmptyState
          icon={Receipt}
          title={TITULO_SIN_GASTOS_EN_EL_VIAJE}
          action={
            <Button asChild size="lg">
              <Link to={alViaje.to} state={alViaje.state}>
                {VOLVER_AL_VIAJE}
              </Link>
            </Button>
          }
        />
      </>
    );
  } else {
    lista = (
      <>
        {errorLista}
        {hayMasQueElTope ? (
          <Alert>
            <Info aria-hidden="true" />
            <AlertDescription>{AVISO_TOPE_POR_VEZ}</AlertDescription>
          </Alert>
        ) : null}
        {truncado ? (
          <Alert>
            <Info aria-hidden="true" />
            <AlertDescription>{AVISO_HAY_MAS_GASTOS}</AlertDescription>
          </Alert>
        ) : null}
        {errorCategorias}

        <section aria-labelledby="quitar-gastos-lista-titulo" className="space-y-3">
          <h2 id="quitar-gastos-lista-titulo" className="text-lg font-semibold">
            {TITULO_LISTA_DEL_VIAJE}
          </h2>
          <p className="text-muted-foreground">{AYUDA_DE_LA_LISTA_QUITAR}</p>
          <Button
            type="button"
            variant="outline"
            className="w-full sm:w-auto"
            disabled={ocupado}
            onClick={() => (seleccion.todosMarcados ? seleccion.desmarcarTodos() : seleccion.marcarTodos())}
          >
            {seleccion.todosMarcados
              ? MARCAR_TODOS_DESMARCADO
              : hayMasQueElTope
                ? textoMarcarPrimeros(MAX_GASTOS_POR_VEZ)
                : textoMarcarTodos(items.length)}
          </Button>
          <GastosParaElegir
            gastos={items}
            categoriasPorId={categoriasPorId}
            marcados={seleccion.marcados}
            onAlternar={seleccion.alternar}
            deshabilitado={ocupado}
            sinCupo={seleccion.sinCupo}
            etiqueta={TITULO_LISTA_DEL_VIAJE}
          />
        </section>
      </>
    );
  }

  // El botón principal con lo que suma lo marcado. Se dibuja dos veces según el ancho (desktop en el flujo, celular fijo abajo),
  // como el botón principal de Gastos y Viajes: en cada ancho se ve UNA sola. Se apaga sin nada marcado o con algo en curso.
  const accion = (
    <div className="space-y-2 rounded-lg border border-border bg-card p-3">
      <p className="text-base font-medium tabular-nums [overflow-wrap:anywhere]">
        {cantidad > 0 ? textoTotalMarcado(formatMoney(total)) : MARCA_ALGUNO_QUITAR}
      </p>
      {seleccion.sinCupo ? (
        <p role="status" className="text-base text-muted-foreground">
          {AVISO_MAXIMO_MARCADO}
        </p>
      ) : null}
      <Button
        type="button"
        size="lg"
        className="h-auto min-h-14 w-full whitespace-normal py-2 text-center"
        disabled={ocupado || cantidad === 0}
        aria-busy={ocupado}
        onClick={() => void quitarMarcados()}
      >
        {ocupado ? (
          <>
            <Spinner /> {textoOcupado}
          </>
        ) : (
          textoBotonQuitar(cantidad)
        )}
      </Button>
      <span role="status" aria-live="polite" className="sr-only">
        {ocupado ? textoOcupado : ''}
      </span>
    </div>
  );

  return (
    <>
      {resultado !== null || error !== null ? (
        <div ref={avisoRef} tabIndex={-1} className="focus-visible:outline-none">
          {resultado !== null ? <ResultadoDeQuitar resultado={resultado} alViaje={alViaje} /> : null}
          {error !== null ? (
            <InlineError message={error} onRetry={puedeReintentar ? () => void quitarMarcados() : undefined} retrying={ocupado} />
          ) : null}
        </div>
      ) : null}

      {lista}

      {/* Solo con algo que quitar: con el viaje sin gastos no hay botón (en lugar de uno apagado para siempre). */}
      {items.length > 0 ? (
        <>
          <div className="max-md:hidden md:sticky md:bottom-4 md:z-30 [&>*]:shadow-lg">{accion}</div>
          {/* La barra fija del celular es más alta que la de un solo botón (lleva también la línea del total, y con el máximo marcado
              otra más con el aviso): este aire extra evita que tape la última fila al llegar al final de la lista. */}
          <div aria-hidden="true" className={cn('md:hidden', seleccion.sinCupo ? 'h-36' : 'h-16')} />
          <FixedActionBar>{accion}</FixedActionBar>
        </>
      ) : null}
    </>
  );
}
