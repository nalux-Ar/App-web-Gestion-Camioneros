import { UserMessageError, isRetryableDataError } from '@/lib/data-errors';
import type { CamionColumns } from './camion-form';
import type { ResultadoCrearCamion } from './camiones-api';

/**
 * Alta de un camión por `crear_camion` y qué hacer con lo que devuelve. Lógica PURA: las llamadas reales se inyectan
 * (`io`), así se prueba sin Supabase. La usan el formulario de Camiones y el "+ Nuevo camión" del bloque Combustible.
 *
 * `crear_camion` es idempotente por patente: si ya hay un camión con esa patente en el tenant, lo devuelve con
 * `creado = false` sin tocar nada. Eso pasa en dos casos que para la persona son MUY distintos:
 *  - Reintento tras una respuesta perdida: el primer intento SÍ creó el camión (con mala señal se cortó la respuesta). Es
 *    éxito: el camión es el que la persona acaba de cargar.
 *  - Patente repetida: ya había un camión con esa patente desde antes (activo, o archivado: ahí se ofrece reactivarlo).
 * Se distinguen por la DUDA: una patente cuyo intento anterior falló con un error reintentable (red, timeout) queda
 * anotada; si al reintentar vuelve `creado = false` y activo, es el reintento. Sin duda, es una patente repetida.
 */

export interface AltaCamionIO {
  crear(columns: CamionColumns): Promise<ResultadoCrearCamion>;
  /** UPDATE de las columnas (para dejar la marca, el modelo y el año de lo que está en pantalla tras un reintento). */
  actualizar(id: string, columns: CamionColumns): Promise<void>;
}

/** Lo que hay que recordar entre intentos del MISMO formulario. `altaCamion` lo modifica. */
export interface AltaCamionEstado {
  /** Patentes (normalizadas) cuyo último intento falló sin saber si llegó a la base. */
  patentesEnDuda: Set<string>;
  /**
   * Por cada patente en duda, la huella de las columnas (patente, marca, modelo y año) de CADA intento que falló sin saber si
   * llegó. Sirve para no pisar un camión que ya existía: ver `altaCamion`.
   */
  enviadosEnDuda: Map<string, Set<string>>;
}

export function estadoInicialAltaCamion(): AltaCamionEstado {
  return { patentesEnDuda: new Set(), enviadosEnDuda: new Map() };
}

function olvidarDudas(estado: AltaCamionEstado): void {
  estado.patentesEnDuda.clear();
  estado.enviadosEnDuda.clear();
}

/** Huella de lo que se manda: dos intentos con la misma huella dejarían el camión igual. */
function huellaDe(columns: CamionColumns): string {
  return JSON.stringify([columns.patente, columns.marca, columns.modelo, columns.anio]);
}

export type AltaCamionResultado =
  /** Se creó. Si era el primero del tenant, `viajesAsignados` / `gastosAsignados` dicen cuántos registros se le asignaron. */
  | { tipo: 'creado'; camionId: string; viajesAsignados: number; gastosAsignados: number }
  /** Ya lo había creado un intento anterior (respuesta perdida): éxito. Lo asignado en ese intento no se sabe. */
  | { tipo: 'ya-guardado'; camionId: string }
  /** Ya había un camión con esa patente, de antes. `activa` false = está archivado (se ofrece reactivarlo). */
  | { tipo: 'duplicado'; camionId: string; activa: boolean };

export async function altaCamion({
  columns,
  estado,
  io,
}: {
  columns: CamionColumns;
  estado: AltaCamionEstado;
  io: AltaCamionIO;
}): Promise<AltaCamionResultado> {
  let resultado: ResultadoCrearCamion;
  try {
    resultado = await io.crear(columns);
  } catch (error) {
    // Con red, timeout o servidor el camión pudo haberse creado igual: se anota la duda. Con un error que da lo mismo
    // reintentando (patente inválida, sin permiso) no se creó.
    if (isRetryableDataError(error)) {
      estado.patentesEnDuda.add(columns.patente);
      const huellas = estado.enviadosEnDuda.get(columns.patente) ?? new Set<string>();
      huellas.add(huellaDe(columns));
      estado.enviadosEnDuda.set(columns.patente, huellas);
    }
    throw error;
  }

  if (resultado.creado) {
    olvidarDudas(estado);
    return {
      tipo: 'creado',
      camionId: resultado.camionId,
      viajesAsignados: resultado.viajesAsignados,
      gastosAsignados: resultado.gastosAsignados,
    };
  }

  if (resultado.activa && estado.patentesEnDuda.has(columns.patente)) {
    // Probablemente es el camión que creó el intento anterior, pero la respuesta no distingue eso de un camión que YA
    // existía con esa patente (por ejemplo, el primer intento se cortó antes de llegar a la base). Por eso solo se
    // actualiza si lo que hay en pantalla es DISTINTO de lo mandado en los intentos dudosos: si es lo mismo, el camión
    // (si era el nuestro) ya tiene esos valores y no hay nada que escribir; actualizar con valores iguales a los del
    // intento perdido pisaría, si era uno viejo, su marca, modelo y año con lo que se tipeó (o con vacío).
    // Si hubo más de un intento dudoso con valores distintos, el camión puede haber quedado con los de cualquiera: se
    // actualiza. Si este UPDATE falla, la duda sigue y el próximo reintento vuelve a llegar acá.
    const mandados = estado.enviadosEnDuda.get(columns.patente);
    const igualALoMandado = mandados !== undefined && mandados.size === 1 && mandados.has(huellaDe(columns));
    if (!igualALoMandado) await io.actualizar(resultado.camionId, columns);
    olvidarDudas(estado);
    return { tipo: 'ya-guardado', camionId: resultado.camionId };
  }

  return { tipo: 'duplicado', camionId: resultado.camionId, activa: resultado.activa };
}

export const UNICO_ACTIVO_MESSAGE = 'Es tu único camión activo: primero carga el camión que lo reemplaza.';

/**
 * Regla SOLO del front (la base no la impone): no se archiva el único camión activo. Se cuenta FRESCO justo antes de
 * archivar (`contarActivos`), no con la lista en caché: si otro dispositivo archivó otro camión, la lista de la pantalla
 * estaría vieja. Tira un `UserMessageError` (no reintentable) si el camión es el único activo.
 */
export async function verificarPuedeArchivar(contarActivos: () => Promise<number>): Promise<void> {
  const activos = await contarActivos();
  if (activos <= 1) throw new UserMessageError(UNICO_ACTIVO_MESSAGE, { retryable: false });
}
