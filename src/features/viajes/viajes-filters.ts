import {
  compareMonths,
  currentMonth,
  formatMesParam,
  monthRange,
  parseMesParam,
  type MonthRange,
  type YearMonth,
} from '@/lib/dates';

/**
 * Filtro de la lista de viajes (el mes) y su paso por la URL (`/viajes?mes=2026-08`). Lógica pura.
 *
 * Todo lo que viene de la URL es entrada del usuario: se valida y, si no sirve, se IGNORA y se usa el
 * valor por defecto (el mes actual). Nada de esto va a SQL armado a mano: el mes se convierte a un rango
 * de fechas. Mismas reglas que Gastos (`parseMesParam` vive en `src/lib/dates.ts`): de enero de 2000 al
 * mes actual (la fecha de un viaje no puede ser futura, igual que la de un gasto).
 */

export interface ViajesFiltro {
  mes: YearMonth;
}

/** Lee el filtro de los search params, con el mes actual si falta o es inválido. */
export function readFiltro(params: URLSearchParams, now: Date = new Date()): ViajesFiltro {
  return { mes: parseMesParam(params.get('mes'), now) ?? currentMonth(now) };
}

/** Search params para un filtro. El mes actual (el valor por defecto) no se escribe: `/viajes` sigue siendo "este mes". */
export function filtroToParams(filtro: ViajesFiltro, now: Date = new Date()): URLSearchParams {
  const params = new URLSearchParams();
  if (compareMonths(filtro.mes, currentMonth(now)) !== 0) params.set('mes', formatMesParam(filtro.mes));
  return params;
}

/** '' o '?mes=...' (con el `?`), para armar enlaces. */
export function filtroToSearch(filtro: ViajesFiltro, now: Date = new Date()): string {
  const text = filtroToParams(filtro, now).toString();
  return text ? `?${text}` : '';
}

/** Rango del mes para filtrar con `gte('fecha', desde)` y `lt('fecha', hasta)`. Fechas locales, sin UTC. */
export function rangoDelFiltro(filtro: ViajesFiltro): MonthRange {
  return monthRange(filtro.mes.year, filtro.mes.month);
}

/**
 * `search` para volver a la lista (viaja en `location.state`): solo se acepta lo que `filtroToSearch`
 * podría haber escrito. Cualquier otra cosa se ignora: el estado de navegación no es de confianza.
 */
export function sanitizeVolver(raw: unknown, now: Date = new Date()): string {
  if (typeof raw !== 'string' || raw === '') return '';
  const params = new URLSearchParams(raw.startsWith('?') ? raw.slice(1) : raw);
  return filtroToSearch(readFiltro(params, now), now);
}

/** Enlace a la lista en el mes de una fecha 'YYYY-MM-DD': para mostrar el viaje recién guardado aunque
 *  sea de otro mes. '' si la fecha es del mes actual o no es válida. */
export function searchDelMesDeFecha(fecha: string, now: Date = new Date()): string {
  const mes = parseMesParam(fecha.slice(0, 7), now);
  return mes ? filtroToSearch({ mes }, now) : '';
}
