import { act, useMemo, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// El camión activo en el estado del miembro (Etapa 5c): se lee en la MISMA consulta de `miembros` al arrancar, se valida
// (uuid o null) y se actualiza localmente solo con la guarda de tenant. Mock de supabase; el provider es el real.
const h = vi.hoisted(() => {
  const calls: Array<{ table: string; ops: Array<{ m: string; args: unknown[] }> }> = [];
  const state = { responder: null as null | ((call: { table: string; ops: Array<{ m: string; args: unknown[] }> }) => unknown) };
  function from(table: string) {
    const call = { table, ops: [] as Array<{ m: string; args: unknown[] }> };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {};
    for (const m of ['select', 'update', 'eq', 'abortSignal', 'maybeSingle']) {
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
import type { MemberContextValue } from '@/features/member/member-context';
import { MemberProvider } from '@/features/member/member-provider';
import { useMember } from '@/features/member/use-member';

const CAMION_1 = 'c0000000-0000-4000-8000-000000000001';
const CAMION_2 = 'c0000000-0000-4000-8000-000000000002';
/** Para simular las filas de las pruebas viejas, que no traen la columna. */
const AUSENTE = Symbol('sin la columna');

const db: { users: Record<string, { tenantId: string; camionActivo: unknown }> } = { users: {} };

function installResponder() {
  h.state.responder = (call) => {
    if (call.table === 'miembros' && call.ops.some((o) => o.m === 'maybeSingle')) {
      const userId = call.ops.find((o) => o.m === 'eq')!.args[1] as string;
      const u = db.users[userId];
      if (!u) return { data: null, error: null, status: 200 };
      const row: Record<string, unknown> = {
        rol: 'admin',
        tema: 'dark',
        color_acento: '#F59E0B',
        transportista_id: u.tenantId,
        transportistas: { nombre: `Cuenta ${u.tenantId}` },
      };
      if (u.camionActivo !== AUSENTE) row.camion_activo_id = u.camionActivo;
      return { data: row, error: null, status: 200 };
    }
    throw new Error(`pedido inesperado: ${call.table} ${call.ops.map((o) => o.m).join('.')}`);
  };
}

const probe: { ctx: MemberContextValue | null; renders: number } = { ctx: null, renders: 0 };
const ctl: { setUser: (id: string | null) => void } = { setUser: () => {} };

function Probe() {
  probe.ctx = useMember();
  probe.renders += 1;
  return null;
}

function AuthHarness({ initialUser, children }: { initialUser: string; children: ReactNode }) {
  const [userId, setUserId] = useState<string | null>(initialUser);
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

async function mount(userId: string) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <AuthHarness initialUser={userId}>
        <MemberProvider>
          <Probe />
        </MemberProvider>
      </AuthHarness>,
    );
  });
  await settle();
}

async function remount(userId: string) {
  await act(async () => root.unmount());
  container.remove();
  h.calls.length = 0;
  await mount(userId);
}

const member = () => probe.ctx!.member!;
const lecturasDeMiembros = () => h.calls.filter((c) => c.table === 'miembros');

beforeEach(() => {
  h.calls.length = 0;
  db.users = {
    'user-a': { tenantId: 'tenant-a', camionActivo: CAMION_1 },
    'user-b': { tenantId: 'tenant-b', camionActivo: null },
  };
  installResponder();
  probe.ctx = null;
  probe.renders = 0;
  localStorage.clear();
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  container?.remove();
  expect(errorSpy.mock.calls.map((c: unknown[]) => String(c[0]))).toEqual([]);
  errorSpy.mockRestore();
});

describe('MemberProvider: el camión activo se lee con el miembro', () => {
  it('va en la MISMA consulta de miembros (un solo pedido, la columna en el select) y queda en el miembro', async () => {
    await mount('user-a');
    expect(probe.ctx!.status).toBe('ready');
    expect(lecturasDeMiembros()).toHaveLength(1);
    const lectura = lecturasDeMiembros()[0]!;
    expect(lectura.ops.find((o) => o.m === 'select')!.args).toEqual([
      'rol, tema, color_acento, transportista_id, camion_activo_id, tour_version_vista, transportistas(nombre)',
    ]);
    expect(lectura.ops.find((o) => o.m === 'eq')!.args).toEqual(['user_id', 'user-a']);
    expect(member().camionActivoId).toBe(CAMION_1);
    // Lo demás, igual que antes.
    expect(member()).toMatchObject({ rol: 'admin', tema: 'dark', colorAcento: '#F59E0B', transportistaId: 'tenant-a' });
  });

  it('sin camión activo (NULL): null', async () => {
    await mount('user-b');
    expect(member().camionActivoId).toBeNull();
  });

  it('un valor que no es un uuid válido se lee como null (nunca se usa como id)', async () => {
    for (const raro of ['no-es-uuid', '', 42, { id: CAMION_1 }, [CAMION_1], true, `${CAMION_1} `, 'c0000000-0000-4000-8000-00000000000g']) {
      db.users['user-a']!.camionActivo = raro;
      await remount('user-a');
      expect(member().camionActivoId, JSON.stringify(raro)).toBeNull();
    }
  });

  it('una fila SIN la columna (p. ej. los mocks viejos) se lee como null', async () => {
    db.users['user-a']!.camionActivo = AUSENTE;
    await remount('user-a');
    expect(member().camionActivoId).toBeNull();
  });

  it('un uuid en mayúsculas se guarda en minúsculas (como los ids de la lista de camiones)', async () => {
    db.users['user-a']!.camionActivo = CAMION_1.toUpperCase();
    await remount('user-a');
    expect(member().camionActivoId).toBe(CAMION_1);
  });
});

describe('updateLocalCamionActivo', () => {
  it('solo actúa en el miembro de ESE transportista', async () => {
    await mount('user-a');
    await act(async () => probe.ctx!.updateLocalCamionActivo('tenant-b', CAMION_2));
    expect(member().camionActivoId).toBe(CAMION_1);
    await act(async () => probe.ctx!.updateLocalCamionActivo('tenant-a', CAMION_2));
    expect(member().camionActivoId).toBe(CAMION_2);
    // Lo demás del miembro no se toca.
    expect(member()).toMatchObject({ rol: 'admin', tema: 'dark', colorAcento: '#F59E0B', transportistaId: 'tenant-a', transportistaNombre: 'Cuenta tenant-a' });
  });

  it('quitarlo (null) también se refleja', async () => {
    await mount('user-a');
    await act(async () => probe.ctx!.updateLocalCamionActivo('tenant-a', null));
    expect(member().camionActivoId).toBeNull();
  });

  it('el mismo valor: la MISMA referencia del miembro y sin re-render', async () => {
    await mount('user-a');
    const antes = probe.ctx!.member;
    const renders = probe.renders;
    await act(async () => probe.ctx!.updateLocalCamionActivo('tenant-a', CAMION_1));
    expect(probe.ctx!.member).toBe(antes);
    expect(probe.renders).toBe(renders);
    // En mayúsculas es el mismo camión: tampoco cambia nada.
    await act(async () => probe.ctx!.updateLocalCamionActivo('tenant-a', CAMION_1.toUpperCase()));
    expect(probe.ctx!.member).toBe(antes);
  });

  it('un valor que no es uuid se guarda como null (igual que en la lectura)', async () => {
    await mount('user-a');
    await act(async () => probe.ctx!.updateLocalCamionActivo('tenant-a', 'cualquier-cosa'));
    expect(member().camionActivoId).toBeNull();
  });

  it('una respuesta que llega DESPUÉS de cambiar de usuario/tenant no escribe en el miembro nuevo', async () => {
    await mount('user-a');
    await act(async () => ctl.setUser('user-b'));
    await settle();
    expect(member().transportistaId).toBe('tenant-b');
    await act(async () => probe.ctx!.updateLocalCamionActivo('tenant-a', CAMION_2));
    expect(member().camionActivoId).toBeNull();
  });

  it('cambiar el camión activo NO reaplica el tema (no reescribe la caché de tema)', async () => {
    await mount('user-a');
    expect(localStorage.length).toBeGreaterThan(0); // la preferencia de entrada
    localStorage.clear(); // centinela
    await act(async () => probe.ctx!.updateLocalCamionActivo('tenant-a', CAMION_2));
    expect(member().camionActivoId).toBe(CAMION_2);
    expect(localStorage.length).toBe(0);
  });

  it('es estable entre renders (se puede usar en callbacks de mutaciones)', async () => {
    await mount('user-a');
    const fn = probe.ctx!.updateLocalCamionActivo;
    await act(async () => probe.ctx!.updateLocalCamionActivo('tenant-a', CAMION_2));
    expect(probe.ctx!.updateLocalCamionActivo).toBe(fn);
  });
});
