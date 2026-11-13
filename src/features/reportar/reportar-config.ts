/**
 * Interruptor de "Reportar un problema" (la pantalla donde la persona le cuenta al equipo qué falló).
 *
 * Con `false`, la función queda OCULTA: no se dibuja el atajo del header ni la tarjeta de Configuración, las ayudas «Ayuda»
 * de Inicio y de Configuración no la nombran, el recorrido de bienvenida no tiene su paso y la ruta `/reportar` lleva a
 * Inicio. Está en `false` A PROPÓSITO: la función se oculta, no se elimina. El código de `src/features/reportar`, la tabla
 * `reportes` y sus datos siguen intactos, y lo que la app junta en memoria para el reporte (los errores recientes y la
 * última pantalla) se sigue anotando igual: no sale del dispositivo mientras nadie envíe un reporte.
 *
 * Para reactivarla basta con poner `true` aquí: todo vuelve a como estaba antes de ocultarla (mismos textos, mismo orden).
 * Una sola salvedad: quien ya vio el recorrido de bienvenida NO lo repite, porque `TOUR_VERSION` no se subió al ocultar
 * la función. Si se quiere que todos vean de nuevo el paso de «Reportar un problema», hay que subir esa versión
 * (`src/features/ayuda/tour-version.ts`).
 *
 * Este archivo no tiene imports a propósito: lo leen módulos que se cargan al inicio (el router, los textos de ayuda y
 * los pasos del recorrido) y no debe arrastrar nada del código de la función.
 */
export const REPORTAR_VISIBLE: boolean = false;
