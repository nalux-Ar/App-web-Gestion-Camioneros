import { useMutation } from '@tanstack/react-query';

import { SIN_REGISTRO_DE_ERRORES } from '@/lib/query-client';
import { enviarReporte } from './reportar-api';

/** El `scope` del envío (una cola: dos toques seguidos no salen en paralelo). */
export const SCOPE_ENVIAR_REPORTE = 'enviar-reporte';

/**
 * Enviar un reporte. Sin reintentos automáticos ni pausa sin red (los defaults de las mutaciones del proyecto, ver
 * src/lib/query-client.ts): si falla, falla en el momento y la persona toca "Reintentar" con lo que escribió. No invalida
 * nada (ninguna consulta lee `reportes`). Sus errores NO van al registro de errores recientes (`meta`): si no, un reporte
 * que no sale por falta de red llenaría el registro con sus propios fallos.
 */
export function useEnviarReporte() {
  return useMutation({
    mutationFn: enviarReporte,
    scope: { id: SCOPE_ENVIAR_REPORTE },
    meta: SIN_REGISTRO_DE_ERRORES,
  });
}
