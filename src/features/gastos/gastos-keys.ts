import { tenantKey } from '@/lib/query-keys';

/**
 * Query keys de Gastos. Todas empiezan con el tenant (`tenantKey`, ver
 * src/lib/query-keys.ts). Invalidar `all` cubre la lista, el detalle y todo lo
 * que cuelgue de 'gastos'.
 */
export const gastosKeys = {
  all: (tenantId: string) => tenantKey(tenantId, 'gastos'),
  list: (tenantId: string, desde: string, hasta: string, categoriaId: string | null) =>
    tenantKey(tenantId, 'gastos', 'lista', desde, hasta, categoriaId ?? 'todas'),
  detail: (tenantId: string, id: string) => tenantKey(tenantId, 'gastos', 'detalle', id),
  /** Las categorías no cuelgan de 'gastos': cambian poco y se piden aparte. */
  categorias: (tenantId: string) => tenantKey(tenantId, 'categorias-gasto'),
};
