import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PageHeader } from '@/components/shared/page-header';
import { AYUDA_INICIO, AYUDA_VIAJES, type AyudaPantalla } from './ayuda-pantallas';
import { BotonAyuda } from './boton-ayuda';
import { usePedidosDeRecorrido } from './pedido-recorrido';

// La "i" de cada pantalla y el encabezado que la lleva. Las pruebas están pensadas para FALLAR si se rompe cada comportamiento
// (sin type="button", sin aria-label, sin data-ayuda, sin devolver el foco, con la "i" donde no va...).
const AYUDA_PRUEBA: AyudaPantalla = { titulo: 'Ayuda de prueba', puntos: ['Primer punto.', 'Segundo punto.'] };
const ETIQUETA = 'Ayuda de esta pantalla';
const RECORRIDO = 'Ver el recorrido otra vez';

let app: HTMLElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // Como en index.html: el diálogo va en un portal FUERA de `#root`.
  app = document.createElement('div');
  app.id = 'root';
  document.body.appendChild(app);
  root = createRoot(app);
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = '';
});

async function render(nodo: React.ReactNode) {
  await act(async () => root.render(nodo));
}
async function esperar(condicion: () => boolean, ms = 3000) {
  for (let t = 0; t < ms && !condicion(); t += 20) await act(async () => void (await new Promise((r) => setTimeout(r, 20))));
}

const botonI = () => document.querySelector<HTMLButtonElement>(`button[aria-label="${ETIQUETA}"]`);
const dialogo = () => document.querySelector<HTMLElement>('[role="dialog"]');
const boton = (texto: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === texto);
async function abrir() {
  await act(async () => botonI()!.click());
  await esperar(() => dialogo() !== null);
}
async function cerrarCon(como: 'boton' | 'esc' | 'velo') {
  await act(async () => {
    if (como === 'boton') boton('Cerrar')!.click();
    else if (como === 'esc') document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    else document.querySelector<HTMLElement>('[data-velo]')!.click();
  });
}

describe('BotonAyuda: el botón', () => {
  it('tiene nombre accesible, type="button" y un objetivo táctil de 48 px', async () => {
    await render(<BotonAyuda ayuda={AYUDA_PRUEBA} />);
    const i = botonI();
    expect(i).not.toBeNull();
    expect(i!.getAttribute('type')).toBe('button');
    expect(i!.getAttribute('aria-label')).toBe(ETIQUETA);
    expect(i!.getAttribute('aria-haspopup')).toBe('dialog');
    expect(i!.className).toMatch(/\bh-12\b/);
    expect(i!.className).toMatch(/\bw-12\b/);
    expect(i!.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('no envía el formulario donde esté (type="button")', async () => {
    let enviados = 0;
    await render(
      <form onSubmit={(e) => (e.preventDefault(), (enviados += 1))}>
        <BotonAyuda ayuda={AYUDA_PRUEBA} />
      </form>,
    );
    await abrir();
    expect(dialogo()).not.toBeNull();
    expect(enviados).toBe(0);
  });

  it('solo usa colores del tema (ni hex ni paleta de Tailwind)', async () => {
    await render(<BotonAyuda ayuda={AYUDA_PRUEBA} />);
    expect(botonI()!.outerHTML).not.toMatch(/#[0-9a-f]{3,8}\b|\b(?:text|bg|border|ring)-(?:red|blue|green|gray|slate|zinc|amber|yellow|white|black)\b/i);
  });

  it('lleva el data-ayuda que se le da (y ninguno si no se le da)', async () => {
    await render(<BotonAyuda ayuda={AYUDA_PRUEBA} dataAyuda="ayuda-inicio" />);
    expect(botonI()!.getAttribute('data-ayuda')).toBe('ayuda-inicio');
    await render(<BotonAyuda ayuda={AYUDA_PRUEBA} />);
    expect(botonI()!.hasAttribute('data-ayuda')).toBe(false);
  });

  it('no baja ni muestra la hoja hasta que se toca', async () => {
    await render(<BotonAyuda ayuda={AYUDA_PRUEBA} />);
    expect(dialogo()).toBeNull();
    expect(app.hasAttribute('inert')).toBe(false);
  });
});

describe('BotonAyuda: la hoja', () => {
  it('al tocar abre la ayuda de ESA pantalla (título y puntos), con la app inerte', async () => {
    await render(<BotonAyuda ayuda={AYUDA_PRUEBA} />);
    await abrir();
    expect(dialogo()!.getAttribute('aria-modal')).toBe('true');
    expect(dialogo()!.querySelector('h2')!.textContent).toBe('Ayuda de prueba');
    expect([...dialogo()!.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['Primer punto.', 'Segundo punto.']);
    expect(app.hasAttribute('inert')).toBe(true);
    expect(boton(RECORRIDO)).toBeUndefined();
  });

  it.each(['boton', 'esc', 'velo'] as const)('al cerrar con %s: se va la hoja, la app deja de estar inerte y el foco vuelve a la "i"', async (como) => {
    await render(<BotonAyuda ayuda={AYUDA_PRUEBA} />);
    // `click()` no enfoca en jsdom (como Safari al tocar): el foco igual tiene que volver.
    await abrir();
    expect(document.activeElement).not.toBe(botonI());
    await cerrarCon(como);
    expect(dialogo()).toBeNull();
    expect(document.querySelector('[data-velo]')).toBeNull();
    expect(app.hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(botonI());
  });

  it('se puede abrir de nuevo después de cerrar', async () => {
    await render(<BotonAyuda ayuda={AYUDA_PRUEBA} />);
    await abrir();
    await cerrarCon('esc');
    await abrir();
    expect(dialogo()).not.toBeNull();
  });
});

describe('BotonAyuda en Inicio: "Ver el recorrido otra vez" dentro de la hoja', () => {
  /** Anota, en cada cambio del contador de pedidos, cómo estaba la página en ese momento. */
  const instantes: Array<{ pedidos: number; hayDialogo: boolean; inerte: boolean; foco: Element | null }> = [];
  function Espia() {
    const pedidos = usePedidosDeRecorrido();
    useEffect(() => {
      instantes.push({
        pedidos,
        hayDialogo: document.querySelector('[role="dialog"]') !== null,
        inerte: document.getElementById('root')!.hasAttribute('inert'),
        foco: document.activeElement,
      });
    }, [pedidos]);
    return null;
  }

  beforeEach(() => {
    instantes.length = 0;
  });

  it('está al final de la hoja, con los puntos antes', async () => {
    await render(<BotonAyuda ayuda={AYUDA_INICIO} dataAyuda="ayuda-inicio" conRecorrido />);
    await abrir();
    const b = boton(RECORRIDO)!;
    expect(b.getAttribute('type')).toBe('button');
    const lista = dialogo()!.querySelector('ul')!;
    expect(lista.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('al tocarlo cierra la hoja y pide el recorrido UNA vez, ya con la app libre y el foco en la "i"', async () => {
    await render(
      <>
        <Espia />
        <BotonAyuda ayuda={AYUDA_INICIO} conRecorrido />
      </>,
    );
    const antes = instantes[instantes.length - 1]!.pedidos;
    await abrir();
    await act(async () => boton(RECORRIDO)!.click());
    await esperar(() => instantes[instantes.length - 1]!.pedidos > antes);
    const ultimo = instantes[instantes.length - 1]!;
    expect(ultimo.pedidos).toBe(antes + 1);
    // En el instante del pedido la hoja ya no está: no chocan el `inert`, el velo ni el foco con los del recorrido.
    expect(ultimo.hayDialogo).toBe(false);
    expect(ultimo.inerte).toBe(false);
    expect(ultimo.foco).toBe(botonI());
    expect(dialogo()).toBeNull();
    expect(document.querySelector('[data-velo]')).toBeNull();
  });

  it.each(['boton', 'esc'] as const)('después de pedir el recorrido, volver a abrir la "i" y cerrarla con %s NO lo pide otra vez', async (como) => {
    await render(
      <>
        <Espia />
        <BotonAyuda ayuda={AYUDA_INICIO} conRecorrido />
      </>,
    );
    const antes = instantes[instantes.length - 1]!.pedidos;
    await abrir();
    await act(async () => boton(RECORRIDO)!.click());
    await esperar(() => instantes[instantes.length - 1]!.pedidos > antes);
    expect(instantes[instantes.length - 1]!.pedidos).toBe(antes + 1);
    await abrir();
    expect(dialogo()).not.toBeNull();
    await cerrarCon(como);
    await esperar(() => false, 100);
    expect(dialogo()).toBeNull();
    expect(instantes[instantes.length - 1]!.pedidos).toBe(antes + 1);
  });

  it('cerrar la hoja sin tocar el botón NO pide el recorrido', async () => {
    await render(
      <>
        <Espia />
        <BotonAyuda ayuda={AYUDA_INICIO} conRecorrido />
      </>,
    );
    const antes = instantes[instantes.length - 1]!.pedidos;
    await abrir();
    await cerrarCon('boton');
    await esperar(() => false, 100);
    expect(instantes[instantes.length - 1]!.pedidos).toBe(antes);
  });
});

describe('PageHeader con y sin ayuda', () => {
  it('sin `ayuda` no hay "i" y el encabezado queda como estaba (el h1 directo, sin envoltorio)', async () => {
    await render(<PageHeader title="Gastos" description="Descripción" />);
    expect(botonI()).toBeNull();
    const h1 = document.querySelector('h1')!;
    expect(h1.textContent).toBe('Gastos');
    expect(h1.parentElement!.className).toBe('min-w-0 space-y-1');
  });

  it('con `ayuda` pinta la "i" junto al título, FUERA del h1 (el nombre accesible del h1 no cambia)', async () => {
    await render(<PageHeader title="Viajes" ayuda={AYUDA_VIAJES} />);
    const h1 = document.querySelector('h1')!;
    expect(h1.textContent).toBe('Viajes');
    expect(h1.contains(botonI())).toBe(false);
    expect(h1.parentElement!.contains(botonI())).toBe(true);
  });

  it('con `ayuda`, la "i" abre la hoja de ESA pantalla y devuelve el foco', async () => {
    await render(<PageHeader title="Viajes" ayuda={AYUDA_VIAJES} />);
    await abrir();
    expect(dialogo()!.querySelector('h2')!.textContent).toBe(AYUDA_VIAJES.titulo);
    expect(dialogo()!.querySelectorAll('li')).toHaveLength(AYUDA_VIAJES.puntos.length);
    await cerrarCon('boton');
    expect(document.activeElement).toBe(botonI());
  });

  it('un título larguísimo y sin espacios puede partirse y encogerse (no empuja la "i" ni el layout)', async () => {
    const largo = 'Origen-larguísimo-sin-espacios-'.repeat(8);
    await render(<PageHeader title={largo} ayuda={AYUDA_VIAJES} action={<button type="button">Nuevo</button>} />);
    const h1 = document.querySelector('h1')!;
    expect(h1.className).toContain('break-words');
    expect(h1.className).toContain('min-w-0');
    expect(h1.parentElement!.parentElement!.className).toContain('min-w-0');
    expect(botonI()!.className).toContain('shrink-0');
    expect(h1.textContent).toBe(largo);
  });

  it('un título con marcado (origen → destino) sigue siendo el nombre del h1', async () => {
    await render(
      <PageHeader
        title={
          <>
            Pilar <span aria-hidden="true">→</span> Rosario
          </>
        }
        ayuda={AYUDA_VIAJES}
      />,
    );
    expect(document.querySelector('h1')!.textContent).toBe('Pilar → Rosario');
    expect(document.querySelector('h1 button')).toBeNull();
  });
});
