import { supabase } from '@/lib/supabase';
import {
  insertPayload,
  unwrap,
  updatePayload,
  writeTimeoutSignal,
  type MetodoPago,
  type NewRow,
  type RowChanges,
} from '@/lib/db';
import { RecordNotFoundError } from '@/lib/data-errors';
import { LIST_LIMIT } from './constants';
import type { Categoria } from './categorias';
import type { ViajeOpcion } from '@/features/viajes/viaje-opciones';
import type { GastoWriteIO } from './gasto-save';
import { acotarLista, type ListaAcotada } from './gastos-list';

/**
 * Acceso a datos de Gastos. Reglas (src/lib/db.ts):
 *  - LECTURAS: `.abortSignal(signal)` con la señal de TanStack; `unwrap()` para que un error no
 *    quede cacheado como éxito.
 *  - ESCRITURAS: `.abortSignal(writeTimeoutSignal())` (20 s); `insertPayload` / `updatePayload`
 *    (nunca `id` ni `transportista_id`; `client_ref` solo en el INSERT).
 *  - El filtro por tenant lo hace la base (RLS), no el front.
 */

// ---------------------------------------------------------------------------
// Lecturas
// ---------------------------------------------------------------------------

/** Las columnas propias del gasto que muestra una fila de lista. */
const FILA_COLUMNS = 'id, categoria_id, fecha, monto, descripcion, litros, created_at' as const;

/**
 * Las de la lista de un mes: las de la fila + el viaje al que está vinculado (`viaje_id` y el embed
 * `viajes(origen, destino)` por la FK compuesta `gastos_viaje_fk`: PostgREST devuelve un objeto, o `null` si el
 * gasto no tiene viaje).
 */
const LIST_COLUMNS = `${FILA_COLUMNS}, viaje_id, viajes(origen, destino)` as const;

/**
 * Columnas del formulario de edición (no incluye `client_ref`: no se usa al editar). Con el viaje vinculado
 * embebido (`viajes(id, fecha, origen, destino)`): así el selector del formulario lo ofrece aunque ya no esté
 * entre los viajes recientes y abrir el gasto no pierde el vínculo.
 */
const DETAIL_COLUMNS =
  'id, categoria_id, fecha, monto, descripcion, metodo_pago, litros, precio_por_litro, km_odometro, tanque_lleno, viaje_id, viajes(id, fecha, origen, destino)' as const;

/** Lo que tiene una fila de gasto en cualquier lista (la de un mes o la de un viaje). */
export interface GastoDeFila {
  id: string;
  categoria_id: string;
  fecha: string;
  monto: number;
  descripcion: string | null;
  litros: number | null;
  created_at: string;
}

/** El recorrido del viaje vinculado, para mostrarlo en la fila. */
export interface ViajeDeGasto {
  origen: string;
  destino: string;
}

export interface GastoDeLista extends GastoDeFila {
  viaje_id: string | null;
  viajes: ViajeDeGasto | null;
}

export interface FetchGastosArgs {
  /** 'YYYY-MM-DD' inclusive. */
  desde: string;
  /** 'YYYY-MM-DD' EXCLUSIVO (primer día del mes siguiente). */
  hasta: string;
  categoriaId: string | null;
  signal: AbortSignal;
}

/** Gastos del rango, del más nuevo al más viejo (fecha desc, luego created_at desc), con tope. */
export async function fetchGastosDelRango({
  desde,
  hasta,
  categoriaId,
  signal,
}: FetchGastosArgs): Promise<ListaAcotada<GastoDeLista>> {
  let query = supabase.from('gastos').select(LIST_COLUMNS).gte('fecha', desde).lt('fecha', hasta);
  if (categoriaId) query = query.eq('categoria_id', categoriaId);

  const rows = unwrap(
    await query
      .order('fecha', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(LIST_LIMIT + 1) // uno de más: así se sabe si se alcanzó el tope
      .abortSignal(signal),
  );
  return acotarLista<GastoDeLista>(rows);
}

export type GastoDetalle = {
  id: string;
  categoria_id: string;
  fecha: string;
  monto: number;
  descripcion: string | null;
  metodo_pago: MetodoPago | null;
  litros: number | null;
  precio_por_litro: number | null;
  km_odometro: number | null;
  tanque_lleno: boolean | null;
  viaje_id: string | null;
  /** El viaje vinculado (embebido), o `null` si no tiene. Lleva lo necesario para ofrecerlo en el selector. */
  viajes: ViajeOpcion | null;
};

/** Un gasto por id, o `null` si no existe (o no es de este transportista: la base no distingue). */
export async function fetchGasto(id: string, signal: AbortSignal): Promise<GastoDetalle | null> {
  return unwrap(await supabase.from('gastos').select(DETAIL_COLUMNS).eq('id', id).abortSignal(signal).maybeSingle());
}

/** Todas las categorías visibles (globales + propias), activas o no: la lista necesita el nombre de las inactivas. */
export async function fetchCategorias(signal: AbortSignal): Promise<Categoria[]> {
  return unwrap(
    await supabase
      .from('categorias_gasto')
      .select('id, nombre, activa, transportista_id')
      .order('nombre', { ascending: true })
      .abortSignal(signal),
  );
}

/**
 * Los gastos de UN viaje, del más nuevo al más viejo (fecha desc, luego created_at desc), con tope: se piden
 * `LIST_LIMIT + 1` y, si vino uno de más, la lista (y el total que se calcule sobre ella) es parcial.
 */
export async function fetchGastosDelViaje(viajeId: string, signal: AbortSignal): Promise<ListaAcotada<GastoDeFila>> {
  const rows = unwrap(
    await supabase
      .from('gastos')
      .select(FILA_COLUMNS)
      .eq('viaje_id', viajeId)
      .order('fecha', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(LIST_LIMIT + 1)
      .abortSignal(signal),
  );
  return acotarLista<GastoDeFila>(rows);
}

// ---------------------------------------------------------------------------
// Escrituras
// ---------------------------------------------------------------------------

/** INSERT / UPDATE por client_ref para `crearGasto` (src/features/gastos/gasto-save.ts). */
export const gastoWriteIO: GastoWriteIO = {
  async insert(row: NewRow<'gastos'>) {
    // Sin .select(): no hace falta devolver la fila (y el INSERT no depende de la policy de lectura).
    unwrap(await supabase.from('gastos').insert(insertPayload<'gastos'>(row)).abortSignal(writeTimeoutSignal()));
  },
  async updateByClientRef(clientRef: string, changes: RowChanges<'gastos'>) {
    const rows = unwrap(
      await supabase
        .from('gastos')
        .update(updatePayload<'gastos'>(changes))
        .eq('client_ref', clientRef)
        .select('id')
        .abortSignal(writeTimeoutSignal()),
    );
    if (rows.length === 0) throw new RecordNotFoundError();
  },
};

/** Edición: UPDATE por id (nunca upsert). 0 filas = el gasto ya no existe → `RecordNotFoundError`. */
export async function actualizarGasto(id: string, changes: RowChanges<'gastos'>): Promise<void> {
  const rows = unwrap(
    await supabase
      .from('gastos')
      .update(updatePayload<'gastos'>(changes))
      .eq('id', id)
      .select('id')
      .abortSignal(writeTimeoutSignal()),
  );
  if (rows.length === 0) throw new RecordNotFoundError();
}

/** Borrado por id. Devuelve cuántas filas borró: 0 = ya no estaba (el llamador lo trata como éxito). */
export async function eliminarGasto(id: string): Promise<number> {
  const rows = unwrap(
    await supabase.from('gastos').delete().eq('id', id).select('id').abortSignal(writeTimeoutSignal()),
  );
  return rows.length;
}
