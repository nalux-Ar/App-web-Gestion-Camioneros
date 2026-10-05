import { supabase } from '@/lib/supabase';
import { DataRequestError, RecordNotFoundError } from '@/lib/data-errors';
import { insertPayload, unwrap, updatePayload, writeTimeoutSignal, type MotivoDevolucion, type NewRow } from '@/lib/db';
import { acotarLista, type ListaAcotada } from '@/lib/lista-acotada';
import type { ClienteColumns, ClienteDatos } from './cliente-form';
import { ordenarClientes, type ClienteOpcion } from './cliente-nombre';
import type { ClienteWriteIO } from './cliente-save';
import { DETALLE_LIMIT } from './constants';

/**
 * Acceso a datos de Clientes. Reglas (src/lib/db.ts):
 *  - LECTURAS: `.abortSignal(signal)` con la señal de TanStack; `unwrap()` para que un error no quede cacheado como éxito.
 *  - ESCRITURAS: `.abortSignal(writeTimeoutSignal())` (20 s); `insertPayload` / `updatePayload` (nunca `id` ni
 *    `transportista_id`; `client_ref` solo en el INSERT). Ediciones por UPDATE, nunca upsert.
 *  - El filtro por tenant lo hace la base (RLS), no el front.
 */

// ---------------------------------------------------------------------------
// Lecturas
// ---------------------------------------------------------------------------

/** Tope de clientes que trae la lista. Se pide uno más para saber si se alcanzó. */
export const CLIENTES_LIMIT = 500;

/**
 * Clientes del transportista por nombre. La base ordena por `nombre, id` (así el corte del tope es
 * determinista) y acá se reordena en español sin distinguir mayúsculas ni tildes, que PostgREST no
 * puede pedir (`order` no acepta `lower(nombre)`).
 */
export async function fetchClientes(signal: AbortSignal): Promise<ListaAcotada<ClienteOpcion>> {
  const rows = unwrap(
    await supabase
      .from('clientes')
      .select('id, nombre')
      .order('nombre', { ascending: true })
      .order('id', { ascending: true })
      .limit(CLIENTES_LIMIT + 1) // uno de más: así se sabe si se alcanzó el tope
      .abortSignal(signal),
  );
  const acotada = acotarLista<ClienteOpcion>(rows, CLIENTES_LIMIT);
  return { items: ordenarClientes(acotada.items), truncado: acotada.truncado };
}

/** Las columnas de un cliente que muestran el detalle y el formulario de edición (no incluye `client_ref`: solo se usa al crear). */
const CLIENTE_COLUMNS = 'id, nombre, contacto_telefono, contacto_email, direccion' as const;

export interface ClienteDetalle {
  id: string;
  nombre: string;
  contacto_telefono: string | null;
  contacto_email: string | null;
  direccion: string | null;
}

/** Un cliente por id, o `null` si no existe (o no es de este transportista: la base no distingue, y la pantalla tampoco). */
export async function fetchCliente(id: string, signal: AbortSignal): Promise<ClienteDetalle | null> {
  return unwrap(await supabase.from('clientes').select(CLIENTE_COLUMNS).eq('id', id).abortSignal(signal).maybeSingle());
}

/**
 * Los viajes de un cliente con sus entregas a él: `entregas!inner(...)` + el filtro `entregas.cliente_id` hacen que
 * PostgREST traiga SOLO los viajes que tienen al menos una entrega de ese cliente, cada viaje UNA sola vez aunque el
 * cliente tenga dos entregas en él (un viaje puede repetir cliente), y que embeba solo las entregas de ese cliente (con sus
 * incidencias). El tope corta viajes, no entregas.
 */
const VIAJES_DEL_CLIENTE_COLUMNS = 'id, fecha, origen, destino, entregas!inner(id, incidencias)' as const;

export interface ViajeDelCliente {
  id: string;
  /** 'YYYY-MM-DD' */
  fecha: string;
  origen: string;
  destino: string;
  /** Las entregas de ESTE cliente en el viaje (una o más). */
  entregas: Array<{ id: string; incidencias: string | null }>;
}

/** Los viajes de un cliente, del más nuevo al más viejo (fecha, created_at e id desc: orden estable), con tope. */
export async function fetchViajesDelCliente(clienteId: string, signal: AbortSignal): Promise<ListaAcotada<ViajeDelCliente>> {
  const rows: ViajeDelCliente[] = unwrap(
    await supabase
      .from('viajes')
      .select(VIAJES_DEL_CLIENTE_COLUMNS)
      .eq('entregas.cliente_id', clienteId)
      .order('fecha', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(DETALLE_LIMIT + 1) // uno de más: así se sabe si se alcanzó el tope
      .abortSignal(signal),
  );
  return acotarLista(rows, DETALLE_LIMIT);
}

/**
 * Las devoluciones de un cliente con su viaje embebido (`viajes!inner(...)`, por la FK compuesta `devoluciones_viaje_fk`: el
 * viaje llega siempre como un objeto). Misma forma que la lista de un mes de la pestaña Devoluciones, sin el cliente (es el
 * de la pantalla) y sin rango de fechas.
 */
const DEVOLUCIONES_DEL_CLIENTE_COLUMNS = 'id, motivo, descripcion, viaje_id, created_at, viajes!inner(fecha, origen, destino)' as const;

export interface DevolucionDelCliente {
  id: string;
  motivo: MotivoDevolucion;
  descripcion: string | null;
  viaje_id: string;
  created_at: string;
  /** El viaje de la devolución: su fecha es la de la devolución (no tiene fecha propia). */
  viajes: { fecha: string; origen: string; destino: string };
}

/**
 * Las devoluciones de un cliente, más nueva primero, con tope. El orden se hace EN LA BASE por la fecha del viaje
 * (`order=viajes(fecha).desc,created_at.desc,id.desc`, igual que la pestaña Devoluciones): así el tope corta lo más reciente
 * de verdad. La columna va con la forma `viajes(fecha)` y SIN `referencedTable` (que ordenaría solo las filas embebidas).
 */
export async function fetchDevolucionesDelCliente(
  clienteId: string,
  signal: AbortSignal,
): Promise<ListaAcotada<DevolucionDelCliente>> {
  const rows: DevolucionDelCliente[] = unwrap(
    await supabase
      .from('devoluciones')
      .select(DEVOLUCIONES_DEL_CLIENTE_COLUMNS)
      .eq('cliente_id', clienteId)
      .order('viajes(fecha)', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(DETALLE_LIMIT + 1) // una de más: así se sabe si se alcanzó el tope
      .abortSignal(signal),
  );
  return acotarLista(rows, DETALLE_LIMIT);
}

/** Cuántas entregas y cuántas devoluciones tiene un cliente: lo que impide borrarlo (RESTRICT). */
export interface ConteosDelCliente {
  entregas: number;
  devoluciones: number;
}

/** Con `count: 'exact'` siempre viene un número; otra cosa es una respuesta inesperada ("no se pudo contar"). */
function numeroDeConteo(count: number | null, que: 'entregas' | 'devoluciones'): number {
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) {
    throw new DataRequestError({ message: `Respuesta inesperada del conteo de ${que} del cliente` });
  }
  return count;
}

/** Cuántas entregas tiene un cliente, sin traer las filas (`count: 'exact'` + `head: true`). */
export async function contarEntregasDelCliente(clienteId: string, signal: AbortSignal): Promise<number> {
  const { count, error, status } = await supabase
    .from('entregas')
    .select('id', { count: 'exact', head: true })
    .eq('cliente_id', clienteId)
    .abortSignal(signal);
  if (error !== null) throw new DataRequestError(error, status);
  return numeroDeConteo(count, 'entregas');
}

/** Cuántas devoluciones tiene un cliente, sin traer las filas (`count: 'exact'` + `head: true`). */
export async function contarDevolucionesDelCliente(clienteId: string, signal: AbortSignal): Promise<number> {
  const { count, error, status } = await supabase
    .from('devoluciones')
    .select('id', { count: 'exact', head: true })
    .eq('cliente_id', clienteId)
    .abortSignal(signal);
  if (error !== null) throw new DataRequestError(error, status);
  return numeroDeConteo(count, 'devoluciones');
}

/**
 * Los DOS conteos que pide la confirmación de borrar un cliente, pedidos a la vez. Si cualquiera falla, falla todo: el
 * llamador lo trata como "no se pudo contar" (nunca un número a medias).
 */
export async function contarDelCliente(clienteId: string, signal: AbortSignal): Promise<ConteosDelCliente> {
  const [entregas, devoluciones] = await Promise.all([
    contarEntregasDelCliente(clienteId, signal),
    contarDevolucionesDelCliente(clienteId, signal),
  ]);
  return { entregas, devoluciones };
}

// ---------------------------------------------------------------------------
// Escrituras
// ---------------------------------------------------------------------------

/** Lo que devuelven las escrituras de un alta: el id y el nombre (lo que necesita quien crea el cliente para usarlo). */
const ALTA_COLUMNS = 'id, nombre' as const;

/** INSERT, lectura y UPDATE por `client_ref` para `crearClienteIdempotente` (src/features/clientes/cliente-save.ts). */
export const clienteWriteIO: ClienteWriteIO = {
  async insertar(fila: NewRow<'clientes'>) {
    return unwrap(
      await supabase
        .from('clientes')
        .insert(insertPayload<'clientes'>(fila))
        .select(ALTA_COLUMNS)
        .abortSignal(writeTimeoutSignal())
        .single(),
    );
  },
  async leerPorClientRef(clientRef: string) {
    // Es parte de un guardado (no hay señal de TanStack): lleva el timeout de escritura. RLS la acota al tenant.
    return unwrap(
      await supabase
        .from('clientes')
        .select(ALTA_COLUMNS)
        .eq('client_ref', clientRef)
        .abortSignal(writeTimeoutSignal())
        .maybeSingle(),
    );
  },
  async actualizarPorClientRef(clientRef: string, datos: ClienteDatos) {
    const rows = unwrap(
      await supabase
        .from('clientes')
        .update(updatePayload<'clientes'>(datos))
        .eq('client_ref', clientRef)
        .select(ALTA_COLUMNS)
        .abortSignal(writeTimeoutSignal()),
    );
    const [cliente] = rows;
    if (cliente === undefined) throw new RecordNotFoundError();
    return cliente;
  },
};

/**
 * Edición: UPDATE por id (nunca upsert) con TODAS las columnas del formulario (un `null` vacía el dato). Nunca manda
 * `client_ref` (`updatePayload` lo quita: es inmutable). 0 filas = el cliente ya no existe → `RecordNotFoundError`.
 */
export async function actualizarCliente(id: string, columns: ClienteColumns): Promise<void> {
  const rows = unwrap(
    await supabase
      .from('clientes')
      .update(updatePayload<'clientes'>(columns))
      .eq('id', id)
      .select('id')
      .abortSignal(writeTimeoutSignal()),
  );
  if (rows.length === 0) throw new RecordNotFoundError();
}

/**
 * Borrado por id. Devuelve cuántas filas borró: 0 = ya no estaba (el llamador lo trata como éxito). Un cliente con
 * entregas o devoluciones no se borra: la base responde 23503 (PostgreSQL 17) o 23001 (PostgreSQL 18) y no toca nada;
 * el mensaje lo pone `ELIMINAR_CLIENTE_CONTEXT`.
 */
export async function eliminarCliente(id: string): Promise<number> {
  const rows = unwrap(await supabase.from('clientes').delete().eq('id', id).select('id').abortSignal(writeTimeoutSignal()));
  return rows.length;
}
