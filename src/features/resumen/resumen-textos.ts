import { METODO_PAGO_LABELS } from '@/features/gastos/constants';
import { formatearPatente } from '@/features/camiones/patente';
import { mapDataError, UserMessageError, type DataErrorContext } from '@/lib/data-errors';
import type { MetodoPago } from '@/lib/db';

/**
 * Textos del Resumen que usa la capa de datos (y que reusará la pantalla): las etiquetas de los grupos de
 * `resumen_gastos`, los "sin camión" / "sin especificar", los motivos de descarte del rendimiento y los mensajes de error.
 * Español neutro, de "tú". Ningún texto del servidor llega a la pantalla: todo pasa por acá o por `mapDataError`.
 */

/** Los grupos de filas de `resumen_gastos`. */
export const GRUPOS_GASTO = ['total', 'categoria', 'metodo_pago', 'camion'] as const;
export type GrupoGasto = (typeof GRUPOS_GASTO)[number];

export const ETIQUETAS_GRUPO_GASTO: Record<GrupoGasto, string> = {
  total: 'Total',
  categoria: 'Por categoría',
  metodo_pago: 'Por método de pago',
  camion: 'Por camión',
};

/** Gastos sin camión propio ni viaje con camión (todo lo que no es combustible y no va en un viaje con camión). */
export const SIN_CAMION = 'Sin camión';
/** Gastos sin método de pago cargado. */
export const SIN_ESPECIFICAR = 'Sin especificar';

/** El método de pago de una fila de `resumen_gastos` (null = sin especificar). */
export function etiquetaMetodoPago(metodo: MetodoPago | null): string {
  return metodo === null ? SIN_ESPECIFICAR : METODO_PAGO_LABELS[metodo];
}

/**
 * El camión de una fila del Resumen: "Sin camión" (sin id), la patente con espacios ("AB 123 CD") y, si está archivado,
 * "(archivado)". La patente viene de la propia función de la base (es el valor del momento de la consulta).
 */
export function etiquetaCamionResumen(camion: { camionId: string | null; patente: string | null; activa: boolean | null }): string {
  if (camion.camionId === null) return SIN_CAMION;
  const patente = camion.patente ? formatearPatente(camion.patente) : 'Camión no disponible';
  return camion.activa === false ? `${patente} (archivado)` : patente;
}

/** Los motivos por los que un tramo de rendimiento no se usa (columnas `descartados_*` de `resumen_combustible`). */
export type MotivoDescarte = 'retroceso' | 'sinAvance' | 'fueraDeRango';

export const MOTIVOS_DESCARTE: Record<MotivoDescarte, string> = {
  retroceso: 'El odómetro bajó respecto de la carga llena anterior.',
  sinAvance: 'El odómetro no avanzó desde la carga llena anterior.',
  fueraDeRango: 'Dio menos de 0,5 o más de 15 km por litro: casi siempre es un odómetro mal escrito.',
};

/** Aviso cuando la lista de viajes del período se cortó (la base devuelve como máximo 500). null si no se cortó. */
export function textoViajesCortados(mostrados: number, total: number): string | null {
  if (total <= mostrados) return null;
  return `Hay ${total} viajes en este período: se muestran los ${mostrados} más nuevos.`;
}

// ---------------------------------------------------------------------------
// Errores
// ---------------------------------------------------------------------------

/** Una parte del Resumen no se pudo armar por algo que no debería pasar (parámetros o respuesta inesperados). */
export const RESUMEN_ERROR_INESPERADO = 'No pudimos armar esta parte del resumen. Prueba de nuevo en un momento.';
/** 42501: el usuario no pertenece a ninguna cuenta. */
export const RESUMEN_SIN_CUENTA = 'No encontramos tu cuenta. Cierra sesión y vuelve a ingresar.';

/**
 * Errores de las funciones del Resumen (lecturas):
 *  - 22023 (período inválido): la pantalla nunca debería provocarlo (la capa de datos controla los topes antes de llamar);
 *    es un error inesperado, sin "Reintentar" (con los mismos parámetros daría lo mismo).
 *  - 42501: sin cuenta.
 *  - Red, timeout y servidor: los mensajes de siempre, con "Reintentar".
 */
export const RESUMEN_ERROR_CONTEXT: DataErrorContext = {
  invalidData: RESUMEN_ERROR_INESPERADO,
  permission: RESUMEN_SIN_CUENTA,
};

/** El mensaje para mostrar de cualquier error de un bloque del Resumen. */
export function mensajeErrorResumen(error: unknown): string {
  return mapDataError(error, RESUMEN_ERROR_CONTEXT);
}

/**
 * El front iba a llamar a una función del Resumen con un período que la base rechazaría con 22023 (fechas inválidas,
 * desde > hasta, más días o meses que el tope). No se llama: es un error de programación, sin "Reintentar" (daría lo
 * mismo), con el mismo mensaje que un 22023.
 */
export class ResumenParametrosInvalidosError extends UserMessageError {
  readonly rpc: string;
  readonly motivo: string;

  constructor(rpc: string, motivo: string) {
    super(RESUMEN_ERROR_INESPERADO, { retryable: false });
    this.name = 'ResumenParametrosInvalidosError';
    this.rpc = rpc;
    this.motivo = motivo;
  }
}

/**
 * La base respondió algo que no cumple el contrato de la 014 (una columna faltante, un número que no es número, un grupo
 * desconocido, un nulo donde no puede haberlo…). Nunca se devuelven datos a medias: el bloque entero muestra el error.
 * El motivo (`rpc`, `motivo`) es interno, para depurar; a la pantalla llega `RESUMEN_ERROR_INESPERADO`. Se puede
 * reintentar (puede haber sido algo de paso, como un proxy).
 */
export class ResumenRespuestaInesperadaError extends UserMessageError {
  readonly rpc: string;
  readonly motivo: string;

  constructor(rpc: string, motivo: string) {
    super(RESUMEN_ERROR_INESPERADO, { retryable: true });
    this.name = 'ResumenRespuestaInesperadaError';
    this.rpc = rpc;
    this.motivo = motivo;
  }
}
