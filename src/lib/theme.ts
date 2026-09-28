/**
 * Sistema de theming en runtime de Elan.
 *
 * Esta capa SOLO aplica overrides sobre las variables CSS definidas en
 * `src/index.css` (:root / .dark). No persiste nada (eso vive en el
 * Bloque B, en la UI de Configuración, contra Supabase/localStorage) y no
 * conoce sesión ni tenant: recibe un modo o un hex y lo aplica al DOM.
 *
 * Regla de seguridad: `applyAccentColor` nunca interpola texto libre en
 * CSS. Valida el hex contra un regex estricto (^#RRGGBB$) y sólo entonces
 * lo convierte a HSL numérico antes de tocar `document.documentElement`.
 * Si el valor no matchea, no se toca nada del theming actual (fail-safe,
 * no fail-open): mejor quedarse con el acento vigente que aplicar algo
 * a medio validar. El hex en sí debe originarse siempre en datos de la
 * base (perfil de tenant), nunca en texto tipeado libre sin pasar por acá.
 */

export type ThemeMode = 'dark' | 'light';

export const DEFAULT_THEME: ThemeMode = 'dark';
export const DEFAULT_ACCENT = '#F59E0B';

/** Único formato aceptado: numeral + 6 dígitos hex, sin abreviado (#RGB),
 *  sin alpha (#RRGGBBAA) y sin nombres de color CSS. */
const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

/** Hue (en grados, escala HSL) del token --destructive fijo en index.css. */
const DESTRUCTIVE_HUE_DEG = 0;

/** Distancia angular mínima (grados) para considerar un acento "seguro"
 *  respecto del rojo de --destructive. Por debajo de esto, Configuración
 *  (Bloque B) debería advertir al usuario antes de guardar. */
const DESTRUCTIVE_PROXIMITY_THRESHOLD_DEG = 20;

/** Por debajo de esta saturación el color se percibe como gris neutro,
 *  no como "rojo": no tiene sentido compararlo contra --destructive. */
const NEUTRAL_SATURATION_THRESHOLD = 15;

const ACCENT_CSS_VARS = {
  primary: '--primary',
  ring: '--ring',
  primaryForeground: '--primary-foreground',
} as const;

/** Atributo booleano en <html> que activa el tratamiento visual extra para
 *  elementos destructivos (ver src/index.css) cuando el acento elegido se
 *  confunde con --destructive. Presencia = true, ausencia = false (mismo
 *  patrón que `disabled`/`hidden`), togglado siempre junto con el color. */
const ACCENT_WARNING_ATTR = 'data-accent-warn';

interface Hsl {
  h: number;
  s: number;
  l: number;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Convierte un #RRGGBB validado a HSL numérico (h en [0,360), s/l en [0,100]). */
function hexToHsl(hex: string): Hsl | null {
  if (!HEX_COLOR_PATTERN.test(hex)) return null;

  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const l = (max + min) / 2;

  let h = 0;
  let s = 0;

  if (delta !== 0) {
    s = delta / (1 - Math.abs(2 * l - 1));
    switch (max) {
      case r:
        h = ((g - b) / delta) % 6;
        break;
      case g:
        h = (b - r) / delta + 2;
        break;
      default:
        h = (r - g) / delta + 4;
    }
    h *= 60;
    if (h < 0) h += 360;
  }

  return { h, s: s * 100, l: l * 100 };
}

/**
 * Convierte un hex `#RRGGBB` al formato "H S% L%" usado en las variables
 * CSS de shadcn (mismo formato que --primary en index.css).
 * Devuelve `null` si el hex no matchea el patrón estricto.
 */
export function hexToHslTriplet(hex: string): string | null {
  const hsl = hexToHsl(hex);
  if (!hsl) return null;
  return `${round1(hsl.h)} ${round1(hsl.s)}% ${round1(hsl.l)}%`;
}

function relativeLuminance(hex: string): number {
  const channel = (value: number): number => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const r = channel(parseInt(hex.slice(1, 3), 16));
  const g = channel(parseInt(hex.slice(3, 5), 16));
  const b = channel(parseInt(hex.slice(5, 7), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(hexA: string, hexB: string): number {
  const lumA = relativeLuminance(hexA);
  const lumB = relativeLuminance(hexB);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Devuelve el negro o blanco puro que dé mejor contraste WCAG sobre `hex`.
 * Se usa para calcular `--primary-foreground` cuando el usuario personaliza
 * el color de acento: nunca un tono intermedio, siempre el extremo que
 * garantiza mejor legibilidad de texto sobre botones/elementos primary.
 */
export function getContrastForeground(hex: string): '#000000' | '#ffffff' {
  if (!HEX_COLOR_PATTERN.test(hex)) return '#000000';
  const contrastWithBlack = contrastRatio(hex, '#000000');
  const contrastWithWhite = contrastRatio(hex, '#ffffff');
  return contrastWithBlack >= contrastWithWhite ? '#000000' : '#ffffff';
}

/**
 * True si `hex` cae dentro de ~20° de hue del rojo de --destructive y no es
 * un gris neutro. Pensado para que la UI de Configuración (Bloque B) avise
 * "este color se puede confundir con las acciones destructivas" antes de
 * guardar, no para bloquear nada acá.
 */
export function isAccentTooCloseToDestructive(hex: string): boolean {
  const hsl = hexToHsl(hex);
  if (!hsl) return false;
  if (hsl.s < NEUTRAL_SATURATION_THRESHOLD) return false;

  const diff = Math.abs(hsl.h - DESTRUCTIVE_HUE_DEG);
  const angularDistance = Math.min(diff, 360 - diff);
  return angularDistance <= DESTRUCTIVE_PROXIMITY_THRESHOLD_DEG;
}

/** Togglea la clase `dark` en <html>. No persiste preferencia. */
export function applyTheme(mode: ThemeMode): void {
  document.documentElement.classList.toggle('dark', mode === 'dark');
}

/**
 * Aplica `hex` como color de acento (--primary/--ring) más un
 * --primary-foreground de alto contraste calculado. Si `hex` no matchea
 * `^#[0-9A-Fa-f]{6}$` no toca nada y devuelve `false`.
 */
export function applyAccentColor(hex: string): boolean {
  const triplet = hexToHslTriplet(hex);
  if (!triplet) {
    console.warn(`[theme] Color de acento inválido, se ignora: ${hex}`);
    return false;
  }

  const foregroundHex = getContrastForeground(hex);
  const foregroundTriplet = hexToHslTriplet(foregroundHex);

  const inlineStyle = document.documentElement.style;
  inlineStyle.setProperty(ACCENT_CSS_VARS.primary, triplet);
  inlineStyle.setProperty(ACCENT_CSS_VARS.ring, triplet);
  if (foregroundTriplet) {
    inlineStyle.setProperty(ACCENT_CSS_VARS.primaryForeground, foregroundTriplet);
  }

  // Un solo lugar decide si el acento se confunde con el rojo de error: acá
  // mismo, cada vez que se aplica un color. Configuración solo lee este
  // atributo para su propio aviso in-page; el tratamiento visual global de
  // los elementos destructivos vive en CSS (ver index.css).
  document.documentElement.toggleAttribute(ACCENT_WARNING_ATTR, isAccentTooCloseToDestructive(hex));

  return true;
}

/** Quita los overrides inline de acento, volviendo al ámbar por defecto
 *  definido en index.css (:root / .dark). */
export function resetAccentColor(): void {
  const inlineStyle = document.documentElement.style;
  inlineStyle.removeProperty(ACCENT_CSS_VARS.primary);
  inlineStyle.removeProperty(ACCENT_CSS_VARS.ring);
  inlineStyle.removeProperty(ACCENT_CSS_VARS.primaryForeground);
  document.documentElement.removeAttribute(ACCENT_WARNING_ATTR);
}
