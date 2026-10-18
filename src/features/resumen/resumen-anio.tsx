import { Link } from 'react-router';

import { todayLocal } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { BarraDecorativa, BloqueResumen, EstadoDeCarga, type ConsultaDeBloque } from './resumen-bloque';
import { CombustibleDelPeriodo } from './resumen-combustible';
import { gastoPorMes, mesesYaTranscurridos, promedioPorMes, totalesDelAnio, type GastoDeUnMes } from './resumen-calculos';
import { mesDeFecha, mesesTranscurridos } from './resumen-fechas';
import { filtroEnVista, resumenFiltroToSearch } from './resumen-filtros';
import { DesglosesDelGasto } from './resumen-gastos';
import {
  ETIQUETA_KM,
  ETIQUETA_PROMEDIO_POR_MES,
  ETIQUETA_VIAJES,
  etiquetaResultado,
  formatMonto,
  IR_A_LA_VISTA_MES,
  nombreDelMes,
  SIN_GASTOS,
  SIN_INGRESOS_CARGADOS,
  SIN_VIAJES,
  TEXTO_COMO_SE_CALCULA_RESULTADO_ANIO,
  TEXTO_VIAJES_EN_EL_ANIO,
  textoCantidadGastos,
  textoCantidadViajes,
  textoIngresosYGastos,
  textoKm,
  textoPromedioDeMeses,
  textoSinCombustibleDelAnio,
  textoSinGastosDelAnio,
  textoSinResultado,
  TITULO_GASTO_POR_MES,
  TITULO_GASTOS_DEL_ANIO,
  TITULO_RESULTADO,
  TITULO_RESULTADO_POR_MES,
} from './resumen-pantalla-textos';
import type { MontoYCantidad, ResumenDelMes, ResumenGastos } from './resumen-parse';
import { ContenidoDelResultado } from './resumen-resultado';
import { useResumenDelAnio } from './use-resumen';

/**
 * La vista Año: los bloques de UN año, cada uno con su consulta (`useResumenDelAnio`: el gasto del año, los 12 meses de
 * `resumen_mensual` y el combustible del año) y su propio estado. Componente aparte: al cambiar de año se arma de nuevo
 * con las consultas de ESE año (`key` en la pantalla).
 *
 * No hay lista de viajes: la base la limita a 62 días (un año no entra). Se ven mes a mes desde la vista Mes, y cada mes
 * de las listas "Gasto por mes" y "Resultado por mes" lleva a su Mes.
 */
export function ResumenDelAnio({ anio }: { anio: number }) {
  // "Hoy" una sola vez: decide si el año está en curso y cuántos meses ya empezaron (12 en un año pasado; en el año en
  // curso, hasta el actual inclusive).
  const hoy = todayLocal();
  const enCurso = mesDeFecha(hoy)?.year === anio;
  const meses = mesesTranscurridos(anio, hoy);
  const resumen = useResumenDelAnio(anio);
  const gastos = resumen.gastos.data;

  return (
    <>
      <EstadoDeCarga consultas={[resumen.gastos, resumen.mensual, resumen.combustible]} periodo={String(anio)} />
      <GastosDelAnio anio={anio} enCurso={enCurso} meses={meses} gastos={resumen.gastos} />
      <GastoPorMes anio={anio} enCurso={enCurso} meses={meses} mensual={resumen.mensual} />
      {gastos !== undefined && gastos.total.cantidad > 0 ? <DesglosesDelGasto datos={gastos} /> : null}
      <ResultadoDelAnio anio={anio} meses={meses} mensual={resumen.mensual} />
      <CombustibleDelPeriodo vacio={textoSinCombustibleDelAnio(anio, enCurso)} combustible={resumen.combustible} />
    </>
  );
}

interface GastosDelAnioProps {
  anio: number;
  enCurso: boolean;
  /** Meses transcurridos del año (el divisor del promedio). */
  meses: number;
  gastos: ConsultaDeBloque<ResumenGastos>;
}

/** El gasto del año: total (monto y cantidad) y el promedio por mes. Sin comparación con el año anterior. */
function GastosDelAnio({ anio, enCurso, meses, gastos }: GastosDelAnioProps) {
  return (
    <BloqueResumen id="resumen-gastos" titulo={TITULO_GASTOS_DEL_ANIO} consulta={gastos}>
      {(datos) =>
        datos.total.cantidad === 0 ? (
          <p className="text-muted-foreground">{textoSinGastosDelAnio(anio, enCurso)}</p>
        ) : (
          <TotalYPromedio total={datos.total} meses={meses} enCurso={enCurso} />
        )
      }
    </BloqueResumen>
  );
}

/**
 * El total y el promedio por mes = total / meses transcurridos (ver `mesesTranscurridos`): en el año en curso se divide
 * por los meses que ya empezaron, no por 12 (los que faltan todavía no tienen gastos). El texto dice sobre cuántos meses.
 */
function TotalYPromedio({ total, meses, enCurso }: { total: MontoYCantidad; meses: number; enCurso: boolean }) {
  const promedio = promedioPorMes(total.monto, meses);
  return (
    <>
      <div>
        <p className="text-3xl font-semibold tabular-nums [overflow-wrap:anywhere]">{formatMonto(total.monto)}</p>
        <p className="text-sm text-muted-foreground">{textoCantidadGastos(total.cantidad)}</p>
      </div>
      {promedio !== null ? (
        <dl>
          <div data-promedio="">
            <dt className="text-sm text-muted-foreground">{ETIQUETA_PROMEDIO_POR_MES}</dt>
            <dd className="text-lg font-semibold tabular-nums [overflow-wrap:anywhere]">{formatMonto(promedio)}</dd>
            <dd className="text-sm text-muted-foreground">{textoPromedioDeMeses(meses, enCurso)}</dd>
          </div>
        </dl>
      ) : null}
    </>
  );
}

interface GastoPorMesProps {
  anio: number;
  enCurso: boolean;
  meses: number;
  mensual: ConsultaDeBloque<ResumenDelMes[]>;
}

/**
 * Una barra por mes transcurrido (los futuros vienen en 0 y no aportan), con el ancho RELATIVO AL MES DE MAYOR GASTO y el
 * monto y la cantidad en texto. Cada fila lleva al Mes de ese mes. Sale de `resumen_mensual` (su propia consulta).
 */
function GastoPorMes({ anio, enCurso, meses, mensual }: GastoPorMesProps) {
  return (
    <BloqueResumen id="resumen-gasto-por-mes" titulo={TITULO_GASTO_POR_MES} consulta={mensual} filasCargando={4}>
      {(filas) => {
        const lista = gastoPorMes(filas, meses);
        if (lista.every((mes) => mes.monto === 0)) return <p className="text-muted-foreground">{textoSinGastosDelAnio(anio, enCurso)}</p>;
        return (
          <ul className="space-y-1">
            {lista.map((mes) => (
              <FilaDeGastoDelMes key={mes.mes} gasto={mes} />
            ))}
          </ul>
        );
      }}
    </BloqueResumen>
  );
}

/** Un mes: enlace a su Mes (área táctil ≥ 44 px). Sin gastos: lo dice y no dibuja barra. */
function FilaDeGastoDelMes({ gasto }: { gasto: GastoDeUnMes }) {
  const mes = mesDeFecha(gasto.mes);
  if (mes === null) return null;
  return (
    <li data-mes={gasto.mes.slice(0, 7)}>
      <Link
        to={`/resumen${resumenFiltroToSearch({ vista: 'mes', mes })}`}
        className="-mx-2 block min-h-11 rounded-md px-2 py-2 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex items-baseline justify-between gap-3">
          <span className="font-medium capitalize">{nombreDelMes(mes)}</span>
          {gasto.monto > 0 ? (
            <span className="shrink-0 font-semibold tabular-nums">{formatMonto(gasto.monto)}</span>
          ) : (
            <span className="shrink-0 text-sm text-muted-foreground">{SIN_GASTOS}</span>
          )}
        </span>
        {gasto.monto > 0 ? (
          <>
            <BarraDecorativa ancho={gasto.ancho} visible />
            <span className="mt-1 block text-sm text-muted-foreground">{textoCantidadGastos(gasto.cantidad)}</span>
          </>
        ) : null}
      </Link>
    </li>
  );
}

interface ResultadoDelAnioProps {
  anio: number;
  meses: number;
  mensual: ConsultaDeBloque<ResumenDelMes[]>;
}

/**
 * Ingresos y resultado del año, SUMANDO los 12 meses de `resumen_mensual` (`totalesDelAnio`), con las mismas reglas que el
 * Mes (`ContenidoDelResultado`) más los viajes y los km del año. Debajo, el resultado de cada mes transcurrido. No hay lista
 * de viajes: se explica y se lleva a la vista Mes.
 */
function ResultadoDelAnio({ anio, meses, mensual }: ResultadoDelAnioProps) {
  return (
    <BloqueResumen id="resumen-resultado" titulo={TITULO_RESULTADO} consulta={mensual} filasCargando={3}>
      {(filas) => {
        const totales = totalesDelAnio(filas);
        return (
          <>
            <ContenidoDelResultado
              datos={{
                resultado: totales.resultado,
                viajesCantidad: totales.viajesCantidad,
                viajesConIngreso: totales.viajesConIngreso,
                viajesSinIngreso: totales.viajesSinIngreso,
                viajesIngreso: totales.ingresos,
                gastosMonto: totales.gastos,
              }}
              etiquetaGastos={TITULO_GASTOS_DEL_ANIO}
              comoSeCalcula={TEXTO_COMO_SE_CALCULA_RESULTADO_ANIO}
              sinResultado={textoSinResultado(totales.viajesCantidad, 'año')}
              extras={[
                { etiqueta: ETIQUETA_VIAJES, valor: textoCantidadViajes(totales.viajesCantidad) },
                { etiqueta: ETIQUETA_KM, valor: textoKm(totales.viajesKm) },
              ]}
            />
            <p data-viajes-por-mes="" className="text-sm text-muted-foreground">
              {TEXTO_VIAJES_EN_EL_ANIO}{' '}
              <Link
                to={`/resumen${resumenFiltroToSearch(filtroEnVista({ vista: 'anio', anio }, 'mes'))}`}
                replace
                className="-mx-1 inline-flex min-h-11 items-center rounded-md px-1 font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {IR_A_LA_VISTA_MES}
              </Link>
            </p>
            {/* Sin ningún viaje en el año, el bloque ya lo dice: una lista de meses vacíos sería solo ruido. */}
            {totales.viajesCantidad > 0 ? <ResultadoPorMes filas={mesesYaTranscurridos(filas, meses)} /> : null}
          </>
        );
      }}
    </BloqueResumen>
  );
}

/**
 * El resultado de cada mes transcurrido, con enlace a su Mes. A la derecha:
 *  - un mes SIN VIAJES: "Sin viajes" (no es que falten ingresos: no hubo viajes);
 *  - con viajes pero ninguno con ingreso (`resultado` null, el de la base): "Sin ingresos cargados";
 *  - si no, Ganancia / Pérdida / Resultado.
 * La línea "Ingresos … · Gastos …" se omite si el mes no tuvo ni viajes ni gastos (serían dos ceros).
 */
function ResultadoPorMes({ filas }: { filas: readonly ResumenDelMes[] }) {
  return (
    <div data-resultado-por-mes="" className="space-y-2">
      <h3 id="resumen-resultado-por-mes-titulo" className="font-semibold">
        {TITULO_RESULTADO_POR_MES}
      </h3>
      <ul aria-labelledby="resumen-resultado-por-mes-titulo" className="space-y-1">
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
                className="-mx-2 flex min-h-11 items-center justify-between gap-3 rounded-md px-2 py-2 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="min-w-0">
                  <span className="block font-medium capitalize">{nombreDelMes(mes)}</span>
                  {conMovimientos ? (
                    <span className="block text-sm text-muted-foreground">{textoIngresosYGastos(fila.viajesIngreso, fila.gastosMonto)}</span>
                  ) : null}
                </span>
                {sinViajes || resultado === null ? (
                  <span data-resultado-del-mes="" className="shrink-0 text-right text-sm text-muted-foreground">
                    {sinViajes ? SIN_VIAJES : SIN_INGRESOS_CARGADOS}
                  </span>
                ) : (
                  <span data-resultado-del-mes="" className="shrink-0 text-right">
                    <span className="block text-xs text-muted-foreground">{etiquetaResultado(resultado)}</span>{' '}
                    <span className={cn('block font-semibold tabular-nums', resultado < 0 && 'text-destructive-text')}>
                      {formatMonto(Math.abs(resultado))}
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
