import { erroresRecientes, type ErrorReciente } from '@/lib/errores-recientes';
import { APP_VERSION } from '@/lib/version';

/**
 * El contexto técnico que viaja con un reporte (columna `contexto`, un objeto JSON de hasta 4000 bytes): la versión de la
 * app, el navegador, el tamaño de la pantalla, si había conexión, el idioma y los últimos errores técnicos (ya en lista
 * blanca, ver src/lib/errores-recientes.ts). NADA personal: ni correo, ni ids del usuario o de la cuenta, ni datos de la
 * base. Lógica pura salvo `leerEntorno`.
 */

/** Tope de la columna `contexto` en la base (bytes del JSON). */
export const MAX_CONTEXTO_BYTES = 4000;
const MAX_NAVEGADOR = 200;
const MAX_IDIOMA = 35;

/** `type` (no `interface`): tiene que poder ir en una columna JSON. */
export type ContextoDelReporte = {
  version: string;
  navegador: string;
  pantalla_tamano: string;
  en_linea: boolean;
  idioma: string;
  errores_recientes: ErrorReciente[];
};

/** Lo que se lee del navegador (inyectable en las pruebas). */
export type Entorno = {
  userAgent: string;
  ancho: number;
  alto: number;
  enLinea: boolean;
  idioma: string;
};

export function leerEntorno(): Entorno {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  const win = typeof window !== 'undefined' ? window : undefined;
  return {
    userAgent: nav?.userAgent ?? '',
    ancho: win?.innerWidth ?? 0,
    alto: win?.innerHeight ?? 0,
    enLinea: nav?.onLine ?? true,
    idioma: nav?.language ?? '',
  };
}

/** Sin caracteres de control y recortado (por code points, sin partir un emoji al medio). */
function textoPlano(valor: string, max: number): string {
  return Array.from(valor)
    .filter((caracter) => {
      const code = caracter.codePointAt(0) ?? 0;
      return code >= 0x20 && !(code >= 0x7f && code < 0xa0);
    })
    .slice(0, max)
    .join('');
}

function dimension(valor: number): number {
  return Number.isFinite(valor) && valor > 0 ? Math.min(Math.round(valor), 99999) : 0;
}

/** Bytes del JSON (lo que mide la base). */
export function bytesDe(valor: unknown): number {
  return new TextEncoder().encode(JSON.stringify(valor)).length;
}

/**
 * Arma el contexto. Si pasara de `limite` bytes (no debería: los errores son pocos y cortos), recorta lo menos importante
 * primero: los errores más viejos, después el navegador; la versión, el tamaño, la conexión y el idioma quedan siempre.
 */
export function armarContexto(
  entorno: Entorno = leerEntorno(),
  errores: readonly ErrorReciente[] = erroresRecientes(),
  version: string = APP_VERSION,
  limite: number = MAX_CONTEXTO_BYTES,
): ContextoDelReporte {
  const idioma = textoPlano(entorno.idioma, MAX_IDIOMA);
  const contexto: ContextoDelReporte = {
    version,
    navegador: textoPlano(entorno.userAgent, MAX_NAVEGADOR),
    pantalla_tamano: `${dimension(entorno.ancho)}x${dimension(entorno.alto)}`,
    en_linea: entorno.enLinea === true,
    idioma: /^[A-Za-z0-9-]+$/.test(idioma) ? idioma : '',
    errores_recientes: [...errores],
  };
  while (bytesDe(contexto) > limite && contexto.errores_recientes.length > 0) contexto.errores_recientes.shift();
  if (bytesDe(contexto) > limite) contexto.navegador = textoPlano(contexto.navegador, 50);
  if (bytesDe(contexto) > limite) contexto.navegador = '';
  return contexto;
}
