import { REPORTAR_VISIBLE } from '@/features/reportar/reportar-config';
import type { PasoTour } from './posicion';

/**
 * El recorrido de bienvenida (Inicio) completo: 5 pasos, con el de «Reportar un problema». Español neutro, de "tú", textos
 * planos y CORTOS (hasta 15 palabras por texto: lo lee gente mayor, a veces con sol de frente). Cada objetivo es el
 * `data-ayuda` de un elemento real: la barra de navegación (el `<nav>` de abajo en el celular, la lista de ítems de la
 * lateral a la izquierda en escritorio; el motor toma la que se ve), la tarjeta del camión de Inicio (sus 3 variantes), el atajo "Reportar un problema" del header y el
 * botón «Ayuda» de Inicio. No se exporta: lo que se muestra sale de `pasosDelTour`.
 *
 * Antes eran 9 pasos (uno por cada sección de la barra, y Configuración): se recortaron a lo esencial. Como NO se subió
 * `TOUR_VERSION`, quien ya vio el recorrido largo no lo repite; lo ven los usuarios nuevos y quien lo pide desde «Ayuda».
 */
const PASOS_COMPLETOS: readonly PasoTour[] = [
  {
    // Una pregunta, no una explicación: «Sí» sigue y «Ahora no» lo termina (queda como visto y no insiste en cada ingreso).
    id: 'bienvenida',
    objetivo: null,
    titulo: '¿Te mostramos cómo se usa?',
    texto: 'Son pocos pasos. Después puedes verlo otra vez desde «Ayuda».',
    siFalta: 'centrado',
    invitacion: true,
  },
  {
    // El título NO dice «abajo»: en escritorio la barra está a la izquierda.
    id: 'barra',
    objetivo: 'nav',
    titulo: 'Para ir a cada parte',
    texto: 'Desde esta barra vas a Viajes, Gastos, Clientes y Resumen.',
    siFalta: 'saltar',
  },
  {
    id: 'camion',
    objetivo: 'camion',
    titulo: 'Tu camión',
    texto: 'Se usa en tus viajes y gastos. Si tienes varios, elige aquí cuál.',
    siFalta: 'saltar',
  },
  {
    id: 'reportar',
    objetivo: 'reportar',
    titulo: 'Reportar un problema',
    texto: 'Si algo falla o se ve raro, cuéntanos desde aquí.',
    siFalta: 'saltar',
  },
  {
    // El botón «Ayuda» de Inicio (con el botón de repetir el recorrido); si no se ve, este cierre va centrado.
    id: 'cierre',
    objetivo: 'ayuda-inicio',
    titulo: 'Si necesitas ayuda',
    texto: 'Toca «Ayuda»: ahí puedes ver este recorrido otra vez.',
    siFalta: 'centrado',
  },
];

/**
 * Los pasos que se muestran, según el interruptor de «Reportar un problema» (`reportar-config.ts`). Con `true`, los 5 pasos
 * completos; con `false`, los mismos sin el de `reportar` (4), en el mismo orden. Función pura: así se prueban los dos
 * estados sin recargar módulos.
 */
export function pasosDelTour(reportarVisible: boolean): readonly PasoTour[] {
  return reportarVisible ? PASOS_COMPLETOS : PASOS_COMPLETOS.filter((paso) => paso.id !== 'reportar');
}

/**
 * Los pasos del recorrido de bienvenida con el interruptor real: 4 con «Reportar un problema» oculto, 5 si está visible. Se
 * cargan junto con el disparador (diferido): no pesan en la carga inicial.
 */
export const TOUR_PASOS: readonly PasoTour[] = pasosDelTour(REPORTAR_VISIBLE);
