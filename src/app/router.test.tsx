import { act, useMemo, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock de supabase: registra cada pedido y responde según la tabla. TODO lo demás (el router REAL con sus guards y sus
// pantallas con carga diferida, el layout, TanStack Query) es código REAL del proyecto.
type Op = { m: string; args: unknown[] };
type Call = { table: string; ops: Op[] };

const h = vi.hoisted(() => {
  const calls: Array<{ table: string; ops: Array<{ m: string; args: unknown[] }> }> = [];
  const state = { responder: null as null | ((call: { table: string; ops: Array<{ m: string; args: unknown[] }> }) => unknown) };
  function from(table: string) {
    const call = { table, ops: [] as Array<{ m: string; args: unknown[] }> };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {};
    for (const m of ['select', 'update', 'insert', 'delete', 'eq', 'abortSignal', 'order', 'limit', 'gte', 'lt', 'maybeSingle', 'single']) {
      builder[m] = (...args: unknown[]) => {
        call.ops.push({ m, args });
        return builder;
      };
    }
    builder.then = (onF: (v: unknown) => unknown, onR: (e: unknown) => unknown) => {
      calls.push(call);
      return Promise.resolve()
        .then(() => state.responder?.(call))
        .then(onF, onR);
    };
    return builder;
  }
  return { calls, state, from };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from: h.from } }));

import { AppRouter } from '@/app/router';
import { AuthContext, type AuthContextValue } from '@/features/auth/auth-context';
import { MemberProvider } from '@/features/member/member-provider';
import { queryClient } from '@/lib/query-client';

const ok = (data: unknown) => ({ data, error: null, status: 200 });

const VIAJE = 'b0000000-0000-4000-8000-000000000001';
const DEV = 'f0000000-0000-4000-8000-000000000001';
const MIEMBRO = {
  rol: 'admin',
  tema: 'dark',
  color_acento: '#F59E0B',
  transportista_id: 'tenant-a',
  transportistas: { nombre: 'Transportes A' },
};
const VISTA = {
  id: VIAJE,
  fecha: '2025-06-15',
  origen: 'Rosario',
  destino: 'Córdoba',
  km_inicial: null,
  km_final: null,
  km_recorridos: null,
  ingreso: null,
  observaciones: null,
  entregas: [],
};
const DETALLE_VIAJE = { ...VISTA, camion_id: null };

function installResponder() {
  h.state.responder = (call: Call) => {
    const has = (m: string) => call.ops.some((o) => o.m === m);
    if (call.table === 'miembros' && has('maybeSingle')) return ok(MIEMBRO);
    if (call.table === 'clientes') return ok([]);
    if (call.table === 'categorias_gasto') return ok([]);
    if (call.table === 'gastos') return ok([]);
    if (call.table === 'viajes') {
      // La pantalla de solo lectura y la de edición piden el viaje por id (con entregas embebidas).
      const select = String(call.ops.find((o) => o.m === 'select')?.args[0] ?? '');
      return has('maybeSingle') ? ok(select.includes('camion_id') ? DETALLE_VIAJE : VISTA) : ok([]);
    }
    if (call.table === 'devoluciones') {
      if (has('maybeSingle')) return ok({ id: DEV, viaje_id: VIAJE, cliente_id: 'a0000000-0000-4000-8000-000000000001', motivo: 'otro', descripcion: 'x' });
      return ok([]);
    }
    throw new Error(`pedido inesperado: ${call.table} ${call.ops.map((o) => o.m).join('.')}`);
  };
}

function AuthHarness({ children, conSesion }: { children: ReactNode; conSesion: boolean }) {
  const value = useMemo<AuthContextValue>(
    () => ({
      session: conSesion ? ({ access_token: 't' } as never) : null,
      user: conSesion ? ({ id: 'user-a', email: 'a@correo.test' } as never) : null,
      status: 'ready',
      signOut: async () => ({ ok: true }),
    }),
    [conSesion],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

let root: Root;
let container: HTMLElement;
let errorSpy: ReturnType<typeof vi.spyOn>;

const h1 = () => document.querySelector('h1')?.textContent ?? '';

async function settle(times = 4) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

/** Espera (con act) a que se cumpla algo: las pantallas se cargan con `lazy`, así que tardan más que un turno. */
async function until(condition: () => boolean, ms = 15_000) {
  const limit = Date.now() + ms;
  while (!condition() && Date.now() < limit) await settle(1);
}

async function mount(path: string, conSesion = true) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <AuthHarness conSesion={conSesion}>
          <MemberProvider>
            <MemoryRouter initialEntries={[path]}>
              <AppRouter />
            </MemoryRouter>
          </MemberProvider>
        </AuthHarness>
      </QueryClientProvider>,
    );
  });
  await settle(4);
}

beforeEach(() => {
  h.calls.length = 0;
  installResponder();
  localStorage.clear();
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.scrollTo = (() => {}) as never;
  Element.prototype.scrollIntoView = (() => {}) as never;
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

describe('router: las rutas de devoluciones, anidadas bajo el viaje', () => {
  it('/viajes/<id>/devoluciones/nueva abre el formulario de una devolución nueva, dentro del layout de la app', async () => {
    await mount(`/viajes/${VIAJE}/devoluciones/nueva`);
    await until(() => h1() === 'Nueva devolución');
    expect(h1()).toBe('Nueva devolución');
    expect(document.querySelector('header')).not.toBeNull(); // el layout (AppShell) de la app logueada
    await until(() => document.querySelector('input[type="radio"][value="otro"]') !== null);
    expect(document.querySelector('input[type="radio"][value="otro"]')).not.toBeNull();
  });

  it('/viajes/<id>/devoluciones/<id>/editar abre la edición de esa devolución', async () => {
    await mount(`/viajes/${VIAJE}/devoluciones/${DEV}/editar`);
    await until(() => h1() === 'Editar devolución');
    expect(h1()).toBe('Editar devolución');
    await until(() => document.querySelector('textarea') !== null);
    expect(document.querySelector<HTMLTextAreaElement>('#devolucion-descripcion')!.value).toBe('x');
  });

  it('no chocan con las rutas de viajes: /viajes/<id> sigue siendo el detalle, /viajes/<id>/editar la edición y /viajes/nuevo el alta', async () => {
    await mount(`/viajes/${VIAJE}`);
    await until(() => h1().includes('Rosario'));
    expect(h1()).toContain('Rosario');
    expect(h1()).not.toContain('devolución');
    await act(async () => {
      root.unmount();
    });
    container.remove();
    queryClient.clear();

    await mount(`/viajes/${VIAJE}/editar`);
    await until(() => h1() === 'Editar viaje');
    expect(h1()).toBe('Editar viaje');
    await act(async () => {
      root.unmount();
    });
    container.remove();
    queryClient.clear();

    await mount('/viajes/nuevo');
    await until(() => h1() === 'Nuevo viaje');
    expect(h1()).toBe('Nuevo viaje');
  });

  it('rutas parecidas que no existen (/devoluciones, /devoluciones/editar, /devoluciones/nueva/x, /devoluciones/<id>) caen en la ruta desconocida: nada de devoluciones y ninguna consulta', async () => {
    for (const ruta of [
      `/viajes/${VIAJE}/devoluciones`,
      `/viajes/${VIAJE}/devoluciones/editar`,
      `/viajes/${VIAJE}/devoluciones/nueva/x`,
      `/viajes/${VIAJE}/devoluciones/${DEV}`,
      `/viajes/${VIAJE}/devoluciones/${DEV}/editar/x`,
      '/devoluciones',
      '/devoluciones/nueva',
    ]) {
      h.calls.length = 0;
      await mount(ruta);
      await until(() => h1().startsWith('Hola'));
      expect(h1(), ruta).toMatch(/^Hola/); // la ruta desconocida lleva a Inicio
      expect(h.calls.filter((c) => c.table === 'devoluciones'), ruta).toHaveLength(0);
      await act(async () => {
        root.unmount();
      });
      container.remove();
      queryClient.clear();
    }
  });

  it('no hay pantalla general ni ítem de menú de Devoluciones: solo se llega desde el detalle de un viaje', async () => {
    await mount('/');
    await until(() => h1().startsWith('Hola'));
    const nav = [...document.querySelectorAll('nav a')].map((a) => a.textContent?.trim());
    expect(nav.some((texto) => texto?.toLowerCase().includes('devolucion'))).toBe(false);
    expect([...document.querySelectorAll('a')].some((a) => (a.getAttribute('href') ?? '') === '/devoluciones')).toBe(false);
  });

  it('están detrás de la sesión: sin sesión no se pide NADA y no se muestra el formulario', async () => {
    await mount(`/viajes/${VIAJE}/devoluciones/nueva`, false);
    await settle(6);
    expect(h1()).not.toBe('Nueva devolución');
    expect(document.querySelector('input[type="radio"][value="otro"]')).toBeNull();
    expect(h.calls.filter((c) => c.table === 'devoluciones' || c.table === 'clientes' || c.table === 'viajes')).toHaveLength(0);
  });
});
