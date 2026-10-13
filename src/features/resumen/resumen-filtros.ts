import { MIN_YEAR, compareMonths, currentMonth, formatMesParam, parseMesParam, type YearMonth } from '@/lib/dates';

/**
 * Filtro de la pantalla Resumen (la vista y el período) y su paso por la URL: `/resumen` (el mes actual),
 * `/resumen?mes=2026-08` (un mes) y `/resumen?vista=anio&anio=2025` (un año). Lógica pura.
 *
 * Todo lo que viene de la URL es entrada del usuario: se valida contra una lista blanca y, si no sirve, se IGNORA y se usa
 * el valor por defecto (la vista Mes, el mes actual, el año actual). Nada de esto va a SQL armado a mano: el período se
 * convierte a fechas que viajan como parámetros de las funciones de la 014. Mismas reglas de mes que Viajes y Gastos
 * (`parseMesParam`): de enero de 2000 al mes actual. El año, igual: de 2000 al año actual (el futuro no tiene registros).
 *
 * Solo cuenta el parámetro de la vista elegida: en la vista Mes se ignora `anio`, y en la vista Año se ignora `mes`.
 */

/** Las vistas de la pantalla. Lista blanca: cualquier otro valor de `?vista=` se ignora. */
export const VISTAS_RESUMEN = ['mes', 'anio'] as const;
export type VistaResumen = (typeof VISTAS_RESUMEN)[number];

/** La vista por defecto: no se escribe en la URL (`/resumen` es "el mes actual"). */
const VISTA_POR_DEFECTO: VistaResumen = 'mes';

export type ResumenFiltro = { vista: 'mes'; mes: YearMonth } | { vista: 'anio'; anio: number };

const ANIO_PATTERN = /^\d{4}$/;

/** Busca el valor en la lista blanca (no por clave de objeto: `'toString'` no pasa); inválido -> la vista por defecto. */
function parseVista(raw: string | null): VistaResumen {
  return VISTAS_RESUMEN.find((permitida) => permitida === raw) ?? VISTA_POR_DEFECTO;
}

/** 'YYYY' → año, o null si no son exactamente 4 dígitos ASCII entre 2000 (`MIN_YEAR`) y el año actual. */
export function parseAnioParam(raw: string | null | undefined, now: Date = new Date()): number | null {
  if (typeof raw !== 'string' || !ANIO_PATTERN.test(raw)) return null;
  const anio = Number(raw);
  if (anio < MIN_YEAR || anio > now.getFullYear()) return null;
  return anio;
}

/** Lee el filtro de los search params: la vista Mes y el mes actual si falta o es inválido. */
export function readResumenFiltro(params: URLSearchParams, now: Date = new Date()): ResumenFiltro {
  if (parseVista(params.get('vista')) === 'anio') {
    return { vista: 'anio', anio: parseAnioParam(params.get('anio'), now) ?? now.getFullYear() };
  }
  return { vista: 'mes', mes: parseMesParam(params.get('mes'), now) ?? currentMonth(now) };
}

/**
 * Search params para un filtro. Lo que es el valor por defecto no se escribe (la vista Mes, el mes actual, el año actual):
 * `/resumen` sigue siendo "este mes". La vista va primero: `?vista=anio&anio=2025`.
 */
export function resumenFiltroToParams(filtro: ResumenFiltro, now: Date = new Date()): URLSearchParams {
  const params = new URLSearchParams();
  if (filtro.vista === 'anio') {
    params.set('vista', 'anio');
    if (filtro.anio !== now.getFullYear()) params.set('anio', String(filtro.anio));
    return params;
  }
  if (compareMonths(filtro.mes, currentMonth(now)) !== 0) params.set('mes', formatMesParam(filtro.mes));
  return params;
}

/** '' o '?mes=...' / '?vista=anio&anio=...' (con el `?`), para armar enlaces. */
export function resumenFiltroToSearch(filtro: ResumenFiltro, now: Date = new Date()): string {
  const text = resumenFiltroToParams(filtro, now).toString();
  return text ? `?${text}` : '';
}

/**
 * El filtro al cambiar de vista, conservando el período que se estaba mirando: de un mes al año de ese mes; de un año al
 * mes actual si es el año en curso, o a diciembre si es un año pasado (el último mes de ese año).
 */
export function filtroEnVista(filtro: ResumenFiltro, vista: VistaResumen, now: Date = new Date()): ResumenFiltro {
  if (filtro.vista === vista) return filtro;
  if (vista === 'anio') return { vista: 'anio', anio: filtro.vista === 'mes' ? filtro.mes.year : now.getFullYear() };
  const anio = filtro.vista === 'anio' ? filtro.anio : now.getFullYear();
  return { vista: 'mes', mes: anio === now.getFullYear() ? currentMonth(now) : { year: anio, month: 12 } };
}
