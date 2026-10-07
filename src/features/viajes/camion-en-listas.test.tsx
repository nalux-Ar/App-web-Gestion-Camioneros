import { act, useMemo, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, type InitialEntry } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// El camión donde se MUESTRA (Etapa 5b): la fila "Camión" del detalle del viaje y la patente en las listas de viajes y de
// gastos (solo con 2 o más camiones). La patente sale de la lista de camiones en caché, nunca de un embed.
type Op = { m: string; args: unknown[] };
type Call = { target: string; ops: Op[] };

const h = vi.hoisted(() => {
  const calls: Array<{ target: string; ops: Array<{ m: string; args: unknown[] }> }> = [];
  const state = { responder: null as null | ((call: { target: string; ops: Array<{ m: string; args: unknown[] }> }) => unknown) };
  function builder(target: string) {
    const call = { target, ops: [] as Array<{ m: string; args: unknown[] }> };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {};
    for (const m of ['select', 'eq', 'neq', 'is', 'not', 'abortSignal', 'order', 'limit', 'gte', 'lt', 'maybeSingle']) {
      b[m] = (...args: unknown[]) => {
        call.ops.push({ m, args });
        return b;
      };
    }
    b.then = (onF: (v: unknown) => unknown, onR: (e: unknown) => unknown) => {
      calls.push(call);
      return Promise.resolve()
        .then(() => state.responder?.(call))
        .then(onF, onR);
    };
    return b;
  }
  return { calls, state, from: (table: string) => builder(table) };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from: h.from } }));

import { AuthContext, type AuthContextValue } from '@/features/auth/auth-context';
import { MemberProvider } from '@/features/member/member-provider';
import { RequireMember } from '@/app/guards';
import { ViajeDetallePage } from '@/features/viajes/viaje-detalle-page';
import { ViajesPage } from '@/features/viajes/viajes-page';
import { GastosPage } from '@/features/gastos/gastos-page';
import { COMBUSTIBLE_CATEGORIA_ID, GASTOS_VARIOS_CATEGORIA_ID } from '@/features/gastos/constants';
import type { Categoria } from '@/features/gastos/categorias';
import { queryClient } from '@/lib/query-client';

type Resp = { data: unknown; error: { message: string; code: string } | null; status: number };
const ok = (data: unknown): Resp => ({ data, error: null, status: 200 });
const sinRed = (): Resp => ({ data: null, error: { code: '', message: 'TypeError: Failed to fetch' }, status: 0 });

const MIEMBRO = { rol: 'chofer', tema: 'dark', color_acento: '#F59E0B', transportista_id: 'tenant-a', transportistas: { nombre: 'Transportes A' } };
const PEAJES_ID = '210b4f00-fdb4-499b-bf15-79ebe2aaf3c3';
const CATS: Categoria[] = [
  { id: COMBUSTIBLE_CATEGORIA_ID, nombre: 'Combustible', activa: true, transportista_id: null },
  { id: GASTOS_VARIOS_CATEGORIA_ID, nombre: 'Gastos varios', activa: true, transportista_id: null },
  { id: PEAJES_ID, nombre: 'Peajes', activa: true, transportista_id: null },
];

const cid = (n: number) => `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const A = { id: cid(1), patente: 'AB123CD', marca: 'Scania', modelo: null, anio: null, activa: true };
const B = { id: cid(2), patente: 'ABC123', marca: null, modelo: null, anio: null, activa: true };
const X = { id: cid(9), patente: 'XY987ZW', marca: null, modelo: null, anio: null, activa: false };

const VIAJE_ID = 'b0000000-0000-4000-8000-000000000001';
const V2 = 'b0000000-0000-4000-8000-000000000002';
const vista = (camionId: string | null) => ({
  id: VIAJE_ID,
  camion_id: camionId,
  fecha: '2025-06-15',
  origen: 'Rosario',
  destino: 'Córdoba',
  km_inicial: null,
  km_final: null,
  km_recorridos: 500,
  ingreso: null,
  observaciones: null,
  entregas: [],
});
const filaViaje = (id: string, camionId: string | null) => ({
  id,
  camion_id: camionId,
  fecha: '2025-08-01',
  origen: 'Rosario',
  destino: 'Córdoba',
  km_inicial: null,
  km_final: null,
  km_recorridos: null,
  ingreso: null,
  created_at: '2025-08-01T10:00:00Z',
  entregas: [{ count: 0 }],
});
const G1 = 'e0000000-0000-4000-8000-000000000001';
const G2 = 'e0000000-0000-4000-8000-000000000002';
const filaGasto = (id: string, over: Record<string, unknown>) => ({
  id,
  categoria_id: PEAJES_ID,
  fecha: '2025-08-01',
  monto: 800,
  descripcion: null,
  litros: null,
  camion_id: null,
  created_at: '2025-08-01T10:00:00Z',
  viaje_id: null,
  viajes: null,
  ...over,
});

let camiones: () => Resp = () => ok([A, B]);
let viaje: () => Resp = () => ok(vista(A.id));

function installResponder() {
  h.state.responder = (call: Call) => {
    const has = (m: string) => call.ops.some((o) => o.m === m);
    if (call.target === 'miembros' && has('maybeSingle')) return ok(MIEMBRO);
    if (call.target === 'camiones') return camiones();
    if (call.target === 'categorias_gasto') return ok(CATS);
    if (call.target === 'devoluciones') return ok([]);
    if (call.target === 'viajes') return has('maybeSingle') ? viaje() : ok([filaViaje(VIAJE_ID, A.id), filaViaje(V2, null)]);
    if (call.target === 'gastos') {
      // Los gastos del detalle de un viaje (filtrados por viaje) o la lista del mes.
      if (call.ops.some((o) => o.m === 'eq' && o.args[0] === 'viaje_id')) return ok([]);
      return ok([
        filaGasto(G1, { categoria_id: COMBUSTIBLE_CATEGORIA_ID, litros: 40, camion_id: B.id }),
        filaGasto(G2, { descripcion: 'Peaje Ruta 9' }),
      ]);
    }
    throw new Error(`pedido inesperado: ${call.target} ${call.ops.map((o) => o.m).join('.')}`);
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

async function mount(entry: InitialEntry) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <AuthHarness>
          <MemberProvider>
            <MemoryRouter initialEntries={[entry]}>
              <RequireMember>
                <Routes>
                  <Route path="/viajes" element={<ViajesPage />} />
                  <Route path="/viajes/:id" element={<ViajeDetallePage />} />
                  <Route path="/gastos" element={<GastosPage />} />
                </Routes>
              </RequireMember>
            </MemoryRouter>
          </MemberProvider>
        </AuthHarness>
      </QueryClientProvider>,
    );
  });
  await settle(8);
}

/** El `<dd>` de una fila del detalle por su `<dt>`. */
const datoDe = (titulo: string) =>
  [...document.querySelectorAll('dt')].find((dt) => dt.textContent === titulo)?.nextElementSibling?.textContent ?? null;
const filaDe = (href: string) => document.querySelector(`a[href="${href}"]`)?.textContent ?? '';

beforeEach(() => {
  h.calls.length = 0;
  camiones = () => ok([A, B]);
  viaje = () => ok(vista(A.id));
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

describe('detalle del viaje: fila "Camión"', () => {
  it('con camiones: la patente del camión del viaje', async () => {
    await mount(`/viajes/${VIAJE_ID}`);
    expect(datoDe('Camión')).toBe('AB 123 CD');
  });

  it('un viaje viejo sin camión, con camiones en la cuenta: "Sin asignar"', async () => {
    viaje = () => ok(vista(null));
    await mount(`/viajes/${VIAJE_ID}`);
    expect(datoDe('Camión')).toBe('Sin asignar');
  });

  it('su camión archivado: "(archivado)"', async () => {
    camiones = () => ok([A, X]);
    viaje = () => ok(vista(X.id));
    await mount(`/viajes/${VIAJE_ID}`);
    expect(datoDe('Camión')).toBe('XY 987 ZW (archivado)');
  });

  it('0 camiones en la cuenta: no hay fila (como hoy)', async () => {
    camiones = () => ok([]);
    viaje = () => ok(vista(null));
    await mount(`/viajes/${VIAJE_ID}`);
    expect(datoDe('Camión')).toBeNull();
    expect(datoDe('Kilometraje')).not.toBeNull();
  });

  it('si la lista de camiones no carga: no hay fila (el resto del detalle, igual)', async () => {
    camiones = () => sinRed();
    await mount(`/viajes/${VIAJE_ID}`);
    expect(datoDe('Camión')).toBeNull();
    expect(datoDe('Kilometraje')).toBe('500 km');
  });

  it('la vista del viaje pide camion_id y NO embebe camiones', async () => {
    await mount(`/viajes/${VIAJE_ID}`);
    const select = String(h.calls.find((c) => c.target === 'viajes')!.ops.find((o) => o.m === 'select')!.args[0]);
    expect(select).toContain('camion_id');
    expect(select).not.toContain('camiones(');
  });
});

describe('lista de viajes: la patente solo con 2 o más camiones', () => {
  it('2 camiones: el viaje con camión lo muestra; el que no tiene, nada', async () => {
    await mount('/viajes?mes=2025-08');
    expect(filaDe(`/viajes/${VIAJE_ID}`)).toContain('AB 123 CD');
    expect(filaDe(`/viajes/${V2}`)).not.toMatch(/AB 123 CD|ABC 123/);
  });

  it('1 camión: no se muestra (no aporta nada)', async () => {
    camiones = () => ok([A]);
    await mount('/viajes?mes=2025-08');
    expect(filaDe(`/viajes/${VIAJE_ID}`)).not.toContain('AB 123 CD');
  });

  it('1 activo + 1 archivado cuentan como 2', async () => {
    camiones = () => ok([A, X]);
    await mount('/viajes?mes=2025-08');
    expect(filaDe(`/viajes/${VIAJE_ID}`)).toContain('AB 123 CD');
  });

  it('si la lista de camiones no carga, la de viajes se ve igual (sin patentes)', async () => {
    camiones = () => sinRed();
    await mount('/viajes?mes=2025-08');
    expect(filaDe(`/viajes/${VIAJE_ID}`)).toContain('Rosario');
    expect(filaDe(`/viajes/${VIAJE_ID}`)).not.toContain('AB 123 CD');
  });
});

describe('lista de gastos: la patente de la carga solo con 2 o más camiones', () => {
  it('2 camiones: la carga de combustible muestra su camión', async () => {
    await mount('/gastos?mes=2025-08');
    expect(filaDe(`/gastos/${G1}/editar`)).toContain('ABC 123');
    expect(filaDe(`/gastos/${G2}/editar`)).not.toMatch(/AB 123 CD|ABC 123/);
  });

  it('1 camión: no se muestra', async () => {
    camiones = () => ok([B]);
    await mount('/gastos?mes=2025-08');
    expect(filaDe(`/gastos/${G1}/editar`)).not.toContain('ABC 123');
  });

  it('la lista de gastos pide camion_id sin embeber camiones', async () => {
    await mount('/gastos?mes=2025-08');
    const select = String(h.calls.find((c) => c.target === 'gastos')!.ops.find((o) => o.m === 'select')!.args[0]);
    expect(select).toContain('camion_id');
    expect(select).not.toContain('camiones(');
  });
});
