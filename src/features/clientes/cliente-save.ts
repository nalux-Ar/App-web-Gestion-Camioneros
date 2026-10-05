import { isClientRefDuplicate } from '@/features/gastos/client-ref';
import { RecordNotFoundError } from '@/lib/data-errors';
import type { NewRow } from '@/lib/db';
import type { ClienteOpcion } from './cliente-nombre';
import { buildInsertRow, fingerprintOf, type ClienteDatos } from './cliente-form';
import { CLIENTES_CLIENT_REF_CONSTRAINT } from './constants';

/**
 * Guardar un cliente NUEVO con idempotencia (`client_ref`, migración 009). Lógica pura: la escritura real se inyecta
 * (`io`), así se puede probar sin Supabase. Es el mismo patrón que `crearGasto` y `crearDevolucion`: con mala señal el
 * INSERT puede llegar a la base y perderse la respuesta; sin esto, "Reintentar" duplicaría el cliente.
 *
 * Lo usan el formulario de Clientes y el "+ Nuevo cliente" al vuelo del viaje. A diferencia de gastos y devoluciones, acá
 * hace falta el cliente guardado (su `id`): el alta al vuelo lo deja elegido en la entrega y el formulario navega a su
 * detalle. Por eso el INSERT devuelve la fila y, si el cliente ya estaba guardado, se lee (o se actualiza) por
 * `client_ref`: RLS acota esa lectura al propio transportista.
 */

export interface ClienteWriteIO {
  /** INSERT (con `client_ref`) que devuelve el id y el nombre que guardó la base. Tira el error si falla (con el `code` y el
   *  mensaje de PostgREST). */
  insertar(fila: NewRow<'clientes'>): Promise<ClienteOpcion>;
  /** El cliente ya guardado con ese `client_ref`, o `null` si ya no está. */
  leerPorClientRef(clientRef: string): Promise<ClienteOpcion | null>;
  /** UPDATE ... WHERE client_ref = ? con los datos; devuelve el id y el nombre. Tira `RecordNotFoundError` si no afectó
   *  ninguna fila. NUNCA debe mandar `client_ref` (es inmutable: el trigger rechaza el cambio con 42501). */
  actualizarPorClientRef(clientRef: string, datos: ClienteDatos): Promise<ClienteOpcion>;
}

/**
 * - `creado`: el INSERT salió bien.
 * - `ya-guardado`: el INSERT dio "ya existe ese client_ref" y lo que se mandó antes es lo mismo que hay en pantalla: el
 *   cliente ya estaba guardado tal cual. Éxito, no error.
 * - `ya-guardado-actualizado`: ya existía, pero el usuario cambió datos entre intentos: se actualizó con lo que hay en
 *   pantalla.
 */
export type CrearClienteTipo = 'creado' | 'ya-guardado' | 'ya-guardado-actualizado';

export interface CrearClienteResultado {
  tipo: CrearClienteTipo;
  /** El cliente guardado (id y nombre, tal como los devolvió la base). */
  cliente: ClienteOpcion;
}

interface CrearClienteArgs {
  datos: ClienteDatos;
  clientRef: string;
  /**
   * Huellas de TODO lo que se mandó a la base con este `clientRef` (INSERT o UPDATE), aunque no se haya confirmado: un
   * pedido sin respuesta pudo haberse aplicado. Vive mientras vive el formulario y se vacía al regenerar el `clientRef`.
   * Esta función la modifica.
   */
  sent: Set<string>;
  io: ClienteWriteIO;
}

/**
 * INSERT con `client_ref`. Si la base dice que ese `client_ref` ya existe (23505 de `clientes_transportista_client_ref_uidx`),
 * el cliente YA está guardado:
 *
 *  - si lo único que se mandó hasta ahora (en todos los intentos) es lo mismo que hay en pantalla, se lee por `client_ref`
 *    para tener su id (si entre tanto lo borraron, `RecordNotFoundError`: el próximo intento lo vuelve a crear, porque el
 *    índice ya quedó libre);
 *  - si en algún intento se mandó otra cosa (el usuario cambió datos entre intentos), la fila guardada puede tener esos
 *    datos viejos: se hace un UPDATE por `client_ref` con lo actual. Es conservador a propósito: si ese UPDATE falla (red),
 *    el próximo reintento vuelve a actualizar en vez de dar por bueno un estado que no se confirmó.
 *
 * Cualquier otro error (incluido un 23505 de otro índice) se propaga tal cual. Nunca upsert: el índice es parcial y
 * PostgREST no puede apuntar a un índice parcial en `on_conflict` (42P10).
 */
export async function crearClienteIdempotente({ datos, clientRef, sent, io }: CrearClienteArgs): Promise<CrearClienteResultado> {
  const fingerprint = fingerprintOf(datos);
  sent.add(fingerprint);

  try {
    return { tipo: 'creado', cliente: await io.insertar(buildInsertRow(datos, clientRef)) };
  } catch (error) {
    if (!isClientRefDuplicate(error, CLIENTES_CLIENT_REF_CONSTRAINT)) throw error;
  }

  const sameAsEverythingSent = sent.size === 1 && sent.has(fingerprint);
  if (sameAsEverythingSent) {
    const cliente = await io.leerPorClientRef(clientRef);
    if (cliente === null) throw new RecordNotFoundError();
    return { tipo: 'ya-guardado', cliente };
  }

  return { tipo: 'ya-guardado-actualizado', cliente: await io.actualizarPorClientRef(clientRef, datos) };
}
