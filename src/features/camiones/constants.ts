import type { DataErrorContext } from '@/lib/data-errors';

/**
 * Constantes de Camiones: límites de la tabla, nombres de constraints que el front reconoce SOLO para elegir un mensaje
 * (nunca se muestran) y los contextos de error de cada escritura. Ver el encabezado de la migración 010.
 */

/** Largos máximos de marca y modelo: mismos valores que `camiones_marca_chk` / `camiones_modelo_chk` (001). */
export const MAX_MARCA = 100;
export const MAX_MODELO = 100;

/** Año mínimo: el de `camiones_anio_chk` (001). El máximo lo pone el front: el año que viene. */
export const MIN_ANIO = 1950;

/**
 * Tope de camiones que trae la lista (activos y archivados). Un transportista tiene pocos; el tope es una guarda: se
 * piden uno más para saber si se alcanzó.
 */
export const CAMIONES_LIMIT = 100;

/** Desde cuántos camiones elegibles el selector pasa de botones a una lista desplegable. */
export const MAX_BOTONES_CAMION = 4;

/** La lista de camiones cambia poco: se considera fresca 10 minutos (como las categorías de gasto). */
export const CAMIONES_STALE_TIME_MS = 10 * 60_000;

/** Patente repetida en el tenant (23505, INSERT o UPDATE directo). */
export const CAMIONES_PATENTE_UNICA = 'camiones_transportista_patente_key';
/** Patente que no llegó normalizada a un UPDATE directo (23514). */
export const CAMIONES_PATENTE_NORMALIZADA = 'camiones_patente_normalizada_chk';
/** Texto fijo del 55000 que levanta la base al asignar un camión archivado (viaje o gasto nuevo, o un cambio de camión). */
export const CAMION_ARCHIVADO = 'camion_archivado';
/** Gasto con un camión distinto del de su viaje (23514). */
export const GASTOS_CAMION_VIAJE = 'gastos_camion_viaje_chk';
/** FK compuesta gasto -> camión (23503: camión de otro tenant o inexistente, mismo error en los dos casos). */
export const GASTOS_CAMION_FK = 'gastos_camion_fk';
/** FK compuesta viaje -> camión (ídem). */
export const VIAJES_CAMION_FK = 'viajes_camion_fk';

export const SOLO_ADMIN_CAMIONES_MESSAGE = 'Solo el administrador de la cuenta puede cargar o cambiar camiones.';
export const PATENTE_REPETIDA_MESSAGE = 'Ya tienes un camión con esa patente.';
export const CAMION_ARCHIVADO_MESSAGE = 'Ese camión está archivado. Elige otro camión o reactívalo desde Camiones.';

/** Errores al GUARDAR un camión (alta por `crear_camion` o edición por UPDATE). */
export const GUARDAR_CAMION_CONTEXT: DataErrorContext = {
  messagesByConstraint: {
    [CAMIONES_PATENTE_UNICA]: PATENTE_REPETIDA_MESSAGE,
    [CAMIONES_PATENTE_NORMALIZADA]: 'Revisa la patente: solo puede tener letras y números.',
  },
  // 23514 de los checks de largo (patente, marca, modelo, año): el front ya los valida, llegar acá es raro.
  invalidData: 'Alguno de los datos del camión no es válido. Revísalos e inténtalo de nuevo.',
  // `crear_camion` de alguien que no es administrador.
  permission: SOLO_ADMIN_CAMIONES_MESSAGE,
  // UPDATE que no afectó ninguna fila al reactivar desde el alta (lo borraron, o no es administrador).
  notFound: 'No encontramos ese camión. Vuelve a la lista de camiones.',
};

/** Errores al ARCHIVAR o REACTIVAR un camión. */
export const ARCHIVAR_CAMION_CONTEXT: DataErrorContext = {
  notFound: 'No pudimos cambiar ese camión: puede que ya no exista o que no tengas permiso.',
};
