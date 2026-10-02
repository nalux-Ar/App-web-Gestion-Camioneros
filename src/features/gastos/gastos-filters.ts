import { compareMonths, currentMonth, monthRange, type MonthRange, type YearMonth } from '@/lib/dates';
import { isUuid } from '@/lib/uuid';
import { MIN_YEAR } from './constants';

/**
 * Filtros de la lista de gastos (mes y categoría) y su paso por la URL
 * (`/gastos?mes=2026-08&categoria=<uuid>`). Lógica pura.
 *
 * Todo lo que viene de la URL es entrada del usuario: se valida y, si no
 * sirve, se IGNORA y se usa el valor por defecto (mes actual, todas las
 * categorías). Nada de esto va a SQL armado a mano: el mes se convierte a un
 * rango de fechas y la categoría es un uuid que va como parámetro.
 */

// `MIN_YEAR` (primer año aceptado en `mes=`) vive en constants.ts: la validación de la fecha del
// formulario usa la misma cota, para que un gasto guardado nunca quede fuera del alcance de la lista.
export { MIN_YEAR };

export interface GastosFiltro {
  mes: YearMonth;
  /** uuid de la categoría, o null = todas. */
  categoriaId: string | null;
}

const MES_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** 'YYYY-MM' → mes, o null si no es un mes válido entre enero de 2000 y el mes actual
 *  (el futuro no tiene gastos: no se puede cargar un gasto con fecha futura). */
export function parseMesParam(raw: string | null | undefined, now: Date = new Date()): YearMonth | null {
  if (typeof raw !== 'string') return null;
  const match = MES_PATTERN.exec(raw);
  if (!match) return null;
  const mes: YearMonth = { year: Number(match[1]), month: Number(match[2]) };
  if (mes.year < MIN_YEAR) return null;
  if (compareMonths(mes, currentMonth(now)) > 0) return null;
  return mes;
}

export function formatMesParam(mes: YearMonth): string {
  return `${String(mes.year).padStart(4, '0')}-${String(mes.month).padStart(2, '0')}`;
}

/** uuid válido, o null (ausente o inválido). */
export function parseCategoriaParam(raw: string | null | undefined): string | null {
  return isUuid(raw) ? raw.toLowerCase() : null;
}

/** Lee el filtro de los search params, con los valores por defecto si faltan o son inválidos. */
export function readFiltro(params: URLSearchParams, now: Date = new Date()): GastosFiltro {
  return {
    mes: parseMesParam(params.get('mes'), now) ?? currentMonth(now),
    categoriaId: parseCategoriaParam(params.get('categoria')),
  };
}

/**
 * Search params para un filtro. Lo que es el valor por defecto no se escribe
 * (el mes actual, "todas"): la URL queda corta y `/gastos` sigue siendo "este mes".
 */
export function filtroToParams(filtro: GastosFiltro, now: Date = new Date()): URLSearchParams {
  const params = new URLSearchParams();
  if (compareMonths(filtro.mes, currentMonth(now)) !== 0) params.set('mes', formatMesParam(filtro.mes));
  if (filtro.categoriaId) params.set('categoria', filtro.categoriaId);
  return params;
}

/** '' o '?mes=...&categoria=...' (con el `?`), para armar enlaces. */
export function filtroToSearch(filtro: GastosFiltro, now: Date = new Date()): string {
  const text = filtroToParams(filtro, now).toString();
  return text ? `?${text}` : '';
}

/** Rango del mes para filtrar con `gte('fecha', desde)` y `lt('fecha', hasta)`. Fechas locales, sin UTC. */
export function rangoDelFiltro(filtro: GastosFiltro): MonthRange {
  return monthRange(filtro.mes.year, filtro.mes.month);
}

/**
 * `search` para volver a la lista (viaja en `location.state`): solo se acepta lo que
 * `filtroToSearch` podría haber escrito. Cualquier otra cosa se ignora: el estado de
 * navegación no es de confianza (un enlace externo no puede fijarlo, pero se valida igual).
 */
export function sanitizeVolver(raw: unknown, now: Date = new Date()): string {
  if (typeof raw !== 'string' || raw === '') return '';
  const params = new URLSearchParams(raw.startsWith('?') ? raw.slice(1) : raw);
  return filtroToSearch(readFiltro(params, now), now);
}

/** Enlace a la lista en el mes de una fecha 'YYYY-MM-DD' (sin filtro de categoría): para mostrar el
 *  gasto recién guardado aunque sea de otro mes. '' si la fecha es del mes actual o no es válida. */
export function searchDelMesDeFecha(fecha: string, now: Date = new Date()): string {
  const mes = parseMesParam(fecha.slice(0, 7), now);
  return mes ? filtroToSearch({ mes, categoriaId: null }, now) : '';
}

