import { addMonths, compareMonths, isValidDateString, type YearMonth } from '@/lib/dates';

/**
 * Fechas de los períodos del Resumen. Lógica PURA y sin zona horaria: todo es aritmética de año/mes/día sobre textos
 * 'YYYY-MM-DD' (nunca `Date`, ni UTC). "Hoy" lo pasa quien llama, sacado de `todayLocal()` (src/lib/dates.ts, hora local
 * del dispositivo): así el mes en curso es el del reloj de la persona y las pruebas no dependen del día en que corren.
 *
 * Los rangos son INCLUSIVOS en los dos extremos (`hasta` incluido), como los `p_hasta` de las funciones de la migración
 * 014. Ojo: es distinto de `monthRange` (src/lib/dates.ts), que da `hasta` = primer día del mes SIGUIENTE para filtrar
 * listas con `.lt('fecha', hasta)`. No mezclarlos.
 */

/** Un período con los dos extremos incluidos, en 'YYYY-MM-DD'. */
export interface RangoInclusivo {
  desde: string;
  hasta: string;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function fechaYmd(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`;
}

/** ¿Año bisiesto? (gregoriano: divisible por 4, salvo los centenarios que no son divisibles por 400). */
export function esBisiesto(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Cantidad de días del mes (28, 29, 30 o 31). */
export function diasDelMes(year: number, month: number): number {
  if (month === 2) return esBisiesto(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** 'YYYY-MM-DD' válido → año, mes y día; cualquier otra cosa → null. */
export function partesDeFecha(fecha: string): { year: number; month: number; day: number } | null {
  if (!isValidDateString(fecha)) return null;
  return { year: Number(fecha.slice(0, 4)), month: Number(fecha.slice(5, 7)), day: Number(fecha.slice(8, 10)) };
}

/** El mes de una fecha 'YYYY-MM-DD' (o null si no es una fecha válida). */
export function mesDeFecha(fecha: string): YearMonth | null {
  const partes = partesDeFecha(fecha);
  return partes ? { year: partes.year, month: partes.month } : null;
}

/** Primer día del mes: 'YYYY-MM-01'. Es también el `p_mes_desde` de `resumen_mensual`. */
export function primerDiaDelMes(mes: YearMonth): string {
  return fechaYmd(mes.year, mes.month, 1);
}

/** Último día del mes (28, 29, 30 o 31 según el mes y el año). */
export function ultimoDiaDelMes(mes: YearMonth): string {
  return fechaYmd(mes.year, mes.month, diasDelMes(mes.year, mes.month));
}

/** El mes completo, del día 1 al último (inclusivo). */
export function rangoDelMes(mes: YearMonth): RangoInclusivo {
  return { desde: primerDiaDelMes(mes), hasta: ultimoDiaDelMes(mes) };
}

/** El año completo, del 1 de enero al 31 de diciembre (inclusivo). */
export function rangoDelAnio(anio: number): RangoInclusivo {
  return { desde: fechaYmd(anio, 1, 1), hasta: fechaYmd(anio, 12, 31) };
}

/** ¿El mes es el de hoy? (`hoy` = 'YYYY-MM-DD' local, de `todayLocal()`). */
export function esMesEnCurso(mes: YearMonth, hoy: string): boolean {
  const mesDeHoy = mesDeFecha(hoy);
  return mesDeHoy !== null && compareMonths(mes, mesDeHoy) === 0;
}

/**
 * Con qué se compara el gasto de un mes (decisión aprobada del 2026-10-12):
 *  - el mes EN CURSO, con los mismos días del mes anterior: del 1 al mismo número de día que hoy, acotado al último día
 *    de ese mes (hoy 31 de marzo → del 1 al 28 de febrero, o al 29 en un año bisiesto; hoy 31 de mayo → del 1 al 30 de
 *    abril). Así no se compara medio mes contra un mes entero.
 *  - un mes CERRADO (cualquier otro), con el mes anterior completo.
 * Enero se compara con diciembre del año anterior. Si `hoy` no es una fecha válida, se toma el mes como cerrado.
 */
export function rangoDeComparacion(mes: YearMonth, hoy: string): RangoInclusivo {
  const anterior = addMonths(mes, -1);
  const partesHoy = partesDeFecha(hoy);
  if (partesHoy === null || !esMesEnCurso(mes, hoy)) return rangoDelMes(anterior);
  const dia = Math.min(partesHoy.day, diasDelMes(anterior.year, anterior.month));
  return { desde: primerDiaDelMes(anterior), hasta: fechaYmd(anterior.year, anterior.month, dia) };
}

/**
 * Cuántos meses del año ya empezaron, según `hoy`: 12 en un año pasado, el número del mes actual en el año en curso
 * (el mes en curso cuenta) y 0 en un año futuro o con `hoy` inválido. Es el divisor del "promedio por mes" de la vista Año.
 */
export function mesesTranscurridos(anio: number, hoy: string): number {
  const partes = partesDeFecha(hoy);
  if (partes === null || anio > partes.year) return 0;
  return anio < partes.year ? 12 : partes.month;
}

/**
 * Días del calendario civil gregoriano desde una fecha fija (algoritmo `days_from_civil`, aritmética entera): sirve para
 * restar fechas sin `Date` ni zona horaria.
 */
function numeroDeDia(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe;
}

/**
 * `hasta - desde` en días, como lo calcula la base (`p_hasta - p_desde`): 0 para un solo día, 30 para el 1 y el 31 de
 * un mes. null si alguna fecha no es válida.
 */
export function diferenciaEnDias(rango: RangoInclusivo): number | null {
  const desde = partesDeFecha(rango.desde);
  const hasta = partesDeFecha(rango.hasta);
  if (desde === null || hasta === null) return null;
  return numeroDeDia(hasta.year, hasta.month, hasta.day) - numeroDeDia(desde.year, desde.month, desde.day);
}

/** Los meses de una serie de `resumen_mensual`: `meses` primeros días consecutivos desde el de `mesDesde`. */
export function mesesDeLaSerie(mesDesde: YearMonth, meses: number): string[] {
  return Array.from({ length: meses }, (_, i) => primerDiaDelMes(addMonths(mesDesde, i)));
}
