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
import { gastosKeys } from '@/features/gastos/gastos-keys';
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
  camion_activo_id: null,
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
  return <div id="edicion" data-pathname={location.pathname} data-search={location.search} data-state={JSON.stringify(location.state ?? null)} />;
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
                  <Route path="/gastos/sumar-a-viaje" element={<Edicion />} />
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
    expect(linea!.className).toContain('text-base');
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

  it('la fecha de la fila (junto a los litros) y el resto de las líneas de apoyo van a 16 px, en el color de apoyo de siempre', async () => {
    await mount();
    const detalle = [...itemOf(G_LARGO).querySelectorAll('p')].find((p) => p.textContent?.includes('40 L'))!;
    expect(detalle.className).toContain('text-base');
    expect(detalle.className).toContain('text-muted-foreground'); // el color NO cambió
    for (const item of items()) {
      for (const p of item.querySelectorAll('p')) expect(p.className, p.textContent ?? '').not.toMatch(/\btext-(xs|sm)\b/);
    }
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

describe('lista de gastos: el botón «Sumar varios a un viaje»', () => {
  const enlace = () => [...document.querySelectorAll<HTMLAnchorElement>('a')].find((a) => a.textContent?.trim() === 'Sumar varios a un viaje');

  it('con al menos un gasto SIN viaje en la lista: aparece, es un enlace secundario de 48 px de todo el ancho en el celular y lleva a /gastos/sumar-a-viaje', async () => {
    await mount();
    const boton = enlace()!;
    expect(boton).toBeDefined();
    expect(boton.getAttribute('href')).toBe('/gastos/sumar-a-viaje');
    expect(boton.className).toContain('h-12');
    expect(boton.className).not.toContain('h-14'); // no es el botón principal (el de «Nuevo gasto» es de 56 px)
    expect(boton.className).toContain('border-input'); // el estilo «secundario» (con borde) de los otros botones de ese tipo
    expect(boton.className).toContain('w-full');
    expect(boton.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('va debajo del filtro de categoría y antes del total y de la lista', async () => {
    await mount();
    const boton = enlace()!;
    const select = document.querySelector('select')!;
    const total = document.getElementById('gastos-total-titulo')!;
    const lista = document.querySelector('ul')!;
    expect(select.compareDocumentPosition(boton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(boton.compareDocumentPosition(total) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(boton.compareDocumentPosition(lista) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('lleva el MISMO search de la lista: el mes y la categoría', async () => {
    await mount(`/gastos?mes=2025-06&categoria=${PEAJES_ID}`);
    expect(enlace()!.getAttribute('href')).toBe(`/gastos/sumar-a-viaje?mes=2025-06&categoria=${PEAJES_ID}`);
  });

  it('con una categoría inválida en la URL el search sale normalizado (la categoría se ignora, igual que en la lista)', async () => {
    await mount('/gastos?mes=2025-06&categoria=no-es-un-uuid');
    expect(enlace()!.getAttribute('href')).toBe('/gastos/sumar-a-viaje?mes=2025-06');
  });

  it('al tocarlo se abre la pantalla nueva con ese search', async () => {
    await mount('/gastos?mes=2025-06');
    await act(async () => {
      enlace()!.click();
    });
    await settle(3);
    const destino = document.getElementById('edicion')!;
    expect(destino.dataset.pathname).toBe('/gastos/sumar-a-viaje');
    expect(destino.dataset.search).toBe('?mes=2025-06');
  });

  it('con TODOS los gastos en un viaje no aparece', async () => {
    gastos = () => ok([fila(G_CON, { viaje_id: V_ID, viajes: { origen: 'Pilar', destino: 'Villa María' } }), fila(G_LARGO, { viaje_id: V_ID, viajes: { origen: 'A', destino: 'B' } })]);
    await mount();
    expect(items()).toHaveLength(2);
    expect(enlace()).toBeUndefined();
  });

  it('con la lista vacía no aparece', async () => {
    gastos = () => ok([]);
    await mount();
    expect(enlace()).toBeUndefined();
  });

  it('mientras la lista carga no aparece', async () => {
    gastos = () => new Promise<Resp>(() => {}) as unknown as Resp;
    await mount();
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(enlace()).toBeUndefined();
  });

  it('si la lista falla y no hay datos, no aparece', async () => {
    gastos = () => ({ data: null, error: { code: '', message: 'TypeError: Failed to fetch' }, status: 0 });
    await mount();
    expect(items()).toHaveLength(0);
    expect(enlace()).toBeUndefined();
  });

  it('si falla un refresco con la lista ya a la vista, el botón se queda', async () => {
    await mount();
    expect(enlace()).toBeDefined();
    gastos = () => ({ data: null, error: { code: '', message: 'TypeError: Failed to fetch' }, status: 0 });
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: gastosKeys.all('tenant-a') });
    });
    await settle(6);
    expect(items()).toHaveLength(3);
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
    expect(enlace()).toBeDefined();
  });

  it('el resto de la pantalla no cambia: «Nuevo gasto» sigue en el encabezado y fijo abajo, y los gastos con su enlace a la edición', async () => {
    await mount();
    const nuevos = [...document.querySelectorAll<HTMLAnchorElement>('a[href="/gastos/nuevo"]')];
    expect(nuevos).toHaveLength(2); // el del encabezado (escritorio) y el de la barra fija (celular)
    expect(items()).toHaveLength(3);
  });
});
