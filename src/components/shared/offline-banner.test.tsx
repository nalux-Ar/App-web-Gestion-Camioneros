import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { OfflineBanner } from './offline-banner';

// El aviso de «sin señal» de los formularios (revisión de usabilidad, fila A21, solo el texto fijo): corto, con la palabra de
// la ruta («señal») y diciendo para qué (guardar).
let root: Root;
let app: HTMLElement;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  app = document.createElement('div');
  document.body.appendChild(app);
  root = createRoot(app);
});

afterEach(async () => {
  await act(async () => root.unmount());
  app.remove();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
});

async function montar(enLinea: boolean) {
  Object.defineProperty(navigator, 'onLine', { value: enLinea, configurable: true });
  await act(async () => root.render(<OfflineBanner />));
}

describe('OfflineBanner', () => {
  it('sin conexión: «Sin señal. Revisa la conexión antes de guardar.», en una región de estado y a 16 px', async () => {
    await montar(false);
    const aviso = app.querySelector('[role="status"]')!;
    expect(aviso.textContent).toBe('Sin señal. Revisa la conexión antes de guardar.');
    expect(aviso.className.split(/\s+/)).toContain('text-base');
  });

  it('ya no dice «formulario» ni «No hay conexión» (la palabra de la ruta es «señal»)', async () => {
    await montar(false);
    expect(app.textContent).not.toMatch(/formulario|No hay conexión/);
  });

  it('con conexión no muestra nada', async () => {
    await montar(true);
    expect(app.textContent).toBe('');
  });
});
