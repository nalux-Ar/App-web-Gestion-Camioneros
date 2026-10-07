import type { ResolucionCamion } from '@/features/camiones/camion-seleccion';
import { validateFechaDeRegistro } from '@/lib/dates';
import type { MetodoPago, NewRow } from '@/lib/db';
import {
  maxValueFor,
  formatForInput,
  fromDbNumber,
  roundToScale,
  toDbNumber,
  toDbNumberOrNull,
  validateOptionalNumber,
  validateRequiredNumber,
} from '@/lib/numbers';
import { charLength } from '@/lib/text';
import { isCombustible, isGastosVarios, type Categoria } from './categorias';
import { METODO_PAGO_ORDER, MAX_DESCRIPCION } from './constants';

/**
 * Lógica PURA del formulario de gastos (sin React ni Supabase): validación,
 * cálculo del precio por litro y armado de lo que se manda a la base. Está
 * aparte a propósito para poder probarla suelta (el proyecto no tiene test
 * runner todavía).
 *
 * La base sigue siendo la autoridad (RLS + checks): esto es el espejo en el
 * front para avisar antes de enviar, con mensajes en español.
 */

// ---------------------------------------------------------------------------
// Valores del formulario (todo texto, tal cual lo tipeó el usuario)
// ---------------------------------------------------------------------------

/** Tanque lleno: '' = Sin indicar (null), 'si' = true, 'no' = false. */
export type TanqueLlenoChoice = '' | 'si' | 'no';

export interface GastoFormValues {
  categoriaId: string;
  monto: string;
  /** 'YYYY-MM-DD' */
  fecha: string;
  /** Id del viaje al que pertenece el gasto, o '' = Sin viaje (null). */
  viajeId: string;
  descripcion: string;
  /** '' = Sin especificar (null). */
  metodoPago: '' | MetodoPago;
  // Solo se usan con la categoría Combustible. Se CONSERVAN si el usuario
  // cambia de categoría y vuelve, pero no se envían (ver `validateGastoForm`).
  /** El camión elegido ('' = ninguno). Solo cuenta cuando hay que ELEGIR (ver `decidirCamion`). */
  camionId: string;
  litros: string;
  kmOdometro: string;
  tanqueLleno: TanqueLlenoChoice;
}

export type GastoFormField = keyof GastoFormValues;

/** Orden en pantalla: se usa para llevar el foco al PRIMER campo con error. */
export const GASTO_FIELD_ORDER: readonly GastoFormField[] = [
  'categoriaId',
  'descripcion',
  'monto',
  'camionId',
  'litros',
  'kmOdometro',
  'tanqueLleno',
  'fecha',
  'viajeId',
  'metodoPago',
];

export type GastoFormErrors = Partial<Record<GastoFormField, string>>;

/** Valores de un gasto nuevo. `viajeId` solo viene cargado cuando se llegó desde un viaje (`?viaje=`): un gasto común
 *  NO preselecciona ningún viaje. */
export function emptyGastoValues(today: string, viajeId = ''): GastoFormValues {
  return {
    categoriaId: '',
    monto: '',
    fecha: today,
    viajeId,
    descripcion: '',
    metodoPago: '',
    camionId: '',
    litros: '',
    kmOdometro: '',
    tanqueLleno: '',
  };
}

/** Lo que el formulario necesita de un gasto guardado para editarlo. */
export interface GastoEditable {
  categoria_id: string;
  monto: number | string;
  fecha: string;
  descripcion: string | null;
  metodo_pago: MetodoPago | null;
  litros: number | string | null;
  km_odometro: number | string | null;
  tanque_lleno: boolean | null;
  viaje_id: string | null;
  /** El camión que el gasto ya tenía (puede estar archivado: se conserva salvo que se elija otro). */
  camion_id?: string | null;
}

export function valuesFromGasto(gasto: GastoEditable): GastoFormValues {
  return {
    categoriaId: gasto.categoria_id,
    monto: formatForInput(fromDbNumber(gasto.monto)),
    fecha: gasto.fecha,
    viajeId: gasto.viaje_id ?? '',
    descripcion: gasto.descripcion ?? '',
    metodoPago: gasto.metodo_pago ?? '',
    camionId: gasto.camion_id ?? '',
    // Litros SIEMPRE con coma: con el punto decimal de es-MX/es-US/es-419, 40,125 L quedaría "40.125", que
    // las reglas de litros rechazan como ambiguo (¿40,125 o 40125?). La coma se lee igual en cualquier idioma.
    litros: formatForInput(fromDbNumber(gasto.litros), ','),
    // Monto y km: con el separador del dispositivo; "15000.5" y "15000,5" se leen igual (un solo separador =
    // decimal) y tienen a lo sumo 2 y 1 decimales, así que nunca caen en la regla de ambigüedad.
    kmOdometro: formatForInput(fromDbNumber(gasto.km_odometro)),
    tanqueLleno: gasto.tanque_lleno === true ? 'si' : gasto.tanque_lleno === false ? 'no' : '',
  };
}

// ---------------------------------------------------------------------------
// Precio por litro (dato derivado, no se tipea)
// ---------------------------------------------------------------------------

/**
 * precio por litro = monto / litros, redondeado a 2 decimales (columna
 * numeric(10,2)). `null` si no se puede calcular o no sirve: falta alguno,
 * el resultado no es > 0 (la base exige `precio_por_litro > 0`; p.ej. 0,01
 * entre 1000 litros redondea a 0,00), o no entra en la columna.
 */
export function calcPrecioPorLitro(monto: number | null, litros: number | null): number | null {
  if (monto === null || litros === null) return null;
  if (!Number.isFinite(monto) || !Number.isFinite(litros) || monto <= 0 || litros <= 0) return null;
  const precio = roundToScale(monto / litros, 'precioLitro');
  if (!(precio > 0) || precio > maxValueFor('precioLitro')) return null;
  return precio;
}

/** El mismo cálculo a partir de los textos del formulario, para mostrarlo mientras se tipea
 *  (`null` si algún texto todavía no es válido). */
export function previewPrecioPorLitro(montoText: string, litrosText: string): number | null {
  const monto = validateRequiredNumber(montoText, 'dinero');
  const litros = validateRequiredNumber(litrosText, 'litros');
  if (!monto.ok || !litros.ok) return null;
  return calcPrecioPorLitro(monto.value, litros.value);
}

// ---------------------------------------------------------------------------
// Validación
// ---------------------------------------------------------------------------

/**
 * Columnas de `gastos` que escribe el formulario, TODAS explícitas (las de
 * combustible van en `null` si la categoría no es Combustible: al EDITAR eso
 * limpia lo que hubiera quedado de antes). No incluye `client_ref` (solo se
 * manda al crear) ni `id`/`transportista_id`/timestamps (los pone la base).
 */
export interface GastoColumns {
  categoria_id: string;
  monto: number;
  fecha: string;
  /** `null` explícito = sin viaje (al EDITAR, desvincula el gasto). */
  viaje_id: string | null;
  descripcion: string | null;
  metodo_pago: MetodoPago | null;
  litros: number | null;
  precio_por_litro: number | null;
  km_odometro: number | null;
  tanque_lleno: boolean | null;
  /** El camión de la carga de combustible; `null` en las demás categorías (como los litros). */
  camion_id: string | null;
}

export interface ValidarGastoContext {
  /** TODAS las categorías conocidas (activas e inactivas: al editar puede estar inactiva la actual). */
  categorias: readonly Categoria[];
  /** Hoy en hora local, 'YYYY-MM-DD'. La fecha no puede ser posterior. */
  today: string;
  /** Los viajes que se pueden elegir ahora (los recientes + el vinculado + el preseleccionado): ver `opcionesDeViaje`. */
  viajes: ReadonlyArray<{ id: string }>;
  /**
   * Solo en Combustible: el camión ya resuelto por el formulario (`resolverCamion` sobre `decidirCamion`), o el error si
   * falta elegirlo, hay que cargar uno o la lista de camiones no cargó. Con litros hace falta camión: en Combustible la
   * resolución nunca da `null`. Sin esto (pruebas viejas) la carga va sin camión.
   */
  camion?: ResolucionCamion;
}

export type GastoValidation =
  | { ok: true; columns: GastoColumns }
  | { ok: false; errors: GastoFormErrors; firstField: GastoFormField };

/** ¿La categoría elegida activa el modo combustible? */
export function esCombustibleElegida(categoriaId: string, categorias: readonly Categoria[]): boolean {
  return isCombustible(categorias.find((c) => c.id === categoriaId));
}

/** ¿La categoría elegida es "Gastos varios" (la descripción es obligatoria)? */
export function esGastosVariosElegida(categoriaId: string, categorias: readonly Categoria[]): boolean {
  return isGastosVarios(categorias.find((c) => c.id === categoriaId));
}

/** Error de la descripción vacía en "Gastos varios". */
export const DESCRIPCION_OBLIGATORIA_MESSAGE = 'Escribe de qué se trata este gasto.';

/** Error del viaje: un id que no está entre las opciones conocidas (el viaje es opcional: '' = sin viaje es válido). */
export const VIAJE_INVALIDO_MESSAGE = 'Elige un viaje de la lista.';

/**
 * Valida el formulario completo (espejo de los checks de la base) y arma las
 * columnas listas para enviar.
 *
 *  - categoría: obligatoria y conocida.
 *  - monto: > 0 y <= 9.999.999.999,99.
 *  - fecha: válida y no futura.
 *  - viaje: opcional ('' = sin viaje); si hay, tiene que ser uno de los viajes conocidos (`context.viajes`).
 *  - descripción: <= 2000 caracteres (recortada; vacía = null). OBLIGATORIA solo en la
 *    categoría global "Gastos varios"; en las demás es opcional.
 *  - Combustible: camión obligatorio (`context.camion`), litros obligatorios (> 0),
 *    km >= 0 opcional, tanque lleno Sí/No/Sin indicar; precio por litro calculado.
 *  - Cualquier otra categoría: camión, litros, precio, km y tanque van en NULL
 *    aunque el formulario los tenga cargados de antes.
 */
export function validateGastoForm(values: GastoFormValues, context: ValidarGastoContext): GastoValidation {
  const errors: GastoFormErrors = {};
  const fuel = esCombustibleElegida(values.categoriaId, context.categorias);

  if (!values.categoriaId || !context.categorias.some((c) => c.id === values.categoriaId)) {
    errors.categoriaId = 'Elige una categoría.';
  }

  const monto = validateRequiredNumber(values.monto, 'dinero');
  if (!monto.ok) errors.monto = monto.message;

  // Con cota inferior (ver `validateFechaDeRegistro`): sin ella, un año de 2 dígitos tipeado en escritorio
  // ("26" → 0026) pasaba y el gasto quedaba guardado pero fuera del alcance de la lista.
  const fecha = validateFechaDeRegistro(values.fecha, context.today);
  if (!fecha.ok) errors.fecha = fecha.message;

  const descripcion = values.descripcion.trim();
  if (charLength(descripcion, MAX_DESCRIPCION) > MAX_DESCRIPCION) {
    errors.descripcion = `La descripción puede tener hasta ${MAX_DESCRIPCION} caracteres.`;
  } else if (descripcion === '' && esGastosVariosElegida(values.categoriaId, context.categorias)) {
    // "Gastos varios" es la categoría más ambigua: sin una palabra que diga de qué se trata queda un gasto fantasma.
    errors.descripcion = DESCRIPCION_OBLIGATORIA_MESSAGE;
  }

  if (values.viajeId !== '' && !context.viajes.some((viaje) => viaje.id === values.viajeId)) {
    errors.viajeId = VIAJE_INVALIDO_MESSAGE;
  }

  if (values.metodoPago !== '' && !METODO_PAGO_ORDER.includes(values.metodoPago)) {
    errors.metodoPago = 'Elige un método de pago de la lista.';
  }

  let litros: number | null = null;
  let kmOdometro: number | null = null;
  let tanqueLleno: boolean | null = null;
  let camionId: string | null = null;

  if (fuel) {
    const camion: ResolucionCamion = context.camion ?? { ok: true, camionId: null };
    if (camion.ok) camionId = camion.camionId;
    else errors.camionId = camion.message;

    const litrosResult = validateRequiredNumber(values.litros, 'litros');
    if (litrosResult.ok) litros = litrosResult.value;
    else errors.litros = litrosResult.message;

    const kmResult = validateOptionalNumber(values.kmOdometro, 'km', { allowZero: true });
    if (kmResult.ok) kmOdometro = kmResult.value;
    else errors.kmOdometro = kmResult.message;

    tanqueLleno = values.tanqueLleno === 'si' ? true : values.tanqueLleno === 'no' ? false : null;
  }

  if (Object.keys(errors).length > 0) {
    const firstField = GASTO_FIELD_ORDER.find((field) => errors[field] !== undefined) ?? 'categoriaId';
    return { ok: false, errors, firstField };
  }

  // Si llegó hasta acá, monto y fecha son válidos (TypeScript no lo sabe).
  if (!monto.ok || !fecha.ok) throw new Error('validateGastoForm: estado inconsistente');

  const montoDb = toDbNumber(monto.value, 'dinero');
  const litrosDb = toDbNumberOrNull(litros, 'litros');
  return {
    ok: true,
    columns: {
      categoria_id: values.categoriaId,
      monto: montoDb,
      fecha: fecha.value,
      viaje_id: values.viajeId === '' ? null : values.viajeId,
      descripcion: descripcion === '' ? null : descripcion,
      metodo_pago: values.metodoPago === '' ? null : values.metodoPago,
      // Sin litros (o categoría que no es combustible) no hay tanque lleno ni
      // precio: la base rechaza tanque_lleno = true con litros NULL.
      litros: litrosDb,
      precio_por_litro: calcPrecioPorLitro(montoDb, litrosDb),
      km_odometro: toDbNumberOrNull(kmOdometro, 'km'),
      tanque_lleno: litrosDb === null ? null : tanqueLleno,
      // Fuera de Combustible va en NULL aunque el formulario tuviera uno elegido (como los litros).
      camion_id: camionId,
    },
  };
}

// ---------------------------------------------------------------------------
// Lo que se manda a la base
// ---------------------------------------------------------------------------

/** Fila para INSERT: las columnas + la clave de idempotencia. `insertPayload` quita lo que pone la base. */
export function buildInsertRow(columns: GastoColumns, clientRef: string): NewRow<'gastos'> {
  return { ...columns, client_ref: clientRef };
}

const COLUMN_KEYS: ReadonlyArray<keyof GastoColumns> = [
  'categoria_id',
  'monto',
  'fecha',
  'viaje_id',
  'descripcion',
  'metodo_pago',
  'litros',
  'precio_por_litro',
  'km_odometro',
  'tanque_lleno',
  'camion_id',
];

/**
 * Huella de lo que se mandó (orden fijo de claves): sirve para saber si entre
 * dos intentos de guardar el usuario cambió algo (ver `crearGasto`).
 */
export function fingerprintOf(columns: GastoColumns): string {
  return JSON.stringify(COLUMN_KEYS.map((key) => columns[key]));
}
