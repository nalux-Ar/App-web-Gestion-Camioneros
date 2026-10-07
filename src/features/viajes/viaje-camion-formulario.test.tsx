import { act, useMemo, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, type InitialEntry } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// El CAMIÓN en el formulario de viaje (Etapa 5b): qué se muestra según los camiones de la cuenta, qué se manda a la base,
// el botón que avisa cuántos gastos se mueven y los errores del camión. Mock de supabase; el resto es código real.
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
import { ViajeFormPage } from '@/features/viajes/viaje-form-page';
import { camionesKeys } from '@/features/camiones/camiones-keys';
import { CAMION_ARCHIVADO_MESSAGE } from '@/features/camiones/constants';
import { CAMIONES_SIN_CARGAR_MESSAGE, CAMION_FALTA_MESSAGE } from '@/features/camiones/camion-seleccion';
import { gastosKeys } from '@/features/gastos/gastos-keys';
import { viajesKeys } from '@/features/viajes/viajes-keys';
import { queryClient } from '@/lib/query-client';

type Resp = { data: unknown; count?: unknown; error: { message: string; code: string; details?: string; hint?: string } | null; status: number };
const ok = (data: unknown): Resp => ({ data, error: null, status: 200 });
const conteo = (count: number): Resp => ({ data: null, count, error: null, status: 200 });
const fail = (code: string, message: string, status = 400): Resp => ({ data: null, error: { code, message, details: '', hint: '' }, status });
const sinRed = (): Resp => ({ data: null, error: { code: '', message: 'TypeError: Failed to fetch' }, status: 0 });

const MIEMBRO = { rol: 'admin', tema: 'dark', color_acento: '#F59E0B', transportista_id: 'tenant-a', transportistas: { nombre: 'Transportes A' } };
const VIAJE_ID = 'b0000000-0000-4000-8000-000000000001';
const NUEVO_VIAJE_ID = 'b0000000-0000-4000-8000-0000000000ff';
const id = (n: number) => `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

type Fila = { id: string; patente: string; marca: string | null; modelo: string | null; anio: number | null; activa: boolean };
const camion = (n: number, patente: string, over: Partial<Fila> = {}): Fila => ({ id: id(n), patente, marca: null, modelo: null, anio: null, activa: true, ...over });
const A = camion(1, 'AB123CD', { marca: 'Scania' });
const B = camion(2, 'ABC123');
const C = camion(3, 'CC333CC');
const D = camion(4, 'DD444DD');
const E = camion(5, 'EE555EE');
const X = camion(9, 'XY987ZW', { activa: false });

type Handler = (call: Call) => unknown;
const route: { camiones: Handler; detalle: Handler; crear: Handler; actualizar: Handler; gastosAMover: Handler } = {} as never;

const detalleViaje = (over: Record<string, unknown> = {}) => ({
  id: VIAJE_ID,
  camion_id: null,
  fecha: '2025-06-15',
  origen: 'Rosario',
  destino: 'Córdoba',
  km_inicial: null,
  km_final: null,
  km_recorridos: 640.5,
  ingreso: null,
  observaciones: null,
  entregas: [],
  ...over,
});

function resetRoutes() {
  route.camiones = () => ok([]);
  route.detalle = () => ok(detalleViaje());
  route.crear = () => ok([{ viaje_id: NUEVO_VIAJE_ID, creado: true }]);
  route.actualizar = () => ok(null);
  route.gastosAMover = () => conteo(0);
}

function installResponder() {
  h.state.responder = (call: Call) => {
    const has = (m: string) => call.ops.some((o) => o.m === m);
    if (call.target === 'miembros' && has('maybeSingle')) return ok(MIEMBRO);
    if (call.target === 'camiones') return route.camiones(call);
    if (call.target === 'clientes') return ok([]);
    if (call.target === 'rpc:crear_viaje_con_entregas') return route.crear(call);
    if (call.target === 'rpc:actualizar_viaje_con_entregas') return route.actualizar(call);
    if (call.target === 'viajes' && has('maybeSingle')) return route.detalle(call);
    if (call.target === 'gastos' && has('neq')) return route.gastosAMover(call);
    throw new Error(`pedido inesperado: ${call.target} ${call.ops.map((o) => o.m).join('.')}`);
  };
}

const callsTo = (target: string) => h.calls.filter((c) => c.target === target);
const rpcArgs = (call: Call) => call.ops.find((o) => o.m === 'rpc')!.args[0] as Record<string, unknown>;
const crearCalls = () => callsTo('rpc:crear_viaje_con_entregas');
const actualizarCalls = () => callsTo('rpc:actualizar_viaje_con_entregas');
const conteosAMover = () => callsTo('gastos').filter((c) => c.ops.some((o) => o.m === 'neq'));

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

const EDITAR = `/viajes/${VIAJE_ID}/editar`;

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
                  <Route path="/viajes/:id" element={<div id="detalle-del-viaje" />} />
                  <Route path="/viajes" element={<div id="lista-de-viajes" />} />
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
const submit = () => document.querySelector<HTMLButtonElement>('button[type="submit"]')!;
const radios = () => [...document.querySelectorAll<HTMLInputElement>('input[type="radio"][id^="viaje-camion-"]')];
const radioDe = (texto: string) => radios().find((r) => r.closest('label')?.textContent?.includes(texto));
const selectCamion = () => byId<HTMLSelectElement>('viaje-camion');
const errorCamion = () => byId('viaje-camion-error')?.textContent ?? '';

async function click(el: HTMLElement | null | undefined) {
  if (!el) throw new Error('no se encontró el elemento a tocar');
  await act(async () => {
    el.click();
  });
  await settle(5);
}
async function typeById(elementId: string, value: string) {
  const el = byId<HTMLInputElement>(elementId);
  if (!el) throw new Error(`no se encontró ${elementId}`);
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
  await settle(4);
}
async function guardar() {
  await click(submit());
  await settle(3);
}
async function llenarLoMinimo() {
  await typeById('viaje-origen', 'Rosario');
  await typeById('viaje-destino', 'Córdoba');
}

let invalidadas: unknown[][] = [];
let invalidateSpy: ReturnType<typeof vi.spyOn>;
const invalido = (key: readonly unknown[]) => invalidadas.some((k) => JSON.stringify(k) === JSON.stringify(key));
const T = 'tenant-a';

beforeEach(() => {
  h.calls.length = 0;
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
// Viaje NUEVO
// ---------------------------------------------------------------------------
describe('viaje nuevo: el camión según los camiones de la cuenta', () => {
  it('0 camiones: no se muestra nada y el viaje va SIN camión (como hoy)', async () => {
    await mount();
    expect(bodyText()).not.toContain('Camión');
    await llenarLoMinimo();
    await guardar();
    expect(rpcArgs(crearCalls()[0]!).p_camion_id).toBeNull();
  });

  it('solo archivados: igual, sin camión (un archivado no se ofrece)', async () => {
    route.camiones = () => ok([X]);
    await mount();
    expect(radios()).toHaveLength(0);
    await llenarLoMinimo();
    await guardar();
    expect(rpcArgs(crearCalls()[0]!).p_camion_id).toBeNull();
  });

  it('1 activo: no se pregunta, va ese', async () => {
    route.camiones = () => ok([A, X]);
    await mount();
    expect(radios()).toHaveLength(0);
    expect(selectCamion()).toBeNull();
    await llenarLoMinimo();
    await guardar();
    expect(rpcArgs(crearCalls()[0]!).p_camion_id).toBe(A.id);
  });

  it('AUDITORÍA: con 1 camión activo en la caché (fresca) y un 2º cargado desde otro dispositivo, el formulario vuelve a pedir la lista y pregunta (no asigna el 1º en silencio)', async () => {
    // La caché dice "1 activo" desde hace unos segundos (dentro de los 10 minutos); la base ya tiene 2.
    queryClient.setQueryData(camionesKeys.list(T), { items: [A], truncado: false });
    route.camiones = () => ok([A, B]);
    await mount();
    expect(callsTo('camiones').length).toBeGreaterThan(0); // se volvió a pedir aunque la caché estaba fresca
    expect(radios().map((r) => r.closest('label')!.textContent)).toEqual(['AB 123 CD', 'ABC 123']);
    expect(radios().some((r) => r.checked)).toBe(false);
    await llenarLoMinimo();
    await guardar();
    expect(errorCamion()).toBe(CAMION_FALTA_MESSAGE);
    expect(crearCalls()).toHaveLength(0);
  });

  it('2 activos: botones de un toque SIN preselección, entre Destino y Kilometraje', async () => {
    route.camiones = () => ok([B, A, X]);
    await mount();
    expect(radios().map((r) => r.closest('label')!.textContent)).toEqual(['AB 123 CD', 'ABC 123']);
    expect(radios().some((r) => r.checked)).toBe(false);
    const legend = document.querySelector('fieldset legend');
    expect([...document.querySelectorAll('legend')].some((l) => l.textContent?.includes('Camión'))).toBe(true);
    expect(legend).not.toBeNull();
    const destino = byId('viaje-destino')!;
    expect(destino.compareDocumentPosition(radios()[0]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('2 activos sin elegir: "Elige el camión.", foco en el primer botón, no se manda nada', async () => {
    route.camiones = () => ok([A, B]);
    await mount();
    await llenarLoMinimo();
    await guardar();
    expect(errorCamion()).toBe(CAMION_FALTA_MESSAGE);
    expect(document.activeElement).toBe(byId('viaje-camion-0'));
    expect(crearCalls()).toHaveLength(0);
    await click(radioDe('ABC 123'));
    expect(errorCamion()).toBe('');
    await guardar();
    expect(rpcArgs(crearCalls()[0]!).p_camion_id).toBe(B.id);
  });

  it('5 activos: lista desplegable "Elige el camión" (con marca), sin preselección', async () => {
    route.camiones = () => ok([A, B, C, D, E]);
    await mount();
    const select = selectCamion()!;
    expect(select).not.toBeNull();
    expect(select.value).toBe('');
    const textos = [...select.options].map((o) => o.textContent);
    expect(textos[0]).toBe('Elige el camión');
    expect(textos).toContain('AB 123 CD · Scania');
    await llenarLoMinimo();
    await guardar();
    expect(errorCamion()).toBe(CAMION_FALTA_MESSAGE);
    expect(document.activeElement).toBe(select);
    await selectValue(select, D.id);
    await guardar();
    expect(rpcArgs(crearCalls()[0]!).p_camion_id).toBe(D.id);
  });

  it('si la lista de camiones no carga: error con "Reintentar" y el viaje NO se guarda ("Falta cargar tus camiones")', async () => {
    route.camiones = () => sinRed();
    await mount();
    expect(bodyText()).toContain('No pudimos cargar tus camiones.');
    await llenarLoMinimo();
    await guardar();
    expect(errorCamion()).toBe(CAMIONES_SIN_CARGAR_MESSAGE);
    expect(document.activeElement).toBe(byId('viaje-camion-bloque'));
    expect(crearCalls()).toHaveLength(0);
    route.camiones = () => ok([A]);
    await click(buttonByText('Reintentar'));
    expect(bodyText()).not.toContain('No pudimos cargar tus camiones.');
    await guardar();
    expect(rpcArgs(crearCalls()[0]!).p_camion_id).toBe(A.id);
  });

  it('CORRECCIÓN de crearViaje: reintento con datos cambiados que ya estaba guardado -> el UPDATE lleva el camión (antes iba null)', async () => {
    route.camiones = () => ok([A, B]);
    let intento = 0;
    route.crear = () => {
      intento += 1;
      return intento === 1 ? sinRed() : ok([{ viaje_id: NUEVO_VIAJE_ID, creado: false }]);
    };
    await mount();
    await llenarLoMinimo();
    await click(radioDe('ABC 123'));
    await guardar();
    expect(bodyText()).toContain('No hay conexión');
    await typeById('viaje-destino', 'Mendoza'); // cambia algo entre intentos
    await guardar();
    expect(crearCalls()).toHaveLength(2);
    expect(actualizarCalls()).toHaveLength(1);
    expect(rpcArgs(actualizarCalls()[0]!)).toMatchObject({ p_viaje_id: NUEVO_VIAJE_ID, p_destino: 'Mendoza', p_camion_id: B.id });
  });

  it('55000 (el camión se archivó mientras tanto): mensaje propio, sin "Reintentar", y se refresca la lista de camiones', async () => {
    route.camiones = () => ok([A]);
    route.crear = () => fail('55000', 'El camión está archivado (camion_archivado)');
    await mount();
    await llenarLoMinimo();
    await guardar();
    expect(bodyText()).toContain(CAMION_ARCHIVADO_MESSAGE);
    expect(bodyText()).not.toContain('camion_archivado');
    expect(buttonByText('Reintentar')).toBeUndefined();
    expect(invalido(camionesKeys.list(T))).toBe(true);
  });

  it('23503 viajes_camion_fk (el camión ya no existe): "El camión elegido ya no existe." y se refresca la lista de camiones', async () => {
    route.camiones = () => ok([A]);
    route.crear = () => fail('23503', 'insert or update on table "viajes" violates foreign key constraint "viajes_camion_fk"', 409);
    await mount();
    await llenarLoMinimo();
    await guardar();
    expect(bodyText()).toContain('El camión elegido ya no existe. Elige otro.');
    expect(buttonByText('Reintentar')).toBeUndefined();
    expect(invalido(camionesKeys.list(T))).toBe(true);
  });

  it('otro error (de red) no refresca la lista de camiones', async () => {
    route.camiones = () => ok([A]);
    route.crear = () => sinRed();
    await mount();
    await llenarLoMinimo();
    await guardar();
    expect(invalido(camionesKeys.list(T))).toBe(false);
    expect(invalido(viajesKeys.lists(T))).toBe(true);
  });

  it('un viaje nuevo nunca cuenta gastos a mover', async () => {
    route.camiones = () => ok([A, B]);
    await mount();
    await llenarLoMinimo();
    await click(radioDe('AB 123 CD'));
    expect(submit().textContent).toBe('Guardar viaje');
    expect(conteosAMover()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// EDITAR un viaje
// ---------------------------------------------------------------------------
describe('editar un viaje: el camión que tenía', () => {
  it('con su camión activo y otro más: preseleccionado; guardar sin tocar manda el mismo, sin contar gastos', async () => {
    route.camiones = () => ok([A, B]);
    route.detalle = () => ok(detalleViaje({ camion_id: B.id }));
    await mount(EDITAR);
    expect(radioDe('ABC 123')!.checked).toBe(true);
    expect(submit().textContent).toBe('Guardar viaje');
    await guardar();
    expect(conteosAMover()).toHaveLength(0);
    expect(rpcArgs(actualizarCalls()[0]!).p_camion_id).toBe(B.id);
  });

  it('su camión está ARCHIVADO: se conserva (primero, "(archivado)", elegido); nunca se reasigna en silencio', async () => {
    route.camiones = () => ok([A, X]);
    route.detalle = () => ok(detalleViaje({ camion_id: X.id }));
    await mount(EDITAR);
    expect(radios().map((r) => r.closest('label')!.textContent)).toEqual(['XY 987 ZW (archivado)', 'AB 123 CD']);
    expect(radioDe('XY 987 ZW')!.checked).toBe(true);
    await guardar();
    expect(rpcArgs(actualizarCalls()[0]!).p_camion_id).toBe(X.id);
  });

  it('su camión archivado y 0 activos: igual se muestra y se conserva', async () => {
    route.camiones = () => ok([X]);
    route.detalle = () => ok(detalleViaje({ camion_id: X.id }));
    await mount(EDITAR);
    expect(radios()).toHaveLength(1);
    await guardar();
    expect(rpcArgs(actualizarCalls()[0]!).p_camion_id).toBe(X.id);
  });

  it('un viaje viejo SIN camión y 0 camiones: sigue sin camión', async () => {
    await mount(EDITAR);
    await guardar();
    expect(rpcArgs(actualizarCalls()[0]!).p_camion_id).toBeNull();
    expect(conteosAMover()).toHaveLength(0);
  });

  it('un viaje viejo SIN camión y 1 activo: se le asigna (cuenta los gastos a mover y lo dice si hay)', async () => {
    route.camiones = () => ok([A]);
    route.gastosAMover = () => conteo(2);
    await mount(EDITAR);
    expect(submit().textContent).toBe('Guardar y pasar 2 gastos al camión AB 123 CD');
    await guardar();
    expect(rpcArgs(actualizarCalls()[0]!).p_camion_id).toBe(A.id);
  });

  it('un viaje viejo SIN camión y 2 activos: hay que elegir', async () => {
    route.camiones = () => ok([A, B]);
    await mount(EDITAR);
    await guardar();
    expect(errorCamion()).toBe(CAMION_FALTA_MESSAGE);
    expect(actualizarCalls()).toHaveLength(0);
  });
});

describe('editar un viaje: cambiar de camión con gastos ("Guardar y pasar N gastos")', () => {
  it('cuenta FRESCO los gastos del viaje con OTRO camión y el botón lo dice; al guardar manda el camión nuevo', async () => {
    route.camiones = () => ok([A, B]);
    route.detalle = () => ok(detalleViaje({ camion_id: A.id }));
    route.gastosAMover = () => conteo(3);
    await mount(EDITAR);
    expect(conteosAMover()).toHaveLength(0);
    await click(radioDe('ABC 123'));
    const conteoCall = conteosAMover()[0]!;
    expect(conteoCall.ops.find((o) => o.m === 'select')!.args).toEqual(['id', { count: 'exact', head: true }]);
    expect(conteoCall.ops.find((o) => o.m === 'eq')!.args).toEqual(['viaje_id', VIAJE_ID]);
    expect(conteoCall.ops.find((o) => o.m === 'neq')!.args).toEqual(['camion_id', B.id]);
    expect(submit().textContent).toBe('Guardar y pasar 3 gastos al camión ABC 123');
    expect(bodyText()).toContain('Este viaje tiene 3 gastos con otro camión: al guardar pasan al camión ABC 123. No queda registro del camión anterior.');
    await guardar();
    expect(rpcArgs(actualizarCalls()[0]!).p_camion_id).toBe(B.id);
    // La base movió los gastos: las listas de gastos quedaron viejas.
    expect(invalido(gastosKeys.all(T))).toBe(true);
  });

  it('1 gasto: singular', async () => {
    route.camiones = () => ok([A, B]);
    route.detalle = () => ok(detalleViaje({ camion_id: A.id }));
    route.gastosAMover = () => conteo(1);
    await mount(EDITAR);
    await click(radioDe('ABC 123'));
    expect(submit().textContent).toBe('Guardar y pasar 1 gasto al camión ABC 123');
  });

  it('0 gastos a mover: "Guardar viaje" sin aviso', async () => {
    route.camiones = () => ok([A, B]);
    route.detalle = () => ok(detalleViaje({ camion_id: A.id }));
    await mount(EDITAR);
    await click(radioDe('ABC 123'));
    expect(conteosAMover()).toHaveLength(1);
    expect(submit().textContent).toBe('Guardar viaje');
    expect(bodyText()).not.toContain('con otro camión');
  });

  it('volver al camión que tenía: ya no se avisa nada', async () => {
    route.camiones = () => ok([A, B]);
    route.detalle = () => ok(detalleViaje({ camion_id: A.id }));
    route.gastosAMover = () => conteo(3);
    await mount(EDITAR);
    await click(radioDe('ABC 123'));
    await click(radioDe('AB 123 CD'));
    expect(submit().textContent).toBe('Guardar viaje');
    expect(bodyText()).not.toContain('con otro camión');
  });

  it('mientras cuenta, el botón espera ("Revisando los gastos del viaje…", deshabilitado)', async () => {
    route.camiones = () => ok([A, B]);
    route.detalle = () => ok(detalleViaje({ camion_id: A.id }));
    let soltar: (resp: Resp) => void = () => {};
    route.gastosAMover = () => new Promise<Resp>((resolve) => (soltar = resolve));
    await mount(EDITAR);
    await click(radioDe('ABC 123'));
    expect(submit().textContent).toBe('Revisando los gastos del viaje…');
    expect(submit().disabled).toBe(true);
    await act(async () => soltar(conteo(2)));
    await settle(4);
    expect(submit().textContent).toBe('Guardar y pasar 2 gastos al camión ABC 123');
    expect(submit().disabled).toBe(false);
  });

  it('si no se pudo contar: se puede guardar, con un aviso sin números', async () => {
    route.camiones = () => ok([A, B]);
    route.detalle = () => ok(detalleViaje({ camion_id: A.id }));
    route.gastosAMover = () => sinRed();
    await mount(EDITAR);
    await click(radioDe('ABC 123'));
    expect(submit().textContent).toBe('Guardar viaje');
    expect(submit().disabled).toBe(false);
    expect(bodyText()).toContain('No pudimos revisar los gastos del viaje: si tiene gastos con otro camión, al guardar pasan al camión ABC 123.');
    await guardar();
    expect(rpcArgs(actualizarCalls()[0]!).p_camion_id).toBe(B.id);
  });

  it('el conteo no se guarda en caché: volver a elegir el mismo camión vuelve a contar', async () => {
    route.camiones = () => ok([A, B]);
    route.detalle = () => ok(detalleViaje({ camion_id: A.id }));
    route.gastosAMover = () => conteo(1);
    await mount(EDITAR);
    await click(radioDe('ABC 123'));
    await click(radioDe('AB 123 CD'));
    route.gastosAMover = () => conteo(4);
    await click(radioDe('ABC 123'));
    expect(conteosAMover()).toHaveLength(2);
    expect(submit().textContent).toBe('Guardar y pasar 4 gastos al camión ABC 123');
  });
});
