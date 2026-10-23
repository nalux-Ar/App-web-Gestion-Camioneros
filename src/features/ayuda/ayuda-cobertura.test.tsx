import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { HojaAyuda } from './hoja-ayuda';
import { calcularPosicion, esVisible, MARGEN, type PasoTour, type Rect } from './posicion';
import { TourAyuda } from './tour-ayuda';
import { atraparTab, leerViewport } from './use-dialogo-ayuda';

// Casos que cubren bordes del motor: márgenes y bordes exactos, `inert` previo, Tab con el foco afuera, el
// `visualViewport` (falso: jsdom no lo trae), los listeners de giro y del viewport, el `ResizeObserver` (falso) y las
// clases de capas, toques y movimiento. Mismo arnés que tour-ayuda.test.tsx.
const rects = new Map<string, Rect>();
const originales = {
  rect: Element.prototype.getBoundingClientRect,
  cajas: Element.prototype.getClientRects,
  scroll: Element.prototype.scrollIntoView,
  ro: globalThis.ResizeObserver,
};

let app: HTMLElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  rects.clear();
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const clave = this.getAttribute('data-ayuda');
    const r = (clave && rects.get(clave)) || { top: 0, left: 0, width: 0, height: 0 };
    return { ...r, x: r.left, y: r.top, right: r.left + r.width, bottom: r.top + r.height, toJSON: () => r } as DOMRect;
  };
  Element.prototype.getClientRects = function (this: Element) {
    const clave = this.getAttribute('data-ayuda');
    return (clave && rects.has(clave) ? [this.getBoundingClientRect()] : []) as unknown as DOMRectList;
  };
  Element.prototype.scrollIntoView = (() => {}) as typeof Element.prototype.scrollIntoView;
  Object.defineProperty(window, 'innerWidth', { value: 1280, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
  app = document.createElement('div');
  app.id = 'root';
  document.body.appendChild(app);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  app.remove();
  document.body.innerHTML = '';
  Element.prototype.getBoundingClientRect = originales.rect;
  Element.prototype.getClientRects = originales.cajas;
  Element.prototype.scrollIntoView = originales.scroll;
  globalThis.ResizeObserver = originales.ro;
  delete (window as { visualViewport?: unknown }).visualViewport;
});

async function asentar() {
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
  }
}

const dialogo = () => document.querySelector<HTMLElement>('[role="dialog"]');
const titulo = () => dialogo()?.querySelector('h2')?.textContent ?? '';
const boton = (texto: string) => [...(dialogo()?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find((b) => b.textContent === texto);
const aro = () => document.querySelector<HTMLElement>('[data-aro]');
const velo = () => document.querySelector<HTMLElement>('[data-velo]');

async function tocar(el: HTMLElement | undefined | null) {
  if (!el) throw new Error('no se encontró el elemento');
  await act(async () => el.click());
  await asentar();
}

async function montarTour(objetivos: string, pasos: readonly PasoTour[]) {
  app.innerHTML = `${objetivos}<div id="montaje"></div>`;
  root = createRoot(document.getElementById('montaje')!);
  await act(async () => {
    root.render(<TourAyuda pasos={pasos} onTerminar={() => {}} esperaMs={60} />);
  });
  await asentar();
}

/** Un `visualViewport` falso: un EventTarget con medidas. */
function viewportFalso(medidas: { width: number; height: number; offsetTop?: number; offsetLeft?: number }) {
  const vv = Object.assign(new EventTarget(), { offsetTop: 0, offsetLeft: 0, ...medidas });
  Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
  return vv;
}

const PASOS: PasoTour[] = [
  { id: 'hola', objetivo: null, titulo: 'Te mostramos la app', texto: 'Son pocos pasos.', siFalta: 'centrado' },
  { id: 'viajes', objetivo: 'nav-viajes', titulo: 'Viajes', texto: 'Acá cargas tus viajes.', siFalta: 'saltar' },
  { id: 'camion', objetivo: 'camion', titulo: 'Tu camión', texto: 'El camión con el que trabajas.', siFalta: 'saltar' },
  { id: 'fin', objetivo: null, titulo: 'Listo', texto: 'Eso es todo.', siFalta: 'centrado' },
];
const OBJETIVOS = '<a data-ayuda="nav-viajes" href="#">Viajes</a><div data-ayuda="camion">camión</div>';
function conRects() {
  rects.set('nav-viajes', { top: 100, left: 20, width: 200, height: 48 });
  rects.set('camion', { top: 300, left: 260, width: 600, height: 160 });
}

describe('posición: bordes y margen por defecto', () => {
  it('el margen por defecto es 12 px (sin pasar el argumento)', () => {
    expect(MARGEN).toBe(12);
    expect(calcularPosicion({ top: 100, left: 500, width: 100, height: 40 }, { ancho: 300, alto: 200 }, { ancho: 1280, alto: 800 })).toEqual({
      modo: 'tarjeta',
      lado: 'abajo',
      top: 152,
      left: 400,
    });
  });

  it('arriba acepta el borde EXACTO (justo 12 px del borde de arriba)', () => {
    // abajo no entra (objetivo alto); arriba queda en top = 224 - 12 - 200 = 12 = el mínimo.
    expect(calcularPosicion({ top: 224, left: 500, width: 100, height: 400 }, { ancho: 300, alto: 200 }, { ancho: 1280, alto: 800 })).toEqual({
      modo: 'tarjeta',
      lado: 'arriba',
      top: 12,
      left: 400,
    });
  });

  it('con medidas pero SIN cajas de layout no se ve', () => {
    const elemento = { getClientRects: () => ({ length: 0 }), getBoundingClientRect: () => ({ width: 80, height: 48 }) } as unknown as Element;
    expect(esVisible(elemento)).toBe(false);
  });
});

describe('diálogo: inert previo y Tab con el foco afuera', () => {
  it('si la app YA estaba inerte antes de abrir, al cerrar queda inerte', async () => {
    app.setAttribute('inert', '');
    await montarTour('', [PASOS[0]!]);
    await act(async () => root.unmount());
    expect(app.hasAttribute('inert')).toBe(true);
  });

  it('Shift+Tab con el foco FUERA del diálogo lo trae al último botón; Tab, al primero', () => {
    const contenedor = document.createElement('div');
    contenedor.innerHTML = '<button id="b1">1</button><button id="b2">2</button>';
    const afuera = document.createElement('button');
    document.body.append(contenedor, afuera);
    afuera.focus();
    const evento = (shiftKey: boolean) => new KeyboardEvent('keydown', { key: 'Tab', shiftKey, cancelable: true });
    const conShift = evento(true);
    atraparTab(conShift, contenedor);
    expect(document.activeElement!.id).toBe('b2');
    expect(conShift.defaultPrevented).toBe(true);
    afuera.focus();
    atraparTab(evento(false), contenedor);
    expect(document.activeElement!.id).toBe('b1');
  });
});

describe('visualViewport', () => {
  it('leerViewport usa el visualViewport (ancho, alto y offsets) cuando existe', () => {
    viewportFalso({ width: 375, height: 600, offsetTop: 150, offsetLeft: 5 });
    expect(leerViewport()).toEqual({ ancho: 375, alto: 600, offsetTop: 150, offsetLeft: 5 });
  });

  it('sin visualViewport, la ventana', () => {
    expect(leerViewport()).toEqual({ ancho: 1280, alto: 800 });
  });

  it('el recorrido decide celular o escritorio por el visualViewport (no por la ventana)', async () => {
    conRects();
    viewportFalso({ width: 375, height: 800 });
    await montarTour(OBJETIVOS, PASOS);
    expect(dialogo()!.getAttribute('data-posicion')).toBe('hoja-abajo');
  });

  it('con el offsetTop del visualViewport la hoja cambia de lado', async () => {
    // Objetivo en y = 450..498 (centro 474): contra un viewport visible desde 300, está en la mitad de ARRIBA → hoja abajo.
    rects.set('nav-viajes', { top: 450, left: 20, width: 200, height: 48 });
    viewportFalso({ width: 375, height: 800, offsetTop: 300 });
    await montarTour('<a data-ayuda="nav-viajes" href="#">Viajes</a>', [PASOS[1]!]);
    expect(dialogo()!.getAttribute('data-posicion')).toBe('hoja-abajo');
  });

  it('vuelve a medir con el scroll y con el resize del visualViewport', async () => {
    conRects();
    const vv = viewportFalso({ width: 1280, height: 800 });
    await montarTour(OBJETIVOS, PASOS);
    await tocar(boton('Siguiente'));
    rects.set('nav-viajes', { top: 400, left: 20, width: 200, height: 48 });
    await act(async () => vv.dispatchEvent(new Event('scroll')));
    await asentar();
    expect(aro()!.style.top).toBe('396px');
    rects.set('nav-viajes', { top: 200, left: 20, width: 200, height: 48 });
    await act(async () => vv.dispatchEvent(new Event('resize')));
    await asentar();
    expect(aro()!.style.top).toBe('196px');
  });
});

describe('recorrido: navegación y nueva medición', () => {
  it('"Atrás" retrocede de a UN paso (3 → 2 → 1), con título y contador', async () => {
    conRects();
    await montarTour(OBJETIVOS, PASOS);
    await tocar(boton('Siguiente'));
    await tocar(boton('Siguiente'));
    expect(dialogo()!.textContent).toContain('Paso 3 de 4');
    await tocar(boton('Atrás'));
    expect(titulo()).toBe('Viajes');
    expect(dialogo()!.textContent).toContain('Paso 2 de 4');
    await tocar(boton('Atrás'));
    expect(titulo()).toBe('Te mostramos la app');
    expect(dialogo()!.textContent).toContain('Paso 1 de 4');
  });

  it('vuelve a medir al girar el equipo (orientationchange)', async () => {
    conRects();
    await montarTour(OBJETIVOS, PASOS);
    await tocar(boton('Siguiente'));
    rects.set('nav-viajes', { top: 500, left: 20, width: 200, height: 48 });
    await act(async () => window.dispatchEvent(new Event('orientationchange')));
    await asentar();
    expect(aro()!.style.top).toBe('496px');
  });

  it('un objetivo que SOLO cambia de ancho se vuelve a medir', async () => {
    conRects();
    await montarTour(OBJETIVOS, PASOS);
    await tocar(boton('Siguiente'));
    rects.set('nav-viajes', { top: 100, left: 20, width: 320, height: 48 });
    await act(async () => window.dispatchEvent(new Event('resize')));
    await asentar();
    expect(aro()!.style.width).toBe('328px');
  });

  it('un paso SIN objetivo después de uno con objetivo no muestra aro', async () => {
    conRects();
    await montarTour(OBJETIVOS, [PASOS[1]!, PASOS[3]!]);
    expect(aro()).not.toBeNull();
    await tocar(boton('Siguiente'));
    expect(titulo()).toBe('Listo');
    expect(aro()).toBeNull();
    expect(dialogo()!.getAttribute('data-posicion')).toBe('centrado');
  });

  it('ni por un cuadro: al pasar a un paso sin objetivo, el aro del paso anterior desaparece ANTES de volver a medir', async () => {
    conRects();
    await montarTour(OBJETIVOS, [PASOS[1]!, PASOS[3]!]);
    expect(aro()).not.toBeNull();
    // Solo el render del cambio de paso (sin dejar correr el requestAnimationFrame de la nueva medición).
    await act(async () => boton('Siguiente')!.click());
    expect(titulo()).toBe('Listo');
    expect(aro()).toBeNull();
  });

  it('observa con ResizeObserver al objetivo Y a la tarjeta', async () => {
    const observados: Element[] = [];
    globalThis.ResizeObserver = class {
      observe(elemento: Element) {
        observados.push(elemento);
      }
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    conRects();
    await montarTour(OBJETIVOS, PASOS);
    await tocar(boton('Siguiente'));
    expect(observados).toContain(document.querySelector('[data-ayuda="nav-viajes"]'));
    expect(observados).toContain(dialogo());
  });
});

describe('clases: capas, toques, tope de alto y movimiento', () => {
  it('la hoja del celular tiene tope de alto y scroll propio', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 360, configurable: true });
    await montarTour('', [PASOS[0]!]);
    expect(dialogo()!.className).toContain('max-h-[70dvh]');
    expect(dialogo()!.className).toContain('overflow-y-auto');
  });

  it('toda animación va con motion-safe: (nada se mueve si se pidió menos movimiento)', async () => {
    conRects();
    await montarTour(OBJETIVOS, PASOS);
    await tocar(boton('Siguiente'));
    const clases = [dialogo()!, aro()!].flatMap((el) => el.className.split(/\s+/));
    const deMovimiento = clases.filter((c) => /(animate|fade|transition|duration|slide|zoom)/.test(c));
    expect(deMovimiento.length).toBeGreaterThan(0);
    for (const clase of deMovimiento) expect(clase.startsWith('motion-safe:'), clase).toBe(true);
  });

  it('el velo se traga los toques (touch-none) con y sin objetivo, y queda en z-60', async () => {
    conRects();
    await montarTour(OBJETIVOS, PASOS);
    expect(velo()!.className).toContain('touch-none');
    expect(velo()!.className.split(/\s+/)).toContain('z-[60]');
    await tocar(boton('Siguiente'));
    expect(velo()!.className).toContain('touch-none');
    expect(velo()!.className.split(/\s+/)).toContain('z-[60]');
  });

  it('el aro no captura toques, va en z-61 y usa solo colores del tema', async () => {
    conRects();
    await montarTour(OBJETIVOS, PASOS);
    await tocar(boton('Siguiente'));
    const clases = aro()!.className.split(/\s+/);
    expect(clases).toContain('pointer-events-none');
    expect(clases).toContain('z-[61]');
    expect(clases).toContain('ring-primary');
    // Ninguna clase de color de la paleta fija de Tailwind (ring-yellow-400, bg-black/60…).
    for (const clase of clases) expect(clase, clase).not.toMatch(/^(?:ring|bg|text|border|shadow)-(?:[a-z]+-(?:50|[1-9]00)|black|white)\b/);
  });
});

describe('hoja de la "i"', () => {
  it('cambia de lugar al redimensionar o girar (de centrada a hoja abajo)', async () => {
    app.innerHTML = '<div id="montaje"></div>';
    root = createRoot(document.getElementById('montaje')!);
    await act(async () => {
      root.render(<HojaAyuda titulo="Ayuda" puntos={['Uno.']} onCerrar={() => {}} />);
    });
    await asentar();
    expect(dialogo()!.getAttribute('data-posicion')).toBe('centrado');
    Object.defineProperty(window, 'innerWidth', { value: 360, configurable: true });
    await act(async () => window.dispatchEvent(new Event('resize')));
    await asentar();
    expect(dialogo()!.getAttribute('data-posicion')).toBe('hoja-abajo');
  });
});
