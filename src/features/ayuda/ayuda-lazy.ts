import { lazy, type ComponentType } from 'react';

/** Si el chunk no baja (sin señal o un deploy nuevo), la ayuda no se muestra: es opcional y no debe tumbar la app. */
function sinFalla<P extends object>(cargar: () => Promise<ComponentType<P>>) {
  return lazy<ComponentType<P>>(() => cargar().then((componente) => ({ default: componente }), () => ({ default: () => null })));
}

/**
 * Las entradas a la ayuda, con carga DIFERIDA: el motor del recorrido y la hoja de la "i" van en chunks aparte y solo se
 * bajan cuando se van a mostrar (la carga inicial de la app no crece). Montarlos dentro de un `<Suspense>`.
 */
export const TourAyudaDiferido = sinFalla(() => import('./tour-ayuda').then((m) => m.TourAyuda));
export const HojaAyudaDiferida = sinFalla(() => import('./hoja-ayuda').then((m) => m.HojaAyuda));
/** El que decide cuándo mostrar el recorrido (va en el AppShell): con sus 9 pasos, también diferido. */
export const DisparadorTourDiferido = sinFalla(() => import('./disparador-tour').then((m) => m.DisparadorTour));
