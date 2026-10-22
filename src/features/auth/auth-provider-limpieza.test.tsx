import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Lo que "Reportar un problema" junta en memoria (errores recientes y última pantalla) se vacía en los MISMOS momentos que
// la caché de datos: cualquier transición a "sin sesión", un cambio de usuario y el "Salir" manual. Mock de supabase.auth;
// el AuthProvider es el REAL.
const h = vi.hoisted(() => ({
  session: null as unknown,
  listener: null as null | ((event: string, session: unknown) => void),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: h.session }, error: null }),
      onAuthStateChange: (callback: (event: string, session: unknown) => void) => {
        h.listener = callback;
        return { data: { subscription: { unsubscribe: () => {} } } };
      },
      signOut: () => Promise.resolve({ error: null }),
    },
  },
}));

import { AuthProvider } from './auth-provider';
import { useAuth } from './use-auth';
import type { AuthContextValue } from './auth-context';
import { leerUltimaPantalla, limpiarUltimaPantalla, registrarPantalla } from '@/features/reportar/ultima-pantalla';
import { erroresRecientes, limpiarErroresRecientes, registrarErrorDeDatos } from '@/lib/errores-recientes';
import { queryClient } from '@/lib/query-client';

const sesion = (id: string) => ({ access_token: 't', user: { id, email: `${id}@correo.test` } });

let root: Root;
let container: HTMLElement;
/** El contexto de auth, para tocar "Salir" desde la prueba (se guarda en un efecto, no durante el render). */
const capturado: { auth: AuthContextValue | null } = { auth: null };

function Captura() {
  const value = useAuth();
  useEffect(() => {
    capturado.auth = value;
  });
  return null;
}

async function settle() {
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function montar() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/gastos']}>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <Captura />
          </AuthProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );
  });
  await settle();
}

/** Deja anotado algo en los dos registros (como si la persona hubiera estado usando la app). */
function usarLaApp() {
  registrarErrorDeDatos({ code: '23514', message: 'x' }, 'crear-gasto');
  registrarPantalla('/gastos', '?mes=2026-08');
}

async function emitir(evento: string, session: unknown) {
  await act(async () => h.listener?.(evento, session));
  await settle();
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  h.session = sesion('user-a');
  h.listener = null;
  limpiarErroresRecientes();
  limpiarUltimaPantalla();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  queryClient.clear();
});

describe('AuthProvider: limpia lo de "Reportar un problema" junto con la caché', () => {
  it('al pasar a "sin sesión" (logout en otra pestaña, sesión vencida): se vacían los dos registros', async () => {
    await montar();
    usarLaApp();
    await emitir('SIGNED_OUT', null);
    expect(erroresRecientes()).toEqual([]);
    expect(leerUltimaPantalla()).toBeNull();
  });

  it('al cambiar de usuario (otra cuenta en otra pestaña): se vacían', async () => {
    await montar();
    usarLaApp();
    await emitir('SIGNED_IN', sesion('user-b'));
    expect(erroresRecientes()).toEqual([]);
    expect(leerUltimaPantalla()).toBeNull();
  });

  it('el MISMO usuario re-emitido (volver a la pestaña): NO se vacían', async () => {
    await montar();
    usarLaApp();
    await emitir('SIGNED_IN', sesion('user-a'));
    expect(erroresRecientes()).toHaveLength(1);
    expect(leerUltimaPantalla()).toBe('/gastos?mes=2026-08');
  });

  it('"Salir" a mano: se vacían aunque el evento no llegue', async () => {
    await montar();
    usarLaApp();
    let resultado: unknown;
    await act(async () => {
      resultado = await capturado.auth!.signOut();
    });
    expect(resultado).toEqual({ ok: true });
    expect(erroresRecientes()).toEqual([]);
    expect(leerUltimaPantalla()).toBeNull();
  });
});
