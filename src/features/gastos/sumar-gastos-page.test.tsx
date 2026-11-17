import { readFileSync } from 'node:fs';
import { act, useMemo, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation, useNavigate, type InitialEntry } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// «Sumar gastos que ya cargué»: la pantalla completa. Mock de supabase (un Proxy que anota cada método encadenado) con una «base»
// falsa que se comporta como la de verdad (los gastos sin viaje, y `vincular_gastos_a_viaje` con sus cinco resultados); el router,
// TanStack Query con su configuración real, los hooks, el miembro y la pantalla son código REAL.
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
import { COMBUSTIBLE_CATEGORIA_ID, MAX_GASTOS_POR_VEZ } from '@/features/gastos/constants';
import { gastosKeys } from '@/features/gastos/gastos-keys';
import { SumarGastosPage } from '@/features/gastos/sumar-gastos-page';
import { useQuitarGastosDelViaje, useVincularGastos } from '@/features/gastos/use-gasto-mutations';
import { resumenKeys } from '@/features/resumen/resumen-keys';
import { viajesKeys } from '@/features/viajes/viajes-keys';
import { todayLocal } from '@/lib/dates';
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
const SECRETO = 'relation "gastos" violates constraint secreto_interno_del_servidor';

const T = 'tenant-a';
const VIAJE = 'b0000000-0000-4000-8000-000000000001';
const CLIENTE = 'a0000000-0000-4000-8000-0000000000c1';
const CAMION_1 = 'c0000000-0000-4000-8000-000000000001';
const CAMION_2 = 'c0000000-0000-4000-8000-000000000002';
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
const CAMIONES = [
  { id: CAMION_1, patente: 'AB123CD', marca: 'Scania', modelo: null, anio: null, activa: true },
  { id: CAMION_2, patente: 'XY987ZT', marca: 'Volvo', modelo: null, anio: null, activa: true },
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
const gasto = (n: number, over: Partial<GastoDeLaBase> = {}): GastoDeLaBase => ({
  id: G(n),
  categoria_id: PEAJES,
  fecha: '2026-06-15',
  monto: 1000,
  descripcion: `gasto ${n}`,
  litros: null,
  camion_id: null,
  created_at: '2026-11-01T10:00:00+00:00',
  viaje_id: null,
  ...over,
});
/** Con el viaje del 15 de junio de 2026, por cercanía salen: G1 (1 día después), G2 (1 día antes), G3 (5 días antes) y G4 (muy lejos). */
const gastosPorDefecto = (): GastoDeLaBase[] => [
  gasto(1, { fecha: '2026-06-16', monto: 1000, descripcion: 'peaje norte' }),
  gasto(2, { fecha: '2026-06-14', monto: 2500.5, categoria_id: COMBUSTIBLE_CATEGORIA_ID, descripcion: null }),
  gasto(3, { fecha: '2026-06-10', monto: 300, categoria_id: LAVADO, descripcion: 'lavado del acoplado' }),
  gasto(4, { fecha: '2025-01-02', monto: 50, descripcion: 'muy viejo' }),
];
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
const esLecturaDeSueltos = (call: Call) => call.target === 'gastos' && ops(call).includes('is');
const esVincular = (call: Call) => call.target === 'rpc:vincular_gastos_a_viaje';
const esQuitar = (call: Call) => call.target === 'gastos' && ops(call).includes('update');
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

/** La lectura de los sin viaje: la mitad de «desde la fecha del viaje» (gte, ascendente) o la de «antes» (lt, descendente), 101 filas como mucho. */
function leerSueltosDeLaBase(call: Call): Resp {
  const gte = call.ops.find((o) => o.m === 'gte');
  const lt = call.ops.find((o) => o.m === 'lt');
  const sueltos = db.gastos.filter((g) => g.viaje_id === null);
  const filas = gte
    ? sueltos.filter((g) => g.fecha >= String(gte.args[1])).sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0))
    : sueltos.filter((g) => g.fecha < String(lt!.args[1])).sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0));
  return ok(filas.slice(0, MAX_GASTOS_POR_VEZ + 1).map(fila));
}

/** `vincular_gastos_a_viaje`, con las mismas respuestas que la función de la base (y los mismos cambios). */
function vincularEnLaBase(call: Call): Resp {
  const { p_viaje_id: viajeId, p_gasto_ids: ids } = argsDeVincular(call);
  const camionDelViaje = (db.viaje?.camion_id as string | null | undefined) ?? null;
  return ok(
    ids.map((gasto_id) => {
      const g = db.gastos.find((x) => x.id === gasto_id);
      if (!g) return { gasto_id, resultado: 'no_encontrado' };
      if (g.viaje_id === viajeId) return { gasto_id, resultado: 'ya_estaba' };
      if (g.viaje_id !== null) return { gasto_id, resultado: 'en_otro_viaje' };
      if (g.camion_id !== null && camionDelViaje !== null && g.camion_id !== camionDelViaje) return { gasto_id, resultado: 'camion_distinto' };
      g.viaje_id = viajeId;
      return { gasto_id, resultado: 'vinculado' };
    }),
  );
}

const route: { viaje: Handler; sueltos: Handler; categorias: Handler; camiones: Handler; vincular: Handler; quitar: Handler } = {
  viaje: () => ok(db.viaje),
  sueltos: leerSueltosDeLaBase,
  categorias: () => ok(CATS),
  camiones: () => ok(CAMIONES),
  vincular: vincularEnLaBase,
  quitar: () => ok([]),
};
function resetRoutes() {
  route.viaje = () => ok(db.viaje);
  route.sueltos = leerSueltosDeLaBase;
  route.categorias = () => ok(CATS);
  route.camiones = () => ok(CAMIONES);
  route.vincular = vincularEnLaBase;
  route.quitar = () => ok([]);
}

function installResponder() {
  h.state.responder = (call: Call) => {
    if (call.target === 'miembros') return ok(MIEMBRO);
    if (call.target === 'categorias_gasto') return route.categorias(call);
    if (call.target === 'camiones') return route.camiones(call);
    if (call.target === 'viajes') return route.viaje(call);
    if (esLecturaDeSueltos(call)) return route.sueltos(call);
    if (esVincular(call)) return route.vincular(call);
    if (esQuitar(call)) return route.quitar(call);
    throw new Error(`pedido inesperado: ${call.target} ${ops(call).join('.')}`);
  };
}

type Deferred = { promise: Promise<Resp>; resolve: (r: Resp) => void };
function deferred(): Deferred {
  let resolve!: (r: Resp) => void;
  const promise = new Promise<Resp>((r) => (resolve = r));
  return { promise, resolve };
}

const lecturasDeSueltos = () => h.calls.filter(esLecturaDeSueltos);
const envios = () => h.calls.filter(esVincular).map(argsDeVincular);

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

const RUTA = `/viajes/${VIAJE}/sumar-gastos`;

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
                  <Route path="/viajes/:id/sumar-gastos" element={<SumarGastosPage />} />
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
const marcadas = () => casillas().filter((c) => c.checked);
const botones = () => [...document.querySelectorAll<HTMLButtonElement>('button')];
const botonesConTexto = (patron: RegExp) => botones().filter((b) => patron.test(b.textContent?.trim() ?? ''));
/** Hay DOS (uno para el celular y otro para escritorio, solo uno se ve por ancho): se prueban siempre los dos. */
const botonesDeSumar = () => botonesConTexto(/^(?:Sumar (?:\d+ gastos?|gastos) al viaje|Sumando…|Un momento…)$/);
const botonSumar = () => botonesDeSumar()[0]!;
const botonMarcarTodos = () => botonesConTexto(/^(?:Marcar todos \(\d+\)|Desmarcar todos)$/)[0]!;
/** «Reintentar» (o «Reintentando…» si no se puede tocar porque hay algo en curso). */
const botonReintentar = () => botonesConTexto(/^Reintent(?:ar|ando…)$/)[0];
const alertas = () => [...document.querySelectorAll<HTMLElement>('[role="alert"]')];
/** Solo el mensaje de cada alerta, sin el texto del botón «Reintentar» que lleva adentro. */
const mensajes = () => alertas().map((a) => a.querySelector('[data-slot="alert-description"]')?.textContent ?? a.textContent ?? '');
/** El aviso del resultado de «Sumar» (`role="status"`). */
const resultado = () => [...document.querySelectorAll<HTMLElement>('[role="status"]')].find((e) => /Sumaste|No se sumó|ya estaba|ya estaban/.test(e.textContent ?? ''));
const links = () => [...document.querySelectorAll<HTMLAnchorElement>('a')];
const seccion = (titulo: string) => [...document.querySelectorAll('section')].find((s) => s.querySelector('h2')?.textContent === titulo) as HTMLElement | undefined;

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
describe('«Sumar gastos que ya cargué»: el encabezado', () => {
  it('el título, el viaje («Origen → Destino» y su fecha) debajo y un «Volver» al detalle del viaje', async () => {
    await mount();
    expect(document.querySelector('h1')!.textContent).toBe('Sumar gastos que ya cargué');
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
    await mount(`/viajes/${VIAJE.toUpperCase()}/sumar-gastos`);
    expect(filas()).toHaveLength(4);
    expect(links().some((a) => a.getAttribute('href') === `/viajes/${VIAJE}`)).toBe(true);
  });
});

describe('«Sumar gastos que ya cargué»: el viaje de la URL', () => {
  it('un id que no es uuid: «Viaje no encontrado», sin pedir NADA a la base, y el título sigue ahí', async () => {
    await mount('/viajes/no-es-un-uuid/sumar-gastos');
    expect(bodyText()).toContain('Viaje no encontrado');
    expect(document.querySelector('h1')!.textContent).toBe('Sumar gastos que ya cargué');
    expect(h.calls.filter((c) => c.target === 'viajes' || c.target === 'gastos')).toHaveLength(0);
    // el «Volver» lleva a la lista de viajes, no a un detalle que no existe
    expect(links().some((a) => a.getAttribute('href') === '/viajes' && a.textContent?.includes('Volver'))).toBe(true);
    expect(botonesDeSumar()).toHaveLength(0);
  });

  it('un viaje que no existe (o es de otra cuenta: la base no distingue): «Viaje no encontrado», sin lista ni botones', async () => {
    db.viaje = null;
    await mount();
    expect(bodyText()).toContain('Viaje no encontrado');
    expect(casillas()).toHaveLength(0);
    expect(botonesDeSumar()).toHaveLength(0);
    expect(lecturasDeSueltos()).toHaveLength(0); // sin saber la fecha del viaje no se pide la lista
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
    expect(botonesDeSumar()).toHaveLength(0);
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
    expect(document.querySelector('h1')!.textContent).toBe('Sumar gastos que ya cargué');
    expect(bodyText()).toContain('Rosario');
    expect(alertas()).toHaveLength(0);
  });

  it('un viaje con una fecha que no existe en el calendario (la base acepta `infinity`) no deja la pantalla colgada: ordena por hoy y se ve la lista', async () => {
    db.viaje = viajeDeLaBase({ fecha: 'infinity' });
    await mount();
    expect(bodyText()).toContain('infinity'); // se muestra tal cual, sin romper el dibujo
    expect(filas()).toHaveLength(4);
    expect(lecturasDeSueltos()).toHaveLength(2);
    const fechasPedidas = lecturasDeSueltos().map((c) => c.ops.find((o) => o.m === 'gte' || o.m === 'lt')!.args[1]);
    expect(fechasPedidas).toEqual([todayLocal(), todayLocal()]);
  });
});

// ---------------------------------------------------------------------------
// La lista
// ---------------------------------------------------------------------------
describe('«Sumar gastos que ya cargué»: la lista de los gastos sin viaje', () => {
  it('pide los que NO tienen viaje (`viaje_id is null`), en dos consultas de 101 filas, y sin ventana de días', async () => {
    await mount();
    const lecturas = lecturasDeSueltos();
    expect(lecturas).toHaveLength(2);
    for (const call of lecturas) {
      expect(call.ops.find((o) => o.m === 'is')!.args).toEqual(['viaje_id', null]);
      expect(call.ops.find((o) => o.m === 'limit')!.args).toEqual([101]);
    }
    expect(lecturas.map((c) => ops(c).includes('gte'))).toContain(true);
    expect(lecturas.map((c) => ops(c).includes('lt'))).toContain(true);
    // sin ventana: el gasto de hace año y medio también se ofrece
    expect(filas().some((f) => f.includes('muy viejo'))).toBe(true);
  });

  it('los más cercanos a la fecha del viaje primero: a igual distancia, el de fecha más reciente', async () => {
    await mount();
    expect(filas().map((f) => f.match(/peaje norte|Combustible|lavado del acoplado|muy viejo/)![0])).toEqual([
      'peaje norte', // 16 jun: 1 día después
      'Combustible', // 14 jun: 1 día antes
      'lavado del acoplado', // 10 jun: 5 días antes
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
    expect(alertas()).toHaveLength(0); // un aviso de categorías caídas sería un aviso de más: los nombres están a la vista
    expect(textoDeFila(casillas()[0]!)).toContain('Peajes');
    expect(filas()).toHaveLength(4);
  });

  it('la descripción larga, sin espacios, se corta donde haga falta (sin scroll horizontal) y a dos líneas', async () => {
    db.gastos = [gasto(1, { descripcion: 'x'.repeat(2000) })];
    await mount();
    const descripcion = [...document.querySelectorAll<HTMLElement>('label span')].find((s) => s.textContent === 'x'.repeat(2000))!;
    expect(descripcion.className).toContain('[overflow-wrap:anywhere]');
    expect(descripcion.className).toContain('line-clamp-2');
    // `line-clamp` ya es un bloque; un `block` de Tailwind lo desharía (el `display` va después en la hoja de estilos)
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
    expect(errorSpy).not.toHaveBeenCalled(); // nada se rompió al dibujar
  });

  it('cada fila mide 64 px o más y TODA la fila es la zona que se toca (una `label` con la casilla adentro)', async () => {
    await mount();
    for (const c of casillas()) {
      const etiqueta = c.closest('label')!;
      expect(etiqueta.querySelectorAll('input')).toHaveLength(1);
      const fila = etiqueta.querySelector('span')!;
      expect(fila.className).toContain('min-h-16');
      expect(fila.className).toContain('cursor-pointer');
      expect(etiqueta.textContent!.length).toBeGreaterThan(5); // el texto de la fila está dentro de la etiqueta, no al lado
    }
  });

  it('la casilla se ve grande (28 px) y marcada se distingue por el borde, el fondo y el TILDE (no solo por el color)', async () => {
    await mount();
    const recuadro = () => casillas()[0]!.closest('label')!.querySelector<HTMLElement>('span > span[aria-hidden="true"]')!;
    expect(recuadro().className).toContain('size-7');
    expect(recuadro().querySelector('svg')).toBeNull();
    const fila = () => casillas()[0]!.closest('label')!.querySelector('span')!;
    expect(fila().className).toContain('border-border');
    await tocar(casillas()[0]);
    expect(recuadro().querySelector('svg')).not.toBeNull(); // el tilde
    expect(fila().className).toContain('border-primary');
    expect(fila().className).toContain('bg-primary/10');
    expect(recuadro().className).toContain('bg-primary');
  });

  it('la lista es un grupo de casillas con nombre (`fieldset` + `legend`) y un título «Gastos sin viaje» con su ayuda', async () => {
    await mount();
    const grupo = document.querySelector('fieldset')!;
    expect(grupo.querySelector('legend')!.textContent).toBe('Gastos sin viaje');
    expect(grupo.querySelector('legend')!.className).toContain('sr-only');
    expect(seccion('Gastos sin viaje')).toBeDefined();
    expect(bodyText()).toContain('Marca los que fueron de este viaje.');
  });

  it('mientras la lista carga: un esqueleto, sin casillas ni botón de sumar; el viaje ya se ve', async () => {
    route.sueltos = () => new Promise<Resp>(() => {});
    await mount();
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(casillas()).toHaveLength(0);
    expect(botonesDeSumar()).toHaveLength(0);
    expect(bodyText()).toContain('Rosario');
  });

  it('sin gastos sin viaje: «No tienes gastos sin viaje.», un «Volver al viaje» bien a la vista y ningún botón de sumar', async () => {
    db.gastos = [gasto(1, { viaje_id: 'b0000000-0000-4000-8000-0000000000bb' })]; // los que tienen otro viaje no son candidatos
    await mount();
    expect(bodyText()).toContain('No tienes gastos sin viaje.');
    expect(bodyText()).toContain('Los gastos que anotes sin elegir un viaje aparecerán aquí.');
    expect(casillas()).toHaveLength(0);
    expect(botonesDeSumar()).toHaveLength(0);
    expect(botonMarcarTodos()).toBeUndefined();
    const botonVolver = links().filter((a) => a.textContent?.trim() === 'Volver al viaje' && a.className.includes('h-14'));
    expect(botonVolver).toHaveLength(1); // el botón grande del estado vacío (el «Volver» de arriba es el otro)
    expect(botonVolver[0]!.getAttribute('href')).toBe(`/viajes/${VIAJE}`);
    await tocar(botonVolver[0]);
    expect(byId('destino-detalle')).not.toBeNull();
  });

  it('si la lista falla y no hay datos: mensaje con «Reintentar», que vuelve a pedirla', async () => {
    let intento = 0;
    route.sueltos = (call) => {
      intento += 1;
      return intento <= 2 ? sinRed() : leerSueltosDeLaBase(call); // las dos mitades de la primera vuelta
    };
    await mount();
    expect(mensajes()[0]).toBe('No hay señal. Revisa la conexión y prueba de nuevo.');
    expect(casillas()).toHaveLength(0);
    expect(botonesDeSumar()).toHaveLength(0);
    await tocar(botonReintentar());
    expect(filas()).toHaveLength(4);
    expect(alertas()).toHaveLength(0);
  });

  it('si falla el REFRESCO de la lista y ya hay datos: la lista sigue a la vista, con el aviso y «Reintentar» (nada se pierde)', async () => {
    await mount();
    await tocar(casilla('peaje norte'));
    route.sueltos = () => sinRed();
    await invalidarLosGastos();
    expect(mensajes()).toEqual(['No hay señal. Revisa la conexión y prueba de nuevo.']);
    expect(filas()).toHaveLength(4); // la lista sigue
    expect(casilla('peaje norte').checked).toBe(true); // y lo marcado también
    expect(botonSumar().textContent).toBe('Sumar 1 gasto al viaje');
    expect(botonReintentar()).toBeDefined();
    route.sueltos = leerSueltosDeLaBase;
    await tocar(botonReintentar());
    expect(alertas()).toHaveLength(0);
    expect(filas()).toHaveLength(4);
    expect(casilla('peaje norte').checked).toBe(true);
  });

  it('con más gastos de los que entran (MAX_GASTOS_POR_VEZ + 1): se ven los 100 más cercanos y un aviso corto', async () => {
    db.gastos = Array.from({ length: MAX_GASTOS_POR_VEZ + 1 }, (_, i) => gasto(i + 1, { fecha: '2026-06-20', descripcion: `fila ${i + 1}` }));
    await mount();
    expect(casillas()).toHaveLength(MAX_GASTOS_POR_VEZ);
    expect(bodyText()).toContain('Hay más gastos sin viaje; aquí se ven los 100 más cercanos a la fecha del viaje.');
    expect(botonMarcarTodos().textContent).toBe('Marcar todos (100)');
  });

  it('con exactamente 100 gastos NO hay aviso (se ven todos)', async () => {
    db.gastos = Array.from({ length: MAX_GASTOS_POR_VEZ }, (_, i) => gasto(i + 1, { fecha: '2026-06-20', descripcion: `fila ${i + 1}` }));
    await mount();
    expect(casillas()).toHaveLength(MAX_GASTOS_POR_VEZ);
    expect(bodyText()).not.toContain('Hay más gastos sin viaje');
  });
});

// ---------------------------------------------------------------------------
// Marcar
// ---------------------------------------------------------------------------
describe('«Sumar gastos que ya cargué»: marcar', () => {
  it('NINGUNO viene marcado, y el botón de sumar está apagado con un renglón que dice por qué', async () => {
    await mount();
    expect(casillas()).toHaveLength(4);
    expect(marcadas()).toHaveLength(0);
    expect(botonesDeSumar()).toHaveLength(2);
    for (const b of botonesDeSumar()) {
      expect(b.disabled).toBe(true);
      expect(b.textContent).toBe('Sumar gastos al viaje');
    }
    expect(bodyText()).toContain('Marca los que quieres sumar.');
    expect(bodyText()).not.toContain('Suman ');
  });

  it('marcar uno: «Sumar 1 gasto al viaje» (singular) y «Suman …» con su monto', async () => {
    await mount();
    await tocar(casilla('peaje norte'));
    expect(marcadas()).toHaveLength(1);
    for (const b of botonesDeSumar()) {
      expect(b.disabled).toBe(false);
      expect(b.textContent).toBe('Sumar 1 gasto al viaje');
    }
    expect(bodyText()).toContain(`Suman ${formatNumber(1000, { decimales: 2 })}`);
    expect(bodyText()).not.toContain('Marca los que quieres sumar.');
  });

  it('marcar varios: plural y el total sumado en CENTAVOS enteros (0,1 + 0,2 da 0,30 y no 0,30000000000000004)', async () => {
    db.gastos = [gasto(1, { monto: 0.1, descripcion: 'uno' }), gasto(2, { monto: 0.2, descripcion: 'dos' }), gasto(3, { monto: 100.3, descripcion: 'tres' })];
    await mount();
    await tocar(casilla('uno'));
    await tocar(casilla('dos'));
    expect(botonSumar().textContent).toBe('Sumar 2 gastos al viaje');
    expect(bodyText()).toContain(`Suman ${formatNumber(0.3, { decimales: 2 })}`);
    await tocar(casilla('tres'));
    expect(bodyText()).toContain(`Suman ${formatNumber(100.6, { decimales: 2 })}`);
  });

  it('desmarcar vuelve atrás: al quedar sin nada, el botón se apaga otra vez', async () => {
    await mount();
    await tocar(casilla('peaje norte'));
    await tocar(casilla('peaje norte'));
    expect(marcadas()).toHaveLength(0);
    expect(botonSumar().disabled).toBe(true);
    expect(bodyText()).toContain('Marca los que quieres sumar.');
  });

  it('«Marcar todos (N)» marca todos los que se pueden sumar y pasa a «Desmarcar todos»; tocarlo desmarca todos', async () => {
    await mount();
    expect(botonMarcarTodos().textContent).toBe('Marcar todos (4)');
    await tocar(botonMarcarTodos());
    expect(marcadas()).toHaveLength(4);
    expect(botonMarcarTodos().textContent).toBe('Desmarcar todos');
    expect(botonSumar().textContent).toBe('Sumar 4 gastos al viaje');
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
});

// ---------------------------------------------------------------------------
// Los de otro camión
// ---------------------------------------------------------------------------
describe('«Sumar gastos que ya cargué»: los gastos de otro camión', () => {
  beforeEach(() => {
    db.viaje = viajeDeLaBase({ camion_id: CAMION_1 });
    db.gastos = [
      gasto(1, { fecha: '2026-06-16', descripcion: 'del mismo camión', camion_id: CAMION_1 }),
      gasto(2, { fecha: '2026-06-14', descripcion: 'sin camión', camion_id: null }),
      gasto(3, { fecha: '2026-06-13', descripcion: 'de otro camión', camion_id: CAMION_2, monto: 777 }),
      gasto(4, { fecha: '2026-06-12', descripcion: 'de otro camión también', camion_id: CAMION_2, monto: 5 }),
    ];
  });

  it('van APARTE, en «No se pueden sumar»: sin casilla y con el motivo y la patente («Es de otro camión (XY 987 ZT)»)', async () => {
    await mount();
    expect(filas()).toHaveLength(2); // solo los que se pueden sumar tienen casilla
    expect(filas().join(' ')).not.toContain('de otro camión');
    const aparte = seccion('No se pueden sumar')!;
    expect(aparte).toBeDefined();
    expect(aparte.querySelectorAll('input')).toHaveLength(0);
    const items = [...aparte.querySelectorAll('li')];
    expect(items).toHaveLength(2);
    expect(items[0]!.textContent).toContain('de otro camión');
    expect(items[0]!.textContent).toContain(formatNumber(777, { decimales: 2 }));
    expect(items[0]!.textContent).toContain('Es de otro camión (XY 987 ZT)');
    expect(items[1]!.textContent).toContain('Es de otro camión (XY 987 ZT)');
  });

  it('«Marcar todos (N)» cuenta solo los que se pueden sumar, y «Sumar» manda solo esos', async () => {
    await mount();
    expect(botonMarcarTodos().textContent).toBe('Marcar todos (2)');
    await tocar(botonMarcarTodos());
    expect(botonSumar().textContent).toBe('Sumar 2 gastos al viaje');
    await tocar(botonSumar());
    expect(envios()).toEqual([{ p_viaje_id: VIAJE, p_gasto_ids: [G(1), G(2)] }]);
  });

  it('si no se conoce la patente (la lista de camiones no cargó, o no lo tiene) dice solo «Es de otro camión»', async () => {
    route.camiones = () => sinRed();
    await mount();
    const motivos = [...seccion('No se pueden sumar')!.querySelectorAll('li p')].map((p) => p.textContent);
    expect(motivos).toEqual(['Es de otro camión', 'Es de otro camión']);
  });

  it('un camión que no está en la lista de camiones: «Es de otro camión», sin inventar una patente', async () => {
    db.gastos = [gasto(3, { camion_id: 'c0000000-0000-4000-8000-0000000000ee', descripcion: 'camión desconocido' })];
    await mount();
    expect(seccion('No se pueden sumar')!.textContent).toContain('Es de otro camión');
    expect(seccion('No se pueden sumar')!.textContent).not.toContain('(');
  });

  it('un viaje SIN camión no choca con ninguno: todos se pueden sumar y no hay sección aparte', async () => {
    db.viaje = viajeDeLaBase({ camion_id: null });
    await mount();
    expect(filas()).toHaveLength(4);
    expect(seccion('No se pueden sumar')).toBeUndefined();
  });

  it('si TODO lo que hay sin viaje es de otro camión: lo dice, no hay nada para marcar y no hay botón de sumar', async () => {
    db.gastos = [gasto(3, { camion_id: CAMION_2, descripcion: 'de otro camión' })];
    await mount();
    expect(bodyText()).toContain('Ninguno de estos gastos se puede sumar a este viaje.');
    expect(casillas()).toHaveLength(0);
    expect(botonMarcarTodos()).toBeUndefined();
    expect(botonesDeSumar()).toHaveLength(0);
    expect(seccion('No se pueden sumar')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Sumar
// ---------------------------------------------------------------------------
describe('«Sumar gastos que ya cargué»: sumar y su resultado', () => {
  it('manda los marcados, SIN repetir y en el orden de la lista (no en el que se tocaron), con el viaje de la URL y nada de transportista_id', async () => {
    await mount();
    await tocar(casilla('lavado del acoplado'));
    await tocar(casilla('peaje norte'));
    await tocar(botonSumar());
    expect(envios()).toEqual([{ p_viaje_id: VIAJE, p_gasto_ids: [G(1), G(3)] }]);
    expect(JSON.stringify(h.calls.filter(esVincular))).not.toContain('transportista');
  });

  it('el resultado: «Sumaste N gastos al viaje.» (role=status), la selección queda vacía y los sumados desaparecen de la lista', async () => {
    await mount();
    await tocar(casilla('peaje norte'));
    await tocar(casilla('lavado del acoplado'));
    await tocar(botonSumar());
    expect(resultado()!.textContent).toContain('Sumaste 2 gastos al viaje.');
    expect(resultado()!.getAttribute('role')).toBe('status');
    expect(resultado()!.textContent).not.toContain('ya estaba');
    expect(resultado()!.textContent).not.toContain('no se pudo');
    // se refrescó la lista: quedan los dos que no se sumaron, sin marcar
    expect(filas()).toHaveLength(2);
    expect(filas().join(' ')).not.toContain('peaje norte');
    expect(marcadas()).toHaveLength(0);
    expect(botonSumar().disabled).toBe(true);
    expect(botonSumar().textContent).toBe('Sumar gastos al viaje');
    expect(db.gastos.filter((g) => g.viaje_id === VIAJE).map((g) => g.id)).toEqual([G(1), G(3)]);
  });

  it('con 1 solo gasto: «Sumaste 1 gasto al viaje.» (singular)', async () => {
    await mount();
    await tocar(casilla('peaje norte'));
    await tocar(botonSumar());
    expect(resultado()!.textContent).toContain('Sumaste 1 gasto al viaje.');
    expect(resultado()!.textContent).not.toContain('gastos al viaje');
  });

  it('la pantalla NO vuelve sola: sigue en la misma ruta y ofrece «Volver al viaje» (un botón de 48 px) que lleva al detalle', async () => {
    await mount({ pathname: RUTA, state: { volver: '?mes=2025-06', desdeCliente: CLIENTE, volverCliente: '?q=alma' } });
    await tocar(casilla('peaje norte'));
    await tocar(botonSumar());
    expect(document.querySelector('h1')!.textContent).toBe('Sumar gastos que ya cargué');
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
    await tocar(botonSumar());
    const aviso = resultado()!.parentElement!;
    expect(aviso.getAttribute('tabindex')).toBe('-1');
    expect(document.activeElement).toBe(aviso);
    expect(scroll).toHaveBeenCalledWith({ block: 'center' });
    await settle(10);
    expect(resultado()).toBeDefined(); // no se cierra solo
  });

  it('resultado PARCIAL: lo sumado, lo que ya estaba y «M no se pudieron sumar:» con «Categoría · fecha: motivo», en el orden de la lista', async () => {
    db.gastos = [
      gasto(1, { fecha: '2026-06-16', descripcion: 'uno' }),
      gasto(2, { fecha: '2026-06-14', descripcion: 'dos', categoria_id: COMBUSTIBLE_CATEGORIA_ID }),
      gasto(3, { fecha: '2026-06-13', descripcion: 'tres', categoria_id: LAVADO }),
      gasto(4, { fecha: '2026-06-12', descripcion: 'cuatro' }),
      gasto(5, { fecha: '2026-06-11', descripcion: 'cinco' }),
      gasto(6, { fecha: '2026-06-10', descripcion: 'seis' }),
    ];
    route.vincular = (call) =>
      ok(
        argsDeVincular(call).p_gasto_ids.map((gasto_id, i) => ({
          gasto_id,
          resultado: ['vinculado', 'ya_estaba', 'en_otro_viaje', 'camion_distinto', 'no_encontrado', null][i],
        })),
      );
    await mount();
    await tocar(botonMarcarTodos());
    await tocar(botonSumar());
    const aviso = resultado()!;
    const parrafos = [...aviso.querySelectorAll('p')].map((p) => p.textContent);
    expect(parrafos).toEqual(['Sumaste 1 gasto al viaje.', '1 ya estaba en este viaje.', '4 no se pudieron sumar:']);
    expect([...aviso.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'Lavado · 13 jun 2026: Ya está en otro viaje.',
      'Peajes · 12 jun 2026: Es de otro camión.',
      'Peajes · 11 jun 2026: Ya no está disponible.',
      'Peajes · 10 jun 2026: No se pudo sumar. Inténtalo de nuevo.', // un resultado nulo (un trigger lo frenó) NUNCA es un éxito
    ]);
  });

  it('«no_encontrado» tiene UN solo texto: se borró o es de otra cuenta, la pantalla no lo distingue jamás', async () => {
    route.vincular = (call) => ok(argsDeVincular(call).p_gasto_ids.map((gasto_id) => ({ gasto_id, resultado: 'no_encontrado' })));
    await mount();
    await tocar(botonMarcarTodos());
    await tocar(botonSumar());
    const lineas = [...resultado()!.querySelectorAll('li')].map((li) => li.textContent!.split(': ')[1]);
    expect(lineas).toEqual(['Ya no está disponible.', 'Ya no está disponible.', 'Ya no está disponible.', 'Ya no está disponible.']);
    expect(bodyText()).not.toMatch(/borr|otra cuenta|ajen/i);
  });

  it('un solo gasto que no se pudo sumar: «1 no se pudo sumar:» (singular) y nada se cuenta como sumado', async () => {
    route.vincular = (call) => ok(argsDeVincular(call).p_gasto_ids.map((gasto_id) => ({ gasto_id, resultado: 'en_otro_viaje' })));
    await mount();
    await tocar(casilla('peaje norte'));
    await tocar(botonSumar());
    const parrafos = [...resultado()!.querySelectorAll('p')].map((p) => p.textContent);
    expect(parrafos).toEqual(['No se sumó ningún gasto.', '1 no se pudo sumar:']);
    expect(resultado()!.className).not.toContain('border-primary'); // no es un aviso de «salió bien»
    // el gasto sigue en la lista (no se sumó) y sin marcar
    expect(filas()).toHaveLength(4);
    expect(marcadas()).toHaveLength(0);
  });

  it('todo estaba ya sumado: «K ya estaban en este viaje.» y nada más', async () => {
    route.vincular = (call) => ok(argsDeVincular(call).p_gasto_ids.map((gasto_id) => ({ gasto_id, resultado: 'ya_estaba' })));
    await mount();
    await tocar(botonMarcarTodos());
    await tocar(botonSumar());
    const parrafos = [...resultado()!.querySelectorAll('p')].map((p) => p.textContent);
    expect(parrafos).toEqual(['4 ya estaban en este viaje.']);
    expect(resultado()!.className).toContain('border-primary/50');
  });

  it('si se suman todos los gastos: queda el aviso arriba y debajo «No tienes gastos sin viaje.», sin botón de sumar', async () => {
    await mount();
    await tocar(botonMarcarTodos());
    await tocar(botonSumar());
    expect(resultado()!.textContent).toContain('Sumaste 4 gastos al viaje.');
    expect(bodyText()).toContain('No tienes gastos sin viaje.');
    expect(botonesDeSumar()).toHaveLength(0);
    expect(casillas()).toHaveLength(0);
  });

  it('un segundo «Sumar» reemplaza el aviso anterior (no se acumulan)', async () => {
    await mount();
    await tocar(casilla('peaje norte'));
    await tocar(botonSumar());
    expect(resultado()!.textContent).toContain('Sumaste 1 gasto al viaje.');
    await tocar(casilla('lavado del acoplado'));
    await tocar(casilla('Combustible'));
    await tocar(botonSumar());
    const avisos = [...document.querySelectorAll('[role="status"]')].filter((e) => /Sumaste/.test(e.textContent ?? ''));
    expect(avisos).toHaveLength(1);
    expect(avisos[0]!.textContent).toContain('Sumaste 2 gastos al viaje.');
  });

  it('el Resumen y los gastos se refrescan (el viaje ya tiene esos gastos)', async () => {
    const invalidar = vi.spyOn(queryClient, 'invalidateQueries');
    await mount();
    await tocar(casilla('peaje norte'));
    await tocar(botonSumar());
    const claves = invalidar.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(claves).toContain(JSON.stringify(gastosKeys.all(T)));
    expect(claves).toContain(JSON.stringify(resumenKeys.all(T)));
  });
});

// ---------------------------------------------------------------------------
// Errores y «Reintentar»
// ---------------------------------------------------------------------------
describe('«Sumar gastos que ya cargué»: errores y «Reintentar»', () => {
  it('sin señal: texto propio de sumar (no habla de «lo escrito» ni nombra un botón), «Reintentar», y lo marcado se CONSERVA', async () => {
    route.vincular = () => sinRed();
    await mount();
    await tocar(casilla('peaje norte'));
    await tocar(casilla('Combustible'));
    await tocar(botonSumar());
    expect(mensajes()).toEqual(['No hay señal. Todavía NO se sumaron. Cuando tengas señal, inténtalo de nuevo.']);
    expect(botonReintentar()).toBeDefined();
    expect(marcadas()).toHaveLength(2); // sigue marcado para poder reintentar
    expect(botonSumar().textContent).toBe('Sumar 2 gastos al viaje');
    expect(resultado()).toBeUndefined();
    expect(h.calls.filter(esVincular)).toHaveLength(1); // sin reintento automático
  });

  const tiempoVencido = (): Resp => ({ data: null, error: { code: '', message: 'TimeoutError: The operation was aborted due to timeout' }, status: 0 });

  it('con el tiempo vencido y la escritura que NO llegó: «no sabemos si se sumaron…», «Reintentar» y, al reintentar, se suma (sin duplicar nada)', async () => {
    let intento = 0;
    route.vincular = (call) => {
      intento += 1;
      return intento === 1 ? tiempoVencido() : vincularEnLaBase(call);
    };
    await mount();
    await tocar(casilla('peaje norte'));
    await tocar(botonSumar());
    expect(mensajes()).toEqual(['La señal está lenta y no sabemos si se sumaron. Revisa el viaje o inténtalo de nuevo: si ya estaban sumados, no pasa nada.']);
    expect(marcadas()).toHaveLength(1); // la lista no cambió: sigue marcado
    await tocar(botonReintentar());
    expect(envios()).toEqual([
      { p_viaje_id: VIAJE, p_gasto_ids: [G(1)] },
      { p_viaje_id: VIAJE, p_gasto_ids: [G(1)] }, // la MISMA selección, porque sigue marcada y sigue en la lista
    ]);
    expect(resultado()!.textContent).toContain('Sumaste 1 gasto al viaje.');
  });

  it('con el tiempo vencido y la escritura que SÍ llegó: la lista se refresca sola, el gasto ya no es candidato y no queda nada que reintentar', async () => {
    route.vincular = (call) => {
      vincularEnLaBase(call); // la escritura llegó…
      return tiempoVencido(); // …pero se perdió la respuesta
    };
    await mount();
    await tocar(casilla('peaje norte'));
    await tocar(botonSumar());
    expect(mensajes()[0]).toContain('La señal está lenta y no sabemos si se sumaron.');
    expect(filas().join(' ')).not.toContain('peaje norte'); // la mutación falló, pero la lista se pidió igual (onSettled)
    expect(marcadas()).toHaveLength(0);
    expect(botonReintentar()).toBeUndefined(); // sin nada marcado, «Reintentar» no se ofrece (no hay qué mandar)
    expect(botonSumar().disabled).toBe(true);
  });

  it('«Reintentar» manda la selección de AHORA: lo que ya no está en la lista NO se reenvía', async () => {
    let intento = 0;
    route.vincular = (call) => {
      intento += 1;
      return intento === 1 ? sinRed() : vincularEnLaBase(call);
    };
    await mount();
    await tocar(casilla('peaje norte'));
    await tocar(casilla('Combustible'));
    await tocar(botonSumar());
    expect(botonReintentar()).toBeDefined();
    // mientras tanto, otro dispositivo sumó el de combustible: la lista se refresca y ya no está
    db.gastos.find((g) => g.id === G(2))!.viaje_id = VIAJE;
    await invalidarLosGastos();
    expect(filas().join(' ')).not.toContain('Combustible');
    expect(botonSumar().textContent).toBe('Sumar 1 gasto al viaje');
    await tocar(botonReintentar());
    expect(envios()).toEqual([
      { p_viaje_id: VIAJE, p_gasto_ids: [G(1), G(2)] },
      { p_viaje_id: VIAJE, p_gasto_ids: [G(1)] }, // solo lo que sigue en la lista y sigue marcado
    ]);
    expect(resultado()!.textContent).toContain('Sumaste 1 gasto al viaje.');
    expect(alertas()).toHaveLength(0); // el error se fue
  });

  it('«Reintentar» manda lo que está marcado AHORA: si se desmarcó uno después del error, ese no sale', async () => {
    let intento = 0;
    route.vincular = (call) => {
      intento += 1;
      return intento === 1 ? sinRed() : vincularEnLaBase(call);
    };
    await mount();
    await tocar(botonMarcarTodos());
    await tocar(botonSumar());
    await tocar(casilla('lavado del acoplado')); // se desmarca uno
    await tocar(casilla('muy viejo')); // y otro
    await tocar(botonReintentar());
    expect(envios()).toEqual([
      { p_viaje_id: VIAJE, p_gasto_ids: [G(1), G(2), G(3), G(4)] },
      { p_viaje_id: VIAJE, p_gasto_ids: [G(1), G(2)] },
    ]);
  });

  it('el error se conserva y el botón principal también sirve: un «Sumar» nuevo limpia el aviso del error', async () => {
    let intento = 0;
    route.vincular = (call) => {
      intento += 1;
      return intento === 1 ? sinRed() : vincularEnLaBase(call);
    };
    await mount();
    await tocar(casilla('peaje norte'));
    await tocar(botonSumar());
    expect(alertas()).toHaveLength(1);
    await tocar(botonSumar());
    expect(alertas()).toHaveLength(0);
    expect(resultado()!.textContent).toContain('Sumaste 1 gasto al viaje.');
  });

  it('un error después de un resultado reemplaza al resultado (nunca se ven los dos)', async () => {
    await mount();
    await tocar(casilla('peaje norte'));
    await tocar(botonSumar());
    expect(resultado()).toBeDefined();
    route.vincular = () => sinRed();
    await tocar(casilla('Combustible'));
    await tocar(botonSumar());
    expect(resultado()).toBeUndefined();
    expect(alertas()).toHaveLength(1);
  });

  it('sin nada marcado, «Reintentar» no se ofrece (no hay qué mandar); el aviso queda y se puede marcar y sumar de nuevo', async () => {
    route.vincular = () => sinRed();
    await mount();
    await tocar(casilla('peaje norte'));
    await tocar(botonSumar());
    expect(botonReintentar()).toBeDefined();
    await tocar(casilla('peaje norte')); // se desmarca
    expect(botonReintentar()).toBeUndefined();
    expect(mensajes()[0]).toContain('No hay señal. Todavía NO se sumaron.');
    expect(botonSumar().disabled).toBe(true);
    await tocar(casilla('peaje norte'));
    expect(botonSumar().disabled).toBe(false);
    expect(botonReintentar()).toBeDefined();
  });

  it('cuenta en solo lectura (PT402 / HTTP 402, clase «payment»): el mensaje general y SIN «Reintentar»', async () => {
    route.vincular = () => fail('PT402', SECRETO, 402);
    await mount();
    await tocar(casilla('peaje norte'));
    await tocar(botonSumar());
    expect(mensajes()).toEqual(['Tu cuenta está en modo de solo lectura: por ahora no se pueden guardar cambios.']);
    expect(botonReintentar()).toBeUndefined();
    expect(bodyText()).not.toContain('secreto_interno');
    expect(marcadas()).toHaveLength(1); // lo marcado se conserva
  });

  it('un 402 sin código también es «payment»: sin «Reintentar»', async () => {
    route.vincular = () => fail('', SECRETO, 402);
    await mount();
    await tocar(casilla('peaje norte'));
    await tocar(botonSumar());
    expect(mensajes()[0]).toContain('solo lectura');
    expect(botonReintentar()).toBeUndefined();
  });

  it('el viaje ya no existe (P0002): «Este viaje ya no existe.», sin «Reintentar»', async () => {
    route.vincular = () => fail('P0002', SECRETO, 500);
    await mount();
    await tocar(casilla('peaje norte'));
    await tocar(botonSumar());
    expect(mensajes()).toEqual(['Este viaje ya no existe.']);
    expect(botonReintentar()).toBeUndefined();
  });

  it('un error del servidor (500): el mensaje de siempre y «Reintentar»; nunca el texto que manda el servidor', async () => {
    route.vincular = () => fail('XX000', SECRETO, 500);
    await mount();
    await tocar(casilla('peaje norte'));
    await tocar(botonSumar());
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
      route.vincular = () => fail(code, SECRETO, status);
      await mount();
      await tocar(casilla('peaje norte'));
      await tocar(botonSumar());
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
describe('«Sumar gastos que ya cargué»: mientras hay un «Sumar» o un «Quitar» en curso', () => {
  it('mientras se envía: el botón dice «Sumando…» y está apagado, y no se pueden tocar las casillas ni «Marcar todos»', async () => {
    const enCamino = deferred();
    route.vincular = async (call) => {
      await enCamino.promise;
      return vincularEnLaBase(call);
    };
    await mount();
    await tocar(casilla('peaje norte'));
    await tocar(botonSumar());
    expect(envios()).toHaveLength(1);
    expect(botonesDeSumar()).toHaveLength(2);
    for (const b of botonesDeSumar()) {
      expect(b.disabled).toBe(true);
      expect(b.textContent?.trim()).toBe('Sumando…');
      expect(b.getAttribute('aria-busy')).toBe('true');
    }
    expect(casillas().every((c) => c.disabled)).toBe(true);
    expect(botonMarcarTodos().disabled).toBe(true);
    expect(document.querySelector('[role="status"].sr-only')?.textContent).toContain('Sumando…');
    // y al terminar todo se habilita otra vez
    await act(async () => {
      enCamino.resolve(ok(null));
    });
    await settle(8);
    expect(resultado()!.textContent).toContain('Sumaste 1 gasto al viaje.');
    expect(casillas().every((c) => !c.disabled)).toBe(true);
    expect(botonMarcarTodos().disabled).toBe(false);
  });

  it('dos toques seguidos (antes de que la pantalla se vuelva a dibujar) mandan UN solo pedido', async () => {
    const enCamino = deferred();
    route.vincular = async (call) => {
      await enCamino.promise;
      return vincularEnLaBase(call);
    };
    await mount();
    await tocar(casilla('peaje norte'));
    const boton = botonSumar();
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

  it('un «Quitar» en vuelo (de otra pantalla o de un montaje anterior) también apaga «Sumar» aunque haya marcados, con un texto NEUTRO: «Un momento…» (decir «Sumando…» sería mentira)', async () => {
    const quitando = deferred();
    route.quitar = () => quitando.promise;
    await mount();
    await tocar(casilla('peaje norte'));
    expect(botonSumar().disabled).toBe(false);
    await act(async () => {
      otra.quitar!.mutate({ tenantId: T, viajeId: VIAJE, gastoIds: [G(2)] });
    });
    await settle(4);
    expect(botonesDeSumar()).toHaveLength(2);
    for (const b of botonesDeSumar()) {
      expect(b.disabled).toBe(true);
      expect(b.textContent?.trim()).toBe('Un momento…');
      expect(b.getAttribute('aria-busy')).toBe('true');
    }
    expect(document.querySelector('[role="status"].sr-only')?.textContent).toBe('Un momento…');
    expect(casillas().every((c) => c.disabled)).toBe(true);
    await tocar(botonSumar()); // un toque sobre un botón apagado no manda nada
    expect(envios()).toHaveLength(0);
    await act(async () => {
      quitando.resolve(ok([{ id: G(2) }]));
    });
    await settle(8);
    expect(botonSumar().disabled).toBe(false); // terminó: se puede volver a sumar
    expect(casilla('peaje norte').checked).toBe(true); // y lo marcado seguía ahí
  });

  it('un «Sumar» de OTRO montaje en vuelo también cuenta (no lo conoce el hook de esta pantalla, pero sí el scope) y dice «Un momento…» (esta pantalla no lo lanzó)', async () => {
    const enCamino = deferred();
    route.vincular = async (call) => {
      await enCamino.promise;
      return vincularEnLaBase(call);
    };
    await mount();
    await tocar(casilla('peaje norte'));
    await act(async () => {
      otra.vincular!.mutate({ tenantId: T, viajeId: VIAJE, gastoIds: [G(2)] });
    });
    await settle(4);
    expect(botonesDeSumar()).toHaveLength(2);
    expect(botonesDeSumar().every((b) => b.disabled && b.textContent?.trim() === 'Un momento…')).toBe(true);
    expect(document.querySelector('[role="status"].sr-only')?.textContent).toBe('Un momento…');
    await act(async () => {
      enCamino.resolve(ok(null));
    });
    await settle(8);
    expect(botonSumar().disabled).toBe(false);
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
      otra.vincular!.mutate({ tenantId: T, viajeId: VIAJE, gastoIds: [G(3)] }); // en cola detrás de la anterior
    });
    await settle(4);
    expect(otra.vincular!.isPending).toBe(true);
    expect(envios()).toHaveLength(0); // la segunda todavía no salió
    expect(botonesDeSumar().every((b) => b.disabled)).toBe(true);
    await act(async () => {
      primera.resolve(ok([{ id: G(2) }]));
    });
    await settle(8);
    expect(envios()).toHaveLength(1); // ahora corre la segunda
    expect(botonesDeSumar().every((b) => b.disabled)).toBe(true); // y mientras corre sigue apagado
    await act(async () => {
      segunda.resolve(ok(null));
    });
    await settle(8);
    expect(botonSumar().disabled).toBe(false);
  });

  it('«Reintentar» tampoco se puede tocar con algo en curso (y no manda nada)', async () => {
    route.vincular = () => sinRed();
    await mount();
    await tocar(casilla('peaje norte'));
    await tocar(botonSumar());
    expect(botonReintentar()).toBeDefined();
    const quitando = deferred();
    route.quitar = () => quitando.promise;
    await act(async () => {
      otra.quitar!.mutate({ tenantId: T, viajeId: VIAJE, gastoIds: [G(2)] });
    });
    await settle(4);
    expect(botonReintentar()!.disabled).toBe(true);
    await tocar(botonReintentar());
    expect(envios()).toHaveLength(1); // solo el primero, el que falló
    await act(async () => {
      quitando.resolve(ok([]));
    });
    await settle(6);
  });

  it('si la pantalla se desmonta con el pedido en vuelo no pasa nada raro: la escritura se hace, los datos se refrescan y React no avisa de nada', async () => {
    const invalidar = vi.spyOn(queryClient, 'invalidateQueries');
    const enCamino = deferred();
    route.vincular = async (call) => {
      await enCamino.promise;
      return vincularEnLaBase(call);
    };
    await mount();
    await tocar(casilla('peaje norte'));
    await tocar(botonSumar());
    expect(envios()).toHaveLength(1);
    await desmontar(); // se va de la pantalla con el pedido en camino
    await act(async () => {
      enCamino.resolve(ok(null));
    });
    await settle(8);
    expect(db.gastos.find((g) => g.id === G(1))!.viaje_id).toBe(VIAJE); // la escritura se aplicó igual
    const claves = invalidar.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey));
    expect(claves).toContain(JSON.stringify(gastosKeys.all(T))); // y los datos quedaron marcados como viejos (no depende de un callback de la pantalla)
    // (el `afterEach` comprueba además que React no escribió ningún aviso)
  });
});

// ---------------------------------------------------------------------------
// La selección sigue a la lista
// ---------------------------------------------------------------------------
describe('«Sumar gastos que ya cargué»: la selección sigue a la lista', () => {
  it('si la lista se refresca y un gasto marcado ya no está, deja de estar marcado y NO se manda', async () => {
    await mount();
    await tocar(casilla('peaje norte'));
    await tocar(casilla('Combustible'));
    expect(botonSumar().textContent).toBe('Sumar 2 gastos al viaje');
    db.gastos.find((g) => g.id === G(2))!.viaje_id = VIAJE; // otro dispositivo lo sumó
    await invalidarLosGastos();
    expect(filas()).toHaveLength(3);
    expect(marcadas().map(textoDeFila)).toHaveLength(1);
    expect(botonSumar().textContent).toBe('Sumar 1 gasto al viaje');
    expect(bodyText()).toContain(`Suman ${formatNumber(1000, { decimales: 2 })}`);
    await tocar(botonSumar());
    expect(envios()).toEqual([{ p_viaje_id: VIAJE, p_gasto_ids: [G(1)] }]);
  });

  it('si ese gasto VUELVE a aparecer en la lista, vuelve SIN marcar (nunca se suma algo que no se marcó)', async () => {
    await mount();
    await tocar(casilla('peaje norte'));
    await tocar(casilla('Combustible'));
    db.gastos.find((g) => g.id === G(2))!.viaje_id = VIAJE;
    await invalidarLosGastos();
    expect(filas().join(' ')).not.toContain('Combustible');
    db.gastos.find((g) => g.id === G(2))!.viaje_id = null; // lo quitaron del viaje desde otro lado
    await invalidarLosGastos();
    expect(filas().join(' ')).toContain('Combustible');
    expect(casilla('Combustible').checked).toBe(false);
    expect(casilla('peaje norte').checked).toBe(true);
    expect(botonSumar().textContent).toBe('Sumar 1 gasto al viaje');
  });

  it('un refresco que no cambia la lista no pierde lo marcado', async () => {
    await mount();
    await tocar(casilla('peaje norte'));
    await tocar(casilla('lavado del acoplado'));
    await invalidarLosGastos();
    expect(lecturasDeSueltos()).toHaveLength(4); // se volvió a pedir
    expect(marcadas()).toHaveLength(2);
    expect(botonSumar().textContent).toBe('Sumar 2 gastos al viaje');
  });

  it('si se refresca la lista y se queda sin nada marcado, el botón se apaga solo', async () => {
    await mount();
    await tocar(casilla('peaje norte'));
    db.gastos.find((g) => g.id === G(1))!.viaje_id = VIAJE;
    await invalidarLosGastos();
    expect(marcadas()).toHaveLength(0);
    expect(botonSumar().disabled).toBe(true);
    expect(botonSumar().textContent).toBe('Sumar gastos al viaje');
  });

  it('después de un «Sumar» que sale bien, lo que sigue en la lista queda SIN marcar (hay que marcarlo a propósito)', async () => {
    route.vincular = (call) => ok(argsDeVincular(call).p_gasto_ids.map((gasto_id) => ({ gasto_id, resultado: 'en_otro_viaje' })));
    await mount();
    await tocar(casilla('peaje norte'));
    await tocar(botonSumar());
    expect(filas()).toHaveLength(4); // nada salió de la lista
    expect(marcadas()).toHaveLength(0); // pero la selección se vació
  });
});

// ---------------------------------------------------------------------------
// Cambiar de viaje con la pantalla abierta
// ---------------------------------------------------------------------------
// Con la pantalla abierta la URL puede pasar de un viaje a otro sin desmontarla (p. ej. un salto de varias páginas atrás en el
// historial del celular): es la MISMA ruta con otro `:id`. Lo que quedó del viaje anterior (el aviso de lo que se sumó, un error)
// no puede aparecer bajo el encabezado del viaje nuevo: confundiría a quien lo lee («Sumaste 1 gasto al viaje» ¿a cuál?). Lo
// garantiza la `key` por viaje de `SumarGastosPage`.
describe('«Sumar gastos que ya cargué»: cambiar de viaje con la pantalla abierta', () => {
  const OTRO_VIAJE = 'b0000000-0000-4000-8000-000000000002';
  const RUTA_OTRO = `/viajes/${OTRO_VIAJE}/sumar-gastos`;

  /**
   * Cada viaje con lo suyo: la «base» contesta según el id que se pide. Y el otro viaje YA está en la caché (como si se hubiera visto
   * hace un momento): al cambiar de URL se dibuja de inmediato, SIN pasar por el esqueleto de «cargando», que por sí solo desmontaría
   * la parte con estado. Así lo único que reinicia ese estado es la `key` por viaje (y eso es lo que se prueba): si algún día el viaje
   * se guarda en caché o se muestra el anterior mientras carga, el esqueleto ya no estaría para hacerlo.
   */
  function hayDosViajes() {
    const otro = viajeDeLaBase({ id: OTRO_VIAJE, origen: 'Mendoza', destino: 'Salta', fecha: '2026-07-01' });
    route.viaje = (call) => {
      const id = call.ops.find((o) => o.m === 'eq' && o.args[0] === 'id')?.args[1];
      return ok(id === OTRO_VIAJE ? otro : db.viaje);
    };
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
    await tocar(botonSumar());
    expect(resultado()!.textContent).toContain('Sumaste 1 gasto al viaje.');
    await tocar(casilla('lavado del acoplado')); // algo marcado justo cuando se cambia de viaje
    expect(marcadas()).toHaveLength(1);
    await irAlOtroViaje();
    expect(encabezado()).toContain('Mendoza'); // ya es el otro viaje
    expect(encabezado()).not.toContain('Rosario');
    expect(resultado()).toBeUndefined(); // sin la `key` por viaje, el «Sumaste 1 gasto» del viaje anterior quedaría acá
    expect(marcadas()).toHaveLength(0);
  });

  it('un error del viaje anterior tampoco queda a la vista en el viaje nuevo (ni su «Reintentar»)', async () => {
    hayDosViajes();
    route.vincular = () => sinRed();
    await mount();
    await tocar(casilla('peaje norte'));
    await tocar(botonSumar());
    expect(mensajes()).toHaveLength(1);
    expect(botonReintentar()).toBeDefined();
    await irAlOtroViaje();
    expect(encabezado()).toContain('Mendoza');
    expect(mensajes()).toEqual([]);
    expect(botonReintentar()).toBeUndefined();
  });

  it('el viaje nuevo manda lo suyo: suma al viaje de la URL de ahora, no al anterior', async () => {
    hayDosViajes();
    await mount();
    await irAlOtroViaje();
    await tocar(casilla('lavado del acoplado'));
    await tocar(botonSumar());
    expect(envios()).toEqual([{ p_viaje_id: OTRO_VIAJE, p_gasto_ids: [G(3)] }]);
  });
});

// ---------------------------------------------------------------------------
// Tamaños, colores y accesibilidad
// ---------------------------------------------------------------------------
describe('«Sumar gastos que ya cargué»: tamaños, colores y accesibilidad', () => {
  it('el botón principal: 56 px como mínimo (puede partir el rótulo en líneas), de todo el ancho, dos veces (celular fijo abajo y escritorio) y en cada ancho se ve UNA', async () => {
    await mount();
    expect(botonesDeSumar()).toHaveLength(2);
    for (const b of botonesDeSumar()) {
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
    const tarjeta = botonSumar().parentElement!;
    expect(tarjeta.className).toContain('bg-card');
    expect(tarjeta.className).toContain('border-border');
    const total = tarjeta.querySelector('p')!;
    expect(total.textContent).toBe(`Suman ${formatNumber(1000, { decimales: 2 })}`);
    expect(total.className).toContain('tabular-nums');
    expect(total.compareDocumentPosition(botonSumar()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('la barra fija del celular tiene aire extra debajo de la lista (es más alta que la de un solo botón)', async () => {
    await mount();
    const raiz = container.querySelector('div.space-y-5')!;
    const aire = [...raiz.children].find((el) => el.getAttribute('aria-hidden') === 'true' && el.className.includes('h-16'))!;
    expect(aire.className).toContain('md:hidden');
    expect(raiz.lastElementChild!.previousElementSibling).toBe(aire);
  });

  it('ningún color nuevo ni suelto: solo clases del tema (nada de paleta de Tailwind ni de colores en hexadecimal)', async () => {
    db.viaje = viajeDeLaBase({ camion_id: CAMION_1 });
    db.gastos = [...gastosPorDefecto(), gasto(9, { camion_id: CAMION_2, descripcion: 'otro camión' })];
    route.vincular = (call) => ok(argsDeVincular(call).p_gasto_ids.map((gasto_id, i) => ({ gasto_id, resultado: i === 0 ? 'vinculado' : 'en_otro_viaje' })));
    await mount();
    await tocar(botonMarcarTodos());
    await tocar(botonSumar());
    const clases = [...container.querySelectorAll('[class]')].flatMap((el) => el.getAttribute('class')!.split(/\s+/));
    const paleta = /^(?:[a-z-]+:)*(?:bg|text|border|ring|fill|stroke|accent|outline|shadow|from|to|via|divide|decoration|caret)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|black|white)(?:-\d+)?(?:\/\d+)?$/;
    expect(clases.filter((c) => paleta.test(c))).toEqual([]);
    expect(clases.filter((c) => /#[0-9a-f]{3,8}|\brgb\(|\bhsl\(/i.test(c))).toEqual([]);
    expect(container.innerHTML).not.toMatch(/style="[^"]*(?:color|background)/i);
  });

  it('ningún texto por debajo de 16 px (sin `text-xs` ni `text-sm`) y las cifras alineadas (`tabular-nums`)', async () => {
    await mount();
    await tocar(casilla('peaje norte'));
    expect(container.querySelectorAll('[class*="text-xs"], [class*="text-sm"]')).toHaveLength(0);
    expect(container.querySelectorAll('.tabular-nums').length).toBeGreaterThanOrEqual(5); // el monto de cada fila y el total
  });

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

  it('los títulos son encabezados: h1 del título y h2 de cada sección', async () => {
    db.viaje = viajeDeLaBase({ camion_id: CAMION_1 });
    db.gastos = [gasto(1, { camion_id: CAMION_1 }), gasto(2, { camion_id: CAMION_2 })];
    await mount();
    expect([...document.querySelectorAll('h1, h2')].map((e) => `${e.tagName}:${e.textContent}`)).toEqual([
      'H1:Sumar gastos que ya cargué',
      'H2:Gastos sin viaje',
      'H2:No se pueden sumar',
    ]);
  });
});

// ---------------------------------------------------------------------------
// Reglas del código que no se pueden romper sin que una prueba lo note
// ---------------------------------------------------------------------------
describe('«Sumar gastos que ya cargué»: reglas del código de la pantalla', () => {
  const ARCHIVOS = [
    'sumar-gastos-page.tsx',
    'gastos-para-elegir.tsx',
    'resultado-de-sumar.tsx',
    'sumar-gastos-resultado.ts',
    'sumar-gastos-seleccion.ts',
    'use-seleccion-de-gastos.ts',
    'use-vinculos-en-curso.ts',
    'sumar-gastos-textos.ts',
  ].map((nombre) => `src/features/gastos/${nombre}`);

  /** El código sin comentarios, para mirar solo lo que se ejecuta. */
  const codigo = (archivo: string) => readFileSync(archivo, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const pantalla = () => codigo('src/features/gastos/sumar-gastos-page.tsx');

  it('el estado de la pantalla NO depende de callbacks pasados a `mutate(…)` (no corren si la pantalla se desmonta): solo `mutateAsync` dentro de `useSubmitFeedback`', () => {
    expect(pantalla()).not.toMatch(/\.mutate\(/);
    expect(pantalla()).not.toMatch(/\bon(?:Success|Error|Settled)\b/);
    expect(pantalla()).toMatch(/vincular\.mutateAsync\(/);
    expect(pantalla()).toMatch(/useSubmitFeedback\(/);
  });

  it('las fechas se formatean SOLO con los helpers de `@/lib/dates` (la base acepta `infinity` y `Intl` tira `RangeError`): ni `Intl`, ni `toLocale…`, ni `new Date(`, ni `Date.parse`', () => {
    for (const archivo of ARCHIVOS) {
      expect(codigo(archivo), archivo).not.toMatch(/\bIntl\b|toLocale\w*\(|new Date\(|Date\.parse\(|Date\.UTC\(/);
    }
    expect(codigo('src/features/gastos/gastos-para-elegir.tsx')).toMatch(/formatDateWithYear/);
    expect(codigo('src/features/gastos/sumar-gastos-resultado.ts')).toMatch(/formatDateWithYear/);
    expect(pantalla()).toMatch(/formatDateWithYear\(viaje\.fecha\)/);
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
});
