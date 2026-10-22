/**
 * La versión desplegada de la app: los primeros 7 caracteres del commit (la define `vite.config.ts` como `__APP_VERSION__`
 * con `VERCEL_GIT_COMMIT_SHA`), o 'local' fuera de Vercel. Se manda con "Reportar un problema" para saber en qué versión
 * pasó algo. Si la constante no está definida (p. ej. en las pruebas, que usan su propia config), 'local'.
 */
export const APP_VERSION: string = leerVersion(typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : undefined);

/** Solo un hash corto (hex) o 'local': cualquier otra cosa se descarta. */
export function leerVersion(valor: string | undefined): string {
  return typeof valor === 'string' && /^[0-9a-f]{7}$/.test(valor) ? valor : 'local';
}
