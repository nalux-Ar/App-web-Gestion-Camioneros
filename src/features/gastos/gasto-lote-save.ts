import type { NewRow } from '@/lib/db';
import { isUuid } from '@/lib/uuid';
import { isClientRefDuplicate } from './client-ref';
import { MAX_GASTOS_POR_CARGA } from './constants';
import { buildInsertRow, fingerprintOf, type GastoColumns } from './gasto-form';
import { LoteDeGastosDistintoError, LoteDeGastosInvalidoError } from './gasto-lote-errores';
import type { GastoWriteIO } from './gasto-save';

/**
 * Guardar VARIOS gastos NUEVOS de una vez (uno por categoría) con idempotencia (`client_ref` POR gasto) y todo-o-nada. Lógica
 * pura: la escritura real se inyecta (`io`), así se puede probar sin Supabase. Es `crearGasto` (gasto-save.ts) para N gastos.
 *
 * Por qué un solo pedido: un INSERT de N filas es UNA sentencia, es decir una sola transacción: o quedan los N gastos o ninguno.
 * Con un INSERT por gasto, una señal que se corta a la mitad dejaría algunos guardados y otros no, y no habría forma de saber
 * cuáles. Y como el pedido es atómico, un 23505 del `client_ref` significa que el intento anterior SÍ llegó y existen TODOS.
 */

export interface GastoLoteWriteIO {
  /**
   * UN solo INSERT con todas las filas. Tira el error si falla (con el `code` y el mensaje de PostgREST). O se guardan todas o
   * ninguna.
   */
  insertMany(rows: ReadonlyArray<NewRow<'gastos'>>): Promise<void>;
  /** El mismo UPDATE por `client_ref` de un gasto solo (nunca manda `client_ref`; tira `RecordNotFoundError` si no afectó ninguna fila). */
  updateByClientRef: GastoWriteIO['updateByClientRef'];
}

/**
 * - `creados`: el INSERT salió bien (quedaron todos).
 * - `ya-guardados`: el INSERT dio «ya existe ese client_ref» y lo que se mandó antes es lo mismo que hay en pantalla: los gastos ya
 *   estaban guardados tal cual. Éxito, no error.
 * - `ya-guardados-actualizados`: ya existían, pero el usuario cambió datos entre intentos: se actualizó CADA gasto con lo que hay
 *   en pantalla.
 */
export type CrearGastosResultado = 'creados' | 'ya-guardados' | 'ya-guardados-actualizados';

/** Un gasto de la carga con SU clave de idempotencia. */
export interface GastoParaGuardar {
  columns: GastoColumns;
  /** Uno distinto por gasto; lo genera y lo guarda quien llama (estable entre reintentos), acá no se regenera. */
  clientRef: string;
}

interface CrearGastosArgs {
  /** Entre 1 y `MAX_GASTOS_POR_CARGA`, cada uno con su `client_ref` (uuid, sin repetir). */
  items: readonly GastoParaGuardar[];
  /**
   * Huellas de TODO lo que se mandó a la base con estos `client_ref` (INSERT o UPDATE), aunque no se haya confirmado: un pedido sin
   * respuesta pudo haberse aplicado. Cada huella incluye QUÉ `client_ref` se mandaron y el contenido de cada gasto. Vive mientras
   * vive el formulario y se vacía al regenerar los `client_ref`. Esta función la modifica.
   */
  sent: Set<string>;
  io: GastoLoteWriteIO;
}

/** Separa, dentro de una huella, el conjunto de `client_ref` del contenido (`JSON.stringify` nunca escribe un salto de línea crudo). */
const SEPARADOR = '\n';

function porClientRef(a: GastoParaGuardar, b: GastoParaGuardar): number {
  return a.clientRef < b.clientRef ? -1 : a.clientRef > b.clientRef ? 1 : 0;
}

/**
 * Huella de un pedido: los `client_ref` y, ligado a cada uno, lo que se mandó. Ordenada por `client_ref`: no depende del orden en
 * que estén los gastos, solo de QUÉ se manda con qué clave.
 */
function huellaDelLote(items: readonly GastoParaGuardar[]): string {
  const ordenados = [...items].sort(porClientRef);
  const refs = JSON.stringify(ordenados.map((item) => item.clientRef));
  const contenido = JSON.stringify(ordenados.map((item) => fingerprintOf(item.columns)));
  return `${refs}${SEPARADOR}${contenido}`;
}

/** El conjunto de `client_ref` de una huella. Si no tiene el formato (no es de un lote) da algo que no coincide con ninguno: falla seguro. */
function refsDeLaHuella(huella: string): string {
  const fin = huella.indexOf(SEPARADOR);
  return fin === -1 ? '' : huella.slice(0, fin);
}

/**
 * Lo que tiene que cumplir un pedido para que la idempotencia valga, revisado ANTES de tocar la red. Que no haya dos gastos con el
 * mismo `client_ref` (comparado sin distinguir mayúsculas: la base trata `ABC…` y `abc…` como el mismo uuid) es lo más importante:
 * con uno repetido, el INSERT chocaría con el índice único del `client_ref` y se leería como «ya estaban guardados» sin haber
 * guardado nada.
 */
function revisarItems(items: readonly GastoParaGuardar[]): void {
  if (items.length === 0) throw new LoteDeGastosInvalidoError('vacio');
  if (items.length > MAX_GASTOS_POR_CARGA) throw new LoteDeGastosInvalidoError('demasiadas');
  if (!items.every((item) => isUuid(item.clientRef))) throw new LoteDeGastosInvalidoError('client-ref-invalido');
  if (new Set(items.map((item) => item.clientRef.toLowerCase())).size !== items.length) {
    throw new LoteDeGastosInvalidoError('client-ref-repetido');
  }
}

/**
 * INSERT de todos los gastos en UN pedido, cada uno con su `client_ref`. Si la base dice que ese `client_ref` ya existe (23505 del
 * índice único), el pedido anterior SÍ llegó y existen TODOS (el pedido es atómico):
 *
 *  - si lo único que se mandó hasta ahora (en todos los intentos) es lo mismo que hay en pantalla, no hace falta nada más;
 *  - si en algún intento se mandó otra cosa (el usuario cambió datos entre intentos), las filas guardadas pueden tener esos datos
 *    viejos: se hace un UPDATE por `client_ref` de CADA gasto con lo actual. Son N pedidos y no una sola transacción, pero es seguro:
 *    es conservador a propósito, y si uno falla (red) el próximo reintento vuelve a actualizarlos TODOS en vez de dar por bueno un
 *    estado que no se confirmó.
 *
 * Cualquier otro error (incluido otro 23505) se propaga tal cual, también el `RecordNotFoundError` de un UPDATE sin filas.
 *
 * Defensa en profundidad: si ya se mandó (sin confirmar) un pedido con OTROS `client_ref` que los de ahora (se destildó o se agregó
 * una categoría después de un intento sin respuesta), tira `LoteDeGastosDistintoError` ANTES de tocar la red y sin anotar nada en
 * `sent`: un gasto del intento anterior pudo haberse guardado y quedaría escondido. La pantalla lo evita bloqueando las categorías;
 * esto no depende de eso.
 *
 * Tira `LoteDeGastosInvalidoError` (también antes de tocar la red) si no hay gastos, hay más de `MAX_GASTOS_POR_CARGA` o los
 * `client_ref` no son uuid distintos.
 */
export async function crearGastos({ items, sent, io }: CrearGastosArgs): Promise<CrearGastosResultado> {
  revisarItems(items);

  const huella = huellaDelLote(items);
  const refs = refsDeLaHuella(huella);
  for (const anterior of sent) {
    if (refsDeLaHuella(anterior) !== refs) throw new LoteDeGastosDistintoError();
  }

  sent.add(huella);

  try {
    await io.insertMany(items.map(({ columns, clientRef }) => buildInsertRow(columns, clientRef)));
    return 'creados';
  } catch (error) {
    if (!isClientRefDuplicate(error)) throw error;
  }

  const sameAsEverythingSent = sent.size === 1 && sent.has(huella);
  if (sameAsEverythingSent) return 'ya-guardados';

  // Uno por uno y en orden: si falla alguno se corta ahí y el reintento los repite todos (actualizar con lo mismo no hace daño).
  for (const { columns, clientRef } of items) {
    await io.updateByClientRef(clientRef, columns);
  }
  return 'ya-guardados-actualizados';
}
