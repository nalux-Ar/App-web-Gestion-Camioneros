import { act, useMemo, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Los hooks del Resumen: una query por función de la 014, cada una con su propio estado de carga y de error, con los
// períodos bien armados (mes, comparación, año) y la caché por un minuto. Mock de supabase; TanStack Query es el real.
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
import { resumenKeys } from '@/features/resumen/resumen-keys';
import { ResumenRespuestaInesperadaError, mensajeErrorResumen } from '@/features/resumen/resumen-textos';
import { useResumenDelAnio, useResumenDelMes } from '@/features/resumen/use-resumen';
import type { YearMonth } from '@/lib/dates';
import { queryClient } from '@/lib/query-client';

type Resp = { data: unknown; error: { message: string; code: string } | null; status: number };
const ok = (data: unknown): Resp => ({ data, error: null, status: 200 });
const sinRed = (): Resp => ({ data: null, error: { code: '', message: 'TypeError: Failed to fetch' }, status: 0 });
const MIEMBRO = {
  rol: 'admin',
  tema: 'dark',
  color_acento: '#F59E0B',
  transportista_id: 'tenant-a',
  camion_activo_id: null,
  transportistas: { nombre: 'Transportes A' },
};
const T = 'tenant-a';

const TOTAL = (monto: number) => [{ grupo: 'total', clave: null, nombre: null, activa: null, cantidad: monto > 0 ? 1 : 0, monto }];
function mesVacio(mes: string) {
  return {
    mes,
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
}

type Handler = (call: Call) => unknown;
const route: { gastos: Handler; mensual: Handler; combustible: Handler; viajes: Handler } = {} as never;
const argsDe = (call: Call) => call.ops.find((o) => o.m === 'rpc')!.args[0] as Record<string, unknown>;

function resetRoutes() {
  route.gastos = (call) => ok(TOTAL(argsDe(call).p_desde === '2026-10-01' ? 1000 : 800));
  route.mensual = (call) => {
    const args = argsDe(call);
    const desde = String(args.p_mes_desde);
    const meses = Number(args.p_meses);
    const [y, m] = [Number(desde.slice(0, 4)), Number(desde.slice(5, 7))];
    return ok(
      Array.from({ length: meses }, (_, i) => {
        const indice = y * 12 + (m - 1) + i;
        return mesVacio(`${Math.floor(indice / 12)}-${String((indice % 12) + 1).padStart(2, '0')}-01`);
      }),
    );
  };
  route.combustible = () => ok([]);
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

const probe: { mes: ReturnType<typeof useResumenDelMes> | null; anio: ReturnType<typeof useResumenDelAnio> | null } = { mes: null, anio: null };

function ProbeMes({ mes, hoy }: { mes: YearMonth; hoy: string }) {
  probe.mes = useResumenDelMes(mes, hoy);
  return null;
}
function ProbeAnio({ anio }: { anio: number }) {
  probe.anio = useResumenDelAnio(anio);
  return null;
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

async function mount(children: ReactNode) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <AuthHarness>
          <MemberProvider>
            <RequireMember>{children}</RequireMember>
          </MemberProvider>
        </AuthHarness>
      </QueryClientProvider>,
    );
  });
  await settle();
}

async function unmount() {
  await act(async () => {
    root.unmount();
  });
  container.remove();
}

beforeEach(() => {
  h.calls.length = 0;
  resetRoutes();
  installResponder();
  probe.mes = null;
  probe.anio = null;
  localStorage.clear();
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (container?.isConnected) await unmount();
  queryClient.clear();
  expect(errorSpy.mock.calls.map((c: unknown[]) => String(c[0]))).toEqual([]);
  errorSpy.mockRestore();
});

describe('vista Mes: cada bloque, su llamada', () => {
  it('mes EN CURSO: gasto del mes completo, comparación con los mismos días del anterior, la fila del mes, combustible y viajes', async () => {
    await mount(<ProbeMes mes={{ year: 2026, month: 10 }} hoy="2026-10-13" />);
    const gastos = rpcs('resumen_gastos').map(argsDe);
    expect(gastos).toContainEqual({ p_desde: '2026-10-01', p_hasta: '2026-10-31' });
    expect(gastos).toContainEqual({ p_desde: '2026-09-01', p_hasta: '2026-09-13' });
    expect(gastos).toHaveLength(2);
    expect(rpcs('resumen_mensual').map(argsDe)).toEqual([{ p_mes_desde: '2026-10-01', p_meses: 1 }]);
    expect(rpcs('resumen_combustible').map(argsDe)).toEqual([{ p_desde: '2026-10-01', p_hasta: '2026-10-31' }]);
    expect(rpcs('resumen_viajes').map(argsDe)).toEqual([{ p_desde: '2026-10-01', p_hasta: '2026-10-31' }]);
    const r = probe.mes!;
    expect(r.rangos).toEqual({ mes: { desde: '2026-10-01', hasta: '2026-10-31' }, comparacion: { desde: '2026-09-01', hasta: '2026-09-13' } });
    expect(r.gastos.data!.total.monto).toBe(1000);
    expect(r.comparacion.data!.total.monto).toBe(800);
    expect(r.mensual.data).toHaveLength(1);
    expect(r.combustible.data).toEqual([]);
    expect(r.viajes.data).toEqual({ viajes: [], total: 0, cortada: false });
  });

  it('mes CERRADO: la comparación es el mes anterior completo', async () => {
    await mount(<ProbeMes mes={{ year: 2026, month: 3 }} hoy="2026-10-13" />);
    expect(rpcs('resumen_gastos').map(argsDe)).toContainEqual({ p_desde: '2026-02-01', p_hasta: '2026-02-28' });
    expect(rpcs('resumen_gastos').map(argsDe)).toContainEqual({ p_desde: '2026-03-01', p_hasta: '2026-03-31' });
  });

  it('un bloque que FALLA no tumba a los demás: cada uno con su error y su "Reintentar"', async () => {
    route.combustible = () => sinRed();
    await mount(<ProbeMes mes={{ year: 2026, month: 10 }} hoy="2026-10-13" />);
    const r = probe.mes!;
    expect(r.combustible.isError).toBe(true);
    expect(mensajeErrorResumen(r.combustible.error)).toBe('No hay conexión. Revisa la señal y prueba de nuevo.');
    expect(r.gastos.isSuccess && r.comparacion.isSuccess && r.mensual.isSuccess && r.viajes.isSuccess).toBe(true);
    // Sin reintento automático de un error de red: un solo pedido.
    expect(rpcs('resumen_combustible')).toHaveLength(1);
    // "Reintentar" de ese bloque: vuelve a pedir SOLO ese.
    route.combustible = () => ok([]);
    const antes = h.calls.length;
    await act(async () => {
      await probe.mes!.combustible.refetch();
    });
    await settle();
    expect(h.calls.slice(antes).map((c) => c.target)).toEqual(['rpc:resumen_combustible']);
    expect(probe.mes!.combustible.isSuccess).toBe(true);
  });

  it('una respuesta fuera de contrato es un error de ESE bloque (sin datos a medias)', async () => {
    route.viajes = () => ok([{ viaje_id: 'no-uuid' }]);
    await mount(<ProbeMes mes={{ year: 2026, month: 10 }} hoy="2026-10-13" />);
    expect(probe.mes!.viajes.isError).toBe(true);
    expect(probe.mes!.viajes.data).toBeUndefined();
    expect(probe.mes!.viajes.error).toBeInstanceOf(ResumenRespuestaInesperadaError);
    expect(probe.mes!.gastos.isSuccess).toBe(true);
  });

  it('un 22023 no se reintenta solo', async () => {
    route.gastos = () => ({ data: null, error: { code: '22023', message: 'Período inválido' }, status: 400 });
    await mount(<ProbeMes mes={{ year: 2026, month: 10 }} hoy="2026-10-13" />);
    expect(probe.mes!.gastos.isError).toBe(true);
    await settle(4);
    expect(rpcs('resumen_gastos')).toHaveLength(2); // el mes y la comparación, una vez cada uno
  });

  it('mientras carga, cada bloque está pendiente por su cuenta', async () => {
    route.viajes = () => new Promise(() => {});
    await mount(<ProbeMes mes={{ year: 2026, month: 10 }} hoy="2026-10-13" />);
    expect(probe.mes!.viajes.isPending).toBe(true);
    expect(probe.mes!.gastos.isSuccess).toBe(true);
  });
});

describe('vista Año', () => {
  it('el gasto y el combustible del año entero y la serie de 12 meses; sin lista de viajes', async () => {
    await mount(<ProbeAnio anio={2024} />);
    expect(rpcs('resumen_gastos').map(argsDe)).toEqual([{ p_desde: '2024-01-01', p_hasta: '2024-12-31' }]);
    expect(rpcs('resumen_combustible').map(argsDe)).toEqual([{ p_desde: '2024-01-01', p_hasta: '2024-12-31' }]);
    expect(rpcs('resumen_mensual').map(argsDe)).toEqual([{ p_mes_desde: '2024-01-01', p_meses: 12 }]);
    expect(rpcs('resumen_viajes')).toHaveLength(0);
    expect(probe.anio!.mensual.data!.map((m) => m.mes)).toEqual(Array.from({ length: 12 }, (_, i) => `2024-${String(i + 1).padStart(2, '0')}-01`));
  });
});

describe('caché e invalidación', () => {
  it('la vista Mes de ENERO y la vista Año del mismo año no comparten la serie mensual (mismo mes de inicio, distintos meses)', async () => {
    await mount(<ProbeMes mes={{ year: 2026, month: 1 }} hoy="2026-10-13" />);
    expect(probe.mes!.mensual.data).toHaveLength(1);
    await unmount();
    await mount(<ProbeAnio anio={2026} />);
    expect(probe.anio!.mensual.data).toHaveLength(12);
    expect(probe.anio!.mensual.data!.map((m) => m.mes)).toEqual(
      Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}-01`),
    );
    expect(rpcs('resumen_mensual').map(argsDe)).toEqual([
      { p_mes_desde: '2026-01-01', p_meses: 1 },
      { p_mes_desde: '2026-01-01', p_meses: 12 },
    ]);
  });

  it('volver a la pantalla dentro del minuto no vuelve a pedir; tras invalidar resumen.all, sí', async () => {
    await mount(<ProbeMes mes={{ year: 2026, month: 10 }} hoy="2026-10-13" />);
    const primeros = h.calls.filter((c) => c.target.startsWith('rpc:')).length;
    expect(primeros).toBe(5);
    await unmount();
    await mount(<ProbeMes mes={{ year: 2026, month: 10 }} hoy="2026-10-13" />);
    expect(h.calls.filter((c) => c.target.startsWith('rpc:')).length).toBe(5); // de la caché
    await unmount();
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: resumenKeys.all(T) });
    });
    await mount(<ProbeMes mes={{ year: 2026, month: 10 }} hoy="2026-10-13" />);
    expect(h.calls.filter((c) => c.target.startsWith('rpc:')).length).toBe(10); // las 5 de nuevo
  });

  it('otro mes es otra key: pide lo suyo', async () => {
    await mount(<ProbeMes mes={{ year: 2026, month: 10 }} hoy="2026-10-13" />);
    await unmount();
    await mount(<ProbeMes mes={{ year: 2026, month: 9 }} hoy="2026-10-13" />);
    expect(rpcs('resumen_gastos').map(argsDe)).toContainEqual({ p_desde: '2026-09-01', p_hasta: '2026-09-30' });
    expect(rpcs('resumen_gastos').map(argsDe)).toContainEqual({ p_desde: '2026-08-01', p_hasta: '2026-08-31' });
  });
});
