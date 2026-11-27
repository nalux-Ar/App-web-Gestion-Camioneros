import { act, useMemo, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, type InitialEntry } from 'react-router';
import { onlineManager, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// La estructura del Resumen: el orden de las tarjetas (Mes y Año), los plegados y su apertura ante un error, y que se piden
// los mismos datos de siempre. Mock de supabase: cada función de la base responde según `route`; todo lo demás es código
// real. "Hoy" es el 14 de octubre de 2026 (solo se fija `Date`: los timers son los reales). Todos los datos son inventados.
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
import { GASTOS_VARIOS_CATEGORIA_ID } from '@/features/gastos/constants';
import { queryClient } from '@/lib/query-client';

type Resp = { data: unknown; error: { message: string; code: string } | null; status: number };
const ok = (data: unknown): Resp => ({ data, error: null, status: 200 });
const sinRed = (): Resp => ({ data: null, error: { code: '', message: 'TypeError: Failed to fetch' }, status: 0 });
const MIEMBRO = { rol: 'admin', tema: 'dark', color_acento: '#F59E0B', transportista_id: 'tenant-a', camion_activo_id: null, transportistas: { nombre: 'Transportes A' } };

const CAT_A = 'a1000000-0000-4000-8000-000000000001';
const CAM_X = 'c1000000-0000-4000-8000-000000000001';
const V1 = 'b1000000-0000-4000-8000-000000000001';

type FilaGasto = { grupo: string; clave: string | null; nombre: string | null; activa: boolean | null; cantidad: number; monto: number };
const total = (monto: number, cantidad: number): FilaGasto => ({ grupo: 'total', clave: null, nombre: null, activa: null, cantidad, monto });
const cat = (clave: string, nombre: string, monto: number, cantidad = 1): FilaGasto => ({ grupo: 'categoria', clave, nombre, activa: null, cantidad, monto });
const met = (clave: string | null, monto: number, cantidad = 1): FilaGasto => ({ grupo: 'metodo_pago', clave, nombre: null, activa: null, cantidad, monto });
const cam = (clave: string | null, nombre: string | null, activa: boolean | null, monto: number, cantidad = 1): FilaGasto => ({ grupo: 'camion', clave, nombre, activa, cantidad, monto });

const GASTOS: FilaGasto[] = [total(10000, 8), cat(CAT_A, 'Combustible', 10000, 8), met('efectivo', 10000, 8), cam(CAM_X, 'AB123CD', true, 10000, 8)];

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

const COMBUSTIBLE = {
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
};

const VIAJE = {
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
  total_viajes: 1,
};

type Handler = (call: Call) => unknown;
const route: { gastos: Handler; mensual: Handler; combustible: Handler; viajes: Handler; varios: Handler } = {} as never;
const argsDe = (call: Call) => call.ops.find((o) => o.m === 'rpc')!.args[0] as Record<string, unknown>;

function resetRoutes() {
  route.gastos = () => ok(GASTOS);
  route.mensual = (call) => {
    const desde = String(argsDe(call).p_mes_desde);
    const primero = Number(desde.slice(5, 7));
    return ok(Array.from({ length: Number(argsDe(call).p_meses) }, (_, i) => mesFila(`${desde.slice(0, 4)}-${String(primero + i).padStart(2, '0')}-01`)));
  };
  route.combustible = () => ok([COMBUSTIBLE]);
  route.viajes = () => ok([VIAJE]);
  route.varios = () => ok([]);
}

function installResponder() {
  h.state.responder = (call: Call) => {
    if (call.target === 'miembros') return ok(MIEMBRO);
    if (call.target === 'rpc:resumen_gastos') return route.gastos(call);
    if (call.target === 'rpc:resumen_mensual') return route.mensual(call);
    if (call.target === 'rpc:resumen_combustible') return route.combustible(call);
    if (call.target === 'rpc:resumen_viajes') return route.viajes(call);
    if (call.target === 'rpc:resumen_gastos_varios') return route.varios(call);
    throw new Error(`pedido inesperado: ${call.target}`);
  };
}

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

async function settle(times = 6) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function mount(entry: InitialEntry = '/resumen') {
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
                  <Route path="/resumen" element={<ResumenPage />} />
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

/** Los pedidos hechos, como texto y en orden alfabético (el orden en que salen no importa). */
const pedidos = () => h.calls.map((c) => (c.target === 'miembros' ? 'miembros' : `${c.target} ${JSON.stringify(argsDe(c))}`)).sort();

async function desmontar() {
  await act(async () => root.unmount());
  container.remove();
  queryClient.clear();
}

// ----- lo que se ve
const NBSP = String.fromCharCode(0xa0);
const MENOS = String.fromCharCode(0x2212);
const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T | null;
/** Texto como se lee: espacios duros y signo menos tipográfico normalizados, espacios colapsados. */
const plano = (texto: string | null | undefined) => (texto ?? '').split(NBSP).join(' ').split(MENOS).join('-').replace(/\s+/g, ' ').trim();
const textos = (selector: string) => [...document.querySelectorAll(selector)].map((el) => plano(el.textContent));
const secciones = () => [...document.querySelectorAll('section')].map((s) => s.id);
/** Una pieza del contenido: su etiqueta y, si lo tiene, su id (`#…`) o su marca `data-…`. */
const nombreDeParte = (el: Element) => {
  const marca = el.id ? `#${el.id}` : ([...el.attributes].find((a) => a.name.startsWith('data-'))?.name ?? '');
  return `${el.tagName} ${marca}`.trim();
};
/** El contenido de una tarjeta a la vista (lo que va debajo de su título), en orden. */
const partes = (id: string) => [...byId(id)!.querySelector(':scope > div')!.children].map(nombreDeParte);
/** El nombre accesible de una sección: el texto del elemento al que apunta su `aria-labelledby`. */
const nombreDe = (id: string) => plano(byId(byId(id)!.getAttribute('aria-labelledby')!)!.textContent);

// ----- plegados
const boton = (id: string) => byId(id)!.querySelector<HTMLButtonElement>(':scope > h2 > button')!;
const region = (id: string) => byId(`${id}-contenido`)!;
const aviso = (id: string) => byId(id)!.querySelector('[data-plegado-fallo]');
const plegados = () => [...document.querySelectorAll('section > h2 > button[aria-expanded]')].map((b) => b.closest('section')!.id);
/** Los que están abiertos; de paso, que lo que dice el botón y lo que se ve coincidan. */
const abiertos = () =>
  plegados().filter((id) => {
    expect(boton(id).getAttribute('aria-expanded'), id).toBe(String(!region(id).hidden));
    return !region(id).hidden;
  });
const botonReintentar = (id: string) =>
  [...(byId(id)?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find((b) => b.textContent?.trim() === 'Reintentar');

// ----- acciones
async function click(el: HTMLElement | null | undefined) {
  if (!el) throw new Error('no se encontró el elemento a tocar');
  await act(async () => {
    el.click();
  });
  await settle();
}
const tocar = (id: string) => click(boton(id));
const tocarBoton = (etiqueta: string) => click(document.querySelector<HTMLButtonElement>(`button[aria-label="${etiqueta}"]`));
const tocarVista = (texto: string) => click([...document.querySelectorAll<HTMLAnchorElement>('nav a')].find((a) => a.textContent === texto));
/** Se corta y vuelve la señal: TanStack vuelve a pedir solo lo que quedó con error o viejo. */
async function volverLaSenal() {
  await act(async () => onlineManager.setOnline(false));
  await act(async () => onlineManager.setOnline(true));
  await settle();
}
/** Lo que pasa cuando otra pantalla guarda algo: se vuelve a pedir todo lo que está a la vista. */
async function refrescar() {
  await act(async () => {
    await queryClient.invalidateQueries();
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
// Los pedidos a la base: ni uno más, ni uno menos
// ---------------------------------------------------------------------------
const OCT = '{"p_desde":"2026-10-01","p_hasta":"2026-10-31"}';
const PEDIDOS_DEL_MES = [
  'miembros',
  `rpc:resumen_combustible ${OCT}`,
  `rpc:resumen_gastos ${OCT}`,
  'rpc:resumen_gastos {"p_desde":"2026-09-01","p_hasta":"2026-09-14"}',
  'rpc:resumen_mensual {"p_mes_desde":"2026-10-01","p_meses":1}',
  `rpc:resumen_viajes ${OCT}`,
].sort();
const ANIO = '{"p_desde":"2026-01-01","p_hasta":"2026-12-31"}';
const PEDIDOS_DEL_ANIO = [
  'miembros',
  `rpc:resumen_combustible ${ANIO}`,
  `rpc:resumen_gastos ${ANIO}`,
  'rpc:resumen_mensual {"p_mes_desde":"2026-01-01","p_meses":12}',
].sort();
const CON_VARIOS: FilaGasto[] = [total(500, 1), cat(GASTOS_VARIOS_CATEGORIA_ID, 'Gastos varios', 500, 1), met('efectivo', 500, 1), cam(null, null, null, 500, 1)];

describe('Resumen: los pedidos a la base son los de siempre', () => {
  it('vista Mes: exactamente estos, cada uno una sola vez', async () => {
    await mount();
    expect(pedidos()).toEqual(PEDIDOS_DEL_MES);
  });

  it('vista Mes con "Gastos varios": los mismos más el detalle (uno)', async () => {
    route.gastos = () => ok(CON_VARIOS);
    await mount();
    expect(pedidos()).toEqual([...PEDIDOS_DEL_MES, `rpc:resumen_gastos_varios ${OCT}`].sort());
  });

  it('vista Año: gastos, meses y combustible del año; nada de viajes, comparación ni detalle de varios', async () => {
    route.gastos = () => ok(CON_VARIOS);
    await mount('/resumen?vista=anio');
    expect(pedidos()).toEqual(PEDIDOS_DEL_ANIO);
  });

  it.each([
    ['Mes', '/resumen', PEDIDOS_DEL_MES],
    ['Año', '/resumen?vista=anio', PEDIDOS_DEL_ANIO],
  ])('vista %s: abrir y cerrar todos los plegados no pide nada (las consultas no son perezosas)', async (_vista, url, esperados) => {
    await mount(url);
    expect(pedidos()).toEqual(esperados);
    for (const id of plegados()) await tocar(id);
    for (const id of plegados()) await tocar(id);
    expect(pedidos()).toEqual(esperados);
  });
});

// ---------------------------------------------------------------------------
// El orden de las tarjetas
// ---------------------------------------------------------------------------
const ORDEN_DEL_MES = ['resumen-resultado', 'resumen-gastos', 'resumen-por-metodo', 'resumen-por-camion', 'resumen-combustible', 'resumen-viajes'];
const ORDEN_DEL_ANIO = ['resumen-resultado', 'resumen-gastos', 'resumen-mes-por-mes', 'resumen-por-metodo', 'resumen-por-camion', 'resumen-combustible'];
const PLEGADOS_DEL_MES = ORDEN_DEL_MES.slice(2);
const PLEGADOS_DEL_ANIO = ORDEN_DEL_ANIO.slice(2);
const SIN_GASTOS_DEL_PERIODO = () => ok([total(0, 0)]);

describe('Resumen: el orden de las tarjetas', () => {
  it.each([
    ['Mes', '/resumen', 'Mes', ORDEN_DEL_MES],
    ['Año', '/resumen?vista=anio', 'Año', ORDEN_DEL_ANIO],
  ])('vista %s: "¿Cuánto te quedó?" justo debajo del selector, "En qué gastaste" segunda y después los plegados', async (_vista, url, selector, orden) => {
    await mount(url);
    expect(secciones()).toEqual(orden);
    // Entre el selector del período y la primera tarjeta solo está el aviso de la pantalla (oculto).
    const aviso = byId('resumen-resultado')!.previousElementSibling!;
    expect(aviso.getAttribute('role')).toBe('status');
    expect(aviso.className).toBe('sr-only');
    expect(aviso.previousElementSibling!.getAttribute('role')).toBe('group');
    expect(aviso.previousElementSibling!.getAttribute('aria-label')).toBe(selector);
    expect(byId('resumen-resultado')!.nextElementSibling).toBe(byId('resumen-gastos'));
  });

  it('el orden no cambia aunque los gastos lleguen DESPUÉS del combustible y los viajes; y lo que estaba abierto sigue abierto', async () => {
    let soltar: (r: Resp) => void = () => {};
    route.gastos = (call) => (argsDe(call).p_desde === '2026-10-01' ? new Promise<Resp>((resolver) => (soltar = resolver)) : ok(GASTOS));
    await mount();
    expect(secciones()).toEqual(['resumen-resultado', 'resumen-gastos', 'resumen-combustible', 'resumen-viajes']);
    await tocar('resumen-combustible');
    await act(async () => soltar(ok(GASTOS)));
    await settle();
    expect(secciones()).toEqual(ORDEN_DEL_MES);
    expect(abiertos()).toEqual(['resumen-combustible']);
  });

  it.each([
    ['Mes', '/resumen', ['resumen-resultado', 'resumen-gastos', 'resumen-combustible', 'resumen-viajes']],
    ['Año', '/resumen?vista=anio', ['resumen-resultado', 'resumen-gastos', 'resumen-mes-por-mes', 'resumen-combustible']],
  ])('vista %s sin gastos: no hay "Cómo pagaste" ni "Gasto por camión"; el resto queda igual', async (_vista, url, orden) => {
    route.gastos = SIN_GASTOS_DEL_PERIODO;
    await mount(url);
    expect(secciones()).toEqual(orden);
  });

  it.each([
    ['Mes', '/resumen'],
    ['Año', '/resumen?vista=anio'],
  ])('vista %s: ningún gasto con camión: está "Cómo pagaste" y no "Gasto por camión"', async (_vista, url) => {
    route.gastos = () => ok([total(100, 1), cat(CAT_A, 'Peajes', 100), met('efectivo', 100), cam(null, null, null, 100)]);
    await mount(url);
    expect(byId('resumen-por-metodo')).not.toBeNull();
    expect(byId('resumen-por-camion')).toBeNull();
  });

  it('dentro de la primera tarjeta: Cobraste, Gastaste, un separador, el resultado y cómo se calcula', async () => {
    await mount();
    expect(partes('resumen-resultado')).toEqual(['DL', 'HR', 'DIV data-resultado', 'P']);
    expect(textos('#resumen-resultado dl dt')).toEqual(['Cobraste', 'Gastaste']);
    expect(textos('#resumen-resultado [data-resultado] > p')).toEqual(['Te quedó', '$ 15.000']);
    expect(textos('#resumen-resultado > div > p')).toEqual(['El resultado es lo que cobraste por los viajes del mes menos todos los gastos del mes.']);
  });

  it('el aviso de viajes sin cobro anotado va pegado al resultado (antes de la explicación)', async () => {
    route.mensual = () => ok([mesFila('2026-10-01', { viajes_con_ingreso: 2, viajes_sin_ingreso: 1 })]);
    await mount();
    expect(textos('#resumen-resultado [data-resultado] > p')).toEqual(['Te quedó', '$ 15.000', '1 viaje sin cobro anotado: el resultado puede estar incompleto.']);
    expect(partes('resumen-resultado')).toEqual(['DL', 'HR', 'DIV data-resultado', 'P']);
  });

  it.each([
    [0, 'No hay viajes en el mes. Anota tus viajes con lo que cobraste para saber cuánto te quedó en el mes.', []],
    [1, 'Tu viaje del mes no tiene anotado lo que cobraste. Anótalo para saber cuánto te quedó en el mes.', ['0 de 1 viaje con cobro anotado']],
    [4, 'Ninguno de tus 4 viajes del mes tiene anotado lo que cobraste. Anótalo para saber cuánto te quedó en el mes.', ['0 de 4 viajes con cobro anotado']],
  ])('sin resultado (%i viajes): en su lugar el texto y el enlace; Cobraste y Gastaste igual; ningún resultado inventado ni explicación', async (viajes, texto, detalle) => {
    route.mensual = () => ok([mesFila('2026-10-01', { viajes_cantidad: viajes, viajes_con_ingreso: 0, viajes_sin_ingreso: viajes, viajes_ingreso: 0, resultado: null })]);
    await mount();
    expect(partes('resumen-resultado')).toEqual(['DL', 'HR', 'DIV']);
    expect(textos('#resumen-resultado dl > div > *')).toEqual(['Cobraste', '$ 0', ...detalle, 'Gastaste', '$ 10.000']);
    expect(textos('#resumen-resultado hr + div > *')).toEqual([texto, 'Ver los viajes del mes']);
    expect(plano(byId('resumen-resultado')!.textContent)).not.toMatch(/Te quedó|Perdiste|El resultado|incompleto/);
  });

  it('con pérdida: la tarjeta dice "Perdiste" y la fila del viaje sigue diciendo "Pérdida"', async () => {
    route.mensual = () => ok([mesFila('2026-10-01', { viajes_ingreso: 7000, resultado: -3000 })]);
    route.viajes = () => ok([{ ...VIAJE, ingreso: 1000, gastos_monto: 3000, ganancia: -2000 }]);
    await mount();
    expect(textos('#resumen-resultado [data-resultado] > p')).toEqual(['Perdiste', '-$ 3.000']);
    expect(textos('#resumen-viajes [data-ganancia] span')).toEqual(['Pérdida', '-$ 2.000']);
  });

  it('Año con pérdida: la tarjeta dice "Perdiste" y las filas de "Resultado por mes" siguen diciendo "Pérdida"; con ganancia, "Ganancia"', async () => {
    route.mensual = () =>
      ok(
        Array.from({ length: 12 }, (_, i) =>
          mesFila(`2026-${String(i + 1).padStart(2, '0')}-01`, i === 0 ? { resultado: 500 } : { viajes_ingreso: 7000, resultado: -3000 }),
        ),
      );
    await mount('/resumen?vista=anio');
    expect(textos('#resumen-resultado [data-resultado] > p')[0]).toBe('Perdiste');
    const rotulos = textos('#resumen-mes-por-mes [data-resultado-del-mes] > span:first-child');
    expect(rotulos).toEqual(['Ganancia', ...Array<string>(9).fill('Pérdida')]);
  });

  it('"En qué gastaste" del Mes: la cantidad, las barras y la comparación, en ese orden', async () => {
    await mount();
    expect(partes('resumen-gastos')).toEqual(['P', 'DIV #resumen-por-categoria', 'DIV data-comparacion']);
    expect(textos('#resumen-gastos > div > p')).toEqual(['8 gastos']);
  });

  it('"En qué gastaste" del Año: la cantidad, las barras y el promedio por mes, en ese orden', async () => {
    await mount('/resumen?vista=anio');
    expect(partes('resumen-gastos')).toEqual(['P', 'DIV #resumen-por-categoria', 'DL']);
    expect(textos('#resumen-gastos > div > p')).toEqual(['8 gastos']);
    expect(textos('#resumen-gastos [data-promedio] > *')).toEqual(['Promedio por mes', '$ 1.000', 'promedio de los 10 meses transcurridos']);
  });

  it('"Mes por mes": viajes y km del año, "Gasto por mes", "Resultado por mes" y el paso a la vista Mes, en ese orden', async () => {
    await mount('/resumen?vista=anio');
    const hijos = [...region('resumen-mes-por-mes').children];
    expect(hijos.map(nombreDeParte)).toEqual(['DL', 'DIV #resumen-gasto-por-mes', 'DIV data-resultado-por-mes', 'P data-viajes-por-mes']);
    expect(textos('#resumen-mes-por-mes dl dt')).toEqual(['Viajes', 'Km recorridos']);
    // La base falsa llena los 12 meses (3 viajes y 1.500 km cada uno): los totales suman la serie entera.
    expect(textos('#resumen-mes-por-mes dl dd')).toEqual(['36 viajes', '18.000 km']);
    expect(hijos[1]!.querySelectorAll('li[data-mes]')).toHaveLength(10);
    expect(hijos[2]!.querySelectorAll('li[data-mes]')).toHaveLength(10);
    expect(plano(hijos[3]!.textContent)).toBe('La lista de viajes se ve mes a mes: toca un mes o pasa a la vista Mes. Ir a la vista Mes');
    // La primera tarjeta ya no lleva nada de eso.
    expect(plano(byId('resumen-resultado')!.textContent)).not.toMatch(/Km recorridos|mes a mes|Resultado por mes/);
  });

  it.each([
    [{ viajes: [], total: 0 }, 'Viajes del mes (0)'],
    [{ viajes: [VIAJE], total: 1 }, 'Viajes del mes (1)'],
    [{ viajes: [{ ...VIAJE, total_viajes: 600 }], total: 600 }, 'Viajes del mes (600)'],
  ])('el título de los viajes dice cuántos HAY en el mes (no cuántos se muestran): %j', async (dato, titulo) => {
    route.viajes = () => ok(dato.viajes);
    await mount();
    expect(nombreDe('resumen-viajes')).toBe(titulo);
  });
});

// ---------------------------------------------------------------------------
// Los plegados
// ---------------------------------------------------------------------------
describe('Resumen: lo demás va plegado', () => {
  it.each([
    ['Mes', '/resumen', PLEGADOS_DEL_MES, ['Cómo pagaste', 'Gasto por camión', 'Combustible por camión', 'Viajes del mes (1)']],
    ['Año', '/resumen?vista=anio', PLEGADOS_DEL_ANIO, ['Mes por mes', 'Cómo pagaste', 'Gasto por camión', 'Combustible por camión']],
  ])('vista %s: al entrar están todos cerrados; las dos primeras tarjetas no se pliegan', async (_vista, url, ids, titulos) => {
    await mount(url);
    expect(plegados()).toEqual(ids);
    expect(abiertos()).toEqual([]);
    expect(ids.map(nombreDe)).toEqual(titulos);
    expect(ids.map((id) => plano(boton(id).textContent))).toEqual(titulos);
    for (const id of ['resumen-resultado', 'resumen-gastos']) {
      expect(byId(id)!.querySelector('button'), id).toBeNull();
      expect(byId(id)!.closest('[hidden]'), id).toBeNull();
      expect(byId(id)!.querySelector('[hidden]'), id).toBeNull();
    }
  });

  it.each([
    ['Mes', '/resumen'],
    ['Año', '/resumen?vista=anio'],
  ])('vista %s: acordeón accesible (h2 con un botón, aria-expanded, aria-controls a una región que está aunque esté oculta, sección con nombre)', async (_vista, url) => {
    await mount(url);
    for (const id of plegados()) {
      const seccion = byId(id)!;
      const h2 = seccion.querySelector('h2')!;
      expect(h2.parentElement, id).toBe(seccion);
      expect(h2.children, id).toHaveLength(1);
      expect(h2.firstElementChild, id).toBe(boton(id));
      expect(boton(id).getAttribute('type'), id).toBe('button');
      expect(boton(id).getAttribute('aria-expanded'), id).toBe('false');
      expect(boton(id).getAttribute('aria-controls'), id).toBe(`${id}-contenido`);
      expect(region(id).parentElement, id).toBe(seccion);
      expect(region(id).hidden, id).toBe(true);
      // El nombre de la sección es SOLO el título.
      const nombre = byId(seccion.getAttribute('aria-labelledby')!)!;
      expect(boton(id).contains(nombre), id).toBe(true);
      const iconos = boton(id).querySelectorAll('svg');
      expect(iconos, id).toHaveLength(1);
      expect(iconos[0]!.getAttribute('aria-hidden'), id).toBe('true');
    }
    const ids = [...document.querySelectorAll('[id]')].map((el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('la fila entera se toca (48 px como mínimo, letra de 18 px, foco visible) y el título parte en renglones sin desbordar', async () => {
    await mount();
    for (const id of plegados()) {
      const clases = boton(id).className.split(' ');
      expect(clases, id).toEqual(expect.arrayContaining(['min-h-12', 'w-full', 'text-left', 'focus-visible:ring-2', 'focus-visible:ring-ring']));
      expect(byId(id)!.querySelector('h2')!.className.split(' '), id).toContain('text-lg');
      const titulo = byId(`${id}-titulo`)!;
      expect(titulo.className.split(' '), id).toContain('break-words');
      expect(titulo.parentElement!.className.split(' '), id).toEqual(expect.arrayContaining(['min-w-0', 'flex-1']));
      expect(boton(id).className, id).not.toMatch(/whitespace-nowrap|truncate|break-all/);
      expect(boton(id).querySelector('svg')!.getAttribute('class')!.split(' '), id).toContain('shrink-0');
      // Una clase de `display` en la región le ganaría al atributo `hidden`.
      expect(region(id).className.split(' ').filter((c) => /^(flex|grid|block|inline|inline-block|contents|table)$/.test(c)), id).toEqual([]);
    }
  });

  it('tocar el título abre SOLO ese plegado (y la flecha gira); tocarlo otra vez lo cierra', async () => {
    await mount();
    const flecha = () => boton('resumen-por-camion').querySelector('svg')!.getAttribute('class')!.split(' ');
    expect(flecha()).not.toContain('rotate-180');
    await tocar('resumen-por-camion');
    expect(abiertos()).toEqual(['resumen-por-camion']);
    expect(flecha()).toContain('rotate-180');
    await tocar('resumen-viajes');
    expect(abiertos()).toEqual(['resumen-por-camion', 'resumen-viajes']);
    await tocar('resumen-por-camion');
    expect(abiertos()).toEqual(['resumen-viajes']);
    expect(flecha()).not.toContain('rotate-180');
  });

  it('cada cosa está dentro de la región de SU plegado', async () => {
    await mount();
    expect(region('resumen-por-metodo').querySelector('li[data-fila="efectivo"]')).not.toBeNull();
    expect(region('resumen-por-camion').querySelector(`li[data-fila="${CAM_X}"]`)).not.toBeNull();
    expect(region('resumen-combustible').querySelectorAll('article')).toHaveLength(1);
    expect(region('resumen-combustible').querySelector('details')).not.toBeNull();
    expect(region('resumen-viajes').querySelectorAll('li[data-viaje]')).toHaveLength(1);
  });

  it('cambiar de mes los deja cerrados, también al volver a un mes que ya estaba en caché', async () => {
    await mount();
    for (const id of PLEGADOS_DEL_MES) await tocar(id);
    expect(abiertos()).toEqual(PLEGADOS_DEL_MES);
    await tocarBoton('Mes anterior');
    expect(plegados()).toEqual(PLEGADOS_DEL_MES);
    expect(abiertos()).toEqual([]);
    for (const id of PLEGADOS_DEL_MES) await tocar(id);
    h.calls.length = 0;
    await tocarBoton('Mes siguiente');
    expect(h.calls).toHaveLength(0); // vino de la caché: sin pasar por "cargando"
    expect(abiertos()).toEqual([]);
  });

  it('cambiar de año los deja cerrados, también al volver a un año que ya estaba en caché', async () => {
    await mount('/resumen?vista=anio');
    for (const id of PLEGADOS_DEL_ANIO) await tocar(id);
    expect(abiertos()).toEqual(PLEGADOS_DEL_ANIO);
    await tocarBoton('Año anterior');
    expect(plegados()).toEqual(PLEGADOS_DEL_ANIO);
    expect(abiertos()).toEqual([]);
    for (const id of PLEGADOS_DEL_ANIO) await tocar(id);
    h.calls.length = 0;
    await tocarBoton('Año siguiente');
    expect(h.calls).toHaveLength(0);
    expect(abiertos()).toEqual([]);
  });

  it('cambiar de vista (y volver) los deja cerrados', async () => {
    await mount();
    await tocar('resumen-combustible');
    await tocar('resumen-por-metodo');
    await tocarVista('Año');
    expect(abiertos()).toEqual([]);
    await tocar('resumen-combustible');
    await tocar('resumen-por-metodo');
    await tocarVista('Mes');
    expect(plegados()).toEqual(PLEGADOS_DEL_MES);
    expect(abiertos()).toEqual([]);
  });

  it('al volver a entrar a la pantalla arranca cerrado (el estado no se guarda en ningún lado)', async () => {
    await mount();
    const guardado = () => JSON.stringify([{ ...localStorage }, { ...sessionStorage }]);
    const antes = guardado();
    await tocar('resumen-combustible');
    expect(guardado()).toBe(antes);
    await desmontar();
    await mount();
    expect(abiertos()).toEqual([]);
  });

  it.each([
    ['resumen-combustible', 'combustible', '/resumen'],
    ['resumen-viajes', 'viajes', '/resumen'],
    ['resumen-combustible', 'combustible', '/resumen?vista=anio'],
    ['resumen-mes-por-mes', 'mensual', '/resumen?vista=anio'],
  ] as const)('abrir %s mientras carga muestra las filas grises adentro; al llegar los datos sigue abierto (%s, %s)', async (id, consulta, url) => {
    const normal = route[consulta];
    let soltar: (r: unknown) => void = () => {};
    let pendiente: Call | null = null;
    route[consulta] = (call) => {
      pendiente = call;
      return new Promise((resolver) => (soltar = resolver));
    };
    await mount(url);
    expect(byId(id)!.getAttribute('aria-busy')).toBe('true');
    expect(abiertos()).toEqual([]);
    await tocar(id);
    expect(region(id).querySelector('[data-cargando]')).not.toBeNull();
    await act(async () => soltar(normal(pendiente!)));
    await settle();
    expect(abiertos()).toEqual([id]);
    expect(byId(id)!.getAttribute('aria-busy')).toBe('false');
    expect(region(id).querySelector('[data-cargando]')).toBeNull();
    expect(region(id).children.length).toBeGreaterThan(0);
  });

  it('mientras cargan los viajes el título va sin número', async () => {
    route.viajes = () => new Promise(() => {});
    await mount();
    expect(nombreDe('resumen-viajes')).toBe('Viajes del mes');
  });
});

// ---------------------------------------------------------------------------
// Un error nunca queda escondido
// ---------------------------------------------------------------------------
const PROPIOS = [
  ['resumen-combustible', 'combustible', '/resumen', 'Combustible por camión'],
  ['resumen-viajes', 'viajes', '/resumen', 'Viajes del mes'],
  ['resumen-combustible', 'combustible', '/resumen?vista=anio', 'Combustible por camión'],
] as const;

describe.each(PROPIOS)('Resumen: si falla la consulta propia de %s (%s, %s)', (id, consulta, url, titulo) => {
  const rpc = `resumen_${consulta}`;
  const cuantos = () => h.calls.filter((c) => c.target === `rpc:${rpc}`).length;
  let falla = true;
  let normal: Handler;
  beforeEach(() => {
    falla = true;
    normal = route[consulta];
    route[consulta] = (call) => (falla ? sinRed() : normal(call));
  });

  it('se abre solo, con el error y su "Reintentar" a la vista; los demás siguen cerrados', async () => {
    await mount(url);
    expect(abiertos()).toEqual([id]);
    const alerta = region(id).querySelector('[role="alert"]')!;
    expect(alerta.closest('[hidden]')).toBeNull();
    expect(botonReintentar(id)).toBeDefined();
    // Abierto, el encabezado no repite el aviso.
    expect(aviso(id)).toBeNull();
    expect(plano(boton(id).textContent)).toBe(titulo);
  });

  it('cerrado, el encabezado dice que no se pudo cargar (con ícono), y la sección se sigue llamando como su título', async () => {
    await mount(url);
    await tocar(id);
    expect(abiertos()).toEqual([]);
    expect(plano(aviso(id)!.textContent)).toBe('No se pudo cargar');
    expect(boton(id).contains(aviso(id))).toBe(true);
    // Las dos frases se leen separadas en el nombre del botón.
    expect(plano(boton(id).textContent)).toBe(`${titulo} No se pudo cargar`);
    expect(aviso(id)!.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
    expect(aviso(id)!.className.split(' ')).toContain('text-destructive-text');
    expect(nombreDe(id)).toBe(titulo);
    // El aviso es solo de este plegado.
    expect(document.querySelectorAll('[data-plegado-fallo]')).toHaveLength(1);
  });

  it('cerrado por la persona, el MISMO fallo no lo vuelve a abrir: ni al recuperar la señal ni al refrescar', async () => {
    await mount(url);
    await tocar(id);
    let antes = cuantos();
    await volverLaSenal();
    expect(cuantos()).toBe(antes + 1); // de verdad se volvió a pedir (y volvió a fallar)
    expect(abiertos()).toEqual([]);
    expect(aviso(id)).not.toBeNull();
    antes = cuantos();
    await refrescar();
    expect(cuantos()).toBe(antes + 1);
    expect(abiertos()).toEqual([]);
    expect(aviso(id)).not.toBeNull();
  });

  it('"Reintentar", cerrar mientras carga y volver a fallar: queda cerrado', async () => {
    await mount(url);
    let soltar: (r: Resp) => void = () => {};
    route[consulta] = () => new Promise<Resp>((resolver) => (soltar = resolver));
    await click(botonReintentar(id));
    expect(abiertos()).toEqual([id]);
    await tocar(id);
    expect(aviso(id)).toBeNull(); // está cargando de nuevo: todavía no falló
    await act(async () => soltar(sinRed()));
    await settle();
    expect(abiertos()).toEqual([]);
    expect(aviso(id)).not.toBeNull();
  });

  it('"Reintentar" que sale bien: muestra los datos y sigue abierto hasta que la persona lo cierra, ya sin aviso', async () => {
    await mount(url);
    falla = false;
    await click(botonReintentar(id));
    expect(abiertos()).toEqual([id]);
    expect(region(id).querySelector('[role="alert"]')).toBeNull();
    await tocar(id);
    expect(abiertos()).toEqual([]);
    expect(aviso(id)).toBeNull();
  });

  it('un fallo NUEVO, después de haber cargado bien, sí lo vuelve a abrir (con los datos de antes debajo del error)', async () => {
    await mount(url);
    falla = false;
    await click(botonReintentar(id));
    await tocar(id);
    falla = true;
    await refrescar();
    expect(abiertos()).toEqual([id]);
    expect(region(id).querySelector('[role="alert"]')).not.toBeNull();
    expect(region(id).querySelector('article, li[data-viaje]')).not.toBeNull();
    // Y este segundo fallo también se abre una sola vez.
    await tocar(id);
    await refrescar();
    expect(abiertos()).toEqual([]);
    expect(aviso(id)).not.toBeNull();
  });

  it('abierto a mano mientras carga y cerrado antes de que falle: se abre solo (una vez)', async () => {
    let soltar: (r: Resp) => void = () => {};
    route[consulta] = () => new Promise<Resp>((resolver) => (soltar = resolver));
    await mount(url);
    await tocar(id);
    await tocar(id);
    await act(async () => soltar(sinRed()));
    await settle();
    expect(abiertos()).toEqual([id]);
  });

  it('abierto a mano mientras carga y falla estando abierto: sigue abierto, y al cerrarlo ya no vuelve solo', async () => {
    let soltar: (r: Resp) => void = () => {};
    route[consulta] = () => new Promise<Resp>((resolver) => (soltar = resolver));
    await mount(url);
    await tocar(id);
    await act(async () => soltar(sinRed()));
    await settle();
    expect(abiertos()).toEqual([id]);
    route[consulta] = () => sinRed();
    await tocar(id);
    await refrescar();
    expect(abiertos()).toEqual([]);
  });
});

describe('Resumen: errores que no abren ningún plegado (se ven en una tarjeta de arriba)', () => {
  it('fallan combustible y viajes a la vez: se abren los dos, y nada más', async () => {
    route.combustible = () => sinRed();
    route.viajes = () => sinRed();
    await mount();
    expect(abiertos()).toEqual(['resumen-combustible', 'resumen-viajes']);
  });

  it('un mes nuevo con el combustible roto se abre solo; al pasar a uno que carga bien, todo cerrado y sin aviso', async () => {
    route.combustible = (call) => (argsDe(call).p_desde === '2026-09-01' ? sinRed() : ok([COMBUSTIBLE]));
    await mount();
    expect(abiertos()).toEqual([]);
    await tocarBoton('Mes anterior');
    expect(abiertos()).toEqual(['resumen-combustible']);
    await tocarBoton('Mes siguiente');
    expect(abiertos()).toEqual([]);
    expect(document.querySelector('[data-plegado-fallo]')).toBeNull();
  });

  it('Mes: fallan el resultado y los gastos: no se abre ni avisa ningún plegado', async () => {
    route.gastos = () => sinRed();
    route.mensual = () => sinRed();
    await mount();
    expect(plegados()).toEqual(['resumen-combustible', 'resumen-viajes']);
    expect(abiertos()).toEqual([]);
    expect(document.querySelector('[data-plegado-fallo]')).toBeNull();
    expect(document.querySelectorAll('[role="alert"]')).toHaveLength(2);
  });

  it('Mes: con datos de gastos y un refresco que falla, "Cómo pagaste" y "Gasto por camión" siguen cerrados y el aviso está solo arriba', async () => {
    await mount();
    route.gastos = () => sinRed();
    await refrescar();
    expect(abiertos()).toEqual([]);
    expect(document.querySelector('[data-plegado-fallo]')).toBeNull();
    expect(byId('resumen-gastos')!.querySelector('[role="alert"]')).not.toBeNull();
    expect(byId('resumen-por-metodo')!.querySelector('[role="alert"]')).toBeNull();
    expect(byId('resumen-por-camion')!.querySelector('[role="alert"]')).toBeNull();
  });

  it('Año: si falla la serie del año, "Mes por mes" NO se abre ni avisa en el título; adentro dice dónde está el aviso, sin repetirlo', async () => {
    let falla = true;
    const normal = route.mensual;
    route.mensual = (call) => (falla ? sinRed() : normal(call));
    await mount('/resumen?vista=anio');
    expect(abiertos()).toEqual([]);
    expect(document.querySelector('[data-plegado-fallo]')).toBeNull();
    expect(plano(boton('resumen-mes-por-mes').textContent)).toBe('Mes por mes');
    expect(document.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(byId('resumen-resultado')!.querySelector('[role="alert"]')).not.toBeNull();
    await tocar('resumen-mes-por-mes');
    expect(textos('#resumen-mes-por-mes-contenido > *')).toEqual(['No pudimos cargar los meses. Mira el aviso en «¿Cuánto te quedó?», arriba.']);
    // El "Reintentar" de arriba trae también los meses, y el plegado queda como lo dejó la persona.
    falla = false;
    await click(botonReintentar('resumen-resultado'));
    expect(abiertos()).toEqual(['resumen-mes-por-mes']);
    expect(region('resumen-mes-por-mes').querySelector('#resumen-gasto-por-mes')).not.toBeNull();
  });

  it('Año: si la serie ya estaba y falla el refresco, "Mes por mes" conserva los meses, cerrado y sin aviso propio', async () => {
    await mount('/resumen?vista=anio');
    route.mensual = () => sinRed();
    await refrescar();
    expect(abiertos()).toEqual([]);
    expect(region('resumen-mes-por-mes').querySelector('#resumen-gasto-por-mes')).not.toBeNull();
    expect(region('resumen-mes-por-mes').querySelector('[role="alert"]')).toBeNull();
    expect(byId('resumen-resultado')!.querySelector('[role="alert"]')).not.toBeNull();
  });
});
