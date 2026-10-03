import { act, useMemo, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation, type InitialEntry } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock de supabase: registra cada pedido y responde segun la tabla. Todo lo demas es codigo REAL del proyecto.
type Op = { m: string; args: unknown[] };
type Call = { table: string; ops: Op[] };

const h = vi.hoisted(() => {
  const calls: Array<{ table: string; ops: Array<{ m: string; args: unknown[] }> }> = [];
  const state = { responder: null as null | ((call: { table: string; ops: Array<{ m: string; args: unknown[] }> }) => unknown) };
  function from(table: string) {
    const call = { table, ops: [] as Array<{ m: string; args: unknown[] }> };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {};
    for (const m of ['select', 'eq', 'abortSignal', 'order', 'limit', 'gte', 'lt', 'maybeSingle']) {
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
import { GastosPage } from '@/features/gastos/gastos-page';
import { COMBUSTIBLE_CATEGORIA_ID, GASTOS_VARIOS_CATEGORIA_ID } from '@/features/gastos/constants';
import type { Categoria } from '@/features/gastos/categorias';
import { queryClient } from '@/lib/query-client';

type Resp = { data: unknown; error: { message: string; code: string } | null; status: number };
const ok = (data: unknown): Resp => ({ data, error: null, status: 200 });

const PEAJES_ID = '210b4f00-fdb4-499b-bf15-79ebe2aaf3c3';
const CATS: Categoria[] = [
  { id: COMBUSTIBLE_CATEGORIA_ID, nombre: 'Combustible', activa: true, transportista_id: null },
  { id: GASTOS_VARIOS_CATEGORIA_ID, nombre: 'Gastos varios', activa: true, transportista_id: null },
  { id: PEAJES_ID, nombre: 'Peajes', activa: true, transportista_id: null },
];
const MIEMBRO = {
  rol: 'admin',
  tema: 'dark',
  color_acento: '#F59E0B',
  transportista_id: 'tenant-a',
  transportistas: { nombre: 'Transportes A' },
};

const V_ID = 'b0000000-0000-4000-8000-000000000001';
const G_CON = 'e0000000-0000-4000-8000-000000000001';
const G_SIN = 'e0000000-0000-4000-8000-000000000002';
const G_LARGO = 'e0000000-0000-4000-8000-000000000003';

const fila = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  categoria_id: PEAJES_ID,
  fecha: '2026-10-01',
  monto: 800,
  descripcion: null,
  litros: null,
  created_at: '2026-10-01T10:00:00Z',
  viaje_id: null,
  viajes: null,
  ...over,
});
const FILAS = [
  fila(G_CON, { viaje_id: V_ID, viajes: { origen: 'Pilar', destino: 'Villa María' } }),
  fila(G_SIN, { categoria_id: GASTOS_VARIOS_CATEGORIA_ID, descripcion: 'Lavado' }),
  fila(G_LARGO, {
    categoria_id: COMBUSTIBLE_CATEGORIA_ID,
    litros: 40,
    viaje_id: V_ID,
    viajes: { origen: 'Un origen con un nombre larguísimo que no entra en una sola línea', destino: 'Un destino igual de largo que el origen de este viaje' },
  }),
];

let gastos: () => Resp = () => ok(FILAS);

function installResponder() {
  h.state.responder = (call: Call) => {
    if (call.table === 'miembros' && call.ops.some((o) => o.m === 'maybeSingle')) return ok(MIEMBRO);
    if (call.table === 'categorias_gasto') return ok(CATS);
    if (call.table === 'gastos') return gastos();
    throw new Error(`pedido inesperado: ${call.table}`);
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

/** La edicion de un gasto de mentira: muestra con que `state` se llego. */
function Edicion() {
  const location = useLocation();
  return <div id="edicion" data-state={JSON.stringify(location.state ?? null)} />;
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

async function mount(entry: InitialEntry = '/gastos') {
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
                  <Route path="/gastos" element={<GastosPage />} />
                  <Route path="/gastos/:id/editar" element={<Edicion />} />
                  <Route path="/gastos/nuevo" element={<Edicion />} />
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

const items = () => [...document.querySelectorAll<HTMLAnchorElement>('ul li a[href*="/editar"]')];
const itemOf = (id: string) => items().find((a) => a.getAttribute('href') === `/gastos/${id}/editar`)!;
const lineasDeViaje = (el: Element) => [...el.querySelectorAll('p')].filter((p) => p.textContent?.startsWith('Viaje:'));

beforeEach(() => {
  h.calls.length = 0;
  gastos = () => ok(FILAS);
  installResponder();
  localStorage.clear();
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.scrollTo = (() => {}) as never;
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  container?.remove();
  queryClient.clear();
  expect(errorSpy.mock.calls.map((c: unknown[]) => String(c[0]))).toEqual([]);
  vi.restoreAllMocks();
});

describe('lista de gastos: el viaje vinculado', () => {
  it('la consulta pide viaje_id y el embed viajes(origen, destino) en la MISMA consulta (no una por gasto)', async () => {
    await mount();
    const consultas = h.calls.filter((c) => c.table === 'gastos');
    expect(consultas).toHaveLength(1);
    const select = consultas[0]!.ops.find((o) => o.m === 'select')!.args[0] as string;
    expect(select).toContain('viaje_id');
    expect(select).toContain('viajes(origen, destino)');
    for (const columna of ['id', 'categoria_id', 'fecha', 'monto', 'descripcion', 'litros', 'created_at']) expect(select).toContain(columna);
  });

  it('un gasto vinculado muestra "Viaje: Pilar → Villa María" en una linea discreta y truncada', async () => {
    await mount();
    const [linea] = lineasDeViaje(itemOf(G_CON));
    expect(linea).toBeDefined();
    // Con el "a" oculto a la vista para el lector de pantalla entre la flecha y el destino.
    expect(linea!.textContent!.replace(/\s+/g, ' ')).toBe('Viaje: Pilar → a Villa María');
    expect(linea!.className).toContain('truncate');
    expect(linea!.className).toContain('text-sm');
    expect(linea!.className).toContain('text-muted-foreground'); // discreta: mismo tono que la fecha
  });

  it('la flecha es decorativa y el lector de pantalla oye "Viaje: Pilar a Villa María"', async () => {
    await mount();
    const [linea] = lineasDeViaje(itemOf(G_CON));
    expect(linea!.querySelector('[aria-hidden="true"]')!.textContent).toBe('→');
    expect(linea!.querySelector('.sr-only')!.textContent).toBe(' a ');
  });

  it('un gasto SIN viaje se ve igual que antes: sin linea de viaje', async () => {
    await mount();
    const item = itemOf(G_SIN);
    expect(lineasDeViaje(item)).toHaveLength(0);
    expect(item.textContent).not.toContain('Viaje');
    expect(item.textContent).toContain('Gastos varios');
    expect(item.textContent).toContain('Lavado');
  });

  it('un viaje con nombres largos no desborda: la linea es de UNA sola linea (truncate)', async () => {
    await mount();
    const [linea] = lineasDeViaje(itemOf(G_LARGO));
    expect(linea!.className).toContain('truncate');
    expect(linea!.closest('.min-w-0')).not.toBeNull(); // el contenedor flexible permite que el texto se corte
  });

  it('los litros de combustible y el resto de la fila siguen igual', async () => {
    await mount();
    const item = itemOf(G_LARGO);
    expect(item.textContent).toContain('Combustible');
    expect(item.textContent).toContain('40 L');
    expect(item.className).toContain('min-h-16');
  });

  it('toda la fila sigue siendo un enlace a la edicion, que vuelve a Gastos con sus filtros (state.volver), no a un viaje', async () => {
    await mount('/gastos?mes=2025-06');
    gastos = () => ok(FILAS);
    const item = itemOf(G_CON);
    await act(async () => {
      item.click();
    });
    await settle(3);
    const state = JSON.parse(document.getElementById('edicion')!.dataset.state!) as Record<string, unknown>;
    expect(state).toEqual({ volver: '?mes=2025-06' });
    expect(state).not.toHaveProperty('desdeViaje');
  });

  it('el total del mes no cambia por el viaje', async () => {
    await mount();
    expect(document.body.textContent).toContain('3 gastos');
  });

  it('un viaje con HTML en el nombre se muestra como texto', async () => {
    gastos = () => ok([fila(G_CON, { viaje_id: V_ID, viajes: { origen: '<img src=x onerror=alert(1)>', destino: '<b>x</b>' } })]);
    await mount();
    expect(document.querySelector('img')).toBeNull();
    expect(itemOf(G_CON).textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('una fila sin la clave del viaje (respuesta vieja) no rompe la lista', async () => {
    gastos = () => ok([{ id: G_SIN, categoria_id: PEAJES_ID, fecha: '2026-10-01', monto: 5, descripcion: null, litros: null, created_at: '2026-10-01T10:00:00Z' }]);
    await mount();
    expect(items()).toHaveLength(1);
    expect(lineasDeViaje(items()[0]!)).toHaveLength(0);
  });
});
