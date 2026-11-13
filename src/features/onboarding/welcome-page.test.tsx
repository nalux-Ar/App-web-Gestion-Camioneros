import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// La bienvenida (revisión de usabilidad, fila A15, solo textos): «Te damos la bienvenida a Elan», qué escribir y dónde lo va a
// ver, y el error de nombre vacío con la salida a la vista. El botón «siempre activo» es de otra tanda (comportamiento).
const h = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc: h.rpc } }));

import { MemberContext, type MemberContextValue } from '@/features/member/member-context';
import { WelcomePage } from './welcome-page';

let root: Root;
let app: HTMLElement;

beforeEach(async () => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  h.rpc.mockReset();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  app = document.createElement('div');
  document.body.appendChild(app);
  root = createRoot(app);
  await act(async () => {
    root.render(
      <MemberContext.Provider value={{ refetch: async () => {} } as unknown as MemberContextValue}>
        <MemoryRouter initialEntries={['/bienvenida']}>
          <WelcomePage />
        </MemoryRouter>
      </MemberContext.Provider>,
    );
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  app.remove();
});

describe('bienvenida: los textos', () => {
  it('«Te damos la bienvenida a Elan» (sin género) y qué escribir y dónde lo va a ver', () => {
    expect(app.querySelector('h1, [class*="text-2xl"]')!.textContent).toBe('Te damos la bienvenida a Elan');
    expect(app.textContent).toContain('Escribe tu nombre o el de tu empresa. Lo verás arriba, en el saludo.');
    expect(app.textContent).not.toMatch(/Bienvenido|¿Cómo se llama/);
  });

  it('no trae nombres de ejemplo (de personas ni de empresas)', () => {
    expect(app.textContent).not.toMatch(/Juan|Pérez|SRL|Por ejemplo/);
  });

  it('nombre vacío: «Escribe tu nombre para seguir.», sin tocar la base', async () => {
    await act(async () => {
      app.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(app.querySelector('[role="alert"]')!.textContent).toBe('Escribe tu nombre para seguir.');
    expect(h.rpc).not.toHaveBeenCalled();
  });
});
