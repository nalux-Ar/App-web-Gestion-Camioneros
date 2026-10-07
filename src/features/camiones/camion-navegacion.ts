/**
 * Navegación de Camiones: rutas (armadas en el código) y el aviso breve que la lista muestra al volver de guardar,
 * archivar o reactivar. Lógica PURA.
 *
 * Regla de seguridad (la de siempre): el `location.state` NO es de confianza. El aviso es un literal de lista blanca y las
 * cantidades que acompañan al alta del primer camión se aceptan solo si son enteros razonables; cualquier otra cosa se
 * ignora.
 */

export const RUTA_CAMIONES = '/camiones';
export const RUTA_NUEVO_CAMION = '/camiones/nuevo';

/** Ruta de la edición de un camión. Solo se llama con un id ya validado (`isUuid`) o que devolvió la base. */
export function rutaEditarCamion(id: string): string {
  return `/camiones/${id}/editar`;
}

export type CamionesAvisoTipo = 'camion-guardado' | 'camion-archivado' | 'camion-reactivado';

const AVISOS: readonly CamionesAvisoTipo[] = ['camion-guardado', 'camion-archivado', 'camion-reactivado'];

export interface AvisoCamiones {
  tipo: CamionesAvisoTipo;
  /** Solo en el alta del primer camión: cuántos viajes y cargas sin camión le asignó la base. */
  viajesAsignados: number;
  gastosAsignados: number;
}

/** Tope de sensatez para las cantidades del state (no es de seguridad: es para no mostrar un número absurdo). */
const MAX_CANTIDAD = 1_000_000;

function cantidad(valor: unknown): number {
  return typeof valor === 'number' && Number.isInteger(valor) && valor >= 0 && valor <= MAX_CANTIDAD ? valor : 0;
}

/** El `state` con el que se vuelve a la lista. Las cantidades solo van si hay alguna. */
export function estadoAvisoCamiones(
  tipo: CamionesAvisoTipo,
  asignados: { viajes: number; gastos: number } = { viajes: 0, gastos: 0 },
): { aviso: CamionesAvisoTipo; viajesAsignados?: number; gastosAsignados?: number } {
  return asignados.viajes > 0 || asignados.gastos > 0
    ? { aviso: tipo, viajesAsignados: asignados.viajes, gastosAsignados: asignados.gastos }
    : { aviso: tipo };
}

/** Lee el aviso del `state`: solo un literal de la lista blanca; las cantidades raras cuentan como 0. */
export function leerAvisoCamiones(state: unknown): AvisoCamiones | null {
  if (typeof state !== 'object' || state === null) return null;
  const { aviso, viajesAsignados, gastosAsignados } = state as Record<string, unknown>;
  const tipo = AVISOS.find((permitido) => permitido === aviso);
  if (tipo === undefined) return null;
  return { tipo, viajesAsignados: cantidad(viajesAsignados), gastosAsignados: cantidad(gastosAsignados) };
}

function viajesEn(n: number): string {
  return n === 1 ? '1 viaje' : `${n} viajes`;
}

function cargasEn(n: number): string {
  return n === 1 ? '1 carga de combustible' : `${n} cargas de combustible`;
}

/** "3 viajes y 1 carga de combustible" (solo lo que haya), o '' si no hay nada. */
export function textoAsignados(viajes: number, gastos: number): string {
  if (viajes > 0 && gastos > 0) return `${viajesEn(viajes)} y ${cargasEn(gastos)}`;
  if (viajes > 0) return viajesEn(viajes);
  if (gastos > 0) return cargasEn(gastos);
  return '';
}

/** El aviso antes de cargar el PRIMER camión, según el estado del conteo fresco de lo que se le va a asignar. */
export function textoPrimerCamion(
  estado: { tipo: 'cargando' } | { tipo: 'error' } | { tipo: 'listo'; viajes: number; gastos: number },
): string {
  if (estado.tipo === 'cargando') return 'Es tu primer camión. Revisando tus viajes y cargas de combustible sin camión…';
  if (estado.tipo === 'error') {
    return 'Es tu primer camión: los viajes y las cargas de combustible que cargaste sin camión van a quedar asignados a él.';
  }
  const asignados = textoAsignados(estado.viajes, estado.gastos);
  return asignados ? `Es tu primer camión: ${asignados} que cargaste sin camión van a quedar asignados a él.` : 'Es tu primer camión.';
}

export function textoAvisoCamiones(aviso: AvisoCamiones): string {
  if (aviso.tipo === 'camion-archivado') return 'Camión archivado.';
  if (aviso.tipo === 'camion-reactivado') return 'Camión reactivado.';
  const asignados = textoAsignados(aviso.viajesAsignados, aviso.gastosAsignados);
  return asignados ? `Camión guardado. Se le asignaron ${asignados} que estaban sin camión.` : 'Camión guardado.';
}
