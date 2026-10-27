import { act, useMemo, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// La versión del recorrido de bienvenida en el miembro (migración 017): se lee con la MISMA consulta de `miembros`, se
// normaliza, y `marcarTourVisto` guarda primero local y después en la base (sin bajar nunca). Mock de supabase; el provider
// es el real.
type Call = { table: string; ops: Array<{ m: string; args: unknown[] }> };
const h = vi.hoisted(() => {
  const calls: Array<{ table: string; ops: Array<{ m: string; args: unknown[] }> }> = [];
  const state = { responder: null as null | ((call: { table: string; ops: Array<{ m: string; args: unknown[] }> }) => unknown) };
  function from(table: string) {
    const call = { table, ops: [] as Array<{ m: string; args: unknown[] }> };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {};
    for (const m of ['select', 'update', 'eq', 'lt', 'abortSignal', 'maybeSingle']) {
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
import { leerTourVistoLocal } from '@/features/ayuda/tour-version';
import type { MemberContextValue } from './member-context';
import { MemberProvider } from './member-provider';
import { useMember } from './use-member';

const AUSENTE = Symbol('sin la columna');
const STORAGE = 'elan:tour-visto';
const db: { users: Record<string, { tenantId: string; tour: unknown }> } = { users: {} };
/** Cómo responde el UPDATE: 'ok' (1 fila), 'ninguna' (0 filas), 'error' (de la base), 'red' (tira), 'diferida' (cuando se llama a `soltarUpdate`). */
let respuestaUpdate: 'ok' | 'ninguna' | 'error' | 'red' | 'diferida' = 'ok';
let soltarUpdate: () => void = () => {};
/** Si la lectura del miembro tarda (así se ve el paso por 'loading' en un render aparte). */
let lecturaLenta = false;

const lecturas = () => h.calls.filter((c) => c.table === 'miembros' && c.ops.some((o) => o.m === 'maybeSingle'));
const escrituras = () => h.calls.filter((c) => c.table === 'miembros' && c.ops.some((o) => o.m === 'update'));

function installResponder() {
  h.state.responder = (call: Call) => {
    if (call.table !== 'miembros') throw new Error(`pedido inesperado: ${call.table}`);
    const userId = call.ops.find((o) => o.m === 'eq')!.args[1] as string;
    if (call.ops.some((o) => o.m === 'update')) {
      if (respuestaUpdate === 'red') throw new TypeError('Failed to fetch');
      if (respuestaUpdate === 'diferida') return new Promise((r) => (soltarUpdate = () => r({ data: null, error: null, status: 204 })));
      if (respuestaUpdate === 'error') return { data: null, error: { code: '', message: 'TypeError: Failed to fetch' }, status: 0 };
      const version = (call.ops.find((o) => o.m === 'update')!.args[0] as { tour_version_vista: number }).tour_version_vista;
      const u = db.users[userId];
      if (respuestaUpdate === 'ok' && u && typeof u.tour === 'number' && u.tour < version) u.tour = version;
      return { data: null, error: null, status: 204 };
    }
    const u = db.users[userId];
    if (!u) return { data: null, error: null, status: 200 };
    const row: Record<string, unknown> = {
      rol: 'admin',
      tema: 'dark',
      color_acento: '#F59E0B',
      transportista_id: u.tenantId,
      camion_activo_id: null,
      transportistas: { nombre: 'Cuenta' },
    };
    if (u.tour !== AUSENTE) row.tour_version_vista = u.tour;
    const resp = { data: row, error: null, status: 200 };
    return lecturaLenta ? new Promise((r) => setTimeout(() => r(resp), 20)) : resp;
  };
}

const probe: { ctx: MemberContextValue | null } = { ctx: null };
const ctl: { setUser: (id: string | null) => void } = { setUser: () => {} };

function Probe() {
  probe.ctx = useMember();
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

async function settle(times = 6) {
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

beforeEach(() => {
  h.calls.length = 0;
  db.users = { 'user-a': { tenantId: 'tenant-a', tour: 0 }, 'user-b': { tenantId: 'tenant-b', tour: 0 } };
  respuestaUpdate = 'ok';
  lecturaLenta = false;
  installResponder();
  probe.ctx = null;
  localStorage.clear();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
});

describe('MemberProvider: la versión del recorrido se lee con el miembro', () => {
  it('va en la MISMA consulta (la columna en el select) y queda en el miembro', async () => {
    db.users['user-a']!.tour = 1;
    await mount('user-a');
    expect(lecturas()).toHaveLength(1);
    expect(String(lecturas()[0]!.ops.find((o) => o.m === 'select')!.args[0])).toContain('tour_version_vista');
    expect(member().tourVersionVista).toBe(1);
  });

  it('sin la columna, o con algo raro (texto, negativo, decimal, null), se lee como 0', async () => {
    for (const raro of [AUSENTE, '2', -1, 1.5, null, Number.NaN, {}]) {
      db.users['user-a']!.tour = raro;
      await remount('user-a');
      expect(member().tourVersionVista, String(raro)).toBe(0);
    }
  });
});

describe('marcarTourVisto', () => {
  it('guarda primero LOCAL y después en la base (update con eq del usuario y lt de la versión); sube el miembro', async () => {
    await mount('user-a');
    h.calls.length = 0;
    await act(async () => probe.ctx!.marcarTourVisto(1));
    expect(JSON.parse(localStorage.getItem(STORAGE)!)).toEqual({ userId: 'user-a', version: 1 });
    expect(escrituras()).toHaveLength(1);
    const ops = escrituras()[0]!.ops;
    expect(ops.find((o) => o.m === 'update')!.args).toEqual([{ tour_version_vista: 1 }]);
    expect(ops.find((o) => o.m === 'eq')!.args).toEqual(['user_id', 'user-a']);
    expect(ops.find((o) => o.m === 'lt')!.args).toEqual(['tour_version_vista', 1]);
    expect(Object.keys(ops.find((o) => o.m === 'update')!.args[0] as object)).toEqual(['tour_version_vista']);
    expect(member().tourVersionVista).toBe(1);
  });

  it('0 filas (ya estaba) no es un error: el miembro igual queda en esa versión y no tira', async () => {
    respuestaUpdate = 'ninguna';
    await mount('user-a');
    await act(async () => expect(probe.ctx!.marcarTourVisto(1)).resolves.toBeUndefined());
    expect(member().tourVersionVista).toBe(1);
  });

  it('si la base falla (sin señal), queda lo local, el miembro NO cambia y no tira', async () => {
    respuestaUpdate = 'error';
    await mount('user-a');
    await act(async () => expect(probe.ctx!.marcarTourVisto(1)).resolves.toBeUndefined());
    expect(leerTourVistoLocal('user-a')).toBe(1);
    expect(member().tourVersionVista).toBe(0);
  });

  it('si el pedido TIRA (red), igual: lo local queda y no tira', async () => {
    respuestaUpdate = 'red';
    await mount('user-a');
    await act(async () => expect(probe.ctx!.marcarTourVisto(1)).resolves.toBeUndefined());
    expect(leerTourVistoLocal('user-a')).toBe(1);
    expect(member().tourVersionVista).toBe(0);
  });

  it('nunca baja la versión del miembro (marcar 1 con la 2 ya vista)', async () => {
    db.users['user-a']!.tour = 2;
    await mount('user-a');
    await act(async () => probe.ctx!.marcarTourVisto(1));
    expect(member().tourVersionVista).toBe(2);
  });

  it('si la respuesta llega DESPUÉS de que el otro usuario ya cargó, tampoco lo toca', async () => {
    respuestaUpdate = 'diferida';
    await mount('user-a');
    let promesa: Promise<void> = Promise.resolve();
    await act(async () => {
      promesa = probe.ctx!.marcarTourVisto(1);
    });
    await act(async () => ctl.setUser('user-b'));
    await settle();
    expect(member().transportistaId).toBe('tenant-b');
    await act(async () => {
      soltarUpdate();
      await promesa;
    });
    await settle();
    expect(member().transportistaId).toBe('tenant-b');
    expect(member().tourVersionVista).toBe(0);
  });

  it('una respuesta que llega con OTRO usuario ya activo no toca a ese miembro', async () => {
    await mount('user-a');
    let promesa: Promise<void> = Promise.resolve();
    await act(async () => {
      promesa = probe.ctx!.marcarTourVisto(1);
      ctl.setUser('user-b');
    });
    await act(async () => promesa);
    await settle();
    expect(member().transportistaId).toBe('tenant-b');
    expect(member().tourVersionVista).toBe(0);
  });
});

describe('reintento al arrancar y limpieza', () => {
  it('si la copia local (de ESTE usuario) quedó adelante de la base, al arrancar se reintenta en silencio (una vez)', async () => {
    localStorage.setItem(STORAGE, JSON.stringify({ userId: 'user-a', version: 1 }));
    await mount('user-a');
    expect(escrituras()).toHaveLength(1);
    expect(escrituras()[0]!.ops.find((o) => o.m === 'update')!.args).toEqual([{ tour_version_vista: 1 }]);
    expect(member().tourVersionVista).toBe(1);
    await settle();
    expect(escrituras()).toHaveLength(1);
  });

  it('con la base al día (o adelante) no se escribe nada', async () => {
    db.users['user-a']!.tour = 1;
    localStorage.setItem(STORAGE, JSON.stringify({ userId: 'user-a', version: 1 }));
    await mount('user-a');
    expect(escrituras()).toHaveLength(0);
  });

  it('la copia local de OTRO usuario se ignora (no se reintenta ni cuenta)', async () => {
    localStorage.setItem(STORAGE, JSON.stringify({ userId: 'user-b', version: 1 }));
    await mount('user-a');
    expect(escrituras()).toHaveLength(0);
    expect(leerTourVistoLocal('user-a')).toBe(0);
  });

  it('si el reintento falla, no se insiste en la misma sesión', async () => {
    respuestaUpdate = 'error';
    localStorage.setItem(STORAGE, JSON.stringify({ userId: 'user-a', version: 1 }));
    await mount('user-a');
    await settle();
    expect(escrituras()).toHaveLength(1);
    expect(leerTourVistoLocal('user-a')).toBe(1);
    // Ni cuando el miembro se vuelve a pedir (pasa por 'loading' y vuelve a 'ready').
    lecturaLenta = true;
    await act(async () => {
      void probe.ctx!.refetch();
    });
    expect(probe.ctx!.status).toBe('loading');
    await settle(10);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 40));
    });
    expect(probe.ctx!.status).toBe('ready');
    expect(lecturas()).toHaveLength(2);
    expect(escrituras()).toHaveLength(1);
  });

  it('al cambiar de usuario (A → B sin pasar por "sin sesión"), la copia local de A se borra', async () => {
    await mount('user-a');
    await act(async () => probe.ctx!.marcarTourVisto(1));
    expect(localStorage.getItem(STORAGE)).not.toBeNull();
    await act(async () => ctl.setUser('user-b'));
    await settle();
    expect(localStorage.getItem(STORAGE)).toBeNull();
  });
});
