import { readFileSync } from 'node:fs';
import { act, useMemo, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation, useNavigate, type InitialEntry } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// «Quitar gastos del viaje»: la pantalla completa. Mock de supabase (un Proxy que anota cada método encadenado) con una «base» falsa
// que se comporta como la de verdad (los gastos de un viaje, el UPDATE que los deja sin viaje y devuelve los ids que SÍ quitó, y la
// función `vincular_gastos_a_viaje` para los «Sumar» de otra pantalla); el router, TanStack Query con su configuración real, los hooks,
// el miembro y la pantalla son código REAL.
type Op = { m: string; args: unknown[] };
type Call = { target: string; ops: Op[] };

const h = vi.hoisted(() => {
  const calls: Array<{ target: string; ops: Array<{ m: string; args: unknown[] }> }> = [];
  const state = { responder: null as null | ((call: { target: string; ops: Array<{ m: string; args: unknown[] }> }) => unknown) };
  function builder(target: string, firstOp?: { m: string; args: unknown[] }): object {
    const call = { target, ops: firstOp ? [firstOp] : ([] as Array<{ m: string; args: unknown[] }>) };
    const proxy: object = new Proxy(
      {},
      {
        get(_objetivo, propiedad) {
          if (propiedad === 'then') {
            return (onF: (v: unknown) => unknown, onR: (e: unknown) => unknown) => {
              calls.push(call);
              return Promise.resolve()
                .then(() => state.responder?.(call))
                .then(onF, onR);
            };
          }
          return (...args: unknown[]) => {
            call.ops.push({ m: String(propiedad), args });
            return proxy;
          };
        },
      },
    );
    return proxy;
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
import { COMBUSTIBLE_CATEGORIA_ID, LIST_LIMIT, MAX_GASTOS_POR_VEZ } from '@/features/gastos/constants';
import { gastosKeys } from '@/features/gastos/gastos-keys';
import { QuitarGastosPage } from '@/features/gastos/quitar-gastos-page';
import { SCOPE_DE_VINCULOS, useQuitarGastosDelViaje, useVincularGastos } from '@/features/gastos/use-gasto-mutations';
import { resumenKeys } from '@/features/resumen/resumen-keys';
import { viajesKeys } from '@/features/viajes/viajes-keys';
import { limpiarErroresRecientes } from '@/lib/errores-recientes';
import { formatNumber } from '@/lib/numbers';
import { queryClient } from '@/lib/query-client';

// ---------------------------------------------------------------------------
// La «base» falsa
// ---------------------------------------------------------------------------
type Resp = { data: unknown; error: { message: string; code: string; details?: string; hint?: string } | null; status: number };
const ok = (data: unknown): Resp => ({ data, error: null, status: 200 });
const fail = (code: string, message: string, status: number): Resp => ({ data: null, error: { code, message, details: '', hint: '' }, status });
const sinRed = (): Resp => ({ data: null, error: { code: '', message: 'TypeError: Failed to fetch' }, status: 0 });
const tiempoVencido = (): Resp => ({ data: null, error: { code: '', message: 'TimeoutError: The operation was aborted due to timeout' }, status: 0 });
const SECRETO = 'relation "gastos" violates constraint secreto_interno_del_servidor';

const T = 'tenant-a';
const VIAJE = 'b0000000-0000-4000-8000-000000000001';
const OTRO_VIAJE = 'b0000000-0000-4000-8000-000000000002';
const CLIENTE = 'a0000000-0000-4000-8000-0000000000c1';
const PEAJES = '210b4f00-fdb4-499b-bf15-79ebe2aaf3c3';
const LAVADO = '210b4f00-fdb4-499b-bf15-79ebe2aaf3c4';
const G = (n: number) => `e0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const MIEMBRO = {
  rol: 'admin',
  tema: 'dark',
  color_acento: '#F59E0B',
  transportista_id: T,
  camion_activo_id: null,
  transportistas: { nombre: 'Transportes A' },
};
const CATS = [
  { id: PEAJES, nombre: 'Peajes', activa: true, transportista_id: null },
  { id: COMBUSTIBLE_CATEGORIA_ID, nombre: 'Combustible', activa: true, transportista_id: null },
  { id: LAVADO, nombre: 'Lavado', activa: true, transportista_id: null },
];

interface GastoDeLaBase {
  id: string;
  categoria_id: string;
  fecha: string;
  monto: number;
  descripcion: string | null;
  litros: number | null;
  camion_id: string | null;
  created_at: string;
  viaje_id: string | null;
}
/** Por defecto un gasto de ESTE viaje. */
const gasto = (n: number, over: Partial<GastoDeLaBase> = {}): GastoDeLaBase => ({
  id: G(n),
  categoria_id: PEAJES,
  fecha: '2026-06-15',
  monto: 1000,
  descripcion: `gasto ${n}`,
  litros: null,
  camion_id: null,
  created_at: '2026-11-01T10:00:00+00:00',
  viaje_id: VIAJE,
  ...over,
});
/** Del más nuevo al más viejo (la lista los pide por fecha descendente): G1, G2, G3 y G4. */
const gastosPorDefecto = (): GastoDeLaBase[] => [
  gasto(1, { fecha: '2026-06-16', monto: 1000, descripcion: 'peaje norte' }),
  gasto(2, { fecha: '2026-06-14', monto: 2500.5, categoria_id: COMBUSTIBLE_CATEGORIA_ID, descripcion: null }),
  gasto(3, { fecha: '2026-06-10', monto: 300, categoria_id: LAVADO, descripcion: 'lavado del acoplado' }),
  gasto(4, { fecha: '2025-01-02', monto: 50, descripcion: 'muy viejo' }),
];
/** `cantidad` gastos de este viaje con la MISMA fecha y `created_at` descendente: salen en lista en el orden de su número (`fila-001`, `fila-002`…). */
const muchos = (cantidad: number, over: Partial<GastoDeLaBase> = {}): GastoDeLaBase[] =>
  Array.from({ length: cantidad }, (_, i) =>
    gasto(i + 1, {
      fecha: '2026-06-20',
      descripcion: `fila-${String(i + 1).padStart(3, '0')}`,
      created_at: new Date(Date.UTC(2026, 10, 1, 10, 0, 0) - i * 1000).toISOString(),
      ...over,
    }),
  );
const viajeDeLaBase = (over: Record<string, unknown> = {}) => ({
  id: VIAJE,
  camion_id: null,
  fecha: '2026-06-15',
  origen: 'Rosario',
  destino: 'Córdoba',
  km_inicial: null,
  km_final: null,
  km_recorridos: null,
  ingreso: null,
  observaciones: null,
  entregas: [],
  ...over,
});

const db: { gastos: GastoDeLaBase[]; viaje: Record<string, unknown> | null } = { gastos: [], viaje: null };

type Handler = (call: Call) => unknown;
const ops = (call: Call) => call.ops.map((o) => o.m);
const eqDe = (call: Call, columna: string) => call.ops.find((o) => o.m === 'eq' && o.args[0] === columna)?.args[1];
/** La lectura de los gastos de UN viaje (`.eq('viaje_id', …)`, sin `update`). */
const esLecturaDelViaje = (call: Call) => call.target === 'gastos' && !ops(call).includes('update') && eqDe(call, 'viaje_id') !== undefined;
/** El UPDATE que deja gastos sin viaje. */
const esQuitar = (call: Call) => call.target === 'gastos' && ops(call).includes('update');
const esVincular = (call: Call) => call.target === 'rpc:vincular_gastos_a_viaje';
const argsDeQuitar = (call: Call) => ({
  ids: call.ops.find((o) => o.m === 'in')!.args[1] as string[],
  viajeId: eqDe(call, 'viaje_id') as string,
  valores: call.ops.find((o) => o.m === 'update')!.args[0] as Record<string, unknown>,
});
const argsDeVincular = (call: Call) => call.ops.find((o) => o.m === 'rpc')!.args[0] as { p_viaje_id: string; p_gasto_ids: string[] };

const fila = (g: GastoDeLaBase) => ({
  id: g.id,
  categoria_id: g.categoria_id,
  fecha: g.fecha,
  monto: g.monto,
  descripcion: g.descripcion,
  litros: g.litros,
  camion_id: g.camion_id,
  created_at: g.created_at,
});
const masNuevoPrimero = (a: GastoDeLaBase, b: GastoDeLaBase) =>
  a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0;

/** Los gastos de un viaje: fecha descendente y luego `created_at` descendente, con el `limit` que se pida (501). */
function leerGastosDelViajeDeLaBase(call: Call): Resp {
  const viajeId = eqDe(call, 'viaje_id');
  const limite = call.ops.find((o) => o.m === 'limit')!.args[0] as number;
  return ok(db.gastos.filter((g) => g.viaje_id === viajeId).sort(masNuevoPrimero).slice(0, limite).map(fila));
}

/** `update gastos set viaje_id = null where id in (…) and viaje_id = <viaje> returning id`: devuelve SOLO los que cambió. */
function quitarEnLaBase(call: Call): Resp {
  const { ids, viajeId } = argsDeQuitar(call);
  const quitados = db.gastos.filter((g) => ids.includes(g.id) && g.viaje_id === viajeId);
  for (const g of quitados) g.viaje_id = null;
  return ok(quitados.map((g) => ({ id: g.id })));
}

/** `vincular_gastos_a_viaje` (para los «Sumar» de otra pantalla): solo hace falta que mueva lo suelto al viaje. */
function vincularEnLaBase(call: Call): Resp {
  const { p_viaje_id: viajeId, p_gasto_ids: ids } = argsDeVincular(call);
  return ok(
    ids.map((gasto_id) => {
      const g = db.gastos.find((x) => x.id === gasto_id);
      if (!g) return { gasto_id, resultado: 'no_encontrado' };
      if (g.viaje_id === viajeId) return { gasto_id, resultado: 'ya_estaba' };
      if (g.viaje_id !== null) return { gasto_id, resultado: 'en_otro_viaje' };
      g.viaje_id = viajeId;
      return { gasto_id, resultado: 'vinculado' };
    }),
  );
}

const route: { viaje: Handler; gastos: Handler; categorias: Handler; quitar: Handler; vincular: Handler } = {
  viaje: () => ok(db.viaje),
  gastos: leerGastosDelViajeDeLaBase,
  categorias: () => ok(CATS),
  quitar: quitarEnLaBase,
  vincular: vincularEnLaBase,
};
function resetRoutes() {
  route.viaje = () => ok(db.viaje);
  route.gastos = leerGastosDelViajeDeLaBase;
  route.categorias = () => ok(CATS);
  route.quitar = quitarEnLaBase;
  route.vincular = vincularEnLaBase;
}

function installResponder() {
  h.state.responder = (call: Call) => {
    if (call.target === 'miembros') return ok(MIEMBRO);
    if (call.target === 'categorias_gasto') return route.categorias(call);
    if (call.target === 'camiones') return ok([]);
    if (call.target === 'viajes') return route.viaje(call);
    if (esLecturaDelViaje(call)) return route.gastos(call);
    if (esQuitar(call)) return route.quitar(call);
    if (esVincular(call)) return route.vincular(call);
    throw new Error(`pedido inesperado: ${call.target} ${ops(call).join('.')}`);
  };
}

type Deferred = { promise: Promise<Resp>; resolve: (r: Resp) => void };
function deferred(): Deferred {
  let resolve!: (r: Resp) => void;
  const promise = new Promise<Resp>((r) => (resolve = r));
  return { promise, resolve };
}

const lecturasDelViaje = () => h.calls.filter(esLecturaDelViaje);
/** Lo que se mandó en cada «Quitar»: los ids, el viaje y lo que se escribe. */
const envios = () => h.calls.filter(esQuitar).map(argsDeQuitar);
const idsEnviados = () => envios().map((e) => e.ids);

// ---------------------------------------------------------------------------
// El árbol de prueba
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

/** A dónde se llegó: muestra con qué `state` y en qué ruta. */
function Destino({ nombre }: { nombre: string }) {
  const location = useLocation();
  return <div id={`destino-${nombre}`} data-pathname={location.pathname} data-state={JSON.stringify(location.state ?? null)} />;
}

/** Otra «pantalla» (o un montaje anterior) con sus propias mutaciones de sumar y quitar: comparten el scope con la que se prueba. */
const otra: { vincular: ReturnType<typeof useVincularGastos> | null; quitar: ReturnType<typeof useQuitarGastosDelViaje> | null } = {
  vincular: null,
  quitar: null,
};
function OtraPantalla() {
  otra.vincular = useVincularGastos();
  otra.quitar = useQuitarGastosDelViaje();
  return null;
}

/** Deja a mano el `navigate` del router: sirve para cambiar de URL con la pantalla YA montada (como un salto de varias páginas en el historial). */
const nav: { ir: ((destino: string) => void) | null } = { ir: null };
function Navegador() {
  const navigate = useNavigate();
  nav.ir = (destino) => navigate(destino);
  return null;
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

const RUTA = `/viajes/${VIAJE}/quitar-gastos`;

async function mount(entry: InitialEntry = RUTA) {
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
                <OtraPantalla />
                <Navegador />
                <Routes>
                  <Route path="/viajes/:id/quitar-gastos" element={<QuitarGastosPage />} />
                  <Route path="/viajes/:id" element={<Destino nombre="detalle" />} />
                  <Route path="/viajes" element={<Destino nombre="lista-de-viajes" />} />
                </Routes>
              </RequireMember>
            </MemoryRouter>
          </MemberProvider>
        </AuthHarness>
      </QueryClientProvider>,
    );
  });
  await settle(8);
}

async function desmontar() {
  await act(async () => {
    root.unmount();
  });
  container.remove();
}

beforeEach(() => {
  h.calls.length = 0;
  db.gastos = gastosPorDefecto();
  db.viaje = viajeDeLaBase();
  resetRoutes();
  installResponder();
  limpiarErroresRecientes();
  otra.vincular = null;
  otra.quitar = null;
  nav.ir = null;
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
  // Ninguna prueba debe dejar warnings de React (act, anidamiento inválido de DOM, keys…).
  expect(errorSpy.mock.calls.map((c: unknown[]) => String(c[0]))).toEqual([]);
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Ayudas para leer y tocar la pantalla
// ---------------------------------------------------------------------------
const bodyText = () => document.body.textContent ?? '';
const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T | null;
const stateOf = (el: Element) => JSON.parse((el as HTMLElement).dataset.state ?? 'null') as Record<string, unknown> | null;
const casillas = () => [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
const textoDeFila = (c: HTMLInputElement) => c.closest('label')?.textContent ?? '';
const filas = () => casillas().map(textoDeFila);
/** La casilla de la fila que contiene este texto (cada fila de prueba tiene una descripción o una categoría propias). */
function casilla(texto: string): HTMLInputElement {
  const encontradas = casillas().filter((c) => textoDeFila(c).includes(texto));
  if (encontradas.length !== 1) throw new Error(`casillas con «${texto}»: ${encontradas.length}`);
  return encontradas[0]!;
}
/** La casilla de la fila `fila-NNN` de `muchos(…)`. */
const casillaN = (n: number) => casilla(`fila-${String(n).padStart(3, '0')}`);
const marcadas = () => casillas().filter((c) => c.checked);
const botones = () => [...document.querySelectorAll<HTMLButtonElement>('button')];
const botonesConTexto = (patron: RegExp) => botones().filter((b) => patron.test(b.textContent?.trim() ?? ''));
/** Hay DOS (uno para el celular y otro para escritorio, solo uno se ve por ancho): se prueban siempre los dos. */
const botonesDeQuitar = () => botonesConTexto(/^(?:Quitar (?:\d+ gastos?|gastos) del viaje|Quitando…|Un momento…)$/);
const botonQuitar = () => botonesDeQuitar()[0]!;
const botonMarcarTodos = () => botonesConTexto(/^(?:Marcar todos \(\d+\)|Marcar los primeros \d+|Desmarcar todos)$/)[0]!;
/** «Reintentar» (o «Reintentando…» si no se puede tocar porque hay algo en curso). */
const botonReintentar = () => botonesConTexto(/^Reintent(?:ar|ando…)$/)[0];
const alertas = () => [...document.querySelectorAll<HTMLElement>('[role="alert"]')];
/** Solo el mensaje de cada alerta, sin el texto del botón «Reintentar» que lleva adentro. */
const mensajes = () => alertas().map((a) => a.querySelector('[data-slot="alert-description"]')?.textContent ?? a.textContent ?? '');
/** El aviso del resultado de «Quitar» (`role="status"`). */
const resultado = () =>
  [...document.querySelectorAll<HTMLElement>('[role="status"]')].find((e) => /Quitaste|No se quitó|ya no estaba|ya no estaban/.test(e.textContent ?? ''));
const parrafosDelResultado = () => [...resultado()!.querySelectorAll('p')].map((p) => p.textContent);
const links = () => [...document.querySelectorAll<HTMLAnchorElement>('a')];
const seccion = (titulo: string) => [...document.querySelectorAll('section')].find((s) => s.querySelector('h2')?.textContent === titulo) as HTMLElement | undefined;
const AVISO_100 = `Marcaste ${MAX_GASTOS_POR_VEZ}, el máximo por vez. Desmarca uno para elegir otro.`;
/** Las líneas «llegaste al máximo» que hay en la pantalla (una por cada copia de la tarjeta: celular y escritorio). */
const avisosDeMaximo = () => [...document.querySelectorAll<HTMLElement>('p[role="status"]')].filter((p) => p.textContent === AVISO_100);

async function tocar(el: HTMLElement | null | undefined) {
  if (!el) throw new Error('no se encontró el elemento a tocar');
  await act(async () => {
    el.click();
  });
  await settle(6);
}

async function invalidarLosGastos() {
  await act(async () => {
    await queryClient.invalidateQueries({ queryKey: gastosKeys.all(T) });
  });
  await settle(6);
}

// ---------------------------------------------------------------------------
// Encabezado y estados del viaje
// ---------------------------------------------------------------------------
describe('«Quitar gastos del viaje»: el encabezado', () => {
  it('el título, el viaje («Origen → Destino» y su fecha) debajo y un «Volver» al detalle del viaje', async () => {
    await mount();
    expect(document.querySelector('h1')!.textContent).toBe('Quitar gastos del viaje');
    const viaje = [...document.querySelectorAll('p')].find((p) => p.textContent?.includes('Rosario'))!;
    expect(viaje.textContent).toContain('Rosario');
    expect(viaje.textContent).toContain('Córdoba');
    expect(viaje.textContent).toContain('15 jun 2026');
    expect(viaje.querySelector('[aria-hidden="true"]')!.textContent).toBe('→'); // la flecha es decorativa…
    expect(viaje.querySelector('.sr-only')!.textContent).toBe(' a '); // …y el lector de pantalla oye «a»
    const volver = links().find((a) => a.getAttribute('href') === `/viajes/${VIAJE}`)!;
    expect(volver.textContent?.trim()).toBe('Volver al viaje'); // a la vista dice solo «Volver»
    expect(volver.className).toContain('min-h-12');
    expect(volver.querySelector('.sr-only')!.textContent?.trim()).toBe('al viaje');
  });

  it('tiene su botón «Ayuda» junto al título', async () => {
    await mount();
    const ayuda = document.querySelector<HTMLButtonElement>('button[aria-label="Ayuda de esta pantalla"]')!;
    expect(ayuda).not.toBeNull();
    expect(ayuda.textContent!.trim()).toBe('Ayuda');
  });

  it('el «Volver» lleva el mes de la lista de viajes como único dato del state (saneado)', async () => {
    const volver = () => links().find((a) => a.getAttribute('href') === `/viajes/${VIAJE}`)!;
    await mount({ pathname: RUTA, state: { volver: '?mes=2025-06' } });
    await tocar(volver());
    expect(byId('destino-detalle')).not.toBeNull();
    expect(stateOf(byId('destino-detalle')!)).toEqual({ volver: '?mes=2025-06' });
  });

  it('un volver raro del state se ignora: no viaja nada que no haya podido escribir la lista', async () => {
    await mount({ pathname: RUTA, state: { volver: '//evil.com?mes=2025-06&x=<script>' } });
    await tocar(links().find((a) => a.getAttribute('href') === `/viajes/${VIAJE}`));
    expect(stateOf(byId('destino-detalle')!)).toEqual({ volver: '' });
  });

  it('si el detalle se abrió desde un cliente, el cliente vuelve con el «Volver» (un uuid ya validado)', async () => {
    await mount({ pathname: RUTA, state: { volver: '', desdeCliente: CLIENTE, volverCliente: '?q=alma' } });
    await tocar(links().find((a) => a.getAttribute('href') === `/viajes/${VIAJE}`));
    expect(stateOf(byId('destino-detalle')!)).toEqual({ volver: '', desdeCliente: CLIENTE, volverCliente: '?q=alma' });
  });

  it('un desdeCliente que no es uuid (una ruta, una URL) no viaja', async () => {
    await mount({ pathname: RUTA, state: { desdeCliente: '//evil.test', volverCliente: '?q=a' } });
    await tocar(links().find((a) => a.getAttribute('href') === `/viajes/${VIAJE}`));
    expect(stateOf(byId('destino-detalle')!)).toEqual({ volver: '' });
  });

  it('el id de la URL en mayúsculas funciona (se pasa a minúsculas antes de pedir nada)', async () => {
    await mount(`/viajes/${VIAJE.toUpperCase()}/quitar-gastos`);
    expect(filas()).toHaveLength(4);
    expect(links().some((a) => a.getAttribute('href') === `/viajes/${VIAJE}`)).toBe(true);
    expect(eqDe(lecturasDelViaje()[0]!, 'viaje_id')).toBe(VIAJE); // el pedido va con el uuid en minúsculas
  });
});

describe('«Quitar gastos del viaje»: el viaje de la URL', () => {
  it('un id que no es uuid: «Viaje no encontrado», sin pedir NADA a la base, y el título sigue ahí', async () => {
    await mount('/viajes/no-es-un-uuid/quitar-gastos');
    expect(bodyText()).toContain('Viaje no encontrado');
    expect(document.querySelector('h1')!.textContent).toBe('Quitar gastos del viaje');
    expect(h.calls.filter((c) => c.target === 'viajes' || c.target === 'gastos')).toHaveLength(0);
    // el «Volver» lleva a la lista de viajes, no a un detalle que no existe
    expect(links().some((a) => a.getAttribute('href') === '/viajes' && a.textContent?.includes('Volver'))).toBe(true);
    expect(botonesDeQuitar()).toHaveLength(0);
  });

  it('un viaje que no existe (o es de otra cuenta: la base no distingue): «Viaje no encontrado», sin lista ni botones', async () => {
    db.viaje = null;
    await mount();
    expect(bodyText()).toContain('Viaje no encontrado');
    expect(casillas()).toHaveLength(0);
    expect(botonesDeQuitar()).toHaveLength(0);
    expect(lecturasDelViaje()).toHaveLength(0); // sin saber que el viaje existe no se piden sus gastos
  });

  it('si falla la carga del viaje: mensaje en español con «Reintentar», que vuelve a pedirlo', async () => {
    let intento = 0;
    route.viaje = () => {
      intento += 1;
      return intento === 1 ? sinRed() : ok(db.viaje);
    };
    await mount();
    expect(mensajes()[0]).toBe('No hay señal. Revisa la conexión y prueba de nuevo.');
    expect(casillas()).toHaveLength(0);
    await tocar(botonReintentar());
    expect(filas()).toHaveLength(4);
    expect(alertas()).toHaveLength(0);
  });

  it('mientras el viaje carga hay un esqueleto (nada de botones todavía)', async () => {
    route.viaje = () => new Promise<Resp>(() => {});
    await mount();
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(botonesDeQuitar()).toHaveLength(0);
    expect(casillas()).toHaveLength(0);
  });

  it('si falla el REFRESCO del viaje y ya hay datos, la pantalla sigue como estaba (no la tapa con un error)', async () => {
    await mount();
    expect(filas()).toHaveLength(4);
    route.viaje = () => sinRed();
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: viajesKeys.vistas(T) });
    });
    await settle(6);
    expect(filas()).toHaveLength(4);
    expect(document.querySelector('h1')!.textContent).toBe('Quitar gastos del viaje');
    expect(bodyText()).toContain('Rosario');
    expect(alertas()).toHaveLength(0);
  });

  it('un viaje con una fecha que no existe en el calendario (la base acepta `infinity`) se ve igual: la fecha tal cual y la lista, sin romper', async () => {
    db.viaje = viajeDeLaBase({ fecha: 'infinity' });
    await mount();
    expect(bodyText()).toContain('infinity'); // se muestra tal cual, sin romper el dibujo
    expect(filas()).toHaveLength(4);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// La lista
// ---------------------------------------------------------------------------
describe('«Quitar gastos del viaje»: la lista de los gastos del viaje', () => {
  it('pide los gastos de ESTE viaje (`viaje_id = <id>`), del más nuevo al más viejo, sin el embed del viaje y sin pedir los gastos sin viaje', async () => {
    await mount();
    const lecturas = lecturasDelViaje();
    expect(lecturas).toHaveLength(1);
    const call = lecturas[0]!;
    expect(eqDe(call, 'viaje_id')).toBe(VIAJE);
    expect(call.ops.filter((o) => o.m === 'order').map((o) => o.args)).toEqual([
      ['fecha', { ascending: false }],
      ['created_at', { ascending: false }],
      ['id', { ascending: true }],
    ]);
    expect(call.ops.find((o) => o.m === 'limit')!.args).toEqual([LIST_LIMIT + 1]);
    expect(String(call.ops.find((o) => o.m === 'select')!.args[0])).not.toContain('viajes(');
    expect(ops(call)).not.toContain('is'); // no es la lectura de los gastos SIN viaje
  });

  it('muestra solo los gastos de este viaje: los de otro viaje y los que no tienen viaje no aparecen', async () => {
    db.gastos = [...gastosPorDefecto(), gasto(90, { viaje_id: OTRO_VIAJE, descripcion: 'de otro viaje' }), gasto(91, { viaje_id: null, descripcion: 'sin viaje' })];
    await mount();
    expect(filas()).toHaveLength(4);
    expect(filas().join(' ')).not.toContain('de otro viaje');
    expect(filas().join(' ')).not.toContain('sin viaje');
  });

  it('los más nuevos primero (fecha descendente)', async () => {
    await mount();
    expect(filas().map((f) => f.match(/peaje norte|Combustible|lavado del acoplado|muy viejo/)![0])).toEqual([
      'peaje norte', // 16 jun 2026
      'Combustible', // 14 jun 2026
      'lavado del acoplado', // 10 jun 2026
      'muy viejo', // 2 ene 2025
    ]);
  });

  it('cada fila muestra la categoría, la fecha (con año), el monto (sin símbolo de moneda) y la descripción si tiene', async () => {
    await mount();
    const primera = textoDeFila(casillas()[0]!);
    expect(primera).toContain('Peajes');
    expect(primera).toContain('16 jun 2026');
    expect(primera).toContain(formatNumber(1000, { decimales: 2 }));
    expect(primera).toContain('peaje norte');
    expect(primera).not.toContain('$');
    const segunda = textoDeFila(casillas()[1]!);
    expect(segunda).toContain('Combustible');
    expect(segunda).toContain('14 jun 2026');
    expect(segunda).toContain(formatNumber(2500.5, { decimales: 2 }));
    // sin descripción no hay línea de descripción
    expect(document.querySelectorAll('li')[1]!.querySelectorAll('.line-clamp-2')).toHaveLength(0);
  });

  it('una categoría que no cargó (o no existe) se ve como «Gasto»; una inactiva, con «(inactiva)»', async () => {
    route.categorias = () => ok([{ id: PEAJES, nombre: 'Peajes', activa: false, transportista_id: 'tenant-a' }]);
    await mount();
    expect(textoDeFila(casillas()[0]!)).toContain('Peajes (inactiva)');
    expect(textoDeFila(casillas()[1]!)).toMatch(/^Gasto/);
  });

  it('si fallan las categorías: los gastos se ven con el nombre genérico y un aviso con «Reintentar»', async () => {
    let intento = 0;
    route.categorias = () => {
      intento += 1;
      return intento === 1 ? sinRed() : ok(CATS);
    };
    await mount();
    expect(mensajes()[0]).toBe('No pudimos cargar las categorías. No hay señal. Revisa la conexión y prueba de nuevo.');
    expect(filas()).toHaveLength(4);
    expect(textoDeFila(casillas()[0]!)).toMatch(/^Gasto/);
    await tocar(botonReintentar());
    expect(alertas()).toHaveLength(0);
    expect(textoDeFila(casillas()[0]!)).toContain('Peajes');
  });

  it('si falla el REFRESCO de las categorías y ya hay datos: los nombres siguen y NO sale el aviso (hay copia anterior)', async () => {
    await mount();
    expect(textoDeFila(casillas()[0]!)).toContain('Peajes');
    route.categorias = () => sinRed();
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: gastosKeys.categorias(T) });
    });
    await settle(6);
    expect(alertas()).toHaveLength(0);
    expect(textoDeFila(casillas()[0]!)).toContain('Peajes');
    expect(filas()).toHaveLength(4);
  });

  it('la descripción larga, sin espacios, se corta donde haga falta (sin scroll horizontal) y a dos líneas', async () => {
    db.gastos = [gasto(1, { descripcion: 'x'.repeat(2000) })];
    await mount();
    const descripcion = [...document.querySelectorAll<HTMLElement>('label span')].find((s) => s.textContent === 'x'.repeat(2000))!;
    expect(descripcion.className).toContain('[overflow-wrap:anywhere]');
    expect(descripcion.className).toContain('line-clamp-2');
    expect(descripcion.className.split(/\s+/)).not.toContain('block');
  });

  it('el texto de una descripción se muestra como texto (sin interpretar HTML)', async () => {
    db.gastos = [gasto(1, { descripcion: '<img src=x onerror=alert(1)><script>alert(2)</script>' })];
    await mount();
    expect(document.querySelector('img')).toBeNull();
    expect(document.querySelector('script')).toBeNull();
    expect(bodyText()).toContain('<script>alert(2)</script>');
  });

  it('con una fecha de gasto `infinity`, `-infinity` o de CINCO cifras la lista se sigue viendo (no rompe `Intl`)', async () => {
    db.gastos = [
      gasto(1, { fecha: 'infinity', descripcion: 'sin fin' }),
      gasto(2, { fecha: '-infinity', descripcion: 'sin comienzo' }),
      gasto(3, { fecha: '10000-01-01', descripcion: 'año diez mil' }),
      gasto(4, { fecha: '2026-06-14', descripcion: 'normal' }),
    ];
    await mount();
    expect(casillas()).toHaveLength(4);
    expect(textoDeFila(casilla('sin fin'))).toContain('infinity');
    expect(textoDeFila(casilla('año diez mil'))).toContain('10000-01-01');
    expect(textoDeFila(casilla('normal'))).toContain('14 jun 2026');
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('cada fila mide 64 px o más y TODA la fila es la zona que se toca (una `label` con la casilla adentro)', async () => {
    await mount();
    for (const c of casillas()) {
      const etiqueta = c.closest('label')!;
      expect(etiqueta.querySelectorAll('input')).toHaveLength(1);
      const fila = etiqueta.querySelector('span')!;
      expect(fila.className).toContain('min-h-16');
      expect(fila.className).toContain('cursor-pointer');
      expect(etiqueta.textContent!.length).toBeGreaterThan(5);
    }
  });

  it('la lista es un grupo de casillas con nombre (`fieldset` + `legend`) y un título «Gastos del viaje» con su ayuda', async () => {
    await mount();
    const grupo = document.querySelector('fieldset')!;
    expect(grupo.querySelector('legend')!.textContent).toBe('Gastos del viaje');
    expect(grupo.querySelector('legend')!.className).toContain('sr-only');
    expect(seccion('Gastos del viaje')).toBeDefined();
    expect(bodyText()).toContain('Marca los que quieres quitar de este viaje.');
  });

  it('mientras la lista carga: un esqueleto, sin casillas ni botón de quitar; el viaje ya se ve', async () => {
    route.gastos = () => new Promise<Resp>(() => {});
    await mount();
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(casillas()).toHaveLength(0);
    expect(botonesDeQuitar()).toHaveLength(0);
    expect(bodyText()).toContain('Rosario');
  });

  it('con el viaje SIN gastos: «Este viaje no tiene gastos.», un «Volver al viaje» bien a la vista (grande) y ningún botón de quitar', async () => {
    db.gastos = [gasto(1, { viaje_id: OTRO_VIAJE }), gasto(2, { viaje_id: null })]; // ninguno es de este viaje
    await mount();
    expect(bodyText()).toContain('Este viaje no tiene gastos.');
    expect(casillas()).toHaveLength(0);
    expect(botonesDeQuitar()).toHaveLength(0);
    expect(botonMarcarTodos()).toBeUndefined();
    expect(bodyText()).not.toContain('Marca los que quieres quitar');
    const botonVolver = links().filter((a) => a.textContent?.trim() === 'Volver al viaje' && a.className.includes('h-14'));
    expect(botonVolver).toHaveLength(1); // el botón grande del estado vacío (el «Volver» de arriba es el otro)
    expect(botonVolver[0]!.getAttribute('href')).toBe(`/viajes/${VIAJE}`);
    await tocar(botonVolver[0]);
    expect(byId('destino-detalle')).not.toBeNull();
  });

  it('el «Volver al viaje» del estado vacío lleva el mes y el cliente como únicos datos del state', async () => {
    db.gastos = [];
    await mount({ pathname: RUTA, state: { volver: '?mes=2025-06', desdeCliente: CLIENTE, volverCliente: '?q=alma' } });
    await tocar(links().find((a) => a.textContent?.trim() === 'Volver al viaje' && a.className.includes('h-14')));
    expect(stateOf(byId('destino-detalle')!)).toEqual({ volver: '?mes=2025-06', desdeCliente: CLIENTE, volverCliente: '?q=alma' });
  });

  it('si la lista falla y no hay datos: mensaje con «Reintentar», que vuelve a pedirla', async () => {
    let intento = 0;
    route.gastos = (call) => {
      intento += 1;
      return intento === 1 ? sinRed() : leerGastosDelViajeDeLaBase(call);
    };
    await mount();
    expect(mensajes()[0]).toBe('No hay señal. Revisa la conexión y prueba de nuevo.');
    expect(casillas()).toHaveLength(0);
    expect(botonesDeQuitar()).toHaveLength(0);
    await tocar(botonReintentar());
    expect(filas()).toHaveLength(4);
    expect(alertas()).toHaveLength(0);
  });

  it('si falla el REFRESCO de la lista y ya hay datos: la lista sigue a la vista, con el aviso y «Reintentar» (nada se pierde)', async () => {
    await mount();
    await tocar(casilla('peaje norte'));
    route.gastos = () => sinRed();
    await invalidarLosGastos();
    expect(mensajes()).toEqual(['No hay señal. Revisa la conexión y prueba de nuevo.']);
    expect(filas()).toHaveLength(4); // la lista sigue
    expect(casilla('peaje norte').checked).toBe(true); // y lo marcado también
    expect(botonQuitar().textContent).toBe('Quitar 1 gasto del viaje');
    expect(botonReintentar()).toBeDefined();
    route.gastos = leerGastosDelViajeDeLaBase;
    await tocar(botonReintentar());
    expect(alertas()).toHaveLength(0);
    expect(filas()).toHaveLength(4);
    expect(casilla('peaje norte').checked).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Marcar
// ---------------------------------------------------------------------------
describe('«Quitar gastos del viaje»: marcar', () => {
  it('NINGUNO viene marcado, y el botón de quitar está apagado con un renglón que dice por qué', async () => {
    await mount();
    expect(casillas()).toHaveLength(4);
    expect(marcadas()).toHaveLength(0);
    expect(botonesDeQuitar()).toHaveLength(2);
    for (const b of botonesDeQuitar()) {
      expect(b.disabled).toBe(true);
      expect(b.textContent).toBe('Quitar gastos del viaje');
    }
    expect(bodyText()).toContain('Marca los que quieres quitar.');
    expect(bodyText()).not.toContain('Suman ');
  });

  it('marcar uno: «Quitar 1 gasto del viaje» (singular) y «Suman …» con su monto', async () => {
    await mount();
    await tocar(casilla('peaje norte'));
    expect(marcadas()).toHaveLength(1);
    for (const b of botonesDeQuitar()) {
      expect(b.disabled).toBe(false);
      expect(b.textContent).toBe('Quitar 1 gasto del viaje');
    }
    expect(bodyText()).toContain(`Suman ${formatNumber(1000, { decimales: 2 })}`);
    expect(bodyText()).not.toContain('Marca los que quieres quitar.');
  });

  it('marcar varios: plural y el total sumado en CENTAVOS enteros (0,1 + 0,2 da 0,30 y no 0,30000000000000004)', async () => {
    db.gastos = [gasto(1, { monto: 0.1, descripcion: 'uno', fecha: '2026-06-03' }), gasto(2, { monto: 0.2, descripcion: 'dos', fecha: '2026-06-02' }), gasto(3, { monto: 100.3, descripcion: 'tres', fecha: '2026-06-01' })];
    await mount();
    await tocar(casilla('uno'));
    await tocar(casilla('dos'));
    expect(botonQuitar().textContent).toBe('Quitar 2 gastos del viaje');
    expect(bodyText()).toContain(`Suman ${formatNumber(0.3, { decimales: 2 })}`);
    await tocar(casilla('tres'));
    expect(bodyText()).toContain(`Suman ${formatNumber(100.6, { decimales: 2 })}`);
  });

  it('desmarcar vuelve atrás: al quedar sin nada, el botón se apaga otra vez', async () => {
    await mount();
    await tocar(casilla('peaje norte'));
    await tocar(casilla('peaje norte'));
    expect(marcadas()).toHaveLength(0);
    expect(botonQuitar().disabled).toBe(true);
    expect(bodyText()).toContain('Marca los que quieres quitar.');
  });

  it('«Marcar todos (N)» marca todos los gastos del viaje y pasa a «Desmarcar todos»; tocarlo desmarca todos', async () => {
    await mount();
    expect(botonMarcarTodos().textContent).toBe('Marcar todos (4)');
    await tocar(botonMarcarTodos());
    expect(marcadas()).toHaveLength(4);
    expect(botonMarcarTodos().textContent).toBe('Desmarcar todos');
    expect(botonQuitar().textContent).toBe('Quitar 4 gastos del viaje');
    expect(bodyText()).toContain(`Suman ${formatNumber(1000 + 2500.5 + 300 + 50, { decimales: 2 })}`);
    await tocar(botonMarcarTodos());
    expect(marcadas()).toHaveLength(0);
    expect(botonMarcarTodos().textContent).toBe('Marcar todos (4)');
  });

  it('«Marcar todos» con algunos ya marcados marca los que faltan; y si se completan a mano, cambia solo a «Desmarcar todos»', async () => {
    await mount();
    await tocar(casilla('peaje norte'));
    expect(botonMarcarTodos().textContent).toBe('Marcar todos (4)');
    await tocar(botonMarcarTodos());
    expect(marcadas()).toHaveLength(4);
    await tocar(casilla('lavado del acoplado'));
    expect(botonMarcarTodos().textContent).toBe('Marcar todos (4)');
    await tocar(casilla('lavado del acoplado'));
    expect(botonMarcarTodos().textContent).toBe('Desmarcar todos');
  });

  it('«Marcar todos» tiene 48 px y ocupa todo el ancho en el celular', async () => {
    await mount();
    expect(botonMarcarTodos().className).toContain('h-12');
    expect(botonMarcarTodos().className).toContain('w-full');
    expect(botonMarcarTodos().className).toContain('sm:w-auto');
  });

  it('con UN solo gasto en el viaje: «Marcar todos (1)» y se puede quitar', async () => {
    db.gastos = [gasto(1)];
    await mount();
    expect(botonMarcarTodos().textContent).toBe('Marcar todos (1)');
    await tocar(botonMarcarTodos());
    expect(botonQuitar().textContent).toBe('Quitar 1 gasto del viaje');
  });
});

// ---------------------------------------------------------------------------
// El tope de 100 por vez
// ---------------------------------------------------------------------------
describe('«Quitar gastos del viaje»: el tope de 100 por vez', () => {
  it('con 99 gastos: sin ningún aviso de tope y «Marcar todos (99)»', async () => {
    db.gastos = muchos(99);
    await mount();
    expect(casillas()).toHaveLength(99);
    expect(botonMarcarTodos().textContent).toBe('Marcar todos (99)');
    expect(bodyText()).not.toContain('Puedes quitar hasta');
    expect(bodyText()).not.toContain('Hay más de');
  });

  it('con EXACTAMENTE 100: «Marcar todos (100)» marca los 100, no hay avisos ni casillas apagadas, y se mandan los 100', async () => {
    db.gastos = muchos(MAX_GASTOS_POR_VEZ);
    await mount();
    expect(casillas()).toHaveLength(100);
    expect(bodyText()).not.toContain('Puedes quitar hasta'); // el viaje no tiene MÁS de 100: nada que avisar
    expect(botonMarcarTodos().textContent).toBe('Marcar todos (100)');
    await tocar(botonMarcarTodos());
    expect(marcadas()).toHaveLength(100);
    expect(botonMarcarTodos().textContent).toBe('Desmarcar todos');
    expect(botonQuitar().textContent).toBe('Quitar 100 gastos del viaje');
    expect(casillas().every((c) => !c.disabled)).toBe(true); // todas marcadas: no hay ninguna sin marcar que apagar
    expect(avisosDeMaximo()).toHaveLength(0);
    await tocar(botonQuitar());
    expect(idsEnviados()).toHaveLength(1);
    expect(idsEnviados()[0]).toEqual(Array.from({ length: 100 }, (_, i) => G(i + 1)));
    expect(parrafosDelResultado()[0]).toBe('Quitaste 100 gastos del viaje.');
    expect(bodyText()).toContain('Este viaje no tiene gastos.');
  }, 60_000);

  it('con 101: el aviso del tope, «Marcar los primeros 100» (no «Marcar todos (101)») y SIN el aviso de «hay más de 500»', async () => {
    db.gastos = muchos(MAX_GASTOS_POR_VEZ + 1);
    await mount();
    expect(casillas()).toHaveLength(101);
    expect(bodyText()).toContain('Puedes quitar hasta 100 gastos por vez. Cuando termines, puedes seguir con los demás.');
    expect(bodyText()).not.toContain('Hay más de 500');
    expect(botonMarcarTodos().textContent).toBe('Marcar los primeros 100');
    expect(bodyText()).not.toContain('Marcar todos (101)');
  }, 60_000);

  it('con 101: «Marcar los primeros 100» marca los 100 DE ARRIBA, apaga la casilla 101 (sin marcar) y avisa; «Quitar 100 gastos del viaje»', async () => {
    db.gastos = muchos(MAX_GASTOS_POR_VEZ + 1);
    await mount();
    await tocar(botonMarcarTodos());
    expect(marcadas()).toHaveLength(100);
    expect(casillaN(100).checked).toBe(true);
    expect(casillaN(101).checked).toBe(false);
    expect(casillaN(101).disabled).toBe(true); // sin cupo: la que quedó sin marcar se apaga
    expect(casillaN(100).disabled).toBe(false); // las marcadas siguen activas (se pueden desmarcar)
    expect(casillas().filter((c) => c.disabled)).toHaveLength(1);
    expect(botonMarcarTodos().textContent).toBe('Desmarcar todos');
    expect(botonQuitar().textContent).toBe('Quitar 100 gastos del viaje');
    expect(botonQuitar().disabled).toBe(false);
    // el aviso junto al total, en las DOS copias de la tarjeta (celular y escritorio), como una línea de estado
    expect(avisosDeMaximo()).toHaveLength(2);
    expect(bodyText()).toContain('Marcaste 100, el máximo por vez. Desmarca uno para elegir otro.');
  }, 60_000);

  it('con 101: marcar a mano hasta 100 y tocar la 101: no pasa nada (apagada); desmarcar una la habilita y se puede marcar la 101 en su lugar', async () => {
    db.gastos = muchos(MAX_GASTOS_POR_VEZ + 1);
    await mount();
    await tocar(botonMarcarTodos()); // 1 a 100
    await tocar(casillaN(101)); // apagada: un toque no marca
    expect(casillaN(101).checked).toBe(false);
    expect(marcadas()).toHaveLength(100);
    await tocar(casillaN(50)); // se desmarca la 50
    expect(marcadas()).toHaveLength(99);
    expect(casillas().every((c) => !c.disabled)).toBe(true); // hay cupo otra vez: ninguna apagada
    expect(avisosDeMaximo()).toHaveLength(0);
    expect(botonQuitar().textContent).toBe('Quitar 99 gastos del viaje');
    await tocar(casillaN(101)); // y se marca la 101 en su lugar
    expect(marcadas()).toHaveLength(100);
    expect(casillaN(101).checked).toBe(true);
    expect(casillaN(50).disabled).toBe(true); // ahora la que quedó sin marcar es la 50
    expect(avisosDeMaximo()).toHaveLength(2);
    await tocar(botonQuitar());
    // sale en el orden de la LISTA (no en el que se tocaron): 1…49, 51…100 y la 101
    expect(idsEnviados()[0]).toEqual([...Array.from({ length: 49 }, (_, i) => G(i + 1)), ...Array.from({ length: 51 }, (_, i) => G(i + 51))]);
    expect(idsEnviados()[0]).toHaveLength(100);
  }, 60_000);

  it('con 101: después de quitar los 100, el que quedó SIGUE en la lista (se vuelve a pedir), sin marcar y sin avisos: queda para otra vez', async () => {
    db.gastos = muchos(MAX_GASTOS_POR_VEZ + 1);
    await mount();
    await tocar(botonMarcarTodos());
    await tocar(botonQuitar());
    expect(parrafosDelResultado()[0]).toBe('Quitaste 100 gastos del viaje.');
    expect(filas()).toHaveLength(1);
    expect(filas()[0]).toContain('fila-101');
    expect(marcadas()).toHaveLength(0);
    expect(casillas()[0]!.disabled).toBe(false);
    expect(botonMarcarTodos().textContent).toBe('Marcar todos (1)'); // ya no hay más de 100: vuelve el rótulo de siempre
    expect(bodyText()).not.toContain('Puedes quitar hasta');
    expect(avisosDeMaximo()).toHaveLength(0);
    // y se quita en una segunda vuelta
    await tocar(botonMarcarTodos());
    await tocar(botonQuitar());
    expect(idsEnviados()).toEqual([Array.from({ length: 100 }, (_, i) => G(i + 1)), [G(101)]]);
    expect(parrafosDelResultado()[0]).toBe('Quitaste 1 gasto del viaje.');
    expect(db.gastos.every((g) => g.viaje_id === null)).toBe(true);
  }, 60_000);

  it('con 500 gastos justos: el aviso del tope pero NO el de «hay más de 500» (se ven todos)', async () => {
    db.gastos = muchos(LIST_LIMIT);
    await mount();
    expect(casillas()).toHaveLength(500);
    expect(bodyText()).toContain('Puedes quitar hasta 100 gastos por vez.');
    expect(bodyText()).not.toContain('Hay más de 500');
  }, 60_000);

  it('con MÁS de 500 (la lista se corta): se ven 500, los dos avisos, «Marcar los primeros 100» y se mandan exactamente 100; al terminar el aviso de «más de 500» se va', async () => {
    db.gastos = muchos(LIST_LIMIT + 100); // 600 en el viaje
    await mount();
    expect(casillas()).toHaveLength(500);
    expect(bodyText()).toContain('Puedes quitar hasta 100 gastos por vez. Cuando termines, puedes seguir con los demás.');
    expect(bodyText()).toContain('Hay más de 500 gastos en este viaje; aquí se ven los 500 más recientes.');
    expect(botonMarcarTodos().textContent).toBe('Marcar los primeros 100');
    await tocar(botonMarcarTodos());
    expect(marcadas()).toHaveLength(100);
    expect(casillaN(101).disabled).toBe(true);
    expect(casillaN(500).disabled).toBe(true);
    expect(botonQuitar().textContent).toBe('Quitar 100 gastos del viaje');
    await tocar(botonQuitar());
    expect(idsEnviados()).toEqual([Array.from({ length: 100 }, (_, i) => G(i + 1))]);
    expect(parrafosDelResultado()[0]).toBe('Quitaste 100 gastos del viaje.');
    // quedan 500 en el viaje: ahora se ven todos, y el que antes quedaba fuera (el 501) ya entra en la lista
    expect(casillas()).toHaveLength(500);
    expect(filas()[0]).toContain('fila-101');
    expect(filas()[499]).toContain('fila-600');
    expect(bodyText()).not.toContain('Hay más de 500');
    expect(bodyText()).toContain('Puedes quitar hasta 100 gastos por vez.'); // sigue habiendo más de 100
  }, 60_000);

  it('el tope nunca se pasa aunque se marque a mano toda la lista de 150: quedan marcados los primeros 100 que se tocaron y el resto apagado', async () => {
    db.gastos = muchos(150);
    await mount();
    for (let n = 1; n <= 150; n += 1) await act(async () => casillaN(n).click());
    await settle(4);
    expect(marcadas()).toHaveLength(100);
    expect(botonQuitar().textContent).toBe('Quitar 100 gastos del viaje');
    await tocar(botonQuitar());
    expect(idsEnviados()[0]).toHaveLength(100);
    expect(idsEnviados()[0]![0]).toBe(G(1));
    expect(idsEnviados()[0]![99]).toBe(G(100));
  }, 60_000);

  it('la tarjeta del celular tiene más aire debajo de la lista con el máximo marcado (lleva una línea más) y el aire de siempre sin él', async () => {
    db.gastos = muchos(MAX_GASTOS_POR_VEZ + 1);
    await mount();
    const raiz = container.querySelector('div.space-y-5')!;
    const aire = () => [...raiz.children].find((el) => el.getAttribute('aria-hidden') === 'true' && el.className.includes('md:hidden'))!;
    expect(aire().className).toContain('h-16');
    expect(aire().className).not.toContain('h-36');
    await tocar(botonMarcarTodos());
    expect(aire().className).toContain('h-36');
    expect(aire().className).not.toContain('h-16');
    expect(raiz.lastElementChild!.previousElementSibling).toBe(aire()); // sigue siendo lo penúltimo: la barra fija es lo último
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Quitar
// ---------------------------------------------------------------------------
describe('«Quitar gastos del viaje»: quitar y su resultado', () => {
  it('manda los marcados, SIN repetir y en el orden de la lista (no en el que se tocaron), con el viaje de la URL, el UPDATE a «sin viaje» y nada de transportista_id', async () => {
    await mount();
    await tocar(casilla('lavado del acoplado'));
    await tocar(casilla('peaje norte'));
    await tocar(botonQuitar());
    expect(envios()).toEqual([{ ids: [G(1), G(3)], viajeId: VIAJE, valores: { viaje_id: null } }]);
    const llamada = h.calls.find(esQuitar)!;
    expect(llamada.ops.find((o) => o.m === 'select')!.args).toEqual(['id']);
    expect(JSON.stringify(llamada)).not.toContain('transportista');
    expect(JSON.stringify(llamada)).not.toContain(G(2));
  });

  it('el resultado: «Quitaste N gastos del viaje.» (role=status), que NO se borraron, la selección queda vacía y los quitados desaparecen de la lista', async () => {
    await mount();
    await tocar(casilla('peaje norte'));
    await tocar(casilla('lavado del acoplado'));
    await tocar(botonQuitar());
    expect(resultado()!.getAttribute('role')).toBe('status');
    expect(parrafosDelResultado()).toEqual(['Quitaste 2 gastos del viaje.', 'Los gastos no se borraron: quedaron sin viaje.']);
    // se refrescó la lista: quedan los dos que no se quitaron, sin marcar
    expect(filas()).toHaveLength(2);
    expect(filas().join(' ')).not.toContain('peaje norte');
    expect(marcadas()).toHaveLength(0);
    expect(botonQuitar().disabled).toBe(true);
    expect(botonQuitar().textContent).toBe('Quitar gastos del viaje');
    // los gastos NO se borraron: siguen existiendo, solo que sin viaje
    expect(db.gastos).toHaveLength(4);
    expect(db.gastos.filter((g) => g.viaje_id === null).map((g) => g.id)).toEqual([G(1), G(3)]);
    expect(db.gastos.filter((g) => g.viaje_id === VIAJE).map((g) => g.id)).toEqual([G(2), G(4)]);
  });

  it('con 1 solo gasto: «Quitaste 1 gasto del viaje.» y «El gasto no se borró: quedó sin viaje.» (singular)', async () => {
    await mount();
    await tocar(casilla('peaje norte'));
    await tocar(botonQuitar());
    expect(parrafosDelResultado()).toEqual(['Quitaste 1 gasto del viaje.', 'El gasto no se borró: quedó sin viaje.']);
  });

  it('la pantalla NO vuelve sola: sigue en la misma ruta y ofrece «Volver al viaje» (un botón de 48 px) que lleva al detalle con el mes y el cliente', async () => {
    await mount({ pathname: RUTA, state: { volver: '?mes=2025-06', desdeCliente: CLIENTE, volverCliente: '?q=alma' } });
    await tocar(casilla('peaje norte'));
    await tocar(botonQuitar());
    expect(document.querySelector('h1')!.textContent).toBe('Quitar gastos del viaje');
    expect(byId('destino-detalle')).toBeNull();
    const volver = [...resultado()!.querySelectorAll('a')].find((a) => a.textContent === 'Volver al viaje')!;
    expect(volver.getAttribute('href')).toBe(`/viajes/${VIAJE}`);
    expect(volver.className).toContain('h-12');
    await tocar(volver);
    expect(stateOf(byId('destino-detalle')!)).toEqual({ volver: '?mes=2025-06', desdeCliente: CLIENTE, volverCliente: '?q=alma' });
  });

  it('el aviso se queda a la vista y se lleva el foco (con la lista larga y el botón fijo abajo, si no, no se vería nada cambiar)', async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll as never;
    await mount();
    await tocar(casilla('peaje norte'));
    await tocar(botonQuitar());
    const aviso = resultado()!.parentElement!;
    expect(aviso.getAttribute('tabindex')).toBe('-1');
    expect(document.activeElement).toBe(aviso);
    expect(scroll).toHaveBeenCalledWith({ block: 'center' });
    await settle(10);
    expect(resultado()).toBeDefined(); // no se cierra solo
  });

  it('si algunos marcados YA NO ESTABAN en el viaje (otro dispositivo los quitó): «Quitaste N…», que no se borraron y «K ya no estaban en este viaje.»', async () => {
    await mount();
    await tocar(botonMarcarTodos()); // los cuatro
    // mientras tanto otro dispositivo quitó el 2 y el 4; esta pantalla todavía los ve
    db.gastos.find((g) => g.id === G(2))!.viaje_id = null;
    db.gastos.find((g) => g.id === G(4))!.viaje_id = null;
    await tocar(botonQuitar());
    expect(idsEnviados()).toEqual([[G(1), G(2), G(3), G(4)]]); // se pidieron los cuatro
    expect(parrafosDelResultado()).toEqual(['Quitaste 2 gastos del viaje.', 'Los gastos no se borraron: quedaron sin viaje.', '2 ya no estaban en este viaje.']);
    expect(filas()).toHaveLength(0);
  });

  it('uno solo que ya no estaba: «1 ya no estaba en este viaje.» (singular)', async () => {
    await mount();
    await tocar(casilla('peaje norte'));
    await tocar(casilla('muy viejo'));
    db.gastos.find((g) => g.id === G(4))!.viaje_id = OTRO_VIAJE; // otro dispositivo lo movió a otro viaje
    await tocar(botonQuitar());
    expect(parrafosDelResultado()).toEqual(['Quitaste 1 gasto del viaje.', 'El gasto no se borró: quedó sin viaje.', '1 ya no estaba en este viaje.']);
    expect(db.gastos.find((g) => g.id === G(4))!.viaje_id).toBe(OTRO_VIAJE); // lo del otro viaje NO se toca
  });

  it('si TODOS ya no estaban: «K ya no estaban en este viaje.» y nada más (ni «Quitaste 0» ni «no se borraron»); el aviso es de «salió bien» y la lista queda vacía', async () => {
    await mount();
    await tocar(botonMarcarTodos());
    for (const g of db.gastos) g.viaje_id = null; // otro dispositivo los quitó a todos
    await tocar(botonQuitar());
    expect(parrafosDelResultado()).toEqual(['4 ya no estaban en este viaje.']);
    expect(resultado()!.className).toContain('border-primary/50');
    expect(bodyText()).toContain('Este viaje no tiene gastos.');
    expect(botonesDeQuitar()).toHaveLength(0);
  });

  it('si se quitan todos los gastos: queda el aviso arriba y debajo «Este viaje no tiene gastos.», sin botón de quitar', async () => {
    await mount();
    await tocar(botonMarcarTodos());
    await tocar(botonQuitar());
    expect(parrafosDelResultado()[0]).toBe('Quitaste 4 gastos del viaje.');
    expect(bodyText()).toContain('Este viaje no tiene gastos.');
    expect(botonesDeQuitar()).toHaveLength(0);
    expect(casillas()).toHaveLength(0);
    expect(botonMarcarTodos()).toBeUndefined();
  });

  it('un segundo «Quitar» reemplaza el aviso anterior (no se acumulan)', async () => {
    await mount();
    await tocar(casilla('peaje norte'));
    await tocar(botonQuitar());
    expect(parrafosDelResultado()[0]).toBe('Quitaste 1 gasto del viaje.');
    await tocar(casilla('lavado del acoplado'));
    await tocar(casilla('Combustible'));
    await tocar(botonQuitar());
    const avisos = [...document.querySelectorAll('[role="status"]')].filter((e) => /Quitaste/.test(e.textContent ?? ''));
    expect(avisos).toHaveLength(1);
    expect(avisos[0]!.textContent).toContain('Quitaste 2 gastos del viaje.');
  });

  it('el Resumen y los gastos se refrescan (los totales por camión y la ganancia del viaje cambiaron)', async () => {
    const invalidar = vi.spyOn(queryClient, 'invalidateQueries');
    await mount();
    await tocar(casilla('peaje norte'));
    await tocar(botonQuitar());
    const claves = invalidar.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(claves).toContain(JSON.stringify(gastosKeys.all(T)));
    expect(claves).toContain(JSON.stringify(resumenKeys.all(T)));
  });

  it('la mutación va en el scope compartido de sumar y quitar (corren de a una)', async () => {
    const enCamino = deferred();
    route.quitar = async (call) => {
      await enCamino.promise;
      return quitarEnLaBase(call);
    };
    await mount();
    await tocar(casilla('peaje norte'));
    await tocar(botonQuitar());
    const delScope = queryClient.getMutationCache().getAll().filter((m) => m.options.scope?.id === SCOPE_DE_VINCULOS.id);
    expect(delScope).toHaveLength(1);
    expect(delScope[0]!.state.status).toBe('pending');
    await act(async () => {
      enCamino.resolve(ok(null));
    });
    await settle(8);
  });

  it('una respuesta que NO es una lista (se rompió algo) no se lee como «ya no estaban»: error genérico con «Reintentar» y lo marcado se conserva', async () => {
    route.quitar = () => ok({ raro: true });
    await mount();
    await tocar(casilla('peaje norte'));
    await tocar(botonQuitar());
    expect(resultado()).toBeUndefined();
    expect(mensajes()).toHaveLength(1);
    expect(botonReintentar()).toBeDefined();
    expect(marcadas()).toHaveLength(1);
    expect(bodyText()).not.toContain('ya no estaba');
  });
});

// ---------------------------------------------------------------------------
// Errores y «Reintentar»
// ---------------------------------------------------------------------------
describe('«Quitar gastos del viaje»: errores y «Reintentar»', () => {
  it('sin señal: texto propio de quitar (no habla de «lo escrito» ni nombra un botón), «Reintentar», y lo marcado se CONSERVA', async () => {
    route.quitar = () => sinRed();
    await mount();
    await tocar(casilla('peaje norte'));
    await tocar(casilla('Combustible'));
    await tocar(botonQuitar());
    expect(mensajes()).toEqual(['No hay señal. Todavía NO se quitaron. Cuando tengas señal, inténtalo de nuevo.']);
    expect(botonReintentar()).toBeDefined();
    expect(marcadas()).toHaveLength(2); // sigue marcado para poder reintentar
    expect(botonQuitar().textContent).toBe('Quitar 2 gastos del viaje');
    expect(resultado()).toBeUndefined();
    expect(h.calls.filter(esQuitar)).toHaveLength(1); // sin reintento automático
  });

  it('con el tiempo vencido y la escritura que NO llegó: «no sabemos si se quitaron…», «Reintentar» y, al reintentar, se quita (sin riesgo: quitar es idempotente)', async () => {
    let intento = 0;
    route.quitar = (call) => {
      intento += 1;
      return intento === 1 ? tiempoVencido() : quitarEnLaBase(call);
    };
    await mount();
    await tocar(casilla('peaje norte'));
    await tocar(botonQuitar());
    expect(mensajes()).toEqual(['La señal está lenta y no sabemos si se quitaron. Revisa el viaje o inténtalo de nuevo: si ya estaban quitados, no pasa nada.']);
    expect(marcadas()).toHaveLength(1); // la lista no cambió: sigue marcado
    await tocar(botonReintentar());
    expect(idsEnviados()).toEqual([[G(1)], [G(1)]]); // la MISMA selección, porque sigue marcada y sigue en la lista
    expect(parrafosDelResultado()[0]).toBe('Quitaste 1 gasto del viaje.');
  });

  it('con el tiempo vencido y la escritura que SÍ llegó: la lista se refresca sola, el gasto ya no está y no queda nada que reintentar', async () => {
    route.quitar = (call) => {
      quitarEnLaBase(call); // la escritura llegó…
      return tiempoVencido(); // …pero se perdió la respuesta
    };
    await mount();
    await tocar(casilla('peaje norte'));
    await tocar(botonQuitar());
    expect(mensajes()[0]).toContain('La señal está lenta y no sabemos si se quitaron.');
    expect(filas().join(' ')).not.toContain('peaje norte'); // la mutación falló, pero la lista se pidió igual (onSettled)
    expect(marcadas()).toHaveLength(0);
    expect(botonReintentar()).toBeUndefined(); // sin nada marcado, «Reintentar» no se ofrece (no hay qué mandar)
    expect(botonQuitar().disabled).toBe(true);
  });

  it('«Reintentar» manda la selección de AHORA: lo que ya no está en la lista NO se reenvía', async () => {
    let intento = 0;
    route.quitar = (call) => {
      intento += 1;
      return intento === 1 ? sinRed() : quitarEnLaBase(call);
    };
    await mount();
    await tocar(casilla('peaje norte'));
    await tocar(casilla('Combustible'));
    await tocar(botonQuitar());
    expect(botonReintentar()).toBeDefined();
    // mientras tanto, otro dispositivo quitó el de combustible: la lista se refresca y ya no está
    db.gastos.find((g) => g.id === G(2))!.viaje_id = null;
    await invalidarLosGastos();
    expect(filas().join(' ')).not.toContain('Combustible');
    expect(botonQuitar().textContent).toBe('Quitar 1 gasto del viaje');
    await tocar(botonReintentar());
    expect(idsEnviados()).toEqual([
      [G(1), G(2)],
      [G(1)], // solo lo que sigue en la lista y sigue marcado
    ]);
    expect(parrafosDelResultado()[0]).toBe('Quitaste 1 gasto del viaje.');
    expect(alertas()).toHaveLength(0); // el error se fue
  });

  it('«Reintentar» manda lo que está marcado AHORA: si se desmarcó uno después del error, ese no sale', async () => {
    let intento = 0;
    route.quitar = (call) => {
      intento += 1;
      return intento === 1 ? sinRed() : quitarEnLaBase(call);
    };
    await mount();
    await tocar(botonMarcarTodos());
    await tocar(botonQuitar());
    await tocar(casilla('lavado del acoplado')); // se desmarca uno
    await tocar(casilla('muy viejo')); // y otro
    await tocar(botonReintentar());
    expect(idsEnviados()).toEqual([
      [G(1), G(2), G(3), G(4)],
      [G(1), G(2)],
    ]);
  });

  it('el error se conserva y el botón principal también sirve: un «Quitar» nuevo limpia el aviso del error', async () => {
    let intento = 0;
    route.quitar = (call) => {
      intento += 1;
      return intento === 1 ? sinRed() : quitarEnLaBase(call);
    };
    await mount();
    await tocar(casilla('peaje norte'));
    await tocar(botonQuitar());
    expect(alertas()).toHaveLength(1);
    await tocar(botonQuitar());
    expect(alertas()).toHaveLength(0);
    expect(parrafosDelResultado()[0]).toBe('Quitaste 1 gasto del viaje.');
  });

  it('un error después de un resultado reemplaza al resultado (nunca se ven los dos)', async () => {
    await mount();
    await tocar(casilla('peaje norte'));
    await tocar(botonQuitar());
    expect(resultado()).toBeDefined();
    route.quitar = () => sinRed();
    await tocar(casilla('Combustible'));
    await tocar(botonQuitar());
    expect(resultado()).toBeUndefined();
    expect(alertas()).toHaveLength(1);
  });

  it('sin nada marcado, «Reintentar» no se ofrece (no hay qué mandar); el aviso queda y se puede marcar y quitar de nuevo', async () => {
    route.quitar = () => sinRed();
    await mount();
    await tocar(casilla('peaje norte'));
    await tocar(botonQuitar());
    expect(botonReintentar()).toBeDefined();
    await tocar(casilla('peaje norte')); // se desmarca
    expect(botonReintentar()).toBeUndefined();
    expect(mensajes()[0]).toContain('No hay señal. Todavía NO se quitaron.');
    expect(botonQuitar().disabled).toBe(true);
    await tocar(casilla('peaje norte'));
    expect(botonQuitar().disabled).toBe(false);
    expect(botonReintentar()).toBeDefined();
  });

  it('cuenta en solo lectura (PT402 / HTTP 402, clase «payment»): el mensaje general y SIN «Reintentar»', async () => {
    route.quitar = () => fail('PT402', SECRETO, 402);
    await mount();
    await tocar(casilla('peaje norte'));
    await tocar(botonQuitar());
    expect(mensajes()).toEqual(['Tu cuenta está en modo de solo lectura: por ahora no se pueden guardar cambios.']);
    expect(botonReintentar()).toBeUndefined();
    expect(bodyText()).not.toContain('secreto_interno');
    expect(marcadas()).toHaveLength(1); // lo marcado se conserva
  });

  it('un 402 sin código también es «payment»: sin «Reintentar»', async () => {
    route.quitar = () => fail('', SECRETO, 402);
    await mount();
    await tocar(casilla('peaje norte'));
    await tocar(botonQuitar());
    expect(mensajes()[0]).toContain('solo lectura');
    expect(botonReintentar()).toBeUndefined();
  });

  it('el viaje ya no existe (P0002): «Este viaje ya no existe.», sin «Reintentar»', async () => {
    route.quitar = () => fail('P0002', SECRETO, 500);
    await mount();
    await tocar(casilla('peaje norte'));
    await tocar(botonQuitar());
    expect(mensajes()).toEqual(['Este viaje ya no existe.']);
    expect(botonReintentar()).toBeUndefined();
  });

  it('datos inválidos (22023): «No se pudo quitar. Vuelve al viaje y prueba de nuevo.», sin «Reintentar»', async () => {
    route.quitar = () => fail('22023', SECRETO, 400);
    await mount();
    await tocar(casilla('peaje norte'));
    await tocar(botonQuitar());
    expect(mensajes()).toEqual(['No se pudo quitar. Vuelve al viaje y prueba de nuevo.']);
    expect(botonReintentar()).toBeUndefined();
  });

  it('sin permiso (42501) y sesión vencida: sin «Reintentar» (daría lo mismo)', async () => {
    for (const [code, status] of [
      ['42501', 403],
      ['PGRST301', 401],
    ] as const) {
      route.quitar = () => fail(code, SECRETO, status);
      await mount();
      await tocar(casilla('peaje norte'));
      await tocar(botonQuitar());
      expect(alertas().length, code).toBeGreaterThan(0);
      expect(botonReintentar(), code).toBeUndefined();
      await desmontar();
      queryClient.clear();
      h.calls.length = 0;
    }
  });

  it('un error del servidor (500): el mensaje de siempre y «Reintentar»; nunca el texto que manda el servidor', async () => {
    route.quitar = () => fail('XX000', SECRETO, 500);
    await mount();
    await tocar(casilla('peaje norte'));
    await tocar(botonQuitar());
    expect(mensajes()[0]).toContain('El servicio no está disponible en este momento. Prueba de nuevo en un rato.');
    expect(botonReintentar()).toBeDefined();
    expect(bodyText()).not.toContain('secreto_interno');
    expect(bodyText()).not.toContain('relation');
  });

  it('NINGÚN error muestra el texto del servidor (sesión vencida, permiso, datos inválidos, error desconocido…)', async () => {
    for (const [code, status] of [
      ['PGRST301', 401],
      ['42501', 403],
      ['22023', 400],
      ['23514', 400],
      ['', 418],
      ['40001', 409],
    ] as const) {
      route.quitar = () => fail(code, SECRETO, status);
      await mount();
      await tocar(casilla('peaje norte'));
      await tocar(botonQuitar());
      expect(alertas().length, code).toBeGreaterThan(0);
      expect(bodyText(), code).not.toContain('secreto_interno');
      expect(bodyText(), code).not.toContain('relation');
      await desmontar();
      queryClient.clear();
      h.calls.length = 0;
    }
  });
});

// ---------------------------------------------------------------------------
// Nada se toca mientras hay un envío en curso
// ---------------------------------------------------------------------------
describe('«Quitar gastos del viaje»: mientras hay un «Sumar» o un «Quitar» en curso', () => {
  it('mientras se envía ESTE pedido: el botón dice «Quitando…» y está apagado, y no se pueden tocar las casillas ni «Marcar todos»', async () => {
    const enCamino = deferred();
    route.quitar = async (call) => {
      await enCamino.promise;
      return quitarEnLaBase(call);
    };
    await mount();
    await tocar(casilla('peaje norte'));
    await tocar(botonQuitar());
    expect(envios()).toHaveLength(1);
    expect(botonesDeQuitar()).toHaveLength(2);
    for (const b of botonesDeQuitar()) {
      expect(b.disabled).toBe(true);
      expect(b.textContent?.trim()).toBe('Quitando…');
      expect(b.getAttribute('aria-busy')).toBe('true');
    }
    expect(casillas().every((c) => c.disabled)).toBe(true);
    expect(botonMarcarTodos().disabled).toBe(true);
    expect(document.querySelector('[role="status"].sr-only')?.textContent).toContain('Quitando…');
    // y al terminar todo se habilita otra vez
    await act(async () => {
      enCamino.resolve(ok(null));
    });
    await settle(8);
    expect(parrafosDelResultado()[0]).toBe('Quitaste 1 gasto del viaje.');
    expect(casillas().every((c) => !c.disabled)).toBe(true);
    expect(botonMarcarTodos().disabled).toBe(false);
  });

  it('dos toques seguidos (antes de que la pantalla se vuelva a dibujar) mandan UN solo pedido', async () => {
    const enCamino = deferred();
    route.quitar = async (call) => {
      await enCamino.promise;
      return quitarEnLaBase(call);
    };
    await mount();
    await tocar(casilla('peaje norte'));
    const boton = botonQuitar();
    await act(async () => {
      boton.click();
      boton.click();
    });
    await settle(4);
    expect(envios()).toHaveLength(1);
    await act(async () => {
      enCamino.resolve(ok(null));
    });
    await settle(6);
    expect(envios()).toHaveLength(1);
  });

  it('un «Sumar» en vuelo (de otra pantalla o de un montaje anterior) apaga «Quitar» con un texto NEUTRO: «Un momento…» (decir «Quitando…» sería mentira)', async () => {
    const sumando = deferred();
    route.vincular = () => sumando.promise;
    await mount();
    await tocar(casilla('peaje norte'));
    expect(botonQuitar().disabled).toBe(false);
    await act(async () => {
      otra.vincular!.mutate({ tenantId: T, viajeId: VIAJE, gastoIds: [G(9)] });
    });
    await settle(4);
    for (const b of botonesDeQuitar()) {
      expect(b.disabled).toBe(true);
      expect(b.textContent?.trim()).toBe('Un momento…');
      expect(b.getAttribute('aria-busy')).toBe('true');
    }
    expect(bodyText()).not.toContain('Quitando…');
    expect(document.querySelector('[role="status"].sr-only')?.textContent).toBe('Un momento…');
    expect(casillas().every((c) => c.disabled)).toBe(true);
    expect(botonMarcarTodos().disabled).toBe(true);
    await tocar(botonQuitar()); // un toque sobre un botón apagado no manda nada
    expect(envios()).toHaveLength(0);
    await act(async () => {
      sumando.resolve(ok([{ gasto_id: G(9), resultado: 'no_encontrado' }]));
    });
    await settle(8);
    expect(botonQuitar().disabled).toBe(false); // terminó: se puede volver a quitar
    expect(botonQuitar().textContent).toBe('Quitar 1 gasto del viaje');
    expect(casilla('peaje norte').checked).toBe(true); // y lo marcado seguía ahí
  });

  it('un «Quitar» de OTRO montaje en vuelo también apaga este con «Un momento…» (esta pantalla no lo lanzó: no dice «Quitando…»)', async () => {
    const enCamino = deferred();
    route.quitar = async (call) => {
      await enCamino.promise;
      return quitarEnLaBase(call);
    };
    await mount();
    await tocar(casilla('peaje norte'));
    await act(async () => {
      otra.quitar!.mutate({ tenantId: T, viajeId: VIAJE, gastoIds: [G(2)] });
    });
    await settle(4);
    expect(botonesDeQuitar().every((b) => b.disabled && b.textContent?.trim() === 'Un momento…')).toBe(true);
    await act(async () => {
      enCamino.resolve(ok(null));
    });
    await settle(8);
    expect(botonQuitar().disabled).toBe(false);
  });

  it('cuando termina el «Sumar» de otra pantalla, la lista se refresca sola: el gasto que se sumó a este viaje aparece, SIN marcar', async () => {
    const sumando = deferred();
    db.gastos = [...gastosPorDefecto(), gasto(9, { viaje_id: null, descripcion: 'recién sumado', fecha: '2026-06-20' })];
    route.vincular = async (call) => {
      await sumando.promise;
      return vincularEnLaBase(call);
    };
    await mount();
    expect(filas()).toHaveLength(4);
    await tocar(casilla('peaje norte'));
    await act(async () => {
      otra.vincular!.mutate({ tenantId: T, viajeId: VIAJE, gastoIds: [G(9)] });
    });
    await settle(4);
    await act(async () => {
      sumando.resolve(ok(null));
    });
    await settle(8);
    expect(filas()).toHaveLength(5);
    expect(casilla('recién sumado').checked).toBe(false);
    expect(casilla('peaje norte').checked).toBe(true);
    expect(botonQuitar().textContent).toBe('Quitar 1 gasto del viaje');
  });

  it('una mutación EN COLA (esperando su turno) cuenta: el botón sigue apagado hasta que terminan las dos', async () => {
    const primera = deferred();
    const segunda = deferred();
    route.quitar = () => primera.promise;
    route.vincular = async (call) => {
      await segunda.promise;
      return vincularEnLaBase(call);
    };
    await mount();
    await tocar(casilla('peaje norte'));
    await act(async () => {
      otra.quitar!.mutate({ tenantId: T, viajeId: VIAJE, gastoIds: [G(2)] }); // en vuelo
      otra.vincular!.mutate({ tenantId: T, viajeId: VIAJE, gastoIds: [G(9)] }); // en cola detrás de la anterior
    });
    await settle(4);
    expect(otra.vincular!.isPending).toBe(true);
    expect(h.calls.filter(esVincular)).toHaveLength(0); // la segunda todavía no salió
    expect(botonesDeQuitar().every((b) => b.disabled)).toBe(true);
    await act(async () => {
      primera.resolve(ok([{ id: G(2) }]));
    });
    await settle(8);
    expect(h.calls.filter(esVincular)).toHaveLength(1); // ahora corre la segunda
    expect(botonesDeQuitar().every((b) => b.disabled)).toBe(true); // y mientras corre sigue apagado
    await act(async () => {
      segunda.resolve(ok([{ gasto_id: G(9), resultado: 'no_encontrado' }]));
    });
    await settle(8);
    expect(botonQuitar().disabled).toBe(false);
  });

  it('un «Quitar» de ESTA pantalla que quedó EN COLA detrás de un «Sumar» ya iniciado dice «Quitando…» (es el suyo), no sale hasta que le toca y entonces se completa', async () => {
    const sumando = deferred();
    route.vincular = () => sumando.promise;
    await mount();
    await tocar(casilla('peaje norte'));
    const boton = botonQuitar();
    await act(async () => {
      otra.vincular!.mutate({ tenantId: T, viajeId: VIAJE, gastoIds: [G(9)] }); // sale primero
      boton.click(); // el botón todavía se ve habilitado (el dibujo no cambió): este «Quitar» queda EN COLA detrás del «Sumar»
    });
    await settle(4);
    expect(envios()).toHaveLength(0); // todavía no salió: espera su turno
    expect(botonesDeQuitar().every((b) => b.disabled && b.textContent?.trim() === 'Quitando…')).toBe(true); // y como es el suyo, dice «Quitando…»
    await act(async () => {
      sumando.resolve(ok([]));
    });
    await settle(8);
    expect(envios()).toEqual([{ ids: [G(1)], viajeId: VIAJE, valores: { viaje_id: null } }]);
    expect(parrafosDelResultado()[0]).toBe('Quitaste 1 gasto del viaje.');
  });

  it('«Reintentar» tampoco se puede tocar con algo en curso (y no manda nada)', async () => {
    route.quitar = () => sinRed();
    await mount();
    await tocar(casilla('peaje norte'));
    await tocar(botonQuitar());
    expect(botonReintentar()).toBeDefined();
    const sumando = deferred();
    route.vincular = () => sumando.promise;
    await act(async () => {
      otra.vincular!.mutate({ tenantId: T, viajeId: VIAJE, gastoIds: [G(9)] });
    });
    await settle(4);
    expect(botonReintentar()!.disabled).toBe(true);
    await tocar(botonReintentar());
    expect(envios()).toHaveLength(1); // solo el primero, el que falló
    await act(async () => {
      sumando.resolve(ok([]));
    });
    await settle(6);
  });

  it('si la pantalla se desmonta con el pedido en vuelo no pasa nada raro: la escritura se hace, los datos se refrescan y React no avisa de nada', async () => {
    const invalidar = vi.spyOn(queryClient, 'invalidateQueries');
    const enCamino = deferred();
    route.quitar = async (call) => {
      await enCamino.promise;
      return quitarEnLaBase(call);
    };
    await mount();
    await tocar(casilla('peaje norte'));
    await tocar(botonQuitar());
    expect(envios()).toHaveLength(1);
    await desmontar(); // se va de la pantalla con el pedido en camino
    await act(async () => {
      enCamino.resolve(ok(null));
    });
    await settle(8);
    expect(db.gastos.find((g) => g.id === G(1))!.viaje_id).toBeNull(); // la escritura se aplicó igual
    const claves = invalidar.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(claves).toContain(JSON.stringify(gastosKeys.all(T))); // y los datos quedaron marcados como viejos (no depende de un callback de la pantalla)
    expect(claves).toContain(JSON.stringify(resumenKeys.all(T)));
    // (el `afterEach` comprueba además que React no escribió ningún aviso)
  });

  it('si se vuelve a entrar mientras el pedido anterior sigue en vuelo, la pantalla nueva arranca apagada con «Un momento…» (no lo lanzó ella)', async () => {
    const enCamino = deferred();
    route.quitar = async (call) => {
      await enCamino.promise;
      return quitarEnLaBase(call);
    };
    await mount();
    await tocar(casilla('peaje norte'));
    await tocar(botonQuitar());
    await desmontar();
    await mount(); // se vuelve a entrar con el pedido anterior todavía en camino
    expect(botonesDeQuitar().every((b) => b.disabled && b.textContent?.trim() === 'Un momento…')).toBe(true);
    expect(casillas().every((c) => c.disabled)).toBe(true);
    await act(async () => {
      enCamino.resolve(ok(null));
    });
    await settle(8);
    expect(filas().join(' ')).not.toContain('peaje norte'); // ya está quitado y la lista lo refleja
    expect(casillas().every((c) => !c.disabled)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// La selección sigue a la lista
// ---------------------------------------------------------------------------
describe('«Quitar gastos del viaje»: la selección sigue a la lista', () => {
  it('si la lista se refresca y un gasto marcado ya no está, deja de estar marcado y NO se manda', async () => {
    await mount();
    await tocar(casilla('peaje norte'));
    await tocar(casilla('Combustible'));
    expect(botonQuitar().textContent).toBe('Quitar 2 gastos del viaje');
    db.gastos.find((g) => g.id === G(2))!.viaje_id = null; // otro dispositivo lo quitó
    await invalidarLosGastos();
    expect(filas()).toHaveLength(3);
    expect(marcadas()).toHaveLength(1);
    expect(botonQuitar().textContent).toBe('Quitar 1 gasto del viaje');
    expect(bodyText()).toContain(`Suman ${formatNumber(1000, { decimales: 2 })}`);
    await tocar(botonQuitar());
    expect(idsEnviados()).toEqual([[G(1)]]);
  });

  it('si ese gasto VUELVE a aparecer en la lista, vuelve SIN marcar (nunca se quita algo que no se marcó)', async () => {
    await mount();
    await tocar(casilla('peaje norte'));
    await tocar(casilla('Combustible'));
    db.gastos.find((g) => g.id === G(2))!.viaje_id = null;
    await invalidarLosGastos();
    expect(filas().join(' ')).not.toContain('Combustible');
    db.gastos.find((g) => g.id === G(2))!.viaje_id = VIAJE; // lo volvieron a poner en el viaje desde otro lado
    await invalidarLosGastos();
    expect(filas().join(' ')).toContain('Combustible');
    expect(casilla('Combustible').checked).toBe(false);
    expect(casilla('peaje norte').checked).toBe(true);
    expect(botonQuitar().textContent).toBe('Quitar 1 gasto del viaje');
  });

  it('EL HUECO: si en el refresco SALE un gasto y ENTRA otro (la lista queda con la MISMA cantidad), lo que salió deja de estar marcado y, si vuelve, vuelve SIN marcar', async () => {
    db.gastos = [...gastosPorDefecto(), gasto(9, { viaje_id: null, descripcion: 'recién llegado', fecha: '2026-06-01' })];
    await mount();
    await tocar(casilla('Combustible')); // se marca el G2
    expect(filas()).toHaveLength(4);
    // otro dispositivo saca el G2 del viaje y pone el G9: la lista sigue teniendo 4, pero NO son los mismos
    db.gastos.find((g) => g.id === G(2))!.viaje_id = null;
    db.gastos.find((g) => g.id === G(9))!.viaje_id = VIAJE;
    await invalidarLosGastos();
    expect(filas()).toHaveLength(4);
    expect(filas().join(' ')).not.toContain('Combustible');
    expect(filas().join(' ')).toContain('recién llegado');
    expect(marcadas()).toHaveLength(0); // el G2 salió: no queda nada marcado (y el G9, que entró, no se marcó solo)
    expect(botonQuitar().disabled).toBe(true);
    // el G2 vuelve al viaje: tampoco vuelve marcado
    db.gastos.find((g) => g.id === G(2))!.viaje_id = VIAJE;
    await invalidarLosGastos();
    expect(casilla('Combustible').checked).toBe(false);
    expect(marcadas()).toHaveLength(0);
    expect(botonQuitar().disabled).toBe(true);
  });

  it('un refresco que no cambia la lista no pierde lo marcado', async () => {
    await mount();
    await tocar(casilla('peaje norte'));
    await tocar(casilla('lavado del acoplado'));
    await invalidarLosGastos();
    expect(lecturasDelViaje()).toHaveLength(2); // se volvió a pedir
    expect(marcadas()).toHaveLength(2);
    expect(botonQuitar().textContent).toBe('Quitar 2 gastos del viaje');
  });

  it('si se refresca la lista y se queda sin nada marcado, el botón se apaga solo', async () => {
    await mount();
    await tocar(casilla('peaje norte'));
    db.gastos.find((g) => g.id === G(1))!.viaje_id = null;
    await invalidarLosGastos();
    expect(marcadas()).toHaveLength(0);
    expect(botonQuitar().disabled).toBe(true);
    expect(botonQuitar().textContent).toBe('Quitar gastos del viaje');
  });

  it('después de un «Quitar» que termina, lo que sigue en la lista queda SIN marcar (hay que marcarlo a propósito)', async () => {
    route.quitar = () => ok([]); // la base no quitó nada (ya no estaban en este viaje)
    await mount();
    await tocar(casilla('peaje norte'));
    await tocar(botonQuitar());
    expect(filas()).toHaveLength(4); // nada salió de la lista
    expect(marcadas()).toHaveLength(0); // pero la selección se vació
    expect(parrafosDelResultado()).toEqual(['1 ya no estaba en este viaje.']);
  });

  it('un gasto que entra a la lista arranca SIN marcar aunque se haya marcado todo antes', async () => {
    db.gastos = [...gastosPorDefecto(), gasto(9, { viaje_id: null, descripcion: 'recién llegado', fecha: '2026-06-01' })];
    await mount();
    await tocar(botonMarcarTodos());
    expect(marcadas()).toHaveLength(4);
    db.gastos.find((g) => g.id === G(9))!.viaje_id = VIAJE;
    await invalidarLosGastos();
    expect(filas()).toHaveLength(5);
    expect(casilla('recién llegado').checked).toBe(false);
    expect(marcadas()).toHaveLength(4);
    expect(botonMarcarTodos().textContent).toBe('Marcar todos (5)');
  });
});

// ---------------------------------------------------------------------------
// Cambiar de viaje con la pantalla abierta
// ---------------------------------------------------------------------------
// Con la pantalla abierta la URL puede pasar de un viaje a otro sin desmontarla (p. ej. un salto de varias páginas atrás en el
// historial del celular): es la MISMA ruta con otro `:id`. Lo que quedó del viaje anterior (el aviso de lo que se quitó, un error, lo
// marcado) no puede aparecer bajo el encabezado del viaje nuevo: confundiría a quien lo lee. Lo garantiza la `key` por viaje.
describe('«Quitar gastos del viaje»: cambiar de viaje con la pantalla abierta', () => {
  const RUTA_OTRO = `/viajes/${OTRO_VIAJE}/quitar-gastos`;

  /**
   * Cada viaje con lo suyo: la «base» contesta según el id que se pide. Y el otro viaje YA está en la caché (como si se hubiera visto
   * hace un momento): al cambiar de URL se dibuja de inmediato, SIN pasar por el esqueleto de «cargando», que por sí solo desmontaría
   * la parte con estado. Así lo único que reinicia ese estado es la `key` por viaje (y eso es lo que se prueba).
   */
  function hayDosViajes() {
    const otro = viajeDeLaBase({ id: OTRO_VIAJE, origen: 'Mendoza', destino: 'Salta', fecha: '2026-07-01' });
    db.gastos = [...gastosPorDefecto(), gasto(50, { viaje_id: OTRO_VIAJE, descripcion: 'del otro viaje', fecha: '2026-07-02' })];
    route.viaje = (call) => ok(eqDe(call, 'id') === OTRO_VIAJE ? otro : db.viaje);
    queryClient.setQueryData(viajesKeys.vista(T, OTRO_VIAJE), otro);
  }
  async function irAlOtroViaje() {
    await act(async () => {
      nav.ir!(RUTA_OTRO);
    });
    await settle(8);
  }
  /** El renglón del viaje, debajo del título («Rosario → Córdoba · 15 jun 2026»): el único párrafo con la flecha. */
  const encabezado = () => [...document.querySelectorAll('p')].find((p) => p.textContent?.includes('→'))?.textContent ?? '';

  it('el resultado del viaje anterior NO queda a la vista bajo el encabezado del viaje nuevo, ni lo marcado', async () => {
    hayDosViajes();
    await mount();
    expect(encabezado()).toContain('Rosario');
    await tocar(casilla('peaje norte'));
    await tocar(botonQuitar());
    expect(parrafosDelResultado()[0]).toBe('Quitaste 1 gasto del viaje.');
    await tocar(casilla('lavado del acoplado')); // algo marcado justo cuando se cambia de viaje
    expect(marcadas()).toHaveLength(1);
    await irAlOtroViaje();
    expect(encabezado()).toContain('Mendoza'); // ya es el otro viaje
    expect(encabezado()).not.toContain('Rosario');
    expect(resultado()).toBeUndefined(); // sin la `key` por viaje, el «Quitaste 1 gasto» del viaje anterior quedaría acá
    expect(filas()).toHaveLength(1);
    expect(filas()[0]).toContain('del otro viaje');
    expect(marcadas()).toHaveLength(0);
  });

  it('un error del viaje anterior tampoco queda a la vista en el viaje nuevo (ni su «Reintentar»)', async () => {
    hayDosViajes();
    route.quitar = () => sinRed();
    await mount();
    await tocar(casilla('peaje norte'));
    await tocar(botonQuitar());
    expect(mensajes()).toHaveLength(1);
    expect(botonReintentar()).toBeDefined();
    await irAlOtroViaje();
    expect(encabezado()).toContain('Mendoza');
    expect(mensajes()).toEqual([]);
    expect(botonReintentar()).toBeUndefined();
  });

  it('el viaje nuevo manda lo suyo: quita del viaje de la URL de ahora, no del anterior', async () => {
    hayDosViajes();
    await mount();
    await irAlOtroViaje();
    await tocar(casilla('del otro viaje'));
    await tocar(botonQuitar());
    expect(envios()).toEqual([{ ids: [G(50)], viajeId: OTRO_VIAJE, valores: { viaje_id: null } }]);
  });
});

// ---------------------------------------------------------------------------
// Tamaños, colores y accesibilidad
// ---------------------------------------------------------------------------
describe('«Quitar gastos del viaje»: tamaños, colores y accesibilidad', () => {
  it('el botón principal: 56 px como mínimo (puede partir el rótulo en líneas), de todo el ancho, dos veces (celular fijo abajo y escritorio) y en cada ancho se ve UNA', async () => {
    await mount();
    expect(botonesDeQuitar()).toHaveLength(2);
    for (const b of botonesDeQuitar()) {
      expect(b.className).toContain('min-h-14');
      expect(b.className).toContain('w-full');
      expect(b.className).toContain('whitespace-normal');
    }
    const raiz = container.querySelector('div.space-y-5')!;
    const deEscritorio = [...raiz.children].find((el) => el.className.includes('max-md:hidden') && el.querySelector('button'))!;
    expect(deEscritorio.className).toContain('md:sticky'); // en escritorio acompaña a la lista
    const ultimo = raiz.lastElementChild as HTMLElement; // la barra fija es el ÚLTIMO hijo de la pantalla
    expect(ultimo.className).toContain('md:hidden');
    expect(ultimo.querySelector('.fixed')!.querySelector('button')).not.toBeNull();
    expect(deEscritorio.querySelectorAll('button')).toHaveLength(1);
    expect(ultimo.querySelectorAll('button')).toHaveLength(1);
  });

  it('el total y el botón van juntos, en una tarjeta con los colores del tema (la línea del total está arriba del botón)', async () => {
    await mount();
    await tocar(casilla('peaje norte'));
    const tarjeta = botonQuitar().parentElement!;
    expect(tarjeta.className).toContain('bg-card');
    expect(tarjeta.className).toContain('border-border');
    const total = tarjeta.querySelector('p')!;
    expect(total.textContent).toBe(`Suman ${formatNumber(1000, { decimales: 2 })}`);
    expect(total.className).toContain('tabular-nums');
    expect(total.compareDocumentPosition(botonQuitar()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('la barra fija del celular tiene aire extra debajo de la lista (es más alta que la de un solo botón)', async () => {
    await mount();
    const raiz = container.querySelector('div.space-y-5')!;
    const aire = [...raiz.children].find((el) => el.getAttribute('aria-hidden') === 'true' && el.className.includes('h-16'))!;
    expect(aire.className).toContain('md:hidden');
    expect(raiz.lastElementChild!.previousElementSibling).toBe(aire);
  });

  it('ningún color nuevo ni suelto: solo clases del tema (nada de paleta de Tailwind ni de colores en hexadecimal)', async () => {
    db.gastos = muchos(MAX_GASTOS_POR_VEZ + 1);
    route.quitar = (call) => quitarEnLaBase(call);
    await mount();
    await tocar(botonMarcarTodos()); // con el máximo marcado: se ven la línea del tope y las casillas apagadas
    const clases = [...container.querySelectorAll('[class]')].flatMap((el) => el.getAttribute('class')!.split(/\s+/));
    const paleta = /^(?:[a-z-]+:)*(?:bg|text|border|ring|fill|stroke|accent|outline|shadow|from|to|via|divide|decoration|caret)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|black|white)(?:-\d+)?(?:\/\d+)?$/;
    expect(clases.filter((c) => paleta.test(c))).toEqual([]);
    expect(clases.filter((c) => /#[0-9a-f]{3,8}|\brgb\(|\bhsl\(/i.test(c))).toEqual([]);
    expect(container.innerHTML).not.toMatch(/style="[^"]*(?:color|background)/i);
    await tocar(botonQuitar()); // y con el aviso del resultado a la vista
    const clasesDespues = [...container.querySelectorAll('[class]')].flatMap((el) => el.getAttribute('class')!.split(/\s+/));
    expect(clasesDespues.filter((c) => paleta.test(c))).toEqual([]);
  }, 60_000);

  it('ningún texto por debajo de 16 px (sin `text-xs` ni `text-sm`) y las cifras alineadas (`tabular-nums`)', async () => {
    await mount();
    await tocar(casilla('peaje norte'));
    expect(container.querySelectorAll('[class*="text-xs"], [class*="text-sm"]')).toHaveLength(0);
    expect(container.querySelectorAll('.tabular-nums').length).toBeGreaterThanOrEqual(5); // el monto de cada fila y el total
  });

  it('la línea del máximo es de 16 px o más y usa el color de apoyo del tema; es un aviso de estado (`role="status"`) para el lector de pantalla', async () => {
    db.gastos = muchos(MAX_GASTOS_POR_VEZ + 1);
    await mount();
    await tocar(botonMarcarTodos());
    for (const p of avisosDeMaximo()) {
      expect(p.className).toContain('text-base');
      expect(p.className).toContain('text-muted-foreground');
      expect(p.getAttribute('role')).toBe('status');
    }
  }, 60_000);

  it('el foco se ve en cada casilla (anillo) aunque la casilla de verdad esté oculta a la vista', async () => {
    await mount();
    const entrada = casillas()[0]!;
    expect(entrada.className).toContain('sr-only'); // fuera de la vista, pero con teclado y lector de pantalla
    expect(entrada.className).toContain('peer');
    const fila = entrada.closest('label')!.querySelector('span')!;
    expect(fila.className).toContain('peer-focus-visible:ring-2');
  });

  it('con el teclado: Tab llega a las casillas y la barra espaciadora marca (son casillas nativas)', async () => {
    await mount();
    const entrada = casillas()[0]!;
    expect(entrada.type).toBe('checkbox');
    entrada.focus();
    expect(document.activeElement).toBe(entrada);
    await tocar(entrada); // el clic es lo que hace el navegador con la barra espaciadora sobre una casilla nativa
    expect(entrada.checked).toBe(true);
  });

  it('cada casilla tiene nombre accesible: la categoría, la fecha y el monto de su fila', async () => {
    await mount();
    const nombre = textoDeFila(casillas()[0]!);
    expect(nombre).toContain('Peajes');
    expect(nombre).toContain('16 jun 2026');
    expect(nombre).toContain(formatNumber(1000, { decimales: 2 }));
  });

  it('los títulos son encabezados: h1 del título y h2 de la lista', async () => {
    await mount();
    expect([...document.querySelectorAll('h1, h2')].map((e) => `${e.tagName}:${e.textContent}`)).toEqual(['H1:Quitar gastos del viaje', 'H2:Gastos del viaje']);
  });

  it('los avisos de la parte de arriba son alertas informativas con ícono decorativo (no solo color)', async () => {
    db.gastos = muchos(LIST_LIMIT + 1);
    await mount();
    const informativos = [...document.querySelectorAll('[data-slot="alert"]')].filter((a) => /Puedes quitar hasta|Hay más de/.test(a.textContent ?? ''));
    expect(informativos).toHaveLength(2);
    for (const aviso of informativos) expect(aviso.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Reglas del código que no se pueden romper sin que una prueba lo note
// ---------------------------------------------------------------------------
describe('«Quitar gastos del viaje»: reglas del código de la pantalla', () => {
  const ARCHIVOS = [
    'quitar-gastos-page.tsx',
    'resultado-de-quitar.tsx',
    'quitar-gastos-resultado.ts',
    'seleccion-con-tope.ts',
    'use-seleccion-con-tope.ts',
    'quitar-gastos-textos.ts',
  ].map((nombre) => `src/features/gastos/${nombre}`);

  /** El código sin comentarios, para mirar solo lo que se ejecuta. */
  const codigo = (archivo: string) => readFileSync(archivo, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const pantalla = () => codigo('src/features/gastos/quitar-gastos-page.tsx');

  it('el estado de la pantalla NO depende de callbacks pasados a `mutate(…)` (no corren si la pantalla se desmonta): solo `mutateAsync` dentro de `useSubmitFeedback`', () => {
    expect(pantalla()).not.toMatch(/\.mutate\(/);
    expect(pantalla()).not.toMatch(/\bon(?:Success|Error|Settled)\b/);
    expect(pantalla()).toMatch(/quitar\.mutateAsync\(/);
    expect(pantalla()).toMatch(/useSubmitFeedback\(/);
  });

  it('las fechas se formatean SOLO con los helpers de `@/lib/dates` (la base acepta `infinity` y `Intl` tira `RangeError`): ni `Intl`, ni `toLocale…`, ni `new Date(`, ni `Date.parse`', () => {
    for (const archivo of ARCHIVOS) {
      expect(codigo(archivo), archivo).not.toMatch(/\bIntl\b|toLocale\w*\(|new Date\(|Date\.parse\(|Date\.UTC\(/);
    }
    expect(pantalla()).toMatch(/formatDateWithYear\(viaje\.fecha\)/);
    expect(codigo('src/features/gastos/gastos-para-elegir.tsx')).toMatch(/formatDateWithYear/);
  });

  it('el cliente nunca manda `transportista_id` ni arma consultas: la pantalla no nombra la base ni el tenant en lo que manda', () => {
    for (const archivo of ARCHIVOS) {
      expect(codigo(archivo), archivo).not.toMatch(/transportista_id\s*:/);
      expect(codigo(archivo), archivo).not.toMatch(/supabase/);
    }
  });

  it('no configura `retry` ni `networkMode`, no usa `useMutation` propio y no hay `any`, `@ts-ignore` ni `eslint-disable`', () => {
    for (const archivo of ARCHIVOS) {
      const fuente = readFileSync(archivo, 'utf8');
      expect(fuente, archivo).not.toMatch(/\b(?:retry|retryDelay|networkMode)\b\s*:/);
      expect(codigo(archivo), archivo).not.toMatch(/\buseMutation\(/);
      expect(fuente, archivo).not.toMatch(/@ts-ignore|@ts-expect-error|eslint-disable/);
      expect(codigo(archivo), archivo).not.toMatch(/(?::|\bas|<)\s*any\b/);
    }
  });

  it('nunca muestra el texto del servidor: ninguna pieza lee `error.message` ni `.details`; todo error pasa por `mapDataError`', () => {
    for (const archivo of ARCHIVOS) {
      expect(codigo(archivo), archivo).not.toMatch(/\.message\b|\.details\b|\.hint\b/);
    }
    expect(pantalla()).toMatch(/mapDataError\(/);
  });

  it('lo que se manda sale de `seleccion.idsParaEnviar` (selección ∩ lista de ahora), no de un conjunto guardado', () => {
    expect(pantalla()).toMatch(/const gastoIds = seleccion\.idsParaEnviar;/);
    expect(pantalla()).not.toMatch(/useRef<Set|new Set\(\[\.\.\.seleccion/);
  });

  it('el scope compartido se usa por su nombre (`useVinculosEnCurso`, `useQuitarGastosDelViaje`): ninguna pieza repite su identificador a mano', () => {
    for (const archivo of ARCHIVOS) expect(codigo(archivo), archivo).not.toMatch(/vincular-gastos/);
    expect(pantalla()).toMatch(/useVinculosEnCurso\(\)/);
    expect(pantalla()).toMatch(/useQuitarGastosDelViaje\(\)/);
  });

  it('el tope sale de `MAX_GASTOS_POR_VEZ` (no un 100 suelto en la pantalla)', () => {
    expect(pantalla()).toMatch(/useSeleccionConTope\(idsDe\(items\), MAX_GASTOS_POR_VEZ\)/);
    expect(pantalla()).not.toMatch(/\b100\b/);
  });

  it('no manda nada que no sea `selección ∩ lista`: ningún `slice` ni recorte de última hora sobre lo que se envía', () => {
    expect(pantalla()).not.toMatch(/\.slice\(/);
  });
});
