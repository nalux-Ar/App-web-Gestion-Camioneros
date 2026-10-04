import { act, useMemo, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock de supabase: registra cada pedido (tabla + operaciones encadenadas) y
// responde según lo que defina cada test. TODO lo demás es código REAL del proyecto.
// ---------------------------------------------------------------------------
type Op = { m: string; args: unknown[] };
type Call = { table: string; ops: Op[] };
type Resp = { data: unknown; error: { message: string; code: string } | null; status: number };

const h = vi.hoisted(() => {
  const calls: Array<{ table: string; ops: Array<{ m: string; args: unknown[] }> }> = [];
  const state = {
    responder: null as null | ((call: { table: string; ops: Array<{ m: string; args: unknown[] }> }) => unknown),
  };
  function from(table: string) {
    const call = { table, ops: [] as Array<{ m: string; args: unknown[] }> };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {};
    for (const m of ['select', 'update', 'insert', 'delete', 'eq', 'abortSignal', 'order', 'limit', 'gte', 'lt', 'maybeSingle']) {
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
import { MemberProvider } from '@/features/member/member-provider';
import { useMember } from '@/features/member/use-member';
import type { MemberContextValue } from '@/features/member/member-context';
import { RequireMember } from '@/app/guards';
import { Header } from '@/features/layout/header';
import { InicioPage } from '@/features/home/inicio-page';
import { ConfiguracionPage } from '@/features/configuracion/configuracion-page';
import { queryClient } from '@/lib/query-client';

// ---------------------------------------------------------------------------
// "Base de datos" falsa
// ---------------------------------------------------------------------------
const db = {
  tenants: {} as Record<string, { nombre: string }>,
  users: {} as Record<string, { tenantId: string; rol: 'admin' | 'chofer' }>,
};

function resetDb() {
  db.tenants = { 'tenant-a': { nombre: 'Transportes A' }, 'tenant-b': { nombre: 'Empresa B' } };
  db.users = {
    'user-a': { tenantId: 'tenant-a', rol: 'admin' },
    'user-b': { tenantId: 'tenant-b', rol: 'admin' },
    'user-chofer': { tenantId: 'tenant-a', rol: 'chofer' },
  };
}

const ok = (data: unknown): Resp => ({ data, error: null, status: 200 });
const fail = (message: string, code = '', status = 0): Resp => ({ data: null, error: { message, code }, status });

type Deferred = { promise: Promise<Resp>; resolve: (r: Resp) => void };
function deferred(): Deferred {
  let resolve!: (r: Resp) => void;
  const promise = new Promise<Resp>((r) => (resolve = r));
  return { promise, resolve };
}

/** Respuesta de la lectura de `miembros` (la que hace MemberProvider) + lo que defina `onUpdate` para transportistas. */
function installResponder(onUpdate: (call: Call) => unknown) {
  h.state.responder = (call) => {
    if (call.table === 'miembros' && call.ops.some((o) => o.m === 'maybeSingle')) {
      const eq = call.ops.find((o) => o.m === 'eq');
      const userId = eq?.args[1] as string;
      const u = db.users[userId];
      if (!u) return ok(null);
      return ok({
        rol: u.rol,
        tema: 'dark',
        color_acento: '#F59E0B',
        transportista_id: u.tenantId,
        transportistas: { nombre: db.tenants[u.tenantId].nombre },
      });
    }
    if (call.table === 'transportistas') return onUpdate(call);
    throw new Error(`pedido inesperado: ${call.table} ${call.ops.map((o) => o.m).join('.')}`);
  };
}

const writes = () => h.calls.filter((c) => c.table === 'transportistas');

// ---------------------------------------------------------------------------
// Árbol de prueba
// ---------------------------------------------------------------------------
const probe: { ctx: MemberContextValue | null } = { ctx: null };
const ctl: { setUser: (id: string | null) => void; setShowConfig: (v: boolean) => void } = {
  setUser: () => {},
  setShowConfig: () => {},
};

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

function Tree({ initialUser }: { initialUser: string }) {
  const [showConfig, setShowConfig] = useState(true);
  ctl.setShowConfig = setShowConfig;
  return (
    <QueryClientProvider client={queryClient}>
      <AuthHarness initialUser={initialUser}>
        <MemberProvider>
          <MemoryRouter>
            <RequireMember>
              <Header />
              <InicioPage />
              {showConfig ? <ConfiguracionPage /> : null}
              <Probe />
            </RequireMember>
          </MemoryRouter>
        </MemberProvider>
      </AuthHarness>
    </QueryClientProvider>
  );
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

async function mount(userId: string) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<Tree initialUser={userId} />);
  });
  await settle();
}

const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector<T>(sel);
const input = () => q<HTMLInputElement>('#nombre-cuenta')!;
const buttonByText = (text: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === text) ?? null;
const guardar = () => buttonByText('Guardar') ?? buttonByText('Guardando…');
const headerName = () => q('header span.truncate')?.textContent ?? null;
const greeting = () => [...document.querySelectorAll('h1')].find((e) => e.textContent?.startsWith('Hola'))?.textContent ?? null;
const bodyText = () => document.body.textContent ?? '';

async function typeInto(el: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function click(el: HTMLElement) {
  await act(async () => {
    el.click();
  });
}

const NO_EDITABLE = 'No pudimos cambiar el nombre. Solo el administrador de la cuenta puede hacerlo.';

beforeEach(() => {
  resetDb();
  h.calls.length = 0;
  h.state.responder = null;
  probe.ctx = null;
  localStorage.clear();
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  container?.remove();
  queryClient.clear();
  // Ningún test debe haber disparado errores de React (act, setState sobre desmontado, keys, etc.).
  expect(errorSpy.mock.calls.map((c: unknown[]) => String(c[0]))).toEqual([]);
  errorSpy.mockRestore();
});

describe('tarjeta Nombre: estructura y accesibilidad', () => {
  it('va entre "Tu cuenta" y "Tema", con título, descripción, label asociado y subtítulo actualizado', async () => {
    installResponder(() => ok([]));
    await mount('user-a');

    const titles = [...document.querySelectorAll('[data-slot="card-title"]')].map((e) => e.textContent);
    expect(titles.slice(0, 3)).toEqual(['Tu cuenta', 'Nombre', 'Tema']);
    expect(bodyText()).toContain('Es el nombre de tu cuenta: aparece en el encabezado y en el saludo del inicio.');
    expect(bodyText()).toContain('Tu cuenta y cómo se ve la app para ti.');
    expect(bodyText()).not.toContain('Elige cómo se ve la app para ti.');

    const label = document.querySelector<HTMLLabelElement>('label[for="nombre-cuenta"]')!;
    expect(label.textContent).toBe('Nombre de la cuenta');
    const el = input();
    expect(el.id).toBe('nombre-cuenta');
    expect(el.value).toBe('Transportes A'); // precargado con el nombre actual
    expect(el.getAttribute('autocomplete')).toBe('organization');
    expect(el.autofocus).toBe(false);
    expect(document.activeElement).not.toBe(el); // sin autofocus
    expect(el.disabled).toBe(false);
    expect(el.hasAttribute('maxlength')).toBe(false);
    // Botón: tamaño por defecto = h-12 (48 px), sin colores hardcodeados.
    const btn = guardar()!;
    expect(btn.className).toMatch(/\bh-12\b/);
    expect(btn.type).toBe('submit');
    expect(btn.disabled).toBe(true); // sin cambios
    expect(writes()).toHaveLength(0);
  });

  it('el código nuevo no trae colores hardcodeados (solo tokens)', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    // Relativo a este archivo (no una ruta absoluta): las pruebas corren igual en cualquier máquina.
    const dir = import.meta.dirname;
    for (const f of ['nombre-card.tsx', 'nombre.ts', 'nombre-api.ts', 'use-actualizar-nombre.ts']) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      expect(src, f).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(src, f).not.toMatch(/\b(?:bg|text|border|ring)-(?:red|green|blue|gray|slate|zinc|amber|black|white)-?\d*/);
      expect(src, f).not.toMatch(/\bvos\b|\btenés\b|\bpodés\b|\bescribí\b|\btocá\b|\bguardá\b/i);
    }
  });
});

describe('tarjeta Nombre: admin guarda', () => {
  it('guarda bien: payload exacto, id del contexto, contexto/encabezado/saludo actualizados con lo que devolvió la base', async () => {
    const d = deferred();
    installResponder(() => d.promise);
    await mount('user-a');
    expect(headerName()).toBe('Transportes A');
    expect(greeting()).toBe('Hola, Transportes A');

    await typeInto(input(), '  Nuevo Nombre  ');
    expect(guardar()!.disabled).toBe(false);
    await click(guardar()!);

    // En vuelo: sin actualización optimista, "Guardando…" con spinner, campo de solo lectura.
    expect(writes()).toHaveLength(1);
    expect(guardar()!.textContent).toContain('Guardando…');
    expect(guardar()!.disabled).toBe(true);
    expect(guardar()!.querySelector('svg.animate-spin')).not.toBeNull();
    expect(input().readOnly).toBe(true);
    expect(headerName()).toBe('Transportes A');
    expect(greeting()).toBe('Hola, Transportes A');
    expect(probe.ctx!.member!.transportistaNombre).toBe('Transportes A');

    // La base devuelve un nombre distinto del enviado: es ESE el que se muestra.
    d.resolve(ok([{ id: 'tenant-a', nombre: 'Nuevo Nombre (de la base)' }]));
    await settle();

    expect(headerName()).toBe('Nuevo Nombre (de la base)');
    expect(greeting()).toBe('Hola, Nuevo Nombre (de la base)');
    expect(probe.ctx!.member!.transportistaNombre).toBe('Nuevo Nombre (de la base)');
    expect(input().value).toBe('Nuevo Nombre (de la base)');
    expect(input().readOnly).toBe(false);
    expect(guardar()!.textContent).toBe('Guardar');
    expect(guardar()!.disabled).toBe(true); // valor sin cambios
    expect(bodyText()).toContain('Nombre guardado.');
    expect(document.querySelector('[aria-live="polite"]:not(.sr-only)')).not.toBeNull();

    // Payload y filtros EXACTOS.
    const [w] = writes();
    expect(w.ops.map((o) => o.m)).toEqual(['update', 'eq', 'select', 'abortSignal']);
    expect(w.ops[0].args).toEqual([{ nombre: 'Nuevo Nombre' }]); // recortado, solo { nombre }
    expect(Object.keys(w.ops[0].args[0] as object)).toEqual(['nombre']);
    expect(w.ops[1].args).toEqual(['id', 'tenant-a']); // el id sale del contexto
    expect(w.ops[2].args).toEqual(['id, nombre']);
    expect(w.ops[3].args[0]).toBeInstanceOf(AbortSignal);
    expect(h.calls.some((c) => c.ops.some((o) => ['insert', 'delete'].includes(o.m)))).toBe(false);
  });

  it('el campo del nombre guardado queda sin espacios y se puede volver a editar y guardar', async () => {
    installResponder((call) => {
      const nombre = (call.ops[0].args[0] as { nombre: string }).nombre;
      return ok([{ id: 'tenant-a', nombre }]);
    });
    await mount('user-a');

    await typeInto(input(), 'Uno  ');
    await click(guardar()!);
    await settle();
    expect(headerName()).toBe('Uno');
    expect(input().value).toBe('Uno');
    expect(bodyText()).toContain('Nombre guardado.');

    // Tipear de nuevo: se va "Nombre guardado." y el botón se habilita; segundo guardado.
    await typeInto(input(), 'Dos');
    expect(bodyText()).not.toContain('Nombre guardado.');
    expect(guardar()!.disabled).toBe(false);
    await click(guardar()!);
    await settle();
    expect(headerName()).toBe('Dos');
    expect(writes()).toHaveLength(2);
  });
});

describe('tarjeta Nombre: errores', () => {
  it('0 filas -> mensaje de "solo el administrador", SIN Reintentar, contexto sin cambios, lo tipeado intacto', async () => {
    installResponder(() => ok([]));
    await mount('user-a');

    await typeInto(input(), 'Otro nombre');
    await click(guardar()!);
    await settle();

    expect(bodyText()).toContain(NO_EDITABLE);
    expect(buttonByText('Reintentar')).toBeNull();
    expect(bodyText()).not.toContain('Nombre guardado.');
    expect(bodyText()).not.toContain('No hay conexión');
    expect(headerName()).toBe('Transportes A');
    expect(greeting()).toBe('Hola, Transportes A');
    expect(probe.ctx!.member!.transportistaNombre).toBe('Transportes A');
    expect(input().value).toBe('Otro nombre');
    expect(guardar()!.disabled).toBe(false); // se puede volver a intentar a mano
    expect(document.querySelector('[role="alert"]')).not.toBeNull();

    // Al tipear de nuevo, el aviso viejo se va.
    await typeInto(input(), 'Otro nombre 2');
    expect(bodyText()).not.toContain(NO_EDITABLE);
  });

  it('error de red -> mensaje + Reintentar sin perder lo tipeado; Reintentar reenvía lo mismo y termina bien', async () => {
    let n = 0;
    installResponder((call) => {
      n++;
      if (n === 1) return fail('TypeError: Failed to fetch');
      return ok([{ id: 'tenant-a', nombre: (call.ops[0].args[0] as { nombre: string }).nombre }]);
    });
    await mount('user-a');

    await typeInto(input(), 'Nombre sin señal');
    await click(guardar()!);
    await settle();

    expect(bodyText()).toContain('No hay conexión. Revisa la señal y prueba de nuevo.');
    expect(bodyText()).not.toContain('TypeError');
    const retry = buttonByText('Reintentar');
    expect(retry).not.toBeNull();
    expect(retry!.type).toBe('submit');
    expect(input().value).toBe('Nombre sin señal'); // no se perdió lo tipeado
    expect(headerName()).toBe('Transportes A'); // el contexto no cambió

    await click(retry!);
    await settle();
    expect(writes()).toHaveLength(2);
    expect(writes()[1].ops[0].args).toEqual([{ nombre: 'Nombre sin señal' }]);
    expect(writes()[1].ops[1].args).toEqual(['id', 'tenant-a']);
    expect(headerName()).toBe('Nombre sin señal');
    expect(bodyText()).toContain('Nombre guardado.');
    expect(buttonByText('Reintentar')).toBeNull();
    expect(bodyText()).not.toContain('No hay conexión. Revisa');
  });

  it('timeout y 5xx -> reintentables; permiso (42501) y check (23514) -> mensajes propios y sin Reintentar; nunca texto crudo', async () => {
    const cases: Array<{ resp: Resp; text: string; retry: boolean }> = [
      { resp: fail('TimeoutError: signal timed out'), text: 'Tardó demasiado en responder', retry: true },
      { resp: fail('upstream connect error', '', 502), text: 'El servicio no está disponible', retry: true },
      { resp: fail('permission denied for table transportistas', '42501', 403), text: NO_EDITABLE, retry: false },
      {
        resp: fail('new row violates check constraint "transportistas_nombre_chk"', '23514', 400),
        text: 'Escribe un nombre entre 1 y 200 caracteres.',
        retry: false,
      },
    ];
    for (const c of cases) {
      resetDb();
      h.calls.length = 0;
      installResponder(() => c.resp);
      await mount('user-a');
      await typeInto(input(), 'Algo nuevo');
      await click(guardar()!);
      await settle();
      expect(bodyText(), c.text).toContain(c.text);
      expect(!!buttonByText('Reintentar'), c.text).toBe(c.retry);
      expect(bodyText()).not.toMatch(/constraint|transportistas_nombre_chk|permission denied|upstream/);
      expect(input().value).toBe('Algo nuevo');
      expect(headerName()).toBe('Transportes A');
      await act(async () => root.unmount());
      container.remove();
      queryClient.clear();
    }
  });

  it('sin conexión: el banner avisa pero se deja intentar', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    installResponder(() => fail('TypeError: Failed to fetch'));
    await mount('user-a');

    expect(bodyText()).toContain('No hay conexión. Revisa la señal antes de enviar el formulario.');
    expect(document.querySelectorAll('[role="status"]').length).toBeGreaterThan(0);
    await typeInto(input(), 'Intento offline');
    expect(guardar()!.disabled).toBe(false); // se deja intentar
    await click(guardar()!);
    await settle();
    expect(writes()).toHaveLength(1); // salió el pedido igual (networkMode: 'always')
    expect(bodyText()).toContain('No hay conexión. Revisa la señal y prueba de nuevo.');
    expect(buttonByText('Reintentar')).not.toBeNull();
    // Un solo banner (el de la pantalla): la tarjeta no agrega otro.
    expect(document.body.textContent!.match(/No hay conexión\. Revisa la señal antes de enviar/g)).toHaveLength(1);
  });
});

describe('tarjeta Nombre: validación al guardar', () => {
  it('vacío / solo espacios / 201 -> mensaje en <p role="alert"> asociado, foco al campo, sin pedido; se limpia al tipear', async () => {
    installResponder(() => ok([]));
    await mount('user-a');

    for (const bad of ['', '    ', 'a'.repeat(201)]) {
      await typeInto(input(), bad);
      expect(guardar()!.disabled).toBe(false); // habilitado: la validación es al intentar guardar
      await click(guardar()!);
      const p = document.querySelector<HTMLElement>('p[role="alert"]')!;
      expect(p.textContent).toBe('Escribe un nombre entre 1 y 200 caracteres.');
      expect(p.className).toBe('text-sm text-destructive-text');
      expect(input().getAttribute('aria-invalid')).toBe('true');
      expect(input().getAttribute('aria-describedby')).toBe(p.id);
      expect(document.activeElement).toBe(input());
      expect(writes()).toHaveLength(0);
      await typeInto(input(), bad + 'x');
      expect(document.querySelector('p[role="alert"]')).toBeNull();
      expect(input().getAttribute('aria-invalid')).toBe('false');
      expect(input().hasAttribute('aria-describedby')).toBe(false);
    }
  });

  it('200 emojis (400 unidades UTF-16) se aceptan; texto gigante pegado -> inválido sin colgar la pantalla', async () => {
    installResponder((call) => ok([{ id: 'tenant-a', nombre: (call.ops[0].args[0] as { nombre: string }).nombre }]));
    await mount('user-a');

    await typeInto(input(), '🚚'.repeat(200));
    await click(guardar()!);
    await settle();
    expect(writes()).toHaveLength(1);
    expect(headerName()).toBe('🚚'.repeat(200));

    await typeInto(input(), 'x'.repeat(3_000_000));
    const t0 = performance.now();
    await click(guardar()!);
    expect(performance.now() - t0).toBeLessThan(1500);
    expect(document.querySelector('p[role="alert"]')?.textContent).toBe('Escribe un nombre entre 1 y 200 caracteres.');
    expect(writes()).toHaveLength(1);
  });
});

describe('tarjeta Nombre: habilitación del botón', () => {
  it('valor sin cambios (también con espacios de más) -> deshabilitado; cambia -> habilitado; vuelve -> deshabilitado', async () => {
    installResponder(() => ok([]));
    await mount('user-a');
    expect(guardar()!.disabled).toBe(true);
    await typeInto(input(), 'Transportes A   ');
    expect(guardar()!.disabled).toBe(true);
    await typeInto(input(), '  Transportes A');
    expect(guardar()!.disabled).toBe(true);
    await typeInto(input(), 'Transportes AB');
    expect(guardar()!.disabled).toBe(false);
    await typeInto(input(), 'Transportes A');
    expect(guardar()!.disabled).toBe(true);
    // Un submit "a la fuerza" (Enter) con valor sin cambios tampoco escribe nada.
    await act(async () => {
      q<HTMLFormElement>('form')!.requestSubmit();
    });
    await settle();
    expect(writes()).toHaveLength(0);
  });

  it('chofer: campo de solo lectura (legible, no deshabilitado), botón deshabilitado, texto explicativo asociado, y no escribe nunca', async () => {
    installResponder(() => ok([]));
    await mount('user-chofer');

    expect(input().value).toBe('Transportes A');
    // Ajuste posterior a la auditoría: `readOnly` + `aria-readonly` en vez de `disabled`
    // (el texto queda legible; un campo `disabled` se atenúa con opacity-50).
    expect(input().readOnly).toBe(true);
    expect(input().getAttribute('aria-readonly')).toBe('true');
    expect(input().disabled).toBe(false);
    expect(input().className).toContain('bg-muted');
    expect(guardar()!.disabled).toBe(true);
    const hint = [...document.querySelectorAll('p')].find(
      (p) => p.textContent === 'Solo el administrador de la cuenta puede cambiar el nombre.',
    )!;
    expect(hint).toBeTruthy();
    expect(input().getAttribute('aria-describedby')).toBe(hint.id);
    // Defensa en profundidad: aunque el texto cambie por la fuerza (un input deshabilitado no deja
    // tipear, pero acá se dispara el evento a mano), el botón sigue deshabilitado por el ROL y
    // un submit forzado no manda ningún pedido.
    await typeInto(input(), 'Forzado por DOM');
    expect(guardar()!.disabled).toBe(true);
    await act(async () => {
      q<HTMLFormElement>('form')!.requestSubmit();
    });
    await settle();
    expect(writes()).toHaveLength(0);
  });

  it('admin: no aparece el texto de "solo el administrador"', async () => {
    installResponder(() => ok([]));
    await mount('user-a');
    expect(bodyText()).not.toContain('Solo el administrador de la cuenta puede cambiar el nombre.');
    // El admin sí edita: el campo no es de solo lectura ni tiene el fondo apagado.
    expect(input().readOnly).toBe(false);
    expect(input().getAttribute('aria-readonly')).toBe('false');
    expect(input().className).not.toContain('bg-muted');
  });
});

describe('tarjeta Nombre: doble toque', () => {
  it('dos clics seguidos (y un Enter) antes del repintado -> UNA sola escritura', async () => {
    const d = deferred();
    installResponder(() => d.promise);
    await mount('user-a');
    await typeInto(input(), 'Doble toque');

    await act(async () => {
      const btn = guardar()!;
      btn.click();
      btn.click(); // el botón todavía no se repintó como deshabilitado
      q<HTMLFormElement>('form')!.requestSubmit(); // y un Enter
    });
    await settle();
    expect(writes()).toHaveLength(1);

    // Mientras guarda, más toques (el botón ya está deshabilitado) tampoco escriben.
    await click(guardar()!);
    q<HTMLFormElement>('form')!.requestSubmit();
    await settle();
    expect(writes()).toHaveLength(1);

    d.resolve(ok([{ id: 'tenant-a', nombre: 'Doble toque' }]));
    await settle();
    expect(writes()).toHaveLength(1);
    expect(headerName()).toBe('Doble toque');
  });
});

describe('tarjeta Nombre: tenant / usuario / pantalla durante la escritura', () => {
  it('cambia el usuario (otro tenant) mientras escribe -> el contexto del nuevo tenant NO se toca', async () => {
    const d = deferred();
    installResponder((call) => {
      // Los pedidos de la cuenta B (si los hubiera) devolverían su propia fila; el de A queda en vuelo.
      void call;
      return d.promise;
    });
    await mount('user-a');
    await typeInto(input(), 'Nombre nuevo de A');
    await click(guardar()!);
    expect(writes()).toHaveLength(1);
    expect(writes()[0].ops[1].args).toEqual(['id', 'tenant-a']);

    // Mientras la base responde, entra otro usuario (otra pestaña) de otro tenant.
    await act(async () => {
      ctl.setUser('user-b');
    });
    await settle(6);
    expect(probe.ctx!.member!.transportistaId).toBe('tenant-b');
    expect(headerName()).toBe('Empresa B');

    // Llega la respuesta tardía del tenant A.
    d.resolve(ok([{ id: 'tenant-a', nombre: 'Nombre nuevo de A' }]));
    await settle(6);

    expect(probe.ctx!.member!.transportistaId).toBe('tenant-b');
    expect(probe.ctx!.member!.transportistaNombre).toBe('Empresa B');
    expect(headerName()).toBe('Empresa B');
    expect(greeting()).toBe('Hola, Empresa B');
    expect(input().value).toBe('Empresa B');
    expect(bodyText()).not.toContain('Nombre nuevo de A');
    expect(bodyText()).not.toContain('Nombre guardado.');
    expect(guardar()!.disabled).toBe(true);
    expect(writes()).toHaveLength(1);
  });

  it('updateLocalTransportistaNombre: solo actúa si el miembro actual es de ESE transportista', async () => {
    installResponder(() => ok([]));
    await mount('user-a');
    const before = probe.ctx!;
    expect(typeof before.refetch).toBe('function');
    expect(typeof before.updateLocalPreferences).toBe('function');
    expect(before.status).toBe('ready');

    await act(async () => probe.ctx!.updateLocalTransportistaNombre('tenant-b', 'Intruso'));
    expect(probe.ctx!.member!.transportistaNombre).toBe('Transportes A');
    expect(headerName()).toBe('Transportes A');

    await act(async () => probe.ctx!.updateLocalTransportistaNombre('tenant-a', 'Cambiado'));
    expect(probe.ctx!.member!.transportistaNombre).toBe('Cambiado');
    expect(headerName()).toBe('Cambiado');
    // Lo demás del miembro no se toca.
    expect(probe.ctx!.member!.rol).toBe('admin');
    expect(probe.ctx!.member!.tema).toBe('dark');
    expect(probe.ctx!.member!.colorAcento).toBe('#F59E0B');
    expect(probe.ctx!.member!.transportistaId).toBe('tenant-a');

    // Mismo nombre: no cambia la referencia del miembro (sin re-render ni re-aplicar tema).
    const memberRef = probe.ctx!.member;
    await act(async () => probe.ctx!.updateLocalTransportistaNombre('tenant-a', 'Cambiado'));
    expect(probe.ctx!.member).toBe(memberRef);
  });

  it('la persona se va de Configuración mientras guarda -> el encabezado igual se actualiza y no hay errores de React', async () => {
    const d = deferred();
    installResponder(() => d.promise);
    await mount('user-a');
    await typeInto(input(), 'Guardado en segundo plano');
    await click(guardar()!);
    expect(writes()).toHaveLength(1);

    await act(async () => ctl.setShowConfig(false)); // sale de Configuración
    expect(q('#nombre-cuenta')).toBeNull();
    d.resolve(ok([{ id: 'tenant-a', nombre: 'Guardado en segundo plano' }]));
    await settle();

    expect(headerName()).toBe('Guardado en segundo plano');
    expect(probe.ctx!.member!.transportistaNombre).toBe('Guardado en segundo plano');
  });
});

describe('ajustes posteriores a la auditoria', () => {
  it('el saludo del inicio rompe palabras largas (break-words) y muestra el nombre completo', async () => {
    installResponder(() => ok([]));
    db.tenants['tenant-a'].nombre = 'x'.repeat(200);
    await mount('user-a');
    const h1 = [...document.querySelectorAll('h1')].find((e) => e.textContent?.startsWith('Hola'))!;
    expect(h1.className).toContain('break-words');
    expect(h1.textContent).toBe('Hola, ' + 'x'.repeat(200));
  });

  it('scope: un segundo guardado (otra instancia de la tarjeta) espera al primero y el contexto queda con el ultimo', async () => {
    const first = deferred();
    let n = 0;
    installResponder(() => {
      n += 1;
      if (n === 1) return first.promise;
      return ok([{ id: 'tenant-a', nombre: 'Segundo' }]);
    });
    await mount('user-a');

    await typeInto(input(), 'Primero');
    await click(guardar()!);
    await settle();
    expect(writes()).toHaveLength(1);

    // Se sale de Configuracion y se vuelve (tarjeta NUEVA, con su propio guard) antes de que responda el primero.
    await act(async () => ctl.setShowConfig(false));
    await act(async () => ctl.setShowConfig(true));
    await settle();
    await typeInto(input(), 'Segundo');
    await click(guardar()!);
    await settle();
    expect(writes()).toHaveLength(1); // el segundo espera: no hay dos UPDATE concurrentes

    first.resolve(ok([{ id: 'tenant-a', nombre: 'Primero' }]));
    await settle(8);
    expect(writes()).toHaveLength(2);
    expect(headerName()).toBe('Segundo');
    expect(probe.ctx!.member!.transportistaNombre).toBe('Segundo');
  });

  it('confirmar el nombre NO reaplica el tema (no reescribe la cache de tema); cambiar el tema si', async () => {
    installResponder(() => ok([{ id: 'tenant-a', nombre: 'Nombre nuevo' }]));
    await mount('user-a');
    // Al montar, el efecto escribe la preferencia de entrada en la cache local.
    expect(localStorage.length).toBeGreaterThan(0);
    localStorage.clear(); // centinela: si algo vuelve a escribir, se nota

    await typeInto(input(), 'Nombre nuevo');
    await click(guardar()!);
    await settle(6);
    expect(headerName()).toBe('Nombre nuevo');
    expect(localStorage.length).toBe(0); // el cambio de nombre no toco el tema

    await act(async () => probe.ctx!.updateLocalPreferences({ tema: 'light' }));
    expect(localStorage.length).toBeGreaterThan(0); // cambiar el tema SI reaplica y reescribe
  });

  it('cambio de usuario con el MISMO tema y acento: el efecto igual reaplica y reescribe la cache del nuevo usuario', async () => {
    installResponder(() => ok([]));
    await mount('user-a');
    await act(async () => ctl.setUser('user-b'));
    await settle(6);
    expect(headerName()).toBe('Empresa B');
    expect(localStorage.length).toBeGreaterThan(0);
  });
});

describe('tarjeta Nombre: sincronización del campo con el contexto', () => {
  it('cambio externo del nombre: NO pisa lo que se está tipeando', async () => {
    installResponder(() => ok([]));
    await mount('user-a');
    await typeInto(input(), 'Estoy escribiendo');

    await act(async () => probe.ctx!.updateLocalTransportistaNombre('tenant-a', 'Cambio externo'));
    expect(headerName()).toBe('Cambio externo');
    expect(input().value).toBe('Estoy escribiendo'); // intacto
    expect(guardar()!.disabled).toBe(false); // difiere del nombre actual
  });

  it('cambio externo con el campo SIN editar: el campo acompaña al nombre nuevo y el botón sigue deshabilitado', async () => {
    installResponder(() => ok([]));
    await mount('user-a');
    expect(input().value).toBe('Transportes A');

    await act(async () => probe.ctx!.updateLocalTransportistaNombre('tenant-a', 'Cambio externo'));
    expect(input().value).toBe('Cambio externo');
    expect(guardar()!.disabled).toBe(true);
  });
});
