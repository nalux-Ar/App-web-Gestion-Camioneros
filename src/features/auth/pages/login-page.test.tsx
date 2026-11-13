import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { AuthApiError } from '@supabase/supabase-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// El ingreso (revisión de usabilidad, filas A5 y A12): «Olvidé mi contraseña» es un BOTÓN de 48 px con el texto a 16 px y 16 px
// de aire sobre el campo; el campo del correo dice «Correo electrónico»; y el error de credenciales cita ese botón por su nombre.
const h = vi.hoisted(() => ({ signIn: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: { auth: { signInWithPassword: h.signIn } } }));

import { CREDENCIALES_MESSAGE, NETWORK_ERROR_MESSAGE } from '../auth-errors';
import { LoginPage } from './login-page';

let root: Root;
let app: HTMLElement;

beforeEach(async () => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  h.signIn.mockReset();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  app = document.createElement('div');
  document.body.appendChild(app);
  root = createRoot(app);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/ingresar']}>
        <LoginPage />
      </MemoryRouter>,
    );
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  app.remove();
});

const enlaceOlvide = () => [...app.querySelectorAll('a')].find((a) => a.getAttribute('href') === '/recuperar-contrasena')!;
const correo = () => app.querySelector<HTMLInputElement>('input[type="email"]')!;
const clave = () => app.querySelector<HTMLInputElement>('input[autocomplete="current-password"]')!;

async function escribir(el: HTMLInputElement, valor: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, valor);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function enviar() {
  await act(async () => {
    app.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  for (let i = 0; i < 3; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))));
}

describe('ingreso: el correo y «Olvidé mi contraseña»', () => {
  it('el campo se llama «Correo electrónico» (ya no «Email») y el texto de arriba también habla de «correo»', () => {
    const etiquetas = [...app.querySelectorAll('label')].map((l) => l.textContent);
    expect(etiquetas).toContain('Correo electrónico');
    expect(etiquetas).not.toContain('Email');
    expect(app.textContent).toContain('Ingresa con tu correo y tu contraseña.');
    expect(app.textContent).not.toMatch(/email/i);
  });

  it('«Olvidé mi contraseña» es un botón de 48 px de alto, con el texto a 16 px y la forma de un botón (borde), no un enlace chico', () => {
    const boton = enlaceOlvide();
    expect(boton.textContent).toBe('Olvidé mi contraseña');
    const clases = boton.className.split(/\s+/);
    expect(clases).toContain('h-12'); // 48 px
    expect(clases).toContain('text-base'); // 16 px
    expect(clases).toContain('border'); // se ve como un botón
    expect(clases).not.toContain('underline'); // y no como un enlace subrayado
    expect(app.textContent).not.toContain('¿Olvidaste tu contraseña?');
  });

  it('sigue siendo un enlace (navega a recuperar la contraseña), hermano del campo de la contraseña y a 16 px de él', () => {
    const boton = enlaceOlvide();
    expect(boton.tagName).toBe('A');
    const grupo = boton.parentElement!.parentElement!;
    expect(grupo.className.split(/\s+/)).toContain('space-y-4'); // 16 px entre el campo y el botón (antes: 6 px)
    expect(grupo.className).not.toContain('space-y-1.5');
    expect(grupo.querySelector('input[autocomplete="current-password"]')).toBe(clave());
    expect(grupo.firstElementChild!.contains(clave())).toBe(true); // el campo va ANTES que el botón
  });

  it('con credenciales malas el error dice qué hacer y cita el botón EXACTAMENTE como se llama', async () => {
    h.signIn.mockResolvedValue({ error: new AuthApiError('Invalid login credentials', 400, 'invalid_credentials') });
    await escribir(correo(), 'chofer@correo.test');
    await escribir(clave(), 'una-clave-mala');
    await enviar();
    const alerta = app.querySelector('[role="alert"]')!;
    expect(alerta.textContent).toBe(CREDENCIALES_MESSAGE);
    expect(alerta.textContent).toContain(`«${enlaceOlvide().textContent}»`);
    expect(alerta.textContent).not.toContain('Invalid login credentials');
  });

  it('sin señal al ingresar: el texto neutro (no habla de guardar ni de «Reintentar»: el botón es «Ingresar»)', async () => {
    h.signIn.mockRejectedValue(new TypeError('Failed to fetch'));
    await escribir(correo(), 'chofer@correo.test');
    await escribir(clave(), 'una-clave');
    await enviar();
    expect(app.querySelector('[role="alert"]')!.textContent).toBe(NETWORK_ERROR_MESSAGE);
  });
});
