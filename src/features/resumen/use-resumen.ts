import { useQuery } from '@tanstack/react-query';

import { useTenantId } from '@/features/member/use-tenant-id';
import { todayLocal, type YearMonth } from '@/lib/dates';
import { RESUMEN_STALE_TIME_MS } from './constants';
import { fetchResumenCombustible, fetchResumenGastos, fetchResumenMensual, fetchResumenViajes } from './resumen-api';
import { primerDiaDelMes, rangoDeComparacion, rangoDelAnio, rangoDelMes, type RangoInclusivo } from './resumen-fechas';
import { resumenKeys } from './resumen-keys';

/**
 * Queries del Resumen: UNA por llamada a una función de la 014, cada una con su propio estado de carga y de error. Así
 * un bloque que falla (o que tarda) no deja la pantalla en blanco: los demás se muestran igual, y cada uno tiene su
 * "Reintentar" (`refetch` de su query).
 *
 * Cada key lleva el tenant y los parámetros (`resumenKeys`), y cada `queryFn` pasa la `signal` de TanStack. Reintentos:
 * los globales (solo errores de servidor, src/lib/query-client.ts). `staleTime` de 1 minuto: lo que cambia desde esta
 * app lo invalidan las mutaciones (`invalidarResumen`).
 */

export interface OpcionesQuery {
  enabled?: boolean;
}

/** `resumen_gastos` de un período. */
export function useResumenGastos(rango: RangoInclusivo, { enabled = true }: OpcionesQuery = {}) {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: resumenKeys.gastos(tenantId, rango.desde, rango.hasta),
    queryFn: ({ signal }) => fetchResumenGastos(rango, signal),
    enabled,
    staleTime: RESUMEN_STALE_TIME_MS,
  });
}

/** `resumen_mensual`: `meses` meses desde `mesDesde`. */
export function useResumenMensual(mesDesde: YearMonth, meses: number, { enabled = true }: OpcionesQuery = {}) {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: resumenKeys.mensual(tenantId, primerDiaDelMes(mesDesde), meses),
    queryFn: ({ signal }) => fetchResumenMensual(mesDesde, meses, signal),
    enabled,
    staleTime: RESUMEN_STALE_TIME_MS,
  });
}

/** `resumen_combustible` de un período (todos los camiones, o uno). */
export function useResumenCombustible(rango: RangoInclusivo, camionId: string | null = null, { enabled = true }: OpcionesQuery = {}) {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: resumenKeys.combustible(tenantId, rango.desde, rango.hasta, camionId),
    queryFn: ({ signal }) => fetchResumenCombustible(rango, camionId, signal),
    enabled,
    staleTime: RESUMEN_STALE_TIME_MS,
  });
}

/** `resumen_viajes` de un período (hasta 62 días). */
export function useResumenViajes(rango: RangoInclusivo, { enabled = true }: OpcionesQuery = {}) {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: resumenKeys.viajes(tenantId, rango.desde, rango.hasta),
    queryFn: ({ signal }) => fetchResumenViajes(rango, signal),
    enabled,
    staleTime: RESUMEN_STALE_TIME_MS,
  });
}

/**
 * Todo lo de la vista Mes, cada bloque por separado:
 *  - `gastos`: el gasto del mes (completo, del 1 al último día);
 *  - `comparacion`: el gasto del rango con que se compara (`rangoDeComparacion`: los mismos días del mes anterior si es el
 *    mes en curso, o el mes anterior completo);
 *  - `mensual`: la fila del mes de `resumen_mensual` (viajes, ingresos y resultado del mes);
 *  - `combustible` y `viajes`: los del mes.
 * `hoy` ('YYYY-MM-DD' local) decide si el mes está en curso; por defecto, el del reloj del dispositivo.
 */
export function useResumenDelMes(mes: YearMonth, hoy: string = todayLocal()) {
  const rangos = { mes: rangoDelMes(mes), comparacion: rangoDeComparacion(mes, hoy) };
  return {
    rangos,
    gastos: useResumenGastos(rangos.mes),
    comparacion: useResumenGastos(rangos.comparacion),
    mensual: useResumenMensual(mes, 1),
    combustible: useResumenCombustible(rangos.mes),
    viajes: useResumenViajes(rangos.mes),
  };
}

/**
 * Todo lo de la vista Año, cada bloque por separado: el gasto y el combustible del año entero y la serie de 12 meses
 * (de enero a diciembre; los meses que todavía no llegaron vienen en 0). No hay lista de viajes: la base la limita a 62 días.
 */
export function useResumenDelAnio(anio: number) {
  const rango = rangoDelAnio(anio);
  return {
    rango,
    gastos: useResumenGastos(rango),
    mensual: useResumenMensual({ year: anio, month: 1 }, 12),
    combustible: useResumenCombustible(rango),
  };
}
