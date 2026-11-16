import { isValidDateString } from '@/lib/dates';
import { MAX_GASTOS_POR_VEZ } from './constants';

/**
 * Lógica pura de «Sumar gastos que ya cargué» (vincular varios gastos sueltos a un viaje) y de «Quitar del viaje». Sin React
 * ni acceso a la base: lo que entra son datos, lo que sale son datos. El acceso a la base está en `gastos-api.ts` y los
 * textos de la pantalla en su propio archivo (acá no hay ninguno).
 *
 * Contrato con la base (migración 019, función `vincular_gastos_a_viaje`): devuelve UNA fila `{ gasto_id, resultado }` por cada
 * gasto distinto que se pidió, en el orden recibido. Esa respuesta NO se confía tal cual: la lee `parsearResultadosVinculo`,
 * que solo da por bueno lo que entiende al pie de la letra.
 */

export { MAX_GASTOS_POR_VEZ };

// ---------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------

/**
 * Cómo se comparan dos ids de gasto: un uuid es el mismo escrito en mayúsculas o en minúsculas (la base siempre responde en
 * minúsculas). Otras formas de escribir un uuid (con llaves, sin guiones) no se reconocen: quedan como un id distinto y, en el
 * parser, como «no se pudo» (que es el lado seguro: jamás un éxito falso).
 */
function claveDeId(id: string): string {
  return id.toLowerCase();
}

/** Los ids sin repetir, en el orden de su primera aparición y con la escritura de esa primera aparición. No cambia el arreglo recibido. */
export function idsDistintos(ids: readonly string[]): string[] {
  const vistos = new Set<string>();
  const distintos: string[] = [];
  for (const id of ids) {
    const clave = claveDeId(id);
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    distintos.push(id);
  }
  return distintos;
}

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor);
}

// ---------------------------------------------------------------------------
// Respuesta de `vincular_gastos_a_viaje`
// ---------------------------------------------------------------------------

/** Lo que la base puede contestar por cada gasto (en este orden de precedencia, si cumple más de una condición). */
const RESULTADOS_DE_LA_BASE = ['vinculado', 'ya_estaba', 'en_otro_viaje', 'camion_distinto', 'no_encontrado'] as const;

/**
 * - `vinculado`: estaba suelto y ahora está en el viaje.
 * - `ya_estaba`: ya era de ESTE viaje (por ejemplo, un reintento después de perder la respuesta).
 * - `en_otro_viaje`: es de OTRO viaje; la base NO lo mueve.
 * - `camion_distinto`: el gasto y el viaje tienen camión y son distintos; no se vincula.
 * - `no_encontrado`: no existe o es de otra cuenta (la base contesta igual en los dos casos: no revela cuál).
 */
export type ResultadoDeLaBase = (typeof RESULTADOS_DE_LA_BASE)[number];

/**
 * Lo anterior más `no_se_pudo`: la respuesta no se entiende (el gasto no aparece, o su `resultado` viene vacío o con un
 * texto desconocido; la base devuelve NULL si un trigger frena el UPDATE sin error). Es «no se pudo sumar»: nunca un éxito.
 */
export type ResultadoVinculo = ResultadoDeLaBase | 'no_se_pudo';

/** Qué pasó con un gasto pedido. */
export interface ResultadoDeGasto {
  /** El id tal como se pidió (la primera vez que aparece en `pedidos`). */
  gastoId: string;
  resultado: ResultadoVinculo;
}

function esResultadoDeLaBase(valor: unknown): valor is ResultadoDeLaBase {
  // Comparación exacta (sin pasar a minúsculas ni recortar espacios): `Vinculado` o `vinculado ` no son lo que la base dice.
  return typeof valor === 'string' && (RESULTADOS_DE_LA_BASE as readonly string[]).includes(valor);
}

/**
 * Lee la respuesta de la función de la base de forma ESTRICTA y devuelve, por cada id pedido (sin repetir, en el orden de
 * `pedidos`), qué pasó con él. `data` es lo que devolvió la llamada, sin ninguna confianza (`unknown`).
 *
 * Reglas:
 *  - Si `data` no es un arreglo, no hay filas que leer: todos los pedidos quedan en `no_se_pudo`.
 *  - Una fila que no es un objeto con un `gasto_id` de texto se descarta.
 *  - Una fila con un `gasto_id` que NO se pidió se ignora por completo: ni se muestra ni se cuenta.
 *  - El `resultado` tiene que ser, EXACTAMENTE, uno de los cinco de la base. Cualquier otra cosa (NULL, otro texto, otro tipo)
 *    es `no_se_pudo`. Solo `vinculado` y `ya_estaba` son éxitos y solo llegan de la base, nunca por descarte.
 *  - Si un mismo id viene en varias filas y sus lecturas (ya normalizadas como en el punto anterior) NO coinciden, es
 *    `no_se_pudo`: la base manda UNA fila por gasto, así que dos que se contradicen son una respuesta rota y no se le cree a
 *    ninguna (ni a la primera ni a la que diga «vinculado»). Si coinciden, es ese resultado.
 *  - Un id pedido que no tiene fila en la respuesta es `no_se_pudo`.
 */
export function parsearResultadosVinculo(data: unknown, pedidos: readonly string[]): ResultadoDeGasto[] {
  const ids = idsDistintos(pedidos);
  const pedidosPorClave = new Set(ids.map(claveDeId));
  const resultadoPorClave = new Map<string, ResultadoVinculo>();

  if (Array.isArray(data)) {
    const filas: readonly unknown[] = data;
    for (const fila of filas) {
      if (!esObjeto(fila) || typeof fila.gasto_id !== 'string') continue;
      const clave = claveDeId(fila.gasto_id);
      if (!pedidosPorClave.has(clave)) continue;
      const lectura: ResultadoVinculo = esResultadoDeLaBase(fila.resultado) ? fila.resultado : 'no_se_pudo';
      const previa = resultadoPorClave.get(clave);
      // Si no coinciden, `no_se_pudo`; y ahí se queda (una lectura posterior distinta de `no_se_pudo` vuelve a no coincidir).
      resultadoPorClave.set(clave, previa === undefined || previa === lectura ? lectura : 'no_se_pudo');
    }
  }

  return ids.map((gastoId) => ({ gastoId, resultado: resultadoPorClave.get(claveDeId(gastoId)) ?? 'no_se_pudo' }));
}

/** Por qué un gasto NO quedó sumado (todo resultado que no es `vinculado` ni `ya_estaba`). */
export type MotivoNoSumado = Exclude<ResultadoVinculo, 'vinculado' | 'ya_estaba'>;

export interface ResumenDeResultados {
  /** Cuántos estaban sueltos y ahora están en el viaje (`vinculado`). */
  sumados: number;
  /** Cuántos ya eran de este viaje (`ya_estaba`). */
  yaEstaban: number;
  /** Los que no se sumaron, en el orden recibido, cada uno con su motivo. */
  noSumados: Array<{ gastoId: string; motivo: MotivoNoSumado }>;
}

/** Los dos éxitos o el motivo; un valor que no debería existir cuenta como `no_se_pudo` (nunca como éxito). */
function motivoDeNoSumado(resultado: ResultadoVinculo): MotivoNoSumado {
  return resultado === 'en_otro_viaje' || resultado === 'camion_distinto' || resultado === 'no_encontrado' ? resultado : 'no_se_pudo';
}

/** Cuenta lo que pasó con la selección. Sin textos: eso es de la pantalla. */
export function resumirResultados(resultados: readonly ResultadoDeGasto[]): ResumenDeResultados {
  let sumados = 0;
  let yaEstaban = 0;
  const noSumados: ResumenDeResultados['noSumados'] = [];
  for (const { gastoId, resultado } of resultados) {
    if (resultado === 'vinculado') sumados += 1;
    else if (resultado === 'ya_estaba') yaEstaban += 1;
    else noSumados.push({ gastoId, motivo: motivoDeNoSumado(resultado) });
  }
  return { sumados, yaEstaban, noSumados };
}

/**
 * Los ids que REALMENTE se quitaron del viaje, según lo que devolvió el UPDATE (`.select('id')`). Misma desconfianza que
 * `parsearResultadosVinculo`: solo cuentan las filas con un `id` de texto que se haya pedido; las demás se ignoran. Sale en el
 * orden de `pedidos` (sin repetir) y con la escritura con que se pidió. Que salgan menos de los pedidos no es un error: alguien
 * ya los había quitado.
 */
export function parsearIdsQuitados(data: unknown, pedidos: readonly string[]): string[] {
  if (!Array.isArray(data)) return [];
  const quitados = new Set<string>();
  const filas: readonly unknown[] = data;
  for (const fila of filas) {
    if (esObjeto(fila) && typeof fila.id === 'string') quitados.add(claveDeId(fila.id));
  }
  return idsDistintos(pedidos).filter((id) => quitados.has(claveDeId(id)));
}

// ---------------------------------------------------------------------------
// Camión
// ---------------------------------------------------------------------------

/**
 * ¿El gasto es de OTRO camión que el viaje? Es la misma regla que el trigger `fn_validar_camion` (migración 010) y que la
 * función de la base: solo hay conflicto si el gasto Y el viaje tienen camión Y son distintos. Un gasto sin camión, o un viaje
 * sin camión, no chocan. Es una ayuda para la pantalla (no ofrecer lo que la base va a rechazar): la que decide es la base.
 */
export function esDeOtroCamion(gasto: { camion_id?: string | null }, viaje: { camion_id: string | null }): boolean {
  const camionDelGasto = gasto.camion_id ?? null;
  const camionDelViaje = viaje.camion_id ?? null;
  return camionDelGasto !== null && camionDelViaje !== null && camionDelGasto !== camionDelViaje;
}

// ---------------------------------------------------------------------------
// Fechas
// ---------------------------------------------------------------------------

const MS_POR_DIA = 86_400_000;

/**
 * 'YYYY-MM-DD' → días desde 1970-01-01 (negativo antes), o null si no es una fecha que exista en el calendario. Usa solo UTC
 * (medianoche UTC): el horario local y el de verano no entran, y un día siempre dura 24 horas. `setUTCFullYear` evita que un
 * año de dos dígitos se lea como 19xx.
 */
function diaDeCalendario(fecha: string): number | null {
  if (!isValidDateString(fecha)) return null;
  const [anio, mes, dia] = fecha.split('-').map(Number);
  const instante = new Date(0);
  instante.setUTCFullYear(anio, mes - 1, dia);
  return instante.getTime() / MS_POR_DIA;
}

/**
 * Cuántos días hay entre dos fechas 'YYYY-MM-DD' (sin zona horaria), siempre positivo o 0: no dice cuál es anterior. No depende
 * de la zona horaria ni del horario de verano.
 *
 * Con una fecha que no tiene ese formato o no existe en el calendario ('2026-02-30', 'infinity', '2026-1-5') devuelve `null`
 * («no se puede calcular»), no tira: la base no limita la fecha de un gasto (acepta 'infinity', años antes de Cristo o de
 * cinco cifras), y un solo gasto con una fecha rara no tiene que romper la lista de candidatos. `ordenarPorCercania` lo manda
 * al final.
 */
export function distanciaEnDias(fecha: string, fechaViaje: string): number | null {
  const dia = diaDeCalendario(fecha);
  const diaDelViaje = diaDeCalendario(fechaViaje);
  return dia === null || diaDelViaje === null ? null : Math.abs(dia - diaDelViaje);
}

// ---------------------------------------------------------------------------
// Orden por cercanía a la fecha del viaje
// ---------------------------------------------------------------------------

/** Lo mínimo que hace falta de un gasto para ordenarlo. */
export interface GastoOrdenable {
  id: string;
  /** 'YYYY-MM-DD'. */
  fecha: string;
  /** Timestamp ISO que devuelve la base (`timestamptz`). */
  created_at: string;
}

/** `2026-11-13T15:23:11.123456+00:00`, con o sin fracción, con `T` o espacio, y con `Z`, `+00`, `+00:00` o `+0000`. */
const TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}(?::?\d{2})?)?$/;

/**
 * Un timestamp como un solo número de MICROsegundos desde 1970 (Postgres guarda microsegundos), o null si no se entiende. Se
 * arma a mano en vez de `Date.parse`: esa función no promete leer más de tres cifras de fracción en todos los navegadores, y
 * un texto que compara distinto según su zona ('Z' contra '+00:00') no se puede ordenar como texto. Con fecha en 2026 el
 * número tiene 16 cifras: entra exacto en un `number` (el límite es el año 2255). El instante se arma con `setUTCFullYear` (como
 * `diaDeCalendario`) y no con `Date.UTC`, que lee un año de 0 a 99 como 19xx.
 */
function microsegundosDe(texto: string): number | null {
  const partes = TIMESTAMP.exec(texto);
  if (partes === null) return null;
  const [, anio, mes, dia, hora, minuto, segundo, fraccion = '', zona = 'Z'] = partes;
  let desfase = 0; // segundos que la zona se adelanta (o atrasa) respecto de UTC
  if (zona !== 'Z') {
    const signo = zona.startsWith('-') ? -1 : 1;
    const minutosDeZona = zona.length > 3 ? Number(zona.slice(-2)) : 0;
    desfase = signo * (Number(zona.slice(1, 3)) * 3600 + minutosDeZona * 60);
  }
  const instante = new Date(0);
  instante.setUTCFullYear(Number(anio), Number(mes) - 1, Number(dia));
  instante.setUTCHours(Number(hora), Number(minuto), Number(segundo), 0);
  const segundos = instante.getTime() / 1000 - desfase;
  const total = segundos * 1_000_000 + Number(fraccion.padEnd(6, '0').slice(0, 6));
  return Number.isFinite(total) ? total : null;
}

interface GastoConClaves<T> {
  gasto: T;
  /** Días a la fecha del viaje; `Infinity` si la fecha del gasto no se entiende (va al final). */
  distancia: number;
  /** Cuándo se creó; null si el timestamp no se entiende. */
  creado: number | null;
}

/** Texto contra texto, sin mirar el idioma: es el orden de los uuid en la base (son hexadecimales en minúscula). */
function compararTexto(a: string, b: string): number {
  return a === b ? 0 : a < b ? -1 : 1;
}

function compararNumero(a: number, b: number): number {
  return a === b ? 0 : a < b ? -1 : 1;
}

/** Más nuevo primero. Lo que no tiene un timestamp entendible va después de todo lo que sí, y entre sí por el texto, también descendente. */
function compararCreacionDescendente<T extends GastoOrdenable>(a: GastoConClaves<T>, b: GastoConClaves<T>): number {
  if (a.creado !== null && b.creado !== null) return compararNumero(b.creado, a.creado);
  if (a.creado !== null) return -1;
  if (b.creado !== null) return 1;
  return compararTexto(b.gasto.created_at, a.gasto.created_at);
}

function compararPorCercania<T extends GastoOrdenable>(a: GastoConClaves<T>, b: GastoConClaves<T>): number {
  return (
    compararNumero(a.distancia, b.distancia) || // 1) el más cercano a la fecha del viaje
    compararTexto(b.gasto.fecha, a.gasto.fecha) || // 2) a igual distancia, la fecha MÁS RECIENTE (el posterior antes que el anterior)
    compararCreacionDescendente(a, b) || // 3) a igual fecha, el creado más tarde
    compararTexto(a.gasto.id, b.gasto.id) // 4) y por último el id, para que el orden no dependa de cómo llegaron
  );
}

/**
 * Ordena los gastos del más cercano a la fecha del viaje al más lejano; a igual distancia, el de fecha MÁS RECIENTE primero;
 * después `created_at` descendente y por último `id`. Es EXACTAMENTE el orden de la consulta de candidatos que se probó en la
 * base (caso 27.22 de `supabase/tests/aislamiento.sql`): `abs(fecha - fechaViaje), fecha desc, created_at desc, id`.
 * Devuelve un arreglo nuevo: no cambia el que recibe. Sin ventana de días: ningún gasto se descarta por lejano.
 *
 * `fechaViaje` tiene que ser una fecha 'YYYY-MM-DD' que exista (si no, tira `RangeError`: es un error de quien llama). En
 * cambio una fecha de GASTO que no se entiende no tira: ese gasto queda al final (ver `distanciaEnDias`).
 */
export function ordenarPorCercania<T extends GastoOrdenable>(gastos: readonly T[], fechaViaje: string): T[] {
  const diaDelViaje = diaDeCalendario(fechaViaje);
  if (diaDelViaje === null) throw new RangeError('La fecha del viaje tiene que ser una fecha válida con formato AAAA-MM-DD.');

  const conClaves = gastos.map<GastoConClaves<T>>((gasto) => {
    const dia = diaDeCalendario(gasto.fecha);
    return {
      gasto,
      distancia: dia === null ? Number.POSITIVE_INFINITY : Math.abs(dia - diaDelViaje),
      creado: microsegundosDe(gasto.created_at),
    };
  });
  // `sort` es estable: lo que empata en las cuatro claves (el mismo gasto repetido) conserva el orden en que llegó.
  conClaves.sort(compararPorCercania);
  return conClaves.map(({ gasto }) => gasto);
}

// ---------------------------------------------------------------------------
// Candidatos
// ---------------------------------------------------------------------------

/** Los candidatos que se muestran y si había más. */
export interface Candidatos<T> {
  /** Como mucho `tope`, del más cercano a la fecha del viaje al más lejano. */
  items: T[];
  /** true si, entre las dos listas, había MÁS gastos que el tope: lo que se muestra no es todo lo que hay suelto. */
  hayMas: boolean;
}

/**
 * Junta las dos consultas de gastos sueltos (los de la fecha del viaje en adelante y los anteriores), las ordena con
 * `ordenarPorCercania`, se queda con los `tope` más cercanos y dice si había más.
 *
 * Por qué hay dos listas: la consulta no puede ordenar por «distancia en días» (no es una columna). Se piden por separado los
 * `tope + 1` más cercanos de cada lado de la fecha del viaje; entre los dos lados están, seguro, los `tope` más cercanos de
 * todos. Y como cada lado trae uno de más, `hayMas` es exacto: si entre ambos hay MÁS que `tope`, falta mostrar alguno; si no,
 * ninguno de los dos lados se cortó y está todo.
 *
 * Un mismo gasto que llegue en las dos listas (se le cambió la fecha entre una consulta y la otra) se cuenta una sola vez.
 * `tope` es un entero mayor o igual a 0 (si no, tira `RangeError`: un `slice` con un negativo cortaría de más sin avisar).
 */
export function mezclarCandidatos<T extends GastoOrdenable>(
  posteriores: readonly T[],
  anteriores: readonly T[],
  fechaViaje: string,
  tope: number = MAX_GASTOS_POR_VEZ,
): Candidatos<T> {
  if (!Number.isInteger(tope) || tope < 0) throw new RangeError('El tope tiene que ser un número entero mayor o igual a 0.');

  const vistos = new Set<string>();
  const juntos: T[] = [];
  for (const gasto of [...posteriores, ...anteriores]) {
    const clave = claveDeId(gasto.id);
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    juntos.push(gasto);
  }

  const ordenados = ordenarPorCercania(juntos, fechaViaje);
  return { items: ordenados.slice(0, tope), hayMas: ordenados.length > tope };
}
