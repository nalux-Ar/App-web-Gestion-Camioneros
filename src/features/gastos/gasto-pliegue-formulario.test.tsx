import { act, useMemo, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation, type InitialEntry } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// «Nuevo gasto» y la edición: la nota (la descripción) y el viaje van plegados detrás de «Agregar nota o viaje»; la descripción de «Gastos
// varios» es obligatoria, va siempre a la vista y se llama «¿En qué gastaste?». Mock de supabase: registra cada pedido y responde según
// la tabla. Todo lo demás es código REAL del proyecto (formulario, hooks, TanStack Query, router, validación). Hoy es SIEMPRE el 25 de
// noviembre de 2026 (solo se congela `Date`; los temporizadores corren).
type Op = { m: string; args: unknown[] };
type Call = { target: string; ops: Op[] };

const h = vi.hoisted(() => {
  const calls: Array<{ target: string; ops: Array<{ m: string; args: unknown[] }> }> = [];
  const state = {
    responder: null as null | ((call: { target: string; ops: Array<{ m: string; args: unknown[] }> }) => unknown),
    /** Si está, la validación de UN gasto devuelve estos errores (para probar errores que la de hoy no puede dar). Si no, corre la real. */
    errorForzado: null as null | Record<string, string>,
    /** Lo mismo para la validación de VARIOS gastos: el resultado entero. */
    loteForzado: null as null | unknown,
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

// Las dos validaciones corren las REALES salvo que una prueba fuerce un resultado (ver `errorForzado` y `loteForzado`).
vi.mock('@/features/gastos/gasto-form', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/features/gastos/gasto-form')>();
  return {
    ...original,
    validateGastoForm: (...args: Parameters<typeof original.validateGastoForm>) =>
      h.state.errorForzado
        ? ({ ok: false, errors: h.state.errorForzado, firstField: 'viajeId' } as ReturnType<typeof original.validateGastoForm>)
        : original.validateGastoForm(...args),
  };
});
vi.mock('@/features/gastos/gasto-lote', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/features/gastos/gasto-lote')>();
  return {
    ...original,
    validateLoteDeGastos: (...args: Parameters<typeof original.validateLoteDeGastos>) =>
      h.state.loteForzado ? (h.state.loteForzado as ReturnType<typeof original.validateLoteDeGastos>) : original.validateLoteDeGastos(...args),
  };
});

import { AuthContext, type AuthContextValue } from '@/features/auth/auth-context';
import { MemberProvider } from '@/features/member/member-provider';
import { RequireMember } from '@/app/guards';
import { GastoFormPage } from '@/features/gastos/gasto-form-page';
import { COMBUSTIBLE_CATEGORIA_ID, GASTOS_VARIOS_CATEGORIA_ID, MAX_DESCRIPCION } from '@/features/gastos/constants';
import type { Categoria } from '@/features/gastos/categorias';
import { DESCRIPCION_OBLIGATORIA_MESSAGE, VIAJE_INVALIDO_MESSAGE } from '@/features/gastos/gasto-form';
import { queryClient } from '@/lib/query-client';

type Resp = { data: unknown; error: { message: string; code: string; details?: string; hint?: string } | null; status: number };
const ok = (data: unknown): Resp => ({ data, error: null, status: 200 });

const HOY = '2026-11-25';

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

const vid = (n: number) => `b0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const viaje = (n: number, origen: string) => ({ id: vid(n), fecha: '2026-09-15', origen, destino: 'Córdoba', camion_id: null });
const V_PILAR = viaje(1, 'Pilar');
const V_ROSARIO = viaje(2, 'Rosario');
const V_FUERA = vid(99); // un viaje que NO está entre los recientes ni vinculado: la validación lo rechaza
const RECIENTES = [V_PILAR, V_ROSARIO];

const GASTO_ID = 'e0000000-0000-4000-8000-000000000001';
const detalle = (over: Record<string, unknown> = {}) => ({
  id: GASTO_ID, categoria_id: PEAJES_ID, fecha: '2026-10-01', monto: 900, descripcion: null, metodo_pago: 'efectivo', litros: null,
  precio_por_litro: null, km_odometro: null, tanque_lleno: null, camion_id: null, viaje_id: null, viajes: null, ...over,
});

type Handler = (call: Call) => unknown;
const route: { detalle: Handler; opcion: Handler; insertar: Handler; actualizar: Handler } = {} as never;
function resetRoutes() {
  route.detalle = () => ok(detalle());
  route.opcion = () => ok(null);
  route.insertar = () => ok(null);
  route.actualizar = () => ok([{ id: GASTO_ID }]);
}
function installResponder() {
  h.state.responder = (call: Call) => {
    const has = (m: string) => call.ops.some((o) => o.m === m);
    if (call.target === 'miembros' && has('maybeSingle')) return ok(MIEMBRO);
    if (call.target === 'categorias_gasto') return ok(CATS);
    if (call.target === 'camiones') return ok([CAM_A]);
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

/** La lista de gastos de mentira. */
function ListaProbe() {
  const location = useLocation();
  const state = (location.state as { aviso?: string } | null) ?? {};
  return (
    <div id="lista-de-gastos" data-aviso={state.aviso ?? ''}>
      lista
    </div>
  );
}
/** El detalle del viaje de mentira. */
function DetalleProbe() {
  const location = useLocation();
  return <div id="detalle-del-viaje" data-path={location.pathname} />;
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

const EDITAR = `/gastos/${GASTO_ID}/editar`;
const byId = <T extends HTMLElement = HTMLElement>(elementId: string) => document.getElementById(elementId) as T | null;
const bodyText = () => document.body.textContent ?? '';
const buttons = () => [...document.querySelectorAll<HTMLButtonElement>('button')];
const casilla = (categoriaId: string) => document.querySelector<HTMLInputElement>(`input[type="checkbox"][value="${categoriaId}"]`)!;
const radioDeCategoria = (categoriaId: string) => document.querySelector<HTMLInputElement>(`input[type="radio"][name][value="${categoriaId}"]`)!;
const enfocado = () => document.activeElement?.id ?? '';
const monto = (categoriaId?: string) => byId<HTMLInputElement>(categoriaId === undefined ? 'gasto-monto' : `gasto-monto-${categoriaId}`);
const nota = (categoriaId?: string) => byId<HTMLTextAreaElement>(categoriaId === undefined ? 'gasto-descripcion' : `gasto-descripcion-${categoriaId}`);
const selectViaje = () => byId<HTMLSelectElement>('gasto-viaje');
/** El botón del pliegue (el único con `aria-controls="gasto-pliegue"`). */
const botonPliegue = () => buttons().find((b) => b.getAttribute('aria-controls') === 'gasto-pliegue') ?? null;
const antes = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

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
/** «Agregar nota o viaje»: despliega el pliegue donde viven las notas y el viaje (si ya está desplegado, no hace nada). */
async function abrirNotaYViaje() {
  const boton = botonPliegue();
  if (boton) await click(boton);
}
async function elegirMetodo(valor: string, categoriaId?: string) {
  const prefijo = categoriaId === undefined ? 'gasto-metodo' : `gasto-metodo-${categoriaId}`;
  await click(document.querySelector<HTMLInputElement>(`input[type="radio"][id^="${prefijo}-"][value="${valor}"]`));
}
/** Lo mínimo para guardar UN gasto de Peajes: el monto y el método de pago. */
async function llenarPeajes() {
  await marcar(PEAJES_ID);
  await typeText(monto(), '800');
  await elegirMetodo('efectivo');
}
/** Lo mínimo para guardar varios gastos (sin «Gastos varios»): Peajes y Lavado. */
async function llenarPeajesYLavado() {
  await marcar(PEAJES_ID, LAVADO_ID);
  await typeText(monto(PEAJES_ID), '800');
  await elegirMetodo('efectivo', PEAJES_ID);
  await typeText(monto(LAVADO_ID), '300');
  await elegirMetodo('transferencia', LAVADO_ID);
}
/** El reloj de hoy cambia (solo `Date`). */
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
const textoDelBoton = (boton: HTMLButtonElement | null) => boton?.textContent ?? null;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  ponerHoy(HOY);
  h.calls.length = 0;
  h.state.errorForzado = null;
  h.state.loteForzado = null;
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
// (a) El orden de los campos
// ---------------------------------------------------------------------------
describe('el orden de los campos con el pliegue «Agregar nota o viaje»', () => {
  const PLEGADO_COMUN = ['Categoría', 'Monto', '¿Cómo pagaste?', 'Fecha: hoy'];

  it('una categoría común (o ninguna): Categoría → Monto → ¿Cómo pagaste? → Fecha → [botón]; desplegado: Descripción → Viaje', async () => {
    await mount();
    expect(camposEnPantalla()).toEqual(PLEGADO_COMUN);
    expect(botonPliegue()).not.toBeNull();
    await marcar(PEAJES_ID);
    expect(camposEnPantalla()).toEqual(PLEGADO_COMUN);
    await abrirNotaYViaje();
    expect(camposEnPantalla()).toEqual([...PLEGADO_COMUN, 'Descripción', 'Viaje']);
    expect(ultimoCampo()).toBe('gasto-viaje');
    expect(botonPliegue()).toBeNull();
  });

  it('Gastos varios: Categoría → ¿En qué gastaste? → Monto → ¿Cómo pagaste? → Fecha → [botón «Agregar viaje»]; desplegado: Viaje', async () => {
    await mount();
    await marcar(GASTOS_VARIOS_CATEGORIA_ID);
    expect(camposEnPantalla()).toEqual(['Categoría', '¿En qué gastaste?', 'Monto', '¿Cómo pagaste?', 'Fecha: hoy']);
    expect(textoDelBoton(botonPliegue())).toBe('Agregar viaje');
    await abrirNotaYViaje();
    expect(camposEnPantalla()).toEqual(['Categoría', '¿En qué gastaste?', 'Monto', '¿Cómo pagaste?', 'Fecha: hoy', 'Viaje']);
    expect(ultimoCampo()).toBe('gasto-viaje');
  });

  it('Combustible: el recuadro (camión, litros, km, tanque) queda después del monto; la nota, después de la fecha', async () => {
    await mount();
    await marcar(COMBUSTIBLE_CATEGORIA_ID);
    expect(camposEnPantalla()).toEqual(['Categoría', 'Monto', 'Litros', 'Kilómetros del camión', '¿Llenaste el tanque?', '¿Cómo pagaste?', 'Fecha: hoy']);
    await abrirNotaYViaje();
    expect(camposEnPantalla()).toEqual(['Categoría', 'Monto', 'Litros', 'Kilómetros del camión', '¿Llenaste el tanque?', '¿Cómo pagaste?', 'Fecha: hoy', 'Descripción', 'Viaje']);
    const orden = ['gasto-monto', 'gasto-litros', 'gasto-km', 'gasto-tanque-0', 'gasto-metodo-0', 'gasto-fecha-linea', 'gasto-descripcion', 'gasto-viaje'].map((id) => byId(id)!);
    for (let i = 0; i < orden.length - 1; i++) expect(antes(orden[i]!, orden[i + 1]!), `${orden[i]!.id} antes de ${orden[i + 1]!.id}`).toBe(true);
  });

  it('al editar un gasto común sin nota ni viaje: lo mismo, plegado', async () => {
    await mount(EDITAR);
    expect(camposEnPantalla()).toEqual(['Categoría', 'Monto', '¿Cómo pagaste?', 'Fecha: 1 oct']);
    expect(textoDelBoton(botonPliegue())).toBe('Agregar nota o viaje');
    await abrirNotaYViaje();
    expect(camposEnPantalla()).toEqual(['Categoría', 'Monto', '¿Cómo pagaste?', 'Fecha: 1 oct', 'Descripción', 'Viaje']);
  });

  it('al editar un gasto de Combustible: método de pago, fecha, nota y viaje, en ese orden, después del recuadro', async () => {
    route.detalle = () => ok(detalle({ categoria_id: COMBUSTIBLE_CATEGORIA_ID, litros: 40, precio_por_litro: 22.5, camion_id: CAM_A.id }));
    await mount(EDITAR);
    await abrirNotaYViaje();
    const orden = ['gasto-monto', 'gasto-litros', 'gasto-km', 'gasto-tanque-0', 'gasto-metodo-0', 'gasto-fecha-linea', 'gasto-descripcion', 'gasto-viaje'].map((id) => byId(id)!);
    for (let i = 0; i < orden.length - 1; i++) expect(antes(orden[i]!, orden[i + 1]!), `${orden[i]!.id} antes de ${orden[i + 1]!.id}`).toBe(true);
  });

  it('al editar un gasto de Gastos varios: ¿En qué gastaste? arriba y solo el viaje en el pliegue', async () => {
    route.detalle = () => ok(detalle({ categoria_id: GASTOS_VARIOS_CATEGORIA_ID }));
    await mount(EDITAR);
    expect(camposEnPantalla()).toEqual(['Categoría', '¿En qué gastaste?', 'Monto', '¿Cómo pagaste?', 'Fecha: 1 oct']);
    expect(textoDelBoton(botonPliegue())).toBe('Agregar viaje');
  });

  it('varias categorías SIN Gastos varios: los bloques, los métodos juntos, la fecha y [botón]; desplegado: una nota por categoría y el viaje', async () => {
    await mount();
    await marcar(PEAJES_ID, LAVADO_ID);
    const plegado = ['Categoría', 'Monto', 'Monto', '¿Cómo pagaste cada gasto?', '¿Cómo pagaste Lavado?', '¿Cómo pagaste Peajes?', 'Fecha: hoy'];
    expect(camposEnPantalla()).toEqual(plegado);
    expect(textoDelBoton(botonPliegue())).toBe('Agregar notas o viaje');
    await abrirNotaYViaje();
    expect(camposEnPantalla()).toEqual([...plegado, 'Nota de Lavado', 'Nota de Peajes', 'Viaje']);
    expect(ultimoCampo()).toBe('gasto-viaje');
  });

  it('varias categorías CON Gastos varios: su pregunta arriba de su monto; las notas de las demás en el pliegue', async () => {
    await mount();
    await marcar(PEAJES_ID, GASTOS_VARIOS_CATEGORIA_ID);
    const plegado = ['Categoría', '¿En qué gastaste?', 'Monto', 'Monto', '¿Cómo pagaste cada gasto?', '¿Cómo pagaste Gastos varios?', '¿Cómo pagaste Peajes?', 'Fecha: hoy'];
    expect(camposEnPantalla()).toEqual(plegado);
    expect(textoDelBoton(botonPliegue())).toBe('Agregar nota o viaje');
    await abrirNotaYViaje();
    expect(camposEnPantalla()).toEqual([...plegado, 'Nota de Peajes', 'Viaje']);
  });

  it('varias categorías con Combustible, Gastos varios y Peajes: Combustible primero, cada bloque con lo suyo, y las notas de Combustible y Peajes (no la de Gastos varios)', async () => {
    await mount();
    await marcar(PEAJES_ID, GASTOS_VARIOS_CATEGORIA_ID, COMBUSTIBLE_CATEGORIA_ID);
    await abrirNotaYViaje();
    expect(camposEnPantalla()).toEqual([
      'Categoría',
      'Monto', // Combustible
      'Litros',
      'Kilómetros del camión',
      '¿Llenaste el tanque?',
      '¿En qué gastaste?', // Gastos varios
      'Monto',
      'Monto', // Peajes
      '¿Cómo pagaste cada gasto?',
      '¿Cómo pagaste Combustible?',
      '¿Cómo pagaste Gastos varios?',
      '¿Cómo pagaste Peajes?',
      'Fecha: hoy',
      'Nota de Combustible',
      'Nota de Peajes',
      'Viaje',
    ]);
  });
});

// ---------------------------------------------------------------------------
// (b) El botón del pliegue
// ---------------------------------------------------------------------------
describe('el botón «Agregar nota o viaje»', () => {
  it('una categoría común: «Agregar nota o viaje»', async () => {
    await mount();
    expect(textoDelBoton(botonPliegue())).toBe('Agregar nota o viaje');
    await marcar(PEAJES_ID);
    expect(textoDelBoton(botonPliegue())).toBe('Agregar nota o viaje');
  });

  it('solo Gastos varios (donde solo queda el viaje): «Agregar viaje»', async () => {
    await mount();
    await marcar(GASTOS_VARIOS_CATEGORIA_ID);
    expect(textoDelBoton(botonPliegue())).toBe('Agregar viaje');
  });

  it('varias con dos notas adentro: «Agregar notas o viaje»; con una sola (la otra es Gastos varios): «Agregar nota o viaje»', async () => {
    await mount();
    await marcar(PEAJES_ID, LAVADO_ID);
    expect(textoDelBoton(botonPliegue())).toBe('Agregar notas o viaje');
    await marcar(LAVADO_ID, GASTOS_VARIOS_CATEGORIA_ID);
    expect(textoDelBoton(botonPliegue())).toBe('Agregar nota o viaje');
    await marcar(COMBUSTIBLE_CATEGORIA_ID);
    expect(textoDelBoton(botonPliegue())).toBe('Agregar notas o viaje');
  });

  it('el texto cambia solo cuando cambia lo que hay adentro (de «Agregar nota o viaje» a «Agregar viaje» al pasar a Gastos varios)', async () => {
    await mount();
    await marcar(PEAJES_ID);
    expect(textoDelBoton(botonPliegue())).toBe('Agregar nota o viaje');
    await marcar(PEAJES_ID, GASTOS_VARIOS_CATEGORIA_ID);
    expect(textoDelBoton(botonPliegue())).toBe('Agregar viaje');
    expect(buttons().filter((b) => b.getAttribute('aria-controls') === 'gasto-pliegue')).toHaveLength(1);
  });

  it('es de contorno, de ANCHO COMPLETO, de 48 px o más de alto y de 16 px o más de texto', async () => {
    await mount();
    const clases = botonPliegue()!.className;
    expect(clases).toMatch(/(?:^|\s)w-full(?:\s|$)/);
    const alto = /(?:^|\s)(?:min-)?h-(\d+)(?:\s|$)/.exec(clases);
    expect(alto, clases).not.toBeNull();
    expect(Number(alto![1]) * 4).toBeGreaterThanOrEqual(48); // 12 = 3 rem = 48 px
    expect(clases).toMatch(/(?:^|\s)min-h-12(?:\s|$)/); // y crece si el texto se parte (letra grande)
    expect(clases).toContain('text-base'); // 16 px
    expect(clases).not.toMatch(/(?:^|\s)text-(?:xs|sm)(?:\s|$)/);
    expect(clases).toContain('border'); // variante «outline»
    expect(botonPliegue()!.type).toBe('button'); // no envía el formulario
  });

  it('dice que está plegado (aria-expanded="false") y apunta a la región que se despliega, que existe y está oculta mientras está plegada', async () => {
    await mount();
    const boton = botonPliegue()!;
    expect(boton.getAttribute('aria-expanded')).toBe('false');
    expect(boton.getAttribute('aria-controls')).toBe('gasto-pliegue');
    const region = byId('gasto-pliegue')!;
    expect(region).not.toBeNull();
    expect(region.hidden).toBe(true);
    expect(region.childElementCount).toBe(0); // sin campos ocultos ni ids repetidos
    expect(document.querySelectorAll('#gasto-pliegue')).toHaveLength(1);
  });

  it('desplegado: la región se ve, tiene los campos y el botón ya no está', async () => {
    await mount();
    await abrirNotaYViaje();
    const region = byId('gasto-pliegue')!;
    expect(region.hidden).toBe(false);
    expect(region.contains(nota()!)).toBe(true);
    expect(region.contains(selectViaje()!)).toBe(true);
    expect(botonPliegue()).toBeNull();
    expect(buttons().some((b) => /Agregar (nota|notas|viaje)/.test(b.textContent ?? ''))).toBe(false);
  });

  it('el «+» es un ícono decorativo (aria-hidden) y NO parte del texto: el nombre accesible es solo el texto, y empieza con lo que se ve', async () => {
    await mount();
    const boton = botonPliegue()!;
    const icono = boton.querySelector('svg');
    expect(icono).not.toBeNull();
    expect(icono!.getAttribute('aria-hidden')).toBe('true');
    expect(boton.textContent).toBe('Agregar nota o viaje'); // sin «+» ni espacios de más
    expect(boton.textContent).not.toContain('+');
    expect(boton.getAttribute('aria-label')).toBeNull(); // el nombre sale del texto visible
  });

  it('en el alta con varias, el botón está en el bloque compartido: después de la fecha y antes del botón de guardar', async () => {
    await mount();
    await marcar(PEAJES_ID, LAVADO_ID);
    const guardarBtn = buttons().find((b) => b.type === 'submit')!;
    expect(antes(byId('gasto-fecha-linea')!, botonPliegue()!)).toBe(true);
    expect(antes(botonPliegue()!, guardarBtn)).toBe(true);
    expect(antes(byId(`gasto-metodo-${PEAJES_ID}-0`)!, botonPliegue()!)).toBe(true);
  });

  it('tocar el botón no guarda ni muestra errores', async () => {
    await mount();
    await abrirNotaYViaje();
    expect(inserts()).toHaveLength(0);
    expect(document.querySelectorAll('[aria-invalid="true"]')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// (c) Desplegar mueve el foco y queda desplegado
// ---------------------------------------------------------------------------
describe('desplegar el pliegue: el foco pasa al primer campo y queda desplegado', () => {
  it('una categoría común: el foco va a la Descripción', async () => {
    await mount();
    await marcar(PEAJES_ID);
    await abrirNotaYViaje();
    expect(enfocado()).toBe('gasto-descripcion');
    expect(document.activeElement).toBe(nota());
  });

  it('sin ninguna categoría marcada también: a la Descripción', async () => {
    await mount();
    await abrirNotaYViaje();
    expect(enfocado()).toBe('gasto-descripcion');
  });

  it('solo Gastos varios (no hay nota en el pliegue): el foco va al Viaje', async () => {
    await mount();
    await marcar(GASTOS_VARIOS_CATEGORIA_ID);
    await abrirNotaYViaje();
    expect(enfocado()).toBe('gasto-viaje');
  });

  it('varias: el foco va a la primera nota del pliegue (en el orden de los bloques)', async () => {
    await mount();
    await marcar(PEAJES_ID, LAVADO_ID);
    await abrirNotaYViaje();
    expect(enfocado()).toBe(`gasto-descripcion-${LAVADO_ID}`); // Lavado va antes que Peajes en la lista de categorías
  });

  it('varias con Gastos varios y Peajes: a la nota de Peajes (la de Gastos varios no está en el pliegue)', async () => {
    await mount();
    await marcar(GASTOS_VARIOS_CATEGORIA_ID, PEAJES_ID);
    await abrirNotaYViaje();
    expect(enfocado()).toBe(`gasto-descripcion-${PEAJES_ID}`);
  });

  it('queda desplegado: al escribir, al borrar todo lo escrito y al elegir «Sin viaje» el pliegue NO se vuelve a plegar bajo el dedo', async () => {
    await mount();
    await marcar(PEAJES_ID);
    await abrirNotaYViaje();
    await typeText(nota(), 'Peaje de la ruta');
    expect(botonPliegue()).toBeNull();
    await typeText(nota(), '');
    expect(nota()).not.toBeNull();
    expect(botonPliegue()).toBeNull();
    await selectValue(selectViaje(), V_PILAR.id);
    await selectValue(selectViaje(), '');
    expect(selectViaje()).not.toBeNull();
    expect(botonPliegue()).toBeNull();
  });

  it('no vuelve a llevar el foco cada vez que se escribe en otro lado', async () => {
    await mount();
    await marcar(PEAJES_ID);
    await abrirNotaYViaje();
    await act(async () => {
      monto()!.focus();
    });
    await typeText(monto(), '55');
    expect(enfocado()).toBe('gasto-monto');
  });

  it('con varias queda desplegado aunque se desmarque una categoría', async () => {
    await mount();
    await marcar(PEAJES_ID, LAVADO_ID);
    await abrirNotaYViaje();
    await marcar(LAVADO_ID);
    expect(botonPliegue()).toBeNull();
    expect(nota()).not.toBeNull();
    expect(selectViaje()).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// (d) Desplegado de entrada cuando hay algo adentro
// ---------------------------------------------------------------------------
describe('el pliegue se ve desplegado desde el principio cuando ya hay algo adentro (no esconde datos)', () => {
  it('editar un gasto con descripción: la nota se ve, con su texto, y no hay botón', async () => {
    route.detalle = () => ok(detalle({ descripcion: 'Peaje de Rosario' }));
    await mount(EDITAR);
    expect(botonPliegue()).toBeNull();
    expect(nota()!.value).toBe('Peaje de Rosario');
    expect(byId('gasto-pliegue')!.hidden).toBe(false);
    expect(selectViaje()).not.toBeNull();
  });

  it('editar un gasto con viaje: el viaje se ve elegido y no hay botón', async () => {
    route.detalle = () => ok(detalle({ viaje_id: V_ROSARIO.id, viajes: V_ROSARIO }));
    await mount(EDITAR);
    expect(botonPliegue()).toBeNull();
    expect(selectViaje()!.value).toBe(V_ROSARIO.id);
    expect(nota()).not.toBeNull();
  });

  it('editar un gasto de Gastos varios con viaje: el viaje se ve (la descripción ya estaba arriba) y no hay botón', async () => {
    route.detalle = () => ok(detalle({ categoria_id: GASTOS_VARIOS_CATEGORIA_ID, descripcion: 'Lavado', viaje_id: V_PILAR.id, viajes: V_PILAR }));
    await mount(EDITAR);
    expect(botonPliegue()).toBeNull();
    expect(selectViaje()!.value).toBe(V_PILAR.id);
    expect(nota()!.value).toBe('Lavado');
    expect(document.querySelector('label[for="gasto-descripcion"]')!.textContent).toBe('¿En qué gastaste?');
  });

  it('editar un gasto de Gastos varios con descripción pero SIN viaje: sigue plegado (la descripción no está en el pliegue)', async () => {
    route.detalle = () => ok(detalle({ categoria_id: GASTOS_VARIOS_CATEGORIA_ID, descripcion: 'Lavado' }));
    await mount(EDITAR);
    expect(textoDelBoton(botonPliegue())).toBe('Agregar viaje');
    expect(selectViaje()).toBeNull();
    expect(nota()!.value).toBe('Lavado');
  });

  it('llegar desde el detalle de un viaje (?viaje= y desdeViaje): el viaje llega elegido y el pliegue desplegado', async () => {
    route.opcion = () => ok(V_PILAR);
    await mount({ pathname: '/gastos/nuevo', search: `?viaje=${V_PILAR.id}`, state: { desdeViaje: V_PILAR.id, volverViaje: '' } });
    expect(botonPliegue()).toBeNull();
    expect(selectViaje()!.value).toBe(V_PILAR.id);
  });

  it('llegar con ?viaje= (sin desdeViaje): también desplegado, con el viaje elegido', async () => {
    route.opcion = () => ok(V_PILAR);
    await mount(`/gastos/nuevo?viaje=${V_PILAR.id}`);
    expect(botonPliegue()).toBeNull();
    expect(selectViaje()!.value).toBe(V_PILAR.id);
  });

  it('con varias categorías y un viaje que llegó elegido: el pliegue desplegado, con una nota por categoría', async () => {
    route.opcion = () => ok(V_PILAR);
    await mount(`/gastos/nuevo?viaje=${V_PILAR.id}`);
    await marcar(PEAJES_ID, LAVADO_ID);
    expect(botonPliegue()).toBeNull();
    expect(nota(PEAJES_ID)).not.toBeNull();
    expect(nota(LAVADO_ID)).not.toBeNull();
    expect(selectViaje()!.value).toBe(V_PILAR.id);
  });

  it('al cambiar de categoría con texto escrito en «¿En qué gastaste?»: pasa a la nota de la nueva y el pliegue se ve desplegado (el texto NO queda escondido)', async () => {
    await mount();
    await marcar(GASTOS_VARIOS_CATEGORIA_ID);
    await typeText(nota(), 'Lavado del camión');
    expect(textoDelBoton(botonPliegue())).toBe('Agregar viaje');
    await marcar(GASTOS_VARIOS_CATEGORIA_ID, PEAJES_ID); // desmarca una y marca la otra
    expect(botonPliegue()).toBeNull();
    expect(nota()!.value).toBe('Lavado del camión');
    expect(document.querySelector('label[for="gasto-descripcion"]')!.textContent).toContain('Descripción');
  });

  it('al editar y cambiar la categoría de una común con nota a Gastos varios: el texto sube a «¿En qué gastaste?» y se ve', async () => {
    route.detalle = () => ok(detalle({ descripcion: 'Peaje de Rosario' }));
    await mount(EDITAR);
    expect(nota()!.value).toBe('Peaje de Rosario');
    await click(radioDeCategoria(GASTOS_VARIOS_CATEGORIA_ID));
    expect(nota()!.value).toBe('Peaje de Rosario');
    expect(document.querySelector('label[for="gasto-descripcion"]')!.textContent).toBe('¿En qué gastaste?');
  });

  it('al editar un gasto de Gastos varios con texto y cambiarlo a una común: el texto aparece en la nota ya desplegada', async () => {
    route.detalle = () => ok(detalle({ categoria_id: GASTOS_VARIOS_CATEGORIA_ID, descripcion: 'Lavado del camión' }));
    await mount(EDITAR);
    expect(textoDelBoton(botonPliegue())).toBe('Agregar viaje');
    await click(radioDeCategoria(LAVADO_ID));
    expect(botonPliegue()).toBeNull();
    expect(nota()!.value).toBe('Lavado del camión');
  });

  it('un gasto sin nota ni viaje arranca plegado, y una nota de solo espacios no cuenta como dato', async () => {
    route.detalle = () => ok(detalle({ descripcion: '   ' }));
    await mount(EDITAR);
    expect(textoDelBoton(botonPliegue())).toBe('Agregar nota o viaje');
    expect(nota()).toBeNull();
  });

  it('el texto de una categoría que ya no está marcada NO cuenta: el pliegue solo mira lo que se ve', async () => {
    await mount();
    await marcar(PEAJES_ID, LAVADO_ID);
    await abrirNotaYViaje();
    await typeText(nota(LAVADO_ID), 'solo de Lavado');
    expect(botonPliegue()).toBeNull();
    // se desmarcan las dos y se marca Gastos varios (que no tiene notas): la nota de Lavado queda guardada pero a la vista no hay nada en el pliegue
    await marcar(LAVADO_ID, PEAJES_ID, GASTOS_VARIOS_CATEGORIA_ID);
    expect(nota(LAVADO_ID)).toBeNull();
  });

  it('lo escrito en «¿En qué gastaste?» (Gastos varios) NO desplega el pliegue: no está en él', async () => {
    await mount();
    await marcar(GASTOS_VARIOS_CATEGORIA_ID);
    await typeText(nota(), 'Lavado');
    expect(textoDelBoton(botonPliegue())).toBe('Agregar viaje');
    await marcar(PEAJES_ID);
    await typeText(nota(GASTOS_VARIOS_CATEGORIA_ID), 'Lavado del camión');
    expect(textoDelBoton(botonPliegue())).toBe('Agregar nota o viaje');
    expect(nota(PEAJES_ID)).toBeNull();
  });
});

describe('lo que se abrió solo porque había datos también queda abierto', () => {
  it('editar un gasto con nota y borrarla entera: el pliegue sigue desplegado (no se pliega bajo el dedo)', async () => {
    route.detalle = () => ok(detalle({ descripcion: 'Peaje de Rosario' }));
    await mount(EDITAR);
    await typeText(nota(), '');
    expect(botonPliegue()).toBeNull();
    expect(nota()).not.toBeNull();
    expect(selectViaje()).not.toBeNull();
  });

  it('editar un gasto con viaje y elegir «Sin viaje»: sigue desplegado', async () => {
    route.detalle = () => ok(detalle({ viaje_id: V_ROSARIO.id, viajes: V_ROSARIO }));
    await mount(EDITAR);
    await selectValue(selectViaje(), '');
    expect(botonPliegue()).toBeNull();
    expect(selectViaje()!.value).toBe('');
  });

  it('llegar con un viaje elegido y elegir «Sin viaje»: sigue desplegado', async () => {
    route.opcion = () => ok(V_PILAR);
    await mount(`/gastos/nuevo?viaje=${V_PILAR.id}`);
    await selectValue(selectViaje(), '');
    expect(botonPliegue()).toBeNull();
    expect(selectViaje()).not.toBeNull();
  });

  it('editar un gasto con nota y cambiar la categoría a Gastos varios (la nota sube): el pliegue sigue desplegado, con el viaje', async () => {
    route.detalle = () => ok(detalle({ descripcion: 'Peaje de Rosario' }));
    await mount(EDITAR);
    await click(radioDeCategoria(GASTOS_VARIOS_CATEGORIA_ID));
    expect(botonPliegue()).toBeNull();
    expect(selectViaje()).not.toBeNull();
    expect(document.querySelectorAll('textarea')).toHaveLength(1);
  });

  it('en el alta: una nota que pasó de «Gastos varios» a una común abre el pliegue, y al volver a Gastos varios sigue desplegado', async () => {
    await mount();
    await marcar(GASTOS_VARIOS_CATEGORIA_ID);
    await typeText(nota(), 'Lavado del camión');
    await marcar(GASTOS_VARIOS_CATEGORIA_ID, PEAJES_ID);
    expect(botonPliegue()).toBeNull();
    await marcar(PEAJES_ID, GASTOS_VARIOS_CATEGORIA_ID);
    expect(botonPliegue()).toBeNull();
    expect(selectViaje()).not.toBeNull();
    expect(nota()!.value).toBe('Lavado del camión');
  });
});

// ---------------------------------------------------------------------------
// (e) Errores en lo que se pliega
// ---------------------------------------------------------------------------
describe('un error de un campo del pliegue lo abre en el mismo render, aunque el campo esté vacío (validación forzada)', () => {
  it('una categoría, error del viaje con el pliegue plegado: se abre, el error se ve y el foco va al viaje', async () => {
    await mount();
    await llenarPeajes();
    h.state.errorForzado = { viajeId: VIAJE_INVALIDO_MESSAGE };
    expect(selectViaje()).toBeNull();
    await guardar();
    expect(inserts()).toHaveLength(0);
    expect(botonPliegue()).toBeNull();
    expect(byId('gasto-viaje-error')!.textContent).toBe(VIAJE_INVALIDO_MESSAGE);
    expect(enfocado()).toBe('gasto-viaje');
  });

  it('una categoría, error en la nota vacía: se abre, el error se ve y el foco va a la nota', async () => {
    await mount();
    await llenarPeajes();
    h.state.errorForzado = { descripcion: 'Falta la nota.' };
    await guardar();
    expect(botonPliegue()).toBeNull();
    expect(byId('gasto-descripcion-error')!.textContent).toBe('Falta la nota.');
    expect(enfocado()).toBe('gasto-descripcion');
  });

  it('el pliegue que abrió un error queda abierto al corregirlo', async () => {
    await mount();
    await llenarPeajes();
    h.state.errorForzado = { viajeId: VIAJE_INVALIDO_MESSAGE };
    await guardar();
    await selectValue(selectViaje(), V_PILAR.id);
    await selectValue(selectViaje(), '');
    expect(byId('gasto-viaje-error')!.textContent).toBe('');
    expect(botonPliegue()).toBeNull();
  });

  it('varias, error en la nota vacía de un bloque: se abre y el foco va a ESA nota', async () => {
    await mount();
    await llenarPeajesYLavado();
    h.state.loteForzado = { ok: false, compartidos: {}, bloques: [{ categoriaId: PEAJES_ID, errors: { descripcion: 'Falta la nota.' } }], primero: { categoriaId: PEAJES_ID, field: 'descripcion' } };
    await guardar('Guardar 2 gastos');
    expect(botonPliegue()).toBeNull();
    expect(byId(`gasto-descripcion-${PEAJES_ID}-error`)!.textContent).toBe('Falta la nota.');
    expect(enfocado()).toBe(`gasto-descripcion-${PEAJES_ID}`);
  });

  it('varias, error del viaje: se abre y el foco va al viaje', async () => {
    await mount();
    await llenarPeajesYLavado();
    h.state.loteForzado = { ok: false, compartidos: { viajeId: VIAJE_INVALIDO_MESSAGE }, bloques: [], primero: { categoriaId: LAVADO_ID, field: 'viajeId' } };
    await guardar('Guardar 2 gastos');
    expect(botonPliegue()).toBeNull();
    expect(enfocado()).toBe('gasto-viaje');
  });

  it('un error de «¿En qué gastaste?» (que está arriba, fuera del pliegue) NO abre el pliegue', async () => {
    await mount();
    await marcar(PEAJES_ID, GASTOS_VARIOS_CATEGORIA_ID);
    h.state.loteForzado = { ok: false, compartidos: {}, bloques: [{ categoriaId: GASTOS_VARIOS_CATEGORIA_ID, errors: { descripcion: 'Falta.' } }], primero: { categoriaId: GASTOS_VARIOS_CATEGORIA_ID, field: 'descripcion' } };
    await guardar('Guardar 2 gastos');
    expect(textoDelBoton(botonPliegue())).toBe('Agregar nota o viaje');
    expect(enfocado()).toBe(`gasto-descripcion-${GASTOS_VARIOS_CATEGORIA_ID}`);
  });
});

describe('un error del viaje o de una nota nunca queda escondido: el pliegue está abierto y el foco va al primer error', () => {
  it('un viaje que no está entre los conocidos (el gasto se edita con un viaje que no llegó): el error se ve, el pliegue está desplegado y el foco va al viaje', async () => {
    route.detalle = () => ok(detalle({ viaje_id: V_FUERA, viajes: null }));
    await mount(EDITAR);
    expect(botonPliegue()).toBeNull();
    await guardar();
    expect(updatesGasto()).toHaveLength(0);
    expect(byId('gasto-viaje-error')!.textContent).toBe(VIAJE_INVALIDO_MESSAGE);
    expect(enfocado()).toBe('gasto-viaje');
    expect(botonPliegue()).toBeNull();
  });

  it('una nota demasiado larga (edición): el error se ve, el pliegue desplegado y el foco va a la nota', async () => {
    route.detalle = () => ok(detalle({ descripcion: 'x'.repeat(MAX_DESCRIPCION + 1) }));
    await mount(EDITAR);
    expect(botonPliegue()).toBeNull();
    await guardar();
    expect(updatesGasto()).toHaveLength(0);
    expect(byId('gasto-descripcion-error')!.textContent).not.toBe('');
    expect(enfocado()).toBe('gasto-descripcion');
  });

  it('una nota demasiado larga y un viaje inválido a la vez: el foco va a la nota (se ve antes que el viaje)', async () => {
    route.detalle = () => ok(detalle({ descripcion: 'x'.repeat(MAX_DESCRIPCION + 1), viaje_id: V_FUERA, viajes: null }));
    await mount(EDITAR);
    await guardar();
    expect(byId('gasto-descripcion-error')!.textContent).not.toBe('');
    expect(byId('gasto-viaje-error')!.textContent).not.toBe('');
    expect(enfocado()).toBe('gasto-descripcion');
  });

  it('una nota demasiado larga y un error de la fecha: el foco va a la fecha (la nota se ve después)', async () => {
    route.detalle = () => ok(detalle({ fecha: '1999-12-31', descripcion: 'x'.repeat(MAX_DESCRIPCION + 1) }));
    await mount(EDITAR);
    await guardar();
    expect(byId('gasto-fecha-error')!.textContent).not.toBe('');
    expect(byId('gasto-descripcion-error')!.textContent).not.toBe('');
    expect(enfocado()).toBe('gasto-fecha');
  });

  it('una nota demasiado larga y el método de pago sin elegir: el foco va al método (se ve antes)', async () => {
    route.detalle = () => ok(detalle({ metodo_pago: null, descripcion: 'x'.repeat(MAX_DESCRIPCION + 1) }));
    await mount(EDITAR);
    await guardar();
    expect(enfocado()).toBe('gasto-metodo-0');
    expect(byId('gasto-descripcion-error')!.textContent).not.toBe('');
  });

  it('una nota demasiado larga y un monto vacío: el foco va al monto', async () => {
    route.detalle = () => ok(detalle({ descripcion: 'x'.repeat(MAX_DESCRIPCION + 1) }));
    await mount(EDITAR);
    await typeText(monto(), '');
    await guardar();
    expect(enfocado()).toBe('gasto-monto');
  });

  it('varias: una nota demasiado larga escrita en el pliegue: el error se ve en SU nota, el foco va a ella y el pliegue sigue desplegado', async () => {
    await mount();
    await llenarPeajesYLavado();
    await abrirNotaYViaje();
    await typeText(nota(LAVADO_ID), 'x'.repeat(MAX_DESCRIPCION + 1));
    await guardar('Guardar 2 gastos');
    expect(inserts()).toHaveLength(0);
    expect(byId(`gasto-descripcion-${LAVADO_ID}-error`)!.textContent).not.toBe('');
    expect(byId(`gasto-descripcion-${PEAJES_ID}-error`)!.textContent).toBe('');
    expect(enfocado()).toBe(`gasto-descripcion-${LAVADO_ID}`);
    expect(botonPliegue()).toBeNull();
  });

  it('varias: dos notas largas: el foco va a la primera (en el orden de los bloques)', async () => {
    await mount();
    await llenarPeajesYLavado();
    await abrirNotaYViaje();
    await typeText(nota(PEAJES_ID), 'x'.repeat(MAX_DESCRIPCION + 1));
    await typeText(nota(LAVADO_ID), 'x'.repeat(MAX_DESCRIPCION + 1));
    await guardar('Guardar 2 gastos');
    expect(enfocado()).toBe(`gasto-descripcion-${LAVADO_ID}`);
  });

  it('varias: un error en una nota y otro en el monto de un bloque: el foco va al monto', async () => {
    await mount();
    await llenarPeajesYLavado();
    await abrirNotaYViaje();
    await typeText(nota(PEAJES_ID), 'x'.repeat(MAX_DESCRIPCION + 1));
    await typeText(monto(LAVADO_ID), '');
    await guardar('Guardar 2 gastos');
    expect(enfocado()).toBe(`gasto-monto-${LAVADO_ID}`);
  });

  it('un error de otro campo (el monto) NO desplega el pliegue: sigue plegado', async () => {
    await mount();
    await marcar(PEAJES_ID);
    await elegirMetodo('efectivo');
    await guardar();
    expect(byId('gasto-monto-error')!.textContent).not.toBe('');
    expect(textoDelBoton(botonPliegue())).toBe('Agregar nota o viaje');
    expect(nota()).toBeNull();
  });

  it('un error de la fecha (campo plegado aparte) tampoco desplega el pliegue de nota y viaje', async () => {
    await mount();
    await llenarPeajes();
    ponerHoy('2026-11-24');
    await guardar();
    expect(byId('gasto-fecha-error')!.textContent).not.toBe('');
    expect(enfocado()).toBe('gasto-fecha');
    expect(textoDelBoton(botonPliegue())).toBe('Agregar nota o viaje');
  });

  it('corregir el error de la nota la deja desplegada', async () => {
    route.detalle = () => ok(detalle({ descripcion: 'x'.repeat(MAX_DESCRIPCION + 1) }));
    await mount(EDITAR);
    await guardar();
    await typeText(nota(), '');
    expect(byId('gasto-descripcion-error')!.textContent).toBe('');
    expect(botonPliegue()).toBeNull();
    expect(nota()).not.toBeNull();
    await guardar();
    expect(cambiosDe(updatesGasto()[0]!).descripcion).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// (f) «¿En qué gastaste?» en Gastos varios
// ---------------------------------------------------------------------------
describe('Gastos varios: «¿En qué gastaste?» es obligatoria y está SIEMPRE a la vista', () => {
  it('con solo Gastos varios marcado: la pregunta está a la vista sin tocar nada, sin «(opcional)», con la ayuda nueva y aria-required', async () => {
    await mount();
    await marcar(GASTOS_VARIOS_CATEGORIA_ID);
    const etiqueta = document.querySelector('label[for="gasto-descripcion"]')!;
    expect(etiqueta.textContent).toBe('¿En qué gastaste?');
    expect(etiqueta.textContent).not.toContain('opcional');
    expect(bodyText()).toContain('Es obligatorio: cuéntanos de qué se trata.');
    expect(bodyText()).not.toContain('Obligatoria en Gastos varios');
    expect(nota()!.getAttribute('aria-required')).toBe('true');
    expect(nota()!.getAttribute('aria-describedby')).toContain('gasto-descripcion-hint');
    expect(byId('gasto-descripcion-hint')!.textContent).toBe('Es obligatorio: cuéntanos de qué se trata.');
  });

  it('está justo debajo de la categoría, antes del monto, y fuera del pliegue', async () => {
    await mount();
    await marcar(GASTOS_VARIOS_CATEGORIA_ID);
    expect(antes(byId('gasto-categoria-0')!.closest('fieldset')!, nota()!)).toBe(true);
    expect(antes(nota()!, monto()!)).toBe(true);
    expect(byId('gasto-pliegue')!.contains(nota())).toBe(false);
  });

  it('la validación sigue exigiéndola, con el mismo mensaje, el foco en ella y nada se manda', async () => {
    await mount();
    await marcar(GASTOS_VARIOS_CATEGORIA_ID);
    await typeText(monto(), '500');
    await elegirMetodo('efectivo');
    await guardar();
    expect(inserts()).toHaveLength(0);
    expect(byId('gasto-descripcion-error')!.textContent).toBe(DESCRIPCION_OBLIGATORIA_MESSAGE);
    expect(DESCRIPCION_OBLIGATORIA_MESSAGE).toBe('Escribe de qué se trata este gasto.');
    expect(nota()!.getAttribute('aria-invalid')).toBe('true');
    expect(enfocado()).toBe('gasto-descripcion');
    expect(textoDelBoton(botonPliegue())).toBe('Agregar viaje'); // el error está a la vista, arriba: el pliegue sigue cerrado
  });

  it('sin descripción NI monto: el foco va a la descripción, que está arriba del monto', async () => {
    await mount();
    await marcar(GASTOS_VARIOS_CATEGORIA_ID);
    await elegirMetodo('efectivo');
    await guardar();
    expect(byId('gasto-monto-error')!.textContent).not.toBe('');
    expect(byId('gasto-descripcion-error')!.textContent).toBe(DESCRIPCION_OBLIGATORIA_MESSAGE);
    expect(enfocado()).toBe('gasto-descripcion');
  });

  it('con varias: Gastos varios sin descripción ni monto y otro bloque sin monto: el foco va a la pregunta de Gastos varios (la primera en pantalla)', async () => {
    await mount();
    await marcar(PEAJES_ID, GASTOS_VARIOS_CATEGORIA_ID);
    await guardar('Guardar 2 gastos');
    expect(byId(`gasto-monto-${PEAJES_ID}-error`)!.textContent).not.toBe('');
    expect(byId(`gasto-monto-${GASTOS_VARIOS_CATEGORIA_ID}-error`)!.textContent).not.toBe('');
    expect(enfocado()).toBe(`gasto-descripcion-${GASTOS_VARIOS_CATEGORIA_ID}`);
  });

  it('con varias: si el primer bloque (Combustible) tiene un error, va antes que la pregunta de Gastos varios', async () => {
    await mount();
    await marcar(GASTOS_VARIOS_CATEGORIA_ID, COMBUSTIBLE_CATEGORIA_ID);
    await guardar('Guardar 2 gastos');
    expect(byId(`gasto-descripcion-${GASTOS_VARIOS_CATEGORIA_ID}-error`)!.textContent).toBe(DESCRIPCION_OBLIGATORIA_MESSAGE);
    expect(enfocado()).toBe(`gasto-monto-${COMBUSTIBLE_CATEGORIA_ID}`);
  });

  it('con solo espacios sigue sin valer, y con texto se guarda (recortado)', async () => {
    await mount();
    await marcar(GASTOS_VARIOS_CATEGORIA_ID);
    await typeText(monto(), '500');
    await elegirMetodo('efectivo');
    await typeText(nota(), '    ');
    await guardar();
    expect(inserts()).toHaveLength(0);
    expect(byId('gasto-descripcion-error')!.textContent).toBe(DESCRIPCION_OBLIGATORIA_MESSAGE);
    await typeText(nota(), '  Lavado del camión  ');
    await guardar();
    expect(filaDe(inserts()[0]!).descripcion).toBe('Lavado del camión');
  });

  it('al editar un gasto de Gastos varios es lo mismo: a la vista, obligatoria y sin «(opcional)»', async () => {
    route.detalle = () => ok(detalle({ categoria_id: GASTOS_VARIOS_CATEGORIA_ID, descripcion: 'Lavado' }));
    await mount(EDITAR);
    expect(document.querySelector('label[for="gasto-descripcion"]')!.textContent).toBe('¿En qué gastaste?');
    await typeText(nota(), '');
    await guardar();
    expect(updatesGasto()).toHaveLength(0);
    expect(byId('gasto-descripcion-error')!.textContent).toBe(DESCRIPCION_OBLIGATORIA_MESSAGE);
    expect(enfocado()).toBe('gasto-descripcion');
  });

  it('con varias: el bloque de Gastos varios tiene su pregunta a la vista (con su título) y la validación la exige', async () => {
    await mount();
    await marcar(PEAJES_ID, GASTOS_VARIOS_CATEGORIA_ID);
    expect(document.querySelector(`label[for="gasto-descripcion-${GASTOS_VARIOS_CATEGORIA_ID}"]`)!.textContent).toBe('¿En qué gastaste?');
    expect(nota(GASTOS_VARIOS_CATEGORIA_ID)!.closest('[role="group"]')!.querySelector('h2')!.textContent).toBe('Gastos varios');
    expect(nota(GASTOS_VARIOS_CATEGORIA_ID)!.getAttribute('aria-required')).toBe('true');
    await typeText(monto(PEAJES_ID), '800');
    await elegirMetodo('efectivo', PEAJES_ID);
    await typeText(monto(GASTOS_VARIOS_CATEGORIA_ID), '500');
    await elegirMetodo('efectivo', GASTOS_VARIOS_CATEGORIA_ID);
    await guardar('Guardar 2 gastos');
    expect(inserts()).toHaveLength(0);
    expect(byId(`gasto-descripcion-${GASTOS_VARIOS_CATEGORIA_ID}-error`)!.textContent).toBe(DESCRIPCION_OBLIGATORIA_MESSAGE);
    expect(enfocado()).toBe(`gasto-descripcion-${GASTOS_VARIOS_CATEGORIA_ID}`);
  });

  it('la de las demás categorías sigue opcional (no se exige) y no usa la pregunta', async () => {
    await mount();
    await llenarPeajes();
    await guardar();
    expect(inserts()).toHaveLength(1);
    expect(filaDe(inserts()[0]!).descripcion).toBeNull();
    expect(bodyText()).not.toContain('¿En qué gastaste?');
  });

  it('pasar de Gastos varios a otra categoría saca la obligación (y su error); volver a Gastos varios con la descripción vacía la vuelve a exigir', async () => {
    await mount();
    await marcar(GASTOS_VARIOS_CATEGORIA_ID);
    await typeText(monto(), '500');
    await elegirMetodo('efectivo');
    await guardar();
    expect(byId('gasto-descripcion-error')!.textContent).toBe(DESCRIPCION_OBLIGATORIA_MESSAGE);
    await marcar(GASTOS_VARIOS_CATEGORIA_ID, PEAJES_ID);
    expect(bodyText()).not.toContain(DESCRIPCION_OBLIGATORIA_MESSAGE);
    expect(textoDelBoton(botonPliegue())).toBe('Agregar nota o viaje');
    await guardar();
    expect(inserts()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// (g) Varias categorías: un solo pliegue
// ---------------------------------------------------------------------------
describe('varias categorías: UN solo pliegue con una nota por categoría y el viaje compartido', () => {
  it('un solo botón y una sola región; desplegado, una nota por categoría común y UN viaje (nada duplicado)', async () => {
    await mount();
    await marcar(PEAJES_ID, LAVADO_ID, GASTOS_VARIOS_CATEGORIA_ID);
    expect(buttons().filter((b) => b.getAttribute('aria-controls') === 'gasto-pliegue')).toHaveLength(1);
    expect(document.querySelectorAll('#gasto-pliegue')).toHaveLength(1);
    await abrirNotaYViaje();
    const region = byId('gasto-pliegue')!;
    expect(region.querySelectorAll('textarea')).toHaveLength(2);
    expect(region.querySelectorAll('select')).toHaveLength(1);
    expect(document.querySelectorAll('select#gasto-viaje')).toHaveLength(1);
    expect(document.querySelectorAll('textarea')).toHaveLength(3); // las dos notas y «¿En qué gastaste?» (arriba, fuera del pliegue)
    expect(region.contains(nota(GASTOS_VARIOS_CATEGORIA_ID))).toBe(false);
  });

  it('cada nota lleva el nombre de SU categoría tal como se ve en el título del bloque, y «(opcional)»', async () => {
    await mount();
    await marcar(PEAJES_ID, LAVADO_ID, COMBUSTIBLE_CATEGORIA_ID);
    await abrirNotaYViaje();
    const titulos = [...document.querySelectorAll('form h2')].map((t) => t.textContent);
    for (const nombre of ['Combustible', 'Lavado', 'Peajes']) {
      expect(titulos).toContain(nombre);
    }
    const etiquetas = [...byId('gasto-pliegue')!.querySelectorAll('label')].map((l) => l.textContent);
    expect(etiquetas).toEqual(['Nota de Combustible (opcional)', 'Nota de Lavado (opcional)', 'Nota de Peajes (opcional)', 'Viaje (opcional)']);
  });

  it('las notas van en el orden de los bloques, no en el de los toques', async () => {
    await mount();
    await marcar(PEAJES_ID, COMBUSTIBLE_CATEGORIA_ID, LAVADO_ID);
    await abrirNotaYViaje();
    const ids = [...byId('gasto-pliegue')!.querySelectorAll('textarea')].map((t) => t.id);
    expect(ids).toEqual([`gasto-descripcion-${COMBUSTIBLE_CATEGORIA_ID}`, `gasto-descripcion-${LAVADO_ID}`, `gasto-descripcion-${PEAJES_ID}`]);
  });

  it('ningún id se repite en toda la pantalla (ni plegada ni desplegada, con y sin Gastos varios)', async () => {
    const repetidos = () => {
      const ids = [...document.querySelectorAll('[id]')].map((el) => el.id);
      return ids.filter((id, i) => ids.indexOf(id) !== i);
    };
    await mount();
    await marcar(PEAJES_ID, LAVADO_ID, GASTOS_VARIOS_CATEGORIA_ID, COMBUSTIBLE_CATEGORIA_ID);
    expect(repetidos()).toEqual([]);
    await abrirNotaYViaje();
    expect(repetidos()).toEqual([]);
  });

  it('los aria-describedby de cada nota son los de SU nota (su ayuda y su error) y apuntan a elementos que existen', async () => {
    await mount();
    await llenarPeajesYLavado();
    await abrirNotaYViaje();
    for (const id of [PEAJES_ID, LAVADO_ID]) await typeText(nota(id), 'x'.repeat(MAX_DESCRIPCION + 1));
    await guardar('Guardar 2 gastos');
    for (const id of [PEAJES_ID, LAVADO_ID]) {
      const campo = nota(id)!;
      const referencias = (campo.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
      expect(referencias).toEqual(expect.arrayContaining([`gasto-descripcion-${id}-hint`, `gasto-descripcion-${id}-error`]));
      for (const ref of referencias) {
        expect(ref.includes(id), ref).toBe(true); // ninguna apunta a la ayuda o al error de otra nota
        expect(byId(ref), ref).not.toBeNull();
      }
    }
  });

  it('desmarcar hasta una sola categoría vuelve al pliegue de siempre: una nota («Descripción») con su id sin sufijo', async () => {
    await mount();
    await marcar(PEAJES_ID, LAVADO_ID);
    await abrirNotaYViaje();
    await marcar(LAVADO_ID);
    expect(nota()).not.toBeNull();
    expect(nota(PEAJES_ID)).toBeNull();
    expect(document.querySelector('label[for="gasto-descripcion"]')!.textContent).toBe('Descripción (opcional)');
  });

  it('el contador de largo de cada nota es de SU nota', async () => {
    await mount();
    await marcar(PEAJES_ID, LAVADO_ID);
    await abrirNotaYViaje();
    await typeText(nota(PEAJES_ID), 'x'.repeat(1850));
    expect(byId(`gasto-descripcion-${PEAJES_ID}-hint`)!.textContent).toBe('1850 de 2000 caracteres');
    expect(byId(`gasto-descripcion-${LAVADO_ID}-hint`)?.textContent ?? '').toBe('');
  });
});

// ---------------------------------------------------------------------------
// (h) Lo que se manda
// ---------------------------------------------------------------------------
describe('lo que se manda al guardar es lo mismo, con el pliegue sin abrir, abierto o desplegado de entrada', () => {
  it('sin abrir el pliegue: descripcion null y viaje_id null', async () => {
    await mount();
    await llenarPeajes();
    await guardar();
    expect(filaDe(inserts()[0]!)).toMatchObject({ categoria_id: PEAJES_ID, descripcion: null, viaje_id: null, monto: 800 });
  });

  it('abierto pero vacío: lo mismo (null y null)', async () => {
    await mount();
    await llenarPeajes();
    await abrirNotaYViaje();
    await guardar();
    expect(filaDe(inserts()[0]!)).toMatchObject({ descripcion: null, viaje_id: null });
  });

  it('abierto y completado: la nota (recortada) y el viaje elegido', async () => {
    await mount();
    await llenarPeajes();
    await abrirNotaYViaje();
    await typeText(nota(), '  Peaje de la ruta  ');
    await selectValue(selectViaje(), V_ROSARIO.id);
    await guardar();
    expect(filaDe(inserts()[0]!)).toMatchObject({ descripcion: 'Peaje de la ruta', viaje_id: V_ROSARIO.id });
  });

  it('abierto, completado y vuelto a vaciar: se manda vacío (null)', async () => {
    await mount();
    await llenarPeajes();
    await abrirNotaYViaje();
    await typeText(nota(), 'algo');
    await selectValue(selectViaje(), V_ROSARIO.id);
    await typeText(nota(), '');
    await selectValue(selectViaje(), '');
    await guardar();
    expect(filaDe(inserts()[0]!)).toMatchObject({ descripcion: null, viaje_id: null });
  });

  it('Gastos varios: la descripción a la vista y el viaje del pliegue, los dos en la fila', async () => {
    await mount();
    await marcar(GASTOS_VARIOS_CATEGORIA_ID);
    await typeText(nota(), 'Lavado');
    await typeText(monto(), '500');
    await elegirMetodo('efectivo');
    await abrirNotaYViaje();
    await selectValue(selectViaje(), V_PILAR.id);
    await guardar();
    expect(filaDe(inserts()[0]!)).toMatchObject({ categoria_id: GASTOS_VARIOS_CATEGORIA_ID, descripcion: 'Lavado', viaje_id: V_PILAR.id });
  });

  it('varias: cada gasto va con SU nota (o null) y todos con el MISMO viaje', async () => {
    await mount();
    await llenarPeajesYLavado();
    await abrirNotaYViaje();
    await typeText(nota(PEAJES_ID), 'Peaje de Rosario');
    await selectValue(selectViaje(), V_PILAR.id);
    await guardar('Guardar 2 gastos');
    const porCategoria = Object.fromEntries(filasDe(inserts()[0]!).map((fila) => [fila.categoria_id as string, fila]));
    expect(porCategoria[PEAJES_ID]).toMatchObject({ descripcion: 'Peaje de Rosario', viaje_id: V_PILAR.id });
    expect(porCategoria[LAVADO_ID]).toMatchObject({ descripcion: null, viaje_id: V_PILAR.id });
  });

  it('varias sin abrir el pliegue: todo null', async () => {
    await mount();
    await llenarPeajesYLavado();
    await guardar('Guardar 2 gastos');
    for (const fila of filasDe(inserts()[0]!)) expect(fila).toMatchObject({ descripcion: null, viaje_id: null });
  });

  it('varias con Gastos varios: su descripción (a la vista) y la nota del pliegue de la otra, cada una en su fila', async () => {
    await mount();
    await marcar(PEAJES_ID, GASTOS_VARIOS_CATEGORIA_ID);
    await typeText(nota(GASTOS_VARIOS_CATEGORIA_ID), 'Lavado del camión');
    await typeText(monto(GASTOS_VARIOS_CATEGORIA_ID), '500');
    await elegirMetodo('efectivo', GASTOS_VARIOS_CATEGORIA_ID);
    await typeText(monto(PEAJES_ID), '800');
    await elegirMetodo('efectivo', PEAJES_ID);
    await abrirNotaYViaje();
    await typeText(nota(PEAJES_ID), 'Ruta 9');
    await guardar('Guardar 2 gastos');
    const porCategoria = Object.fromEntries(filasDe(inserts()[0]!).map((fila) => [fila.categoria_id as string, fila]));
    expect(porCategoria[GASTOS_VARIOS_CATEGORIA_ID]!.descripcion).toBe('Lavado del camión');
    expect(porCategoria[PEAJES_ID]!.descripcion).toBe('Ruta 9');
  });

  it('al editar sin tocar nada: se manda lo que el gasto ya tenía (nota y viaje intactos, pliegue desplegado de entrada)', async () => {
    route.detalle = () => ok(detalle({ descripcion: 'Peaje de Rosario', viaje_id: V_ROSARIO.id, viajes: V_ROSARIO }));
    await mount(EDITAR);
    await guardar();
    expect(cambiosDe(updatesGasto()[0]!)).toMatchObject({ descripcion: 'Peaje de Rosario', viaje_id: V_ROSARIO.id });
  });

  it('al editar un gasto sin nota ni viaje sin abrir el pliegue: null y null (no se inventa nada)', async () => {
    await mount(EDITAR);
    await guardar();
    expect(cambiosDe(updatesGasto()[0]!)).toMatchObject({ descripcion: null, viaje_id: null });
  });

  it('al editar, quitar la nota y el viaje (el pliegue estaba desplegado de entrada): se mandan null explícitos', async () => {
    route.detalle = () => ok(detalle({ descripcion: 'Peaje de Rosario', viaje_id: V_ROSARIO.id, viajes: V_ROSARIO }));
    await mount(EDITAR);
    await typeText(nota(), '');
    await selectValue(selectViaje(), '');
    await guardar();
    expect(cambiosDe(updatesGasto()[0]!)).toMatchObject({ descripcion: null, viaje_id: null });
  });

  it('desde el detalle de un viaje: guardar vuelve a ese viaje con el viaje que llegó elegido', async () => {
    route.opcion = () => ok(V_PILAR);
    await mount({ pathname: '/gastos/nuevo', search: `?viaje=${V_PILAR.id}`, state: { desdeViaje: V_PILAR.id, volverViaje: '' } });
    await marcar(PEAJES_ID);
    await typeText(monto(), '800');
    await elegirMetodo('efectivo');
    await guardar();
    expect(filaDe(inserts()[0]!).viaje_id).toBe(V_PILAR.id);
    expect(byId('detalle-del-viaje')!.dataset.path).toBe(`/viajes/${V_PILAR.id}`);
  });
});
