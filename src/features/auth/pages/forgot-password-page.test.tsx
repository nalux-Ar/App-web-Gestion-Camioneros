import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { AuthApiError } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Recuperar la contraseña (revisión de usabilidad, fila A12): «correo» en vez de «email», y dónde buscar el mensaje. El
// resultado es SIEMPRE el mismo, exista o no una cuenta con ese correo (no se revela cuáles están registrados).
const h = vi.hoisted(() => ({ reset: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { resetPasswordForEmail: h.reset } } }));

import { NETWORK_ERROR_MESSAGE } from '../auth-errors';
import { ForgotPasswordPage } from './forgot-password-page';

const MENSAJE =
  'Si ese correo tiene una cuenta en Elan, te enviamos un enlace para que elijas una contraseña nueva. Búscalo en Recibidos, Spam o Correo no deseado.';

let root: Root;
let app: HTMLElement;

beforeEach(async () => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  h.reset.mockReset();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  app = document.createElement('div');
  document.body.appendChild(app);
  root = createRoot(app);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/recuperar-contrasena']}>
        <ForgotPasswordPage />
      </MemoryRouter>,
    );
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  app.remove();
});

async function pedirEnlace() {
  const campo = app.querySelector<HTMLInputElement>('input[type="email"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(campo, 'chofer@correo.test');
    campo.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await act(async () => {
    app.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  for (let i = 0; i < 3; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))));
}

describe('recuperar la contraseña', () => {
  it('pide el «Correo electrónico» y habla de «correo» (nada de «email»)', () => {
    expect([...app.querySelectorAll('label')].map((l) => l.textContent)).toContain('Correo electrónico');
    expect(app.textContent).toContain('Escribe tu correo y te enviamos un enlace para elegir una nueva.');
    expect(app.textContent).not.toMatch(/email/i);
  });

  it('al enviar: dice dónde buscar el mensaje, con los nombres de las carpetas, y no afirma que la cuenta exista', async () => {
    h.reset.mockResolvedValue({ data: {}, error: null });
    await pedirEnlace();
    expect(app.textContent).toContain('Revisa tu correo');
    expect(app.textContent).toContain(MENSAJE);
    expect(app.textContent).toContain('Búscalo en Recibidos, Spam o Correo no deseado.');
    expect(app.textContent).toContain('Si ese correo tiene una cuenta'); // condicional: no confirma nada
  });

  it('el MISMO texto aunque el servidor diga que no hay cuenta (no se puede averiguar qué correos están registrados)', async () => {
    h.reset.mockResolvedValue({ data: null, error: new AuthApiError('User not found', 400, 'user_not_found') });
    await pedirEnlace();
    expect(app.textContent).toContain(MENSAJE);
    expect(app.textContent).not.toMatch(/no existe|no hay ninguna cuenta|no encontramos/i);
  });

  it('sin señal sí avisa (el pedido ni llegó), con el texto neutro, y deja reintentar', async () => {
    h.reset.mockRejectedValue(new TypeError('Failed to fetch'));
    await pedirEnlace();
    expect(app.querySelector('[role="alert"]')!.textContent).toBe(NETWORK_ERROR_MESSAGE);
    expect(app.textContent).not.toContain('Revisa tu correo');
  });
});
