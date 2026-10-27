import { lazy } from 'react';

/**
 * Las entradas a la ayuda, con carga DIFERIDA: el motor del recorrido y la hoja de la "i" van en chunks aparte y solo se
 * bajan cuando se van a mostrar (la carga inicial de la app no crece). Montarlos dentro de un `<Suspense>`.
 */
export const TourAyudaDiferido = lazy(() => import('./tour-ayuda').then((m) => ({ default: m.TourAyuda })));
export const HojaAyudaDiferida = lazy(() => import('./hoja-ayuda').then((m) => ({ default: m.HojaAyuda })));
/** El que decide cuándo mostrar el recorrido (va en el AppShell): con sus 9 pasos, también diferido. */
export const DisparadorTourDiferido = lazy(() => import('./disparador-tour').then((m) => ({ default: m.DisparadorTour })));
