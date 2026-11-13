import { REPORTAR_VISIBLE } from '@/features/reportar/reportar-config';
import type { PasoTour } from './posicion';

/**
 * El recorrido de bienvenida (Inicio) completo: 9 pasos, con el de «Reportar un problema». Español neutro, de "tú", textos
 * planos. Cada objetivo es el `data-ayuda` de un elemento real: la barra de navegación (abajo en el celular, a la izquierda
 * en escritorio; el motor toma el que se ve), la tarjeta del camión de Inicio (sus 3 variantes), Configuración, el atajo
 * "Reportar un problema" del header y el botón «Ayuda» de Inicio. No se exporta: lo que se muestra sale de `pasosDelTour`.
 */
const PASOS_COMPLETOS: readonly PasoTour[] = [
  {
    id: 'bienvenida',
    objetivo: null,
    titulo: 'Te mostramos la app',
    texto: 'Son pocos pasos. Puedes saltarlo cuando quieras.',
    siFalta: 'centrado',
  },
  {
    id: 'viajes',
    objetivo: 'nav-viajes',
    titulo: 'Viajes',
    texto: 'Aquí anotas tus viajes: de dónde a dónde, los kilómetros, lo que cobraste y las entregas. También están las devoluciones.',
    siFalta: 'saltar',
  },
  {
    id: 'gastos',
    objetivo: 'nav-gastos',
    titulo: 'Gastos',
    texto:
      'Aquí anotas lo que gastas: combustible, peajes, urea o gastos varios. En el combustible anota los litros y los kilómetros que marca el tablero: así calculamos cuánto rinde tu camión.',
    siFalta: 'saltar',
  },
  {
    id: 'clientes',
    objetivo: 'nav-clientes',
    titulo: 'Clientes',
    texto: 'A quiénes les entregas. Los eliges al anotar las entregas de un viaje.',
    siFalta: 'saltar',
  },
  {
    id: 'resumen',
    objetivo: 'nav-resumen',
    titulo: 'Resumen',
    texto: 'Cuánto gastaste en el mes o en el año, en qué, y cuánto te quedó según lo que cobraste por los viajes. También ves cuánto rinde el combustible.',
    siFalta: 'saltar',
  },
  {
    id: 'camion',
    objetivo: 'camion',
    titulo: 'Tu camión',
    texto:
      'El camión con el que trabajas: se usa en tus viajes y cargas de combustible nuevos. Si tienes varios, aquí eliges cuál; si todavía no agregaste ninguno, empieza por aquí.',
    siFalta: 'saltar',
  },
  {
    id: 'configuracion',
    objetivo: 'nav-configuracion',
    titulo: 'Configuración',
    texto: 'Tu cuenta, el nombre, tus camiones y cómo se ve la app.',
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
    titulo: 'Listo',
    texto: 'Eso es todo. Si quieres verlo otra vez, toca «Ayuda»: ahí está «Ver el recorrido otra vez».',
    siFalta: 'centrado',
  },
];

/**
 * Los pasos que se muestran, según el interruptor de «Reportar un problema» (`reportar-config.ts`). Con `true`, los 9 pasos
 * completos; con `false`, los mismos sin el de `reportar` (8), en el mismo orden. Función pura: así se prueban los dos
 * estados sin recargar módulos.
 */
export function pasosDelTour(reportarVisible: boolean): readonly PasoTour[] {
  return reportarVisible ? PASOS_COMPLETOS : PASOS_COMPLETOS.filter((paso) => paso.id !== 'reportar');
}

/**
 * Los pasos del recorrido de bienvenida con el interruptor real: 8 con «Reportar un problema» oculto, 9 si está visible. Se
 * cargan junto con el disparador (diferido): no pesan en la carga inicial.
 */
export const TOUR_PASOS: readonly PasoTour[] = pasosDelTour(REPORTAR_VISIBLE);
