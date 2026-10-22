/**
 * Textos de "Reportar un problema". Español neutro, de "tú". Lógica pura: se prueban sueltos.
 */

export const RUTA_REPORTAR = '/reportar';

export const TITULO_REPORTAR = 'Reportar un problema';
export const INTRO_REPORTAR = 'Cuéntanos qué pasó o qué se ve raro. Lo leemos nosotros.';
export const ETIQUETA_MENSAJE = '¿Qué pasó?';
export const AYUDA_MENSAJE = 'No escribas contraseñas ni datos de otras personas.';
/** Qué se manda solo, además del mensaje (ver `contexto.ts` y `ultima-pantalla.ts`). */
export const QUE_SE_ENVIA =
  'Con tu mensaje enviamos el nombre de la pantalla en la que estabas (sin los datos que tenías cargados), qué versión de la app usas, tu navegador y los últimos errores técnicos que vio la app. El reporte queda asociado a tu cuenta.';

export const BOTON_ENVIAR = 'Enviar reporte';
export const ENVIANDO = 'Enviando…';

/** Tope del mensaje (el mismo `check` de la base: 1 a 2000 caracteres sin los espacios de los extremos). */
export const MAX_MENSAJE = 2000;

export const MENSAJE_VACIO = 'Escribe qué pasó antes de enviar.';

export function textoMensajeLargo(caracteres: number): string {
  return `Tu mensaje tiene ${caracteres} caracteres. El máximo es ${MAX_MENSAJE}: acórtalo un poco.`;
}

/** El contador bajo el campo: "120 de 2000 caracteres". */
export function textoContador(caracteres: number): string {
  return `${caracteres} de ${MAX_MENSAJE} caracteres`;
}

export const GRACIAS_TITULO = 'Gracias, lo recibimos';
export const GRACIAS_TEXTO = 'Vamos a revisarlo. Si pasa otra cosa, puedes enviar otro reporte cuando quieras.';
export const BOTON_VOLVER = 'Volver';

/** El tope anti-spam de la base (el reporte número 31 en 24 horas): reintentar no sirve. */
export const TOPE_ALCANZADO = 'Ya enviaste muchos reportes en las últimas 24 horas. Podrás enviar otro más tarde.';

/** La base rechazó el mensaje por su `check` (no debería pasar: la pantalla valida lo mismo). */
export const MENSAJE_RECHAZADO = `Revisa el mensaje: tiene que tener texto y hasta ${MAX_MENSAJE} caracteres.`;
/** La base rechazó la pantalla o el contexto técnico por su `check` (no debería pasar: se recortan antes). */
export const PROBLEMA_DE_LA_APP = 'No pudimos enviar el reporte por un problema de la app. Prueba de nuevo más tarde.';

/** El atajo del header (nombre accesible del botón de ícono) y la tarjeta de Configuración. */
export const ETIQUETA_ATAJO = 'Reportar un problema';
export const TARJETA_TITULO = 'Reportar un problema';
export const TARJETA_DESCRIPCION = 'Si algo no funciona o se ve raro, cuéntanos. También puedes hacerlo desde el ícono de arriba.';
export const TARJETA_BOTON = 'Reportar un problema';
