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
import { AYUDA_SUMAR_GASTOS } from '@/features/ayuda/ayuda-pantallas';
import { buscarCamion, type CamionDeLista } from '@/features/camiones/camion';
import { formatearPatente } from '@/features/camiones/patente';
import { useCamiones } from '@/features/camiones/use-camiones';
import { estadoDesdeCliente, leerDesdeCliente } from '@/features/clientes/cliente-navegacion';
import { useTenantId } from '@/features/member/use-tenant-id';
import { useViajeVista } from '@/features/viajes/use-viajes';
import { rutaDelViaje } from '@/features/viajes/viaje-navegacion';
import { ViajeNoEncontrado } from '@/features/viajes/viaje-no-encontrado';
import type { ViajeVista } from '@/features/viajes/viajes-api';
import { sanitizeVolver } from '@/features/viajes/viajes-filters';
import { mapDataError } from '@/lib/data-errors';
import { formatDateWithYear, isValidDateString, todayLocal } from '@/lib/dates';
import { formatNumber } from '@/lib/numbers';
import { useSubmitFeedback } from '@/lib/use-submit-feedback';
import { useScrollToTopOnMount } from '@/lib/use-scroll-to-top';
import { isUuid } from '@/lib/uuid';
import { GastosParaElegir, GastosQueNoSeEligen } from './gastos-para-elegir';
import { ResultadoDeSumar } from './resultado-de-sumar';
import { armarResultado, type ResultadoParaMostrar } from './sumar-gastos-resultado';
import { idsDe, partirPorCamion, totalDeMarcados } from './sumar-gastos-seleccion';
import {
  AVISO_HAY_MAS,
  AYUDA_DE_LA_LISTA,
  DETALLE_SIN_GASTOS_SUELTOS,
  ERROR_CATEGORIAS,
  MARCA_ALGUNO,
  MARCAR_TODOS_DESMARCADO,
  NADA_PARA_SUMAR,
  SUMANDO,
  UN_MOMENTO,
  SUMAR_GASTOS_CONTEXT,
  TITULO_LISTA_SUELTOS,
  TITULO_NO_SE_PUEDEN_SUMAR,
  TITULO_SIN_GASTOS_SUELTOS,
  TITULO_SUMAR_GASTOS,
  VOLVER_AL_VIAJE,
  textoBotonSumar,
  textoMarcarTodos,
  textoOtroCamion,
  textoTotalMarcado,
} from './sumar-gastos-textos';
import { useVincularGastos } from './use-gasto-mutations';
import { useCategorias, useGastosSueltos } from './use-gastos';
import { useSeleccionDeGastos } from './use-seleccion-de-gastos';
import { useVinculosEnCurso } from './use-vinculos-en-curso';

/** A dónde vuelve la pantalla: al detalle del viaje, con el mes de la lista y el cliente (si lo había) como únicos datos del state. */
interface AlViaje {
  to: LinkProps['to'];
  state: LinkProps['state'];
}

/**
 * «Sumar gastos que ya cargué» (`/viajes/:id/sumar-gastos`): los gastos que se anotaron SIN viaje, para sumar varios de una vez a
 * este. Se llega solo desde el detalle del viaje.
 *
 * Qué muestra: los gastos sin viaje (sin ventana de días: cada viaje es distinto), los más cercanos a la fecha del viaje primero
 * y, si hay más de los que entran (`MAX_GASTOS_POR_VEZ`), un aviso. NINGUNO viene marcado. Los de otro camión no se pueden sumar
 * (la base los rechazaría): van aparte, sin casilla y con el motivo. Abajo, el botón «Sumar N gastos al viaje» con lo que suman.
 *
 * Después de sumar la pantalla NO vuelve sola: dice qué se sumó, qué ya estaba y qué no se pudo (y por qué), y ofrece «Volver al
 * viaje». Lo sumado desaparece de la lista porque se vuelve a pedir.
 *
 * Reglas que esta pantalla no se salta (de la auditoría de seguridad de la capa de datos):
 *  1. Se manda SIEMPRE «lo marcado que sigue en la lista de ahora» (`useSeleccionDeGastos`), nunca un conjunto guardado. La selección
 *     se vacía después de cada «Sumar» que sale bien; si falla se conserva (para que «Reintentar» tenga qué mandar) y «Reintentar»
 *     vuelve a calcular desde lo que está marcado AHORA.
 *  2. «Sumar» no se puede tocar mientras haya un «Sumar» o un «Quitar» en curso o en cola, de esta pantalla o de un montaje
 *     anterior (`useVinculosEnCurso`: cuenta todo el scope compartido).
 *  3. El estado de la pantalla NO depende de callbacks pasados a `mutate(…)` (no corren si la pantalla se desmonta): se usa
 *     `mutateAsync` dentro de `useSubmitFeedback`, que tiene su propio estado.
 *  4. Las fechas, solo con `formatDateWithYear` (la base acepta `infinity` y `Intl` rompería el dibujo).
 *  5. `no_encontrado` tiene UN solo texto («Ya no está disponible.»): «se borró» y «es de otra cuenta» no se distinguen jamás.
 *  6. Nunca se muestra el texto que manda el servidor: todo pasa por `mapDataError`. Con la clase `payment` (cuenta en solo
 *     lectura) no hay «Reintentar».
 *  7. Si el refresco de la lista falla, la lista sigue a la vista (con el aviso y «Reintentar»).
 *
 * Qué NO hace: navegar a algo que venga del estado o de la URL. El viaje de la URL se valida con `isUuid`; el `volver` se sanea
 * con `sanitizeVolver`; el cliente, con `leerDesdeCliente`; y la ruta de vuelta se arma acá con un uuid ya validado.
 */
export function SumarGastosPage() {
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
    contenido = <SumarGastosDelViaje key={viaje.id} viaje={viaje} alViaje={alViaje} />;
  }

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <VolverLink
          to={alViaje?.to ?? `/viajes${volver}`}
          state={alViaje?.state}
          destino={alViaje ? 'al viaje' : 'a Viajes'}
        />
        <PageHeader title={TITULO_SUMAR_GASTOS} ayuda={AYUDA_SUMAR_GASTOS} />
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

/** La patente con espacios («AB 123 CD») del camión de un gasto, o null si no se conoce (la lista de camiones no llegó o no lo tiene). */
function patenteDelCamion(camiones: readonly CamionDeLista[] | undefined, camionId: string | null | undefined): string | null {
  const camion = camiones ? buscarCamion(camiones, camionId) : null;
  return camion && camion.patente !== '' ? formatearPatente(camion.patente) : null;
}

interface SumarGastosDelViajeProps {
  viaje: ViajeVista;
  alViaje: AlViaje;
}

/**
 * Todo lo que depende de que el viaje ya se conozca. Devuelve un fragmento (no un contenedor propio) para que sus piezas queden
 * como hijos directos de la pantalla, con la barra fija de abajo como ÚLTIMO hijo (`FixedActionBar`).
 */
function SumarGastosDelViaje({ viaje, alViaje }: SumarGastosDelViajeProps) {
  const tenantId = useTenantId();
  // Los candidatos se ordenan por cercanía a la fecha del viaje. Una fecha que no existe en el calendario (la base acepta
  // `infinity`) no se puede ordenar: se usa hoy, para que la pantalla igual sirva en vez de quedar en un error sin salida.
  const fechaDeReferencia = isValidDateString(viaje.fecha) ? viaje.fecha : todayLocal();
  const sueltosQuery = useGastosSueltos(viaje.id, fechaDeReferencia);
  const categoriasQuery = useCategorias();
  // La patente del camión sale de la lista de camiones (en caché, sin embed). Si no cargó, el motivo no la lleva.
  const camiones = useCamiones().data?.items;
  const vincular = useVincularGastos();
  const vinculosEnCurso = useVinculosEnCurso();
  const { run, pending, error, retryable } = useSubmitFeedback({ context: SUMAR_GASTOS_CONTEXT });
  const [resultado, setResultado] = useState<ResultadoParaMostrar | null>(null);

  const categorias = categoriasQuery.data;
  const categoriasPorId = useMemo(() => new Map((categorias ?? []).map((categoria) => [categoria.id, categoria])), [categorias]);

  const items = sueltosQuery.data?.items ?? [];
  const hayMas = sueltosQuery.data?.hayMas ?? false;
  const { sumables, deOtroCamion } = partirPorCamion(items, viaje);
  const seleccion = useSeleccionDeGastos(idsDe(sumables));
  const cantidad = seleccion.idsParaEnviar.length;
  const total = totalDeMarcados(sumables, seleccion.marcados);

  // Hay un «Sumar» o un «Quitar» en curso o en cola (de esta pantalla o de una anterior): nada se puede tocar hasta que termine.
  // `pending` cubre el instante entre el toque y el primer dibujo; `vinculosEnCurso`, todo lo que está en la caché de mutaciones.
  const ocupado = pending || vinculosEnCurso;
  // «Sumando…» solo si el pedido es de ESTA pantalla; si lo que corre es otra operación (un «Quitar», por ejemplo), un texto neutro.
  const textoOcupado = pending ? SUMANDO : UN_MOMENTO;

  /**
   * Suma lo marcado AHORA. «Reintentar» llama a esta misma función: vuelve a leer la selección de este momento (selección ∩ lista
   * de ahora), no reenvía lo que se mandó antes. Si no queda nada marcado, no manda nada.
   */
  async function sumar() {
    const gastoIds = seleccion.idsParaEnviar;
    if (ocupado || gastoIds.length === 0) return;
    setResultado(null);
    // Las filas que se mandan, tal como están ahora: de ahí salen la categoría y la fecha de los que no se puedan sumar.
    const mandados = new Set(gastoIds);
    const enviados = sumables.filter((gasto) => mandados.has(gasto.id));
    const intento = await run(() => vincular.mutateAsync({ tenantId, viajeId: viaje.id, gastoIds }), { keepLocked: false });
    if (!intento.ok) return; // el aviso del error lo muestra `useSubmitFeedback`; la selección se conserva
    seleccion.vaciar();
    setResultado(armarResultado(intento.data, enviados, categoriasPorId));
  }

  // Al terminar un «Sumar» (bien o mal) el aviso es lo que hay que ver: se lleva la vista y el foco ahí. Sin esto, con la lista
  // larga y el botón fijo abajo, quien toca «Sumar» no vería nada cambiar, y el foco se perdería con el botón apagado.
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
  const errorLista = sueltosQuery.isError ? (
    <InlineError message={mapDataError(sueltosQuery.error)} onRetry={() => void sueltosQuery.refetch()} retrying={sueltosQuery.isFetching} />
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
  if (sueltosQuery.data === undefined) {
    lista = errorLista ?? <ListSkeleton rows={5} />;
  } else if (items.length === 0) {
    lista = (
      <>
        {errorLista}
        <EmptyState
          icon={Receipt}
          title={TITULO_SIN_GASTOS_SUELTOS}
          description={DETALLE_SIN_GASTOS_SUELTOS}
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
        {hayMas ? (
          <Alert>
            <Info aria-hidden="true" />
            <AlertDescription>{AVISO_HAY_MAS}</AlertDescription>
          </Alert>
        ) : null}
        {errorCategorias}

        {sumables.length > 0 ? (
          <section aria-labelledby="sumar-gastos-lista-titulo" className="space-y-3">
            <h2 id="sumar-gastos-lista-titulo" className="text-lg font-semibold">
              {TITULO_LISTA_SUELTOS}
            </h2>
            <p className="text-muted-foreground">{AYUDA_DE_LA_LISTA}</p>
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto"
              disabled={ocupado}
              onClick={() => (seleccion.todosMarcados ? seleccion.desmarcarTodos() : seleccion.marcarTodos())}
            >
              {seleccion.todosMarcados ? MARCAR_TODOS_DESMARCADO : textoMarcarTodos(sumables.length)}
            </Button>
            <GastosParaElegir
              gastos={sumables}
              categoriasPorId={categoriasPorId}
              marcados={seleccion.marcados}
              onAlternar={seleccion.alternar}
              deshabilitado={ocupado}
              etiqueta={TITULO_LISTA_SUELTOS}
            />
          </section>
        ) : (
          <p className="text-muted-foreground">{NADA_PARA_SUMAR}</p>
        )}

        {deOtroCamion.length > 0 ? (
          <section aria-labelledby="sumar-gastos-no-titulo" className="space-y-3">
            <h2 id="sumar-gastos-no-titulo" className="text-lg font-semibold">
              {TITULO_NO_SE_PUEDEN_SUMAR}
            </h2>
            <GastosQueNoSeEligen
              gastos={deOtroCamion}
              categoriasPorId={categoriasPorId}
              motivoDe={(gasto) => textoOtroCamion(patenteDelCamion(camiones, gasto.camion_id))}
            />
          </section>
        ) : null}
      </>
    );
  }

  // El botón principal con lo que suma lo marcado. Se dibuja dos veces según el ancho (desktop en el flujo, celular fijo abajo),
  // como el botón principal de Gastos y Viajes: en cada ancho se ve UNA sola. Se apaga sin nada marcado o con algo en curso.
  const accion = (
    <div className="space-y-2 rounded-lg border border-border bg-card p-3">
      <p className="text-base font-medium tabular-nums [overflow-wrap:anywhere]">
        {cantidad > 0 ? textoTotalMarcado(formatNumber(total, { decimales: 2 })) : MARCA_ALGUNO}
      </p>
      <Button
        type="button"
        size="lg"
        className="h-auto min-h-14 w-full whitespace-normal py-2 text-center"
        disabled={ocupado || cantidad === 0}
        aria-busy={ocupado}
        onClick={() => void sumar()}
      >
        {ocupado ? (
          <>
            <Spinner /> {textoOcupado}
          </>
        ) : (
          textoBotonSumar(cantidad)
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
          {resultado !== null ? <ResultadoDeSumar resultado={resultado} alViaje={alViaje} /> : null}
          {error !== null ? (
            <InlineError message={error} onRetry={puedeReintentar ? () => void sumar() : undefined} retrying={ocupado} />
          ) : null}
        </div>
      ) : null}

      {lista}

      {/* Solo con algo que sumar: con la lista vacía, o con todo de otro camión, no hay botón (en lugar de uno apagado para siempre). */}
      {sumables.length > 0 ? (
        <>
          <div className="max-md:hidden md:sticky md:bottom-4 md:z-30 [&>*]:shadow-lg">{accion}</div>
          {/* La barra fija del celular es más alta que la de un solo botón (lleva también la línea del total): este aire extra
              evita que tape la última fila al llegar al final de la lista. */}
          <div aria-hidden="true" className="h-16 md:hidden" />
          <FixedActionBar>{accion}</FixedActionBar>
        </>
      ) : null}
    </>
  );
}
