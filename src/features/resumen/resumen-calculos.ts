import type { ResumenDelMes } from './resumen-parse';

/**
 * Cuentas de la PANTALLA Resumen sobre lo que ya devolvió la base (la base suma; acá solo se compara y se reparte en
 * porcentajes para las barras). Lógica PURA: se prueba suelta.
 */

/** Redondeo a centavos, sin el ruido de la coma flotante (10000.1 - 8000.05 = 2000.0499999…). */
function aCentavos(valor: number): number {
  return Math.round(valor * 100) / 100;
}

export type SentidoComparacion = 'mas' | 'menos' | 'igual';

/** El gasto de un período contra el del período con que se compara. Todo en valor absoluto: el signo lo da `sentido`. */
export interface ComparacionDeGasto {
  sentido: SentidoComparacion;
  /** |actual − anterior|, a centavos. */
  diferencia: number;
  /** |actual − anterior| / anterior, en % entero; null si el anterior es 0 (no hay contra qué dividir). */
  porcentaje: number | null;
}

export function compararGasto(actual: number, anterior: number): ComparacionDeGasto {
  const diferencia = aCentavos(actual - anterior);
  const sentido: SentidoComparacion = diferencia > 0 ? 'mas' : diferencia < 0 ? 'menos' : 'igual';
  const porcentaje = anterior > 0 ? Math.round((Math.abs(diferencia) / anterior) * 100) : null;
  return { sentido, diferencia: Math.abs(diferencia), porcentaje };
}

/**
 * Porcentajes ENTEROS de cada monto sobre el total que suman lo mismo que los porcentajes exactos redondeados (100 si
 * los montos suman el total): método del mayor resto. Redondear cada uno por separado puede dar 99 % o 101 % en total.
 * Con total ≤ 0, todo 0. Empates en el resto: gana el que viene primero (la lista ya viene de mayor a menor).
 */
export function porcentajesEnteros(montos: readonly number[], total: number): number[] {
  if (!(total > 0)) return montos.map(() => 0);
  const exactos = montos.map((monto) => (Math.max(monto, 0) / total) * 100);
  const enteros = exactos.map((valor) => Math.floor(valor));
  const objetivo = Math.round(exactos.reduce((suma, valor) => suma + valor, 0));
  let faltan = objetivo - enteros.reduce((suma, valor) => suma + valor, 0);
  // El resto, redondeado: 4/6 y 1/6 tienen el mismo resto (0,666…) pero la coma flotante los deja distintos en el
  // decimal 15, y el empate tiene que decidirse por el orden, no por ese ruido.
  const porResto = exactos
    .map((valor, indice) => ({ indice, resto: Math.round((valor - Math.floor(valor)) * 1e9) }))
    .sort((a, b) => b.resto - a.resto || a.indice - b.indice);
  for (const { indice } of porResto) {
    if (faltan <= 0) break;
    enteros[indice]! += 1;
    faltan -= 1;
  }
  return enteros;
}

/** Una fila de un desglose, lista para dibujar su barra. */
export interface EntradaDeBarra {
  /** Única dentro del desglose (key de React). */
  clave: string;
  etiqueta: string;
  monto: number;
  /** Cantidad de gastos. */
  cantidad: number;
}

export interface FilaDeBarra extends EntradaDeBarra {
  /** % entero del total (ver `porcentajesEnteros`). */
  porcentaje: number;
  /** Ancho de la barra: % EXACTO del total, entre 0 y 100. */
  ancho: number;
}

/** Las filas de un desglose con su porcentaje y el ancho de su barra, en el mismo orden. */
export function filasDeBarras(entradas: readonly EntradaDeBarra[], total: number): FilaDeBarra[] {
  const porcentajes = porcentajesEnteros(
    entradas.map((entrada) => entrada.monto),
    total,
  );
  return entradas.map((entrada, indice) => ({
    ...entrada,
    porcentaje: porcentajes[indice]!,
    ancho: total > 0 ? Math.min(Math.max((entrada.monto / total) * 100, 0), 100) : 0,
  }));
}

/** Clave de la fila "Otras" (las de las categorías son uuid: no choca). */
export const CLAVE_OTRAS = 'otras';

/**
 * Las `max` filas de mayor monto y, si quedan 2 o más, una fila más con la suma del resto (`etiquetaOtras(cuántas)`).
 * Si queda UNA sola afuera se muestra tal cual: una "Otras" de una sola fila escondería su nombre sin ahorrar lugar.
 * Ordena de mayor a menor monto (estable: a igual monto, el orden en que vinieron).
 */
export function principalesYOtras(
  entradas: readonly EntradaDeBarra[],
  max: number,
  etiquetaOtras: (cuantas: number) => string,
): EntradaDeBarra[] {
  const ordenadas = [...entradas].sort((a, b) => b.monto - a.monto);
  if (ordenadas.length <= max + 1) return ordenadas;
  const resto = ordenadas.slice(max);
  return [
    ...ordenadas.slice(0, max),
    {
      clave: CLAVE_OTRAS,
      etiqueta: etiquetaOtras(resto.length),
      monto: aCentavos(resto.reduce((suma, entrada) => suma + entrada.monto, 0)),
      cantidad: resto.reduce((suma, entrada) => suma + entrada.cantidad, 0),
    },
  ];
}

// ---------------------------------------------------------------------------
// Vista Año
// ---------------------------------------------------------------------------

/** El gasto promedio por mes: total / meses (a centavos). null con 0 meses (un año que todavía no empezó: no hay promedio). */
export function promedioPorMes(total: number, meses: number): number | null {
  return meses > 0 ? aCentavos(total / meses) : null;
}

/** Un mes de la lista "Gasto por mes". */
export interface GastoDeUnMes {
  /** 'YYYY-MM-01' (el `mes` de la fila de `resumen_mensual`). */
  mes: string;
  monto: number;
  cantidad: number;
  /** Ancho de la barra: % del MES DE MAYOR GASTO del año (ese mide 100), entre 0 y 100. */
  ancho: number;
}

/**
 * Los meses del año que ya empezaron (`meses`, ver `mesesTranscurridos`: los futuros vienen en 0 y no aportan), cada uno
 * con su gasto y el ancho de su barra RELATIVO AL MES DE MAYOR GASTO (no al total del año: así las diferencias entre meses
 * se ven). Las filas vienen de `resumen_mensual` en orden desde enero (el parse lo garantiza).
 */
export function gastoPorMes(filas: readonly Pick<ResumenDelMes, 'mes' | 'gastosMonto' | 'gastosCantidad'>[], meses: number): GastoDeUnMes[] {
  const transcurridos = mesesYaTranscurridos(filas, meses);
  const maximo = transcurridos.reduce((mayor, fila) => Math.max(mayor, fila.gastosMonto), 0);
  return transcurridos.map((fila) => ({
    mes: fila.mes,
    monto: fila.gastosMonto,
    cantidad: fila.gastosCantidad,
    ancho: maximo > 0 ? Math.min(Math.max((fila.gastosMonto / maximo) * 100, 0), 100) : 0,
  }));
}

/**
 * Los meses del año que ya empezaron (`meses`, ver `mesesTranscurridos`): los primeros `meses` de la serie de
 * `resumen_mensual`, que viene en orden desde enero. Los futuros vienen en 0 y no se muestran.
 */
export function mesesYaTranscurridos<T>(filas: readonly T[], meses: number): T[] {
  return filas.slice(0, Math.max(0, meses));
}

/** Los totales del año, sumando sus filas de `resumen_mensual`. */
export interface TotalesDelAnio {
  ingresos: number;
  gastos: number;
  viajesCantidad: number;
  viajesKm: number;
  viajesConIngreso: number;
  viajesSinIngreso: number;
  /**
   * Ingresos − gastos del año, SOLO si al menos un viaje del año tiene ingreso cargado (un ingreso 0 cuenta como cargado);
   * si no, null (como el `resultado` de un mes): sin ingresos, "resultado" serían solo los gastos con signo menos.
   */
  resultado: number | null;
}

export function totalesDelAnio(filas: readonly ResumenDelMes[]): TotalesDelAnio {
  const suma = (valor: (fila: ResumenDelMes) => number) => aCentavos(filas.reduce((total, fila) => total + valor(fila), 0));
  const ingresos = suma((fila) => fila.viajesIngreso);
  const gastos = suma((fila) => fila.gastosMonto);
  const viajesConIngreso = suma((fila) => fila.viajesConIngreso);
  return {
    ingresos,
    gastos,
    viajesCantidad: suma((fila) => fila.viajesCantidad),
    viajesKm: suma((fila) => fila.viajesKm),
    viajesConIngreso,
    viajesSinIngreso: suma((fila) => fila.viajesSinIngreso),
    resultado: viajesConIngreso > 0 ? aCentavos(ingresos - gastos) : null,
  };
}
