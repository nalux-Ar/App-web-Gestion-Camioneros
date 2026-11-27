import { Link } from 'react-router';

import { GASTOS_VARIOS_CATEGORIA_ID } from '@/features/gastos/constants';
import { filtroToSearch } from '@/features/gastos/gastos-filters';
import { formatDateShort, type YearMonth } from '@/lib/dates';
import { BloqueResumen, ErrorDeBloque, LineaCargando, ListaDeBarras, type ConsultaDeBloque } from './resumen-bloque';
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
  TITULO_COMO_PAGASTE,
  TITULO_EN_QUE_GASTASTE,
  TITULO_GASTO_POR_CAMION,
} from './resumen-pantalla-textos';
import type { ResumenGastos, ResumenGastosVarios } from './resumen-parse';
import { PlegadoResumen } from './resumen-plegado';
import { etiquetaCamionResumen, etiquetaMetodoPago } from './resumen-textos';

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
 * "En qué gastaste" del mes: cuántos gastos, las barras por categoría y la comparación con el mes anterior. El total no
 * va acá: es el "Gastaste" de la primera tarjeta.
 */
export function GastosDelMes({ mes, enCurso, gastos, comparacion, gastosVarios }: GastosDelMesProps) {
  const periodo = periodoDeComparacion(mes, enCurso);
  return (
    <BloqueResumen id="resumen-gastos" titulo={TITULO_EN_QUE_GASTASTE} consulta={gastos}>
      {(datos) =>
        datos.total.cantidad === 0 ? (
          <p className="text-muted-foreground">{textoSinGastosDelMes(mes, enCurso)}</p>
        ) : (
          <>
            <p className="text-base text-muted-foreground">{textoCantidadGastos(datos.total.cantidad)}</p>
            <BarrasPorCategoria datos={datos} variosDelMes={{ mes, consulta: gastosVarios }} />
            <ComparacionDelGasto actual={datos.total.monto} consulta={comparacion} periodo={periodo} />
          </>
        )
      }
    </BloqueResumen>
  );
}

/**
 * La comparación, con SU estado (es otra consulta): mientras carga, una línea gris; si falla, su error con "Reintentar"
 * (lo demás de la tarjeta se sigue viendo). Si el período con que se compara no tuvo gastos, no hay porcentaje posible.
 * La raya de arriba la separa de la última barra: habla del total, no de esa categoría.
 */
function ComparacionDelGasto({ actual, consulta, periodo }: { actual: number; consulta: ConsultaDeBloque<ResumenGastos>; periodo: string }) {
  const anterior = consulta.data?.total.monto;
  return (
    <div data-comparacion="" className="space-y-2 border-t border-border pt-3">
      {consulta.isError ? <ErrorDeBloque consulta={consulta} prefijo={textoErrorComparacion(periodo)} /> : null}
      {anterior === undefined ? (
        consulta.isError ? null : <LineaCargando />
      ) : anterior > 0 ? (
        <p className="text-base">
          <span className="font-medium">{textoDiferencia(compararGasto(actual, anterior))}</span>{' '}
          <span className="text-muted-foreground">{textoVs(periodo, anterior)}</span>
        </p>
      ) : (
        <p className="text-base text-muted-foreground">{textoSinGastosParaComparar(periodo)}</p>
      )}
    </div>
  );
}

/**
 * Las barras por categoría de un período (el mes o el año: la misma respuesta de `resumen_gastos`), las 5 de mayor monto
 * y "Otras". En el Mes, con el detalle de "Gastos varios".
 */
export function BarrasPorCategoria({ datos, variosDelMes }: { datos: ResumenGastos; variosDelMes?: VariosDelMes }) {
  const categorias = filasDeBarras(
    principalesYOtras(
      datos.porCategoria.map((fila) => ({ clave: fila.categoriaId, etiqueta: fila.nombre, monto: fila.monto, cantidad: fila.cantidad })),
      CATEGORIAS_A_LA_VISTA,
      textoOtrasCategorias,
    ),
    datos.total.monto,
  );

  return (
    <div id="resumen-por-categoria">
      <ListaDeBarras
        filas={categorias}
        detalle={variosDelMes ? (clave) => (clave === GASTOS_VARIOS_CATEGORIA_ID ? <DetalleGastosVarios {...variosDelMes} /> : null) : undefined}
      />
      {/* "Gastos varios" puede haber quedado dentro de "Otras": el detalle va igual, debajo de las barras y con su título. */}
      {variosDelMes && !categorias.some((fila) => fila.clave === GASTOS_VARIOS_CATEGORIA_ID) && tieneVarios(datos) ? (
        <DetalleGastosVarios {...variosDelMes} conTitulo />
      ) : null}
    </div>
  );
}

/**
 * Los otros dos desgloses del gasto de un período, plegados: "Cómo pagaste" y "Gasto por camión" (este solo si al menos
 * un gasto tiene camión). Salen de la misma consulta que "En qué gastaste": solo aparecen cuando hay gastos, y su carga y
 * su error se ven allá.
 */
export function DesglosesPlegados({ gastos }: { gastos: ConsultaDeBloque<ResumenGastos> }) {
  const datos = gastos.data;
  if (datos === undefined || datos.total.cantidad === 0) return null;

  const total = datos.total.monto;
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
      <PlegadoResumen id="resumen-por-metodo" titulo={TITULO_COMO_PAGASTE}>
        <ListaDeBarras filas={metodos} />
      </PlegadoResumen>
      {conCamion ? (
        <PlegadoResumen id="resumen-por-camion" titulo={TITULO_GASTO_POR_CAMION}>
          <ListaDeBarras filas={camiones} />
        </PlegadoResumen>
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
          {conTitulo ? <h3 className="text-base font-semibold">{ETIQUETA_DETALLE_GASTOS_VARIOS}</h3> : null}
          <ul aria-label={conTitulo ? undefined : ETIQUETA_DETALLE_GASTOS_VARIOS} className="space-y-1 text-base">
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
            <p data-gastos-varios-mas="" className="text-base text-muted-foreground">
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
