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
import { ViajeDetallePage } from '@/features/viajes/viaje-detalle-page';
import { devolucionesKeys } from '@/features/devoluciones/devoluciones-keys';
import { gastosKeys } from '@/features/gastos/gastos-keys';
import { viajesKeys } from '@/features/viajes/viajes-keys';
import { COMBUSTIBLE_CATEGORIA_ID, GASTOS_VARIOS_CATEGORIA_ID } from '@/features/gastos/constants';
import type { Categoria } from '@/features/gastos/categorias';
import { formatNumber } from '@/lib/numbers';
import { queryClient } from '@/lib/query-client';

// ---------------------------------------------------------------------------
// "Base de datos" falsa
// ---------------------------------------------------------------------------
type Resp = { data: unknown; error: { message: string; code: string } | null; status: number };
const ok = (data: unknown): Resp => ({ data, error: null, status: 200 });
const sinRed = (): Resp => ({ data: null, error: { code: '', message: 'TypeError: Failed to fetch' }, status: 0 });

const VIAJE_ID = 'b0000000-0000-4000-8000-000000000001';
const E_1 = 'd0000000-0000-4000-8000-000000000001';
const E_2 = 'd0000000-0000-4000-8000-000000000002';
const E_3 = 'd0000000-0000-4000-8000-000000000003';
const D_1 = 'f0000000-0000-4000-8000-000000000001';
const D_2 = 'f0000000-0000-4000-8000-000000000002';
const D_3 = 'f0000000-0000-4000-8000-000000000003';
const C_1 = 'a0000000-0000-4000-8000-000000000001';
const C_2 = 'a0000000-0000-4000-8000-000000000002';
const C_3 = 'a0000000-0000-4000-8000-000000000003';
const G_1 = 'e0000000-0000-4000-8000-000000000001';
const G_2 = 'e0000000-0000-4000-8000-000000000002';
const G_3 = 'e0000000-0000-4000-8000-000000000003';
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

const vista = (over: Record<string, unknown> = {}) => ({
  id: VIAJE_ID,
  fecha: '2025-06-15',
  origen: 'Rosario',
  destino: 'Córdoba',
  km_inicial: 1200,
  km_final: 1850.5,
  km_recorridos: null,
  ingreso: 15000.5,
  observaciones: 'Todo bien\nSegunda línea',
  entregas: [
    { id: E_1, cliente_id: C_1, incidencias: 'Golpe en un pallet', created_at: '2025-06-15T10:00:00.001Z', clientes: { nombre: 'Almacén Central' } },
    { id: E_2, cliente_id: C_2, incidencias: null, created_at: '2025-06-15T10:00:00.002Z', clientes: { nombre: 'Frigorífico Sur' } },
    { id: E_3, cliente_id: C_3, incidencias: 'Llegó tarde', created_at: '2025-06-15T10:00:00.003Z', clientes: { nombre: 'Distribuidora Norte' } },
  ],
  ...over,
});

const gasto = (id: string, monto: number, over: Record<string, unknown> = {}) => ({
  id,
  categoria_id: PEAJES_ID,
  fecha: '2025-06-15',
  monto,
  descripcion: null,
  litros: null,
  created_at: '2025-06-15T12:00:00Z',
  ...over,
});
// 0,1 + 0,2 + 100,3: en coma flotante da 100.60000000000001; en centavos enteros, 100,6.
const GASTOS = [
  gasto(G_1, 0.1),
  gasto(G_2, 0.2, { categoria_id: GASTOS_VARIOS_CATEGORIA_ID, descripcion: 'Lavado del camión' }),
  gasto(G_3, 100.3, { categoria_id: COMBUSTIBLE_CATEGORIA_ID, litros: 40.5 }),
];

const devolucion = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  motivo: 'rotura_danio',
  descripcion: null,
  cliente_id: C_1,
  created_at: '2025-06-16T09:00:00Z',
  clientes: { nombre: 'Almacén Central' },
  ...over,
});
// De la más nueva a la más vieja (el orden lo pone la base: acá solo se muestra tal cual llega).
const DEVOLUCIONES = [
  devolucion(D_3, { motivo: 'otro', descripcion: 'El cliente cerró antes de la hora', cliente_id: C_3, clientes: { nombre: 'Distribuidora Norte' } }),
  devolucion(D_2, { motivo: 'vencimiento', cliente_id: C_2, clientes: { nombre: 'Frigorífico Sur' } }),
  devolucion(D_1, { motivo: 'mercaderia_incorrecta', descripcion: 'Cajas de otro pedido' }),
];

type Handler = (call: Call) => unknown;
const route: { viaje: Handler; gastos: Handler; categorias: Handler; devoluciones: Handler } = {
  viaje: () => ok(vista()),
  gastos: () => ok(GASTOS),
  categorias: () => ok(CATS),
  devoluciones: () => ok(DEVOLUCIONES),
};
function resetRoutes() {
  route.viaje = () => ok(vista());
  route.gastos = () => ok(GASTOS);
  route.categorias = () => ok(CATS);
  route.devoluciones = () => ok(DEVOLUCIONES);
}

function installResponder() {
  h.state.responder = (call: Call) => {
    const has = (m: string) => call.ops.some((o) => o.m === m);
    if (call.table === 'miembros' && has('maybeSingle')) return ok(MIEMBRO);
    if (call.table === 'categorias_gasto') return route.categorias(call);
    if (call.table === 'viajes') return route.viaje(call);
    if (call.table === 'gastos') return route.gastos(call);
    if (call.table === 'devoluciones') return route.devoluciones(call);
    throw new Error(`pedido inesperado: ${call.table} ${call.ops.map((o) => o.m).join('.')}`);
  };
}
const callsTo = (table: string) => h.calls.filter((c) => c.table === table);

// ---------------------------------------------------------------------------
// Arbol de prueba
// ---------------------------------------------------------------------------
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

/** Pantallas a las que lleva el detalle: muestran con que `state` se llego. */
function Destino({ nombre }: { nombre: string }) {
  const location = useLocation();
  return (
    <div id={`destino-${nombre}`} data-search={location.search} data-state={JSON.stringify(location.state ?? null)}>
      {nombre}
    </div>
  );
}
function Estado() {
  const location = useLocation();
  return <span id="estado" data-state={JSON.stringify(location.state ?? null)} data-pathname={location.pathname} />;
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

async function mount(entry: InitialEntry = `/viajes/${VIAJE_ID}`) {
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
                <Estado />
                <Routes>
                  <Route path="/viajes/:id" element={<ViajeDetallePage />} />
                  <Route path="/viajes/:id/editar" element={<Destino nombre="editar-viaje" />} />
                  <Route path="/viajes/:id/devoluciones/nueva" element={<Destino nombre="nueva-devolucion" />} />
                  <Route path="/viajes/:id/devoluciones/:devolucionId/editar" element={<Destino nombre="editar-devolucion" />} />
                  <Route path="/viajes" element={<Destino nombre="lista-de-viajes" />} />
                  <Route path="/gastos/nuevo" element={<Destino nombre="nuevo-gasto" />} />
                  <Route path="/gastos/:id/editar" element={<Destino nombre="editar-gasto" />} />
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
const links = () => [...document.querySelectorAll<HTMLAnchorElement>('a')];
const linkTo = (href: string) => links().filter((a) => a.getAttribute('href') === href);
const buttonByText = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes(text));
const nums = (n: number | null, decimales: number, fijos = true) => formatNumber(n, { decimales, fijos });
const section = (titulo: string) => [...document.querySelectorAll('section')].find((s) => s.querySelector('h2')?.textContent?.startsWith(titulo)) as HTMLElement;
const gastoItems = () => [...document.querySelectorAll<HTMLAnchorElement>('ul li a[href^="/gastos/"]')];
const stateOf = (el: Element) => JSON.parse((el as HTMLElement).dataset.state ?? 'null') as Record<string, unknown> | null;

async function click(el: HTMLElement | null | undefined) {
  if (!el) throw new Error('no se encontro el elemento a tocar');
  await act(async () => {
    el.click();
  });
  await settle(4);
}

beforeEach(() => {
  h.calls.length = 0;
  resetRoutes();
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
  // Ninguna prueba debe dejar warnings de React (act, anidamiento invalido de DOM, keys...).
  expect(errorSpy.mock.calls.map((c: unknown[]) => String(c[0]))).toEqual([]);
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Datos del viaje
// ---------------------------------------------------------------------------
describe('detalle de un viaje: los datos', () => {
  it('muestra origen → destino como titulo (la flecha es decorativa y el lector de pantalla oye "a"), fecha, km, ingreso y observaciones', async () => {
    await mount();
    const h1 = document.querySelector('h1')!;
    expect(h1.textContent).toContain('Rosario');
    expect(h1.textContent).toContain('Córdoba');
    expect(h1.querySelector('[aria-hidden="true"]')!.textContent).toBe('→');
    expect(h1.querySelector('.sr-only')!.textContent).toBe(' a ');

    const datos = section('Datos del viaje');
    expect(datos.textContent).toContain('15 jun 2025');
    expect(datos.textContent).toContain(`${nums(650.5, 1, false)} km`); // 1850,5 - 1200
    expect(datos.textContent).toContain(nums(15000.5, 2));
    expect(datos.textContent).toContain('Todo bien');
    expect(datos.textContent).toContain('Segunda línea');
  });

  it('con km recorridos muestra ese valor', async () => {
    route.viaje = () => ok(vista({ km_inicial: null, km_final: null, km_recorridos: 480 }));
    await mount();
    expect(section('Datos del viaje').textContent).toContain(`${nums(480, 1, false)} km`);
  });

  it('viaje en curso (solo el km inicial): "Km final sin cargar"', async () => {
    route.viaje = () => ok(vista({ km_final: null }));
    await mount();
    expect(section('Datos del viaje').textContent).toContain('Km final sin cargar');
    expect(section('Datos del viaje').textContent).not.toMatch(/\d km/);
  });

  it('sin km ni ingreso ni observaciones: "Sin cargar" y no aparece el bloque de observaciones', async () => {
    route.viaje = () => ok(vista({ km_inicial: null, km_final: null, km_recorridos: null, ingreso: null, observaciones: null }));
    await mount();
    const datos = section('Datos del viaje');
    expect(datos.textContent).toContain('Sin cargar');
    expect(datos.textContent).not.toContain('Observaciones');
    expect(datos.textContent).not.toContain(nums(0, 2));
  });

  it('un ingreso de 0 se muestra como 0 (no como "Sin cargar")', async () => {
    route.viaje = () => ok(vista({ ingreso: 0 }));
    await mount();
    expect(section('Datos del viaje').textContent).toContain(nums(0, 2));
  });

  it('el texto del viaje se muestra como texto (sin interpretar HTML)', async () => {
    route.viaje = () => ok(vista({ origen: '<img src=x onerror=alert(1)>', observaciones: '<script>alert(1)</script>' }));
    await mount();
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('script')).toBeNull();
    expect(bodyText()).toContain('<script>alert(1)</script>');
  });

  it('pide UNA consulta del viaje por id, con las entregas y su cliente embebidos, ordenadas por (created_at, id), con maybeSingle', async () => {
    await mount();
    const consultas = callsTo('viajes');
    expect(consultas).toHaveLength(1);
    const call = consultas[0]!;
    // Con el cliente_id de cada entrega: el formulario de devoluciones ofrece primero los clientes del viaje.
    expect(call.ops.find((o) => o.m === 'select')!.args[0]).toContain('entregas(id, cliente_id, incidencias, created_at, clientes(nombre))');
    expect(call.ops.find((o) => o.m === 'eq')!.args).toEqual(['id', VIAJE_ID]);
    expect(call.ops.filter((o) => o.m === 'order').map((o) => o.args)).toEqual([
      ['created_at', { ascending: true, referencedTable: 'entregas' }],
      ['id', { ascending: true, referencedTable: 'entregas' }],
    ]);
    expect(call.ops.some((o) => o.m === 'maybeSingle')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Entregas
// ---------------------------------------------------------------------------
describe('detalle de un viaje: las entregas', () => {
  it('en su orden de carga, con el nombre del cliente y las incidencias (solo donde las hay)', async () => {
    await mount();
    const entregas = section('Entregas');
    expect(entregas.querySelector('h2')!.textContent).toBe('Entregas (3)');
    const filas = [...entregas.querySelectorAll('li')];
    expect(filas).toHaveLength(3);
    expect(filas[0]!.textContent).toContain('Almacén Central');
    expect(filas[0]!.textContent).toContain('Incidencias: Golpe en un pallet');
    expect(filas[1]!.textContent).toContain('Frigorífico Sur');
    expect(filas[1]!.textContent).not.toContain('Incidencias');
    expect(filas[2]!.textContent).toContain('Distribuidora Norte');
    expect(filas[2]!.textContent).toContain('Incidencias: Llegó tarde');
  });

  it('sin entregas: lo dice', async () => {
    route.viaje = () => ok(vista({ entregas: [] }));
    await mount();
    expect(section('Entregas').textContent).toContain('Este viaje no tiene entregas cargadas.');
    expect(section('Entregas').querySelector('ul')).toBeNull();
  });

  it('una entrega cuyo cliente no vino no rompe la pantalla', async () => {
    route.viaje = () => ok(vista({ entregas: [{ id: E_1, incidencias: null, created_at: '2025-06-15T10:00:00.001Z', clientes: null }] }));
    await mount();
    expect(section('Entregas').textContent).toContain('Cliente');
  });
});

// ---------------------------------------------------------------------------
// Devoluciones del viaje
// ---------------------------------------------------------------------------
const devolucionItems = () => [...document.querySelectorAll<HTMLAnchorElement>('a[href*="/devoluciones/"][href$="/editar"]')];

describe('detalle de un viaje: las devoluciones', () => {
  it('la sección va ENTRE las entregas y los gastos, con su título "Devoluciones (N)"', async () => {
    await mount();
    const titulos = [...document.querySelectorAll('section h2')].map((e) => e.textContent);
    expect(titulos).toEqual(['Datos del viaje', 'Entregas (3)', 'Devoluciones (3)', 'Gastos del viaje']);
    const entregas = section('Entregas');
    const devoluciones = section('Devoluciones');
    const gastos = section('Gastos del viaje');
    const despues = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(despues(entregas, devoluciones)).toBe(true);
    expect(despues(devoluciones, gastos)).toBe(true);
    expect(devoluciones.getAttribute('aria-labelledby')).toBe('viaje-devoluciones-titulo');
  });

  it('muestra cada devolución con el cliente, el motivo en español y la descripción (cortada a 2 líneas), en el orden que llega (la más nueva primero)', async () => {
    await mount();
    const items = devolucionItems();
    expect(items).toHaveLength(3);
    expect(items[0]!.textContent).toContain('Distribuidora Norte');
    expect(items[0]!.textContent).toContain('Otro');
    expect(items[0]!.textContent).toContain('El cliente cerró antes de la hora');
    expect(items[1]!.textContent).toContain('Frigorífico Sur');
    expect(items[1]!.textContent).toContain('Vencimiento');
    expect(items[2]!.textContent).toContain('Almacén Central');
    expect(items[2]!.textContent).toContain('Mercadería incorrecta');
    expect(items[2]!.textContent).toContain('Cajas de otro pedido');
    const descripcion = [...items[0]!.querySelectorAll('p')].find((p) => p.textContent === 'El cliente cerró antes de la hora')!;
    expect(descripcion.className).toContain('line-clamp-2');
  });

  it('los cuatro motivos con su etiqueta exacta', async () => {
    route.devoluciones = () =>
      ok([
        devolucion(D_1, { motivo: 'rotura_danio' }),
        devolucion(D_2, { motivo: 'vencimiento' }),
        devolucion(D_3, { motivo: 'mercaderia_incorrecta' }),
        devolucion('f0000000-0000-4000-8000-000000000004', { motivo: 'otro' }),
      ]);
    await mount();
    const motivos = devolucionItems().map((a) => [...a.querySelectorAll('p')][1]!.textContent);
    expect(motivos).toEqual(['Rotura o daño', 'Vencimiento', 'Mercadería incorrecta', 'Otro']);
  });

  it('sin descripción no hay línea de descripción; sin el nombre del cliente (no vino) dice "Cliente"', async () => {
    route.devoluciones = () => ok([devolucion(D_1, { descripcion: null, clientes: null })]);
    await mount();
    const [item] = devolucionItems();
    expect(item!.querySelectorAll('p')).toHaveLength(2); // cliente y motivo
    expect(item!.textContent).toContain('Cliente');
  });

  it('con una sola devolución el título dice "Devoluciones (1)"', async () => {
    route.devoluciones = () => ok([devolucion(D_1)]);
    await mount();
    expect(section('Devoluciones').querySelector('h2')!.textContent).toBe('Devoluciones (1)');
  });

  it('sin devoluciones: "Este viaje no tiene devoluciones." y el título sin cantidad', async () => {
    route.devoluciones = () => ok([]);
    await mount();
    const devoluciones = section('Devoluciones');
    expect(devoluciones.querySelector('h2')!.textContent).toBe('Devoluciones');
    expect(devoluciones.textContent).toContain('Este viaje no tiene devoluciones.');
    expect(devolucionItems()).toHaveLength(0);
    expect(devoluciones.querySelector('ul')).toBeNull();
    expect(linkTo(`/viajes/${VIAJE_ID}/devoluciones/nueva`)).toHaveLength(1); // el botón sigue
  });

  it('cada devolución es un enlace a su edición (área táctil de 64 px) con el mes de la lista como ÚNICO dato en el state', async () => {
    await mount({ pathname: `/viajes/${VIAJE_ID}`, state: { volver: '?mes=2025-06' } });
    const primero = devolucionItems()[0]!;
    expect(primero.getAttribute('href')).toBe(`/viajes/${VIAJE_ID}/devoluciones/${D_3}/editar`);
    expect(primero.className).toContain('min-h-16');
    await click(primero);
    const destino = byId('destino-editar-devolucion')!;
    expect(destino).not.toBeNull();
    expect(stateOf(destino)).toEqual({ volver: '?mes=2025-06' });
  });

  it('si el detalle se abrió desde la pestaña Devoluciones, la edición sigue SIN marca de origen (solo el volver con la pestaña): al guardar vuelve al detalle', async () => {
    await mount({ pathname: `/viajes/${VIAJE_ID}`, state: { volver: '?vista=devoluciones&mes=2025-06' } });
    await click(devolucionItems()[0]!);
    expect(stateOf(byId('destino-editar-devolucion')!)).toEqual({ volver: '?vista=devoluciones&mes=2025-06' });
  });

  it('el enlace "Viajes" del detalle vuelve a la pestaña de la que se vino (pestaña y mes en el volver)', async () => {
    await mount({ pathname: `/viajes/${VIAJE_ID}`, state: { volver: '?vista=devoluciones&mes=2025-06' } });
    const viajes = [...document.querySelectorAll<HTMLAnchorElement>('a')].find((a) => a.textContent?.trim() === 'Viajes')!;
    expect(viajes.getAttribute('href')).toBe('/viajes?vista=devoluciones&mes=2025-06');
  });

  it('el texto de la devolución se muestra como texto (sin interpretar HTML)', async () => {
    route.devoluciones = () =>
      ok([devolucion(D_1, { descripcion: '<img src=x onerror=alert(1)><script>alert(1)</script>', clientes: { nombre: '<b>Cliente</b>' } })]);
    await mount();
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('script')).toBeNull();
    expect(section('Devoluciones').querySelector('b')).toBeNull();
    expect(bodyText()).toContain('<script>alert(1)</script>');
    expect(bodyText()).toContain('<b>Cliente</b>');
  });

  it('pide las devoluciones por viaje_id: created_at desc, id desc, 201 pedidas, con el cliente embebido, y con una key propia que cuelga de las de devoluciones', async () => {
    await mount();
    const consultas = callsTo('devoluciones');
    expect(consultas).toHaveLength(1);
    const call = consultas[0]!;
    expect(call.ops.find((o) => o.m === 'select')!.args[0]).toBe('id, motivo, descripcion, cliente_id, created_at, clientes(nombre)');
    expect(call.ops.find((o) => o.m === 'eq')!.args).toEqual(['viaje_id', VIAJE_ID]);
    expect(call.ops.filter((o) => o.m === 'order').map((o) => o.args)).toEqual([
      ['created_at', { ascending: false }],
      ['id', { ascending: false }],
    ]);
    expect(call.ops.find((o) => o.m === 'limit')!.args).toEqual([201]);
    expect(queryClient.getQueryCache().find({ queryKey: devolucionesKeys.delViaje('tenant-a', VIAJE_ID) })).toBeDefined();
    expect(callsTo('viajes')).toHaveLength(1); // las devoluciones no se piden dentro de la consulta del viaje
  });

  it('más de 200 devoluciones: se muestran 200 y se avisa; con exactamente 200, sin aviso', async () => {
    const muchas = (n: number) => Array.from({ length: n }, (_, i) => devolucion(`f0000000-0000-4000-8000-${String(i + 1000).padStart(12, '0')}`));
    route.devoluciones = () => ok(muchas(201));
    await mount();
    expect(devolucionItems()).toHaveLength(200);
    expect(bodyText()).toContain('Hay más de 200 devoluciones en este viaje. Se muestran las 200 más recientes.');
    expect(section('Devoluciones').querySelector('h2')!.textContent).toBe('Devoluciones (200+)');

    await act(async () => {
      root.unmount();
    });
    container.remove();
    queryClient.clear();
    route.devoluciones = () => ok(muchas(200));
    await mount();
    expect(devolucionItems()).toHaveLength(200);
    expect(bodyText()).not.toContain('Hay más de 200 devoluciones');
    expect(section('Devoluciones').querySelector('h2')!.textContent).toBe('Devoluciones (200)');
  }, 60_000);

  it('si fallan las devoluciones: error con "Reintentar" que vuelve a pedirlas; el resto del viaje se ve igual', async () => {
    let intento = 0;
    route.devoluciones = () => {
      intento += 1;
      return intento === 1 ? sinRed() : ok(DEVOLUCIONES);
    };
    await mount();
    expect(section('Datos del viaje').textContent).toContain('15 jun 2025');
    expect(gastoItems()).toHaveLength(3); // los gastos y las entregas no se enteran
    const devoluciones = section('Devoluciones');
    expect(devoluciones.textContent).toContain('No hay conexión');
    expect(devoluciones.textContent).not.toContain('Este viaje no tiene devoluciones.'); // un error NO es "vacío"
    expect(devolucionItems()).toHaveLength(0);
    await click([...devoluciones.querySelectorAll('button')].find((b) => b.textContent?.includes('Reintentar')));
    expect(devolucionItems()).toHaveLength(3);
    expect(bodyText()).not.toContain('No hay conexión');
  });

  it('con el error, el botón "Cargar devolución" sigue disponible', async () => {
    route.devoluciones = () => sinRed();
    await mount();
    expect(linkTo(`/viajes/${VIAJE_ID}/devoluciones/nueva`)).toHaveLength(1);
  });

  it('si ya había lista y un refresco falla: se sigue mostrando la lista, con el error y su "Reintentar" arriba', async () => {
    let cargas = 0;
    route.devoluciones = () => {
      cargas += 1;
      return cargas === 1 ? ok(DEVOLUCIONES) : sinRed();
    };
    await mount();
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: devolucionesKeys.delViaje('tenant-a', VIAJE_ID) });
    });
    await settle(4);
    expect(cargas).toBe(2);
    expect(devolucionItems()).toHaveLength(3); // la lista sigue a la vista
    const devoluciones = section('Devoluciones');
    expect(devoluciones.textContent).toContain('No hay conexión');
    expect([...devoluciones.querySelectorAll('button')].some((b) => b.textContent?.includes('Reintentar'))).toBe(true);
  });

  it('cualquier alta, edición o borrado de una devolución invalida la lista (la key cuelga de devolucionesKeys) y se actualiza', async () => {
    await mount();
    expect(devolucionItems()).toHaveLength(3);
    route.devoluciones = () => ok([devolucion(D_1)]);
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: devolucionesKeys.delosViajes('tenant-a') });
    });
    await settle(4);
    expect(callsTo('devoluciones')).toHaveLength(2);
    expect(devolucionItems()).toHaveLength(1);
    expect(section('Devoluciones').querySelector('h2')!.textContent).toBe('Devoluciones (1)');
  });

  it('mientras cargan, la sección muestra su esqueleto (sin "Este viaje no tiene devoluciones.")', async () => {
    route.devoluciones = () => new Promise<Resp>(() => {});
    await mount();
    expect(section('Devoluciones').querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(bodyText()).not.toContain('Este viaje no tiene devoluciones.');
  });
});

describe('detalle de un viaje: "Cargar devolución" (acción secundaria)', () => {
  it('lleva a /viajes/<id>/devoluciones/nueva con el mes como único dato en el state', async () => {
    await mount({ pathname: `/viajes/${VIAJE_ID}`, state: { volver: '?mes=2025-06' } });
    const cargar = linkTo(`/viajes/${VIAJE_ID}/devoluciones/nueva`);
    expect(cargar).toHaveLength(1);
    expect(cargar[0]!.textContent).toContain('Cargar devolución');
    await click(cargar[0]!);
    const destino = byId('destino-nueva-devolucion')!;
    expect(destino).not.toBeNull();
    expect(stateOf(destino)).toEqual({ volver: '?mes=2025-06' });
  });

  it('es SECUNDARIO (outline, no el color primario) y de al menos 48 px; está dentro de la sección de devoluciones', async () => {
    await mount();
    const [boton] = linkTo(`/viajes/${VIAJE_ID}/devoluciones/nueva`);
    expect(boton!.className).toContain('border'); // outline
    expect(boton!.className).not.toContain('bg-primary');
    expect(boton!.className).toContain('h-12'); // 48 px, no el de 56 del botón principal
    expect(boton!.className).not.toContain('h-14');
    expect(section('Devoluciones').contains(boton!)).toBe(true);
  });

  it('un volver raro en el state se sanea antes de pasarlo al formulario', async () => {
    await mount({ pathname: `/viajes/${VIAJE_ID}`, state: { volver: '//evil.com?mes=2025-06&x=<script>' } });
    await click(linkTo(`/viajes/${VIAJE_ID}/devoluciones/nueva`)[0]!);
    expect(stateOf(byId('destino-nueva-devolucion')!)).toEqual({ volver: '' });
  });

  it('la acción PRIMARIA sigue siendo "Cargar gasto de este viaje": única en el encabezado (desde md) y fija abajo en el celular; la devolución no la reemplaza', async () => {
    await mount();
    const raiz = container.querySelector('div.space-y-5')!;
    const ocultosEnCelular = [...raiz.querySelectorAll('.max-md\\:hidden')];
    expect(ocultosEnCelular).toHaveLength(1);
    expect(ocultosEnCelular[0]!.querySelector(`a[href="/gastos/nuevo?viaje=${VIAJE_ID}"]`)).not.toBeNull();
    expect(ocultosEnCelular[0]!.textContent).not.toContain('devolución');
    const ultimo = raiz.lastElementChild as HTMLElement; // la barra fija: ÚLTIMO hijo de la pantalla
    expect(ultimo.className).toContain('md:hidden');
    expect(ultimo.querySelector(`a[href="/gastos/nuevo?viaje=${VIAJE_ID}"]`)).not.toBeNull();
    expect(ultimo.querySelector(`a[href="/viajes/${VIAJE_ID}/devoluciones/nueva"]`)).toBeNull();
    expect(ultimo.textContent).not.toContain('Cargar devolución');
    // El primario conserva su tamaño (56 px) y su color.
    expect(ocultosEnCelular[0]!.querySelector('a')!.className).toContain('h-14');
    expect(ocultosEnCelular[0]!.querySelector('a')!.className).toContain('bg-primary');
  });

  it('sin viaje (no encontrado) no hay botón de devoluciones', async () => {
    route.viaje = () => ok(null);
    await mount();
    expect(bodyText()).not.toContain('Cargar devolución');
    expect(bodyText()).not.toContain('Devoluciones');
  });
});

// ---------------------------------------------------------------------------
// Gastos del viaje
// ---------------------------------------------------------------------------
describe('detalle de un viaje: los gastos', () => {
  it('lista los gastos del viaje con la categoria y el total sumado en CENTAVOS enteros', async () => {
    await mount();
    const gastos = section('Gastos del viaje');
    expect(gastos.textContent).toContain('Total de gastos del viaje');
    expect(gastos.textContent).toContain(nums(100.6, 2)); // no 100,60000000000001
    expect(gastos.textContent).toContain('3 gastos');
    const items = gastoItems();
    expect(items).toHaveLength(3);
    expect(items[0]!.textContent).toContain('Peajes');
    expect(items[1]!.textContent).toContain('Gastos varios');
    expect(items[1]!.textContent).toContain('Lavado del camión');
    expect(items[2]!.textContent).toContain('Combustible');
    expect(items[2]!.textContent).toContain(`${nums(40.5, 3, false)} L`);
  });

  it('los gastos no repiten el recorrido del viaje (ya es el titulo)', async () => {
    await mount();
    for (const item of gastoItems()) expect(item.textContent).not.toContain('Viaje:');
  });

  it('con un solo gasto dice "1 gasto"', async () => {
    route.gastos = () => ok([gasto(G_1, 250)]);
    await mount();
    const gastos = section('Gastos del viaje');
    expect(gastos.textContent).toContain('1 gasto');
    expect(gastos.textContent).not.toContain('1 gastos');
    expect(gastos.textContent).toContain(nums(250, 2));
  });

  it('pide los gastos por viaje_id: fecha desc, created_at desc, 501 pedidos, con una key que cuelga de las de gastos', async () => {
    await mount();
    const consultas = callsTo('gastos');
    expect(consultas).toHaveLength(1);
    const call = consultas[0]!;
    expect(call.ops.find((o) => o.m === 'eq')!.args).toEqual(['viaje_id', VIAJE_ID]);
    expect(call.ops.filter((o) => o.m === 'order').map((o) => o.args)).toEqual([
      ['fecha', { ascending: false }],
      ['created_at', { ascending: false }],
    ]);
    expect(call.ops.find((o) => o.m === 'limit')!.args).toEqual([501]);
    expect(call.ops.find((o) => o.m === 'select')!.args[0]).not.toContain('viajes('); // no hace falta el embed del viaje
    expect(queryClient.getQueryCache().find({ queryKey: gastosKeys.delViaje('tenant-a', VIAJE_ID) })).toBeDefined();
  });

  it('cada gasto es un enlace a su edicion, que vuelve a ESTE viaje (dato validado, no una ruta)', async () => {
    await mount({ pathname: `/viajes/${VIAJE_ID}`, state: { volver: '?mes=2025-06' } });
    const primero = gastoItems()[0]!;
    expect(primero.getAttribute('href')).toBe(`/gastos/${G_1}/editar`);
    expect(primero.className).toContain('min-h-16'); // area tactil de 64 px
    await click(primero);
    const destino = byId('destino-editar-gasto')!;
    expect(destino).not.toBeNull();
    expect(stateOf(destino)).toEqual({ desdeViaje: VIAJE_ID, volverViaje: '?mes=2025-06' });
  });

  it('sin gastos: lo dice, sin total', async () => {
    route.gastos = () => ok([]);
    await mount();
    expect(section('Gastos del viaje').textContent).toContain('Todavía no hay gastos cargados en este viaje.');
    expect(bodyText()).not.toContain('Total de gastos del viaje');
  });

  it('mas de 500 gastos: se muestran 500, el total solo suma esos y se avisa que es parcial', async () => {
    const muchos = Array.from({ length: 501 }, (_, i) => gasto(`e0000000-0000-4000-8000-${String(i + 1000).padStart(12, '0')}`, 1));
    route.gastos = () => ok(muchos);
    await mount();
    expect(gastoItems()).toHaveLength(500);
    expect(bodyText()).toContain('Hay más de 500 gastos en este viaje. Se muestran los 500 más recientes y el total solo suma esos.');
    expect(section('Gastos del viaje').textContent).toContain('500 gastos (los más recientes)');
    expect(section('Gastos del viaje').textContent).toContain(nums(500, 2)); // el 501 no suma
  }, 60_000);

  it('exactamente 500 gastos: sin aviso', async () => {
    const quinientos = Array.from({ length: 500 }, (_, i) => gasto(`e0000000-0000-4000-8000-${String(i + 1000).padStart(12, '0')}`, 1));
    route.gastos = () => ok(quinientos);
    await mount();
    expect(gastoItems()).toHaveLength(500);
    expect(bodyText()).not.toContain('Hay más de 500 gastos');
  }, 60_000);

  it('NO calcula un "resultado" (ingreso menos gastos): eso queda para el Resumen', async () => {
    await mount();
    const texto = bodyText().toLowerCase();
    for (const palabra of ['resultado', 'ganancia', 'balance', 'neto', 'margen']) expect(texto, palabra).not.toContain(palabra);
    // Ni la resta (15000,5 - 100,6 = 14899,9) aparece en pantalla.
    expect(bodyText()).not.toContain(nums(14899.9, 2));
  });

  it('si fallan los gastos: error con "Reintentar" que vuelve a pedirlos; el resto del viaje se ve igual', async () => {
    let intento = 0;
    route.gastos = () => {
      intento += 1;
      return intento === 1 ? sinRed() : ok(GASTOS);
    };
    await mount();
    expect(section('Datos del viaje').textContent).toContain('15 jun 2025');
    expect(section('Gastos del viaje').textContent).toContain('No hay conexión');
    expect(gastoItems()).toHaveLength(0);
    await click(buttonByText('Reintentar'));
    expect(gastoItems()).toHaveLength(3);
    expect(bodyText()).not.toContain('No hay conexión');
  });

  it('si fallan las categorias: los gastos se ven con nombre generico y un aviso con "Reintentar"', async () => {
    let intento = 0;
    route.categorias = () => {
      intento += 1;
      return intento === 1 ? sinRed() : ok(CATS);
    };
    await mount();
    expect(bodyText()).toContain('No pudimos cargar las categorías.');
    expect(gastoItems()[0]!.textContent).toContain('Gasto');
    await click(buttonByText('Reintentar'));
    expect(bodyText()).not.toContain('No pudimos cargar las categorías.');
    expect(gastoItems()[0]!.textContent).toContain('Peajes');
  });

  it('cualquier alta, edicion o borrado de un gasto invalida la lista (la key cuelga de gastosKeys.all) y el total se actualiza', async () => {
    await mount();
    expect(section('Gastos del viaje').textContent).toContain(nums(100.6, 2));
    route.gastos = () => ok([gasto(G_1, 0.1), gasto(G_2, 0.2), gasto(G_3, 100.3), gasto('e0000000-0000-4000-8000-000000000004', 50)]);
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: gastosKeys.all('tenant-a') });
    });
    await settle(4);
    expect(callsTo('gastos')).toHaveLength(2);
    expect(gastoItems()).toHaveLength(4);
    expect(section('Gastos del viaje').textContent).toContain(nums(150.6, 2));
  });
});

// ---------------------------------------------------------------------------
// Acciones
// ---------------------------------------------------------------------------
describe('detalle de un viaje: las acciones', () => {
  it('"Cargar gasto de este viaje" lleva a /gastos/nuevo?viaje=<id> con el viaje como DATO en el state (no una ruta) y el mes', async () => {
    await mount({ pathname: `/viajes/${VIAJE_ID}`, state: { volver: '?mes=2025-06' } });
    const cargar = linkTo(`/gastos/nuevo?viaje=${VIAJE_ID}`);
    expect(cargar.length).toBeGreaterThan(0);
    expect(cargar[0]!.textContent).toContain('Cargar gasto de este viaje');
    await click(cargar[0]!);
    const destino = byId('destino-nuevo-gasto')!;
    expect(destino.dataset.search).toBe(`?viaje=${VIAJE_ID}`);
    expect(stateOf(destino)).toEqual({ desdeViaje: VIAJE_ID, volverViaje: '?mes=2025-06' });
  });

  it('el boton principal se muestra UNA vez por ancho: en el encabezado solo desde md y fijo abajo solo en el celular', async () => {
    await mount();
    const raiz = container.querySelector('div.space-y-5')!;
    const ocultosEnCelular = [...raiz.querySelectorAll('.max-md\\:hidden')];
    expect(ocultosEnCelular).toHaveLength(1);
    expect(ocultosEnCelular[0]!.querySelector(`a[href="/gastos/nuevo?viaje=${VIAJE_ID}"]`)).not.toBeNull();
    const ultimo = raiz.lastElementChild as HTMLElement; // FixedActionBar: ULTIMO hijo de la pantalla
    expect(ultimo.className).toContain('md:hidden');
    expect(ultimo.querySelector(`a[href="/gastos/nuevo?viaje=${VIAJE_ID}"]`)).not.toBeNull();
    // Y es la accion primaria (boton grande, de 56 px).
    expect(ocultosEnCelular[0]!.querySelector('a')!.className).toContain('h-14');
  });

  it('"Editar viaje" (secundaria) lleva a /viajes/<id>/editar con el viaje y el mes como datos en el state', async () => {
    await mount({ pathname: `/viajes/${VIAJE_ID}`, state: { volver: '?mes=2025-06' } });
    const editar = linkTo(`/viajes/${VIAJE_ID}/editar`);
    expect(editar).toHaveLength(1);
    expect(editar[0]!.textContent).toContain('Editar viaje');
    expect(editar[0]!.className).toContain('border'); // outline: secundaria
    expect(editar[0]!.className).toContain('h-12'); // objetivo tactil de 48 px
    await click(editar[0]!);
    expect(stateOf(byId('destino-editar-viaje')!)).toEqual({ desdeViaje: VIAJE_ID, volverViaje: '?mes=2025-06' });
  });

  it('un volver raro en el state se sanea antes de pasarlo a los formularios', async () => {
    await mount({ pathname: `/viajes/${VIAJE_ID}`, state: { volver: '//evil.com?mes=2025-06&x=<script>' } });
    await click(linkTo(`/viajes/${VIAJE_ID}/editar`)[0]!);
    expect(stateOf(byId('destino-editar-viaje')!)).toEqual({ desdeViaje: VIAJE_ID, volverViaje: '' });
  });
});

// ---------------------------------------------------------------------------
// Volver
// ---------------------------------------------------------------------------
describe('detalle de un viaje: volver a la lista', () => {
  it('el enlace "Viajes" conserva el ?mes= (el mismo volver saneado de las demas pantallas)', async () => {
    await mount({ pathname: `/viajes/${VIAJE_ID}`, state: { volver: '?mes=2025-06' } });
    const volver = linkTo('/viajes?mes=2025-06');
    expect(volver).toHaveLength(1);
    expect(volver[0]!.textContent).toContain('Viajes');
    expect(volver[0]!.className).toContain('min-h-12');
  });

  it('sin volver, o con uno invalido, vuelve a /viajes (mes actual)', async () => {
    await mount();
    expect(linkTo('/viajes')).toHaveLength(1);
    await act(async () => {
      root.unmount();
    });
    container.remove();
    queryClient.clear();
    await mount({ pathname: `/viajes/${VIAJE_ID}`, state: { volver: 'https://evil.com' } });
    expect(linkTo('/viajes')).toHaveLength(1);
    expect(links().some((a) => (a.getAttribute('href') ?? '').includes('evil'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Estados
// ---------------------------------------------------------------------------
describe('detalle de un viaje: estados', () => {
  it('un id que no es uuid no consulta nada y muestra "Viaje no encontrado"', async () => {
    await mount('/viajes/no-es-un-uuid');
    expect(bodyText()).toContain('Viaje no encontrado');
    expect(h.calls.filter((c) => c.table === 'viajes' || c.table === 'gastos' || c.table === 'devoluciones')).toHaveLength(0);
    expect(linkTo('/viajes')).not.toHaveLength(0);
    expect(document.querySelector('h1')).not.toBeNull(); // la pantalla siempre tiene su titulo
  });

  it('un viaje que no existe (o es de otro transportista: la base no distingue) muestra "Viaje no encontrado", sin acciones', async () => {
    route.viaje = () => ok(null);
    await mount();
    expect(bodyText()).toContain('Viaje no encontrado');
    expect(bodyText()).not.toContain('Cargar gasto de este viaje');
    expect(bodyText()).not.toContain('Editar viaje');
    expect(container.querySelector('div.space-y-5')!.querySelector('.md\\:hidden')).toBeNull(); // sin barra fija
  });

  it('el "no encontrado" conserva el ?mes= en su enlace para volver', async () => {
    route.viaje = () => ok(null);
    await mount({ pathname: `/viajes/${VIAJE_ID}`, state: { volver: '?mes=2025-06' } });
    expect(linkTo('/viajes?mes=2025-06').length).toBeGreaterThan(0);
  });

  it('error de carga: mensaje en español con "Reintentar" que vuelve a pedir el viaje', async () => {
    let intento = 0;
    route.viaje = () => {
      intento += 1;
      return intento === 1 ? sinRed() : ok(vista());
    };
    await mount();
    expect(bodyText()).toContain('No hay conexión');
    expect(bodyText()).not.toContain('Viaje no encontrado');
    expect(bodyText()).not.toContain('Cargar gasto de este viaje');
    await click(buttonByText('Reintentar'));
    await settle(4);
    expect(section('Datos del viaje').textContent).toContain('15 jun 2025');
    expect(bodyText()).not.toContain('No hay conexión');
  });

  it('un refresco fallido con el viaje YA a la vista no lo reemplaza por el error ("Reintentar" solo si no hay datos)', async () => {
    let cargas = 0;
    route.viaje = () => {
      cargas += 1;
      return cargas === 1 ? ok(vista()) : sinRed();
    };
    await mount();
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: viajesKeys.vistas('tenant-a') });
    });
    await settle(4);
    expect(cargas).toBe(2);
    expect(section('Datos del viaje').textContent).toContain('15 jun 2025');
    expect(bodyText()).not.toContain('No hay conexión');
    expect(buttonByText('Reintentar')).toBeUndefined();
  });

  it('al volver a la pantalla (de editar el viaje o de cargar un gasto) se piden de nuevo el viaje y sus gastos: nunca una copia vieja', async () => {
    await mount();
    expect(callsTo('viajes')).toHaveLength(1);
    expect(callsTo('gastos')).toHaveLength(1);
    expect(callsTo('devoluciones')).toHaveLength(1);
    await act(async () => {
      root.unmount();
    });
    container.remove();
    await settle(2); // TanStack descarta una consulta sin observadores con gcTime 0 en el próximo turno
    expect(queryClient.getQueryCache().find({ queryKey: viajesKeys.vista('tenant-a', VIAJE_ID) })).toBeUndefined();
    expect(queryClient.getQueryCache().find({ queryKey: gastosKeys.delViaje('tenant-a', VIAJE_ID) })).toBeUndefined();
    expect(queryClient.getQueryCache().find({ queryKey: devolucionesKeys.delViaje('tenant-a', VIAJE_ID) })).toBeUndefined();
    route.viaje = () => ok(vista({ origen: 'San Lorenzo' }));
    await mount();
    expect(callsTo('viajes')).toHaveLength(2);
    expect(callsTo('gastos')).toHaveLength(2);
    expect(callsTo('devoluciones')).toHaveLength(2);
    expect(document.querySelector('h1')!.textContent).toContain('San Lorenzo');
  });

  it('mientras carga muestra el esqueleto y el titulo "Viaje"', async () => {
    route.viaje = () => new Promise<Resp>(() => {});
    await mount();
    expect(document.querySelector('h1')!.textContent).toBe('Viaje');
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(bodyText()).not.toContain('Cargar gasto de este viaje');
  });
});

// ---------------------------------------------------------------------------
// Avisos
// ---------------------------------------------------------------------------
describe('detalle de un viaje: aviso al volver de guardar o borrar', () => {
  for (const [aviso, mensaje] of [
    ['gasto-guardado', 'Gasto guardado.'],
    ['gasto-eliminado', 'Gasto eliminado.'],
    ['viaje-guardado', 'Viaje guardado.'],
    ['devolucion-guardada', 'Devolución guardada.'],
    ['devolucion-eliminada', 'Devolución eliminada.'],
  ] as const) {
    it(`"${mensaje}" con el aviso "${aviso}" del state`, async () => {
      await mount({ pathname: `/viajes/${VIAJE_ID}`, state: { aviso, volver: '?mes=2025-06' } });
      const caja = [...document.querySelectorAll('[role="status"]')].find((e) => e.textContent?.includes(mensaje));
      expect(caja, mensaje).toBeTruthy();
    });
  }

  it('se cierra con la X (objetivo de 48 px) y CONSERVA el ?mes= para el enlace "Viajes"', async () => {
    await mount({ pathname: `/viajes/${VIAJE_ID}`, state: { aviso: 'gasto-guardado', volver: '?mes=2025-06' } });
    const cerrar = document.querySelector<HTMLButtonElement>('button[aria-label="Cerrar aviso"]')!;
    expect(cerrar.className).toContain('h-12');
    await click(cerrar);
    expect(bodyText()).not.toContain('Gasto guardado.');
    expect(stateOf(byId('estado')!)).toEqual({ volver: '?mes=2025-06' });
    expect(linkTo('/viajes?mes=2025-06')).toHaveLength(1);
  });

  it('lista blanca: los avisos de las listas ("guardado") y cualquier otro valor no se muestran', async () => {
    for (const raro of ['guardado', 'eliminado', 'devolucion', 'devolucion-guardado', '<b>hack</b>', 'toString', 42, { x: 1 }]) {
      await mount({ pathname: `/viajes/${VIAJE_ID}`, state: { aviso: raro } });
      expect(bodyText(), JSON.stringify(raro)).not.toContain('hack');
      expect(bodyText(), JSON.stringify(raro)).not.toContain('guardado.');
      expect(bodyText(), JSON.stringify(raro)).not.toContain('eliminado.');
      await act(async () => {
        root.unmount();
      });
      container.remove();
      queryClient.clear();
    }
  });

  it('se cierra solo a los 5 segundos', async () => {
    const real = window.setTimeout.bind(window);
    let pendiente: (() => void) | null = null;
    vi.spyOn(window, 'setTimeout').mockImplementation(((fn: () => void, ms?: number, ...rest: unknown[]) => {
      if (ms === 5000) {
        pendiente = fn;
        return 12345 as never;
      }
      return real(fn, ms, ...(rest as []));
    }) as never);
    await mount({ pathname: `/viajes/${VIAJE_ID}`, state: { aviso: 'viaje-guardado' } });
    expect(bodyText()).toContain('Viaje guardado.');
    expect(pendiente).not.toBeNull();
    await act(async () => {
      pendiente!();
    });
    await settle(3);
    expect(bodyText()).not.toContain('Viaje guardado.');
  });
});
