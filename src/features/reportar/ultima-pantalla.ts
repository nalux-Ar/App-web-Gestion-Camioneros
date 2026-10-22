/**
 * La "última pantalla de trabajo": en qué pantalla estaba la persona antes de ir a "Reportar un problema". Sirve para
 * (1) mandarla con el reporte (columna `pantalla`) y (2) el botón "Volver" después de enviar.
 *
 * Vive en una variable de MÓDULO (no en estado de React ni en la navegación): la actualiza `useRegistrarUltimaPantalla`
 * (montado en el `AppShell`) en cada cambio de ubicación, IGNORANDO `/reportar` y `/configuracion` (así sirve igual desde
 * el atajo del header que desde la tarjeta de Configuración). Se limpia al cerrar sesión o cambiar de usuario
 * (`AuthProvider`, junto con la caché de datos).
 *
 * Se guarda `pathname + search` SANEADO (`sanearPantalla`). Nunca se navega a ella salvo el "Volver", y solo si además
 * pasa la lista blanca de rutas de la app (`rutaDeVuelta`, en ruta-de-vuelta.ts); si no, se vuelve a Inicio.
 */

/** Tope de la columna `pantalla` (y de lo que se guarda). */
export const MAX_PANTALLA = 300;

/** Rutas que NO cuentan como pantalla de trabajo: la de reportar y la de Configuración (desde donde también se llega). */
export const RUTAS_IGNORADAS: readonly string[] = ['/reportar', '/configuracion'];

let ultimaPantalla: string | null = null;

/** ¿Algún caracter de control (C0, DEL o C1) o espacio en blanco? */
function tieneControlOEspacio(valor: string): boolean {
  for (const caracter of valor) {
    const code = caracter.codePointAt(0) ?? 0;
    if (code <= 0x20 || (code >= 0x7f && code < 0xa0) || /\s/.test(caracter)) return true;
  }
  return false;
}

/**
 * `pathname + search` interno y prolijo, o null: empieza con "/" (y no con "//" ni "/\", que algunos navegadores leen como
 * otro sitio), sin espacios ni caracteres de control, y hasta 300 caracteres. Un `javascript:…` o una URL absoluta no
 * empiezan con "/": quedan afuera.
 */
export function sanearPantalla(valor: unknown): string | null {
  if (typeof valor !== 'string' || valor.length === 0 || valor.length > MAX_PANTALLA) return null;
  if (!valor.startsWith('/') || valor.startsWith('//') || valor.startsWith('/\\')) return null;
  if (tieneControlOEspacio(valor)) return null;
  return valor;
}

/** Anota la pantalla actual, salvo las ignoradas o una que no pasa el saneo (en ese caso queda la anterior). */
export function registrarPantalla(pathname: string, search: string): void {
  if (RUTAS_IGNORADAS.includes(pathname)) return;
  const pantalla = sanearPantalla(`${pathname}${search}`);
  if (pantalla !== null) ultimaPantalla = pantalla;
}

/** La última pantalla de trabajo anotada (ya saneada), o null. */
export function leerUltimaPantalla(): string | null {
  return ultimaPantalla;
}

/** Al cerrar sesión o cambiar de usuario. */
export function limpiarUltimaPantalla(): void {
  ultimaPantalla = null;
}

const UUID_EN_RUTA = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * Lo que viaja al SERVIDOR en la columna `pantalla`: solo el NOMBRE de la pantalla. Se corta en el primer `?` o `#` (la
 * búsqueda puede traer lo que la persona tipeó, p. ej. `?q=` con el nombre de un cliente, que es dato de un tercero) y cada
 * uuid se cambia por `:id` (`/viajes/:id/editar`): ningún id de registro sale de la app. Vacío → null.
 *
 * La ruta COMPLETA (saneada) se sigue usando solo en el dispositivo, para el "Volver" (`rutaDeVuelta`).
 */
export function pantallaParaElReporte(valor: string | null): string | null {
  if (valor === null) return null;
  const corte = valor.search(/[?#]/);
  const pathname = (corte === -1 ? valor : valor.slice(0, corte)).replace(UUID_EN_RUTA, ':id');
  return pathname.length > 0 ? pathname : null;
}
