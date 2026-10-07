import { supabase } from '@/lib/supabase';
import { DataRequestError, RecordNotFoundError } from '@/lib/data-errors';
import { unwrap, updatePayload, writeTimeoutSignal } from '@/lib/db';
import { acotarLista, type ListaAcotada } from '@/lib/lista-acotada';
import { ordenarCamiones, type CamionDeLista } from './camion';
import type { CamionColumns } from './camion-form';
import { CAMIONES_LIMIT } from './constants';

/**
 * Acceso a datos de Camiones. Reglas (src/lib/db.ts y migración 010):
 *  - LECTURAS: `.abortSignal(signal)` con la señal de TanStack; `unwrap()` para que un error no quede cacheado como éxito.
 *  - ALTA: SIEMPRE por la RPC `crear_camion` (normaliza la patente, es idempotente por patente y, si es el primer camión
 *    del tenant, le asigna los viajes y los gastos con litros cargados sin camión). Nunca un INSERT directo.
 *  - EDITAR, ARCHIVAR y REACTIVAR: UPDATE directo por id con `updatePayload` (nunca `id` ni `transportista_id`), la
 *    patente YA normalizada, `.select('id')` (0 filas = no existe o no es administrador) y `writeTimeoutSignal()`.
 *  - Sin DELETE desde la pantalla (v1: solo archivar).
 *  - El filtro por tenant lo hace la base (RLS), no el front. Un chofer LEE los camiones (los necesita para elegir) pero
 *    no escribe: `crear_camion` le da 42501 y un UPDATE le afecta 0 filas.
 */

// ---------------------------------------------------------------------------
// Lecturas
// ---------------------------------------------------------------------------

const COLUMNS = 'id, patente, marca, modelo, anio, activa' as const;

/** Todos los camiones del tenant (activos y archivados), por patente, con tope (uno de más para saber si se alcanzó). */
export async function fetchCamiones(signal: AbortSignal): Promise<ListaAcotada<CamionDeLista>> {
  const rows: CamionDeLista[] = unwrap(
    await supabase
      .from('camiones')
      .select(COLUMNS)
      .order('patente', { ascending: true })
      .order('id', { ascending: true })
      .limit(CAMIONES_LIMIT + 1)
      .abortSignal(signal),
  );
  const acotada = acotarLista(rows, CAMIONES_LIMIT);
  return { items: ordenarCamiones(acotada.items), truncado: acotada.truncado };
}

/** Un camión por id, o `null` si no existe (o es de otro transportista: la base no distingue, y la pantalla tampoco). */
export async function fetchCamion(id: string, signal: AbortSignal): Promise<CamionDeLista | null> {
  return unwrap(await supabase.from('camiones').select(COLUMNS).eq('id', id).abortSignal(signal).maybeSingle());
}

/** Con `count: 'exact'` siempre viene un número; otra cosa es una respuesta inesperada ("no se pudo contar"). */
function numeroDeConteo(count: number | null, que: string): number {
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) {
    throw new DataRequestError({ message: `Respuesta inesperada del conteo de ${que}` });
  }
  return count;
}

export interface ConteoSinCamion {
  /** Viajes sin camión. */
  viajes: number;
  /** Gastos CON litros sin camión (los demás gastos no se tocan: pueden ser gastos propios). */
  gastos: number;
}

/**
 * Lo que `crear_camion` le asignaría al PRIMER camión del tenant: los viajes sin camión y los gastos con litros sin camión.
 * Dos conteos sin traer filas (`count: 'exact'` + `head: true`), a la vez; si cualquiera falla, falla todo.
 */
export async function contarSinCamion(signal: AbortSignal): Promise<ConteoSinCamion> {
  const [viajes, gastos] = await Promise.all([
    (async () => {
      const { count, error, status } = await supabase
        .from('viajes')
        .select('id', { count: 'exact', head: true })
        .is('camion_id', null)
        .abortSignal(signal);
      if (error !== null) throw new DataRequestError(error, status);
      return numeroDeConteo(count, 'viajes sin camión');
    })(),
    (async () => {
      const { count, error, status } = await supabase
        .from('gastos')
        .select('id', { count: 'exact', head: true })
        .is('camion_id', null)
        .not('litros', 'is', null)
        .abortSignal(signal);
      if (error !== null) throw new DataRequestError(error, status);
      return numeroDeConteo(count, 'cargas sin camión');
    })(),
  ]);
  return { viajes, gastos };
}

/**
 * Cuántos gastos de un viaje pasarían al camión `camionId` si el viaje cambia a ese camión: los que tienen OTRO camión
 * (`neq` deja afuera los que no tienen camión, que la base no toca). Es lo que hace el trigger `fn_propagar_camion_viaje`.
 */
export async function contarGastosAMover(viajeId: string, camionId: string, signal: AbortSignal): Promise<number> {
  const { count, error, status } = await supabase
    .from('gastos')
    .select('id', { count: 'exact', head: true })
    .eq('viaje_id', viajeId)
    .neq('camion_id', camionId)
    .abortSignal(signal);
  if (error !== null) throw new DataRequestError(error, status);
  return numeroDeConteo(count, 'gastos del viaje');
}

// ---------------------------------------------------------------------------
// Escrituras
// ---------------------------------------------------------------------------

/** Lo que devuelve `crear_camion` (una fila). */
export interface ResultadoCrearCamion {
  camionId: string;
  /** false = ya existía un camión con esa patente en el tenant (reintento tras respuesta perdida, o patente repetida). */
  creado: boolean;
  viajesAsignados: number;
  gastosAsignados: number;
  /** false = ese camión existente está archivado. */
  activa: boolean;
}

/**
 * `crear_camion(p_patente, p_marca, p_modelo, p_anio)`. Los opcionales vacíos NO se mandan (quedan en su default `null`
 * en la base): así no hace falta forzar los tipos generados, que no admiten `null`. La patente va normalizada, aunque la
 * función normaliza sola.
 */
export async function crearCamion(columns: CamionColumns): Promise<ResultadoCrearCamion> {
  const rows = unwrap(
    await supabase
      .rpc('crear_camion', {
        p_patente: columns.patente,
        ...(columns.marca !== null ? { p_marca: columns.marca } : {}),
        ...(columns.modelo !== null ? { p_modelo: columns.modelo } : {}),
        ...(columns.anio !== null ? { p_anio: columns.anio } : {}),
      })
      .abortSignal(writeTimeoutSignal()),
  );
  // Una sola fila con esta forma; otra cosa es una respuesta inesperada (error genérico y reintentable: la función es
  // idempotente por patente, así que reintentar es seguro).
  const fila = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
  if (
    !fila ||
    typeof fila.camion_id !== 'string' ||
    typeof fila.creado !== 'boolean' ||
    typeof fila.activa !== 'boolean' ||
    !Number.isInteger(fila.viajes_asignados) ||
    !Number.isInteger(fila.gastos_asignados)
  ) {
    throw new DataRequestError({ message: 'Respuesta inesperada de crear_camion' });
  }
  return {
    camionId: fila.camion_id,
    creado: fila.creado,
    viajesAsignados: fila.viajes_asignados,
    gastosAsignados: fila.gastos_asignados,
    activa: fila.activa,
  };
}

/**
 * Edición: UPDATE por id con las cuatro columnas (la patente YA normalizada: si no, 23514). 0 filas = el camión no
 * existe, no es de este tenant o quien edita no es administrador → `RecordNotFoundError`.
 */
export async function actualizarCamion(id: string, columns: CamionColumns): Promise<void> {
  const rows = unwrap(
    await supabase
      .from('camiones')
      .update(updatePayload<'camiones'>({ patente: columns.patente, marca: columns.marca, modelo: columns.modelo, anio: columns.anio }))
      .eq('id', id)
      .select('id')
      .abortSignal(writeTimeoutSignal()),
  );
  if (rows.length === 0) throw new RecordNotFoundError();
}

/** Archivar (`activa` false) o reactivar (true). 0 filas → `RecordNotFoundError` (ídem edición). */
export async function cambiarActivaCamion(id: string, activa: boolean): Promise<void> {
  const rows = unwrap(
    await supabase
      .from('camiones')
      .update(updatePayload<'camiones'>({ activa }))
      .eq('id', id)
      .select('id')
      .abortSignal(writeTimeoutSignal()),
  );
  if (rows.length === 0) throw new RecordNotFoundError();
}

/** Cuántos camiones activos hay AHORA (fresco, sin traer filas): la regla de no archivar el único activo. */
export async function contarCamionesActivos(signal: AbortSignal): Promise<number> {
  const { count, error, status } = await supabase
    .from('camiones')
    .select('id', { count: 'exact', head: true })
    .eq('activa', true)
    .abortSignal(signal);
  if (error !== null) throw new DataRequestError(error, status);
  return numeroDeConteo(count, 'camiones activos');
}
