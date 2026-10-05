import { useMutation, useQueryClient } from '@tanstack/react-query';

import { clienteWriteIO } from './clientes-api';
import { clientesKeys } from './clientes-keys';
import type { ClienteDatos } from './cliente-form';
import { crearClienteIdempotente, type CrearClienteResultado } from './cliente-save';

/**
 * Mutación del ALTA de un cliente (el formulario de Clientes y el "+ Nuevo cliente" al vuelo del viaje). Reglas:
 *  - NO se configura `retry` ni `networkMode` acá (regla de ESLint): el default global es `retry: 0` +
 *    `networkMode: 'always'`. El reintento es manual y seguro: `crearClienteIdempotente` manda el mismo `client_ref` y la
 *    base no duplica (migración 009).
 *  - El `tenantId` viaja en las variables: se captura al empezar la mutación y es ESE el que se invalida, aunque mientras
 *    tanto cambie el usuario.
 *  - Se invalida la LISTA en `onSettled` (no solo si salió bien): con un timeout la escritura pudo haberse aplicado igual
 *    (respuesta perdida). La lista la comparten la pantalla de Clientes y los selectores de entregas y devoluciones. No se
 *    espera la invalidación (`void`): quien crea ya tiene el cliente (lo devolvió la base) para usarlo.
 *  - `scope`: dos altas de cliente corren de a una (un doble toque no crea dos en paralelo).
 */

export interface CrearClienteVariables {
  tenantId: string;
  /** Ya validados y recortados. */
  datos: ClienteDatos;
  /** Clave de idempotencia del formulario: la misma en cada reintento. */
  clientRef: string;
  /** Huellas de lo ya mandado con este `clientRef` (ver `crearClienteIdempotente`). Se modifica. */
  sent: Set<string>;
}

export function useCrearCliente() {
  const queryClient = useQueryClient();
  return useMutation<CrearClienteResultado, Error, CrearClienteVariables>({
    scope: { id: 'crear-cliente' },
    mutationFn: ({ datos, clientRef, sent }) => crearClienteIdempotente({ datos, clientRef, sent, io: clienteWriteIO }),
    onSettled: (_resultado, _error, { tenantId }) => {
      void queryClient.invalidateQueries({ queryKey: clientesKeys.list(tenantId) });
    },
  });
}
