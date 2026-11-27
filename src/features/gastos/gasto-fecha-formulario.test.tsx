import { act, useMemo, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation, type InitialEntry } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// «Nuevo gasto» y la edición: el método de pago va ANTES de la fecha y del viaje, y la fecha va plegada («Fecha: hoy» con «Cambiar»).
// Mock de supabase: registra cada pedido y responde según la tabla. Todo lo demás es código REAL del proyecto (formulario, hooks,
// TanStack Query, router, validación). Hoy es SIEMPRE el 25 de noviembre de 2026 (solo se congela `Date`; los temporizadores corren).
type Op = { m: string; args: unknown[] };
type Call = { target: string; ops: Op[] };

const h = vi.hoisted(() => {
  const calls: Array<{ target: string; ops: Array<{ m: string; args: unknown[] }> }> = [];
  const state = {
    responder: null as null | ((call: { target: string; ops: Array<{ m: string; args: unknown[] }> }) => unknown),
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

import { AuthContext, type AuthContextValue } from '@/features/auth/auth-context';
import { MemberProvider } from '@/features/member/member-provider';
import { RequireMember } from '@/app/guards';
import { GastoFormPage } from '@/features/gastos/gasto-form-page';
import { COMBUSTIBLE_CATEGORIA_ID, GASTOS_VARIOS_CATEGORIA_ID, MIN_FECHA } from '@/features/gastos/constants';
import type { Categoria } from '@/features/gastos/categorias';
import { EMPEZAR_DE_NUEVO } from '@/features/gastos/gasto-varios-textos';
import { NETWORK_SAVE_ERROR_MESSAGE } from '@/lib/data-errors';
import { queryClient } from '@/lib/query-client';

type Resp = { data: unknown; error: { message: string; code: string; details?: string; hint?: string } | null; status: number };
const ok = (data: unknown): Resp => ({ data, error: null, status: 200 });
const sinRed = (): Resp => ({ data: null, error: { code: '', message: 'TypeError: Failed to fetch' }, status: 0 });

const HOY = '2026-11-25';
const AYER = '2026-11-24';

const PEAJES_ID = '210b4f00-fdb4-499b-bf15-79ebe2aaf3c3';
const LAVADO_ID = '210b4f00-fdb4-499b-bf15-79ebe2aaf3c4';
const CATS: Categoria[] = [
  { id: COMBUSTIBLE_CATEGORIA_ID, nombre: 'Combustible', activa: true, transportista_id: null },
  { id: GASTOS_VARIOS_CATEGORIA_ID, nombre: 'Gastos varios', activa: true, transportista_id: null },
  { id: PEAJES_ID, nombre: 'Peajes', activa: true, transportista_id: null },
  { id: LAVADO_ID, nombre: 'Lavado', activa: true, transportista_id: 'tenant-a' },
];
const MIEMBRO = { rol: 'admin', tema: 'dark', color_acento: '#F59E0B', transportista_id: 'tenant-a', camion_activo_id: null, transportistas: { nombre: 'Transportes A' } };
const CAM_A = { id: 'c0000000-0000-4000-8000-000000000001', patente: 'AB123CD', marca: null, modelo: null, anio: null, activa: true };

const GASTO_ID = 'e0000000-0000-4000-8000-000000000001';
const detalle = (over: Record<string, unknown> = {}) => ({
  id: GASTO_ID, categoria_id: PEAJES_ID, fecha: '2026-10-01', monto: 900, descripcion: null, metodo_pago: 'efectivo', litros: null,
  precio_por_litro: null, km_odometro: null, tanque_lleno: null, camion_id: null, viaje_id: null, viajes: null, ...over,
});

type Handler = (call: Call) => unknown;
const route: { detalle: Handler; insertar: Handler; actualizar: Handler } = {} as never;
function resetRoutes() {
  route.detalle = () => ok(detalle());
  route.insertar = () => ok(null);
  route.actualizar = () => ok([{ id: GASTO_ID }]);
}
function installResponder() {
  h.state.responder = (call: Call) => {
    const has = (m: string) => call.ops.some((o) => o.m === m);
    if (call.target === 'miembros' && has('maybeSingle')) return ok(MIEMBRO);
    if (call.target === 'categorias_gasto') return ok(CATS);
    if (call.target === 'camiones') return ok([CAM_A]);
    if (call.target === 'viajes') return has('limit') ? ok([]) : ok(null);
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
const filaDe = (call: Call) => argOf(call, 'insert') as Record<string, unknown>;
const filasDe = (call: Call) => argOf(call, 'insert') as Array<Record<string, unknown>>;
const cambiosDe = (call: Call) => argOf(call, 'update') as Record<string, unknown>;

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

/** La lista de gastos de mentira: a dónde se navegó, con qué aviso y con qué `search` (el mes). */
function ListaProbe() {
  const location = useLocation();
  const state = (location.state as { aviso?: string } | null) ?? {};
  return (
    <div id="lista-de-gastos" data-aviso={state.aviso ?? ''} data-search={location.search}>
      lista
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
async function desmontar() {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  queryClient.clear();
}

const EDITAR = `/gastos/${GASTO_ID}/editar`;
const byId = <T extends HTMLElement = HTMLElement>(elementId: string) => document.getElementById(elementId) as T | null;
const bodyText = () => document.body.textContent ?? '';
const buttons = () => [...document.querySelectorAll<HTMLButtonElement>('button')];
const buttonByText = (text: string) => buttons().find((b) => b.textContent?.includes(text));
const casilla = (categoriaId: string) => document.querySelector<HTMLInputElement>(`input[type="checkbox"][value="${categoriaId}"]`)!;
const antes = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
const enfocado = () => document.activeElement?.id ?? '';
const monto = (categoriaId?: string) => byId<HTMLInputElement>(categoriaId === undefined ? 'gasto-monto' : `gasto-monto-${categoriaId}`);
const campoFecha = () => byId<HTMLInputElement>('gasto-fecha');
const filaFecha = () => byId('gasto-fecha-linea');
const botonCambiar = () => buttons().find((b) => b.textContent === 'Cambiar') ?? null;
const errorDeFecha = () => byId('gasto-fecha-error')?.textContent ?? '';

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
async function guardar(rotulo = 'Guardar gasto') {
  await click(buttons().find((b) => b.type === 'submit' && b.textContent === rotulo));
  await settle(4);
}
/** «Agregar nota o viaje»: despliega el pliegue donde viven la descripción (nota) y el viaje (si ya está desplegado, no hace nada). */
async function abrirNotaYViaje() {
  const boton = buttons().find((b) => b.getAttribute('aria-controls') === 'gasto-pliegue');
  if (boton) await click(boton);
}
/** «Cambiar» en la fila «Fecha: hoy». */
async function abrirFecha() {
  await click(botonCambiar());
}
/** Toca un método de pago (el de una categoría si hay varias marcadas). */
async function elegirMetodo(valor: string, categoriaId?: string) {
  const prefijo = categoriaId === undefined ? 'gasto-metodo' : `gasto-metodo-${categoriaId}`;
  await click(document.querySelector<HTMLInputElement>(`input[type="radio"][id^="${prefijo}-"][value="${valor}"]`));
}
/** Lo mínimo para guardar UN gasto (Peajes): el monto y el método de pago. */
async function llenarPeajes() {
  await marcar(PEAJES_ID);
  await typeText(monto(), '800');
  await elegirMetodo('efectivo');
}
/** Lo mínimo para guardar Peajes + Lavado. */
async function llenarPeajesYLavado() {
  await marcar(PEAJES_ID, LAVADO_ID);
  await typeText(monto(PEAJES_ID), '800');
  await elegirMetodo('efectivo', PEAJES_ID);
  await typeText(monto(LAVADO_ID), '300');
  await elegirMetodo('transferencia', LAVADO_ID);
}
/** El reloj de hoy cambia (solo `Date`): para provocar un error de fecha sin tocar el campo. */
function ponerHoy(dia: string) {
  const [anio, mes, d] = dia.split('-').map(Number);
  vi.setSystemTime(new Date(anio!, mes! - 1, d, 12, 0, 0));
}

/**
 * Lo que se ve del formulario, en el orden en que se ve: las leyendas de los grupos, los rótulos de los campos (no los de las opciones de
 * un grupo), el título del grupo de métodos y la fila de la fecha. Sin el «(opcional)».
 */
function camposEnPantalla(): string[] {
  const formulario = document.querySelector('form')!;
  return [...formulario.querySelectorAll('legend, label, #gasto-fecha-linea, #gasto-metodos-titulo')]
    .filter((el) => el.tagName !== 'LABEL' || !el.closest('fieldset'))
    .map((el) => (el.textContent ?? '').replace(/\s*\(opcional\)/, '').trim());
}
/** El id del último campo (no botón) del formulario: tiene que ser el viaje. */
const ultimoCampo = () => [...document.querySelectorAll('form input:not([type="hidden"]), form select, form textarea')].at(-1)?.id ?? '';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  ponerHoy(HOY);
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
  expect(errorSpy.mock.calls.map((c: unknown[]) => String(c[0]))).toEqual([]);
  errorSpy.mockRestore();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// El orden de los campos
// ---------------------------------------------------------------------------
describe('el orden de los campos: «¿Cómo pagaste?» ANTES de la fecha (y de la nota y el viaje, que van en el pliegue)', () => {
  it('una categoría (o ninguna): Categoría → Monto → ¿Cómo pagaste? → Fecha y, desplegado el pliegue, Descripción → Viaje', async () => {
    await mount();
    expect(camposEnPantalla()).toEqual(['Categoría', 'Monto', '¿Cómo pagaste?', 'Fecha: hoy']);
    await marcar(PEAJES_ID);
    expect(camposEnPantalla()).toEqual(['Categoría', 'Monto', '¿Cómo pagaste?', 'Fecha: hoy']);
    await abrirNotaYViaje();
    expect(camposEnPantalla()).toEqual(['Categoría', 'Monto', '¿Cómo pagaste?', 'Fecha: hoy', 'Descripción', 'Viaje']);
    expect(ultimoCampo()).toBe('gasto-viaje');
  });

  it('con Combustible: el recuadro del combustible queda donde estaba (después del monto) y el método de pago va después de él', async () => {
    await mount();
    await marcar(COMBUSTIBLE_CATEGORIA_ID);
    expect(camposEnPantalla()).toEqual(['Categoría', 'Monto', 'Litros', 'Kilómetros del camión', '¿Llenaste el tanque?', '¿Cómo pagaste?', 'Fecha: hoy']);
    await abrirNotaYViaje();
    const orden = ['gasto-monto', 'gasto-litros', 'gasto-km', 'gasto-tanque-0', 'gasto-metodo-0', 'gasto-fecha-linea', 'gasto-viaje'].map((id) => byId(id)!);
    for (let i = 0; i < orden.length - 1; i++) expect(antes(orden[i]!, orden[i + 1]!), `${orden[i]!.id} antes de ${orden[i + 1]!.id}`).toBe(true);
  });

  it('al editar un gasto es el mismo orden (sin nota ni viaje el pliegue queda plegado)', async () => {
    await mount(EDITAR);
    expect(camposEnPantalla()).toEqual(['Categoría', 'Monto', '¿Cómo pagaste?', 'Fecha: 1 oct']);
    await abrirNotaYViaje();
    expect(camposEnPantalla()).toEqual(['Categoría', 'Monto', '¿Cómo pagaste?', 'Fecha: 1 oct', 'Descripción', 'Viaje']);
    expect(ultimoCampo()).toBe('gasto-viaje');
  });

  it('al editar un gasto de Combustible: el método de pago después del tanque lleno, antes de la fecha', async () => {
    route.detalle = () => ok(detalle({ categoria_id: COMBUSTIBLE_CATEGORIA_ID, litros: 40, precio_por_litro: 22.5, camion_id: CAM_A.id }));
    await mount(EDITAR);
    await abrirNotaYViaje();
    const orden = ['gasto-litros', 'gasto-km', 'gasto-tanque-0', 'gasto-metodo-0', 'gasto-fecha-linea', 'gasto-viaje'].map((id) => byId(id)!);
    for (let i = 0; i < orden.length - 1; i++) expect(antes(orden[i]!, orden[i + 1]!), `${orden[i]!.id} antes de ${orden[i + 1]!.id}`).toBe(true);
  });

  it('varias categorías: los bloques, el grupo «¿Cómo pagaste cada gasto?» (un método por gasto), la fecha y, en el pliegue, una nota por categoría y el viaje', async () => {
    await mount();
    await marcar(PEAJES_ID, COMBUSTIBLE_CATEGORIA_ID);
    expect(camposEnPantalla()).toEqual([
      'Categoría',
      'Monto',
      'Litros',
      'Kilómetros del camión',
      '¿Llenaste el tanque?',
      'Monto',
      '¿Cómo pagaste cada gasto?',
      '¿Cómo pagaste Combustible?',
      '¿Cómo pagaste Peajes?',
      'Fecha: hoy',
    ]);
    await abrirNotaYViaje();
    expect(camposEnPantalla().slice(-4)).toEqual(['Fecha: hoy', 'Nota de Combustible', 'Nota de Peajes', 'Viaje']);
    expect(ultimoCampo()).toBe('gasto-viaje');
  });

  it('varias categorías: el grupo de métodos viene después de TODOS los bloques (también del tanque lleno de Combustible) y antes de la fecha', async () => {
    await mount();
    await marcar(PEAJES_ID, COMBUSTIBLE_CATEGORIA_ID);
    await abrirNotaYViaje();
    const orden = [
      byId(`gasto-tanque-${COMBUSTIBLE_CATEGORIA_ID}-0`)!,
      monto(PEAJES_ID)!,
      byId('gasto-metodos-titulo')!,
      byId(`gasto-metodo-${COMBUSTIBLE_CATEGORIA_ID}-0`)!,
      byId(`gasto-metodo-${PEAJES_ID}-0`)!,
      byId('gasto-fecha-linea')!,
      byId('gasto-viaje')!,
    ];
    for (let i = 0; i < orden.length - 1; i++) expect(antes(orden[i]!, orden[i + 1]!), `${orden[i]!.id} antes de ${orden[i + 1]!.id}`).toBe(true);
  });

  it('con la fecha ya desplegada el orden es el mismo: ¿Cómo pagaste? → Fecha → nota → Viaje', async () => {
    await mount();
    await marcar(PEAJES_ID);
    await abrirFecha();
    await abrirNotaYViaje();
    expect(camposEnPantalla()).toEqual(['Categoría', 'Monto', '¿Cómo pagaste?', 'Fecha', 'Descripción', 'Viaje']);
    await marcar(LAVADO_ID);
    expect(camposEnPantalla().slice(-6)).toEqual(['¿Cómo pagaste Lavado?', '¿Cómo pagaste Peajes?', 'Fecha', 'Nota de Lavado', 'Nota de Peajes', 'Viaje']);
  });

  it('el viaje es el selector de siempre, con su rótulo y su id, y está en el pliegue (no a la vista hasta desplegarlo)', async () => {
    await mount();
    expect(byId('gasto-viaje')).toBeNull();
    await abrirNotaYViaje();
    expect(byId('gasto-viaje')!.tagName).toBe('SELECT');
    expect(document.querySelector('label[for="gasto-viaje"]')!.textContent).toBe('Viaje (opcional)');
  });
});

// ---------------------------------------------------------------------------
// La fila «Fecha: hoy» y «Cambiar»
// ---------------------------------------------------------------------------
describe('la fecha plegada: «Fecha: hoy» y el botón «Cambiar»', () => {
  it('una fila con el texto «Fecha: hoy» y SIN campo de fecha (ni su rótulo)', async () => {
    await mount();
    expect(filaFecha()!.textContent).toBe('Fecha: hoy');
    expect(document.querySelectorAll('input[type="date"]')).toHaveLength(0);
    expect(campoFecha()).toBeNull();
    expect(document.querySelector('label[for="gasto-fecha"]')).toBeNull();
  });

  it('con varias categorías es la misma fila, una sola', async () => {
    await mount();
    await marcar(PEAJES_ID, LAVADO_ID);
    expect(document.querySelectorAll('#gasto-fecha-linea')).toHaveLength(1);
    expect(filaFecha()!.textContent).toBe('Fecha: hoy');
    expect(buttons().filter((b) => b.textContent === 'Cambiar')).toHaveLength(1);
    expect(document.querySelectorAll('input[type="date"]')).toHaveLength(0);
  });

  it('el botón dice «Cambiar», es de tipo «button» (no envía el formulario) y su nombre accesible EMPIEZA con el texto que se ve', async () => {
    await mount();
    const boton = botonCambiar()!;
    expect(boton.textContent).toBe('Cambiar');
    expect(boton.type).toBe('button');
    const nombre = boton.getAttribute('aria-label')!;
    expect(nombre).toBe('Cambiar la fecha');
    expect(nombre.startsWith(boton.textContent!)).toBe(true);
    expect(boton.disabled).toBe(false);
  });

  it('el botón mide 48 px o más de alto y su texto es de 16 px o más (clases del botón de siempre del proyecto)', async () => {
    await mount();
    const clases = botonCambiar()!.className;
    const alto = /(?:^|\s)h-(\d+)(?:\s|$)/.exec(clases);
    expect(alto, clases).not.toBeNull();
    expect(Number(alto![1]) * 4).toBeGreaterThanOrEqual(48); // h-12 = 3 rem = 48 px
    expect(clases).toContain('text-base'); // 16 px
    expect(clases).not.toMatch(/(?:^|\s)text-(?:xs|sm)(?:\s|$)/);
  });

  it('la fila y el botón van en la misma línea del formulario, uno junto al otro', async () => {
    await mount();
    expect(filaFecha()!.parentElement).toBe(botonCambiar()!.parentElement);
  });

  it('el botón queda PEGADO al texto (no empujado al borde derecho en pantalla ancha): sin «justify-between» y con una separación fija entre los dos', async () => {
    await mount();
    const fila = filaFecha()!.parentElement!;
    const clases = fila.className;
    expect(clases).not.toContain('justify-between');
    expect(clases).not.toMatch(/(?:^|\s)justify-(?:end|around|evenly|center)(?:\s|$)/);
    expect(clases).toMatch(/(?:^|\s)flex(?:\s|$)/);
    expect(clases).toMatch(/(?:^|\s)flex-wrap(?:\s|$)/); // y si no entra (320 px o letra grande), el botón baja a la línea de abajo
    expect(clases).toMatch(/(?:^|\s)gap-x-4(?:\s|$)/);
    expect(clases).toMatch(/(?:^|\s)items-center(?:\s|$)/);
    // el texto no se estira para ocupar todo el ancho (eso también separaría el botón)
    expect(filaFecha()!.className).not.toMatch(/(?:^|\s)(?:flex-1|grow|w-full)(?:\s|$)/);
  });

  it('tocar «Cambiar» no guarda nada ni muestra errores', async () => {
    await mount();
    await abrirFecha();
    expect(inserts()).toHaveLength(0);
    expect(document.querySelectorAll('[aria-invalid="true"]')).toHaveLength(0);
    expect(bodyText()).not.toContain('Elige una categoría');
  });
});

describe('«Cambiar» despliega el campo de siempre y le pasa el foco', () => {
  it('reemplaza la fila por el campo «Fecha» (mismo id, con hoy y los mismos límites) y no queda la fila ni el botón', async () => {
    await mount();
    await abrirFecha();
    const campo = campoFecha()!;
    expect(campo.type).toBe('date');
    expect(campo.value).toBe(HOY);
    expect(campo.min).toBe(MIN_FECHA);
    expect(campo.max).toBe(HOY);
    expect(document.querySelector('label[for="gasto-fecha"]')!.textContent).toBe('Fecha');
    expect(document.querySelectorAll('input[type="date"]')).toHaveLength(1);
    expect(filaFecha()).toBeNull();
    expect(botonCambiar()).toBeNull();
  });

  it('el foco pasa al campo de la fecha', async () => {
    await mount();
    expect(enfocado()).not.toBe('gasto-fecha');
    await abrirFecha();
    expect(enfocado()).toBe('gasto-fecha');
    expect(document.activeElement).toBe(campoFecha());
  });

  it('con varias categorías también: un solo campo y el foco en él', async () => {
    await mount();
    await marcar(PEAJES_ID, LAVADO_ID);
    await abrirFecha();
    expect(document.querySelectorAll('input[type="date"]')).toHaveLength(1);
    expect(enfocado()).toBe('gasto-fecha');
  });

  it('una vez abierto QUEDA abierto: al escribir otra fecha, al volver a hoy, al escribir en otros campos y al sumar otra categoría', async () => {
    await mount();
    await marcar(PEAJES_ID);
    await abrirFecha();
    await typeText(campoFecha(), '2026-11-10');
    expect(campoFecha()).not.toBeNull();
    expect(filaFecha()).toBeNull();
    await typeText(campoFecha(), HOY);
    expect(campoFecha()!.value).toBe(HOY);
    expect(filaFecha()).toBeNull(); // volver a hoy NO lo pliega de nuevo
    await typeText(monto(), '800');
    await marcar(LAVADO_ID);
    expect(campoFecha()).not.toBeNull();
    expect(filaFecha()).toBeNull();
    expect(document.querySelectorAll('input[type="date"]')).toHaveLength(1);
  });

  it('el foco no se vuelve a llevar al campo cada vez que se escribe en otro lado', async () => {
    await mount();
    await marcar(PEAJES_ID);
    await abrirFecha();
    await typeText(monto(), '5');
    await act(async () => {
      monto()!.focus();
    });
    expect(enfocado()).toBe('gasto-monto');
    await typeText(monto(), '55');
    expect(enfocado()).toBe('gasto-monto');
  });
});

// ---------------------------------------------------------------------------
// La fecha que se guarda
// ---------------------------------------------------------------------------
describe('la fecha que se manda al guardar es la que se ve', () => {
  it('sin tocar «Cambiar»: un gasto va con la fecha de hoy', async () => {
    await mount();
    await llenarPeajes();
    expect(filaFecha()!.textContent).toBe('Fecha: hoy');
    await guardar();
    expect(inserts()).toHaveLength(1);
    expect(filaDe(inserts()[0]!).fecha).toBe(HOY);
  });

  it('sin tocar «Cambiar»: con varias categorías todos van con la fecha de hoy', async () => {
    await mount();
    await llenarPeajesYLavado();
    await guardar('Guardar 2 gastos');
    expect(filasDe(inserts()[0]!).map((fila) => fila.fecha)).toEqual([HOY, HOY]);
  });

  it('después de «Cambiar» y escribir otra fecha: un gasto va con ESA fecha y vuelve a la lista de ese mes', async () => {
    await mount();
    await llenarPeajes();
    await abrirFecha();
    await typeText(campoFecha(), '2026-09-20');
    await guardar();
    expect(filaDe(inserts()[0]!).fecha).toBe('2026-09-20');
    expect(byId('lista-de-gastos')!.dataset.search).toContain('mes=2026-09');
  });

  it('después de «Cambiar» y escribir otra fecha: con varias categorías todos van con ESA fecha', async () => {
    await mount();
    await llenarPeajesYLavado();
    await abrirFecha();
    await typeText(campoFecha(), '2026-09-20');
    await guardar('Guardar 2 gastos');
    expect(filasDe(inserts()[0]!).map((fila) => fila.fecha)).toEqual(['2026-09-20', '2026-09-20']);
  });

  it('después de «Cambiar» SIN escribir nada: la fecha sigue siendo la de hoy', async () => {
    await mount();
    await llenarPeajes();
    await abrirFecha();
    await guardar();
    expect(filaDe(inserts()[0]!).fecha).toBe(HOY);
  });

  it('al editar sin tocar «Cambiar»: se manda la fecha del gasto, sin cambiarla', async () => {
    await mount(EDITAR);
    await guardar();
    expect(updatesGasto()).toHaveLength(1);
    expect(cambiosDe(updatesGasto()[0]!).fecha).toBe('2026-10-01');
  });

  it('al editar con «Cambiar»: se manda la fecha nueva', async () => {
    await mount(EDITAR);
    await abrirFecha();
    expect(campoFecha()!.value).toBe('2026-10-01');
    await typeText(campoFecha(), '2026-10-05');
    await guardar();
    expect(cambiosDe(updatesGasto()[0]!).fecha).toBe('2026-10-05');
  });
});

// ---------------------------------------------------------------------------
// Cuando la fecha no es hoy
// ---------------------------------------------------------------------------
describe('cuando la fecha NO es hoy: «Fecha: <fecha corta>» y «Cambiar»', () => {
  it('al editar un gasto de este año: la fecha corta de las listas («1 oct»), no «hoy», y «Cambiar» igual', async () => {
    await mount(EDITAR);
    expect(filaFecha()!.textContent).toBe('Fecha: 1 oct');
    expect(filaFecha()!.textContent).not.toContain('hoy');
    expect(botonCambiar()).not.toBeNull();
    expect(campoFecha()).toBeNull();
  });

  it('al editar un gasto de otro año: lleva el año («5 mar 2025»)', async () => {
    route.detalle = () => ok(detalle({ fecha: '2025-03-05' }));
    await mount(EDITAR);
    expect(filaFecha()!.textContent).toBe('Fecha: 5 mar 2025');
  });

  it('al editar un gasto de AYER: «24 nov», no «hoy»', async () => {
    route.detalle = () => ok(detalle({ fecha: AYER }));
    await mount(EDITAR);
    expect(filaFecha()!.textContent).toBe('Fecha: 24 nov');
  });

  it('al editar un gasto de hoy: «Fecha: hoy»', async () => {
    route.detalle = () => ok(detalle({ fecha: HOY }));
    await mount(EDITAR);
    expect(filaFecha()!.textContent).toBe('Fecha: hoy');
  });

  it('«Cambiar» en un gasto viejo abre el campo con SU fecha (no la de hoy) y le pasa el foco', async () => {
    await mount(EDITAR);
    await abrirFecha();
    expect(campoFecha()!.value).toBe('2026-10-01');
    expect(enfocado()).toBe('gasto-fecha');
  });

  it('una fecha que no se entiende (la base acepta cosas raras) no se resume en una línea: el campo arranca abierto', async () => {
    route.detalle = () => ok(detalle({ fecha: '2026-02-30' }));
    await mount(EDITAR);
    expect(filaFecha()).toBeNull();
    expect(campoFecha()).not.toBeNull();
    expect(botonCambiar()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Errores de la fecha
// ---------------------------------------------------------------------------
describe('un error de la fecha abre el campo y lleva el foco (nunca queda escondido en la fila)', () => {
  it('al editar un gasto con una fecha anterior al piso (31 dic 1999): al guardar se abre el campo, se ve el error y el foco va al campo', async () => {
    route.detalle = () => ok(detalle({ fecha: '1999-12-31' }));
    await mount(EDITAR);
    expect(filaFecha()!.textContent).toBe('Fecha: 31 dic 1999');
    expect(campoFecha()).toBeNull();
    await guardar();
    expect(updatesGasto()).toHaveLength(0);
    expect(campoFecha()).not.toBeNull();
    expect(filaFecha()).toBeNull();
    expect(errorDeFecha()).not.toBe('');
    expect(campoFecha()!.getAttribute('aria-invalid')).toBe('true');
    expect(enfocado()).toBe('gasto-fecha');
  });

  it('al editar un gasto con fecha futura: lo mismo', async () => {
    route.detalle = () => ok(detalle({ fecha: '2026-12-01' }));
    await mount(EDITAR);
    expect(filaFecha()!.textContent).toBe('Fecha: 1 dic');
    await guardar();
    expect(updatesGasto()).toHaveLength(0);
    expect(errorDeFecha()).not.toBe('');
    expect(enfocado()).toBe('gasto-fecha');
  });

  it('alta con una categoría: si el reloj cambia y la fecha de hoy ya no vale, se abre el campo y el foco va a él', async () => {
    await mount();
    await llenarPeajes();
    expect(campoFecha()).toBeNull();
    ponerHoy(AYER); // la fecha elegida (hoy) quedó en el futuro
    await guardar();
    expect(inserts()).toHaveLength(0);
    expect(campoFecha()).not.toBeNull();
    expect(errorDeFecha()).not.toBe('');
    expect(enfocado()).toBe('gasto-fecha');
  });

  it('alta con varias categorías: lo mismo, UN solo campo, el error una sola vez y el foco en él', async () => {
    await mount();
    await llenarPeajesYLavado();
    expect(campoFecha()).toBeNull();
    ponerHoy(AYER);
    await guardar('Guardar 2 gastos');
    expect(inserts()).toHaveLength(0);
    expect(document.querySelectorAll('input[type="date"]')).toHaveLength(1);
    const mensaje = errorDeFecha();
    expect(mensaje).not.toBe('');
    expect(bodyText().split(mensaje)).toHaveLength(2);
    expect(enfocado()).toBe('gasto-fecha');
  });

  it('el campo abierto por el error NO se vuelve a plegar al corregirlo, y la corrección se guarda', async () => {
    route.detalle = () => ok(detalle({ fecha: '1999-12-31' }));
    await mount(EDITAR);
    await guardar();
    expect(errorDeFecha()).not.toBe('');
    await typeText(campoFecha(), '2026-11-01');
    expect(errorDeFecha()).toBe('');
    expect(campoFecha()).not.toBeNull();
    expect(filaFecha()).toBeNull();
    await guardar();
    expect(cambiosDe(updatesGasto()[0]!).fecha).toBe('2026-11-01');
  });

  it('un error de la fecha junto con uno anterior (el monto): el campo de la fecha se abre igual (su error se ve) y el foco va al primero', async () => {
    route.detalle = () => ok(detalle({ fecha: '1999-12-31' }));
    await mount(EDITAR);
    await typeText(monto(), '');
    await guardar();
    expect(campoFecha()).not.toBeNull();
    expect(errorDeFecha()).not.toBe('');
    expect(byId('gasto-monto-error')!.textContent).not.toBe('');
    expect(enfocado()).toBe('gasto-monto');
  });

  it('el método de pago sin elegir se ve ANTES que la fecha: con los dos errores el foco va al método y la fecha se abre igual', async () => {
    route.detalle = () => ok(detalle({ fecha: '1999-12-31', metodo_pago: null }));
    await mount(EDITAR);
    await guardar();
    expect(updatesGasto()).toHaveLength(0);
    expect(byId('gasto-metodo-error')!.textContent).not.toBe('');
    expect(errorDeFecha()).not.toBe('');
    expect(campoFecha()).not.toBeNull();
    expect(enfocado()).toBe('gasto-metodo-0');
  });

  it('varias categorías: el método de pago sin elegir (el del primer gasto) gana el foco sobre la fecha, y la fecha se abre igual', async () => {
    await mount();
    await marcar(PEAJES_ID, LAVADO_ID);
    await typeText(monto(PEAJES_ID), '800');
    await typeText(monto(LAVADO_ID), '300');
    await elegirMetodo('efectivo', LAVADO_ID); // falta el de Peajes
    ponerHoy(AYER);
    await guardar('Guardar 2 gastos');
    expect(inserts()).toHaveLength(0);
    expect(byId(`gasto-metodo-${PEAJES_ID}-error`)!.textContent).not.toBe('');
    expect(errorDeFecha()).not.toBe('');
    expect(campoFecha()).not.toBeNull();
    expect(enfocado()).toBe(`gasto-metodo-${PEAJES_ID}-0`);
  });

  it('un error de OTRO campo (el monto) no abre la fecha: sigue plegada', async () => {
    await mount();
    await marcar(PEAJES_ID);
    await elegirMetodo('efectivo');
    await guardar();
    expect(inserts()).toHaveLength(0);
    expect(byId('gasto-monto-error')!.textContent).not.toBe('');
    expect(campoFecha()).toBeNull();
    expect(filaFecha()!.textContent).toBe('Fecha: hoy');
    expect(enfocado()).toBe('gasto-monto');
  });

  it('un error de la categoría tampoco abre la fecha', async () => {
    await mount();
    await guardar();
    expect(campoFecha()).toBeNull();
    expect(filaFecha()).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// «Empezar de nuevo» y volver a abrir la pantalla
// ---------------------------------------------------------------------------
describe('«Empezar de nuevo» y el reinicio tras guardar', () => {
  /** Un gasto cuyo primer guardado falla sin señal: aparece «Empezar de nuevo». */
  async function conUnGuardadoFallido(cambiarFecha: boolean) {
    route.insertar = () => sinRed();
    await mount();
    await llenarPeajes();
    if (cambiarFecha) {
      await abrirFecha();
      await typeText(campoFecha(), '2026-11-10');
    }
    await guardar();
    expect(bodyText()).toContain(NETWORK_SAVE_ERROR_MESSAGE);
  }
  async function empezarDeNuevo() {
    await click(buttonByText(EMPEZAR_DE_NUEVO));
    await click(buttonByText('Sí, empezar de nuevo'));
  }

  it('sin haber tocado la fecha: tras «Empezar de nuevo» sigue plegada en «hoy»', async () => {
    await conUnGuardadoFallido(false);
    await empezarDeNuevo();
    expect(buttonByText(EMPEZAR_DE_NUEVO)).toBeUndefined();
    expect(filaFecha()!.textContent).toBe('Fecha: hoy');
    expect(campoFecha()).toBeNull();
  });

  it('con la fecha cambiada: «Empezar de nuevo» CONSERVA lo escrito, la fecha incluida (y el campo sigue abierto), como con el monto', async () => {
    await conUnGuardadoFallido(true);
    await empezarDeNuevo();
    expect(monto()!.value).toBe('800');
    expect(campoFecha()!.value).toBe('2026-11-10');
    expect(filaFecha()).toBeNull();
  });

  it('con la fecha cambiada y guardada de nuevo tras «Empezar de nuevo»: va con esa fecha', async () => {
    await conUnGuardadoFallido(true);
    route.insertar = () => ok(null);
    await empezarDeNuevo();
    await guardar();
    expect(filaDe(inserts()[1]!).fecha).toBe('2026-11-10');
  });

  it('tras guardar bien se sale de la pantalla: al volver a abrir «Nuevo gasto» la fecha es hoy y está plegada (aunque se hubiera cambiado)', async () => {
    await mount();
    await llenarPeajes();
    await abrirFecha();
    await typeText(campoFecha(), '2026-11-10');
    await guardar();
    expect(byId('lista-de-gastos')).not.toBeNull();
    await desmontar();
    await mount();
    expect(filaFecha()!.textContent).toBe('Fecha: hoy');
    expect(campoFecha()).toBeNull();
    await guardar();
    expect(byId('gasto-fecha')).toBeNull();
  });
});
