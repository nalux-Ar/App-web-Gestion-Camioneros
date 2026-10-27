import { act, Suspense } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DisparadorTourDiferido, HojaAyudaDiferida, TourAyudaDiferido } from './ayuda-lazy';

// Los chunks de la ayuda no bajan (sin señal o un deploy nuevo): no se muestra nada y la app sigue en pie.
vi.mock('./hoja-ayuda', () => {
  throw new Error('chunk no disponible');
});
vi.mock('./tour-ayuda', () => {
  throw new Error('chunk no disponible');
});
vi.mock('./disparador-tour', () => {
  throw new Error('chunk no disponible');
});

let app: HTMLElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  app = document.createElement('div');
  document.body.appendChild(app);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  app.remove();
});

describe('carga diferida de la ayuda', () => {
  it('si el chunk no baja, no dibuja nada y no tira (no tumba la app)', async () => {
    root = createRoot(app);
    const errores = vi.spyOn(console, 'error').mockImplementation(() => {});
    await act(async () => {
      root.render(
        <Suspense fallback={null}>
          <p id="resto">sigue la app</p>
          <HojaAyudaDiferida titulo="x" puntos={['y']} onCerrar={() => {}} />
          <TourAyudaDiferido pasos={[]} onTerminar={() => {}} />
          <DisparadorTourDiferido />
        </Suspense>,
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    errores.mockRestore();
    expect(app.querySelector('#resto')?.textContent).toBe('sigue la app');
    expect(app.querySelector('[role="dialog"]')).toBeNull();
  });
});
