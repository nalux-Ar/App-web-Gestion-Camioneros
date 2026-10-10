import { buscarCamion, type CamionDeLista } from './camion';

/**
 * El "camión activo" de la persona (Etapa 5c): el camión con el que está trabajando, guardado en la base como una
 * preferencia suya (`miembros.camion_activo_id`, migración 012) y que el front usa para PRECOMPLETAR los viajes y las
 * cargas de combustible NUEVOS cuando la cuenta tiene 2 o más camiones activos. Lógica PURA.
 *
 * Lo guardado es solo un puntero: archivar un camión no lo toca (la base lo conserva) y la lista de la pantalla puede no
 * traerlo. Por eso SIEMPRE se valida contra la lista fresca antes de usarlo: si no está en la lista o está archivado, es un
 * puntero obsoleto y se comporta exactamente como "no hay camión activo" (se vuelve a la regla por cantidad de camiones
 * activos de `decidirCamion`). Nunca se "arregla" solo: la persona elige otro en Inicio.
 */

export interface CamionActivoResuelto {
  /** El camión activo guardado, si existe en la lista y está activo; si no, null. */
  camion: CamionDeLista | null;
  /** Hay un camión activo guardado pero no sirve (no está en la lista, o está archivado). */
  obsoleto: boolean;
}

export interface ResolverCamionActivoArgs {
  /** Todos los camiones de la cuenta (activos y archivados), YA cargados. */
  camiones: readonly CamionDeLista[];
  /** Lo guardado en el miembro (`member.camionActivoId`). */
  camionActivoId: string | null;
}

export function resolverCamionActivo({ camiones, camionActivoId }: ResolverCamionActivoArgs): CamionActivoResuelto {
  if (!camionActivoId) return { camion: null, obsoleto: false };
  const camion = buscarCamion(camiones, camionActivoId);
  return camion !== null && camion.activa ? { camion, obsoleto: false } : { camion: null, obsoleto: true };
}
