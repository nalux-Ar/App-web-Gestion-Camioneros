import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SubmitBar } from './submit-bar';

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

const boton = () => container.querySelector<HTMLButtonElement>('button[type="submit"]')!;

describe('SubmitBar: el botón principal', () => {
  it('18 px (text-lg) y 56 px como mínimo (min-h-14), de ancho completo', async () => {
    await act(async () => {
      root.render(<SubmitBar pending={false} error={null} label="Guardar gasto" />);
    });
    expect(boton().className).toContain('text-lg');
    expect(boton().className).toContain('min-h-14');
    expect(boton().className).toContain('w-full');
    expect(boton().textContent).toBe('Guardar gasto');
  });

  it('un rótulo largo se parte en líneas (no se sale del botón a 360 px) y el botón crece en vez de fijar 56 px', async () => {
    await act(async () => {
      root.render(<SubmitBar pending={false} error={null} label="Guardar y pasar 12 gastos al camión AB 123 CD" />);
    });
    expect(boton().className).toContain('whitespace-normal');
    expect(boton().className).not.toContain('whitespace-nowrap');
    expect(boton().className).toContain('h-auto');
    expect(boton().className).not.toMatch(/(^|\s)h-14(\s|$)/);
    expect(boton().className).toContain('text-center');
    expect(boton().textContent).toBe('Guardar y pasar 12 gastos al camión AB 123 CD');
  });
});
