import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HojaAyuda } from './hoja-ayuda';
import type { PasoTour, Rect } from './posicion';
import { TourAyuda, type FinDelTour } from './tour-ayuda';

// jsdom no tiene layout: cada `data-ayuda` recibe un rectángulo FALSO (`rects`); sin rectángulo, el elemento "no se ve"
// (sin cajas). La app vive en un `#root` (el que queda inerte) y los diálogos van en portales fuera de él.
const rects = new Map<string, Rect>();
const originales = {
  rect: Element.prototype.getBoundingClientRect,
  cajas: Element.prototype.getClientRects,
  scroll: Element.prototype.scrollIntoView,
};

let app: HTMLElement;
let root: Root;
let scrolls: Array<{ elemento: Element; opciones: unknown }>;

function rectDe(elemento: Element): Rect | undefined {
  const clave = elemento.getAttribute('data-ayuda-falsa') ?? elemento.getAttribute('data-ayuda');
  return clave ? rects.get(clave) : undefined;
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  rects.clear();
  scrolls = [];
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const r = rectDe(this) ?? { top: 0, left: 0, width: 0, height: 0 };
    return { ...r, x: r.left, y: r.top, right: r.left + r.width, bottom: r.top + r.height, toJSON: () => r } as DOMRect;
  };
  Element.prototype.getClientRects = function (this: Element) {
    return (rectDe(this) ? [this.getBoundingClientRect()] : []) as unknown as DOMRectList;
  };
  Element.prototype.scrollIntoView = function (this: Element, opciones?: unknown) {
    scrolls.push({ elemento: this, opciones });
  } as typeof Element.prototype.scrollIntoView;
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
  delete (window as { matchMedia?: unknown }).matchMedia;
});

async function esperar(ms = 0) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

/** Deja que corran los frames de medición (rAF) y los timers de espera. */
async function asentar() {
  for (let i = 0; i < 4; i++) await esperar(20);
}

const PASOS: PasoTour[] = [
  { id: 'hola', objetivo: null, titulo: 'Te mostramos la app', texto: 'Son pocos pasos.', siFalta: 'centrado' },
  { id: 'viajes', objetivo: 'nav-viajes', titulo: 'Viajes', texto: 'Acá cargas tus viajes.', siFalta: 'saltar' },
  { id: 'camion', objetivo: 'camion', titulo: 'Tu camión', texto: 'El camión con el que trabajas.', siFalta: 'saltar' },
  { id: 'fin', objetivo: 'ayuda-i', titulo: 'La ayuda', texto: 'Toca la i.', siFalta: 'centrado' },
];

/** La "app": un botón con el foco antes de abrir, y los objetivos que se pidan. */
async function montar(objetivos: string, pasos: readonly PasoTour[] = PASOS, onTerminar: (m: FinDelTour) => void = () => {}, esperaMs = 60) {
  app.innerHTML = `<button id="antes">antes</button>${objetivos}<div id="montaje"></div>`;
  (document.getElementById('antes') as HTMLButtonElement).focus();
  root = createRoot(document.getElementById('montaje')!);
  await act(async () => {
    root.render(<TourAyuda pasos={pasos} onTerminar={onTerminar} esperaMs={esperaMs} />);
  });
  await asentar();
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

async function tecla(key: string, opciones: KeyboardEventInit = {}) {
  await act(async () => {
    (document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opciones }));
  });
  await asentar();
}

const OBJETIVOS = '<a data-ayuda="nav-viajes" href="#">Viajes</a><div data-ayuda="camion">camión</div><button data-ayuda="ayuda-i">i</button>';

function conRects() {
  rects.set('nav-viajes', { top: 100, left: 20, width: 200, height: 48 });
  rects.set('camion', { top: 300, left: 260, width: 600, height: 160 });
  rects.set('ayuda-i', { top: 70, left: 900, width: 48, height: 48 });
}

describe('TourAyuda: el diálogo', () => {
  it('role="dialog" con aria-modal, nombre (título) y descripción (texto); "Paso 1 de 4"; foco al título', async () => {
    conRects();
    await montar(OBJETIVOS);
    const d = dialogo()!;
    expect(d.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(d.getAttribute('aria-labelledby')!)!.textContent).toBe('Te mostramos la app');
    expect(document.getElementById(d.getAttribute('aria-describedby')!)!.textContent).toBe('Son pocos pasos.');
    expect(d.textContent).toContain('Paso 1 de 4');
    expect(document.activeElement).toBe(d.querySelector('h2'));
  });

  it('Siguiente y Atrás recorren los pasos (Atrás no está en el primero); el foco vuelve al título en cada paso', async () => {
    conRects();
    await montar(OBJETIVOS);
    expect(boton('Atrás')).toBeUndefined();
    // Como en el celular o con teclado: el foco está en "Siguiente" al tocarlo (en jsdom `click()` no mueve el foco).
    boton('Siguiente')!.focus();
    await tocar(boton('Siguiente'));
    expect(titulo()).toBe('Viajes');
    expect(dialogo()!.textContent).toContain('Paso 2 de 4');
    expect(document.activeElement).toBe(dialogo()!.querySelector('h2'));
    await tocar(boton('Atrás'));
    expect(titulo()).toBe('Te mostramos la app');
  });

  it('en el último paso, "Listo" termina como completo', async () => {
    conRects();
    const fin = vi.fn();
    await montar(OBJETIVOS, PASOS, fin);
    for (let i = 0; i < 3; i++) await tocar(boton('Siguiente'));
    expect(boton('Siguiente')).toBeUndefined();
    await tocar(boton('Listo'));
    expect(fin).toHaveBeenCalledWith('completo');
  });

  it('"Saltar" siempre visible (en todos los pasos, 48 px, con nombre claro) y termina como saltado', async () => {
    conRects();
    const fin = vi.fn();
    await montar(OBJETIVOS, PASOS, fin);
    for (let i = 0; i < 4; i++) {
      const saltar = boton('Saltar')!;
      expect(saltar.getAttribute('aria-label')).toBe('Saltar el recorrido');
      expect(saltar.className).toContain('h-12');
      if (i < 3) await tocar(boton('Siguiente'));
    }
    await tocar(boton('Saltar'));
    expect(fin).toHaveBeenCalledWith('saltado');
  });

  it('Esc = saltar', async () => {
    conRects();
    const fin = vi.fn();
    await montar(OBJETIVOS, PASOS, fin);
    await tecla('Escape');
    expect(fin).toHaveBeenCalledWith('saltado');
  });

  it('Tab queda atrapado: del último botón al primero, y con Shift del primero al último', async () => {
    conRects();
    await montar(OBJETIVOS);
    await tocar(boton('Siguiente')); // paso 2: Saltar, Atrás, Siguiente
    const botones = [...dialogo()!.querySelectorAll<HTMLButtonElement>('button')];
    expect(botones.map((b) => b.textContent)).toEqual(['Saltar', 'Atrás', 'Siguiente']);
    botones[2]!.focus();
    await tecla('Tab');
    expect(document.activeElement).toBe(botones[0]);
    await tecla('Tab', { shiftKey: true });
    expect(document.activeElement).toBe(botones[2]);
  });

  it('el resto de la app queda inerte, el diálogo está FUERA de ella, y al cerrar todo vuelve (con el foco donde estaba)', async () => {
    conRects();
    await montar(OBJETIVOS);
    expect(app.hasAttribute('inert')).toBe(true);
    expect(app.contains(dialogo())).toBe(false);
    expect(app.contains(velo())).toBe(false);
    await act(async () => root.unmount());
    expect(app.hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(document.getElementById('antes'));
    expect(dialogo()).toBeNull();
  });

  it('textos siempre como texto: nada de HTML', async () => {
    conRects();
    const hostiles: PasoTour[] = [{ id: 'x', objetivo: null, titulo: '<img src=x onerror=alert(1)>', texto: '<b>negrita</b>', siFalta: 'centrado' }];
    await montar('', hostiles);
    expect(titulo()).toBe('<img src=x onerror=alert(1)>');
    expect(dialogo()!.querySelector('[data-texto-paso]')!.textContent).toBe('<b>negrita</b>');
    expect(document.querySelector('img, b')).toBeNull();
  });

  it('capas: velo z-60, aro z-61, diálogo z-62 (por encima del header, la barra de abajo y la barra fija)', async () => {
    conRects();
    await montar(OBJETIVOS);
    await tocar(boton('Siguiente'));
    expect(velo()!.className).toContain('z-[60]');
    expect(aro()!.className).toContain('z-[61]');
    expect(dialogo()!.className).toContain('z-[62]');
  });

  it('solo colores del tema (ninguno fijo); el velo y el aro son decorativos', async () => {
    conRects();
    await montar(OBJETIVOS);
    await tocar(boton('Siguiente'));
    const clases = [...document.querySelectorAll('[class]')].map((el) => el.getAttribute('class')).join(' ');
    expect(clases).not.toMatch(/(?:bg|text|border|ring|shadow)-(?:red|green|blue|gray|slate|zinc|neutral|black|white)\b/);
    expect(clases).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(velo()!.getAttribute('aria-hidden')).toBe('true');
    expect(aro()!.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('TourAyuda: objetivos', () => {
  it('el aro rodea al objetivo (con 4 px de holgura) y la tarjeta queda anclada', async () => {
    conRects();
    await montar(OBJETIVOS);
    await tocar(boton('Siguiente'));
    expect(aro()!.style.top).toBe('96px');
    expect(aro()!.style.left).toBe('16px');
    expect(aro()!.style.width).toBe('208px');
    expect(aro()!.style.height).toBe('56px');
    expect(dialogo()!.getAttribute('data-posicion')).toBe('tarjeta-abajo');
  });

  it('un paso centrado no tiene aro y el velo oscurece entero', async () => {
    conRects();
    await montar(OBJETIVOS);
    expect(aro()).toBeNull();
    expect(velo()!.className).toContain('bg-brand-plate/60');
    expect(dialogo()!.getAttribute('data-posicion')).toBe('centrado');
  });

  it('objetivo que no aparece: con siFalta "saltar" se saltea y el contador no lo cuenta', async () => {
    rects.set('nav-viajes', { top: 100, left: 20, width: 200, height: 48 });
    rects.set('ayuda-i', { top: 70, left: 900, width: 48, height: 48 });
    await montar('<a data-ayuda="nav-viajes" href="#">Viajes</a><button data-ayuda="ayuda-i">i</button>');
    expect(dialogo()!.textContent).toContain('Paso 1 de 3');
    await tocar(boton('Siguiente'));
    await tocar(boton('Siguiente'));
    expect(titulo()).toBe('La ayuda');
  });

  it('objetivo que no aparece: con siFalta "centrado" se muestra igual, sin aro', async () => {
    rects.set('nav-viajes', { top: 100, left: 20, width: 200, height: 48 });
    rects.set('camion', { top: 300, left: 260, width: 600, height: 160 });
    await montar('<a data-ayuda="nav-viajes" href="#">Viajes</a><div data-ayuda="camion">c</div>');
    expect(dialogo()!.textContent).toContain('Paso 1 de 4');
    for (let i = 0; i < 3; i++) await tocar(boton('Siguiente'));
    expect(titulo()).toBe('La ayuda');
    expect(aro()).toBeNull();
    expect(dialogo()!.getAttribute('data-posicion')).toBe('centrado');
  });

  it('un objetivo que aparece mientras se espera (la pantalla terminaba de cargar) sí entra', async () => {
    conRects();
    app.innerHTML = '<a data-ayuda="nav-viajes" href="#">Viajes</a><button data-ayuda="ayuda-i">i</button><div id="montaje"></div>';
    root = createRoot(document.getElementById('montaje')!);
    await act(async () => {
      root.render(<TourAyuda pasos={PASOS} onTerminar={() => {}} esperaMs={1000} />);
    });
    await esperar(150);
    const camion = document.createElement('div');
    camion.setAttribute('data-ayuda', 'camion');
    app.appendChild(camion);
    await esperar(250);
    expect(dialogo()!.textContent).toContain('Paso 1 de 4');
  });

  it('de dos elementos con el mismo data-ayuda (barra de abajo y lateral), señala el que SE VE', async () => {
    rects.set('lateral', { top: 200, left: 10, width: 220, height: 48 });
    rects.set('camion', { top: 300, left: 260, width: 600, height: 160 });
    rects.set('ayuda-i', { top: 70, left: 900, width: 48, height: 48 });
    await montar('<a data-ayuda="nav-viajes" href="#">abajo (oculto)</a><a data-ayuda="nav-viajes" data-ayuda-falsa="lateral" href="#">lateral</a><div data-ayuda="camion"></div><button data-ayuda="ayuda-i"></button>');
    await tocar(boton('Siguiente'));
    expect(aro()!.style.top).toBe('196px');
  });

  it('lleva el objetivo a la vista (centrado, con animación suave; sin animación si se pidió menos movimiento)', async () => {
    conRects();
    await montar(OBJETIVOS);
    await tocar(boton('Siguiente'));
    expect(scrolls.at(-1)).toEqual({ elemento: document.querySelector('[data-ayuda="nav-viajes"]'), opciones: { block: 'center', behavior: 'smooth' } });
    await act(async () => root.unmount());
    (window as { matchMedia?: unknown }).matchMedia = (q: string) => ({ matches: q.includes('reduce') });
    await montar(OBJETIVOS);
    await tocar(boton('Siguiente'));
    expect(scrolls.at(-1)!.opciones).toEqual({ block: 'center', behavior: 'auto' });
  });

  it('vuelve a medir con resize y con scroll (el aro sigue al objetivo)', async () => {
    conRects();
    await montar(OBJETIVOS);
    await tocar(boton('Siguiente'));
    rects.set('nav-viajes', { top: 400, left: 20, width: 200, height: 48 });
    await act(async () => window.dispatchEvent(new Event('resize')));
    await asentar();
    expect(aro()!.style.top).toBe('396px');
    rects.set('nav-viajes', { top: 250, left: 20, width: 200, height: 48 });
    await act(async () => document.dispatchEvent(new Event('scroll')));
    await asentar();
    expect(aro()!.style.top).toBe('246px');
  });

  it('en el celular: hoja ABAJO si el objetivo está arriba, ARRIBA si está abajo (p. ej. la barra de navegación)', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 375, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    rects.set('nav-viajes', { top: 744, left: 75, width: 75, height: 56 });
    rects.set('camion', { top: 150, left: 16, width: 343, height: 160 });
    rects.set('ayuda-i', { top: 70, left: 300, width: 48, height: 48 });
    await montar(OBJETIVOS);
    expect(dialogo()!.getAttribute('data-posicion')).toBe('hoja-abajo');
    await tocar(boton('Siguiente'));
    expect(dialogo()!.getAttribute('data-posicion')).toBe('hoja-arriba');
    expect(dialogo()!.className).toContain('safe-area-inset-top');
    await tocar(boton('Siguiente'));
    expect(dialogo()!.getAttribute('data-posicion')).toBe('hoja-abajo');
    expect(dialogo()!.className).toContain('safe-area-inset-bottom');
  });

  it('sin ningún paso para mostrar: termina solo (como completo) y no dibuja nada', async () => {
    const fin = vi.fn();
    await montar('', [{ id: 'a', objetivo: 'no-esta', titulo: 'x', texto: 'x', siFalta: 'saltar' }], fin);
    expect(fin).toHaveBeenCalledWith('completo');
    expect(dialogo()).toBeNull();
    expect(app.hasAttribute('inert')).toBe(false);
  });

  it('un toque en el velo no hace nada durante el recorrido (no se navega la app)', async () => {
    conRects();
    const fin = vi.fn();
    await montar(OBJETIVOS, PASOS, fin);
    await tocar(velo());
    expect(fin).not.toHaveBeenCalled();
    expect(titulo()).toBe('Te mostramos la app');
  });
});

describe('HojaAyuda (la de la "i")', () => {
  async function abrir(onCerrar: () => void = () => {}, puntos: readonly string[] = ['Uno.', 'Dos.']) {
    app.innerHTML = '<button id="i">i</button><div id="montaje"></div>';
    (document.getElementById('i') as HTMLButtonElement).focus();
    root = createRoot(document.getElementById('montaje')!);
    await act(async () => {
      root.render(<HojaAyuda titulo="Ayuda de Gastos" puntos={puntos} onCerrar={onCerrar} />);
    });
    await asentar();
  }

  it('el mismo diálogo: título, puntos, "Cerrar", foco al título, app inerte', async () => {
    await abrir();
    const d = dialogo()!;
    expect(d.getAttribute('aria-modal')).toBe('true');
    expect(titulo()).toBe('Ayuda de Gastos');
    expect([...d.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['Uno.', 'Dos.']);
    expect(boton('Cerrar')!.className).toContain('h-12');
    expect(document.activeElement).toBe(d.querySelector('h2'));
    expect(app.hasAttribute('inert')).toBe(true);
    expect(app.contains(d)).toBe(false);
  });

  it('se cierra con "Cerrar", con Esc y tocando el velo', async () => {
    const cerrar = vi.fn();
    await abrir(cerrar);
    await tocar(boton('Cerrar'));
    await tecla('Escape');
    await tocar(velo());
    expect(cerrar).toHaveBeenCalledTimes(3);
  });

  it('al cerrar, el foco vuelve a la "i" y la app deja de estar inerte', async () => {
    await abrir();
    await act(async () => root.unmount());
    expect(document.activeElement).toBe(document.getElementById('i'));
    expect(app.hasAttribute('inert')).toBe(false);
  });

  it('celular: hoja abajo; escritorio: centrada', async () => {
    await abrir();
    expect(dialogo()!.getAttribute('data-posicion')).toBe('centrado');
    await act(async () => root.unmount());
    Object.defineProperty(window, 'innerWidth', { value: 360, configurable: true });
    await abrir();
    expect(dialogo()!.getAttribute('data-posicion')).toBe('hoja-abajo');
  });

  it('puntos como texto, nunca HTML', async () => {
    await abrir(() => {}, ['<script>alert(1)</script>', '<b>x</b>']);
    expect(dialogo()!.querySelector('script, b')).toBeNull();
    expect(dialogo()!.querySelector('li')!.textContent).toBe('<script>alert(1)</script>');
  });

  it('Tab atrapado también acá (un solo botón: se queda en él)', async () => {
    await abrir();
    boton('Cerrar')!.focus();
    await tecla('Tab');
    expect(document.activeElement).toBe(boton('Cerrar'));
  });
});
