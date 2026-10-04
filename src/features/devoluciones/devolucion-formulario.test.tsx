import { act, useMemo, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation, type InitialEntry } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock de supabase: registra cada pedido y responde según la tabla. TODO lo demás (pantalla, formulario, hooks,
// TanStack Query, router, validación, guardado idempotente) es código REAL del proyecto.
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

import { AuthContext, type AuthContextValue } from '@/features/auth/auth-context';
import { MemberProvider } from '@/features/member/member-provider';
import { RequireMember } from '@/app/guards';
import { clientesKeys } from '@/features/clientes/clientes-keys';
import { DevolucionFormPage } from '@/features/devoluciones/devolucion-form-page';
import { devolucionesKeys } from '@/features/devoluciones/devoluciones-keys';
import { viajesKeys } from '@/features/viajes/viajes-keys';
import { queryClient } from '@/lib/query-client';

// ---------------------------------------------------------------------------
// "Base de datos" falsa
// ---------------------------------------------------------------------------
type Resp = { data: unknown; error: { message: string; code: string; details?: string; hint?: string } | null; status: number };
const ok = (data: unknown): Resp => ({ data, error: null, status: 200 });
const fail = (code: string, message: string, details = ''): Resp => ({ data: null, error: { code, message, details, hint: '' }, status: 409 });
const sinRed = (): Resp => ({ data: null, error: { code: '', message: 'TypeError: Failed to fetch' }, status: 0 });

const VIAJE = 'b0000000-0000-4000-8000-000000000001';
const OTRO_VIAJE = 'b0000000-0000-4000-8000-000000000002';
const DEV_ID = 'f0000000-0000-4000-8000-000000000001';
const C_ALMACEN = 'a0000000-0000-4000-8000-000000000001';
const C_BODEGA = 'a0000000-0000-4000-8000-000000000002';
const C_COOP = 'a0000000-0000-4000-8000-000000000003';
const C_DISTRI = 'a0000000-0000-4000-8000-000000000004';
const C_BORRADO = 'a0000000-0000-4000-8000-0000000000ee';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const MIEMBRO = {
  rol: 'admin',
  tema: 'dark',
  color_acento: '#F59E0B',
  transportista_id: 'tenant-a',
  transportistas: { nombre: 'Transportes A' },
};

const CLIENTES = [
  { id: C_ALMACEN, nombre: 'Almacén Central' },
  { id: C_BODEGA, nombre: 'Bodega Norte' },
  { id: C_COOP, nombre: 'Cooperativa Sur' },
  { id: C_DISTRI, nombre: 'Distribuidora Este' },
];

const entrega = (n: number, clienteId: string, nombre: string) => ({
  id: `d0000000-0000-4000-8000-00000000000${n}`,
  cliente_id: clienteId,
  incidencias: null,
  created_at: `2025-06-15T10:00:00.00${n}Z`,
  clientes: { nombre },
});

const vista = (over: Record<string, unknown> = {}) => ({
  id: VIAJE,
  fecha: '2025-06-15',
  origen: 'Rosario',
  destino: 'Córdoba',
  km_inicial: null,
  km_final: null,
  km_recorridos: null,
  ingreso: null,
  observaciones: null,
  // Cooperativa dos veces y Almacén una: los del viaje son Almacén y Cooperativa (sin duplicados, en el orden de la lista).
  entregas: [entrega(1, C_COOP, 'Cooperativa Sur'), entrega(2, C_ALMACEN, 'Almacén Central'), entrega(3, C_COOP, 'Cooperativa Sur')],
  ...over,
});

const devolucionFila = (over: Record<string, unknown> = {}) => ({
  id: DEV_ID,
  viaje_id: VIAJE,
  cliente_id: C_COOP,
  motivo: 'vencimiento',
  descripcion: 'Latas vencidas',
  ...over,
});

type Handler = (call: Call) => unknown;
const route: {
  clientes: Handler;
  viaje: Handler;
  detalle: Handler;
  insertar: Handler;
  actualizar: Handler;
  borrar: Handler;
} = {
  clientes: () => ok(CLIENTES),
  viaje: () => ok(vista()),
  detalle: () => ok(null),
  insertar: () => ok(null),
  actualizar: () => ok([{ id: DEV_ID }]),
  borrar: () => ok([{ id: DEV_ID }]),
};

/** La devolución solo existe en SU viaje: pedirla por otro viaje (o por un id que no es) da 0 filas, como la base. */
const detalleDeLaDevolucion: Handler = (call) => {
  const eqs = call.ops.filter((o) => o.m === 'eq').map((o) => o.args);
  const porId = eqs.find((args) => args[0] === 'id')?.[1];
  const porViaje = eqs.find((args) => args[0] === 'viaje_id')?.[1];
  return porId === DEV_ID && porViaje === VIAJE ? ok(devolucionFila()) : ok(null);
};

function resetRoutes() {
  route.clientes = () => ok(CLIENTES);
  route.viaje = () => ok(vista());
  route.detalle = () => ok(null);
  route.insertar = () => ok(null);
  route.actualizar = () => ok([{ id: DEV_ID }]);
  route.borrar = () => ok([{ id: DEV_ID }]);
}

function installResponder() {
  h.state.responder = (call: Call) => {
    const has = (m: string) => call.ops.some((o) => o.m === m);
    if (call.table === 'miembros' && has('maybeSingle')) return ok(MIEMBRO);
    if (call.table === 'clientes') return route.clientes(call);
    if (call.table === 'viajes') return route.viaje(call);
    if (call.table === 'devoluciones') {
      if (has('insert')) return route.insertar(call);
      if (has('update')) return route.actualizar(call);
      if (has('delete')) return route.borrar(call);
      return route.detalle(call);
    }
    throw new Error(`pedido inesperado: ${call.table} ${call.ops.map((o) => o.m).join('.')}`);
  };
}

const callsTo = (table: string) => h.calls.filter((c) => c.table === table);
const devolucionesCalls = () => callsTo('devoluciones');
const inserts = () => devolucionesCalls().filter((c) => c.ops.some((o) => o.m === 'insert'));
const updates = () => devolucionesCalls().filter((c) => c.ops.some((o) => o.m === 'update'));
const deletes = () => devolucionesCalls().filter((c) => c.ops.some((o) => o.m === 'delete'));
const detalleCalls = () => devolucionesCalls().filter((c) => c.ops.some((o) => o.m === 'maybeSingle'));
const payloadOf = (call: Call, m: 'insert' | 'update') => call.ops.find((o) => o.m === m)!.args[0] as Record<string, unknown>;

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

/** El detalle del viaje de mentira: a dónde se navegó, con qué aviso y con qué `volver`. */
function DetalleProbe() {
  const location = useLocation();
  const state = (location.state as { aviso?: string; volver?: string } | null) ?? {};
  return (
    <div id="detalle-del-viaje" data-path={location.pathname} data-aviso={state.aviso ?? ''} data-volver={state.volver ?? ''} data-state={JSON.stringify(location.state ?? null)}>
      detalle
    </div>
  );
}

/** La lista de viajes de mentira. */
function ListaProbe() {
  const location = useLocation();
  const state = (location.state as { aviso?: string } | null) ?? {};
  return <div id="lista-de-viajes" data-search={location.search} data-aviso={state.aviso ?? ''} data-state={JSON.stringify(location.state ?? null)} />;
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

const NUEVA = `/viajes/${VIAJE}/devoluciones/nueva`;
const EDITAR = `/viajes/${VIAJE}/devoluciones/${DEV_ID}/editar`;

async function mount(entry: InitialEntry = NUEVA) {
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
                  <Route path="/viajes/:viajeId/devoluciones/nueva" element={<DevolucionFormPage modo="nuevo" />} />
                  <Route path="/viajes/:viajeId/devoluciones/:id/editar" element={<DevolucionFormPage modo="editar" />} />
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
const links = () => [...document.querySelectorAll<HTMLAnchorElement>('a')];
const selectCliente = () => byId<HTMLSelectElement>('devolucion-cliente')!;
const textarea = () => byId<HTMLTextAreaElement>('devolucion-descripcion')!;
const radios = () => [...document.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
const radio = (label: string) => radios().find((r) => r.closest('label')?.textContent?.includes(label))!;
const radioLabels = () => radios().map((r) => r.closest('label')!.textContent!.trim());
const radioElegido = () => radios().find((r) => r.checked)?.closest('label')?.textContent?.trim() ?? null;
const grupos = () =>
  [...selectCliente().querySelectorAll('optgroup')].map((g) => ({
    label: g.label,
    opciones: [...g.querySelectorAll('option')].map((o) => o.textContent ?? ''),
  }));
const clienteElegido = () => selectCliente().selectedOptions[0]?.textContent ?? null;
const errorDe = (controlId: string) => byId(`${controlId}-error`)?.textContent ?? '';
const labelDe = (controlId: string) => document.querySelector<HTMLLabelElement>(`label[for="${controlId}"]`)?.textContent ?? '';
const ayudaDe = (controlId: string) => byId(`${controlId}-hint`)?.textContent ?? null;
const enfocado = () => (document.activeElement as HTMLElement | null)?.id ?? '';

async function click(el: HTMLElement | null | undefined) {
  if (!el) throw new Error('no se encontró el elemento a tocar');
  await act(async () => {
    el.click();
  });
  await settle(3);
}
async function typeText(el: HTMLTextAreaElement | null, value: string) {
  if (!el) throw new Error('no se encontró el campo');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
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
    buttonByText('Guardar devolución')!.click();
  });
  await settle(6);
}
/** Llena lo mínimo de una devolución NUEVA: un motivo y un cliente. */
async function llenarLoMinimo(motivo = 'Vencimiento', clienteId = C_COOP) {
  await click(radio(motivo));
  await selectValue(selectCliente(), clienteId);
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
  // Ninguna prueba debe dejar warnings de React (act, anidamiento inválido de DOM, keys...).
  expect(errorSpy.mock.calls.map((c: unknown[]) => String(c[0]))).toEqual([]);
  errorSpy.mockRestore();
});

// ---------------------------------------------------------------------------
// Alta: estructura
// ---------------------------------------------------------------------------
describe('formulario de devolución (alta): estructura', () => {
  it('orden en pantalla: Motivo, Cliente, Descripción y Guardar; título "Nueva devolución"; sin fecha ni "+ Nuevo cliente"', async () => {
    await mount();
    expect(document.querySelector('h1')!.textContent).toBe('Nueva devolución');
    const motivo = radios()[0]!;
    const cliente = selectCliente();
    const descripcion = textarea();
    const guardarBtn = buttonByText('Guardar devolución')!;
    const antes = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(antes(motivo, cliente)).toBe(true);
    expect(antes(cliente, descripcion)).toBe(true);
    expect(antes(descripcion, guardarBtn)).toBe(true);
    expect(document.querySelector('input[type="date"]')).toBeNull(); // la fecha es la del viaje
    expect(bodyText()).not.toContain('Fecha');
    expect(buttonByText('Nuevo cliente')).toBeUndefined();
    expect(bodyText()).not.toContain('Nuevo cliente');
  });

  it('el motivo son 4 botones con las etiquetas exactas, en este orden', async () => {
    await mount();
    expect(radioLabels()).toEqual(['Rotura o daño', 'Vencimiento', 'Mercadería incorrecta', 'Otro']);
    expect(radios().map((r) => r.value)).toEqual(['rotura_danio', 'vencimiento', 'mercaderia_incorrecta', 'otro']);
    expect(document.querySelector('fieldset legend')!.textContent).toBe('Motivo');
    for (const r of radios()) expect(r.required).toBe(true); // obligatorio: sin "(opcional)"
  });

  it('nada viene preseleccionado: ni motivo ni cliente, y la descripción es opcional', async () => {
    await mount();
    expect(radioElegido()).toBeNull();
    expect(selectCliente().value).toBe('');
    expect(clienteElegido()).toBe('Elige un cliente');
    expect(textarea().value).toBe('');
    expect(labelDe('devolucion-descripcion')).toBe('Descripción (opcional)');
    expect(labelDe('devolucion-cliente')).toBe('Cliente'); // obligatorio: sin "(opcional)"
    expect(selectCliente().getAttribute('aria-required')).toBe('true');
  });

  it('al abrirse pide los clientes y el viaje (para ofrecer primero los suyos) y NO manda nada a devoluciones', async () => {
    await mount();
    expect(callsTo('clientes')).toHaveLength(1);
    expect(callsTo('viajes')).toHaveLength(1);
    expect(callsTo('viajes')[0]!.ops.find((o) => o.m === 'eq')!.args).toEqual(['id', VIAJE]);
    expect(devolucionesCalls()).toHaveLength(0);
  });

  it('el enlace de volver dice "Viaje" y lleva a /viajes/<id> (armado en el código)', async () => {
    await mount();
    const volver = links().find((a) => a.textContent?.includes('Viaje'))!;
    expect(volver.getAttribute('href')).toBe(`/viajes/${VIAJE}`);
    expect(volver.textContent).toContain('Viaje');
    expect(volver.className).toContain('min-h-12');
  });

  it('objetivos táctiles: el botón de guardar es de 56 px (h-14) y el selector de cliente de 48 px (h-12)', async () => {
    await mount();
    expect(buttonByText('Guardar devolución')!.className).toContain('h-14');
    expect(selectCliente().className).toContain('h-12');
  });
});

// ---------------------------------------------------------------------------
// Alta: el selector de cliente
// ---------------------------------------------------------------------------
describe('formulario de devolución: el selector de cliente', () => {
  it('con entregas: "Clientes de este viaje" primero (sin duplicados, en el orden de la lista) y "Otros clientes" debajo', async () => {
    await mount();
    expect(grupos()).toEqual([
      { label: 'Clientes de este viaje', opciones: ['Almacén Central', 'Cooperativa Sur'] }, // Cooperativa tiene 2 entregas: una sola vez
      { label: 'Otros clientes', opciones: ['Bodega Norte', 'Distribuidora Este'] },
    ]);
    // El placeholder va primero y no se puede volver a elegir (obligatorio).
    const primera = selectCliente().options[0]!;
    expect(primera.textContent).toBe('Elige un cliente');
    expect(primera.disabled).toBe(true);
  });

  it('cada cliente aparece una sola vez en total', async () => {
    await mount();
    const valores = [...selectCliente().options].map((o) => o.value).filter(Boolean);
    expect(valores).toHaveLength(4);
    expect(new Set(valores).size).toBe(4);
  });

  it('un viaje sin entregas: un solo grupo "Clientes" con todos', async () => {
    route.viaje = () => ok(vista({ entregas: [] }));
    await mount();
    expect(grupos()).toEqual([{ label: 'Clientes', opciones: ['Almacén Central', 'Bodega Norte', 'Cooperativa Sur', 'Distribuidora Este'] }]);
  });

  it('un viaje cuyas entregas son de clientes que no están en la lista: también un solo grupo "Clientes"', async () => {
    route.viaje = () => ok(vista({ entregas: [entrega(1, C_BORRADO, 'Cliente borrado')] }));
    await mount();
    expect(grupos().map((g) => g.label)).toEqual(['Clientes']);
    expect(grupos()[0]!.opciones).toHaveLength(4);
  });

  it('se puede elegir un cliente de "Otros clientes" (la base permite una devolución de un cliente sin entrega en el viaje)', async () => {
    await mount();
    await llenarLoMinimo('Rotura o daño', C_DISTRI);
    await guardar();
    expect(payloadOf(inserts()[0]!, 'insert').cliente_id).toBe(C_DISTRI);
  });

  it('sin clientes: lo explica y no se puede guardar (no se manda nada)', async () => {
    route.clientes = () => ok([]);
    await mount();
    expect(bodyText()).toContain('Todavía no tienes clientes: se crean al cargar una entrega en un viaje.');
    expect(ayudaDe('devolucion-cliente')).toBe('Todavía no tienes clientes: se crean al cargar una entrega en un viaje.');
    expect(selectCliente().options).toHaveLength(1); // solo el placeholder
    const boton = buttonByText('Guardar devolución')!;
    expect(boton.disabled).toBe(true);
    await click(radio('Vencimiento'));
    await guardar();
    expect(inserts()).toHaveLength(0);
    expect(buttonByText('Nuevo cliente')).toBeUndefined();
  });

  it('con más de 500 clientes avisa que se muestran los primeros 500', async () => {
    route.clientes = () => ok(Array.from({ length: 501 }, (_, i) => ({ id: `a1000000-0000-4000-8000-${String(i).padStart(12, '0')}`, nombre: `Cliente ${String(i).padStart(3, '0')}` })));
    await mount();
    expect(ayudaDe('devolucion-cliente')).toBe('Tienes más de 500 clientes: aquí se muestran los primeros 500, por orden alfabético.');
  });
});

// ---------------------------------------------------------------------------
// Alta: validación y foco
// ---------------------------------------------------------------------------
describe('formulario de devolución: validación y foco', () => {
  it('enviar vacío: "Elige un motivo." y "Elige un cliente." en su campo, foco en el primero (el motivo) y NO se manda nada', async () => {
    await mount();
    await guardar();
    expect(errorDe('devolucion-motivo')).toBe('Elige un motivo.');
    expect(errorDe('devolucion-cliente')).toBe('Elige un cliente.');
    expect(errorDe('devolucion-descripcion')).toBe('');
    expect(enfocado()).toBe('devolucion-motivo-0');
    expect(inserts()).toHaveLength(0);
    expect(selectCliente().getAttribute('aria-invalid')).toBe('true');
    expect(selectCliente().getAttribute('aria-describedby')).toContain('devolucion-cliente-error');
    expect(byId('devolucion-cliente-error')!.getAttribute('aria-live')).toBe('polite'); // anunciado a lectores de pantalla
  });

  it('al corregir un campo se descarta su error y el foco va al SIGUIENTE campo con error, en orden visual', async () => {
    await mount();
    await guardar();
    await click(radio('Vencimiento'));
    expect(errorDe('devolucion-motivo')).toBe(''); // se descartó al tocarlo
    expect(errorDe('devolucion-cliente')).toBe('Elige un cliente.'); // el otro sigue hasta corregirlo
    await guardar();
    expect(enfocado()).toBe('devolucion-cliente');
    await selectValue(selectCliente(), C_ALMACEN);
    expect(errorDe('devolucion-cliente')).toBe('');
    await guardar();
    expect(inserts()).toHaveLength(1);
  });

  it('con el motivo elegido y sin cliente, el foco va al selector de cliente', async () => {
    await mount();
    await click(radio('Vencimiento'));
    await guardar();
    expect(enfocado()).toBe('devolucion-cliente');
    expect(errorDe('devolucion-motivo')).toBe('');
  });

  it('descripción de más de 2000 caracteres: error del largo y foco en la descripción', async () => {
    await mount();
    await llenarLoMinimo();
    await typeText(textarea(), 'a'.repeat(2001));
    await guardar();
    expect(errorDe('devolucion-descripcion')).toBe('La descripción puede tener hasta 2000 caracteres.');
    expect(enfocado()).toBe('devolucion-descripcion');
    expect(inserts()).toHaveLength(0);
  });

  it('contador de la descripción: nada hasta 1799, "1800 de 2000 caracteres" desde 1800 y el aviso de más de 2000', async () => {
    await mount();
    await typeText(textarea(), 'a'.repeat(1799));
    expect(ayudaDe('devolucion-descripcion')).toBeNull();
    await typeText(textarea(), 'a'.repeat(1800));
    expect(ayudaDe('devolucion-descripcion')).toBe('1800 de 2000 caracteres');
    await typeText(textarea(), 'a'.repeat(2000));
    expect(ayudaDe('devolucion-descripcion')).toBe('2000 de 2000 caracteres');
    await typeText(textarea(), 'a'.repeat(2001));
    expect(ayudaDe('devolucion-descripcion')).toBe('Más de 2000 caracteres: acórtala.');
  });

  it('el contador cuenta como la base (code points): 1800 emojis son 1800 caracteres, no 3600', async () => {
    await mount();
    await typeText(textarea(), '😀'.repeat(1800));
    expect(ayudaDe('devolucion-descripcion')).toBe('1800 de 2000 caracteres');
  });

  it('exactamente 2000 caracteres se guarda', async () => {
    await mount();
    await llenarLoMinimo();
    await typeText(textarea(), 'a'.repeat(2000));
    await guardar();
    expect(inserts()).toHaveLength(1);
  });
});

describe('formulario de devolución: el motivo "Otro" exige la descripción', () => {
  it('al elegir "Otro" la etiqueta pierde "(opcional)" y la ayuda dice que es obligatoria', async () => {
    await mount();
    expect(labelDe('devolucion-descripcion')).toBe('Descripción (opcional)');
    expect(ayudaDe('devolucion-descripcion')).toBeNull();
    await click(radio('Otro'));
    expect(labelDe('devolucion-descripcion')).toBe('Descripción');
    expect(ayudaDe('devolucion-descripcion')).toBe('Obligatoria si el motivo es «Otro»: escribe qué pasó.');
    expect(textarea().getAttribute('aria-required')).toBe('true');
  });

  it('con otro motivo la descripción sigue opcional (etiqueta y sin ayuda)', async () => {
    await mount();
    for (const motivo of ['Rotura o daño', 'Vencimiento', 'Mercadería incorrecta']) {
      await click(radio(motivo));
      expect(labelDe('devolucion-descripcion'), motivo).toBe('Descripción (opcional)');
      expect(ayudaDe('devolucion-descripcion'), motivo).toBeNull();
      expect(textarea().getAttribute('aria-required')).toBeNull();
    }
  });

  it('"Otro" con la descripción vacía (o solo espacios): "Escribe qué pasó con esta devolución.", foco en la descripción y NO se manda nada', async () => {
    await mount();
    await llenarLoMinimo('Otro', C_ALMACEN);
    await typeText(textarea(), '   ');
    await guardar();
    expect(errorDe('devolucion-descripcion')).toBe('Escribe qué pasó con esta devolución.');
    expect(enfocado()).toBe('devolucion-descripcion');
    expect(inserts()).toHaveLength(0);
  });

  it('"Otro" con descripción se guarda', async () => {
    await mount();
    await llenarLoMinimo('Otro', C_ALMACEN);
    await typeText(textarea(), 'El cliente cerró antes');
    await guardar();
    const row = payloadOf(inserts()[0]!, 'insert');
    expect(row.motivo).toBe('otro');
    expect(row.descripcion).toBe('El cliente cerró antes');
  });

  it('al CAMBIAR de motivo, ese error se descarta (ya no vale) y se puede guardar sin descripción', async () => {
    await mount();
    await llenarLoMinimo('Otro', C_ALMACEN);
    await guardar();
    expect(errorDe('devolucion-descripcion')).toBe('Escribe qué pasó con esta devolución.');
    await click(radio('Vencimiento'));
    expect(errorDe('devolucion-descripcion')).toBe('');
    expect(labelDe('devolucion-descripcion')).toBe('Descripción (opcional)');
    await guardar();
    expect(inserts()).toHaveLength(1);
    expect(payloadOf(inserts()[0]!, 'insert').descripcion).toBeNull();
  });

  it('cambiar de motivo NO descarta otros errores de la descripción (el del largo sigue)', async () => {
    await mount();
    await llenarLoMinimo('Otro', C_ALMACEN);
    await typeText(textarea(), 'a'.repeat(2001));
    await guardar();
    expect(errorDe('devolucion-descripcion')).toBe('La descripción puede tener hasta 2000 caracteres.');
    await click(radio('Vencimiento'));
    expect(errorDe('devolucion-descripcion')).toBe('La descripción puede tener hasta 2000 caracteres.');
  });

  it('si el error de "Otro" estaba y se vuelve a elegir "Otro" sin escribir, se vuelve a validar al guardar', async () => {
    await mount();
    await llenarLoMinimo('Otro', C_ALMACEN);
    await guardar();
    await click(radio('Vencimiento'));
    await click(radio('Otro'));
    await guardar();
    expect(errorDe('devolucion-descripcion')).toBe('Escribe qué pasó con esta devolución.');
  });
});

// ---------------------------------------------------------------------------
// Alta: guardar
// ---------------------------------------------------------------------------
describe('formulario de devolución (alta): guardar', () => {
  it('INSERT con el viaje de la URL, motivo, cliente y descripción recortada, un client_ref uuid y NUNCA id ni transportista_id; vuelve al viaje con "devolucion-guardada"', async () => {
    await mount();
    await llenarLoMinimo('Mercadería incorrecta', C_BODEGA);
    await typeText(textarea(), '  Llegaron cajas de otro pedido \n');
    await guardar();

    expect(inserts()).toHaveLength(1);
    const row = payloadOf(inserts()[0]!, 'insert');
    expect(row).toEqual({
      viaje_id: VIAJE,
      motivo: 'mercaderia_incorrecta',
      cliente_id: C_BODEGA,
      descripcion: 'Llegaron cajas de otro pedido',
      client_ref: expect.stringMatching(UUID),
    });
    expect(row).not.toHaveProperty('id');
    expect(row).not.toHaveProperty('transportista_id');
    // Escritura con timeout y sin .select()
    expect(inserts()[0]!.ops.map((o) => o.m)).toEqual(['insert', 'abortSignal']);
    expect(inserts()[0]!.ops.find((o) => o.m === 'abortSignal')!.args[0]).toBeInstanceOf(AbortSignal);

    const detalle = byId('detalle-del-viaje')!;
    expect(detalle.dataset.path).toBe(`/viajes/${VIAJE}`);
    expect(detalle.dataset.aviso).toBe('devolucion-guardada');
  });

  it('sin descripción manda descripcion = null explícito', async () => {
    await mount();
    await llenarLoMinimo();
    await guardar();
    const row = payloadOf(inserts()[0]!, 'insert');
    expect(Object.prototype.hasOwnProperty.call(row, 'descripcion')).toBe(true);
    expect(row.descripcion).toBeNull();
  });

  it('el mes de la lista de viajes se conserva: el "volver" del state llega al detalle (y al enlace "Viaje")', async () => {
    await mount({ pathname: NUEVA, state: { volver: '?mes=2025-06' } });
    const volver = links().find((a) => a.textContent?.includes('Viaje'))!;
    expect(volver.getAttribute('href')).toBe(`/viajes/${VIAJE}`);
    await llenarLoMinimo();
    await guardar();
    expect(byId('detalle-del-viaje')!.dataset.volver).toBe('?mes=2025-06');
  });

  it('un "volver" raro del state se sanea: solo lo que la lista de viajes podría haber escrito', async () => {
    for (const [raro, saneado] of [
      ['//evil.com?mes=2025-06&x=<script>', ''],
      ['https://evil.com', ''],
      [{ mes: '2025-06' }, ''],
      ['?mes=2999-01', ''], // un mes futuro cae en el actual
      ['?mes=2025-06&x=<script>', '?mes=2025-06'], // lo que sobra se descarta
    ] as const) {
      await mount({ pathname: NUEVA, state: { volver: raro } });
      await llenarLoMinimo();
      await guardar();
      expect(byId('detalle-del-viaje')!.dataset.volver, JSON.stringify(raro)).toBe(saneado);
      await act(async () => {
        root.unmount();
      });
      container.remove();
      queryClient.clear();
      h.calls.length = 0;
    }
  });

  it('el state solo lleva { aviso, volver }: ningún otro dato (ni una ruta) viaja al detalle', async () => {
    await mount({ pathname: NUEVA, state: { volver: '?mes=2025-06', desdeViaje: '/gastos', ruta: '//evil.com' } });
    await llenarLoMinimo();
    await guardar();
    expect(JSON.parse(byId('detalle-del-viaje')!.dataset.state!)).toEqual({ aviso: 'devolucion-guardada', volver: '?mes=2025-06' });
  });

  it('doble toque en "Guardar": un solo INSERT (queda bloqueado hasta salir de la pantalla)', async () => {
    await mount();
    await llenarLoMinimo();
    await act(async () => {
      const boton = buttonByText('Guardar devolución')!;
      boton.click();
      boton.click();
    });
    await settle(6);
    expect(inserts()).toHaveLength(1);
  });

  it('falla de red: error con "Reintentar", lo tipeado queda y el reintento usa el MISMO client_ref', async () => {
    let intento = 0;
    route.insertar = () => {
      intento += 1;
      return intento === 1 ? sinRed() : ok(null);
    };
    await mount();
    await llenarLoMinimo('Rotura o daño', C_ALMACEN);
    await typeText(textarea(), 'Pallet roto');
    await guardar();

    expect(byId('detalle-del-viaje')).toBeNull();
    expect(bodyText()).toContain('No hay conexión');
    expect(buttonByText('Reintentar')).toBeTruthy();
    expect(radioElegido()).toBe('Rotura o daño');
    expect(selectCliente().value).toBe(C_ALMACEN);
    expect(textarea().value).toBe('Pallet roto');

    await click(buttonByText('Reintentar'));
    await settle(4);
    expect(inserts()).toHaveLength(2);
    const [primero, segundo] = inserts().map((c) => payloadOf(c, 'insert'));
    expect(segundo!.client_ref).toBe(primero!.client_ref);
    expect(segundo).toEqual(primero);
    expect(byId('detalle-del-viaje')!.dataset.aviso).toBe('devolucion-guardada');
  });

  it('respuesta perdida (la devolución SÍ se guardó): el reintento da 23505 del client_ref y se trata como "Devolución guardada", sin duplicar ni actualizar', async () => {
    let intento = 0;
    route.insertar = () => {
      intento += 1;
      return intento === 1
        ? sinRed()
        : fail('23505', 'duplicate key value violates unique constraint "devoluciones_transportista_client_ref_uidx"');
    };
    await mount();
    await llenarLoMinimo();
    await guardar();
    expect(bodyText()).toContain('No hay conexión');
    await click(buttonByText('Reintentar'));
    await settle(4);

    expect(inserts()).toHaveLength(2);
    expect(updates()).toHaveLength(0);
    expect(bodyText()).not.toContain('Ya existe un registro');
    expect(byId('detalle-del-viaje')!.dataset.aviso).toBe('devolucion-guardada'); // éxito, no error
  });

  it('respuesta perdida y el usuario CAMBIÓ datos antes de reintentar: UPDATE por client_ref con lo de pantalla, sin client_ref ni viaje_id', async () => {
    let intento = 0;
    route.insertar = () => {
      intento += 1;
      return intento === 1
        ? sinRed()
        : fail('23505', 'duplicate key value violates unique constraint "devoluciones_transportista_client_ref_uidx"');
    };
    await mount();
    await llenarLoMinimo('Vencimiento', C_COOP);
    await typeText(textarea(), 'Primera versión');
    await guardar();
    expect(bodyText()).toContain('No hay conexión');

    // Cambia de idea: otro motivo, otro cliente, otra descripción.
    await click(radio('Rotura o daño'));
    await selectValue(selectCliente(), C_BODEGA);
    await typeText(textarea(), 'Segunda versión');
    await click(buttonByText('Reintentar'));
    await settle(4);

    expect(inserts()).toHaveLength(2);
    expect(updates()).toHaveLength(1);
    const clientRef = payloadOf(inserts()[0]!, 'insert').client_ref;
    expect(updates()[0]!.ops.find((o) => o.m === 'eq')!.args).toEqual(['client_ref', clientRef]);
    expect(payloadOf(updates()[0]!, 'update')).toEqual({ motivo: 'rotura_danio', cliente_id: C_BODEGA, descripcion: 'Segunda versión' });
    expect(updates()[0]!.ops.find((o) => o.m === 'abortSignal')!.args[0]).toBeInstanceOf(AbortSignal);
    expect(byId('detalle-del-viaje')!.dataset.aviso).toBe('devolucion-guardada');
  });

  it('cambiar SOLO la descripción entre intentos también actualiza (la huella cubre cada campo)', async () => {
    let intento = 0;
    route.insertar = () => {
      intento += 1;
      return intento === 1 ? sinRed() : fail('23505', 'duplicate key value violates unique constraint "devoluciones_transportista_client_ref_uidx"');
    };
    await mount();
    await llenarLoMinimo();
    await guardar();
    await typeText(textarea(), 'Ahora con descripción');
    await click(buttonByText('Reintentar'));
    await settle(4);
    expect(updates()).toHaveLength(1);
    expect(payloadOf(updates()[0]!, 'update').descripcion).toBe('Ahora con descripción');
  });

  it('un 23505 de OTRO índice no es "ya guardada": se muestra como error y no se navega', async () => {
    route.insertar = () => fail('23505', 'duplicate key value violates unique constraint "devoluciones_pkey"');
    await mount();
    await llenarLoMinimo();
    await guardar();
    expect(byId('detalle-del-viaje')).toBeNull();
    expect(bodyText()).toContain('Ya existe un registro con esos datos.');
    expect(bodyText()).not.toContain('devoluciones_pkey');
    expect(updates()).toHaveLength(0);
  });

  it('23503 de devoluciones_cliente_fk: "El cliente elegido ya no existe. Elige otro.", sin "Reintentar", sin el nombre del constraint, y se vuelve a pedir la lista de clientes', async () => {
    route.insertar = () => fail('23503', 'insert or update on table "devoluciones" violates foreign key constraint "devoluciones_cliente_fk"');
    await mount();
    await llenarLoMinimo('Vencimiento', C_COOP);
    expect(callsTo('clientes')).toHaveLength(1);
    await guardar();

    expect(bodyText()).toContain('El cliente elegido ya no existe. Elige otro.');
    expect(bodyText()).not.toContain('devoluciones_cliente_fk');
    expect(bodyText()).not.toContain('Este viaje ya no existe');
    expect(buttonByText('Reintentar')).toBeUndefined(); // reintentar con lo mismo da lo mismo
    expect(byId('detalle-del-viaje')).toBeNull();
    expect(callsTo('clientes')).toHaveLength(2); // el cliente borrado deja de ofrecerse
    expect(radioElegido()).toBe('Vencimiento'); // lo tipeado queda
  });

  it('tras el 23503 del cliente se elige otro y se guarda con el MISMO client_ref', async () => {
    let intento = 0;
    route.insertar = () => {
      intento += 1;
      return intento === 1 ? fail('23503', 'violates foreign key constraint "devoluciones_cliente_fk"') : ok(null);
    };
    await mount();
    await llenarLoMinimo('Vencimiento', C_COOP);
    route.clientes = () => ok(CLIENTES.filter((c) => c.id !== C_COOP)); // el cliente se borró
    await guardar();
    expect(bodyText()).toContain('El cliente elegido ya no existe. Elige otro.');
    // Ya no se ofrece, y el selector queda "sin elegir" (no muestra OTRO cliente).
    expect([...selectCliente().options].some((o) => o.value === C_COOP)).toBe(false);
    expect(selectCliente().value).toBe('');
    expect(clienteElegido()).toBe('Elige un cliente');

    await selectValue(selectCliente(), C_BODEGA);
    await guardar();
    expect(inserts()).toHaveLength(2);
    expect(payloadOf(inserts()[1]!, 'insert').client_ref).toBe(payloadOf(inserts()[0]!, 'insert').client_ref);
    expect(payloadOf(inserts()[1]!, 'insert').cliente_id).toBe(C_BODEGA);
    expect(byId('detalle-del-viaje')!.dataset.aviso).toBe('devolucion-guardada');
  });

  it('23503 de devoluciones_viaje_fk: "Este viaje ya no existe. Vuelve a la lista de viajes.", sin "Reintentar" ni el nombre del constraint, y marca viejas las listas de viajes', async () => {
    route.insertar = () => fail('23503', 'insert or update on table "devoluciones" violates foreign key constraint "devoluciones_viaje_fk"');
    await mount();
    const listaDeViajes = viajesKeys.lists('tenant-a');
    queryClient.setQueryData([...listaDeViajes, '2025-06-01', '2025-07-01'], { items: [], truncado: false });
    await llenarLoMinimo();
    await guardar();

    expect(bodyText()).toContain('Este viaje ya no existe. Vuelve a la lista de viajes.');
    expect(bodyText()).not.toContain('devoluciones_viaje_fk');
    expect(bodyText()).not.toContain('El cliente elegido ya no existe');
    expect(buttonByText('Reintentar')).toBeUndefined();
    expect(callsTo('clientes')).toHaveLength(1); // este error no toca la lista de clientes
    expect(queryClient.getQueryState([...listaDeViajes, '2025-06-01', '2025-07-01'])?.isInvalidated).toBe(true);
  });

  it('23514, 22P02 y 23502: "datos no válidos", sin el texto del servidor y sin "Reintentar"', async () => {
    for (const [code, mensaje] of [
      ['23514', 'new row for relation "devoluciones" violates check constraint "devoluciones_descripcion_chk"'],
      ['22P02', 'invalid input value for enum motivo_devolucion: "robo"'],
      ['23502', 'null value in column "motivo" violates not-null constraint'],
    ] as const) {
      h.calls.length = 0;
      route.insertar = () => fail(code, mensaje);
      await mount();
      await llenarLoMinimo();
      await guardar();
      expect(bodyText(), code).toContain('Alguno de los datos de la devolución no es válido. Revísalos e inténtalo de nuevo.');
      expect(bodyText(), code).not.toContain('devoluciones_descripcion_chk');
      expect(bodyText(), code).not.toContain('motivo_devolucion');
      expect(bodyText(), code).not.toContain('not-null');
      expect(buttonByText('Reintentar'), code).toBeUndefined();
      await act(async () => {
        root.unmount();
      });
      container.remove();
      queryClient.clear();
    }
  });

  it('el alta marca vieja la lista POR MES de la pestaña Devoluciones (también la de otros meses: puede ser de cualquier viaje)', async () => {
    await mount();
    const claves = [
      devolucionesKeys.delMes('tenant-a', '2025-06-01', '2025-07-01'),
      devolucionesKeys.delMes('tenant-a', '2025-05-01', '2025-06-01'),
    ];
    for (const clave of claves) queryClient.setQueryData(clave, { items: [], truncado: false });
    await llenarLoMinimo();
    await guardar();
    for (const clave of claves) expect(queryClient.getQueryState(clave)?.isInvalidated).toBe(true);
  });

  it('tras guardar, guardar y navegar, el INSERT se hizo una sola vez aunque se toque de nuevo', async () => {
    await mount();
    await llenarLoMinimo();
    await guardar();
    expect(inserts()).toHaveLength(1);
  });

  it('un guardado que termina cuando ya se salió de la pantalla no arrastra al usuario al viaje', async () => {
    let resolver!: (r: Resp) => void;
    route.insertar = () => new Promise<Resp>((r) => (resolver = r));
    await mount();
    await llenarLoMinimo();
    await act(async () => {
      buttonByText('Guardar devolución')!.click();
    });
    await settle(2);
    await act(async () => {
      root.unmount();
    });
    container.remove();
    await act(async () => {
      resolver(ok(null));
    });
    await settle(3);
    expect(byId('detalle-del-viaje')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Alta: el viaje de la URL y las cargas
// ---------------------------------------------------------------------------
describe('formulario de devolución: el viaje de la URL', () => {
  it('un viaje que no es uuid no consulta NADA y muestra "Viaje no encontrado", con el enlace a /viajes', async () => {
    await mount('/viajes/no-es-un-uuid/devoluciones/nueva');
    expect(bodyText()).toContain('Viaje no encontrado');
    expect(h.calls.filter((c) => c.table !== 'miembros')).toHaveLength(0);
    expect(buttonByText('Guardar devolución')).toBeUndefined();
    expect(links().find((a) => a.textContent?.includes('Volver a Viajes'))!.getAttribute('href')).toBe('/viajes');
    expect(links().find((a) => a.textContent?.includes('Viajes') && !a.textContent.includes('Volver'))!.getAttribute('href')).toBe('/viajes');
    expect(document.querySelector('h1')).not.toBeNull();
  });

  it('un valor tipo ruta o con texto pegado tampoco es un viaje: nada se consulta ni se arma como ruta', async () => {
    for (const raro of ['..%2F..%2Fgastos', `${VIAJE}%2F..`, `${VIAJE}x`, '%2F%2Fevil.com', 'undefined']) {
      h.calls.length = 0;
      await mount(`/viajes/${raro}/devoluciones/nueva`);
      expect(bodyText(), raro).toContain('Viaje no encontrado');
      expect(h.calls.filter((c) => c.table !== 'miembros'), raro).toHaveLength(0);
      expect(links().every((a) => !(a.getAttribute('href') ?? '').includes('evil')), raro).toBe(true);
      await act(async () => {
        root.unmount();
      });
      container.remove();
      queryClient.clear();
    }
  });

  it('un viaje con el uuid en MAYÚSCULAS se normaliza (la ruta y la consulta usan minúsculas)', async () => {
    await mount(`/viajes/${VIAJE.toUpperCase()}/devoluciones/nueva`);
    expect(callsTo('viajes')[0]!.ops.find((o) => o.m === 'eq')!.args).toEqual(['id', VIAJE]);
    expect(links().find((a) => a.textContent?.includes('Viaje'))!.getAttribute('href')).toBe(`/viajes/${VIAJE}`);
    await llenarLoMinimo();
    await guardar();
    expect(payloadOf(inserts()[0]!, 'insert').viaje_id).toBe(VIAJE);
  });

  it('un viaje que no existe (o es de otro transportista: la base no distingue) muestra "Viaje no encontrado" y no ofrece el formulario', async () => {
    route.viaje = () => ok(null);
    await mount();
    expect(bodyText()).toContain('Viaje no encontrado');
    expect(buttonByText('Guardar devolución')).toBeUndefined();
    expect(inserts()).toHaveLength(0);
  });

  it('mientras carga muestra el esqueleto y no el formulario', async () => {
    route.viaje = () => new Promise<Resp>(() => {});
    await mount();
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(buttonByText('Guardar devolución')).toBeUndefined();
    expect(document.querySelector('h1')!.textContent).toBe('Nueva devolución');
  });
});

describe('formulario de devolución: errores de carga', () => {
  it('si fallan los clientes: error con "Reintentar" en lugar del formulario; al reintentar aparece', async () => {
    let intento = 0;
    route.clientes = () => {
      intento += 1;
      return intento === 1 ? sinRed() : ok(CLIENTES);
    };
    await mount();
    expect(bodyText()).toContain('No pudimos cargar los clientes.');
    expect(bodyText()).toContain('No hay conexión');
    expect(buttonByText('Guardar devolución')).toBeUndefined();
    await click(buttonByText('Reintentar'));
    expect(buttonByText('Guardar devolución')).toBeTruthy();
    expect(bodyText()).not.toContain('No hay conexión');
  });

  it('si falla el viaje: error con "Reintentar"; al reintentar aparece el formulario', async () => {
    let intento = 0;
    route.viaje = () => {
      intento += 1;
      return intento === 1 ? sinRed() : ok(vista());
    };
    await mount();
    expect(bodyText()).toContain('No hay conexión');
    expect(bodyText()).not.toContain('Viaje no encontrado');
    expect(buttonByText('Guardar devolución')).toBeUndefined();
    await click(buttonByText('Reintentar'));
    expect(buttonByText('Guardar devolución')).toBeTruthy();
    expect(grupos().map((g) => g.label)).toEqual(['Clientes de este viaje', 'Otros clientes']);
  });

  it('un refresco fallido (de los clientes o del viaje) con el formulario ya abierto NO lo desmonta: lo tipeado queda', async () => {
    await mount();
    await llenarLoMinimo('Rotura o daño', C_ALMACEN);
    await typeText(textarea(), 'Texto a conservar');

    route.clientes = () => sinRed();
    route.viaje = () => sinRed();
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: clientesKeys.list('tenant-a') });
      await queryClient.refetchQueries({ queryKey: viajesKeys.vistas('tenant-a') });
    });
    await settle(4);

    expect(callsTo('clientes')).toHaveLength(2); // el refresco ocurrió y falló
    expect(callsTo('viajes')).toHaveLength(2);
    expect(radioElegido()).toBe('Rotura o daño');
    expect(selectCliente().value).toBe(C_ALMACEN);
    expect(textarea().value).toBe('Texto a conservar');
    expect(bodyText()).not.toContain('No hay conexión');
  });
});

// ---------------------------------------------------------------------------
// Edición
// ---------------------------------------------------------------------------
describe('formulario de devolución: editar', () => {
  beforeEach(() => {
    route.detalle = detalleDeLaDevolucion;
  });

  it('carga la devolución (por id Y por viaje, una consulta con maybeSingle) y precarga motivo, cliente y descripción', async () => {
    await mount(EDITAR);
    expect(document.querySelector('h1')!.textContent).toBe('Editar devolución');
    expect(detalleCalls()).toHaveLength(1);
    const call = detalleCalls()[0]!;
    expect(call.ops.find((o) => o.m === 'select')!.args).toEqual(['id, viaje_id, cliente_id, motivo, descripcion']);
    expect(call.ops.filter((o) => o.m === 'eq').map((o) => o.args)).toEqual([
      ['id', DEV_ID],
      ['viaje_id', VIAJE],
    ]);
    expect(radioElegido()).toBe('Vencimiento');
    expect(selectCliente().value).toBe(C_COOP);
    expect(clienteElegido()).toBe('Cooperativa Sur');
    expect(textarea().value).toBe('Latas vencidas');
    expect(labelDe('devolucion-descripcion')).toBe('Descripción (opcional)');
  });

  it('sin cambios: UPDATE por id con SOLO motivo, cliente y descripción (nunca viaje_id, client_ref, id ni transportista_id) y vuelve al viaje con "devolucion-guardada"', async () => {
    await mount(EDITAR);
    await guardar();
    expect(updates()).toHaveLength(1);
    expect(inserts()).toHaveLength(0);
    const call = updates()[0]!;
    expect(call.ops.map((o) => o.m)).toEqual(['update', 'eq', 'select', 'abortSignal']);
    expect(call.ops.find((o) => o.m === 'eq')!.args).toEqual(['id', DEV_ID]);
    expect(call.ops.find((o) => o.m === 'select')!.args).toEqual(['id']);
    expect(call.ops.find((o) => o.m === 'abortSignal')!.args[0]).toBeInstanceOf(AbortSignal);
    expect(payloadOf(call, 'update')).toEqual({ motivo: 'vencimiento', cliente_id: C_COOP, descripcion: 'Latas vencidas' });
    expect(byId('detalle-del-viaje')!.dataset.path).toBe(`/viajes/${VIAJE}`);
    expect(byId('detalle-del-viaje')!.dataset.aviso).toBe('devolucion-guardada');
  });

  it('se puede cambiar motivo, cliente y descripción; la descripción vaciada manda null', async () => {
    await mount(EDITAR);
    await click(radio('Rotura o daño'));
    await selectValue(selectCliente(), C_DISTRI);
    await typeText(textarea(), 'Nueva descripción');
    await guardar();
    expect(payloadOf(updates()[0]!, 'update')).toEqual({ motivo: 'rotura_danio', cliente_id: C_DISTRI, descripcion: 'Nueva descripción' });

    await act(async () => {
      root.unmount();
    });
    container.remove();
    queryClient.clear();
    h.calls.length = 0;
    await mount(EDITAR);
    await typeText(textarea(), '   ');
    await guardar();
    expect(payloadOf(updates()[0]!, 'update').descripcion).toBeNull();
  });

  it('al cambiar a "Otro" sin descripción pide escribirla; con la descripción cargada de antes no hace falta tocar nada', async () => {
    await mount(EDITAR);
    await click(radio('Otro'));
    expect(ayudaDe('devolucion-descripcion')).toBe('Obligatoria si el motivo es «Otro»: escribe qué pasó.');
    await guardar();
    expect(updates()).toHaveLength(1); // ya tenía "Latas vencidas"
    expect(payloadOf(updates()[0]!, 'update').motivo).toBe('otro');
  });

  it('NO se mueve a otro viaje: el enlace de volver es el del viaje de la URL y no hay forma de elegir otro', async () => {
    await mount(EDITAR);
    expect(bodyText()).not.toContain('Mover');
    expect(selectCliente().closest('form')!.querySelectorAll('select')).toHaveLength(1); // solo el de cliente
    const volver = links().find((a) => a.textContent?.includes('Viaje'))!;
    expect(volver.getAttribute('href')).toBe(`/viajes/${VIAJE}`);
  });

  it('un cliente guardado que ya no está en la lista: el selector queda en "Elige un cliente" (nunca OTRO cliente) y pide elegir al guardar', async () => {
    route.detalle = () => ok(devolucionFila({ cliente_id: C_BORRADO }));
    await mount(EDITAR);
    expect(selectCliente().value).toBe('');
    expect(clienteElegido()).toBe('Elige un cliente');
    expect(clienteElegido()).not.toBe('Almacén Central'); // el primero de la lista: lo que mostraría un <select> con un valor sin opción
    await guardar();
    expect(errorDe('devolucion-cliente')).toBe('Elige un cliente.');
    expect(enfocado()).toBe('devolucion-cliente');
    expect(updates()).toHaveLength(0);

    await selectValue(selectCliente(), C_BODEGA);
    await guardar();
    expect(updates()).toHaveLength(1);
    expect(payloadOf(updates()[0]!, 'update').cliente_id).toBe(C_BODEGA);
  });

  it('la lista de clientes de la edición también agrupa: los del viaje primero', async () => {
    await mount(EDITAR);
    expect(grupos().map((g) => g.label)).toEqual(['Clientes de este viaje', 'Otros clientes']);
  });

  it('el UPDATE sin filas (la devolución ya no existe) lleva a "Devolución no encontrada"', async () => {
    route.actualizar = () => ok([]);
    await mount(EDITAR);
    await guardar();
    expect(bodyText()).toContain('Devolución no encontrada');
    expect(byId('detalle-del-viaje')).toBeNull();
    expect(links().find((a) => a.textContent?.includes('Volver al viaje'))!.getAttribute('href')).toBe(`/viajes/${VIAJE}`);
  });

  it('falla de red al guardar: error con "Reintentar", lo tipeado queda y el reintento guarda', async () => {
    let intento = 0;
    route.actualizar = () => {
      intento += 1;
      return intento === 1 ? sinRed() : ok([{ id: DEV_ID }]);
    };
    await mount(EDITAR);
    await typeText(textarea(), 'Editado');
    await guardar();
    expect(bodyText()).toContain('No hay conexión');
    expect(textarea().value).toBe('Editado');
    await click(buttonByText('Reintentar'));
    await settle(4);
    expect(updates()).toHaveLength(2);
    expect(byId('detalle-del-viaje')!.dataset.aviso).toBe('devolucion-guardada');
  });

  it('el formulario se inicializa UNA vez: guardar (aunque falle) no vuelve a pedir ni invalida la devolución, y no se pide de nuevo al reconectar', async () => {
    route.actualizar = () => sinRed();
    await mount(EDITAR);
    expect(detalleCalls()).toHaveLength(1);
    const claveDetalle = devolucionesKeys.detail('tenant-a', DEV_ID, VIAJE);
    await typeText(textarea(), 'Editado');
    await guardar();
    expect(bodyText()).toContain('No hay conexión');
    expect(detalleCalls()).toHaveLength(1); // no se volvió a pedir
    expect(queryClient.getQueryState(claveDetalle)?.isInvalidated).toBe(false); // ni se marcó vieja
    const query = queryClient.getQueryCache().find({ queryKey: claveDetalle })!;
    expect(query.observers[0]!.options.refetchOnReconnect).toBe(false);
    expect(query.observers[0]!.options.gcTime).toBe(0);
    expect(textarea().value).toBe('Editado');
  });

  it('guardar (aunque falle) marca viejas las listas de devoluciones de los viajes, no el detalle', async () => {
    await mount(EDITAR);
    const claveLista = devolucionesKeys.delViaje('tenant-a', VIAJE);
    queryClient.setQueryData(claveLista, { items: [], truncado: false });
    await guardar();
    expect(queryClient.getQueryState(claveLista)?.isInvalidated).toBe(true);
  });

  it('guardar (aunque falle) marca viejas también las listas POR MES (la pestaña Devoluciones de /viajes): si no, al volver a ella se vería la de antes', async () => {
    route.actualizar = () => sinRed();
    await mount(EDITAR);
    const claveMes = devolucionesKeys.delMes('tenant-a', '2025-06-01', '2025-07-01');
    queryClient.setQueryData(claveMes, { items: [], truncado: false });
    await guardar();
    expect(bodyText()).toContain('No hay conexión');
    expect(queryClient.getQueryState(claveMes)?.isInvalidated).toBe(true);
  });

  it('aunque algo fuerce un refresco de la devolución y falle, el formulario ya cargado no se desmonta (el error solo reemplaza al formulario si NO hay datos)', async () => {
    await mount(EDITAR);
    await typeText(textarea(), 'Lo que escribí');
    route.detalle = () => sinRed();
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: devolucionesKeys.detail('tenant-a', DEV_ID, VIAJE) });
    });
    await settle(4);
    expect(detalleCalls()).toHaveLength(2);
    expect(textarea().value).toBe('Lo que escribí');
    expect(bodyText()).not.toContain('No hay conexión');
  });

  it('si falla la carga de la devolución: error con "Reintentar" que vuelve a pedirla', async () => {
    let intento = 0;
    route.detalle = (call) => {
      intento += 1;
      return intento === 1 ? sinRed() : detalleDeLaDevolucion(call);
    };
    await mount(EDITAR);
    expect(bodyText()).toContain('No hay conexión');
    expect(bodyText()).not.toContain('Devolución no encontrada');
    expect(buttonByText('Guardar devolución')).toBeUndefined();
    await click(buttonByText('Reintentar'));
    expect(textarea().value).toBe('Latas vencidas');
  });

  it('el 23503 de un cliente borrado al guardar una edición también se explica y pide la lista de clientes de nuevo', async () => {
    route.actualizar = () => fail('23503', 'violates foreign key constraint "devoluciones_cliente_fk"');
    await mount(EDITAR);
    await guardar();
    expect(bodyText()).toContain('El cliente elegido ya no existe. Elige otro.');
    expect(buttonByText('Reintentar')).toBeUndefined();
    expect(callsTo('clientes')).toHaveLength(2);
    expect(textarea().value).toBe('Latas vencidas');
  });
});

describe('formulario de devolución: "Devolución no encontrada"', () => {
  beforeEach(() => {
    route.detalle = detalleDeLaDevolucion;
  });

  /** Lo que ve la persona en la pantalla de "no encontrada" (sin el id de ningún viaje). */
  const pantalla = () => {
    const vacio = document.querySelector('.border-dashed')!;
    return `${vacio.textContent}|${links().filter((a) => vacio.contains(a)).map((a) => a.textContent).join(',')}`;
  };

  it('un id que no es uuid no consulta nada y muestra "Devolución no encontrada"', async () => {
    await mount(`/viajes/${VIAJE}/devoluciones/no-es-un-uuid/editar`);
    expect(bodyText()).toContain('Devolución no encontrada');
    expect(h.calls.filter((c) => c.table !== 'miembros')).toHaveLength(0);
    expect(links().find((a) => a.textContent?.includes('Volver al viaje'))!.getAttribute('href')).toBe(`/viajes/${VIAJE}`);
    expect(buttonByText('Guardar devolución')).toBeUndefined();
  });

  it('inexistente, de otro viaje y de otro transportista: EXACTAMENTE la misma pantalla (sin oráculo)', async () => {
    const textos: string[] = [];

    // 1) Un uuid válido que no existe en ningún lado.
    await mount(`/viajes/${VIAJE}/devoluciones/f0000000-0000-4000-8000-0000000000aa/editar`);
    expect(bodyText()).toContain('Devolución no encontrada');
    textos.push(pantalla());
    await act(async () => {
      root.unmount();
    });
    container.remove();
    queryClient.clear();

    // 2) La devolución existe, pero es de OTRO viaje (el viaje de la URL existe): por id Y viaje no aparece.
    await mount(`/viajes/${OTRO_VIAJE}/devoluciones/${DEV_ID}/editar`);
    expect(bodyText()).toContain('Devolución no encontrada');
    textos.push(pantalla().replaceAll(OTRO_VIAJE, VIAJE));
    await act(async () => {
      root.unmount();
    });
    container.remove();
    queryClient.clear();

    // 3) De otro transportista: RLS la oculta y la base responde 0 filas, igual que en el caso 1.
    route.detalle = () => ok(null);
    await mount(EDITAR);
    expect(bodyText()).toContain('Devolución no encontrada');
    textos.push(pantalla());

    expect(new Set(textos).size).toBe(1);
    expect(textos[0]).toContain('Puede que ya la hayas eliminado, o que el enlace no sea correcto.');
    // Los tres pidieron la devolución por id Y por viaje.
    for (const call of detalleCalls()) expect(call.ops.filter((o) => o.m === 'eq').map((o) => o.args[0])).toEqual(['id', 'viaje_id']);
  });

  it('un viaje de la URL inexistente en la edición: la devolución tampoco existe -> "Devolución no encontrada"', async () => {
    route.viaje = () => ok(null);
    route.detalle = () => ok(null);
    await mount(EDITAR);
    expect(bodyText()).toContain('Devolución no encontrada');
  });

  it('el enlace "Volver al viaje" conserva el mes (state.volver saneado) y va a /viajes/<id>', async () => {
    await mount({ pathname: `/viajes/${VIAJE}/devoluciones/no-es-un-uuid/editar`, state: { volver: '?mes=2025-06' } });
    const volver = links().find((a) => a.textContent?.includes('Volver al viaje'))!;
    await click(volver);
    expect(byId('detalle-del-viaje')!.dataset.path).toBe(`/viajes/${VIAJE}`);
    expect(byId('detalle-del-viaje')!.dataset.volver).toBe('?mes=2025-06');
  });
});

// ---------------------------------------------------------------------------
// Eliminar
// ---------------------------------------------------------------------------
describe('formulario de devolución: eliminar', () => {
  beforeEach(() => {
    route.detalle = detalleDeLaDevolucion;
  });

  it('el alta no ofrece "Eliminar devolución"', async () => {
    await mount();
    expect(buttonByText('Eliminar devolución')).toBeUndefined();
  });

  it('pide confirmación (dos pasos), borra por id con .select("id") y vuelve al viaje con "devolucion-eliminada"', async () => {
    await mount({ pathname: EDITAR, state: { volver: '?mes=2025-06' } });
    await click(buttonByText('Eliminar devolución'));
    expect(bodyText()).toContain('¿Seguro? Esto no se puede deshacer.');
    expect(deletes()).toHaveLength(0); // todavía no borró
    await click(buttonByText('Sí, eliminar'));
    await settle(4);

    expect(deletes()).toHaveLength(1);
    expect(deletes()[0]!.ops.map((o) => o.m)).toEqual(['delete', 'eq', 'select', 'abortSignal']);
    expect(deletes()[0]!.ops.find((o) => o.m === 'eq')!.args).toEqual(['id', DEV_ID]);
    const detalle = byId('detalle-del-viaje')!;
    expect(detalle.dataset.path).toBe(`/viajes/${VIAJE}`);
    expect(detalle.dataset.aviso).toBe('devolucion-eliminada');
    expect(detalle.dataset.volver).toBe('?mes=2025-06');
  });

  it('0 filas borradas (ya no estaba) se trata como éxito', async () => {
    route.borrar = () => ok([]);
    await mount(EDITAR);
    await click(buttonByText('Eliminar devolución'));
    await click(buttonByText('Sí, eliminar'));
    await settle(4);
    expect(byId('detalle-del-viaje')!.dataset.aviso).toBe('devolucion-eliminada');
  });

  it('con falla de red al borrar: error con "Reintentar" y el reintento borra', async () => {
    let intento = 0;
    route.borrar = () => {
      intento += 1;
      return intento === 1 ? sinRed() : ok([{ id: DEV_ID }]);
    };
    await mount(EDITAR);
    await click(buttonByText('Eliminar devolución'));
    await click(buttonByText('Sí, eliminar'));
    await settle(4);
    expect(bodyText()).toContain('No hay conexión');
    expect(byId('detalle-del-viaje')).toBeNull();
    await click(buttonByText('Reintentar'));
    await settle(4);
    expect(deletes()).toHaveLength(2);
    expect(byId('detalle-del-viaje')!.dataset.aviso).toBe('devolucion-eliminada');
  });

  it('cancelar no borra nada', async () => {
    await mount(EDITAR);
    await click(buttonByText('Eliminar devolución'));
    await click(buttonByText('Cancelar'));
    expect(deletes()).toHaveLength(0);
    expect(buttonByText('Eliminar devolución')).toBeTruthy();
  });

  it('borrar marca viejas las listas POR MES de la pestaña Devoluciones', async () => {
    await mount(EDITAR);
    const claveMes = devolucionesKeys.delMes('tenant-a', '2025-06-01', '2025-07-01');
    queryClient.setQueryData(claveMes, { items: [], truncado: false });
    await click(buttonByText('Eliminar devolución'));
    await click(buttonByText('Sí, eliminar'));
    await settle(4);
    expect(queryClient.getQueryState(claveMes)?.isInvalidated).toBe(true);
  });

  it('borrar marca viejas las listas de devoluciones de los viajes', async () => {
    await mount(EDITAR);
    const claveLista = devolucionesKeys.delViaje('tenant-a', VIAJE);
    queryClient.setQueryData(claveLista, { items: [], truncado: false });
    await click(buttonByText('Eliminar devolución'));
    await click(buttonByText('Sí, eliminar'));
    await settle(4);
    expect(queryClient.getQueryState(claveLista)?.isInvalidated).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Origen: la edición abierta desde la pestaña Devoluciones de /viajes
// ---------------------------------------------------------------------------
describe('edición abierta desde la lista de Devoluciones (marca de origen en el state)', () => {
  const DESDE_LISTA = { volver: '?vista=devoluciones&mes=2025-06', origen: 'lista-devoluciones' };
  const LISTA = '/viajes?vista=devoluciones&mes=2025-06';
  const enlaceDeVolver = () => links().find((a) => ['Devoluciones', 'Viaje', 'Viajes'].includes(a.textContent?.trim() ?? ''))!;
  /** Desmonta y limpia, para montar otra pantalla dentro de la misma prueba. */
  async function desmontar() {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    queryClient.clear();
    h.calls.length = 0;
  }

  beforeEach(() => {
    route.detalle = detalleDeLaDevolucion;
  });

  it('el enlace de volver dice "Devoluciones" y lleva a la lista (misma pestaña y mismo mes)', async () => {
    await mount({ pathname: EDITAR, state: DESDE_LISTA });
    expect(enlaceDeVolver().textContent?.trim()).toBe('Devoluciones');
    expect(enlaceDeVolver().getAttribute('href')).toBe(LISTA);
  });

  it('guardar vuelve a la lista de Devoluciones (misma pestaña y mismo mes) con "devolucion-guardada", y NO al detalle del viaje', async () => {
    await mount({ pathname: EDITAR, state: DESDE_LISTA });
    await guardar();
    expect(updates()).toHaveLength(1);
    expect(byId('detalle-del-viaje')).toBeNull();
    const lista = byId('lista-de-viajes')!;
    expect(lista.dataset.search).toBe('?vista=devoluciones&mes=2025-06');
    expect(lista.dataset.aviso).toBe('devolucion-guardada');
  });

  it('el state hacia la lista lleva SOLO el aviso: ni el origen ni el volver ni nada más', async () => {
    await mount({ pathname: EDITAR, state: { ...DESDE_LISTA, ruta: '//evil.com', desdeViaje: '/gastos' } });
    await guardar();
    expect(JSON.parse(byId('lista-de-viajes')!.dataset.state!)).toEqual({ aviso: 'devolucion-guardada' });
  });

  it('eliminar vuelve a la lista de Devoluciones con "devolucion-eliminada"', async () => {
    await mount({ pathname: EDITAR, state: DESDE_LISTA });
    await click(buttonByText('Eliminar devolución'));
    await click(buttonByText('Sí, eliminar'));
    await settle(4);
    expect(deletes()).toHaveLength(1);
    expect(byId('detalle-del-viaje')).toBeNull();
    expect(byId('lista-de-viajes')!.dataset.search).toBe('?vista=devoluciones&mes=2025-06');
    expect(byId('lista-de-viajes')!.dataset.aviso).toBe('devolucion-eliminada');
  });

  it('con el mes actual el volver lleva solo la pestaña', async () => {
    await mount({ pathname: EDITAR, state: { volver: '?vista=devoluciones', origen: 'lista-devoluciones' } });
    await guardar();
    expect(byId('lista-de-viajes')!.dataset.search).toBe('?vista=devoluciones');
  });

  it('la pestaña la fija el código, no el volver: con origen válido y un volver SIN pestaña (o con otra) también va a Devoluciones', async () => {
    for (const volver of ['?mes=2025-06', '?vista=viajes&mes=2025-06', '?vista=basura&mes=2025-06']) {
      await mount({ pathname: EDITAR, state: { volver, origen: 'lista-devoluciones' } });
      await guardar();
      expect(byId('lista-de-viajes')!.dataset.search, volver).toBe('?vista=devoluciones&mes=2025-06');
      await desmontar();
    }
  });

  it('un volver raro se sanea y nunca cambia el destino: siempre /viajes, pestaña Devoluciones, mes actual', async () => {
    for (const raro of ['//evil.com', 'https://evil.com', '?mes=<script>', '?mes=2999-01', { mes: '2025-06' }, 42]) {
      await mount({ pathname: EDITAR, state: { volver: raro, origen: 'lista-devoluciones' } });
      expect(enlaceDeVolver().getAttribute('href'), JSON.stringify(raro)).toBe('/viajes?vista=devoluciones');
      await guardar();
      expect(byId('lista-de-viajes')!.dataset.search, JSON.stringify(raro)).toBe('?vista=devoluciones');
      await desmontar();
    }
  });

  it('SIN la marca de origen, aunque el volver traiga la pestaña Devoluciones (se abrió desde el detalle del viaje), vuelve al DETALLE como hoy', async () => {
    await mount({ pathname: EDITAR, state: { volver: '?vista=devoluciones&mes=2025-06' } });
    expect(enlaceDeVolver().textContent?.trim()).toBe('Viaje');
    expect(enlaceDeVolver().getAttribute('href')).toBe(`/viajes/${VIAJE}`);
    await guardar();
    expect(byId('lista-de-viajes')).toBeNull();
    const detalle = byId('detalle-del-viaje')!;
    expect(detalle.dataset.path).toBe(`/viajes/${VIAJE}`);
    expect(detalle.dataset.aviso).toBe('devolucion-guardada');
    expect(detalle.dataset.volver).toBe('?vista=devoluciones&mes=2025-06'); // el detalle conserva la pestaña para su "Viajes"
  });

  it('SIN la marca de origen, eliminar también vuelve al detalle', async () => {
    await mount({ pathname: EDITAR, state: { volver: '?vista=devoluciones&mes=2025-06' } });
    await click(buttonByText('Eliminar devolución'));
    await click(buttonByText('Sí, eliminar'));
    await settle(4);
    expect(byId('lista-de-viajes')).toBeNull();
    expect(byId('detalle-del-viaje')!.dataset.aviso).toBe('devolucion-eliminada');
  });

  it('un origen que no es EXACTAMENTE el literal de la lista blanca se ignora: la edición vuelve al detalle', async () => {
    for (const raro of ['Lista-Devoluciones', ' lista-devoluciones', 'lista-devoluciones/../x', '/viajes?vista=devoluciones', '//evil.com', 'https://evil.com', 'detalle', '', 'toString', 1, true, null, {}, ['lista-devoluciones']]) {
      await mount({ pathname: EDITAR, state: { volver: '?vista=devoluciones&mes=2025-06', origen: raro } });
      expect(enlaceDeVolver().textContent?.trim(), JSON.stringify(raro)).toBe('Viaje');
      await guardar();
      expect(byId('lista-de-viajes'), JSON.stringify(raro)).toBeNull();
      expect(byId('detalle-del-viaje')!.dataset.path, JSON.stringify(raro)).toBe(`/viajes/${VIAJE}`);
      await desmontar();
    }
  });

  it('el origen solo cuenta al EDITAR: en el alta se ignora y vuelve al detalle', async () => {
    await mount({ pathname: NUEVA, state: DESDE_LISTA });
    expect(enlaceDeVolver().textContent?.trim()).toBe('Viaje');
    await llenarLoMinimo();
    await guardar();
    expect(inserts()).toHaveLength(1);
    expect(byId('lista-de-viajes')).toBeNull();
    expect(byId('detalle-del-viaje')!.dataset.aviso).toBe('devolucion-guardada');
  });

  it('un guardado que falla no navega y conserva lo tipeado; el reintento vuelve a la lista', async () => {
    let intento = 0;
    route.actualizar = () => {
      intento += 1;
      return intento === 1 ? sinRed() : ok([{ id: DEV_ID }]);
    };
    await mount({ pathname: EDITAR, state: DESDE_LISTA });
    await typeText(textarea(), 'Cambiada');
    await guardar();
    expect(bodyText()).toContain('No hay conexión');
    expect(byId('lista-de-viajes')).toBeNull();
    expect(textarea().value).toBe('Cambiada');
    await click(buttonByText('Reintentar'));
    await settle(4);
    expect(byId('lista-de-viajes')!.dataset.aviso).toBe('devolucion-guardada');
  });

  it('"Devolución no encontrada": el botón vuelve a la lista de Devoluciones (y sin origen sigue siendo "Volver al viaje")', async () => {
    route.detalle = () => ok(null);
    await mount({ pathname: EDITAR, state: DESDE_LISTA });
    expect(bodyText()).toContain('Devolución no encontrada');
    const volver = links().find((a) => a.textContent?.includes('Volver a Devoluciones'))!;
    expect(volver.getAttribute('href')).toBe(LISTA);
    expect(links().some((a) => a.textContent?.includes('Volver al viaje'))).toBe(false);
    await click(volver);
    expect(byId('lista-de-viajes')!.dataset.search).toBe('?vista=devoluciones&mes=2025-06');
    await desmontar();

    await mount({ pathname: EDITAR, state: { volver: '?vista=devoluciones&mes=2025-06' } });
    expect(links().some((a) => a.textContent?.includes('Volver a Devoluciones'))).toBe(false);
    expect(links().find((a) => a.textContent?.includes('Volver al viaje'))!.getAttribute('href')).toBe(`/viajes/${VIAJE}`);
  });

  it('el UPDATE sin filas (ya no existe) desde la lista también ofrece volver a la lista', async () => {
    route.actualizar = () => ok([]);
    await mount({ pathname: EDITAR, state: DESDE_LISTA });
    await guardar();
    expect(bodyText()).toContain('Devolución no encontrada');
    expect(links().find((a) => a.textContent?.includes('Volver a Devoluciones'))!.getAttribute('href')).toBe(LISTA);
  });

  it('"Viaje no encontrado" (viaje de la URL inválido): el enlace conserva la pestaña y el mes', async () => {
    await mount({ pathname: `/viajes/no-es-un-uuid/devoluciones/${DEV_ID}/editar`, state: DESDE_LISTA });
    expect(bodyText()).toContain('Viaje no encontrado');
    expect(links().find((a) => a.textContent?.includes('Volver a Viajes'))!.getAttribute('href')).toBe('/viajes?vista=devoluciones&mes=2025-06');
    // Y el enlace de arriba también vuelve a la lista de Devoluciones.
    expect(enlaceDeVolver().getAttribute('href')).toBe(LISTA);
  });
});

describe('ids de los campos', () => {
  it('motivo, cliente y descripción tienen los ids a los que va el foco', async () => {
    await mount();
    expect(byId('devolucion-motivo-0')).toBe(radios()[0]);
    expect(byId('devolucion-cliente')).toBe(selectCliente());
    expect(byId('devolucion-descripcion')).toBe(textarea());
  });
});
