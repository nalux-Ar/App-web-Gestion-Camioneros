import { tenantKey } from '@/lib/query-keys';

/**
 * Query keys de Clientes. Todas empiezan con el tenant (`tenantKey`, ver src/lib/query-keys.ts).
 * Invalidar `all` cubre la lista y todo lo que cuelgue de 'clientes'.
 */
export const clientesKeys = {
  all: (tenantId: string) => tenantKey(tenantId, 'clientes'),
  list: (tenantId: string) => tenantKey(tenantId, 'clientes', 'lista'),
};
