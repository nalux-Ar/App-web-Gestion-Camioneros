import { act, useMemo, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// La mutación del camión activo (Etapa 5c): UPDATE de la fila PROPIA de `miembros` con SOLO `camion_activo_id`, guardado
// pesimista (el miembro cambia cuando la base confirma), errores con mensaje propio y sin reintento automático. Mock de
// supabase; el provider, TanStack Query y la mutación son los reales.
type Op = { m: string; args: unknown[] };
type Call = { table: string; ops: Op[] };
type Resp = { data: unknown; error: { message: string; code: string; details?: string; hint?: string } | null; status: number };

const h = vi.hoisted(() => {
  const calls: Array<{ table: string; ops: Array<{ m: string; args: unknown[] }> }> = [];
  const state = { responder: null as null | ((call: { table: string; ops: Array<{ m: string; args: unknown[] }> }) => unknown) };
  function from(table: string) {
    const call = { table, ops: [] as Array<{ m: string; args: unknown[] }> };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {};
    for (const m of ['select', 'update', 'insert', 'delete', 'eq', 'abortSignal', 'maybeSingle']) {
      builder[m] = (...args: unknown[]) => {
        call.ops.push({ m, args });
        return builder;
      };
    }
    builder.then = (onF: (v: unknown) => unknown, onR: (e: unknown) => unknown) => {
      calls.push(call);
      return Promise.resolve()
        .then(() => state.responder?.(call))
        .then(onF, onR);
    };
    return builder;
  }
  return { calls, state, from };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from: h.from } }));

import { AuthContext, type AuthContextValue } from '@/features/auth/auth-context';
import type { MemberInfo } from '@/features/member/member-context';
import { MemberProvider } from '@/features/member/member-provider';
import { useMember } from '@/features/member/use-member';
import { camionesKeys } from '@/features/camiones/camiones-keys';
import {
  CAMBIAR_CAMION_ACTIVO_CONTEXT,
  CAMION_ACTIVO_NO_GUARDADO_MESSAGE,
  CAMION_ARCHIVADO_MESSAGE,
  CAMION_ELEGIDO_NO_EXISTE_MESSAGE,
} from '@/features/camiones/constants';
import { useCambiarCamionActivo, type CambiarCamionActivoVariables } from '@/features/camiones/use-cambiar-camion-activo';
import { RecordNotFoundError, isRetryableDataError, mapDataError } from '@/lib/data-errors';
import { queryClient } from '@/lib/query-client';

const ok = (data: unknown): Resp => ({ data, error: null, status: 200 });
const fail = (code: string, message: string, status = 400): Resp => ({ data: null, error: { code, message, details: '', hint: '' }, status });
const sinRed = (): Resp => ({ data: null, error: { code: '', message: 'TypeError: Failed to fetch' }, status: 0 });

const C1 = 'c0000000-0000-4000-8000-000000000001';
const C2 = 'c0000000-0000-4000-8000-000000000002';
const C3 = 'c0000000-0000-4000-8000-000000000003';

const db: { users: Record<string, { tenantId: string; camionActivo: string | null }> } = { users: {} };
let onUpdate: (call: Call) => unknown = () => ok([]);

function installResponder() {
  h.state.responder = (call) => {
    if (call.table === 'miembros' && call.ops.some((o) => o.m === 'maybeSingle')) {
      const userId = call.ops.find((o) => o.m === 'eq')!.args[1] as string;
      const u = db.users[userId];
      if (!u) return ok(null);
      return ok({
        rol: 'admin',
        tema: 'dark',
        color_acento: '#F59E0B',
        transportista_id: u.tenantId,
        camion_activo_id: u.camionActivo,
        transportistas: { nombre: `Cuenta ${u.tenantId}` },
      });
    }
    if (call.table === 'miembros' && call.ops.some((o) => o.m === 'update')) return onUpdate(call);
    throw new Error(`pedido inesperado: ${call.table} ${call.ops.map((o) => o.m).join('.')}`);
  };
}

/** La base de verdad: guarda lo mandado en la fila del usuario filtrado y devuelve la fila. */
function guardarEnDb(call: Call): Resp {
  const userId = call.ops.find((o) => o.m === 'eq')!.args[1] as string;
  const payload = call.ops.find((o) => o.m === 'update')!.args[0] as { camion_activo_id: string | null };
  const u = db.users[userId];
  if (!u) return ok([]);
  u.camionActivo = payload.camion_activo_id;
  return ok([{ camion_activo_id: payload.camion_activo_id }]);
}

type Deferred = { promise: Promise<Resp>; resolve: (r: Resp) => void };
function deferred(): Deferred {
  let resolve!: (r: Resp) => void;
  const promise = new Promise<Resp>((r) => (resolve = r));
  return { promise, resolve };
}

const probe: {
  mutation: ReturnType<typeof useCambiarCamionActivo> | null;
  member: MemberInfo | null;
} = { mutation: null, member: null };
const ctl: { setUser: (id: string | null) => void } = { setUser: () => {} };

function Probe() {
  probe.mutation = useCambiarCamionActivo();
  probe.member = useMember().member;
  return null;
}

function AuthHarness({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState<string | null>('user-a');
  ctl.setUser = setUserId;
  const value = useMemo<AuthContextValue>(
    () => ({
      session: userId ? ({ access_token: 't' } as never) : null,
      user: userId ? ({ id: userId, email: `${userId}@correo.test` } as never) : null,
      status: 'ready',
      signOut: async () => ({ ok: true }),
    }),
    [userId],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

let root: Root;
let container: HTMLElement;
let errorSpy: ReturnType<typeof vi.spyOn>;

async function settle(times = 5) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function mount() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <AuthHarness>
          <MemberProvider>
            <Probe />
          </MemberProvider>
        </AuthHarness>
      </QueryClientProvider>,
    );
  });
  await settle();
}

const vars = (camionId: string | null, over: Partial<CambiarCamionActivoVariables> = {}): CambiarCamionActivoVariables => ({
  tenantId: 'tenant-a',
  userId: 'user-a',
  camionId,
  ...over,
});

/** Corre la mutación y devuelve el error (o null si salió bien). */
async function cambiar(variables: CambiarCamionActivoVariables): Promise<unknown> {
  let error: unknown = null;
  await act(async () => {
    try {
      await probe.mutation!.mutateAsync(variables);
    } catch (failure) {
      error = failure;
    }
  });
  await settle(2);
  return error;
}

const updates = () => h.calls.filter((c) => c.table === 'miembros' && c.ops.some((o) => o.m === 'update'));
const payload = (i = 0) => updates()[i]!.ops.find((o) => o.m === 'update')!.args[0];

let invalidadas: unknown[][] = [];
let invalidateSpy: ReturnType<typeof vi.spyOn>;
const invalidoCamiones = () => invalidadas.some((k) => JSON.stringify(k) === JSON.stringify(camionesKeys.list('tenant-a')));

beforeEach(() => {
  h.calls.length = 0;
  db.users = {
    'user-a': { tenantId: 'tenant-a', camionActivo: C1 },
    'user-b': { tenantId: 'tenant-b', camionActivo: null },
  };
  onUpdate = guardarEnDb;
  installResponder();
  probe.mutation = null;
  probe.member = null;
  localStorage.clear();
  invalidadas = [];
  invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockImplementation(((filters?: { queryKey?: unknown[] }) => {
    if (filters?.queryKey) invalidadas.push(filters.queryKey);
    return Promise.resolve();
  }) as never);
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
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

describe('useCambiarCamionActivo: lo que se manda', () => {
  it('UPDATE de miembros con SOLO camion_activo_id, filtrado por user_id, pidiendo la fila de vuelta y con timeout', async () => {
    await mount();
    expect(await cambiar(vars(C2))).toBeNull();
    expect(updates()).toHaveLength(1);
    const call = updates()[0]!;
    expect(call.ops.map((o) => o.m)).toEqual(['update', 'eq', 'select', 'abortSignal']);
    expect(payload()).toEqual({ camion_activo_id: C2 }); // nunca transportista_id, rol, user_id, tema…
    expect(call.ops.find((o) => o.m === 'eq')!.args).toEqual(['user_id', 'user-a']);
    expect(call.ops.find((o) => o.m === 'select')!.args).toEqual(['camion_activo_id']);
    expect(call.ops.find((o) => o.m === 'abortSignal')!.args[0]).toBeInstanceOf(AbortSignal);
  });

  it('quitarlo manda null', async () => {
    await mount();
    await cambiar(vars(null));
    expect(payload()).toEqual({ camion_activo_id: null });
    expect(probe.member!.camionActivoId).toBeNull();
  });

  it('el filtro es el usuario de las variables (la fila propia), no el tenant', async () => {
    await mount();
    await cambiar(vars(C2, { userId: 'user-a' }));
    const eqs = updates()[0]!.ops.filter((o) => o.m === 'eq').map((o) => o.args);
    expect(eqs).toEqual([['user_id', 'user-a']]);
  });
});

describe('useCambiarCamionActivo: pesimista', () => {
  it('el miembro cambia SOLO cuando la base confirma (mientras tanto, sigue el de antes)', async () => {
    await mount();
    const d = deferred();
    onUpdate = () => d.promise;
    let pendiente!: Promise<unknown>;
    await act(async () => {
      pendiente = probe.mutation!.mutateAsync(vars(C2));
    });
    await settle();
    expect(probe.mutation!.isPending).toBe(true);
    expect(probe.member!.camionActivoId).toBe(C1);
    await act(async () => {
      d.resolve(ok([{ camion_activo_id: C2 }]));
      await pendiente;
    });
    await settle();
    expect(probe.member!.camionActivoId).toBe(C2);
  });

  it('se refleja lo que DEVOLVIÓ la base (no lo que se mandó)', async () => {
    await mount();
    onUpdate = () => ok([{ camion_activo_id: C3.toUpperCase() }]);
    await cambiar(vars(C2));
    expect(probe.member!.camionActivoId).toBe(C3);
  });

  it('éxito: no invalida nada (el camión activo no vive en la caché de TanStack)', async () => {
    await mount();
    await cambiar(vars(C2));
    expect(invalidadas).toEqual([]);
  });
});

describe('useCambiarCamionActivo: errores', () => {
  it('55000 camion_archivado: mensaje propio, sin reintento, el miembro no cambia y se refresca la lista de camiones', async () => {
    await mount();
    onUpdate = () => fail('55000', 'El camión está archivado (camion_archivado)');
    const error = await cambiar(vars(C2));
    expect(mapDataError(error, CAMBIAR_CAMION_ACTIVO_CONTEXT)).toBe(CAMION_ARCHIVADO_MESSAGE);
    expect(isRetryableDataError(error, CAMBIAR_CAMION_ACTIVO_CONTEXT)).toBe(false);
    expect(probe.member!.camionActivoId).toBe(C1);
    expect(invalidoCamiones()).toBe(true);
  });

  it('23503 miembros_camion_activo_fk (inexistente o de otra cuenta): "El camión elegido ya no existe. Elige otro." y se refresca la lista', async () => {
    await mount();
    onUpdate = () =>
      fail('23503', 'insert or update on table "miembros" violates foreign key constraint "miembros_camion_activo_fk"', 409);
    const error = await cambiar(vars(C2));
    expect(mapDataError(error, CAMBIAR_CAMION_ACTIVO_CONTEXT)).toBe(CAMION_ELEGIDO_NO_EXISTE_MESSAGE);
    expect(CAMION_ELEGIDO_NO_EXISTE_MESSAGE).toBe('El camión elegido ya no existe. Elige otro.');
    expect(isRetryableDataError(error, CAMBIAR_CAMION_ACTIVO_CONTEXT)).toBe(false);
    expect(probe.member!.camionActivoId).toBe(C1);
    expect(invalidoCamiones()).toBe(true);
  });

  it('0 filas (no apareció la fila propia): RecordNotFoundError con el mensaje genérico de guardado, sin reintento, sin invalidar', async () => {
    await mount();
    onUpdate = () => ok([]);
    const error = await cambiar(vars(C2));
    expect(error).toBeInstanceOf(RecordNotFoundError);
    expect(mapDataError(error, CAMBIAR_CAMION_ACTIVO_CONTEXT)).toBe(CAMION_ACTIVO_NO_GUARDADO_MESSAGE);
    expect(isRetryableDataError(error, CAMBIAR_CAMION_ACTIVO_CONTEXT)).toBe(false);
    expect(probe.member!.camionActivoId).toBe(C1);
    expect(invalidadas).toEqual([]);
  });

  it('sin red: reintentable, el miembro no cambia, no invalida y NO hay reintento automático (un solo UPDATE)', async () => {
    await mount();
    onUpdate = () => sinRed();
    const error = await cambiar(vars(C2));
    expect(mapDataError(error, CAMBIAR_CAMION_ACTIVO_CONTEXT)).toBe('No hay conexión. Revisa la señal y prueba de nuevo.');
    expect(isRetryableDataError(error, CAMBIAR_CAMION_ACTIVO_CONTEXT)).toBe(true);
    await settle(10);
    expect(updates()).toHaveLength(1);
    expect(probe.member!.camionActivoId).toBe(C1);
    expect(invalidadas).toEqual([]);
  });

  it('timeout: "Tardó demasiado…", reintentable, un solo UPDATE', async () => {
    await mount();
    onUpdate = () => ({ data: null, error: { code: '', message: 'TimeoutError: signal timed out' }, status: 0 });
    const error = await cambiar(vars(C2));
    expect(mapDataError(error, CAMBIAR_CAMION_ACTIVO_CONTEXT)).toBe('Tardó demasiado en responder. Revisa tu conexión e inténtalo de nuevo.');
    expect(isRetryableDataError(error, CAMBIAR_CAMION_ACTIVO_CONTEXT)).toBe(true);
    await settle(10);
    expect(updates()).toHaveLength(1);
  });

  it('otro 23503 (que no nombra la FK del camión activo) no refresca la lista de camiones', async () => {
    await mount();
    onUpdate = () => fail('23503', 'violates foreign key constraint "otra_fk"', 409);
    await cambiar(vars(C2));
    expect(invalidadas).toEqual([]);
  });

  it('el texto del servidor nunca llega al mensaje', async () => {
    await mount();
    onUpdate = () => fail('55000', 'El camión está archivado (camion_archivado)');
    const error = await cambiar(vars(C2));
    expect(mapDataError(error, CAMBIAR_CAMION_ACTIVO_CONTEXT)).not.toMatch(/camion_archivado|miembros|constraint/);
  });
});

describe('useCambiarCamionActivo: orden y cambio de cuenta', () => {
  it('scope: un segundo cambio espera al primero (un solo UPDATE en vuelo) y queda el último', async () => {
    await mount();
    const primero = deferred();
    let n = 0;
    onUpdate = (call) => {
      n += 1;
      return n === 1 ? primero.promise : guardarEnDb(call);
    };
    let p1!: Promise<unknown>;
    let p2!: Promise<unknown>;
    await act(async () => {
      p1 = probe.mutation!.mutateAsync(vars(C2));
    });
    await settle();
    await act(async () => {
      p2 = probe.mutation!.mutateAsync(vars(C3));
    });
    await settle();
    expect(updates()).toHaveLength(1); // el segundo espera
    await act(async () => {
      primero.resolve(ok([{ camion_activo_id: C2 }]));
      await p1;
      await p2;
    });
    await settle();
    expect(updates()).toHaveLength(2);
    expect(updates().map((c) => (c.ops.find((o) => o.m === 'update')!.args[0] as { camion_activo_id: string }).camion_activo_id)).toEqual([C2, C3]);
    expect(probe.member!.camionActivoId).toBe(C3);
  });

  it('si mientras guardaba cambió el usuario (y la cuenta), la respuesta NO se escribe en el miembro nuevo', async () => {
    await mount();
    const d = deferred();
    onUpdate = () => d.promise;
    let pendiente!: Promise<unknown>;
    await act(async () => {
      pendiente = probe.mutation!.mutateAsync(vars(C2));
    });
    await settle();
    await act(async () => ctl.setUser('user-b'));
    await settle();
    expect(probe.member!.transportistaId).toBe('tenant-b');
    await act(async () => {
      d.resolve(ok([{ camion_activo_id: C2 }]));
      await pendiente;
    });
    await settle();
    expect(probe.member!.camionActivoId).toBeNull(); // el de user-b, intacto
    // Y el UPDATE fue sobre la fila del usuario que lo pidió.
    expect(updates()[0]!.ops.find((o) => o.m === 'eq')!.args).toEqual(['user_id', 'user-a']);
  });
});
