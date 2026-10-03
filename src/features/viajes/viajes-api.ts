import { supabase } from '@/lib/supabase';
import {
  DataRequestError,
  RecordNotFoundError,
  UserMessageError,
  isRetryableDataError,
  mapDataError,
} from '@/lib/data-errors';
import { unwrap, updatePayload, writeTimeoutSignal } from '@/lib/db';
import type { Database } from '@/lib/database.types';
import { acotarLista, type ListaAcotada } from '@/lib/lista-acotada';
import { ELIMINAR_VIAJE_CONTEXT, LIST_LIMIT, RECIENTES_LIMIT } from './constants';
import { textoBorradoIncompleto, textoConteoCambiado } from './eliminar-viaje-textos';
import type { ViajeOpcion } from './viaje-opciones';
import type { ActualizarViajeArgs, CrearViajeArgs, ViajeWriteIO } from './viaje-save';
import { aViajeDeLista, type FilaViajeDeLista, type ViajeDeLista } from './viajes-list';

/**
 * Acceso a datos de Viajes. Reglas (src/lib/db.ts):
 *  - LECTURAS: `.abortSignal(signal)` con la señal de TanStack; `unwrap()` para que un error no quede
 *    cacheado como éxito.
 *  - ESCRITURAS: `.abortSignal(writeTimeoutSignal())` (20 s). Alta y edición van por las funciones de la
 *    base (una sola transacción para el viaje y sus entregas): el cliente nunca manda `transportista_id` ni
 *    el `id` de una fila nueva. El borrado es un DELETE por id.
 *  - El filtro por tenant lo hace la base (RLS), no el front.
 */

// ---------------------------------------------------------------------------
// Lecturas
// ---------------------------------------------------------------------------

/**
 * Solo las columnas que usa la lista + la cantidad de entregas con un embed `entregas(count)`: sale en la
 * MISMA consulta, sin pedir nada por viaje. PostgREST devuelve `entregas: [{ count: n }]`.
 * OJO: el conteo embebido depende del soporte de agregados de PostgREST de la base; ver `aViajeDeLista`.
 */
const LIST_COLUMNS =
  'id, fecha, origen, destino, km_inicial, km_final, km_recorridos, ingreso, created_at, entregas(count)' as const;

export interface FetchViajesArgs {
  /** 'YYYY-MM-DD' inclusive. */
  desde: string;
  /** 'YYYY-MM-DD' EXCLUSIVO (primer día del mes siguiente). */
  hasta: string;
  signal: AbortSignal;
}

/** Viajes del rango, del más nuevo al más viejo (fecha desc, luego created_at desc), con tope. */
export async function fetchViajesDelRango({ desde, hasta, signal }: FetchViajesArgs): Promise<ListaAcotada<ViajeDeLista>> {
  const rows: FilaViajeDeLista[] = unwrap(
    await supabase
      .from('viajes')
      .select(LIST_COLUMNS)
      .gte('fecha', desde)
      .lt('fecha', hasta)
      .order('fecha', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(LIST_LIMIT + 1) // uno de más: así se sabe si se alcanzó el tope
      .abortSignal(signal),
  );
  const acotada = acotarLista(rows, LIST_LIMIT);
  return { items: acotada.items.map(aViajeDeLista), truncado: acotada.truncado };
}

/** Columnas del formulario de edición. Incluye `camion_id`: la edición lo pasa tal cual (si no, se borraría) y
 *  no incluye `client_ref` (solo se usa al crear). Las entregas vienen embebidas. */
const DETAIL_COLUMNS =
  'id, camion_id, fecha, origen, destino, km_inicial, km_final, km_recorridos, ingreso, observaciones, entregas(id, cliente_id, incidencias, created_at)' as const;

export interface EntregaDetalle {
  id: string;
  cliente_id: string;
  incidencias: string | null;
  created_at: string;
}

export interface ViajeDetalle {
  id: string;
  camion_id: string | null;
  fecha: string;
  origen: string;
  destino: string;
  km_inicial: number | null;
  km_final: number | null;
  km_recorridos: number | null;
  ingreso: number | null;
  observaciones: string | null;
  /** En el orden en que se cargaron: `(created_at, id)`. */
  entregas: EntregaDetalle[];
}

/**
 * Un viaje por id con sus entregas, o `null` si no existe (o no es de este transportista: la base no
 * distingue). Una sola consulta: las entregas van embebidas y ordenadas por `(created_at, id)`, que es
 * el orden de carga (la base no tiene columna de orden).
 */
export async function fetchViaje(id: string, signal: AbortSignal): Promise<ViajeDetalle | null> {
  return unwrap(
    await supabase
      .from('viajes')
      .select(DETAIL_COLUMNS)
      .eq('id', id)
      .order('created_at', { ascending: true, referencedTable: 'entregas' })
      .order('id', { ascending: true, referencedTable: 'entregas' })
      .abortSignal(signal)
      .maybeSingle(),
  );
}

/** Lo que necesita el selector "Viaje" del formulario de gastos (y nada más: es una consulta liviana). */
const OPCION_COLUMNS = 'id, fecha, origen, destino' as const;

/**
 * Los viajes más recientes del transportista (fecha desc, luego created_at desc), hasta `RECIENTES_LIMIT`,
 * para el selector del formulario de gastos. Sin filtro de mes: el gasto puede ser de un viaje de cualquier fecha.
 */
export async function fetchViajesRecientes(signal: AbortSignal): Promise<ViajeOpcion[]> {
  return unwrap(
    await supabase
      .from('viajes')
      .select(OPCION_COLUMNS)
      .order('fecha', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(RECIENTES_LIMIT)
      .abortSignal(signal),
  );
}

/** Un viaje por id para el selector (el que llega preseleccionado por `?viaje=` y no está entre los recientes),
 *  o `null` si no existe o no es de este transportista: la base no distingue. */
export async function fetchViajeOpcion(id: string, signal: AbortSignal): Promise<ViajeOpcion | null> {
  return unwrap(await supabase.from('viajes').select(OPCION_COLUMNS).eq('id', id).abortSignal(signal).maybeSingle());
}

/**
 * Columnas de la pantalla de solo lectura de un viaje. Las entregas vienen embebidas con el nombre del cliente
 * (`clientes(nombre)`, por la FK compuesta `entregas_cliente_fk`: PostgREST devuelve un objeto, o `null`).
 * No incluye `camion_id` ni `client_ref`: nada de esto se edita desde esta pantalla.
 */
const VISTA_COLUMNS =
  'id, fecha, origen, destino, km_inicial, km_final, km_recorridos, ingreso, observaciones, entregas(id, incidencias, created_at, clientes(nombre))' as const;

export interface EntregaVista {
  id: string;
  incidencias: string | null;
  created_at: string;
  clientes: { nombre: string } | null;
}

export interface ViajeVista {
  id: string;
  fecha: string;
  origen: string;
  destino: string;
  km_inicial: number | null;
  km_final: number | null;
  km_recorridos: number | null;
  ingreso: number | null;
  observaciones: string | null;
  /** En el orden en que se cargaron: `(created_at, id)`. */
  entregas: EntregaVista[];
}

/** Un viaje por id con sus entregas y los clientes, o `null` si no existe (o no es de este transportista: la base
 *  no distingue). Una sola consulta; las entregas van ordenadas por `(created_at, id)`, el orden de carga. */
export async function fetchViajeVista(id: string, signal: AbortSignal): Promise<ViajeVista | null> {
  return unwrap(
    await supabase
      .from('viajes')
      .select(VISTA_COLUMNS)
      .eq('id', id)
      .order('created_at', { ascending: true, referencedTable: 'entregas' })
      .order('id', { ascending: true, referencedTable: 'entregas' })
      .abortSignal(signal)
      .maybeSingle(),
  );
}

/**
 * Cuántos gastos tiene vinculados un viaje, sin traer las filas (`count: 'exact'` + `head: true`). Lo usa la
 * confirmación de borrar el viaje.
 */
export async function contarGastosDelViaje(viajeId: string, signal: AbortSignal): Promise<number> {
  const { count, error, status } = await supabase
    .from('gastos')
    .select('id', { count: 'exact', head: true })
    .eq('viaje_id', viajeId)
    .abortSignal(signal);
  if (error !== null) throw new DataRequestError(error, status);
  // Con `count: 'exact'` siempre viene un número; otra cosa es una respuesta inesperada (el llamador la trata como "no se pudo contar").
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) {
    throw new DataRequestError({ message: 'Respuesta inesperada del conteo de gastos del viaje' });
  }
  return count;
}

// ---------------------------------------------------------------------------
// Escrituras
// ---------------------------------------------------------------------------

type RpcArgs<Nombre extends 'crear_viaje_con_entregas' | 'actualizar_viaje_con_entregas'> =
  Database['public']['Functions'][Nombre]['Args'];

/**
 * Los tipos generados (`database.types.ts`) no admiten `null` en los parámetros opcionales de
 * `crear_viaje_con_entregas` ni en los de `actualizar_viaje_con_entregas` (que son obligatorios y tienen
 * que poder vaciarse con `null`), aunque la base sí los acepta. Por eso `CrearViajeArgs` y
 * `ActualizarViajeArgs` (viaje-save.ts) están tipados a mano y acá se convierten a lo que espera
 * `supabase.rpc`: este es el ÚNICO lugar donde se afloja el tipo, y solo para esa diferencia de `null`.
 * Los nombres de los parámetros no se pueden equivocar sin que falle algo: una prueba compara las claves
 * con las generadas, y la base falla fuerte (PGRST202) con un nombre desconocido.
 */
function comoArgsDeCrear(args: CrearViajeArgs): RpcArgs<'crear_viaje_con_entregas'> {
  return args as RpcArgs<'crear_viaje_con_entregas'>;
}

function comoArgsDeActualizar(args: ActualizarViajeArgs): RpcArgs<'actualizar_viaje_con_entregas'> {
  return args as RpcArgs<'actualizar_viaje_con_entregas'>;
}

/** Las dos funciones de guardado para `crearViaje` / `actualizarViaje` (src/features/viajes/viaje-save.ts). */
export const viajeWriteIO: ViajeWriteIO = {
  async crear(args) {
    const rows = unwrap(
      await supabase.rpc('crear_viaje_con_entregas', comoArgsDeCrear(args)).abortSignal(writeTimeoutSignal()),
    );
    // La función devuelve UNA fila `{ viaje_id, creado }`. Otra forma de respuesta es inesperada: se tira como un error
    // genérico y reintentable (reintentar es seguro: el `client_ref` hace el alta idempotente).
    const fila = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
    if (!fila || typeof fila.viaje_id !== 'string' || typeof fila.creado !== 'boolean') {
      throw new DataRequestError({ message: 'Respuesta inesperada de crear_viaje_con_entregas' });
    }
    return { viajeId: fila.viaje_id, creado: fila.creado };
  },
  async actualizar(args) {
    unwrap(await supabase.rpc('actualizar_viaje_con_entregas', comoArgsDeActualizar(args)).abortSignal(writeTimeoutSignal()));
  },
};

/**
 * Borrado por id. Borrar un viaje borra en cascada sus entregas y devoluciones. 0 filas = el viaje ya no
 * existe → `RecordNotFoundError` (para un borrado es lo mismo que éxito: el llamador lo trata así). Con
 * gastos vinculados la base responde 23503 (`gastos_viaje_fk`, RESTRICT): como el borrado desde la pantalla
 * pasa siempre por `eliminarViajeDesvinculandoGastos`, solo puede ser una carrera; se traduce por el
 * contexto del borrado (`ELIMINAR_VIAJE_CONTEXT`).
 */
export async function eliminarViaje(id: string): Promise<void> {
  const rows = unwrap(await supabase.from('viajes').delete().eq('id', id).select('id').abortSignal(writeTimeoutSignal()));
  if (rows.length === 0) throw new RecordNotFoundError();
}

/**
 * Paso 1 de borrar un viaje: `update gastos set viaje_id = null where viaje_id = <id>`. Los gastos se
 * CONSERVAN, solo pierden el vínculo. Idempotente: sin gastos vinculados no toca nada. La base no puede
 * hacerlo sola (`gastos_viaje_fk` es ON DELETE RESTRICT: un SET NULL en una FK compuesta anularía también
 * `transportista_id`), así que lo hace el cliente justo antes del DELETE.
 */
export async function desvincularGastosDelViaje(id: string): Promise<number> {
  const rows = unwrap(
    await supabase
      .from('gastos')
      .update(updatePayload<'gastos'>({ viaje_id: null }))
      .eq('viaje_id', id)
      .select('id')
      .abortSignal(writeTimeoutSignal()),
  );
  return rows.length;
}

/**
 * Borrar un viaje, SIEMPRE en dos pasos (sin importar cuántos gastos tenga): (1) desvincular sus gastos y
 * (2) borrar el viaje. Los dos son idempotentes: si se corta entre uno y otro el viaje sigue existiendo (con sus
 * gastos ya sin vínculo) y reintentar completa el borrado sin duplicar nada. Un 23503 en el paso 2 solo
 * puede ser una carrera (alguien vinculó un gasto entre los dos pasos): repetir los dos pasos lo resuelve.
 *
 * `gastosMostrados`: la cantidad que la confirmación le mostró al usuario (null si no se pudo contar). Justo
 * antes del paso 1 se vuelve a contar y, si ya no coincide, no se toca nada (`UserMessageError` con el número
 * nuevo): así se desvincula lo que el usuario vio, aunque la confirmación haya quedado abierta mucho tiempo.
 * Queda una ventana de milisegundos entre ese conteo y el UPDATE; un gasto vinculado justo ahí también se
 * desvincula (se conserva, solo pierde el vínculo).
 *
 * Si el paso 1 desvinculó gastos y el paso 2 falla, el error lo dice ("los N gastos ya quedaron sin viaje, pero
 * el viaje no se borró"), con el mismo "Reintentar" que tenía el error original.
 */
export async function eliminarViajeDesvinculandoGastos(id: string, gastosMostrados: number | null): Promise<void> {
  if (gastosMostrados !== null) {
    const ahora = await contarGastosDelViaje(id, writeTimeoutSignal());
    if (ahora !== gastosMostrados) throw new UserMessageError(textoConteoCambiado(ahora), { retryable: true });
  }

  const desvinculados = await desvincularGastosDelViaje(id);
  try {
    await eliminarViaje(id);
  } catch (error) {
    if (error instanceof RecordNotFoundError || desvinculados === 0) throw error;
    throw new UserMessageError(textoBorradoIncompleto(desvinculados, mapDataError(error, ELIMINAR_VIAJE_CONTEXT)), {
      retryable: isRetryableDataError(error, ELIMINAR_VIAJE_CONTEXT),
      cause: error,
    });
  }
}
