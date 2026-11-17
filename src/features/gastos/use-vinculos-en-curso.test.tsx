import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MutationObserver, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `useVinculosEnCurso`: ¿hay un «Sumar» o un «Quitar» en curso o en cola, venga de donde venga? Se prueba con los hooks REALES de
// sumar y de quitar (`useVincularGastos`, `useQuitarGastosDelViaje`) y la configuración real de TanStack Query: así, si alguno
// dejara de usar el scope compartido (`SCOPE_DE_VINCULOS`, que vive en `use-gasto-mutations.ts` y que `use-vinculos-en-curso.ts`
// importa: el id no está repetido en ningún lado), esta prueba falla. Mock de supabase: un Proxy que anota cada método encadenado.
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

import {
  SCOPE_DE_VINCULOS,
  useQuitarGastosDelViaje,
  useVincularGastos,
  type QuitarGastosDelViajeVariables,
  type VincularGastosVariables,
} from '@/features/gastos/use-gasto-mutations';
import { useVinculosEnCurso } from '@/features/gastos/use-vinculos-en-curso';
import { limpiarErroresRecientes } from '@/lib/errores-recientes';
import { queryClient } from '@/lib/query-client';

type Resp = { data: unknown; error: { message: string; code: string; details?: string; hint?: string } | null; status: number };
const ok = (data: unknown): Resp => ({ data, error: null, status: 200 });
const sinRed = (): Resp => ({ data: null, error: { code: '', message: 'TypeError: Failed to fetch' }, status: 0 });

const T = 'tenant-a';
const VIAJE = 'b1000000-0000-4000-8000-000000000001';
const G1 = 'e1000000-0000-4000-8000-000000000001';
const G2 = 'e1000000-0000-4000-8000-000000000002';

const esVincular = (call: Call) => call.target === 'rpc:vincular_gastos_a_viaje';
const esQuitar = (call: Call) => call.target === 'gastos' && call.ops.some((o) => o.m === 'update');

type Deferred = { promise: Promise<Resp>; resolve: (r: Resp) => void };
function deferred(): Deferred {
  let resolve!: (r: Resp) => void;
  const promise = new Promise<Resp>((r) => (resolve = r));
  return { promise, resolve };
}

const variablesDeSumar = (): VincularGastosVariables => ({ tenantId: T, viajeId: VIAJE, gastoIds: [G1, G2] });
const variablesDeQuitar = (): QuitarGastosDelViajeVariables => ({ tenantId: T, viajeId: VIAJE, gastoIds: [G1, G2] });
const sumandoOk = () =>
  ok([
    { gasto_id: G1, resultado: 'vinculado' },
    { gasto_id: G2, resultado: 'vinculado' },
  ]);
const quitandoOk = () => ok([{ id: G1 }, { id: G2 }]);

/** Lo que lee la prueba de lo que el hook devolvió en el último dibujo. */
const probe: {
  vincular: ReturnType<typeof useVincularGastos> | null;
  quitar: ReturnType<typeof useQuitarGastosDelViaje> | null;
  enCurso: boolean | null;
} = { vincular: null, quitar: null, enCurso: null };

function Probe() {
  probe.vincular = useVincularGastos();
  probe.quitar = useQuitarGastosDelViaje();
  probe.enCurso = useVinculosEnCurso();
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

function Arbol({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

async function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <Arbol>
        <Probe />
      </Arbol>,
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
  h.state.responder = (call) => {
    if (esVincular(call)) return sumandoOk();
    if (esQuitar(call)) return quitandoOk();
    throw new Error(`pedido inesperado: ${call.target}`);
  };
  limpiarErroresRecientes();
  probe.vincular = null;
  probe.quitar = null;
  probe.enCurso = null;
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

describe('useVinculosEnCurso: ¿hay un «Sumar» o un «Quitar» en curso o en cola, venga de donde venga?', () => {
  it('sin ninguna mutación: false', async () => {
    await mount();
    expect(probe.enCurso).toBe(false);
  });

  it('true mientras un «Sumar» está en vuelo y false cuando termina bien', async () => {
    await mount();
    const enCamino = deferred();
    h.state.responder = (call) => (esVincular(call) ? enCamino.promise : quitandoOk());
    let sumando!: Promise<unknown>;
    await act(async () => {
      sumando = probe.vincular!.mutateAsync(variablesDeSumar());
    });
    await settle(3);
    expect(probe.enCurso).toBe(true);
    await act(async () => {
      enCamino.resolve(sumandoOk());
      await sumando;
    });
    await settle(3);
    expect(probe.enCurso).toBe(false);
  });

  it('también cuenta un «Quitar» (comparte el scope con «Sumar»)', async () => {
    await mount();
    const enCamino = deferred();
    h.state.responder = (call) => (esQuitar(call) ? enCamino.promise : sumandoOk());
    let quitando!: Promise<unknown>;
    await act(async () => {
      quitando = probe.quitar!.mutateAsync(variablesDeQuitar());
    });
    await settle(3);
    expect(probe.enCurso).toBe(true);
    await act(async () => {
      enCamino.resolve(quitandoOk());
      await quitando;
    });
    await settle(3);
    expect(probe.enCurso).toBe(false);
  });

  it('una mutación EN COLA (esperando su turno detrás de otra) cuenta: sigue en true hasta que terminan las dos', async () => {
    await mount();
    const primera = deferred();
    const segunda = deferred();
    let salioElQuitar = 0;
    h.state.responder = (call) => {
      if (esVincular(call)) return primera.promise;
      salioElQuitar += 1;
      return segunda.promise;
    };
    let sumando!: Promise<unknown>;
    let quitando!: Promise<unknown>;
    await act(async () => {
      sumando = probe.vincular!.mutateAsync(variablesDeSumar());
    });
    await settle(3);
    await act(async () => {
      quitando = probe.quitar!.mutateAsync(variablesDeQuitar());
    });
    await settle(3);
    expect(salioElQuitar).toBe(0); // la segunda espera su turno: todavía no salió
    expect(probe.quitar!.isPending).toBe(true); // y para TanStack ya está «pendiente»
    expect(probe.enCurso).toBe(true);

    await act(async () => {
      primera.resolve(sumandoOk());
      await sumando;
    });
    await settle(4);
    expect(salioElQuitar).toBe(1); // ahora corre la segunda
    expect(probe.enCurso).toBe(true); // y mientras corre sigue contando

    await act(async () => {
      segunda.resolve(quitandoOk());
      await quitando;
    });
    await settle(3);
    expect(probe.enCurso).toBe(false);
  });

  it('cuenta una mutación que lanzó OTRO montaje (la pantalla se cerró y se volvió a abrir con el pedido todavía en vuelo)', async () => {
    await mount();
    const enCamino = deferred();
    h.state.responder = (call) => (esVincular(call) ? enCamino.promise : quitandoOk());
    let sumando!: Promise<unknown>;
    await act(async () => {
      sumando = probe.vincular!.mutateAsync(variablesDeSumar());
    });
    await settle(3);
    await unmount();
    probe.enCurso = null;
    await mount(); // un montaje nuevo: su `useVincularGastos` no conoce esa mutación, pero el scope sí
    expect(probe.vincular!.isPending).toBe(false);
    expect(probe.enCurso).toBe(true);
    await act(async () => {
      enCamino.resolve(sumandoOk());
      await sumando;
    });
    await settle(3);
    expect(probe.enCurso).toBe(false);
  });

  it('si el «Sumar» falla, vuelve a false (un error no deja la pantalla bloqueada para siempre)', async () => {
    await mount();
    h.state.responder = (call) => (esVincular(call) ? sinRed() : quitandoOk());
    await act(async () => {
      await probe.vincular!.mutateAsync(variablesDeSumar()).catch(() => undefined);
    });
    await settle(3);
    expect(probe.enCurso).toBe(false);
  });

  it('si el «Quitar» falla, también vuelve a false', async () => {
    await mount();
    h.state.responder = (call) => (esQuitar(call) ? sinRed() : sumandoOk());
    await act(async () => {
      await probe.quitar!.mutateAsync(variablesDeQuitar()).catch(() => undefined);
    });
    await settle(3);
    expect(probe.enCurso).toBe(false);
  });

  it('NO cuenta las mutaciones de otros scopes (guardar un gasto, un viaje…): solo sumar y quitar', async () => {
    await mount();
    const ajena = new MutationObserver(queryClient, { mutationFn: () => new Promise<void>(() => {}), scope: { id: 'otra-cosa' } });
    const sinScope = new MutationObserver(queryClient, { mutationFn: () => new Promise<void>(() => {}) });
    await act(async () => {
      void ajena.mutate(undefined).catch(() => undefined);
      void sinScope.mutate(undefined).catch(() => undefined);
    });
    await settle(3);
    expect(queryClient.getMutationCache().getAll().filter((m) => m.state.status === 'pending')).toHaveLength(2);
    expect(probe.enCurso).toBe(false);
  });

  it('los hooks REALES de sumar y de quitar usan el scope compartido que el hook mira (si alguno usara otro, esto falla)', async () => {
    await mount();
    await act(async () => {
      await probe.vincular!.mutateAsync(variablesDeSumar());
      await probe.quitar!.mutateAsync(variablesDeQuitar());
    });
    const scopes = queryClient.getMutationCache().getAll().map((m) => m.options.scope?.id);
    expect(scopes).toEqual([SCOPE_DE_VINCULOS.id, SCOPE_DE_VINCULOS.id]);
    // Y su id es el que el registro de errores anota como «operación» (ver `sumar-gastos-hooks.test.tsx`): no cambia sin darse cuenta.
    expect(SCOPE_DE_VINCULOS.id).toBe('vincular-gastos');
  });
});
