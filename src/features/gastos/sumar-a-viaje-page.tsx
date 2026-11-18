import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ChevronLeft, Info, Receipt } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/shared/empty-state';
import { FixedActionBar } from '@/components/shared/fixed-action-bar';
import { InlineError } from '@/components/shared/inline-error';
import { ListSkeleton } from '@/components/shared/list-skeleton';
import { MonthPicker } from '@/components/shared/month-picker';
import { PageHeader } from '@/components/shared/page-header';
import { SelectField } from '@/components/shared/select-field';
import { Spinner } from '@/components/shared/spinner';
import { VolverLink } from '@/components/shared/volver-link';
import { AYUDA_SUMAR_A_VIAJE } from '@/features/ayuda/ayuda-pantallas';
import { useCamiones } from '@/features/camiones/use-camiones';
import { useTenantId } from '@/features/member/use-tenant-id';
import { rutaDelViaje } from '@/features/viajes/viaje-navegacion';
import type { ViajeDeLista } from '@/features/viajes/viajes-list';
import { searchDelMesDeFecha } from '@/features/viajes/viajes-filters';
import { mapDataError } from '@/lib/data-errors';
import { formatMonthLabel } from '@/lib/dates';
import { formatNumber } from '@/lib/numbers';
import { useSubmitFeedback } from '@/lib/use-submit-feedback';
import { useScrollToTopOnMount } from '@/lib/use-scroll-to-top';
import { cn } from '@/lib/utils';
import { categoriasParaElegir, nombreParaMostrar, type Categoria } from './categorias';
import { MAX_GASTOS_POR_VEZ } from './constants';
import { ElegirElViaje } from './elegir-el-viaje';
import { GastosParaElegir } from './gastos-para-elegir';
import { filtroToParams, filtroToSearch, formatMesParam, readFiltro, type GastosFiltro } from './gastos-filters';
import { AVISO_MAXIMO_MARCADO, textoMarcarPrimeros } from './quitar-gastos-textos';
import { ResultadoDeSumar } from './resultado-de-sumar';
import { gastosMarcados, gastosSinViaje, repartirPorCamionDelViaje } from './sumar-a-viaje';
import {
  AVISO_DESMARCADO_POR_CATEGORIA,
  AVISO_DESMARCADO_POR_MES,
  AVISO_HAY_MAS_GASTOS_DEL_MES,
  AVISO_TOPE_POR_VEZ_SUMAR,
  AVISO_YA_EN_UN_VIAJE,
  AYUDA_DE_LA_LISTA_A_VIAJE,
  BOTON_VOLVER,
  ETIQUETA_DE_CATEGORIA,
  ELEGIR_EL_VIAJE,
  SUMAR_A_VIAJE_CONTEXT,
  TITULO_SUMAR_A_VIAJE,
  TODAS_LAS_CATEGORIAS,
  VER_EL_VIAJE,
  VOLVER_A_ELEGIR_GASTOS,
  VOLVER_A_GASTOS,
  textoSinGastosEnElMes,
  textoTodosConViaje,
} from './sumar-a-viaje-textos';
import { armarResultado, type ResultadoParaMostrar } from './sumar-gastos-resultado';
import { idsDe, totalDeMarcados } from './sumar-gastos-seleccion';
import {
  ERROR_CATEGORIAS,
  MARCA_ALGUNO,
  MARCAR_TODOS_DESMARCADO,
  SUMANDO,
  TITULO_LISTA_SUELTOS,
  UN_MOMENTO,
  textoMarcarTodos,
  textoTotalMarcado,
} from './sumar-gastos-textos';
import { useVincularGastos } from './use-gasto-mutations';
import { useCategorias, useGastosDelMes } from './use-gastos';
import { useSeleccionConTope } from './use-seleccion-con-tope';
import { useVinculosEnCurso } from './use-vinculos-en-curso';

/** El paso en que está la pantalla: 1 = elegir los gastos, 2 = elegir el viaje. */
type Paso = 1 | 2;

/** Lo que muestra el aviso de después de sumar: el resultado y a qué viaje se sumó (para «Ver el viaje»). */
interface ResultadoDeEstaPantalla {
  datos: ResultadoParaMostrar;
  viajeId: string;
  /** El `search` de la lista de Viajes en el mes de ese viaje: el «Volver» del detalle lleva a esa lista. Ya saneado ('' o '?mes=…'). */
  volverAViajes: string;
}

/** Lo único que identifica a una lista: el mes y la categoría. Cambia cuando cambia lo que se ve. */
function claveDelFiltro(filtro: GastosFiltro): string {
  return `${formatMesParam(filtro.mes)}|${filtro.categoriaId ?? ''}`;
}

/**
 * «Sumar varios a un viaje» (`/gastos/sumar-a-viaje`): se llega desde la lista de Gastos. Marca varios gastos que NO tienen viaje y
 * ponlos en un viaje de una vez, sin entrar al viaje. Es el camino inverso de «Sumar gastos que ya cargué» (que parte de un viaje y
 * busca gastos): acá se parte de los gastos y se busca el viaje. Se arma igual que «Sumar» y «Quitar».
 *
 * Dos pasos en la MISMA pantalla (el paso es estado del componente, no de la URL):
 *  1. Elegir los gastos: los del mes (y la categoría) de la URL que no tienen viaje. Los que ya están en un viaje NO aparecen (sacarlos
 *     se hace desde el viaje). Al cambiar el mes o la categoría se DESMARCA todo, con un aviso si había algo marcado: así lo que se
 *     ve es siempre lo que se manda. NINGUNO viene marcado y nunca se marcan más de `MAX_GASTOS_POR_VEZ` (`useSeleccionConTope`).
 *  2. ¿A qué viaje? (`ElegirElViaje`): los viajes de un mes, para elegir uno. «Volver» regresa al paso 1 sin perder lo marcado.
 *
 * Después de sumar la pantalla NO vuelve sola a Gastos: vuelve al paso 1 con el aviso de qué se sumó (y «Ver el viaje» y «Volver a
 * Gastos»), sin nada marcado y con la lista pedida otra vez (lo sumado ya no está).
 *
 * Reglas que esta pantalla no se salta (las de la auditoría de seguridad de la capa de datos y de «Sumar» y «Quitar»):
 *  1. Se manda SIEMPRE «lo marcado que sigue en la lista de ahora» (`useSeleccionConTope`), nunca un conjunto guardado, y sin los
 *     gastos de otro camión que el viaje. La selección se vacía después de cada envío que termina y se conserva si falla (para que
 *     «Reintentar» tenga qué mandar); «Reintentar» vuelve a calcular desde lo marcado y el viaje elegido AHORA.
 *  2. Nada se puede tocar mientras haya un «Sumar» o un «Quitar» en curso o en cola, de esta pantalla o de otra
 *     (`useVinculosEnCurso`: cuenta todo el scope compartido): ni los botones, ni las casillas, ni «Marcar todos», ni las opciones de
 *     viaje, ni el mes y la categoría, ni «Reintentar». El botón dice «Sumando…» solo si el pedido es de ESTA pantalla; si es otra
 *     operación, un texto neutro («Un momento…»).
 *  3. «Reintentar» llama a la misma función de enviar: relee lo marcado y el viaje elegido de ahora. No se ofrece sin nada para
 *     mandar ni con una clase de error que no se reintenta (`payment`).
 *  4. Solo `mutateAsync` dentro de `useSubmitFeedback`, sin callbacks por llamada (no corren si la pantalla se desmonta).
 *  5. Las fechas, solo con los ayudantes de `@/lib/dates` (la base acepta `infinity` y `Intl` rompería el dibujo).
 *  6. La ruta está en la lista blanca de «Reportar un problema» (`ruta-de-vuelta.ts`).
 *  7. Si falla el refresco de una lista con datos a la vista, se sigue mostrando (con el aviso y «Reintentar»).
 * Y nunca se muestra el texto que manda el servidor: todo error pasa por `mapDataError` (con los textos de `SUMAR_A_VIAJE_CONTEXT`).
 *
 * Qué NO hace: navegar a algo que venga del estado o de la URL. El mes y la categoría se validan con `readFiltro` (una categoría que
 * no existe se ignora, igual que en Gastos); «Volver a Gastos» y los enlaces del aviso se arman acá con eso y con el id de un viaje
 * que salió de la lista, nunca con un texto de la URL. Tampoco manda nunca `transportista_id` ni arma consultas.
 */
export function SumarAViajePage() {
  useScrollToTopOnMount();
  const [searchParams, setSearchParams] = useSearchParams();
  const tenantId = useTenantId();

  const filtroUrl = readFiltro(searchParams);
  const categoriasQuery = useCategorias();
  // La patente de un viaje solo se muestra si la cuenta tiene 2 o más camiones (la cuenta, el segundo paso).
  const camiones = useCamiones().data?.items;
  const categorias = useMemo<readonly Categoria[]>(() => categoriasQuery.data ?? [], [categoriasQuery.data]);
  const categoriasCargadas = categoriasQuery.data !== undefined;

  // Igual que en Gastos: una categoría de la URL que no existe se ignora apenas se sabe cuáles hay, y la lista ESPERA a las categorías
  // (para validarla) antes de pedir si hay una en la URL.
  const categoriaValida =
    filtroUrl.categoriaId === null || !categoriasCargadas || categorias.some((categoria) => categoria.id === filtroUrl.categoriaId);
  const filtro: GastosFiltro = categoriaValida ? filtroUrl : { ...filtroUrl, categoriaId: null };
  const esperandoCategorias = filtro.categoriaId !== null && !categoriasCargadas;
  const gastosQuery = useGastosDelMes(filtro, !esperandoCategorias);

  const categoriasPorId = useMemo(() => new Map(categorias.map((categoria) => [categoria.id, categoria])), [categorias]);
  const opcionesFiltro = useMemo(
    () => [
      { value: '', label: TODAS_LAS_CATEGORIAS },
      ...categoriasParaElegir(categorias, filtro.categoriaId).map((categoria) => ({ value: categoria.id, label: nombreParaMostrar(categoria) })),
    ],
    [categorias, filtro.categoriaId],
  );

  const vuelta = `/gastos${filtroToSearch(filtro)}`;
  const mesLabel = formatMonthLabel(filtro.mes);

  // Solo los gastos SIN viaje de esa lista (los que ya tienen viaje no se ofrecen).
  const todos = gastosQuery.data?.items ?? [];
  const sueltos = gastosSinViaje(todos);
  const truncado = gastosQuery.data?.truncado ?? false;
  const seleccion = useSeleccionConTope(idsDe(sueltos), MAX_GASTOS_POR_VEZ);
  const cantidad = seleccion.idsParaEnviar.length;
  const marcados = gastosMarcados(sueltos, seleccion.idsParaEnviar);
  const total = totalDeMarcados(sueltos, seleccion.marcados);
  const hayMasQueElTope = sueltos.length > MAX_GASTOS_POR_VEZ;

  const [paso, setPaso] = useState<Paso>(1);
  const [resultado, setResultado] = useState<ResultadoDeEstaPantalla | null>(null);
  const [avisoDesmarcado, setAvisoDesmarcado] = useState<string | null>(null);

  const vincular = useVincularGastos();
  const vinculosEnCurso = useVinculosEnCurso();
  const { run, pending, error, retryable, clearError } = useSubmitFeedback({ context: SUMAR_A_VIAJE_CONTEXT });
  // Hay un «Sumar» o un «Quitar» en curso o en cola (de esta pantalla o de otra): nada se puede tocar hasta que termine.
  // `pending` cubre el instante entre el toque y el primer dibujo (y dice que el pedido en curso es ESTE); `vinculosEnCurso`, todo lo que
  // está en la caché de mutaciones, venga de donde venga.
  const ocupado = pending || vinculosEnCurso;
  const textoOcupado = pending ? SUMANDO : UN_MOMENTO;

  // Cambió el mes o la categoría (por el selector de esta pantalla o por otro lado, como el botón «atrás»): lo marcado se desmarca y se
  // vuelve al primer paso. Se hace acá, mirando la URL, y no en el selector: así vale para cualquier cambio. Si fue el selector, además
  // avisa (`cambiarFiltro`).
  const clave = claveDelFiltro(filtro);
  const [claveVista, setClaveVista] = useState(clave);
  if (clave !== claveVista) {
    setClaveVista(clave);
    seleccion.vaciar();
    setPaso(1);
  }

  function cambiarFiltro(siguiente: GastosFiltro, queCambio: 'mes' | 'categoria') {
    if (ocupado) return;
    setAvisoDesmarcado(cantidad > 0 ? (queCambio === 'mes' ? AVISO_DESMARCADO_POR_MES : AVISO_DESMARCADO_POR_CATEGORIA) : null);
    setSearchParams(filtroToParams(siguiente), { replace: true });
  }

  /**
   * Suma lo marcado AHORA al viaje elegido AHORA (la lista de viajes que se ve en este momento). «Reintentar» llama a esta misma
   * función: vuelve a leer la selección de este momento (selección ∩ lista de ahora, sin los de otro camión), no reenvía lo que se
   * mandó antes. Sin viaje o sin nada que mandar, no manda nada.
   */
  async function enviar(viaje: ViajeDeLista | null) {
    if (ocupado || viaje === null) return;
    const enviados = repartirPorCamionDelViaje(marcados, viaje).aEnviar;
    const gastoIds = idsDe(enviados);
    if (gastoIds.length === 0) return;
    setResultado(null);
    setAvisoDesmarcado(null);
    const intento = await run(() => vincular.mutateAsync({ tenantId, viajeId: viaje.id, gastoIds }), { keepLocked: false });
    if (!intento.ok) return; // el aviso del error lo muestra `useSubmitFeedback`; la selección se conserva
    seleccion.vaciar();
    setResultado({
      datos: armarResultado(intento.data, enviados, categoriasPorId),
      viajeId: viaje.id,
      volverAViajes: searchDelMesDeFecha(viaje.fecha),
    });
    setPaso(1);
  }

  function volverAElegirGastos() {
    if (ocupado) return;
    setPaso(1);
  }

  // Al volver al primer paso el foco va a su título (el paso anterior desapareció y el foco se habría perdido). Va ANTES del efecto del
  // aviso: si hay un resultado, gana el aviso.
  const tituloListaRef = useRef<HTMLHeadingElement>(null);
  const primerDibujo = useRef(true);
  useEffect(() => {
    if (primerDibujo.current) {
      primerDibujo.current = false;
      return;
    }
    if (paso === 1) tituloListaRef.current?.focus({ preventScroll: true });
  }, [paso]);

  // Al terminar un envío el aviso es lo que hay que ver: se lleva la vista y el foco ahí.
  const avisoRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (resultado === null) return;
    const aviso = avisoRef.current;
    if (aviso === null) return;
    aviso.focus({ preventScroll: true });
    aviso.scrollIntoView({ block: 'center' });
  }, [resultado]);

  const errorLista = gastosQuery.isError ? (
    <InlineError message={mapDataError(gastosQuery.error)} onRetry={() => void gastosQuery.refetch()} retrying={gastosQuery.isFetching} />
  ) : null;

  // Las categorías no cargaron (y no hay una copia anterior): la lista igual se muestra, con nombres genéricos y sin poder filtrar.
  const errorCategorias =
    categoriasQuery.isError && !categoriasCargadas ? (
      <InlineError
        message={`${ERROR_CATEGORIAS} ${mapDataError(categoriasQuery.error)}`}
        onRetry={() => void categoriasQuery.refetch()}
        retrying={categoriasQuery.isFetching}
      />
    ) : null;

  const volverAGastos = (
    <Button asChild size="lg">
      <Link to={vuelta}>{VOLVER_A_GASTOS}</Link>
    </Button>
  );

  let lista: ReactNode;
  if (esperandoCategorias && categoriasQuery.isError) {
    lista = null; // el aviso de las categorías (arriba) ya lo explica; no hay nada que listar todavía
  } else if (gastosQuery.data === undefined) {
    lista = errorLista ?? <ListSkeleton rows={5} />;
  } else if (sueltos.length === 0) {
    lista = (
      <>
        {errorLista}
        <EmptyState
          icon={Receipt}
          title={todos.length === 0 ? textoSinGastosEnElMes(mesLabel, filtro.categoriaId !== null) : textoTodosConViaje(mesLabel)}
          action={volverAGastos}
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
            <AlertDescription>{AVISO_TOPE_POR_VEZ_SUMAR}</AlertDescription>
          </Alert>
        ) : null}
        {truncado ? (
          <Alert>
            <Info aria-hidden="true" />
            <AlertDescription>{AVISO_HAY_MAS_GASTOS_DEL_MES}</AlertDescription>
          </Alert>
        ) : null}

        <section aria-labelledby="sumar-a-viaje-lista-titulo" className="space-y-3">
          <h2 id="sumar-a-viaje-lista-titulo" ref={tituloListaRef} tabIndex={-1} className="text-lg font-semibold focus-visible:outline-none">
            {TITULO_LISTA_SUELTOS}
          </h2>
          <p className="text-muted-foreground">{AYUDA_DE_LA_LISTA_A_VIAJE}</p>
          <p className="text-muted-foreground">{AVISO_YA_EN_UN_VIAJE}</p>
          <Button
            type="button"
            variant="outline"
            className="w-full sm:w-auto"
            disabled={ocupado}
            onClick={() => {
              setAvisoDesmarcado(null);
              if (seleccion.todosMarcados) seleccion.desmarcarTodos();
              else seleccion.marcarTodos();
            }}
          >
            {seleccion.todosMarcados
              ? MARCAR_TODOS_DESMARCADO
              : hayMasQueElTope
                ? textoMarcarPrimeros(MAX_GASTOS_POR_VEZ)
                : textoMarcarTodos(sueltos.length)}
          </Button>
          <GastosParaElegir
            gastos={sueltos}
            categoriasPorId={categoriasPorId}
            marcados={seleccion.marcados}
            onAlternar={(id) => {
              setAvisoDesmarcado(null);
              seleccion.alternar(id);
            }}
            deshabilitado={ocupado}
            sinCupo={seleccion.sinCupo}
            etiqueta={TITULO_LISTA_SUELTOS}
          />
        </section>
      </>
    );
  }

  // El botón del primer paso con lo que suma lo marcado. Se dibuja dos veces según el ancho (escritorio en el flujo, celular fijo abajo):
  // en cada ancho se ve UNA sola. Se apaga sin nada marcado o con algo en curso.
  const accion = (
    <div className="space-y-2 rounded-lg border border-border bg-card p-3">
      <p className="text-base font-medium tabular-nums [overflow-wrap:anywhere]">
        {cantidad > 0 ? textoTotalMarcado(formatNumber(total, { decimales: 2 })) : MARCA_ALGUNO}
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
        onClick={() => {
          clearError();
          setResultado(null); // el aviso de un envío anterior no vuelve sobre la selección nueva
          setPaso(2);
        }}
      >
        {ocupado ? (
          <>
            <Spinner /> {textoOcupado}
          </>
        ) : (
          ELEGIR_EL_VIAJE
        )}
      </Button>
      <span role="status" aria-live="polite" className="sr-only">
        {ocupado ? textoOcupado : ''}
      </span>
    </div>
  );

  const aviso =
    resultado === null ? null : (
      <div ref={avisoRef} tabIndex={-1} className="focus-visible:outline-none">
        <ResultadoDeSumar
          resultado={resultado.datos}
          acciones={
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button asChild variant="outline" className="w-full sm:w-auto">
                <Link to={rutaDelViaje(resultado.viajeId)} state={{ volver: resultado.volverAViajes }}>
                  {VER_EL_VIAJE}
                </Link>
              </Button>
              <Button asChild variant="outline" className="w-full sm:w-auto">
                <Link to={vuelta}>{VOLVER_A_GASTOS}</Link>
              </Button>
            </div>
          }
        />
      </div>
    );

  return (
    <div className="space-y-5">
      <div className="space-y-1">
        {paso === 1 ? (
          <VolverLink to={vuelta} destino="a Gastos" />
        ) : (
          <button
            type="button"
            onClick={volverAElegirGastos}
            disabled={ocupado}
            className={cn(
              '-ml-2 inline-flex min-h-12 items-center gap-1 rounded-md px-2 text-base font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              'disabled:cursor-not-allowed disabled:opacity-50',
            )}
          >
            <ChevronLeft className="size-5" aria-hidden="true" /> {BOTON_VOLVER}
            <span className="sr-only"> {VOLVER_A_ELEGIR_GASTOS}</span>
          </button>
        )}
        <PageHeader title={TITULO_SUMAR_A_VIAJE} ayuda={AYUDA_SUMAR_A_VIAJE} />
      </div>

      {paso === 2 ? (
        <ElegirElViaje
          marcados={marcados}
          total={total}
          mesInicial={filtro.mes}
          camiones={camiones}
          ocupado={ocupado}
          pending={pending}
          error={error}
          retryable={retryable}
          onEnviar={enviar}
        />
      ) : (
        <>
          {aviso}

          {/* Un `fieldset` apagado apaga también los botones de adentro (las flechas del mes): no hace falta tocar el selector de mes. */}
          <fieldset disabled={ocupado} className="min-w-0">
            <MonthPicker value={filtro.mes} onChange={(mes) => cambiarFiltro({ ...filtro, mes }, 'mes')} />
          </fieldset>
          <SelectField
            label={ETIQUETA_DE_CATEGORIA}
            value={filtro.categoriaId ?? ''}
            onChange={(value) => cambiarFiltro({ ...filtro, categoriaId: value === '' ? null : value }, 'categoria')}
            options={opcionesFiltro}
            disabled={!categoriasCargadas || ocupado}
          />

          {errorCategorias}

          {avisoDesmarcado !== null ? (
            <p role="status" className="text-base text-muted-foreground">
              {avisoDesmarcado}
            </p>
          ) : null}

          {lista}

          {/* Solo con algo que elegir: con la lista vacía, cargando o en error no hay botón (en lugar de uno apagado para siempre). */}
          {gastosQuery.data !== undefined && sueltos.length > 0 ? (
            <>
              <div className="max-md:hidden md:sticky md:bottom-4 md:z-30 [&>*]:shadow-lg">{accion}</div>
              {/* La barra fija del celular es más alta que la de un solo botón (lleva también la línea del total, y con el máximo
                  marcado otra más con el aviso): este aire extra evita que tape la última fila al llegar al final de la lista. */}
              <div aria-hidden="true" className={cn('md:hidden', seleccion.sinCupo ? 'h-36' : 'h-16')} />
              <FixedActionBar>{accion}</FixedActionBar>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
