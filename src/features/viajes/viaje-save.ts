import type { EntregaDato, ViajeDatos } from './viaje-form';

/**
 * Guardar un viaje con sus entregas. Lógica pura: las llamadas reales a la base se inyectan (`io`), así se
 * puede probar sin Supabase.
 *
 * El viaje y sus entregas se guardan en UNA transacción con las funciones de la base de la migración 007
 * (`crear_viaje_con_entregas` y `actualizar_viaje_con_entregas`): con llamadas sueltas, una señal que se
 * corta a mitad de camino dejaría un viaje sin entregas (o con la mitad).
 */

// ---------------------------------------------------------------------------
// Argumentos de las funciones (tipados a mano)
// ---------------------------------------------------------------------------

/**
 * Una entrega dentro de `p_entregas`. Es un `type` (no una `interface`) a propósito: así es asignable a
 * `Json`. `id` solo existe para una entrega que YA está en la base (se actualiza en vez de crearse de
 * nuevo); una nueva va sin esa clave. Cualquier otra clave (`transportista_id`, `viaje_id`…) la ignora la
 * base: el cliente nunca decide el tenant ni el id de una fila nueva.
 */
export type EntregaPayload = { id?: string; cliente_id: string; incidencias: string | null };

/**
 * Argumentos de `crear_viaje_con_entregas`.
 *
 * Por qué a mano: los tipos de `src/lib/database.types.ts` los genera Supabase y marcan los parámetros
 * opcionales como `number | undefined` (sin `null`), pero la base sí acepta `null` (el default de esos
 * parámetros es `null`). Acá se manda `null` explícito para vaciar un campo. No lleva `p_camion_id`: en
 * el alta no se manda (queda en el default `null`).
 */
export interface CrearViajeArgs {
  p_client_ref: string;
  p_fecha: string;
  p_origen: string;
  p_destino: string;
  p_km_inicial: number | null;
  p_km_final: number | null;
  p_km_recorridos: number | null;
  p_observaciones: string | null;
  p_ingreso: number | null;
  p_entregas: EntregaPayload[];
}

/**
 * Argumentos de `actualizar_viaje_con_entregas`: un REEMPLAZO COMPLETO, así que TODOS son obligatorios
 * (`null` explícito para vaciar un campo; si falta uno la base responde PGRST202 en vez de borrar datos
 * sin avisar).
 *
 * Por qué a mano: los tipos generados declaran estos parámetros como `number` / `string` a secas, sin
 * `null`, aunque la base los acepta (la columna admite NULL y el reemplazo completo necesita vaciarla).
 * `viaje-save.test.ts` comprueba en compilación que las claves coinciden con las generadas: si la base
 * cambia una firma y se regeneran los tipos, deja de compilar y hay que revisar esto.
 */
export interface ActualizarViajeArgs {
  p_viaje_id: string;
  p_fecha: string;
  p_origen: string;
  p_destino: string;
  /** El camión que el viaje YA tenía (null si no tenía). Mandar `null` siempre lo borraría sin querer. */
  p_camion_id: string | null;
  p_km_inicial: number | null;
  p_km_final: number | null;
  p_km_recorridos: number | null;
  p_observaciones: string | null;
  p_ingreso: number | null;
  p_entregas: EntregaPayload[];
}

export interface ViajeWriteIO {
  /** `crear_viaje_con_entregas`. Tira el error si falla (con el `code` de PostgREST). */
  crear(args: CrearViajeArgs): Promise<{ viajeId: string; creado: boolean }>;
  /** `actualizar_viaje_con_entregas`. Tira el error si falla. */
  actualizar(args: ActualizarViajeArgs): Promise<void>;
}

// ---------------------------------------------------------------------------
// Armado de los argumentos
// ---------------------------------------------------------------------------

/** Las entregas en el orden en que se cargaron (la base no tiene columna de orden: conserva el de la lista).
 *  Las nuevas van sin `id`; las que ya existían, con su `id`. */
export function buildEntregasPayload(entregas: readonly EntregaDato[]): EntregaPayload[] {
  return entregas.map((entrega) =>
    entrega.id === null
      ? { cliente_id: entrega.cliente_id, incidencias: entrega.incidencias }
      : { id: entrega.id, cliente_id: entrega.cliente_id, incidencias: entrega.incidencias },
  );
}

/** Alta: lo ya validado + el `client_ref`. Las entregas van sin `id` (en el alta la base lo ignora). */
export function buildCrearArgs({ columns, entregas }: ViajeDatos, clientRef: string): CrearViajeArgs {
  return {
    p_client_ref: clientRef,
    p_fecha: columns.fecha,
    p_origen: columns.origen,
    p_destino: columns.destino,
    p_km_inicial: columns.km_inicial,
    p_km_final: columns.km_final,
    p_km_recorridos: columns.km_recorridos,
    p_observaciones: columns.observaciones,
    p_ingreso: columns.ingreso,
    p_entregas: buildEntregasPayload(entregas.map((entrega) => ({ ...entrega, id: null }))),
  };
}

/** Edición: reemplazo completo. `camionId` es el que el viaje ya tenía (se pasa tal cual). */
export function buildActualizarArgs(viajeId: string, camionId: string | null, { columns, entregas }: ViajeDatos): ActualizarViajeArgs {
  return {
    p_viaje_id: viajeId,
    p_fecha: columns.fecha,
    p_origen: columns.origen,
    p_destino: columns.destino,
    p_camion_id: camionId,
    p_km_inicial: columns.km_inicial,
    p_km_final: columns.km_final,
    p_km_recorridos: columns.km_recorridos,
    p_observaciones: columns.observaciones,
    p_ingreso: columns.ingreso,
    p_entregas: buildEntregasPayload(entregas),
  };
}

/**
 * Huella de lo que se mandó al crear (orden fijo de claves): sirve para saber si entre dos intentos de
 * guardar el usuario cambió algo (ver `crearViaje`). Las entregas cuentan por cliente e incidencias, en
 * orden; los `id` y las claves locales no entran (en el alta ninguna entrega tiene `id`).
 */
export function fingerprintOf({ columns, entregas }: ViajeDatos): string {
  return JSON.stringify([
    columns.fecha,
    columns.origen,
    columns.destino,
    columns.km_inicial,
    columns.km_final,
    columns.km_recorridos,
    columns.observaciones,
    columns.ingreso,
    entregas.map((entrega) => [entrega.cliente_id, entrega.incidencias]),
  ]);
}

// ---------------------------------------------------------------------------
// Alta idempotente
// ---------------------------------------------------------------------------

/**
 * - `creado`: se creó el viaje con sus entregas.
 * - `ya-guardado`: el viaje YA estaba guardado (un intento anterior llegó a la base aunque se perdió la
 *   respuesta) y lo que se mandó antes es lo mismo que hay en pantalla. Éxito, no error.
 * - `ya-guardado-actualizado`: ya existía, pero el usuario cambió datos entre intentos: se actualizó con
 *   lo que hay en pantalla.
 */
export type CrearViajeResultado = 'creado' | 'ya-guardado' | 'ya-guardado-actualizado';

interface CrearViajeArgsFlow {
  datos: ViajeDatos;
  clientRef: string;
  /**
   * Huellas de TODO lo que se mandó a la base con este `clientRef`, aunque no se haya confirmado: un
   * pedido sin respuesta pudo haberse aplicado. Vive mientras vive el formulario y se vacía al regenerar
   * el `clientRef`. Esta función la modifica.
   */
  sent: Set<string>;
  io: ViajeWriteIO;
}

/**
 * `crear_viaje_con_entregas` con `client_ref`. La función de la base es idempotente: si ese `client_ref`
 * ya existe devuelve el viaje existente con `creado = false` y NO reaplica nada (ni valida lo recibido).
 * Desde `crear` nunca sale un 23505.
 *
 *  - Si lo único que se mandó hasta ahora (en todos los intentos) es lo mismo que hay en pantalla, el
 *    viaje ya está guardado tal cual: no hace falta nada más.
 *  - Si en algún intento se mandó otra cosa (el usuario cambió datos entre intentos), el viaje guardado
 *    puede tener esos datos viejos: se llama a `actualizar_viaje_con_entregas` con ese `viaje_id` y lo
 *    actual. Las entregas van sin `id`: la función borra las que no vengan y crea las nuevas, y el
 *    resultado queda igual a lo que se ve. Es conservador a propósito: si ese UPDATE falla (red), el
 *    próximo reintento vuelve a actualizar en vez de dar por bueno un estado que no se confirmó.
 *
 * Nunca upsert. Cualquier error se propaga tal cual (con su `code`) para que `mapDataError` lo traduzca.
 */
export async function crearViaje({ datos, clientRef, sent, io }: CrearViajeArgsFlow): Promise<CrearViajeResultado> {
  const fingerprint = fingerprintOf(datos);
  sent.add(fingerprint);

  const { viajeId, creado } = await io.crear(buildCrearArgs(datos, clientRef));
  if (creado) return 'creado';

  const sameAsEverythingSent = sent.size === 1 && sent.has(fingerprint);
  if (sameAsEverythingSent) return 'ya-guardado';

  // El viaje lo creó este mismo formulario sin camión: `p_camion_id` = null es lo que ya tiene.
  await io.actualizar(buildActualizarArgs(viajeId, null, datos));
  return 'ya-guardado-actualizado';
}

// ---------------------------------------------------------------------------
// Edición
// ---------------------------------------------------------------------------

interface ActualizarViajeArgsFlow {
  viajeId: string;
  /** El `camion_id` que el viaje ya tenía (leído del detalle), tal cual. Si era null, null. */
  camionId: string | null;
  datos: ViajeDatos;
  io: ViajeWriteIO;
}

/**
 * Reemplazo completo del viaje y sus entregas. "Último guardado gana" entre pestañas: la función de la
 * base serializa los guardados del mismo viaje (lock de la fila) y deja la lista de entregas exactamente
 * como se manda; si otra pestaña agregó una entrega que esta no tiene, se borra. El único aviso que da la
 * base es P0002 cuando el viaje (o una entrega con `id`) ya no está.
 */
export async function actualizarViaje({ viajeId, camionId, datos, io }: ActualizarViajeArgsFlow): Promise<void> {
  await io.actualizar(buildActualizarArgs(viajeId, camionId, datos));
}
