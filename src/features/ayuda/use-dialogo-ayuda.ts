import { useEffect, useRef, type RefObject } from 'react';

import type { Rect, Viewport } from './posicion';

/**
 * Comportamiento compartido de los diálogos de ayuda (el recorrido y la hoja de la "i"). Solo tocan el DOM: nada de esto
 * provoca renders.
 */

/** El contenedor de la app (`#root` de index.html). Los diálogos van en un portal FUERA de él. */
export const ID_CONTENEDOR_APP = 'root';

/**
 * Mientras el diálogo está abierto, el resto de la app queda `inert` (no se puede tocar ni enfocar, y los lectores de
 * pantalla la ignoran). Al cerrar se deja como estaba.
 */
export function useAppInerte(activo: boolean): void {
  useEffect(() => {
    if (!activo) return;
    const app = document.getElementById(ID_CONTENEDOR_APP);
    if (!app) return;
    // El ATRIBUTO (no la propiedad): es lo que leen los navegadores y se puede comprobar en cualquier entorno.
    const yaEstaba = app.hasAttribute('inert');
    app.setAttribute('inert', '');
    return () => {
      if (!yaEstaba) app.removeAttribute('inert');
    };
  }, [activo]);
}

/** Al abrir, recuerda dónde estaba el foco; al cerrar, lo devuelve ahí (si ese elemento sigue en la página). */
export function useDevolverFoco(): void {
  const previo = useRef<Element | null>(null);
  useEffect(() => {
    previo.current = document.activeElement;
    return () => {
      const elemento = previo.current;
      if (elemento instanceof HTMLElement && elemento.isConnected) elemento.focus({ preventScroll: true });
    };
  }, []);
}

/** Esc cierra (en el recorrido, es "Saltar"). Escucha en el documento: funciona donde esté el foco. */
export function useEscape(onEscape: () => void): void {
  const callback = useRef(onEscape);
  useEffect(() => {
    callback.current = onEscape;
  });
  useEffect(() => {
    function alApretar(evento: KeyboardEvent) {
      if (evento.key !== 'Escape') return;
      evento.preventDefault();
      callback.current();
    }
    document.addEventListener('keydown', alApretar);
    return () => document.removeEventListener('keydown', alApretar);
  }, []);
}

const ENFOCABLES = 'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Tab y Shift+Tab quedan ATRAPADOS dentro del diálogo: del último botón se vuelve al primero y al revés. (Con la app
 * `inert` igual no habría a dónde ir, pero así el foco nunca se pierde en el `body`.)
 */
export function atraparTab(evento: KeyboardEvent | React.KeyboardEvent, contenedor: HTMLElement | null): void {
  if (evento.key !== 'Tab' || contenedor === null) return;
  const enfocables = [...contenedor.querySelectorAll<HTMLElement>(ENFOCABLES)];
  if (enfocables.length === 0) {
    evento.preventDefault();
    return;
  }
  const primero = enfocables[0]!;
  const ultimo = enfocables[enfocables.length - 1]!;
  const activo = document.activeElement;
  if (evento.shiftKey && (activo === primero || !contenedor.contains(activo))) {
    evento.preventDefault();
    ultimo.focus();
  } else if (!evento.shiftKey && (activo === ultimo || !contenedor.contains(activo))) {
    evento.preventDefault();
    primero.focus();
  }
}

/** Foco al título del diálogo cada vez que cambia `clave` (cada paso del recorrido): los lectores de pantalla lo leen. */
export function useFocoAlTitulo(titulo: RefObject<HTMLElement | null>, clave: unknown): void {
  useEffect(() => {
    titulo.current?.focus({ preventScroll: true });
  }, [titulo, clave]);
}

/** La parte visible de la ventana: `visualViewport` (sigue el zoom y la barra dinámica de iOS) o, si no hay, la ventana. */
export function leerViewport(): Viewport {
  const vv = typeof window !== 'undefined' ? window.visualViewport : null;
  if (vv) return { ancho: vv.width, alto: vv.height, offsetTop: vv.offsetTop, offsetLeft: vv.offsetLeft };
  return { ancho: window.innerWidth, alto: window.innerHeight };
}

/** El rectángulo de un elemento, como dato plano. */
export function rectDe(elemento: Element): Rect {
  const { top, left, width, height } = elemento.getBoundingClientRect();
  return { top, left, width, height };
}

/** ¿La persona pidió menos movimiento? */
export function prefiereMenosMovimiento(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
