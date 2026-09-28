import { DEFAULT_THEME, hexToHslTriplet, type ThemeMode } from './theme';

/**
 * Caché en localStorage de la última preferencia de tema CONOCIDA (no
 * sensible: solo tema claro/oscuro + color de acento). Sirve únicamente
 * para aplicar el tema correcto antes del primer render (evitar el flash
 * "oscuro dorado por defecto -> claro/acento del usuario" al recargar la
 * página). La base de datos (`miembros.tema` / `miembros.color_acento`)
 * sigue siendo la fuente de verdad: esto es solo una copia de lectura
 * rápida, se reescribe cada vez que se confirma la preferencia real.
 *
 * Nunca se guarda nada sensible acá (ni sesión, ni contraseña, ni tokens).
 * Todo acceso a localStorage está envuelto en try/catch: en navegadores
 * con storage bloqueado (modo privado estricto, políticas corporativas)
 * la app tiene que seguir funcionando, solo sin este atajo.
 */
const STORAGE_KEY = 'elan:pref-tema';

export interface CachedThemePreference {
  tema: ThemeMode;
  colorAcento: string | null;
}

export function readCachedThemePreference(): CachedThemePreference | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;

    const candidate = parsed as { tema?: unknown; colorAcento?: unknown };
    const tema: ThemeMode | null =
      candidate.tema === 'light' ? 'light' : candidate.tema === 'dark' ? 'dark' : null;
    if (!tema) return null;

    const colorAcento =
      typeof candidate.colorAcento === 'string' && hexToHslTriplet(candidate.colorAcento)
        ? candidate.colorAcento
        : null;

    return { tema, colorAcento };
  } catch {
    return null;
  }
}

export function writeCachedThemePreference(pref: CachedThemePreference): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pref));
  } catch {
    // Sin storage disponible: no rompe la app, solo no hay caché.
  }
}

export function clearCachedThemePreference(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // idem arriba
  }
}

/** Preferencia a aplicar antes del primer render si no hay caché todavía
 *  (coincide con los valores por defecto de index.css, así que en rigor es
 *  un no-op visual, pero deja explícito cuál es el fallback). */
export const FALLBACK_THEME_PREFERENCE: CachedThemePreference = {
  tema: DEFAULT_THEME,
  colorAcento: null,
};
