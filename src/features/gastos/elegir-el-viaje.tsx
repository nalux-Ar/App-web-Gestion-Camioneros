import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Check, Info, Route } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/shared/empty-state';
import { FixedActionBar } from '@/components/shared/fixed-action-bar';
import { InlineError } from '@/components/shared/inline-error';
import { ListSkeleton } from '@/components/shared/list-skeleton';
import { MonthPicker } from '@/components/shared/month-picker';
import { Spinner } from '@/components/shared/spinner';
import { buscarCamion, etiquetaCamion, type CamionDeLista } from '@/features/camiones/camion';
import { useViajesDelMes } from '@/features/viajes/use-viajes';
import type { ViajeDeLista } from '@/features/viajes/viajes-list';
import { mapDataError } from '@/lib/data-errors';
import { formatDateShort, formatMonthLabel, type YearMonth } from '@/lib/dates';
import { formatNumber } from '@/lib/numbers';
import { useScrollToTopOnMount } from '@/lib/use-scroll-to-top';
import { cn } from '@/lib/utils';
import type { GastoDeFila } from './gastos-api';
import {
  AVISO_HAY_MAS_VIAJES,
  ELIGE_UN_VIAJE,
  MARCADOS_DE_OTRO_CAMION,
  NOMBRE_DE_LA_LISTA_DE_VIAJES,
  TITULO_A_QUE_VIAJE,
  YA_NO_HAY_MARCADOS,
  textoBotonSumarAEsteViaje,
  textoNoHayViajes,
  textoOtroCamionEnElViaje,
  textoResumenDeMarcados,
} from './sumar-a-viaje-textos';
import { repartirPorCamionDelViaje } from './sumar-a-viaje';
import { UN_MOMENTO, SUMANDO } from './sumar-gastos-textos';

/** El id de la línea que explica una opción (la opción la nombra como descripción). */
function idDeLaNotaDelViaje(grupo: string, viajeId: string): string {
  return `${grupo}-nota-${viajeId}`;
}

interface ElegirElViajeProps {
  /** Los gastos marcados que siguen en la lista de AHORA, en el orden de la lista. */
  marcados: readonly GastoDeFila[];
  /** Lo que suman los marcados. */
  total: number;
  /** El mes con que arranca la lista de viajes (el de los gastos). Cambiarlo acá no toca lo marcado. */
  mesInicial: YearMonth;
  /** La lista de camiones (si ya cargó): con 2 o más se muestra la patente de cada viaje. */
  camiones: readonly CamionDeLista[] | undefined;
  /** Hay un «Sumar» o un «Quitar» en curso o en cola, de cualquier pantalla: no se puede tocar nada. */
  ocupado: boolean;
  /** El pedido en curso es de ESTA pantalla (decide entre «Sumando…» y «Un momento…»). */
  pending: boolean;
  /** El error del último envío, ya en español (nunca el texto del servidor), o null. */
  error: string | null;
  /** Reintentar tiene sentido (la clase del error lo permite). */
  retryable: boolean;
  /** Suma lo marcado AHORA al viaje que se pasa (la pantalla recalcula qué se manda). */
  onEnviar: (viaje: ViajeDeLista | null) => Promise<void>;
}

/**
 * El segundo paso de «Sumar varios a un viaje»: ¿a qué viaje? Una lista de los viajes de un mes (con su propio selector de mes) para
 * elegir UNO. NINGUNO viene elegido. Cada viaje es una opción de un grupo de radios nativos (un grupo con nombre, una sola elegida,
 * flechas y Tab del teclado, filas de 64 px o más).
 *
 * El camión: de los marcados, los que son de otro camión que el viaje NO se suman (la base los rechazaría). Si son algunos, la opción
 * lo dice y el botón de abajo repite el aviso; si son TODOS, la opción se apaga con el motivo. El botón dice cuántos se van a sumar
 * de verdad («Sumar N gastos a este viaje»).
 *
 * Lo que se manda lo decide la pantalla (`onEnviar`) con lo marcado y el viaje de ESTE momento: acá la elección es solo el id de una
 * opción y se vuelve a buscar en la lista de viajes de ahora en cada dibujo. Si el viaje desaparece de la lista (se borró, se cambió
 * de mes, se refrescó) la elección se borra: no queda un viaje elegido que no se ve.
 */
export function ElegirElViaje({ marcados, total, mesInicial, camiones, ocupado, pending, error, retryable, onEnviar }: ElegirElViajeProps) {
  useScrollToTopOnMount();
  const nombreDelGrupo = useId();
  const [mes, setMes] = useState<YearMonth>(mesInicial);
  const [viajeId, setViajeId] = useState<string | null>(null);
  const viajesQuery = useViajesDelMes({ mes, vista: 'viajes' });

  const viajes = viajesQuery.data?.items ?? [];
  const truncado = viajesQuery.data?.truncado ?? false;
  const viajeElegido = viajeId === null ? null : (viajes.find((viaje) => viaje.id === viajeId) ?? null);
  // El viaje elegido ya no está en la lista (con la lista a la vista): se borra la elección, también si el viaje vuelve a aparecer.
  if (viajeId !== null && viajesQuery.data !== undefined && viajeElegido === null) setViajeId(null);

  const conCamion = camiones !== undefined && camiones.length >= 2;
  const mesLabel = formatMonthLabel(mes);
  const hayMarcados = marcados.length > 0;

  const reparto = viajeElegido === null ? null : repartirPorCamionDelViaje(marcados, viajeElegido);
  const cantidad = reparto?.aEnviar.length ?? 0;
  const textoOcupado = pending ? SUMANDO : UN_MOMENTO;
  // «Reintentar» solo si tiene sentido (la clase del error lo permite) y hay algo que mandar AHORA.
  const puedeReintentar = retryable && cantidad > 0;

  // El error de un envío es lo que hay que ver: se lleva la vista y el foco ahí (con el botón fijo abajo y la lista larga, si no,
  // no se vería nada cambiar y el foco se perdería con el botón apagado).
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error === null) return;
    const aviso = errorRef.current;
    if (aviso === null) return;
    aviso.focus({ preventScroll: true });
    aviso.scrollIntoView({ block: 'center' });
  }, [error]);

  // Al entrar a este paso el foco va al título (el paso anterior desapareció y el foco se habría perdido).
  const tituloRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    tituloRef.current?.focus({ preventScroll: true });
  }, []);

  const errorLista = viajesQuery.isError ? (
    <InlineError message={mapDataError(viajesQuery.error)} onRetry={() => void viajesQuery.refetch()} retrying={viajesQuery.isFetching} />
  ) : null;

  let lista: ReactNode;
  if (viajesQuery.data === undefined) {
    lista = errorLista ?? <ListSkeleton rows={4} />;
  } else if (viajes.length === 0) {
    lista = (
      <>
        {errorLista}
        <EmptyState icon={Route} title={textoNoHayViajes(mesLabel)} />
      </>
    );
  } else {
    lista = (
      <>
        {errorLista}
        {truncado ? (
          <Alert>
            <Info aria-hidden="true" />
            <AlertDescription>{AVISO_HAY_MAS_VIAJES}</AlertDescription>
          </Alert>
        ) : null}
        <fieldset className="min-w-0">
          <legend className="sr-only">{NOMBRE_DE_LA_LISTA_DE_VIAJES}</legend>
          <ul className="space-y-2">
            {viajes.map((viaje) => {
              const parte = repartirPorCamionDelViaje(marcados, viaje);
              const elegido = viaje.id === viajeElegido?.id;
              const nota = parte.todosDeOtroCamion
                ? MARCADOS_DE_OTRO_CAMION
                : parte.deOtroCamion > 0
                  ? textoOtroCamionEnElViaje(parte.deOtroCamion)
                  : null;
              const idDeLaNota = idDeLaNotaDelViaje(nombreDelGrupo, viaje.id);
              const detalle = [
                formatDateShort(viaje.fecha),
                conCamion && viaje.camion_id ? etiquetaCamion(buscarCamion(camiones, viaje.camion_id)) : null,
              ]
                .filter(Boolean)
                .join(' · ');
              return (
                <li key={viaje.id}>
                  <label className="relative block min-w-0">
                    <input
                      type="radio"
                      name={nombreDelGrupo}
                      value={viaje.id}
                      checked={elegido}
                      disabled={ocupado || parte.todosDeOtroCamion}
                      aria-describedby={nota === null ? undefined : idDeLaNota}
                      onChange={() => setViajeId(viaje.id)}
                      className="peer sr-only"
                    />
                    <span
                      className={cn(
                        'flex min-h-16 cursor-pointer items-start gap-3 rounded-lg border-2 px-4 py-3 transition-colors',
                        elegido ? 'border-primary bg-primary/10' : 'border-border bg-card',
                        'hover:bg-accent',
                        'peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background',
                        'peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
                      )}
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border-2',
                          elegido ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-background',
                        )}
                      >
                        {elegido ? <Check className="size-5" /> : null}
                      </span>
                      <span className="min-w-0 flex-1 break-words">
                        <span className="block font-medium [overflow-wrap:anywhere]">
                          {viaje.origen} <span aria-hidden="true">→</span>
                          <span className="sr-only"> a </span> {viaje.destino}
                        </span>
                        <span className="block text-base text-muted-foreground">{detalle}</span>
                      </span>
                    </span>
                  </label>
                  {/* Afuera de la fila: una opción apagada se ve más tenue y el motivo tiene que leerse bien. */}
                  {nota !== null ? (
                    <p id={idDeLaNota} className="mt-1 px-1 text-base text-muted-foreground [overflow-wrap:anywhere]">
                      {nota}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </fieldset>
      </>
    );
  }

  // El botón principal. Se dibuja dos veces según el ancho (escritorio en el flujo, celular fijo abajo): en cada ancho se ve UNA sola.
  const accion = (
    <div className="space-y-2 rounded-lg border border-border bg-card p-3">
      {viajeElegido === null ? <p className="text-base font-medium [overflow-wrap:anywhere]">{ELIGE_UN_VIAJE}</p> : null}
      {reparto !== null && reparto.deOtroCamion > 0 && !reparto.todosDeOtroCamion ? (
        <p className="text-base text-muted-foreground [overflow-wrap:anywhere]">{textoOtroCamionEnElViaje(reparto.deOtroCamion)}</p>
      ) : null}
      <Button
        type="button"
        size="lg"
        className="h-auto min-h-14 w-full whitespace-normal py-2 text-center"
        disabled={ocupado || viajeElegido === null || cantidad === 0}
        aria-busy={ocupado}
        onClick={() => void onEnviar(viajeElegido)}
      >
        {ocupado ? (
          <>
            <Spinner /> {textoOcupado}
          </>
        ) : (
          textoBotonSumarAEsteViaje(cantidad)
        )}
      </Button>
      <span role="status" aria-live="polite" className="sr-only">
        {ocupado ? textoOcupado : ''}
      </span>
    </div>
  );

  return (
    <>
      {error !== null ? (
        <div ref={errorRef} tabIndex={-1} className="focus-visible:outline-none">
          <InlineError message={error} onRetry={puedeReintentar ? () => void onEnviar(viajeElegido) : undefined} retrying={ocupado} />
        </div>
      ) : null}

      <section aria-labelledby="sumar-a-viaje-viajes-titulo" className="space-y-3">
        <h2 id="sumar-a-viaje-viajes-titulo" ref={tituloRef} tabIndex={-1} className="text-lg font-semibold focus-visible:outline-none">
          {TITULO_A_QUE_VIAJE}
        </h2>
        <p className="text-base font-medium tabular-nums [overflow-wrap:anywhere]">
          {hayMarcados ? textoResumenDeMarcados(marcados.length, formatNumber(total, { decimales: 2 })) : YA_NO_HAY_MARCADOS}
        </p>
        {/* Un `fieldset` apagado apaga también los botones de adentro (las flechas del mes): no hace falta tocar el selector de mes. */}
        <fieldset disabled={ocupado} className="min-w-0">
          <MonthPicker
            value={mes}
            onChange={(siguiente) => {
              setMes(siguiente); // la elección se borra sola: el viaje elegido no está en la lista del mes nuevo
            }}
          />
        </fieldset>
        {lista}
      </section>

      <div className="max-md:hidden md:sticky md:bottom-4 md:z-30 [&>*]:shadow-lg">{accion}</div>
      {/* La barra fija del celular es más alta que la de un solo botón (lleva también la línea de arriba): este aire extra
          evita que tape la última fila al llegar al final de la lista. */}
      <div aria-hidden="true" className="h-24 md:hidden" />
      <FixedActionBar>{accion}</FixedActionBar>
    </>
  );
}
