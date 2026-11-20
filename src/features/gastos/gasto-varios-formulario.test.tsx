import { act, useMemo, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Link, MemoryRouter, Route, Routes, useLocation, type InitialEntry } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// «Nuevo gasto» con MÁS DE UNA categoría (cargar varios gastos de una vez). Mock de supabase: registra cada pedido y responde según la
// tabla. Todo lo demás es código REAL del proyecto (formulario, hooks, TanStack Query, router, validación). Los dos `vi.mock` de más
// abajo no cambian nada: solo dejan CONTAR los reinicios del envío y FORZAR un error del guardado del lote.
type Op = { m: string; args: unknown[] };
type Call = { target: string; ops: Op[] };

const h = vi.hoisted(() => {
  const calls: Array<{ target: string; ops: Array<{ m: string; args: unknown[] }> }> = [];
  const state = {
    responder: null as null | ((call: { target: string; ops: Array<{ m: string; args: unknown[] }> }) => unknown),
    /** Si está, reemplaza a `crearGastos` (para forzar `LoteDeGastosDistintoError`). Si no, corre el real. */
    crearGastosOverride: null as null | ((args: unknown) => Promise<unknown>),
    reinicios: 0,
  };
  function builder(target: string, firstOp?: { m: string; args: unknown[] }) {
    const call = { target, ops: firstOp ? [firstOp] : ([] as Array<{ m: string; args: unknown[] }>) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {};
    for (const m of ['select', 'update', 'insert', 'delete', 'eq', 'neq', 'is', 'not', 'abortSignal', 'order', 'limit', 'gte', 'lt', 'maybeSingle', 'single']) {
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
  return {
    calls,
    state,
    from: (table: string) => builder(table),
    rpc: (fn: string, args: unknown) => builder(`rpc:${fn}`, { m: 'rpc', args: [args] }),
  };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from: h.from, rpc: h.rpc } }));

vi.mock('@/features/gastos/gasto-lote-save', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/features/gastos/gasto-lote-save')>();
  return {
    ...original,
    crearGastos: (args: Parameters<typeof original.crearGastos>[0]) =>
      h.state.crearGastosOverride ? h.state.crearGastosOverride(args) : original.crearGastos(args),
  };
});

vi.mock('@/features/gastos/gasto-envio', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/features/gastos/gasto-envio')>();
  return {
    ...original,
    reiniciarEnvio: (...args: Parameters<typeof original.reiniciarEnvio>) => {
      h.state.reinicios += 1;
      return original.reiniciarEnvio(...args);
    },
  };
});

import { AuthContext, type AuthContextValue } from '@/features/auth/auth-context';
import { MemberProvider } from '@/features/member/member-provider';
import { RequireMember } from '@/app/guards';
import { GastoFormPage } from '@/features/gastos/gasto-form-page';
import { COMBUSTIBLE_CATEGORIA_ID, GASTOS_VARIOS_CATEGORIA_ID, MAX_GASTOS_POR_CARGA } from '@/features/gastos/constants';
import type { Categoria } from '@/features/gastos/categorias';
import { LoteDeGastosDistintoError } from '@/features/gastos/gasto-lote-errores';
import { LOTE_DISTINTO_MESSAGE, LOTE_NO_ENCONTRADO_MESSAGE } from '@/features/gastos/gasto-lote-textos';
import * as textosVarios from '@/features/gastos/gasto-varios-textos';
import { NETWORK_SAVE_ERROR_MESSAGE, TIMEOUT_ERROR_MESSAGE } from '@/lib/data-errors';
import { todayLocal } from '@/lib/dates';
import { formatNumber } from '@/lib/numbers';
import { queryClient } from '@/lib/query-client';
import { isUuid } from '@/lib/uuid';
import { CAMION_FALTA_MESSAGE, CAMIONES_SIN_CARGAR_MESSAGE } from '@/features/camiones/camion-seleccion';

type Resp = { data: unknown; count?: unknown; error: { message: string; code: string; details?: string; hint?: string } | null; status: number };
const ok = (data: unknown): Resp => ({ data, error: null, status: 200 });
const fail = (code: string, message: string, status = 400): Resp => ({ data: null, error: { code, message, details: '', hint: '' }, status });
const sinRed = (): Resp => ({ data: null, error: { code: '', message: 'TypeError: Failed to fetch' }, status: 0 });
const CLIENT_REF_DUPLICADO = (): Resp =>
  fail('23505', 'duplicate key value violates unique constraint "gastos_transportista_client_ref_uidx"', 409);

const PEAJES_ID = '210b4f00-fdb4-499b-bf15-79ebe2aaf3c3';
const LAVADO_ID = '210b4f00-fdb4-499b-bf15-79ebe2aaf3c4';
const BASE_CATS: Categoria[] = [
  { id: COMBUSTIBLE_CATEGORIA_ID, nombre: 'Combustible', activa: true, transportista_id: null },
  { id: GASTOS_VARIOS_CATEGORIA_ID, nombre: 'Gastos varios', activa: true, transportista_id: null },
  { id: PEAJES_ID, nombre: 'Peajes', activa: true, transportista_id: null },
  { id: LAVADO_ID, nombre: 'Lavado', activa: true, transportista_id: 'tenant-a' },
];
let CATS: Categoria[] = BASE_CATS;
const miembro = () => ({ rol: 'admin', tema: 'dark', color_acento: '#F59E0B', transportista_id: 'tenant-a', camion_activo_id: null, transportistas: { nombre: 'Transportes A' } });

const cid = (n: number) => `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
type Fila = { id: string; patente: string; marca: string | null; modelo: string | null; anio: number | null; activa: boolean };
const camion = (n: number, patente: string): Fila => ({ id: cid(n), patente, marca: null, modelo: null, anio: null, activa: true });
const CAM_A = camion(1, 'AB123CD');
const CAM_B = camion(2, 'ABC123');

const GASTO_ID = 'e0000000-0000-4000-8000-000000000001';
const vid = (n: number) => `b0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const viaje = (n: number, origen: string, camionId: string | null) => ({ id: vid(n), fecha: '2026-09-15', origen, destino: 'Córdoba', camion_id: camionId });
const V_PILAR = viaje(1, 'Pilar', null);
const V_CON_CAMION = viaje(2, 'Rosario', CAM_B.id);
const RECIENTES = [V_PILAR, V_CON_CAMION];

type Handler = (call: Call) => unknown;
const route: { camiones: Handler; opcion: Handler; detalle: Handler; insertar: Handler; actualizar: Handler } = {} as never;

function resetRoutes() {
  route.camiones = () => ok([CAM_A]);
  route.opcion = () => ok(null);
  route.detalle = () =>
    ok({
      id: GASTO_ID, categoria_id: PEAJES_ID, fecha: '2026-10-01', monto: 900, descripcion: null, metodo_pago: 'efectivo', litros: null,
      precio_por_litro: null, km_odometro: null, tanque_lleno: null, camion_id: null, viaje_id: null, viajes: null,
    });
  route.insertar = () => ok(null);
  route.actualizar = () => ok([{ id: GASTO_ID }]);
}

function installResponder() {
  h.state.responder = (call: Call) => {
    const has = (m: string) => call.ops.some((o) => o.m === m);
    if (call.target === 'miembros' && has('maybeSingle')) return ok(miembro());
    if (call.target === 'categorias_gasto') return ok(CATS);
    if (call.target === 'camiones') return route.camiones(call);
    if (call.target === 'viajes') return has('limit') ? ok(RECIENTES) : route.opcion(call);
    if (call.target === 'gastos') {
      if (has('insert')) return route.insertar(call);
      if (has('update')) return route.actualizar(call);
      return route.detalle(call);
    }
    throw new Error(`pedido inesperado: ${call.target} ${call.ops.map((o) => o.m).join('.')}`);
  };
}

const callsTo = (target: string) => h.calls.filter((c) => c.target === target);
const inserts = () => callsTo('gastos').filter((c) => c.ops.some((o) => o.m === 'insert'));
const updatesGasto = () => callsTo('gastos').filter((c) => c.ops.some((o) => o.m === 'update'));
const argOf = (call: Call, m: 'insert' | 'update') => call.ops.find((o) => o.m === m)!.args[0];
/** Lo que se mandó en el pedido de un INSERT de varios: una LISTA de filas. */
const filasDe = (call: Call) => argOf(call, 'insert') as Array<Record<string, unknown>>;
/** Lo que se mandó en el INSERT de UN solo gasto: una sola fila (no una lista). */
const filaDe = (call: Call) => argOf(call, 'insert') as Record<string, unknown>;
const clientRefsDe = (call: Call) => filasDe(call).map((fila) => fila.client_ref as string);
const refPorCategoria = (call: Call) => Object.fromEntries(filasDe(call).map((fila) => [fila.categoria_id as string, fila.client_ref as string]));

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

/** La lista de gastos de mentira: a dónde se navegó y con qué aviso (y cantidad). */
function ListaProbe() {
  const location = useLocation();
  const state = (location.state as { aviso?: string; cantidad?: unknown } | null) ?? {};
  return (
    <div id="lista-de-gastos" data-aviso={state.aviso ?? ''} data-cantidad={state.cantidad === undefined ? '' : String(state.cantidad)} data-search={location.search}>
      lista
    </div>
  );
}

/** El detalle del viaje de mentira. */
function DetalleProbe() {
  const location = useLocation();
  const state = (location.state as { aviso?: string; cantidad?: unknown; volver?: string } | null) ?? {};
  return (
    <div id="detalle-del-viaje" data-path={location.pathname} data-aviso={state.aviso ?? ''} data-cantidad={state.cantidad === undefined ? '' : String(state.cantidad)} data-volver={state.volver ?? ''}>
      detalle
    </div>
  );
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

async function mount(entry: InitialEntry = '/gastos/nuevo') {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <AuthHarness>
          <MemberProvider>
            <MemoryRouter initialEntries={[entry]}>
              {/* Un enlace vacío para irse de la pantalla mientras un guardado está en vuelo. */}
              <Link id="irse" to={`/viajes/${V_PILAR.id}`} aria-label="irse" />
              <RequireMember>
                <Routes>
                  <Route path="/gastos/nuevo" element={<GastoFormPage modo="nuevo" />} />
                  <Route path="/gastos/:id/editar" element={<GastoFormPage modo="editar" />} />
                  <Route path="/gastos" element={<ListaProbe />} />
                  <Route path="/viajes/:id" element={<DetalleProbe />} />
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

const byId = <T extends HTMLElement = HTMLElement>(elementId: string) => document.getElementById(elementId) as T | null;
const bodyText = () => document.body.textContent ?? '';
const buttons = () => [...document.querySelectorAll<HTMLButtonElement>('button')];
const buttonByText = (text: string) => buttons().find((b) => b.textContent?.includes(text));
const casilla = (categoriaId: string) => document.querySelector<HTMLInputElement>(`input[type="checkbox"][value="${categoriaId}"]`)!;
const casillas = () => [...document.querySelectorAll<HTMLInputElement>('fieldset input[type="checkbox"]')];
const marcadas = () => casillas().filter((c) => c.checked).map((c) => c.value);
/** ¿No se puede tocar? `:disabled` cuenta también el `fieldset` deshabilitado (la propiedad `disabled` de la casilla no). */
const apagada = (c: HTMLInputElement) => c.matches(':disabled');
const titulosDeBloques = () => [...document.querySelectorAll('form h2')].map((t) => t.textContent);
const antes = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
const anuncio = () => [...document.querySelectorAll('[role="status"]')].find((p) => p.textContent?.startsWith('Vas a guardar'))?.textContent ?? '';
const enfocado = () => document.activeElement?.id ?? '';

async function click(el: HTMLElement | null | undefined) {
  if (!el) throw new Error('no se encontró el elemento a tocar');
  await act(async () => {
    el.click();
  });
  await settle(4);
}
async function marcar(...categorias: string[]) {
  for (const id of categorias) await click(casilla(id));
}
async function typeText(el: HTMLInputElement | HTMLTextAreaElement | null, value: string) {
  if (!el) throw new Error('no se encontró el campo');
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function selectValue(el: HTMLSelectElement | null, value: string) {
  if (!el) throw new Error('no se encontró el selector');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await settle(3);
}
async function guardar(rotulo = 'Guardar gasto') {
  await click(buttons().find((b) => b.type === 'submit' && b.textContent === rotulo));
  await settle(4);
}
async function reintentar() {
  await click(buttonByText('Reintentar'));
  await settle(4);
}

/** Los ids de los campos de un bloque cuando hay varias categorías: llevan el id de la categoría. */
const monto = (categoriaId: string) => byId<HTMLInputElement>(`gasto-monto-${categoriaId}`);
const descripcion = (categoriaId: string) => byId<HTMLTextAreaElement>(`gasto-descripcion-${categoriaId}`);
const litros = (categoriaId: string) => byId<HTMLInputElement>(`gasto-litros-${categoriaId}`);
const metodo = (categoriaId: string) => byId<HTMLSelectElement>(`gasto-metodo-${categoriaId}`);

/** Llena el monto y el método de pago de UN bloque (con varias categorías marcadas). */
async function llenarBloque(categoriaId: string, valorMonto: string, valorMetodo = 'efectivo') {
  await typeText(monto(categoriaId), valorMonto);
  await selectValue(metodo(categoriaId), valorMetodo);
}
/** Lo mínimo para guardar Combustible + Peajes (con un solo camión activo, que se asigna solo). */
async function llenarCombustibleYPeajes() {
  await marcar(PEAJES_ID, COMBUSTIBLE_CATEGORIA_ID);
  await llenarBloque(COMBUSTIBLE_CATEGORIA_ID, '40000', 'tarjeta_credito');
  await typeText(litros(COMBUSTIBLE_CATEGORIA_ID), '40');
  await llenarBloque(PEAJES_ID, '800', 'efectivo');
}
/** Lo mínimo para guardar Peajes + Gastos varios. */
async function llenarPeajesYVarios() {
  await marcar(PEAJES_ID, GASTOS_VARIOS_CATEGORIA_ID);
  await llenarBloque(PEAJES_ID, '800', 'efectivo');
  await typeText(descripcion(GASTOS_VARIOS_CATEGORIA_ID), 'Lavado del camión');
  await llenarBloque(GASTOS_VARIOS_CATEGORIA_ID, '500', 'transferencia');
}

beforeEach(() => {
  h.calls.length = 0;
  h.state.crearGastosOverride = null;
  h.state.reinicios = 0;
  CATS = BASE_CATS;
  resetRoutes();
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

// ---------------------------------------------------------------------------
// El grupo de categorías
// ---------------------------------------------------------------------------
describe('alta: el grupo «Categoría» son casillas', () => {
  it('es un fieldset con la leyenda «Categoría», casillas nativas y NINGUNA marcada de entrada', async () => {
    await mount();
    const grupo = byId('gasto-categoria-0')!.closest('fieldset')!;
    expect(grupo.querySelector('legend')!.textContent).toBe('Categoría');
    expect(casillas()).toHaveLength(4);
    expect(document.querySelectorAll('fieldset input[type="radio"][id^="gasto-categoria"]')).toHaveLength(0);
    expect(marcadas()).toEqual([]);
  });

  it('dice que se puede marcar más de una y que cada una se guarda como un gasto', async () => {
    await mount();
    expect(bodyText()).toContain('Puedes marcar más de una: cada una se guarda como un gasto.');
    expect(byId('gasto-categoria-hint')!.textContent).toBe(textosVarios.AYUDA_VARIAS_CATEGORIAS);
  });

  it('las categorías van en el orden de siempre (Combustible primero y el resto por nombre) y la primera casilla es gasto-categoria-0', async () => {
    await mount();
    expect(casillas().map((c) => c.closest('label')!.textContent)).toEqual(['Combustible', 'Gastos varios', 'Lavado', 'Peajes']);
    expect(casillas()[0]!.id).toBe('gasto-categoria-0');
  });

  it('cada opción mide 56 px o más y tiene texto de 16 px o más', async () => {
    await mount();
    for (const c of casillas()) {
      expect(c.nextElementSibling!.className).toContain('min-h-14');
      expect(c.nextElementSibling!.className).toContain('text-base');
    }
  });

  it('con el tope de categorías por vez, las que faltan se apagan y se avisa; al desmarcar una vuelven', async () => {
    CATS = [
      ...BASE_CATS,
      ...Array.from({ length: 8 }, (_, i) => ({ id: `d0000000-0000-4000-8000-${String(i).padStart(12, '0')}`, nombre: `Otra ${i + 1}`, activa: true, transportista_id: 'tenant-a' })),
    ];
    await mount();
    expect(casillas()).toHaveLength(12);
    expect(MAX_GASTOS_POR_CARGA).toBe(10);
    for (const c of casillas().slice(0, MAX_GASTOS_POR_CARGA - 1)) await click(c);
    expect(casillas().every((c) => !apagada(c))).toBe(true);
    expect(bodyText()).not.toContain(textosVarios.AVISO_TOPE_DE_CATEGORIAS);
    await click(casillas()[MAX_GASTOS_POR_CARGA - 1]!);
    expect(marcadas()).toHaveLength(10);
    expect(casillas().filter(apagada)).toHaveLength(2); // las 2 que no se marcaron
    expect(casillas().filter(apagada).every((c) => !c.checked)).toBe(true);
    const aviso = [...document.querySelectorAll('p[role="status"]')].find((p) => p.textContent === textosVarios.AVISO_TOPE_DE_CATEGORIAS);
    expect(aviso).toBeTruthy();
    expect(buttonByText('Guardar 10 gastos')).toBeTruthy();
    // una desmarcada y vuelven las demás
    await click(casillas()[0]!);
    expect(casillas().every((c) => !apagada(c))).toBe(true);
    expect(bodyText()).not.toContain(textosVarios.AVISO_TOPE_DE_CATEGORIAS);
  });

  it('con el máximo de categorías marcadas (incluido Combustible) se guarda: UN solo pedido con las 10 filas', async () => {
    CATS = [
      ...BASE_CATS,
      ...Array.from({ length: 8 }, (_, i) => ({ id: `d0000000-0000-4000-8000-${String(i).padStart(12, '0')}`, nombre: `Otra ${i + 1}`, activa: true, transportista_id: 'tenant-a' })),
    ];
    await mount();
    const elegidas = casillas().slice(0, 10).map((c) => c.value);
    expect(elegidas).toContain(COMBUSTIBLE_CATEGORIA_ID);
    await marcar(...elegidas);
    for (const id of elegidas) {
      if (id === GASTOS_VARIOS_CATEGORIA_ID) await typeText(descripcion(id), 'algo');
      if (id === COMBUSTIBLE_CATEGORIA_ID) await typeText(litros(id), '10');
      await llenarBloque(id, '100');
    }
    await guardar('Guardar 10 gastos');
    expect(inserts()).toHaveLength(1);
    expect(filasDe(inserts()[0]!)).toHaveLength(10);
    expect(new Set(clientRefsDe(inserts()[0]!)).size).toBe(10);
    expect(new Set(filasDe(inserts()[0]!).map((fila) => fila.categoria_id)).size).toBe(10);
    expect(byId('lista-de-gastos')!.dataset.cantidad).toBe('10');
  });
});

// ---------------------------------------------------------------------------
// Con UNA categoría la pantalla es la de siempre
// ---------------------------------------------------------------------------
describe('alta con una categoría (o ninguna): la pantalla de siempre', () => {
  it('sin nada marcado: Categoría → Descripción → Monto → Fecha → Viaje → Método de pago, con los ids y rótulos de siempre', async () => {
    await mount();
    const orden = ['gasto-categoria-0', 'gasto-descripcion', 'gasto-monto', 'gasto-fecha', 'gasto-viaje', 'gasto-metodo'].map((id) => byId(id)!);
    expect(orden.every(Boolean)).toBe(true);
    for (let i = 0; i < orden.length - 1; i++) expect(antes(orden[i]!, orden[i + 1]!), `${orden[i]!.id} antes de ${orden[i + 1]!.id}`).toBe(true);
    expect(document.querySelector('label[for="gasto-metodo"]')!.textContent).toBe('Método de pago');
    expect(document.querySelector('label[for="gasto-monto"]')!.textContent).toBe('Monto');
    expect(document.querySelector('label[for="gasto-descripcion"]')!.textContent).toContain('Descripción');
    expect(titulosDeBloques()).toEqual([]);
    expect(buttonByText('Guardar gasto')).toBeTruthy();
  });

  it('con UNA categoría marcada es lo mismo: sin títulos de bloque, los mismos ids sin sufijo, el botón «Guardar gasto»', async () => {
    await mount();
    await marcar(PEAJES_ID);
    expect(titulosDeBloques()).toEqual([]);
    for (const id of ['gasto-descripcion', 'gasto-monto', 'gasto-fecha', 'gasto-viaje', 'gasto-metodo']) expect(byId(id), id).not.toBeNull();
    expect(document.querySelectorAll('input[id^="gasto-monto"]')).toHaveLength(1);
    expect(buttonByText('Guardar gasto')).toBeTruthy();
    expect(buttonByText('Guardar 1 gasto')).toBeUndefined();
  });

  it('con Combustible marcado solo, el recuadro de siempre con sus ids de siempre y el título «Combustible»', async () => {
    await mount();
    await marcar(COMBUSTIBLE_CATEGORIA_ID);
    for (const id of ['gasto-litros', 'gasto-km', 'gasto-tanque-0', 'gasto-camion-linea']) expect(byId(id), id).not.toBeNull();
    expect(bodyText()).toContain('Combustible');
    expect(bodyText()).not.toContain(textosVarios.TITULO_DATOS_DEL_COMBUSTIBLE);
    expect(bodyText()).toContain('Se agregaron los campos de combustible: litros, kilómetros del camión y tanque lleno.');
  });

  it('guardar UNA categoría va por el camino de siempre: UN pedido de UNA fila (no una lista), «Gasto guardado.»', async () => {
    await mount();
    await marcar(PEAJES_ID);
    await typeText(byId<HTMLInputElement>('gasto-monto'), '800');
    await selectValue(byId<HTMLSelectElement>('gasto-metodo'), 'efectivo');
    await guardar();
    expect(inserts()).toHaveLength(1);
    const fila = filaDe(inserts()[0]!);
    expect(Array.isArray(fila)).toBe(false);
    expect(fila).toMatchObject({ categoria_id: PEAJES_ID, monto: 800, metodo_pago: 'efectivo', camion_id: null, litros: null });
    expect(isUuid(fila.client_ref)).toBe(true);
    const lista = byId('lista-de-gastos')!;
    expect(lista.dataset.aviso).toBe('guardado');
    expect(lista.dataset.cantidad).toBe('');
  });

  it('sin ninguna categoría: «Elige una categoría.», el foco va al grupo y no se manda nada', async () => {
    await mount();
    await typeText(byId<HTMLInputElement>('gasto-monto'), '800');
    await selectValue(byId<HTMLSelectElement>('gasto-metodo'), 'efectivo');
    await guardar();
    expect(byId('gasto-categoria-error')!.textContent).toBe('Elige una categoría.');
    expect(enfocado()).toBe('gasto-categoria-0');
    expect(inserts()).toHaveLength(0);
    expect(casillas().every((c) => c.getAttribute('aria-invalid') === 'true')).toBe(true);
  });

  it('el error de «Elige una categoría.» se va al marcar una', async () => {
    await mount();
    await guardar();
    expect(bodyText()).toContain('Elige una categoría.');
    await marcar(PEAJES_ID);
    expect(bodyText()).not.toContain('Elige una categoría.');
  });

  it('cambiar de categoría (desmarcar una y marcar otra) CONSERVA lo escrito: monto, descripción y método de pago', async () => {
    await mount();
    await marcar(PEAJES_ID);
    await typeText(byId<HTMLInputElement>('gasto-monto'), '800');
    await typeText(byId<HTMLTextAreaElement>('gasto-descripcion'), 'Peaje de la ruta');
    await selectValue(byId<HTMLSelectElement>('gasto-metodo'), 'tarjeta_debito');
    await click(casilla(PEAJES_ID)); // sin ninguna marcada: sigue la misma pantalla
    expect(marcadas()).toEqual([]);
    expect(byId<HTMLInputElement>('gasto-monto')!.value).toBe('800');
    await click(casilla(LAVADO_ID));
    expect(byId<HTMLInputElement>('gasto-monto')!.value).toBe('800');
    expect(byId<HTMLTextAreaElement>('gasto-descripcion')!.value).toBe('Peaje de la ruta');
    expect(byId<HTMLSelectElement>('gasto-metodo')!.value).toBe('tarjeta_debito');
    await guardar();
    expect(filaDe(inserts()[0]!)).toMatchObject({ categoria_id: LAVADO_ID, monto: 800, descripcion: 'Peaje de la ruta', metodo_pago: 'tarjeta_debito' });
  });
});

// ---------------------------------------------------------------------------
// Con varias categorías
// ---------------------------------------------------------------------------
describe('alta con varias categorías: un bloque por categoría', () => {
  it('los bloques van en el orden de la LISTA de categorías, no en el de los toques', async () => {
    await mount();
    await marcar(PEAJES_ID, GASTOS_VARIOS_CATEGORIA_ID, COMBUSTIBLE_CATEGORIA_ID);
    expect(titulosDeBloques().slice(0, 3)).toEqual(['Combustible', 'Gastos varios', 'Peajes']);
    await marcar(LAVADO_ID);
    expect(titulosDeBloques().slice(0, 4)).toEqual(['Combustible', 'Gastos varios', 'Lavado', 'Peajes']);
  });

  it('cada bloque lleva su descripción y su monto con el id de SU categoría al final; los ids de un solo bloque ya no están', async () => {
    await mount();
    await marcar(PEAJES_ID, GASTOS_VARIOS_CATEGORIA_ID);
    for (const id of [PEAJES_ID, GASTOS_VARIOS_CATEGORIA_ID]) {
      expect(descripcion(id), id).not.toBeNull();
      expect(monto(id), id).not.toBeNull();
      expect(metodo(id), id).not.toBeNull();
    }
    for (const sinSufijo of ['gasto-descripcion', 'gasto-monto', 'gasto-metodo']) expect(byId(sinSufijo), sinSufijo).toBeNull();
    // cada bloque es un grupo con su título
    const grupo = monto(PEAJES_ID)!.closest('[role="group"]')!;
    expect(document.getElementById(grupo.getAttribute('aria-labelledby')!)!.textContent).toBe('Peajes');
  });

  it('la fecha y el viaje aparecen UNA sola vez y con sus ids de siempre', async () => {
    await mount();
    await marcar(PEAJES_ID, GASTOS_VARIOS_CATEGORIA_ID, COMBUSTIBLE_CATEGORIA_ID);
    expect(document.querySelectorAll('input[type="date"]')).toHaveLength(1);
    expect(byId('gasto-fecha')).not.toBeNull();
    expect(document.querySelectorAll('select#gasto-viaje')).toHaveLength(1);
    expect(document.querySelectorAll('label[for^="gasto-fecha"]')).toHaveLength(1);
    expect(document.querySelectorAll('label[for^="gasto-viaje"]')).toHaveLength(1);
  });

  it('el orden en pantalla: los bloques, después la fecha y el viaje, y al final el método de pago de cada gasto', async () => {
    await mount();
    await marcar(PEAJES_ID, COMBUSTIBLE_CATEGORIA_ID);
    const orden = [
      byId('gasto-categoria-0')!,
      monto(COMBUSTIBLE_CATEGORIA_ID)!,
      monto(PEAJES_ID)!,
      byId('gasto-fecha')!,
      byId('gasto-viaje')!,
      metodo(COMBUSTIBLE_CATEGORIA_ID)!,
      metodo(PEAJES_ID)!,
    ];
    for (let i = 0; i < orden.length - 1; i++) expect(antes(orden[i]!, orden[i + 1]!), `${orden[i]!.id} antes de ${orden[i + 1]!.id}`).toBe(true);
  });

  it('los métodos de pago van juntos abajo, uno por gasto, rotulados con el nombre de su categoría y sin valor por defecto', async () => {
    await mount();
    await marcar(PEAJES_ID, COMBUSTIBLE_CATEGORIA_ID);
    expect(document.querySelector('label[for="gasto-metodo-' + COMBUSTIBLE_CATEGORIA_ID + '"]')!.textContent).toBe('Método de pago de Combustible');
    expect(document.querySelector('label[for="gasto-metodo-' + PEAJES_ID + '"]')!.textContent).toBe('Método de pago de Peajes');
    expect(metodo(PEAJES_ID)!.value).toBe('');
    expect(metodo(PEAJES_ID)!.getAttribute('aria-required')).toBe('true');
    expect(titulosDeBloques()).toContain('¿Cómo pagaste cada gasto?');
  });

  it('el botón dice «Guardar N gastos» (a todo el ancho) y con una sola vuelve a «Guardar gasto»', async () => {
    await mount();
    await marcar(PEAJES_ID, COMBUSTIBLE_CATEGORIA_ID);
    expect(buttonByText('Guardar 2 gastos')).toBeTruthy();
    expect(buttonByText('Guardar gasto')).toBeUndefined();
    expect(buttonByText('Guardar 2 gastos')!.className).toContain('w-full');
    await marcar(GASTOS_VARIOS_CATEGORIA_ID);
    expect(buttonByText('Guardar 3 gastos')).toBeTruthy();
    await marcar(GASTOS_VARIOS_CATEGORIA_ID, COMBUSTIBLE_CATEGORIA_ID);
    expect(buttonByText('Guardar gasto')).toBeTruthy();
    expect(titulosDeBloques()).toEqual([]);
    expect(byId('gasto-monto')).not.toBeNull(); // los ids de un solo bloque vuelven
    expect(byId(`gasto-monto-${PEAJES_ID}`)).toBeNull();
  });

  it('una región role="status" anuncia cuántos gastos se van a guardar y de qué categorías, al marcar y al desmarcar', async () => {
    await mount();
    expect(anuncio()).toBe('');
    await marcar(PEAJES_ID);
    expect(anuncio()).toBe('Vas a guardar 1 gasto: Peajes.');
    await marcar(COMBUSTIBLE_CATEGORIA_ID);
    expect(anuncio()).toBe('Vas a guardar 2 gastos: Combustible y Peajes.');
    await marcar(GASTOS_VARIOS_CATEGORIA_ID);
    expect(anuncio()).toBe('Vas a guardar 3 gastos: Combustible, Gastos varios y Peajes.');
    await marcar(GASTOS_VARIOS_CATEGORIA_ID);
    expect(anuncio()).toBe('Vas a guardar 2 gastos: Combustible y Peajes.');
    const region = [...document.querySelectorAll('[role="status"]')].find((p) => p.textContent?.startsWith('Vas a guardar'))!;
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.className).toContain('sr-only');
  });

  it('lo escrito en un bloque no pasa a otro, y desmarcar una categoría y volver a marcarla recupera lo suyo', async () => {
    await mount();
    await marcar(PEAJES_ID, LAVADO_ID);
    await typeText(monto(PEAJES_ID), '800');
    await typeText(monto(LAVADO_ID), '300');
    await selectValue(metodo(LAVADO_ID), 'transferencia');
    expect(monto(PEAJES_ID)!.value).toBe('800');
    expect(monto(LAVADO_ID)!.value).toBe('300');
    expect(metodo(PEAJES_ID)!.value).toBe('');
    await click(casilla(LAVADO_ID));
    expect(monto(LAVADO_ID)).toBeNull();
    expect(byId<HTMLInputElement>('gasto-monto')!.value).toBe('800'); // quedó uno solo: la pantalla de siempre, con lo de Peajes
    await click(casilla(LAVADO_ID));
    expect(monto(LAVADO_ID)!.value).toBe('300');
    expect(metodo(LAVADO_ID)!.value).toBe('transferencia');
    expect(monto(PEAJES_ID)!.value).toBe('800');
  });

  it('Combustible: su recuadro con el título «Datos del combustible», sus ids con el sufijo y el aviso para lectores de pantalla', async () => {
    await mount();
    await marcar(PEAJES_ID, COMBUSTIBLE_CATEGORIA_ID);
    const conSufijo = [
      `gasto-litros-${COMBUSTIBLE_CATEGORIA_ID}`,
      `gasto-km-${COMBUSTIBLE_CATEGORIA_ID}`,
      `gasto-tanque-${COMBUSTIBLE_CATEGORIA_ID}-0`,
      `gasto-camion-${COMBUSTIBLE_CATEGORIA_ID}-linea`,
    ];
    for (const id of conSufijo) expect(byId(id), id).not.toBeNull();
    for (const id of ['gasto-litros', 'gasto-km', 'gasto-tanque-0', 'gasto-camion-linea']) expect(byId(id), `${id} sin sufijo`).toBeNull();
    expect(bodyText()).toContain(textosVarios.TITULO_DATOS_DEL_COMBUSTIBLE);
    expect(bodyText()).toContain('Se agregaron los campos de combustible: litros, kilómetros del camión y tanque lleno.');
    // el recuadro está dentro del bloque de Combustible y no en el de Peajes
    expect(litros(COMBUSTIBLE_CATEGORIA_ID)!.closest('[role="group"]')).toBe(monto(COMBUSTIBLE_CATEGORIA_ID)!.closest('[role="group"]'));
    expect(litros(PEAJES_ID)).toBeNull();
  });

  it('«Sale a … el litro» se calcula con el monto y los litros del bloque de Combustible', async () => {
    await mount();
    await marcar(PEAJES_ID, COMBUSTIBLE_CATEGORIA_ID);
    await typeText(monto(COMBUSTIBLE_CATEGORIA_ID), '40000');
    await typeText(monto(PEAJES_ID), '5');
    await typeText(litros(COMBUSTIBLE_CATEGORIA_ID), '40');
    expect(bodyText()).toContain(`Sale a ${formatNumber(1000, { decimales: 2 })} el litro`);
  });

  it('«Gastos varios»: SU descripción es obligatoria (sin «(opcional)» y con su ayuda) y la de los demás sigue opcional', async () => {
    await mount();
    await marcar(PEAJES_ID, GASTOS_VARIOS_CATEGORIA_ID);
    expect(document.querySelector(`label[for="gasto-descripcion-${GASTOS_VARIOS_CATEGORIA_ID}"]`)!.textContent).toBe('Descripción');
    expect(descripcion(GASTOS_VARIOS_CATEGORIA_ID)!.getAttribute('aria-required')).toBe('true');
    expect(document.querySelector(`label[for="gasto-descripcion-${PEAJES_ID}"]`)!.textContent).toContain('(opcional)');
    expect(bodyText().match(/Obligatoria en Gastos varios/g)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Errores
// ---------------------------------------------------------------------------
describe('alta con varias categorías: errores por bloque y foco', () => {
  it('cada error aparece en SU bloque y no se manda nada', async () => {
    await mount();
    await marcar(PEAJES_ID, GASTOS_VARIOS_CATEGORIA_ID);
    await llenarBloque(PEAJES_ID, '800');
    await guardar('Guardar 2 gastos');
    expect(inserts()).toHaveLength(0);
    // Peajes está bien; Gastos varios: sin descripción, sin monto y sin método
    expect(byId(`gasto-monto-${GASTOS_VARIOS_CATEGORIA_ID}-error`)!.textContent).not.toBe('');
    expect(byId(`gasto-descripcion-${GASTOS_VARIOS_CATEGORIA_ID}-error`)!.textContent).toBe('Escribe de qué se trata este gasto.');
    expect(byId(`gasto-metodo-${GASTOS_VARIOS_CATEGORIA_ID}-error`)!.textContent).toBe('Elige cómo pagaste.');
    expect(byId(`gasto-monto-${PEAJES_ID}-error`)!.textContent).toBe('');
    expect(byId(`gasto-metodo-${PEAJES_ID}-error`)!.textContent).toBe('');
    expect(monto(GASTOS_VARIOS_CATEGORIA_ID)!.getAttribute('aria-invalid')).toBe('true');
    expect(monto(PEAJES_ID)!.getAttribute('aria-invalid')).toBeNull();
  });

  it('el foco va al PRIMER error en el orden en que se ve la pantalla: el monto de un bloque antes que el método de pago de uno anterior', async () => {
    await mount();
    await marcar(PEAJES_ID, COMBUSTIBLE_CATEGORIA_ID);
    // Combustible: monto y litros bien, SIN método. Peajes: sin monto y sin método.
    await typeText(monto(COMBUSTIBLE_CATEGORIA_ID), '40000');
    await typeText(litros(COMBUSTIBLE_CATEGORIA_ID), '40');
    await guardar('Guardar 2 gastos');
    expect(inserts()).toHaveLength(0);
    // La validación del lote señalaría el método de Combustible (el primer bloque); en pantalla el monto de Peajes se ve antes.
    expect(enfocado()).toBe(`gasto-monto-${PEAJES_ID}`);
  });

  it('con un solo error de método de pago, el foco va a ese método (abajo de todo)', async () => {
    await mount();
    await marcar(PEAJES_ID, GASTOS_VARIOS_CATEGORIA_ID);
    await typeText(monto(PEAJES_ID), '800');
    await typeText(monto(GASTOS_VARIOS_CATEGORIA_ID), '500');
    await typeText(descripcion(GASTOS_VARIOS_CATEGORIA_ID), 'Lavado');
    await selectValue(metodo(GASTOS_VARIOS_CATEGORIA_ID), 'efectivo');
    await guardar('Guardar 2 gastos');
    expect(enfocado()).toBe(`gasto-metodo-${PEAJES_ID}`);
  });

  it('un error de la descripción de «Gastos varios» (que está antes que su monto) lleva el foco a la descripción', async () => {
    await mount();
    await marcar(PEAJES_ID, GASTOS_VARIOS_CATEGORIA_ID);
    await llenarBloque(PEAJES_ID, '800');
    await typeText(monto(GASTOS_VARIOS_CATEGORIA_ID), '500');
    await selectValue(metodo(GASTOS_VARIOS_CATEGORIA_ID), 'efectivo');
    await guardar('Guardar 2 gastos');
    expect(enfocado()).toBe(`gasto-descripcion-${GASTOS_VARIOS_CATEGORIA_ID}`);
  });

  it('corregir un campo saca SU error y no los de los demás bloques', async () => {
    await mount();
    await marcar(PEAJES_ID, LAVADO_ID);
    await guardar('Guardar 2 gastos');
    expect(byId(`gasto-monto-${PEAJES_ID}-error`)!.textContent).not.toBe('');
    expect(byId(`gasto-monto-${LAVADO_ID}-error`)!.textContent).not.toBe('');
    await typeText(monto(PEAJES_ID), '800');
    expect(byId(`gasto-monto-${PEAJES_ID}-error`)!.textContent).toBe('');
    expect(byId(`gasto-monto-${LAVADO_ID}-error`)!.textContent).not.toBe('');
    await selectValue(metodo(LAVADO_ID), 'efectivo');
    expect(byId(`gasto-metodo-${LAVADO_ID}-error`)!.textContent).toBe('');
    expect(byId(`gasto-metodo-${PEAJES_ID}-error`)!.textContent).not.toBe('');
  });

  it('un error de la fecha se muestra UNA sola vez (es de toda la carga) y lleva el foco a la fecha', async () => {
    await mount();
    await llenarPeajesYVarios();
    const manana = new Date();
    manana.setDate(manana.getDate() + 2);
    const futura = `${manana.getFullYear()}-${String(manana.getMonth() + 1).padStart(2, '0')}-${String(manana.getDate()).padStart(2, '0')}`;
    await typeText(byId<HTMLInputElement>('gasto-fecha'), futura);
    await guardar('Guardar 2 gastos');
    expect(inserts()).toHaveLength(0);
    const mensaje = byId('gasto-fecha-error')!.textContent!;
    expect(mensaje).not.toBe('');
    expect(bodyText().split(mensaje)).toHaveLength(2); // el mensaje aparece UNA sola vez en toda la pantalla
    expect(enfocado()).toBe('gasto-fecha');
  });

  it('Combustible con dos camiones y ninguno elegido: el error está en su bloque y el foco va a las opciones del camión', async () => {
    route.camiones = () => ok([CAM_A, CAM_B]);
    await mount();
    await llenarCombustibleYPeajes();
    await guardar('Guardar 2 gastos');
    expect(inserts()).toHaveLength(0);
    expect(byId(`gasto-camion-${COMBUSTIBLE_CATEGORIA_ID}-error`)!.textContent).toBe(CAMION_FALTA_MESSAGE);
    expect(enfocado()).toBe(`gasto-camion-${COMBUSTIBLE_CATEGORIA_ID}-0`);
  });

  it('Combustible con la lista de camiones sin cargar: no se guarda NADA (ni lo de las otras categorías) y se explica en su bloque', async () => {
    route.camiones = () => sinRed();
    await mount();
    await llenarCombustibleYPeajes();
    await guardar('Guardar 2 gastos');
    expect(inserts()).toHaveLength(0);
    expect(byId(`gasto-camion-${COMBUSTIBLE_CATEGORIA_ID}-error`)!.textContent).toBe(CAMIONES_SIN_CARGAR_MESSAGE);
    expect(enfocado()).toBe(`gasto-camion-${COMBUSTIBLE_CATEGORIA_ID}-bloque`);
  });

  it('un error no deja las categorías bloqueadas: nunca se intentó guardar', async () => {
    await mount();
    await marcar(PEAJES_ID, LAVADO_ID);
    await guardar('Guardar 2 gastos');
    expect(casillas().every((c) => !apagada(c))).toBe(true);
    expect(buttonByText(textosVarios.EMPEZAR_DE_NUEVO)).toBeUndefined();
    expect(bodyText()).not.toContain(textosVarios.AVISO_CATEGORIAS_FIJAS);
  });
});

// ---------------------------------------------------------------------------
// Guardado
// ---------------------------------------------------------------------------
describe('alta con varias categorías: guardado', () => {
  it('UN solo pedido con las N filas, cada una con SUS datos, y nada que lo decida la base: sin transportista_id, id ni fechas de registro', async () => {
    await mount();
    await llenarCombustibleYPeajes();
    await guardar('Guardar 2 gastos');
    expect(inserts()).toHaveLength(1);
    expect(updatesGasto()).toHaveLength(0);
    const filas = filasDe(inserts()[0]!);
    expect(Array.isArray(argOf(inserts()[0]!, 'insert'))).toBe(true);
    expect(filas).toHaveLength(2);
    const porCategoria = Object.fromEntries(filas.map((fila) => [fila.categoria_id as string, fila]));
    expect(porCategoria[COMBUSTIBLE_CATEGORIA_ID]).toMatchObject({
      monto: 40000, metodo_pago: 'tarjeta_credito', litros: 40, precio_por_litro: 1000, camion_id: CAM_A.id, viaje_id: null, descripcion: null,
    });
    expect(porCategoria[PEAJES_ID]).toMatchObject({ monto: 800, metodo_pago: 'efectivo', litros: null, precio_por_litro: null, camion_id: null, viaje_id: null, tanque_lleno: null, km_odometro: null });
    for (const fila of filas) {
      for (const prohibida of ['transportista_id', 'id', 'created_at', 'updated_at']) expect(fila, prohibida).not.toHaveProperty(prohibida);
      expect(fila.fecha).toBe(todayLocal());
    }
  });

  it('cada fila lleva SU clave de idempotencia: uuid, distintas entre sí', async () => {
    await mount();
    await llenarPeajesYVarios();
    await guardar('Guardar 2 gastos');
    const refs = clientRefsDe(inserts()[0]!);
    expect(refs).toHaveLength(2);
    expect(refs.every((ref) => isUuid(ref))).toBe(true);
    expect(new Set(refs).size).toBe(2);
  });

  it('el método de pago es POR gasto: cada fila lleva el suyo', async () => {
    await mount();
    await llenarPeajesYVarios();
    await guardar('Guardar 2 gastos');
    const porCategoria = Object.fromEntries(filasDe(inserts()[0]!).map((fila) => [fila.categoria_id as string, fila]));
    expect(porCategoria[PEAJES_ID]!.metodo_pago).toBe('efectivo');
    expect(porCategoria[GASTOS_VARIOS_CATEGORIA_ID]!.metodo_pago).toBe('transferencia');
  });

  it('la descripción de «Gastos varios» se guarda recortada y la de Peajes (vacía) va en null', async () => {
    await mount();
    await marcar(PEAJES_ID, GASTOS_VARIOS_CATEGORIA_ID);
    await llenarBloque(PEAJES_ID, '800');
    await typeText(descripcion(GASTOS_VARIOS_CATEGORIA_ID), '  Lavado del camión  ');
    await llenarBloque(GASTOS_VARIOS_CATEGORIA_ID, '500');
    await guardar('Guardar 2 gastos');
    const porCategoria = Object.fromEntries(filasDe(inserts()[0]!).map((fila) => [fila.categoria_id as string, fila]));
    expect(porCategoria[GASTOS_VARIOS_CATEGORIA_ID]!.descripcion).toBe('Lavado del camión');
    expect(porCategoria[PEAJES_ID]!.descripcion).toBeNull();
  });

  it('la fecha y el viaje son los mismos para todos los gastos', async () => {
    await mount();
    await llenarPeajesYVarios();
    await selectValue(byId<HTMLSelectElement>('gasto-viaje'), V_PILAR.id);
    await typeText(byId<HTMLInputElement>('gasto-fecha'), '2026-09-20');
    await guardar('Guardar 2 gastos');
    const filas = filasDe(inserts()[0]!);
    expect(filas.map((fila) => fila.viaje_id)).toEqual([V_PILAR.id, V_PILAR.id]);
    expect(filas.map((fila) => fila.fecha)).toEqual(['2026-09-20', '2026-09-20']);
  });

  it('Combustible lleva el camión: con un camión activo, ese; con un viaje que tiene camión, el del viaje (y las demás categorías, sin camión)', async () => {
    route.camiones = () => ok([CAM_A, CAM_B]);
    await mount();
    await llenarCombustibleYPeajes();
    await selectValue(byId<HTMLSelectElement>('gasto-viaje'), V_CON_CAMION.id);
    expect(bodyText()).toContain('Camión del viaje: ABC 123');
    await guardar('Guardar 2 gastos');
    const porCategoria = Object.fromEntries(filasDe(inserts()[0]!).map((fila) => [fila.categoria_id as string, fila]));
    expect(porCategoria[COMBUSTIBLE_CATEGORIA_ID]).toMatchObject({ camion_id: CAM_B.id, viaje_id: V_CON_CAMION.id });
    expect(porCategoria[PEAJES_ID]).toMatchObject({ camion_id: null, viaje_id: V_CON_CAMION.id });
  });

  it('Combustible con dos camiones, elegido uno: ese camión va en su fila', async () => {
    route.camiones = () => ok([CAM_A, CAM_B]);
    await mount();
    await llenarCombustibleYPeajes();
    await click(byId(`gasto-camion-${COMBUSTIBLE_CATEGORIA_ID}-1`)); // las opciones van por patente: la segunda es «ABC 123»
    await guardar('Guardar 2 gastos');
    const porCategoria = Object.fromEntries(filasDe(inserts()[0]!).map((fila) => [fila.categoria_id as string, fila]));
    expect(porCategoria[COMBUSTIBLE_CATEGORIA_ID]!.camion_id).toBe(CAM_B.id);
  });

  it('con el viaje que llega preseleccionado por ?viaje= ambos gastos van a ese viaje', async () => {
    route.opcion = () => ok(V_PILAR);
    await mount(`/gastos/nuevo?viaje=${V_PILAR.id}`);
    expect(byId<HTMLSelectElement>('gasto-viaje')!.value).toBe(V_PILAR.id);
    await llenarPeajesYVarios();
    await guardar('Guardar 2 gastos');
    expect(filasDe(inserts()[0]!).map((fila) => fila.viaje_id)).toEqual([V_PILAR.id, V_PILAR.id]);
  });

  it('al guardar vuelve a la lista de Gastos con el aviso «guardados» y la cantidad', async () => {
    await mount();
    await llenarPeajesYVarios();
    await guardar('Guardar 2 gastos');
    const lista = byId('lista-de-gastos')!;
    expect(lista).not.toBeNull();
    expect(lista.dataset.aviso).toBe('guardados');
    expect(lista.dataset.cantidad).toBe('2');
  });

  it('vuelve a la lista en el MES de la fecha de los gastos', async () => {
    await mount();
    await llenarPeajesYVarios();
    await typeText(byId<HTMLInputElement>('gasto-fecha'), '2026-03-10');
    await guardar('Guardar 2 gastos');
    expect(byId('lista-de-gastos')!.dataset.search).toContain('mes=2026-03');
  });

  it('abierto desde el detalle de un viaje: vuelve a ESE viaje con el aviso de varios gastos y su cantidad (y con uno, el de siempre)', async () => {
    route.opcion = () => ok(V_PILAR);
    const desdeDetalle: InitialEntry = {
      pathname: '/gastos/nuevo',
      search: `?viaje=${V_PILAR.id}`,
      state: { desdeViaje: V_PILAR.id, volverViaje: '?mes=2025-06' },
    };
    await mount(desdeDetalle);
    await llenarPeajesYVarios();
    await guardar('Guardar 2 gastos');
    const detalle = byId('detalle-del-viaje')!;
    expect(detalle.dataset.path).toBe(`/viajes/${V_PILAR.id}`);
    expect(detalle.dataset.aviso).toBe('gastos-guardados');
    expect(detalle.dataset.cantidad).toBe('2');
    expect(detalle.dataset.volver).toBe('?mes=2025-06');
    expect(byId('lista-de-gastos')).toBeNull();
  });

  it('abierto desde el detalle de un viaje con UNA categoría: «gasto-guardado», sin cantidad', async () => {
    route.opcion = () => ok(V_PILAR);
    await mount({ pathname: '/gastos/nuevo', search: `?viaje=${V_PILAR.id}`, state: { desdeViaje: V_PILAR.id, volverViaje: '' } });
    await marcar(PEAJES_ID);
    await typeText(byId<HTMLInputElement>('gasto-monto'), '800');
    await selectValue(byId<HTMLSelectElement>('gasto-metodo'), 'efectivo');
    await guardar();
    const detalle = byId('detalle-del-viaje')!;
    expect(detalle.dataset.aviso).toBe('gasto-guardado');
    expect(detalle.dataset.cantidad).toBe('');
  });

  it('nunca navega a algo que venga del estado: un volverViaje raro no cambia la ruta del detalle', async () => {
    route.opcion = () => ok(V_PILAR);
    await mount({ pathname: '/gastos/nuevo', search: `?viaje=${V_PILAR.id}`, state: { desdeViaje: V_PILAR.id, volverViaje: '//evil.com' } });
    await llenarPeajesYVarios();
    await guardar('Guardar 2 gastos');
    const detalle = byId('detalle-del-viaje')!;
    expect(detalle.dataset.path).toBe(`/viajes/${V_PILAR.id}`);
    expect(detalle.dataset.volver).toBe('');
  });

  it('mientras guarda, el grupo de categorías no se puede tocar y el botón dice «Guardando…»', async () => {
    route.insertar = () => new Promise(() => {}); // nunca responde
    await mount();
    await llenarPeajesYVarios();
    await guardar('Guardar 2 gastos');
    expect(buttonByText('Guardando…')!.disabled).toBe(true);
    expect(casillas().every(apagada)).toBe(true);
    expect(document.querySelector('fieldset')!.disabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Sin señal, reintento y «ya guardados»
// ---------------------------------------------------------------------------
describe('alta con varias categorías: sin señal y reintento', () => {
  it('sin señal: el aviso de siempre, NADA se borra, y «Reintentar» manda lo MISMO con las MISMAS claves y entra', async () => {
    let intento = 0;
    route.insertar = () => (++intento === 1 ? sinRed() : ok(null));
    await mount();
    await llenarPeajesYVarios();
    await guardar('Guardar 2 gastos');
    expect(bodyText()).toContain(NETWORK_SAVE_ERROR_MESSAGE);
    expect(byId('lista-de-gastos')).toBeNull();
    // lo escrito sigue ahí, en cada bloque
    expect(monto(PEAJES_ID)!.value).toBe('800');
    expect(monto(GASTOS_VARIOS_CATEGORIA_ID)!.value).toBe('500');
    expect(descripcion(GASTOS_VARIOS_CATEGORIA_ID)!.value).toBe('Lavado del camión');
    expect(metodo(PEAJES_ID)!.value).toBe('efectivo');
    expect(metodo(GASTOS_VARIOS_CATEGORIA_ID)!.value).toBe('transferencia');
    await reintentar();
    expect(inserts()).toHaveLength(2);
    expect(filasDe(inserts()[1]!)).toEqual(filasDe(inserts()[0]!)); // lo mismo, con las mismas claves
    expect(refPorCategoria(inserts()[1]!)).toEqual(refPorCategoria(inserts()[0]!));
    expect(byId('lista-de-gastos')!.dataset.cantidad).toBe('2');
  });

  it('con la respuesta perdida (el pedido anterior SÍ llegó): el segundo da «ya existe» y se toma como guardado, sin actualizar nada', async () => {
    let intento = 0;
    route.insertar = () => (++intento === 1 ? sinRed() : CLIENT_REF_DUPLICADO());
    await mount();
    await llenarPeajesYVarios();
    await guardar('Guardar 2 gastos');
    await reintentar();
    expect(inserts()).toHaveLength(2);
    expect(updatesGasto()).toHaveLength(0);
    expect(byId('lista-de-gastos')!.dataset.aviso).toBe('guardados');
    expect(byId('lista-de-gastos')!.dataset.cantidad).toBe('2');
  });

  it('si entre intentos se corrigió un dato y el primero sí había llegado: se actualiza CADA gasto con lo de ahora, por su clave', async () => {
    let intento = 0;
    route.insertar = () => (++intento === 1 ? sinRed() : CLIENT_REF_DUPLICADO());
    await mount();
    await llenarPeajesYVarios();
    await guardar('Guardar 2 gastos');
    await typeText(monto(PEAJES_ID), '950');
    await reintentar();
    expect(updatesGasto()).toHaveLength(2);
    const refs = clientRefsDe(inserts()[0]!);
    const actualizadas = updatesGasto().map((c) => c.ops.find((o) => o.m === 'eq')!.args[1]);
    expect(new Set(actualizadas)).toEqual(new Set(refs));
    for (const u of updatesGasto()) expect(argOf(u, 'update')).not.toHaveProperty('client_ref');
    expect(byId('lista-de-gastos')!.dataset.cantidad).toBe('2');
  });

  it('un reintento con un dato corregido manda lo nuevo con las mismas claves', async () => {
    let intento = 0;
    route.insertar = () => (++intento === 1 ? sinRed() : ok(null));
    await mount();
    await llenarPeajesYVarios();
    await guardar('Guardar 2 gastos');
    await typeText(monto(PEAJES_ID), '950');
    await reintentar();
    const [primero, segundo] = inserts();
    expect(refPorCategoria(segundo!)).toEqual(refPorCategoria(primero!));
    expect(filasDe(segundo!).find((f) => f.categoria_id === PEAJES_ID)!.monto).toBe(950);
  });

  it('un timeout: «no sabemos si se guardó» con «Reintentar», y las categorías quedan fijas', async () => {
    route.insertar = () => ({ data: null, error: { code: '', message: 'TimeoutError: signal timed out' }, status: 0 });
    await mount();
    await llenarPeajesYVarios();
    await guardar('Guardar 2 gastos');
    expect(bodyText()).toContain(TIMEOUT_ERROR_MESSAGE);
    expect(buttonByText('Reintentar')).toBeTruthy();
    expect(casillas().every(apagada)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Categorías fijas tras un intento sin confirmar, y «Empezar de nuevo»
// ---------------------------------------------------------------------------
describe('después de un intento que no terminó bien: las categorías quedan fijas', () => {
  it('sin señal: todas las casillas se apagan, se explica por qué y aparece «Empezar de nuevo»', async () => {
    route.insertar = () => sinRed();
    await mount();
    await llenarPeajesYVarios();
    expect(casillas().some(apagada)).toBe(false);
    await guardar('Guardar 2 gastos');
    expect(casillas().every(apagada)).toBe(true);
    expect(document.querySelector('fieldset')!.disabled).toBe(true);
    expect(byId('gasto-categoria-hint')!.textContent).toContain(textosVarios.AVISO_CATEGORIAS_FIJAS);
    expect(byId('gasto-categoria-hint')!.textContent).toContain(textosVarios.AYUDA_VARIAS_CATEGORIAS);
    expect(buttonByText(textosVarios.EMPEZAR_DE_NUEVO)).toBeTruthy();
  });

  it('tocar una casilla apagada no cambia nada: ni se marca ni se desmarca (los bloques siguen)', async () => {
    route.insertar = () => sinRed();
    await mount();
    await llenarPeajesYVarios();
    await guardar('Guardar 2 gastos');
    await click(casilla(PEAJES_ID));
    await click(casilla(LAVADO_ID));
    expect(marcadas()).toEqual([GASTOS_VARIOS_CATEGORIA_ID, PEAJES_ID]);
    expect(titulosDeBloques()[0]).toBe('Gastos varios');
    expect(buttonByText('Guardar 2 gastos')).toBeTruthy();
  });

  it('el bloqueo no depende solo de que las casillas estén apagadas: aunque se las encienda a la fuerza, tocarlas no cambia las categorías', async () => {
    route.insertar = () => sinRed();
    await mount();
    await llenarPeajesYVarios();
    await guardar('Guardar 2 gastos');
    document.querySelector('fieldset')!.disabled = false;
    for (const c of casillas()) c.disabled = false;
    expect(casillas().some(apagada)).toBe(false);
    await click(casilla(PEAJES_ID));
    await click(casilla(LAVADO_ID));
    expect(marcadas()).toEqual([GASTOS_VARIOS_CATEGORIA_ID, PEAJES_ID]);
    expect(titulosDeBloques()[0]).toBe('Gastos varios');
    expect(monto(PEAJES_ID)!.value).toBe('800');
  });

  it('lo escrito en cada bloque se puede seguir corrigiendo', async () => {
    route.insertar = () => sinRed();
    await mount();
    await llenarPeajesYVarios();
    await guardar('Guardar 2 gastos');
    await typeText(monto(PEAJES_ID), '1200');
    await selectValue(metodo(PEAJES_ID), 'tarjeta_debito');
    await typeText(descripcion(GASTOS_VARIOS_CATEGORIA_ID), 'Otra cosa');
    expect(monto(PEAJES_ID)!.value).toBe('1200');
    expect(metodo(PEAJES_ID)!.value).toBe('tarjeta_debito');
    expect(descripcion(GASTOS_VARIOS_CATEGORIA_ID)!.value).toBe('Otra cosa');
  });

  it('un error que NO es de red (el servidor lo rechazó) también las deja fijas: «cualquier error» de un intento que empezó', async () => {
    route.insertar = () => fail('23503', 'insert or update on table "gastos" violates foreign key constraint "gastos_viaje_fk"', 409);
    await mount();
    await llenarPeajesYVarios();
    await guardar('Guardar 2 gastos');
    expect(bodyText()).toContain('El viaje elegido ya no existe.');
    expect(casillas().every(apagada)).toBe(true);
    expect(buttonByText(textosVarios.EMPEZAR_DE_NUEVO)).toBeTruthy();
  });

  it('tras un fallo del lote, las categorías quedan TOTALMENTE fijas y la línea que lo explica es la de «fijas» (no la de UN gasto)', async () => {
    route.insertar = () => sinRed();
    await mount();
    await llenarPeajesYVarios();
    await guardar('Guardar 2 gastos');
    expect(casillas().every(apagada)).toBe(true);
    expect(document.querySelector('fieldset')!.disabled).toBe(true);
    expect(byId('gasto-categoria-hint')!.textContent).toContain(textosVarios.AVISO_CATEGORIAS_FIJAS);
    expect(byId('gasto-categoria-hint')!.textContent).not.toContain(textosVarios.AVISO_CATEGORIA_CAMBIABLE);
    // ni siquiera se puede desmarcar una: se queda como está
    await click(casilla(PEAJES_ID));
    expect(marcadas()).toEqual([GASTOS_VARIOS_CATEGORIA_ID, PEAJES_ID]);
  });

  it('editar un gasto: sin casillas, nada se bloquea y no hay «Empezar de nuevo» aunque falle el guardado', async () => {
    route.actualizar = () => sinRed();
    await mount(`/gastos/${GASTO_ID}/editar`);
    await guardar();
    expect(bodyText()).toContain(NETWORK_SAVE_ERROR_MESSAGE);
    expect(buttonByText(textosVarios.EMPEZAR_DE_NUEVO)).toBeUndefined();
    expect(document.querySelectorAll('input[type="radio"][id^="gasto-categoria"]').length).toBeGreaterThan(0);
    expect(document.querySelector('input[type="radio"][id^="gasto-categoria"]:disabled')).toBeNull();
  });
});

// Tras un intento de UN solo gasto que no terminó bien: la categoría se puede CAMBIAR (el reintento usa la misma clave y `crearGasto`
// corrige lo ya mandado con un UPDATE por clave, sin duplicar) pero NO se puede sumar otra (pasaría al camino de varios, con otras claves).
describe('después de un intento de UN gasto que no terminó bien: la categoría se puede cambiar, no sumar otra', () => {
  /** Una categoría (Peajes) con su monto y su método, y el primer guardado falla con la respuesta que se pida. */
  async function conUnGastoFallido(respuestas: Array<() => Resp>) {
    let intento = 0;
    route.insertar = () => (respuestas[intento++] ?? (() => ok(null)))();
    await mount();
    await marcar(PEAJES_ID);
    await typeText(byId<HTMLInputElement>('gasto-monto'), '800');
    await selectValue(byId<HTMLSelectElement>('gasto-metodo'), 'efectivo');
    await guardar();
  }

  it('el error se ve, lo escrito sigue y se explica que la categoría se puede cambiar (sin las palabras del tope de 10 ni las de «fijas»)', async () => {
    await conUnGastoFallido([sinRed]);
    expect(bodyText()).toContain(NETWORK_SAVE_ERROR_MESSAGE);
    expect(byId<HTMLInputElement>('gasto-monto')!.value).toBe('800');
    const ayuda = byId('gasto-categoria-hint')!.textContent!;
    expect(ayuda).toContain(textosVarios.AYUDA_VARIAS_CATEGORIAS);
    expect(ayuda).toContain(textosVarios.AVISO_CATEGORIA_CAMBIABLE);
    expect(ayuda).not.toContain(textosVarios.AVISO_CATEGORIAS_FIJAS);
    expect(bodyText()).not.toContain(textosVarios.AVISO_TOPE_DE_CATEGORIAS);
    expect(buttonByText(textosVarios.EMPEZAR_DE_NUEVO)).toBeTruthy();
  });

  it('(a) se puede desmarcar la categoría y marcar otra; lo escrito pasa a la nueva y el reintento usa la MISMA clave con la categoría nueva', async () => {
    await conUnGastoFallido([sinRed]);
    await click(casilla(PEAJES_ID));
    expect(marcadas()).toEqual([]);
    await click(casilla(LAVADO_ID));
    expect(marcadas()).toEqual([LAVADO_ID]);
    expect(byId<HTMLInputElement>('gasto-monto')!.value).toBe('800');
    expect(byId<HTMLSelectElement>('gasto-metodo')!.value).toBe('efectivo');
    await reintentar();
    expect(inserts()).toHaveLength(2);
    expect(filaDe(inserts()[1]!).client_ref).toBe(filaDe(inserts()[0]!).client_ref); // la misma clave: no puede duplicar
    expect(filaDe(inserts()[0]!).categoria_id).toBe(PEAJES_ID);
    expect(filaDe(inserts()[1]!)).toMatchObject({ categoria_id: LAVADO_ID, monto: 800, metodo_pago: 'efectivo' });
    expect(byId('lista-de-gastos')!.dataset.aviso).toBe('guardado');
  });

  it('(a) si el primer pedido SÍ había llegado, el reintento con otra categoría lo corrige con un UPDATE por la misma clave (nunca crea otro)', async () => {
    await conUnGastoFallido([sinRed, CLIENT_REF_DUPLICADO]);
    await click(casilla(PEAJES_ID));
    await click(casilla(LAVADO_ID));
    await reintentar();
    expect(inserts()).toHaveLength(2);
    expect(updatesGasto()).toHaveLength(1);
    const clave = filaDe(inserts()[0]!).client_ref;
    expect(updatesGasto()[0]!.ops.find((o) => o.m === 'eq')!.args).toEqual(['client_ref', clave]);
    const cambios = argOf(updatesGasto()[0]!, 'update') as Record<string, unknown>;
    expect(cambios).toMatchObject({ categoria_id: LAVADO_ID, monto: 800 });
    expect(cambios).not.toHaveProperty('client_ref');
    expect(byId('lista-de-gastos')!.dataset.aviso).toBe('guardado');
  });

  it('(b) con una marcada, las demás casillas están apagadas (y la marcada no) y no se puede llegar a 2', async () => {
    await conUnGastoFallido([sinRed]);
    expect(marcadas()).toEqual([PEAJES_ID]);
    expect(document.querySelector('fieldset')!.disabled).toBe(false); // el grupo NO se apaga entero
    expect(apagada(casilla(PEAJES_ID))).toBe(false);
    for (const id of [COMBUSTIBLE_CATEGORIA_ID, GASTOS_VARIOS_CATEGORIA_ID, LAVADO_ID]) expect(apagada(casilla(id)), id).toBe(true);
    await click(casilla(LAVADO_ID)); // apagada: no hace nada
    expect(marcadas()).toEqual([PEAJES_ID]);
    expect(titulosDeBloques()).toEqual([]); // sigue la pantalla de UNA categoría
    expect(buttonByText('Guardar gasto')).toBeTruthy();
  });

  it('(b) al desmarcar la categoría se vuelven a encender todas, y al marcar otra se apagan las demás de nuevo', async () => {
    await conUnGastoFallido([sinRed]);
    await click(casilla(PEAJES_ID));
    expect(casillas().some(apagada)).toBe(false);
    await click(casilla(GASTOS_VARIOS_CATEGORIA_ID));
    expect(marcadas()).toEqual([GASTOS_VARIOS_CATEGORIA_ID]);
    expect(casillas().filter(apagada).map((c) => c.value).sort()).toEqual([COMBUSTIBLE_CATEGORIA_ID, LAVADO_ID, PEAJES_ID].sort());
  });

  it('(b) no depende solo de las casillas apagadas: aunque se las encienda a la fuerza, tocar otra NO llega a 2 marcadas', async () => {
    await conUnGastoFallido([sinRed]);
    document.querySelector('fieldset')!.disabled = false;
    for (const c of casillas()) c.disabled = false;
    expect(casillas().some(apagada)).toBe(false);
    await click(casilla(LAVADO_ID));
    await click(casilla(COMBUSTIBLE_CATEGORIA_ID));
    expect(marcadas()).toEqual([PEAJES_ID]);
    expect(titulosDeBloques()).toEqual([]);
    // cambiar la categoría (desmarcar y marcar otra) sí
    await click(casilla(PEAJES_ID));
    await click(casilla(LAVADO_ID));
    expect(marcadas()).toEqual([LAVADO_ID]);
  });

  it('desmarcar la única categoría y tocar «Guardar gasto» sin ninguna marcada: «Elige una categoría.», NO se manda nada y el bloqueo sigue', async () => {
    await conUnGastoFallido([sinRed]);
    expect(inserts()).toHaveLength(1);
    await click(casilla(PEAJES_ID));
    expect(marcadas()).toEqual([]);
    await guardar();
    expect(byId('gasto-categoria-error')!.textContent).toBe('Elige una categoría.');
    expect(enfocado()).toBe('gasto-categoria-0');
    expect(inserts()).toHaveLength(1); // ningún pedido nuevo
    expect(updatesGasto()).toHaveLength(0);
    expect(h.state.reinicios).toBe(0);
    // el bloqueo sigue: el aviso, «Empezar de nuevo» y lo escrito siguen a la vista
    expect(byId('gasto-categoria-hint')!.textContent).toContain(textosVarios.AVISO_CATEGORIA_CAMBIABLE);
    expect(buttonByText(textosVarios.EMPEZAR_DE_NUEVO)).toBeTruthy();
    expect(byId<HTMLInputElement>('gasto-monto')!.value).toBe('800');
    // y sigue siendo «una a la vez»: marcar una apaga las demás
    await click(casilla(LAVADO_ID));
    expect(marcadas()).toEqual([LAVADO_ID]);
    expect(apagada(casilla(PEAJES_ID))).toBe(true);
    expect(bodyText()).not.toContain('Elige una categoría.'); // y el error se va al marcar
  });

  it('el aviso de «una a la vez» dice que hay que DESMARCAR la actual y marcar otra', async () => {
    await conUnGastoFallido([sinRed]);
    const ayuda = byId('gasto-categoria-hint')!.textContent!;
    expect(ayuda).toContain('Para cambiar la categoría, desmarca la actual y marca otra; para sumar otra, empieza de nuevo.');
    expect(ayuda).not.toContain('Puedes cambiar la categoría');
  });

  it('el tope de 10 de siempre no cambia: sin ningún intento fallido sigue valiendo 10 (no 1) y con su aviso', async () => {
    await mount();
    await marcar(PEAJES_ID, LAVADO_ID, GASTOS_VARIOS_CATEGORIA_ID);
    expect(marcadas()).toHaveLength(3);
    expect(casillas().some(apagada)).toBe(false);
    expect(bodyText()).not.toContain(textosVarios.AVISO_TOPE_DE_CATEGORIAS);
  });

  it('(d) «Empezar de nuevo» desbloquea todo y permite marcar más de una, y guarda TODO con claves nuevas', async () => {
    await conUnGastoFallido([sinRed]);
    const claveVieja = filaDe(inserts()[0]!).client_ref;
    await click(buttonByText(textosVarios.EMPEZAR_DE_NUEVO));
    await click(buttonByText('Sí, empezar de nuevo'));
    expect(h.state.reinicios).toBe(1);
    expect(casillas().some(apagada)).toBe(false);
    expect(byId('gasto-categoria-hint')!.textContent).toBe(textosVarios.AYUDA_VARIAS_CATEGORIAS);
    expect(buttonByText(textosVarios.EMPEZAR_DE_NUEVO)).toBeUndefined();
    expect(bodyText()).not.toContain(NETWORK_SAVE_ERROR_MESSAGE);
    expect(byId<HTMLInputElement>('gasto-monto')!.value).toBe('800'); // lo escrito se conserva
    expect(enfocado()).toBe('gasto-categoria-0');
    await click(casilla(LAVADO_ID)); // ahora sí se puede sumar una segunda
    expect(marcadas()).toEqual([LAVADO_ID, PEAJES_ID]);
    await llenarBloque(LAVADO_ID, '300', 'transferencia');
    await guardar('Guardar 2 gastos');
    expect(inserts()).toHaveLength(2);
    const filas = filasDe(inserts()[1]!);
    expect(filas).toHaveLength(2);
    const claves = clientRefsDe(inserts()[1]!);
    expect(claves).not.toContain(claveVieja); // claves nuevas
    expect(new Set(claves).size).toBe(2);
    expect(bodyText()).not.toContain(LOTE_DISTINTO_MESSAGE);
    expect(byId('lista-de-gastos')!.dataset.cantidad).toBe('2');
  });

  it('(d) desde «una», «Empezar de nuevo» sigue siendo de dos toques y no reinicia hasta confirmar', async () => {
    await conUnGastoFallido([sinRed]);
    await click(buttonByText(textosVarios.EMPEZAR_DE_NUEVO));
    expect(bodyText()).toContain(textosVarios.PREGUNTA_EMPEZAR_DE_NUEVO);
    expect(h.state.reinicios).toBe(0);
    expect(apagada(casilla(LAVADO_ID))).toBe(true); // todavía limitado
    await click(buttonByText('Cancelar'));
    expect(h.state.reinicios).toBe(0);
    await reintentar(); // y el reintento sigue mandando lo mismo, con la misma clave
    expect(filaDe(inserts()[1]!).client_ref).toBe(filaDe(inserts()[0]!).client_ref);
  });

  it('(e) «La categoría elegida ya no está disponible. Elige otra.»: ya se puede elegir otra y guardar con la misma clave', async () => {
    await conUnGastoFallido([() => fail('23503', 'La categoría de gasto no es válida para este transportista', 409)]);
    expect(bodyText()).toContain('La categoría elegida ya no está disponible. Elige otra.');
    expect(buttonByText('Reintentar')).toBeUndefined(); // reintentar con lo mismo daría lo mismo
    expect(apagada(casilla(PEAJES_ID))).toBe(false); // la marcada se puede desmarcar
    await click(casilla(PEAJES_ID));
    await click(casilla(LAVADO_ID));
    expect(marcadas()).toEqual([LAVADO_ID]);
    await guardar();
    expect(inserts()).toHaveLength(2);
    expect(filaDe(inserts()[1]!)).toMatchObject({ categoria_id: LAVADO_ID, monto: 800 });
    expect(filaDe(inserts()[1]!).client_ref).toBe(filaDe(inserts()[0]!).client_ref);
    expect(byId('lista-de-gastos')!.dataset.aviso).toBe('guardado');
  });

  it('un error que NO es de red también deja la categoría cambiable (no hace falta ser un error de red)', async () => {
    await conUnGastoFallido([() => fail('23503', 'insert or update on table "gastos" violates foreign key constraint "gastos_viaje_fk"', 409)]);
    expect(bodyText()).toContain('El viaje elegido ya no existe.');
    expect(byId('gasto-categoria-hint')!.textContent).toContain(textosVarios.AVISO_CATEGORIA_CAMBIABLE);
    expect(apagada(casilla(LAVADO_ID))).toBe(true);
    expect(apagada(casilla(PEAJES_ID))).toBe(false);
  });

  it('después de otro fallo con la categoría cambiada, sigue siendo «una a la vez» y con la misma clave', async () => {
    await conUnGastoFallido([sinRed, sinRed]);
    await click(casilla(PEAJES_ID));
    await click(casilla(LAVADO_ID));
    await reintentar();
    expect(bodyText()).toContain(NETWORK_SAVE_ERROR_MESSAGE);
    expect(marcadas()).toEqual([LAVADO_ID]);
    expect(apagada(casilla(PEAJES_ID))).toBe(true);
    await click(casilla(LAVADO_ID));
    await click(casilla(GASTOS_VARIOS_CATEGORIA_ID));
    expect(marcadas()).toEqual([GASTOS_VARIOS_CATEGORIA_ID]);
    expect(inserts()).toHaveLength(2);
    expect(filaDe(inserts()[1]!).client_ref).toBe(filaDe(inserts()[0]!).client_ref);
  });
});

describe('«Empezar de nuevo»', () => {
  async function conUnIntentoFallido() {
    let intento = 0;
    route.insertar = () => (++intento === 1 ? sinRed() : ok(null));
    await mount();
    await llenarPeajesYVarios();
    await guardar('Guardar 2 gastos');
  }

  it('es una confirmación en DOS toques: primero pregunta y manda a revisar la lista de Gastos; no hace nada hasta confirmar', async () => {
    await conUnIntentoFallido();
    await click(buttonByText(textosVarios.EMPEZAR_DE_NUEVO));
    expect(bodyText()).toContain('Antes de empezar de nuevo, revisa la lista de Gastos: puede que ya se hayan guardado.');
    expect(buttonByText('Sí, empezar de nuevo')).toBeTruthy();
    expect(buttonByText('Cancelar')).toBeTruthy();
    expect(casillas().every(apagada)).toBe(true); // todavía fijas
    expect(h.state.reinicios).toBe(0);
  });

  it('el foco pasa a «Cancelar» (la opción segura) y «Cancelar» vuelve atrás SIN reiniciar nada', async () => {
    await conUnIntentoFallido();
    await click(buttonByText(textosVarios.EMPEZAR_DE_NUEVO));
    expect(document.activeElement).toBe(buttonByText('Cancelar'));
    await click(buttonByText('Cancelar'));
    expect(bodyText()).not.toContain('Antes de empezar de nuevo');
    expect(document.activeElement).toBe(buttonByText(textosVarios.EMPEZAR_DE_NUEVO));
    expect(casillas().every(apagada)).toBe(true);
    expect(h.state.reinicios).toBe(0);
    await reintentar(); // y reintentar sigue mandando lo MISMO, con las mismas claves
    expect(refPorCategoria(inserts()[1]!)).toEqual(refPorCategoria(inserts()[0]!));
  });

  it('confirmar: UN reinicio, las categorías se pueden volver a elegir, lo escrito se CONSERVA, el error se va y el foco va al grupo', async () => {
    await conUnIntentoFallido();
    await click(buttonByText(textosVarios.EMPEZAR_DE_NUEVO));
    await click(buttonByText('Sí, empezar de nuevo'));
    expect(h.state.reinicios).toBe(1);
    expect(casillas().some(apagada)).toBe(false);
    expect(marcadas()).toEqual([GASTOS_VARIOS_CATEGORIA_ID, PEAJES_ID]);
    expect(monto(PEAJES_ID)!.value).toBe('800');
    expect(monto(GASTOS_VARIOS_CATEGORIA_ID)!.value).toBe('500');
    expect(descripcion(GASTOS_VARIOS_CATEGORIA_ID)!.value).toBe('Lavado del camión');
    expect(metodo(PEAJES_ID)!.value).toBe('efectivo');
    expect(bodyText()).not.toContain(NETWORK_SAVE_ERROR_MESSAGE);
    expect(bodyText()).not.toContain(textosVarios.AVISO_CATEGORIAS_FIJAS);
    expect(buttonByText(textosVarios.EMPEZAR_DE_NUEVO)).toBeUndefined();
    expect(enfocado()).toBe('gasto-categoria-0');
  });

  it('después de empezar de nuevo, guardar manda TODAS las claves NUEVAS (nunca las del intento anterior)', async () => {
    await conUnIntentoFallido();
    await click(buttonByText(textosVarios.EMPEZAR_DE_NUEVO));
    await click(buttonByText('Sí, empezar de nuevo'));
    await guardar('Guardar 2 gastos');
    expect(inserts()).toHaveLength(2);
    const viejas = clientRefsDe(inserts()[0]!);
    const nuevas = clientRefsDe(inserts()[1]!);
    expect(new Set([...viejas, ...nuevas]).size).toBe(4); // ninguna se repite
    expect(byId('lista-de-gastos')!.dataset.cantidad).toBe('2');
  });

  it('después de empezar de nuevo se pueden cambiar las categorías y guardar con otras: el envío anterior se olvidó por completo (no hay error de «categorías distintas»)', async () => {
    await conUnIntentoFallido();
    await click(buttonByText(textosVarios.EMPEZAR_DE_NUEVO));
    await click(buttonByText('Sí, empezar de nuevo'));
    await click(casilla(LAVADO_ID));
    await llenarBloque(LAVADO_ID, '300', 'efectivo');
    await guardar('Guardar 3 gastos');
    expect(inserts()).toHaveLength(2);
    expect(filasDe(inserts()[1]!)).toHaveLength(3);
    expect(bodyText()).not.toContain(LOTE_DISTINTO_MESSAGE);
    expect(byId('lista-de-gastos')!.dataset.cantidad).toBe('3');
    const nuevas = clientRefsDe(inserts()[1]!);
    expect(nuevas.some((ref) => clientRefsDe(inserts()[0]!).includes(ref))).toBe(false);
  });

  it('después de empezar de nuevo y fallar otra vez, las categorías vuelven a quedar fijas', async () => {
    route.insertar = () => sinRed();
    await mount();
    await llenarPeajesYVarios();
    await guardar('Guardar 2 gastos');
    await click(buttonByText(textosVarios.EMPEZAR_DE_NUEVO));
    await click(buttonByText('Sí, empezar de nuevo'));
    expect(casillas().some(apagada)).toBe(false);
    await guardar('Guardar 2 gastos');
    expect(casillas().every(apagada)).toBe(true);
    expect(buttonByText(textosVarios.EMPEZAR_DE_NUEVO)).toBeTruthy();
  });

  it('con UNA categoría: empezar de nuevo también renueva la clave (el pedido siguiente no repite la del intento anterior)', async () => {
    let intento = 0;
    route.insertar = () => (++intento === 1 ? sinRed() : ok(null));
    await mount();
    await marcar(PEAJES_ID);
    await typeText(byId<HTMLInputElement>('gasto-monto'), '800');
    await selectValue(byId<HTMLSelectElement>('gasto-metodo'), 'efectivo');
    await guardar();
    await click(buttonByText(textosVarios.EMPEZAR_DE_NUEVO));
    await click(buttonByText('Sí, empezar de nuevo'));
    expect(h.state.reinicios).toBe(1);
    await guardar();
    expect(inserts()).toHaveLength(2);
    expect(filaDe(inserts()[1]!).client_ref).not.toBe(filaDe(inserts()[0]!).client_ref);
  });
});

describe('el reinicio del envío (lo mandado y las claves, juntos)', () => {
  it('guardar bien reinicia UNA vez y recién ahí se navega', async () => {
    await mount();
    await llenarPeajesYVarios();
    expect(h.state.reinicios).toBe(0);
    await guardar('Guardar 2 gastos');
    expect(h.state.reinicios).toBe(1);
    expect(byId('lista-de-gastos')).not.toBeNull();
  });

  it('guardar bien UN gasto también reinicia UNA vez', async () => {
    await mount();
    await marcar(PEAJES_ID);
    await typeText(byId<HTMLInputElement>('gasto-monto'), '800');
    await selectValue(byId<HTMLSelectElement>('gasto-metodo'), 'efectivo');
    await guardar();
    expect(h.state.reinicios).toBe(1);
  });

  it('un guardado que falla NO reinicia (los reintentos tienen que mandar lo mismo)', async () => {
    route.insertar = () => sinRed();
    await mount();
    await llenarPeajesYVarios();
    await guardar('Guardar 2 gastos');
    await reintentar();
    await reintentar();
    expect(h.state.reinicios).toBe(0);
    expect(inserts()).toHaveLength(3);
    expect(new Set(inserts().map((c) => JSON.stringify(refPorCategoria(c)))).size).toBe(1);
  });

  it('un error de validación NO reinicia', async () => {
    await mount();
    await marcar(PEAJES_ID, LAVADO_ID);
    await guardar('Guardar 2 gastos');
    expect(h.state.reinicios).toBe(0);
  });

  it('editar un gasto no usa el envío: nunca se reinicia', async () => {
    await mount(`/gastos/${GASTO_ID}/editar`);
    await guardar();
    expect(updatesGasto()).toHaveLength(1);
    expect(h.state.reinicios).toBe(0);
  });
});

describe('lo que no se arregla reintentando: «Empezar de nuevo» es la única salida', () => {
  it('«el intento anterior fue con otras categorías»: mensaje propio, SIN «Reintentar», «Guardar» apagado y «Empezar de nuevo»', async () => {
    h.state.crearGastosOverride = async () => {
      throw new LoteDeGastosDistintoError();
    };
    await mount();
    await llenarPeajesYVarios();
    await guardar('Guardar 2 gastos');
    expect(bodyText()).toContain(LOTE_DISTINTO_MESSAGE);
    expect(buttonByText('Reintentar')).toBeUndefined();
    expect(buttonByText('Guardar 2 gastos')!.disabled).toBe(true);
    expect(buttonByText(textosVarios.EMPEZAR_DE_NUEVO)).toBeTruthy();
    expect(casillas().every(apagada)).toBe(true);
    expect(monto(PEAJES_ID)!.value).toBe('800'); // lo escrito sigue
  });

  it('...y empezar de nuevo lo destraba: se guarda con claves nuevas', async () => {
    h.state.crearGastosOverride = async () => {
      throw new LoteDeGastosDistintoError();
    };
    await mount();
    await llenarPeajesYVarios();
    await guardar('Guardar 2 gastos');
    h.state.crearGastosOverride = null; // ya no se fuerza el error
    await click(buttonByText(textosVarios.EMPEZAR_DE_NUEVO));
    await click(buttonByText('Sí, empezar de nuevo'));
    expect(buttonByText('Guardar 2 gastos')!.disabled).toBe(false);
    expect(bodyText()).not.toContain(LOTE_DISTINTO_MESSAGE);
    await guardar('Guardar 2 gastos');
    expect(inserts()).toHaveLength(1);
    expect(byId('lista-de-gastos')!.dataset.cantidad).toBe('2');
  });

  it('el «atascado raro» (uno de los gastos ya guardados ya no está al actualizar): mensaje propio, sin «Reintentar», «Guardar» apagado y «Empezar de nuevo»', async () => {
    let intento = 0;
    route.insertar = () => (++intento === 1 ? sinRed() : CLIENT_REF_DUPLICADO());
    route.actualizar = () => ok([]); // el UPDATE no encuentra la fila
    await mount();
    await llenarPeajesYVarios();
    await guardar('Guardar 2 gastos');
    await typeText(monto(PEAJES_ID), '950'); // un dato cambiado entre intentos obliga a actualizar
    await reintentar();
    expect(updatesGasto().length).toBeGreaterThan(0);
    expect(bodyText()).toContain(LOTE_NO_ENCONTRADO_MESSAGE);
    expect(buttonByText('Reintentar')).toBeUndefined();
    expect(buttonByText('Guardar 2 gastos')!.disabled).toBe(true);
    expect(buttonByText(textosVarios.EMPEZAR_DE_NUEVO)).toBeTruthy();
    expect(byId('lista-de-gastos')).toBeNull();
    expect(monto(PEAJES_ID)!.value).toBe('950');
  });

  it('con UN solo gasto, que el gasto ya guardado ya no esté NO es un callejón: mensaje de UN gasto y «Guardar gasto» sigue activo para guardarlo de nuevo', async () => {
    let intento = 0;
    route.insertar = () => (++intento === 2 ? CLIENT_REF_DUPLICADO() : intento === 1 ? sinRed() : ok(null));
    route.actualizar = () => ok([]); // el UPDATE no encuentra la fila
    await mount();
    await marcar(PEAJES_ID);
    await typeText(byId<HTMLInputElement>('gasto-monto'), '800');
    await selectValue(byId<HTMLSelectElement>('gasto-metodo'), 'efectivo');
    await guardar();
    await typeText(byId<HTMLInputElement>('gasto-monto'), '950');
    await reintentar();
    expect(bodyText()).toContain('El gasto que se había guardado ya no está. Toca "Guardar gasto" para guardarlo de nuevo.');
    expect(bodyText()).not.toContain(LOTE_NO_ENCONTRADO_MESSAGE);
    expect(buttonByText('Guardar gasto')!.disabled).toBe(false);
    await guardar();
    expect(inserts()).toHaveLength(3);
    expect(byId('lista-de-gastos')!.dataset.aviso).toBe('guardado');
  });

  it('mientras REINTENTA, «Empezar de nuevo» no se puede tocar', async () => {
    let intento = 0;
    route.insertar = () => (++intento === 1 ? sinRed() : new Promise(() => {})); // el reintento no responde
    await mount();
    await llenarPeajesYVarios();
    await guardar('Guardar 2 gastos');
    expect(buttonByText(textosVarios.EMPEZAR_DE_NUEVO)!.disabled).toBe(false);
    await reintentar();
    expect(buttonByText('Guardando…')).toBeTruthy();
    expect(buttonByText(textosVarios.EMPEZAR_DE_NUEVO)!.disabled).toBe(true);
  });

  it('un error común sin «Reintentar» (la categoría ya no está) NO apaga «Guardar»: se puede corregir y volver a probar', async () => {
    route.insertar = () => fail('23503', 'La categoría de gasto no es válida para este transportista', 409);
    await mount();
    await llenarPeajesYVarios();
    await guardar('Guardar 2 gastos');
    expect(buttonByText('Reintentar')).toBeUndefined();
    expect(buttonByText('Guardar 2 gastos')!.disabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Edición
// ---------------------------------------------------------------------------
describe('guardados en vuelo: irse de la pantalla, doble toque y reinicio', () => {
  /** Un guardado que no responde hasta que la prueba lo decide. */
  function respuestaManual() {
    const control = { responder: () => {} };
    route.insertar = () =>
      new Promise((resolver) => {
        control.responder = () => resolver(ok(null));
      });
    return control;
  }
  async function llenarYGuardar(cantidad: 1 | 2) {
    if (cantidad === 2) {
      await llenarPeajesYVarios();
      await guardar('Guardar 2 gastos');
    } else {
      await marcar(PEAJES_ID);
      await typeText(byId<HTMLInputElement>('gasto-monto'), '800');
      await selectValue(byId<HTMLSelectElement>('gasto-metodo'), 'efectivo');
      await guardar();
    }
  }

  it.each([[1], [2]] as const)('la pantalla se desmontó con un guardado en vuelo (%i gasto/s): al llegar la respuesta NO navega y NO reinicia el envío', async (cantidad) => {
    const control = respuestaManual();
    await mount();
    await llenarYGuardar(cantidad);
    expect(inserts()).toHaveLength(1);
    expect(buttonByText('Guardando…')).toBeTruthy();
    await click(byId('irse')); // se va a otra pantalla (el detalle de un viaje) mientras guarda
    expect(byId('detalle-del-viaje')!.dataset.path).toBe(`/viajes/${V_PILAR.id}`);
    expect(document.getElementById('gasto-monto') ?? document.querySelector('input[id^="gasto-monto"]')).toBeNull(); // la pantalla de gasto ya no está
    await act(async () => {
      control.responder();
    });
    await settle(6);
    // la respuesta llegó, pero nadie la usa: no se lo arrastra a la lista, ni a ningún aviso, ni se reinicia el envío
    expect(byId('lista-de-gastos')).toBeNull();
    expect(byId('detalle-del-viaje')!.dataset.path).toBe(`/viajes/${V_PILAR.id}`);
    expect(byId('detalle-del-viaje')!.dataset.aviso).toBe('');
    expect(h.state.reinicios).toBe(0);
    expect(inserts()).toHaveLength(1);
  });

  it.each([[1], [2]] as const)('doble toque en guardar (%i gasto/s): un solo pedido, con botón y con envíos forzados del formulario', async (cantidad) => {
    const control = respuestaManual();
    await mount();
    if (cantidad === 2) await llenarPeajesYVarios();
    else {
      await marcar(PEAJES_ID);
      await typeText(byId<HTMLInputElement>('gasto-monto'), '800');
      await selectValue(byId<HTMLSelectElement>('gasto-metodo'), 'efectivo');
    }
    const boton = buttons().find((b) => b.type === 'submit' && b.textContent === (cantidad === 2 ? 'Guardar 2 gastos' : 'Guardar gasto'))!;
    const formulario = document.querySelector('form')!;
    await act(async () => {
      boton.click();
      boton.click();
      formulario.requestSubmit(); // el botón apagado no frena un envío forzado: lo frena el guard de «ya está guardando»
      formulario.requestSubmit();
    });
    await settle(4);
    expect(inserts()).toHaveLength(1);
    expect(h.state.reinicios).toBe(0);
    // un toque de más que se ignora NO cuenta como un intento fallido: nada se bloquea ni se ofrece «Empezar de nuevo»
    expect(buttonByText(textosVarios.EMPEZAR_DE_NUEVO)).toBeUndefined();
    await act(async () => {
      control.responder();
    });
    await settle(6);
    expect(inserts()).toHaveLength(1);
    expect(byId('lista-de-gastos')!.dataset.aviso).toBe(cantidad === 2 ? 'guardados' : 'guardado');
    expect(h.state.reinicios).toBe(1);
  });

  it('mientras guarda, aunque se enciendan a la fuerza las casillas, tocarlas no cambia las categorías', async () => {
    const control = respuestaManual();
    await mount();
    await llenarYGuardar(2);
    expect(casillas().every(apagada)).toBe(true);
    document.querySelector('fieldset')!.disabled = false;
    for (const c of casillas()) c.disabled = false;
    await click(casilla(PEAJES_ID));
    await click(casilla(LAVADO_ID));
    expect(marcadas()).toEqual([GASTOS_VARIOS_CATEGORIA_ID, PEAJES_ID]);
    expect(buttonByText('Guardando…')).toBeTruthy();
    await act(async () => {
      control.responder();
    });
    await settle(6);
    expect(inserts()).toHaveLength(1);
    expect(filasDe(inserts()[0]!)).toHaveLength(2);
  });

  it('«Empezar de nuevo» no hace nada si llega mientras se está guardando (ni reinicia, ni desbloquea)', async () => {
    let intento = 0;
    let responder = () => {};
    route.insertar = () => (++intento === 1 ? sinRed() : new Promise((resolver) => { responder = () => resolver(ok(null)); }));
    await mount();
    await llenarPeajesYVarios();
    await guardar('Guardar 2 gastos');
    await click(buttonByText(textosVarios.EMPEZAR_DE_NUEVO)); // queda abierta la confirmación
    await reintentar(); // y ahora guarda de nuevo (sin responder)
    expect(buttonByText('Guardando…')).toBeTruthy();
    const confirmar = buttonByText('Sí, empezar de nuevo')!;
    expect(confirmar.disabled).toBe(true);
    // React no deja llegar un clic a un botón apagado, así que se llama al manejador del botón directamente: como si algo se saltara el
    // botón apagado. Lo que se prueba es la guarda de adentro, no el botón.
    const clave = Object.keys(confirmar).find((k) => k.startsWith('__reactProps'))!;
    await act(async () => {
      (confirmar as unknown as Record<string, { onClick: () => void }>)[clave]!.onClick();
    });
    await settle(3);
    expect(h.state.reinicios).toBe(0);
    expect(casillas().every(apagada)).toBe(true); // siguen fijas
    expect(buttonByText('Guardando…')).toBeTruthy();
    await act(async () => {
      responder();
    });
    await settle(6);
    expect(inserts()).toHaveLength(2);
    expect(refPorCategoria(inserts()[1]!)).toEqual(refPorCategoria(inserts()[0]!)); // y el guardado siguió con las MISMAS claves
    expect(byId('lista-de-gastos')!.dataset.cantidad).toBe('2');
  });
});

describe('editar un gasto: una sola categoría, igual que siempre', () => {
  it('la categoría es de UNA opción (radios), sin la ayuda de «marcar más de una» ni bloques', async () => {
    await mount(`/gastos/${GASTO_ID}/editar`);
    expect(document.querySelectorAll('input[type="radio"][id^="gasto-categoria"]')).toHaveLength(4);
    expect(document.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
    expect(bodyText()).not.toContain('Puedes marcar más de una');
    expect(titulosDeBloques()).toEqual([]);
    expect(buttonByText('Guardar gasto')).toBeTruthy();
    expect([...document.querySelectorAll<HTMLInputElement>('input[type="radio"][id^="gasto-categoria"]')].filter((r) => r.checked).map((r) => r.value)).toEqual([PEAJES_ID]);
  });

  it('los ids de siempre y guardar actualiza UN gasto (nunca un lote)', async () => {
    await mount(`/gastos/${GASTO_ID}/editar`);
    for (const id of ['gasto-descripcion', 'gasto-monto', 'gasto-fecha', 'gasto-viaje', 'gasto-metodo']) expect(byId(id), id).not.toBeNull();
    await guardar();
    expect(updatesGasto()).toHaveLength(1);
    expect(inserts()).toHaveLength(0);
  });

  it('cambiar la categoría de un gasto que se edita conserva lo escrito', async () => {
    await mount(`/gastos/${GASTO_ID}/editar`);
    await click(document.querySelector<HTMLInputElement>(`input[type="radio"][value="${LAVADO_ID}"]`));
    expect(byId<HTMLInputElement>('gasto-monto')!.value).toBe('900');
    await guardar();
    expect(argOf(updatesGasto()[0]!, 'update')).toMatchObject({ categoria_id: LAVADO_ID, monto: 900, metodo_pago: 'efectivo' });
  });
});

// ---------------------------------------------------------------------------
// Idioma y accesibilidad
// ---------------------------------------------------------------------------
describe('alta con varias categorías: idioma y accesibilidad', () => {
  it('ningún texto nuevo de la pantalla en voseo, y «aquí», no «acá»', async () => {
    route.insertar = () => sinRed();
    await mount();
    await llenarPeajesYVarios();
    await guardar('Guardar 2 gastos');
    await click(buttonByText(textosVarios.EMPEZAR_DE_NUEVO));
    const texto = bodyText();
    expect(texto).not.toMatch(/(?<![\p{L}])(vos|sos|acá|tenés|podés|elegí|marcá|empezá|revisá|desmarcá)(?![\p{L}])/iu);
    expect(texto).toContain('empieza de nuevo');
  });

  it('cada bloque es un grupo con nombre (título enlazado), y los títulos son encabezados', async () => {
    await mount();
    await marcar(PEAJES_ID, GASTOS_VARIOS_CATEGORIA_ID);
    const grupos = [...document.querySelectorAll('form [role="group"][aria-labelledby]')];
    expect(grupos.length).toBeGreaterThanOrEqual(3); // dos bloques y el de los métodos de pago
    for (const grupo of grupos) expect(document.getElementById(grupo.getAttribute('aria-labelledby')!)!.tagName).toBe('H2');
  });

  it('los tocables de «Empezar de nuevo» miden 48 px o más y se parten en líneas en vez de salirse', async () => {
    route.insertar = () => sinRed();
    await mount();
    await llenarPeajesYVarios();
    await guardar('Guardar 2 gastos');
    await click(buttonByText(textosVarios.EMPEZAR_DE_NUEVO));
    expect(buttonByText('Sí, empezar de nuevo')!.className).toContain('min-h-12');
    expect(buttonByText('Sí, empezar de nuevo')!.className).toContain('whitespace-normal');
    expect(buttonByText('Cancelar')!.className).toContain('h-12');
  });

  it('sin scroll horizontal: ningún bloque fija un ancho (todo es fluido) y los grupos pueden encogerse', async () => {
    await mount();
    await marcar(PEAJES_ID, COMBUSTIBLE_CATEGORIA_ID);
    const html = document.querySelector('form')!.innerHTML;
    expect(html).not.toMatch(/(?:^|\s)w-\[\d+px\]/);
    expect(html).not.toMatch(/(?:^|\s)min-w-\[\d+px\]/);
    expect(document.querySelector('fieldset')!.className).toContain('min-w-0');
  });
});
