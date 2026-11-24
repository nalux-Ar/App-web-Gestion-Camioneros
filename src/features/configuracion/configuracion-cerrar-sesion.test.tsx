import { act, useMemo, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// «Cerrar sesión» pasó del encabezado («Salir», que cerraba de un toque) a la tarjeta «Tu cuenta» de Configuración, con confirmación
// (tanda 3b, A3). Acá se prueban las DOS pantallas reales juntas, con un `signOut` espía en el contexto de autenticación. Mock de
// supabase mínimo: solo la lectura del miembro y la lista de camiones; todo lo demás es código real del proyecto.
// ---------------------------------------------------------------------------
type Op = { m: string; args: unknown[] };
type Resp = { data: unknown; error: { message: string; code: string } | null; status: number };

const h = vi.hoisted(() => {
  const state = {
    responder: null as null | ((call: { table: string; ops: Array<{ m: string; args: unknown[] }> }) => unknown),
  };
  function from(table: string) {
    const call = { table, ops: [] as Array<{ m: string; args: unknown[] }> };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {};
    for (const m of ['select', 'update', 'insert', 'delete', 'eq', 'abortSignal', 'order', 'limit', 'gte', 'lt', 'maybeSingle']) {
      builder[m] = (...args: unknown[]) => {
        call.ops.push({ m, args });
        return builder;
      };
    }
    builder.then = (onF: (v: unknown) => unknown, onR: (e: unknown) => unknown) =>
      Promise.resolve()
        .then(() => state.responder?.(call))
        .then(onF, onR);
    return builder;
  }
  return { state, from };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from: h.from } }));

import { RequireMember } from '@/app/guards';
import { AuthContext, type AuthContextValue, type SignOutResult } from '@/features/auth/auth-context';
import { ConfiguracionPage } from '@/features/configuracion/configuracion-page';
import { Header } from '@/features/layout/header';
import { MemberProvider } from '@/features/member/member-provider';
import { queryClient } from '@/lib/query-client';

const ok = (data: unknown): Resp => ({ data, error: null, status: 200 });

let signOut: ReturnType<typeof vi.fn<() => Promise<SignOutResult>>>;
let root: Root;
let container: HTMLElement;
let errorSpy: ReturnType<typeof vi.spyOn>;

function Auth({ children }: { children: ReactNode }) {
  const value = useMemo<AuthContextValue>(
    () => ({
      session: { access_token: 't' } as never,
      user: { id: 'user-a', email: 'user-a@correo.test' } as never,
      status: 'ready',
      signOut,
    }),
    [],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

async function settle(times = 4) {
  for (let i = 0; i < times; i++) {
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
      <QueryClientProvider client={queryClient}>
        <Auth>
          <MemberProvider>
            <MemoryRouter>
              <RequireMember>
                <Header />
                <ConfiguracionPage />
              </RequireMember>
            </MemoryRouter>
          </MemberProvider>
        </Auth>
      </QueryClientProvider>,
    );
  });
  await settle();
}

const botones = (dentro: ParentNode = document) => [...dentro.querySelectorAll<HTMLButtonElement>('button')];
const botonPorTexto = (texto: string) => botones().find((b) => b.textContent?.trim() === texto) ?? null;
const encabezado = () => document.querySelector('header')!;
const tarjetaCuenta = () => [...document.querySelectorAll('[data-slot="card"]')].find((c) => c.querySelector('[data-slot="card-title"]')?.textContent === 'Tu cuenta')!;
async function tocar(el: HTMLElement | null) {
  if (!el) throw new Error('no se encontró el botón a tocar');
  await act(async () => {
    el.click();
  });
}

beforeEach(() => {
  signOut = vi.fn<() => Promise<SignOutResult>>(async () => ({ ok: true }));
  h.state.responder = (call) => {
    if (call.table === 'miembros' && call.ops.some((o: Op) => o.m === 'maybeSingle')) {
      return ok({
        rol: 'admin',
        tema: 'dark',
        color_acento: '#F59E0B',
        transportista_id: 'tenant-a',
        camion_activo_id: null,
        transportistas: { nombre: 'Transportes A' },
      });
    }
    if (call.table === 'camiones') return ok([]);
    throw new Error(`pedido inesperado: ${call.table} ${call.ops.map((o: Op) => o.m).join('.')}`);
  };
  localStorage.clear();
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  container?.remove();
  queryClient.clear();
  expect(errorSpy.mock.calls.map((c: unknown[]) => String(c[0]))).toEqual([]);
  errorSpy.mockRestore();
});

describe('el encabezado ya no tiene «Salir»', () => {
  it('ni botón, ni el texto, ni un nombre accesible «Salir»: solo queda Configuración', async () => {
    await montar();
    expect(botones(encabezado())).toHaveLength(0);
    expect(encabezado().textContent).not.toContain('Salir');
    expect(encabezado().querySelector('[aria-label="Salir"]')).toBeNull();
    expect(encabezado().querySelector('.lucide-log-out')).toBeNull();
    expect([...encabezado().querySelectorAll('a')].map((a) => a.getAttribute('aria-label'))).toEqual(['Configuración']);
    // En ningún otro lugar de la pantalla quedó un «Salir».
    expect(botones().some((b) => b.textContent?.trim() === 'Salir' || b.getAttribute('aria-label') === 'Salir')).toBe(false);
  });

  it('el encabezado no necesita la autenticación: ya no tiene nada que cerrar (no llama a signOut de ninguna manera)', async () => {
    await montar();
    for (const el of [...encabezado().querySelectorAll<HTMLElement>('a, button')]) {
      await act(async () => {
        el.click();
      });
    }
    expect(signOut).not.toHaveBeenCalled();
  });

  it('a 360 px el encabezado queda con el logo y un solo toque de 48 px (Configuración), sin nada que se pise ni se salga', async () => {
    await montar();
    const derecha = encabezado().querySelector('a[aria-label="Configuración"]')!.parentElement!;
    expect(derecha.children).toHaveLength(1);
    const enlace = derecha.children[0]!;
    expect(enlace.className).toContain('h-12');
    expect(enlace.className).toContain('w-12');
    // La fila del encabezado sigue siendo fluida: el nombre se corta con «…» y el logo no se achica.
    const fila = encabezado().firstElementChild!;
    expect(fila.className).toContain('justify-between');
    expect(fila.querySelector('img')!.className).toContain('shrink-0');
  });
});

describe('Configuración: «Cerrar sesión» en la tarjeta «Tu cuenta»', () => {
  it('la tarjeta «Tu cuenta» tiene el botón «Cerrar sesión» (56 px), debajo del correo', async () => {
    await montar();
    const boton = botones(tarjetaCuenta()).find((b) => b.textContent?.trim() === 'Cerrar sesión')!;
    expect(boton).toBeTruthy();
    expect(boton.className).toContain('h-14');
    expect(tarjetaCuenta().textContent).toContain('user-a@correo.test');
    expect(tarjetaCuenta().textContent).toContain('Si no es la tuya, cierra sesión.');
    // Un solo botón «Cerrar sesión» en toda la pantalla.
    expect(botones().filter((b) => b.textContent?.trim() === 'Cerrar sesión')).toHaveLength(1);
  });

  it('el primer toque NO cierra: muestra la pregunta con el texto exacto', async () => {
    await montar();
    await tocar(botonPorTexto('Cerrar sesión'));
    expect(signOut).not.toHaveBeenCalled();
    expect(tarjetaCuenta().textContent).toContain('¿Cerrar sesión? Para volver a entrar necesitas tu correo y tu contraseña.');
    expect(botones(tarjetaCuenta()).map((b) => b.textContent?.trim())).toEqual(['Sí, cerrar', 'No']);
  });

  it('«No» cancela sin llamar a signOut; «Sí, cerrar» lo llama una sola vez (aunque se toque dos veces)', async () => {
    let terminar!: (r: SignOutResult) => void;
    signOut.mockImplementation(() => new Promise<SignOutResult>((resolve) => (terminar = resolve)));
    await montar();
    await tocar(botonPorTexto('Cerrar sesión'));
    await tocar(botonPorTexto('No'));
    expect(signOut).not.toHaveBeenCalled();
    expect(botonPorTexto('Cerrar sesión')).not.toBeNull();

    await tocar(botonPorTexto('Cerrar sesión'));
    const si = botonPorTexto('Sí, cerrar')!;
    await act(async () => {
      si.click();
      si.click();
    });
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(tarjetaCuenta().textContent).toContain('Cerrando sesión…');
    await act(async () => terminar({ ok: true }));
    expect(signOut).toHaveBeenCalledTimes(1);
  });
});
