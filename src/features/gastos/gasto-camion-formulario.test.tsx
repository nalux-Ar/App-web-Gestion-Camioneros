import { act, useMemo, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, type InitialEntry } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// El CAMIÓN de una carga de combustible (Etapa 5b): con litros hace falta camión (regla del front hasta la 011). Qué se
// muestra según los camiones y el viaje, el alta en línea, qué se manda y los errores. Mock de supabase; el resto es real.
type Op = { m: string; args: unknown[] };
type Call = { target: string; ops: Op[] };

const h = vi.hoisted(() => {
  const calls: Array<{ target: string; ops: Array<{ m: string; args: unknown[] }> }> = [];
  const state = { responder: null as null | ((call: { target: string; ops: Array<{ m: string; args: unknown[] }> }) => unknown) };
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

import { AuthContext, type AuthContextValue } from '@/features/auth/auth-context';
import { MemberProvider } from '@/features/member/member-provider';
import { RequireMember } from '@/app/guards';
import { GastoFormPage } from '@/features/gastos/gasto-form-page';
import { COMBUSTIBLE_CATEGORIA_ID, GASTOS_VARIOS_CATEGORIA_ID } from '@/features/gastos/constants';
import type { Categoria } from '@/features/gastos/categorias';
import { gastosKeys } from '@/features/gastos/gastos-keys';
import { camionesKeys } from '@/features/camiones/camiones-keys';
import { CAMION_ARCHIVADO_MESSAGE } from '@/features/camiones/constants';
import {
  CAMIONES_SIN_CARGAR_MESSAGE,
  CAMION_CREAR_MESSAGE,
  CAMION_FALTA_MESSAGE,
} from '@/features/camiones/camion-seleccion';
import { viajesKeys } from '@/features/viajes/viajes-keys';
import { queryClient } from '@/lib/query-client';

type Resp = { data: unknown; count?: unknown; error: { message: string; code: string; details?: string; hint?: string } | null; status: number };
const ok = (data: unknown): Resp => ({ data, error: null, status: 200 });
const conteo = (count: number): Resp => ({ data: null, count, error: null, status: 200 });
const fail = (code: string, message: string, status = 400): Resp => ({ data: null, error: { code, message, details: '', hint: '' }, status });
const sinRed = (): Resp => ({ data: null, error: { code: '', message: 'TypeError: Failed to fetch' }, status: 0 });

const PEAJES_ID = '210b4f00-fdb4-499b-bf15-79ebe2aaf3c3';
const CATS: Categoria[] = [
  { id: COMBUSTIBLE_CATEGORIA_ID, nombre: 'Combustible', activa: true, transportista_id: null },
  { id: GASTOS_VARIOS_CATEGORIA_ID, nombre: 'Gastos varios', activa: true, transportista_id: null },
  { id: PEAJES_ID, nombre: 'Peajes', activa: true, transportista_id: null },
];
let ROL: 'admin' | 'chofer' = 'admin';
const miembro = () => ({ rol: ROL, tema: 'dark', color_acento: '#F59E0B', transportista_id: 'tenant-a', transportistas: { nombre: 'Transportes A' } });

const cid = (n: number) => `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
type Fila = { id: string; patente: string; marca: string | null; modelo: string | null; anio: number | null; activa: boolean };
const camion = (n: number, patente: string, over: Partial<Fila> = {}): Fila => ({ id: cid(n), patente, marca: null, modelo: null, anio: null, activa: true, ...over });
const A = camion(1, 'AB123CD');
const B = camion(2, 'ABC123');
const C = camion(3, 'CC333CC');
const D = camion(4, 'DD444DD');
const E = camion(5, 'EE555EE');
const X = camion(9, 'XY987ZW', { activa: false });
const NUEVO = cid(170);

const GASTO_ID = 'e0000000-0000-4000-8000-000000000001';
const vid = (n: number) => `b0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const viaje = (n: number, origen: string, camionId: string | null) => ({ id: vid(n), fecha: '2026-09-15', origen, destino: 'Córdoba', camion_id: camionId });
const V_A = viaje(1, 'Rosario', A.id);
const V_B = viaje(2, 'Pilar', B.id);
const V_SIN = viaje(3, 'Salta', null);
const V_X = viaje(4, 'Tandil', X.id);
const V_PRE = viaje(900, 'Mendoza', B.id); // no está entre los recientes: llega con ?viaje=
const RECIENTES = [V_A, V_B, V_SIN, V_X];

const gastoDetalle = (over: Record<string, unknown> = {}) => ({
  id: GASTO_ID,
  categoria_id: COMBUSTIBLE_CATEGORIA_ID,
  fecha: '2026-09-15',
  monto: 40000,
  descripcion: null,
  metodo_pago: null,
  litros: 40,
  precio_por_litro: 1000,
  km_odometro: null,
  tanque_lleno: null,
  camion_id: null,
  viaje_id: null,
  viajes: null,
  ...over,
});

type Handler = (call: Call) => unknown;
const route: {
  camiones: Handler;
  detalle: Handler;
  opcion: Handler;
  insertar: Handler;
  actualizarGasto: Handler;
  crearCamion: Handler;
  actualizarCamion: Handler;
} = {} as never;

function resetRoutes() {
  route.camiones = () => ok([A, B]);
  route.detalle = () => ok(gastoDetalle());
  route.opcion = () => ok(V_PRE);
  route.insertar = () => ok(null);
  route.actualizarGasto = () => ok([{ id: GASTO_ID }]);
  route.crearCamion = () => ok([{ camion_id: NUEVO, creado: true, viajes_asignados: 0, gastos_asignados: 0, activa: true }]);
  route.actualizarCamion = (call) => ok([{ id: call.ops.find((o) => o.m === 'eq')!.args[1] }]);
}

function installResponder() {
  h.state.responder = (call: Call) => {
    const has = (m: string) => call.ops.some((o) => o.m === m);
    if (call.target === 'miembros' && has('maybeSingle')) return ok(miembro());
    if (call.target === 'categorias_gasto') return ok(CATS);
    if (call.target === 'rpc:crear_camion') return route.crearCamion(call);
    if (call.target === 'camiones') return has('update') ? route.actualizarCamion(call) : route.camiones(call);
    if (call.target === 'viajes') {
      if (has('is')) return conteo(6); // conteo del primer camión
      return has('limit') ? ok(RECIENTES) : route.opcion(call);
    }
    if (call.target === 'gastos') {
      if (has('is')) return conteo(2); // conteo del primer camión
      if (has('insert')) return route.insertar(call);
      if (has('update')) return route.actualizarGasto(call);
      return route.detalle(call);
    }
    throw new Error(`pedido inesperado: ${call.target} ${call.ops.map((o) => o.m).join('.')}`);
  };
}

const callsTo = (target: string) => h.calls.filter((c) => c.target === target);
const inserts = () => callsTo('gastos').filter((c) => c.ops.some((o) => o.m === 'insert'));
const updatesGasto = () => callsTo('gastos').filter((c) => c.ops.some((o) => o.m === 'update'));
const payloadOf = (call: Call, m: 'insert' | 'update') => call.ops.find((o) => o.m === m)!.args[0] as Record<string, unknown>;
const rpcsCamion = () => callsTo('rpc:crear_camion');

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
              <RequireMember>
                <Routes>
                  <Route path="/gastos/nuevo" element={<GastoFormPage modo="nuevo" />} />
                  <Route path="/gastos/:id/editar" element={<GastoFormPage modo="editar" />} />
                  <Route path="/gastos" element={<div id="lista-de-gastos" />} />
                  <Route path="/viajes/:id" element={<div id="detalle-del-viaje" />} />
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

const EDITAR = `/gastos/${GASTO_ID}/editar`;
const byId = <T extends HTMLElement = HTMLElement>(elementId: string) => document.getElementById(elementId) as T | null;
const bodyText = () => document.body.textContent ?? '';
const buttons = () => [...document.querySelectorAll<HTMLButtonElement>('button')];
const buttonByText = (text: string) => buttons().find((b) => b.textContent?.includes(text));
const radioOf = (categoriaId: string) => document.querySelector<HTMLInputElement>(`input[type="radio"][value="${categoriaId}"]`)!;
const radiosCamion = () => [...document.querySelectorAll<HTMLInputElement>('input[type="radio"][id^="gasto-camion-"]')];
const radioCamion = (texto: string) => radiosCamion().find((r) => r.closest('label')?.textContent?.includes(texto));
const errorCamion = () => byId('gasto-camion-error')?.textContent ?? '';
const inputPatente = () => byId<HTMLInputElement>('gasto-camion-nuevo-patente');

async function click(el: HTMLElement | null | undefined) {
  if (!el) throw new Error('no se encontró el elemento a tocar');
  await act(async () => {
    el.click();
  });
  await settle(5);
}
async function typeText(el: HTMLInputElement | null, value: string) {
  if (!el) throw new Error('no se encontró el campo');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
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
async function guardar() {
  await click(buttonByText('Guardar gasto'));
  await settle(3);
}
/** Combustible con monto y litros (lo mínimo de una carga). */
async function llenarCombustible() {
  await click(radioOf(COMBUSTIBLE_CATEGORIA_ID));
  await typeText(byId<HTMLInputElement>('gasto-monto'), '40000');
  await typeText(byId<HTMLInputElement>('gasto-litros'), '40');
}

let invalidadas: unknown[][] = [];
let invalidateSpy: ReturnType<typeof vi.spyOn>;
const invalido = (key: readonly unknown[]) => invalidadas.some((k) => JSON.stringify(k) === JSON.stringify(key));
const T = 'tenant-a';

beforeEach(() => {
  h.calls.length = 0;
  ROL = 'admin';
  resetRoutes();
  installResponder();
  localStorage.clear();
  invalidadas = [];
  invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockImplementation(((filters?: { queryKey?: unknown[] }) => {
    if (filters?.queryKey) invalidadas.push(filters.queryKey);
    return Promise.resolve();
  }) as never);
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
  invalidateSpy.mockRestore();
  queryClient.clear();
  expect(errorSpy.mock.calls.map((c: unknown[]) => String(c[0]))).toEqual([]);
  errorSpy.mockRestore();
});

// ---------------------------------------------------------------------------
// Sin viaje
// ---------------------------------------------------------------------------
describe('carga de combustible sin viaje: el camión según los camiones', () => {
  it('otra categoría: no hay camión y se manda camion_id NULL (aunque haya camiones)', async () => {
    await mount();
    await click(radioOf(PEAJES_ID));
    expect(radiosCamion()).toHaveLength(0);
    await typeText(byId<HTMLInputElement>('gasto-monto'), '800');
    await guardar();
    expect(payloadOf(inserts()[0]!, 'insert')).toMatchObject({ camion_id: null, litros: null });
  });

  it('1 activo: no se pregunta, va ese', async () => {
    route.camiones = () => ok([A, X]);
    await mount();
    await llenarCombustible();
    expect(radiosCamion()).toHaveLength(0);
    await guardar();
    expect(payloadOf(inserts()[0]!, 'insert')).toMatchObject({ camion_id: A.id, litros: 40 });
  });

  it('2 activos: botones sin preselección, en el bloque Combustible antes de los litros; sin elegir no se guarda', async () => {
    await mount();
    await llenarCombustible();
    expect(radiosCamion().map((r) => r.closest('label')!.textContent)).toEqual(['AB 123 CD', 'ABC 123']);
    expect(radiosCamion().some((r) => r.checked)).toBe(false);
    expect(radiosCamion()[0]!.compareDocumentPosition(byId('gasto-litros')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await guardar();
    expect(errorCamion()).toBe(CAMION_FALTA_MESSAGE);
    expect(document.activeElement).toBe(byId('gasto-camion-0'));
    expect(inserts()).toHaveLength(0);
    await click(radioCamion('ABC 123'));
    await guardar();
    expect(payloadOf(inserts()[0]!, 'insert').camion_id).toBe(B.id);
  });

  it('AUDITORÍA: con 1 camión activo en la caché (fresca) y un 2º cargado desde otro dispositivo, el formulario vuelve a pedir la lista y pregunta (no asigna el 1º en silencio)', async () => {
    queryClient.setQueryData(camionesKeys.list('tenant-a'), { items: [A], truncado: false });
    route.camiones = () => ok([A, B]);
    await mount();
    await llenarCombustible();
    expect(h.calls.some((c) => c.target === 'camiones')).toBe(true); // se volvió a pedir aunque la caché estaba fresca
    expect(radiosCamion().map((r) => r.closest('label')!.textContent)).toEqual(['AB 123 CD', 'ABC 123']);
    expect(radiosCamion().some((r) => r.checked)).toBe(false);
    await guardar();
    expect(errorCamion()).toBe(CAMION_FALTA_MESSAGE);
    expect(inserts()).toHaveLength(0);
  });

  it('5 activos: lista desplegable', async () => {
    route.camiones = () => ok([A, B, C, D, E]);
    await mount();
    await llenarCombustible();
    const select = byId<HTMLSelectElement>('gasto-camion')!;
    expect(select.tagName).toBe('SELECT');
    await guardar();
    expect(document.activeElement).toBe(select);
    await selectValue(select, E.id);
    await guardar();
    expect(payloadOf(inserts()[0]!, 'insert').camion_id).toBe(E.id);
  });

  it('elegir un camión y pasar a otra categoría: el camión NO se manda', async () => {
    await mount();
    await llenarCombustible();
    await click(radioCamion('AB 123 CD'));
    await click(radioOf(PEAJES_ID));
    await guardar();
    expect(payloadOf(inserts()[0]!, 'insert')).toMatchObject({ camion_id: null, litros: null });
  });

  it('si la lista de camiones no carga: Combustible no se guarda ("Falta cargar tus camiones"); otra categoría sí', async () => {
    route.camiones = () => sinRed();
    await mount();
    await llenarCombustible();
    expect(bodyText()).toContain('No pudimos cargar tus camiones.');
    await guardar();
    expect(errorCamion()).toBe(CAMIONES_SIN_CARGAR_MESSAGE);
    expect(document.activeElement).toBe(byId('gasto-camion-bloque'));
    expect(inserts()).toHaveLength(0);
    await click(radioOf(PEAJES_ID));
    await guardar();
    expect(payloadOf(inserts()[0]!, 'insert').camion_id).toBeNull();
  });

  it('"Reintentar" vuelve a pedir la lista y entonces se puede guardar', async () => {
    route.camiones = () => sinRed();
    await mount();
    await llenarCombustible();
    route.camiones = () => ok([A]);
    await click(buttonByText('Reintentar'));
    await guardar();
    expect(payloadOf(inserts()[0]!, 'insert').camion_id).toBe(A.id);
  });
});

// ---------------------------------------------------------------------------
// Sin camiones activos: cargarlo en línea
// ---------------------------------------------------------------------------
describe('sin camiones activos: "+ Nuevo camión" en línea (solo el administrador)', () => {
  it('sin cargarlo no se guarda: "Para guardar los litros hace falta un camión", foco en el bloque', async () => {
    route.camiones = () => ok([]);
    await mount();
    await llenarCombustible();
    expect(inputPatente()).not.toBeNull();
    await guardar();
    expect(errorCamion()).toBe(CAMION_CREAR_MESSAGE);
    expect(document.activeElement).toBe(byId('gasto-camion-bloque'));
    expect(inserts()).toHaveLength(0);
  });

  it('PRIMER camión: avisa lo que se le asigna; al cargarlo lo dice y la carga va con él; se invalida lo asignado', async () => {
    route.camiones = () => ok([]);
    route.crearCamion = () => ok([{ camion_id: NUEVO, creado: true, viajes_asignados: 6, gastos_asignados: 2, activa: true }]);
    await mount();
    await llenarCombustible();
    expect(bodyText()).toContain('Es tu primer camión: 6 viajes y 2 cargas de combustible que cargaste sin camión van a quedar asignados a él.');
    await typeText(inputPatente(), 'ab 123 cd');
    await click(buttonByText('Cargar camión'));
    expect(rpcsCamion()[0]!.ops.find((o) => o.m === 'rpc')!.args[0]).toEqual({ p_patente: 'AB123CD' });
    expect(bodyText()).toContain('Camión AB 123 CD cargado. Se le asignaron 6 viajes y 2 cargas de combustible que estaban sin camión.');
    expect(inputPatente()).toBeNull(); // ya hay un camión: el bloque de alta se va
    expect(invalido(viajesKeys.lists(T))).toBe(true);
    expect(invalido(gastosKeys.all(T))).toBe(true);
    await guardar();
    expect(payloadOf(inserts()[0]!, 'insert').camion_id).toBe(NUEVO);
  });

  it('el Enter del campo carga el camión y NO envía el gasto', async () => {
    route.camiones = () => ok([]);
    await mount();
    await llenarCombustible();
    await typeText(inputPatente(), 'AB123CD');
    await act(async () => {
      inputPatente()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await settle(6);
    expect(rpcsCamion()).toHaveLength(1);
    expect(inserts()).toHaveLength(0);
  });

  it('patente vacía: error en el campo, sin pedir nada', async () => {
    route.camiones = () => ok([]);
    await mount();
    await llenarCombustible();
    await click(buttonByText('Cargar camión'));
    expect(bodyText()).toContain('Escribe la patente.');
    expect(rpcsCamion()).toHaveLength(0);
  });

  it('solo archivados (0 activos, no es el primero): se carga en línea, sin aviso de primer camión ni conteos', async () => {
    route.camiones = () => ok([X]);
    await mount();
    await llenarCombustible();
    expect(inputPatente()).not.toBeNull();
    expect(bodyText()).not.toContain('primer camión');
    expect(callsTo('viajes').filter((c) => c.ops.some((o) => o.m === 'is'))).toHaveLength(0);
  });

  it('la patente ya era de un camión ACTIVO (lista vieja): se usa ese', async () => {
    route.camiones = () => ok([X]);
    route.crearCamion = () => ok([{ camion_id: A.id, creado: false, viajes_asignados: 0, gastos_asignados: 0, activa: true }]);
    await mount();
    await llenarCombustible();
    await typeText(inputPatente(), 'AB123CD');
    await click(buttonByText('Cargar camión'));
    expect(bodyText()).toContain('Ya tenías el camión AB 123 CD: se usa ese.');
    await guardar();
    expect(payloadOf(inserts()[0]!, 'insert').camion_id).toBe(A.id);
  });

  it('la patente era de un camión ARCHIVADO: "Reactivarlo y usarlo"', async () => {
    route.camiones = () => ok([X]);
    route.crearCamion = () => ok([{ camion_id: X.id, creado: false, viajes_asignados: 0, gastos_asignados: 0, activa: false }]);
    await mount();
    await llenarCombustible();
    await typeText(inputPatente(), 'XY987ZW');
    await click(buttonByText('Cargar camión'));
    expect(bodyText()).toContain('Ya tienes un camión con esa patente (XY 987 ZW), pero está archivado.');
    await click(buttonByText('Reactivarlo y usarlo'));
    const update = callsTo('camiones').find((c) => c.ops.some((o) => o.m === 'update'))!;
    expect(update.ops.find((o) => o.m === 'update')!.args[0]).toEqual({ activa: true });
    expect(bodyText()).toContain('Camión XY 987 ZW reactivado.');
    await guardar();
    expect(payloadOf(inserts()[0]!, 'insert').camion_id).toBe(X.id);
  });

  it('cuando la lista se vuelve a leer, manda ella (lo reactivado acá ya no se impone)', async () => {
    route.camiones = () => ok([X]);
    route.crearCamion = () => ok([{ camion_id: X.id, creado: false, viajes_asignados: 0, gastos_asignados: 0, activa: false }]);
    await mount();
    await llenarCombustible();
    await typeText(inputPatente(), 'XY987ZW');
    await click(buttonByText('Cargar camión'));
    await click(buttonByText('Reactivarlo y usarlo'));
    expect(inputPatente()).toBeNull();
    // Alguien lo volvió a archivar desde otro dispositivo: la lista nueva lo trae archivado.
    await new Promise((r) => setTimeout(r, 5)); // que el `dataUpdatedAt` de la relectura sea posterior
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: camionesKeys.list(T) });
    });
    await settle(3);
    expect(inputPatente()).not.toBeNull();
    await guardar();
    expect(errorCamion()).toBe(CAMION_CREAR_MESSAGE);
    expect(inserts()).toHaveLength(0);
  });

  it('error de red al cargarlo: "Reintentar" en el bloque, lo tipeado sigue', async () => {
    route.camiones = () => ok([]);
    let intento = 0;
    route.crearCamion = () => {
      intento += 1;
      return intento === 1 ? sinRed() : ok([{ camion_id: NUEVO, creado: true, viajes_asignados: 0, gastos_asignados: 0, activa: true }]);
    };
    await mount();
    await llenarCombustible();
    await typeText(inputPatente(), 'AB123CD');
    await click(buttonByText('Cargar camión'));
    expect(bodyText()).toContain('No hay conexión');
    expect(inputPatente()!.value).toBe('AB123CD');
    await click(buttonByText('Reintentar'));
    expect(rpcsCamion()).toHaveLength(2);
    expect(bodyText()).toContain('Camión AB 123 CD cargado.');
  });

  it('CHOFER: no puede cargar un camión; se le explica y la carga con litros no se guarda', async () => {
    ROL = 'chofer';
    route.camiones = () => ok([]);
    await mount();
    await llenarCombustible();
    expect(inputPatente()).toBeNull();
    expect(bodyText()).toContain('solo el administrador de la cuenta puede cargarlo');
    await guardar();
    expect(errorCamion()).toBe(CAMION_CREAR_MESSAGE);
    expect(inserts()).toHaveLength(0);
    // Ni conteos del primer camión (no se muestra el alta).
    expect(callsTo('viajes').filter((c) => c.ops.some((o) => o.m === 'is'))).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Con viaje
// ---------------------------------------------------------------------------
describe('carga de combustible en un viaje con camión: el del viaje, bloqueado', () => {
  it('elegir un viaje con camión: "Camión del viaje: X" (sin botones) y va ese', async () => {
    await mount();
    await llenarCombustible();
    await selectValue(byId<HTMLSelectElement>('gasto-viaje'), V_B.id);
    expect(radiosCamion()).toHaveLength(0);
    expect(bodyText()).toContain('Camión del viaje: ABC 123');
    await guardar();
    expect(payloadOf(inserts()[0]!, 'insert')).toMatchObject({ camion_id: B.id, viaje_id: V_B.id });
  });

  it('cambiar de viaje cambia el camión', async () => {
    await mount();
    await llenarCombustible();
    await selectValue(byId<HTMLSelectElement>('gasto-viaje'), V_B.id);
    await selectValue(byId<HTMLSelectElement>('gasto-viaje'), V_A.id);
    expect(bodyText()).toContain('Camión del viaje: AB 123 CD');
    await guardar();
    expect(payloadOf(inserts()[0]!, 'insert').camion_id).toBe(A.id);
  });

  it('"Sin viaje" lo vuelve editable, con el camión que tenía elegido', async () => {
    await mount();
    await llenarCombustible();
    await selectValue(byId<HTMLSelectElement>('gasto-viaje'), V_B.id);
    await selectValue(byId<HTMLSelectElement>('gasto-viaje'), '');
    expect(radioCamion('ABC 123')!.checked).toBe(true);
    await click(radioCamion('AB 123 CD'));
    await guardar();
    expect(payloadOf(inserts()[0]!, 'insert')).toMatchObject({ camion_id: A.id, viaje_id: null });
  });

  it('un viaje SIN camión no bloquea: se elige como sin viaje', async () => {
    await mount();
    await llenarCombustible();
    await selectValue(byId<HTMLSelectElement>('gasto-viaje'), V_SIN.id);
    expect(radiosCamion()).toHaveLength(2);
    await guardar();
    expect(errorCamion()).toBe(CAMION_FALTA_MESSAGE);
  });

  it('llegar con ?viaje= de un viaje con camión: bloqueado desde el principio', async () => {
    await mount(`/gastos/nuevo?viaje=${V_PRE.id}`);
    await llenarCombustible();
    expect(bodyText()).toContain('Camión del viaje: ABC 123');
    await guardar();
    expect(payloadOf(inserts()[0]!, 'insert')).toMatchObject({ camion_id: B.id, viaje_id: V_PRE.id });
  });

  it('el camión del viaje está ARCHIVADO y la carga es nueva: no se guarda, con la explicación', async () => {
    route.camiones = () => ok([A, B, X]);
    await mount();
    await llenarCombustible();
    await selectValue(byId<HTMLSelectElement>('gasto-viaje'), V_X.id);
    expect(bodyText()).toContain('Camión del viaje: XY 987 ZW (archivado)');
    await guardar();
    expect(errorCamion()).toBe('El camión de este viaje (XY 987 ZW) está archivado: reactívalo desde Camiones o carga el gasto sin viaje.');
    expect(document.activeElement).toBe(byId('gasto-camion-bloque'));
    expect(inserts()).toHaveLength(0);
  });

  it('el camión del viaje no está en la lista: "Camión no disponible", y se manda el del viaje', async () => {
    route.camiones = () => ok([A]);
    await mount();
    await llenarCombustible();
    await selectValue(byId<HTMLSelectElement>('gasto-viaje'), V_B.id);
    expect(bodyText()).toContain('Camión del viaje: Camión no disponible');
    await guardar();
    expect(payloadOf(inserts()[0]!, 'insert').camion_id).toBe(B.id);
  });

  it('otra categoría en un viaje con camión: camion_id NULL (solo los litros llevan camión)', async () => {
    await mount();
    await click(radioOf(PEAJES_ID));
    await typeText(byId<HTMLInputElement>('gasto-monto'), '800');
    await selectValue(byId<HTMLSelectElement>('gasto-viaje'), V_B.id);
    await guardar();
    expect(payloadOf(inserts()[0]!, 'insert')).toMatchObject({ camion_id: null, viaje_id: V_B.id });
  });
});

// ---------------------------------------------------------------------------
// Editar
// ---------------------------------------------------------------------------
describe('editar una carga de combustible', () => {
  it('con su camión: preseleccionado y se manda el mismo', async () => {
    route.detalle = () => ok(gastoDetalle({ camion_id: B.id }));
    await mount(EDITAR);
    expect(radioCamion('ABC 123')!.checked).toBe(true);
    await guardar();
    expect(payloadOf(updatesGasto()[0]!, 'update')).toMatchObject({ camion_id: B.id });
  });

  it('su camión ARCHIVADO (sin viaje): se conserva entre las opciones, "(archivado)"', async () => {
    route.camiones = () => ok([A, B, X]);
    route.detalle = () => ok(gastoDetalle({ camion_id: X.id }));
    await mount(EDITAR);
    expect(radiosCamion().map((r) => r.closest('label')!.textContent)).toEqual(['XY 987 ZW (archivado)', 'AB 123 CD', 'ABC 123']);
    await guardar();
    expect(payloadOf(updatesGasto()[0]!, 'update').camion_id).toBe(X.id);
  });

  it('en un viaje con camión archivado que la carga YA tenía: se puede seguir editando', async () => {
    route.camiones = () => ok([A, X]);
    route.detalle = () => ok(gastoDetalle({ camion_id: X.id, viaje_id: V_X.id, viajes: V_X }));
    await mount(EDITAR);
    expect(bodyText()).toContain('Camión del viaje: XY 987 ZW (archivado)');
    await guardar();
    expect(payloadOf(updatesGasto()[0]!, 'update')).toMatchObject({ camion_id: X.id, viaje_id: V_X.id });
  });

  it('una carga VIEJA con litros y sin camión, con 1 activo: se le asigna al guardar', async () => {
    route.camiones = () => ok([A]);
    await mount(EDITAR);
    await guardar();
    expect(payloadOf(updatesGasto()[0]!, 'update').camion_id).toBe(A.id);
  });

  it('una carga VIEJA con litros y 0 camiones: pide cargar uno antes de guardar', async () => {
    route.camiones = () => ok([]);
    await mount(EDITAR);
    expect(inputPatente()).not.toBeNull();
    await guardar();
    expect(errorCamion()).toBe(CAMION_CREAR_MESSAGE);
    expect(updatesGasto()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Errores de la base
// ---------------------------------------------------------------------------
describe('errores del camión al guardar', () => {
  it('23514 gastos_camion_viaje_chk (el viaje cambió de camión en otro lado): mensaje y se refrescan viajes y camiones', async () => {
    route.insertar = () => fail('23514', 'El camión del gasto no coincide con el del viaje (gastos_camion_viaje_chk)');
    await mount();
    await llenarCombustible();
    await selectValue(byId<HTMLSelectElement>('gasto-viaje'), V_B.id);
    await guardar();
    expect(bodyText()).toContain('El camión no coincide con el del viaje: el viaje cambió de camión. Vuelve a elegir el viaje.');
    expect(bodyText()).not.toContain('gastos_camion_viaje_chk');
    expect(buttonByText('Reintentar')).toBeUndefined();
    expect(invalido(viajesKeys.recientes(T))).toBe(true);
    expect(invalido(camionesKeys.list(T))).toBe(true);
  });

  it('23503 gastos_camion_fk (el camión ya no existe): mensaje y se refresca SOLO la lista de camiones', async () => {
    route.insertar = () => fail('23503', 'insert or update on table "gastos" violates foreign key constraint "gastos_camion_fk"', 409);
    await mount();
    await llenarCombustible();
    await click(radioCamion('AB 123 CD'));
    await guardar();
    expect(bodyText()).toContain('El camión elegido ya no existe. Elige otro.');
    expect(invalido(camionesKeys.list(T))).toBe(true);
    expect(invalido(viajesKeys.recientes(T))).toBe(false);
  });

  it('55000 camion_archivado: mensaje propio sin "Reintentar"', async () => {
    route.actualizarGasto = () => fail('55000', 'El camión está archivado (camion_archivado)');
    route.detalle = () => ok(gastoDetalle({ camion_id: A.id }));
    await mount(EDITAR);
    await guardar();
    expect(bodyText()).toContain(CAMION_ARCHIVADO_MESSAGE);
    expect(buttonByText('Reintentar')).toBeUndefined();
    expect(invalido(camionesKeys.list(T))).toBe(true);
  });

  it('la FK del viaje sigue con su mensaje y NO refresca camiones', async () => {
    route.insertar = () =>
      fail('23503', 'insert or update on table "gastos" violates foreign key constraint "gastos_viaje_fk"', 409);
    await mount();
    await llenarCombustible();
    await selectValue(byId<HTMLSelectElement>('gasto-viaje'), V_B.id);
    await guardar();
    expect(bodyText()).toContain('El viaje elegido ya no existe. Elige otro o déjalo sin viaje.');
    expect(invalido(viajesKeys.recientes(T))).toBe(true);
    expect(invalido(camionesKeys.list(T))).toBe(false);
  });
});
