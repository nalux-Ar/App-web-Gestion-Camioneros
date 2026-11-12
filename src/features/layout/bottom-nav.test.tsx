import { readFileSync } from 'node:fs';
import path from 'node:path';

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FixedActionBar } from '@/components/shared/fixed-action-bar';
import { BottomNav } from './bottom-nav';

let root: Root;
let container: HTMLElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

async function render(ruta = '/viajes') {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[ruta]}>
        <BottomNav />
      </MemoryRouter>,
    );
  });
}

const enlaces = () => [...container.querySelectorAll<HTMLAnchorElement>('nav a')];
const rotulo = (a: HTMLAnchorElement) => a.querySelector('span')!;

describe('barra inferior (celular)', () => {
  it('5 secciones, cada una con su ícono (24 px, decorativo) y su rótulo escrito', async () => {
    await render();
    expect(enlaces().map((a) => rotulo(a).textContent)).toEqual(['Inicio', 'Viajes', 'Gastos', 'Clientes', 'Resumen']);
    for (const a of enlaces()) {
      const icono = a.querySelector('svg')!;
      expect(icono.getAttribute('aria-hidden')).toBe('true');
      expect(icono.getAttribute('class')).toContain('size-6');
      expect(icono.getAttribute('class')).not.toContain('size-5');
    }
  });

  it('el rótulo va en 14 px (text-sm, antes 11 px): sin tamaños sueltos en px, y un rótulo que no entra se recorta con "…" en vez de pisar al vecino', async () => {
    await render();
    for (const a of enlaces()) {
      expect(a.className).toContain('text-sm');
      expect(a.className).not.toMatch(/text-\[\d+px\]/);
      expect(rotulo(a).className).toContain('truncate');
      expect(rotulo(a).className).toContain('max-w-full');
    }
  });

  it('cada ítem es de 64 px de alto como mínimo (≥ 48 px) y los 5 se reparten el ancho por igual (sin padding que le robe lugar al rótulo)', async () => {
    await render();
    for (const a of enlaces()) {
      expect(a.className).toContain('min-h-16');
      expect(a.className).not.toMatch(/\bpx-\d/);
      expect(a.parentElement!.className).toContain('flex-1');
    }
  });

  it('la sección activa no depende solo del color: lleva aria-current y el rótulo en negrita', async () => {
    await render('/gastos');
    const activos = enlaces().filter((a) => a.getAttribute('aria-current') === 'page');
    expect(activos.map((a) => rotulo(a).textContent)).toEqual(['Gastos']);
    expect(rotulo(activos[0]!).className).toContain('font-semibold');
    for (const a of enlaces().filter((x) => x !== activos[0])) expect(rotulo(a).className).not.toContain('font-semibold');
  });

  it('solo se ve en el celular (md:hidden) y respeta el safe-area de abajo', async () => {
    await render();
    const nav = container.querySelector('nav')!;
    expect(nav.className).toContain('md:hidden');
    expect(nav.className).toContain('pb-[env(safe-area-inset-bottom)]');
    expect(nav.className).toContain('fixed');
  });
});

describe('lo que depende del alto de la barra (4 rem del ítem + 1 px de borde)', () => {
  it('el botón fijo de las listas queda 0,75 rem por encima de la barra', async () => {
    await act(async () => {
      root.render(
        <FixedActionBar>
          <button type="button">Nuevo gasto</button>
        </FixedActionBar>,
      );
    });
    const fijo = container.querySelector<HTMLElement>('.fixed')!;
    expect(fijo.className).toContain('bottom-[calc(4rem+1px+env(safe-area-inset-bottom)+0.75rem)]');
  });

  it('el contenido deja lugar abajo para que nada quede tapado: 5 rem (los 4 rem + 1 px de la barra + aire)', () => {
    const fuente = readFileSync(path.join(import.meta.dirname, 'app-shell.tsx'), 'utf8');
    expect(fuente).toContain('pb-[calc(5rem+env(safe-area-inset-bottom))]');
    expect(fuente).not.toContain('4.5rem');
  });
});
