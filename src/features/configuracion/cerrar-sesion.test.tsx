import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthContext, type AuthContextValue, type SignOutResult } from '@/features/auth/auth-context';
import {
  BOTON_CERRAR_SESION,
  CANCELAR_CERRAR_SESION,
  CERRANDO_SESION,
  CERRAR_SESION_FALLBACK_MESSAGE,
  CONFIRMAR_CERRAR_SESION,
  CerrarSesion,
  PREGUNTA_CERRAR_SESION,
} from './cerrar-sesion';

// «Cerrar sesión» de la tarjeta «Tu cuenta» (tanda 3b, A3): dos toques, sin cerrar de entrada. El componente real, con un contexto de
// autenticación cuyo `signOut` es un espía: lo que importa es CUÁNTAS veces lo llama y cuándo.
let root: Root;
let container: HTMLElement;
let errorSpy: ReturnType<typeof vi.spyOn>;
let signOut: ReturnType<typeof vi.fn<() => Promise<SignOutResult>>>;

type Pendiente = { promise: Promise<SignOutResult>; resolve: (r: SignOutResult) => void; reject: (e: unknown) => void };
function pendiente(): Pendiente {
  let resolve!: (r: SignOutResult) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<SignOutResult>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function montar() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  const valor: AuthContextValue = { session: null, user: null, status: 'ready', signOut };
  await act(async () => {
    root.render(
      <AuthContext.Provider value={valor}>
        <CerrarSesion />
      </AuthContext.Provider>,
    );
  });
}

const botones = () => [...container.querySelectorAll<HTMLButtonElement>('button')];
const botonPorTexto = (texto: string) => botones().find((b) => b.textContent?.trim() === texto) ?? null;
const textoVisible = () => container.textContent ?? '';
const grupo = () => container.querySelector<HTMLElement>('[role="group"]');

async function tocar(el: HTMLElement | null) {
  if (!el) throw new Error('no se encontró el botón a tocar');
  await act(async () => {
    el.click();
  });
}
async function pedirConfirmacion() {
  await tocar(botonPorTexto(BOTON_CERRAR_SESION));
}

beforeEach(() => {
  signOut = vi.fn<() => Promise<SignOutResult>>(async () => ({ ok: true }));
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  container?.remove();
  // Ninguna prueba debe dejar avisos de React (act, setState, keys…).
  expect(errorSpy.mock.calls.map((c: unknown[]) => String(c[0]))).toEqual([]);
  errorSpy.mockRestore();
});

describe('«Cerrar sesión»: los textos', () => {
  it('son exactamente los pedidos, en español de «tú»', () => {
    expect(BOTON_CERRAR_SESION).toBe('Cerrar sesión');
    expect(PREGUNTA_CERRAR_SESION).toBe('¿Cerrar sesión? Para volver a entrar necesitas tu correo y tu contraseña.');
    expect(CONFIRMAR_CERRAR_SESION).toBe('Sí, cerrar');
    expect(CANCELAR_CERRAR_SESION).toBe('No');
    expect(CERRANDO_SESION).toBe('Cerrando sesión…');
    for (const texto of [PREGUNTA_CERRAR_SESION, CERRAR_SESION_FALLBACK_MESSAGE]) expect(texto).not.toMatch(/\b(tocá|elegí|podés|necesitás|tenés)\b/i);
  });
});

describe('«Cerrar sesión»: el primer toque NO cierra', () => {
  it('al principio es solo un botón «Cerrar sesión» de 56 px (tamaño lg), con borde (estilo secundario) y sin colores a mano', async () => {
    await montar();
    expect(botones().map((b) => b.textContent?.trim())).toEqual([BOTON_CERRAR_SESION]);
    const boton = botonPorTexto(BOTON_CERRAR_SESION)!;
    expect(boton.type).toBe('button');
    expect(boton.className).toContain('h-14'); // 56 px
    expect(boton.className).toContain('border-input'); // contorno del tema
    expect(boton.className).not.toContain('bg-primary');
    expect(boton.className).not.toMatch(/\b(?:bg|text|border)-(?:red|rose|\[#)/);
    expect(boton.className).not.toContain('destructive');
    expect(boton.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
    expect(textoVisible()).not.toContain('¿Cerrar sesión?');
    expect(signOut).not.toHaveBeenCalled();
  });

  it('tocarlo muestra la pregunta con el texto exacto y dos botones, «Sí, cerrar» y «No», de 56 px; NO llama a signOut', async () => {
    await montar();
    await pedirConfirmacion();
    expect(signOut).not.toHaveBeenCalled();
    expect(textoVisible()).toContain('¿Cerrar sesión? Para volver a entrar necesitas tu correo y tu contraseña.');
    expect(botones().map((b) => b.textContent?.trim())).toEqual(['Sí, cerrar', 'No']);
    for (const boton of botones()) {
      expect(boton.type).toBe('button');
      expect(boton.className).toContain('h-14');
      expect(boton.disabled).toBe(false);
    }
    // El botón inicial ya no está (la pregunta lo reemplaza).
    expect(botonPorTexto(BOTON_CERRAR_SESION)).toBeNull();
  });

  it('la pregunta es un grupo con nombre (su propio texto) y el foco pasa a «No», la opción segura', async () => {
    await montar();
    await pedirConfirmacion();
    const g = grupo()!;
    expect(document.getElementById(g.getAttribute('aria-labelledby')!)!.textContent).toBe(PREGUNTA_CERRAR_SESION);
    expect(document.activeElement).toBe(botonPorTexto('No'));
  });

  it('«No» cierra la pregunta sin llamar a signOut, devuelve el foco al botón y deja volver a abrirla', async () => {
    await montar();
    await pedirConfirmacion();
    await tocar(botonPorTexto('No'));
    expect(signOut).not.toHaveBeenCalled();
    expect(grupo()).toBeNull();
    expect(textoVisible()).not.toContain('¿Cerrar sesión?');
    expect(botones().map((b) => b.textContent?.trim())).toEqual([BOTON_CERRAR_SESION]);
    expect(document.activeElement).toBe(botonPorTexto(BOTON_CERRAR_SESION));
    await pedirConfirmacion();
    expect(textoVisible()).toContain(PREGUNTA_CERRAR_SESION);
    expect(signOut).not.toHaveBeenCalled();
  });
});

describe('«Cerrar sesión»: «Sí, cerrar»', () => {
  it('llama a signOut UNA vez', async () => {
    await montar();
    await pedirConfirmacion();
    await tocar(botonPorTexto('Sí, cerrar'));
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(signOut).toHaveBeenCalledWith();
  });

  it('mientras cierra: los dos botones apagados y «Cerrando sesión…» (en el botón y para lectores de pantalla)', async () => {
    const espera = pendiente();
    signOut.mockImplementation(() => espera.promise);
    await montar();
    await pedirConfirmacion();
    await tocar(botonPorTexto('Sí, cerrar'));
    expect(botones()).toHaveLength(2);
    expect(botones().every((b) => b.disabled)).toBe(true);
    expect(botones()[0]!.textContent).toContain('Cerrando sesión…');
    expect(botones()[0]!.getAttribute('aria-busy')).toBe('true');
    expect(container.querySelector('[role="status"]')!.textContent).toBe('Cerrando sesión…');
    expect(textoVisible()).toContain(PREGUNTA_CERRAR_SESION); // la pregunta sigue a la vista
    await act(async () => espera.resolve({ ok: true }));
  });

  it('un doble toque (dos clics seguidos antes de que React repinte) llama a signOut UNA sola vez', async () => {
    const espera = pendiente();
    signOut.mockImplementation(() => espera.promise);
    await montar();
    await pedirConfirmacion();
    const si = botonPorTexto('Sí, cerrar')!;
    await act(async () => {
      si.click();
      si.click();
    });
    expect(signOut).toHaveBeenCalledTimes(1);
    // Ni siquiera tocando de nuevo mientras sigue cerrando (el botón está apagado).
    await tocar(botones()[0]!);
    await tocar(botones()[1]!);
    expect(signOut).toHaveBeenCalledTimes(1);
    await act(async () => espera.resolve({ ok: true }));
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it('una vez cerrada la sesión sigue bloqueado: no hay nada que reintentar (la pantalla se va sola)', async () => {
    await montar();
    await pedirConfirmacion();
    await tocar(botonPorTexto('Sí, cerrar'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(botones().every((b) => b.disabled)).toBe(true);
    await tocar(botones()[0]!);
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(grupo()!.querySelector('[role="alert"]')).toBeNull();
  });
});

describe('«Cerrar sesión»: si no se pudo cerrar', () => {
  it('signOut devuelve ok:false: se muestra SU mensaje, la sesión sigue y los botones vuelven a andar para intentar otra vez', async () => {
    signOut.mockResolvedValueOnce({ ok: false, message: 'No pudimos cerrar tu sesión (mensaje de prueba).' });
    await montar();
    await pedirConfirmacion();
    await tocar(botonPorTexto('Sí, cerrar'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.querySelector('[role="alert"]')!.textContent).toContain('No pudimos cerrar tu sesión (mensaje de prueba).');
    expect(botones().map((b) => b.textContent?.trim())).toEqual(['Sí, cerrar', 'No']);
    expect(botones().every((b) => !b.disabled)).toBe(true);
    // Reintentar: otra llamada, y ahora sí (el mensaje se va al empezar).
    await tocar(botonPorTexto('Sí, cerrar'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(signOut).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('«No» después de un fallo cierra la pregunta y se lleva el mensaje', async () => {
    signOut.mockResolvedValueOnce({ ok: false, message: 'No se pudo.' });
    await montar();
    await pedirConfirmacion();
    await tocar(botonPorTexto('Sí, cerrar'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    await tocar(botonPorTexto('No'));
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(botones().map((b) => b.textContent?.trim())).toEqual([BOTON_CERRAR_SESION]);
    await pedirConfirmacion();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('si signOut rechazara (no debería): texto propio, sin error sin manejar, y se puede volver a intentar', async () => {
    signOut.mockRejectedValueOnce(new Error('boom'));
    await montar();
    await pedirConfirmacion();
    await tocar(botonPorTexto('Sí, cerrar'));
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.querySelector('[role="alert"]')!.textContent).toContain(CERRAR_SESION_FALLBACK_MESSAGE);
    expect(botones().every((b) => !b.disabled)).toBe(true);
    await tocar(botonPorTexto('Sí, cerrar'));
    expect(signOut).toHaveBeenCalledTimes(2);
  });
});
