import { tenantKey } from '@/lib/query-keys';

/**
 * Query keys de Devoluciones. Todas empiezan con el tenant (`tenantKey`, ver src/lib/query-keys.ts).
 *
 * Las listas (las de un viaje y las de un mes) cuelgan de prefijos propios (`viaje`, `mes`): tras guardar o borrar se
 * invalidan ESOS prefijos, NO `all`. El detalle de EDICIÓN (`detail`) lo tiene activo la pantalla de edición y se lee una
 * sola vez para inicializar el formulario: refrescarlo mientras está abierto no sirve y, con señal mala, un refresco
 * fallido era el origen del hallazgo medio de la auditoría de Viajes. `all` cubre todo (se usa cuando se borra un viaje,
 * que se lleva sus devoluciones: ningún formulario de devolución está abierto en ese momento).
 *
 * La lista de un mes (`delMes`, la pestaña Devoluciones de `/viajes`) también la mueven los cambios de un VIAJE: guardarlo
 * puede cambiarle la fecha (y con ella el mes de sus devoluciones) o el recorrido que muestra cada fila. Por eso las
 * mutaciones de viajes invalidan `delosMeses`.
 */
export const devolucionesKeys = {
  all: (tenantId: string) => tenantKey(tenantId, 'devoluciones'),
  /** Todas las listas por viaje (para invalidarlas juntas). */
  delosViajes: (tenantId: string) => tenantKey(tenantId, 'devoluciones', 'viaje'),
  /** Las devoluciones de UN viaje (el detalle del viaje). */
  delViaje: (tenantId: string, viajeId: string) => tenantKey(tenantId, 'devoluciones', 'viaje', viajeId),
  /** Todas las listas por mes (para invalidarlas juntas). */
  delosMeses: (tenantId: string) => tenantKey(tenantId, 'devoluciones', 'mes'),
  /** Las devoluciones de UN mes (el de la fecha de su viaje): la pestaña Devoluciones de `/viajes`. */
  delMes: (tenantId: string, desde: string, hasta: string) => tenantKey(tenantId, 'devoluciones', 'mes', desde, hasta),
  /** Una devolución para editarla: depende del id y del viaje (se pide con los dos). */
  detail: (tenantId: string, id: string, viajeId: string) => tenantKey(tenantId, 'devoluciones', 'detalle', viajeId, id),
};
