import { buscarCamion, etiquetaCamion, ordenarCamiones, type CamionDeLista } from './camion';
import { MAX_BOTONES_CAMION } from './constants';

/**
 * Qué camión lleva un viaje o una carga de combustible, y qué se muestra para elegirlo. Lógica PURA: la usan el
 * formulario de viaje y el bloque Combustible del gasto, y se prueba suelta.
 *
 * Reglas (plan aprobado de la Etapa 5):
 *  - 0 camiones activos: el viaje se guarda sin camión y no se muestra nada; en Combustible hay que cargar uno ("+ Nuevo
 *    camión" dentro del formulario), porque con litros hace falta camión.
 *  - 1 camión activo: se asigna solo, sin mostrar nada (si el registro ya tenía ESE camión, se conserva).
 *  - 2 o más activos: se elige con un toque, sin preselección (preseleccionar el último usado vincularía mal sin que se
 *    note cuando el dueño carga datos de dos camiones). Botones hasta 4 camiones; desde 5, una lista desplegable.
 *  - Un registro que ya tenía un camión ARCHIVADO: se muestra "(archivado)" entre las opciones y se conserva; NUNCA se
 *    reasigna en silencio (la base solo rechaza un camión archivado si el camión CAMBIA).
 *  - Combustible vinculado a un viaje con camión: va el camión del viaje, bloqueado y visible (la base exige que coincidan).
 *    Si ese camión está archivado y la carga es nueva (o cambia de camión), no se puede guardar: la base rechazaría
 *    cualquier camión (55000 el archivado, 23514 otro distinto del del viaje).
 */

export type ContextoCamion = 'viaje' | 'combustible';

export type DecisionCamion =
  /** Sin selector: el registro va sin camión (viaje con 0 camiones activos). */
  | { tipo: 'ninguno' }
  /** Un solo camión activo: se asigna solo, sin mostrar nada. */
  | { tipo: 'auto'; camion: CamionDeLista }
  /** Hay que elegir (o conservar el que ya tenía). `opciones` ya ordenadas; `control` dice cómo se muestran. */
  | { tipo: 'elegir'; opciones: CamionDeLista[]; control: 'botones' | 'lista' }
  /**
   * Combustible de un viaje con camión: va el del viaje, bloqueado. `camion` es null si no está en la lista (no debería
   * pasar). `archivadoNuevo`: el camión del viaje está archivado y el gasto no lo tenía ya, así que no se puede guardar.
   */
  | { tipo: 'del-viaje'; camionId: string; camion: CamionDeLista | null; archivadoNuevo: boolean }
  /** Combustible sin camiones activos: hay que cargar uno. */
  | { tipo: 'crear' };

export interface DecidirCamionArgs {
  /** Todos los camiones del tenant (activos y archivados), YA cargados. */
  camiones: readonly CamionDeLista[];
  /** El camión que el registro tenía al abrir el formulario (null si es nuevo o no tenía). */
  original: string | null;
  /** Solo en Combustible: el camión del viaje vinculado (null o undefined si no hay viaje o el viaje no tiene camión). */
  camionDelViaje?: string | null;
  contexto: ContextoCamion;
}

/** Un camión que el registro tenía y que no aparece en la lista (no debería pasar: la lista trae también los archivados). */
function camionDesconocido(id: string): CamionDeLista {
  return { id, patente: '', marca: null, modelo: null, anio: null, activa: false };
}

export function decidirCamion({ camiones, original, camionDelViaje = null, contexto }: DecidirCamionArgs): DecisionCamion {
  if (contexto === 'combustible' && camionDelViaje) {
    const camion = buscarCamion(camiones, camionDelViaje);
    const archivado = camion !== null && !camion.activa;
    return { tipo: 'del-viaje', camionId: camionDelViaje, camion, archivadoNuevo: archivado && original !== camionDelViaje };
  }

  const activos = ordenarCamiones(camiones.filter((camion) => camion.activa));
  const actual = original ? (buscarCamion(camiones, original) ?? camionDesconocido(original)) : null;

  // El registro ya tenía un camión que no está entre los activos (archivado): se ofrece primero, junto con los activos,
  // y se conserva salvo que la persona elija otro.
  if (actual !== null && !actual.activa) {
    const opciones = [actual, ...activos];
    return { tipo: 'elegir', opciones, control: opciones.length <= MAX_BOTONES_CAMION ? 'botones' : 'lista' };
  }

  if (activos.length === 0) return contexto === 'combustible' ? { tipo: 'crear' } : { tipo: 'ninguno' };
  if (activos.length === 1) return { tipo: 'auto', camion: activos[0]! };
  return { tipo: 'elegir', opciones: activos, control: activos.length <= MAX_BOTONES_CAMION ? 'botones' : 'lista' };
}

/**
 * El id del DOM al que va el foco cuando el camión tiene un error: el primer botón (`${prefijo}-0`), la lista desplegable
 * (`${prefijo}`) o el bloque que lo explica (`${prefijo}-bloque`).
 */
export function domIdDelCamion(prefijo: string, decision: DecisionCamion | null): string {
  if (decision?.tipo === 'elegir') return decision.control === 'botones' ? `${prefijo}-0` : prefijo;
  return `${prefijo}-bloque`;
}

/**
 * La lista cargada más los camiones creados o reactivados en esta pantalla DESPUÉS de leerla (la lista se refresca en segundo
 * plano: sin esto, el camión recién creado no estaría para elegir y uno recién reactivado seguiría figurando archivado, con
 * lo que la carga no se podría guardar hasta que llegue el refresco). Quien llama descarta los `creados` en cuanto la lista se
 * vuelve a leer (desde ahí la lista es lo más nuevo).
 * Sin repetidos por id: si un id viene en las dos, quedan los datos de la lista (marca, modelo, año), pero un camión que la
 * base confirmó activo acá cuenta como activo.
 */
export function combinarCamiones(cargados: readonly CamionDeLista[], creados: readonly CamionDeLista[]): CamionDeLista[] {
  const creadosPorId = new Map(creados.map((camion) => [camion.id, camion]));
  const actualizados = cargados.map((camion) =>
    !camion.activa && creadosPorId.get(camion.id)?.activa === true ? { ...camion, activa: true } : camion,
  );
  const ids = new Set(cargados.map((camion) => camion.id));
  return ordenarCamiones([...actualizados, ...creados.filter((camion) => !ids.has(camion.id))]);
}

export const CAMION_FALTA_MESSAGE = 'Elige el camión.';
export const CAMION_CREAR_MESSAGE = 'Para guardar los litros hace falta un camión: cárgalo aquí abajo.';
export const CAMIONES_SIN_CARGAR_MESSAGE = 'Falta cargar tus camiones. Revisa la sección del camión.';

/** "El camión de este viaje (AB 123 CD) está archivado…": el camión del viaje no se puede usar en una carga nueva. */
export function camionDelViajeArchivadoMessage(camion: CamionDeLista | null): string {
  return `El camión de este viaje (${etiquetaCamion(camion && { ...camion, activa: true })}) está archivado: reactívalo desde Camiones o carga el gasto sin viaje.`;
}

export type ResolucionCamion = { ok: true; camionId: string | null } | { ok: false; message: string };

/**
 * El camión que se manda a la base según la decisión y lo elegido en pantalla (`valor`, '' = nada elegido):
 *  - ninguno: null; auto: el único activo; del-viaje: el del viaje (o error si está archivado y es nuevo);
 *  - elegir: lo elegido, que tiene que ser una de las opciones (si no, "Elige el camión.");
 *  - crear: error (hay que cargar un camión antes de guardar los litros).
 */
export function resolverCamion(decision: DecisionCamion, valor: string): ResolucionCamion {
  switch (decision.tipo) {
    case 'ninguno':
      return { ok: true, camionId: null };
    case 'auto':
      return { ok: true, camionId: decision.camion.id };
    case 'del-viaje':
      return decision.archivadoNuevo
        ? { ok: false, message: camionDelViajeArchivadoMessage(decision.camion) }
        : { ok: true, camionId: decision.camionId };
    case 'elegir':
      return valor !== '' && decision.opciones.some((camion) => camion.id === valor)
        ? { ok: true, camionId: valor }
        : { ok: false, message: CAMION_FALTA_MESSAGE };
    case 'crear':
      return { ok: false, message: CAMION_CREAR_MESSAGE };
  }
}
