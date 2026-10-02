import { useMutation } from '@tanstack/react-query';

import { useMember } from '@/features/member/use-member';
import { actualizarNombreTransportista } from './nombre-api';

/**
 * Mutación del nombre de la cuenta. Reglas:
 *  - NO se configura `retry` ni `networkMode` acá (regla de ESLint): el default
 *    global es `retry: 0` + `networkMode: 'always'`. El reintento es manual
 *    (`useSubmitFeedback` + "Reintentar"); es seguro porque el UPDATE es idempotente.
 *  - El `transportistaId` viaja en las variables: se captura al empezar y es ESE
 *    el que se usa en `onSuccess`, aunque mientras tanto cambie el usuario o el tenant.
 *  - El contexto de miembro (encabezado y saludo) se actualiza SOLO cuando la base
 *    confirma, con el nombre que devolvió ella (sin actualización optimista). Va en
 *    `onSuccess` de la mutación y no en la pantalla: así se actualiza aunque la
 *    persona se haya ido de Configuración mientras guardaba. Si en el medio cambió
 *    el tenant, `updateLocalTransportistaNombre` no hace nada.
 *  - No hay queries que invalidar: el nombre no vive en la caché de TanStack
 *    (las query keys llevan el id del tenant, no el nombre).
 *  - `scope`: las mutaciones con el mismo `scope.id` corren de a una. Si se guarda,
 *    se sale de Configuración, se vuelve y se guarda otro nombre antes de que
 *    responda el primero, el segundo espera al primero: las respuestas no llegan
 *    desordenadas y el contexto queda con el último.
 */

export interface ActualizarNombreVariables {
  transportistaId: string;
  nombre: string;
}

/** Devuelve el nombre guardado por la base. */
export function useActualizarNombre() {
  const { updateLocalTransportistaNombre } = useMember();
  return useMutation<string, Error, ActualizarNombreVariables>({
    scope: { id: 'nombre-cuenta' },
    mutationFn: ({ transportistaId, nombre }) => actualizarNombreTransportista(transportistaId, nombre),
    onSuccess: (nombreGuardado, { transportistaId }) => {
      updateLocalTransportistaNombre(transportistaId, nombreGuardado);
    },
  });
}
