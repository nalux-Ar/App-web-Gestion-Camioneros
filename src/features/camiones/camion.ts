import { formatearPatente } from './patente';

/**
 * Un camión tal como lo trae la lista (activos y archivados) y cómo se nombra en pantalla. Lógica PURA.
 *
 * La patente de un camión se muestra SIEMPRE desde esta lista ya cargada (`useCamiones`), nunca embebida en otras
 * consultas (`camiones(...)` dentro de viajes o gastos): así renombrar o archivar un camión solo obliga a refrescar la
 * lista de camiones, y la misma lista la reusa el Resumen.
 */

export interface CamionDeLista {
  id: string;
  /** Normalizada (solo A-Z y 0-9). */
  patente: string;
  marca: string | null;
  modelo: string | null;
  anio: number | null;
  /** false = archivado. */
  activa: boolean;
}

/** "Scania R450 · 2019" (solo lo que haya), o null si no tiene marca, modelo ni año. */
export function descripcionCamion(camion: Pick<CamionDeLista, 'marca' | 'modelo' | 'anio'>): string | null {
  const nombre = [camion.marca, camion.modelo].filter((parte): parte is string => !!parte && parte.trim() !== '').join(' ');
  const partes = [nombre, camion.anio !== null ? String(camion.anio) : ''].filter((parte) => parte !== '');
  return partes.length > 0 ? partes.join(' · ') : null;
}

/**
 * Cómo se nombra un camión en un selector o una fila: la patente con espacios ("AB 123 CD") y, si está archivado,
 * "(archivado)". Con `conDescripcion`, también la marca, el modelo y el año. Un camión que no está en la lista (no
 * debería pasar) se nombra "Camión no disponible".
 */
export function etiquetaCamion(camion: CamionDeLista | null | undefined, { conDescripcion = false } = {}): string {
  if (!camion || camion.patente === '') return 'Camión no disponible';
  const descripcion = conDescripcion ? descripcionCamion(camion) : null;
  const base = descripcion ? `${formatearPatente(camion.patente)} · ${descripcion}` : formatearPatente(camion.patente);
  return camion.activa ? base : `${base} (archivado)`;
}

/** Por patente (orden estable): la lista se muestra y se elige siempre en el mismo orden. */
export function ordenarCamiones<T extends Pick<CamionDeLista, 'id' | 'patente'>>(camiones: readonly T[]): T[] {
  return [...camiones].sort((a, b) => a.patente.localeCompare(b.patente, 'en') || a.id.localeCompare(b.id));
}

/** Busca un camión por id en la lista (o null). */
export function buscarCamion<T extends Pick<CamionDeLista, 'id'>>(camiones: readonly T[], id: string | null | undefined): T | null {
  if (!id) return null;
  return camiones.find((camion) => camion.id === id) ?? null;
}
