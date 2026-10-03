import { supabase } from '@/lib/supabase';
import { insertPayload, unwrap, writeTimeoutSignal } from '@/lib/db';
import { acotarLista, type ListaAcotada } from '@/lib/lista-acotada';
import { ordenarClientes, type ClienteOpcion } from './cliente-nombre';

/**
 * Acceso a datos de Clientes (mínimo: lo que necesita el selector de un viaje). Reglas (src/lib/db.ts):
 *  - LECTURAS: `.abortSignal(signal)` con la señal de TanStack; `unwrap()`.
 *  - ESCRITURAS: `.abortSignal(writeTimeoutSignal())` y `insertPayload` (nunca `id` ni `transportista_id`:
 *    los pone la base).
 *  - El filtro por tenant lo hace la base (RLS), no el front.
 */

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

/**
 * Crea un cliente solo con el nombre (ya validado y recortado). Devuelve la fila que guardó la base.
 *
 * NO es idempotente: la tabla no tiene `client_ref`. Un reintento después de un fallo de red puede
 * duplicar; quien llama (`altaCliente`) refresca la lista y verifica antes de reintentar.
 */
export async function crearCliente(nombre: string): Promise<ClienteOpcion> {
  return unwrap(
    await supabase
      .from('clientes')
      .insert(insertPayload<'clientes'>({ nombre }))
      .select('id, nombre')
      .abortSignal(writeTimeoutSignal())
      .single(),
  );
}
