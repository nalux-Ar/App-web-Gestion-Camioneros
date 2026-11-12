/**
 * Cuánto dura en pantalla un aviso de "guardado" / "eliminado" antes de cerrarse solo: 10 segundos (antes 5).
 *
 * Quien lee despacio, o mira la pantalla recién después de soltar el volante o el celular, necesita tiempo para leerlo
 * (WCAG 2.2.1: los límites de tiempo tienen que poder ser largos). Además el aviso tiene su botón "Cerrar aviso"
 * (48 px), así que quien ya lo leyó no tiene que esperar. Es UN solo número para todas las pantallas que lo muestran
 * (Gastos, Viajes, el detalle del viaje, Clientes, el detalle del cliente y Camiones).
 */
export const AVISO_AUTOCIERRE_MS = 10_000;
