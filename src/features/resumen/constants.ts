/**
 * Constantes de la pantalla Resumen. Los topes son los de las funciones de la migración 014 (`014_resumen.sql`): el front
 * nunca debería mandar un período fuera de ellos (la base respondería 22023), así que la capa de datos los controla antes
 * de llamar.
 */

/** `resumen_gastos` y `resumen_combustible`: `p_hasta - p_desde` no puede superar 366 días (un año, bisiesto incluido). */
export const MAX_DIAS_PERIODO = 366;

/** `resumen_viajes`: `p_hasta - p_desde` no puede superar 62 días (la lista de viajes es de un mes, con margen). */
export const MAX_DIAS_VIAJES = 62;

/** `resumen_mensual`: entre 1 y 24 meses. */
export const MAX_MESES = 24;

/** `resumen_viajes` devuelve como máximo 500 filas (con `total_viajes` para saber si se cortó). */
export const MAX_FILAS_VIAJES = 500;

/** `resumen_gastos_varios` devuelve como máximo 30 filas (con `total_cantidad` para saber si se cortó). */
export const MAX_FILAS_GASTOS_VARIOS = 30;

/**
 * Los números del Resumen se consideran frescos 1 minuto. No hace falta más: las mutaciones que cambian lo que lee
 * (gastos, viajes y camiones) invalidan `resumenKeys.all` (`invalidarResumen`), así que lo cargado desde esta app se ve
 * enseguida; el minuto solo cubre lo cargado desde otro dispositivo (se ve al volver a entrar a la pantalla).
 */
export const RESUMEN_STALE_TIME_MS = 60_000;
