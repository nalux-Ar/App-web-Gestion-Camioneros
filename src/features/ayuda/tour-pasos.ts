import type { PasoTour } from './posicion';

/**
 * Los 9 pasos del recorrido de bienvenida (Inicio). Español neutro, de "tú", textos planos. Cada objetivo es el
 * `data-ayuda` de un elemento real: la barra de navegación (abajo en el celular, a la izquierda en escritorio; el motor toma
 * el que se ve), la tarjeta del camión de Inicio (sus 3 variantes), Configuración y el atajo "Reportar un problema" del
 * header. Se cargan junto con el disparador (diferido): no pesan en la carga inicial.
 */
export const TOUR_PASOS: readonly PasoTour[] = [
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
    texto: 'Aquí cargas tus viajes: de dónde a dónde, los kilómetros, lo que cobraste y las entregas. También están las devoluciones.',
    siFalta: 'saltar',
  },
  {
    id: 'gastos',
    objetivo: 'nav-gastos',
    titulo: 'Gastos',
    texto:
      'Aquí cargas lo que gastas: combustible, peajes, urea o gastos varios. En el combustible anota los litros y el odómetro (los kilómetros del tablero): así calculamos cuánto rinde tu camión.',
    siFalta: 'saltar',
  },
  {
    id: 'clientes',
    objetivo: 'nav-clientes',
    titulo: 'Clientes',
    texto: 'A quiénes les entregas. Los eliges al cargar las entregas de un viaje.',
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
      'El camión con el que trabajas: se usa en tus viajes y cargas de combustible nuevos. Si tienes varios, aquí eliges cuál; si todavía no cargaste ninguno, empieza por aquí.',
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
    // La "i" de Inicio llega en el paso 3; mientras no exista, este cierre va centrado.
    id: 'cierre',
    objetivo: 'ayuda-inicio',
    titulo: 'Listo',
    texto: 'Eso es todo. Si quieres verlo otra vez, en Inicio tienes «Ver el recorrido otra vez».',
    siFalta: 'centrado',
  },
];
