import { act, useMemo, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation, useNavigate, useNavigationType, type InitialEntry } from 'react-router';
import { onlineManager, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// La pantalla Resumen (vista Mes). Mock de supabase: cada función de la 014 responde según `route`; TODO lo demás (la
// pantalla, los hooks, TanStack Query, el parse, el router) es código REAL. "Hoy" es el 14 de octubre de 2026 (solo se
// fija `Date`: los timers son los reales).
type Op = { m: string; args: unknown[] };
type Call = { target: string; ops: Op[] };

const h = vi.hoisted(() => {
  const calls: Array<{ target: string; ops: Array<{ m: string; args: unknown[] }> }> = [];
  const state = { responder: null as null | ((call: { target: string; ops: Array<{ m: string; args: unknown[] }> }) => unknown) };
  function builder(target: string, firstOp?: { m: string; args: unknown[] }) {
    const call = { target, ops: firstOp ? [firstOp] : ([] as Array<{ m: string; args: unknown[] }>) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {};
    for (const m of ['select', 'eq', 'abortSignal', 'maybeSingle']) {
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
import { ResumenPage } from '@/features/resumen/resumen-page';
import { RESUMEN_SIN_CONEXION } from '@/features/resumen/resumen-pantalla-textos';
import { RESUMEN_ERROR_INESPERADO, RESUMEN_SIN_CUENTA } from '@/features/resumen/resumen-textos';
import { NETWORK_ERROR_MESSAGE } from '@/features/auth/auth-errors';
import { resumenKeys } from '@/features/resumen/resumen-keys';
import { parseResumenCombustible, parseResumenGastos, parseResumenMensual, parseResumenViajes } from '@/features/resumen/resumen-parse';
import { queryClient } from '@/lib/query-client';

// ---------------------------------------------------------------------------
// "Base de datos" falsa
// ---------------------------------------------------------------------------
type Resp = { data: unknown; error: { message: string; code: string } | null; status: number };
const ok = (data: unknown): Resp => ({ data, error: null, status: 200 });
const sinRed = (): Resp => ({ data: null, error: { code: '', message: 'TypeError: Failed to fetch' }, status: 0 });
const errorBase = (code: string, status: number): Resp => ({ data: null, error: { code, message: 'detalle interno de la base' }, status });
const MIEMBRO = { rol: 'admin', tema: 'dark', color_acento: '#F59E0B', transportista_id: 'tenant-a', camion_activo_id: null, transportistas: { nombre: 'Transportes A' } };

const CAT_A = 'a1000000-0000-4000-8000-000000000001';
const CAT_B = 'a1000000-0000-4000-8000-000000000002';
const CAM_X = 'c1000000-0000-4000-8000-000000000001';
const V1 = 'b1000000-0000-4000-8000-000000000001';
const V2 = 'b1000000-0000-4000-8000-000000000002';

type FilaGasto = { grupo: string; clave: string | null; nombre: string | null; activa: boolean | null; cantidad: number; monto: number };
const total = (monto: number, cantidad: number): FilaGasto => ({ grupo: 'total', clave: null, nombre: null, activa: null, cantidad, monto });
const cat = (clave: string, nombre: string, monto: number, cantidad = 1): FilaGasto => ({ grupo: 'categoria', clave, nombre, activa: null, cantidad, monto });
const met = (clave: string | null, monto: number, cantidad = 1): FilaGasto => ({ grupo: 'metodo_pago', clave, nombre: null, activa: null, cantidad, monto });
const cam = (clave: string | null, nombre: string | null, activa: boolean | null, monto: number, cantidad = 1): FilaGasto => ({ grupo: 'camion', clave, nombre, activa, cantidad, monto });

/** Gasto de octubre: 3 categorías, 2 métodos (uno sin especificar) y 2 filas de camión (una "sin camión"). */
const GASTOS_OCT: FilaGasto[] = [
  total(10000, 8),
  cat(CAT_A, 'Combustible', 7000, 3),
  cat(CAT_B, 'Peajes', 2000, 4),
  cat('a1000000-0000-4000-8000-000000000003', 'Comida', 1000, 1),
  met('efectivo', 6000, 5),
  met(null, 4000, 3),
  cam(CAM_X, 'AB123CD', true, 7500, 4),
  cam(null, null, null, 2500, 4),
];

function mesFila(mes: string, over: Record<string, unknown> = {}) {
  return {
    mes,
    gastos_cantidad: 8,
    gastos_monto: 10000,
    combustible_cargas: 3,
    combustible_litros: 300,
    combustible_monto: 7000,
    viajes_cantidad: 3,
    viajes_km: 1500,
    viajes_con_ingreso: 3,
    viajes_sin_ingreso: 0,
    viajes_ingreso: 25000,
    resultado: 15000,
    ...over,
  };
}

function combFila(over: Record<string, unknown> = {}) {
  return {
    camion_id: CAM_X,
    patente: 'AB123CD',
    activa: true,
    cargas: 3,
    litros: 300.5,
    monto: 7000,
    precio_promedio: 23.29,
    llenas_con_odometro: 3,
    tramos: 2,
    tramos_km: 900,
    tramos_litros: 300,
    tramos_monto: 6900,
    km_por_litro: 3,
    litros_100km: 33.33,
    costo_por_km: 7.67,
    descartados_retroceso: 0,
    descartados_sin_avance: 0,
    descartados_fuera_de_rango: 0,
    ...over,
  };
}

function viajeFila(over: Record<string, unknown> = {}) {
  return {
    viaje_id: V1,
    fecha: '2026-10-12',
    origen: 'Rosario',
    destino: 'Córdoba',
    camion_id: CAM_X,
    patente: 'AB123CD',
    km: 400,
    ingreso: 15000,
    gastos_cantidad: 2,
    gastos_monto: 3000,
    ganancia: 12000,
    total_viajes: 2,
    ...over,
  };
}

type Handler = (call: Call) => unknown;
const route: { gastos: Handler; mensual: Handler; combustible: Handler; viajes: Handler } = {} as never;
const argsDe = (call: Call) => call.ops.find((o) => o.m === 'rpc')!.args[0] as Record<string, unknown>;
/** La comparación es la llamada a resumen_gastos que NO empieza el día 1 del mes mirado. */
let MES_DESDE = '2026-10-01';

function resetRoutes() {
  MES_DESDE = '2026-10-01';
  route.gastos = (call) => ok(argsDe(call).p_desde === MES_DESDE ? GASTOS_OCT : [total(8000, 6)]);
  route.mensual = (call) => ok([mesFila(String(argsDe(call).p_mes_desde))]);
  route.combustible = () => ok([combFila()]);
  route.viajes = () => ok([viajeFila(), viajeFila({ viaje_id: V2, fecha: '2026-10-03', origen: 'Salta', destino: 'Jujuy', camion_id: null, patente: null, km: null, ingreso: null, ganancia: null, gastos_cantidad: 0, gastos_monto: 0 })]);
}

function installResponder() {
  h.state.responder = (call: Call) => {
    if (call.target === 'miembros') return ok(MIEMBRO);
    if (call.target === 'rpc:resumen_gastos') return route.gastos(call);
    if (call.target === 'rpc:resumen_mensual') return route.mensual(call);
    if (call.target === 'rpc:resumen_combustible') return route.combustible(call);
    if (call.target === 'rpc:resumen_viajes') return route.viajes(call);
    throw new Error(`pedido inesperado: ${call.target}`);
  };
}

const rpcs = (fn: string) => h.calls.filter((c) => c.target === `rpc:${fn}`);

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

/** Deja a la vista dónde está la pantalla (para ver qué se escribió en la URL) y cómo se llegó (PUSH / REPLACE / POP). */
function Ubicacion() {
  const location = useLocation();
  const tipo = useNavigationType();
  return <div id="ubicacion" data-pathname={location.pathname} data-search={location.search} data-tipo={tipo} />;
}

function Destino() {
  const location = useLocation();
  return <div id="destino" data-pathname={location.pathname} />;
}

/** El "atrás" del navegador: vuelve a la entrada anterior del historial. */
function Atras() {
  const navigate = useNavigate();
  return (
    <button type="button" id="atras" onClick={() => void navigate(-1)}>
      atrás
    </button>
  );
}

let root: Root;
let container: HTMLElement;
let errorSpy: ReturnType<typeof vi.spyOn>;

async function settle(times = 6) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

/** `entry`: la URL inicial, o varias (historial previo; la pantalla abre en la última). */
async function mount(entry: InitialEntry | InitialEntry[] = '/resumen') {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <AuthHarness>
          <MemberProvider>
            <MemoryRouter initialEntries={Array.isArray(entry) ? entry : [entry]}>
              <RequireMember>
                <Routes>
                  <Route
                    path="/resumen"
                    element={
                      <>
                        <ResumenPage />
                        <Ubicacion />
                        <Atras />
                      </>
                    }
                  />
                  <Route path="/viajes/:id" element={<Destino />} />
                  <Route path="/inicio-de-prueba" element={<div id="pantalla-anterior" />} />
                </Routes>
              </RequireMember>
            </MemoryRouter>
          </MemberProvider>
        </AuthHarness>
      </QueryClientProvider>,
    );
  });
  await settle();
}

const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T | null;
const bodyText = () => document.body.textContent ?? '';
const buttons = () => [...document.querySelectorAll<HTMLButtonElement>('button')];
const buttonByLabel = (label: string) => buttons().find((b) => b.getAttribute('aria-label') === label);
const mesMostrado = () => document.querySelector('[role="group"][aria-label="Mes"] p')?.textContent ?? '';
const search = () => byId('ubicacion')?.dataset.search ?? '';
/** Texto como se lee: espacios duros y signo menos tipográfico normalizados, espacios colapsados. */
const plano = (texto: string | null | undefined) =>
  (texto ?? '').replace(/\u00a0/g, ' ').replace(/\u2212/g, '-').replace(/\s+/g, ' ').trim();
const textoDe = (id: string) => plano(byId(id)?.textContent);
const h2s = () => [...document.querySelectorAll('h2')].map((h) => h.textContent);
/** Las filas de un desglose: [etiqueta, monto, detalle]. */
const barras = (id: string) =>
  [...(byId(id)?.querySelectorAll('li[data-fila]') ?? [])].map((li) => {
    const spans = li.querySelectorAll('span');
    return [plano(spans[0]?.textContent), plano(spans[1]?.textContent), plano(li.querySelector('p')?.textContent)];
  });
const anchos = (id: string) =>
  [...(byId(id)?.querySelectorAll<HTMLElement>('li[data-fila] [aria-hidden="true"] > div') ?? [])].map((barra) => barra.style.width);
const comparacion = () => plano(document.querySelector('#resumen-gastos [data-comparacion]')?.textContent);
/** Cuántas veces se pidió `resumen_gastos` desde ese día (el mes mirado o el período de comparación). */
const pedidosDeGastos = (desde: string) => rpcs('resumen_gastos').filter((c) => argsDe(c).p_desde === desde).length;
const botonEn = (id: string, texto: string) =>
  [...(byId(id)?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find((b) => b.textContent?.trim() === texto);

async function click(el: HTMLElement | null | undefined) {
  if (!el) throw new Error('no se encontró el elemento a tocar');
  await act(async () => {
    el.click();
  });
  await settle();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 14, 10, 0));
  h.calls.length = 0;
  resetRoutes();
  installResponder();
  localStorage.clear();
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.scrollTo = (() => {}) as never;
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  container?.remove();
  queryClient.clear();
  onlineManager.setOnline(true);
  vi.useRealTimers();
  expect(errorSpy.mock.calls.map((c: unknown[]) => String(c[0]))).toEqual([]);
  errorSpy.mockRestore();
});

// ---------------------------------------------------------------------------
// Encabezado y mes
// ---------------------------------------------------------------------------
describe('pantalla Resumen: encabezado y mes', () => {
  it('título "Resumen" y el mes actual, sin escribirlo en la URL', async () => {
    await mount();
    expect(document.querySelector('h1')!.textContent).toBe('Resumen');
    expect(mesMostrado()).toBe('octubre 2026');
    expect(search()).toBe('');
    expect(rpcs('resumen_gastos').map(argsDe)).toContainEqual({ p_desde: '2026-10-01', p_hasta: '2026-10-31' });
  });

  it('?mes= válido: ese mes (y sus consultas)', async () => {
    MES_DESDE = '2026-08-01';
    await mount('/resumen?mes=2026-08');
    expect(mesMostrado()).toBe('agosto 2026');
    expect(rpcs('resumen_gastos').map(argsDe)).toContainEqual({ p_desde: '2026-08-01', p_hasta: '2026-08-31' });
    expect(rpcs('resumen_mensual').map(argsDe)).toEqual([{ p_mes_desde: '2026-08-01', p_meses: 1 }]);
  });

  it.each(['mes=2026-13', 'mes=2026-11', 'mes=1999-12', 'mes=2026-8', 'mes=toString', 'mes=%3Cscript%3E', 'mes=2026-10-01'])(
    'URL hostil (%s): el mes actual',
    async (q) => {
      await mount(`/resumen?${q}`);
      expect(mesMostrado()).toBe('octubre 2026');
      expect(rpcs('resumen_gastos').map(argsDe)).toContainEqual({ p_desde: '2026-10-01', p_hasta: '2026-10-31' });
    },
  );

  it('?vista=anio (todavía sin vista Año): el mes que le corresponde a ese año', async () => {
    MES_DESDE = '2025-12-01';
    await mount('/resumen?vista=anio&anio=2025');
    expect(mesMostrado()).toBe('diciembre 2025');
    await act(async () => root.unmount());
    container.remove();
    MES_DESDE = '2026-10-01';
    await mount('/resumen?vista=anio');
    expect(mesMostrado()).toBe('octubre 2026');
  });

  it('cambiar de mes: el mes va a la URL (?mes=) y se piden SUS datos; volver al actual lo saca de la URL', async () => {
    await mount();
    MES_DESDE = '2026-09-01';
    await click(buttonByLabel('Mes anterior'));
    expect(mesMostrado()).toBe('septiembre 2026');
    expect(search()).toBe('?mes=2026-09');
    expect(rpcs('resumen_gastos').map(argsDe)).toContainEqual({ p_desde: '2026-09-01', p_hasta: '2026-09-30' });
    MES_DESDE = '2026-10-01';
    await click(buttonByLabel('Mes siguiente'));
    expect(search()).toBe('');
    expect(mesMostrado()).toBe('octubre 2026');
  });

  it('desde ?vista=anio, cambiar de mes deja solo ?mes=', async () => {
    MES_DESDE = '2025-12-01';
    await mount('/resumen?vista=anio&anio=2025');
    MES_DESDE = '2025-11-01';
    await click(buttonByLabel('Mes anterior'));
    expect(search()).toBe('?mes=2025-11');
  });

  it('cambiar de mes REEMPLAZA la entrada del historial (no la agrega): "atrás" sale del Resumen, como en Viajes y Gastos', async () => {
    await mount(['/inicio-de-prueba', '/resumen']);
    const tipo = () => byId('ubicacion')!.dataset.tipo;
    MES_DESDE = '2026-09-01';
    await click(buttonByLabel('Mes anterior'));
    expect(search()).toBe('?mes=2026-09');
    expect(tipo()).toBe('REPLACE');
    MES_DESDE = '2026-08-01';
    await click(buttonByLabel('Mes anterior'));
    expect(tipo()).toBe('REPLACE');
    MES_DESDE = '2026-09-01';
    await click(buttonByLabel('Mes siguiente'));
    expect(search()).toBe('?mes=2026-09');
    expect(tipo()).toBe('REPLACE');
    // Tres cambios de mes y ninguna entrada nueva: "atrás" vuelve a la pantalla de antes, no a otro mes del Resumen.
    await click(byId('atras'));
    expect(byId('pantalla-anterior')).not.toBeNull();
    expect(byId('ubicacion')).toBeNull();
  });

  it('no se puede ir al mes que viene', async () => {
    await mount();
    expect(buttonByLabel('Mes siguiente')!.disabled).toBe(true);
  });

  it('mientras carga: UN aviso para lectores de pantalla; al terminar se vacía', async () => {
    route.viajes = () => new Promise(() => {});
    await mount();
    const avisos = [...document.querySelectorAll('[role="status"]')].map((el) => el.textContent).filter(Boolean);
    expect(avisos).toEqual(['Cargando el resumen de octubre 2026…']);
    expect(bodyText()).toContain('Cargando el resumen de octubre 2026…');
  });
});

// ---------------------------------------------------------------------------
// Bloque: gastos del mes y comparación
// ---------------------------------------------------------------------------
describe('pantalla Resumen: gastos del mes y comparación', () => {
  /** El gasto del período de comparación (todo lo que no es el mes mirado). */
  function comparacionDa(resp: () => Resp | Promise<Resp>) {
    route.gastos = (call) => (argsDe(call).p_desde === MES_DESDE ? ok(GASTOS_OCT) : resp());
  }

  it('el total (monto y cantidad) y la comparación con los mismos días del mes anterior (mes en curso)', async () => {
    await mount();
    expect(textoDe('resumen-gastos')).toContain('10.000,00');
    expect(textoDe('resumen-gastos')).toContain('8 gastos');
    expect(comparacion()).toBe('2.000,00 más (+25 %) vs. los mismos días de septiembre (8.000,00)');
    // Del 1 al 14 de septiembre (hoy es 14 de octubre).
    expect(rpcs('resumen_gastos').map(argsDe)).toContainEqual({ p_desde: '2026-09-01', p_hasta: '2026-09-14' });
    expect(byId('resumen-gastos')!.getAttribute('aria-busy')).toBe('false');
  });

  it('mes cerrado: contra el mes anterior COMPLETO, y lo dice ("vs. julio")', async () => {
    MES_DESDE = '2026-08-01';
    await mount('/resumen?mes=2026-08');
    expect(comparacion()).toBe('2.000,00 más (+25 %) vs. julio (8.000,00)');
    expect(rpcs('resumen_gastos').map(argsDe)).toContainEqual({ p_desde: '2026-07-01', p_hasta: '2026-07-31' });
  });

  it('enero se compara con diciembre del año anterior (con el año en el texto)', async () => {
    MES_DESDE = '2026-01-01';
    await mount('/resumen?mes=2026-01');
    expect(comparacion()).toBe('2.000,00 más (+25 %) vs. diciembre 2025 (8.000,00)');
    expect(rpcs('resumen_gastos').map(argsDe)).toContainEqual({ p_desde: '2025-12-01', p_hasta: '2025-12-31' });
  });

  it('menos que antes: "menos" y el % con signo menos', async () => {
    comparacionDa(() => ok([total(12000, 9)]));
    await mount();
    expect(comparacion()).toBe('2.000,00 menos (-17 %) vs. los mismos días de septiembre (12.000,00)');
  });

  it('igual que antes: "Lo mismo"', async () => {
    comparacionDa(() => ok([total(10000, 5)]));
    await mount();
    expect(comparacion()).toBe('Lo mismo vs. los mismos días de septiembre (10.000,00)');
  });

  it('una diferencia de menos de 1 % lo dice así (no "+0 %")', async () => {
    comparacionDa(() => ok([total(9990, 5)]));
    await mount();
    expect(comparacion()).toBe('10,00 más (menos de 1 %) vs. los mismos días de septiembre (9.990,00)');
  });

  it('el período anterior sin gastos: SIN porcentaje, y lo dice (en curso y cerrado)', async () => {
    comparacionDa(() => ok([total(0, 0)]));
    await mount();
    expect(comparacion()).toBe('Sin gastos en los mismos días de septiembre para comparar');
    expect(comparacion()).not.toContain('%');
    await act(async () => root.unmount());
    container.remove();
    MES_DESDE = '2026-08-01';
    comparacionDa(() => ok([total(0, 0)]));
    await mount('/resumen?mes=2026-08');
    expect(comparacion()).toBe('Sin gastos en julio para comparar');
  });

  it('el mes sin gastos (en curso): "Todavía no cargaste gastos este mes", sin comparación ni desgloses', async () => {
    route.gastos = () => ok([total(0, 0)]);
    await mount();
    expect(textoDe('resumen-gastos')).toBe('Gastos del mesTodavía no cargaste gastos este mes');
    expect(document.querySelector('[data-comparacion]')).toBeNull();
    expect(byId('resumen-por-categoria')).toBeNull();
    expect(byId('resumen-por-metodo')).toBeNull();
    expect(byId('resumen-por-camion')).toBeNull();
  });

  it('un mes cerrado sin gastos lo nombra: "No cargaste gastos en agosto 2026"', async () => {
    MES_DESDE = '2026-08-01';
    route.gastos = () => ok([total(0, 0)]);
    await mount('/resumen?mes=2026-08');
    expect(textoDe('resumen-gastos')).toContain('No cargaste gastos en agosto 2026');
  });

  it('mientras carga: filas grises y `aria-busy`, sin desgloses', async () => {
    route.gastos = () => new Promise(() => {});
    await mount();
    expect(byId('resumen-gastos')!.getAttribute('aria-busy')).toBe('true');
    expect(byId('resumen-gastos')!.querySelector('[data-cargando]')).not.toBeNull();
    expect(byId('resumen-por-categoria')).toBeNull();
  });

  it('la comparación cargando: el total ya se ve, y la comparación tiene SU línea gris', async () => {
    comparacionDa(() => new Promise<Resp>(() => {}));
    await mount();
    expect(textoDe('resumen-gastos')).toContain('10.000,00');
    expect(byId('resumen-gastos')!.getAttribute('aria-busy')).toBe('false');
    expect(document.querySelector('[data-comparacion] [data-cargando]')).not.toBeNull();
    expect(byId('resumen-por-categoria')).not.toBeNull();
  });

  it('error de red: el aviso con "Reintentar", que vuelve a pedir SOLO el gasto del mes', async () => {
    let falla = true;
    route.gastos = (call) => {
      if (argsDe(call).p_desde !== MES_DESDE) return ok([total(8000, 6)]);
      return falla ? sinRed() : ok(GASTOS_OCT);
    };
    await mount();
    expect(byId('resumen-gastos')!.querySelector('[role="alert"]')!.textContent).toContain(NETWORK_ERROR_MESSAGE);
    expect(byId('resumen-gastos')!.getAttribute('aria-busy')).toBe('false');
    // Con error ya no "carga": nada de filas grises junto al aviso.
    expect(byId('resumen-gastos')!.querySelector('[data-cargando]')).toBeNull();
    expect(byId('resumen-por-categoria')).toBeNull();
    const delMes = pedidosDeGastos('2026-10-01');
    const deComparacion = pedidosDeGastos('2026-09-01');
    const mensuales = rpcs('resumen_mensual').length;
    falla = false;
    await click(botonEn('resumen-gastos', 'Reintentar'));
    expect(pedidosDeGastos('2026-10-01')).toBe(delMes + 1);
    expect(pedidosDeGastos('2026-09-01')).toBe(deComparacion);
    expect(rpcs('resumen_mensual')).toHaveLength(mensuales);
    expect(byId('resumen-gastos')!.querySelector('[role="alert"]')).toBeNull();
    expect(textoDe('resumen-gastos')).toContain('10.000,00');
    expect(byId('resumen-por-categoria')).not.toBeNull();
  });

  it('22023 (período inválido): error inesperado, SIN "Reintentar" y sin el texto crudo de la base', async () => {
    route.gastos = () => errorBase('22023', 400);
    await mount();
    expect(textoDe('resumen-gastos')).toContain(RESUMEN_ERROR_INESPERADO);
    expect(botonEn('resumen-gastos', 'Reintentar')).toBeUndefined();
    expect(bodyText()).not.toContain('detalle interno');
  });

  it('42501 (sin cuenta): lo dice, sin "Reintentar"', async () => {
    route.gastos = () => errorBase('42501', 403);
    await mount();
    expect(textoDe('resumen-gastos')).toContain(RESUMEN_SIN_CUENTA);
    expect(botonEn('resumen-gastos', 'Reintentar')).toBeUndefined();
  });

  it('una respuesta fuera de contrato: error inesperado CON "Reintentar" (y nada a medias)', async () => {
    route.gastos = () => ok([total(10000, 8), { grupo: 'otro', clave: null, nombre: null, activa: null, cantidad: 1, monto: 1 }]);
    await mount();
    expect(textoDe('resumen-gastos')).toContain(RESUMEN_ERROR_INESPERADO);
    expect(botonEn('resumen-gastos', 'Reintentar')).toBeDefined();
    expect(textoDe('resumen-gastos')).not.toContain('10.000,00');
  });

  it('falla SOLO la comparación: el total y los desgloses se ven; la comparación tiene su error y su "Reintentar"', async () => {
    let falla = true;
    comparacionDa(() => (falla ? sinRed() : ok([total(8000, 6)])));
    await mount();
    expect(textoDe('resumen-gastos')).toContain('10.000,00');
    expect(byId('resumen-por-categoria')).not.toBeNull();
    const aviso = document.querySelector('[data-comparacion] [role="alert"]')!;
    expect(plano(aviso.textContent)).toContain(`No pudimos comparar con los mismos días de septiembre. ${NETWORK_ERROR_MESSAGE}`);
    const delMes = pedidosDeGastos('2026-10-01');
    falla = false;
    await click(botonEn('resumen-gastos', 'Reintentar'));
    expect(pedidosDeGastos('2026-10-01')).toBe(delMes);
    expect(comparacion()).toBe('2.000,00 más (+25 %) vs. los mismos días de septiembre (8.000,00)');
  });

  it('sin conexión, lo que falta queda en pausa y se AVISA (visible); al volver la señal, carga', async () => {
    await mount();
    await act(async () => onlineManager.setOnline(false));
    MES_DESDE = '2026-09-01';
    await click(buttonByLabel('Mes anterior'));
    const estado = [...document.querySelectorAll('[role="status"]')].find((el) => el.textContent?.includes(RESUMEN_SIN_CONEXION));
    expect(estado).toBeDefined();
    expect(estado!.className).not.toContain('sr-only');
    expect(byId('resumen-gastos')!.getAttribute('aria-busy')).toBe('true');
    await act(async () => onlineManager.setOnline(true));
    await settle();
    expect(bodyText()).not.toContain(RESUMEN_SIN_CONEXION);
    expect(textoDe('resumen-gastos')).toContain('10.000,00');
  });

  /** El `role="status"` de la pantalla (el único que hay). */
  const estadoDeLaPantalla = () => {
    const estados = [...document.querySelectorAll<HTMLElement>('[role="status"]')];
    expect(estados).toHaveLength(1);
    return estados[0]!;
  };

  it('SOLO la comparación cargando (los otros 4 ya llegaron): el estado para lectores de pantalla anuncia la carga', async () => {
    comparacionDa(() => new Promise<Resp>(() => {}));
    await mount();
    // Los otros cuatro bloques ya están: nada ocupado salvo la línea de la comparación.
    for (const id of ['resumen-gastos', 'resumen-resultado', 'resumen-combustible', 'resumen-viajes']) {
      expect(byId(id)!.getAttribute('aria-busy'), id).toBe('false');
    }
    expect(document.querySelector('[data-comparacion] [data-cargando]')).not.toBeNull();
    expect(estadoDeLaPantalla().textContent).toBe('Cargando el resumen de octubre 2026…');
    expect(estadoDeLaPantalla().className).toBe('sr-only');
  });

  it('SOLO la comparación en pausa por falta de red (lo demás ya en caché): se VE el aviso de sin conexión; al volver la señal, compara', async () => {
    await mount();
    // Septiembre ya pedido antes (fresco en caché) salvo su comparación (agosto completo: es un mes cerrado).
    const t = MIEMBRO.transportista_id;
    queryClient.setQueryData(resumenKeys.gastos(t, '2026-09-01', '2026-09-30'), parseResumenGastos(GASTOS_OCT));
    queryClient.setQueryData(resumenKeys.mensual(t, '2026-09-01', 1), parseResumenMensual([mesFila('2026-09-01')], { mesDesde: { year: 2026, month: 9 }, meses: 1 }));
    queryClient.setQueryData(resumenKeys.combustible(t, '2026-09-01', '2026-09-30', null), parseResumenCombustible([combFila()]));
    queryClient.setQueryData(resumenKeys.viajes(t, '2026-09-01', '2026-09-30'), parseResumenViajes([viajeFila({ total_viajes: 1 })]));
    await act(async () => onlineManager.setOnline(false));
    MES_DESDE = '2026-09-01';
    h.calls.length = 0;
    await click(buttonByLabel('Mes anterior'));

    expect(h.calls).toHaveLength(0); // sin red no salió nada: lo de septiembre vino de la caché
    for (const id of ['resumen-gastos', 'resumen-resultado', 'resumen-combustible', 'resumen-viajes']) {
      expect(byId(id)!.getAttribute('aria-busy'), id).toBe('false');
    }
    expect(textoDe('resumen-gastos')).toContain('10.000,00');
    expect(document.querySelector('[data-comparacion] [data-cargando]')).not.toBeNull();
    expect(plano(estadoDeLaPantalla().textContent)).toBe(RESUMEN_SIN_CONEXION);
    expect(estadoDeLaPantalla().className).not.toContain('sr-only');

    await act(async () => onlineManager.setOnline(true));
    await settle();
    expect(rpcs('resumen_gastos').map(argsDe)).toEqual([{ p_desde: '2026-08-01', p_hasta: '2026-08-31' }]);
    expect(estadoDeLaPantalla().textContent).toBe('');
    expect(comparacion()).toBe('2.000,00 más (+25 %) vs. agosto (8.000,00)');
  });
});

// ---------------------------------------------------------------------------
// Desgloses: por categoría, por método de pago, por camión
// ---------------------------------------------------------------------------
describe('pantalla Resumen: desgloses con barras', () => {
  const categorias = (n: number) =>
    Array.from({ length: n }, (_, i) => cat(`a2000000-0000-4000-8000-00000000000${i}`, `Categoría ${i + 1}`, (n - i) * 100, i + 1));
  function gastosDelMes(filas: FilaGasto[]) {
    route.gastos = (call) => (argsDe(call).p_desde === MES_DESDE ? ok(filas) : ok([total(8000, 6)]));
  }

  it('por categoría: nombre (de la respuesta), monto, cantidad y % del total; la barra mide el %', async () => {
    await mount();
    expect(barras('resumen-por-categoria')).toEqual([
      ['Combustible', '7.000,00', '3 gastos · 70 % del total'],
      ['Peajes', '2.000,00', '4 gastos · 20 % del total'],
      ['Comida', '1.000,00', '1 gasto · 10 % del total'],
    ]);
    expect(anchos('resumen-por-categoria')).toEqual(['70%', '20%', '10%']);
  });

  it('las barras son solo visuales (aria-hidden) y cada valor está en texto', async () => {
    await mount();
    for (const id of ['resumen-por-categoria', 'resumen-por-metodo', 'resumen-por-camion']) {
      const filas = [...byId(id)!.querySelectorAll('li[data-fila]')];
      expect(filas.length, id).toBeGreaterThan(0);
      for (const fila of filas) {
        const barra = fila.querySelector('.bg-muted')!;
        expect(barra.getAttribute('aria-hidden'), id).toBe('true');
        expect(barra.textContent).toBe('');
        expect(plano(fila.textContent)).toMatch(/\d+,\d\d.*gastos? · .*% del total$/);
      }
    }
  });

  it('más de 6 categorías: las 5 de mayor monto + "Otras" con la suma del resto', async () => {
    const filas = categorias(8); // montos 800, 700, …, 100; cantidades 1..8
    gastosDelMes([total(3600, 36), ...filas]);
    await mount();
    expect(barras('resumen-por-categoria')).toEqual([
      ['Categoría 1', '800,00', '1 gasto · 22 % del total'],
      ['Categoría 2', '700,00', '2 gastos · 19 % del total'],
      ['Categoría 3', '600,00', '3 gastos · 17 % del total'],
      ['Categoría 4', '500,00', '4 gastos · 14 % del total'],
      ['Categoría 5', '400,00', '5 gastos · 11 % del total'],
      ['Otras (3 categorías)', '600,00', '21 gastos · 17 % del total'],
    ]);
  });

  it('exactamente 6 categorías: se ven las 6 (no hay "Otras" de una sola)', async () => {
    gastosDelMes([total(2100, 21), ...categorias(6)]);
    await mount();
    expect(barras('resumen-por-categoria').map((f) => f[0])).toEqual([1, 2, 3, 4, 5, 6].map((i) => `Categoría ${i}`));
  });

  it('los % suman 100 (tercios: 34 / 33 / 33) y uno muy chico dice "menos de 1 %"', async () => {
    gastosDelMes([total(3000, 3), cat(CAT_A, 'Uno', 1000), cat(CAT_B, 'Dos', 1000), cat('a1000000-0000-4000-8000-000000000003', 'Tres', 1000)]);
    await mount();
    expect(barras('resumen-por-categoria').map((f) => f[2])).toEqual(['1 gasto · 34 % del total', '1 gasto · 33 % del total', '1 gasto · 33 % del total']);
    // El texto redondea (34 / 33 / 33) pero las barras miden el % EXACTO: las tres iguales.
    for (const ancho of anchos('resumen-por-categoria')) expect(parseFloat(ancho)).toBeCloseTo(100 / 3, 3);
    await act(async () => root.unmount());
    container.remove();
    queryClient.clear();
    gastosDelMes([total(100000, 2), cat(CAT_A, 'Grande', 99990), cat(CAT_B, 'Chica', 10)]);
    await mount();
    expect(barras('resumen-por-categoria')[1]).toEqual(['Chica', '10,00', '1 gasto · menos de 1 % del total']);
  });

  it('el nombre de la categoría se muestra como TEXTO (nunca como HTML)', async () => {
    gastosDelMes([total(100, 1), cat(CAT_A, '<img src=x onerror=alert(1)>', 100)]);
    await mount();
    expect(barras('resumen-por-categoria')[0]![0]).toBe('<img src=x onerror=alert(1)>');
    expect(document.querySelector('img')).toBeNull();
  });

  it('por método de pago, con "Sin especificar"', async () => {
    await mount();
    expect(barras('resumen-por-metodo')).toEqual([
      ['Efectivo', '6.000,00', '5 gastos · 60 % del total'],
      ['Sin especificar', '4.000,00', '3 gastos · 40 % del total'],
    ]);
  });

  it('por camión: la patente con espacios y "Sin camión"', async () => {
    await mount();
    expect(barras('resumen-por-camion')).toEqual([
      ['AB 123 CD', '7.500,00', '4 gastos · 75 % del total'],
      ['Sin camión', '2.500,00', '4 gastos · 25 % del total'],
    ]);
  });

  it('un camión archivado dice "(archivado)"', async () => {
    gastosDelMes([total(1000, 2), cat(CAT_A, 'Peajes', 1000, 2), met('efectivo', 1000, 2), cam('c1000000-0000-4000-8000-000000000002', 'CD456EF', false, 1000, 2)]);
    await mount();
    expect(barras('resumen-por-camion')).toEqual([['CD 456 EF (archivado)', '1.000,00', '2 gastos · 100 % del total']]);
  });

  it('sin ningún gasto con camión (solo "Sin camión"), el desglose por camión NO aparece', async () => {
    gastosDelMes([total(1000, 2), cat(CAT_A, 'Peajes', 1000, 2), met('efectivo', 1000, 2), cam(null, null, null, 1000, 2)]);
    await mount();
    expect(byId('resumen-por-categoria')).not.toBeNull();
    expect(byId('resumen-por-metodo')).not.toBeNull();
    expect(byId('resumen-por-camion')).toBeNull();
  });

  it('títulos en orden: un h1 y un h2 por bloque (cada sección se nombra con su h2)', async () => {
    await mount();
    expect(document.querySelectorAll('h1')).toHaveLength(1);
    expect(h2s().slice(0, 4)).toEqual(['Gastos del mes', 'Por categoría', 'Por método de pago', 'Por camión']);
    for (const id of ['resumen-gastos', 'resumen-por-categoria', 'resumen-por-metodo', 'resumen-por-camion']) {
      const seccion = byId(id)!;
      expect(seccion.tagName).toBe('SECTION');
      expect(byId(seccion.getAttribute('aria-labelledby')!)!.tagName).toBe('H2');
    }
  });
});

// ---------------------------------------------------------------------------
// Bloque: ingresos y resultado
// ---------------------------------------------------------------------------
describe('pantalla Resumen: ingresos y resultado', () => {
  const resultado = () => plano(byId('resumen-resultado')?.querySelector('[data-resultado]')?.textContent);
  const datos = () => [...(byId('resumen-resultado')?.querySelectorAll('dl > div') ?? [])].map((d) => plano(d.textContent));
  const mensualCon = (over: Record<string, unknown>) => {
    route.mensual = (call) => ok([mesFila(String(argsDe(call).p_mes_desde), over)]);
  };

  it('ganancia: "Ganancia" con el monto, los ingresos y los gastos del mes, y qué es el resultado', async () => {
    await mount();
    expect(resultado()).toBe('Ganancia15.000,00');
    expect(datos()).toEqual(['Ingresos de viajes25.000,003 viajes con ingreso', 'Gastos del mes10.000,00']);
    expect(textoDe('resumen-resultado')).toContain('lo que cobraste por los viajes del mes menos todos los gastos del mes');
    expect(textoDe('resumen-resultado')).not.toContain('incompleto');
    expect(byId('resumen-resultado')!.querySelector('.text-destructive-text')).toBeNull();
  });

  it('pérdida: se dice "Pérdida" con la palabra y el monto va sin signo', async () => {
    mensualCon({ viajes_ingreso: 7000, resultado: -3000 });
    await mount();
    expect(resultado()).toBe('Pérdida3.000,00');
    expect(textoDe('resumen-resultado')).not.toContain('-3.000');
    expect(textoDe('resumen-resultado')).not.toContain('Ganancia');
    expect(byId('resumen-resultado')!.querySelector('[data-resultado] .text-destructive-text')!.textContent).toBe('3.000,00');
  });

  it('resultado 0: "Resultado", ni ganancia ni pérdida', async () => {
    mensualCon({ viajes_ingreso: 10000, resultado: 0 });
    await mount();
    expect(resultado()).toBe('Resultado0,00');
  });

  it('resultado null (ningún viaje con ingreso): NO hay resultado; invita a cargar el ingreso, con enlace a los viajes del mes', async () => {
    mensualCon({ viajes_con_ingreso: 0, viajes_sin_ingreso: 3, viajes_ingreso: 0, resultado: null });
    await mount();
    expect(byId('resumen-resultado')!.querySelector('[data-resultado]')).toBeNull();
    const texto = textoDe('resumen-resultado');
    expect(texto).toContain('Ninguno de tus 3 viajes del mes tiene el ingreso cargado. Cárgalo para ver si el mes dio ganancia o pérdida.');
    expect(texto).not.toMatch(/Ganancia|Pérdida|Resultado/);
    expect(texto).not.toContain('lo que cobraste');
    const enlace = byId('resumen-resultado')!.querySelector<HTMLAnchorElement>('a')!;
    expect(enlace.textContent).toBe('Ver los viajes del mes');
    expect(enlace.getAttribute('href')).toBe('/viajes');
    expect(datos()).toEqual(['Ingresos de viajes0,000 de 3 viajes con ingreso', 'Gastos del mes10.000,00']);
  });

  it('resultado null con un solo viaje y sin viajes: el texto que corresponde', async () => {
    mensualCon({ viajes_cantidad: 1, viajes_con_ingreso: 0, viajes_sin_ingreso: 1, viajes_ingreso: 0, resultado: null });
    await mount();
    expect(textoDe('resumen-resultado')).toContain('Tu viaje del mes no tiene el ingreso cargado.');
    await act(async () => root.unmount());
    container.remove();
    queryClient.clear();
    mensualCon({ viajes_cantidad: 0, viajes_km: 0, viajes_con_ingreso: 0, viajes_sin_ingreso: 0, viajes_ingreso: 0, resultado: null });
    await mount();
    expect(textoDe('resumen-resultado')).toContain('No hay viajes en el mes. Carga tus viajes con su ingreso para ver si el mes dio ganancia o pérdida.');
    expect(datos()[0]).toBe('Ingresos de viajes0,00');
  });

  it('en un mes cerrado, el enlace lleva a los viajes de ESE mes', async () => {
    MES_DESDE = '2026-08-01';
    mensualCon({ viajes_con_ingreso: 0, viajes_sin_ingreso: 3, viajes_ingreso: 0, resultado: null });
    await mount('/resumen?mes=2026-08');
    expect(byId('resumen-resultado')!.querySelector('a')!.getAttribute('href')).toBe('/viajes?mes=2026-08');
  });

  it('con viajes sin ingreso, el resultado se muestra CON el aviso de que puede estar incompleto', async () => {
    mensualCon({ viajes_con_ingreso: 1, viajes_sin_ingreso: 2, viajes_ingreso: 12000, resultado: 2000 });
    await mount();
    expect(resultado()).toBe('Ganancia2.000,002 viajes sin ingreso cargado: el resultado puede estar incompleto.');
    expect(datos()[0]).toBe('Ingresos de viajes12.000,001 de 3 viajes con ingreso');
    await act(async () => root.unmount());
    container.remove();
    queryClient.clear();
    mensualCon({ viajes_con_ingreso: 2, viajes_sin_ingreso: 1, viajes_ingreso: 8000, resultado: -2000 });
    await mount();
    expect(resultado()).toBe('Pérdida2.000,001 viaje sin ingreso cargado: el resultado puede estar incompleto.');
  });

  it('pide la fila de ESE mes (un mes) y la valida: un mes que no es el pedido es un error, con "Reintentar"', async () => {
    route.mensual = () => ok([mesFila('2026-09-01')]);
    await mount();
    expect(rpcs('resumen_mensual').map(argsDe)).toEqual([{ p_mes_desde: '2026-10-01', p_meses: 1 }]);
    expect(textoDe('resumen-resultado')).toContain(RESUMEN_ERROR_INESPERADO);
    expect(botonEn('resumen-resultado', 'Reintentar')).toBeDefined();
    expect(resultado()).toBe('');
  });

  it('mientras carga: `aria-busy` y filas grises; los gastos ya se ven', async () => {
    route.mensual = () => new Promise(() => {});
    await mount();
    expect(byId('resumen-resultado')!.getAttribute('aria-busy')).toBe('true');
    expect(byId('resumen-resultado')!.querySelector('[data-cargando]')).not.toBeNull();
    expect(textoDe('resumen-gastos')).toContain('10.000,00');
  });

  it('si falla, su "Reintentar" pide SOLO el resultado; los gastos se siguen viendo', async () => {
    let falla = true;
    route.mensual = (call) => (falla ? sinRed() : ok([mesFila(String(argsDe(call).p_mes_desde))]));
    await mount();
    expect(textoDe('resumen-resultado')).toContain(NETWORK_ERROR_MESSAGE);
    expect(textoDe('resumen-gastos')).toContain('10.000,00');
    const gastos = rpcs('resumen_gastos').length;
    const mensuales = rpcs('resumen_mensual').length;
    falla = false;
    await click(botonEn('resumen-resultado', 'Reintentar'));
    expect(rpcs('resumen_mensual')).toHaveLength(mensuales + 1);
    expect(rpcs('resumen_gastos')).toHaveLength(gastos);
    expect(resultado()).toBe('Ganancia15.000,00');
  });

  it('si fallan los gastos, el resultado se sigue viendo (cada bloque con su consulta)', async () => {
    route.gastos = () => sinRed();
    await mount();
    expect(textoDe('resumen-gastos')).toContain(NETWORK_ERROR_MESSAGE);
    expect(resultado()).toBe('Ganancia15.000,00');
  });
});

// ---------------------------------------------------------------------------
// Bloque: combustible por camión
// ---------------------------------------------------------------------------
describe('pantalla Resumen: combustible por camión', () => {
  const SIN_TRAMOS = { tramos: 0, tramos_km: null, tramos_litros: null, tramos_monto: null, km_por_litro: null, litros_100km: null, costo_por_km: null };
  const camiones = () => [...(byId('resumen-combustible')?.querySelectorAll('article') ?? [])];
  /** Los pares etiqueta/valor de un `dl`: ['Cargas: 3 cargas', …]. */
  const pares = (dl: Element | null | undefined) =>
    [...(dl?.querySelectorAll(':scope > div') ?? [])].map((d) => `${plano(d.querySelector('dt')?.textContent)}: ${plano(d.querySelector('dd')?.textContent)}`);
  const combustibleDa = (...filas: Record<string, unknown>[]) => {
    route.combustible = () => ok(filas.map((f) => combFila(f)));
  };

  it('pide el mes completo, de todos los camiones (sin filtro de camión)', async () => {
    await mount();
    expect(rpcs('resumen_combustible').map(argsDe)).toEqual([{ p_desde: '2026-10-01', p_hasta: '2026-10-31' }]);
  });

  it('con tramos válidos: cargas, litros, gasto y precio promedio; km/L, L/100 km y costo por km; UNA línea de tramos', async () => {
    await mount();
    const [camion] = camiones();
    expect(camiones()).toHaveLength(1);
    expect(camion!.querySelector('h3')!.textContent).toBe('AB 123 CD');
    expect(pares(camion!.querySelector('dl:not([data-rendimiento])'))).toEqual([
      'Cargas: 3 cargas',
      'Litros: 300,5 L',
      'Gasto: 7.000,00',
      'Precio promedio: 23,29 por litro',
    ]);
    expect(pares(camion!.querySelector('dl[data-rendimiento]'))).toEqual(['Rendimiento: 3,0 km/L', 'Consumo: 33,3 L/100 km', 'Costo por km: 7,67']);
    expect(camion!.querySelectorAll('[data-tramos]')).toHaveLength(1);
    expect(plano(camion!.querySelector('[data-tramos]')!.textContent)).toBe('2 tramos usados (900 km, 300,0 L), ninguno descartado.');
    expect(camion!.querySelector('[data-sin-rendimiento]')).toBeNull();
  });

  it('decimales: km/L con hasta 2, litros con hasta 3', async () => {
    combustibleDa({ km_por_litro: 2.849, litros: 40.125, tramos_litros: 315.25, litros_100km: 35.1 });
    await mount();
    const [camion] = camiones();
    expect(pares(camion!.querySelector('dl[data-rendimiento]'))[0]).toBe('Rendimiento: 2,85 km/L');
    expect(pares(camion!.querySelector('dl:not([data-rendimiento])'))[1]).toBe('Litros: 40,125 L');
    expect(plano(camion!.querySelector('[data-tramos]')!.textContent)).toBe('2 tramos usados (900 km, 315,25 L), ninguno descartado.');
  });

  it('sin tramos: "Todavía no hay rendimiento…", sin km/L ni línea de tramos (no hubo descartes)', async () => {
    combustibleDa({ ...SIN_TRAMOS, llenas_con_odometro: 1 });
    await mount();
    const [camion] = camiones();
    expect(plano(camion!.querySelector('[data-sin-rendimiento]')!.textContent)).toBe(
      'Todavía no hay rendimiento para este camión: carga el odómetro en cargas con tanque lleno',
    );
    expect(camion!.querySelector('[data-rendimiento]')).toBeNull();
    expect(camion!.querySelector('[data-tramos]')).toBeNull();
    expect(plano(camion!.textContent)).not.toContain('km/L');
  });

  it('sin tramos pero con descartes: el aviso Y la línea que dice por qué se descartaron (cuántos por motivo)', async () => {
    combustibleDa({ ...SIN_TRAMOS, descartados_retroceso: 2, descartados_fuera_de_rango: 1 });
    await mount();
    const [camion] = camiones();
    expect(camion!.querySelector('[data-sin-rendimiento]')).not.toBeNull();
    expect(plano(camion!.querySelector('[data-tramos]')!.textContent)).toBe(
      'Ningún tramo usado, 3 descartados: el odómetro bajó respecto de la carga llena anterior (2); dio menos de 0,5 o más de 15 km por litro: casi siempre es un odómetro mal escrito (1).',
    );
  });

  it('con tramos y un descarte: el motivo, en la misma línea', async () => {
    combustibleDa({ descartados_sin_avance: 1 });
    await mount();
    expect(plano(camiones()[0]!.querySelector('[data-tramos]')!.textContent)).toBe(
      '2 tramos usados (900 km, 300,0 L), 1 descartado: el odómetro no avanzó desde la carga llena anterior.',
    );
  });

  it('varios camiones, en el orden recibido, cada uno con su h3 (archivado incluido)', async () => {
    combustibleDa({}, { camion_id: 'c1000000-0000-4000-8000-000000000002', patente: 'CD456EF', activa: false, ...SIN_TRAMOS });
    await mount();
    expect(camiones().map((a) => a.querySelector('h3')!.textContent)).toEqual(['AB 123 CD', 'CD 456 EF (archivado)']);
    for (const article of camiones()) {
      expect(byId(article.getAttribute('aria-labelledby')!)!.tagName).toBe('H3');
    }
    expect(byId('resumen-combustible')!.querySelector('h2')!.textContent).toBe('Combustible por camión');
  });

  it('un camión sin cargas en el mes (0): sin precio promedio', async () => {
    combustibleDa({ ...SIN_TRAMOS, cargas: 0, litros: 0, monto: 0, precio_promedio: null, llenas_con_odometro: 0 });
    await mount();
    expect(pares(camiones()[0]!.querySelector('dl'))).toEqual(['Cargas: 0 cargas', 'Litros: 0,0 L', 'Gasto: 0,00']);
  });

  it('sin cargas de combustible en el mes: lo dice (en curso y cerrado)', async () => {
    route.combustible = () => ok([]);
    await mount();
    expect(textoDe('resumen-combustible')).toContain('Todavía no cargaste combustible este mes');
    expect(camiones()).toHaveLength(0);
    await act(async () => root.unmount());
    container.remove();
    MES_DESDE = '2026-08-01';
    await mount('/resumen?mes=2026-08');
    expect(textoDe('resumen-combustible')).toContain('No cargaste combustible en agosto 2026');
  });

  it('"¿Cómo se calcula?": un <details> cerrado, con lleno a lleno, parciales, mes de cierre, descartes y el ponderado', async () => {
    await mount();
    const details = byId('resumen-combustible')!.querySelector('details')!;
    expect(details.open).toBe(false);
    expect(details.querySelector('summary')!.textContent).toBe('¿Cómo se calcula?');
    const texto = plano(details.textContent);
    expect(texto).toContain('tanque lleno a tanque lleno');
    expect(texto).toContain('Solo una carga con tanque lleno Y odómetro cierra un tramo');
    expect(texto).toContain('Las cargas parciales del medio suman sus litros');
    expect(texto).toContain('Cada tramo cuenta en el mes en que se cierra');
    expect(texto).toContain('el odómetro bajó o no avanzó');
    expect(texto).toContain('menos de 0,5 o más de 15 km por litro');
    expect(texto).toContain('ponderado: todos los km de los tramos divididos por todos sus litros');
    expect(details.querySelectorAll('li')).toHaveLength(5);
  });

  it('el <details> también está cuando no hay cargas', async () => {
    route.combustible = () => ok([]);
    await mount();
    expect(byId('resumen-combustible')!.querySelector('details summary')).not.toBeNull();
  });

  it('mientras carga: `aria-busy`; si falla, su "Reintentar" pide SOLO el combustible y el resto se ve', async () => {
    let estado: 'cargando' | 'falla' | 'ok' = 'cargando';
    route.combustible = () => (estado === 'cargando' ? new Promise(() => {}) : estado === 'falla' ? sinRed() : ok([combFila()]));
    await mount();
    expect(byId('resumen-combustible')!.getAttribute('aria-busy')).toBe('true');
    await act(async () => root.unmount());
    container.remove();
    queryClient.clear();
    estado = 'falla';
    await mount();
    expect(textoDe('resumen-combustible')).toContain(NETWORK_ERROR_MESSAGE);
    expect(textoDe('resumen-gastos')).toContain('10.000,00');
    expect(textoDe('resumen-resultado')).toContain('15.000,00');
    const pedidos = rpcs('resumen_combustible').length;
    const otros = h.calls.length - pedidos;
    estado = 'ok';
    await click(botonEn('resumen-combustible', 'Reintentar'));
    expect(rpcs('resumen_combustible')).toHaveLength(pedidos + 1);
    expect(h.calls.length - rpcs('resumen_combustible').length).toBe(otros);
    expect(camiones()).toHaveLength(1);
  });

  it('una fila fuera de contrato (rendimiento sin tramos): error inesperado, nada a medias', async () => {
    combustibleDa({ tramos: 0 });
    await mount();
    expect(textoDe('resumen-combustible')).toContain(RESUMEN_ERROR_INESPERADO);
    expect(camiones()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Bloque: viajes del mes
// ---------------------------------------------------------------------------
describe('pantalla Resumen: viajes del mes', () => {
  const filasDeViajes = () => [...(byId('resumen-viajes')?.querySelectorAll('li[data-viaje]') ?? [])];
  /** Una fila: [recorrido, ganancia, detalle, plata]. */
  const fila = (li: Element) => {
    const ps = li.querySelectorAll('a p');
    return [plano(ps[0]?.textContent), plano(ps[1]?.textContent), plano(ps[2]?.textContent), plano(ps[3]?.textContent)];
  };
  const viajesDa = (...filas: Record<string, unknown>[]) => {
    route.viajes = () => ok(filas.map((f) => viajeFila(f)));
  };

  it('pide el mes completo', async () => {
    await mount();
    expect(rpcs('resumen_viajes').map(argsDe)).toEqual([{ p_desde: '2026-10-01', p_hasta: '2026-10-31' }]);
  });

  it('las filas en el orden en que llegan, cada una enlazada a /viajes/:id (y "volver" a la lista de Viajes del mes)', async () => {
    await mount();
    expect(filasDeViajes().map((li) => li.getAttribute('data-viaje'))).toEqual([V1, V2]);
    expect(filasDeViajes().map((li) => li.querySelector('a')!.getAttribute('href'))).toEqual([`/viajes/${V1}`, `/viajes/${V2}`]);
    await click(filasDeViajes()[0]!.querySelector('a'));
    expect(byId('destino')!.dataset.pathname).toBe(`/viajes/${V1}`);
  });

  it('una fila con todo: recorrido, ganancia, fecha · camión · km, e ingreso · gastos del viaje', async () => {
    await mount();
    expect(fila(filasDeViajes()[0]!)).toEqual(['Rosario → a Córdoba', 'Ganancia 12.000,00', '12 oct · AB 123 CD · 400 km', 'Ingreso 15.000,00 · 2 gastos: 3.000,00']);
  });

  it('sin ingreso: "Sin ingreso" en vez de ganancia; sin camión ni km, no se inventan; sin gastos lo dice', async () => {
    await mount();
    expect(fila(filasDeViajes()[1]!)).toEqual(['Salta → a Jujuy', 'Sin ingreso', '3 oct', 'Sin gastos']);
    expect(plano(filasDeViajes()[1]!.textContent)).not.toMatch(/Ganancia|Pérdida/);
  });

  it('ganancia negativa: "Pérdida" con la palabra, sin signo; un ingreso 0 también cuenta', async () => {
    viajesDa({ ingreso: 1000, gastos_monto: 3000, ganancia: -2000 }, { viaje_id: V2, ingreso: 0, gastos_monto: 500, gastos_cantidad: 1, ganancia: -500 });
    await mount();
    expect(fila(filasDeViajes()[0]!)[1]).toBe('Pérdida 2.000,00');
    expect(filasDeViajes()[0]!.querySelector('[data-ganancia] .text-destructive-text')!.textContent).toBe('2.000,00');
    expect(fila(filasDeViajes()[1]!)).toEqual(['Rosario → a Córdoba', 'Pérdida 500,00', '12 oct · AB 123 CD · 400 km', 'Ingreso 0,00 · 1 gasto: 500,00']);
    expect(textoDe('resumen-viajes')).not.toContain('-2.000');
  });

  it('ganancia 0: "Resultado 0,00"', async () => {
    viajesDa({ ingreso: 3000, gastos_monto: 3000, ganancia: 0, total_viajes: 1 });
    await mount();
    expect(fila(filasDeViajes()[0]!)[1]).toBe('Resultado 0,00');
  });

  it('la cantidad de viajes del mes', async () => {
    await mount();
    expect(byId('resumen-viajes')!.querySelector('h2 + div > p')!.textContent).toBe('2 viajes');
  });

  it('si la base cortó la lista, lo avisa (como nota, no como alerta) y dice cuántos hay', async () => {
    viajesDa({ total_viajes: 600 }, { viaje_id: V2, total_viajes: 600 });
    await mount();
    const nota = byId('resumen-viajes')!.querySelector('[data-cortada]')!;
    expect(nota.getAttribute('role')).toBe('note');
    expect(plano(nota.textContent)).toBe('Hay 600 viajes en este período: se muestran los 2 más nuevos.');
    expect(textoDe('resumen-viajes')).toContain('600 viajes');
  });

  it('si no se cortó, no hay aviso', async () => {
    await mount();
    expect(byId('resumen-viajes')!.querySelector('[data-cortada]')).toBeNull();
    expect(textoDe('resumen-viajes')).not.toContain('se muestran');
  });

  it('sin viajes: lo dice (en curso y cerrado)', async () => {
    route.viajes = () => ok([]);
    await mount();
    expect(textoDe('resumen-viajes')).toBe('Viajes del mesTodavía no hay viajes este mes');
    await act(async () => root.unmount());
    container.remove();
    MES_DESDE = '2026-08-01';
    await mount('/resumen?mes=2026-08');
    expect(textoDe('resumen-viajes')).toContain('No hubo viajes en agosto 2026');
  });

  it('origen y destino se muestran como TEXTO', async () => {
    viajesDa({ origen: '<b>Rosario</b>', destino: '<script>x</script>', total_viajes: 1 });
    await mount();
    expect(fila(filasDeViajes()[0]!)[0]).toBe('<b>Rosario</b> → a <script>x</script>');
    expect(byId('resumen-viajes')!.querySelector('b, script')).toBeNull();
  });

  it('cada fila es un enlace de al menos 64 px (min-h-16) con foco visible', async () => {
    await mount();
    for (const li of filasDeViajes()) {
      const clases = li.querySelector('a')!.className;
      expect(clases).toContain('min-h-16');
      expect(clases).toContain('focus-visible:ring-2');
    }
  });

  it('mientras carga: `aria-busy`; si falla, su "Reintentar" pide SOLO los viajes y lo demás se ve', async () => {
    let estado: 'cargando' | 'falla' | 'ok' = 'cargando';
    route.viajes = () => (estado === 'cargando' ? new Promise(() => {}) : estado === 'falla' ? sinRed() : ok([viajeFila({ total_viajes: 1 })]));
    await mount();
    expect(byId('resumen-viajes')!.getAttribute('aria-busy')).toBe('true');
    expect(textoDe('resumen-gastos')).toContain('10.000,00');
    await act(async () => root.unmount());
    container.remove();
    queryClient.clear();
    estado = 'falla';
    await mount();
    expect(textoDe('resumen-viajes')).toContain(NETWORK_ERROR_MESSAGE);
    expect(byId('resumen-combustible')!.querySelectorAll('article')).toHaveLength(1);
    const pedidos = rpcs('resumen_viajes').length;
    const otros = h.calls.length - pedidos;
    estado = 'ok';
    await click(botonEn('resumen-viajes', 'Reintentar'));
    expect(rpcs('resumen_viajes')).toHaveLength(pedidos + 1);
    expect(h.calls.length - rpcs('resumen_viajes').length).toBe(otros);
    expect(filasDeViajes()).toHaveLength(1);
  });

  it('una respuesta fuera de contrato (ganancia sin ingreso): error inesperado, ninguna fila', async () => {
    viajesDa({ ingreso: null, ganancia: 100 });
    await mount();
    expect(textoDe('resumen-viajes')).toContain(RESUMEN_ERROR_INESPERADO);
    expect(filasDeViajes()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// La pantalla entera
// ---------------------------------------------------------------------------
describe('pantalla Resumen: todos los bloques', () => {
  it('el orden de los bloques y la jerarquía de títulos (h1 → h2 → h3)', async () => {
    await mount();
    expect(h2s()).toEqual(['Gastos del mes', 'Por categoría', 'Por método de pago', 'Por camión', 'Ingresos y resultado', 'Combustible por camión', 'Viajes del mes']);
    const titulos = [...document.querySelectorAll('h1, h2, h3')].map((t) => t.tagName);
    expect(titulos[0]).toBe('H1');
    // Ningún salto de nivel: después de un h1 viene un h2, y un h3 solo después de un h2 o de otro h3.
    titulos.forEach((tag, i) => {
      if (i === 0) return;
      expect(Number(tag[1]) - Number(titulos[i - 1]![1]), `${titulos[i - 1]} → ${tag}`).toBeLessThanOrEqual(1);
    });
  });

  it('si TODO falla, cada bloque muestra su error con su "Reintentar" (ninguno tapa a otro)', async () => {
    route.gastos = () => sinRed();
    route.mensual = () => sinRed();
    route.combustible = () => sinRed();
    route.viajes = () => sinRed();
    await mount();
    for (const id of ['resumen-gastos', 'resumen-resultado', 'resumen-combustible', 'resumen-viajes']) {
      expect(byId(id)!.querySelector('[role="alert"]'), id).not.toBeNull();
      expect(botonEn(id, 'Reintentar'), id).toBeDefined();
      expect(byId(id)!.querySelector('[data-cargando]'), id).toBeNull();
      expect(byId(id)!.getAttribute('aria-busy'), id).toBe('false');
    }
  });

  it('al terminar de cargar no queda ningún aviso de carga ni ninguna sección ocupada', async () => {
    await mount();
    expect(bodyText()).not.toContain('Cargando');
    expect(document.querySelectorAll('[aria-busy="true"]')).toHaveLength(0);
    expect(document.querySelectorAll('[data-cargando]')).toHaveLength(0);
  });

  it('cambiar de mes pide los 5 datos de ESE mes (y la comparación con el anterior)', async () => {
    await mount();
    MES_DESDE = '2026-09-01';
    h.calls.length = 0;
    await click(buttonByLabel('Mes anterior'));
    expect(rpcs('resumen_gastos').map(argsDe)).toEqual(
      expect.arrayContaining([
        { p_desde: '2026-09-01', p_hasta: '2026-09-30' },
        { p_desde: '2026-08-01', p_hasta: '2026-08-31' },
      ]),
    );
    expect(rpcs('resumen_mensual').map(argsDe)).toEqual([{ p_mes_desde: '2026-09-01', p_meses: 1 }]);
    expect(rpcs('resumen_combustible').map(argsDe)).toEqual([{ p_desde: '2026-09-01', p_hasta: '2026-09-30' }]);
    expect(rpcs('resumen_viajes').map(argsDe)).toEqual([{ p_desde: '2026-09-01', p_hasta: '2026-09-30' }]);
    expect(comparacion()).toBe('2.000,00 más (+25 %) vs. agosto (8.000,00)');
  });

  it('ningún color fijo en las clases de la pantalla: solo los del tema', async () => {
    await mount();
    // Solo lo que dibuja la pantalla (el `style` del <html> con las variables del tema lo pone el tema, no la pantalla).
    const clases = [...container.querySelectorAll('[class]')].map((el) => el.getAttribute('class')!).join(' ');
    expect(clases).not.toMatch(/(?:bg|text|border|fill|stroke)-(?:red|green|blue|yellow|amber|gray|slate|zinc|neutral|stone|orange|emerald|white|black)\b/);
    expect(clases).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    const estilos = [...container.querySelectorAll<HTMLElement>('[style]')].map((el) => el.getAttribute('style')!);
    expect(estilos.length).toBeGreaterThan(0);
    for (const estilo of estilos) expect(estilo).toMatch(/^width: [\d.]+%;?$/);
  });
});
