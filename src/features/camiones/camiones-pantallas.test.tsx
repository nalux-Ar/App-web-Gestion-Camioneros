import { act, useMemo, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, type InitialEntry } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock de supabase: registra cada pedido (tabla o RPC + operaciones) y responde según la ruta. TODO lo demás (pantallas,
// formulario, hooks, TanStack Query, router, validación, alta idempotente, conteos) es código REAL del proyecto.
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
import { InicioPage } from '@/features/home/inicio-page';
import { CamionesCard } from '@/features/camiones/camiones-card';
import { CamionesPage } from '@/features/camiones/camiones-page';
import { CamionFormPage } from '@/features/camiones/camion-form-page';
import { camionesKeys } from '@/features/camiones/camiones-keys';
import { PATENTE_FORMATO_AVISO } from '@/features/camiones/patente';
import { UNICO_ACTIVO_MESSAGE } from '@/features/camiones/camion-alta';
import { PATENTE_REPETIDA_MESSAGE, SOLO_ADMIN_CAMIONES_MESSAGE } from '@/features/camiones/constants';
import { gastosKeys } from '@/features/gastos/gastos-keys';
import { viajesKeys } from '@/features/viajes/viajes-keys';
import { queryClient } from '@/lib/query-client';

// ---------------------------------------------------------------------------
// "Base de datos" falsa
// ---------------------------------------------------------------------------
type Resp = { data: unknown; count?: unknown; error: { message: string; code: string; details?: string; hint?: string } | null; status: number };
const ok = (data: unknown): Resp => ({ data, error: null, status: 200 });
const conteo = (count: number): Resp => ({ data: null, count, error: null, status: 200 });
const fail = (code: string, message: string, status = 409): Resp => ({ data: null, error: { code, message, details: '', hint: '' }, status });
const sinRed = (): Resp => ({ data: null, error: { code: '', message: 'TypeError: Failed to fetch' }, status: 0 });

let ROL: 'admin' | 'chofer' = 'admin';
const miembro = () => ({ rol: ROL, tema: 'dark', color_acento: '#F59E0B', transportista_id: 'tenant-a', transportistas: { nombre: 'Transportes A' } });

const C_A = 'c0000000-0000-4000-8000-000000000001';
const C_B = 'c0000000-0000-4000-8000-000000000002';
const C_X = 'c0000000-0000-4000-8000-000000000003';
const C_NUEVO = 'c0000000-0000-4000-8000-0000000000aa';

type Fila = { id: string; patente: string; marca: string | null; modelo: string | null; anio: number | null; activa: boolean };
const A: Fila = { id: C_A, patente: 'AB123CD', marca: 'Scania', modelo: 'R450', anio: 2019, activa: true };
const B: Fila = { id: C_B, patente: 'ABC123', marca: null, modelo: null, anio: null, activa: true };
const X: Fila = { id: C_X, patente: 'XY987ZW', marca: 'Fiat', modelo: null, anio: null, activa: false };

const resultadoRpc = (over: Record<string, unknown> = {}) =>
  ok([{ camion_id: C_NUEVO, creado: true, viajes_asignados: 0, gastos_asignados: 0, activa: true, ...over }]);

type Handler = (call: Call) => unknown;
const route: {
  lista: Handler;
  detalle: Handler;
  activos: Handler;
  actualizar: Handler;
  crear: Handler;
  viajesSinCamion: Handler;
  gastosSinCamion: Handler;
} = {} as never;

let LISTA: Fila[] = [];

const eqDe = (call: Call) => call.ops.filter((o) => o.m === 'eq').map((o) => o.args);
const has = (call: Call, m: string) => call.ops.some((o) => o.m === m);

function resetRoutes() {
  LISTA = [A, B, X];
  route.lista = () => ok(LISTA);
  route.detalle = (call) => ok(LISTA.find((fila) => fila.id === eqDe(call)[0]?.[1]) ?? null);
  route.activos = () => conteo(LISTA.filter((fila) => fila.activa).length);
  route.actualizar = (call) => ok([{ id: eqDe(call)[0]?.[1] }]);
  route.crear = () => resultadoRpc();
  route.viajesSinCamion = () => conteo(6);
  route.gastosSinCamion = () => conteo(2);
}

function installResponder() {
  h.state.responder = (call: Call) => {
    if (call.target === 'miembros' && has(call, 'maybeSingle')) return ok(miembro());
    if (call.target === 'rpc:crear_camion') return route.crear(call);
    if (call.target === 'viajes') return route.viajesSinCamion(call);
    if (call.target === 'gastos') return route.gastosSinCamion(call);
    if (call.target === 'camiones') {
      if (has(call, 'update')) return route.actualizar(call);
      if (has(call, 'maybeSingle')) return route.detalle(call);
      if (eqDe(call)[0]?.[0] === 'activa') return route.activos(call);
      return route.lista(call);
    }
    throw new Error(`pedido inesperado: ${call.target} ${call.ops.map((o) => o.m).join('.')}`);
  };
}

const callsTo = (target: string) => h.calls.filter((c) => c.target === target);
const rpcs = () => callsTo('rpc:crear_camion');
const argsRpc = (i = 0) => rpcs()[i]!.ops.find((o) => o.m === 'rpc')!.args[0] as Record<string, unknown>;
const updates = () => callsTo('camiones').filter((c) => has(c, 'update'));
const payloadUpdate = (i = 0) => updates()[i]!.ops.find((o) => o.m === 'update')!.args[0] as Record<string, unknown>;
const conteosActivos = () => callsTo('camiones').filter((c) => eqDe(c)[0]?.[0] === 'activa');
const lecturasLista = () => callsTo('camiones').filter((c) => !has(c, 'update') && !has(c, 'maybeSingle') && eqDe(c).length === 0);

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

const LISTA_URL = '/camiones';
const NUEVO = '/camiones/nuevo';
const editar = (id: string) => `/camiones/${id}/editar`;

async function mount(entry: InitialEntry = LISTA_URL) {
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
                  <Route path="/" element={<InicioPage />} />
                  <Route path="/tarjeta" element={<CamionesCard />} />
                  <Route path="/camiones" element={<CamionesPage />} />
                  <Route path="/camiones/nuevo" element={<CamionFormPage modo="nuevo" />} />
                  <Route path="/camiones/:id/editar" element={<CamionFormPage modo="editar" />} />
                  <Route path="/configuracion" element={<div id="destino-configuracion" />} />
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
const h1 = () => document.querySelector('h1')?.textContent ?? '';
const buttons = () => [...document.querySelectorAll<HTMLButtonElement>('button')];
const buttonByText = (text: string) => buttons().find((b) => b.textContent?.includes(text));
const links = () => [...document.querySelectorAll<HTMLAnchorElement>('a')];
const linkByText = (text: string) => links().find((a) => a.textContent?.includes(text));
const campo = (nombre: 'patente' | 'marca' | 'modelo' | 'anio') => byId<HTMLInputElement>(`camion-${nombre}`)!;
const errorDe = (nombre: string) => byId(`camion-${nombre}-error`)?.textContent ?? '';
const hintDe = (nombre: string) => byId(`camion-${nombre}-hint`)?.textContent ?? '';
const labelDe = (nombre: string) => document.querySelector<HTMLLabelElement>(`label[for="camion-${nombre}"]`)?.textContent ?? '';
const avisoDeLista = () => [...document.querySelectorAll('[role="status"]')].map((el) => el.textContent ?? '').join(' | ');

async function click(el: HTMLElement | null | undefined) {
  if (!el) throw new Error('no se encontró el elemento a tocar');
  await act(async () => {
    el.click();
  });
  await settle(5);
}
async function tipear(el: HTMLInputElement | null, value: string) {
  if (!el) throw new Error('no se encontró el campo');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function guardar() {
  await click(buttonByText('Guardar camión'));
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
// Lista
// ---------------------------------------------------------------------------
describe('pantalla Camiones (/camiones)', () => {
  it('administrador: encabezado, volver a Configuración, activos con su descripción y enlace a la edición, "Nuevo camión"', async () => {
    await mount();
    expect(h1()).toBe('Camiones');
    expect(linkByText('Configuración')!.getAttribute('href')).toBe('/configuracion');
    expect(bodyText()).toContain('Activos (2)');
    const filaA = links().find((a) => a.getAttribute('href') === editar(C_A))!;
    expect(filaA.textContent).toContain('AB 123 CD');
    expect(filaA.textContent).toContain('Scania R450 · 2019');
    expect(links().some((a) => a.getAttribute('href') === editar(C_B) && a.textContent?.includes('ABC 123'))).toBe(true);
    const nuevos = links().filter((a) => a.textContent?.includes('Nuevo camión'));
    expect(nuevos.length).toBeGreaterThanOrEqual(1);
    expect(nuevos.every((a) => a.getAttribute('href') === NUEVO)).toBe(true);
  });

  it('los archivados van aparte, plegados (details cerrado) y dicen "(archivado)"', async () => {
    await mount();
    const details = document.querySelector('details')!;
    expect(details.open).toBe(false);
    expect(details.querySelector('summary')!.textContent).toContain('Archivados (1)');
    expect(details.textContent).toContain('XY 987 ZW');
    expect(details.textContent).toContain('(archivado)');
    // Los activos no están dentro de los archivados.
    expect(details.textContent).not.toContain('AB 123 CD');
  });

  it('sin archivados no hay sección de archivados', async () => {
    LISTA = [A];
    await mount();
    expect(document.querySelector('details')).toBeNull();
    expect(bodyText()).toContain('Activos (1)');
  });

  it('solo archivados: "Activos (0)" con su texto', async () => {
    LISTA = [X];
    await mount();
    expect(bodyText()).toContain('Activos (0)');
    expect(bodyText()).toContain('No tienes camiones activos.');
  });

  it('CHOFER: ve la lista sin acciones (ni "Nuevo camión" ni enlaces a la edición)', async () => {
    ROL = 'chofer';
    await mount();
    expect(bodyText()).toContain('AB 123 CD');
    expect(linkByText('Nuevo camión')).toBeUndefined();
    expect(links().some((a) => a.getAttribute('href')?.startsWith('/camiones/'))).toBe(false);
  });

  it('vacía: el administrador ve cómo cargar el primero; el chofer, que lo carga el administrador', async () => {
    LISTA = [];
    await mount();
    expect(bodyText()).toContain('Todavía no hay camiones cargados');
    expect(bodyText()).toContain('Carga tu camión para que cada carga de combustible quede asociada a él');
    expect(linkByText('Nuevo camión')!.getAttribute('href')).toBe(NUEVO);
    await act(async () => root.unmount());
    container.remove();
    queryClient.clear();
    ROL = 'chofer';
    await mount();
    expect(bodyText()).toContain('El administrador de la cuenta todavía no cargó camiones.');
    expect(linkByText('Nuevo camión')).toBeUndefined();
  });

  it('el aviso que llega al volver de guardar dice cuántos registros se asignaron; se puede cerrar', async () => {
    await mount({ pathname: LISTA_URL, state: { aviso: 'camion-guardado', viajesAsignados: 6, gastosAsignados: 2 } });
    expect(avisoDeLista()).toContain('Camión guardado. Se le asignaron 6 viajes y 2 cargas de combustible que estaban sin camión.');
    await click(document.querySelector<HTMLButtonElement>('button[aria-label="Cerrar aviso"]'));
    expect(bodyText()).not.toContain('Camión guardado');
  });

  it('un aviso que no es de la lista blanca no se muestra', async () => {
    await mount({ pathname: LISTA_URL, state: { aviso: '<img src=x onerror=alert(1)>' } });
    expect(document.querySelector('button[aria-label="Cerrar aviso"]')).toBeNull();
  });

  it('si la lista no carga: el error con "Reintentar", que la vuelve a pedir', async () => {
    route.lista = () => sinRed();
    await mount();
    expect(bodyText()).toContain('No hay conexión');
    route.lista = () => ok(LISTA);
    await click(buttonByText('Reintentar'));
    expect(bodyText()).toContain('AB 123 CD');
    expect(lecturasLista()).toHaveLength(2);
  });

  it('más de 100 camiones: avisa que se muestran los primeros 100', async () => {
    LISTA = Array.from({ length: 101 }, (_, i) => ({ ...B, id: `c0000000-0000-4000-8000-${String(i).padStart(12, '0')}`, patente: `P${String(i).padStart(3, '0')}` }));
    await mount();
    expect(bodyText()).toContain('Tienes más de 100 camiones: aquí se muestran los primeros 100.');
  });
});

// ---------------------------------------------------------------------------
// Alta
// ---------------------------------------------------------------------------
describe('alta de camión: estructura y validación', () => {
  it('título, volver a Camiones, campos (patente obligatoria, el resto opcional) y "Guardar camión"', async () => {
    await mount(NUEVO);
    expect(h1()).toBe('Nuevo camión');
    expect(linkByText('Camiones')!.getAttribute('href')).toBe('/camiones');
    expect(labelDe('patente')).toBe('Patente');
    expect(labelDe('marca')).toBe('Marca (opcional)');
    expect(labelDe('modelo')).toBe('Modelo (opcional)');
    expect(labelDe('anio')).toBe('Año (opcional)');
    expect(hintDe('anio')).toBe(`Entre 1950 y ${new Date().getFullYear() + 1}.`);
    expect(campo('anio').inputMode).toBe('numeric');
    expect(campo('patente').getAttribute('autocapitalize')).toBe('characters');
    for (const nombre of ['patente', 'marca', 'modelo', 'anio'] as const) expect(campo(nombre).getAttribute('autocomplete')).toBe('off');
    expect(buttonByText('Archivar camión')).toBeUndefined(); // solo al editar
  });

  it('al abrirse (con camiones) pide solo la lista: ni conteos ni escrituras', async () => {
    await mount(NUEVO);
    expect(h.calls.filter((c) => c.target !== 'miembros').map((c) => c.target)).toEqual(['camiones']);
  });

  it('sin patente: "Escribe la patente.", foco en el campo y nada se manda', async () => {
    await mount(NUEVO);
    await guardar();
    expect(errorDe('patente')).toBe('Escribe la patente.');
    expect(document.activeElement).toBe(campo('patente'));
    expect(rpcs()).toHaveLength(0);
  });

  it('una patente de solo símbolos cuenta como vacía', async () => {
    await mount(NUEVO);
    await tipear(campo('patente'), ' - . ');
    await guardar();
    expect(errorDe('patente')).toBe('Escribe la patente.');
    expect(rpcs()).toHaveLength(0);
  });

  it('año fuera de rango o no numérico: error y foco en el año', async () => {
    await mount(NUEVO);
    await tipear(campo('patente'), 'AB123CD');
    for (const anio of ['1900', String(new Date().getFullYear() + 2), '20a9', '19']) {
      await tipear(campo('anio'), anio);
      await guardar();
      expect(errorDe('anio'), anio).toBe(`Escribe un año entre 1950 y ${new Date().getFullYear() + 1}, o déjalo vacío.`);
    }
    expect(document.activeElement).toBe(campo('anio'));
    expect(rpcs()).toHaveLength(0);
  });

  it('una marca demasiado larga no se corta en silencio: error', async () => {
    await mount(NUEVO);
    await tipear(campo('patente'), 'AB123CD');
    await tipear(campo('marca'), 'M'.repeat(101));
    await guardar();
    expect(errorDe('marca')).not.toBe('');
    expect(rpcs()).toHaveLength(0);
  });

  it('una patente que no es argentina solo AVISA (y se guarda igual)', async () => {
    await mount(NUEVO);
    await tipear(campo('patente'), 'x-1');
    expect(hintDe('patente')).toBe(PATENTE_FORMATO_AVISO);
    await tipear(campo('patente'), 'ab 123 cd');
    expect(hintDe('patente')).not.toBe(PATENTE_FORMATO_AVISO);
    await tipear(campo('patente'), 'x-1');
    await guardar();
    expect(argsRpc()).toEqual({ p_patente: 'X1' });
  });
});

describe('alta de camión: guardado con crear_camion', () => {
  it('manda la patente NORMALIZADA y lo opcional; vuelve a la lista con "Camión guardado."', async () => {
    await mount(NUEVO);
    await tipear(campo('patente'), ' ab-123 cd ');
    await tipear(campo('marca'), '  Scania ');
    await tipear(campo('anio'), '2019');
    await guardar();
    expect(rpcs()).toHaveLength(1);
    expect(argsRpc()).toEqual({ p_patente: 'AB123CD', p_marca: 'Scania', p_anio: 2019 });
    expect(h1()).toBe('Camiones');
    expect(avisoDeLista()).toContain('Camión guardado.');
    expect(avisoDeLista()).not.toContain('Se le asignaron');
  });

  it('con camiones ya cargados: NO avisa del primer camión, NO cuenta, e invalida SOLO la lista de camiones', async () => {
    await mount(NUEVO);
    expect(bodyText()).not.toContain('primer camión');
    await tipear(campo('patente'), 'AA111AA');
    await guardar();
    expect(callsTo('viajes')).toHaveLength(0);
    expect(callsTo('gastos')).toHaveLength(0);
    expect(invalido(camionesKeys.list(T))).toBe(true);
    expect(invalido(viajesKeys.lists(T))).toBe(false);
    expect(invalido(viajesKeys.vistas(T))).toBe(false);
    expect(invalido(gastosKeys.all(T))).toBe(false);
    expect(invalido(camionesKeys.all(T))).toBe(false); // ni el detalle de edición
  });

  it('PRIMER camión: antes de guardar dice cuántos viajes y cargas se le asignan (contados frescos, sin traer filas)', async () => {
    LISTA = [];
    await mount(NUEVO);
    expect(avisoDeLista()).toContain(
      'Es tu primer camión: 6 viajes y 2 cargas de combustible que cargaste sin camión van a quedar asignados a él.',
    );
    const viajes = callsTo('viajes')[0]!;
    const gastos = callsTo('gastos')[0]!;
    expect(viajes.ops.find((o) => o.m === 'select')!.args).toEqual(['id', { count: 'exact', head: true }]);
    expect(viajes.ops.find((o) => o.m === 'is')!.args).toEqual(['camion_id', null]);
    expect(gastos.ops.find((o) => o.m === 'not')!.args).toEqual(['litros', 'is', null]);
  });

  it('con solo camiones ARCHIVADOS no es el primero (crear_camion no asigna nada): ni aviso ni conteos ni invalidación de más', async () => {
    LISTA = [X];
    await mount(NUEVO);
    expect(bodyText()).not.toContain('primer camión');
    expect(callsTo('viajes')).toHaveLength(0);
    expect(callsTo('gastos')).toHaveLength(0);
    await tipear(campo('patente'), 'AA111AA');
    await guardar();
    expect(invalido(camionesKeys.list(T))).toBe(true);
    expect(invalido(viajesKeys.lists(T))).toBe(false);
    expect(invalido(gastosKeys.all(T))).toBe(false);
  });

  it('PRIMER camión con 0 registros sin camión: solo "Es tu primer camión."', async () => {
    LISTA = [];
    route.viajesSinCamion = () => conteo(0);
    route.gastosSinCamion = () => conteo(0);
    await mount(NUEVO);
    expect(avisoDeLista()).toContain('Es tu primer camión.');
    expect(avisoDeLista()).not.toContain('van a quedar asignados');
  });

  it('PRIMER camión y el conteo falla: el aviso va igual, sin números, y se puede guardar', async () => {
    LISTA = [];
    route.viajesSinCamion = () => sinRed();
    await mount(NUEVO);
    expect(avisoDeLista()).toContain('van a quedar asignados a él');
    expect(avisoDeLista()).not.toMatch(/\d/);
    await tipear(campo('patente'), 'AB123CD');
    await guardar();
    expect(rpcs()).toHaveLength(1);
  });

  it('PRIMER camión: al volver, la lista dice lo que la base asignó; se invalidan viajes, vistas y gastos', async () => {
    LISTA = [];
    route.crear = () => resultadoRpc({ viajes_asignados: 6, gastos_asignados: 1 });
    await mount(NUEVO);
    await tipear(campo('patente'), 'AB123CD');
    await guardar();
    expect(avisoDeLista()).toContain('Camión guardado. Se le asignaron 6 viajes y 1 carga de combustible que estaban sin camión.');
    for (const key of [camionesKeys.list(T), viajesKeys.lists(T), viajesKeys.vistas(T), gastosKeys.all(T)]) {
      expect(invalido(key), JSON.stringify(key)).toBe(true);
    }
  });

  it('PRIMER camión con la respuesta perdida: el reintento devuelve "ya existía" y se invalida igual todo (era el primero)', async () => {
    LISTA = [];
    let intento = 0;
    route.crear = () => {
      intento += 1;
      return intento === 1 ? sinRed() : resultadoRpc({ creado: false, activa: true });
    };
    await mount(NUEVO);
    await tipear(campo('patente'), 'AB123CD');
    await guardar();
    expect(bodyText()).toContain('No hay conexión');
    await click(buttonByText('Reintentar'));
    expect(h1()).toBe('Camiones');
    expect(invalido(viajesKeys.lists(T))).toBe(true);
    expect(invalido(gastosKeys.all(T))).toBe(true);
  });

  it('REINTENTO tras un error de red con lo MISMO: la 2ª vez la base dice "ya existía" (era el nuestro o uno viejo): éxito y NO se escribe nada (no se pisan sus datos)', async () => {
    let intento = 0;
    route.crear = () => {
      intento += 1;
      return intento === 1 ? sinRed() : resultadoRpc({ camion_id: C_NUEVO, creado: false, activa: true });
    };
    await mount(NUEVO);
    await tipear(campo('patente'), 'AA111AA');
    await tipear(campo('modelo'), 'R450');
    await guardar();
    expect(bodyText()).toContain('No hay conexión');
    // Lo tipeado no se borra.
    expect(campo('patente').value).toBe('AA111AA');
    await click(buttonByText('Reintentar'));
    expect(rpcs()).toHaveLength(2);
    expect(argsRpc(1)).toEqual(argsRpc(0));
    // Con lo mismo que se mandó en el intento perdido no hay nada que actualizar: si el camión era uno que ya existía con
    // esa patente, un UPDATE le pisaría su marca, modelo y año (auditoría de la Etapa 5b).
    expect(updates()).toHaveLength(0);
    expect(avisoDeLista()).toContain('Camión guardado.');
  });

  it('REINTENTO tras un error de red con la marca o el modelo CAMBIADOS: se deja con lo de la pantalla (UPDATE por el id que devolvió la RPC)', async () => {
    let intento = 0;
    route.crear = () => {
      intento += 1;
      return intento === 1 ? sinRed() : resultadoRpc({ camion_id: C_NUEVO, creado: false, activa: true });
    };
    await mount(NUEVO);
    await tipear(campo('patente'), 'AA111AA');
    await tipear(campo('modelo'), 'R450');
    await guardar();
    expect(bodyText()).toContain('No hay conexión');
    await tipear(campo('modelo'), 'R500'); // la persona corrige el modelo antes de reintentar
    await click(buttonByText('Reintentar'));
    expect(rpcs()).toHaveLength(2);
    expect(updates()).toHaveLength(1);
    expect(payloadUpdate()).toEqual({ patente: 'AA111AA', marca: null, modelo: 'R500', anio: null });
    expect(updates()[0]!.ops.find((o) => o.m === 'eq')!.args).toEqual(['id', C_NUEVO]);
    expect(avisoDeLista()).toContain('Camión guardado.');
  });

  it('patente REPETIDA (activa): "Ya tienes un camión con esa patente", con enlace a ese camión; no navega ni toca nada', async () => {
    route.crear = () => resultadoRpc({ camion_id: C_A, creado: false, activa: true });
    await mount(NUEVO);
    await tipear(campo('patente'), 'ab123cd');
    await guardar();
    expect(h1()).toBe('Nuevo camión');
    expect(bodyText()).toContain('Ya tienes un camión con esa patente (AB 123 CD).');
    expect(linkByText('Ver ese camión')!.getAttribute('href')).toBe(editar(C_A));
    expect(updates()).toHaveLength(0);
    expect(buttonByText('Guardar camión')!.disabled).toBe(false);
    expect(document.activeElement).toBe(campo('patente'));
    // Cambiar la patente descarta el aviso.
    await tipear(campo('patente'), 'ab123ce');
    expect(bodyText()).not.toContain('Ya tienes un camión con esa patente');
  });

  it('patente REPETIDA (archivada): ofrece reactivarlo; reactivar es un UPDATE de activa, sin contar, y vuelve a la lista', async () => {
    route.crear = () => resultadoRpc({ camion_id: C_X, creado: false, activa: false });
    await mount(NUEVO);
    await tipear(campo('patente'), 'XY987ZW');
    await guardar();
    expect(bodyText()).toContain('Ya tienes un camión con esa patente (XY 987 ZW), pero está archivado.');
    await click(buttonByText('Reactivarlo'));
    expect(payloadUpdate()).toEqual({ activa: true });
    expect(updates()[0]!.ops.find((o) => o.m === 'eq')!.args).toEqual(['id', C_X]);
    expect(conteosActivos()).toHaveLength(0);
    expect(avisoDeLista()).toContain('Camión reactivado.');
    expect(invalido(camionesKeys.list(T))).toBe(true);
  });

  it('42501 (la base dice que no es administrador): mensaje propio y sin "Reintentar"', async () => {
    route.crear = () => fail('42501', 'Solo el administrador puede crear camiones', 403);
    await mount(NUEVO);
    await tipear(campo('patente'), 'AB123CD');
    await guardar();
    expect(bodyText()).toContain(SOLO_ADMIN_CAMIONES_MESSAGE);
    expect(buttonByText('Reintentar')).toBeUndefined();
  });

  it('un doble toque no manda dos veces', async () => {
    await mount(NUEVO);
    await tipear(campo('patente'), 'AB123CD');
    const boton = buttonByText('Guardar camión')!;
    await act(async () => {
      boton.click();
      boton.click();
    });
    await settle(6);
    expect(rpcs()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Rol
// ---------------------------------------------------------------------------
describe('rol: el chofer no escribe camiones', () => {
  it('alta por la URL: se le explica, sin formulario y sin pedir camiones', async () => {
    ROL = 'chofer';
    await mount(NUEVO);
    expect(bodyText()).toContain(SOLO_ADMIN_CAMIONES_MESSAGE);
    expect(byId('camion-patente')).toBeNull();
    expect(callsTo('camiones')).toHaveLength(0);
  });

  it('edición por la URL: igual, sin leer el camión', async () => {
    ROL = 'chofer';
    await mount(editar(C_A));
    expect(bodyText()).toContain(SOLO_ADMIN_CAMIONES_MESSAGE);
    expect(byId('camion-patente')).toBeNull();
    expect(callsTo('camiones')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Edición
// ---------------------------------------------------------------------------
describe('edición de camión', () => {
  it('id que no es uuid: "Camión no encontrado" sin pedir nada', async () => {
    await mount('/camiones/no-es-un-id/editar');
    expect(bodyText()).toContain('Camión no encontrado');
    expect(callsTo('camiones')).toHaveLength(0);
  });

  it('un camión que no existe (o es de otro): "Camión no encontrado"', async () => {
    await mount(editar('c0000000-0000-4000-8000-0000000000ff'));
    expect(bodyText()).toContain('Camión no encontrado');
    expect(linkByText('Volver a Camiones')!.getAttribute('href')).toBe('/camiones');
  });

  it('abre con los datos del camión', async () => {
    await mount(editar(C_A));
    expect(h1()).toBe('Editar camión');
    expect(campo('patente').value).toBe('AB123CD');
    expect(campo('marca').value).toBe('Scania');
    expect(campo('modelo').value).toBe('R450');
    expect(campo('anio').value).toBe('2019');
    const detalle = callsTo('camiones').find((c) => has(c, 'maybeSingle'))!;
    expect(eqDe(detalle)[0]).toEqual(['id', C_A]);
  });

  it('guardar: UPDATE con la patente normalizada y las 4 columnas (vaciar = null), nunca id, tenant ni activa', async () => {
    await mount(editar(C_A));
    await tipear(campo('patente'), 'ab 123-ce');
    await tipear(campo('marca'), '');
    await guardar();
    expect(rpcs()).toHaveLength(0);
    expect(payloadUpdate()).toEqual({ patente: 'AB123CE', marca: null, modelo: 'R450', anio: 2019 });
    expect(updates()[0]!.ops.find((o) => o.m === 'eq')!.args).toEqual(['id', C_A]);
    expect(avisoDeLista()).toContain('Camión guardado.');
    expect(invalido(camionesKeys.list(T))).toBe(true);
    expect(invalido(viajesKeys.lists(T))).toBe(false);
    expect(invalido(gastosKeys.all(T))).toBe(false);
  });

  it('23505 (otra patente igual): "Ya tienes un camión con esa patente." sin "Reintentar"', async () => {
    route.actualizar = () => fail('23505', 'duplicate key value violates unique constraint "camiones_transportista_patente_key"');
    await mount(editar(C_A));
    await tipear(campo('patente'), 'ABC123');
    await guardar();
    expect(bodyText()).toContain(PATENTE_REPETIDA_MESSAGE);
    expect(buttonByText('Reintentar')).toBeUndefined();
    expect(h1()).toBe('Editar camión');
  });

  it('23514 de la patente: mensaje propio (sin el nombre del constraint)', async () => {
    route.actualizar = () => fail('23514', 'new row violates check constraint "camiones_patente_normalizada_chk"', 400);
    await mount(editar(C_A));
    await guardar();
    expect(bodyText()).toContain('Revisa la patente: solo puede tener letras y números.');
    expect(bodyText()).not.toContain('camiones_patente_normalizada_chk');
  });

  it('0 filas al guardar (lo borraron, o ya no es administrador): "Camión no encontrado"', async () => {
    route.actualizar = () => ok([]);
    await mount(editar(C_A));
    await guardar();
    expect(bodyText()).toContain('Camión no encontrado');
  });
});

describe('archivar y reactivar', () => {
  it('con otro activo: "Archivar camión" pide confirmar (foco en Cancelar); "Sí, archivar" cuenta fresco y archiva', async () => {
    await mount(editar(C_A));
    await click(buttonByText('Archivar camión'));
    expect(bodyText()).toContain('Un camión archivado ya no se puede elegir en viajes ni cargas nuevas.');
    expect(document.activeElement?.textContent).toBe('Cancelar');
    expect(updates()).toHaveLength(0);
    await click(buttonByText('Sí, archivar'));
    expect(conteosActivos()).toHaveLength(1);
    expect(conteosActivos()[0]!.ops.find((o) => o.m === 'select')!.args).toEqual(['id', { count: 'exact', head: true }]);
    expect(payloadUpdate()).toEqual({ activa: false });
    expect(updates()[0]!.ops.find((o) => o.m === 'eq')!.args).toEqual(['id', C_A]);
    expect(avisoDeLista()).toContain('Camión archivado.');
    expect(invalido(camionesKeys.list(T))).toBe(true);
  });

  it('"Cancelar" vuelve atrás sin escribir', async () => {
    await mount(editar(C_A));
    await click(buttonByText('Archivar camión'));
    await click(buttonByText('Cancelar'));
    expect(buttonByText('Archivar camión')).toBeDefined();
    expect(updates()).toHaveLength(0);
    expect(conteosActivos()).toHaveLength(0);
  });

  it('el ÚNICO activo no ofrece archivar: explica que primero se carga el que lo reemplaza', async () => {
    LISTA = [A, X];
    await mount(editar(C_A));
    expect(bodyText()).toContain(UNICO_ACTIVO_MESSAGE);
    expect(buttonByText('Archivar camión')).toBeUndefined();
  });

  it('la lista decía 2 activos pero el conteo FRESCO dice 1: no se archiva, mensaje sin "Reintentar"', async () => {
    route.activos = () => conteo(1);
    await mount(editar(C_A));
    await click(buttonByText('Archivar camión'));
    await click(buttonByText('Sí, archivar'));
    expect(updates()).toHaveLength(0);
    expect(bodyText()).toContain(UNICO_ACTIVO_MESSAGE);
    expect(buttonByText('Sí, archivar')).toBeUndefined();
    expect(buttonByText('Reintentar')).toBeUndefined();
    expect(h1()).toBe('Editar camión');
  });

  it('si el conteo falla por red: no se archiva a ciegas; "Reintentar" lo vuelve a contar', async () => {
    route.activos = () => sinRed();
    await mount(editar(C_A));
    await click(buttonByText('Archivar camión'));
    await click(buttonByText('Sí, archivar'));
    expect(updates()).toHaveLength(0);
    expect(bodyText()).toContain('No hay conexión');
    route.activos = () => conteo(2);
    await click(buttonByText('Reintentar'));
    expect(payloadUpdate()).toEqual({ activa: false });
  });

  it('un camión archivado: "Reactivar camión" (sin contar) y vuelve con "Camión reactivado."', async () => {
    await mount(editar(C_X));
    expect(bodyText()).toContain('Este camión está archivado');
    expect(buttonByText('Archivar camión')).toBeUndefined();
    await click(buttonByText('Reactivar camión'));
    expect(payloadUpdate()).toEqual({ activa: true });
    expect(conteosActivos()).toHaveLength(0);
    expect(avisoDeLista()).toContain('Camión reactivado.');
  });
});

// ---------------------------------------------------------------------------
// Tarjetas
// ---------------------------------------------------------------------------
describe('tarjeta "Carga tu camión" en Inicio', () => {
  it('administrador sin ningún camión: aparece, con el enlace al alta', async () => {
    LISTA = [];
    await mount('/');
    expect(bodyText()).toContain('Carga tu camión');
    expect(linkByText('Cargar camión')!.getAttribute('href')).toBe(NUEVO);
  });

  it('con algún camión (aunque sea archivado) no aparece', async () => {
    LISTA = [X];
    await mount('/');
    expect(bodyText()).not.toContain('Carga tu camión');
  });

  it('chofer: no aparece y ni siquiera pide los camiones', async () => {
    ROL = 'chofer';
    LISTA = [];
    await mount('/');
    expect(bodyText()).not.toContain('Carga tu camión');
    expect(callsTo('camiones')).toHaveLength(0);
  });

  it('si la lista no carga, no aparece (no se adivina)', async () => {
    route.lista = () => sinRed();
    await mount('/');
    expect(bodyText()).not.toContain('Carga tu camión');
    expect(bodyText()).toContain('¿Qué quieres hacer hoy?');
  });
});

describe('tarjeta "Camiones" de Configuración', () => {
  it.each([
    [[A, B, X], '2 camiones activos.'],
    [[A, X], '1 camión activo.'],
    [[], 'Todavía no tienes camiones activos.'],
  ])('dice cuántos activos hay (%#) y lleva a la pantalla', async (lista, texto) => {
    LISTA = lista;
    await mount('/tarjeta');
    expect(bodyText()).toContain(texto);
    expect(linkByText('Ver camiones')!.getAttribute('href')).toBe('/camiones');
  });

  it('si la lista no carga: sin número, el enlace sigue', async () => {
    route.lista = () => sinRed();
    await mount('/tarjeta');
    expect(bodyText()).not.toMatch(/activos?\./);
    expect(linkByText('Ver camiones')).toBeDefined();
  });
});
