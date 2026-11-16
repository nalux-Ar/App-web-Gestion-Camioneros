import { tenantKey } from '@/lib/query-keys';

/**
 * Query keys de Gastos. Todas empiezan con el tenant (`tenantKey`, ver
 * src/lib/query-keys.ts). Invalidar `all` cubre la lista, el detalle y todo lo
 * que cuelgue de 'gastos' (incluidos los gastos de un viaje y los gastos sueltos que se pueden sumar a uno).
 */
export const gastosKeys = {
  all: (tenantId: string) => tenantKey(tenantId, 'gastos'),
  list: (tenantId: string, desde: string, hasta: string, categoriaId: string | null) =>
    tenantKey(tenantId, 'gastos', 'lista', desde, hasta, categoriaId ?? 'todas'),
  detail: (tenantId: string, id: string) => tenantKey(tenantId, 'gastos', 'detalle', id),
  /** Los gastos de un viaje (el detalle del viaje). Cuelga de `all`: cualquier alta, edición o borrado de un gasto la invalida. */
  delViaje: (tenantId: string, viajeId: string) => tenantKey(tenantId, 'gastos', 'viaje', viajeId),
  /**
   * Los gastos SIN viaje que ofrece «Sumar gastos que ya cargué» para un viaje, ordenados por cercanía a la fecha del viaje
   * (la fecha va en la key: si el viaje cambia de fecha, el orden y el corte en el tope cambian). Cuelga de `all`: cualquier
   * alta, edición o borrado de un gasto, y sumar o quitar gastos de un viaje, la invalidan.
   */
  sueltos: (tenantId: string, viajeId: string, fechaViaje: string) => tenantKey(tenantId, 'gastos', 'sueltos', viajeId, fechaViaje),
  /** Las categorías no cuelgan de 'gastos': cambian poco y se piden aparte. */
  categorias: (tenantId: string) => tenantKey(tenantId, 'categorias-gasto'),
};
