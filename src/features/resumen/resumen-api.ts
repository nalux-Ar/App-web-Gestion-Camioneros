import { unwrap } from '@/lib/db';
import { supabase } from '@/lib/supabase';
import { isUuid } from '@/lib/uuid';
import type { YearMonth } from '@/lib/dates';
import { MAX_DIAS_PERIODO, MAX_DIAS_VIAJES, MAX_MESES } from './constants';
import { diferenciaEnDias, primerDiaDelMes, type RangoInclusivo } from './resumen-fechas';
import {
  parseResumenCombustible,
  parseResumenGastos,
  parseResumenGastosVarios,
  parseResumenMensual,
  parseResumenViajes,
  type CombustibleDelCamion,
  type ResumenDelMes,
  type ResumenGastos,
  type ResumenGastosVarios,
  type ResumenViajes,
} from './resumen-parse';
import { ResumenParametrosInvalidosError } from './resumen-textos';

/**
 * Acceso a datos del Resumen: un wrapper por función de la migración 014. Reglas (src/lib/db.ts):
 *  - Son LECTURAS: se cortan con la `signal` que pasa TanStack (salir de la pantalla o cerrar sesión cancela el pedido de
 *    verdad), sin el timeout de escritura.
 *  - `unwrap()`: un error de la base llega como `DataRequestError` (con el SQLSTATE); el mensaje para mostrar lo arma
 *    `mensajeErrorResumen` (`mapDataError` con `RESUMEN_ERROR_CONTEXT`).
 *  - Lo que devuelve la base entra como `unknown` y pasa por el parse (`resumen-parse.ts`): los tipos generados mienten
 *    en los nulos.
 *  - Los períodos se controlan ANTES de llamar con los mismos topes que la base (22023): la pantalla nunca debería
 *    mandar uno inválido, y si pasara, no se hace el pedido (`ResumenParametrosInvalidosError`).
 *  - Ningún parámetro es del tenant: la base filtra por la cuenta de la sesión (RLS + `get_mi_transportista_id()`).
 */

/** desde y hasta válidos, desde <= hasta y `hasta - desde` <= `maxDias` (como `p_hasta - p_desde` en la base). */
function controlarRango(rpc: string, rango: RangoInclusivo, maxDias: number): void {
  const dias = diferenciaEnDias(rango);
  if (dias === null) throw new ResumenParametrosInvalidosError(rpc, 'fechas inválidas');
  if (dias < 0) throw new ResumenParametrosInvalidosError(rpc, 'desde es posterior a hasta');
  if (dias > maxDias) throw new ResumenParametrosInvalidosError(rpc, `más de ${maxDias} días`);
}

/** `resumen_gastos`: el gasto del período (fecha del gasto, `hasta` inclusivo, hasta 366 días), desglosado. */
export async function fetchResumenGastos(rango: RangoInclusivo, signal: AbortSignal): Promise<ResumenGastos> {
  controlarRango('resumen_gastos', rango, MAX_DIAS_PERIODO);
  const datos: unknown = unwrap(
    await supabase.rpc('resumen_gastos', { p_desde: rango.desde, p_hasta: rango.hasta }).abortSignal(signal),
  );
  return parseResumenGastos(datos);
}

/**
 * `resumen_gastos_varios` (migración 018): el detalle (fecha, descripción y monto) de los gastos de la categoría "Gastos
 * varios" del período, hasta 30 y con el total. Mismo período y mismo tope de días que `resumen_gastos`.
 */
export async function fetchResumenGastosVarios(rango: RangoInclusivo, signal: AbortSignal): Promise<ResumenGastosVarios> {
  controlarRango('resumen_gastos_varios', rango, MAX_DIAS_PERIODO);
  const datos: unknown = unwrap(
    await supabase.rpc('resumen_gastos_varios', { p_desde: rango.desde, p_hasta: rango.hasta }).abortSignal(signal),
  );
  return parseResumenGastosVarios(datos);
}

/** `resumen_mensual`: una fila por mes, `meses` (1 a 24) meses desde `mesDesde`. */
export async function fetchResumenMensual(mesDesde: YearMonth, meses: number, signal: AbortSignal): Promise<ResumenDelMes[]> {
  if (!Number.isInteger(meses) || meses < 1 || meses > MAX_MESES) {
    throw new ResumenParametrosInvalidosError('resumen_mensual', `meses fuera de 1 a ${MAX_MESES}`);
  }
  const datos: unknown = unwrap(
    await supabase.rpc('resumen_mensual', { p_mes_desde: primerDiaDelMes(mesDesde), p_meses: meses }).abortSignal(signal),
  );
  return parseResumenMensual(datos, { mesDesde, meses });
}

/**
 * `resumen_combustible`: combustible y rendimiento por camión del período (hasta 366 días). `camionId` opcional (en la
 * primera versión la pantalla no filtra: se manda null y el parámetro NO viaja, queda en su default de la base).
 */
export async function fetchResumenCombustible(
  rango: RangoInclusivo,
  camionId: string | null,
  signal: AbortSignal,
): Promise<CombustibleDelCamion[]> {
  controlarRango('resumen_combustible', rango, MAX_DIAS_PERIODO);
  if (camionId !== null && !isUuid(camionId)) throw new ResumenParametrosInvalidosError('resumen_combustible', 'camión inválido');
  const datos: unknown = unwrap(
    await supabase
      .rpc('resumen_combustible', {
        p_desde: rango.desde,
        p_hasta: rango.hasta,
        ...(camionId !== null ? { p_camion_id: camionId } : {}),
      })
      .abortSignal(signal),
  );
  return parseResumenCombustible(datos, { camionId });
}

/** `resumen_viajes`: los viajes del período (hasta 62 días) con su ganancia, del más nuevo al más viejo, hasta 500. */
export async function fetchResumenViajes(rango: RangoInclusivo, signal: AbortSignal): Promise<ResumenViajes> {
  controlarRango('resumen_viajes', rango, MAX_DIAS_VIAJES);
  const datos: unknown = unwrap(
    await supabase.rpc('resumen_viajes', { p_desde: rango.desde, p_hasta: rango.hasta }).abortSignal(signal),
  );
  return parseResumenViajes(datos);
}
