import { useMutation, useQueryClient } from '@tanstack/react-query';

import { crearCliente } from './clientes-api';
import { clientesKeys } from './clientes-keys';
import type { ClienteOpcion } from './cliente-nombre';

/**
 * Mutación de "+ Nuevo cliente". Reglas:
 *  - NO se configura `retry` ni `networkMode` acá (regla de ESLint): el default global es `retry: 0` +
 *    `networkMode: 'always'`. El reintento es manual y, antes de crear otra vez, la pantalla refresca la
 *    lista y verifica el duplicado (ver `altaCliente`): el INSERT no es idempotente.
 *  - El `tenantId` viaja en las variables: se captura al empezar la mutación y es ESE el que se invalida,
 *    aunque mientras tanto cambie el usuario.
 *  - `onSuccess` no espera la invalidación (`void`): la lista se refresca en segundo plano y la pantalla
 *    ya tiene el cliente nuevo (lo devolvió la base) para dejarlo elegido.
 *  - `scope`: dos altas de cliente corren de a una (un doble toque no crea dos en paralelo).
 */

export interface CrearClienteVariables {
  tenantId: string;
  /** Ya validado y recortado. */
  nombre: string;
}

/** Devuelve el cliente que guardó la base (id + nombre). */
export function useCrearCliente() {
  const queryClient = useQueryClient();
  return useMutation<ClienteOpcion, Error, CrearClienteVariables>({
    scope: { id: 'crear-cliente' },
    mutationFn: ({ nombre }) => crearCliente(nombre),
    onSuccess: (_cliente, { tenantId }) => {
      void queryClient.invalidateQueries({ queryKey: clientesKeys.all(tenantId) });
    },
  });
}
