import { buscarCamion, etiquetaCamion, ordenarCamiones, type CamionDeLista } from './camion';
import { resolverCamionActivo } from './camion-activo';
import { MAX_BOTONES_CAMION } from './constants';

/**
 * Qué camión lleva un viaje o una carga de combustible, y qué se muestra para elegirlo. Lógica PURA: la usan el
 * formulario de viaje y el bloque Combustible del gasto, y se prueba suelta.
 *
 * Reglas (Etapa 5, con los cambios de la Etapa 5c "camión activo", decisiones del 2026-10-07):
 *  - 0 camiones activos: el viaje se guarda sin camión y no se muestra nada; en Combustible hay que cargar uno ("+ Nuevo
 *    camión" dentro del formulario), porque con litros hace falta camión.
 *  - 1 camión activo: se asigna solo, pero VISIBLE: la línea "Camión: AB 123 CD", sin "Cambiar" (no hay nada que elegir;
 *    así el formulario no cambia de forma al cargar el segundo camión).
 *  - 2 o más activos: hay que elegir, PRECOMPLETADO cuando se puede (se revierte la regla de la Etapa 5 "con 2 o más no se
 *    preselecciona ninguno"):
 *     - registro EDITADO: con el camión que ya tenía (aunque esté archivado). Un registro viejo SIN camión no se precompleta:
 *       se elige explícitamente, como antes.
 *     - registro NUEVO: con el camión activo de la persona (`member.camionActivoId`), solo si es válido contra la lista
 *       (`resolverCamionActivo`: existe y está activo). Si no hay uno válido (ninguno, archivado o inexistente), sin
 *       preselección, como antes.
 *    Con un precompletado se muestra la línea "Camión: AB 123 CD" con "Cambiar", que despliega las opciones y afecta SOLO a
 *    ese registro (nunca cambia el camión activo guardado). Sin precompletado, las opciones directo. Botones hasta 4
 *    camiones; desde 5, una lista desplegable.
 *  - Un registro que ya tenía un camión ARCHIVADO: se muestra "(archivado)", primero entre las opciones, y se conserva
 *    (precompletado con él); NUNCA se reasigna en silencio (la base solo rechaza un camión archivado si el camión CAMBIA).
 *  - Combustible vinculado a un viaje con camión: va el camión del viaje, bloqueado y visible (la base exige que coincidan).
 *    Si ese camión está archivado y la carga es nueva (o cambia de camión), no se puede guardar: la base rechazaría
 *    cualquier camión (55000 el archivado, 23514 otro distinto del del viaje).
 *
 * Salvaguardas que reemplazan a la regla vieja: la patente SIEMPRE visible en el formulario, el camión activo solo precompleta
 * registros NUEVOS, se valida contra la lista fresca, y en Combustible manda el camión del viaje. El trigger de la base que
 * asigna el único camión activo cuando el cliente no manda camión no cambia: el front no lo reemplaza.
 */

export type ContextoCamion = 'viaje' | 'combustible';

/** ¿El formulario da de alta un registro o edita uno que ya existe? El camión activo solo precompleta los NUEVOS. */
export type ModoRegistro = 'nuevo' | 'edicion';

/**
 * Texto auxiliar de la decisión `elegir` (solo en registros NUEVOS con 2 o más camiones activos):
 *  - `es-el-activo`: se precompletó con el camión activo de la persona.
 *  - `sugerir-activo`: no hay un camión activo válido; se sugiere dejar uno en Inicio.
 */
export type AyudaCamion = 'es-el-activo' | 'sugerir-activo';

export type DecisionCamion =
  /** Sin selector: el registro va sin camión (viaje con 0 camiones activos). */
  | { tipo: 'ninguno' }
  /** Un solo camión activo: se asigna solo; se muestra la línea "Camión: …" sin "Cambiar". */
  | { tipo: 'auto'; camion: CamionDeLista }
  /**
   * Hay que elegir (o conservar el que ya tenía). `opciones` ya ordenadas; `control` dice cómo se muestran.
   * `preseleccionado`: el camión que se manda si no se toca nada (el del registro editado, o el camión activo en uno nuevo);
   * null = no hay y hay que elegir. Siempre es una de las `opciones`.
   */
  | {
      tipo: 'elegir';
      opciones: CamionDeLista[];
      control: 'botones' | 'lista';
      preseleccionado: CamionDeLista | null;
      ayuda: AyudaCamion | null;
    }
  /**
   * Combustible de un viaje con camión: va el del viaje, bloqueado. `camion` es null si no está en la lista (no debería
   * pasar). `archivadoNuevo`: el camión del viaje está archivado y el gasto no lo tenía ya, así que no se puede guardar.
   */
  | { tipo: 'del-viaje'; camionId: string; camion: CamionDeLista | null; archivadoNuevo: boolean }
  /** Combustible sin camiones activos: hay que cargar uno. */
  | { tipo: 'crear' };

export type DecisionElegir = Extract<DecisionCamion, { tipo: 'elegir' }>;

export interface DecidirCamionArgs {
  /** Todos los camiones del tenant (activos y archivados), YA cargados (la lista fresca del formulario). */
  camiones: readonly CamionDeLista[];
  /** El camión que el registro tenía al abrir el formulario (null si no tenía). Solo cuenta al EDITAR. */
  original: string | null;
  /** Solo en Combustible: el camión del viaje vinculado (null o undefined si no hay viaje o el viaje no tiene camión). */
  camionDelViaje?: string | null;
  contexto: ContextoCamion;
  /** Registro nuevo o editado: el camión activo solo precompleta los nuevos, y un registro nuevo no tiene camión propio. */
  modo: ModoRegistro;
  /** El camión activo guardado de la persona (`member.camionActivoId`), SIN validar: se valida acá contra `camiones`. */
  camionActivoId: string | null;
}

/** Un camión que el registro tenía y que no aparece en la lista (no debería pasar: la lista trae también los archivados). */
function camionDesconocido(id: string): CamionDeLista {
  return { id, patente: '', marca: null, modelo: null, anio: null, activa: false };
}

function decisionElegir(opciones: CamionDeLista[], preseleccionado: CamionDeLista | null, ayuda: AyudaCamion | null): DecisionElegir {
  return { tipo: 'elegir', opciones, control: opciones.length <= MAX_BOTONES_CAMION ? 'botones' : 'lista', preseleccionado, ayuda };
}

export function decidirCamion({
  camiones,
  original,
  camionDelViaje = null,
  contexto,
  modo,
  camionActivoId,
}: DecidirCamionArgs): DecisionCamion {
  // Un registro nuevo no tiene camión propio (aunque llegue un `original`, no cuenta).
  const propio = modo === 'edicion' ? original : null;

  if (contexto === 'combustible' && camionDelViaje) {
    const camion = buscarCamion(camiones, camionDelViaje);
    const archivado = camion !== null && !camion.activa;
    return { tipo: 'del-viaje', camionId: camionDelViaje, camion, archivadoNuevo: archivado && propio !== camionDelViaje };
  }

  const activos = ordenarCamiones(camiones.filter((camion) => camion.activa));
  const actual = propio ? (buscarCamion(camiones, propio) ?? camionDesconocido(propio)) : null;

  // El registro ya tenía un camión que no está entre los activos (archivado): se ofrece primero, junto con los activos,
  // y se conserva (precompletado) salvo que la persona elija otro.
  if (actual !== null && !actual.activa) return decisionElegir([actual, ...activos], actual, null);

  if (activos.length === 0) return contexto === 'combustible' ? { tipo: 'crear' } : { tipo: 'ninguno' };
  if (activos.length === 1) return { tipo: 'auto', camion: activos[0]! };

  // 2 o más activos. Editado: el suyo (o nada, si es un registro viejo sin camión). Nuevo: el camión activo, si es válido.
  if (modo === 'edicion') return decisionElegir(activos, actual, null);
  const { camion: activo } = resolverCamionActivo({ camiones, camionActivoId });
  return decisionElegir(activos, activo, activo ? 'es-el-activo' : 'sugerir-activo');
}

/**
 * En `elegir`, el camión que vale AHORA: lo elegido en pantalla (`valor`) o, si no se tocó nada (`valor === ''`), el
 * precompletado. Solo si es una de las opciones; si no, null (hay que elegir). Lo usan `resolverCamion` (lo que se manda)
 * y el selector (lo que se muestra en la línea), así que lo que se ve es siempre lo que se guarda.
 */
export function camionElegido(decision: DecisionElegir, valor: string): CamionDeLista | null {
  const id = valor !== '' ? valor : (decision.preseleccionado?.id ?? '');
  if (id === '') return null;
  return decision.opciones.find((camion) => camion.id === id) ?? null;
}

/**
 * El id del DOM al que va el foco cuando el camión tiene un error: el primer botón (`${prefijo}-0`), la lista desplegable
 * (`${prefijo}`) o el bloque que lo explica (`${prefijo}-bloque`).
 *
 * En `elegir` el foco va SIEMPRE a las opciones: un error del camión en `elegir` quiere decir que no hay un camión elegido
 * válido (`camionElegido` da null), y en ese caso el selector no muestra la línea "Camión: …" sino las opciones (la línea
 * con "Cambiar" solo existe cuando hay uno válido, y entonces no hay error que enfocar).
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
/** Ayuda de un registro nuevo precompletado con el camión activo. */
export const AYUDA_ES_EL_ACTIVO = 'Es tu camión activo. Si lo cambias aquí, solo cambia en este registro.';
/** Ayuda de un registro nuevo con 2 o más camiones activos y sin un camión activo válido. */
export const AYUDA_SUGERIR_ACTIVO = 'Puedes dejar un camión activo en Inicio para no elegirlo cada vez.';

/** "El camión de este viaje (AB 123 CD) está archivado…": el camión del viaje no se puede usar en una carga nueva. */
export function camionDelViajeArchivadoMessage(camion: CamionDeLista | null): string {
  return `El camión de este viaje (${etiquetaCamion(camion && { ...camion, activa: true })}) está archivado: reactívalo desde Camiones o carga el gasto sin viaje.`;
}

export type ResolucionCamion = { ok: true; camionId: string | null } | { ok: false; message: string };

/**
 * El camión que se manda a la base según la decisión y lo elegido en pantalla (`valor`, '' = nada elegido):
 *  - ninguno: null; auto: el único activo; del-viaje: el del viaje (o error si está archivado y es nuevo);
 *  - elegir: el valor efectivo (`camionElegido`: lo elegido, o el precompletado si no se tocó nada), que tiene que ser una
 *    de las opciones; sin precompletado y sin elegir, "Elige el camión.";
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
    case 'elegir': {
      const camion = camionElegido(decision, valor);
      return camion ? { ok: true, camionId: camion.id } : { ok: false, message: CAMION_FALTA_MESSAGE };
    }
    case 'crear':
      return { ok: false, message: CAMION_CREAR_MESSAGE };
  }
}
