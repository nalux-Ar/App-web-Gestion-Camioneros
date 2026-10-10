import { useMutation, useQueryClient } from '@tanstack/react-query';

import { useMember } from '@/features/member/use-member';
import { mentionsConstraint } from '@/lib/data-errors';
import { guardarCamionActivo } from './camion-activo-api';
import { camionesKeys } from './camiones-keys';
import { CAMION_ARCHIVADO, MIEMBROS_CAMION_ACTIVO_FK } from './constants';

/**
 * Mutación del camión activo (Etapa 5c). Reglas, como las demás mutaciones del módulo:
 *  - NO se configura `retry` ni `networkMode` acá (regla de ESLint): el default global es `retry: 0` +
 *    `networkMode: 'always'`. El reintento es manual ("Reintentar"); es seguro porque el UPDATE es idempotente.
 *  - PESIMISTA: el contexto del miembro (`member.camionActivoId`) cambia SOLO cuando la base confirma, con el valor que
 *    devolvió ella. Va en `onSuccess` de la mutación y no en la pantalla: se refleja aunque la persona se haya ido de
 *    Inicio mientras guardaba. Si falla, no se toca nada.
 *  - El `tenantId` y el `userId` viajan en las variables (se capturan al empezar). Si mientras tanto cambió el usuario o el
 *    tenant, `updateLocalCamionActivo` no escribe nada (no se pisa el miembro de otra cuenta).
 *  - `scope`: dos cambios seguidos corren de a uno, en orden: las respuestas no llegan desordenadas y queda el último.
 *  - Errores del camión (archivado: 55000 `camion_archivado`; inexistente o de otra cuenta: 23503
 *    `miembros_camion_activo_fk`): la lista de camiones de la pantalla estaba vieja, se invalida (con el tenant de las
 *    variables). Los mensajes los arma `CAMBIAR_CAMION_ACTIVO_CONTEXT` (constants.ts), sin "Reintentar".
 */

export interface CambiarCamionActivoVariables {
  tenantId: string;
  /** El usuario de la sesión (`useAuth().user.id`): se actualiza SU fila de `miembros`. */
  userId: string;
  /** El camión elegido, o `null` para quitarlo. */
  camionId: string | null;
}

/** Devuelve el camión activo que guardó la base. */
export function useCambiarCamionActivo() {
  const queryClient = useQueryClient();
  const { updateLocalCamionActivo } = useMember();
  return useMutation<string | null, Error, CambiarCamionActivoVariables>({
    scope: { id: 'camion-activo' },
    mutationFn: ({ userId, camionId }) => guardarCamionActivo(userId, camionId),
    onSuccess: (guardado, { tenantId }) => {
      updateLocalCamionActivo(tenantId, guardado);
    },
    onError: (error, { tenantId }) => {
      if (mentionsConstraint(error, CAMION_ARCHIVADO) || mentionsConstraint(error, MIEMBROS_CAMION_ACTIVO_FK)) {
        void queryClient.invalidateQueries({ queryKey: camionesKeys.list(tenantId) });
      }
    },
  });
}
