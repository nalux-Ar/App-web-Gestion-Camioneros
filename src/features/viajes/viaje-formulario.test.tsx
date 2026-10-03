import { act, useMemo, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation, type InitialEntry } from 'react-router';
import { QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock de supabase: registra cada pedido (tabla o función rpc + operaciones encadenadas) y responde según
// `route`. TODO lo demás (formulario, hooks, TanStack Query, router, validación) es código REAL del proyecto.
// ---------------------------------------------------------------------------
type Op = { m: string; args: unknown[] };
type Call = { target: string; ops: Op[] };

const h = vi.hoisted(() => {
  const calls: Array<{ target: string; ops: Array<{ m: string; args: unknown[] }> }> = [];
  const state = { responder: null as null | ((call: { target: string; ops: Array<{ m: string; args: unknown[] }> }) => unknown) };
  function builder(target: string, firstOp?: { m: string; args: unknown[] }) {
    const call = { target, ops: firstOp ? [firstOp] : ([] as Array<{ m: string; args: unknown[] }>) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {};
    for (const m of ['select', 'update', 'insert', 'delete', 'eq', 'abortSignal', 'order', 'limit', 'gte', 'lt', 'maybeSingle', 'single']) {
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
import { ViajeFormPage } from '@/features/viajes/viaje-form-page';
import { entregaDomId } from '@/features/viajes/viaje-dom-ids';
import { devolucionesKeys } from '@/features/devoluciones/devoluciones-keys';
import { gastosKeys } from '@/features/gastos/gastos-keys';
import { viajesKeys } from '@/features/viajes/viajes-keys';
import { todayLocal } from '@/lib/dates';
import { queryClient } from '@/lib/query-client';

// ---------------------------------------------------------------------------
// "Base de datos" falsa y rutas
// ---------------------------------------------------------------------------
type Resp = {
  data: unknown;
  /** Solo en la consulta de conteo (`select(..., { count: 'exact', head: true })`). */
  count?: number | null;
  error: { message: string; code: string; details?: string; hint?: string } | null;
  status: number;
};
const ok = (data: unknown): Resp => ({ data, error: null, status: 200 });
/** La respuesta de un conteo exacto con `head: true`: sin filas, con el número aparte. */
const conteo = (count: number): Resp => ({ data: null, count, error: null, status: 200 });
const fail = (code: string, message = 'falla', status = 400): Resp => ({ data: null, error: { code, message, details: '', hint: '' }, status });
/** Una falla de red como la que arma supabase-js: sin código de servidor. */
const sinRed = (): Resp => ({ data: null, error: { code: '', message: 'TypeError: Failed to fetch' }, status: 0 });

const C_ALMACEN = 'a0000000-0000-4000-8000-000000000001';
const C_FRIGO = 'a0000000-0000-4000-8000-000000000002';
const VIAJE_ID = 'b0000000-0000-4000-8000-000000000001';
const CAMION_ID = 'c0000000-0000-4000-8000-000000000001';
const E_1 = 'd0000000-0000-4000-8000-000000000001';
const E_2 = 'd0000000-0000-4000-8000-000000000002';
const G_ID = 'e0000000-0000-4000-8000-000000000001';
const NUEVO_VIAJE_ID = 'b0000000-0000-4000-8000-0000000000ff';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const MIEMBRO = {
  rol: 'admin',
  tema: 'dark',
  color_acento: '#F59E0B',
  transportista_id: 'tenant-a',
  transportistas: { nombre: 'Transportes A' },
};

const db = {
  clientes: [] as Array<{ id: string; nombre: string }>,
};

type Handler = (call: Call) => unknown;
const route: {
  clientes: Handler;
  insertCliente: Handler;
  crear: Handler;
  actualizar: Handler;
  detalle: Handler;
  borrar: Handler;
  /** `select('id', { count: 'exact', head: true })` sobre gastos: cuántos gastos tiene el viaje. */
  contarGastos: Handler;
  /** El mismo conteo sobre devoluciones: cuántas devoluciones tiene el viaje (se borran en cascada con él). */
  contarDevoluciones: Handler;
  /** `update gastos set viaje_id = null where viaje_id = ?`. */
  desvincular: Handler;
} = {
  clientes: () => ok(db.clientes),
  insertCliente: () => {
    throw new Error('insertCliente sin definir');
  },
  crear: () => ok([{ viaje_id: NUEVO_VIAJE_ID, creado: true }]),
  actualizar: () => ok(null),
  detalle: () => ok(null),
  borrar: () => ok([{ id: VIAJE_ID }]),
  contarGastos: () => conteo(0),
  contarDevoluciones: () => conteo(0),
  desvincular: () => ok([]),
};

function resetRoutes() {
  db.clientes = [
    { id: C_ALMACEN, nombre: 'Almacén Central' },
    { id: C_FRIGO, nombre: 'Frigorífico Sur' },
  ];
  route.clientes = () => ok(db.clientes);
  route.insertCliente = () => {
    throw new Error('insertCliente sin definir');
  };
  route.crear = () => ok([{ viaje_id: NUEVO_VIAJE_ID, creado: true }]);
  route.actualizar = () => ok(null);
  route.detalle = () => ok(null);
  route.borrar = () => ok([{ id: VIAJE_ID }]);
  route.contarGastos = () => conteo(0);
  route.contarDevoluciones = () => conteo(0);
  route.desvincular = () => ok([]);
}

function installResponder() {
  h.state.responder = (call: Call) => {
    const has = (m: string) => call.ops.some((o) => o.m === m);
    if (call.target === 'miembros' && has('maybeSingle')) return ok(MIEMBRO);
    if (call.target === 'clientes') return has('insert') ? route.insertCliente(call) : route.clientes(call);
    if (call.target === 'rpc:crear_viaje_con_entregas') return route.crear(call);
    if (call.target === 'rpc:actualizar_viaje_con_entregas') return route.actualizar(call);
    if (call.target === 'viajes') return has('delete') ? route.borrar(call) : route.detalle(call);
    if (call.target === 'gastos') return has('update') ? route.desvincular(call) : route.contarGastos(call);
    // Las devoluciones solo se CUENTAN desde esta pantalla: se borran en cascada por la base, sin un paso del front.
    if (call.target === 'devoluciones') {
      if (has('select') && !has('update') && !has('delete') && !has('insert')) return route.contarDevoluciones(call);
    }
    throw new Error(`pedido inesperado: ${call.target} ${call.ops.map((o) => o.m).join('.')}`);
  };
}

const detalleViaje = (over: Record<string, unknown> = {}) => ({
  id: VIAJE_ID,
  camion_id: CAMION_ID,
  fecha: '2025-06-15',
  origen: 'Rosario',
  destino: 'Córdoba',
  km_inicial: null,
  km_final: null,
  km_recorridos: 640.5,
  ingreso: 1500,
  observaciones: 'Todo bien',
  entregas: [
    { id: E_1, cliente_id: C_ALMACEN, incidencias: 'Golpe en un pallet', created_at: '2025-06-15T10:00:00.001Z' },
    { id: E_2, cliente_id: C_FRIGO, incidencias: null, created_at: '2025-06-15T10:00:00.002Z' },
  ],
  ...over,
});

const callsTo = (target: string) => h.calls.filter((c) => c.target === target);
const rpcArgs = (call: Call) => call.ops.find((o) => o.m === 'rpc')!.args[0] as Record<string, unknown>;
const crearCalls = () => callsTo('rpc:crear_viaje_con_entregas');
const actualizarCalls = () => callsTo('rpc:actualizar_viaje_con_entregas');
const clientesListados = () => h.calls.filter((c) => c.target === 'clientes' && !c.ops.some((o) => o.m === 'insert'));
const clientesInsertados = () => h.calls.filter((c) => c.target === 'clientes' && c.ops.some((o) => o.m === 'insert'));
/** Lo que pasó con los gastos y el viaje al borrar, en orden: el conteo de la confirmación, el UPDATE que desvincula y el DELETE. */
const secuenciaDeBorrado = () =>
  h.calls.flatMap((c) => {
    const has = (m: string) => c.ops.some((o) => o.m === m);
    if (c.target === 'gastos') return [has('update') ? 'desvincular' : 'conteo'];
    if (c.target === 'viajes' && has('delete')) return ['borrar'];
    return [];
  });

/**
 * Lo mismo, pero con los conteos de devoluciones: cada confirmación pide los DOS conteos (gastos y devoluciones, en ese
 * orden). Las devoluciones nunca reciben un UPDATE ni un DELETE desde acá: se borran en cascada con el viaje.
 */
const secuenciaCompleta = () =>
  h.calls.flatMap((c) => {
    const has = (m: string) => c.ops.some((o) => o.m === m);
    if (c.target === 'gastos') return [has('update') ? 'desvincular' : 'conteo-gastos'];
    if (c.target === 'devoluciones') return [has('select') && !has('update') && !has('delete') ? 'conteo-devoluciones' : 'ESCRITURA-EN-DEVOLUCIONES'];
    if (c.target === 'viajes' && has('delete')) return ['borrar'];
    return [];
  });

// ---------------------------------------------------------------------------
// Árbol de prueba
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

/** La lista de viajes de mentira: deja a la vista a dónde se navegó y con qué aviso. */
function ListaProbe() {
  const location = useLocation();
  const aviso = (location.state as { aviso?: string } | null)?.aviso ?? '';
  return (
    <div id="lista-de-viajes" data-search={location.search} data-aviso={aviso}>
      lista
    </div>
  );
}

/** El detalle del viaje de mentira: deja a la vista a dónde se navegó, con qué aviso y con qué `volver`. */
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

async function mount(entry: InitialEntry = '/viajes/nuevo') {
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
                  <Route path="/viajes/nuevo" element={<ViajeFormPage modo="nuevo" />} />
                  <Route path="/viajes/:id/editar" element={<ViajeFormPage modo="editar" />} />
                  <Route path="/viajes/:id" element={<DetalleProbe />} />
                  <Route path="/viajes" element={<ListaProbe />} />
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
const labelOf = (controlId: string) => document.querySelector<HTMLLabelElement>(`label[for="${controlId}"]`);
const selectsDeCliente = () => [...document.querySelectorAll<HTMLSelectElement>('select[id^="entrega-"][id$="-cliente"]')];
const textareasDeIncidencias = () => [...document.querySelectorAll<HTMLTextAreaElement>('textarea[id^="entrega-"][id$="-incidencias"]')];
const radio = (label: string) =>
  [...document.querySelectorAll<HTMLInputElement>('input[type="radio"]')].find((r) => r.closest('label')?.textContent?.includes(label))!;
const titulosDeEntrega = () => [...document.querySelectorAll('h3')].map((e) => e.textContent);

async function click(el: HTMLElement | null | undefined) {
  if (!el) throw new Error('no se encontró el elemento a tocar');
  await act(async () => {
    el.click();
  });
  await settle(3);
}
async function typeText(el: HTMLInputElement | HTMLTextAreaElement | null, value: string) {
  if (!el) throw new Error('no se encontró el campo');
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function typeById(id: string, value: string) {
  await typeText(byId<HTMLInputElement>(id), value);
}
async function selectValue(el: HTMLSelectElement | null | undefined, value: string) {
  if (!el) throw new Error('no se encontró el selector');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
async function guardar() {
  await act(async () => {
    buttonByText('Guardar viaje')!.click();
  });
  await settle(6);
}
async function llenarLoMinimo() {
  await typeById('viaje-origen', 'Rosario');
  await typeById('viaje-destino', 'Córdoba');
}
async function agregarEntrega() {
  await click(buttonByText('Agregar entrega'));
}
/** Abre la confirmación de borrar el viaje y la acepta (con el conteo de gastos que dé `route.contarGastos`). */
async function eliminarViajeConfirmando() {
  await click(buttonByText('Eliminar viaje'));
  await click(buttonByText('Sí, eliminar'));
  await settle(4);
}

beforeEach(() => {
  h.calls.length = 0;
  resetRoutes();
  installResponder();
  localStorage.clear();
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  // Si una prueba "sin señal" falló a mitad de camino, TanStack quedó creyendo que no hay red: se restablece
  // directamente (entre pruebas no hay árbol montado, así que nadie escucha el evento 'online').
  onlineManager.setOnline(true);
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
  // Ninguna prueba debe dejar warnings de React (act, anidamiento inválido de DOM, keys...).
  expect(errorSpy.mock.calls.map((c: unknown[]) => String(c[0]))).toEqual([]);
  errorSpy.mockRestore();
});

// ---------------------------------------------------------------------------
// Estructura y kilometraje
// ---------------------------------------------------------------------------
describe('formulario de viaje: estructura', () => {
  it('orden en pantalla: Fecha, Origen, Destino, Kilometraje, Km, Ingreso, Observaciones, Entregas y Guardar', async () => {
    await mount();
    const orden = [
      byId('viaje-fecha'),
      byId('viaje-origen'),
      byId('viaje-destino'),
      byId('viaje-km-modo-0')!.closest('fieldset'),
      byId('viaje-km-inicial'),
      byId('viaje-km-final'),
      byId('viaje-ingreso'),
      byId('viaje-observaciones'),
      byId('viaje-entregas'),
      buttonByText('Agregar entrega'),
      buttonByText('Guardar viaje'),
    ];
    expect(orden.every(Boolean)).toBe(true);
    for (let i = 0; i < orden.length - 1; i++) {
      expect(!!(orden[i]!.compareDocumentPosition(orden[i + 1]!) & Node.DOCUMENT_POSITION_FOLLOWING), `posición ${i}`).toBe(true);
    }
  });

  it('la fecha arranca en hoy (hora local) con rango 2000-01-01 .. hoy; origen y destino son obligatorios; ingreso y observaciones, opcionales', async () => {
    await mount();
    const fecha = byId<HTMLInputElement>('viaje-fecha')!;
    expect(fecha.value).toBe(todayLocal());
    expect(fecha.min).toBe('2000-01-01');
    expect(fecha.max).toBe(todayLocal());
    expect(labelOf('viaje-origen')!.textContent).toBe('Origen');
    expect(byId('viaje-origen')!.getAttribute('aria-required')).toBe('true');
    expect(byId('viaje-destino')!.getAttribute('aria-required')).toBe('true');
    expect(labelOf('viaje-ingreso')!.textContent).toContain('(opcional)');
    expect(labelOf('viaje-observaciones')!.textContent).toContain('(opcional)');
  });

  it('teclado numérico (inputMode decimal) en los km y el ingreso', async () => {
    await mount();
    for (const id of ['viaje-km-inicial', 'viaje-km-final', 'viaje-ingreso']) {
      expect(byId<HTMLInputElement>(id)!.inputMode, id).toBe('decimal');
    }
  });

  it('no manda nada a la base al abrirse, salvo la lista de clientes (y no hay "no encontrado")', async () => {
    await mount();
    expect(crearCalls()).toHaveLength(0);
    expect(clientesListados()).toHaveLength(1);
    expect(bodyText()).not.toContain('Viaje no encontrado');
  });
});

describe('formulario de viaje: modo de kilometraje', () => {
  it('por defecto "Inicial y final" (km inicial y final, sin recorridos); al elegir "Recorridos" queda un solo campo', async () => {
    await mount();
    expect(radio('Inicial y final').checked).toBe(true);
    expect(radio('Recorridos').checked).toBe(false);
    expect(byId('viaje-km-inicial')).not.toBeNull();
    expect(byId('viaje-km-final')).not.toBeNull();
    expect(byId('viaje-km-recorridos')).toBeNull();

    await click(radio('Recorridos'));
    expect(radio('Recorridos').checked).toBe(true);
    expect(byId('viaje-km-inicial')).toBeNull();
    expect(byId('viaje-km-final')).toBeNull();
    expect(byId('viaje-km-recorridos')).not.toBeNull();
    expect(labelOf('viaje-km-recorridos')!.textContent).toContain('Km recorridos');
  });

  it('al volver de modo se conserva lo tipeado en cada uno', async () => {
    await mount();
    await typeById('viaje-km-inicial', '1200');
    await typeById('viaje-km-final', '1850');
    await click(radio('Recorridos'));
    await typeById('viaje-km-recorridos', '650');
    await click(radio('Inicial y final'));
    expect(byId<HTMLInputElement>('viaje-km-inicial')!.value).toBe('1200');
    expect(byId<HTMLInputElement>('viaje-km-final')!.value).toBe('1850');
    await click(radio('Recorridos'));
    expect(byId<HTMLInputElement>('viaje-km-recorridos')!.value).toBe('650');
  });

  it('del modo inactivo se manda null aunque haya texto: Recorridos activo -> inicial y final en null', async () => {
    await mount();
    await llenarLoMinimo();
    await typeById('viaje-km-inicial', '1200');
    await typeById('viaje-km-final', '1850');
    await click(radio('Recorridos'));
    await typeById('viaje-km-recorridos', '650,5');
    await guardar();
    expect(crearCalls()).toHaveLength(1);
    const args = rpcArgs(crearCalls()[0]!);
    expect(args.p_km_inicial).toBeNull();
    expect(args.p_km_final).toBeNull();
    expect(args.p_km_recorridos).toBe(650.5);
  });

  it('del modo inactivo se manda null: Inicial y final activo -> recorridos en null', async () => {
    await mount();
    await llenarLoMinimo();
    await click(radio('Recorridos'));
    await typeById('viaje-km-recorridos', '650');
    await click(radio('Inicial y final'));
    await typeById('viaje-km-inicial', '1200');
    await typeById('viaje-km-final', '1850,5');
    await guardar();
    const args = rpcArgs(crearCalls()[0]!);
    expect([args.p_km_inicial, args.p_km_final, args.p_km_recorridos]).toEqual([1200, 1850.5, null]);
  });

  it('solo el km inicial es válido (viaje en curso): se guarda con el final en null', async () => {
    await mount();
    await llenarLoMinimo();
    await typeById('viaje-km-inicial', '1200');
    await guardar();
    const args = rpcArgs(crearCalls()[0]!);
    expect([args.p_km_inicial, args.p_km_final, args.p_km_recorridos]).toEqual([1200, null, null]);
  });
});

// ---------------------------------------------------------------------------
// Validación y foco
// ---------------------------------------------------------------------------
describe('formulario de viaje: validación y foco', () => {
  it('enviar vacío: errores en español en origen y destino, foco en el primero (origen) y NO se manda nada', async () => {
    await mount();
    await guardar();
    expect(bodyText()).toContain('Escribe el origen del viaje.');
    expect(bodyText()).toContain('Escribe el destino del viaje.');
    expect(byId('viaje-origen')!.getAttribute('aria-invalid')).toBe('true');
    expect(byId('viaje-origen')!.getAttribute('aria-describedby')).toContain('viaje-origen-error');
    expect(document.activeElement?.id).toBe('viaje-origen');
    expect(crearCalls()).toHaveLength(0);
    expect(byId('lista-de-viajes')).toBeNull(); // sigue en el formulario
  });

  it('al corregir un campo se descarta su error y el foco avanza al siguiente error en orden visual', async () => {
    await mount();
    await guardar();
    await typeById('viaje-origen', 'Rosario');
    expect(bodyText()).not.toContain('Escribe el origen del viaje.');
    expect(bodyText()).toContain('Escribe el destino del viaje.'); // el otro sigue hasta tocarlo
    await guardar();
    expect(document.activeElement?.id).toBe('viaje-destino');
  });

  it('km final SIN inicial: "Carga el km inicial." en el inicial, con foco ahí', async () => {
    await mount();
    await llenarLoMinimo();
    await typeById('viaje-km-final', '1850');
    await guardar();
    expect(bodyText()).toContain('Carga el km inicial.');
    expect(document.activeElement?.id).toBe('viaje-km-inicial');
    expect(byId('viaje-km-inicial')!.getAttribute('aria-invalid')).toBe('true');
    expect(crearCalls()).toHaveLength(0);
  });

  it('km final MENOR que el inicial: error en el final, con foco ahí', async () => {
    await mount();
    await llenarLoMinimo();
    await typeById('viaje-km-inicial', '1850');
    await typeById('viaje-km-final', '1200');
    await guardar();
    expect(bodyText()).toContain('El km final no puede ser menor que el inicial.');
    expect(document.activeElement?.id).toBe('viaje-km-final');
    expect(crearCalls()).toHaveLength(0);
  });

  it('cambiar de modo descarta los errores de km del modo que se oculta', async () => {
    await mount();
    await llenarLoMinimo();
    await typeById('viaje-km-final', '1850');
    await guardar();
    expect(bodyText()).toContain('Carga el km inicial.');
    await click(radio('Recorridos'));
    expect(bodyText()).not.toContain('Carga el km inicial.');
    // Al volver al modo donde estaba el error, NO reaparece (era del intento anterior): se descartó al cambiar de modo.
    await click(radio('Inicial y final'));
    expect(bodyText()).not.toContain('Carga el km inicial.');
    expect(byId('viaje-km-inicial')!.getAttribute('aria-invalid')).toBeNull();
    await click(radio('Recorridos'));
    await guardar(); // en modo Recorridos vacío es válido: el final tipeado no se envía
    expect(crearCalls()).toHaveLength(1);
    expect(rpcArgs(crearCalls()[0]!).p_km_final).toBeNull();
  });

  it('ingreso con 3 decimales: error y foco en el ingreso (el campo no deja tipear un "-"); el ingreso 0 se acepta y se manda como 0', async () => {
    await mount();
    await llenarLoMinimo();
    await typeById('viaje-ingreso', '10,555');
    await guardar();
    expect(bodyText()).toContain('Usa hasta 2 decimales.');
    expect(document.activeElement?.id).toBe('viaje-ingreso');
    expect(byId('viaje-ingreso')!.getAttribute('aria-invalid')).toBe('true');
    expect(crearCalls()).toHaveLength(0);
    await typeById('viaje-ingreso', '0');
    await guardar();
    expect(rpcArgs(crearCalls()[0]!).p_ingreso).toBe(0);
  });

  it('observaciones: contador desde 1800 y error por encima de 2000', async () => {
    await mount();
    await llenarLoMinimo();
    await typeText(byId<HTMLTextAreaElement>('viaje-observaciones'), 'x'.repeat(1900));
    expect(bodyText()).toContain('1900 de 2000 caracteres');
    await typeText(byId<HTMLTextAreaElement>('viaje-observaciones'), 'x'.repeat(2001));
    expect(bodyText()).toContain('Más de 2000 caracteres: acórtalas.');
    await guardar();
    expect(document.activeElement?.id).toBe('viaje-observaciones');
    expect(crearCalls()).toHaveLength(0);
  });

  it('una fila de entrega sin cliente: "Elige un cliente." DENTRO de esa fila y foco en su selector', async () => {
    await mount();
    await llenarLoMinimo();
    await agregarEntrega();
    await agregarEntrega();
    const [primero, segundo] = selectsDeCliente();
    await selectValue(primero, C_ALMACEN);
    await guardar();
    expect(crearCalls()).toHaveLength(0);
    const fila2 = segundo!.closest('[role="group"]')!;
    expect(fila2.textContent).toContain('Elige un cliente.');
    expect(primero!.closest('[role="group"]')!.textContent).not.toContain('Elige un cliente.');
    expect(document.activeElement).toBe(segundo);
    expect(segundo!.getAttribute('aria-invalid')).toBe('true');
    // Al elegir, el error de ESA fila desaparece.
    await selectValue(segundo, C_FRIGO);
    expect(bodyText()).not.toContain('Elige un cliente.');
  });

  it('el foco sigue el orden visual: un error de campo gana sobre el de una fila de entrega', async () => {
    await mount();
    await typeById('viaje-destino', 'Córdoba'); // falta el origen
    await agregarEntrega(); // y la fila no tiene cliente
    await guardar();
    expect(document.activeElement?.id).toBe('viaje-origen');
  });

  it('incidencias de más de 2000 caracteres: error en esa fila, con foco en su campo', async () => {
    await mount();
    await llenarLoMinimo();
    await agregarEntrega();
    await selectValue(selectsDeCliente()[0], C_ALMACEN);
    await typeText(textareasDeIncidencias()[0]!, 'x'.repeat(2001));
    await guardar();
    expect(bodyText()).toContain('Las incidencias pueden tener hasta 2000 caracteres.');
    expect(document.activeElement).toBe(textareasDeIncidencias()[0]);
    expect(crearCalls()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Entregas
// ---------------------------------------------------------------------------
describe('formulario de viaje: entregas', () => {
  it('se puede guardar un viaje con CERO entregas (no se exige una mínima)', async () => {
    await mount();
    await llenarLoMinimo();
    await guardar();
    expect(crearCalls()).toHaveLength(1);
    expect(rpcArgs(crearCalls()[0]!).p_entregas).toEqual([]);
  });

  it('agregar y quitar filas: título y numeración, y la fila que queda conserva lo que tenía (clave estable)', async () => {
    await mount();
    expect(titulosDeEntrega()).toEqual([]);
    await agregarEntrega();
    await agregarEntrega();
    expect(titulosDeEntrega()).toEqual(['Entrega 1', 'Entrega 2']);
    expect(document.activeElement).toBe(selectsDeCliente()[1]); // la fila nueva se lleva el foco

    await selectValue(selectsDeCliente()[1], C_FRIGO);
    await typeText(textareasDeIncidencias()[1]!, 'Faltó mercadería');
    await click(buttonByText('Quitar')); // quita la PRIMERA

    expect(titulosDeEntrega()).toEqual(['Entrega 1']);
    expect(selectsDeCliente()).toHaveLength(1);
    expect(selectsDeCliente()[0]!.value).toBe(C_FRIGO);
    expect(textareasDeIncidencias()[0]!.value).toBe('Faltó mercadería');
    // Al quitar, el foco no se pierde: va al botón de agregar.
    expect(document.activeElement).toBe(buttonByText('Agregar entrega'));
    expect(bodyText()).toContain('Entrega quitada. Hay 1 entrega.'); // aviso a lectores de pantalla
  });

  it('cada fila tiene un "Quitar" con nombre accesible propio y un objetivo táctil de al menos 48 px (h-12)', async () => {
    await mount();
    await agregarEntrega();
    await agregarEntrega();
    const quitar = buttons().filter((b) => b.textContent?.includes('Quitar'));
    expect(quitar.map((b) => b.getAttribute('aria-label'))).toEqual(['Quitar entrega 1', 'Quitar entrega 2']);
    for (const b of quitar) expect(b.className).toContain('h-12');
    expect(buttonByText('Agregar entrega')!.className).toContain('h-12');
    expect(buttonByText('Nuevo cliente')!.className).toContain('h-12');
  });

  it('el orden de carga se respeta y un mismo cliente puede estar en dos filas', async () => {
    await mount();
    await llenarLoMinimo();
    await agregarEntrega();
    await agregarEntrega();
    await agregarEntrega();
    const [a, b, c] = selectsDeCliente();
    await selectValue(a, C_FRIGO);
    await selectValue(b, C_ALMACEN);
    await selectValue(c, C_FRIGO);
    await typeText(textareasDeIncidencias()[0]!, '  Golpe  ');
    await guardar();
    expect(rpcArgs(crearCalls()[0]!).p_entregas).toEqual([
      { cliente_id: C_FRIGO, incidencias: 'Golpe' },
      { cliente_id: C_ALMACEN, incidencias: null },
      { cliente_id: C_FRIGO, incidencias: null },
    ]);
  });

  it('nunca manda id, transportista_id ni viaje_id dentro de las entregas del alta', async () => {
    await mount();
    await llenarLoMinimo();
    await agregarEntrega();
    await selectValue(selectsDeCliente()[0], C_ALMACEN);
    await guardar();
    const args = rpcArgs(crearCalls()[0]!);
    const texto = JSON.stringify(args);
    expect(texto).not.toContain('transportista_id');
    expect(texto).not.toContain('viaje_id');
    expect(Object.keys((args.p_entregas as Array<Record<string, unknown>>)[0]!)).toEqual(['cliente_id', 'incidencias']);
  });

  it('tope de 100: al llegar a 100 el botón se deshabilita y explica el motivo en texto; al quitar una, se habilita', async () => {
    const entregas = Array.from({ length: 99 }, (_, i) => ({
      id: `d0000000-0000-4000-8000-${String(i + 100).padStart(12, '0')}`,
      cliente_id: C_ALMACEN,
      incidencias: null,
      created_at: `2025-06-15T10:00:00.${String(i).padStart(3, '0')}Z`,
    }));
    route.detalle = () => ok(detalleViaje({ entregas }));
    await mount(`/viajes/${VIAJE_ID}/editar`);
    expect(selectsDeCliente()).toHaveLength(99);
    const agregar = buttonByText('Agregar entrega')!;
    expect(agregar.disabled).toBe(false);
    expect(bodyText()).not.toContain('Llegaste al máximo');

    await click(agregar);
    expect(selectsDeCliente()).toHaveLength(100);
    expect(buttonByText('Agregar entrega')!.disabled).toBe(true);
    expect(bodyText()).toContain('Llegaste al máximo de 100 entregas por viaje.');
    expect(buttonByText('Agregar entrega')!.getAttribute('aria-describedby')).toBe('viaje-entregas-tope');

    await click(buttonByText('Quitar'));
    expect(selectsDeCliente()).toHaveLength(99);
    expect(buttonByText('Agregar entrega')!.disabled).toBe(false);
    expect(bodyText()).not.toContain('Llegaste al máximo');
  }, 60_000);

  it('sin clientes todavía: el selector ofrece solo el placeholder y la fila explica cómo crear el primero', async () => {
    db.clientes = [];
    await mount();
    await agregarEntrega();
    expect(selectsDeCliente()[0]!.options).toHaveLength(1);
    expect(bodyText()).toContain('Todavía no tienes clientes: crea el primero con «Nuevo cliente».');
  });
});

describe('formulario de viaje: la lista de clientes no carga', () => {
  it('muestra el error con "Reintentar" DENTRO de la sección de entregas y NO borra lo tipeado', async () => {
    route.clientes = () => sinRed();
    await mount();
    await llenarLoMinimo();
    await typeText(byId<HTMLTextAreaElement>('viaje-observaciones'), 'No perder esto');
    await agregarEntrega();
    await typeText(textareasDeIncidencias()[0]!, 'Incidencia tipeada');

    expect(bodyText()).toContain('No pudimos cargar los clientes.');
    const seccion = byId('viaje-entregas')!.closest('section')!;
    const reintentar = [...seccion.querySelectorAll('button')].find((b) => b.textContent?.includes('Reintentar'));
    expect(reintentar).toBeTruthy();
    expect(selectsDeCliente()[0]!.disabled).toBe(true);
    expect(buttonByText('Nuevo cliente')!.disabled).toBe(true);

    // Lo tipeado sigue ahí.
    expect(byId<HTMLInputElement>('viaje-origen')!.value).toBe('Rosario');
    expect(byId<HTMLTextAreaElement>('viaje-observaciones')!.value).toBe('No perder esto');
    expect(textareasDeIncidencias()[0]!.value).toBe('Incidencia tipeada');

    // Intentar guardar con entregas sin lista: aviso de la sección, sin mandar nada.
    await guardar();
    expect(crearCalls()).toHaveLength(0);
    expect(seccion.textContent).toContain('Falta cargar la lista de clientes.');
    expect(document.activeElement?.id).toBe('viaje-entregas');

    // Vuelve la red: "Reintentar" carga la lista, el aviso desaparece y lo tipeado sigue.
    route.clientes = () => ok(db.clientes);
    await click(reintentar);
    expect(bodyText()).not.toContain('No pudimos cargar los clientes.');
    expect(bodyText()).not.toContain('Falta cargar la lista de clientes.');
    expect(selectsDeCliente()[0]!.disabled).toBe(false);
    expect(selectsDeCliente()[0]!.options).toHaveLength(3);
    expect(textareasDeIncidencias()[0]!.value).toBe('Incidencia tipeada');
    expect(byId<HTMLInputElement>('viaje-origen')!.value).toBe('Rosario');
  });

  it('sin entregas se puede guardar aunque la lista de clientes no cargue', async () => {
    route.clientes = () => sinRed();
    await mount();
    await llenarLoMinimo();
    await guardar();
    expect(crearCalls()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Guardado (alta)
// ---------------------------------------------------------------------------
describe('formulario de viaje: guardar (alta)', () => {
  it('llama a crear_viaje_con_entregas con los argumentos exactos (recortados, null explícito, sin camión) y vuelve a la lista con "guardado"', async () => {
    await mount();
    await typeById('viaje-origen', '  Rosario ');
    await typeById('viaje-destino', ' Córdoba  ');
    await typeById('viaje-km-inicial', '1200');
    await typeById('viaje-ingreso', '2500,5');
    await typeText(byId<HTMLTextAreaElement>('viaje-observaciones'), '  Llegó tarde  ');
    await agregarEntrega();
    await selectValue(selectsDeCliente()[0], C_ALMACEN);
    await typeText(textareasDeIncidencias()[0]!, 'Golpe');
    await guardar();

    expect(crearCalls()).toHaveLength(1);
    const args = rpcArgs(crearCalls()[0]!);
    expect(args.p_client_ref).toMatch(UUID);
    expect(args).toEqual({
      p_client_ref: args.p_client_ref,
      p_fecha: todayLocal(),
      p_origen: 'Rosario',
      p_destino: 'Córdoba',
      p_km_inicial: 1200,
      p_km_final: null,
      p_km_recorridos: null,
      p_observaciones: 'Llegó tarde',
      p_ingreso: 2500.5,
      p_entregas: [{ cliente_id: C_ALMACEN, incidencias: 'Golpe' }],
    });
    expect(Object.keys(args)).not.toContain('p_camion_id');
    // Fue con timeout de escritura.
    expect(crearCalls()[0]!.ops.find((o) => o.m === 'abortSignal')!.args[0]).toBeInstanceOf(AbortSignal);

    const lista = byId('lista-de-viajes')!;
    expect(lista).not.toBeNull();
    expect(lista.dataset.aviso).toBe('guardado');
    expect(lista.dataset.search).toBe(''); // la fecha es hoy: el mes actual no se escribe
    expect(actualizarCalls()).toHaveLength(0);
  });

  it('un viaje de otro mes vuelve a la lista de ESE mes', async () => {
    await mount();
    await llenarLoMinimo();
    await typeById('viaje-fecha', '2025-03-10');
    await guardar();
    expect(rpcArgs(crearCalls()[0]!).p_fecha).toBe('2025-03-10');
    expect(byId('lista-de-viajes')!.dataset.search).toBe('?mes=2025-03');
  });

  it('doble toque en "Guardar": una sola llamada (queda bloqueado hasta salir de la pantalla)', async () => {
    await mount();
    await llenarLoMinimo();
    await act(async () => {
      const boton = buttonByText('Guardar viaje')!;
      boton.click();
      boton.click();
    });
    await settle(6);
    expect(crearCalls()).toHaveLength(1);
  });

  it('falla de red: muestra el error con "Reintentar", NO borra lo tipeado y el reintento usa el MISMO client_ref', async () => {
    let intento = 0;
    route.crear = () => {
      intento += 1;
      return intento === 1 ? sinRed() : ok([{ viaje_id: NUEVO_VIAJE_ID, creado: true }]);
    };
    await mount();
    await llenarLoMinimo();
    await typeText(byId<HTMLTextAreaElement>('viaje-observaciones'), 'Observación');
    await agregarEntrega();
    await selectValue(selectsDeCliente()[0], C_ALMACEN);
    await guardar();

    expect(byId('lista-de-viajes')).toBeNull();
    expect(bodyText()).toContain('No hay conexión');
    expect(buttonByText('Reintentar')).toBeTruthy();
    expect(byId<HTMLInputElement>('viaje-origen')!.value).toBe('Rosario');
    expect(byId<HTMLTextAreaElement>('viaje-observaciones')!.value).toBe('Observación');
    expect(selectsDeCliente()[0]!.value).toBe(C_ALMACEN);

    await click(buttonByText('Reintentar'));
    await settle(4);
    expect(crearCalls()).toHaveLength(2);
    const [primero, segundo] = crearCalls().map(rpcArgs);
    expect(segundo!.p_client_ref).toBe(primero!.p_client_ref);
    expect(segundo).toEqual(primero);
    expect(byId('lista-de-viajes')!.dataset.aviso).toBe('guardado');
  });

  it('respuesta perdida (el viaje SÍ se guardó): el reintento recibe creado = false y se trata como "Viaje guardado", sin duplicar ni actualizar', async () => {
    let intento = 0;
    route.crear = () => {
      intento += 1;
      return intento === 1 ? sinRed() : ok([{ viaje_id: NUEVO_VIAJE_ID, creado: false }]);
    };
    await mount();
    await llenarLoMinimo();
    await guardar();
    expect(bodyText()).toContain('No hay conexión');
    await click(buttonByText('Reintentar'));
    await settle(4);
    expect(crearCalls()).toHaveLength(2);
    expect(actualizarCalls()).toHaveLength(0);
    expect(byId('lista-de-viajes')!.dataset.aviso).toBe('guardado'); // éxito, no error
  });

  it('respuesta perdida y el usuario CAMBIÓ datos antes de reintentar: se actualiza el viaje ya guardado con lo que hay en pantalla', async () => {
    let intento = 0;
    route.crear = () => {
      intento += 1;
      return intento === 1 ? sinRed() : ok([{ viaje_id: NUEVO_VIAJE_ID, creado: false }]);
    };
    await mount();
    await llenarLoMinimo();
    await guardar();
    expect(bodyText()).toContain('No hay conexión');

    // Cambia de idea: otro destino y una entrega.
    await typeById('viaje-destino', 'Mendoza');
    await agregarEntrega();
    await selectValue(selectsDeCliente()[0], C_FRIGO);
    await click(buttonByText('Reintentar'));
    await settle(4);

    expect(crearCalls()).toHaveLength(2);
    expect(actualizarCalls()).toHaveLength(1);
    const args = rpcArgs(actualizarCalls()[0]!);
    expect(args.p_viaje_id).toBe(NUEVO_VIAJE_ID);
    expect(args.p_destino).toBe('Mendoza');
    expect(args.p_camion_id).toBeNull();
    expect(args.p_entregas).toEqual([{ cliente_id: C_FRIGO, incidencias: null }]);
    expect(Object.keys(args)).toHaveLength(11);
    expect(byId('lista-de-viajes')!.dataset.aviso).toBe('guardado');
  });

  it('23503 al guardar: además del mensaje, se vuelve a pedir la lista de clientes (así "actualiza la lista" es cierto y el cliente borrado deja de ofrecerse)', async () => {
    route.crear = () => fail('23503', 'Alguno de los clientes no es válido para este transportista');
    await mount();
    await llenarLoMinimo();
    const antes = clientesListados().length;
    await guardar();
    expect(clientesListados().length).toBeGreaterThan(antes);
  });

  it('23503 al guardar (un cliente ya no existe): mensaje en español, sin "Reintentar" (daría lo mismo) y sin nombres de constraints', async () => {
    route.crear = () => fail('23503', 'Alguno de los clientes no es válido para este transportista');
    await mount();
    await llenarLoMinimo();
    await guardar();
    expect(bodyText()).toContain('Alguno de los clientes ya no existe: actualiza la lista y elígelo de nuevo.');
    expect(buttonByText('Reintentar')).toBeUndefined();
    expect(byId('lista-de-viajes')).toBeNull();
    expect(byId<HTMLInputElement>('viaje-origen')!.value).toBe('Rosario'); // lo tipeado sigue
  });

  it('un 23514 (check) se muestra sin el nombre del constraint', async () => {
    route.crear = () => fail('23514', 'new row for relation "viajes" violates check constraint "viajes_chk_km_coherentes"');
    await mount();
    await llenarLoMinimo();
    await guardar();
    expect(bodyText()).toContain('Alguno de los datos del viaje no es válido.');
    expect(bodyText()).not.toContain('viajes_chk_km_coherentes');
    expect(buttonByText('Reintentar')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// "+ Nuevo cliente"
// ---------------------------------------------------------------------------
describe('formulario de viaje: + Nuevo cliente', () => {
  const abrirNuevoCliente = async () => click(buttonByText('Nuevo cliente'));
  const campoNombre = () => document.querySelector<HTMLInputElement>('input[id$="-cliente-nuevo-nombre"]');
  const crearCliente = () => click(buttonByText('Crear cliente'));

  it('abre un mini formulario en línea (solo el nombre) con el foco en el campo, y Cancelar lo cierra devolviendo el foco', async () => {
    await mount();
    await agregarEntrega();
    await abrirNuevoCliente();
    expect(campoNombre()).not.toBeNull();
    expect(document.activeElement).toBe(campoNombre());
    expect(buttonByText('Crear cliente')).toBeTruthy();
    expect(buttonByText('Cancelar')).toBeTruthy();
    // No es un <form> anidado dentro del formulario del viaje.
    expect(document.querySelectorAll('form')).toHaveLength(1);

    await click(buttonByText('Cancelar'));
    expect(campoNombre()).toBeNull();
    expect(document.activeElement).toBe(buttonByText('Nuevo cliente'));
  });

  it('nombre vacío: error de validación y foco en el campo; no se manda nada', async () => {
    await mount();
    await agregarEntrega();
    await abrirNuevoCliente();
    await typeText(campoNombre(), '   ');
    await crearCliente();
    expect(bodyText()).toContain('Escribe el nombre del cliente.');
    expect(document.activeElement).toBe(campoNombre());
    expect(clientesInsertados()).toHaveLength(0);
  });

  it('crea el cliente SOLO con el nombre (sin id ni transportista_id), lo deja seleccionado en esa fila e invalida la lista', async () => {
    route.insertCliente = (call) => {
      const nombre = (call.ops.find((o) => o.m === 'insert')!.args[0] as { nombre: string }).nombre;
      const nuevo = { id: 'a0000000-0000-4000-8000-0000000000aa', nombre };
      db.clientes = [...db.clientes, nuevo];
      return ok(nuevo);
    };
    await mount();
    await agregarEntrega();
    await agregarEntrega();
    const listadosAntes = clientesListados().length;
    await click(buttonByText('Nuevo cliente')); // el de la primera fila
    await typeText(campoNombre(), '  Distribuidora Norte ');
    await crearCliente();

    expect(clientesInsertados()).toHaveLength(1);
    const insertado = clientesInsertados()[0]!;
    expect(insertado.ops.find((o) => o.m === 'insert')!.args[0]).toEqual({ nombre: 'Distribuidora Norte' });
    expect(insertado.ops.find((o) => o.m === 'select')!.args[0]).toBe('id, nombre');
    expect(insertado.ops.some((o) => o.m === 'single')).toBe(true);
    expect(insertado.ops.find((o) => o.m === 'abortSignal')!.args[0]).toBeInstanceOf(AbortSignal);

    // Queda seleccionado en la fila 1 (y solo ahí); el mini formulario se cerró; el foco vuelve al selector.
    const [uno, dos] = selectsDeCliente();
    expect(uno!.value).toBe('a0000000-0000-4000-8000-0000000000aa');
    expect(uno!.selectedOptions[0]!.textContent).toBe('Distribuidora Norte');
    expect(dos!.value).toBe('');
    expect(campoNombre()).toBeNull();
    expect(document.activeElement).toBe(uno);
    // La lista se invalidó: se pidió de nuevo, y el cliente nuevo también está para elegir en la otra fila.
    await settle(4);
    expect(clientesListados().length).toBeGreaterThan(listadosAntes);
    expect([...dos!.options].map((o) => o.textContent)).toContain('Distribuidora Norte');
  });

  it('nombre repetido (sin distinguir mayúsculas ni tildes): NO crea y avisa con "Usar ese" y "Crear de todos modos"', async () => {
    await mount();
    await agregarEntrega();
    await abrirNuevoCliente();
    await typeText(campoNombre(), '  frigorifico   SUR ');
    await crearCliente();

    expect(clientesInsertados()).toHaveLength(0);
    expect(bodyText()).toContain('Ya tienes un cliente llamado «Frigorífico Sur».');
    expect(buttonByText('Usar ese')).toBeTruthy();
    expect(buttonByText('Crear de todos modos')).toBeTruthy();
    expect(document.activeElement).toBe(buttonByText('Usar ese'));
  });

  it('"Usar ese" selecciona al existente en la fila, cierra el mini formulario y no crea nada', async () => {
    await mount();
    await agregarEntrega();
    await abrirNuevoCliente();
    await typeText(campoNombre(), 'frigorifico sur');
    await crearCliente();
    await click(buttonByText('Usar ese'));

    expect(clientesInsertados()).toHaveLength(0);
    expect(selectsDeCliente()[0]!.value).toBe(C_FRIGO);
    expect(campoNombre()).toBeNull();
    expect(document.activeElement).toBe(selectsDeCliente()[0]);
  });

  it('"Crear de todos modos" sí crea el homónimo', async () => {
    route.insertCliente = (call) => {
      const nombre = (call.ops.find((o) => o.m === 'insert')!.args[0] as { nombre: string }).nombre;
      const nuevo = { id: 'a0000000-0000-4000-8000-0000000000bb', nombre };
      db.clientes = [...db.clientes, nuevo];
      return ok(nuevo);
    };
    await mount();
    await agregarEntrega();
    await abrirNuevoCliente();
    await typeText(campoNombre(), 'Almacén Central');
    await crearCliente();
    expect(clientesInsertados()).toHaveLength(0);
    await click(buttonByText('Crear de todos modos'));
    expect(clientesInsertados()).toHaveLength(1);
    expect(selectsDeCliente()[0]!.value).toBe('a0000000-0000-4000-8000-0000000000bb');
  });

  it('seguir tipeando después del aviso de duplicado lo descarta (era de OTRO nombre) y se puede crear uno distinto', async () => {
    route.insertCliente = (call) => {
      const nombre = (call.ops.find((o) => o.m === 'insert')!.args[0] as { nombre: string }).nombre;
      const nuevo = { id: 'a0000000-0000-4000-8000-0000000000cc', nombre };
      db.clientes = [...db.clientes, nuevo];
      return ok(nuevo);
    };
    await mount();
    await agregarEntrega();
    await abrirNuevoCliente();
    await typeText(campoNombre(), 'Almacén Central');
    await crearCliente();
    expect(bodyText()).toContain('Ya tienes un cliente llamado');
    await typeText(campoNombre(), 'Almacén Central Hnos');
    expect(bodyText()).not.toContain('Ya tienes un cliente llamado');
    await crearCliente();
    expect(clientesInsertados()).toHaveLength(1);
  });

  it('Enter en el campo crea el cliente y NO envía el formulario del viaje', async () => {
    route.insertCliente = (call) => {
      const nombre = (call.ops.find((o) => o.m === 'insert')!.args[0] as { nombre: string }).nombre;
      const nuevo = { id: 'a0000000-0000-4000-8000-0000000000dd', nombre };
      db.clientes = [...db.clientes, nuevo];
      return ok(nuevo);
    };
    await mount();
    await llenarLoMinimo();
    await agregarEntrega();
    await abrirNuevoCliente();
    await typeText(campoNombre(), 'Mayorista Oeste');
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    await act(async () => {
      campoNombre()!.dispatchEvent(enter);
    });
    await settle(4);
    expect(enter.defaultPrevented).toBe(true); // en un navegador real, esto es lo que evita el envío implícito del formulario
    expect(clientesInsertados()).toHaveLength(1);
    expect(crearCalls()).toHaveLength(0); // el viaje NO se envió
    expect(byId('lista-de-viajes')).toBeNull();
  });

  it('si la creación falla por red: error con "Reintentar" y lo tipeado queda; el reintento REFRESCA la lista y, si el cliente ya estaba (respuesta perdida), avisa en vez de crear otro', async () => {
    const perdido = { id: 'a0000000-0000-4000-8000-0000000000ee', nombre: 'Mayorista Oeste' };
    route.insertCliente = () => {
      // El INSERT llega a la base, pero la respuesta se pierde.
      db.clientes = [...db.clientes, perdido];
      return sinRed();
    };
    await mount();
    await agregarEntrega();
    await abrirNuevoCliente();
    await typeText(campoNombre(), 'Mayorista Oeste');
    await crearCliente();

    expect(clientesInsertados()).toHaveLength(1);
    expect(bodyText()).toContain('No hay conexión');
    expect(campoNombre()!.value).toBe('Mayorista Oeste'); // nada se borró
    const listadosAntes = clientesListados().length;

    const reintentar = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Reintentar'));
    await click(reintentar);
    await settle(4);

    // Primero refrescó la lista...
    expect(clientesListados().length).toBeGreaterThan(listadosAntes);
    // ...encontró al cliente que se había creado igual y NO creó un segundo.
    expect(clientesInsertados()).toHaveLength(1);
    expect(bodyText()).toContain('Ya tienes un cliente llamado «Mayorista Oeste».');
    await click(buttonByText('Usar ese'));
    expect(selectsDeCliente()[0]!.value).toBe(perdido.id);
    expect(clientesInsertados()).toHaveLength(1);
  });

  it('si la creación falla por red y la base NO lo creó: el reintento refresca, no encuentra nada y recién ahí crea', async () => {
    let intento = 0;
    route.insertCliente = (call) => {
      intento += 1;
      if (intento === 1) return sinRed();
      const nombre = (call.ops.find((o) => o.m === 'insert')!.args[0] as { nombre: string }).nombre;
      const nuevo = { id: 'a0000000-0000-4000-8000-0000000000ff', nombre };
      db.clientes = [...db.clientes, nuevo];
      return ok(nuevo);
    };
    await mount();
    await agregarEntrega();
    await abrirNuevoCliente();
    await typeText(campoNombre(), 'Otro Cliente');
    await crearCliente();
    expect(bodyText()).toContain('No hay conexión');
    const listadosAntes = clientesListados().length;

    await click([...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Reintentar')));
    await settle(4);
    expect(clientesListados().length).toBeGreaterThan(listadosAntes);
    expect(clientesInsertados()).toHaveLength(2);
    expect(selectsDeCliente()[0]!.value).toBe('a0000000-0000-4000-8000-0000000000ff');
  });

  it('si el reintento no puede refrescar la lista (sigue sin red) NO crea nada a ciegas', async () => {
    route.insertCliente = () => sinRed();
    await mount();
    await agregarEntrega();
    await abrirNuevoCliente();
    await typeText(campoNombre(), 'Otro Cliente');
    await crearCliente();
    expect(clientesInsertados()).toHaveLength(1);

    route.clientes = () => sinRed(); // ahora tampoco se puede leer la lista
    await click([...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Reintentar')));
    await settle(4);
    expect(clientesInsertados()).toHaveLength(1); // no se creó otro
    expect(bodyText()).toContain('No hay conexión');
    expect(campoNombre()!.value).toBe('Otro Cliente');
  });
});

// ---------------------------------------------------------------------------
// Edición
// ---------------------------------------------------------------------------
describe('formulario de viaje: editar', () => {
  it('carga el viaje con sus entregas (en orden), deduce el modo "Recorridos" y precarga los campos', async () => {
    route.detalle = () => ok(detalleViaje());
    await mount(`/viajes/${VIAJE_ID}/editar`);

    expect(document.querySelector('h1')!.textContent).toBe('Editar viaje');
    expect(byId<HTMLInputElement>('viaje-origen')!.value).toBe('Rosario');
    expect(byId<HTMLInputElement>('viaje-destino')!.value).toBe('Córdoba');
    expect(byId<HTMLInputElement>('viaje-fecha')!.value).toBe('2025-06-15');
    expect(radio('Recorridos').checked).toBe(true);
    expect(byId<HTMLInputElement>('viaje-km-recorridos')!.value).toMatch(/^640[.,]5$/);
    expect(byId<HTMLInputElement>('viaje-ingreso')!.value).toBe('1500');
    expect(byId<HTMLTextAreaElement>('viaje-observaciones')!.value).toBe('Todo bien');
    expect(titulosDeEntrega()).toEqual(['Entrega 1', 'Entrega 2']);
    expect(selectsDeCliente().map((s) => s.value)).toEqual([C_ALMACEN, C_FRIGO]);
    expect(textareasDeIncidencias().map((t) => t.value)).toEqual(['Golpe en un pallet', '']);
    expect(buttonByText('Eliminar viaje')).toBeTruthy();
  });

  it('pide el viaje con sus entregas en UNA consulta ordenada por (created_at, id), por id', async () => {
    route.detalle = () => ok(detalleViaje());
    await mount(`/viajes/${VIAJE_ID}/editar`);
    const consultas = callsTo('viajes');
    expect(consultas).toHaveLength(1);
    const call = consultas[0]!;
    expect(call.ops.find((o) => o.m === 'eq')!.args).toEqual(['id', VIAJE_ID]);
    expect(call.ops.filter((o) => o.m === 'order').map((o) => o.args)).toEqual([
      ['created_at', { ascending: true, referencedTable: 'entregas' }],
      ['id', { ascending: true, referencedTable: 'entregas' }],
    ]);
    expect(call.ops.some((o) => o.m === 'maybeSingle')).toBe(true);
  });

  it('sin cambios: guarda con actualizar_viaje_con_entregas conservando el camion_id y los ids de las entregas', async () => {
    route.detalle = () => ok(detalleViaje());
    await mount(`/viajes/${VIAJE_ID}/editar`);
    await guardar();

    expect(crearCalls()).toHaveLength(0);
    expect(actualizarCalls()).toHaveLength(1);
    const args = rpcArgs(actualizarCalls()[0]!);
    expect(args).toEqual({
      p_viaje_id: VIAJE_ID,
      p_fecha: '2025-06-15',
      p_origen: 'Rosario',
      p_destino: 'Córdoba',
      p_camion_id: CAMION_ID, // el que ya tenía, tal cual
      p_km_inicial: null,
      p_km_final: null,
      p_km_recorridos: 640.5,
      p_observaciones: 'Todo bien',
      p_ingreso: 1500,
      p_entregas: [
        { id: E_1, cliente_id: C_ALMACEN, incidencias: 'Golpe en un pallet' },
        { id: E_2, cliente_id: C_FRIGO, incidencias: null },
      ],
    });
    expect(byId('lista-de-viajes')!.dataset.aviso).toBe('guardado');
    expect(byId('lista-de-viajes')!.dataset.search).toBe('?mes=2025-06');
  });

  it('un cliente de una entrega que ya no está en la lista (borrado o fuera del tope) se ve "sin elegir" (no como OTRO cliente) y pide elegir uno al guardar', async () => {
    const C_FUERA = 'a0000000-0000-4000-8000-0000000000f0';
    route.detalle = () =>
      ok(detalleViaje({ entregas: [{ id: E_1, cliente_id: C_FUERA, incidencias: null, created_at: '2025-06-15T10:00:00.001Z' }] }));
    await mount(`/viajes/${VIAJE_ID}/editar`);
    const select = selectsDeCliente()[0]!;
    expect(select.value).toBe(''); // el navegador no muestra al primer cliente de la lista por error
    expect(select.selectedOptions[0]!.textContent).toBe('Elige un cliente');
    await guardar();
    expect(actualizarCalls()).toHaveLength(0);
    expect(select.closest('[role="group"]')!.textContent).toContain('Elige un cliente.');
    expect(document.activeElement).toBe(select);
  });

  it('guardar una edición marca vieja la lista de gastos (muestra el recorrido de cada viaje); si falla, no', async () => {
    const listaDeGastos = gastosKeys.list('tenant-a', '2025-06-01', '2025-07-01', null);
    route.detalle = () => ok(detalleViaje());
    route.actualizar = () => sinRed();
    await mount(`/viajes/${VIAJE_ID}/editar`);
    queryClient.setQueryData(listaDeGastos, { items: [], truncado: false });
    await guardar();
    expect(queryClient.getQueryState(listaDeGastos)?.isInvalidated).toBe(false);

    route.actualizar = () => ok(null);
    await guardar();
    expect(queryClient.getQueryState(listaDeGastos)?.isInvalidated).toBe(true);
  });

  it('un viaje sin camión se guarda con p_camion_id = null', async () => {
    route.detalle = () => ok(detalleViaje({ camion_id: null }));
    await mount(`/viajes/${VIAJE_ID}/editar`);
    await guardar();
    expect(rpcArgs(actualizarCalls()[0]!).p_camion_id).toBeNull();
  });

  it('quitar una entrega existente y agregar una nueva: las existentes con su id, la nueva sin id, la quitada no viene', async () => {
    route.detalle = () => ok(detalleViaje());
    await mount(`/viajes/${VIAJE_ID}/editar`);
    await click(buttonByText('Quitar')); // quita la primera (E_1)
    await agregarEntrega();
    await selectValue(selectsDeCliente()[1], C_ALMACEN);
    await typeText(textareasDeIncidencias()[1]!, 'Nueva incidencia');
    await guardar();

    const args = rpcArgs(actualizarCalls()[0]!);
    expect(args.p_entregas).toEqual([
      { id: E_2, cliente_id: C_FRIGO, incidencias: null },
      { cliente_id: C_ALMACEN, incidencias: 'Nueva incidencia' },
    ]);
    expect(JSON.stringify(args.p_entregas)).not.toContain(E_1);
  });

  it('cambiar de "Recorridos" a "Inicial y final": manda los de inicial/final y recorridos en null (reemplazo completo)', async () => {
    route.detalle = () => ok(detalleViaje());
    await mount(`/viajes/${VIAJE_ID}/editar`);
    await click(radio('Inicial y final'));
    await typeById('viaje-km-inicial', '100');
    await typeById('viaje-km-final', '200');
    await guardar();
    const args = rpcArgs(actualizarCalls()[0]!);
    expect([args.p_km_inicial, args.p_km_final, args.p_km_recorridos]).toEqual([100, 200, null]);
  });

  it('vaciar campos opcionales manda null explícito (no los omite)', async () => {
    route.detalle = () => ok(detalleViaje());
    await mount(`/viajes/${VIAJE_ID}/editar`);
    await typeById('viaje-ingreso', '');
    await typeText(byId<HTMLTextAreaElement>('viaje-observaciones'), '');
    await typeById('viaje-km-recorridos', '');
    await guardar();
    const args = rpcArgs(actualizarCalls()[0]!);
    expect(args).toHaveProperty('p_ingreso', null);
    expect(args).toHaveProperty('p_observaciones', null);
    expect(args).toHaveProperty('p_km_recorridos', null);
  });

  it('23503 al guardar una EDICIÓN: también se vuelve a pedir la lista de clientes', async () => {
    route.detalle = () => ok(detalleViaje());
    route.actualizar = () => fail('23503', 'Alguno de los clientes no es válido para este transportista');
    await mount(`/viajes/${VIAJE_ID}/editar`);
    const antes = clientesListados().length;
    await guardar();
    expect(bodyText()).toContain('Alguno de los clientes ya no existe');
    expect(clientesListados().length).toBeGreaterThan(antes);
  });

  it('P0002 (el viaje cambió o ya no existe): mensaje claro, sin "Reintentar", y lo tipeado queda', async () => {
    route.detalle = () => ok(detalleViaje());
    route.actualizar = () => fail('P0002', 'No se encontró el viaje');
    await mount(`/viajes/${VIAJE_ID}/editar`);
    await typeById('viaje-origen', 'San Lorenzo');
    await guardar();
    expect(bodyText()).toContain('El viaje cambió o ya no existe. Vuelve a la lista y actualízala.');
    expect(buttonByText('Reintentar')).toBeUndefined();
    expect(byId<HTMLInputElement>('viaje-origen')!.value).toBe('San Lorenzo');
    expect(byId('lista-de-viajes')).toBeNull();
  });

  it('si el guardado falla por mala señal NO se desmonta el formulario (aunque el refresco del viaje también falle): lo tipeado queda y se ofrece "Reintentar"', async () => {
    // Regresión de la auditoría: el guardado invalidaba también el detalle del viaje (que esta pantalla tiene
    // activo); con señal mala el refresco fallaba, `viaje.isError` pasaba a true y el formulario se desmontaba
    // llevándose lo tipeado. El detalle se lee UNA vez para inicializar el formulario: no se vuelve a pedir.
    let cargas = 0;
    route.detalle = () => {
      cargas += 1;
      return cargas === 1 ? ok(detalleViaje()) : sinRed();
    };
    route.actualizar = () => sinRed();
    await mount(`/viajes/${VIAJE_ID}/editar`);
    await typeById('viaje-origen', 'San Lorenzo');
    await guardar();
    await settle(4);

    expect(byId<HTMLInputElement>('viaje-origen')?.value).toBe('San Lorenzo');
    expect(bodyText()).toContain('No hay conexión');
    expect(buttonByText('Reintentar')).toBeTruthy();
    expect(cargas).toBe(1);
  });

  it('aunque algo fuerce un refresco del viaje y falle, el formulario ya cargado no se desmonta (el error solo reemplaza al formulario si NO hay datos)', async () => {
    let cargas = 0;
    route.detalle = () => {
      cargas += 1;
      return cargas === 1 ? ok(detalleViaje()) : sinRed();
    };
    await mount(`/viajes/${VIAJE_ID}/editar`);
    await typeById('viaje-origen', 'San Lorenzo');
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: viajesKeys.detail('tenant-a', VIAJE_ID) });
    });
    await settle(4);
    expect(cargas).toBe(2); // el refresco sí ocurrió y falló
    expect(byId<HTMLInputElement>('viaje-origen')?.value).toBe('San Lorenzo');
  });

  it('el viaje no existe (o es de otro): pantalla "Viaje no encontrado" con enlace para volver', async () => {
    route.detalle = () => ok(null);
    await mount(`/viajes/${VIAJE_ID}/editar`);
    expect(bodyText()).toContain('Viaje no encontrado');
    expect(document.querySelector('a[href="/viajes"]')).not.toBeNull();
    expect(byId('viaje-origen')).toBeNull();
  });

  it('un id que no es uuid no consulta nada y muestra "no encontrado"', async () => {
    await mount('/viajes/no-es-un-uuid/editar');
    expect(bodyText()).toContain('Viaje no encontrado');
    expect(callsTo('viajes')).toHaveLength(0);
  });

  it('si falla la carga del viaje: error con "Reintentar" que vuelve a pedirlo', async () => {
    let intento = 0;
    route.detalle = () => {
      intento += 1;
      return intento === 1 ? sinRed() : ok(detalleViaje());
    };
    await mount(`/viajes/${VIAJE_ID}/editar`);
    expect(bodyText()).toContain('No hay conexión');
    await click(buttonByText('Reintentar'));
    await settle(4);
    expect(byId<HTMLInputElement>('viaje-origen')!.value).toBe('Rosario');
  });
});

// ---------------------------------------------------------------------------
// Borrado
// ---------------------------------------------------------------------------
describe('formulario de viaje: eliminar', () => {
  const eliminar = async () => {
    await click(buttonByText('Eliminar viaje'));
    await click(buttonByText('Sí, eliminar'));
    await settle(4);
  };

  it('pide confirmación, desvincula los gastos, borra por id y vuelve a la lista con el aviso "eliminado" (conservando el mes)', async () => {
    route.detalle = () => ok(detalleViaje());
    await mount(`/viajes/${VIAJE_ID}/editar`);
    await click(buttonByText('Eliminar viaje'));
    expect(bodyText()).toContain('¿Seguro? Esto no se puede deshacer.');
    expect(callsTo('viajes').some((c) => c.ops.some((o) => o.m === 'delete'))).toBe(false); // todavía no borró

    await click(buttonByText('Sí, eliminar'));
    await settle(4);
    const borrado = callsTo('viajes').find((c) => c.ops.some((o) => o.m === 'delete'))!;
    expect(borrado.ops.map((o) => o.m)).toEqual(['delete', 'eq', 'select', 'abortSignal']);
    expect(borrado.ops.find((o) => o.m === 'eq')!.args).toEqual(['id', VIAJE_ID]);
    expect(byId('lista-de-viajes')!.dataset.aviso).toBe('eliminado');
    // SIEMPRE los dos pasos, aunque no haya gastos: se vuelve a contar, se desvincula y después se borra.
    expect(secuenciaDeBorrado()).toEqual(['conteo', 'conteo', 'desvincular', 'borrar']);
  });

  it('23503 en el DELETE (una carrera: se vinculó un gasto entre los dos pasos): mensaje nuevo, SIN el nombre del constraint, con "Reintentar", y se queda en el formulario', async () => {
    route.detalle = () => ok(detalleViaje());
    route.borrar = () => fail('23503', 'update or delete on table "viajes" violates foreign key constraint "gastos_viaje_fk" on table "gastos"', 409);
    await mount(`/viajes/${VIAJE_ID}/editar`);
    await eliminar();

    expect(bodyText()).toContain('Se vinculó un gasto a este viaje mientras lo borrabas. Vuelve a intentarlo.');
    expect(bodyText()).not.toContain('Este viaje tiene gastos vinculados. Cambia o quita'); // el mensaje viejo ya no existe
    expect(bodyText()).not.toContain('gastos_viaje_fk');
    expect(bodyText()).not.toContain('Alguno de los clientes'); // el mensaje del GUARDADO no se confunde con este
    expect(buttonByText('Reintentar')).toBeTruthy(); // repetir los dos pasos es seguro
    expect(buttonByText('Cancelar')).toBeTruthy();
    expect(byId('lista-de-viajes')).toBeNull();
    expect(byId<HTMLInputElement>('viaje-origen')!.value).toBe('Rosario');
  });

  it('carrera: "Reintentar" repite los DOS pasos (desvincula de nuevo) y entonces borra', async () => {
    route.detalle = () => ok(detalleViaje());
    let intento = 0;
    route.borrar = () => {
      intento += 1;
      return intento === 1
        ? fail('23503', 'update or delete on table "viajes" violates foreign key constraint "gastos_viaje_fk" on table "gastos"', 409)
        : ok([{ id: VIAJE_ID }]);
    };
    await mount(`/viajes/${VIAJE_ID}/editar`);
    await eliminar();
    expect(bodyText()).toContain('Se vinculó un gasto a este viaje mientras lo borrabas.');

    await click(buttonByText('Reintentar'));
    await settle(4);
    // Tras el error se vuelve a pedir el conteo (la confirmación sigue abierta) y el reintento recuenta, desvincula y borra.
    expect(secuenciaDeBorrado()).toEqual(['conteo', 'conteo', 'desvincular', 'borrar', 'conteo', 'conteo', 'desvincular', 'borrar']);
    expect(byId('lista-de-viajes')!.dataset.aviso).toBe('eliminado');
  });

  it('PostgreSQL 18 devuelve 23001 (restrict_violation) en vez de 23503: en el borrado del viaje es EXACTAMENTE lo mismo (mismo mensaje, reintentable, y el reintento borra)', async () => {
    route.detalle = () => ok(detalleViaje());
    let intento = 0;
    route.borrar = () => {
      intento += 1;
      return intento === 1
        ? fail('23001', 'update or delete on table "viajes" violates RESTRICT setting of foreign key constraint "gastos_viaje_fk" on table "gastos"', 409)
        : ok([{ id: VIAJE_ID }]);
    };
    await mount(`/viajes/${VIAJE_ID}/editar`);
    await eliminar();
    expect(bodyText()).toContain('Se vinculó un gasto a este viaje mientras lo borrabas. Vuelve a intentarlo.');
    expect(bodyText()).not.toContain('Alguno de los datos del viaje no es válido'); // no cae en "datos inválidos"
    expect(bodyText()).not.toContain('gastos_viaje_fk');
    expect(buttonByText('Reintentar')).toBeTruthy();
    expect(byId('lista-de-viajes')).toBeNull();

    await click(buttonByText('Reintentar'));
    await settle(4);
    expect(byId('lista-de-viajes')!.dataset.aviso).toBe('eliminado');
  });

  it('con falla de red entre los pasos (el UPDATE salió y el DELETE no): error con "Reintentar"; el viaje sigue existiendo y reintentar completa el borrado', async () => {
    route.detalle = () => ok(detalleViaje());
    let intento = 0;
    route.borrar = () => {
      intento += 1;
      return intento === 1 ? sinRed() : ok([{ id: VIAJE_ID }]);
    };
    await mount(`/viajes/${VIAJE_ID}/editar`);
    await eliminar();
    expect(bodyText()).toContain('No hay conexión');
    expect(secuenciaDeBorrado()).toEqual(['conteo', 'conteo', 'desvincular', 'borrar', 'conteo']);
    expect(byId('lista-de-viajes')).toBeNull(); // el viaje sigue ahí
    expect(byId<HTMLInputElement>('viaje-origen')!.value).toBe('Rosario');

    await click(buttonByText('Reintentar'));
    await settle(4);
    expect(secuenciaDeBorrado()).toEqual(['conteo', 'conteo', 'desvincular', 'borrar', 'conteo', 'conteo', 'desvincular', 'borrar']);
    expect(byId('lista-de-viajes')!.dataset.aviso).toBe('eliminado');
  });

  it('si el paso 1 (desvincular) falla, NO se intenta borrar el viaje', async () => {
    route.detalle = () => ok(detalleViaje());
    route.desvincular = () => sinRed();
    await mount(`/viajes/${VIAJE_ID}/editar`);
    await eliminar();
    expect(bodyText()).toContain('No hay conexión');
    expect(secuenciaDeBorrado()).toEqual(['conteo', 'conteo', 'desvincular', 'conteo']);
    expect(byId('lista-de-viajes')).toBeNull();
  });

  it('0 filas borradas (ya no existía) se trata como éxito: vuelve a la lista con "eliminado"', async () => {
    route.detalle = () => ok(detalleViaje());
    route.borrar = () => ok([]);
    await mount(`/viajes/${VIAJE_ID}/editar`);
    await eliminar();
    expect(byId('lista-de-viajes')!.dataset.aviso).toBe('eliminado');
  });

  it('con falla de red al borrar: error con "Reintentar" y el reintento borra', async () => {
    let intento = 0;
    route.detalle = () => ok(detalleViaje());
    route.borrar = () => {
      intento += 1;
      return intento === 1 ? sinRed() : ok([{ id: VIAJE_ID }]);
    };
    await mount(`/viajes/${VIAJE_ID}/editar`);
    await eliminar();
    expect(bodyText()).toContain('No hay conexión');
    await click(buttonByText('Reintentar'));
    await settle(4);
    expect(byId('lista-de-viajes')!.dataset.aviso).toBe('eliminado');
  });

  it('el alta no ofrece "Eliminar viaje"', async () => {
    await mount();
    expect(buttonByText('Eliminar viaje')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Borrado de un viaje CON gastos: la confirmación dice cuántos y los conserva
// ---------------------------------------------------------------------------
describe('formulario de viaje: eliminar un viaje con gastos vinculados', () => {
  const abrirConfirmacion = async () => {
    route.detalle = () => ok(detalleViaje());
    await mount(`/viajes/${VIAJE_ID}/editar`);
    await click(buttonByText('Eliminar viaje'));
  };

  it('no pide el conteo hasta que se abre la confirmación; después lo pide UNA vez con select("id", { count: "exact", head: true }) por viaje_id', async () => {
    route.detalle = () => ok(detalleViaje());
    await mount(`/viajes/${VIAJE_ID}/editar`);
    expect(secuenciaDeBorrado()).toEqual([]); // abrir el formulario no cuenta nada
    await click(buttonByText('Eliminar viaje'));
    expect(secuenciaDeBorrado()).toEqual(['conteo']);
    const call = callsTo('gastos')[0]!;
    expect(call.ops.find((o) => o.m === 'select')!.args).toEqual(['id', { count: 'exact', head: true }]);
    expect(call.ops.find((o) => o.m === 'eq')!.args).toEqual(['viaje_id', VIAJE_ID]);
  });

  it('con 3 gastos: "Este viaje tiene 3 gastos. Se conservan, pero quedan sin viaje." y el botón dice "Desvincular los gastos y borrar el viaje"', async () => {
    route.contarGastos = () => conteo(3);
    await abrirConfirmacion();
    expect(bodyText()).toContain('Este viaje tiene 3 gastos. Se conservan, pero quedan sin viaje.');
    expect(buttonByText('Desvincular los gastos y borrar el viaje')).toBeTruthy();
    expect(buttonByText('Sí, eliminar')).toBeUndefined();
    expect(buttonByText('Cancelar')).toBeTruthy();
  });

  it('con 1 gasto el texto va en singular (se conserva / queda) y el botón también', async () => {
    route.contarGastos = () => conteo(1);
    await abrirConfirmacion();
    expect(bodyText()).toContain('Este viaje tiene 1 gasto. Se conserva, pero queda sin viaje.');
    expect(bodyText()).not.toContain('1 gastos');
    expect(buttonByText('Desvincular el gasto y borrar el viaje')).toBeTruthy();
  });

  it('con 0 gastos queda el texto de siempre ("¿Seguro? Esto no se puede deshacer.") y "Sí, eliminar"', async () => {
    route.contarGastos = () => conteo(0);
    await abrirConfirmacion();
    expect(bodyText()).toContain('¿Seguro? Esto no se puede deshacer.');
    expect(bodyText()).not.toContain('gasto');
    expect(buttonByText('Sí, eliminar')).toBeTruthy();
  });

  it('confirmar con gastos: conteo -> UPDATE que desvincula (viaje_id = null, filtrado por viaje_id) -> DELETE del viaje, en ese orden, y vuelve a la lista', async () => {
    route.contarGastos = () => conteo(3);
    await abrirConfirmacion();
    await click(buttonByText('Desvincular los gastos y borrar el viaje'));
    await settle(4);

    expect(secuenciaDeBorrado()).toEqual(['conteo', 'conteo', 'desvincular', 'borrar']);
    const update = callsTo('gastos').find((c) => c.ops.some((o) => o.m === 'update'))!;
    expect(update.ops.find((o) => o.m === 'update')!.args[0]).toEqual({ viaje_id: null });
    expect(update.ops.find((o) => o.m === 'eq')!.args).toEqual(['viaje_id', VIAJE_ID]);
    expect(update.ops.find((o) => o.m === 'abortSignal')!.args[0]).toBeInstanceOf(AbortSignal); // timeout de escritura
    expect(byId('lista-de-viajes')!.dataset.aviso).toBe('eliminado');
  });

  it('mientras se cuentan los gastos el botón de confirmar está deshabilitado ("Revisando…") y recién después aparece el texto con el número', async () => {
    let resolver: (r: Resp) => void = () => {};
    const pendiente = new Promise<Resp>((resolve) => {
      resolver = resolve;
    });
    route.contarGastos = () => pendiente;
    await abrirConfirmacion();
    expect(bodyText()).toContain('Revisando si el viaje tiene gastos o devoluciones…');
    expect(buttonByText('Sí, eliminar')!.disabled).toBe(true);
    expect(buttonByText('Cancelar')!.disabled).toBe(false); // se puede cancelar mientras tanto

    await act(async () => {
      resolver(conteo(2));
    });
    await settle(4);
    expect(bodyText()).toContain('Este viaje tiene 2 gastos.');
    expect(buttonByText('Desvincular los gastos y borrar el viaje')!.disabled).toBe(false);
  });

  it('si el conteo falla al abrir: texto genérico y se puede confirmar; al confirmar se RECUENTA y, sin devoluciones, sigue con el borrado', async () => {
    let intento = 0;
    route.contarGastos = () => {
      intento += 1;
      return intento === 1 ? sinRed() : conteo(0); // falla al abrir; con señal al recontar
    };
    await abrirConfirmacion();
    expect(bodyText()).toContain('Si tiene gastos vinculados, se conservan pero quedan sin viaje; si tiene devoluciones, se borran con el viaje.');
    expect(buttonByText('Sí, eliminar')!.disabled).toBe(false);
    await click(buttonByText('Sí, eliminar'));
    await settle(4);
    expect(secuenciaDeBorrado()).toEqual(['conteo', 'conteo', 'desvincular', 'borrar']); // abrir (falló), recuento, UPDATE, DELETE
    expect(byId('lista-de-viajes')!.dataset.aviso).toBe('eliminado');
  });

  it('si el conteo falla al abrir y el recuento al confirmar sigue fallando (sin señal): NO borra nada, error de red con "Reintentar"', async () => {
    route.contarGastos = () => sinRed();
    await abrirConfirmacion();
    await click(buttonByText('Sí, eliminar'));
    await settle(4);
    expect(bodyText()).toContain('No hay conexión');
    expect(secuenciaDeBorrado()).not.toContain('desvincular');
    expect(secuenciaDeBorrado()).not.toContain('borrar');
    expect(byId('lista-de-viajes')).toBeNull();
  });

  it('un conteo con otra forma (sin número) también cae en el texto genérico, sin inventar un 0', async () => {
    route.contarGastos = () => ok(null); // `count` ausente
    await abrirConfirmacion();
    expect(bodyText()).toContain('Si tiene gastos vinculados, se conservan pero quedan sin viaje; si tiene devoluciones, se borran con el viaje.');
    expect(bodyText()).not.toContain('¿Seguro? Esto no se puede deshacer.');
    expect(buttonByText('Sí, eliminar')!.disabled).toBe(false);
  });

  it('cancelar y volver a abrir vuelve a contar (el número es siempre el de ahora)', async () => {
    let cantidad = 2;
    route.contarGastos = () => conteo(cantidad);
    await abrirConfirmacion();
    expect(bodyText()).toContain('Este viaje tiene 2 gastos.');
    await click(buttonByText('Cancelar'));
    cantidad = 0;
    await click(buttonByText('Eliminar viaje'));
    expect(secuenciaDeBorrado()).toEqual(['conteo', 'conteo']);
    expect(bodyText()).toContain('¿Seguro? Esto no se puede deshacer.');
    expect(bodyText()).not.toContain('Este viaje tiene');
  });

  /** Una query de cada clase que el borrado tiene que dejar vieja, sin observadores (solo se marca; no se vuelve a pedir). */
  const clavesQueDebenQuedarViejas = () => ({
    'lista de viajes del mes': viajesKeys.list('tenant-a', '2025-06-01', '2025-07-01'),
    'viajes recientes del selector de gastos': viajesKeys.recientes('tenant-a'),
    'pantalla de solo lectura del viaje': viajesKeys.vista('tenant-a', VIAJE_ID),
    'lista de gastos del mes': gastosKeys.list('tenant-a', '2025-06-01', '2025-07-01', null),
    'gastos del viaje': gastosKeys.delViaje('tenant-a', VIAJE_ID),
    'detalle de un gasto': gastosKeys.detail('tenant-a', G_ID),
  });

  it('tras borrar: se invalidan las listas de viajes (y los recientes y la vista) y TODO lo de gastos, que cambió', async () => {
    route.detalle = () => ok(detalleViaje());
    route.contarGastos = () => conteo(2);
    await mount(`/viajes/${VIAJE_ID}/editar`);
    const claves = clavesQueDebenQuedarViejas();
    for (const key of Object.values(claves)) queryClient.setQueryData(key, []);
    await click(buttonByText('Eliminar viaje'));
    await click(buttonByText('Desvincular los gastos y borrar el viaje'));
    await settle(4);
    expect(byId('lista-de-viajes')!.dataset.aviso).toBe('eliminado');
    for (const [nombre, key] of Object.entries(claves)) expect(queryClient.getQueryState(key)?.isInvalidated, nombre).toBe(true);
  });

  it('si el borrado falla DESPUÉS de desvincular (el paso 1 sí se aplicó), los gastos también se marcan viejos', async () => {
    route.detalle = () => ok(detalleViaje());
    route.borrar = () => sinRed();
    await mount(`/viajes/${VIAJE_ID}/editar`);
    const claves = clavesQueDebenQuedarViejas();
    for (const key of Object.values(claves)) queryClient.setQueryData(key, []);
    await eliminarViajeConfirmando();
    expect(bodyText()).toContain('No hay conexión');
    expect(queryClient.getQueryState(claves['gastos del viaje'])?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(claves['lista de gastos del mes'])?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(claves['lista de viajes del mes'])?.isInvalidated).toBe(true);
  });

  it('si al confirmar la cantidad de gastos ya no es la mostrada (la confirmación quedó abierta y alguien vinculó otros), NO desvincula ni borra: avisa, muestra el número nuevo y el reintento usa ese', async () => {
    let conteos = 0;
    route.contarGastos = () => {
      conteos += 1;
      return conteo(conteos === 1 ? 3 : 5); // al abrir había 3; al confirmar ya son 5
    };
    await abrirConfirmacion();
    expect(bodyText()).toContain('Este viaje tiene 3 gastos.');
    await click(buttonByText('Desvincular los gastos y borrar el viaje'));
    await settle(4);

    expect(bodyText()).toContain('Ahora el viaje tiene 5 gastos. Revisa y vuelve a confirmar.');
    expect(secuenciaDeBorrado()).toEqual(['conteo', 'conteo', 'conteo']); // abrir, recontar al confirmar y refrescar: nada más
    expect(bodyText()).toContain('Este viaje tiene 5 gastos.'); // el texto ya muestra el número de ahora
    expect(byId('lista-de-viajes')).toBeNull();

    await click(buttonByText('Reintentar'));
    await settle(4);
    expect(secuenciaDeBorrado()).toEqual(['conteo', 'conteo', 'conteo', 'conteo', 'desvincular', 'borrar']);
    expect(byId('lista-de-viajes')!.dataset.aviso).toBe('eliminado');
  });

  it('si se corta DESPUÉS de desvincular (el viaje no se borró), el error dice que los gastos ya quedaron sin viaje; "Reintentar" termina el borrado', async () => {
    let conteos = 0;
    route.contarGastos = () => {
      conteos += 1;
      return conteo(conteos <= 2 ? 3 : 0); // 3 antes de desvincular; 0 después (ya no están vinculados)
    };
    route.desvincular = () => ok([{ id: 'g-1' }, { id: 'g-2' }, { id: 'g-3' }]);
    let borrados = 0;
    route.borrar = () => {
      borrados += 1;
      return borrados === 1 ? sinRed() : ok([{ id: VIAJE_ID }]);
    };
    await abrirConfirmacion();
    await click(buttonByText('Desvincular los gastos y borrar el viaje'));
    await settle(4);

    expect(bodyText()).toContain('Los 3 gastos ya quedaron sin viaje, pero el viaje no se borró.');
    expect(bodyText()).toContain('No hay conexión'); // y el motivo
    expect(buttonByText('Reintentar')).toBeTruthy();
    expect(byId('lista-de-viajes')).toBeNull();
    expect(bodyText()).toContain('¿Seguro? Esto no se puede deshacer.'); // el conteo refrescado: ya no quedan gastos vinculados

    await click(buttonByText('Reintentar'));
    await settle(4);
    expect(byId('lista-de-viajes')!.dataset.aviso).toBe('eliminado');
  });

  it('sin señal, al volver a abrir la confirmación NO se muestra el número de la vez anterior: espera ("Revisando…", botón deshabilitado) hasta poder contar', async () => {
    let cantidad = 3;
    route.contarGastos = () => conteo(cantidad);
    await abrirConfirmacion();
    expect(bodyText()).toContain('Este viaje tiene 3 gastos.');
    await click(buttonByText('Cancelar'));

    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    await act(async () => {
      window.dispatchEvent(new Event('offline'));
    });
    cantidad = 1;
    await click(buttonByText('Eliminar viaje'));
    await settle(4);
    expect(bodyText()).toContain('Revisando si el viaje tiene gastos o devoluciones…');
    expect(bodyText()).not.toContain('Este viaje tiene 3 gastos.');
    expect(buttonByText('Sí, eliminar')!.disabled).toBe(true);

    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    await settle(6);
    expect(bodyText()).toContain('Este viaje tiene 1 gasto.');
    expect(buttonByText('Desvincular el gasto y borrar el viaje')!.disabled).toBe(false);
  });

  it('el botón largo se parte en líneas (no se corta) y sigue siendo de al menos 48 px', async () => {
    route.contarGastos = () => conteo(3);
    await abrirConfirmacion();
    const boton = buttonByText('Desvincular los gastos y borrar el viaje')!;
    expect(boton.className).toContain('whitespace-normal');
    expect(boton.className).toContain('min-h-12');
  });

  it('el texto de la confirmación queda enlazado a "Cancelar" (aria-describedby) y se anuncia el estado al lector de pantalla', async () => {
    route.contarGastos = () => conteo(3);
    await abrirConfirmacion();
    const cancelar = buttonByText('Cancelar')!;
    const descripcion = document.getElementById(cancelar.getAttribute('aria-describedby')!);
    expect(descripcion?.textContent).toContain('Este viaje tiene 3 gastos.');
    expect(descripcion?.getAttribute('aria-live')).toBe('polite'); // si el texto cambia con la confirmación abierta, se anuncia
  });
});

// ---------------------------------------------------------------------------
// Borrado de un viaje CON devoluciones: se borran en cascada y la confirmación lo dice
// ---------------------------------------------------------------------------
describe('formulario de viaje: eliminar un viaje con devoluciones', () => {
  const abrirConfirmacion = async () => {
    route.detalle = () => ok(detalleViaje());
    await mount(`/viajes/${VIAJE_ID}/editar`);
    await click(buttonByText('Eliminar viaje'));
  };
  const promptDeLaConfirmacion = () => {
    const cancelar = buttonByText('Cancelar')!;
    return document.getElementById(cancelar.getAttribute('aria-describedby')!)?.textContent ?? '';
  };

  it('no pide nada hasta abrir la confirmación; al abrirla pide los DOS conteos (gastos y devoluciones), cada uno con select("id", { count: "exact", head: true }) por viaje_id', async () => {
    route.detalle = () => ok(detalleViaje());
    await mount(`/viajes/${VIAJE_ID}/editar`);
    expect(secuenciaCompleta()).toEqual([]);
    await click(buttonByText('Eliminar viaje'));
    expect(secuenciaCompleta()).toEqual(['conteo-gastos', 'conteo-devoluciones']);
    for (const call of [callsTo('gastos')[0]!, callsTo('devoluciones')[0]!]) {
      expect(call.ops.find((o) => o.m === 'select')!.args).toEqual(['id', { count: 'exact', head: true }]);
      expect(call.ops.find((o) => o.m === 'eq')!.args).toEqual(['viaje_id', VIAJE_ID]);
    }
  });

  it('la tabla completa en pantalla: cada combinación de gastos y devoluciones dice lo suyo, con su botón', async () => {
    const tabla: Array<[number, number, string, string]> = [
      [0, 0, '¿Seguro? Esto no se puede deshacer.', 'Sí, eliminar'],
      [3, 0, '¿Seguro? Este viaje tiene 3 gastos. Se conservan, pero quedan sin viaje. Esto no se puede deshacer.', 'Desvincular los gastos y borrar el viaje'],
      [1, 0, '¿Seguro? Este viaje tiene 1 gasto. Se conserva, pero queda sin viaje. Esto no se puede deshacer.', 'Desvincular el gasto y borrar el viaje'],
      [0, 2, '¿Seguro? Este viaje tiene 2 devoluciones. Se borran junto con el viaje. Esto no se puede deshacer.', 'Borrar el viaje y sus devoluciones'],
      [0, 1, '¿Seguro? Este viaje tiene 1 devolución. Se borra junto con el viaje. Esto no se puede deshacer.', 'Borrar el viaje y su devolución'],
      [3, 2, '¿Seguro? Este viaje tiene 3 gastos y 2 devoluciones. Los gastos se conservan, pero quedan sin viaje; las devoluciones se borran con el viaje. Esto no se puede deshacer.', 'Borrar el viaje y sus devoluciones'],
      [1, 2, '¿Seguro? Este viaje tiene 1 gasto y 2 devoluciones. El gasto se conserva, pero queda sin viaje; las devoluciones se borran con el viaje. Esto no se puede deshacer.', 'Borrar el viaje y sus devoluciones'],
      [3, 1, '¿Seguro? Este viaje tiene 3 gastos y 1 devolución. Los gastos se conservan, pero quedan sin viaje; la devolución se borra con el viaje. Esto no se puede deshacer.', 'Borrar el viaje y su devolución'],
      [1, 1, '¿Seguro? Este viaje tiene 1 gasto y 1 devolución. El gasto se conserva, pero queda sin viaje; la devolución se borra con el viaje. Esto no se puede deshacer.', 'Borrar el viaje y su devolución'],
    ];
    for (const [gastos, devoluciones, prompt, etiqueta] of tabla) {
      route.contarGastos = () => conteo(gastos);
      route.contarDevoluciones = () => conteo(devoluciones);
      await abrirConfirmacion();
      expect(promptDeLaConfirmacion(), `${gastos}/${devoluciones}`).toBe(prompt);
      const confirmar = buttonByText(etiqueta);
      expect(confirmar, `${gastos}/${devoluciones}`).toBeTruthy();
      expect(confirmar!.disabled).toBe(false);
      await act(async () => {
        root.unmount();
      });
      container.remove();
      queryClient.clear();
      h.calls.length = 0;
    }
  });

  it('con devoluciones el botón dice lo que pasa (no "Sí, eliminar") y se parte en líneas en vez de cortarse', async () => {
    route.contarDevoluciones = () => conteo(2);
    await abrirConfirmacion();
    expect(buttonByText('Sí, eliminar')).toBeUndefined();
    const boton = buttonByText('Borrar el viaje y sus devoluciones')!;
    expect(boton.className).toContain('whitespace-normal');
    expect(boton.className).toContain('min-h-12');
  });

  it('mientras se cuentan ("Revisando si el viaje tiene gastos o devoluciones…") el botón está deshabilitado, aunque el conteo de gastos ya haya llegado: nunca un número a medias', async () => {
    let resolver: (r: Resp) => void = () => {};
    route.contarGastos = () => conteo(2);
    route.contarDevoluciones = () =>
      new Promise<Resp>((resolve) => {
        resolver = resolve;
      });
    await abrirConfirmacion();
    expect(bodyText()).toContain('Revisando si el viaje tiene gastos o devoluciones…');
    expect(bodyText()).not.toContain('Este viaje tiene 2 gastos');
    expect(buttonByText('Sí, eliminar')!.disabled).toBe(true);
    expect(buttonByText('Cancelar')!.disabled).toBe(false);

    await act(async () => {
      resolver(conteo(1));
    });
    await settle(4);
    expect(promptDeLaConfirmacion()).toContain('Este viaje tiene 2 gastos y 1 devolución.');
    expect(buttonByText('Borrar el viaje y su devolución')!.disabled).toBe(false);
  });

  it('si falla el conteo de DEVOLUCIONES al abrir (el de gastos salió): texto genérico; al confirmar se RECUENTA y, sin devoluciones, sigue con el borrado', async () => {
    let intento = 0;
    route.contarGastos = () => conteo(2);
    route.contarDevoluciones = () => {
      intento += 1;
      return intento === 1 ? sinRed() : conteo(0);
    };
    await abrirConfirmacion();
    expect(promptDeLaConfirmacion()).toBe(
      '¿Seguro? Si tiene gastos vinculados, se conservan pero quedan sin viaje; si tiene devoluciones, se borran con el viaje. Esto no se puede deshacer.',
    );
    expect(buttonByText('Sí, eliminar')!.disabled).toBe(false);
    await click(buttonByText('Sí, eliminar'));
    await settle(4);
    expect(secuenciaCompleta()).toEqual([
      'conteo-gastos',
      'conteo-devoluciones', // al abrir (falló)
      'conteo-gastos',
      'conteo-devoluciones', // el recuento al confirmar
      'desvincular',
      'borrar',
    ]);
    expect(byId('lista-de-viajes')!.dataset.aviso).toBe('eliminado');
  });

  // Hallazgo MEDIO de la auditoría: con el conteo fallido el borrado se saltaba el recuento y las devoluciones se perdían
  // sin que el usuario viera cuántas eran.
  it('si el conteo falló al abrir y al confirmar el recuento encuentra DEVOLUCIONES: NO borra, avisa con los números de ahora y la confirmación pasa a mostrarlos (con la etiqueta que nombra lo que se borra)', async () => {
    let intento = 0;
    route.contarGastos = () => conteo(1);
    route.contarDevoluciones = () => {
      intento += 1;
      return intento === 1 ? sinRed() : conteo(2);
    };
    await abrirConfirmacion();
    expect(promptDeLaConfirmacion()).toContain('si tiene devoluciones, se borran con el viaje.'); // genérico: no se vio ningún número
    await click(buttonByText('Sí, eliminar'));
    await settle(6);

    expect(bodyText()).toContain('Ahora el viaje tiene 1 gasto y 2 devoluciones. Revisa y vuelve a confirmar.');
    expect(secuenciaCompleta()).not.toContain('desvincular');
    expect(secuenciaCompleta()).not.toContain('borrar');
    expect(byId('lista-de-viajes')).toBeNull();
    // La confirmación vuelve a pedir los números y ahora los muestra; el botón conserva la etiqueta que dice qué se borra.
    expect(promptDeLaConfirmacion()).toContain('Este viaje tiene 1 gasto y 2 devoluciones.');
    expect(buttonByText('Borrar el viaje y sus devoluciones')).toBeTruthy();
    expect(buttonByText('Reintentar')).toBeUndefined();

    await click(buttonByText('Borrar el viaje y sus devoluciones'));
    await settle(4);
    expect(secuenciaCompleta()).toContain('desvincular');
    expect(byId('lista-de-viajes')!.dataset.aviso).toBe('eliminado');
  });

  it('si falla el conteo de GASTOS (el de devoluciones salió): también texto genérico', async () => {
    route.contarGastos = () => sinRed();
    route.contarDevoluciones = () => conteo(4);
    await abrirConfirmacion();
    expect(promptDeLaConfirmacion()).toContain('si tiene devoluciones, se borran con el viaje.');
    expect(promptDeLaConfirmacion()).not.toContain('4 devoluciones'); // no se muestra un número a medias
    expect(buttonByText('Sí, eliminar')!.disabled).toBe(false);
  });

  it('un conteo de devoluciones con otra forma (sin número) cae en el texto genérico, sin inventar un 0', async () => {
    route.contarDevoluciones = () => ok(null);
    await abrirConfirmacion();
    expect(promptDeLaConfirmacion()).toContain('si tiene devoluciones, se borran con el viaje.');
    expect(promptDeLaConfirmacion()).not.toBe('¿Seguro? Esto no se puede deshacer.');
  });

  it('confirmar con devoluciones: los dos conteos, el recuento de AMBOS, desvincular los gastos y borrar el viaje, en ese orden; las devoluciones no reciben ninguna escritura (se borran en cascada por la base)', async () => {
    route.contarGastos = () => conteo(3);
    route.contarDevoluciones = () => conteo(2);
    await abrirConfirmacion();
    await click(buttonByText('Borrar el viaje y sus devoluciones'));
    await settle(4);

    expect(secuenciaCompleta()).toEqual([
      'conteo-gastos',
      'conteo-devoluciones',
      'conteo-gastos', // el recuento justo antes de desvincular
      'conteo-devoluciones',
      'desvincular',
      'borrar',
    ]);
    expect(secuenciaCompleta()).not.toContain('ESCRITURA-EN-DEVOLUCIONES');
    // El recuento usa timeout de escritura.
    const recuentos = h.calls.filter((c) => (c.target === 'gastos' || c.target === 'devoluciones') && !c.ops.some((o) => o.m === 'update')).slice(2, 4);
    for (const call of recuentos) expect(call.ops.find((o) => o.m === 'abortSignal')!.args[0]).toBeInstanceOf(AbortSignal);
    expect(byId('lista-de-viajes')!.dataset.aviso).toBe('eliminado');
  });

  it('solo devoluciones (sin gastos): igual se recuentan, se hace el paso de desvincular (idempotente, no toca nada) y se borra el viaje', async () => {
    route.contarDevoluciones = () => conteo(1);
    await abrirConfirmacion();
    await click(buttonByText('Borrar el viaje y su devolución'));
    await settle(4);
    expect(secuenciaCompleta()).toEqual(['conteo-gastos', 'conteo-devoluciones', 'conteo-gastos', 'conteo-devoluciones', 'desvincular', 'borrar']);
    expect(byId('lista-de-viajes')!.dataset.aviso).toBe('eliminado');
  });

  it('si al confirmar cambió la cantidad de DEVOLUCIONES (la confirmación quedó abierta y se cargó otra), NO desvincula ni borra: avisa con los números de ahora y el reintento usa esos', async () => {
    let conteos = 0;
    route.contarDevoluciones = () => {
      conteos += 1;
      return conteo(conteos === 1 ? 2 : 3); // al abrir había 2; al confirmar ya son 3
    };
    await abrirConfirmacion();
    expect(promptDeLaConfirmacion()).toContain('Este viaje tiene 2 devoluciones.');
    await click(buttonByText('Borrar el viaje y sus devoluciones'));
    await settle(4);

    expect(bodyText()).toContain('Ahora el viaje tiene 3 devoluciones. Revisa y vuelve a confirmar.');
    expect(secuenciaCompleta()).not.toContain('desvincular');
    expect(secuenciaCompleta()).not.toContain('borrar');
    expect(byId('lista-de-viajes')).toBeNull();
    expect(promptDeLaConfirmacion()).toContain('Este viaje tiene 3 devoluciones.'); // el texto ya muestra el número de ahora
    // Con devoluciones el botón destructivo NO pasa a decir "Reintentar": sigue nombrando lo que se borra.
    expect(buttonByText('Reintentar')).toBeUndefined();
    expect(buttonByText('Borrar el viaje y sus devoluciones')).toBeTruthy();

    await click(buttonByText('Borrar el viaje y sus devoluciones'));
    await settle(4);
    expect(secuenciaCompleta().slice(-2)).toEqual(['desvincular', 'borrar']);
    expect(byId('lista-de-viajes')!.dataset.aviso).toBe('eliminado');
  });

  it('si cambiaron los dos números (gastos y devoluciones), el aviso los dice a la vez', async () => {
    let conteos = 0;
    route.contarGastos = () => {
      conteos += 1;
      return conteo(conteos === 1 ? 3 : 1);
    };
    route.contarDevoluciones = () => conteo(conteos <= 1 ? 2 : 4);
    await abrirConfirmacion();
    await click(buttonByText('Borrar el viaje y sus devoluciones'));
    await settle(4);
    expect(bodyText()).toContain('Ahora el viaje tiene 1 gasto y 4 devoluciones. Revisa y vuelve a confirmar.');
    expect(secuenciaCompleta()).not.toContain('desvincular');
  });

  it('si ahora el viaje ya no tiene ni gastos ni devoluciones, el aviso lo dice', async () => {
    let conteos = 0;
    route.contarGastos = () => {
      conteos += 1;
      return conteo(conteos === 1 ? 1 : 0);
    };
    route.contarDevoluciones = () => conteo(conteos <= 1 ? 1 : 0);
    await abrirConfirmacion();
    await click(buttonByText('Borrar el viaje y su devolución'));
    await settle(4);
    expect(bodyText()).toContain('Ahora el viaje no tiene gastos ni devoluciones vinculados. Revisa y vuelve a confirmar.');
    expect(secuenciaCompleta()).not.toContain('borrar');
  });

  it('si el recuento de devoluciones falla (sin señal), no se toca nada y se ofrece "Reintentar"', async () => {
    let devs = 0;
    route.contarGastos = () => conteo(1);
    route.contarDevoluciones = () => {
      devs += 1;
      return devs === 1 ? conteo(1) : sinRed(); // abrir: bien; recuento: sin señal
    };
    await abrirConfirmacion();
    await click(buttonByText('Borrar el viaje y su devolución'));
    await settle(4);
    expect(bodyText()).toContain('No hay conexión');
    expect(secuenciaCompleta()).not.toContain('desvincular');
    expect(secuenciaCompleta()).not.toContain('borrar');
    expect(byId('lista-de-viajes')).toBeNull();
    expect(buttonByText('Reintentar')).toBeTruthy();
  });

  it('si se corta DESPUÉS de desvincular, el aviso habla de los gastos ("ya quedaron sin viaje") y no de las devoluciones, que siguen intactas: "Reintentar" termina el borrado', async () => {
    let borrados = 0;
    route.contarGastos = () => conteo(3);
    route.contarDevoluciones = () => conteo(2);
    route.desvincular = () => ok([{ id: 'g-1' }, { id: 'g-2' }, { id: 'g-3' }]);
    route.borrar = () => {
      borrados += 1;
      return borrados === 1 ? sinRed() : ok([{ id: VIAJE_ID }]);
    };
    await abrirConfirmacion();
    await click(buttonByText('Borrar el viaje y sus devoluciones'));
    await settle(4);

    expect(bodyText()).toContain('Los 3 gastos ya quedaron sin viaje, pero el viaje no se borró.');
    expect(bodyText()).toContain('No hay conexión');
    expect(secuenciaCompleta()).not.toContain('ESCRITURA-EN-DEVOLUCIONES'); // nada las tocó
    expect(byId('lista-de-viajes')).toBeNull();

    // El botón sigue diciendo qué se borra (con devoluciones no pasa a "Reintentar"): reintentar termina el borrado.
    expect(buttonByText('Reintentar')).toBeUndefined();
    await click(buttonByText('Borrar el viaje y sus devoluciones'));
    await settle(4);
    expect(secuenciaCompleta()).not.toContain('ESCRITURA-EN-DEVOLUCIONES');
    expect(byId('lista-de-viajes')!.dataset.aviso).toBe('eliminado');
  });

  it('cancelar y volver a abrir vuelve a contar AMBOS (los números son siempre los de ahora)', async () => {
    let gastos = 2;
    let devoluciones = 1;
    route.contarGastos = () => conteo(gastos);
    route.contarDevoluciones = () => conteo(devoluciones);
    await abrirConfirmacion();
    expect(promptDeLaConfirmacion()).toContain('Este viaje tiene 2 gastos y 1 devolución.');
    await click(buttonByText('Cancelar'));
    gastos = 0;
    devoluciones = 0;
    await click(buttonByText('Eliminar viaje'));
    expect(secuenciaCompleta()).toEqual(['conteo-gastos', 'conteo-devoluciones', 'conteo-gastos', 'conteo-devoluciones']);
    expect(bodyText()).toContain('¿Seguro? Esto no se puede deshacer.');
    expect(bodyText()).not.toContain('Este viaje tiene');
  });

  /** Una query de devoluciones de cada clase, sin observadores (solo se marca; no se vuelve a pedir). */
  const clavesDeDevoluciones = () => ({
    'devoluciones del viaje': devolucionesKeys.delViaje('tenant-a', VIAJE_ID),
    'detalle de una devolución': devolucionesKeys.detail('tenant-a', 'f0000000-0000-4000-8000-000000000001', VIAJE_ID),
  });

  it('tras borrar: se invalidan las keys de devoluciones del viaje', async () => {
    route.contarDevoluciones = () => conteo(2);
    route.detalle = () => ok(detalleViaje());
    await mount(`/viajes/${VIAJE_ID}/editar`);
    const claves = clavesDeDevoluciones();
    for (const key of Object.values(claves)) queryClient.setQueryData(key, []);
    await click(buttonByText('Eliminar viaje'));
    await click(buttonByText('Borrar el viaje y sus devoluciones'));
    await settle(4);
    expect(byId('lista-de-viajes')!.dataset.aviso).toBe('eliminado');
    for (const [nombre, key] of Object.entries(claves)) expect(queryClient.getQueryState(key)?.isInvalidated, nombre).toBe(true);
  });

  it('si el borrado falla (aunque sea después de desvincular), las keys de devoluciones también se marcan viejas', async () => {
    route.borrar = () => sinRed();
    route.detalle = () => ok(detalleViaje());
    await mount(`/viajes/${VIAJE_ID}/editar`);
    const claves = clavesDeDevoluciones();
    for (const key of Object.values(claves)) queryClient.setQueryData(key, []);
    await eliminarViajeConfirmando();
    expect(bodyText()).toContain('No hay conexión');
    for (const [nombre, key] of Object.entries(claves)) expect(queryClient.getQueryState(key)?.isInvalidated, nombre).toBe(true);
  });

  it('el texto de la confirmación queda enlazado a "Cancelar" (aria-describedby) y se anuncia si cambia', async () => {
    route.contarGastos = () => conteo(3);
    route.contarDevoluciones = () => conteo(2);
    await abrirConfirmacion();
    const cancelar = buttonByText('Cancelar')!;
    const descripcion = document.getElementById(cancelar.getAttribute('aria-describedby')!);
    expect(descripcion?.textContent).toContain('Este viaje tiene 3 gastos y 2 devoluciones.');
    expect(descripcion?.getAttribute('aria-live')).toBe('polite');
  });
});

// ---------------------------------------------------------------------------
// Editar un viaje abierto desde su detalle
// ---------------------------------------------------------------------------
describe('formulario de viaje: abierto desde el detalle', () => {
  const desdeDetalle = (over: Record<string, unknown> = {}): InitialEntry => ({
    pathname: `/viajes/${VIAJE_ID}/editar`,
    state: { desdeViaje: VIAJE_ID, volverViaje: '?mes=2025-06', ...over },
  });

  it('guardar vuelve al DETALLE de ese viaje (con el aviso "viaje-guardado" y el mes para su enlace "Viajes")', async () => {
    route.detalle = () => ok(detalleViaje());
    await mount(desdeDetalle());
    await guardar();
    expect(actualizarCalls()).toHaveLength(1);
    const detalle = byId('detalle-del-viaje')!;
    expect(detalle.dataset.path).toBe(`/viajes/${VIAJE_ID}`);
    expect(detalle.dataset.aviso).toBe('viaje-guardado');
    expect(detalle.dataset.volver).toBe('?mes=2025-06');
    expect(byId('lista-de-viajes')).toBeNull();
  });

  it('el enlace "volver" lleva al detalle de ese viaje (no a la lista), con el mes en el state', async () => {
    route.detalle = () => ok(detalleViaje());
    await mount(desdeDetalle());
    const volver = document.querySelector<HTMLAnchorElement>(`a[href="/viajes/${VIAJE_ID}"]`)!;
    expect(volver).not.toBeNull();
    expect(volver.textContent).toContain('Viaje');
    expect(document.querySelector('a[href="/viajes"]')).toBeNull();
    await click(volver);
    expect(byId('detalle-del-viaje')!.dataset.volver).toBe('?mes=2025-06');
  });

  it('BORRAR el viaje lleva a la LISTA de viajes (el detalle ya no existiría), con el aviso "eliminado" y el mes', async () => {
    route.detalle = () => ok(detalleViaje());
    await mount(desdeDetalle());
    await eliminarViajeConfirmando();
    expect(byId('detalle-del-viaje')).toBeNull();
    expect(byId('lista-de-viajes')!.dataset.aviso).toBe('eliminado');
    expect(byId('lista-de-viajes')!.dataset.search).toBe('?mes=2025-06');
  });

  it('sin desdeViaje todo sigue como hoy: guardar y "volver" van a la lista', async () => {
    route.detalle = () => ok(detalleViaje());
    await mount({ pathname: `/viajes/${VIAJE_ID}/editar`, state: { volver: '?mes=2025-06' } });
    expect(document.querySelector('a[href="/viajes?mes=2025-06"]')).not.toBeNull();
    await guardar();
    expect(byId('lista-de-viajes')!.dataset.aviso).toBe('guardado');
    expect(byId('detalle-del-viaje')).toBeNull();
  });

  it('lista blanca: un desdeViaje que NO es un uuid (una ruta, una URL, un objeto) se ignora y no se navega a ningún lado raro', async () => {
    for (const basura of ['/gastos', '//evil.com', 'https://evil.com/x', '/viajes/../gastos', { id: VIAJE_ID }, ['x'], 42, true, null]) {
      h.calls.length = 0;
      route.detalle = () => ok(detalleViaje());
      await mount({ pathname: `/viajes/${VIAJE_ID}/editar`, state: { desdeViaje: basura, volverViaje: '?mes=2025-06' } });
      expect(document.querySelector('a[href="/viajes"]'), JSON.stringify(basura)).not.toBeNull();
      await guardar();
      expect(byId('lista-de-viajes')?.dataset.aviso, JSON.stringify(basura)).toBe('guardado');
      expect(byId('detalle-del-viaje'), JSON.stringify(basura)).toBeNull();
      await act(async () => {
        root.unmount();
      });
      container.remove();
      queryClient.clear();
    }
  });

  it('un desdeViaje de OTRO viaje (uuid válido pero distinto del de la URL) no cuenta: se vuelve a la lista', async () => {
    route.detalle = () => ok(detalleViaje());
    await mount(desdeDetalle({ desdeViaje: 'b0000000-0000-4000-8000-0000000000aa' }));
    expect(document.querySelector('a[href^="/viajes/b0000000"]')).toBeNull();
    await guardar();
    expect(byId('lista-de-viajes')!.dataset.aviso).toBe('guardado');
  });

  it('el volverViaje se sanea: un search raro se descarta y queda solo lo que la lista podría haber escrito', async () => {
    route.detalle = () => ok(detalleViaje());
    await mount(desdeDetalle({ volverViaje: '?mes=2025-06&x=<script>alert(1)</script>' }));
    await guardar();
    expect(byId('detalle-del-viaje')!.dataset.volver).toBe('?mes=2025-06');
  });
});

// El id de cada control de una fila depende de su clave local, no de su posición.
describe('ids de las filas', () => {
  it('cada fila tiene ids propios y distintos, anclados a su clave', async () => {
    await mount();
    await agregarEntrega();
    await agregarEntrega();
    const ids = selectsDeCliente().map((s) => s.id);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) {
      const key = id.replace(/^entrega-/, '').replace(/-cliente$/, '');
      expect(entregaDomId(key, 'clienteId')).toBe(id);
      expect(byId(entregaDomId(key, 'incidencias'))).not.toBeNull();
    }
  });
});
