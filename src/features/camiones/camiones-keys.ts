import { tenantKey } from '@/lib/query-keys';

/**
 * Query keys de Camiones. Todas empiezan con el tenant (`tenantKey`, ver src/lib/query-keys.ts).
 *
 * Tras crear, editar, archivar o reactivar un camión se invalida SOLO la lista (`list`): la patente se muestra en todas
 * las pantallas desde esa lista, sin embeds. El detalle de EDICIÓN (`detail`) lo tiene activo la pantalla de edición y se
 * lee una sola vez para inicializar el formulario: no se invalida (mismo criterio que `viajes-keys.ts`). Los conteos
 * (`sinCamion`, `gastosAMover`) se piden frescos cada vez y no cuelgan de la lista.
 */
export const camionesKeys = {
  all: (tenantId: string) => tenantKey(tenantId, 'camiones'),
  /** Todos los camiones del tenant (activos y archivados): la pantalla de Camiones, los selectores y las etiquetas. */
  list: (tenantId: string) => tenantKey(tenantId, 'camiones', 'lista'),
  /** Un camión para editarlo. */
  detail: (tenantId: string, id: string) => tenantKey(tenantId, 'camiones', 'detalle', id),
  /** Cuántos viajes sin camión y cuántos gastos con litros sin camión hay: el aviso antes de cargar el PRIMER camión. */
  sinCamion: (tenantId: string) => tenantKey(tenantId, 'camiones', 'conteo-sin-camion'),
  /** Cuántos gastos con camión de un viaje pasarían a otro camión si el viaje cambia de camión. */
  gastosAMover: (tenantId: string, viajeId: string, camionId: string) =>
    tenantKey(tenantId, 'camiones', 'conteo-gastos-a-mover', viajeId, camionId),
};
