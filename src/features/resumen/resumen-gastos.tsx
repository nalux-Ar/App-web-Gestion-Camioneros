import { Link } from 'react-router';

import { GASTOS_VARIOS_CATEGORIA_ID } from '@/features/gastos/constants';
import { filtroToSearch } from '@/features/gastos/gastos-filters';
import { formatDateShort, type YearMonth } from '@/lib/dates';
import { BloqueResumen, ErrorDeBloque, LineaCargando, ListaDeBarras, TarjetaResumen, type ConsultaDeBloque } from './resumen-bloque';
import { compararGasto, filasDeBarras, principalesYOtras } from './resumen-calculos';
import {
  ETIQUETA_DETALLE_GASTOS_VARIOS,
  formatMonto,
  periodoDeComparacion,
  SIN_DESCRIPCION,
  TEXTO_ERROR_DETALLE_GASTOS_VARIOS,
  textoDescripcionGasto,
  textoCantidadGastos,
  textoDiferencia,
  textoErrorComparacion,
  textoOtrasCategorias,
  textoSinGastosDelMes,
  textoSinGastosParaComparar,
  textoVs,
  textoYMasEnGastos,
  TITULO_GASTOS,
} from './resumen-pantalla-textos';
import type { ResumenGastos, ResumenGastosVarios } from './resumen-parse';
import { ETIQUETAS_GRUPO_GASTO, etiquetaCamionResumen, etiquetaMetodoPago } from './resumen-textos';

/** Cuántas categorías se ven antes de sumar el resto en "Otras". */
const CATEGORIAS_A_LA_VISTA = 5;

interface GastosDelMesProps {
  mes: YearMonth;
  /** ¿Es el mes de hoy? Cambia contra qué se compara y el texto del vacío. */
  enCurso: boolean;
  gastos: ConsultaDeBloque<ResumenGastos>;
  comparacion: ConsultaDeBloque<ResumenGastos>;
  /** El detalle de "Gastos varios" del mes (accesorio: si falla, el resto del desglose se ve igual). */
  gastosVarios: ConsultaDeBloque<ResumenGastosVarios>;
}

/**
 * El gasto del mes: el total (monto y cantidad) con la comparación, y debajo los desgloses (por categoría, por método de
 * pago y por camión), que salen de la misma consulta: solo se muestran cuando hay gastos.
 */
export function GastosDelMes({ mes, enCurso, gastos, comparacion, gastosVarios }: GastosDelMesProps) {
  const periodo = periodoDeComparacion(mes, enCurso);
  return (
    <>
      <BloqueResumen id="resumen-gastos" titulo={TITULO_GASTOS} consulta={gastos}>
        {(datos) =>
          datos.total.cantidad === 0 ? (
            <p className="text-muted-foreground">{textoSinGastosDelMes(mes, enCurso)}</p>
          ) : (
            <>
              <div>
                <p className="text-3xl font-semibold tabular-nums [overflow-wrap:anywhere]">{formatMonto(datos.total.monto)}</p>
                <p className="text-sm text-muted-foreground">{textoCantidadGastos(datos.total.cantidad)}</p>
              </div>
              <ComparacionDelGasto actual={datos.total.monto} consulta={comparacion} periodo={periodo} />
            </>
          )
        }
      </BloqueResumen>
      {gastos.data !== undefined && gastos.data.total.cantidad > 0 ? <DesglosesDelGasto datos={gastos.data} variosDelMes={{ mes, consulta: gastosVarios }} /> : null}
    </>
  );
}

/**
 * La comparación, con SU estado (es otra consulta): mientras carga, una línea gris; si falla, su error con "Reintentar"
 * (el total del mes se sigue viendo). Si el período con que se compara no tuvo gastos, no hay porcentaje posible.
 */
function ComparacionDelGasto({ actual, consulta, periodo }: { actual: number; consulta: ConsultaDeBloque<ResumenGastos>; periodo: string }) {
  const anterior = consulta.data?.total.monto;
  return (
    <div data-comparacion="" className="space-y-2">
      {consulta.isError ? <ErrorDeBloque consulta={consulta} prefijo={textoErrorComparacion(periodo)} /> : null}
      {anterior === undefined ? (
        consulta.isError ? null : <div aria-hidden="true" data-cargando="" className="h-5 w-2/3 animate-pulse rounded bg-muted motion-reduce:animate-none" />
      ) : anterior > 0 ? (
        <p className="text-sm">
          <span className="font-medium">{textoDiferencia(compararGasto(actual, anterior))}</span>{' '}
          <span className="text-muted-foreground">{textoVs(periodo, anterior)}</span>
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">{textoSinGastosParaComparar(periodo)}</p>
      )}
    </div>
  );
}

/**
 * Los tres desgloses del gasto de un período (el mes o el año: la misma respuesta de `resumen_gastos`). El de camión solo
 * si al menos un gasto tiene camión.
 */
export function DesglosesDelGasto({ datos, variosDelMes }: { datos: ResumenGastos; variosDelMes?: VariosDelMes }) {
  const total = datos.total.monto;
  const categorias = filasDeBarras(
    principalesYOtras(
      datos.porCategoria.map((fila) => ({ clave: fila.categoriaId, etiqueta: fila.nombre, monto: fila.monto, cantidad: fila.cantidad })),
      CATEGORIAS_A_LA_VISTA,
      textoOtrasCategorias,
    ),
    total,
  );
  const metodos = filasDeBarras(
    datos.porMetodo.map((fila) => ({ clave: fila.metodo ?? 'sin-especificar', etiqueta: etiquetaMetodoPago(fila.metodo), monto: fila.monto, cantidad: fila.cantidad })),
    total,
  );
  const conCamion = datos.porCamion.some((fila) => fila.camionId !== null);
  const camiones = filasDeBarras(
    datos.porCamion.map((fila) => ({ clave: fila.camionId ?? 'sin-camion', etiqueta: etiquetaCamionResumen(fila), monto: fila.monto, cantidad: fila.cantidad })),
    total,
  );

  return (
    <>
      <TarjetaResumen id="resumen-por-categoria" titulo={ETIQUETAS_GRUPO_GASTO.categoria}>
        <ListaDeBarras
          filas={categorias}
          detalle={variosDelMes ? (clave) => (clave === GASTOS_VARIOS_CATEGORIA_ID ? <DetalleGastosVarios {...variosDelMes} /> : null) : undefined}
        />
        {/* "Gastos varios" puede haber quedado dentro de "Otras": el detalle va igual, debajo de las barras y con su título. */}
        {variosDelMes && !categorias.some((fila) => fila.clave === GASTOS_VARIOS_CATEGORIA_ID) && tieneVarios(datos) ? (
          <DetalleGastosVarios {...variosDelMes} conTitulo />
        ) : null}
      </TarjetaResumen>
      <TarjetaResumen id="resumen-por-metodo" titulo={ETIQUETAS_GRUPO_GASTO.metodo_pago}>
        <ListaDeBarras filas={metodos} />
      </TarjetaResumen>
      {conCamion ? (
        <TarjetaResumen id="resumen-por-camion" titulo={ETIQUETAS_GRUPO_GASTO.camion}>
          <ListaDeBarras filas={camiones} />
        </TarjetaResumen>
      ) : null}
    </>
  );
}

/** El detalle de "Gastos varios" de UN mes: el mes (para el enlace a Gastos) y la consulta. */
interface VariosDelMes {
  mes: YearMonth;
  consulta: ConsultaDeBloque<ResumenGastosVarios>;
}

function tieneVarios(datos: ResumenGastos): boolean {
  return datos.porCategoria.some((fila) => fila.categoriaId === GASTOS_VARIOS_CATEGORIA_ID);
}

/**
 * Qué fue cada gasto de "Gastos varios" (fecha, descripción y monto), hasta 30, y "y N más en Gastos" (con enlace a esa
 * categoría y ese mes) si hay más. Es una consulta ACCESORIA con su propio estado: mientras carga, una línea gris; si
 * falla, un aviso breve (con "Reintentar" si sirve) y el resto de la tarjeta sigue igual; sin gastos varios, nada.
 * Todo el texto sale como texto plano (React lo escapa; nunca HTML).
 */
function DetalleGastosVarios({ mes, consulta, conTitulo = false }: VariosDelMes & { conTitulo?: boolean }) {
  const datos = consulta.data;
  const faltan = datos ? datos.totalCantidad - datos.filas.length : 0;
  if (datos !== undefined && datos.filas.length === 0 && !consulta.isError) return null;
  return (
    <div data-gastos-varios="" className="mt-2 space-y-2">
      {consulta.isError ? <ErrorDeBloque consulta={consulta} prefijo={TEXTO_ERROR_DETALLE_GASTOS_VARIOS} /> : null}
      {datos === undefined ? (
        consulta.isError ? null : <LineaCargando />
      ) : datos.filas.length > 0 ? (
        <>
          {conTitulo ? <h3 className="text-sm font-semibold">{ETIQUETA_DETALLE_GASTOS_VARIOS}</h3> : null}
          <ul aria-label={conTitulo ? undefined : ETIQUETA_DETALLE_GASTOS_VARIOS} className="space-y-1 text-sm">
            {datos.filas.map((gasto) => {
              const descripcion = textoDescripcionGasto(gasto.descripcion, gasto.truncada);
              return (
                <li key={gasto.id} data-gasto-vario="" className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 break-words">
                    <span className="text-muted-foreground">{formatDateShort(gasto.fecha)}</span>
                    {' · '}
                    {descripcion === null ? <span className="text-muted-foreground">{SIN_DESCRIPCION}</span> : descripcion}
                  </span>
                  <span className="shrink-0 font-medium tabular-nums">{formatMonto(gasto.monto)}</span>
                </li>
              );
            })}
          </ul>
          {faltan > 0 ? (
            <p data-gastos-varios-mas="" className="text-sm text-muted-foreground">
              <Link
                to={`/gastos${filtroToSearch({ mes, categoriaId: GASTOS_VARIOS_CATEGORIA_ID })}`}
                className="-mx-1 inline-flex min-h-11 items-center rounded-md px-1 font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {textoYMasEnGastos(faltan)}
              </Link>
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
