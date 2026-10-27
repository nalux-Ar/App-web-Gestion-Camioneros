import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { BOTON_ATRAS, BOTON_LISTO, BOTON_SALTAR, BOTON_SIGUIENTE, ETIQUETA_SALTAR } from './ayuda-textos';
import { DialogoAyuda } from './dialogo-ayuda';
import { buscarObjetivo, calcularPosicion, pasosResolubles, textoContador, type PasoResuelto, type PasoTour, type Rect, type Viewport } from './posicion';
import { leerViewport, prefiereMenosMovimiento, rectDe } from './use-dialogo-ayuda';
import { VeloAyuda } from './velo-ayuda';

export type FinDelTour = 'completo' | 'saltado';

export interface TourAyudaProps {
  pasos: readonly PasoTour[];
  /** Al tocar "Listo" en el último paso ('completo'), o "Saltar" / Esc ('saltado'). */
  onTerminar: (motivo: FinDelTour) => void;
  /** Cuánto se espera a que aparezcan los objetivos (la pantalla puede estar terminando de cargar), en ms. */
  esperaMs?: number;
}

/** Medida inicial de la tarjeta, hasta poder medirla de verdad. */
const TARJETA_INICIAL = { ancho: 352, alto: 220 };
const REVISAR_CADA_MS = 100;

function mismoRect(a: Rect | null, b: Rect | null): boolean {
  if (a === null || b === null) return a === b;
  return a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height;
}

/**
 * El motor del recorrido: muestra los pasos de a uno, señalando su objetivo (`data-ayuda`).
 *
 * Al arrancar espera hasta `esperaMs` a que aparezcan los objetivos y arma la lista de pasos que se pueden mostrar
 * (`pasosResolubles`: un objetivo que falta se saltea o se muestra centrado, según el paso); el contador "Paso X de N" es de
 * ESA lista. En cada paso lleva el objetivo a la vista (`scrollIntoView`, sin animación si se pidió menos movimiento) y lo
 * vuelve a medir, siempre en un `requestAnimationFrame`, con el tamaño de la ventana, el scroll, el `visualViewport`, el
 * giro del equipo y un `ResizeObserver` del objetivo y de la tarjeta.
 */
export function TourAyuda({ pasos, onTerminar, esperaMs = 1500 }: TourAyudaProps) {
  const [resueltos, setResueltos] = useState<PasoResuelto[] | null>(null);
  const [indice, setIndice] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [viewport, setViewport] = useState<Viewport>(leerViewport);
  const [tarjeta, setTarjeta] = useState(TARJETA_INICIAL);
  const dialogoRef = useRef<HTMLDivElement>(null);
  const terminar = useRef(onTerminar);
  useEffect(() => {
    terminar.current = onTerminar;
  });

  // Espera a los objetivos y decide qué pasos se muestran.
  useEffect(() => {
    const inicio = Date.now();
    let id = 0;
    function revisar() {
      const todos = pasos.every((paso) => paso.objetivo === null || buscarObjetivo(paso.objetivo) !== null);
      if (!todos && Date.now() - inicio < esperaMs) {
        id = window.setTimeout(revisar, REVISAR_CADA_MS);
        return;
      }
      const lista = pasosResolubles(pasos, (objetivo) => buscarObjetivo(objetivo) !== null);
      if (lista.length === 0) terminar.current('completo');
      else setResueltos(lista);
    }
    id = window.setTimeout(revisar, 0);
    return () => window.clearTimeout(id);
  }, [pasos, esperaMs]);

  const paso = resueltos?.[indice] ?? null;

  // Lleva el objetivo a la vista y lo mide (y vuelve a medir con cada cambio).
  useEffect(() => {
    if (paso === null) return;
    const objetivoDe = () => (paso.conObjetivo && paso.objetivo !== null ? buscarObjetivo(paso.objetivo) : null);
    const objetivo = objetivoDe();
    if (objetivo !== null && typeof objetivo.scrollIntoView === 'function') {
      objetivo.scrollIntoView({ block: 'center', behavior: prefiereMenosMovimiento() ? 'auto' : 'smooth' });
    }

    let frame = 0;
    function medir() {
      frame = 0;
      const actual = objetivoDe();
      const nuevo = actual !== null ? rectDe(actual) : null;
      setRect((previo) => (mismoRect(previo, nuevo) ? previo : nuevo));
      const vista = leerViewport();
      setViewport((previo) => (previo.ancho === vista.ancho && previo.alto === vista.alto && previo.offsetTop === vista.offsetTop && previo.offsetLeft === vista.offsetLeft ? previo : vista));
      const dialogo = dialogoRef.current;
      if (dialogo !== null && dialogo.offsetWidth > 0 && dialogo.offsetHeight > 0) {
        const medida = { ancho: dialogo.offsetWidth, alto: dialogo.offsetHeight };
        setTarjeta((previo) => (previo.ancho === medida.ancho && previo.alto === medida.alto ? previo : medida));
      }
    }
    function programar() {
      if (frame === 0) frame = window.requestAnimationFrame(medir);
    }

    programar();
    window.addEventListener('resize', programar);
    window.addEventListener('scroll', programar, true);
    window.addEventListener('orientationchange', programar);
    const vv = window.visualViewport;
    vv?.addEventListener('resize', programar);
    vv?.addEventListener('scroll', programar);
    const observador = typeof ResizeObserver === 'function' ? new ResizeObserver(programar) : null;
    if (objetivo !== null) observador?.observe(objetivo);
    if (dialogoRef.current !== null) observador?.observe(dialogoRef.current);

    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', programar);
      window.removeEventListener('scroll', programar, true);
      window.removeEventListener('orientationchange', programar);
      vv?.removeEventListener('resize', programar);
      vv?.removeEventListener('scroll', programar);
      observador?.disconnect();
    };
  }, [paso]);

  if (resueltos === null || paso === null) return null;

  const ultimo = indice === resueltos.length - 1;
  const rectVisible = paso.conObjetivo ? rect : null;
  const posicion = calcularPosicion(rectVisible, tarjeta, viewport);

  return (
    <>
      <VeloAyuda rect={rectVisible} />
      <DialogoAyuda
        titulo={paso.titulo}
        antetitulo={textoContador(indice, resueltos.length)}
        posicion={posicion}
        claveFoco={paso.id}
        dialogoRef={dialogoRef}
        onEscape={() => terminar.current('saltado')}
        esquina={
          <Button type="button" variant="ghost" aria-label={ETIQUETA_SALTAR} onClick={() => terminar.current('saltado')}>
            {BOTON_SALTAR}
          </Button>
        }
        acciones={
          <>
            {indice > 0 ? (
              <Button type="button" variant="outline" onClick={() => setIndice((i) => i - 1)}>
                {BOTON_ATRAS}
              </Button>
            ) : null}
            <Button type="button" onClick={() => (ultimo ? terminar.current('completo') : setIndice((i) => i + 1))}>
              {ultimo ? BOTON_LISTO : BOTON_SIGUIENTE}
            </Button>
          </>
        }
      >
        <p data-texto-paso="">{paso.texto}</p>
      </DialogoAyuda>
    </>
  );
}
