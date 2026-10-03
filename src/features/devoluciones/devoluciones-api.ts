import { RecordNotFoundError } from '@/lib/data-errors';
import {
  insertPayload,
  unwrap,
  updatePayload,
  writeTimeoutSignal,
  type MotivoDevolucion,
  type NewRow,
  type RowChanges,
} from '@/lib/db';
import { acotarLista, type ListaAcotada } from '@/lib/lista-acotada';
import { supabase } from '@/lib/supabase';
import { LIST_LIMIT } from './constants';
import type { DevolucionWriteIO } from './devolucion-save';

/**
 * Acceso a datos de Devoluciones. Reglas (src/lib/db.ts):
 *  - LECTURAS: `.abortSignal(signal)` con la señal de TanStack; `unwrap()` para que un error no quede cacheado como éxito.
 *  - ESCRITURAS: `.abortSignal(writeTimeoutSignal())` (20 s); `insertPayload` / `updatePayload` (nunca `id` ni
 *    `transportista_id`; `client_ref` solo en el INSERT).
 *  - El filtro por tenant lo hace la base (RLS), no el front.
 */

// ---------------------------------------------------------------------------
// Lecturas
// ---------------------------------------------------------------------------

/**
 * Lo que muestra una fila del detalle del viaje: el motivo, la descripción y el cliente. El nombre del cliente viene
 * embebido (`clientes(nombre)`, por la FK compuesta `devoluciones_cliente_fk`: PostgREST devuelve un objeto, o `null`).
 * No lleva fecha: es la del viaje.
 */
const LIST_COLUMNS = 'id, motivo, descripcion, cliente_id, created_at, clientes(nombre)' as const;

export interface DevolucionDeLista {
  id: string;
  motivo: MotivoDevolucion;
  descripcion: string | null;
  cliente_id: string;
  created_at: string;
  clientes: { nombre: string } | null;
}

/**
 * Las devoluciones de UN viaje, de la más nueva a la más vieja (`created_at` desc, luego `id` desc: orden estable), con
 * tope: se piden `LIST_LIMIT + 1` y, si vino una de más, la lista es parcial.
 */
export async function fetchDevolucionesDelViaje(viajeId: string, signal: AbortSignal): Promise<ListaAcotada<DevolucionDeLista>> {
  const rows: DevolucionDeLista[] = unwrap(
    await supabase
      .from('devoluciones')
      .select(LIST_COLUMNS)
      .eq('viaje_id', viajeId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(LIST_LIMIT + 1) // una de más: así se sabe si se alcanzó el tope
      .abortSignal(signal),
  );
  return acotarLista(rows, LIST_LIMIT);
}

/** Columnas del formulario de edición (no incluye `client_ref`: no se usa al editar). */
const DETAIL_COLUMNS = 'id, viaje_id, cliente_id, motivo, descripcion' as const;

export interface DevolucionDetalle {
  id: string;
  viaje_id: string;
  cliente_id: string;
  motivo: MotivoDevolucion;
  descripcion: string | null;
}

/**
 * Una devolución por id Y por viaje, o `null` si no existe, es de OTRO viaje o es de otro transportista: la base no
 * distingue ninguno de los tres casos y la pantalla tampoco (sin oráculo).
 */
export async function fetchDevolucion(id: string, viajeId: string, signal: AbortSignal): Promise<DevolucionDetalle | null> {
  return unwrap(
    await supabase
      .from('devoluciones')
      .select(DETAIL_COLUMNS)
      .eq('id', id)
      .eq('viaje_id', viajeId)
      .abortSignal(signal)
      .maybeSingle(),
  );
}

// ---------------------------------------------------------------------------
// Escrituras
// ---------------------------------------------------------------------------

/** INSERT / UPDATE por client_ref para `crearDevolucion` (src/features/devoluciones/devolucion-save.ts). */
export const devolucionWriteIO: DevolucionWriteIO = {
  async insert(row: NewRow<'devoluciones'>) {
    // Sin .select(): no hace falta devolver la fila (y el INSERT no depende de la policy de lectura).
    unwrap(await supabase.from('devoluciones').insert(insertPayload<'devoluciones'>(row)).abortSignal(writeTimeoutSignal()));
  },
  async updateByClientRef(clientRef: string, changes: RowChanges<'devoluciones'>) {
    const rows = unwrap(
      await supabase
        .from('devoluciones')
        .update(updatePayload<'devoluciones'>(changes))
        .eq('client_ref', clientRef)
        .select('id')
        .abortSignal(writeTimeoutSignal()),
    );
    if (rows.length === 0) throw new RecordNotFoundError();
  },
};

/** Edición: UPDATE por id (nunca upsert). 0 filas = la devolución ya no existe → `RecordNotFoundError`. */
export async function actualizarDevolucion(id: string, changes: RowChanges<'devoluciones'>): Promise<void> {
  const rows = unwrap(
    await supabase
      .from('devoluciones')
      .update(updatePayload<'devoluciones'>(changes))
      .eq('id', id)
      .select('id')
      .abortSignal(writeTimeoutSignal()),
  );
  if (rows.length === 0) throw new RecordNotFoundError();
}

/** Borrado por id. Devuelve cuántas filas borró: 0 = ya no estaba (el llamador lo trata como éxito). */
export async function eliminarDevolucion(id: string): Promise<number> {
  const rows = unwrap(
    await supabase.from('devoluciones').delete().eq('id', id).select('id').abortSignal(writeTimeoutSignal()),
  );
  return rows.length;
}
