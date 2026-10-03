/**
 * Números de formularios: lectura de lo que escribe el usuario, límites por
 * columna de la base, formato para mostrar y conversión hacia/desde
 * PostgREST. Sin dependencias: se puede probar suelto.
 *
 * Por qué no `Number(texto)` ni `parseFloat`: el teclado numérico de un
 * celular en español escribe COMA ("12,5"), `Number("12,5")` da NaN y
 * `parseFloat("12,5")` da 12 (pierde los decimales sin avisar). En un gasto
 * eso es plata mal cargada en silencio.
 *
 * Reglas de lectura (ver `parseDecimalText`):
 *  - Un solo tipo de separador (coma o punto), una sola vez: es el decimal.
 *    "1.234" es 1,234 (los campos se tipean SIN separador de miles).
 *  - Coma y punto juntos: el ÚLTIMO es el decimal y el otro es el separador
 *    de miles, que se descarta. "1.234,56" y "1,234.56" dan 1234,56.
 *    Además los miles tienen que estar bien agrupados (grupos de 3): "1,2.5"
 *    no se adivina, se rechaza.
 *  - El mismo separador repetido ("1,2,3", "1.234.567") es ambiguo: se
 *    rechaza en vez de adivinar.
 *  - Sin letras, sin signos (ni "+" ni notación científica), sin espacios
 *    en el medio. Un "-" delante se reconoce solo para avisar "no puede ser
 *    negativo".
 */

// ---------------------------------------------------------------------------
// Límites por tipo de columna
// ---------------------------------------------------------------------------

interface NumberKindSpec {
  /** Dígitos totales de la columna: numeric(precision, scale). */
  precision: number;
  /** Decimales máximos de la columna. */
  scale: number;
}

/**
 * Tipos de columna numérica de la base. Si cambia el esquema, se cambia acá.
 *  - dinero:      numeric(12,2)  gastos.monto, viajes.ingreso
 *  - litros:      numeric(9,3)   gastos.litros
 *  - km:          numeric(9,1)   viajes.km_inicial / km_final / km_recorridos
 *  - precioLitro: numeric(10,2)  gastos.precio_por_litro
 */
export const NUMBER_KINDS = {
  dinero: { precision: 12, scale: 2 },
  litros: { precision: 9, scale: 3 },
  km: { precision: 9, scale: 1 },
  precioLitro: { precision: 10, scale: 2 },
} as const satisfies Record<string, NumberKindSpec>;

export type NumberKind = keyof typeof NUMBER_KINDS;

/** Máximo que entra en la columna, p.ej. dinero → 9999999999.99. */
export function maxValueFor(kind: NumberKind): number {
  const { precision, scale } = NUMBER_KINDS[kind];
  return Number(`${'9'.repeat(precision - scale)}${scale > 0 ? `.${'9'.repeat(scale)}` : ''}`);
}

// ---------------------------------------------------------------------------
// Lectura de texto
// ---------------------------------------------------------------------------

export type DecimalParseFailure = 'empty' | 'invalid' | 'ambiguous' | 'negative';

export type DecimalParse =
  | {
      ok: true;
      value: number;
      /** Dígitos de la parte entera (0 si es "0,5"). Sirve para chequear el tope sin usar floats. */
      integerDigits: number;
      /** Decimales tal cual los escribió el usuario ("1,50" → 2). */
      decimals: number;
    }
  | { ok: false; reason: DecimalParseFailure };

const FAIL_EMPTY: DecimalParse = { ok: false, reason: 'empty' };
const FAIL_INVALID: DecimalParse = { ok: false, reason: 'invalid' };
const FAIL_AMBIGUOUS: DecimalParse = { ok: false, reason: 'ambiguous' };
const FAIL_NEGATIVE: DecimalParse = { ok: false, reason: 'negative' };

function countChar(text: string, char: string): number {
  return text.split(char).length - 1;
}

function build(intRaw: string, fracRaw: string): DecimalParse {
  const intPart = intRaw.replace(/^0+(?=\d)/, '') || '0';
  const normalized = fracRaw.length > 0 ? `${intPart}.${fracRaw}` : intPart;
  return {
    ok: true,
    // Con más de ~308 dígitos da Infinity: no se corta acá a propósito, para
    // que `validateRequiredNumber` lo informe como "demasiado grande" (por
    // `integerDigits`) en vez de "no es un número". `parseDecimal` lo
    // descarta (devuelve null).
    value: Number(normalized),
    integerDigits: intPart === '0' ? 0 : intPart.length,
    decimals: fracRaw.length,
  };
}

function parseUnsigned(body: string): DecimalParse {
  if (!/^[0-9.,]+$/.test(body) || !/[0-9]/.test(body)) return FAIL_INVALID;

  const dots = countChar(body, '.');
  const commas = countChar(body, ',');

  // Sin separadores: solo dígitos.
  if (dots === 0 && commas === 0) return build(body, '');

  // Un solo tipo de separador: si aparece más de una vez es ambiguo
  // ("1,2,3" o "1.234.567"); si aparece una vez, es el decimal.
  if (dots === 0 || commas === 0) {
    const sep = dots > 0 ? '.' : ',';
    if (countChar(body, sep) > 1) return FAIL_AMBIGUOUS;
    const [intRaw, fracRaw] = body.split(sep);
    return build(intRaw, fracRaw);
  }

  // Los dos tipos: el último separador es el decimal y el otro es de miles.
  const decimalSep = body.lastIndexOf('.') > body.lastIndexOf(',') ? '.' : ',';
  const thousandsSep = decimalSep === '.' ? ',' : '.';
  if (countChar(body, decimalSep) > 1) return FAIL_AMBIGUOUS;

  const [intRaw, fracRaw] = body.split(decimalSep);
  const groups = intRaw.split(thousandsSep);
  const grouped =
    /^\d{1,3}$/.test(groups[0]) && groups.slice(1).every((group) => /^\d{3}$/.test(group));
  if (!grouped) return FAIL_AMBIGUOUS;

  return build(groups.join(''), fracRaw);
}

/** Lee lo que escribió el usuario y explica por qué no se pudo, si no se pudo. */
export function parseDecimalText(text: string): DecimalParse {
  const raw = text.trim();
  if (raw === '') return FAIL_EMPTY;

  if (raw.startsWith('-')) {
    const rest = parseUnsigned(raw.slice(1));
    return rest.ok ? FAIL_NEGATIVE : rest;
  }

  return parseUnsigned(raw);
}

/**
 * Versión simple: el número, o `null` si el texto no se puede leer (vacío,
 * letras, signos, separadores ambiguos, negativo). No aplica límites de
 * columna: para eso están `validateRequiredNumber`/`validateOptionalNumber`.
 */
export function parseDecimal(text: string): number | null {
  const result = parseDecimalText(text);
  return result.ok && Number.isFinite(result.value) ? result.value : null;
}

// ---------------------------------------------------------------------------
// Formato (idioma del dispositivo)
// ---------------------------------------------------------------------------

/** Idioma para formatear: el del dispositivo si es español (es-AR, es-MX…,
 *  cada uno con sus separadores), y `es` de respaldo en cualquier otro caso. */
function resolveLocale(): string {
  const language = typeof navigator !== 'undefined' ? navigator.language : '';
  return language && /^es(-|$)/i.test(language) ? language : 'es';
}

const formatterCache = new Map<string, Intl.NumberFormat>();

function getFormatter(minDecimals: number, maxDecimals: number): Intl.NumberFormat {
  const locale = resolveLocale();
  const key = `${locale}|${minDecimals}|${maxDecimals}`;
  let formatter = formatterCache.get(key);
  if (!formatter) {
    const options: Intl.NumberFormatOptions = {
      style: 'decimal', // a propósito: nunca 'currency', los números van sin símbolo
      minimumFractionDigits: minDecimals,
      maximumFractionDigits: maxDecimals,
      // `true` (booleano) = agrupar siempre. Sin esto, es-ES no pone el punto
      // de miles en números de 4 dígitos ("1234" en vez de "1.234").
      useGrouping: true,
      // Dígitos 0-9 siempre: un idioma del dispositivo con dígitos no ASCII
      // (p.ej. `es-u-nu-arab`) dejaría en los campos un texto que
      // `parseDecimal` no entiende.
      numberingSystem: 'latn',
    };
    try {
      formatter = new Intl.NumberFormat(locale, options);
    } catch {
      // Etiqueta de idioma inválida (no debería pasar con navigator.language).
      formatter = new Intl.NumberFormat('es', options);
    }
    formatterCache.set(key, formatter);
  }
  return formatter;
}

export interface FormatNumberOptions {
  /** Cantidad de decimales. Sin esto se muestran los que tenga (hasta 3). */
  decimales?: number;
  /** Con `decimales`: true (por defecto) fuerza exactamente esa cantidad
   *  ("1.234,50"); false muestra hasta esa cantidad sin ceros de relleno. */
  fijos?: boolean;
}

/** Lo que se muestra cuando no hay valor (campo opcional vacío). */
export const EMPTY_VALUE = '—';

/** Número con separador de miles y decimales del idioma del dispositivo.
 *  Sin símbolo de moneda ni unidad: eso lo pone la pantalla. */
export function formatNumber(value: number | null | undefined, options: FormatNumberOptions = {}): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EMPTY_VALUE;
  const { decimales, fijos = true } = options;
  const formatted =
    decimales === undefined
      ? getFormatter(0, 3).format(value)
      : getFormatter(fijos ? decimales : 0, decimales).format(value);
  // Intl muestra "-0,00" para -0 y para negativos que redondean a cero
  // (-0,001 con 2 decimales). Un cero nunca lleva signo.
  return /^-[0.,\s]*$/.test(formatted) ? formatted.slice(1) : formatted;
}

/** Separador decimal del idioma del dispositivo ("," en es-AR, "." en es-MX). */
function decimalSeparator(): string {
  const separator = getFormatter(1, 1).formatToParts(1.1).find((part) => part.type === 'decimal')?.value;
  // Solo coma o punto: son los únicos que `parseDecimal` entiende.
  return separator === '.' || separator === ',' ? separator : ',';
}

/**
 * Texto para precargar un campo al EDITAR un registro: sin separador de miles
 * (los campos se tipean sin miles y "1.234" se lee como 1,234) y con el
 * decimal del dispositivo. 1234.5 → "1234,5".
 *
 * `separator` fuerza la coma o el punto en vez del del dispositivo. Útil con
 * los litros: con punto, 40,125 daría "40.125", que `validateRequiredNumber`
 * rechaza como ambiguo; con coma se lee igual en cualquier idioma.
 */
export function formatForInput(value: number | null | undefined, separator?: ',' | '.'): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '';
  // String(1e-7) da "1e-7": los valores de las columnas nunca son tan chicos,
  // pero si pasara, mejor un decimal plano que una notación que no se puede editar.
  const plain = /e/i.test(String(value)) ? value.toFixed(6).replace(/\.?0+$/, '') : String(value);
  return (plain === '-0' ? '0' : plain).replace('.', separator ?? decimalSeparator());
}

// ---------------------------------------------------------------------------
// Validación con límites de columna (mensajes para el usuario)
// ---------------------------------------------------------------------------

export interface NumberRules {
  /** Por defecto false: montos, litros y precios tienen `check (> 0)` en la
   *  base. Para ingreso y km (`>= 0`) pasar true. */
  allowZero?: boolean;
}

export type NumberValidation =
  | { ok: true; value: number }
  | { ok: false; message: string };

export type OptionalNumberValidation =
  | { ok: true; value: number | null }
  | { ok: false; message: string };

/** Sin coma, 1-3 dígitos, punto y exactamente 3 dígitos: "1.200", "40.500". */
const LITROS_AMBIGUOUS = /^\d{1,3}\.\d{3}$/;

export const LITROS_AMBIGUOUS_MESSAGE =
  'Escribe los litros con coma para los decimales (ej. 40,5) o sin separador de miles (ej. 1200).';

/** Ayuda sugerida para un campo de litros (la usa `NumberField` si no se le pasa otra). */
export const LITROS_HINT = 'Usa coma para los decimales (ej. 40,5). Sin separador de miles.';

function decimalsLabel(scale: number): string {
  return scale === 1 ? '1 decimal' : `${scale} decimales`;
}

function failureMessage(reason: DecimalParseFailure): string {
  switch (reason) {
    case 'empty':
      return 'Escribe un número.';
    case 'negative':
      return 'El número no puede ser negativo.';
    case 'ambiguous':
      return 'Revisa el número: usa una sola coma o un solo punto para los decimales.';
    case 'invalid':
      return 'Escribe solo números, con coma o punto para los decimales.';
  }
}

/** Campo obligatorio: devuelve el número ya validado contra la columna. */
export function validateRequiredNumber(text: string, kind: NumberKind, rules: NumberRules = {}): NumberValidation {
  // "1.200" litros: en es-AR el punto es de MILES (mil doscientos), pero la
  // regla general lo lee como decimal (1,2) y la carga quedaría 1000 veces
  // menor sin avisar. Como litros admite 3 decimales no hay error de
  // "demasiados decimales" que lo frene, así que se rechaza por ambiguo.
  // (En dinero/km/precio ese texto ya falla con "Usa hasta N decimales".)
  if (kind === 'litros' && LITROS_AMBIGUOUS.test(text.trim())) {
    return { ok: false, message: LITROS_AMBIGUOUS_MESSAGE };
  }

  const parsed = parseDecimalText(text);
  if (!parsed.ok) return { ok: false, message: failureMessage(parsed.reason) };

  const { precision, scale } = NUMBER_KINDS[kind];

  if (parsed.decimals > scale) {
    return { ok: false, message: `Usa hasta ${decimalsLabel(scale)}.` };
  }
  // Se cuenta por dígitos, no comparando floats: 9999999999.999 no puede
  // "redondear" hacia un valor que sí entra.
  if (parsed.integerDigits > precision - scale) {
    const max = formatNumber(maxValueFor(kind), { decimales: scale });
    return { ok: false, message: `El número es demasiado grande. El máximo es ${max}.` };
  }
  if (parsed.value === 0 && !rules.allowZero) {
    return { ok: false, message: 'El número tiene que ser mayor que 0.' };
  }

  return { ok: true, value: parsed.value };
}

/** Campo opcional: vacío es válido y da `null`; si hay algo escrito, se valida igual. */
export function validateOptionalNumber(
  text: string,
  kind: NumberKind,
  rules: NumberRules = {},
): OptionalNumberValidation {
  if (text.trim() === '') return { ok: true, value: null };
  return validateRequiredNumber(text, kind, rules);
}

// ---------------------------------------------------------------------------
// Conversión hacia/desde PostgREST
// ---------------------------------------------------------------------------

/**
 * Redondea a los decimales de la columna como Postgres (`numeric`): la mitad
 * se va al lado de arriba (alejándose de cero). 12,915 → 12,92; 1,005 → 1,01;
 * 2,675 → 2,68. `Number.prototype.toFixed` NO sirve para esto: trabaja con el
 * double binario (2,675 es en realidad 2,67499999…) y da 2,67.
 *
 * Se redondea sobre el texto decimal del número (`"2.675e2"` → 267.5 →
 * 268 → 2,68) y antes se quita el ruido de punto flotante (toPrecision(15):
 * 10,5 × 1,23 puede dar 12,914999999999999). Nunca devuelve -0.
 *
 * Para cuentas exactas de dinero lo ideal sería no pasar por floats; con
 * columnas de hasta 12 dígitos este redondeo coincide con el de la base.
 */
export function roundToScale(value: number, kind: NumberKind): number {
  const { scale } = NUMBER_KINDS[kind];
  const clean = Number(value.toPrecision(15));
  const text = String(Math.abs(clean));
  // String() usa notación científica por debajo de 1e-6 y desde 1e21: en esos
  // extremos no hay mitades que cuidar, alcanza con toFixed.
  const magnitude = /e/i.test(text)
    ? Number(Math.abs(clean).toFixed(scale))
    : Math.round(Number(`${text}e${scale}`)) / 10 ** scale;
  const rounded = clean < 0 ? -magnitude : magnitude;
  return rounded === 0 ? 0 : rounded; // normaliza -0
}

/**
 * Valor listo para enviar a una columna `numeric`: redondeado a sus
 * decimales. PostgREST acepta un number JSON (con hasta 12 dígitos
 * significativos no hay pérdida de precisión en un double). Falla fuerte si
 * el valor no entra en la columna: llegar acá con un número inválido es un
 * bug de validación, no algo que el usuario deba ver como error de datos.
 */
export function toDbNumber(value: number, kind: NumberKind): number {
  const { precision, scale } = NUMBER_KINDS[kind];
  const rounded = roundToScale(value, kind);
  if (!Number.isFinite(rounded) || Math.abs(rounded) > maxValueFor(kind)) {
    throw new RangeError(`El valor no entra en numeric(${precision},${scale}).`);
  }
  return rounded;
}

/** Igual que `toDbNumber`, para columnas que admiten NULL. */
export function toDbNumberOrNull(value: number | null, kind: NumberKind): number | null {
  return value === null ? null : toDbNumber(value, kind);
}

/**
 * Lo que devuelve PostgREST para una columna `numeric`: normalmente un
 * number, pero según la configuración puede venir como string
 * ("1234.56"). Devuelve un number o `null`.
 */
export function fromDbNumber(value: number | string | null | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? (value === 0 ? 0 : value) : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? (parsed === 0 ? 0 : parsed) : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Enteros en la escala de la columna (para sumar y comparar sin coma flotante)
// ---------------------------------------------------------------------------

/**
 * El valor en unidades enteras de la escala de la columna: dinero → centavos, km → décimas de km,
 * litros → mililitros. 0,1 + 0,2 da 0,30000000000000004 en coma flotante; 1 + 2 da 3. Para totales
 * y comparaciones (p.ej. "km final menor que el inicial") se pasa a entero, se opera y recién al
 * final se vuelve con `fromScaledInt`.
 *
 * Los valores de la base ya tienen a lo sumo `scale` decimales, así que `Math.round` solo corrige el
 * ruido binario (1,1 × 10 = 11.000000000000002).
 */
export function toScaledInt(value: number, kind: NumberKind): number {
  return Math.round(value * 10 ** NUMBER_KINDS[kind].scale);
}

/** Inverso de `toScaledInt`: 12345 centavos → 123,45. */
export function fromScaledInt(units: number, kind: NumberKind): number {
  const result = units / 10 ** NUMBER_KINDS[kind].scale;
  return result === 0 ? 0 : result; // normaliza -0
}
