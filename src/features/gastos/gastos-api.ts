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
import { DataRequestError, RecordNotFoundError } from '@/lib/data-errors';
import { isValidDateString } from '@/lib/dates';
import { isUuid } from '@/lib/uuid';
import { LIST_LIMIT, MAX_GASTOS_POR_VEZ } from './constants';
import type { Categoria } from './categorias';
import type { ViajeOpcion } from '@/features/viajes/viaje-opciones';
import type { GastoWriteIO } from './gasto-save';
import { acotarLista, type ListaAcotada } from './gastos-list';
import {
  idsDistintos,
  mezclarCandidatos,
  parsearIdsQuitados,
  parsearResultadosVinculo,
  type Candidatos,
  type ResultadoDeGasto,
} from './sumar-gastos';

/**
 * Acceso a datos de Gastos. Reglas (src/lib/db.ts):
 *  - LECTURAS: `.abortSignal(signal)` con la señal de TanStack; `unwrap()` para que un error no
 *    quede cacheado como éxito.
 *  - ESCRITURAS: `.abortSignal(writeTimeoutSignal())` (20 s); `insertPayload` / `updatePayload`
 *    (nunca `id` ni `transportista_id`; `client_ref` solo en el INSERT). Sumar varios gastos a un viaje va por la función
 *    de la base `vincular_gastos_a_viaje` (migración 019), que tampoco recibe `transportista_id`.
 *  - El filtro por tenant lo hace la base (RLS), no el front.
 */

// ---------------------------------------------------------------------------
// Lecturas
// ---------------------------------------------------------------------------

/** Las columnas propias del gasto que muestra una fila de lista. */
/** Con `camion_id` (la patente se muestra desde la lista de camiones ya cargada, sin embeber `camiones(...)`). */
const FILA_COLUMNS = 'id, categoria_id, fecha, monto, descripcion, litros, camion_id, created_at' as const;

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
  'id, categoria_id, fecha, monto, descripcion, metodo_pago, litros, precio_por_litro, km_odometro, tanque_lleno, viaje_id, camion_id, viajes(id, fecha, origen, destino, camion_id)' as const;

/** Lo que tiene una fila de gasto en cualquier lista (la de un mes o la de un viaje). */
export interface GastoDeFila {
  id: string;
  categoria_id: string;
  fecha: string;
  monto: number;
  descripcion: string | null;
  litros: number | null;
  /** El camión de la carga (null si no tiene). */
  camion_id?: string | null;
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
  /** El camión de la carga (null si no tiene). */
  camion_id: string | null;
  /** El viaje vinculado (embebido, con su camión), o `null` si no tiene. Lleva lo necesario para ofrecerlo en el selector. */
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

export interface FetchGastosSueltosArgs {
  /** La fecha del viaje, 'YYYY-MM-DD': los candidatos se ordenan por cercanía a ella. */
  fechaViaje: string;
  signal: AbortSignal;
}

/** Cuántos gastos se piden de CADA lado de la fecha del viaje: el tope más uno (el de más dice si había más). */
const SUELTOS_POR_LADO = MAX_GASTOS_POR_VEZ + 1;

/**
 * Los gastos SIN viaje (`viaje_id is null`) de un lado de la fecha del viaje, los más cercanos a ella primero: `desde` son los
 * de esa fecha en adelante (fecha ascendente) y `antes` los anteriores (fecha descendente). Dentro de una misma fecha, el
 * creado más tarde primero y, por último, el `id`: el mismo desempate que `ordenarPorCercania`, para que el corte en el tope
 * sea siempre el mismo aunque haya gastos con la misma fecha y el mismo `created_at` (los que se crean juntos en una sola
 * sentencia lo comparten).
 */
async function leerSueltosDeUnLado(lado: 'desde' | 'antes', fechaViaje: string, signal: AbortSignal): Promise<GastoDeFila[]> {
  const sueltos = supabase.from('gastos').select(FILA_COLUMNS).is('viaje_id', null);
  const delLado =
    lado === 'desde'
      ? sueltos.gte('fecha', fechaViaje).order('fecha', { ascending: true })
      : sueltos.lt('fecha', fechaViaje).order('fecha', { ascending: false });
  return unwrap(
    await delLado
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .limit(SUELTOS_POR_LADO)
      .abortSignal(signal),
  );
}

/**
 * Los gastos que se pueden SUMAR a un viaje: los que no tienen viaje, los `MAX_GASTOS_POR_VEZ` más cercanos a la fecha del
 * viaje (y, a igual distancia, el de fecha más reciente), SIN ventana de días: un gasto lejano también se ofrece.
 *
 * PostgREST no puede ordenar por «distancia en días» (no es una columna), así que son DOS consultas en paralelo, una de la
 * fecha del viaje en adelante y otra de los anteriores, cada una con `MAX_GASTOS_POR_VEZ + 1` filas; `mezclarCandidatos` las
 * junta, las ordena y dice si había más. Si cualquiera de las dos falla, falla todo: nunca se devuelve un lado solo (la lista
 * parecería completa y no lo sería). Es una lectura: usa la señal de TanStack, no el timeout de escritura.
 *
 * `fechaViaje` inválida tira `RangeError` ANTES de pedir nada.
 */
export async function fetchGastosSueltos({ fechaViaje, signal }: FetchGastosSueltosArgs): Promise<Candidatos<GastoDeFila>> {
  if (!isValidDateString(fechaViaje)) {
    throw new RangeError('La fecha del viaje tiene que ser una fecha válida con formato AAAA-MM-DD.');
  }
  const [posteriores, anteriores] = await Promise.all([
    leerSueltosDeUnLado('desde', fechaViaje, signal),
    leerSueltosDeUnLado('antes', fechaViaje, signal),
  ]);
  return mezclarCandidatos(posteriores, anteriores, fechaViaje);
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

export type MotivoSeleccionInvalida = 'vacia' | 'demasiados' | 'id-invalido' | 'viaje-invalido';

/**
 * Lo que se quiso sumar o quitar no se puede enviar: no hay ningún gasto, hay más de `MAX_GASTOS_POR_VEZ` distintos, alguno no
 * es un uuid, o el id del viaje no es un uuid. Se rechaza ANTES de tocar la red (la base respondería lo mismo: 22023, o 22P02
 * con un id que no es uuid). La pantalla no tendría que dejarlo pasar (sin selección el botón no se puede tocar, la selección se
 * corta en 100 y los ids salen de filas de la base o de la URL ya validada): si llega acá es un error de programación, no algo
 * que el usuario pueda arreglar reintentando.
 *
 * Es un `DataRequestError` con el MISMO código que usaría la base (`22023`): `classifyDataError` lo toma como «datos
 * inválidos», `mapDataError` le da el mensaje de siempre para esa clase y NO se reintenta, igual que si lo hubiera rechazado el
 * servidor. El `message` es interno y fijo (sin ningún dato recibido): nunca se muestra.
 */
const MENSAJES_DE_SELECCION_INVALIDA: Record<MotivoSeleccionInvalida, string> = {
  vacia: 'No hay ningún gasto en la selección',
  demasiados: `Hay más de ${MAX_GASTOS_POR_VEZ} gastos distintos en la selección`,
  'id-invalido': 'Algún id de la selección no es un uuid',
  'viaje-invalido': 'El id del viaje no es un uuid',
};

export class SeleccionDeGastosInvalidaError extends DataRequestError {
  readonly motivo: MotivoSeleccionInvalida;

  constructor(motivo: MotivoSeleccionInvalida) {
    super({
      message: MENSAJES_DE_SELECCION_INVALIDA[motivo],
      code: '22023',
    });
    this.name = 'SeleccionDeGastosInvalidaError';
    this.motivo = motivo;
  }
}

/**
 * Los ids que se mandan: sin repetir (en el orden de la primera aparición), entre 1 y `MAX_GASTOS_POR_VEZ`, y todos uuid. El
 * tope se mide sobre los DISTINTOS: lo que se manda ya va sin repetidos, que es lo que cuenta la base. Que sean uuid cubre algo
 * más que la prolijidad: `.in('id', ids)` arma el filtro de la URL con los ids tal cual (postgrest-js solo les pone comillas si
 * traen una coma o un paréntesis, y no escapa las comillas), así que un id con caracteres de más podría colar valores en la lista.
 *
 * Se valida PRIMERO que todos sean uuid y recién después se juntan los repetidos y se cuentan: `idsDistintos` supone texto, y
 * con algo que no lo es (solo posible saltándose TypeScript) tiraría un `TypeError`, que se clasificaría como `unknown` y
 * ofrecería «Reintentar» algo que nunca va a funcionar. Tira `SeleccionDeGastosInvalidaError`.
 */
function seleccionParaEnviar(gastoIds: readonly string[]): string[] {
  if (!gastoIds.every((id) => isUuid(id))) throw new SeleccionDeGastosInvalidaError('id-invalido');
  const ids = idsDistintos(gastoIds);
  if (ids.length === 0) throw new SeleccionDeGastosInvalidaError('vacia');
  if (ids.length > MAX_GASTOS_POR_VEZ) throw new SeleccionDeGastosInvalidaError('demasiados');
  return ids;
}

/**
 * El id del viaje que se manda: tiene que ser un uuid. Era lo único que salía a la red sin validar. No es explotable (postgrest-js
 * lo codifica en la URL), pero acá solo puede llegar algo que no es uuid por un error de programación: se corta con el mismo
 * error y la misma clase que un id de gasto inválido, en vez de dejar que la base conteste. Tira `SeleccionDeGastosInvalidaError`.
 */
function viajeParaEnviar(viajeId: string): string {
  if (!isUuid(viajeId)) throw new SeleccionDeGastosInvalidaError('viaje-invalido');
  return viajeId;
}

/**
 * Suma varios gastos sueltos a un viaje con la función de la base (`vincular_gastos_a_viaje`, una sola transacción: o quedan
 * todos los que se pueden o ninguno) y devuelve qué pasó con CADA gasto, ya leído de forma estricta
 * (`parsearResultadosVinculo`: un resultado que no se entiende es `no_se_pudo`, nunca un éxito). La base NO mueve un gasto
 * que ya está en otro viaje ni vincula uno de otro camión: eso vuelve como resultado, no como error.
 *
 * Lo que se manda son los ids sin repetir. Una lista vacía, de más de `MAX_GASTOS_POR_VEZ` distintos o con un id que no es uuid,
 * o un `viajeId` que no es uuid, se rechaza antes de tocar la red (`SeleccionDeGastosInvalidaError`). Escritura: tiene el timeout
 * de `writeTimeoutSignal`.
 *
 * NO reintenta sola. El reintento es manual y es seguro porque la función es idempotente: repetir la misma llamada (por
 * ejemplo tras perder la respuesta por mala señal) devuelve `ya_estaba` para lo que la primera ya sumó. Lo que NO es seguro es
 * reenviar una selección VIEJA después de un «Quitar»: volvería a sumar lo que se quitó (idempotente no es lo mismo que
 * conmutativo). Quien llama manda siempre la selección de ahora.
 *
 * Los errores de la base llegan como `DataRequestError` con su `code`: 42501 (sin cuenta), 22023 (parámetros inválidos),
 * P0002 (el viaje no existe o es de otra cuenta: la base no distingue) y, cuando exista el cobro, PT402.
 */
export async function vincularGastosAViaje(viajeId: string, gastoIds: readonly string[]): Promise<ResultadoDeGasto[]> {
  const viaje = viajeParaEnviar(viajeId);
  const ids = seleccionParaEnviar(gastoIds);
  const respuesta = unwrap(
    await supabase
      .rpc('vincular_gastos_a_viaje', { p_viaje_id: viaje, p_gasto_ids: ids })
      .abortSignal(writeTimeoutSignal()),
  );
  return parsearResultadosVinculo(respuesta, ids);
}

/**
 * «Quitar del viaje»: deja SIN viaje los gastos pedidos que sean de ESTE viaje (`update ... set viaje_id = null where id in
 * (...) and viaje_id = <el viaje>`). Un gasto que está en otro viaje no se toca. Los gastos NO se borran y conservan su camión:
 * sumar y quitar es un viaje de ida y vuelta sin cambios. Devuelve los ids que REALMENTE se quitaron, en el orden pedido
 * (`parsearIdsQuitados`): que sean menos de los pedidos, o ninguno, no es un error (alguien ya los había quitado).
 *
 * Mismos rechazos previos que `vincularGastosAViaje` (vacío, más de `MAX_GASTOS_POR_VEZ`, un id que no es uuid, un `viajeId` que
 * no es uuid) y mismo timeout de escritura.
 * Quitar dos veces lo mismo es seguro (la segunda no encuentra nada).
 *
 * Con `.select('id')` la base siempre contesta una lista (vacía si no quitó nada). Si la respuesta NO es una lista, no se sabe qué
 * pasó: tira un `DataRequestError` sin código (clase `unknown`, reintentable: reintentar es seguro porque quitar es idempotente)
 * en vez de devolver `[]`, que la pantalla leería como «ya no estaban».
 */
export async function quitarGastosDelViaje(viajeId: string, gastoIds: readonly string[]): Promise<string[]> {
  const viaje = viajeParaEnviar(viajeId);
  const ids = seleccionParaEnviar(gastoIds);
  const filas = unwrap(
    await supabase
      .from('gastos')
      .update(updatePayload<'gastos'>({ viaje_id: null }))
      .in('id', ids)
      .eq('viaje_id', viaje)
      .select('id')
      .abortSignal(writeTimeoutSignal()),
  );
  if (!Array.isArray(filas)) throw new DataRequestError({ message: 'Respuesta inesperada al quitar gastos del viaje' });
  return parsearIdsQuitados(filas, ids);
}
