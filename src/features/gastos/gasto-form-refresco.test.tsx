import { act, useMemo, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock de supabase: registra cada pedido y responde según la tabla. Todo lo demás es código REAL del proyecto.
type Op = { m: string; args: unknown[] };
type Call = { table: string; ops: Op[] };

const h = vi.hoisted(() => {
  const calls: Array<{ table: string; ops: Array<{ m: string; args: unknown[] }> }> = [];
  const state = { responder: null as null | ((call: { table: string; ops: Array<{ m: string; args: unknown[] }> }) => unknown) };
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

import { AuthContext, type AuthContextValue } from '@/features/auth/auth-context';
import { MemberProvider } from '@/features/member/member-provider';
import { RequireMember } from '@/app/guards';
import { GastoFormPage } from '@/features/gastos/gasto-form-page';
import { gastosKeys } from '@/features/gastos/gastos-keys';
import { COMBUSTIBLE_CATEGORIA_ID, GASTOS_VARIOS_CATEGORIA_ID } from '@/features/gastos/constants';
import type { Categoria } from '@/features/gastos/categorias';
import { queryClient } from '@/lib/query-client';

/**
 * Regresión (auditoría de la Etapa 2): con el formulario de un gasto abierto, un refresco que falla (típico al
 * volver la señal) NO tiene que reemplazarlo por el mensaje de error: se llevaría lo que el usuario tipeó. El error
 * de carga solo ocupa la pantalla cuando NO hay datos con los que mostrar el formulario.
 */

const GASTO_ID = 'e0000000-0000-4000-8000-000000000001';
const PEAJES_ID = '210b4f00-fdb4-499b-bf15-79ebe2aaf3c3';
const CATS: Categoria[] = [
  { id: COMBUSTIBLE_CATEGORIA_ID, nombre: 'Combustible', activa: true, transportista_id: null },
  { id: GASTOS_VARIOS_CATEGORIA_ID, nombre: 'Gastos varios', activa: true, transportista_id: null },
  { id: PEAJES_ID, nombre: 'Peajes', activa: true, transportista_id: null },
];
const GASTO = {
  id: GASTO_ID,
  categoria_id: PEAJES_ID,
  fecha: '2026-10-01',
  monto: 900,
  descripcion: null,
  metodo_pago: null,
  litros: null,
  precio_por_litro: null,
  km_odometro: null,
  tanque_lleno: null,
};

const ok = (data: unknown) => ({ data, error: null, status: 200 });
/** Una falla de red como la que arma supabase-js: sin código de servidor. */
const sinRed = () => ({ data: null, error: { code: '', message: 'TypeError: Failed to fetch' }, status: 0 });

const cargas = { gasto: 0, categorias: 0 };

function installResponder(opts: { gastoFalla?: boolean; categoriasFalla?: boolean } = {}) {
  h.state.responder = (call: Call) => {
    if (call.table === 'miembros' && call.ops.some((o) => o.m === 'maybeSingle')) {
      return ok({
        rol: 'admin',
        tema: 'dark',
        color_acento: '#F59E0B',
        transportista_id: 'tenant-a',
        transportistas: { nombre: 'Transportes A' },
      });
    }
    if (call.table === 'categorias_gasto') {
      cargas.categorias += 1;
      // La primera carga sale bien; las siguientes (refrescos) fallan si se pidió.
      return opts.categoriasFalla && cargas.categorias > 1 ? sinRed() : ok(CATS);
    }
    if (call.table === 'viajes') return ok([]); // los viajes recientes del selector "Viaje"
    if (call.table === 'gastos') {
      cargas.gasto += 1;
      return opts.gastoFalla && cargas.gasto > 1 ? sinRed() : ok(GASTO);
    }
    throw new Error(`pedido inesperado: ${call.table} ${call.ops.map((o) => o.m).join('.')}`);
  };
}

function AuthHarness({ children }: { children: ReactNode }) {
  const value = useMemo<AuthContextValue>(
    () => ({
      session: { access_token: 't' } as never,
      user: { id: 'user-a', email: 'a@correo.test' } as never,
      status: 'ready',
      signOut: async () => ({ ok: true }),
    }),
    [],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

let root: Root;
let container: HTMLElement;
let errorSpy: ReturnType<typeof vi.spyOn>;

async function settle(times = 4) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function mount(path: string) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <AuthHarness>
          <MemberProvider>
            <MemoryRouter initialEntries={[path]}>
              <RequireMember>
                <Routes>
                  <Route path="/gastos/nuevo" element={<GastoFormPage modo="nuevo" />} />
                  <Route path="/gastos/:id/editar" element={<GastoFormPage modo="editar" />} />
                </Routes>
              </RequireMember>
            </MemoryRouter>
          </MemberProvider>
        </AuthHarness>
      </QueryClientProvider>,
    );
  });
  await settle(6);
}

const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T | null;
const bodyText = () => document.body.textContent ?? '';

async function typeText(el: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

beforeEach(() => {
  h.calls.length = 0;
  h.state.responder = null;
  cargas.gasto = 0;
  cargas.categorias = 0;
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

describe('formulario de gasto: un refresco fallido no desmonta el formulario abierto', () => {
  it('editar: si falla un refresco del gasto, lo tipeado queda en pantalla', async () => {
    installResponder({ gastoFalla: true });
    await mount(`/gastos/${GASTO_ID}/editar`);
    await typeText(byId<HTMLInputElement>('gasto-monto')!, '777');

    await act(async () => {
      await queryClient.refetchQueries({ queryKey: gastosKeys.detail('tenant-a', GASTO_ID) });
    });
    await settle(4);

    expect(cargas.gasto).toBe(2); // el refresco ocurrió y falló
    expect(byId<HTMLInputElement>('gasto-monto')?.value).toBe('777');
  });

  it('alta: si falla un refresco de las categorías, lo tipeado queda en pantalla', async () => {
    installResponder({ categoriasFalla: true });
    await mount('/gastos/nuevo');
    await typeText(byId<HTMLInputElement>('gasto-monto')!, '555');

    await act(async () => {
      await queryClient.refetchQueries({ queryKey: gastosKeys.categorias('tenant-a') });
    });
    await settle(4);

    expect(cargas.categorias).toBe(2);
    expect(byId<HTMLInputElement>('gasto-monto')?.value).toBe('555');
  });

  it('sin datos (la primera carga falla) sí se muestra el error con "Reintentar" en lugar del formulario', async () => {
    h.state.responder = (call: Call) => {
      if (call.table === 'miembros' && call.ops.some((o) => o.m === 'maybeSingle')) {
        return ok({
          rol: 'admin',
          tema: 'dark',
          color_acento: '#F59E0B',
          transportista_id: 'tenant-a',
          transportistas: { nombre: 'Transportes A' },
        });
      }
      if (call.table === 'categorias_gasto') return sinRed();
      if (call.table === 'viajes') return ok([]);
      throw new Error(`pedido inesperado: ${call.table}`);
    };
    await mount('/gastos/nuevo');
    expect(bodyText()).toContain('No hay conexión');
    expect([...document.querySelectorAll('button')].some((b) => b.textContent?.includes('Reintentar'))).toBe(true);
    expect(byId('gasto-monto')).toBeNull();
  });
});
