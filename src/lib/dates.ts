/**
 * Fechas de calendario ('YYYY-MM-DD', columnas `date` de la base) con la
 * hora LOCAL del dispositivo.
 *
 * REGLA: nunca `new Date().toISOString().slice(0, 10)`. `toISOString()` es
 * UTC: en Argentina (UTC-3), de las 21:00 a la medianoche ya devuelve el día
 * SIGUIENTE, y un gasto cargado a las 22:00 quedaría con la fecha de mañana
 * (y fuera del mes correcto el último día del mes). Todo lo de acá usa
 * `getFullYear/getMonth/getDate` (hora local) o aritmética pura de
 * año/mes, sin pasar por UTC.
 */

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function formatYmd(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`;
}

/** 'YYYY-MM-DD' con los getters LOCALES del Date (no UTC). */
export function toLocalDateString(date: Date): string {
  return formatYmd(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

/** Hoy según el reloj del dispositivo. `now` existe solo para poder probarlo. */
export function todayLocal(now: Date = new Date()): string {
  return toLocalDateString(now);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

interface DateParts {
  year: number;
  month: number;
  day: number;
}

function parseDateParts(value: string): DateParts | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

/** ¿Es un 'YYYY-MM-DD' que existe en el calendario? ("2026-02-30" no). */
export function isValidDateString(value: string): boolean {
  return parseDateParts(value) !== null;
}

/**
 * 'YYYY-MM-DD' → Date a medianoche LOCAL (sin desfase). `new Date('2026-09-30')`
 * es la trampa clásica: lo interpreta como UTC y en UTC-3 queda el 29.
 */
export function parseLocalDate(value: string): Date | null {
  const parts = parseDateParts(value);
  if (!parts) return null;
  const date = new Date(2000, 0, 1);
  date.setFullYear(parts.year, parts.month - 1, parts.day); // setFullYear: evita que años < 100 se lean como 19xx
  date.setHours(0, 0, 0, 0);
  return date;
}

// ---------------------------------------------------------------------------
// Meses
// ---------------------------------------------------------------------------

/** Un mes de calendario. `month` va de 1 (enero) a 12 (diciembre). */
export interface YearMonth {
  year: number;
  month: number;
}

/** Rango de un mes para filtrar con `>= desde` y `< hasta`. */
export interface MonthRange {
  /** Primer día del mes, 'YYYY-MM-DD'. */
  desde: string;
  /** Primer día del mes SIGUIENTE, 'YYYY-MM-DD' (exclusivo). */
  hasta: string;
}

function assertMonth({ year, month }: YearMonth): void {
  if (!Number.isInteger(year) || !Number.isInteger(month) || year < 1 || year > 9999 || month < 1 || month > 12) {
    throw new RangeError(`Mes inválido: ${year}-${month}`);
  }
}

/** Mes actual según el reloj del dispositivo. */
export function currentMonth(now: Date = new Date()): YearMonth {
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

/**
 * Suma (o resta, con negativo) meses. Trabaja con año+mes, sin día, así que
 * no hay desborde tipo "31 de enero + 1 mes = 3 de marzo" de `Date.setMonth`.
 */
export function addMonths(value: YearMonth, delta: number): YearMonth {
  assertMonth(value);
  const index = value.year * 12 + (value.month - 1) + delta;
  return { year: Math.floor(index / 12), month: (((index % 12) + 12) % 12) + 1 };
}

/** -1, 0 o 1 según `a` sea anterior, igual o posterior a `b`. */
export function compareMonths(a: YearMonth, b: YearMonth): number {
  return Math.sign(a.year * 12 + a.month - (b.year * 12 + b.month));
}

/**
 * Rango de un mes: `desde` = primer día del mes, `hasta` = primer día del mes
 * siguiente. Se usa `.gte('fecha', desde).lt('fecha', hasta)`, que funciona
 * igual en meses de 28, 30 o 31 días y en diciembre (hasta = 1 de enero del
 * año siguiente). Es aritmética de año/mes: no pasa por Date ni por UTC.
 */
export function monthRange(year: number, month: number): MonthRange {
  const start: YearMonth = { year, month };
  assertMonth(start);
  const next = addMonths(start, 1);
  return { desde: formatYmd(year, month, 1), hasta: formatYmd(next.year, next.month, 1) };
}

// ---------------------------------------------------------------------------
// Formato (siempre en español)
// ---------------------------------------------------------------------------

const LOCALE = 'es';

// Se formatea un instante fijo al MEDIODÍA UTC con timeZone 'UTC': el día y el
// mes que se ven son exactamente los pedidos, sin importar la zona horaria
// del dispositivo ni cambios de horario de verano.
function utcNoon(year: number, month: number, day: number): Date {
  const date = new Date(Date.UTC(2000, 0, 1, 12));
  date.setUTCFullYear(year, month - 1, day); // una sola llamada: sin desbordes intermedios
  return date;
}

const monthNameFormatter = new Intl.DateTimeFormat(LOCALE, { month: 'long', timeZone: 'UTC' });

function monthName(year: number, month: number, day = 1): string {
  return monthNameFormatter.format(utcNoon(year, month, day));
}

/** "septiembre 2026" */
export function formatMonthLabel(value: YearMonth): string {
  assertMonth(value);
  return `${monthName(value.year, value.month)} ${value.year}`;
}

/**
 * "30 sep". El mes abreviado son las 3 primeras letras del nombre completo
 * que da Intl en español (ene, feb, mar, abr, may, jun, jul, ago, sep, oct,
 * nov, dic). `Intl` con `month: 'short'` da "sept" según la versión de
 * ICU/navegador; así la abreviatura es la misma en todos los dispositivos.
 * Si el texto no es una fecha válida se devuelve tal cual (no rompe el render).
 */
export function formatDateShort(value: string): string {
  const parts = parseDateParts(value);
  if (!parts) return value;
  return `${parts.day} ${monthName(parts.year, parts.month, parts.day).slice(0, 3)}`;
}

// ---------------------------------------------------------------------------
// Validación de fechas tipeadas (mensajes para el usuario)
// ---------------------------------------------------------------------------

export interface DateRules {
  /** 'YYYY-MM-DD' inclusive. */
  min?: string;
  /** 'YYYY-MM-DD' inclusive. P.ej. `todayLocal()` para gastos. */
  max?: string;
}

export type DateValidation = { ok: true; value: string } | { ok: false; message: string };
export type OptionalDateValidation = { ok: true; value: string | null } | { ok: false; message: string };

/** "a hoy" si es la fecha de hoy; si no, "al 30 sep 2026" (para "anterior/posterior ..."). */
function describeBound(bound: string): string {
  if (bound === todayLocal()) return 'a hoy';
  return `al ${formatDateShort(bound)} ${bound.slice(0, 4)}`;
}

/**
 * Valida una fecha 'YYYY-MM-DD' (la que entrega `<input type="date">`).
 * Los formularios van con `noValidate`, así que `min`/`max` del input NO se
 * aplican al enviar, y en escritorio se puede tipear un año de 5 o 6 dígitos
 * ("202026-09-30"): esto lo atrapa. Las cadenas ISO se comparan como texto
 * (mismo largo, mismo orden que el calendario).
 */
export function validateRequiredDate(value: string, rules: DateRules = {}): DateValidation {
  if (value.trim() === '') return { ok: false, message: 'Elige una fecha.' };
  if (!isValidDateString(value)) {
    return { ok: false, message: 'La fecha no es válida. Revisa el día, el mes y el año.' };
  }
  if (rules.min !== undefined && value < rules.min) {
    return { ok: false, message: `La fecha no puede ser anterior ${describeBound(rules.min)}.` };
  }
  if (rules.max !== undefined && value > rules.max) {
    return { ok: false, message: `La fecha no puede ser posterior ${describeBound(rules.max)}.` };
  }
  return { ok: true, value };
}

/** Campo opcional: vacío es válido y da `null`; si hay algo, se valida igual. */
export function validateOptionalDate(value: string, rules: DateRules = {}): OptionalDateValidation {
  if (value.trim() === '') return { ok: true, value: null };
  return validateRequiredDate(value, rules);
}

// ---------------------------------------------------------------------------
// Fecha de un registro (gastos, viajes) y mes en la URL
// ---------------------------------------------------------------------------

/**
 * Primer año que aceptan las pantallas de Gastos y Viajes: es lo más viejo que el selector de mes y
 * `?mes=` pueden alcanzar. La fecha de un registro NO puede ser anterior (`MIN_FECHA`): si no, se
 * guardaría pero quedaría inalcanzable en la lista. En escritorio, Chrome deja tipear el año con
 * 2 dígitos ("26" → 0026-10-01), y la base lo acepta como fecha válida.
 */
export const MIN_YEAR = 2000;

/** Fecha mínima de un registro, 'YYYY-MM-DD', derivada de `MIN_YEAR`. */
export const MIN_FECHA = `${String(MIN_YEAR).padStart(4, '0')}-01-01`;

/**
 * Fecha obligatoria de un registro de la lista de un mes (gasto, viaje): existe en el calendario, no es
 * anterior a `MIN_FECHA` ni posterior a `today` (hoy en hora local, 'YYYY-MM-DD').
 */
export function validateFechaDeRegistro(value: string, today: string): DateValidation {
  return validateRequiredDate(value, { min: MIN_FECHA, max: today });
}

const MES_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** 'YYYY-MM' → mes, o null si no es un mes válido entre enero de 2000 y el mes actual
 *  (el futuro no tiene registros: no se puede cargar uno con fecha futura). */
export function parseMesParam(raw: string | null | undefined, now: Date = new Date()): YearMonth | null {
  if (typeof raw !== 'string') return null;
  const match = MES_PATTERN.exec(raw);
  if (!match) return null;
  const mes: YearMonth = { year: Number(match[1]), month: Number(match[2]) };
  if (mes.year < MIN_YEAR) return null;
  if (compareMonths(mes, currentMonth(now)) > 0) return null;
  return mes;
}

/** Mes → 'YYYY-MM' (el formato de `?mes=`). */
export function formatMesParam(mes: YearMonth): string {
  return `${String(mes.year).padStart(4, '0')}-${String(mes.month).padStart(2, '0')}`;
}
