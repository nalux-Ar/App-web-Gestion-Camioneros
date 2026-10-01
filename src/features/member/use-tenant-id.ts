import { useMember } from './use-member';

/**
 * `transportista_id` del miembro logueado, para armar las query keys
 * (`tenantKey`, src/lib/query-keys.ts). Solo se puede usar en pantallas que
 * están detrás de `RequireMember`, donde el miembro ya está cargado: si no
 * lo está, es un error de programación y falla fuerte en vez de armar una
 * key sin tenant.
 */
export function useTenantId(): string {
  const { member } = useMember();
  if (!member) {
    throw new Error('useTenantId se tiene que usar dentro de una ruta con miembro cargado (RequireMember).');
  }
  return member.transportistaId;
}
