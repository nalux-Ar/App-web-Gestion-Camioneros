import { Link } from 'react-router';

import { todayLocal } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { BarraDecorativa, BloqueCargando, BloqueResumen, EstadoDeCarga, type ConsultaDeBloque } from './resumen-bloque';
import { CombustibleDelPeriodo } from './resumen-combustible';
import { gastoPorMes, mesesYaTranscurridos, promedioPorMes, totalesDelAnio, type GastoDeUnMes } from './resumen-calculos';
import { mesDeFecha, mesesTranscurridos } from './resumen-fechas';
import { filtroEnVista, resumenFiltroToSearch } from './resumen-filtros';
import { BarrasPorCategoria, DesglosesPlegados } from './resumen-gastos';
import {
  ETIQUETA_KM,
  ETIQUETA_PROMEDIO_POR_MES,
  ETIQUETA_VIAJES,
  etiquetaResultado,
  formatMonto,
  formatResultado,
  IR_A_LA_VISTA_MES,
  nombreDelMes,
  SIN_GASTOS,
  SIN_INGRESOS_CARGADOS,
  SIN_VIAJES,
  TEXTO_COMO_SE_CALCULA_RESULTADO_ANIO,
  TEXTO_MESES_SIN_CARGAR,
  TEXTO_VIAJES_EN_EL_ANIO,
  textoCantidadGastos,
  textoCantidadViajes,
  textoIngresosYGastos,
  textoKm,
  textoPromedioDeMeses,
  textoSinCombustibleDelAnio,
  textoSinGastosDelAnio,
  textoSinResultado,
  TITULO_EN_QUE_GASTASTE,
  TITULO_GASTO_POR_MES,
  TITULO_MES_POR_MES,
  TITULO_RESULTADO,
  TITULO_RESULTADO_POR_MES,
} from './resumen-pantalla-textos';
import type { ResumenDelMes, ResumenGastos } from './resumen-parse';
import { PlegadoResumen } from './resumen-plegado';
import { ContenidoDelResultado } from './resumen-resultado';
import { useResumenDelAnio } from './use-resumen';

/**
 * La vista Año: los bloques de UN año, cada uno con su consulta (`useResumenDelAnio`: el gasto del año, los 12 meses de
 * `resumen_mensual` y el combustible del año) y su propio estado. Componente aparte: al cambiar de año se arma de nuevo
 * con las consultas de ESE año (`key` en la pantalla).
 *
 * No hay lista de viajes: la base la limita a 62 días (un año no entra). Se ven mes a mes desde la vista Mes, y cada mes
 * de las listas "Gasto por mes" y "Resultado por mes" (dentro de "Mes por mes") lleva a su Mes.
 */
export function ResumenDelAnio({ anio }: { anio: number }) {
  // "Hoy" una sola vez: decide si el año está en curso y cuántos meses ya empezaron (12 en un año pasado; en el año en
  // curso, hasta el actual inclusive).
  const hoy = todayLocal();
  const enCurso = mesDeFecha(hoy)?.year === anio;
  const meses = mesesTranscurridos(anio, hoy);
  const resumen = useResumenDelAnio(anio);

  return (
    <>
      <EstadoDeCarga consultas={[resumen.gastos, resumen.mensual, resumen.combustible]} periodo={String(anio)} />
      <ResultadoDelAnio mensual={resumen.mensual} />
      <GastosDelAnio anio={anio} enCurso={enCurso} meses={meses} gastos={resumen.gastos} />
      <MesPorMes anio={anio} enCurso={enCurso} meses={meses} mensual={resumen.mensual} />
      <DesglosesPlegados gastos={resumen.gastos} />
      <CombustibleDelPeriodo vacio={textoSinCombustibleDelAnio(anio, enCurso)} combustible={resumen.combustible} />
    </>
  );
}

/**
 * La primera tarjeta del Año: lo que cobraste, lo que gastaste y cuánto te quedó, SUMANDO los 12 meses de
 * `resumen_mensual` (`totalesDelAnio`), con las mismas reglas que el Mes (`ContenidoDelResultado`).
 */
function ResultadoDelAnio({ mensual }: { mensual: ConsultaDeBloque<ResumenDelMes[]> }) {
  return (
    <BloqueResumen id="resumen-resultado" titulo={TITULO_RESULTADO} consulta={mensual} filasCargando={3}>
      {(filas) => {
        const totales = totalesDelAnio(filas);
        return (
          <ContenidoDelResultado
            datos={{
              resultado: totales.resultado,
              viajesCantidad: totales.viajesCantidad,
              viajesConIngreso: totales.viajesConIngreso,
              viajesSinIngreso: totales.viajesSinIngreso,
              viajesIngreso: totales.ingresos,
              gastosMonto: totales.gastos,
            }}
            comoSeCalcula={TEXTO_COMO_SE_CALCULA_RESULTADO_ANIO}
            sinResultado={textoSinResultado(totales.viajesCantidad, 'año')}
          />
        );
      }}
    </BloqueResumen>
  );
}

interface GastosDelAnioProps {
  anio: number;
  enCurso: boolean;
  /** Meses transcurridos del año (el divisor del promedio). */
  meses: number;
  gastos: ConsultaDeBloque<ResumenGastos>;
}

/**
 * "En qué gastaste" del año: cuántos gastos, las barras por categoría y el promedio por mes. Sin comparación con el año
 * anterior, y sin el total (es el "Gastaste" de la primera tarjeta).
 */
function GastosDelAnio({ anio, enCurso, meses, gastos }: GastosDelAnioProps) {
  return (
    <BloqueResumen id="resumen-gastos" titulo={TITULO_EN_QUE_GASTASTE} consulta={gastos}>
      {(datos) =>
        datos.total.cantidad === 0 ? (
          <p className="text-muted-foreground">{textoSinGastosDelAnio(anio, enCurso)}</p>
        ) : (
          <>
            <p className="text-base text-muted-foreground">{textoCantidadGastos(datos.total.cantidad)}</p>
            <BarrasPorCategoria datos={datos} />
            <PromedioPorMes monto={datos.total.monto} meses={meses} enCurso={enCurso} />
          </>
        )
      }
    </BloqueResumen>
  );
}

/**
 * El promedio por mes = total / meses transcurridos (ver `mesesTranscurridos`): en el año en curso se divide por los
 * meses que ya empezaron, no por 12 (los que faltan todavía no tienen gastos). El texto dice sobre cuántos meses.
 */
function PromedioPorMes({ monto, meses, enCurso }: { monto: number; meses: number; enCurso: boolean }) {
  const promedio = promedioPorMes(monto, meses);
  if (promedio === null) return null;
  return (
    <dl className="border-t border-border pt-3">
      <div data-promedio="">
        <dt className="text-base text-muted-foreground">{ETIQUETA_PROMEDIO_POR_MES}</dt>
        <dd className="text-lg font-semibold tabular-nums [overflow-wrap:anywhere]">{formatMonto(promedio)}</dd>
        <dd className="text-base text-muted-foreground">{textoPromedioDeMeses(meses, enCurso)}</dd>
      </div>
    </dl>
  );
}

interface MesPorMesProps {
  anio: number;
  enCurso: boolean;
  meses: number;
  mensual: ConsultaDeBloque<ResumenDelMes[]>;
}

/**
 * "Mes por mes", plegado: los viajes y km del año, el gasto y el resultado de cada mes transcurrido y el paso a la vista
 * Mes (acá no hay lista de viajes). Usa la MISMA serie que la primera tarjeta, así que no se abre solo ni repite el aviso
 * de error: si no cargó, adentro dice dónde está.
 */
function MesPorMes({ anio, enCurso, meses, mensual }: MesPorMesProps) {
  const filas = mensual.data;
  return (
    <PlegadoResumen id="resumen-mes-por-mes" titulo={TITULO_MES_POR_MES} ocupada={filas === undefined && !mensual.isError}>
      {filas !== undefined ? (
        <DetalleMesPorMes anio={anio} enCurso={enCurso} meses={meses} filas={filas} />
      ) : mensual.isError ? (
        <p className="text-base text-muted-foreground">{TEXTO_MESES_SIN_CARGAR}</p>
      ) : (
        <BloqueCargando filas={4} />
      )}
    </PlegadoResumen>
  );
}

function DetalleMesPorMes({ anio, enCurso, meses, filas }: Omit<MesPorMesProps, 'mensual'> & { filas: readonly ResumenDelMes[] }) {
  const totales = totalesDelAnio(filas);
  return (
    <>
      <dl className="grid grid-cols-2 gap-3">
        <div>
          <dt className="text-base text-muted-foreground">{ETIQUETA_VIAJES}</dt>
          <dd className="text-lg font-semibold tabular-nums [overflow-wrap:anywhere]">{textoCantidadViajes(totales.viajesCantidad)}</dd>
        </div>
        <div>
          <dt className="text-base text-muted-foreground">{ETIQUETA_KM}</dt>
          <dd className="text-lg font-semibold tabular-nums [overflow-wrap:anywhere]">{textoKm(totales.viajesKm)}</dd>
        </div>
      </dl>
      <GastoPorMes anio={anio} enCurso={enCurso} meses={meses} filas={filas} />
      {/* Sin ningún viaje en el año, ya se dice arriba: una lista de meses vacíos sería solo ruido. */}
      {totales.viajesCantidad > 0 ? <ResultadoPorMes filas={mesesYaTranscurridos(filas, meses)} /> : null}
      <p data-viajes-por-mes="" className="text-base text-muted-foreground">
        {TEXTO_VIAJES_EN_EL_ANIO}{' '}
        <Link
          to={`/resumen${resumenFiltroToSearch(filtroEnVista({ vista: 'anio', anio }, 'mes'))}`}
          replace
          className="-mx-1 inline-flex min-h-11 items-center rounded-md px-1 font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {IR_A_LA_VISTA_MES}
        </Link>
      </p>
    </>
  );
}

/**
 * Una barra por mes transcurrido (los futuros vienen en 0 y no aportan), con el ancho RELATIVO AL MES DE MAYOR GASTO y el
 * monto y la cantidad en texto. Cada fila lleva al Mes de ese mes.
 */
function GastoPorMes({ anio, enCurso, meses, filas }: Omit<MesPorMesProps, 'mensual'> & { filas: readonly ResumenDelMes[] }) {
  const lista = gastoPorMes(filas, meses);
  return (
    <div id="resumen-gasto-por-mes" className="space-y-2">
      <h3 id="resumen-gasto-por-mes-titulo" className="font-semibold">
        {TITULO_GASTO_POR_MES}
      </h3>
      {lista.every((mes) => mes.monto === 0) ? (
        <p className="text-muted-foreground">{textoSinGastosDelAnio(anio, enCurso)}</p>
      ) : (
        <ul aria-labelledby="resumen-gasto-por-mes-titulo" className="space-y-2">
          {lista.map((mes) => (
            <FilaDeGastoDelMes key={mes.mes} gasto={mes} />
          ))}
        </ul>
      )}
    </div>
  );
}

/** Un mes: enlace a su Mes (área táctil ≥ 48 px, con 8 px de aire entre filas). Sin gastos: lo dice y no dibuja barra. */
function FilaDeGastoDelMes({ gasto }: { gasto: GastoDeUnMes }) {
  const mes = mesDeFecha(gasto.mes);
  if (mes === null) return null;
  return (
    <li data-mes={gasto.mes.slice(0, 7)}>
      <Link
        to={`/resumen${resumenFiltroToSearch({ vista: 'mes', mes })}`}
        className="-mx-2 block min-h-12 rounded-md px-2 py-2 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex items-baseline justify-between gap-3">
          <span className="font-medium capitalize">{nombreDelMes(mes)}</span>
          {gasto.monto > 0 ? (
            <span className="shrink-0 font-semibold tabular-nums">{formatMonto(gasto.monto)}</span>
          ) : (
            <span className="shrink-0 text-base text-muted-foreground">{SIN_GASTOS}</span>
          )}
        </span>
        {gasto.monto > 0 ? (
          <>
            <BarraDecorativa ancho={gasto.ancho} visible />
            <span className="mt-1 block text-base text-muted-foreground">{textoCantidadGastos(gasto.cantidad)}</span>
          </>
        ) : null}
      </Link>
    </li>
  );
}

/**
 * El resultado de cada mes transcurrido, con enlace a su Mes. A la derecha:
 *  - un mes SIN VIAJES: "Sin viajes" (no es que falten ingresos: no hubo viajes);
 *  - con viajes pero ninguno con ingreso (`resultado` null, el de la base): "Sin ingresos cargados";
 *  - si no, Ganancia / Pérdida / Resultado (la pérdida, con "−" delante del monto).
 * La línea "Ingresos … · Gastos …" se omite si el mes no tuvo ni viajes ni gastos (serían dos ceros).
 */
function ResultadoPorMes({ filas }: { filas: readonly ResumenDelMes[] }) {
  return (
    <div data-resultado-por-mes="" className="space-y-2">
      <h3 id="resumen-resultado-por-mes-titulo" className="font-semibold">
        {TITULO_RESULTADO_POR_MES}
      </h3>
      <ul aria-labelledby="resumen-resultado-por-mes-titulo" className="space-y-2">
        {filas.map((fila) => {
          const mes = mesDeFecha(fila.mes);
          if (mes === null) return null;
          const { resultado } = fila;
          const sinViajes = fila.viajesCantidad === 0;
          const conMovimientos = !sinViajes || fila.gastosCantidad > 0;
          return (
            <li key={fila.mes} data-mes={fila.mes.slice(0, 7)}>
              <Link
                to={`/resumen${resumenFiltroToSearch({ vista: 'mes', mes })}`}
                className="-mx-2 flex min-h-12 items-center justify-between gap-3 rounded-md px-2 py-2 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="min-w-0">
                  <span className="block font-medium capitalize">{nombreDelMes(mes)}</span>
                  {conMovimientos ? (
                    <span className="block text-base text-muted-foreground">{textoIngresosYGastos(fila.viajesIngreso, fila.gastosMonto)}</span>
                  ) : null}
                </span>
                {sinViajes || resultado === null ? (
                  <span data-resultado-del-mes="" className="shrink-0 text-right text-base text-muted-foreground">
                    {sinViajes ? SIN_VIAJES : SIN_INGRESOS_CARGADOS}
                  </span>
                ) : (
                  <span data-resultado-del-mes="" className="shrink-0 text-right">
                    <span className="block text-base text-muted-foreground">{etiquetaResultado(resultado)}</span>{' '}
                    <span className={cn('block font-semibold tabular-nums', resultado < 0 && 'text-destructive-text')}>
                      {formatResultado(resultado)}
                    </span>
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
