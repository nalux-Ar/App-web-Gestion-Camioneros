import { readFileSync } from 'node:fs';
import { act, useMemo, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation, useNavigate, type InitialEntry } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// «Sumar varios a un viaje»: la pantalla completa (los dos pasos). Mock de supabase (un Proxy que anota cada método encadenado) con una
// «base» falsa que se comporta como la de verdad (la lista de gastos de un mes, la de viajes de un mes, los camiones y la función
// `vincular_gastos_a_viaje`); el router, TanStack Query con su configuración real, los hooks, el miembro y la pantalla son código REAL.
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
import { SumarAViajePage } from '@/features/gastos/sumar-a-viaje-page';
import { SCOPE_DE_VINCULOS, useQuitarGastosDelViaje, useVincularGastos } from '@/features/gastos/use-gasto-mutations';
import { viajesKeys } from '@/features/viajes/viajes-keys';
import { LIST_LIMIT as LIST_LIMIT_VIAJES } from '@/features/viajes/constants';
import { formatMonthLabel, todayLocal } from '@/lib/dates';
import { limpiarErroresRecientes } from '@/lib/errores-recientes';
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
const V = (n: number) => `b0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const G = (n: number) => `e0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const C1 = 'c0000000-0000-4000-8000-000000000001';
const C2 = 'c0000000-0000-4000-8000-000000000002';
const PEAJES = '210b4f00-fdb4-499b-bf15-79ebe2aaf3c3';
const LAVADO = '210b4f00-fdb4-499b-bf15-79ebe2aaf3c4';
const OTRA_CATEGORIA = '210b4f00-fdb4-499b-bf15-79ebe2aaf3c9';
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
  { id: C1, patente: 'AB123CD', marca: null, modelo: null, anio: null, activa: true },
  { id: C2, patente: 'EF456GH', marca: null, modelo: null, anio: null, activa: true },
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
  viajes: { origen: string; destino: string } | null;
}
/** Por defecto un gasto SIN viaje de junio de 2026. */
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
  viajes: null,
  ...over,
});
/** Del más nuevo al más viejo: G1, G2, G3 sueltos y G4 que ya está en un viaje (no se ofrece). */
const gastosPorDefecto = (): GastoDeLaBase[] => [
  gasto(1, { fecha: '2026-06-16', monto: 1000, descripcion: 'peaje norte' }),
  gasto(2, { fecha: '2026-06-14', monto: 2500.5, categoria_id: COMBUSTIBLE_CATEGORIA_ID, descripcion: null }),
  gasto(3, { fecha: '2026-06-10', monto: 300, categoria_id: LAVADO, descripcion: 'lavado del acoplado' }),
  gasto(4, { fecha: '2026-06-05', monto: 50, descripcion: 'ya en un viaje', viaje_id: V(1), viajes: { origen: 'Rosario', destino: 'Córdoba' } }),
  gasto(10, { fecha: '2026-05-10', monto: 700, descripcion: 'gasto de mayo' }),
];
/** `cantidad` gastos SIN viaje con la MISMA fecha y `created_at` descendente: salen en el orden de su número (`fila-001`, `fila-002`…). */
const muchos = (cantidad: number, over: Partial<GastoDeLaBase> = {}): GastoDeLaBase[] =>
  Array.from({ length: cantidad }, (_, i) =>
    gasto(i + 1, {
      fecha: '2026-06-20',
      descripcion: `fila-${String(i + 1).padStart(3, '0')}`,
      created_at: new Date(Date.UTC(2026, 10, 1, 10, 0, 0) - i * 1000).toISOString(),
      ...over,
    }),
  );

interface ViajeDeLaBase {
  id: string;
  camion_id: string | null;
  fecha: string;
  origen: string;
  destino: string;
  created_at: string;
}
const viaje = (n: number, over: Partial<ViajeDeLaBase> = {}): ViajeDeLaBase => ({
  id: V(n),
  camion_id: null,
  fecha: '2026-06-15',
  origen: `Origen ${n}`,
  destino: `Destino ${n}`,
  created_at: '2026-06-15T10:00:00+00:00',
  ...over,
});
const viajesPorDefecto = (): ViajeDeLaBase[] => [
  viaje(1, { fecha: '2026-06-15', origen: 'Rosario', destino: 'Córdoba' }),
  viaje(2, { fecha: '2026-06-10', origen: 'Salta', destino: 'Jujuy' }),
  viaje(3, { fecha: '2026-05-20', origen: 'Mendoza', destino: 'San Juan' }),
];

const db: { gastos: GastoDeLaBase[]; viajes: ViajeDeLaBase[]; camiones: typeof CAMIONES } = { gastos: [], viajes: [], camiones: [] };

type Handler = (call: Call) => unknown;
const ops = (call: Call) => call.ops.map((o) => o.m);
const argDe = (call: Call, metodo: string, columna?: string) =>
  call.ops.find((o) => o.m === metodo && (columna === undefined || o.args[0] === columna))?.args;
const esLecturaDeGastos = (call: Call) => call.target === 'gastos' && ops(call).includes('gte');
const esLecturaDeViajes = (call: Call) => call.target === 'viajes' && ops(call).includes('gte');
const esVincular = (call: Call) => call.target === 'rpc:vincular_gastos_a_viaje';
const argsDeVincular = (call: Call) => call.ops.find((o) => o.m === 'rpc')!.args[0] as { p_viaje_id: string; p_gasto_ids: string[] };

const masNuevoPrimero = (a: { fecha: string; created_at: string }, b: { fecha: string; created_at: string }) =>
  a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0;

/** La lista de gastos de un mes (con la categoría, si la piden): fecha descendente y `created_at` descendente, con el `limit` que se pida. */
function leerGastosDelMes(call: Call): Resp {
  const desde = argDe(call, 'gte', 'fecha')![1] as string;
  const hasta = argDe(call, 'lt', 'fecha')![1] as string;
  const categoria = argDe(call, 'eq', 'categoria_id')?.[1];
  const limite = argDe(call, 'limit')![0] as number;
  return ok(
    db.gastos
      .filter((g) => g.fecha >= desde && g.fecha < hasta && (categoria === undefined || g.categoria_id === categoria))
      .sort(masNuevoPrimero)
      .slice(0, limite)
      .map((g) => ({ ...g })), // copias: como la base, cada lectura trae objetos nuevos (si no, un cambio hecho a mano en la «base» cambiaría también lo ya guardado en la caché)
  );
}

/** La lista de viajes de un mes: fecha descendente, con el embed `entregas(count)` en 0. */
function leerViajesDelMes(call: Call): Resp {
  const desde = argDe(call, 'gte', 'fecha')![1] as string;
  const hasta = argDe(call, 'lt', 'fecha')![1] as string;
  const limite = argDe(call, 'limit')![0] as number;
  return ok(
    db.viajes
      .filter((v) => v.fecha >= desde && v.fecha < hasta)
      .sort(masNuevoPrimero)
      .slice(0, limite)
      .map((v) => ({ ...v, km_inicial: null, km_final: null, km_recorridos: null, ingreso: null, entregas: [{ count: 0 }] })),
  );
}

/** `vincular_gastos_a_viaje`: mueve lo suelto al viaje (respeta el camión) y contesta una fila por gasto. */
function vincularEnLaBase(call: Call): Resp {
  const { p_viaje_id: viajeId, p_gasto_ids: ids } = argsDeVincular(call);
  const destino = db.viajes.find((v) => v.id === viajeId);
  return ok(
    ids.map((gasto_id) => {
      const g = db.gastos.find((x) => x.id === gasto_id);
      if (!g) return { gasto_id, resultado: 'no_encontrado' };
      if (g.viaje_id === viajeId) return { gasto_id, resultado: 'ya_estaba' };
      if (g.viaje_id !== null) return { gasto_id, resultado: 'en_otro_viaje' };
      if (g.camion_id !== null && destino?.camion_id != null && g.camion_id !== destino.camion_id) return { gasto_id, resultado: 'camion_distinto' };
      g.viaje_id = viajeId;
      return { gasto_id, resultado: 'vinculado' };
    }),
  );
}

const route: { gastos: Handler; viajes: Handler; categorias: Handler; camiones: Handler; vincular: Handler; quitar: Handler } = {
  gastos: leerGastosDelMes,
  viajes: leerViajesDelMes,
  categorias: () => ok(CATS),
  camiones: () => ok(db.camiones),
  vincular: vincularEnLaBase,
  quitar: () => ok([]),
};
function resetRoutes() {
  route.gastos = leerGastosDelMes;
  route.viajes = leerViajesDelMes;
  route.categorias = () => ok(CATS);
  route.camiones = () => ok(db.camiones);
  route.vincular = vincularEnLaBase;
  route.quitar = () => ok([]);
}

function installResponder() {
  h.state.responder = (call: Call) => {
    if (call.target === 'miembros') return ok(MIEMBRO);
    if (call.target === 'categorias_gasto') return route.categorias(call);
    if (call.target === 'camiones') return route.camiones(call);
    if (call.target === 'gastos' && ops(call).includes('update')) return route.quitar(call); // un «Quitar» de otra pantalla
    if (esLecturaDeViajes(call)) return route.viajes(call);
    if (esLecturaDeGastos(call)) return route.gastos(call);
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

const lecturasDeGastos = () => h.calls.filter(esLecturaDeGastos);
const lecturasDeViajes = () => h.calls.filter(esLecturaDeViajes);
/** Lo que se mandó en cada «Sumar»: el viaje y los ids. */
const envios = () => h.calls.filter(esVincular).map(argsDeVincular);
const idsEnviados = () => envios().map((e) => e.p_gasto_ids);

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
  return <div id={`destino-${nombre}`} data-pathname={location.pathname} data-search={location.search} data-state={JSON.stringify(location.state ?? null)} />;
}

/** Dónde está el router ahora (la ruta y el `search`): sirve para ver cómo cambia la URL al tocar el mes o la categoría. */
function Ubicacion() {
  const location = useLocation();
  return <div id="ubicacion" data-pathname={location.pathname} data-search={location.search} />;
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

/** Deja a mano el `navigate` del router: sirve para cambiar de URL con la pantalla YA montada (como el botón «atrás»). */
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

const RUTA_BASE = '/gastos/sumar-a-viaje';
const RUTA = `${RUTA_BASE}?mes=2026-06`;
const JUNIO = formatMonthLabel({ year: 2026, month: 6 });
const MAYO = formatMonthLabel({ year: 2026, month: 5 });

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
                <Ubicacion />
                <Routes>
                  <Route path="/gastos/sumar-a-viaje" element={<SumarAViajePage />} />
                  <Route path="/gastos" element={<Destino nombre="gastos" />} />
                  <Route path="/viajes/:id" element={<Destino nombre="viaje" />} />
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
  db.viajes = viajesPorDefecto();
  db.camiones = [];
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
const ubicacion = () => ({ pathname: byId('ubicacion')!.dataset.pathname, search: byId('ubicacion')!.dataset.search });
const casillas = () => [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
const textoDeFila = (c: HTMLInputElement) => c.closest('label')?.textContent ?? '';
const filas = () => casillas().map(textoDeFila);
/** La casilla de la fila que contiene este texto (cada fila de prueba tiene una descripción o una categoría propias). */
function casilla(texto: string): HTMLInputElement {
  const encontradas = casillas().filter((c) => textoDeFila(c).includes(texto));
  if (encontradas.length !== 1) throw new Error(`casillas con «${texto}»: ${encontradas.length}`);
  return encontradas[0]!;
}
const casillaN = (n: number) => casilla(`fila-${String(n).padStart(3, '0')}`);
const marcadas = () => casillas().filter((c) => c.checked);
const radios = () => [...document.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
const textoDeOpcion = (r: HTMLInputElement) => r.closest('li')?.textContent ?? '';
/** La opción de viaje que contiene este texto. */
function opcion(texto: string): HTMLInputElement {
  const encontradas = radios().filter((r) => textoDeOpcion(r).includes(texto));
  if (encontradas.length !== 1) throw new Error(`opciones con «${texto}»: ${encontradas.length}`);
  return encontradas[0]!;
}
const botones = () => [...document.querySelectorAll<HTMLButtonElement>('button')];
const botonesConTexto = (patron: RegExp) => botones().filter((b) => patron.test(b.textContent?.trim() ?? ''));
/** Hay DOS de cada botón principal (uno para el celular y otro para escritorio, solo uno se ve por ancho): se prueban siempre los dos. */
const botonesDeElegir = () => botonesConTexto(/^(?:Elegir el viaje|Un momento…)$/);
const botonElegir = () => botonesDeElegir()[0]!;
const botonesDeSumar = () => botonesConTexto(/^(?:Sumar (?:\d+ gastos?|gastos) a este viaje|Sumando…|Un momento…)$/);
const botonSumar = () => botonesDeSumar()[0]!;
const botonMarcarTodos = () => botonesConTexto(/^(?:Marcar todos \(\d+\)|Marcar los primeros \d+|Desmarcar todos)$/)[0]!;
const botonVolverDelPaso2 = () => botones().find((b) => b.textContent?.trim().startsWith('Volver'))!;
const botonMes = (cual: 'anterior' | 'siguiente') => document.querySelector<HTMLButtonElement>(`button[aria-label="Mes ${cual}"]`)!;
/** «Reintentar» (o «Reintentando…» si no se puede tocar porque hay algo en curso). */
const botonReintentar = () => botonesConTexto(/^Reintent(?:ar|ando…)$/)[0];
const alertas = () => [...document.querySelectorAll<HTMLElement>('[role="alert"]')];
/** Solo el mensaje de cada alerta, sin el texto del botón «Reintentar» que lleva adentro. */
const mensajes = () => alertas().map((a) => a.querySelector('[data-slot="alert-description"]')?.textContent ?? a.textContent ?? '');
/** El aviso del resultado de «Sumar» (`role="status"`). */
const resultado = () =>
  [...document.querySelectorAll<HTMLElement>('[role="status"]')].find((e) => /Sumaste|No se sumó|ya estaba|ya estaban|no se pudo|no se pudieron/.test(e.textContent ?? ''));
const parrafosDelResultado = () => [...resultado()!.querySelectorAll('p')].map((p) => p.textContent);
const links = () => [...document.querySelectorAll<HTMLAnchorElement>('a')];
/** El ÚLTIMO enlace con ese texto (el «Volver» de arriba también se llama «Volver a Gastos» para el lector de pantalla: el del contenido va después). */
const enlaceCon = (texto: string) => links().filter((a) => a.textContent?.trim() === texto).at(-1);
const AVISO_100 = `Marcaste ${MAX_GASTOS_POR_VEZ}, el máximo por vez. Desmarca uno para elegir otro.`;
const avisosDeMaximo = () => [...document.querySelectorAll<HTMLElement>('p[role="status"]')].filter((p) => p.textContent === AVISO_100);
const estaEnElPaso2 = () => [...document.querySelectorAll('h2')].some((e) => e.textContent === '¿A qué viaje?');
const estaEnElPaso1 = () => [...document.querySelectorAll('h2')].some((e) => e.textContent === 'Gastos sin viaje');
const AVISO_DESMARCADO_MES = 'Cambiaste el mes: se desmarcó lo que habías marcado.';
const AVISO_DESMARCADO_CATEGORIA = 'Cambiaste la categoría: se desmarcó lo que habías marcado.';
const lineasDeAvisoDesmarcado = () =>
  [...document.querySelectorAll<HTMLElement>('p[role="status"]')].filter((p) => /se desmarcó lo que habías marcado/.test(p.textContent ?? ''));
const selectDeCategoria = () => document.querySelector<HTMLSelectElement>('select')!;

async function tocar(el: HTMLElement | null | undefined) {
  if (!el) throw new Error('no se encontró el elemento a tocar');
  await act(async () => {
    el.click();
  });
  await settle(6);
}

/** Cambia el valor de un `<select>` como lo hace el navegador (React escucha el evento `change`). */
async function elegirCategoria(valor: string) {
  const select = selectDeCategoria();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, valor);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await settle(6);
}

async function invalidarLosGastos() {
  await act(async () => {
    await queryClient.invalidateQueries({ queryKey: gastosKeys.all(T) });
  });
  await settle(6);
}
async function invalidarLosViajes() {
  await act(async () => {
    await queryClient.invalidateQueries({ queryKey: viajesKeys.all(T) });
  });
  await settle(6);
}

/** Marca estos gastos por su texto y pasa al segundo paso. */
async function marcarYElegirViaje(...textos: string[]) {
  for (const texto of textos) await tocar(casilla(texto));
  await tocar(botonElegir());
}
/** Marca, pasa al segundo paso y elige el viaje. */
async function hastaElegirViaje(textos: string[], textoDelViaje: string) {
  await marcarYElegirViaje(...textos);
  await tocar(opcion(textoDelViaje));
}

// ---------------------------------------------------------------------------
// Encabezado, filtros leídos de la URL y el primer paso
// ---------------------------------------------------------------------------
describe('«Sumar varios a un viaje»: el encabezado', () => {
  it('el título, su botón «Ayuda» y un «Volver» a Gastos con el mismo mes (el link y el botón de abajo, la lista ya cargada)', async () => {
    await mount();
    expect(document.querySelector('h1')!.textContent).toBe('Sumar gastos a un viaje');
    const ayuda = document.querySelector<HTMLButtonElement>('button[aria-label="Ayuda de esta pantalla"]')!;
    expect(ayuda.textContent!.trim()).toBe('Ayuda');
    const volver = links().find((a) => a.textContent?.trim().startsWith('Volver'))!;
    expect(volver.getAttribute('href')).toBe('/gastos?mes=2026-06');
    expect(volver.textContent?.trim()).toBe('Volver a Gastos'); // a la vista dice solo «Volver»
    expect(volver.className).toContain('min-h-12');
    expect(volver.querySelector('.sr-only')!.textContent?.trim()).toBe('a Gastos');
  });

  it('el «Volver» lleva a Gastos con el mismo search: el mes y la categoría', async () => {
    await mount(`${RUTA}&categoria=${PEAJES}`);
    const volver = links().find((a) => a.textContent?.trim().startsWith('Volver'))!;
    expect(volver.getAttribute('href')).toBe(`/gastos?mes=2026-06&categoria=${PEAJES}`);
    await tocar(volver);
    expect(byId('destino-gastos')).not.toBeNull();
    expect(byId('destino-gastos')!.dataset.search).toBe(`?mes=2026-06&categoria=${PEAJES}`);
  });

  it('sin mes en la URL, el mes de hoy y un «Volver» a /gastos limpio', async () => {
    await mount(RUTA_BASE);
    expect(links().find((a) => a.textContent?.trim().startsWith('Volver'))!.getAttribute('href')).toBe('/gastos');
    const rango = lecturasDeGastos()[0]!;
    expect(argDe(rango, 'gte', 'fecha')![1]).toBe(`${todayLocal().slice(0, 7)}-01`);
  });

  it('un mes inválido en la URL (o fuera de rango) se ignora: el mes de hoy', async () => {
    for (const mal of ['?mes=2026-13', '?mes=abc', '?mes=1999-01', '?mes=2999-01']) {
      h.calls.length = 0;
      await mount(`${RUTA_BASE}${mal}`);
      expect(argDe(lecturasDeGastos()[0]!, 'gte', 'fecha')![1], mal).toBe(`${todayLocal().slice(0, 7)}-01`);
      await desmontar();
      queryClient.clear();
    }
  });
});

describe('«Sumar varios a un viaje»: los gastos (primer paso)', () => {
  it('pide la lista del mes de la URL (del más nuevo al más viejo, con el tope de la lista) y NO pide viajes todavía', async () => {
    await mount();
    const lecturas = lecturasDeGastos();
    expect(lecturas).toHaveLength(1);
    const call = lecturas[0]!;
    expect(argDe(call, 'gte', 'fecha')![1]).toBe('2026-06-01');
    expect(argDe(call, 'lt', 'fecha')![1]).toBe('2026-07-01');
    expect(call.ops.filter((o) => o.m === 'order').map((o) => o.args)).toEqual([
      ['fecha', { ascending: false }],
      ['created_at', { ascending: false }],
      ['id', { ascending: true }],
    ]);
    expect(argDe(call, 'limit')).toEqual([LIST_LIMIT + 1]);
    expect(argDe(call, 'eq', 'categoria_id')).toBeUndefined();
    expect(lecturasDeViajes()).toHaveLength(0); // los viajes se piden recién al pasar al segundo paso
  });

  it('D3: muestra solo los gastos SIN viaje; el que ya está en un viaje no aparece, y una línea lo dice', async () => {
    await mount();
    expect(filas()).toHaveLength(3);
    expect(filas().join(' ')).not.toContain('ya en un viaje');
    expect(bodyText()).toContain('Los gastos que ya están en un viaje no aparecen aquí. Para sacarlos, entra al viaje.');
  });

  it('los más nuevos primero, y cada fila muestra la categoría, la fecha (con año), el monto (con «$») y la descripción si tiene', async () => {
    await mount();
    expect(filas().map((f) => f.match(/peaje norte|Combustible|lavado del acoplado/)![0])).toEqual(['peaje norte', 'Combustible', 'lavado del acoplado']);
    const primera = textoDeFila(casillas()[0]!);
    expect(primera).toContain('Peajes');
    expect(primera).toContain('16 jun 2026');
    expect(primera).toContain('$\u00a01.000');
    expect(primera.match(/\$/g)).toHaveLength(1);
  });

  it('NINGUNO viene marcado: «Elegir el viaje» apagado (dos copias) y, en lugar del total, el motivo', async () => {
    await mount();
    expect(marcadas()).toHaveLength(0);
    expect(botonesDeElegir()).toHaveLength(2);
    for (const b of botonesDeElegir()) expect(b.disabled).toBe(true);
    expect(bodyText()).toContain('Marca los que quieres sumar.');
    expect(bodyText()).not.toContain('Suman ');
  });

  it('marcar uno o varios: «Elegir el viaje» se habilita y la tarjeta dice cuánto suman (en centavos enteros)', async () => {
    db.gastos = [gasto(1, { monto: 0.1 }), gasto(2, { monto: 0.2 })];
    await mount();
    await tocar(casillas()[0]!);
    await tocar(casillas()[1]!);
    expect(botonElegir().disabled).toBe(false);
    expect(bodyText()).toContain(`Suman $\u00a00,30`);
    expect(bodyText()).not.toContain('0,30000000000000004');
  });

  it('desmarcar vuelve atrás: al quedar sin nada, el botón se apaga otra vez', async () => {
    await mount();
    await tocar(casilla('peaje norte'));
    expect(botonElegir().disabled).toBe(false);
    await tocar(casilla('peaje norte'));
    expect(botonElegir().disabled).toBe(true);
    expect(bodyText()).toContain('Marca los que quieres sumar.');
  });

  it('«Marcar todos (N)» marca todos los sueltos (no el que ya tiene viaje) y pasa a «Desmarcar todos»; tocarlo desmarca todos', async () => {
    await mount();
    expect(botonMarcarTodos().textContent).toBe('Marcar todos (3)');
    await tocar(botonMarcarTodos());
    expect(marcadas()).toHaveLength(3);
    expect(botonMarcarTodos().textContent).toBe('Desmarcar todos');
    await tocar(botonMarcarTodos());
    expect(marcadas()).toHaveLength(0);
  });

  it('«Marcar todos» tiene 48 px y ocupa todo el ancho en el celular', async () => {
    await mount();
    expect(botonMarcarTodos().className).toContain('w-full');
    expect(botonMarcarTodos().className).not.toContain('h-8');
  });

  it('la lista es un grupo de casillas con nombre («Gastos sin viaje») bajo un título h2 con su ayuda', async () => {
    await mount();
    const grupo = document.querySelector('fieldset:has(input[type="checkbox"])')!;
    expect(grupo.querySelector('legend')!.textContent).toBe('Gastos sin viaje');
    expect(grupo.querySelector('legend')!.className).toContain('sr-only');
    expect([...document.querySelectorAll('h1, h2')].map((e) => `${e.tagName}:${e.textContent}`)).toEqual(['H1:Sumar gastos a un viaje', 'H2:Gastos sin viaje']);
    expect(bodyText()).toContain('Marca los que quieres poner en un viaje.');
  });

  it('la categoría: el selector filtra la lista (la categoría viaja a la consulta) y sigue en la URL; con una categoría de la URL, la lista espera a las categorías', async () => {
    await mount(`${RUTA}&categoria=${LAVADO}`);
    expect(selectDeCategoria().value).toBe(LAVADO);
    expect(argDe(lecturasDeGastos()[0]!, 'eq', 'categoria_id')![1]).toBe(LAVADO);
    expect(filas()).toHaveLength(1);
    expect(filas()[0]).toContain('lavado del acoplado');
  });

  it('con una categoría en la URL la lista ESPERA a las categorías: no pide ninguna lista hasta poder validarla (y después pide la filtrada)', async () => {
    const lentas = deferred();
    route.categorias = () => lentas.promise;
    await mount(`${RUTA}&categoria=${LAVADO}`);
    expect(lecturasDeGastos()).toHaveLength(0);
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(botonesDeElegir()).toHaveLength(0);
    await act(async () => {
      lentas.resolve(ok(CATS));
    });
    await settle(8);
    expect(lecturasDeGastos()).toHaveLength(1);
    expect(argDe(lecturasDeGastos()[0]!, 'eq', 'categoria_id')![1]).toBe(LAVADO);
  });

  it('con una categoría en la URL y las categorías caídas: no se pide ninguna lista (no se filtra por algo sin validar), se avisa con «Reintentar» y, al recuperarse, se pide', async () => {
    let intento = 0;
    route.categorias = () => {
      intento += 1;
      return intento === 1 ? sinRed() : ok(CATS);
    };
    await mount(`${RUTA}&categoria=${LAVADO}`);
    expect(lecturasDeGastos()).toHaveLength(0);
    expect(mensajes()[0]).toBe('No pudimos cargar las categorías. No hay señal. Revisa la conexión y prueba de nuevo.');
    expect(casillas()).toHaveLength(0);
    expect(botonesDeElegir()).toHaveLength(0);
    await tocar(botonReintentar());
    expect(lecturasDeGastos()).toHaveLength(1);
    expect(filas()).toHaveLength(1);
  });

  it('una categoría de la URL que no existe se ignora, igual que en Gastos: se pide y se muestra la lista sin filtrar', async () => {
    await mount(`${RUTA}&categoria=${OTRA_CATEGORIA}`);
    expect(selectDeCategoria().value).toBe('');
    expect(filas()).toHaveLength(3);
    // la última lista pedida es la de «todas las categorías»
    expect(argDe(lecturasDeGastos().at(-1)!, 'eq', 'categoria_id')).toBeUndefined();
  });

  it('una categoría de la URL que no es un uuid se ignora (no viaja a la consulta)', async () => {
    await mount(`${RUTA}&categoria=%27%3Bdrop`);
    expect(lecturasDeGastos().every((c) => argDe(c, 'eq', 'categoria_id') === undefined)).toBe(true);
    expect(filas()).toHaveLength(3);
  });

  it('sin gastos en el mes: «No hay gastos en junio 2026.», un «Volver a Gastos» a la vista y ningún botón de elegir', async () => {
    db.gastos = [];
    await mount();
    expect(bodyText()).toContain(`No hay gastos en ${JUNIO}.`);
    expect(botonesDeElegir()).toHaveLength(0);
    expect(casillas()).toHaveLength(0);
    const volver = enlaceCon('Volver a Gastos')!;
    expect(volver.getAttribute('href')).toBe('/gastos?mes=2026-06');
    expect(volver.className).toContain('h-14'); // el botón grande, como el de los otros estados vacíos
  });

  it('con una categoría y sin gastos: «No hay gastos de esa categoría en junio 2026.» y el «Volver a Gastos» conserva la categoría', async () => {
    db.gastos = gastosPorDefecto().filter((g) => g.categoria_id !== LAVADO);
    await mount(`${RUTA}&categoria=${LAVADO}`);
    expect(bodyText()).toContain(`No hay gastos de esa categoría en ${JUNIO}.`);
    expect(enlaceCon('Volver a Gastos')!.getAttribute('href')).toBe(`/gastos?mes=2026-06&categoria=${LAVADO}`);
  });

  it('con todos los gastos en un viaje: «Todos los gastos de junio 2026 ya están en un viaje.» y «Volver a Gastos»', async () => {
    db.gastos = [gasto(1, { viaje_id: V(1) }), gasto(2, { viaje_id: V(2) })];
    await mount();
    expect(bodyText()).toContain(`Todos los gastos de ${JUNIO} ya están en un viaje.`);
    expect(enlaceCon('Volver a Gastos')).toBeDefined();
    expect(botonesDeElegir()).toHaveLength(0);
  });

  it('mientras la lista carga: un esqueleto, sin casillas ni botón de elegir', async () => {
    route.gastos = () => new Promise<Resp>(() => {});
    await mount();
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(botonesDeElegir()).toHaveLength(0);
    expect(casillas()).toHaveLength(0);
  });

  it('si la lista falla y no hay datos: mensaje con «Reintentar», que vuelve a pedirla; sin botón de elegir mientras tanto', async () => {
    let intento = 0;
    route.gastos = (call) => {
      intento += 1;
      return intento === 1 ? sinRed() : leerGastosDelMes(call);
    };
    await mount();
    expect(mensajes()[0]).toBe('No hay señal. Revisa la conexión y prueba de nuevo.');
    expect(casillas()).toHaveLength(0);
    expect(botonesDeElegir()).toHaveLength(0);
    await tocar(botonReintentar());
    expect(filas()).toHaveLength(3);
    expect(alertas()).toHaveLength(0);
  });

  it('si falla el REFRESCO de la lista y ya hay datos: la lista y el botón siguen a la vista, con el aviso y «Reintentar» (nada se pierde)', async () => {
    await mount();
    await tocar(casilla('peaje norte'));
    route.gastos = () => sinRed();
    await invalidarLosGastos();
    expect(filas()).toHaveLength(3);
    expect(casilla('peaje norte').checked).toBe(true); // y lo marcado también
    expect(botonesDeElegir()).toHaveLength(2);
    expect(mensajes()[0]).toBe('No hay señal. Revisa la conexión y prueba de nuevo.');
    expect(botonReintentar()).toBeDefined();
  });

  it('si fallan las categorías: los gastos se ven con el nombre genérico, el selector apagado y un aviso con «Reintentar»', async () => {
    let intento = 0;
    route.categorias = () => {
      intento += 1;
      return intento === 1 ? sinRed() : ok(CATS);
    };
    await mount();
    expect(mensajes()[0]).toBe('No pudimos cargar las categorías. No hay señal. Revisa la conexión y prueba de nuevo.');
    expect(filas()).toHaveLength(3);
    expect(textoDeFila(casillas()[0]!)).toMatch(/^Gasto/);
    expect(selectDeCategoria().disabled).toBe(true);
    await tocar(botonReintentar());
    expect(alertas()).toHaveLength(0);
    expect(selectDeCategoria().disabled).toBe(false);
  });

  it('fechas raras (`infinity`) no rompen la lista', async () => {
    db.gastos = [gasto(1, { fecha: 'infinity' })];
    route.gastos = () => ok(db.gastos);
    await mount();
    expect(bodyText()).toContain('infinity');
    expect(filas()).toHaveLength(1);
  });

  it('el «Volver» de arriba lleva a Gastos con el mismo search', async () => {
    await mount();
    await tocar(links().find((a) => a.textContent?.trim().startsWith('Volver')));
    expect(byId('destino-gastos')).not.toBeNull();
    expect(byId('destino-gastos')!.dataset.search).toBe('?mes=2026-06');
  });
});

// ---------------------------------------------------------------------------
// D2: cambiar el mes o la categoría desmarca todo
// ---------------------------------------------------------------------------
describe('«Sumar varios a un viaje»: cambiar el mes o la categoría desmarca todo (D2)', () => {
  it('cambiar el MES con algo marcado: se desmarca todo, la URL cambia con `replace` y una línea avisa (role=status)', async () => {
    await mount();
    await tocar(casilla('peaje norte'));
    await tocar(casilla('Combustible'));
    await tocar(botonMes('anterior'));
    expect(ubicacion().search).toBe('?mes=2026-05');
    expect(bodyText()).toContain(MAYO);
    expect(filas()).toHaveLength(1);
    expect(filas()[0]).toContain('gasto de mayo');
    expect(marcadas()).toHaveLength(0);
    expect(botonElegir().disabled).toBe(true);
    const avisos = lineasDeAvisoDesmarcado();
    expect(avisos).toHaveLength(1);
    expect(avisos[0]!.textContent).toBe(AVISO_DESMARCADO_MES);
    expect(avisos[0]!.getAttribute('role')).toBe('status');
  });

  it('cambiar el mes SIN nada marcado: no hay aviso', async () => {
    await mount();
    await tocar(botonMes('anterior'));
    expect(lineasDeAvisoDesmarcado()).toHaveLength(0);
    expect(bodyText()).not.toContain('se desmarcó');
  });

  it('cambiar la CATEGORÍA con algo marcado: se desmarca todo y el aviso habla de la categoría', async () => {
    await mount();
    await tocar(casilla('peaje norte'));
    await elegirCategoria(LAVADO);
    expect(ubicacion().search).toBe(`?mes=2026-06&categoria=${LAVADO}`);
    expect(filas()).toHaveLength(1);
    expect(marcadas()).toHaveLength(0);
    expect(lineasDeAvisoDesmarcado().map((p) => p.textContent)).toEqual([AVISO_DESMARCADO_CATEGORIA]);
  });

  it('cambiar la categoría SIN nada marcado: no hay aviso', async () => {
    await mount();
    await elegirCategoria(LAVADO);
    expect(lineasDeAvisoDesmarcado()).toHaveLength(0);
  });

  it('aunque la lista nueva ya esté en la caché y traiga el MISMO gasto marcado (la categoría de antes es una parte de la de ahora), se desmarca igual: lo que se ve es lo que se manda', async () => {
    await mount(); // la lista de «todas las categorías» queda en la caché…
    await elegirCategoria(PEAJES);
    await tocar(casilla('peaje norte'));
    await elegirCategoria(''); // …y al volver a ella aparece al instante, con el gasto marcado adentro
    expect(filas()).toHaveLength(3);
    expect(casilla('peaje norte').checked).toBe(false);
    expect(marcadas()).toHaveLength(0);
    expect(lineasDeAvisoDesmarcado().map((p) => p.textContent)).toEqual([AVISO_DESMARCADO_CATEGORIA]);
  });

  it('volver al mes de antes NO recupera lo que se había marcado', async () => {
    await mount();
    await tocar(casilla('peaje norte'));
    await tocar(botonMes('anterior'));
    await tocar(botonMes('siguiente'));
    expect(filas()).toHaveLength(3);
    expect(marcadas()).toHaveLength(0);
  });

  it('el aviso se va apenas se marca algo (y con «Marcar todos»)', async () => {
    await mount();
    await tocar(casilla('peaje norte'));
    await tocar(botonMes('anterior'));
    expect(lineasDeAvisoDesmarcado()).toHaveLength(1);
    await tocar(casillas()[0]!);
    expect(lineasDeAvisoDesmarcado()).toHaveLength(0);

    await tocar(casillas()[0]!); // desmarca
    await tocar(botonMes('siguiente'));
    await tocar(casilla('peaje norte'));
    await tocar(botonMes('anterior'));
    expect(lineasDeAvisoDesmarcado()).toHaveLength(1);
    await tocar(botonMarcarTodos());
    expect(lineasDeAvisoDesmarcado()).toHaveLength(0);
  });

  it('si la URL cambia por otro lado (el botón «atrás») con algo marcado, también se desmarca todo (sin aviso)', async () => {
    await mount(`${RUTA}&categoria=${PEAJES}`);
    await tocar(casilla('peaje norte'));
    await act(async () => {
      nav.ir!(RUTA);
    });
    await settle(8);
    expect(filas()).toHaveLength(3);
    expect(marcadas()).toHaveLength(0);
  });

  it('si la URL cambia con el segundo paso abierto, se vuelve al primero y sin nada marcado', async () => {
    await mount(`${RUTA}&categoria=${PEAJES}`);
    await marcarYElegirViaje('peaje norte');
    expect(estaEnElPaso2()).toBe(true);
    await act(async () => {
      nav.ir!(RUTA);
    });
    await settle(8);
    expect(estaEnElPaso1()).toBe(true);
    expect(marcadas()).toHaveLength(0);
    expect(botonElegir().disabled).toBe(true);
  });

  it('el mes y la categoría se apagan mientras hay algo en curso (los botones del mes, el selector)', async () => {
    const sumando = deferred();
    route.vincular = () => sumando.promise;
    await mount();
    await act(async () => {
      otra.vincular!.mutate({ tenantId: T, viajeId: V(1), gastoIds: [G(9)] });
    });
    await settle(4);
    expect(botonMes('anterior').matches(':disabled')).toBe(true);
    expect(botonMes('siguiente').matches(':disabled')).toBe(true);
    expect(selectDeCategoria().disabled).toBe(true);
    await act(async () => {
      sumando.resolve(ok([]));
    });
    await settle(8);
    expect(botonMes('anterior').matches(':disabled')).toBe(false);
    expect(selectDeCategoria().disabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// El tope de 100
// ---------------------------------------------------------------------------
describe('«Sumar varios a un viaje»: el tope de 100 por vez', () => {
  it('con 99 gastos: sin ningún aviso de tope y «Marcar todos (99)»', async () => {
    db.gastos = muchos(MAX_GASTOS_POR_VEZ - 1);
    await mount();
    expect(botonMarcarTodos().textContent).toBe('Marcar todos (99)');
    expect(bodyText()).not.toContain('Puedes sumar hasta');
  });

  it('con EXACTAMENTE 100: «Marcar todos (100)» marca los 100, sin avisos ni casillas apagadas, y se mandan los 100', async () => {
    db.gastos = muchos(MAX_GASTOS_POR_VEZ);
    await mount();
    expect(botonMarcarTodos().textContent).toBe('Marcar todos (100)');
    expect(bodyText()).not.toContain('Puedes sumar hasta');
    await tocar(botonMarcarTodos());
    expect(marcadas()).toHaveLength(100);
    expect(casillas().every((c) => !c.disabled)).toBe(true);
    expect(avisosDeMaximo()).toHaveLength(0);
    await tocar(botonElegir());
    await tocar(opcion('Rosario'));
    expect(botonSumar().textContent).toBe('Sumar 100 gastos a este viaje');
    await tocar(botonSumar());
    expect(idsEnviados()).toHaveLength(1);
    expect(idsEnviados()[0]).toHaveLength(100);
  }, 60_000);

  it('con 101: el aviso del tope, «Marcar los primeros 100» (no «Marcar todos (101)») y SIN el aviso de «más de 500»', async () => {
    db.gastos = muchos(MAX_GASTOS_POR_VEZ + 1);
    await mount();
    expect(bodyText()).toContain(`Puedes sumar hasta ${MAX_GASTOS_POR_VEZ} gastos por vez. Cuando termines, puedes seguir con los demás.`);
    expect(botonMarcarTodos().textContent).toBe(`Marcar los primeros ${MAX_GASTOS_POR_VEZ}`);
    expect(bodyText()).not.toContain(`Hay más de ${LIST_LIMIT} gastos`);
  }, 60_000);

  it('el tope se cuenta sobre los SUELTOS: con 100 sueltos y uno más que ya tiene viaje, no hay aviso de tope y es «Marcar todos (100)»', async () => {
    db.gastos = [...muchos(MAX_GASTOS_POR_VEZ), gasto(200, { fecha: '2026-06-21', descripcion: 'con viaje', viaje_id: V(1) })];
    await mount();
    expect(casillas()).toHaveLength(MAX_GASTOS_POR_VEZ);
    expect(bodyText()).not.toContain('Puedes sumar hasta');
    expect(botonMarcarTodos().textContent).toBe('Marcar todos (100)');
  }, 60_000);

  it('con 101: «Marcar los primeros 100» marca los 100 DE ARRIBA, apaga la casilla 101 (sin marcar) y avisa; con el 100 marcado se puede desmarcar uno y marcar la 101 en su lugar', async () => {
    db.gastos = muchos(MAX_GASTOS_POR_VEZ + 1);
    await mount();
    await tocar(botonMarcarTodos());
    expect(marcadas()).toHaveLength(100);
    expect(casillaN(1).checked).toBe(true);
    expect(casillaN(100).checked).toBe(true);
    expect(casillaN(101).checked).toBe(false);
    expect(casillaN(101).disabled).toBe(true);
    expect(casillaN(100).disabled).toBe(false); // las marcadas siguen activas
    expect(avisosDeMaximo()).toHaveLength(2); // una por cada copia de la tarjeta (celular y escritorio)
    expect(botonMarcarTodos().textContent).toBe('Desmarcar todos'); // marcó todo lo que se puede marcar
    await tocar(casillaN(1)); // desmarca una: se libera un lugar
    expect(casillaN(101).disabled).toBe(false);
    await tocar(casillaN(101));
    expect(casillaN(101).checked).toBe(true);
    expect(marcadas()).toHaveLength(100);
    expect(casillaN(1).disabled).toBe(true); // y de nuevo no queda lugar
  }, 60_000);

  it('con MÁS de 500 (la lista se corta): se ven 500, los dos avisos, y se mandan exactamente 100', async () => {
    db.gastos = muchos(LIST_LIMIT + 1);
    await mount();
    expect(casillas()).toHaveLength(LIST_LIMIT);
    expect(bodyText()).toContain(`Puedes sumar hasta ${MAX_GASTOS_POR_VEZ} gastos por vez.`);
    expect(bodyText()).toContain(`Hay más de ${LIST_LIMIT} gastos en este mes; aquí solo se ven los que no tienen viaje entre los ${LIST_LIMIT} más recientes.`);
    expect(botonMarcarTodos().textContent).toBe(`Marcar los primeros ${MAX_GASTOS_POR_VEZ}`);
    await tocar(botonMarcarTodos());
    await tocar(botonElegir());
    await tocar(opcion('Rosario'));
    await tocar(botonSumar());
    expect(idsEnviados()).toHaveLength(1);
    expect(idsEnviados()[0]).toHaveLength(MAX_GASTOS_POR_VEZ);
    expect(idsEnviados()[0]![0]).toBe(G(1));
    expect(idsEnviados()[0]![99]).toBe(G(100));
  }, 90_000);

  it('con 500 gastos justos: no sale el aviso de «hay más de 500» (se ven todos)', async () => {
    db.gastos = muchos(LIST_LIMIT);
    await mount();
    expect(bodyText()).not.toContain(`Hay más de ${LIST_LIMIT} gastos`);
  }, 60_000);

  it('el aviso de la lista cortada habla de los sueltos entre los más recientes (los que tienen viaje cuentan para el corte)', async () => {
    // 501 en el mes, y 2 de los 500 más recientes ya están en un viaje: se ven 498 sueltos, no 500
    db.gastos = muchos(LIST_LIMIT + 1).map((g, i) => (i < 2 ? { ...g, viaje_id: V(1) } : g));
    await mount();
    expect(casillas()).toHaveLength(LIST_LIMIT - 2);
    expect(bodyText()).toContain('aquí solo se ven los que no tienen viaje');
  }, 90_000);
});

// ---------------------------------------------------------------------------
// El segundo paso
// ---------------------------------------------------------------------------
describe('«Sumar varios a un viaje»: ¿a qué viaje? (segundo paso)', () => {
  it('«Elegir el viaje» pasa al segundo paso: el título, un resumen de lo marcado (cuántos y cuánto suman), sin casillas ni lista de gastos', async () => {
    await mount();
    await marcarYElegirViaje('peaje norte', 'Combustible');
    expect(estaEnElPaso2()).toBe(true);
    expect(estaEnElPaso1()).toBe(false);
    expect(casillas()).toHaveLength(0);
    expect(document.querySelector('h1')!.textContent).toBe('Sumar gastos a un viaje');
    expect(bodyText()).toContain(`Vas a sumar 2 gastos. Suman $\u00a03.500,50.`);
  });

  it('un solo gasto marcado: «Vas a sumar 1 gasto. Suma …» (singular)', async () => {
    await mount();
    await marcarYElegirViaje('peaje norte');
    expect(bodyText()).toContain(`Vas a sumar 1 gasto. Suma $\u00a01.000.`);
  });

  it('en el segundo paso el «Volver» de arriba es un botón (no un enlace) que vuelve al primero SIN perder lo marcado', async () => {
    await mount();
    await marcarYElegirViaje('peaje norte', 'lavado del acoplado');
    const volver = botonVolverDelPaso2();
    expect(volver.getAttribute('type')).toBe('button');
    expect(volver.textContent?.trim()).toBe('Volver a elegir los gastos');
    expect(volver.className).toContain('min-h-12');
    expect(links().some((a) => a.textContent?.trim().startsWith('Volver'))).toBe(false);
    await tocar(volver);
    expect(estaEnElPaso1()).toBe(true);
    expect(marcadas()).toHaveLength(2);
    expect(casilla('peaje norte').checked).toBe(true);
    expect(casilla('lavado del acoplado').checked).toBe(true);
    expect(casilla('Combustible').checked).toBe(false);
    expect(botonElegir().disabled).toBe(false);
    expect(links().find((a) => a.textContent?.trim().startsWith('Volver'))!.getAttribute('href')).toBe('/gastos?mes=2026-06');
  });

  it('pide los viajes del MISMO mes que los gastos (con su tope) y los ofrece del más nuevo al más viejo; los de otro mes no aparecen', async () => {
    await mount();
    await marcarYElegirViaje('peaje norte');
    const lecturas = lecturasDeViajes();
    expect(lecturas).toHaveLength(1);
    expect(argDe(lecturas[0]!, 'gte', 'fecha')![1]).toBe('2026-06-01');
    expect(argDe(lecturas[0]!, 'lt', 'fecha')![1]).toBe('2026-07-01');
    expect(argDe(lecturas[0]!, 'limit')).toEqual([LIST_LIMIT_VIAJES + 1]);
    expect(radios().map((r) => textoDeOpcion(r).match(/Rosario|Salta|Mendoza/)![0])).toEqual(['Rosario', 'Salta']);
  });

  it('NINGUNO viene elegido; son opciones de UN grupo (mismo `name`, con nombre para el lector de pantalla), nativas y sin más de una elegida', async () => {
    await mount();
    await marcarYElegirViaje('peaje norte');
    expect(radios()).toHaveLength(2);
    expect(radios().every((r) => !r.checked)).toBe(true);
    expect(new Set(radios().map((r) => r.name)).size).toBe(1);
    expect(radios()[0]!.name).not.toBe('');
    const grupo = document.querySelector('fieldset:has(input[type="radio"])')!;
    expect(grupo.querySelector('legend')!.textContent).toBe('Viajes del mes');
    expect(grupo.querySelector('legend')!.className).toContain('sr-only');
    await tocar(opcion('Rosario'));
    await tocar(opcion('Salta'));
    expect(radios().filter((r) => r.checked)).toHaveLength(1);
    expect(opcion('Salta').checked).toBe(true);
  });

  it('cada opción muestra «origen → destino» (la flecha es decorativa y el lector de pantalla oye «a») y la fecha', async () => {
    await mount();
    await marcarYElegirViaje('peaje norte');
    const fila = opcion('Rosario').closest('li')!;
    const recorrido = fila.querySelector('.font-medium')!;
    expect(recorrido.textContent).toContain('Rosario');
    expect(recorrido.textContent).toContain('Córdoba');
    expect(recorrido.querySelector('[aria-hidden="true"]')!.textContent).toBe('→');
    expect(recorrido.querySelector('.sr-only')!.textContent).toBe(' a ');
    expect(fila.textContent).toContain('15 jun');
  });

  it('cada opción mide 64 px o más y TODA la fila es la zona que se toca (una `label` con la opción adentro)', async () => {
    await mount();
    await marcarYElegirViaje('peaje norte');
    for (const r of radios()) {
      expect(r.closest('label')).not.toBeNull();
      expect(r.className).toContain('sr-only');
      expect(r.closest('label')!.querySelector('span')!.className).toContain('min-h-16');
      expect(r.closest('label')!.querySelector('span')!.className).toContain('peer-focus-visible:ring-2');
    }
  });

  it('con 2 o más camiones, cada viaje con camión dice su patente; con 1 solo, no', async () => {
    db.camiones = [...CAMIONES];
    db.viajes = [viaje(1, { origen: 'Rosario', camion_id: C1 }), viaje(2, { origen: 'Salta', camion_id: null })];
    await mount();
    await marcarYElegirViaje('peaje norte');
    expect(textoDeOpcion(opcion('Rosario'))).toContain('AB 123 CD');
    expect(textoDeOpcion(opcion('Salta'))).not.toMatch(/\b[A-Z]{2} \d{3} [A-Z]{2}\b/); // un viaje sin camión no lleva patente
    await desmontar();
    queryClient.clear();

    db.camiones = [CAMIONES[0]!];
    await mount();
    await marcarYElegirViaje('peaje norte');
    expect(textoDeOpcion(opcion('Rosario'))).not.toContain('AB 123 CD');
  });

  it('el mes de los viajes tiene su propio selector: cambiarlo pide los viajes de ese mes, NO toca lo marcado y borra el viaje elegido', async () => {
    await mount();
    await marcarYElegirViaje('peaje norte', 'Combustible');
    await tocar(opcion('Rosario'));
    expect(botonSumar().disabled).toBe(false);
    await tocar(botonMes('anterior'));
    expect(argDe(lecturasDeViajes().at(-1)!, 'gte', 'fecha')![1]).toBe('2026-05-01');
    expect(radios().map((r) => textoDeOpcion(r).match(/Mendoza/)?.[0])).toEqual(['Mendoza']);
    expect(radios().every((r) => !r.checked)).toBe(true); // la elección de junio no sigue ahí
    expect(botonSumar().disabled).toBe(true);
    expect(ubicacion().search).toBe('?mes=2026-06'); // la URL (el mes de los gastos) no cambió
    expect(bodyText()).toContain(`Vas a sumar 2 gastos.`); // lo marcado, tampoco
    await tocar(botonVolverDelPaso2());
    expect(marcadas()).toHaveLength(2);
    expect(bodyText()).toContain(JUNIO); // y el mes de los gastos es el mismo
  });

  it('al volver al segundo paso el mes de los viajes arranca otra vez en el de los gastos y sin nada elegido', async () => {
    await mount();
    await marcarYElegirViaje('peaje norte');
    await tocar(opcion('Rosario'));
    await tocar(botonMes('anterior'));
    await tocar(botonVolverDelPaso2());
    await tocar(botonElegir());
    expect(radios().map((r) => textoDeOpcion(r).match(/Rosario|Salta/)![0])).toEqual(['Rosario', 'Salta']);
    expect(radios().every((r) => !r.checked)).toBe(true);
  });

  it('un mes sin viajes: «No hay viajes en junio 2026.», sin opciones, y el botón sigue apagado', async () => {
    db.viajes = [];
    await mount();
    await marcarYElegirViaje('peaje norte');
    expect(bodyText()).toContain(`No hay viajes en ${JUNIO}.`);
    expect(radios()).toHaveLength(0);
    expect(botonSumar().disabled).toBe(true);
  });

  it('con 501 viajes en el mes: se ven 500 y un aviso (los más recientes)', async () => {
    db.viajes = Array.from({ length: LIST_LIMIT_VIAJES + 1 }, (_, i) => viaje(i + 1, { origen: `Lugar ${i + 1}`, created_at: new Date(Date.UTC(2026, 5, 15, 10, 0, 0) - i * 1000).toISOString() }));
    await mount();
    await marcarYElegirViaje('peaje norte');
    expect(radios()).toHaveLength(LIST_LIMIT_VIAJES);
    expect(bodyText()).toContain(`Hay más de ${LIST_LIMIT_VIAJES} viajes en este mes; aquí se ven los ${LIST_LIMIT_VIAJES} más recientes.`);
  }, 90_000);

  it('mientras los viajes cargan: un esqueleto; si fallan sin datos: mensaje con «Reintentar» que vuelve a pedirlos', async () => {
    let intento = 0;
    route.viajes = (call) => {
      intento += 1;
      return intento === 1 ? sinRed() : leerViajesDelMes(call);
    };
    await mount();
    await marcarYElegirViaje('peaje norte');
    expect(mensajes()[0]).toBe('No hay señal. Revisa la conexión y prueba de nuevo.');
    expect(radios()).toHaveLength(0);
    await tocar(botonReintentar());
    expect(radios()).toHaveLength(2);
    expect(alertas()).toHaveLength(0);
  });

  it('si falla el REFRESCO de los viajes y ya hay datos, las opciones siguen a la vista (con el aviso y «Reintentar») y lo elegido también', async () => {
    await mount();
    await hastaElegirViaje(['peaje norte'], 'Rosario');
    route.viajes = () => sinRed();
    await invalidarLosViajes();
    expect(radios()).toHaveLength(2);
    expect(opcion('Rosario').checked).toBe(true);
    expect(mensajes()[0]).toBe('No hay señal. Revisa la conexión y prueba de nuevo.');
    expect(botonReintentar()).toBeDefined();
    expect(botonSumar().disabled).toBe(false);
  });

  it('al tocar «Volver» en el segundo paso el foco queda en el título de la lista de gastos (no se pierde con el paso que desaparece)', async () => {
    await mount();
    await marcarYElegirViaje('peaje norte');
    await tocar(botonVolverDelPaso2());
    const titulo = [...document.querySelectorAll('h2')].find((e) => e.textContent === 'Gastos sin viaje')!;
    expect(document.activeElement).toBe(titulo);
    expect(titulo.getAttribute('tabindex')).toBe('-1');
  });

  it('el título «¿A qué viaje?» y el segundo paso se anuncian: foco al título al entrar y la vista arriba', async () => {
    await mount();
    await marcarYElegirViaje('peaje norte');
    const titulo = [...document.querySelectorAll('h2')].find((e) => e.textContent === '¿A qué viaje?')!;
    expect(document.activeElement).toBe(titulo);
  });
});

describe('«Sumar varios a un viaje»: el camión de los marcados y el del viaje', () => {
  beforeEachCamiones();

  it('algunos de los marcados son de otro camión: la opción lo dice (singular), sigue elegible y el botón cuenta solo los que se suman', async () => {
    db.gastos = [gasto(1, { descripcion: 'del camión uno', camion_id: C1 }), gasto(2, { descripcion: 'del camión dos', camion_id: C2 }), gasto(3, { descripcion: 'sin camión', camion_id: null })];
    db.viajes = [viaje(1, { origen: 'Rosario', camion_id: C1 }), viaje(2, { origen: 'Salta', camion_id: null })];
    await mount();
    await marcarYElegirViaje('del camión uno', 'del camión dos', 'sin camión');
    expect(textoDeOpcion(opcion('Rosario'))).toContain('1 de los marcados es de otro camión: no se va a sumar.');
    expect(opcion('Rosario').disabled).toBe(false);
    expect(textoDeOpcion(opcion('Salta'))).not.toContain('otro camión'); // un viaje sin camión recibe a todos
    await tocar(opcion('Rosario'));
    expect(botonSumar().textContent).toBe('Sumar 2 gastos a este viaje');
    expect(bodyText().match(/1 de los marcados es de otro camión: no se va a sumar\./g)).toHaveLength(3); // la opción y las dos copias de la tarjeta
    await tocar(opcion('Salta'));
    expect(botonSumar().textContent).toBe('Sumar 3 gastos a este viaje');
  });

  it('varios de otro camión: el plural', async () => {
    db.gastos = [gasto(1, { descripcion: 'uno', camion_id: C1 }), gasto(2, { descripcion: 'dos', camion_id: C2 }), gasto(3, { descripcion: 'tres', camion_id: C2 })];
    db.viajes = [viaje(1, { origen: 'Rosario', camion_id: C1 })];
    await mount();
    await marcarYElegirViaje('uno', 'dos', 'tres');
    expect(textoDeOpcion(opcion('Rosario'))).toContain('2 de los marcados son de otro camión: no se van a sumar.');
  });

  it('TODOS de otro camión: la opción queda apagada con el motivo y no se puede elegir', async () => {
    db.gastos = [gasto(1, { descripcion: 'del camión dos', camion_id: C2 })];
    db.viajes = [viaje(1, { origen: 'Rosario', camion_id: C1 }), viaje(2, { origen: 'Salta', camion_id: C2 })];
    await mount();
    await marcarYElegirViaje('del camión dos');
    expect(opcion('Rosario').disabled).toBe(true);
    expect(textoDeOpcion(opcion('Rosario'))).toContain('Los marcados son de otro camión.');
    expect(opcion('Salta').disabled).toBe(false);
    await tocar(opcion('Rosario'));
    expect(opcion('Rosario').checked).toBe(false);
    expect(botonSumar().disabled).toBe(true);
  });

  it('el motivo está afuera de la fila apagada (se lee con todo su contraste) y la opción lo nombra como descripción', async () => {
    db.gastos = [gasto(1, { descripcion: 'del camión dos', camion_id: C2 })];
    db.viajes = [viaje(1, { origen: 'Rosario', camion_id: C1 })];
    await mount();
    await marcarYElegirViaje('del camión dos');
    const r = opcion('Rosario');
    const nota = document.getElementById(r.getAttribute('aria-describedby')!)!;
    expect(nota.textContent).toBe('Los marcados son de otro camión.');
    expect(nota.closest('label')).toBeNull();
    expect(nota.className).toContain('text-muted-foreground');
  });

  it('sin viaje elegido el botón dice «Sumar gastos a este viaje», apagado, con «Elige un viaje…» en lugar del aviso', async () => {
    await mount();
    await marcarYElegirViaje('peaje norte');
    expect(botonesDeSumar()).toHaveLength(2);
    for (const b of botonesDeSumar()) {
      expect(b.disabled).toBe(true);
      expect(b.textContent).toBe('Sumar gastos a este viaje');
    }
    expect(bodyText()).toContain('Elige un viaje para sumar los gastos.');
    await tocar(opcion('Rosario'));
    expect(bodyText()).not.toContain('Elige un viaje para sumar los gastos.');
    expect(botonSumar().textContent).toBe('Sumar 1 gasto a este viaje');
    expect(botonSumar().disabled).toBe(false);
  });
});

function beforeEachCamiones() {
  beforeEach(() => {
    db.camiones = [...CAMIONES];
  });
}

// ---------------------------------------------------------------------------
// Enviar y su resultado
// ---------------------------------------------------------------------------
describe('«Sumar varios a un viaje»: sumar y su resultado', () => {
  it('manda EXACTAMENTE los marcados, sin repetir, en el orden de la lista (no en el que se tocaron), con el viaje elegido y nada de transportista_id', async () => {
    await mount();
    await tocar(casilla('lavado del acoplado'));
    await tocar(casilla('peaje norte'));
    await tocar(botonElegir());
    await tocar(opcion('Salta'));
    await tocar(botonSumar());
    expect(envios()).toEqual([{ p_viaje_id: V(2), p_gasto_ids: [G(1), G(3)] }]);
    expect(JSON.stringify(h.calls.filter(esVincular))).not.toContain('transportista_id');
  });

  it('sin los de otro camión: el envío es solo lo que se suma, en el orden de la lista', async () => {
    db.camiones = [...CAMIONES];
    db.gastos = [gasto(1, { descripcion: 'uno', camion_id: C1 }), gasto(2, { descripcion: 'dos', camion_id: C2 }), gasto(3, { descripcion: 'tres', camion_id: null })];
    db.viajes = [viaje(1, { origen: 'Rosario', camion_id: C1 })];
    await mount();
    await marcarYElegirViaje('uno', 'dos', 'tres');
    await tocar(opcion('Rosario'));
    await tocar(botonSumar());
    expect(idsEnviados()).toEqual([[G(1), G(3)]]);
  });

  it('después de sumar la pantalla NO vuelve sola: queda en la misma ruta, en el primer paso, con el aviso arriba, nada marcado y la lista pedida otra vez sin lo sumado', async () => {
    await mount();
    await hastaElegirViaje(['peaje norte', 'Combustible'], 'Rosario');
    const lecturasAntes = lecturasDeGastos().length;
    await tocar(botonSumar());
    expect(ubicacion().pathname).toBe(RUTA_BASE);
    expect(estaEnElPaso1()).toBe(true);
    expect(parrafosDelResultado()).toEqual(['Sumaste 2 gastos al viaje.']);
    expect(resultado()!.getAttribute('role')).toBe('status');
    expect(lecturasDeGastos().length).toBeGreaterThan(lecturasAntes); // la lista se volvió a pedir
    expect(filas()).toHaveLength(1);
    expect(filas()[0]).toContain('lavado del acoplado');
    expect(marcadas()).toHaveLength(0);
    expect(botonElegir().disabled).toBe(true);
    // el aviso está ARRIBA de la lista
    expect(resultado()!.compareDocumentPosition(document.querySelector('fieldset:has(input[type="checkbox"])')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('un solo gasto: «Sumaste 1 gasto al viaje.» (singular)', async () => {
    await mount();
    await hastaElegirViaje(['peaje norte'], 'Rosario');
    await tocar(botonSumar());
    expect(parrafosDelResultado()).toEqual(['Sumaste 1 gasto al viaje.']);
  });

  it('el aviso se queda a la vista y se lleva el foco (con la lista larga y el botón fijo abajo, si no, no se vería nada cambiar)', async () => {
    const vista = vi.fn();
    Element.prototype.scrollIntoView = vista as never;
    await mount();
    await hastaElegirViaje(['peaje norte'], 'Rosario');
    vista.mockClear();
    await tocar(botonSumar());
    const activo = document.activeElement as HTMLElement;
    expect(activo.contains(resultado()!)).toBe(true);
    expect(activo.getAttribute('tabindex')).toBe('-1');
    expect(vista).toHaveBeenCalledWith({ block: 'center' });
  });

  it('el aviso lleva DOS botones: «Ver el viaje» (de 48 px o más) y «Volver a Gastos»', async () => {
    await mount();
    await hastaElegirViaje(['peaje norte'], 'Rosario');
    await tocar(botonSumar());
    const dentro = [...resultado()!.querySelectorAll<HTMLAnchorElement>('a')];
    expect(dentro.map((a) => a.textContent?.trim())).toEqual(['Ver el viaje', 'Volver a Gastos']);
    for (const a of dentro) expect(a.className).toContain('h-12'); // 48 px (el tamaño de siempre de los botones de la app)
  });

  it('«Ver el viaje» va al detalle del viaje al que se sumó, con el mes de ese viaje como único dato del state (para que su «Volver» tenga sentido)', async () => {
    await mount();
    await hastaElegirViaje(['peaje norte'], 'Salta');
    await tocar(botonSumar());
    const ver = enlaceCon('Ver el viaje')!;
    expect(ver.getAttribute('href')).toBe(`/viajes/${V(2)}`);
    await tocar(ver);
    expect(byId('destino-viaje')).not.toBeNull();
    expect(byId('destino-viaje')!.dataset.pathname).toBe(`/viajes/${V(2)}`);
    expect(stateOf(byId('destino-viaje')!)).toEqual({ volver: '?mes=2026-06' });
  });

  it('«Ver el viaje» de un viaje de otro mes (que se buscó con el selector del segundo paso): el state lleva el mes de ESE viaje, no el de los gastos', async () => {
    await mount();
    await marcarYElegirViaje('peaje norte');
    await tocar(botonMes('anterior'));
    await tocar(opcion('Mendoza'));
    await tocar(botonSumar());
    expect(idsEnviados()).toEqual([[G(1)]]);
    await tocar(enlaceCon('Ver el viaje'));
    expect(stateOf(byId('destino-viaje')!)).toEqual({ volver: '?mes=2026-05' });
  });

  it('«Ver el viaje» de un viaje del mes actual: el state lleva un volver vacío (la lista de Viajes sin mes, como siempre)', async () => {
    const mesActual = todayLocal().slice(0, 7);
    db.gastos = [gasto(1, { fecha: `${mesActual}-01`, descripcion: 'de este mes' })];
    db.viajes = [viaje(1, { origen: 'Rosario', fecha: `${mesActual}-01` })];
    await mount(RUTA_BASE);
    await hastaElegirViaje(['de este mes'], 'Rosario');
    await tocar(botonSumar());
    await tocar(enlaceCon('Ver el viaje'));
    expect(stateOf(byId('destino-viaje')!)).toEqual({ volver: '' });
  });

  it('«Volver a Gastos» del aviso lleva a la lista con el mismo mes y la misma categoría', async () => {
    await mount(`${RUTA}&categoria=${PEAJES}`);
    await hastaElegirViaje(['peaje norte'], 'Rosario');
    await tocar(botonSumar());
    // el del AVISO (con el filtro de Peajes la lista queda sin sueltos y el estado vacío también tiene el suyo: se mira el del aviso)
    const volver = [...resultado()!.querySelectorAll('a')].find((a) => a.textContent?.trim() === 'Volver a Gastos')!;
    expect(volver.getAttribute('href')).toBe(`/gastos?mes=2026-06&categoria=${PEAJES}`);
    await tocar(volver);
    expect(byId('destino-gastos')!.dataset.search).toBe(`?mes=2026-06&categoria=${PEAJES}`);
  });

  it('la elección de viaje queda borrada: al volver a elegir un viaje ninguno viene elegido', async () => {
    await mount();
    await hastaElegirViaje(['peaje norte'], 'Rosario');
    await tocar(botonSumar());
    await tocar(casilla('Combustible'));
    await tocar(botonElegir());
    expect(radios().every((r) => !r.checked)).toBe(true);
    expect(botonSumar().disabled).toBe(true);
  });

  it('con algunos que no se pudieron sumar (ya estaban en otro viaje): el aviso dice cuáles y por qué, y siguen en la lista', async () => {
    await mount();
    await marcarYElegirViaje('peaje norte', 'Combustible');
    db.gastos.find((g) => g.id === G(2))!.viaje_id = V(2); // otro dispositivo lo puso en otro viaje
    await tocar(opcion('Rosario'));
    await tocar(botonSumar());
    expect(parrafosDelResultado()).toEqual(['Sumaste 1 gasto al viaje.', '1 no se pudo sumar:']);
    expect(resultado()!.textContent).toContain('Combustible · 14 jun 2026: Ya está en otro viaje.');
  });

  it('si TODO ya estaba en el viaje: «1 ya estaba en este viaje.», sin «Sumaste 0»', async () => {
    await mount();
    await marcarYElegirViaje('peaje norte');
    db.gastos.find((g) => g.id === G(1))!.viaje_id = V(1);
    await tocar(opcion('Rosario'));
    await tocar(botonSumar());
    expect(parrafosDelResultado()).toEqual(['1 ya estaba en este viaje.']);
  });

  it('un segundo envío reemplaza al aviso anterior (no se acumulan)', async () => {
    await mount();
    await hastaElegirViaje(['peaje norte'], 'Rosario');
    await tocar(botonSumar());
    await hastaElegirViaje(['Combustible'], 'Salta');
    await tocar(botonSumar());
    expect([...document.querySelectorAll('[role="status"]')].filter((e) => /Sumaste/.test(e.textContent ?? ''))).toHaveLength(1);
    expect(idsEnviados()).toEqual([[G(1)], [G(2)]]);
  });

  it('lo que la base NO sumó (por ejemplo, por el camión) sigue en la lista pero SIN marcar: después de un envío que termina no queda nada marcado', async () => {
    route.vincular = (call) => ok(argsDeVincular(call).p_gasto_ids.map((gasto_id) => ({ gasto_id, resultado: 'camion_distinto' })));
    await mount();
    await hastaElegirViaje(['peaje norte', 'Combustible'], 'Rosario');
    await tocar(botonSumar());
    expect(resultado()!.textContent).toContain('2 no se pudieron sumar:');
    expect(resultado()!.textContent).toContain('Es de otro camión.');
    expect(filas()).toHaveLength(3); // siguen en la lista
    expect(marcadas()).toHaveLength(0);
    expect(botonElegir().disabled).toBe(true);
    expect(bodyText()).toContain('Marca los que quieres sumar.');
  });

  it('un marcado de OTRO camión que el viaje no se manda y el aviso no lo nombra: dice solo lo que sí se sumó', async () => {
    db.camiones = [...CAMIONES];
    db.gastos = [gasto(1, { descripcion: 'del camión uno', camion_id: C1, categoria_id: PEAJES }), gasto(2, { descripcion: 'del camión dos', camion_id: C2, categoria_id: LAVADO })];
    db.viajes = [viaje(1, { origen: 'Rosario', camion_id: C1 })];
    await mount();
    await hastaElegirViaje(['del camión uno', 'del camión dos'], 'Rosario');
    await tocar(botonSumar());
    expect(idsEnviados()).toEqual([[G(1)]]); // el de otro camión nunca se mandó
    expect(parrafosDelResultado()).toEqual(['Sumaste 1 gasto al viaje.']);
    expect(resultado()!.textContent).not.toMatch(/Lavado|no se pudo|otro camión/);
    expect(resultado()!.querySelector('li')).toBeNull();
    // y el de otro camión sigue en la lista, sin marcar
    expect(filas()).toHaveLength(1);
    expect(filas()[0]).toContain('Lavado');
    expect(marcadas()).toHaveLength(0);
  });

  it('el aviso de un envío anterior NO reaparece sobre una selección nueva: sumar, marcar otros, «Elegir el viaje» y «Volver» (y tras un envío sí aparece)', async () => {
    await mount();
    await hastaElegirViaje(['peaje norte'], 'Rosario');
    await tocar(botonSumar());
    expect(resultado()).toBeDefined();
    await tocar(casilla('Combustible'));
    await tocar(botonElegir()); // el aviso viejo se va al pasar al segundo paso…
    await tocar(botonVolverDelPaso2());
    expect(estaEnElPaso1()).toBe(true);
    expect(resultado()).toBeUndefined(); // …y no vuelve al regresar sin enviar
    expect(enlaceCon('Ver el viaje')).toBeUndefined();
    expect(casilla('Combustible').checked).toBe(true);
    await tocar(botonElegir());
    await tocar(opcion('Salta'));
    await tocar(botonSumar()); // un envío nuevo vuelve a mostrar su aviso
    expect(parrafosDelResultado()).toEqual(['Sumaste 1 gasto al viaje.']);
    expect(enlaceCon('Ver el viaje')!.getAttribute('href')).toBe('/viajes/' + V(2));
  });

  it('el aviso del resultado tiene el ícono decorativo y los colores del tema', async () => {
    await mount();
    await hastaElegirViaje(['peaje norte'], 'Rosario');
    await tocar(botonSumar());
    expect(resultado()!.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
    expect(resultado()!.className).toContain('border-primary/50');
  });

  it('el Resumen y los gastos se refrescan (la mutación invalida lo que cuelga de gastos)', async () => {
    const invalidar = vi.spyOn(queryClient, 'invalidateQueries');
    await mount();
    await hastaElegirViaje(['peaje norte'], 'Rosario');
    await tocar(botonSumar());
    expect(invalidar.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey))).toContain(JSON.stringify(gastosKeys.all(T)));
  });

  it('la mutación va en el scope compartido de sumar y quitar (corren de a una)', async () => {
    const enCamino = deferred();
    route.vincular = async (call) => {
      await enCamino.promise;
      return vincularEnLaBase(call);
    };
    await mount();
    await hastaElegirViaje(['peaje norte'], 'Rosario');
    await tocar(botonSumar());
    const mutaciones = queryClient.getMutationCache().getAll().filter((m) => m.options.scope?.id === SCOPE_DE_VINCULOS.id);
    expect(mutaciones.length).toBeGreaterThanOrEqual(1);
    await act(async () => {
      enCamino.resolve(ok(null));
    });
    await settle(8);
  });

  it('una respuesta que NO es una lista (se rompió algo) no se lee como éxito: «no se pudo sumar» y nada de «Sumaste»', async () => {
    route.vincular = () => ok({ raro: true });
    await mount();
    await hastaElegirViaje(['peaje norte'], 'Rosario');
    await tocar(botonSumar());
    expect(resultado()!.textContent).not.toContain('Sumaste');
    expect(resultado()!.textContent).toContain('No se pudo sumar. Inténtalo de nuevo.');
  });
});

describe('«Sumar varios a un viaje»: la selección y los viajes siguen a la lista de ahora', () => {
  it('si el viaje elegido desaparece de la lista, la elección se borra (y no se manda nada): tampoco vuelve sola si el viaje reaparece', async () => {
    await mount();
    await hastaElegirViaje(['peaje norte'], 'Rosario');
    expect(botonSumar().disabled).toBe(false);
    const rosario = db.viajes.find((v) => v.id === V(1))!;
    db.viajes = db.viajes.filter((v) => v.id !== V(1));
    await invalidarLosViajes();
    expect(radios()).toHaveLength(1);
    expect(botonSumar().disabled).toBe(true);
    expect(botonSumar().textContent).toBe('Sumar gastos a este viaje');
    await tocar(botonSumar());
    expect(envios()).toHaveLength(0);
    db.viajes = [rosario, ...db.viajes];
    await invalidarLosViajes();
    expect(opcion('Rosario').checked).toBe(false); // no se vuelve a elegir sola
    expect(botonSumar().disabled).toBe(true);
  });

  it('si un gasto marcado desaparece de la lista mientras se elige el viaje, no se manda y el resumen cuenta los que quedan', async () => {
    await mount();
    await marcarYElegirViaje('peaje norte', 'Combustible');
    db.gastos.find((g) => g.id === G(2))!.viaje_id = V(2); // otro dispositivo
    await invalidarLosGastos();
    expect(bodyText()).toContain(`Vas a sumar 1 gasto. Suma $\u00a01.000.`);
    await tocar(opcion('Rosario'));
    expect(botonSumar().textContent).toBe('Sumar 1 gasto a este viaje');
    await tocar(botonSumar());
    expect(idsEnviados()).toEqual([[G(1)]]);
  });

  it('si desaparecen TODOS los marcados: «Ya no hay gastos marcados…», el botón apagado y nada que mandar', async () => {
    await mount();
    await marcarYElegirViaje('peaje norte');
    db.gastos.find((g) => g.id === G(1))!.viaje_id = V(2);
    await invalidarLosGastos();
    expect(bodyText()).toContain('Ya no hay gastos marcados. Vuelve y marca los que quieres sumar.');
    expect(botonSumar().disabled).toBe(true);
    await tocar(opcion('Rosario'));
    expect(botonSumar().disabled).toBe(true);
    await tocar(botonSumar());
    expect(envios()).toHaveLength(0);
  });

  it('un gasto que entra a la lista arranca SIN marcar y no se manda', async () => {
    await mount();
    await marcarYElegirViaje('peaje norte');
    db.gastos.push(gasto(20, { fecha: '2026-06-18', descripcion: 'recién cargado' }));
    await invalidarLosGastos();
    await tocar(opcion('Rosario'));
    await tocar(botonSumar());
    expect(idsEnviados()).toEqual([[G(1)]]);
  });

  it('EL HUECO: si en el refresco SALE un gasto marcado y ENTRA otro (la lista queda con la misma cantidad), lo que salió no se manda y lo que entró arranca sin marcar', async () => {
    await mount();
    await tocar(casilla('peaje norte'));
    db.gastos = db.gastos.filter((g) => g.id !== G(1));
    db.gastos.push(gasto(21, { fecha: '2026-06-17', descripcion: 'reemplazo' }));
    await invalidarLosGastos();
    expect(filas()).toHaveLength(3);
    expect(marcadas()).toHaveLength(0);
    expect(botonElegir().disabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Mientras hay algo en curso
// ---------------------------------------------------------------------------
describe('«Sumar varios a un viaje»: mientras hay un «Sumar» o un «Quitar» en curso', () => {
  it('mientras se envía ESTE pedido: el botón dice «Sumando…» y está apagado; las opciones, el mes y «Volver» no se pueden tocar; el aviso sr-only dice «Sumando…»', async () => {
    const enCamino = deferred();
    route.vincular = async (call) => {
      await enCamino.promise;
      return vincularEnLaBase(call);
    };
    await mount();
    await hastaElegirViaje(['peaje norte'], 'Rosario');
    await tocar(botonSumar());
    expect(envios()).toHaveLength(1);
    expect(botonesDeSumar()).toHaveLength(2);
    for (const b of botonesDeSumar()) {
      expect(b.disabled).toBe(true);
      expect(b.textContent?.trim()).toBe('Sumando…');
      expect(b.getAttribute('aria-busy')).toBe('true');
    }
    expect(radios().every((r) => r.disabled)).toBe(true);
    expect(botonMes('anterior').matches(':disabled')).toBe(true);
    expect(botonVolverDelPaso2().disabled).toBe(true);
    expect(document.querySelector('[role="status"].sr-only')?.textContent).toContain('Sumando…');
    await act(async () => {
      enCamino.resolve(ok(null));
    });
    await settle(8);
    expect(parrafosDelResultado()[0]).toBe('Sumaste 1 gasto al viaje.');
    expect(casillas().every((c) => !c.disabled)).toBe(true);
  });

  it('dos toques seguidos (antes de que la pantalla se vuelva a dibujar) mandan UN solo pedido', async () => {
    const enCamino = deferred();
    route.vincular = async (call) => {
      await enCamino.promise;
      return vincularEnLaBase(call);
    };
    await mount();
    await hastaElegirViaje(['peaje norte'], 'Rosario');
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

  it('un «Sumar» o un «Quitar» de OTRA pantalla apaga todo con un texto NEUTRO («Un momento…»): botones, casillas, «Marcar todos», mes y categoría (primer paso)', async () => {
    const sumando = deferred();
    route.vincular = () => sumando.promise;
    await mount();
    await tocar(casilla('peaje norte'));
    expect(botonElegir().disabled).toBe(false);
    await act(async () => {
      otra.vincular!.mutate({ tenantId: T, viajeId: V(1), gastoIds: [G(9)] });
    });
    await settle(4);
    for (const b of botonesDeElegir()) {
      expect(b.disabled).toBe(true);
      expect(b.textContent?.trim()).toBe('Un momento…');
      expect(b.getAttribute('aria-busy')).toBe('true');
    }
    expect(bodyText()).not.toContain('Sumando…');
    expect(document.querySelector('[role="status"].sr-only')?.textContent).toBe('Un momento…');
    expect(casillas().every((c) => c.disabled)).toBe(true);
    expect(botonMarcarTodos().disabled).toBe(true);
    await tocar(botonElegir()); // un toque sobre un botón apagado no pasa al segundo paso
    expect(estaEnElPaso2()).toBe(false);
    await act(async () => {
      sumando.resolve(ok([{ gasto_id: G(9), resultado: 'no_encontrado' }]));
    });
    await settle(8);
    expect(botonElegir().disabled).toBe(false);
    expect(casilla('peaje norte').checked).toBe(true); // y lo marcado seguía ahí
  });

  it('en el segundo paso, lo de otra pantalla apaga las opciones, el mes, «Volver» y el botón («Un momento…», nunca «Sumando…»); un toque no manda nada', async () => {
    const sumando = deferred();
    route.quitar = () => sumando.promise;
    await mount();
    await hastaElegirViaje(['peaje norte'], 'Rosario');
    await act(async () => {
      otra.quitar!.mutate({ tenantId: T, viajeId: V(1), gastoIds: [G(9)] });
    });
    await settle(4);
    for (const b of botonesDeSumar()) {
      expect(b.disabled).toBe(true);
      expect(b.textContent?.trim()).toBe('Un momento…');
    }
    expect(bodyText()).not.toContain('Sumando…');
    expect(radios().every((r) => r.disabled)).toBe(true);
    expect(botonMes('anterior').matches(':disabled')).toBe(true);
    expect(botonMes('siguiente').matches(':disabled')).toBe(true);
    expect(botonVolverDelPaso2().disabled).toBe(true);
    await tocar(botonSumar());
    expect(envios()).toHaveLength(0);
    await act(async () => {
      sumando.resolve(ok([]));
    });
    await settle(8);
  });

  it('una mutación EN COLA (esperando su turno) cuenta: sigue todo apagado hasta que terminan las dos', async () => {
    const primera = deferred();
    route.vincular = () => primera.promise;
    await mount();
    await tocar(casilla('peaje norte'));
    await act(async () => {
      otra.vincular!.mutate({ tenantId: T, viajeId: V(1), gastoIds: [G(9)] }); // en vuelo
      otra.quitar!.mutate({ tenantId: T, viajeId: V(1), gastoIds: [G(8)] }); // en cola detrás de la anterior
    });
    await settle(4);
    expect(h.calls.filter((c) => c.target === 'gastos' && ops(c).includes('update'))).toHaveLength(0); // la segunda todavía no salió
    expect(botonesDeElegir().every((b) => b.disabled)).toBe(true);
    await act(async () => {
      primera.resolve(ok([]));
    });
    await settle(8);
    expect(h.calls.filter((c) => c.target === 'gastos' && ops(c).includes('update'))).toHaveLength(1); // ahora corre la segunda
    expect(botonElegir().disabled).toBe(false);
  });

  it('si se vuelve a entrar mientras el pedido anterior sigue en vuelo, la pantalla nueva arranca apagada con «Un momento…» (no lo lanzó ella)', async () => {
    const enCamino = deferred();
    route.vincular = async (call) => {
      await enCamino.promise;
      return vincularEnLaBase(call);
    };
    await mount();
    await hastaElegirViaje(['peaje norte'], 'Rosario');
    await tocar(botonSumar());
    await desmontar();
    await mount(); // se vuelve a entrar con el pedido anterior todavía en camino
    expect(botonesDeElegir().every((b) => b.disabled && b.textContent?.trim() === 'Un momento…')).toBe(true);
    expect(casillas().every((c) => c.disabled)).toBe(true);
    await act(async () => {
      enCamino.resolve(ok(null));
    });
    await settle(8);
    expect(filas().join(' ')).not.toContain('peaje norte'); // ya está sumado y la lista lo refleja
    expect(casillas().every((c) => !c.disabled)).toBe(true);
  });

  it('si la pantalla se desmonta con el pedido en vuelo no pasa nada raro: la escritura se hace y los datos quedan marcados como viejos', async () => {
    const invalidar = vi.spyOn(queryClient, 'invalidateQueries');
    const enCamino = deferred();
    route.vincular = async (call) => {
      await enCamino.promise;
      return vincularEnLaBase(call);
    };
    await mount();
    await hastaElegirViaje(['peaje norte'], 'Rosario');
    await tocar(botonSumar());
    await desmontar();
    await act(async () => {
      enCamino.resolve(ok(null));
    });
    await settle(8);
    expect(db.gastos.find((g) => g.id === G(1))!.viaje_id).toBe(V(1)); // la escritura se aplicó igual
    expect(invalidar.mock.calls.map((c) => JSON.stringify(c[0]?.queryKey))).toContain(JSON.stringify(gastosKeys.all(T)));
  });
});

// ---------------------------------------------------------------------------
// Errores y «Reintentar»
// ---------------------------------------------------------------------------
describe('«Sumar varios a un viaje»: errores y «Reintentar»', () => {
  it('sin señal: texto propio de sumar (no habla de «lo escrito»), «Reintentar», y lo marcado y el viaje elegido se CONSERVAN (se sigue en el segundo paso)', async () => {
    route.vincular = () => sinRed();
    await mount();
    await hastaElegirViaje(['peaje norte', 'Combustible'], 'Rosario');
    await tocar(botonSumar());
    expect(mensajes()).toEqual(['No hay señal. Todavía NO se sumaron. Cuando tengas señal, inténtalo de nuevo.']);
    expect(botonReintentar()).toBeDefined();
    expect(estaEnElPaso2()).toBe(true);
    expect(opcion('Rosario').checked).toBe(true);
    expect(bodyText()).toContain('Vas a sumar 2 gastos.');
    expect(botonSumar().textContent).toBe('Sumar 2 gastos a este viaje');
    // y al volver, lo marcado sigue ahí
    await tocar(botonVolverDelPaso2());
    expect(marcadas()).toHaveLength(2);
  });

  it('«Reintentar» manda lo marcado y el viaje elegido de AHORA (no un envío viejo) y, si sale bien, termina como un envío normal', async () => {
    let intento = 0;
    route.vincular = (call) => {
      intento += 1;
      return intento === 1 ? sinRed() : vincularEnLaBase(call);
    };
    await mount();
    await hastaElegirViaje(['peaje norte', 'Combustible'], 'Rosario');
    await tocar(botonSumar());
    // mientras tanto, el gasto de combustible quedó en otro viaje (otro dispositivo) y la lista se refrescó
    db.gastos.find((g) => g.id === G(2))!.viaje_id = V(2);
    await invalidarLosGastos();
    // y se cambia de viaje
    await tocar(opcion('Salta'));
    await tocar(botonReintentar());
    expect(idsEnviados()).toEqual([[G(1), G(2)], [G(1)]]);
    expect(envios().map((e) => e.p_viaje_id)).toEqual([V(1), V(2)]);
    expect(parrafosDelResultado()[0]).toBe('Sumaste 1 gasto al viaje.');
    expect(mensajes()).toEqual([]); // el error se fue
    expect(estaEnElPaso1()).toBe(true);
  });

  it('con el tiempo vencido y la escritura que NO llegó: «no sabemos si se sumaron…», «Reintentar» y, al reintentar, se suma', async () => {
    let intento = 0;
    route.vincular = (call) => {
      intento += 1;
      return intento === 1 ? tiempoVencido() : vincularEnLaBase(call);
    };
    await mount();
    await hastaElegirViaje(['peaje norte'], 'Rosario');
    await tocar(botonSumar());
    expect(mensajes()[0]).toBe('La señal está lenta y no sabemos si se sumaron. Revisa el viaje o inténtalo de nuevo: si ya estaban sumados, no pasa nada.');
    expect(botonReintentar()).toBeDefined();
    await tocar(botonReintentar());
    expect(parrafosDelResultado()[0]).toBe('Sumaste 1 gasto al viaje.');
    expect(idsEnviados()).toEqual([[G(1)], [G(1)]]);
  });

  it('con el tiempo vencido y la escritura que SÍ llegó: la lista se refresca sola, el gasto ya no está y no queda nada que reintentar (no se manda lo que ya no es de la lista)', async () => {
    route.vincular = (call) => {
      vincularEnLaBase(call); // la escritura SÍ llegó…
      return tiempoVencido(); // …y se perdió la respuesta
    };
    await mount();
    await hastaElegirViaje(['peaje norte'], 'Rosario');
    await tocar(botonSumar());
    expect(mensajes()[0]).toContain('no sabemos si se sumaron');
    expect(bodyText()).toContain('Ya no hay gastos marcados. Vuelve y marca los que quieres sumar.');
    expect(botonReintentar()).toBeUndefined();
    expect(botonSumar().disabled).toBe(true);
    expect(envios()).toHaveLength(1);
  });

  it('cuenta en solo lectura (PT402 / HTTP 402, clase «payment»): el mensaje general y SIN «Reintentar»', async () => {
    route.vincular = () => fail('PT402', SECRETO, 402);
    await mount();
    await hastaElegirViaje(['peaje norte'], 'Rosario');
    await tocar(botonSumar());
    expect(mensajes()[0]).toBe('Tu cuenta está en modo de solo lectura: por ahora no se pueden guardar cambios.');
    expect(botonReintentar()).toBeUndefined();
  });

  it('el viaje ya no existe (P0002): «Este viaje ya no existe.», sin «Reintentar»', async () => {
    route.vincular = () => fail('P0002', SECRETO, 500);
    await mount();
    await hastaElegirViaje(['peaje norte'], 'Rosario');
    await tocar(botonSumar());
    expect(mensajes()[0]).toBe('Este viaje ya no existe.');
    expect(botonReintentar()).toBeUndefined();
  });

  it('datos inválidos (22023): el texto de sumar, sin «Reintentar»', async () => {
    route.vincular = () => fail('22023', SECRETO, 400);
    await mount();
    await hastaElegirViaje(['peaje norte'], 'Rosario');
    await tocar(botonSumar());
    expect(mensajes()[0]).toBe('No se pudo sumar. Revisa los gastos y el viaje, y prueba de nuevo.');
    expect(botonReintentar()).toBeUndefined();
  });

  it('un error del servidor (500): el mensaje de siempre y «Reintentar»', async () => {
    route.vincular = () => fail('XX000', SECRETO, 500);
    await mount();
    await hastaElegirViaje(['peaje norte'], 'Rosario');
    await tocar(botonSumar());
    expect(mensajes()).toHaveLength(1);
    expect(botonReintentar()).toBeDefined();
  });

  it('NINGÚN error muestra el texto del servidor', async () => {
    for (const [code, status] of [['', 500], ['PT402', 402], ['P0002', 500], ['22023', 400], ['23503', 409], ['42501', 403], ['XX000', 500]] as const) {
      route.vincular = () => fail(code, SECRETO, status);
      await mount();
      await hastaElegirViaje(['peaje norte'], 'Rosario');
      await tocar(botonSumar());
      expect(bodyText(), code).not.toContain('secreto_interno');
      expect(alertas().length, code).toBeGreaterThan(0);
      await desmontar();
      queryClient.clear();
      h.calls.length = 0;
    }
  });

  it('«Reintentar» tampoco se puede tocar con algo en curso (y no manda nada)', async () => {
    route.vincular = () => sinRed();
    await mount();
    await hastaElegirViaje(['peaje norte'], 'Rosario');
    await tocar(botonSumar());
    expect(botonReintentar()).toBeDefined();
    const sumando = deferred();
    route.vincular = () => sumando.promise;
    await act(async () => {
      otra.vincular!.mutate({ tenantId: T, viajeId: V(1), gastoIds: [G(9)] });
    });
    await settle(4);
    expect(botonReintentar()!.disabled).toBe(true);
    await tocar(botonReintentar());
    expect(envios()).toHaveLength(2); // el que falló y el de la otra pantalla; este no mandó nada
    expect(idsEnviados().filter((ids) => ids.includes(G(1)))).toHaveLength(1);
    await act(async () => {
      sumando.resolve(ok([]));
    });
    await settle(6);
  });

  it('si el viaje elegido desaparece, «Reintentar» no se ofrece (no hay qué mandar)', async () => {
    route.vincular = () => sinRed();
    await mount();
    await hastaElegirViaje(['peaje norte'], 'Rosario');
    await tocar(botonSumar());
    expect(botonReintentar()).toBeDefined();
    db.viajes = db.viajes.filter((v) => v.id !== V(1));
    await invalidarLosViajes();
    expect(botonReintentar()).toBeUndefined();
    expect(mensajes()).toHaveLength(1); // el aviso del error queda
  });

  it('el error se ve y se lleva el foco; un envío nuevo limpia el aviso del error', async () => {
    let intento = 0;
    route.vincular = (call) => {
      intento += 1;
      return intento === 1 ? sinRed() : vincularEnLaBase(call);
    };
    await mount();
    await hastaElegirViaje(['peaje norte'], 'Rosario');
    await tocar(botonSumar());
    expect((document.activeElement as HTMLElement).contains(alertas()[0]!)).toBe(true);
    await tocar(botonSumar());
    expect(alertas()).toHaveLength(0);
    expect(parrafosDelResultado()[0]).toBe('Sumaste 1 gasto al viaje.');
  });

  it('«Volver» al primer paso con un error a la vista: el error ya no se muestra (era del paso anterior) y lo marcado sigue', async () => {
    route.vincular = () => sinRed();
    await mount();
    await hastaElegirViaje(['peaje norte'], 'Rosario');
    await tocar(botonSumar());
    expect(alertas()).toHaveLength(1);
    await tocar(botonVolverDelPaso2());
    expect(estaEnElPaso1()).toBe(true);
    expect(alertas()).toHaveLength(0);
    expect(marcadas()).toHaveLength(1);
    await tocar(botonElegir());
    expect(alertas()).toHaveLength(0); // y al volver a entrar al segundo paso tampoco aparece
  });
});

// ---------------------------------------------------------------------------
// Tamaños, colores y accesibilidad
// ---------------------------------------------------------------------------
describe('«Sumar varios a un viaje»: tamaños, colores y accesibilidad', () => {
  it('primer paso: el botón principal mide 56 px o más, ocupa todo el ancho, hay DOS (celular fijo abajo y escritorio) y en cada ancho se ve UNA', async () => {
    await mount();
    expect(botonesDeElegir()).toHaveLength(2);
    for (const b of botonesDeElegir()) {
      expect(b.className).toContain('min-h-14');
      expect(b.className).toContain('w-full');
      expect(b.className).toContain('whitespace-normal');
    }
    const raiz = container.querySelector('div.space-y-5')!;
    const deEscritorio = [...raiz.children].find((el) => el.className.includes('max-md:hidden') && el.querySelector('button'))!;
    expect(deEscritorio.className).toContain('md:sticky');
    const ultimo = raiz.lastElementChild as HTMLElement; // la barra fija es el ÚLTIMO hijo de la pantalla
    expect(ultimo.className).toContain('md:hidden');
    expect(ultimo.querySelector('.fixed')!.querySelector('button')).not.toBeNull();
    expect(deEscritorio.querySelectorAll('button')).toHaveLength(1);
    expect(ultimo.querySelectorAll('button')).toHaveLength(1);
  });

  it('segundo paso: lo mismo (56 px o más, todo el ancho, dos copias, una por ancho, la barra fija al final)', async () => {
    await mount();
    await marcarYElegirViaje('peaje norte');
    expect(botonesDeSumar()).toHaveLength(2);
    for (const b of botonesDeSumar()) {
      expect(b.className).toContain('min-h-14');
      expect(b.className).toContain('w-full');
    }
    const raiz = container.querySelector('div.space-y-5')!;
    const deEscritorio = [...raiz.children].find((el) => el.className.includes('max-md:hidden') && el.querySelector('button'))!;
    expect(deEscritorio.className).toContain('md:sticky');
    expect((raiz.lastElementChild as HTMLElement).className).toContain('md:hidden');
    expect(deEscritorio.querySelectorAll('button')).toHaveLength(1);
    expect(raiz.lastElementChild!.querySelectorAll('button')).toHaveLength(1);
  });

  it('el total y el botón van juntos, en una tarjeta con los colores del tema (la línea del total arriba del botón)', async () => {
    await mount();
    await tocar(casilla('peaje norte'));
    const tarjeta = botonElegir().parentElement!;
    expect(tarjeta.className).toContain('bg-card');
    expect(tarjeta.className).toContain('border-border');
    const total = tarjeta.querySelector('p')!;
    expect(total.textContent).toBe(`Suman $\u00a01.000`);
    expect(total.className).toContain('tabular-nums');
    expect(total.compareDocumentPosition(botonElegir()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('la barra fija del celular tiene aire extra debajo de la lista, y más con el máximo marcado (lleva una línea más)', async () => {
    db.gastos = muchos(MAX_GASTOS_POR_VEZ + 1);
    await mount();
    const raiz = container.querySelector('div.space-y-5')!;
    const aire = () => [...raiz.children].find((el) => el.getAttribute('aria-hidden') === 'true' && /\bh-(?:16|36)\b/.test(el.className))!;
    expect(aire().className).toContain('h-16');
    expect(aire().className).toContain('md:hidden');
    expect(raiz.lastElementChild!.previousElementSibling).toBe(aire());
    await tocar(botonMarcarTodos());
    expect(aire().className).toContain('h-36');
  }, 60_000);

  it('el segundo paso también deja aire para la barra fija', async () => {
    await mount();
    await marcarYElegirViaje('peaje norte');
    const raiz = container.querySelector('div.space-y-5')!;
    const aire = [...raiz.children].find((el) => el.getAttribute('aria-hidden') === 'true' && el.className.includes('h-24'))!;
    expect(aire.className).toContain('md:hidden');
    expect(raiz.lastElementChild!.previousElementSibling).toBe(aire);
  });

  it('ningún color nuevo ni suelto: solo clases del tema (nada de paleta de Tailwind ni de colores en hexadecimal), en los dos pasos y con el resultado a la vista', async () => {
    db.gastos = muchos(MAX_GASTOS_POR_VEZ + 1);
    db.camiones = [...CAMIONES];
    db.viajes = [viaje(1, { origen: 'Rosario', camion_id: C1 }), viaje(2, { origen: 'Salta', camion_id: C2 })];
    await mount();
    await tocar(botonMarcarTodos()); // con el máximo marcado: se ven la línea del tope y las casillas apagadas
    const paleta = /^(?:[a-z-]+:)*(?:bg|text|border|ring|fill|stroke|accent|outline|shadow|from|to|via|divide|decoration|caret)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|black|white)(?:-\d+)?(?:\/\d+)?$/;
    const sinColoresSueltos = () => {
      const clases = [...container.querySelectorAll('[class]')].flatMap((el) => el.getAttribute('class')!.split(/\s+/));
      expect(clases.filter((c) => paleta.test(c))).toEqual([]);
      expect(clases.filter((c) => /#[0-9a-f]{3,8}|\brgb\(|\bhsl\(/i.test(c))).toEqual([]);
      expect(container.innerHTML).not.toMatch(/style="[^"]*(?:color|background)/i);
    };
    sinColoresSueltos();
    await tocar(botonElegir()); // segundo paso (con una opción apagada y un aviso de camión)
    sinColoresSueltos();
    await tocar(opcion('Rosario'));
    sinColoresSueltos();
    await tocar(botonSumar()); // y con el aviso del resultado
    sinColoresSueltos();
  }, 90_000);

  it('ningún texto por debajo de 16 px (sin `text-xs` ni `text-sm`) y las cifras alineadas (`tabular-nums`), en los dos pasos', async () => {
    await mount();
    await tocar(casilla('peaje norte'));
    expect(container.querySelectorAll('[class*="text-xs"], [class*="text-sm"]')).toHaveLength(0);
    expect(container.querySelectorAll('.tabular-nums').length).toBeGreaterThanOrEqual(4);
    await tocar(botonElegir());
    expect(container.querySelectorAll('[class*="text-xs"], [class*="text-sm"]')).toHaveLength(0);
    expect(container.querySelectorAll('.tabular-nums').length).toBeGreaterThanOrEqual(1);
  });

  it('la línea del aviso de «cambiaste el mes» y la del máximo son de 16 px o más, usan el color de apoyo del tema y son avisos de estado (`role="status"`)', async () => {
    db.gastos = muchos(MAX_GASTOS_POR_VEZ + 1);
    await mount();
    await tocar(botonMarcarTodos());
    for (const p of avisosDeMaximo()) {
      expect(p.className).toContain('text-base');
      expect(p.className).toContain('text-muted-foreground');
      expect(p.getAttribute('role')).toBe('status');
    }
    await tocar(botonMes('anterior'));
    for (const p of lineasDeAvisoDesmarcado()) {
      expect(p.className).toContain('text-base');
      expect(p.className).toContain('text-muted-foreground');
    }
    expect(lineasDeAvisoDesmarcado()).toHaveLength(1);
  }, 60_000);

  it('el foco se ve en cada casilla y en cada opción (anillo) aunque la de verdad esté oculta a la vista, y son nativas (teclado y lector de pantalla)', async () => {
    await mount();
    const caja = casillas()[0]!;
    expect(caja.className).toContain('sr-only');
    expect(caja.type).toBe('checkbox');
    await marcarYElegirViaje('peaje norte');
    const radio = radios()[0]!;
    expect(radio.type).toBe('radio');
    expect(radio.className).toContain('peer');
    radio.focus();
    expect(document.activeElement).toBe(radio);
    await tocar(radio); // el clic es lo que hace el navegador con la barra espaciadora sobre una opción nativa
    expect(radio.checked).toBe(true);
  });

  it('el «Volver» del segundo paso mide 48 px y tiene anillo de foco', async () => {
    await mount();
    await marcarYElegirViaje('peaje norte');
    expect(botonVolverDelPaso2().className).toContain('min-h-12');
    expect(botonVolverDelPaso2().className).toContain('focus-visible:ring-2');
  });

  it('cada casilla y cada opción tienen nombre accesible: lo que dice su fila', async () => {
    await mount();
    expect(textoDeFila(casillas()[0]!)).toContain('Peajes');
    await marcarYElegirViaje('peaje norte');
    expect(textoDeOpcion(radios()[0]!)).toContain('Rosario');
    expect(textoDeOpcion(radios()[0]!)).toContain('Córdoba');
  });

  it('los avisos de la parte de arriba son alertas informativas con ícono decorativo (no solo color)', async () => {
    db.gastos = muchos(LIST_LIMIT + 1);
    await mount();
    const informativos = [...document.querySelectorAll('[data-slot="alert"]')].filter((a) => /Puedes sumar hasta|Hay más de/.test(a.textContent ?? ''));
    expect(informativos).toHaveLength(2);
    for (const aviso of informativos) expect(aviso.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
  }, 90_000);
});

// ---------------------------------------------------------------------------
// Reglas del código que no se pueden romper sin que una prueba lo note
// ---------------------------------------------------------------------------
describe('«Sumar varios a un viaje»: reglas del código de la pantalla', () => {
  const ARCHIVOS = [
    'sumar-a-viaje-page.tsx',
    'elegir-el-viaje.tsx',
    'sumar-a-viaje.ts',
    'sumar-a-viaje-textos.ts',
  ].map((nombre) => `src/features/gastos/${nombre}`);

  /** El código sin comentarios, para mirar solo lo que se ejecuta. */
  const codigo = (archivo: string) => readFileSync(archivo, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const pantalla = () => codigo('src/features/gastos/sumar-a-viaje-page.tsx');
  const paso2 = () => codigo('src/features/gastos/elegir-el-viaje.tsx');

  it('el estado de la pantalla NO depende de callbacks pasados a `mutate(…)`: solo `mutateAsync` dentro de `useSubmitFeedback` con `keepLocked: false`', () => {
    expect(pantalla()).not.toMatch(/\.mutate\(/);
    expect(pantalla()).not.toMatch(/\bon(?:Success|Error|Settled)\b/);
    expect(pantalla()).toMatch(/vincular\.mutateAsync\(/);
    expect(pantalla()).toMatch(/useSubmitFeedback\(/);
    expect(pantalla()).toMatch(/\{ keepLocked: false \}/);
    expect(paso2()).not.toMatch(/mutate/);
  });

  it('las fechas se formatean SOLO con los helpers de `@/lib/dates` (la base acepta `infinity`): ni `Intl`, ni `toLocale…`, ni `new Date(`, ni `Date.parse`', () => {
    for (const archivo of ARCHIVOS) {
      expect(codigo(archivo), archivo).not.toMatch(/\bIntl\b|toLocale\w*\(|new Date\(|Date\.parse\(|Date\.UTC\(/);
    }
    expect(paso2()).toMatch(/formatDateShort\(viaje\.fecha\)/);
    expect(pantalla()).toMatch(/searchDelMesDeFecha\(viaje\.fecha\)/);
  });

  it('el cliente nunca manda `transportista_id` ni arma consultas: ninguna pieza nombra la base ni el tenant en lo que manda', () => {
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
    expect(pantalla()).toMatch(/context: SUMAR_A_VIAJE_CONTEXT/);
    expect(paso2()).toMatch(/mapDataError\(/);
  });

  it('lo que se manda sale de `seleccion.idsParaEnviar` (selección ∩ lista de ahora) menos los de otro camión, no de un conjunto guardado', () => {
    expect(pantalla()).toMatch(/gastosMarcados\(sueltos, seleccion\.idsParaEnviar\)/);
    expect(pantalla()).toMatch(/repartirPorCamionDelViaje\(marcados, viaje\)\.aEnviar/);
    expect(pantalla()).not.toMatch(/useRef<Set|new Set\(\[\.\.\.seleccion/);
  });

  it('el scope compartido se usa por su nombre (`useVinculosEnCurso`, `useVincularGastos`): ninguna pieza repite su identificador a mano', () => {
    for (const archivo of ARCHIVOS) expect(codigo(archivo), archivo).not.toMatch(/vincular-gastos/);
    expect(pantalla()).toMatch(/useVinculosEnCurso\(\)/);
    expect(pantalla()).toMatch(/useVincularGastos\(\)/);
  });

  it('el tope sale de `MAX_GASTOS_POR_VEZ` (no un 100 suelto en la pantalla)', () => {
    expect(pantalla()).toMatch(/useSeleccionConTope\(idsDe\(sueltos\), MAX_GASTOS_POR_VEZ\)/);
    expect(pantalla()).not.toMatch(/\b100\b/);
    expect(paso2()).not.toMatch(/\b100\b/);
  });

  it('no manda nada que no sea `selección ∩ lista`: ningún `slice` en la pantalla (el mes del «Volver» de «Ver el viaje» sale de `searchDelMesDeFecha`, no se arma a mano)', () => {
    expect(pantalla()).not.toMatch(/\.slice\(/);
    expect(pantalla()).not.toMatch(/parseMesParam|viajesFiltroToSearch/);
  });

  it('el viaje al que se manda es el elegido en la lista de AHORA (se vuelve a buscar en cada dibujo), no un id guardado', () => {
    expect(paso2()).toMatch(/viajes\.find\(\(viaje\) => viaje\.id === viajeId\)/);
    expect(paso2()).toMatch(/onEnviar\(viajeElegido\)/);
  });

  it('«Reintentar» no se ofrece sin nada para mandar ni con una clase de error que no se reintenta', () => {
    expect(paso2()).toMatch(/retryable && cantidad > 0/);
  });

  it('el botón de la lista de Gastos y el «Volver» de arriba arman su search con `filtroToSearch` (nunca con un texto de la URL)', () => {
    expect(pantalla()).toMatch(/filtroToSearch\(filtro\)/);
    expect(codigo('src/features/gastos/gastos-page.tsx')).toMatch(/search: volver/);
  });
});
