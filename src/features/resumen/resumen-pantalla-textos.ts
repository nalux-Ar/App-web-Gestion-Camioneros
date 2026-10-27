import { addMonths, formatMonthLabel, type YearMonth } from '@/lib/dates';
import { formatNumber } from '@/lib/numbers';
import type { ComparacionDeGasto, FilaDeBarra } from './resumen-calculos';
import { MOTIVOS_DESCARTE, type MotivoDescarte } from './resumen-textos';

/**
 * Textos y formatos de la PANTALLA Resumen (vista Mes). Los de la capa de datos (etiquetas de grupos, "Sin camión",
 * motivos de descarte, errores) están en `resumen-textos.ts`. Español neutro, de "tú", frases cortas pensadas para quien
 * maneja. Los montos van sin símbolo de moneda, como en el resto de la app. Lógica pura: se prueban sueltos.
 */

/** Espacio que no corta línea: "25 %" nunca queda partido en dos renglones. */
const NBSP = '\u00a0';
/** Signo menos tipográfico (no el guion). */
const MENOS = '\u2212';

export const RESUMEN_TITULO = 'Resumen';
export const TITULO_GASTOS = 'Gastos del mes';

/** Sin red, las consultas quedan en pausa hasta que vuelve la señal. */
export const RESUMEN_SIN_CONEXION = 'Sin conexión. Cargaremos el resumen cuando vuelva la señal.';

/** Aviso para lectores de pantalla mientras se piden los bloques de un mes. */
export function textoCargandoResumen(mesLabel: string): string {
  return `Cargando el resumen de ${mesLabel}…`;
}

// ---------------------------------------------------------------------------
// Números
// ---------------------------------------------------------------------------

/** Un monto: siempre con 2 decimales y sin símbolo ("1.234,50"). */
export function formatMonto(valor: number): string {
  return formatNumber(valor, { decimales: 2 });
}

/** Una cantidad entera con separador de miles ("1.234"). */
function formatEntero(valor: number): string {
  return formatNumber(valor, { decimales: 0 });
}

/** "1 gasto" / "3 gastos". */
export function textoCantidadGastos(cantidad: number): string {
  return cantidad === 1 ? '1 gasto' : `${formatEntero(cantidad)} gastos`;
}

// ---------------------------------------------------------------------------
// Gastos del mes y comparación
// ---------------------------------------------------------------------------

/** El nombre de un mes ("septiembre"), con el año solo si es otro que `anioDeReferencia` ("diciembre 2025"). */
export function nombreDeMes(mes: YearMonth, anioDeReferencia: number): string {
  const etiqueta = formatMonthLabel(mes);
  return mes.year === anioDeReferencia ? etiqueta.slice(0, etiqueta.lastIndexOf(' ')) : etiqueta;
}

/**
 * Contra qué se compara el gasto del mes (ver `rangoDeComparacion`): "los mismos días de septiembre" si el mes está en
 * curso, "septiembre" si ya cerró. Enero se compara con "diciembre 2025".
 */
export function periodoDeComparacion(mes: YearMonth, enCurso: boolean): string {
  const nombre = nombreDeMes(addMonths(mes, -1), mes.year);
  return enCurso ? `los mismos días de ${nombre}` : nombre;
}

/** "2.000,00 más (+25 %)", "2.000,00 menos (−25 %)", "Lo mismo". Menos de 1 % de diferencia se dice así. */
export function textoDiferencia(comparacion: ComparacionDeGasto): string {
  if (comparacion.sentido === 'igual') return 'Lo mismo';
  const monto = `${formatMonto(comparacion.diferencia)} ${comparacion.sentido === 'mas' ? 'más' : 'menos'}`;
  if (comparacion.porcentaje === null) return monto;
  const porcentaje =
    comparacion.porcentaje === 0
      ? `menos de 1${NBSP}%`
      : `${comparacion.sentido === 'mas' ? '+' : MENOS}${formatEntero(comparacion.porcentaje)}${NBSP}%`;
  return `${monto} (${porcentaje})`;
}

/** "vs. los mismos días de septiembre (8.000,00)". */
export function textoVs(periodo: string, montoAnterior: number): string {
  return `vs. ${periodo} (${formatMonto(montoAnterior)})`;
}

/** El período con que se compara no tuvo gastos: no hay porcentaje posible. */
export function textoSinGastosParaComparar(periodo: string): string {
  return `Sin gastos en ${periodo} para comparar`;
}

/** Antes del mensaje de error de la comparación (el total del mes sí se ve). */
export function textoErrorComparacion(periodo: string): string {
  return `No pudimos comparar con ${periodo}.`;
}

/** El mes no tiene gastos. */
export function textoSinGastosDelMes(mes: YearMonth, enCurso: boolean): string {
  return enCurso ? 'Todavía no cargaste gastos este mes' : `No cargaste gastos en ${formatMonthLabel(mes)}`;
}

// ---------------------------------------------------------------------------
// Barras de los desgloses
// ---------------------------------------------------------------------------

/** El % de un desglose sobre el total: "70 %"; un monto chico que redondea a 0 dice "menos de 1 %" (no "0 %"). */
export function textoPorcentaje(porcentaje: number, monto: number): string {
  return porcentaje === 0 && monto > 0 ? `menos de 1${NBSP}%` : `${formatEntero(porcentaje)}${NBSP}%`;
}

/** "Otras (3 categorías)": la suma de las categorías que no entran entre las principales. */
export function textoOtrasCategorias(cuantas: number): string {
  return `Otras (${cuantas} categorías)`;
}

/** Debajo de cada barra: "3 gastos · 70 % del total". */
export function textoDetalleBarra(fila: Pick<FilaDeBarra, 'cantidad' | 'porcentaje' | 'monto'>): string {
  return `${textoCantidadGastos(fila.cantidad)} · ${textoPorcentaje(fila.porcentaje, fila.monto)} del total`;
}

// ---------------------------------------------------------------------------
// Detalle de "Gastos varios" (vista Mes)
// ---------------------------------------------------------------------------

/** Nombre de la lista de gastos varios (para lectores de pantalla) y su título cuando la categoría quedó dentro de "Otras". */
export const ETIQUETA_DETALLE_GASTOS_VARIOS = 'Detalle de Gastos varios';
/** El gasto no tiene descripción cargada. */
export const SIN_DESCRIPCION = 'Sin descripción';

/** Antes del mensaje de error cuando no se pudo traer el detalle (lo demás del resumen se sigue viendo). */
export const TEXTO_ERROR_DETALLE_GASTOS_VARIOS = 'No pudimos cargar el detalle de Gastos varios.';

/** La descripción de un gasto: la que tenga, con "…" si la base la cortó; null si no tiene (se dice con `SIN_DESCRIPCION`). */
export function textoDescripcionGasto(descripcion: string | null, truncada: boolean): string | null {
  if (descripcion === null || descripcion.trim() === '') return null;
  return truncada ? `${descripcion}…` : descripcion;
}

/** Cuando la lista se cortó: "y 12 más en Gastos" (`faltan` = total − mostrados). */
export function textoYMasEnGastos(faltan: number): string {
  return `y ${formatEntero(faltan)} más en Gastos`;
}

// ---------------------------------------------------------------------------
// Ingresos y resultado
// ---------------------------------------------------------------------------

export const TITULO_RESULTADO = 'Ingresos y resultado';
export const ETIQUETA_INGRESOS = 'Ingresos de viajes';
export const ETIQUETA_GASTOS_DEL_MES = 'Gastos del mes';
/** Qué es el resultado (lo calcula la base: `resumen_mensual.resultado`). */
export const TEXTO_COMO_SE_CALCULA_RESULTADO = 'El resultado es lo que cobraste por los viajes del mes menos todos los gastos del mes.';
export const TEXTO_VER_VIAJES_DEL_MES = 'Ver los viajes del mes';

/** "1 viaje" / "3 viajes". */
export function textoCantidadViajes(cantidad: number): string {
  return cantidad === 1 ? '1 viaje' : `${formatEntero(cantidad)} viajes`;
}

/** Debajo de los ingresos: "3 viajes con ingreso" o, si no todos lo tienen, "2 de 3 viajes con ingreso". */
export function textoViajesConIngreso(conIngreso: number, total: number): string {
  return conIngreso === total ? `${textoCantidadViajes(total)} con ingreso` : `${formatEntero(conIngreso)} de ${textoCantidadViajes(total)} con ingreso`;
}

/** El nombre del resultado: una pérdida se dice con la palabra, no solo con el signo o el color. */
export function etiquetaResultado(resultado: number): string {
  if (resultado > 0) return 'Ganancia';
  if (resultado < 0) return 'Pérdida';
  return 'Resultado';
}

/** Sin resultado (ningún viaje del período tiene ingreso): qué falta para tenerlo. `periodo`: el Mes o el Año. */
export function textoSinResultado(viajes: number, periodo: 'mes' | 'año' = 'mes'): string {
  const falta = `para ver si el ${periodo} dio ganancia o pérdida.`;
  if (viajes === 0) return `No hay viajes en el ${periodo}. Carga tus viajes con su ingreso ${falta}`;
  if (viajes === 1) return `Tu viaje del ${periodo} no tiene el ingreso cargado. Cárgalo ${falta}`;
  return `Ninguno de tus ${formatEntero(viajes)} viajes del ${periodo} tiene el ingreso cargado. Cárgalo ${falta}`;
}

/** Hay resultado, pero algunos viajes no tienen ingreso: puede faltar plata. */
export function textoViajesSinIngreso(cantidad: number): string {
  return `${textoCantidadViajes(cantidad)} sin ingreso cargado: el resultado puede estar incompleto.`;
}

// ---------------------------------------------------------------------------
// Combustible por camión
// ---------------------------------------------------------------------------

export const TITULO_COMBUSTIBLE = 'Combustible por camión';
export const ETIQUETAS_COMBUSTIBLE = {
  cargas: 'Cargas',
  litros: 'Litros',
  gasto: 'Gasto',
  precio: 'Precio promedio',
  rendimiento: 'Rendimiento',
  consumo: 'Consumo',
  costoPorKm: 'Costo por km',
} as const;
export const TEXTO_SIN_RENDIMIENTO = 'Todavía no hay rendimiento para este camión: carga el odómetro en cargas con tanque lleno';

/**
 * Un número con entre `min` y `max` decimales: los que tenga, redondeado a `max`, pero nunca menos de `min`
 * (3 → "3,0"; 2,849 → "2,85" con 1–2).
 */
export function formatDecimales(valor: number, min: number, max: number): string {
  const factor = 10 ** max;
  const redondeado = Math.round(valor * factor) / factor;
  const decimales = String(redondeado).split('.')[1]?.length ?? 0;
  return decimales < min ? formatNumber(valor, { decimales: min }) : formatNumber(valor, { decimales: max, fijos: false });
}

/** Litros: 1 a 3 decimales ("300,5 L", "40,125 L", "300,0 L"). */
export function textoLitros(litros: number): string {
  return `${formatDecimales(litros, 1, 3)} L`;
}

/** Km: hasta 1 decimal ("900 km", "1.234,5 km"). */
export function textoKm(km: number): string {
  return `${formatNumber(km, { decimales: 1, fijos: false })} km`;
}

/** Rendimiento: 1 a 2 decimales ("3,0 km/L", "2,85 km/L"). */
export function textoKmPorLitro(kmPorLitro: number): string {
  return `${formatDecimales(kmPorLitro, 1, 2)} km/L`;
}

/** Consumo: 1 decimal ("33,3 L/100 km"). */
export function textoLitrosCada100(litros100km: number): string {
  return `${formatNumber(litros100km, { decimales: 1 })} L/100 km`;
}

/** "23,29 por litro". */
export function textoPrecioPorLitro(precio: number): string {
  return `${formatMonto(precio)} por litro`;
}

/** "1 carga" / "3 cargas". */
export function textoCantidadCargas(cantidad: number): string {
  return cantidad === 1 ? '1 carga' : `${formatEntero(cantidad)} cargas`;
}

/** "El odómetro bajó…" → "el odómetro bajó…" (va después de dos puntos), sin el punto final. */
function motivoEnFrase(motivo: string): string {
  const sinPunto = motivo.replace(/\.$/, '');
  return sinPunto.charAt(0).toLowerCase() + sinPunto.slice(1);
}

/**
 * UNA línea con los tramos usados y los descartados, con el motivo de cada descarte (`MOTIVOS_DESCARTE`; si hay más de
 * un motivo, cuántos por cada uno). null si no hay ni tramos ni descartes.
 *   "2 tramos usados (900 km, 300,0 L), ninguno descartado."
 *   "1 tramo usado (450 km, 150,0 L), 1 descartado: el odómetro bajó respecto de la carga llena anterior."
 *   "Ningún tramo usado, 3 descartados: el odómetro bajó… (2); dio menos de 0,5… (1)."
 */
export function textoTramos(
  tramos: { usados: number; km: number | null; litros: number | null },
  descartados: Readonly<Record<MotivoDescarte, number>>,
): string | null {
  const motivos = (Object.keys(MOTIVOS_DESCARTE) as MotivoDescarte[]).filter((motivo) => descartados[motivo] > 0);
  const totalDescartados = motivos.reduce((suma, motivo) => suma + descartados[motivo], 0);
  if (tramos.usados === 0 && totalDescartados === 0) return null;

  const detalle = tramos.km !== null && tramos.litros !== null ? ` (${textoKm(tramos.km)}, ${textoLitros(tramos.litros)})` : '';
  const usados =
    tramos.usados === 0
      ? 'Ningún tramo usado'
      : `${tramos.usados === 1 ? '1 tramo usado' : `${formatEntero(tramos.usados)} tramos usados`}${detalle}`;
  if (totalDescartados === 0) return `${usados}, ninguno descartado.`;

  const cuantos = totalDescartados === 1 ? '1 descartado' : `${formatEntero(totalDescartados)} descartados`;
  const porque =
    motivos.length === 1
      ? motivoEnFrase(MOTIVOS_DESCARTE[motivos[0]!])
      : motivos.map((motivo) => `${motivoEnFrase(MOTIVOS_DESCARTE[motivo])} (${formatEntero(descartados[motivo])})`).join('; ');
  return `${usados}, ${cuantos}: ${porque}.`;
}

/** El mes sin cargas de combustible. */
export function textoSinCombustible(mes: YearMonth, enCurso: boolean): string {
  return enCurso ? 'Todavía no cargaste combustible este mes' : `No cargaste combustible en ${formatMonthLabel(mes)}`;
}

export const TITULO_COMO_SE_CALCULA = '¿Cómo se calcula?';
/** Cómo sale el rendimiento (lo calcula la base, `resumen_combustible`). */
export const PASOS_COMO_SE_CALCULA: readonly string[] = [
  'Se mide de tanque lleno a tanque lleno: cada tramo va de una carga con tanque lleno a la siguiente.',
  'Solo una carga con tanque lleno Y odómetro cierra un tramo. Las cargas parciales del medio suman sus litros a ese tramo.',
  'Cada tramo cuenta en el mes en que se cierra.',
  'Se descartan los tramos en que el odómetro bajó o no avanzó, y los que dan menos de 0,5 o más de 15 km por litro (casi siempre, un odómetro mal escrito).',
  'El rendimiento del mes es ponderado: todos los km de los tramos divididos por todos sus litros (no un promedio de promedios).',
];

// ---------------------------------------------------------------------------
// Viajes del mes
// ---------------------------------------------------------------------------

export const TITULO_VIAJES = 'Viajes del mes';
/** El viaje no tiene ingreso cargado: no hay ganancia que mostrar. */
export const SIN_INGRESO = 'Sin ingreso';

/** El mes sin viajes. */
export function textoSinViajes(mes: YearMonth, enCurso: boolean): string {
  return enCurso ? 'Todavía no hay viajes este mes' : `No hubo viajes en ${formatMonthLabel(mes)}`;
}

/** "Ingreso 15.000,00" (null si no tiene: ya lo dice "Sin ingreso"). */
export function textoIngresoDelViaje(ingreso: number | null): string | null {
  return ingreso === null ? null : `Ingreso ${formatMonto(ingreso)}`;
}

/** Los gastos vinculados al viaje: "Sin gastos" o "2 gastos: 3.000,00". */
export function textoGastosDelViaje(cantidad: number, monto: number): string {
  return cantidad === 0 ? 'Sin gastos' : `${textoCantidadGastos(cantidad)}: ${formatMonto(monto)}`;
}

// ---------------------------------------------------------------------------
// Vistas (Mes | Año) y selector de año
// ---------------------------------------------------------------------------

/** Nombre del `nav` de las dos vistas y el texto de cada enlace. */
export const ETIQUETA_VISTAS = 'Vista del resumen';
export const ETIQUETAS_VISTA = { mes: 'Mes', anio: 'Año' } as const;

/** El selector de año (mismo patrón que el de mes). */
export const ETIQUETA_SELECTOR_ANIO = 'Año';
export const ANIO_ANTERIOR = 'Año anterior';
export const ANIO_SIGUIENTE = 'Año siguiente';

// ---------------------------------------------------------------------------
// Vista Año: gastos del año, promedio y gasto por mes
// ---------------------------------------------------------------------------

export const TITULO_GASTOS_DEL_ANIO = 'Gastos del año';
export const ETIQUETA_PROMEDIO_POR_MES = 'Promedio por mes';
export const TITULO_GASTO_POR_MES = 'Gasto por mes';
/** Un mes del año sin gastos (en la lista de gasto por mes). */
export const SIN_GASTOS = 'Sin gastos';

/** El año no tiene gastos. */
export function textoSinGastosDelAnio(anio: number, enCurso: boolean): string {
  return enCurso ? `Todavía no cargaste gastos en ${anio}` : `No cargaste gastos en ${anio}`;
}

/**
 * Sobre cuántos meses se promedia (ver `mesesTranscurridos`): en el año en curso, los meses que ya empezaron (el actual
 * cuenta); en uno pasado, los 12.
 */
export function textoPromedioDeMeses(meses: number, enCurso: boolean): string {
  if (!enCurso) return `promedio de los ${formatEntero(meses)} meses del año`;
  return meses === 1 ? 'promedio del único mes transcurrido' : `promedio de los ${formatEntero(meses)} meses transcurridos`;
}

/** El nombre del mes, sin el año ("enero"): en la vista Año el año ya está a la vista. */
export function nombreDelMes(mes: YearMonth): string {
  return nombreDeMes(mes, mes.year);
}

// ---------------------------------------------------------------------------
// Vista Año: ingresos, resultado y resultado por mes
// ---------------------------------------------------------------------------

/** Qué es el resultado del año (la suma de los 12 meses de `resumen_mensual`). */
export const TEXTO_COMO_SE_CALCULA_RESULTADO_ANIO = 'El resultado es lo que cobraste por los viajes del año menos todos los gastos del año.';
export const ETIQUETA_VIAJES = 'Viajes';
export const ETIQUETA_KM = 'Km recorridos';
export const TITULO_RESULTADO_POR_MES = 'Resultado por mes';
/** Un mes con viajes pero ninguno con ingreso: no tiene resultado. */
export const SIN_INGRESOS_CARGADOS = 'Sin ingresos cargados';
/** Un mes sin ningún viaje (no faltan ingresos: no hubo viajes). */
export const SIN_VIAJES = 'Sin viajes';
/** En el Año no hay lista de viajes (la base la limita a 62 días). */
export const TEXTO_VIAJES_EN_EL_ANIO = 'La lista de viajes se ve mes a mes: toca un mes o pasa a la vista Mes.';
export const IR_A_LA_VISTA_MES = 'Ir a la vista Mes';

/** Debajo de cada mes de "Resultado por mes": "Ingresos 1.500,00 · Gastos 1.000,00". */
export function textoIngresosYGastos(ingresos: number, gastos: number): string {
  return `Ingresos ${formatMonto(ingresos)} · Gastos ${formatMonto(gastos)}`;
}

/** El año sin cargas de combustible. */
export function textoSinCombustibleDelAnio(anio: number, enCurso: boolean): string {
  return enCurso ? `Todavía no cargaste combustible en ${anio}` : `No cargaste combustible en ${anio}`;
}
