import type { MemberStatus } from '@/features/member/member-context';

/**
 * Qué versión del recorrido de bienvenida vio cada usuario. Lógica pura + una copia local chica (no sensible).
 *
 * La fuente de verdad es la base (`miembros.tour_version_vista`, migración 017). La copia en localStorage
 * (`{ userId, version }`) existe para que, si al terminar o saltar el recorrido no hay señal, NO se vuelva a mostrar: se
 * guarda primero acá y después en la base; si la base falla, al arrancar con señal se reintenta en silencio. Es del usuario
 * que la escribió: con otro usuario se ignora, y se borra al cerrar sesión o al cambiar de usuario.
 */

/** La versión actual del recorrido. Subirla vuelve a mostrarlo a todos (p. ej. con novedades grandes). */
export const TOUR_VERSION = 1;

const STORAGE_KEY = 'elan:tour-visto';

/** Un entero >= 0; cualquier otra cosa (null, texto, negativo, decimal, NaN) cuenta como 0 ("nunca lo vio"). */
export function normalizarVersion(valor: unknown): number {
  return typeof valor === 'number' && Number.isInteger(valor) && valor >= 0 ? valor : 0;
}

/** La versión que este usuario vio según la copia local (0 si no hay, si es de otro usuario o si está rota). */
export function leerTourVistoLocal(userId: string | null): number {
  if (userId === null) return 0;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return 0;
    const dato: unknown = JSON.parse(raw);
    if (typeof dato !== 'object' || dato === null) return 0;
    const { userId: dueno, version } = dato as { userId?: unknown; version?: unknown };
    return dueno === userId ? normalizarVersion(version) : 0;
  } catch {
    return 0;
  }
}

/** Guarda la versión vista por este usuario (nunca baja: si ya había una mayor del mismo usuario, queda esa). */
export function guardarTourVistoLocal(userId: string, version: number): void {
  try {
    const nueva = Math.max(normalizarVersion(version), leerTourVistoLocal(userId));
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ userId, version: nueva }));
  } catch {
    // Sin storage: no rompe nada; solo no hay copia local.
  }
}

/** Al cerrar sesión o cambiar de usuario. */
export function limpiarTourVistoLocal(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // idem
  }
}

/** La versión vista: la mayor entre la base y la copia local. */
export function versionVista(base: number, local: number): number {
  return Math.max(normalizarVersion(base), normalizarVersion(local));
}

/** ¿Hay que reintentar guardar en la base? (la copia local quedó adelante: una escritura anterior falló). */
export function debeReintentarGuardar(base: number, local: number): boolean {
  return normalizarVersion(local) > normalizarVersion(base);
}

/**
 * ¿Se muestra el recorrido automático? Solo con el miembro listo, exactamente en Inicio (`/`) y si la versión vista (base
 * o local) es menor que la actual. Nunca en /bienvenida, en la recuperación de contraseña ni sin miembro.
 */
export function debeMostrarseElTour(args: { status: MemberStatus; pathname: string; versionBase: number; versionLocal: number; actual?: number }): boolean {
  const actual = args.actual ?? TOUR_VERSION;
  return args.status === 'ready' && args.pathname === '/' && versionVista(args.versionBase, args.versionLocal) < actual;
}
