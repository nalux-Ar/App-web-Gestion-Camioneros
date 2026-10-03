import { useQuery } from '@tanstack/react-query';

import { useTenantId } from '@/features/member/use-tenant-id';
import { fetchClientes } from './clientes-api';
import { clientesKeys } from './clientes-keys';

/**
 * Lista de clientes del transportista (con tope, ver `fetchClientes`). La `queryFn` pasa la `signal` de
 * TanStack a la consulta: salir de la pantalla o cerrar sesión corta el pedido de verdad.
 *
 * `enabled: false` para no pedirla cuando todavía no hace falta. Dos pantallas pueden llamar a este hook a
 * la vez (comparten la misma key): se pide una sola vez.
 */
export function useClientes({ enabled = true }: { enabled?: boolean } = {}) {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: clientesKeys.list(tenantId),
    queryFn: ({ signal }) => fetchClientes(signal),
    enabled,
  });
}
