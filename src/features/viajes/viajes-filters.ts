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
 * Filtro de la pantalla de Viajes (la pestaña y el mes) y su paso por la URL
 * (`/viajes?vista=devoluciones&mes=2026-08`). Lógica pura.
 *
 * Todo lo que viene de la URL es entrada del usuario: se valida y, si no sirve, se IGNORA y se usa el
 * valor por defecto (la pestaña Viajes, el mes actual). Nada de esto va a SQL armado a mano: el mes se
 * convierte a un rango de fechas. Mismas reglas que Gastos (`parseMesParam` vive en `src/lib/dates.ts`): de
 * enero de 2000 al mes actual (la fecha de un viaje no puede ser futura, igual que la de un gasto).
 *
 * La pestaña viaja en el mismo `search` que el mes, así que `sanitizeVolver` (que pasa todo por
 * `readFiltro` / `filtroToSearch`) la conserva sin lógica aparte: volver a la lista vuelve a la pestaña de la
 * que se salió.
 */

/** Las pestañas de la pantalla. Lista blanca: cualquier otro valor de `?vista=` se ignora. */
export const VISTAS = ['viajes', 'devoluciones'] as const;
export type VistaViajes = (typeof VISTAS)[number];

/** La pestaña por defecto: no se escribe en la URL (`/viajes` sigue siendo "los viajes de este mes"). */
const VISTA_POR_DEFECTO: VistaViajes = 'viajes';

export interface ViajesFiltro {
  mes: YearMonth;
  vista: VistaViajes;
}

/** Busca el valor en la lista blanca (no por clave de objeto: `'toString'` no pasa); inválido -> la pestaña por defecto. */
function parseVista(raw: string | null): VistaViajes {
  return VISTAS.find((permitida) => permitida === raw) ?? VISTA_POR_DEFECTO;
}

/** Lee el filtro de los search params: Viajes y el mes actual si falta o es inválido. */
export function readFiltro(params: URLSearchParams, now: Date = new Date()): ViajesFiltro {
  return { mes: parseMesParam(params.get('mes'), now) ?? currentMonth(now), vista: parseVista(params.get('vista')) };
}

/**
 * Search params para un filtro. Lo que es el valor por defecto no se escribe (la pestaña Viajes, el mes actual).
 * La pestaña va primero: `?vista=devoluciones&mes=2026-08`.
 */
export function filtroToParams(filtro: ViajesFiltro, now: Date = new Date()): URLSearchParams {
  const params = new URLSearchParams();
  if (filtro.vista !== VISTA_POR_DEFECTO) params.set('vista', filtro.vista);
  if (compareMonths(filtro.mes, currentMonth(now)) !== 0) params.set('mes', formatMesParam(filtro.mes));
  return params;
}

/** '' o '?mes=...' / '?vista=...&mes=...' (con el `?`), para armar enlaces. */
export function filtroToSearch(filtro: ViajesFiltro, now: Date = new Date()): string {
  const text = filtroToParams(filtro, now).toString();
  return text ? `?${text}` : '';
}

/** Rango del mes para filtrar con `gte('fecha', desde)` y `lt('fecha', hasta)`. Fechas locales, sin UTC. */
export function rangoDelFiltro(filtro: Pick<ViajesFiltro, 'mes'>): MonthRange {
  return monthRange(filtro.mes.year, filtro.mes.month);
}

/** Lee un `search` ('?mes=...' o sin el `?`) con las mismas reglas que la URL. Lo que no sea texto es un filtro por defecto. */
function filtroDeSearch(raw: unknown, now: Date): ViajesFiltro {
  const texto = typeof raw === 'string' ? raw : '';
  return readFiltro(new URLSearchParams(texto.startsWith('?') ? texto.slice(1) : texto), now);
}

/**
 * `search` para volver a la lista (viaja en `location.state`): solo se acepta lo que `filtroToSearch`
 * podría haber escrito (la pestaña y el mes). Cualquier otra cosa se ignora: el estado de navegación no es de confianza.
 */
export function sanitizeVolver(raw: unknown, now: Date = new Date()): string {
  if (typeof raw !== 'string' || raw === '') return '';
  return filtroToSearch(filtroDeSearch(raw, now), now);
}

/**
 * El `search` de la lista en la pestaña `vista` y con el mes de `raw` (un `volver`, saneado igual que
 * `sanitizeVolver`). La pestaña la decide quien llama, nunca el texto: sirve para volver a una pestaña concreta sin fiarse
 * de lo que traiga el estado de navegación.
 */
export function searchEnVista(raw: unknown, vista: VistaViajes, now: Date = new Date()): string {
  return filtroToSearch({ ...filtroDeSearch(raw, now), vista }, now);
}

/** Enlace a la lista en el mes de una fecha 'YYYY-MM-DD': para mostrar el viaje recién guardado aunque
 *  sea de otro mes. '' si la fecha es del mes actual o no es válida. Siempre en la pestaña Viajes. */
export function searchDelMesDeFecha(fecha: string, now: Date = new Date()): string {
  const mes = parseMesParam(fecha.slice(0, 7), now);
  return mes ? filtroToSearch({ mes, vista: VISTA_POR_DEFECTO }, now) : '';
}
