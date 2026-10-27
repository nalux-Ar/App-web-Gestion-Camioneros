import { tenantKey } from '@/lib/query-keys';

/**
 * Query keys del Resumen. Todas empiezan con el tenant (`tenantKey`, ver src/lib/query-keys.ts) y cuelgan de
 * `all`: invalidar `resumenKeys.all(tenantId)` (lo hace `invalidarResumen` desde las mutaciones de gastos, viajes y
 * camiones) marca viejos todos los bloques de todos los períodos. Una key por función de la 014, con los parámetros con
 * que se llamó (las fechas son 'YYYY-MM-DD', con `hasta` INCLUSIVO).
 *
 * Este archivo solo importa `query-keys`: lo importan las mutaciones de otras pantallas y no tiene que arrastrar nada más.
 */
export const resumenKeys = {
  all: (tenantId: string) => tenantKey(tenantId, 'resumen'),
  gastos: (tenantId: string, desde: string, hasta: string) => tenantKey(tenantId, 'resumen', 'gastos', desde, hasta),
  mensual: (tenantId: string, mesDesde: string, meses: number) => tenantKey(tenantId, 'resumen', 'mensual', mesDesde, meses),
  combustible: (tenantId: string, desde: string, hasta: string, camionId: string | null) =>
    tenantKey(tenantId, 'resumen', 'combustible', desde, hasta, camionId ?? 'todos'),
  gastosVarios: (tenantId: string, desde: string, hasta: string) => tenantKey(tenantId, 'resumen', 'gastos-varios', desde, hasta),
  viajes: (tenantId: string, desde: string, hasta: string) => tenantKey(tenantId, 'resumen', 'viajes', desde, hasta),
};
