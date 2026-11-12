import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { VolverLink } from './volver-link';

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

/** A dónde se llegó y con qué `state` (para ver que el enlace los conserva). */
function Destino() {
  const location = useLocation();
  return <div id="destino" data-ruta={location.pathname + location.search} data-state={JSON.stringify(location.state ?? null)} />;
}

async function render(destino = 'a Gastos') {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/gastos/nuevo']}>
        <Routes>
          <Route path="/gastos/nuevo" element={<VolverLink to="/gastos?mes=2025-06" state={{ volver: '?mes=2025-06' }} destino={destino} />} />
          <Route path="/gastos" element={<Destino />} />
        </Routes>
      </MemoryRouter>,
    );
  });
  return container.querySelector('a')!;
}

/** Lo que se ve: el texto del enlace sin lo que es solo para lectores de pantalla (`sr-only`). */
function textoVisible(enlace: HTMLElement): string {
  return [...enlace.childNodes]
    .filter((nodo) => !(nodo instanceof HTMLElement && nodo.classList.contains('sr-only')))
    .map((nodo) => nodo.textContent)
    .join('')
    .trim();
}

describe('VolverLink («‹ Volver»)', () => {
  it('a la vista dice SIEMPRE "Volver"; el destino va solo en el nombre accesible ("Volver a Gastos")', async () => {
    const enlace = await render('a Gastos');
    expect(textoVisible(enlace)).toBe('Volver');
    expect(enlace.querySelector('.sr-only')!.textContent?.trim()).toBe('a Gastos');
    // El nombre accesible empieza con lo que se ve (para quien maneja la pantalla por voz: «clic en Volver»).
    expect(enlace.textContent?.trim()).toBe('Volver a Gastos');
  });

  it('el destino se dice con la frase que corresponde ("al viaje", "al cliente")', async () => {
    expect((await render('al viaje')).textContent?.trim()).toBe('Volver al viaje');
  });

  it('el ícono de la flecha es decorativo (no se lee)', async () => {
    const enlace = await render();
    const icono = enlace.querySelector('svg')!;
    expect(icono.getAttribute('aria-hidden')).toBe('true');
  });

  it('16 px (text-base, antes 14 px), área táctil de 48 px y el color de apoyo de siempre', async () => {
    const { className } = await render();
    expect(className).toContain('text-base');
    expect(className).not.toMatch(/\btext-(xs|sm)\b/);
    expect(className).toContain('min-h-12');
    expect(className).toContain('text-muted-foreground'); // el color NO cambió
    expect(className).toContain('focus-visible:ring-2'); // foco visible con el teclado
  });

  it('lleva a donde dice `to` y le pasa el `state`', async () => {
    const enlace = await render();
    expect(enlace.getAttribute('href')).toBe('/gastos?mes=2025-06');
    await act(async () => {
      enlace.click();
    });
    const destino = document.getElementById('destino')!;
    expect(destino.dataset.ruta).toBe('/gastos?mes=2025-06');
    expect(JSON.parse(destino.dataset.state!)).toEqual({ volver: '?mes=2025-06' });
  });
});
