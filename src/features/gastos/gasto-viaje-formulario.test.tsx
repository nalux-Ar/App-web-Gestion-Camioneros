import { act, useMemo, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation, type InitialEntry } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock de supabase: registra cada pedido y responde segun la tabla. Todo lo demas es codigo REAL del proyecto
// (formulario, hooks, TanStack Query, router, validacion).
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
import { COMBUSTIBLE_CATEGORIA_ID, GASTOS_VARIOS_CATEGORIA_ID } from '@/features/gastos/constants';
import type { Categoria } from '@/features/gastos/categorias';
import { viajesKeys } from '@/features/viajes/viajes-keys';
import { etiquetaDeViaje } from '@/features/viajes/viaje-opciones';
import { todayLocal } from '@/lib/dates';
import { queryClient } from '@/lib/query-client';

// ---------------------------------------------------------------------------
// "Base de datos" falsa
// ---------------------------------------------------------------------------
type Resp = { data: unknown; error: { message: string; code: string; details?: string; hint?: string } | null; status: number };
const ok = (data: unknown): Resp => ({ data, error: null, status: 200 });
const fail = (code: string, message: string, details = ''): Resp => ({ data: null, error: { code, message, details, hint: '' }, status: 409 });
const sinRed = (): Resp => ({ data: null, error: { code: '', message: 'TypeError: Failed to fetch' }, status: 0 });

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

const GASTO_ID = 'e0000000-0000-4000-8000-000000000001';
const uuidViaje = (n: number) => `b0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const V_PILAR = uuidViaje(1); // el más reciente: "Pilar → Villa María", del año actual
const V_OTRO = uuidViaje(2);
const V_VIEJO = uuidViaje(900); // un viaje de 2021: NO está entre los 50 recientes
const V_PRESELECCIONADO = uuidViaje(901); // viaje viejo al que se llega con ?viaje=
const V_INEXISTENTE = uuidViaje(999);

const ANIO_ACTUAL = todayLocal().slice(0, 4);
const viajeFila = (id: string, fecha: string, origen: string, destino: string) => ({ id, fecha, origen, destino });
const RECIENTES = [
  viajeFila(V_PILAR, `${ANIO_ACTUAL}-01-15`, 'Pilar', 'Villa María'),
  viajeFila(V_OTRO, '2020-03-05', 'Rosario', 'Córdoba'),
  ...Array.from({ length: 48 }, (_, i) => viajeFila(uuidViaje(i + 3), '2020-01-01', `Origen ${i + 3}`, `Destino ${i + 3}`)),
];
const VIEJO = viajeFila(V_VIEJO, '2021-04-10', 'Salta', 'Tucumán');
const PRESELECCIONADO = viajeFila(V_PRESELECCIONADO, '2019-11-20', 'Mendoza', 'San Juan');

const gastoDetalle = (over: Record<string, unknown> = {}) => ({
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
  viaje_id: V_VIEJO,
  viajes: VIEJO,
  ...over,
});

type Handler = (call: Call) => unknown;
const route: {
  recientes: Handler;
  opcion: Handler;
  detalle: Handler;
  insertar: Handler;
  actualizar: Handler;
  borrar: Handler;
} = {
  recientes: () => ok(RECIENTES),
  opcion: () => ok(null),
  detalle: () => ok(gastoDetalle()),
  insertar: () => ok(null),
  actualizar: () => ok([{ id: GASTO_ID }]),
  borrar: () => ok([{ id: GASTO_ID }]),
};

function resetRoutes() {
  route.recientes = () => ok(RECIENTES);
  route.opcion = () => ok(null);
  route.detalle = () => ok(gastoDetalle());
  route.insertar = () => ok(null);
  route.actualizar = () => ok([{ id: GASTO_ID }]);
  route.borrar = () => ok([{ id: GASTO_ID }]);
}

function installResponder() {
  h.state.responder = (call: Call) => {
    const has = (m: string) => call.ops.some((o) => o.m === m);
    if (call.table === 'miembros' && has('maybeSingle')) return ok(MIEMBRO);
    if (call.table === 'categorias_gasto') return ok(CATS);
    if (call.table === 'viajes') return has('limit') ? route.recientes(call) : route.opcion(call);
    if (call.table === 'gastos') {
      if (has('insert')) return route.insertar(call);
      if (has('update')) return route.actualizar(call);
      if (has('delete')) return route.borrar(call);
      return route.detalle(call);
    }
    throw new Error(`pedido inesperado: ${call.table} ${call.ops.map((o) => o.m).join('.')}`);
  };
}

const callsTo = (table: string) => h.calls.filter((c) => c.table === table);
const recientesCalls = () => callsTo('viajes').filter((c) => c.ops.some((o) => o.m === 'limit'));
const opcionCalls = () => callsTo('viajes').filter((c) => c.ops.some((o) => o.m === 'maybeSingle'));
const inserts = () => callsTo('gastos').filter((c) => c.ops.some((o) => o.m === 'insert'));
const updates = () => callsTo('gastos').filter((c) => c.ops.some((o) => o.m === 'update'));
const payloadOf = (call: Call, m: 'insert' | 'update') => call.ops.find((o) => o.m === m)!.args[0] as Record<string, unknown>;

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

/** La lista de gastos de mentira: a donde se navego y con que aviso. */
function ListaProbe() {
  const location = useLocation();
  const aviso = (location.state as { aviso?: string } | null)?.aviso ?? '';
  return (
    <div id="lista-de-gastos" data-aviso={aviso} data-search={location.search}>
      lista
    </div>
  );
}

/** El detalle del viaje de mentira: a donde se navego, con que aviso y con que `volver`. */
function DetalleProbe() {
  const location = useLocation();
  const state = (location.state as { aviso?: string; volver?: string } | null) ?? {};
  return (
    <div id="detalle-del-viaje" data-path={location.pathname} data-aviso={state.aviso ?? ''} data-volver={state.volver ?? ''}>
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

const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T | null;
const bodyText = () => document.body.textContent ?? '';
const buttons = () => [...document.querySelectorAll<HTMLButtonElement>('button')];
const buttonByText = (text: string) => buttons().find((b) => b.textContent?.includes(text));
const selectViaje = () => byId<HTMLSelectElement>('gasto-viaje')!;
const opcionesDelSelect = () => [...selectViaje().options].map((o) => ({ value: o.value, label: o.textContent ?? '' }));
const seleccionado = () => selectViaje().selectedOptions[0]?.textContent ?? null;
const radioOf = (categoriaId: string) => document.querySelector<HTMLInputElement>(`input[type="radio"][value="${categoriaId}"]`)!;

async function click(el: HTMLElement | null | undefined) {
  if (!el) throw new Error('no se encontro el elemento a tocar');
  await act(async () => {
    el.click();
  });
  await settle(3);
}
async function typeText(el: HTMLInputElement | null, value: string) {
  if (!el) throw new Error('no se encontro el campo');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function selectValue(el: HTMLSelectElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
async function guardar() {
  await act(async () => {
    buttonByText('Guardar gasto')!.click();
  });
  await settle(6);
}
/** Llena lo minimo de un gasto NUEVO: categoria Peajes y un monto. */
async function llenarLoMinimo() {
  await click(radioOf(PEAJES_ID));
  await typeText(byId<HTMLInputElement>('gasto-monto'), '800');
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
  Element.prototype.scrollIntoView = (() => {}) as never;
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  container?.remove();
  queryClient.clear();
  // Ninguna prueba debe dejar warnings de React (act, anidamiento invalido de DOM, keys...).
  expect(errorSpy.mock.calls.map((c: unknown[]) => String(c[0]))).toEqual([]);
  errorSpy.mockRestore();
});

// ---------------------------------------------------------------------------
// Alta: el selector "Viaje"
// ---------------------------------------------------------------------------
describe('formulario de gasto (alta): selector "Viaje (opcional)"', () => {
  it('va despues de la fecha y antes del metodo de pago, con "(opcional)" en la etiqueta', async () => {
    await mount();
    const fecha = byId('gasto-fecha')!;
    const viaje = selectViaje();
    const metodo = byId('gasto-metodo')!;
    const antes = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(antes(fecha, viaje)).toBe(true);
    expect(antes(viaje, metodo)).toBe(true);
    expect(document.querySelector('label[for="gasto-viaje"]')!.textContent).toBe('Viaje (opcional)');
    expect(viaje.getAttribute('aria-required')).toBeNull();
  });

  it('un gasto comun NO preselecciona ningun viaje: queda en "Sin viaje" (valor vacio)', async () => {
    await mount();
    expect(selectViaje().value).toBe('');
    expect(seleccionado()).toBe('Sin viaje');
  });

  it('ofrece "Sin viaje" y los 50 viajes recientes, con la etiqueta "2 oct · Pilar → Villa María" (el año solo si no es el actual)', async () => {
    await mount();
    const opciones = opcionesDelSelect();
    expect(opciones).toHaveLength(51);
    expect(opciones[0]).toEqual({ value: '', label: 'Sin viaje' });
    expect(opciones[1]!.value).toBe(V_PILAR);
    expect(opciones[1]!.label).toBe(etiquetaDeViaje(RECIENTES[0]!, todayLocal()));
    expect(opciones[1]!.label).toBe('15 ene · Pilar → Villa María'); // del año actual: sin año
    expect(opciones[2]!.label).toBe('5 mar 2020 · Rosario → Córdoba'); // de otro año: con año
    expect(opciones.slice(1).map((o) => o.value)).toEqual(RECIENTES.map((v) => v.id)); // en el orden en que llegaron
  });

  it('pide los recientes UNA vez, sin filtro de mes: fecha desc, created_at desc, tope 50', async () => {
    await mount();
    expect(recientesCalls()).toHaveLength(1);
    const call = recientesCalls()[0]!;
    expect(call.ops.find((o) => o.m === 'select')!.args).toEqual(['id, fecha, origen, destino, camion_id']);
    expect(call.ops.filter((o) => o.m === 'order').map((o) => o.args)).toEqual([
      ['fecha', { ascending: false }],
      ['created_at', { ascending: false }],
    ]);
    expect(call.ops.find((o) => o.m === 'limit')!.args).toEqual([50]);
    expect(opcionCalls()).toHaveLength(0); // sin ?viaje= no se consulta ningun viaje por id
  });

  it('con 50 recientes avisa que son los mas recientes; con menos, no', async () => {
    await mount();
    expect(bodyText()).toContain('Se muestran los 50 viajes más recientes.');
  });

  it('con menos de 50 viajes no hay aviso', async () => {
    route.recientes = () => ok(RECIENTES.slice(0, 3));
    await mount();
    expect(bodyText()).not.toContain('Se muestran los 50');
    expect(opcionesDelSelect()).toHaveLength(4);
  });

  it('sin viaje elegido el INSERT manda viaje_id = null explicito', async () => {
    await mount();
    await llenarLoMinimo();
    await guardar();
    expect(inserts()).toHaveLength(1);
    const row = payloadOf(inserts()[0]!, 'insert');
    expect(Object.prototype.hasOwnProperty.call(row, 'viaje_id')).toBe(true);
    expect(row.viaje_id).toBeNull();
    expect(row).not.toHaveProperty('transportista_id');
    expect(row).not.toHaveProperty('id');
    expect(byId('lista-de-gastos')).not.toBeNull();
  });

  it('eligiendo un viaje el INSERT lo manda', async () => {
    await mount();
    await llenarLoMinimo();
    await selectValue(selectViaje(), V_OTRO);
    expect(seleccionado()).toBe('5 mar 2020 · Rosario → Córdoba');
    await guardar();
    expect(payloadOf(inserts()[0]!, 'insert').viaje_id).toBe(V_OTRO);
  });

  it('elegir un viaje y volver a "Sin viaje" manda null', async () => {
    await mount();
    await llenarLoMinimo();
    await selectValue(selectViaje(), V_OTRO);
    await selectValue(selectViaje(), '');
    await guardar();
    expect(payloadOf(inserts()[0]!, 'insert').viaje_id).toBeNull();
  });

  it('el viaje elegido sigue como opcion (y elegido) aunque una actualizacion de la lista ya no lo traiga', async () => {
    await mount();
    await selectValue(selectViaje(), V_OTRO);
    // Aparece un viaje nuevo y el 50º (el ultimo) sale de la lista; el elegido ya no viene entre los recientes.
    const conOtroNuevo = [viajeFila(uuidViaje(300), `${ANIO_ACTUAL}-01-20`, 'Nuevo', 'Viaje'), ...RECIENTES.filter((v) => v.id !== V_OTRO).slice(0, 49)];
    route.recientes = () => ok(conOtroNuevo);
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: viajesKeys.lists('tenant-a') });
    });
    await settle(4);
    expect(recientesCalls()).toHaveLength(2);
    expect(selectViaje().value).toBe(V_OTRO); // el estado y lo que se ve coinciden
    expect(opcionesDelSelect().some((o) => o.value === V_OTRO)).toBe(true);
    expect(seleccionado()).toBe('5 mar 2020 · Rosario → Córdoba');
    await llenarLoMinimo();
    await guardar();
    expect(payloadOf(inserts()[0]!, 'insert').viaje_id).toBe(V_OTRO);
  });
});

// ---------------------------------------------------------------------------
// Si la lista de viajes no carga
// ---------------------------------------------------------------------------
describe('formulario de gasto: si la lista de viajes no carga', () => {
  it('muestra el error con "Reintentar" junto al campo y NO bloquea el guardado (se guarda sin viaje)', async () => {
    route.recientes = () => sinRed();
    await mount();
    expect(bodyText()).toContain('No pudimos cargar los viajes.');
    expect(bodyText()).toContain('No hay conexión');
    const reintentar = buttonByText('Reintentar')!;
    expect(reintentar).toBeTruthy();
    expect(reintentar.type).toBe('button'); // no envia el formulario
    expect(selectViaje()).not.toBeNull(); // el campo sigue (solo "Sin viaje")
    expect(opcionesDelSelect()).toEqual([{ value: '', label: 'Sin viaje' }]);

    await llenarLoMinimo();
    await guardar();
    expect(inserts()).toHaveLength(1);
    expect(payloadOf(inserts()[0]!, 'insert').viaje_id).toBeNull();
    expect(byId('lista-de-gastos')).not.toBeNull();
  });

  it('"Reintentar" vuelve a pedir la lista, no borra lo tipeado y, al cargar, aparecen los viajes', async () => {
    // La señal vuelve recién cuando la persona toca "Reintentar" (el formulario puede pedir la lista más de una vez
    // mientras no hay señal: al montarse, TanStack reintenta una consulta que ya había fallado).
    let conSenal = false;
    route.recientes = () => (conSenal ? ok(RECIENTES) : sinRed());
    await mount();
    await typeText(byId<HTMLInputElement>('gasto-monto'), '777');
    await click(radioOf(PEAJES_ID));
    expect(bodyText()).toContain('No pudimos cargar los viajes.');
    const pedidosAntes = recientesCalls().length;
    conSenal = true;
    await click(buttonByText('Reintentar'));
    expect(recientesCalls().length).toBe(pedidosAntes + 1);
    expect(bodyText()).not.toContain('No pudimos cargar los viajes.');
    expect(opcionesDelSelect()).toHaveLength(51);
    expect(byId<HTMLInputElement>('gasto-monto')!.value).toBe('777'); // nada de lo tipeado se perdio
    expect(radioOf(PEAJES_ID).checked).toBe(true);
  });

  it('un error de la lista NO tapa el formulario ni bloquea "Guardar gasto"', async () => {
    route.recientes = () => sinRed();
    await mount();
    expect(byId('gasto-monto')).not.toBeNull();
    expect(buttonByText('Guardar gasto')!.disabled).toBe(false);
  });

  it('un refresco fallido con la lista YA cargada no muestra ningun error ni saca las opciones', async () => {
    await mount();
    route.recientes = () => sinRed();
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: viajesKeys.recientes('tenant-a') });
    });
    await settle(4);
    expect(recientesCalls()).toHaveLength(2);
    expect(bodyText()).not.toContain('No pudimos cargar los viajes.');
    expect(opcionesDelSelect()).toHaveLength(51);
  });

  it('mientras carga dice "Cargando viajes…" y se puede guardar sin viaje', async () => {
    route.recientes = () => new Promise<Resp>(() => {}); // nunca responde
    await mount();
    expect(bodyText()).toContain('Cargando viajes…');
    expect(buttonByText('Guardar gasto')!.disabled).toBe(false);
    await llenarLoMinimo();
    await guardar();
    expect(inserts()).toHaveLength(1);
    expect(payloadOf(inserts()[0]!, 'insert').viaje_id).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Edicion
// ---------------------------------------------------------------------------
describe('formulario de gasto (edicion): el viaje vinculado', () => {
  it('trae el viaje embebido en el detalle del gasto y NO lo pide por separado', async () => {
    await mount(`/gastos/${GASTO_ID}/editar`);
    const detalle = callsTo('gastos').find((c) => c.ops.some((o) => o.m === 'maybeSingle'))!;
    const select = detalle.ops.find((o) => o.m === 'select')!.args[0] as string;
    expect(select).toContain('viaje_id');
    expect(select).toContain('viajes(id, fecha, origen, destino, camion_id)');
    expect(opcionCalls()).toHaveLength(0);
  });

  it('un viaje vinculado que NO esta entre los 50 recientes se agrega igual a las opciones y queda elegido', async () => {
    await mount(`/gastos/${GASTO_ID}/editar`);
    const opciones = opcionesDelSelect();
    expect(opciones).toHaveLength(52); // Sin viaje + el vinculado + los 50
    expect(opciones[0]).toEqual({ value: '', label: 'Sin viaje' });
    expect(opciones[1]).toEqual({ value: V_VIEJO, label: '10 abr 2021 · Salta → Tucumán' });
    expect(selectViaje().value).toBe(V_VIEJO);
    expect(seleccionado()).toBe('10 abr 2021 · Salta → Tucumán');
    expect(new Set(opciones.map((o) => o.value)).size).toBe(52); // sin duplicados
  });

  it('si el vinculado YA esta entre los recientes no se duplica', async () => {
    route.detalle = () => ok(gastoDetalle({ viaje_id: V_OTRO, viajes: RECIENTES[1] }));
    await mount(`/gastos/${GASTO_ID}/editar`);
    expect(opcionesDelSelect()).toHaveLength(51);
    expect(opcionesDelSelect().filter((o) => o.value === V_OTRO)).toHaveLength(1);
    expect(selectViaje().value).toBe(V_OTRO);
  });

  it('guardar sin tocar el viaje NO pierde el vinculo: el UPDATE manda el mismo viaje_id', async () => {
    await mount(`/gastos/${GASTO_ID}/editar`);
    await guardar();
    expect(updates()).toHaveLength(1);
    expect(payloadOf(updates()[0]!, 'update').viaje_id).toBe(V_VIEJO);
  });

  it('desvincular: elegir "Sin viaje" manda viaje_id = null EXPLICITO en el UPDATE', async () => {
    await mount(`/gastos/${GASTO_ID}/editar`);
    await selectValue(selectViaje(), '');
    await guardar();
    expect(updates()).toHaveLength(1);
    const payload = payloadOf(updates()[0]!, 'update');
    expect(Object.prototype.hasOwnProperty.call(payload, 'viaje_id')).toBe(true);
    expect(payload.viaje_id).toBeNull();
    expect(payload).not.toHaveProperty('transportista_id');
    expect(payload).not.toHaveProperty('id');
    expect(payload).not.toHaveProperty('client_ref');
  });

  it('cambiar de viaje manda el nuevo', async () => {
    await mount(`/gastos/${GASTO_ID}/editar`);
    await selectValue(selectViaje(), V_PILAR);
    await guardar();
    expect(payloadOf(updates()[0]!, 'update').viaje_id).toBe(V_PILAR);
  });

  it('un gasto SIN viaje arranca en "Sin viaje" y guardar manda null', async () => {
    route.detalle = () => ok(gastoDetalle({ viaje_id: null, viajes: null }));
    await mount(`/gastos/${GASTO_ID}/editar`);
    expect(selectViaje().value).toBe('');
    expect(opcionesDelSelect()).toHaveLength(51);
    await guardar();
    expect(payloadOf(updates()[0]!, 'update').viaje_id).toBeNull();
  });

  it('si la lista de recientes falla, el viaje YA vinculado sigue siendo elegible y se guarda sin perder el vinculo', async () => {
    route.recientes = () => sinRed();
    await mount(`/gastos/${GASTO_ID}/editar`);
    expect(bodyText()).toContain('No pudimos cargar los viajes.');
    expect(opcionesDelSelect().map((o) => o.value)).toEqual(['', V_VIEJO]);
    expect(selectViaje().value).toBe(V_VIEJO);
    await guardar();
    expect(payloadOf(updates()[0]!, 'update').viaje_id).toBe(V_VIEJO);
  });
});

// ---------------------------------------------------------------------------
// ?viaje=
// ---------------------------------------------------------------------------
describe('formulario de gasto: /gastos/nuevo?viaje=<uuid>', () => {
  it('un uuid valido de un viaje que existe llega preseleccionado (aunque no este entre los 50) y se guarda con ese viaje', async () => {
    route.opcion = () => ok(PRESELECCIONADO);
    await mount(`/gastos/nuevo?viaje=${V_PRESELECCIONADO}`);
    expect(opcionCalls()).toHaveLength(1);
    expect(opcionCalls()[0]!.ops.find((o) => o.m === 'eq')!.args).toEqual(['id', V_PRESELECCIONADO]);
    expect(selectViaje().value).toBe(V_PRESELECCIONADO);
    expect(seleccionado()).toBe('20 nov 2019 · Mendoza → San Juan');
    expect(opcionesDelSelect()[1]!.value).toBe(V_PRESELECCIONADO); // agregado arriba, fuera de los 50
    expect(opcionesDelSelect()).toHaveLength(52);

    await llenarLoMinimo();
    await guardar();
    expect(payloadOf(inserts()[0]!, 'insert').viaje_id).toBe(V_PRESELECCIONADO);
  });

  it('un uuid valido de un viaje que SI esta entre los 50 tambien llega preseleccionado y sin duplicarse', async () => {
    route.opcion = () => ok(RECIENTES[1]);
    await mount(`/gastos/nuevo?viaje=${V_OTRO}`);
    expect(selectViaje().value).toBe(V_OTRO);
    expect(opcionesDelSelect()).toHaveLength(51);
    expect(opcionesDelSelect().filter((o) => o.value === V_OTRO)).toHaveLength(1);
  });

  it('el uuid en MAYUSCULAS se acepta y se usa el id que devuelve la base', async () => {
    route.opcion = () => ok(PRESELECCIONADO);
    await mount(`/gastos/nuevo?viaje=${V_PRESELECCIONADO.toUpperCase()}`);
    expect(selectViaje().value).toBe(V_PRESELECCIONADO);
  });

  it('un valor que NO es uuid se ignora: no se consulta nada por id y no se preselecciona', async () => {
    for (const raro of ['no-es-un-uuid', '123', '', '../../etc/passwd', `${V_PRESELECCIONADO}x`, '<script>alert(1)</script>', 'null']) {
      h.calls.length = 0;
      await mount(`/gastos/nuevo?viaje=${encodeURIComponent(raro)}`);
      expect(opcionCalls(), raro).toHaveLength(0);
      expect(selectViaje().value, raro).toBe('');
      expect(seleccionado(), raro).toBe('Sin viaje');
      await act(async () => {
        root.unmount();
      });
      container.remove();
      queryClient.clear();
    }
  });

  it('un uuid que no existe (o es de otro transportista: la base no distingue) se ignora sin preseleccionar ni mostrar error', async () => {
    route.opcion = () => ok(null);
    await mount(`/gastos/nuevo?viaje=${V_INEXISTENTE}`);
    expect(opcionCalls()).toHaveLength(1);
    expect(selectViaje().value).toBe('');
    expect(opcionesDelSelect()).toHaveLength(51);
    expect(bodyText()).not.toContain('No pudimos');
    expect(byId('gasto-monto')).not.toBeNull(); // el formulario se abre igual
    await llenarLoMinimo();
    await guardar();
    expect(payloadOf(inserts()[0]!, 'insert').viaje_id).toBeNull();
  });

  it('si no se puede averiguar el viaje (sin conexion) NO se abre el formulario suelto: error con "Reintentar" y, al reintentar, llega preseleccionado', async () => {
    let intento = 0;
    route.opcion = () => {
      intento += 1;
      return intento === 1 ? sinRed() : ok(PRESELECCIONADO);
    };
    await mount(`/gastos/nuevo?viaje=${V_PRESELECCIONADO}`);
    expect(bodyText()).toContain('No hay conexión');
    expect(byId('gasto-monto')).toBeNull();
    await click(buttonByText('Reintentar'));
    await settle(4);
    expect(byId('gasto-monto')).not.toBeNull();
    expect(selectViaje().value).toBe(V_PRESELECCIONADO);
  });

  it('?viaje= no hace nada al EDITAR un gasto: manda el viaje del gasto', async () => {
    route.detalle = () => ok(gastoDetalle({ viaje_id: null, viajes: null }));
    await mount(`/gastos/${GASTO_ID}/editar?viaje=${V_PRESELECCIONADO}`);
    expect(opcionCalls()).toHaveLength(0);
    expect(selectViaje().value).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Volver al detalle del viaje
// ---------------------------------------------------------------------------
describe('formulario de gasto: abierto desde el detalle de un viaje', () => {
  const desdeDetalle = (extra: Record<string, unknown> = {}): InitialEntry => ({
    pathname: '/gastos/nuevo',
    search: `?viaje=${V_PILAR}`,
    state: { desdeViaje: V_PILAR, volverViaje: '?mes=2025-06', ...extra },
  });

  it('alta: guardar vuelve al DETALLE de ESE viaje (con el aviso "gasto-guardado" y el mes para su enlace)', async () => {
    route.opcion = () => ok(RECIENTES[0]);
    await mount(desdeDetalle());
    expect(selectViaje().value).toBe(V_PILAR);
    await llenarLoMinimo();
    await guardar();
    expect(inserts()).toHaveLength(1);
    const detalle = byId('detalle-del-viaje')!;
    expect(detalle).not.toBeNull();
    expect(detalle.dataset.path).toBe(`/viajes/${V_PILAR}`);
    expect(detalle.dataset.aviso).toBe('gasto-guardado');
    expect(detalle.dataset.volver).toBe('?mes=2025-06');
    expect(byId('lista-de-gastos')).toBeNull();
  });

  it('el enlace "volver" lleva al detalle de ese viaje (no a Gastos) y conserva el mes', async () => {
    route.opcion = () => ok(RECIENTES[0]);
    await mount(desdeDetalle());
    const volver = document.querySelector<HTMLAnchorElement>(`a[href="/viajes/${V_PILAR}"]`)!;
    expect(volver).not.toBeNull();
    expect(volver.textContent).toContain('Viaje');
    expect(document.querySelector('a[href^="/gastos"]')).toBeNull();
    await click(volver);
    expect(byId('detalle-del-viaje')!.dataset.volver).toBe('?mes=2025-06');
  });

  it('edicion: guardar vuelve al detalle de ese viaje', async () => {
    await mount({
      pathname: `/gastos/${GASTO_ID}/editar`,
      state: { desdeViaje: V_VIEJO, volverViaje: '?mes=2025-06' },
    });
    await guardar();
    expect(updates()).toHaveLength(1);
    expect(byId('detalle-del-viaje')!.dataset.path).toBe(`/viajes/${V_VIEJO}`);
    expect(byId('detalle-del-viaje')!.dataset.aviso).toBe('gasto-guardado');
  });

  it('borrar el gasto vuelve al detalle de ese viaje con "gasto-eliminado"', async () => {
    await mount({
      pathname: `/gastos/${GASTO_ID}/editar`,
      state: { desdeViaje: V_VIEJO, volverViaje: '?mes=2025-06' },
    });
    await click(buttonByText('Eliminar gasto'));
    await click(buttonByText('Sí, eliminar'));
    await settle(4);
    expect(callsTo('gastos').some((c) => c.ops.some((o) => o.m === 'delete'))).toBe(true);
    const detalle = byId('detalle-del-viaje')!;
    expect(detalle.dataset.path).toBe(`/viajes/${V_VIEJO}`);
    expect(detalle.dataset.aviso).toBe('gasto-eliminado');
    expect(detalle.dataset.volver).toBe('?mes=2025-06');
    expect(byId('lista-de-gastos')).toBeNull();
  });

  it('sin desdeViaje todo funciona como hoy: guardar vuelve a /gastos (con el mes del gasto) y "volver" lleva a /gastos', async () => {
    await mount({ pathname: '/gastos/nuevo', state: { volver: '?mes=2025-06' } });
    expect(document.querySelector('a[href="/gastos?mes=2025-06"]')).not.toBeNull();
    await llenarLoMinimo();
    await guardar();
    expect(byId('lista-de-gastos')!.dataset.aviso).toBe('guardado');
    expect(byId('detalle-del-viaje')).toBeNull();
  });

  it('con ?viaje= pero SIN desdeViaje (un enlace pegado a mano) el viaje llega preseleccionado y se vuelve a /gastos', async () => {
    route.opcion = () => ok(RECIENTES[0]);
    await mount(`/gastos/nuevo?viaje=${V_PILAR}`);
    expect(selectViaje().value).toBe(V_PILAR);
    await llenarLoMinimo();
    await guardar();
    expect(byId('lista-de-gastos')).not.toBeNull();
    expect(byId('detalle-del-viaje')).toBeNull();
  });

  it('lista blanca: un desdeViaje que NO es un uuid (ruta, URL, objeto) se ignora y se vuelve a /gastos', async () => {
    for (const basura of ['/gastos', '//evil.com', 'https://evil.com/x', `/viajes/${V_PILAR}`, { id: V_PILAR }, [V_PILAR], 42, true, null]) {
      h.calls.length = 0;
      await mount({ pathname: '/gastos/nuevo', state: { desdeViaje: basura, volverViaje: '?mes=2025-06' } });
      expect(document.querySelector('a[href="/gastos"]'), JSON.stringify(basura)).not.toBeNull();
      expect(document.querySelector('a[href^="/viajes"]'), JSON.stringify(basura)).toBeNull();
      await llenarLoMinimo();
      await guardar();
      expect(byId('lista-de-gastos')?.dataset.aviso, JSON.stringify(basura)).toBe('guardado');
      expect(byId('detalle-del-viaje'), JSON.stringify(basura)).toBeNull();
      await act(async () => {
        root.unmount();
      });
      container.remove();
      queryClient.clear();
    }
  });

  it('nunca navega a algo que venga del estado: ni siquiera un volverViaje raro altera la ruta del detalle', async () => {
    route.opcion = () => ok(RECIENTES[0]);
    await mount(desdeDetalle({ volverViaje: '//evil.com' }));
    await llenarLoMinimo();
    await guardar();
    const detalle = byId('detalle-del-viaje')!;
    expect(detalle.dataset.path).toBe(`/viajes/${V_PILAR}`);
    expect(detalle.dataset.volver).toBe(''); // saneado: el search raro se descarto
  });

  it('si el guardado falla se queda en el formulario (no vuelve al detalle)', async () => {
    route.opcion = () => ok(RECIENTES[0]);
    route.insertar = () => sinRed();
    await mount(desdeDetalle());
    await llenarLoMinimo();
    await guardar();
    expect(byId('detalle-del-viaje')).toBeNull();
    expect(bodyText()).toContain('No hay conexión');
    expect(byId<HTMLInputElement>('gasto-monto')!.value).toBe('800');
  });
});

// ---------------------------------------------------------------------------
// Errores al guardar
// ---------------------------------------------------------------------------
describe('formulario de gasto: el 23503 segun el constraint', () => {
  const MSG_FK_VIAJE = 'insert or update on table "gastos" violates foreign key constraint "gastos_viaje_fk"';
  const MSG_CATEGORIA = 'La categoría de gasto no es válida para este transportista';

  it('el viaje elegido ya no existe: mensaje del viaje (sin el nombre del constraint), sin "Reintentar", lo tipeado queda y se vuelve a pedir la lista de recientes', async () => {
    route.insertar = () => fail('23503', MSG_FK_VIAJE, 'Key (transportista_id, viaje_id)=(...) is not present in table "viajes".');
    await mount();
    await llenarLoMinimo();
    await selectValue(selectViaje(), V_OTRO);
    expect(recientesCalls()).toHaveLength(1);
    await guardar();

    expect(bodyText()).toContain('El viaje elegido ya no existe. Elige otro o déjalo sin viaje.');
    expect(bodyText()).not.toContain('La categoría elegida ya no está disponible');
    expect(bodyText()).not.toContain('gastos_viaje_fk');
    expect(buttonByText('Reintentar')).toBeUndefined();
    expect(byId('lista-de-gastos')).toBeNull();
    expect(byId<HTMLInputElement>('gasto-monto')!.value).toBe('800');
    expect(recientesCalls()).toHaveLength(2); // se invalido la lista de viajes recientes
    // El viaje elegido sigue visible y elegido (no se vuelve "Sin viaje" por detras): se puede cambiar o dejar sin viaje.
    expect(selectViaje().value).toBe(V_OTRO);
  });

  it('despues del error se puede elegir "Sin viaje" y guardar', async () => {
    let intento = 0;
    route.insertar = () => {
      intento += 1;
      return intento === 1 ? fail('23503', MSG_FK_VIAJE) : ok(null);
    };
    await mount();
    await llenarLoMinimo();
    await selectValue(selectViaje(), V_OTRO);
    await guardar();
    expect(bodyText()).toContain('El viaje elegido ya no existe.');
    await selectValue(selectViaje(), '');
    await guardar();
    expect(inserts()).toHaveLength(2);
    expect(payloadOf(inserts()[1]!, 'insert').viaje_id).toBeNull();
    expect(byId('lista-de-gastos')).not.toBeNull();
  });

  it('el nombre del constraint puede venir solo en los details', async () => {
    route.insertar = () => fail('23503', 'violates foreign key constraint', 'constraint "gastos_viaje_fk" on table "gastos"');
    await mount();
    await llenarLoMinimo();
    await selectValue(selectViaje(), V_OTRO);
    await guardar();
    expect(bodyText()).toContain('El viaje elegido ya no existe. Elige otro o déjalo sin viaje.');
  });

  it('edicion: el viaje vinculado ya no existe -> el mismo mensaje y se invalida la lista de recientes', async () => {
    route.actualizar = () => fail('23503', MSG_FK_VIAJE);
    await mount(`/gastos/${GASTO_ID}/editar`);
    await guardar();
    expect(bodyText()).toContain('El viaje elegido ya no existe. Elige otro o déjalo sin viaje.');
    expect(recientesCalls()).toHaveLength(2);
  });

  it('el 23503 de la CATEGORIA (el trigger, sin constraint) sigue igual: mensaje de categoria y NO se vuelve a pedir la lista de viajes', async () => {
    route.insertar = () => fail('23503', MSG_CATEGORIA);
    await mount();
    await llenarLoMinimo();
    await selectValue(selectViaje(), V_OTRO);
    await guardar();
    expect(bodyText()).toContain('La categoría elegida ya no está disponible. Elige otra.');
    expect(bodyText()).not.toContain('El viaje elegido ya no existe');
    expect(recientesCalls()).toHaveLength(1);
    expect(buttonByText('Reintentar')).toBeUndefined();
  });

  it('otros errores (red) siguen igual: "Reintentar" reenvia lo mismo y NO invalida los viajes', async () => {
    let intento = 0;
    route.insertar = () => {
      intento += 1;
      return intento === 1 ? sinRed() : ok(null);
    };
    await mount();
    await llenarLoMinimo();
    await selectValue(selectViaje(), V_OTRO);
    await guardar();
    expect(bodyText()).toContain('No hay conexión');
    expect(recientesCalls()).toHaveLength(1);
    await click(buttonByText('Reintentar'));
    await settle(4);
    expect(inserts()).toHaveLength(2);
    expect(payloadOf(inserts()[1]!, 'insert').viaje_id).toBe(V_OTRO);
    expect(payloadOf(inserts()[1]!, 'insert').client_ref).toBe(payloadOf(inserts()[0]!, 'insert').client_ref);
  });
});
