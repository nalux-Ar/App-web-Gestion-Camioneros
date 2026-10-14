import type { YearMonth } from '@/lib/dates';
import { BloqueResumen, ErrorDeBloque, ListaDeBarras, TarjetaResumen, type ConsultaDeBloque } from './resumen-bloque';
import { compararGasto, filasDeBarras, principalesYOtras } from './resumen-calculos';
import {
  formatMonto,
  periodoDeComparacion,
  textoCantidadGastos,
  textoDiferencia,
  textoErrorComparacion,
  textoOtrasCategorias,
  textoSinGastosDelMes,
  textoSinGastosParaComparar,
  textoVs,
  TITULO_GASTOS,
} from './resumen-pantalla-textos';
import type { ResumenGastos } from './resumen-parse';
import { ETIQUETAS_GRUPO_GASTO, etiquetaCamionResumen, etiquetaMetodoPago } from './resumen-textos';

/** Cuántas categorías se ven antes de sumar el resto en "Otras". */
const CATEGORIAS_A_LA_VISTA = 5;

interface GastosDelMesProps {
  mes: YearMonth;
  /** ¿Es el mes de hoy? Cambia contra qué se compara y el texto del vacío. */
  enCurso: boolean;
  gastos: ConsultaDeBloque<ResumenGastos>;
  comparacion: ConsultaDeBloque<ResumenGastos>;
}

/**
 * El gasto del mes: el total (monto y cantidad) con la comparación, y debajo los desgloses (por categoría, por método de
 * pago y por camión), que salen de la misma consulta: solo se muestran cuando hay gastos.
 */
export function GastosDelMes({ mes, enCurso, gastos, comparacion }: GastosDelMesProps) {
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
      {gastos.data !== undefined && gastos.data.total.cantidad > 0 ? <DesglosesDelGasto datos={gastos.data} /> : null}
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

/** Los tres desgloses del gasto del mes. El de camión solo si al menos un gasto tiene camión. */
function DesglosesDelGasto({ datos }: { datos: ResumenGastos }) {
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
        <ListaDeBarras filas={categorias} />
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
