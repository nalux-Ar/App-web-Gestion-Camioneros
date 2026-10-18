import { act, useMemo, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation, useNavigate, useNavigationType, type InitialEntry } from 'react-router';
import { onlineManager, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// La pantalla Resumen: el selector de vista (Mes | Año), el selector de año y la vista Año. Mock de supabase: cada función
// de la 014 responde según `route`; TODO lo demás (la pantalla, los hooks, TanStack Query, el parse, el router) es código
// REAL. "Hoy" es el 14 de octubre de 2026 (solo se fija `Date`: los timers son los reales): en 2026 transcurrieron 10 meses.
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
import { RESUMEN_ERROR_INESPERADO } from '@/features/resumen/resumen-textos';
import { NETWORK_ERROR_MESSAGE } from '@/features/auth/auth-errors';
import { queryClient } from '@/lib/query-client';

// ---------------------------------------------------------------------------
// "Base de datos" falsa
// ---------------------------------------------------------------------------
type Resp = { data: unknown; error: { message: string; code: string } | null; status: number };
const ok = (data: unknown): Resp => ({ data, error: null, status: 200 });
const sinRed = (): Resp => ({ data: null, error: { code: '', message: 'TypeError: Failed to fetch' }, status: 0 });
const MIEMBRO = { rol: 'admin', tema: 'dark', color_acento: '#F59E0B', transportista_id: 'tenant-a', camion_activo_id: null, transportistas: { nombre: 'Transportes A' } };

const CAT_A = 'a1000000-0000-4000-8000-000000000001';
const CAT_B = 'a1000000-0000-4000-8000-000000000002';
const CAM_X = 'c1000000-0000-4000-8000-000000000001';

type FilaGasto = { grupo: string; clave: string | null; nombre: string | null; activa: boolean | null; cantidad: number; monto: number };
const total = (monto: number, cantidad: number): FilaGasto => ({ grupo: 'total', clave: null, nombre: null, activa: null, cantidad, monto });
const cat = (clave: string, nombre: string, monto: number, cantidad = 1): FilaGasto => ({ grupo: 'categoria', clave, nombre, activa: null, cantidad, monto });
const met = (clave: string | null, monto: number, cantidad = 1): FilaGasto => ({ grupo: 'metodo_pago', clave, nombre: null, activa: null, cantidad, monto });
const cam = (clave: string | null, nombre: string | null, activa: boolean | null, monto: number, cantidad = 1): FilaGasto => ({ grupo: 'camion', clave, nombre, activa, cantidad, monto });

/** El gasto de un año: 80 % combustible y 20 % peajes, todo en efectivo y con el mismo camión. */
function gastosDelAnio(monto: number, cantidad: number): FilaGasto[] {
  if (cantidad === 0) return [total(0, 0)];
  return [
    total(monto, cantidad),
    cat(CAT_A, 'Combustible', monto * 0.8, cantidad - 5),
    cat(CAT_B, 'Peajes', monto * 0.2, 5),
    met('efectivo', monto, cantidad),
    cam(CAM_X, 'AB123CD', true, monto, cantidad),
  ];
}

/**
 * Una fila de `resumen_mensual`: el mes `m` (1–12) de `anio`. Por defecto, gasto de m × 1.000 (m gastos), 2 viajes con
 * ingreso de m × 1.500 en total y resultado m × 500.
 */
function filaMes(anio: number, m: number, over: Record<string, unknown> = {}) {
  return {
    mes: `${anio}-${String(m).padStart(2, '0')}-01`,
    gastos_cantidad: m,
    gastos_monto: m * 1000,
    combustible_cargas: 1,
    combustible_litros: 100,
    combustible_monto: 2000,
    viajes_cantidad: 2,
    viajes_km: 400,
    viajes_con_ingreso: 2,
    viajes_sin_ingreso: 0,
    viajes_ingreso: m * 1500,
    resultado: m * 500,
    ...over,
  };
}
/** Un mes sin movimientos (los meses que todavía no llegaron vienen así). */
const MES_VACIO = {
  gastos_cantidad: 0,
  gastos_monto: 0,
  combustible_cargas: 0,
  combustible_litros: 0,
  combustible_monto: 0,
  viajes_cantidad: 0,
  viajes_km: 0,
  viajes_con_ingreso: 0,
  viajes_sin_ingreso: 0,
  viajes_ingreso: 0,
  resultado: null,
};

function combFila(over: Record<string, unknown> = {}) {
  return {
    camion_id: CAM_X,
    patente: 'AB123CD',
    activa: true,
    cargas: 30,
    litros: 3000.5,
    monto: 70000,
    precio_promedio: 23.33,
    llenas_con_odometro: 25,
    tramos: 20,
    tramos_km: 9000,
    tramos_litros: 3000,
    tramos_monto: 69000,
    km_por_litro: 3,
    litros_100km: 33.33,
    costo_por_km: 7.67,
    descartados_retroceso: 0,
    descartados_sin_avance: 0,
    descartados_fuera_de_rango: 0,
    ...over,
  };
}

type Handler = (call: Call) => unknown;
const route: { gastos: Handler; mensual: Handler; combustible: Handler; viajes: Handler } = {} as never;
const argsDe = (call: Call) => call.ops.find((o) => o.m === 'rpc')!.args[0] as Record<string, unknown>;
/** Pisa meses puntuales de la serie mensual, de los que ya tienen movimientos: (año, mes 1–12) → columnas. */
let porMes: (anio: number, m: number) => Record<string, unknown> = () => ({});
/** Lo mismo para los meses que todavía no llegaron (vienen en 0): solo para probar que no se muestran. */
let porMesFuturo: (anio: number, m: number) => Record<string, unknown> = () => ({});
/** Hasta qué mes hay movimientos en cada año (2026: hasta octubre, el mes de "hoy"; antes, los 12). */
const mesesConDatos = (anio: number) => (anio === 2026 ? 10 : 12);

function resetRoutes() {
  porMes = () => ({});
  porMesFuturo = () => ({});
  route.gastos = (call) => {
    const anio = Number(String(argsDe(call).p_desde).slice(0, 4));
    return ok(anio === 2026 ? gastosDelAnio(55000, 55) : gastosDelAnio(78000, 78));
  };
  route.mensual = (call) => {
    const desde = String(argsDe(call).p_mes_desde);
    const anio = Number(desde.slice(0, 4));
    const primero = Number(desde.slice(5, 7));
    return ok(
      Array.from({ length: Number(argsDe(call).p_meses) }, (_, i) => {
        const m = primero + i;
        return filaMes(anio, m, m <= mesesConDatos(anio) ? porMes(anio, m) : { ...MES_VACIO, ...porMesFuturo(anio, m) });
      }),
    );
  };
  route.combustible = () => ok([combFila()]);
  route.viajes = () => ok([]);
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

/** Dónde está la pantalla y cómo se llegó (PUSH / REPLACE / POP). */
function Ubicacion() {
  const location = useLocation();
  const tipo = useNavigationType();
  return <div id="ubicacion" data-pathname={location.pathname} data-search={location.search} data-tipo={tipo} />;
}

/** El "atrás" del navegador. */
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

async function mount(entry: InitialEntry | InitialEntry[] = '/resumen?vista=anio') {
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

async function desmontar() {
  await act(async () => root.unmount());
  container.remove();
  queryClient.clear();
}

const NBSP = String.fromCharCode(0xa0);
const MENOS = String.fromCharCode(0x2212);
const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T | null;
const bodyText = () => document.body.textContent ?? '';
const buttonByLabel = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.getAttribute('aria-label') === label);
const anioMostrado = () => document.querySelector('[role="group"][aria-label="Año"] p')?.textContent ?? '';
const mesMostrado = () => document.querySelector('[role="group"][aria-label="Mes"] p')?.textContent ?? '';
const search = () => byId('ubicacion')?.dataset.search ?? '';
const tipoDeNavegacion = () => byId('ubicacion')?.dataset.tipo ?? '';
/** Texto como se lee: espacios duros y signo menos tipográfico normalizados, espacios colapsados. */
const plano = (texto: string | null | undefined) => (texto ?? '').split(NBSP).join(' ').split(MENOS).join('-').replace(/\s+/g, ' ').trim();
const textoDe = (id: string) => plano(byId(id)?.textContent);
const vistas = () => [...document.querySelectorAll<HTMLAnchorElement>('nav[aria-label="Vista del resumen"] a')];
const enlaceDeVista = (texto: string) => vistas().find((a) => a.textContent === texto);
const botonEn = (id: string, texto: string) =>
  [...(byId(id)?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find((b) => b.textContent?.trim() === texto);
const argsDeAnio = (fn: string) => rpcs(fn).map(argsDe);

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
// Selector de vista: Mes | Año
// ---------------------------------------------------------------------------
describe('Resumen: selector de vista (Mes | Año)', () => {
  it('dos ENLACES en un nav con nombre; en la vista Mes, "Mes" es la actual (aria-current) y "Año" lleva al año en curso', async () => {
    await mount('/resumen');
    expect(vistas().map((a) => a.textContent)).toEqual(['Mes', 'Año']);
    expect(enlaceDeVista('Mes')!.getAttribute('aria-current')).toBe('page');
    expect(enlaceDeVista('Año')!.hasAttribute('aria-current')).toBe(false);
    expect(enlaceDeVista('Mes')!.getAttribute('href')).toBe('/resumen');
    expect(enlaceDeVista('Año')!.getAttribute('href')).toBe('/resumen?vista=anio');
    expect(document.querySelectorAll('[role="tab"], [role="tablist"]')).toHaveLength(0);
  });

  it('desde un mes de otro año, "Año" lleva al año DE ESE MES (conserva el período)', async () => {
    await mount('/resumen?mes=2025-03');
    expect(enlaceDeVista('Año')!.getAttribute('href')).toBe('/resumen?vista=anio&anio=2025');
    expect(enlaceDeVista('Mes')!.getAttribute('href')).toBe('/resumen?mes=2025-03');
  });

  it('tocar "Año" abre la vista Año de ese año, REEMPLAZANDO la entrada del historial', async () => {
    await mount('/resumen?mes=2025-03');
    await click(enlaceDeVista('Año'));
    expect(search()).toBe('?vista=anio&anio=2025');
    expect(tipoDeNavegacion()).toBe('REPLACE');
    expect(anioMostrado()).toBe('2025');
    expect(mesMostrado()).toBe('');
    expect(enlaceDeVista('Año')!.getAttribute('aria-current')).toBe('page');
    expect(enlaceDeVista('Mes')!.hasAttribute('aria-current')).toBe(false);
  });

  it('en la vista Año del año en curso, "Mes" lleva al mes actual (sin ?mes=)', async () => {
    await mount();
    expect(enlaceDeVista('Mes')!.getAttribute('href')).toBe('/resumen');
    expect(enlaceDeVista('Año')!.getAttribute('href')).toBe('/resumen?vista=anio');
  });

  it('en la vista Año de un año pasado, "Mes" lleva a diciembre de ese año', async () => {
    await mount('/resumen?vista=anio&anio=2024');
    expect(enlaceDeVista('Mes')!.getAttribute('href')).toBe('/resumen?mes=2024-12');
    await click(enlaceDeVista('Mes'));
    expect(search()).toBe('?mes=2024-12');
    expect(tipoDeNavegacion()).toBe('REPLACE');
    expect(mesMostrado()).toBe('diciembre 2024');
    expect(anioMostrado()).toBe('');
  });

  it('cambiar de vista no apila historial: "atrás" sale del Resumen', async () => {
    await mount(['/inicio-de-prueba', '/resumen?mes=2025-03']);
    await click(enlaceDeVista('Año'));
    await click(enlaceDeVista('Mes'));
    await click(enlaceDeVista('Año'));
    await click(byId('atras'));
    expect(byId('pantalla-anterior')).not.toBeNull();
  });

  it('objetivos táctiles de 48 px y la activa no depende solo del color (borde y negrita)', async () => {
    await mount();
    for (const a of vistas()) expect(a.className).toContain('min-h-12');
    expect(enlaceDeVista('Año')!.className).toContain('font-semibold');
    expect(enlaceDeVista('Año')!.className).toContain('border-primary');
  });

  it.each([
    ['vista=anio&anio=abc', 2026],
    ['vista=anio&anio=2999', 2026],
    ['vista=anio&anio=2027', 2026],
    ['vista=anio&anio=1999', 2026],
    ['vista=anio&anio=02025', 2026],
    ['vista=anio&anio=2025.0', 2026],
    ['vista=anio&anio=%3Cscript%3E', 2026],
    ['vista=anio&anio=2025&mes=2024-01', 2025],
    ['vista=anio&anio=2000', 2000],
  ])('URL hostil o rara en la vista Año (%s): año %i', async (q, anio) => {
    await mount(`/resumen?${q}`);
    expect(anioMostrado()).toBe(String(anio));
    expect(argsDeAnio('resumen_gastos')).toEqual([{ p_desde: `${anio}-01-01`, p_hasta: `${anio}-12-31` }]);
    expect(argsDeAnio('resumen_mensual')).toEqual([{ p_mes_desde: `${anio}-01-01`, p_meses: 12 }]);
  });

  it.each(['vista=toString', 'vista=ANIO', 'vista=anio%00', 'vista=', 'vista=mes&anio=2025'])('?%s no es la vista Año: el mes actual', async (q) => {
    await mount(`/resumen?${q}`);
    expect(mesMostrado()).toBe('octubre 2026');
    expect(anioMostrado()).toBe('');
    expect(argsDeAnio('resumen_mensual')).toEqual([{ p_mes_desde: '2026-10-01', p_meses: 1 }]);
  });
});

// ---------------------------------------------------------------------------
// Selector de año
// ---------------------------------------------------------------------------
describe('Resumen: selector de año', () => {
  it('el año en curso no se escribe; "Año siguiente" deshabilitado (no hay futuro)', async () => {
    await mount();
    expect(anioMostrado()).toBe('2026');
    expect(search()).toBe('?vista=anio');
    expect(buttonByLabel('Año siguiente')!.disabled).toBe(true);
    expect(buttonByLabel('Año anterior')!.disabled).toBe(false);
  });

  it('"Año anterior" va a 2025 (?anio=2025) y pide los datos de ESE año; volver al actual saca el año de la URL', async () => {
    await mount();
    h.calls.length = 0;
    await click(buttonByLabel('Año anterior'));
    expect(anioMostrado()).toBe('2025');
    expect(search()).toBe('?vista=anio&anio=2025');
    expect(tipoDeNavegacion()).toBe('REPLACE');
    expect(argsDeAnio('resumen_gastos')).toEqual([{ p_desde: '2025-01-01', p_hasta: '2025-12-31' }]);
    expect(argsDeAnio('resumen_mensual')).toEqual([{ p_mes_desde: '2025-01-01', p_meses: 12 }]);
    expect(argsDeAnio('resumen_combustible')).toEqual([{ p_desde: '2025-01-01', p_hasta: '2025-12-31' }]);
    expect(rpcs('resumen_viajes')).toHaveLength(0);
    await click(buttonByLabel('Año siguiente'));
    expect(anioMostrado()).toBe('2026');
    expect(search()).toBe('?vista=anio');
  });

  it('no va antes de 2000: en 2000, "Año anterior" deshabilitado', async () => {
    await mount('/resumen?vista=anio&anio=2001');
    await click(buttonByLabel('Año anterior'));
    expect(anioMostrado()).toBe('2000');
    expect(search()).toBe('?vista=anio&anio=2000');
    expect(buttonByLabel('Año anterior')!.disabled).toBe(true);
    expect(buttonByLabel('Año siguiente')!.disabled).toBe(false);
  });

  it('cambiar de año no apila historial: "atrás" sale del Resumen', async () => {
    await mount(['/inicio-de-prueba', '/resumen?vista=anio']);
    await click(buttonByLabel('Año anterior'));
    await click(buttonByLabel('Año anterior'));
    await click(byId('atras'));
    expect(byId('pantalla-anterior')).not.toBeNull();
  });

  it('mismo aspecto que el selector de mes: grupo con nombre, botones de 48 px con nombre y el año anunciado (aria-live)', async () => {
    await mount();
    const grupo = document.querySelector('[role="group"][aria-label="Año"]')!;
    expect(grupo.querySelector('p')!.getAttribute('aria-live')).toBe('polite');
    for (const etiqueta of ['Año anterior', 'Año siguiente']) {
      const boton = buttonByLabel(etiqueta)!;
      expect(grupo.contains(boton)).toBe(true);
      expect(boton.className).toContain('h-12');
      expect(boton.className).toContain('w-12');
    }
  });
});

// ---------------------------------------------------------------------------
// La vista Año: aviso de carga y sin conexión
// ---------------------------------------------------------------------------
describe('Resumen, vista Año: el aviso de la pantalla', () => {
  const estado = () => {
    const estados = [...document.querySelectorAll<HTMLElement>('[role="status"]')];
    expect(estados).toHaveLength(1);
    return estados[0]!;
  };

  it('mientras carga: UN aviso para lectores de pantalla con el año; al terminar se vacía', async () => {
    let soltar: (r: Resp) => void = () => {};
    route.combustible = () => new Promise<Resp>((resolver) => (soltar = resolver));
    await mount();
    expect(estado().textContent).toBe('Cargando el resumen de 2026…');
    expect(estado().className).toBe('sr-only');
    await act(async () => soltar(ok([combFila()])));
    await settle();
    expect(estado().textContent).toBe('');
  });

  it('sin conexión: lo que falta queda en pausa y se AVISA (visible); al volver la señal, carga', async () => {
    await mount();
    await act(async () => onlineManager.setOnline(false));
    await click(buttonByLabel('Año anterior'));
    expect(plano(estado().textContent)).toBe(RESUMEN_SIN_CONEXION);
    expect(estado().className).not.toContain('sr-only');
    await act(async () => onlineManager.setOnline(true));
    await settle();
    expect(bodyText()).not.toContain(RESUMEN_SIN_CONEXION);
    expect(argsDeAnio('resumen_gastos')).toContainEqual({ p_desde: '2025-01-01', p_hasta: '2025-12-31' });
  });

  it('no hay lista de viajes en el Año (la base la limita a 62 días): ni bloque ni pedido', async () => {
    await mount();
    expect(byId('resumen-viajes')).toBeNull();
    expect(rpcs('resumen_viajes')).toHaveLength(0);
  });
});


// ---------------------------------------------------------------------------
// Vista Año: gastos del año y promedio
// ---------------------------------------------------------------------------
/** Las filas de un desglose: [etiqueta, monto, detalle]. */
const barras = (id: string) =>
  [...(byId(id)?.querySelectorAll('li[data-fila]') ?? [])].map((li) => {
    const spans = li.querySelectorAll('span');
    return [plano(spans[0]?.textContent), plano(spans[1]?.textContent), plano(li.querySelector('p')?.textContent)];
  });
/** El promedio como se lee: etiqueta, valor y sobre cuántos meses (cada `dt`/`dd` separado por un espacio). */
const promedio = () =>
  [...(byId('resumen-gastos')?.querySelectorAll('[data-promedio] dt, [data-promedio] dd') ?? [])].map((el) => plano(el.textContent)).join(' ');

describe('Resumen, vista Año: gastos del año y promedio por mes', () => {
  it('año en curso: total, cantidad y promedio de los 10 meses transcurridos (no /12)', async () => {
    await mount();
    expect(byId('resumen-gastos')!.querySelector('h2')!.textContent).toBe('Gastos del año');
    expect(textoDe('resumen-gastos')).toContain('55.000,00');
    expect(textoDe('resumen-gastos')).toContain('55 gastos');
    expect(promedio()).toBe('Promedio por mes 5.500,00 promedio de los 10 meses transcurridos');
  });

  it('año pasado: promedio de los 12 meses', async () => {
    await mount('/resumen?vista=anio&anio=2025');
    expect(textoDe('resumen-gastos')).toContain('78.000,00');
    expect(promedio()).toBe('Promedio por mes 6.500,00 promedio de los 12 meses del año');
  });

  it('en enero, el único mes transcurrido: el promedio es el total', async () => {
    vi.setSystemTime(new Date(2026, 0, 20, 10, 0));
    await mount();
    expect(promedio()).toBe('Promedio por mes 55.000,00 promedio del único mes transcurrido');
  });

  it('el promedio va a centavos (10.000 en 3 meses = 3.333,33)', async () => {
    vi.setSystemTime(new Date(2026, 2, 5, 10, 0));
    route.gastos = () => ok(gastosDelAnio(10000, 12));
    await mount();
    expect(promedio()).toBe('Promedio por mes 3.333,33 promedio de los 3 meses transcurridos');
  });

  it('sin gastos en el año en curso: "Todavía no cargaste gastos en 2026", sin promedio ni desgloses', async () => {
    route.gastos = () => ok(gastosDelAnio(0, 0));
    await mount();
    expect(textoDe('resumen-gastos')).toBe('Gastos del añoTodavía no cargaste gastos en 2026');
    expect(byId('resumen-gastos')!.querySelector('[data-promedio]')).toBeNull();
    expect(byId('resumen-por-categoria')).toBeNull();
    expect(byId('resumen-por-metodo')).toBeNull();
  });

  it('sin gastos en un año pasado: "No cargaste gastos en 2025"', async () => {
    route.gastos = () => ok(gastosDelAnio(0, 0));
    await mount('/resumen?vista=anio&anio=2025');
    expect(textoDe('resumen-gastos')).toContain('No cargaste gastos en 2025');
  });

  it('sin comparación con el año anterior: UN solo pedido de gastos, el del año', async () => {
    await mount();
    expect(argsDeAnio('resumen_gastos')).toEqual([{ p_desde: '2026-01-01', p_hasta: '2026-12-31' }]);
    expect(byId('resumen-gastos')!.querySelector('[data-comparacion]')).toBeNull();
    expect(textoDe('resumen-gastos')).not.toContain('vs.');
  });

  it('los desgloses del año: por categoría, por método de pago y por camión (los mismos del Mes)', async () => {
    await mount();
    expect(barras('resumen-por-categoria')).toEqual([
      ['Combustible', '44.000,00', '50 gastos · 80 % del total'],
      ['Peajes', '11.000,00', '5 gastos · 20 % del total'],
    ]);
    expect(barras('resumen-por-metodo')).toEqual([['Efectivo', '55.000,00', '55 gastos · 100 % del total']]);
    expect(barras('resumen-por-camion')).toEqual([['AB 123 CD', '55.000,00', '55 gastos · 100 % del total']]);
  });

  it('mientras cargan los gastos: `aria-busy` y filas grises; el gasto por mes ya se ve', async () => {
    route.gastos = () => new Promise<Resp>(() => {});
    await mount();
    expect(byId('resumen-gastos')!.getAttribute('aria-busy')).toBe('true');
    expect(byId('resumen-gastos')!.querySelector('[data-cargando]')).not.toBeNull();
    expect(byId('resumen-gasto-por-mes')!.getAttribute('aria-busy')).toBe('false');
    expect(byId('resumen-por-categoria')).toBeNull();
  });

  it('si fallan los gastos: su "Reintentar" pide SOLO los gastos del año; el gasto por mes se sigue viendo', async () => {
    let falla = true;
    route.gastos = () => (falla ? sinRed() : ok(gastosDelAnio(55000, 55)));
    await mount();
    expect(textoDe('resumen-gastos')).toContain(NETWORK_ERROR_MESSAGE);
    expect(byId('resumen-gastos')!.querySelector('[data-cargando]')).toBeNull();
    expect(byId('resumen-gasto-por-mes')!.querySelectorAll('li[data-mes]')).toHaveLength(10);
    const gastos = rpcs('resumen_gastos').length;
    const otros = h.calls.length - gastos;
    falla = false;
    await click(botonEn('resumen-gastos', 'Reintentar'));
    expect(rpcs('resumen_gastos')).toHaveLength(gastos + 1);
    expect(h.calls.length - rpcs('resumen_gastos').length).toBe(otros);
    expect(textoDe('resumen-gastos')).toContain('55.000,00');
  });
});

// ---------------------------------------------------------------------------
// Vista Año: gasto por mes
// ---------------------------------------------------------------------------
describe('Resumen, vista Año: gasto por mes', () => {
  const filasPorMes = () => [...(byId('resumen-gasto-por-mes')?.querySelectorAll('li[data-mes]') ?? [])];
  /** Una fila: [mes, monto o "Sin gastos", cantidad]. */
  const fila = (li: Element) => {
    const enlace = li.querySelector('a')!;
    const [cabecera, ...resto] = [...enlace.children];
    const cantidad = resto.find((el) => el.tagName === 'SPAN');
    return [plano(cabecera!.children[0]?.textContent), plano(cabecera!.children[1]?.textContent), plano(cantidad?.textContent)];
  };
  const ancho = (li: Element) => li.querySelector<HTMLElement>('[aria-hidden="true"] > div')?.style.width ?? null;

  it('año en curso: SOLO los meses transcurridos (enero a octubre), en orden', async () => {
    await mount();
    expect(filasPorMes().map((li) => li.getAttribute('data-mes'))).toEqual(
      ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10'].map((m) => `2026-${m}`),
    );
    expect(byId('resumen-gasto-por-mes')!.querySelector('h2')!.textContent).toBe('Gasto por mes');
  });

  it('cada mes con su nombre, monto y cantidad en texto', async () => {
    await mount();
    expect(fila(filasPorMes()[0]!)).toEqual(['enero', '1.000,00', '1 gasto']);
    expect(fila(filasPorMes()[9]!)).toEqual(['octubre', '10.000,00', '10 gastos']);
  });

  it('el ancho de la barra es relativo al MES DE MAYOR GASTO (octubre = 100 %), no al total del año', async () => {
    await mount();
    expect(filasPorMes().map(ancho)).toEqual(['10%', '20%', '30%', '40%', '50%', '60%', '70%', '80%', '90%', '100%']);
  });

  it('un mes futuro no se muestra ni cuenta para el máximo', async () => {
    porMesFuturo = (anio, m) => (anio === 2026 && m === 11 ? { gastos_monto: 999999, gastos_cantidad: 9 } : {});
    await mount();
    expect(filasPorMes()).toHaveLength(10);
    expect(ancho(filasPorMes()[9]!)).toBe('100%');
    expect(textoDe('resumen-gasto-por-mes')).not.toContain('noviembre');
  });

  it('un mes sin gastos dice "Sin gastos" y no dibuja barra (ni cantidad)', async () => {
    porMes = (_anio, m) => (m === 3 ? { gastos_monto: 0, gastos_cantidad: 0 } : {});
    await mount();
    const marzo = filasPorMes()[2]!;
    expect(fila(marzo)).toEqual(['marzo', 'Sin gastos', '']);
    expect(marzo.querySelector('[aria-hidden="true"]')).toBeNull();
    expect(ancho(filasPorMes()[9]!)).toBe('100%');
  });

  it('cada fila lleva al Mes de ese mes (el mes actual sin ?mes=, como siempre)', async () => {
    await mount();
    expect(filasPorMes().map((li) => li.querySelector('a')!.getAttribute('href'))).toEqual([
      ...['01', '02', '03', '04', '05', '06', '07', '08', '09'].map((m) => `/resumen?mes=2026-${m}`),
      '/resumen',
    ]);
  });

  it('tocar un mes abre ESE mes en la vista Mes (y "atrás" vuelve al año)', async () => {
    await mount();
    await click(filasPorMes()[2]!.querySelector('a'));
    expect(search()).toBe('?mes=2026-03');
    expect(mesMostrado()).toBe('marzo 2026');
    expect(tipoDeNavegacion()).toBe('PUSH');
    await click(byId('atras'));
    expect(anioMostrado()).toBe('2026');
  });

  it('año pasado: los 12 meses; diciembre lleva a ?mes=2025-12', async () => {
    await mount('/resumen?vista=anio&anio=2025');
    expect(filasPorMes()).toHaveLength(12);
    expect(filasPorMes()[11]!.querySelector('a')!.getAttribute('href')).toBe('/resumen?mes=2025-12');
    expect(fila(filasPorMes()[11]!)).toEqual(['diciembre', '12.000,00', '12 gastos']);
  });

  it('un año sin gastos en ningún mes: lo dice, sin filas', async () => {
    porMes = () => ({ gastos_monto: 0, gastos_cantidad: 0 });
    await mount();
    expect(filasPorMes()).toHaveLength(0);
    expect(textoDe('resumen-gasto-por-mes')).toContain('Todavía no cargaste gastos en 2026');
  });

  it('accesible: barras aria-hidden sin texto, filas de al menos 44 px con foco visible', async () => {
    await mount();
    for (const li of filasPorMes()) {
      const barra = li.querySelector('[aria-hidden="true"]')!;
      expect(barra.textContent).toBe('');
      const clases = li.querySelector('a')!.className;
      expect(clases).toContain('min-h-11');
      expect(clases).toContain('focus-visible:ring-2');
    }
  });

  it('mientras carga la serie mensual: `aria-busy`; los gastos del año ya se ven', async () => {
    route.mensual = () => new Promise<Resp>(() => {});
    await mount();
    expect(byId('resumen-gasto-por-mes')!.getAttribute('aria-busy')).toBe('true');
    expect(textoDe('resumen-gastos')).toContain('55.000,00');
  });

  it('si falla la serie mensual: error con "Reintentar" que pide SOLO esa serie; los gastos del año se siguen viendo', async () => {
    let falla = true;
    const normal = route.mensual;
    route.mensual = (call) => (falla ? sinRed() : normal(call));
    await mount();
    expect(textoDe('resumen-gasto-por-mes')).toContain(NETWORK_ERROR_MESSAGE);
    expect(textoDe('resumen-gastos')).toContain('55.000,00');
    const mensuales = rpcs('resumen_mensual').length;
    const otros = h.calls.length - mensuales;
    falla = false;
    await click(botonEn('resumen-gasto-por-mes', 'Reintentar'));
    expect(rpcs('resumen_mensual')).toHaveLength(mensuales + 1);
    expect(h.calls.length - rpcs('resumen_mensual').length).toBe(otros);
    expect(filasPorMes()).toHaveLength(10);
  });

  it('una serie fuera de contrato (11 meses en vez de 12): error inesperado, nada a medias', async () => {
    const normal = route.mensual;
    route.mensual = (call) => {
      const r = normal(call) as Resp;
      return ok((r.data as unknown[]).slice(0, 11));
    };
    await mount();
    expect(textoDe('resumen-gasto-por-mes')).toContain(RESUMEN_ERROR_INESPERADO);
    expect(filasPorMes()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Vista Año: ingresos y resultado, y resultado por mes
// ---------------------------------------------------------------------------
describe('Resumen, vista Año: ingresos y resultado del año', () => {
  /** El resultado como se lee: etiqueta, monto y aviso (cada `p` separado por un espacio). */
  const resultado = () =>
    [...(byId('resumen-resultado')?.querySelectorAll('[data-resultado] p') ?? [])].map((p) => plano(p.textContent)).join(' ');
  /** Los datos del `dl`: "Etiqueta valor [detalle]". */
  const datos = () =>
    [...(byId('resumen-resultado')?.querySelectorAll('dl > div') ?? [])].map((d) =>
      [...d.querySelectorAll('dt, dd')].map((el) => plano(el.textContent)).join(' '),
    );
  const sinIngreso = { viajes_con_ingreso: 0, viajes_sin_ingreso: 2, viajes_ingreso: 0, resultado: null };

  it('suma los meses: Ganancia, ingresos, gastos, viajes y km del año, y qué es el resultado', async () => {
    await mount();
    expect(resultado()).toBe('Ganancia 27.500,00');
    expect(datos()).toEqual([
      'Ingresos de viajes 82.500,00 20 viajes con ingreso',
      'Gastos del año 55.000,00',
      'Viajes 20 viajes',
      'Km recorridos 4.000 km',
    ]);
    expect(textoDe('resumen-resultado')).toContain('lo que cobraste por los viajes del año menos todos los gastos del año');
    expect(textoDe('resumen-resultado')).not.toContain('incompleto');
  });

  it('año pasado: los 12 meses', async () => {
    await mount('/resumen?vista=anio&anio=2025');
    expect(resultado()).toBe('Ganancia 39.000,00');
    expect(datos()[0]).toBe('Ingresos de viajes 117.000,00 24 viajes con ingreso');
    expect(datos()[3]).toBe('Km recorridos 4.800 km');
  });

  it('pérdida: "Pérdida" escrita, el monto sin signo y en el color de error del tema', async () => {
    porMes = (_anio, m) => ({ viajes_ingreso: m * 500, resultado: m * -500 });
    await mount();
    expect(resultado()).toBe('Pérdida 27.500,00');
    expect(byId('resumen-resultado')!.querySelector('[data-resultado] .text-destructive-text')!.textContent).toBe('27.500,00');
    expect(textoDe('resumen-resultado')).not.toContain('-27.500');
  });

  it('ningún viaje del año con ingreso: NO hay resultado; invita a cargarlos (como el Mes, con "año")', async () => {
    porMes = () => sinIngreso;
    await mount();
    expect(byId('resumen-resultado')!.querySelector('[data-resultado]')).toBeNull();
    expect(textoDe('resumen-resultado')).toContain(
      'Ninguno de tus 20 viajes del año tiene el ingreso cargado. Cárgalo para ver si el año dio ganancia o pérdida.',
    );
    expect(textoDe('resumen-resultado')).not.toMatch(/Ganancia|Pérdida|lo que cobraste/);
    expect(datos()[0]).toBe('Ingresos de viajes 0,00 0 de 20 viajes con ingreso');
  });

  it('sin viajes en el año: "No hay viajes en el año…"', async () => {
    porMes = () => ({ viajes_cantidad: 0, viajes_km: 0, viajes_con_ingreso: 0, viajes_sin_ingreso: 0, viajes_ingreso: 0, resultado: null });
    await mount();
    expect(textoDe('resumen-resultado')).toContain('No hay viajes en el año. Carga tus viajes con su ingreso para ver si el año dio ganancia o pérdida.');
    expect(datos()).toEqual(['Ingresos de viajes 0,00', 'Gastos del año 55.000,00', 'Viajes 0 viajes', 'Km recorridos 0 km']);
  });

  it('con viajes sin ingreso en el año: el resultado CON el aviso de que puede estar incompleto', async () => {
    porMes = (_anio, m) => (m <= 3 ? { viajes_con_ingreso: 1, viajes_sin_ingreso: 1 } : {});
    await mount();
    expect(resultado()).toBe('Ganancia 27.500,00 3 viajes sin ingreso cargado: el resultado puede estar incompleto.');
    expect(datos()[0]).toBe('Ingresos de viajes 82.500,00 17 de 20 viajes con ingreso');
  });

  it('meses con y sin ingreso: el resultado resta TODOS los gastos del año (no suma solo los meses con ingreso)', async () => {
    porMes = (_anio, m) => (m > 5 ? sinIngreso : {});
    await mount();
    // Ingresos de enero a mayo: 1.500 × (1+2+3+4+5) = 22.500; gastos del año: 55.000. Sumar los resultados de los meses con
    // ingreso daría "Ganancia 7.500,00".
    expect(resultado()).toBe('Pérdida 32.500,00 10 viajes sin ingreso cargado: el resultado puede estar incompleto.');
  });

  it('un ingreso 0 cuenta como cargado: hay resultado (los gastos, como pérdida)', async () => {
    porMes = (_anio, m) => (m === 4 ? { viajes_con_ingreso: 1, viajes_sin_ingreso: 1, viajes_ingreso: 0, resultado: -4000 } : sinIngreso);
    await mount();
    expect(resultado()).toBe('Pérdida 55.000,00 19 viajes sin ingreso cargado: el resultado puede estar incompleto.');
  });

  it('no hay lista de viajes: una línea lo explica y lleva a la vista Mes (el mes actual / diciembre de un año pasado)', async () => {
    await mount();
    const linea = byId('resumen-resultado')!.querySelector('[data-viajes-por-mes]')!;
    expect(plano(linea.textContent)).toBe('La lista de viajes se ve mes a mes: toca un mes o pasa a la vista Mes. Ir a la vista Mes');
    expect(linea.querySelector('a')!.getAttribute('href')).toBe('/resumen');
    await desmontar();
    await mount('/resumen?vista=anio&anio=2025');
    const enlace = byId('resumen-resultado')!.querySelector<HTMLAnchorElement>('[data-viajes-por-mes] a')!;
    expect(enlace.getAttribute('href')).toBe('/resumen?mes=2025-12');
    await click(enlace);
    expect(mesMostrado()).toBe('diciembre 2025');
  });

  it('mientras carga la serie mensual: `aria-busy` y filas grises', async () => {
    route.mensual = () => new Promise<Resp>(() => {});
    await mount();
    expect(byId('resumen-resultado')!.getAttribute('aria-busy')).toBe('true');
    expect(byId('resumen-resultado')!.querySelector('[data-cargando]')).not.toBeNull();
  });

  it('si falla: error con "Reintentar" (pide SOLO la serie mensual); los gastos y el combustible se siguen viendo', async () => {
    let falla = true;
    const normal = route.mensual;
    route.mensual = (call) => (falla ? sinRed() : normal(call));
    await mount();
    expect(textoDe('resumen-resultado')).toContain(NETWORK_ERROR_MESSAGE);
    expect(textoDe('resumen-gastos')).toContain('55.000,00');
    const mensuales = rpcs('resumen_mensual').length;
    falla = false;
    await click(botonEn('resumen-resultado', 'Reintentar'));
    expect(rpcs('resumen_mensual')).toHaveLength(mensuales + 1);
    expect(resultado()).toBe('Ganancia 27.500,00');
  });
});

describe('Resumen, vista Año: resultado por mes', () => {
  const filasResultado = () => [...(byId('resumen-resultado')?.querySelectorAll('[data-resultado-por-mes] li[data-mes]') ?? [])];
  /** Una fila: [mes, ingresos y gastos, resultado]. */
  const fila = (li: Element) => {
    const textos = li.querySelectorAll('a > span:first-child > span');
    const derecha = li.querySelector('[data-resultado-del-mes]');
    const partes = derecha?.children.length ? [...derecha.children].map((el) => plano(el.textContent)).join(' ') : plano(derecha?.textContent);
    return [plano(textos[0]?.textContent), plano(textos[1]?.textContent), partes];
  };

  it('un h3 "Resultado por mes" dentro del bloque, con una fila por mes transcurrido', async () => {
    await mount();
    const titulo = byId('resumen-resultado')!.querySelector('h3')!;
    expect(titulo.textContent).toBe('Resultado por mes');
    expect(byId('resumen-resultado')!.querySelector('[data-resultado-por-mes] ul')!.getAttribute('aria-labelledby')).toBe(titulo.id);
    expect(filasResultado().map((li) => li.getAttribute('data-mes'))).toEqual(
      ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10'].map((m) => `2026-${m}`),
    );
  });

  it('cada mes: ingresos, gastos y Ganancia / Pérdida escritas', async () => {
    porMes = (_anio, m) => (m === 2 ? { viajes_ingreso: 1700, resultado: -300 } : {});
    await mount();
    expect(fila(filasResultado()[0]!)).toEqual(['enero', 'Ingresos 1.500,00 · Gastos 1.000,00', 'Ganancia 500,00']);
    expect(fila(filasResultado()[1]!)).toEqual(['febrero', 'Ingresos 1.700,00 · Gastos 2.000,00', 'Pérdida 300,00']);
    expect(filasResultado()[1]!.querySelector('.text-destructive-text')!.textContent).toBe('300,00');
  });

  it('un mes sin ingresos (resultado null): "Sin ingresos cargados", nunca "Pérdida"', async () => {
    porMes = (_anio, m) => (m === 3 ? { viajes_con_ingreso: 0, viajes_sin_ingreso: 2, viajes_ingreso: 0, resultado: null } : {});
    await mount();
    expect(fila(filasResultado()[2]!)).toEqual(['marzo', 'Ingresos 0,00 · Gastos 3.000,00', 'Sin ingresos cargados']);
  });

  /** Un mes sin ningún viaje (la base da resultado null también, pero NO es que falten ingresos). */
  const SIN_VIAJES_EN_EL_MES = { viajes_cantidad: 0, viajes_km: 0, viajes_con_ingreso: 0, viajes_sin_ingreso: 0, viajes_ingreso: 0, resultado: null };

  it('mes sin viajes vs. mes con viajes sin ingreso vs. mes con resultado: "Sin viajes", "Sin ingresos cargados", Ganancia', async () => {
    porMes = (_anio, m) => {
      if (m === 1) return SIN_VIAJES_EN_EL_MES; // con gastos (1.000)
      if (m === 2) return { viajes_con_ingreso: 0, viajes_sin_ingreso: 2, viajes_ingreso: 0, resultado: null };
      return {};
    };
    await mount();
    expect(fila(filasResultado()[0]!)).toEqual(['enero', 'Ingresos 0,00 · Gastos 1.000,00', 'Sin viajes']);
    expect(fila(filasResultado()[1]!)).toEqual(['febrero', 'Ingresos 0,00 · Gastos 2.000,00', 'Sin ingresos cargados']);
    expect(fila(filasResultado()[2]!)).toEqual(['marzo', 'Ingresos 4.500,00 · Gastos 3.000,00', 'Ganancia 1.500,00']);
    // "Sin viajes" con el mismo estilo atenuado que "Sin ingresos cargados".
    const [enero, febrero] = filasResultado().map((li) => li.querySelector('[data-resultado-del-mes]')!.className);
    expect(enero).toBe(febrero);
    expect(enero).toContain('text-muted-foreground');
  });

  it('un mes sin viajes NI gastos: "Sin viajes" y sin la línea de ingresos y gastos (serían dos ceros)', async () => {
    porMes = (_anio, m) => (m === 4 ? { ...SIN_VIAJES_EN_EL_MES, gastos_monto: 0, gastos_cantidad: 0 } : {});
    await mount();
    const abril = filasResultado()[3]!;
    expect(fila(abril)).toEqual(['abril', '', 'Sin viajes']);
    expect(abril.querySelectorAll('a > span:first-child > span')).toHaveLength(1);
    expect(plano(abril.textContent)).not.toContain('Ingresos');
  });

  it('un año SIN NINGÚN viaje: no hay lista "Resultado por mes" (el bloque ya dice que no hay viajes)', async () => {
    porMes = () => SIN_VIAJES_EN_EL_MES;
    await mount();
    expect(byId('resumen-resultado')!.querySelector('[data-resultado-por-mes]')).toBeNull();
    expect(byId('resumen-resultado')!.querySelector('h3')).toBeNull();
    expect(textoDe('resumen-resultado')).toContain('No hay viajes en el año.');
    expect(byId('resumen-resultado')!.querySelector('[data-viajes-por-mes]')).not.toBeNull();
  });

  it('un año con viajes en UN solo mes: la lista sigue, con todos los meses transcurridos ("Sin viajes" en los demás)', async () => {
    porMes = (_anio, m) => (m === 5 ? {} : { ...SIN_VIAJES_EN_EL_MES, gastos_monto: 0, gastos_cantidad: 0 });
    await mount();
    expect(filasResultado()).toHaveLength(10);
    expect(fila(filasResultado()[4]!)).toEqual(['mayo', 'Ingresos 7.500,00 · Gastos 5.000,00', 'Ganancia 2.500,00']);
    for (const [i, li] of filasResultado().entries()) {
      if (i === 4) continue;
      expect(fila(li)[2], li.getAttribute('data-mes')!).toBe('Sin viajes');
      expect(fila(li)[1], li.getAttribute('data-mes')!).toBe('');
    }
    expect(textoDe('resumen-resultado')).not.toContain('Sin ingresos cargados');
  });

  it('un año con EXACTAMENTE 1 viaje: la lista se muestra (ese mes con su resultado o "Sin ingresos cargados"; los demás "Sin viajes")', async () => {
    const sinNada = { ...SIN_VIAJES_EN_EL_MES, gastos_monto: 0, gastos_cantidad: 0 };
    /** Todos los meses menos junio: "Sin viajes" y sin la línea de ingresos y gastos. */
    const otrosMesesSinViajes = () => {
      for (const [i, otra] of filasResultado().entries()) {
        if (i !== 5) expect(fila(otra).slice(1), otra.getAttribute('data-mes')!).toEqual(['', 'Sin viajes']);
      }
    };
    // Junio: 1 viaje con ingreso de 9.000 y gastos de 6.000.
    porMes = (_anio, m) => (m === 6 ? { viajes_cantidad: 1, viajes_km: 400, viajes_con_ingreso: 1, viajes_sin_ingreso: 0, viajes_ingreso: 9000, resultado: 3000 } : sinNada);
    await mount();
    expect(byId('resumen-resultado')!.querySelector('[data-resultado-por-mes]')).not.toBeNull();
    expect(filasResultado()).toHaveLength(10);
    expect(fila(filasResultado()[5]!)).toEqual(['junio', 'Ingresos 9.000,00 · Gastos 6.000,00', 'Ganancia 3.000,00']);
    otrosMesesSinViajes();
    await desmontar();
    // El mismo viaje, sin ingreso cargado.
    porMes = (_anio, m) => (m === 6 ? { viajes_cantidad: 1, viajes_km: 400, viajes_con_ingreso: 0, viajes_sin_ingreso: 1, viajes_ingreso: 0, resultado: null } : sinNada);
    await mount();
    expect(filasResultado()).toHaveLength(10);
    expect(fila(filasResultado()[5]!)).toEqual(['junio', 'Ingresos 0,00 · Gastos 6.000,00', 'Sin ingresos cargados']);
    otrosMesesSinViajes();
  });

  it('un mes con resultado 0: "Resultado 0,00"', async () => {
    porMes = (_anio, m) => (m === 1 ? { viajes_ingreso: 1000, resultado: 0 } : {});
    await mount();
    expect(fila(filasResultado()[0]!)[2]).toBe('Resultado 0,00');
  });

  it('un mes futuro no aparece', async () => {
    porMesFuturo = (anio, m) => (anio === 2026 && m === 12 ? { viajes_cantidad: 1, viajes_con_ingreso: 1, viajes_ingreso: 99, resultado: 99 } : {});
    await mount();
    expect(filasResultado()).toHaveLength(10);
    expect(textoDe('resumen-resultado')).not.toContain('diciembre');
  });

  it('año pasado: los 12 meses', async () => {
    await mount('/resumen?vista=anio&anio=2025');
    expect(filasResultado()).toHaveLength(12);
    expect(fila(filasResultado()[11]!)).toEqual(['diciembre', 'Ingresos 18.000,00 · Gastos 12.000,00', 'Ganancia 6.000,00']);
  });

  it('cada fila lleva al Mes de ese mes; tocarla lo abre (y "atrás" vuelve al año)', async () => {
    await mount();
    expect(filasResultado().map((li) => li.querySelector('a')!.getAttribute('href'))).toEqual([
      ...['01', '02', '03', '04', '05', '06', '07', '08', '09'].map((m) => `/resumen?mes=2026-${m}`),
      '/resumen',
    ]);
    await click(filasResultado()[6]!.querySelector('a'));
    expect(mesMostrado()).toBe('julio 2026');
    expect(search()).toBe('?mes=2026-07');
    await click(byId('atras'));
    expect(anioMostrado()).toBe('2026');
  });

  it('filas de al menos 44 px con foco visible', async () => {
    await mount();
    for (const li of filasResultado()) {
      expect(li.querySelector('a')!.className).toContain('min-h-11');
      expect(li.querySelector('a')!.className).toContain('focus-visible:ring-2');
    }
  });
});

// ---------------------------------------------------------------------------
// Vista Año: combustible del año
// ---------------------------------------------------------------------------
describe('Resumen, vista Año: combustible por camión', () => {
  const camiones = () => [...(byId('resumen-combustible')?.querySelectorAll('article') ?? [])];
  const pares = (dl: Element | null | undefined) =>
    [...(dl?.querySelectorAll(':scope > div') ?? [])].map((d) => `${plano(d.querySelector('dt')?.textContent)}: ${plano(d.querySelector('dd')?.textContent)}`);

  it('pide el año completo, de todos los camiones', async () => {
    await mount();
    expect(argsDeAnio('resumen_combustible')).toEqual([{ p_desde: '2026-01-01', p_hasta: '2026-12-31' }]);
  });

  it('el mismo bloque del Mes: cargas, rendimiento ponderado del año, la línea de tramos y "¿Cómo se calcula?" (cerrado)', async () => {
    await mount();
    const [camion] = camiones();
    expect(camiones()).toHaveLength(1);
    expect(camion!.querySelector('h3')!.textContent).toBe('AB 123 CD');
    expect(pares(camion!.querySelector('dl:not([data-rendimiento])'))).toEqual([
      'Cargas: 30 cargas',
      'Litros: 3.000,5 L',
      'Gasto: 70.000,00',
      'Precio promedio: 23,33 por litro',
    ]);
    expect(pares(camion!.querySelector('dl[data-rendimiento]'))).toEqual(['Rendimiento: 3,0 km/L', 'Consumo: 33,3 L/100 km', 'Costo por km: 7,67']);
    expect(plano(camion!.querySelector('[data-tramos]')!.textContent)).toBe('20 tramos usados (9.000 km, 3.000,0 L), ninguno descartado.');
    const details = byId('resumen-combustible')!.querySelector('details')!;
    expect(details.open).toBe(false);
    expect(details.querySelector('summary')!.textContent).toBe('¿Cómo se calcula?');
  });

  it('descartes del año: la línea dice cuántos y por qué', async () => {
    route.combustible = () => ok([combFila({ descartados_retroceso: 2, descartados_fuera_de_rango: 1 })]);
    await mount();
    expect(plano(camiones()[0]!.querySelector('[data-tramos]')!.textContent)).toBe(
      '20 tramos usados (9.000 km, 3.000,0 L), 3 descartados: el odómetro bajó respecto de la carga llena anterior (2); dio menos de 0,5 o más de 15 km por litro: casi siempre es un odómetro mal escrito (1).',
    );
  });

  it('sin cargas en el año: "Todavía no cargaste combustible en 2026" / "No cargaste combustible en 2025" (y la explicación sigue)', async () => {
    route.combustible = () => ok([]);
    await mount();
    expect(textoDe('resumen-combustible')).toContain('Todavía no cargaste combustible en 2026');
    expect(byId('resumen-combustible')!.querySelector('details summary')).not.toBeNull();
    await desmontar();
    await mount('/resumen?vista=anio&anio=2025');
    expect(textoDe('resumen-combustible')).toContain('No cargaste combustible en 2025');
    expect(textoDe('resumen-combustible')).not.toContain('este mes');
  });

  it('mientras carga: `aria-busy`; si falla, su "Reintentar" pide SOLO el combustible y lo demás se ve', async () => {
    let estado: 'cargando' | 'falla' | 'ok' = 'cargando';
    route.combustible = () => (estado === 'cargando' ? new Promise<Resp>(() => {}) : estado === 'falla' ? sinRed() : ok([combFila()]));
    await mount();
    expect(byId('resumen-combustible')!.getAttribute('aria-busy')).toBe('true');
    await desmontar();
    estado = 'falla';
    await mount();
    expect(textoDe('resumen-combustible')).toContain(NETWORK_ERROR_MESSAGE);
    expect(textoDe('resumen-gastos')).toContain('55.000,00');
    expect(textoDe('resumen-resultado')).toContain('27.500,00');
    const pedidos = rpcs('resumen_combustible').length;
    const otros = h.calls.length - pedidos;
    estado = 'ok';
    await click(botonEn('resumen-combustible', 'Reintentar'));
    expect(rpcs('resumen_combustible')).toHaveLength(pedidos + 1);
    expect(h.calls.length - rpcs('resumen_combustible').length).toBe(otros);
    expect(camiones()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// La vista Año entera
// ---------------------------------------------------------------------------
describe('Resumen, vista Año: la pantalla entera', () => {
  it('el orden de los bloques y la jerarquía de títulos (h1 → h2 → h3, sin saltos)', async () => {
    await mount();
    expect([...document.querySelectorAll('h2')].map((t) => t.textContent)).toEqual([
      'Gastos del año',
      'Gasto por mes',
      'Por categoría',
      'Por método de pago',
      'Por camión',
      'Ingresos y resultado',
      'Combustible por camión',
    ]);
    expect([...document.querySelectorAll('h3')].map((t) => t.textContent)).toEqual(['Resultado por mes', 'AB 123 CD']);
    const titulos = [...document.querySelectorAll('h1, h2, h3')].map((t) => Number(t.tagName[1]));
    expect(titulos[0]).toBe(1);
    titulos.forEach((nivel, i) => {
      if (i > 0) expect(nivel - titulos[i - 1]!).toBeLessThanOrEqual(1);
    });
    for (const seccion of document.querySelectorAll('section')) {
      expect(byId(seccion.getAttribute('aria-labelledby')!)!.tagName).toBe('H2');
    }
  });

  it('si TODO falla, cada bloque muestra su error con su "Reintentar" (ninguno tapa a otro) y ninguno queda "cargando"', async () => {
    route.gastos = () => sinRed();
    route.mensual = () => sinRed();
    route.combustible = () => sinRed();
    await mount();
    for (const id of ['resumen-gastos', 'resumen-gasto-por-mes', 'resumen-resultado', 'resumen-combustible']) {
      expect(byId(id)!.querySelector('[role="alert"]'), id).not.toBeNull();
      expect(botonEn(id, 'Reintentar'), id).toBeDefined();
      expect(byId(id)!.getAttribute('aria-busy'), id).toBe('false');
      expect(byId(id)!.querySelector('[data-cargando]'), id).toBeNull();
    }
  });

  it('al terminar de cargar no queda ningún aviso de carga ni sección ocupada', async () => {
    await mount();
    expect(bodyText()).not.toContain('Cargando');
    expect(document.querySelectorAll('[aria-busy="true"]')).toHaveLength(0);
    expect(document.querySelectorAll('[data-cargando]')).toHaveLength(0);
  });

  it('cambiar de año rearma los bloques: nada del año anterior (ni datos ni un "¿Cómo se calcula?" abierto)', async () => {
    await mount();
    const details = byId('resumen-combustible')!.querySelector('details')!;
    await act(async () => {
      details.open = true;
    });
    await click(buttonByLabel('Año anterior'));
    expect(textoDe('resumen-gastos')).toContain('78.000,00');
    expect(textoDe('resumen-gastos')).not.toContain('55.000,00');
    expect(byId('resumen-gasto-por-mes')!.querySelectorAll('li[data-mes]')).toHaveLength(12);
    expect(byId('resumen-combustible')!.querySelector('details')!.open).toBe(false);
  });

  it('aunque el otro año ya esté en caché (se ve al instante, sin pasar por "cargando"), la vista se rearma de cero', async () => {
    // 2025 ya visto: sus datos quedan frescos en caché. Al volver a 2025 no hay carga que desmonte los bloques: lo único que
    // los rearma es la `key` del año.
    await mount('/resumen?vista=anio&anio=2025');
    await click(buttonByLabel('Año siguiente'));
    expect(anioMostrado()).toBe('2026');
    await act(async () => {
      byId('resumen-combustible')!.querySelector('details')!.open = true;
    });
    h.calls.length = 0;
    await click(buttonByLabel('Año anterior'));
    expect(rpcs('resumen_gastos')).toHaveLength(0); // vino de la caché
    expect(textoDe('resumen-gastos')).toContain('78.000,00');
    expect(byId('resumen-combustible')!.querySelector('details')!.open).toBe(false);
  });

  it('cambiar de vista y volver tampoco arrastra estado', async () => {
    await mount();
    await act(async () => {
      byId('resumen-combustible')!.querySelector('details')!.open = true;
    });
    await click(enlaceDeVista('Mes'));
    expect(mesMostrado()).toBe('octubre 2026');
    await click(enlaceDeVista('Año'));
    expect(anioMostrado()).toBe('2026');
    expect(byId('resumen-combustible')!.querySelector('details')!.open).toBe(false);
  });

  it('ningún color fijo: solo clases del tema; el único estilo en línea es el ancho de las barras', async () => {
    await mount();
    const clases = [...container.querySelectorAll('[class]')].map((el) => el.getAttribute('class')!).join(' ');
    expect(clases).not.toMatch(/(?:bg|text|border|fill|stroke)-(?:red|green|blue|yellow|amber|gray|slate|zinc|neutral|stone|orange|emerald|white|black)\b/);
    expect(clases).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    const estilos = [...container.querySelectorAll<HTMLElement>('[style]')].map((el) => el.getAttribute('style')!);
    expect(estilos.length).toBeGreaterThan(0);
    for (const estilo of estilos) expect(estilo).toMatch(/^width: [\d.]+%;?$/);
  });

  it('nombres de categoría, de mes y de camión se muestran como TEXTO (nunca HTML)', async () => {
    route.gastos = () => ok([total(100, 1), cat(CAT_A, '<img src=x onerror=alert(1)>', 100), met(null, 100), cam(null, null, null, 100)]);
    await mount();
    expect(textoDe('resumen-por-categoria')).toContain('<img src=x onerror=alert(1)>');
    expect(container.querySelector('img')).toBeNull();
  });
});
