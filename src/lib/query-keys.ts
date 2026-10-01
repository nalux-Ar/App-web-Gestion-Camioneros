/**
 * Convención de query keys: SIEMPRE empiezan con el tenant.
 *
 *   ['tenant', <transportista_id>, <recurso>, ...parámetros]
 *
 * Motivo (defensa en profundidad, ver src/lib/query-client.ts): la caché se
 * vacía al cambiar de usuario o cerrar sesión, pero si una respuesta en vuelo
 * llegara tarde o una key estuviera mal armada, con el tenant adentro los
 * datos de un transportista nunca quedan bajo la key de otro. Tampoco se
 * puede armar una key sin tenant por accidente: `tenantKey` falla si no hay.
 *
 * Uso típico (un archivo de keys por feature):
 *
 *   export const gastosKeys = {
 *     all: (tenantId: string) => tenantKey(tenantId, 'gastos'),
 *     month: (tenantId: string, desde: string) => tenantKey(tenantId, 'gastos', 'mes', desde),
 *   };
 *   // tras crear/editar/borrar:
 *   queryClient.invalidateQueries({ queryKey: gastosKeys.all(tenantId) });
 *
 * El `tenantId` sale de `useTenantId()` (features/member/use-tenant-id.ts).
 * Ojo: el front NO filtra por `transportista_id` en las consultas (no hace
 * falta: RLS lo hace en la base). El tenant va en la KEY, no en el WHERE.
 */
export type TenantQueryKey = readonly ['tenant', string, ...ReadonlyArray<unknown>];

export function tenantKey(tenantId: string, ...parts: ReadonlyArray<unknown>): TenantQueryKey {
  if (!tenantId) {
    throw new Error('tenantKey: falta el transportista_id. Las queries van dentro de una pantalla con miembro cargado.');
  }
  return ['tenant', tenantId, ...parts];
}

/**
 * Hace que TypeScript EXIJA el tenant en toda key de query y de mutación: una
 * `useQuery({ queryKey: ['gastos'] })` (sin `tenantKey`) deja de compilar.
 * Es la barrera para que nadie arme una key compartida entre tenants (ver
 * arriba): no depende de acordarse de la convención.
 */
declare module '@tanstack/react-query' {
  interface Register {
    queryKey: TenantQueryKey;
    mutationKey: TenantQueryKey;
  }
}
