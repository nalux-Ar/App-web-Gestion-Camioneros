import { act, useMemo, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Los hooks de «Sumar gastos que ya cargué»: la lista de gastos sueltos (query) y las dos mutaciones (sumar y quitar). Mock de
// supabase (un Proxy que anota cada método encadenado); el provider, TanStack Query con su configuración real y los hooks son
// los reales.
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
import { SeleccionDeGastosInvalidaError } from '@/features/gastos/gastos-api';
import { gastosKeys } from '@/features/gastos/gastos-keys';
import { useQuitarGastosDelViaje, useVincularGastos, type QuitarGastosDelViajeVariables, type VincularGastosVariables } from '@/features/gastos/use-gasto-mutations';
import { useGastosSueltos } from '@/features/gastos/use-gastos';
import { resumenKeys } from '@/features/resumen/resumen-keys';
import { DataRequestError, classifyDataError, isRetryableDataError } from '@/lib/data-errors';
import { erroresRecientes, limpiarErroresRecientes } from '@/lib/errores-recientes';
import { queryClient } from '@/lib/query-client';

type Resp = { data: unknown; error: { message: string; code: string; details?: string; hint?: string } | null; status: number };
const ok = (data: unknown): Resp => ({ data, error: null, status: 200 });
const fail = (code: string, message: string, status: number): Resp => ({ data: null, error: { code, message, details: '', hint: '' }, status });
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
const VIAJE = 'b1000000-0000-4000-8000-000000000001';
const FECHA = '2026-06-15';
const G1 = 'e1000000-0000-4000-8000-000000000001';
const G2 = 'e1000000-0000-4000-8000-000000000002';
const G3 = 'e1000000-0000-4000-8000-000000000003';

const ops = (call: Call) => call.ops.map((o) => o.m);
const argsDe = (call: Call) => call.ops.find((o) => o.m === 'rpc')!.args[0] as { p_viaje_id: string; p_gasto_ids: string[] };
const esVincular = (call: Call) => call.target === 'rpc:vincular_gastos_a_viaje';
const esQuitar = (call: Call) => call.target === 'gastos' && ops(call).includes('update');
const esLecturaDeSueltos = (call: Call) => call.target === 'gastos' && ops(call).includes('is');
const idsDelIn = (call: Call) => call.ops.find((o) => o.m === 'in')!.args[1] as string[];

const fila = (id: string, fecha: string) => ({
  id,
  categoria_id: 'a1000000-0000-4000-8000-000000000001',
  fecha,
  monto: 1000,
  descripcion: null,
  litros: null,
  camion_id: null,
  created_at: '2026-11-01T10:00:00+00:00',
});

/** La base «funciona»: el miembro, los sueltos (uno de cada lado de la fecha), y las dos escrituras con lo que piden. */
function responderBien(call: Call): Resp {
  if (call.target === 'miembros') return ok(MIEMBRO);
  if (esVincular(call)) return ok(argsDe(call).p_gasto_ids.map((gasto_id) => ({ gasto_id, resultado: 'vinculado' })));
  if (esQuitar(call)) return ok(idsDelIn(call).map((id) => ({ id })));
  if (esLecturaDeSueltos(call)) return ok(ops(call).includes('gte') ? [fila(G1, '2026-06-16')] : [fila(G2, '2026-06-14')]);
  throw new Error(`pedido inesperado: ${call.target} ${ops(call).join('.')}`);
}

type Deferred = { promise: Promise<Resp>; resolve: (r: Resp) => void };
function deferred(): Deferred {
  let resolve!: (r: Resp) => void;
  const promise = new Promise<Resp>((r) => (resolve = r));
  return { promise, resolve };
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

const probe: {
  vincular: ReturnType<typeof useVincularGastos> | null;
  quitar: ReturnType<typeof useQuitarGastosDelViaje> | null;
  sueltos: ReturnType<typeof useGastosSueltos> | null;
} = { vincular: null, quitar: null, sueltos: null };

function Probe({ viajeId, fecha }: { viajeId: string | null; fecha: string | null }) {
  probe.vincular = useVincularGastos();
  probe.quitar = useQuitarGastosDelViaje();
  probe.sueltos = useGastosSueltos(viajeId, fecha);
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

async function mount(viajeId: string | null = null, fecha: string | null = null) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <AuthHarness>
          <MemberProvider>
            <RequireMember>
              <Probe viajeId={viajeId} fecha={fecha} />
            </RequireMember>
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
  limpiarErroresRecientes();
  h.state.responder = responderBien;
  probe.vincular = null;
  probe.quitar = null;
  probe.sueltos = null;
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

const lecturasDeSueltos = () => h.calls.filter(esLecturaDeSueltos);

describe('useGastosSueltos', () => {
  it('pide los sueltos por la fecha del viaje (dos consultas) y devuelve { items, hayMas }, ordenados por cercanía', async () => {
    await mount(VIAJE, FECHA);
    expect(lecturasDeSueltos()).toHaveLength(2);
    const { data, isSuccess } = probe.sueltos!;
    expect(isSuccess).toBe(true);
    expect(data!.items.map((x) => x.id)).toEqual([G1, G2]); // 1 día después y 1 día antes: a igual distancia, el posterior primero
    expect(data!.hayMas).toBe(false);
  });

  it('no consulta nada mientras falta el id del viaje o su fecha', async () => {
    for (const [viajeId, fecha] of [
      [null, null],
      [VIAJE, null],
      [null, FECHA],
    ] as const) {
      h.calls.length = 0;
      await mount(viajeId, fecha);
      expect(lecturasDeSueltos(), `${viajeId} ${fecha}`).toHaveLength(0);
      expect(probe.sueltos!.fetchStatus).toBe('idle');
      expect(probe.sueltos!.data).toBeUndefined();
      await unmount();
      queryClient.clear();
    }
  });

  it('la key lleva el tenant, el viaje y la fecha, y cuelga de `gastosKeys.all`: invalidar `all` la vuelve a pedir', async () => {
    await mount(VIAJE, FECHA);
    const queries = queryClient.getQueryCache().findAll({ queryKey: gastosKeys.all(T) });
    expect(queries.map((q) => JSON.stringify(q.queryKey))).toContain(JSON.stringify(gastosKeys.sueltos(T, VIAJE, FECHA)));
    expect(gastosKeys.sueltos(T, VIAJE, FECHA)).toEqual(['tenant', T, 'gastos', 'sueltos', VIAJE, FECHA]);
    expect(lecturasDeSueltos()).toHaveLength(2);
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: gastosKeys.all(T) });
    });
    await settle();
    expect(lecturasDeSueltos()).toHaveLength(4);
  });

  it('otra fecha del viaje es otra key: no se mezclan', () => {
    expect(JSON.stringify(gastosKeys.sueltos(T, VIAJE, '2026-06-15'))).not.toBe(JSON.stringify(gastosKeys.sueltos(T, VIAJE, '2026-06-16')));
    expect(JSON.stringify(gastosKeys.sueltos(T, VIAJE, FECHA))).not.toBe(JSON.stringify(gastosKeys.sueltos('tenant-b', VIAJE, FECHA)));
  });

  it('sin caché: al salir de la pantalla la lista se descarta (al volver se pide de nuevo)', async () => {
    await mount(VIAJE, FECHA);
    await unmount();
    await settle(2);
    expect(queryClient.getQueryCache().find({ queryKey: gastosKeys.sueltos(T, VIAJE, FECHA) })).toBeUndefined();
  });

  it('si la lectura falla (sin señal) queda como ERROR (no como un éxito vacío), sin reintento automático', async () => {
    h.state.responder = (call) => (esLecturaDeSueltos(call) ? sinRed() : responderBien(call));
    await mount(VIAJE, FECHA);
    const { isError, data, error } = probe.sueltos!;
    expect(isError).toBe(true);
    expect(data).toBeUndefined();
    expect(error).toBeInstanceOf(DataRequestError);
    expect(classifyDataError(error)).toBe('network');
    await settle(6);
    expect(lecturasDeSueltos()).toHaveLength(2); // una por lado, una sola vez
  });

  it('si UNA de las dos consultas falla, la lista no se muestra a medias', async () => {
    h.state.responder = (call) => (esLecturaDeSueltos(call) && ops(call).includes('lt') ? sinRed() : responderBien(call));
    await mount(VIAJE, FECHA);
    expect(probe.sueltos!.isError).toBe(true);
    expect(probe.sueltos!.data).toBeUndefined();
  });

  it('una fecha de viaje inválida da error sin pedir nada', async () => {
    await mount(VIAJE, '2026-02-30');
    expect(probe.sueltos!.isError).toBe(true);
    expect(probe.sueltos!.error).toBeInstanceOf(RangeError);
    expect(lecturasDeSueltos()).toHaveLength(0);
  });
});

describe('useVincularGastos y useQuitarGastosDelViaje', () => {
  let invalidadas: unknown[][] = [];
  let invalidateSpy: ReturnType<typeof vi.spyOn>;
  const veces = (clave: unknown) => invalidadas.filter((k) => JSON.stringify(k) === JSON.stringify(clave)).length;

  beforeEach(() => {
    invalidadas = [];
    invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockImplementation(((filters?: { queryKey?: unknown[] }) => {
      if (filters?.queryKey) invalidadas.push(filters.queryKey);
      return Promise.resolve();
    }) as never);
  });

  afterEach(() => {
    invalidateSpy.mockRestore();
  });

  const sumar = (over: Partial<VincularGastosVariables> = {}): VincularGastosVariables => ({ tenantId: T, viajeId: VIAJE, gastoIds: [G1, G2], ...over });
  const quitar = (over: Partial<QuitarGastosDelViajeVariables> = {}): QuitarGastosDelViajeVariables => ({ tenantId: T, viajeId: VIAJE, gastoIds: [G1, G2], ...over });

  /** Corre la mutación y devuelve el error (o null si salió bien) una vez asentada. */
  async function correr(fn: () => Promise<unknown>): Promise<unknown> {
    let error: unknown = null;
    await act(async () => {
      try {
        await fn();
      } catch (e) {
        error = e;
      }
    });
    await settle(2);
    return error;
  }

  describe('sumar', () => {
    it('devuelve qué pasó con cada gasto (ya leído) e invalida los gastos y el Resumen del tenant de las variables', async () => {
      await mount();
      let resultado: unknown;
      const error = await correr(async () => {
        resultado = await probe.vincular!.mutateAsync(sumar());
      });
      expect(error).toBeNull();
      expect(resultado).toEqual([
        { gastoId: G1, resultado: 'vinculado' },
        { gastoId: G2, resultado: 'vinculado' },
      ]);
      expect(veces(gastosKeys.all(T))).toBe(1);
      expect(veces(resumenKeys.all(T))).toBe(1);
      expect(h.calls.filter(esVincular)).toHaveLength(1);
      expect(argsDe(h.calls.find(esVincular)!)).toEqual({ p_viaje_id: VIAJE, p_gasto_ids: [G1, G2] });
    });

    it('que algunos gastos NO se sumen no es un error de la mutación: es parte del resultado (y también refresca)', async () => {
      await mount();
      h.state.responder = (call) =>
        esVincular(call)
          ? ok([
              { gasto_id: G1, resultado: 'en_otro_viaje' },
              { gasto_id: G2, resultado: 'camion_distinto' },
              { gasto_id: G3, resultado: 'no_encontrado' },
            ])
          : responderBien(call);
      let resultado: unknown;
      const error = await correr(async () => {
        resultado = await probe.vincular!.mutateAsync(sumar({ gastoIds: [G1, G2, G3] }));
      });
      expect(error).toBeNull();
      expect((resultado as Array<{ resultado: string }>).map((r) => r.resultado)).toEqual(['en_otro_viaje', 'camion_distinto', 'no_encontrado']);
      expect(veces(gastosKeys.all(T))).toBe(1);
    });

    it('si falla (sin señal): propaga el error reintentable e invalida los gastos Y el Resumen del tenant de las variables (la escritura pudo aplicarse y la lista a la vista quedaría vieja)', async () => {
      await mount();
      h.state.responder = (call) => (esVincular(call) ? sinRed() : responderBien(call));
      const error = await correr(() => probe.vincular!.mutateAsync(sumar({ tenantId: 'tenant-b' })));
      expect(error).toBeInstanceOf(DataRequestError);
      expect(classifyDataError(error)).toBe('network');
      expect(isRetryableDataError(error)).toBe(true);
      expect(veces(gastosKeys.all('tenant-b'))).toBe(1);
      expect(veces(resumenKeys.all('tenant-b'))).toBe(1);
      expect(veces(gastosKeys.all(T))).toBe(0); // el del miembro montado no es el de las variables
      expect(veces(resumenKeys.all(T))).toBe(0);
    });

    it('sin reintento automático: un error de red es UN solo pedido, aunque pase el tiempo', async () => {
      await mount();
      h.state.responder = (call) => (esVincular(call) ? sinRed() : responderBien(call));
      await correr(() => probe.vincular!.mutateAsync(sumar()));
      await settle(10);
      expect(h.calls.filter(esVincular)).toHaveLength(1);
    });

    it('no configura su propio reintento ni modo de red: usa los de la app (retry 0, networkMode "always")', async () => {
      await mount();
      await correr(() => probe.vincular!.mutateAsync(sumar()));
      await correr(() => probe.quitar!.mutateAsync(quitar()));
      const mutaciones = queryClient.getMutationCache().getAll();
      expect(mutaciones.length).toBeGreaterThanOrEqual(2);
      for (const mutacion of mutaciones) {
        expect(mutacion.options.retry).toBe(0);
        expect(mutacion.options.networkMode).toBe('always');
        expect(mutacion.options.retryDelay).toBeUndefined();
      }
    });

    it('reintentar a mano manda la MISMA selección y es seguro: lo que ya se sumó vuelve como «ya_estaba»', async () => {
      await mount();
      let intento = 0;
      h.state.responder = (call) => {
        if (!esVincular(call)) return responderBien(call);
        intento += 1;
        return intento === 1 ? sinRed() : ok(argsDe(call).p_gasto_ids.map((gasto_id) => ({ gasto_id, resultado: 'ya_estaba' })));
      };
      const variables = sumar();
      expect(await correr(() => probe.vincular!.mutateAsync(variables))).toBeInstanceOf(DataRequestError);
      let resultado: unknown;
      expect(
        await correr(async () => {
          resultado = await probe.vincular!.mutateAsync(variables);
        }),
      ).toBeNull();
      const enviados = h.calls.filter(esVincular).map((c) => argsDe(c).p_gasto_ids);
      expect(enviados).toEqual([[G1, G2], [G1, G2]]);
      expect((resultado as Array<{ resultado: string }>).every((r) => r.resultado === 'ya_estaba')).toBe(true);
    });

    it('cuenta en solo lectura (PT402, HTTP 402): error de clase «payment», sin «Reintentar»', async () => {
      await mount();
      h.state.responder = (call) => (esVincular(call) ? fail('PT402', 'texto_fijo_de_prueba', 402) : responderBien(call));
      const error = await correr(() => probe.vincular!.mutateAsync(sumar()));
      expect(classifyDataError(error)).toBe('payment');
      expect(isRetryableDataError(error)).toBe(false);
      expect(veces(gastosKeys.all(T))).toBe(1); // también refresca si falla (onSettled): no se distingue por la clase del error
      expect(veces(resumenKeys.all(T))).toBe(1);
    });

    it('un error de sumar o de quitar queda anotado para «Reportar un problema» con su clase y la operación «vincular-gastos» (el id del scope), sin ids ni textos', async () => {
      await mount();
      h.state.responder = (call) => (esVincular(call) || esQuitar(call) ? fail('PT402', 'texto_fijo_de_prueba', 402) : responderBien(call));
      await correr(() => probe.vincular!.mutateAsync(sumar()));
      await correr(() => probe.quitar!.mutateAsync(quitar()));
      const anotados = erroresRecientes(5);
      expect(anotados.map(({ tipo, sqlstate, operacion }) => ({ tipo, sqlstate, operacion }))).toEqual([
        { tipo: 'payment', sqlstate: 'PT402', operacion: 'vincular-gastos' },
        { tipo: 'payment', sqlstate: 'PT402', operacion: 'vincular-gastos' },
      ]);
      expect(JSON.stringify(anotados)).not.toMatch(/texto_fijo|e1000000|b1000000/);
    });

    it('el viaje ya no existe (P0002, HTTP 500): «no encontrado», sin «Reintentar»', async () => {
      await mount();
      h.state.responder = (call) => (esVincular(call) ? fail('P0002', 'No se encontró el viaje', 500) : responderBien(call));
      const error = await correr(() => probe.vincular!.mutateAsync(sumar()));
      expect(classifyDataError(error)).toBe('not-found');
      expect(isRetryableDataError(error)).toBe(false);
      await settle(10);
      expect(h.calls.filter(esVincular)).toHaveLength(1);
    });

    it('una selección que no se puede mandar (vacía) falla SIN tocar la red, con un error que no se reintenta', async () => {
      await mount();
      const error = await correr(() => probe.vincular!.mutateAsync(sumar({ gastoIds: [] })));
      expect(error).toBeInstanceOf(SeleccionDeGastosInvalidaError);
      expect(isRetryableDataError(error)).toBe(false);
      expect(h.calls.filter(esVincular)).toHaveLength(0);
      expect(veces(gastosKeys.all(T))).toBe(1); // también refresca si falla (onSettled), aunque no haya salido ningún pedido
    });

    it('invalida el tenant de las VARIABLES (el de cuando se tocó «Sumar»), no el de otro', async () => {
      await mount();
      await correr(() => probe.vincular!.mutateAsync(sumar({ tenantId: 'tenant-b' })));
      expect(veces(gastosKeys.all('tenant-b'))).toBe(1);
      expect(veces(resumenKeys.all('tenant-b'))).toBe(1);
      expect(veces(gastosKeys.all(T))).toBe(0);
      expect(veces(resumenKeys.all(T))).toBe(0);
    });
  });

  describe('quitar', () => {
    it('devuelve los ids que REALMENTE se quitaron e invalida los gastos y el Resumen', async () => {
      await mount();
      h.state.responder = (call) => (esQuitar(call) ? ok([{ id: G2 }]) : responderBien(call));
      let quitados: unknown;
      const error = await correr(async () => {
        quitados = await probe.quitar!.mutateAsync(quitar());
      });
      expect(error).toBeNull();
      expect(quitados).toEqual([G2]);
      expect(veces(gastosKeys.all(T))).toBe(1);
      expect(veces(resumenKeys.all(T))).toBe(1);
      const update = h.calls.find(esQuitar)!;
      expect(update.ops.find((o) => o.m === 'update')!.args[0]).toEqual({ viaje_id: null });
      expect(update.ops.find((o) => o.m === 'eq')!.args).toEqual(['viaje_id', VIAJE]);
      expect(idsDelIn(update)).toEqual([G1, G2]);
    });

    it('0 filas (ya los habían quitado) no es un error y también refresca', async () => {
      await mount();
      h.state.responder = (call) => (esQuitar(call) ? ok([]) : responderBien(call));
      let quitados: unknown;
      const error = await correr(async () => {
        quitados = await probe.quitar!.mutateAsync(quitar());
      });
      expect(error).toBeNull();
      expect(quitados).toEqual([]);
      expect(veces(gastosKeys.all(T))).toBe(1);
    });

    it('si falla (sin señal): propaga el error e invalida los gastos Y el Resumen del tenant de las variables, y no se reintenta solo', async () => {
      await mount();
      h.state.responder = (call) => (esQuitar(call) ? sinRed() : responderBien(call));
      const error = await correr(() => probe.quitar!.mutateAsync(quitar({ tenantId: 'tenant-b' })));
      expect(classifyDataError(error)).toBe('network');
      await settle(10);
      expect(h.calls.filter(esQuitar)).toHaveLength(1);
      expect(veces(gastosKeys.all('tenant-b'))).toBe(1);
      expect(veces(resumenKeys.all('tenant-b'))).toBe(1);
      expect(veces(gastosKeys.all(T))).toBe(0); // el del miembro montado no es el de las variables
      expect(veces(resumenKeys.all(T))).toBe(0);
    });

    it('cuenta en solo lectura (PT402): clase «payment», sin «Reintentar»', async () => {
      await mount();
      h.state.responder = (call) => (esQuitar(call) ? fail('PT402', 'texto_fijo_de_prueba', 402) : responderBien(call));
      const error = await correr(() => probe.quitar!.mutateAsync(quitar()));
      expect(classifyDataError(error)).toBe('payment');
      expect(isRetryableDataError(error)).toBe(false);
    });

    it('una selección vacía falla sin tocar la red', async () => {
      await mount();
      const error = await correr(() => probe.quitar!.mutateAsync(quitar({ gastoIds: [] })));
      expect(error).toBeInstanceOf(SeleccionDeGastosInvalidaError);
      expect(h.calls.filter(esQuitar)).toHaveLength(0);
    });
  });

  it('no ESPERA el refresco de la lista (`void`): la mutación termina, con éxito o con error, aunque la invalidación no termine nunca', async () => {
    await mount();
    invalidateSpy.mockImplementation(((filters?: { queryKey?: unknown[] }) => {
      if (filters?.queryKey) invalidadas.push(filters.queryKey);
      return new Promise<void>(() => {});
    }) as never);
    expect(await correr(() => probe.vincular!.mutateAsync(sumar()))).toBeNull();
    expect(await correr(() => probe.quitar!.mutateAsync(quitar()))).toBeNull();
    h.state.responder = (call) => (esVincular(call) || esQuitar(call) ? sinRed() : responderBien(call));
    expect(await correr(() => probe.vincular!.mutateAsync(sumar()))).toBeInstanceOf(DataRequestError);
    expect(await correr(() => probe.quitar!.mutateAsync(quitar()))).toBeInstanceOf(DataRequestError);
    expect(veces(gastosKeys.all(T))).toBe(4); // y las cuatro veces se pidió
  });

  describe('sumar y quitar corren de a UNO, en el orden en que se pidieron (scope compartido)', () => {
    it('un «Quitar» pedido mientras un «Sumar» sigue en camino ESPERA a que termine: no llega a la base antes', async () => {
      await mount();
      const enCamino = deferred();
      h.state.responder = (call) => (esVincular(call) ? enCamino.promise : responderBien(call));
      let sumando!: Promise<unknown>;
      let quitando!: Promise<unknown>;
      await act(async () => {
        sumando = probe.vincular!.mutateAsync(sumar());
      });
      await settle();
      await act(async () => {
        quitando = probe.quitar!.mutateAsync(quitar());
      });
      await settle(5);
      expect(h.calls.filter(esVincular)).toHaveLength(1);
      expect(h.calls.filter(esQuitar)).toHaveLength(0); // el quitar espera
      await act(async () => {
        enCamino.resolve(ok([{ gasto_id: G1, resultado: 'vinculado' }, { gasto_id: G2, resultado: 'vinculado' }]));
        await sumando;
        await quitando;
      });
      await settle();
      expect(h.calls.filter((c) => esVincular(c) || esQuitar(c)).map((c) => c.target + (esQuitar(c) ? '.update' : ''))).toEqual([
        'rpc:vincular_gastos_a_viaje',
        'gastos.update',
      ]);
    });

    it('si el «Sumar» que va primero falla, el «Quitar» que esperaba igual corre', async () => {
      await mount();
      const enCamino = deferred();
      h.state.responder = (call) => (esVincular(call) ? enCamino.promise : responderBien(call));
      let sumando!: Promise<unknown>;
      let quitando!: Promise<unknown>;
      await act(async () => {
        sumando = probe.vincular!.mutateAsync(sumar()).catch((e: unknown) => e);
      });
      await settle();
      await act(async () => {
        quitando = probe.quitar!.mutateAsync(quitar());
      });
      await settle(3);
      expect(h.calls.filter(esQuitar)).toHaveLength(0);
      await act(async () => {
        enCamino.resolve(sinRed());
        await sumando;
        await quitando;
      });
      await settle();
      expect(h.calls.filter(esQuitar)).toHaveLength(1);
    });
  });
});
