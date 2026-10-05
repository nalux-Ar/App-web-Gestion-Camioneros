import { act, useMemo, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation, type InitialEntry } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock de supabase: registra cada pedido y responde según la tabla y las operaciones. TODO lo demás (pantalla, formulario,
// hooks, TanStack Query, router, validación, guardado idempotente, conteo del borrado) es código REAL del proyecto.
type Op = { m: string; args: unknown[] };
type Call = { table: string; ops: Op[] };

const h = vi.hoisted(() => {
  const calls: Array<{ table: string; ops: Array<{ m: string; args: unknown[] }> }> = [];
  const state = { responder: null as null | ((call: { table: string; ops: Array<{ m: string; args: unknown[] }> }) => unknown) };
  function from(table: string) {
    const call = { table, ops: [] as Array<{ m: string; args: unknown[] }> };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {};
    for (const m of ['select', 'update', 'insert', 'delete', 'eq', 'abortSignal', 'order', 'limit', 'gte', 'lt', 'maybeSingle', 'single']) {
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
import { RequireMember } from '@/app/guards';
import { ClienteFormPage } from '@/features/clientes/cliente-form-page';
import { clientesKeys } from '@/features/clientes/clientes-keys';
import { devolucionesKeys } from '@/features/devoluciones/devoluciones-keys';
import { gastosKeys } from '@/features/gastos/gastos-keys';
import { viajesKeys } from '@/features/viajes/viajes-keys';
import { queryClient } from '@/lib/query-client';

// ---------------------------------------------------------------------------
// "Base de datos" falsa
// ---------------------------------------------------------------------------
type Resp = { data: unknown; count?: unknown; error: { message: string; code: string; details?: string; hint?: string } | null; status: number };
const ok = (data: unknown): Resp => ({ data, error: null, status: 200 });
const conteo = (count: number): Resp => ({ data: null, count, error: null, status: 200 });
const fail = (code: string, message: string): Resp => ({ data: null, error: { code, message, details: '', hint: '' }, status: 409 });
const sinRed = (): Resp => ({ data: null, error: { code: '', message: 'TypeError: Failed to fetch' }, status: 0 });
const refDuplicado = () => fail('23505', 'duplicate key value violates unique constraint "clientes_transportista_client_ref_uidx"');

const MIEMBRO = { rol: 'admin', tema: 'dark', color_acento: '#F59E0B', transportista_id: 'tenant-a', transportistas: { nombre: 'Transportes A' } };
const C_ALMACEN = 'a0000000-0000-4000-8000-000000000001';
const C_BODEGA = 'a0000000-0000-4000-8000-000000000002';
const C_NUEVO = 'a0000000-0000-4000-8000-0000000000aa';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const LISTA = [
  { id: C_ALMACEN, nombre: 'Almacén Central' },
  { id: C_BODEGA, nombre: 'Bodega Norte' },
];
const detalleAlmacen = (over: Record<string, unknown> = {}) => ({
  id: C_ALMACEN,
  nombre: 'Almacén Central',
  contacto_telefono: '351 555-1234',
  contacto_email: 'ventas@almacen.test',
  direccion: 'Ruta 9 km 12',
  ...over,
});

type Handler = (call: Call) => unknown;
const route: {
  lista: Handler;
  detalle: Handler;
  porRef: Handler;
  insertar: Handler;
  actualizar: Handler;
  borrar: Handler;
  contarEntregas: Handler;
  contarDevoluciones: Handler;
} = {} as never;

function resetRoutes() {
  route.lista = () => ok(LISTA);
  route.detalle = () => ok(detalleAlmacen());
  route.porRef = () => ok(null);
  route.insertar = (call) => ok({ id: C_NUEVO, nombre: (payloadOf(call, 'insert') as { nombre: string }).nombre });
  route.actualizar = () => ok([{ id: C_ALMACEN }]);
  route.borrar = () => ok([{ id: C_ALMACEN }]);
  route.contarEntregas = () => conteo(0);
  route.contarDevoluciones = () => conteo(0);
}

const eqDe = (call: Call) => call.ops.filter((o) => o.m === 'eq').map((o) => o.args);

function installResponder() {
  h.state.responder = (call: Call) => {
    const has = (m: string) => call.ops.some((o) => o.m === m);
    if (call.table === 'miembros' && has('maybeSingle')) return ok(MIEMBRO);
    if (call.table === 'entregas') return route.contarEntregas(call);
    if (call.table === 'devoluciones') return route.contarDevoluciones(call);
    if (call.table === 'clientes') {
      if (has('insert')) return route.insertar(call);
      if (has('update')) return route.actualizar(call);
      if (has('delete')) return route.borrar(call);
      if (has('maybeSingle')) return eqDe(call)[0]?.[0] === 'client_ref' ? route.porRef(call) : route.detalle(call);
      return route.lista(call);
    }
    throw new Error(`pedido inesperado: ${call.table} ${call.ops.map((o) => o.m).join('.')}`);
  };
}

const callsTo = (table: string) => h.calls.filter((c) => c.table === table);
const clientesCon = (m: string) => callsTo('clientes').filter((c) => c.ops.some((o) => o.m === m));
const inserts = () => clientesCon('insert');
const updates = () => clientesCon('update');
const deletes = () => clientesCon('delete');
const lecturasPorRef = () => clientesCon('maybeSingle').filter((c) => eqDe(c)[0]?.[0] === 'client_ref');
function payloadOf(call: Call, m: 'insert' | 'update') {
  return call.ops.find((o) => o.m === m)!.args[0] as Record<string, unknown>;
}

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

function Destino({ nombre }: { nombre: string }) {
  const location = useLocation();
  return <div id={`destino-${nombre}`} data-pathname={location.pathname} data-search={location.search} data-state={JSON.stringify(location.state ?? null)} />;
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

const NUEVO = '/clientes/nuevo';
const EDITAR = `/clientes/${C_ALMACEN}/editar`;

async function mount(entry: InitialEntry = NUEVO) {
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
                  <Route path="/clientes/nuevo" element={<ClienteFormPage modo="nuevo" />} />
                  <Route path="/clientes/:id/editar" element={<ClienteFormPage modo="editar" />} />
                  <Route path="/clientes/:id" element={<Destino nombre="detalle" />} />
                  <Route path="/clientes" element={<Destino nombre="lista" />} />
                </Routes>
              </RequireMember>
            </MemoryRouter>
          </MemberProvider>
        </AuthHarness>
      </QueryClientProvider>,
    );
  });
  await settle(6);
}

async function remount(entry: InitialEntry) {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  queryClient.clear();
  await mount(entry);
}

const byId = <T extends HTMLElement = HTMLElement>(elementId: string) => document.getElementById(elementId) as T | null;
const bodyText = () => document.body.textContent ?? '';
const buttons = () => [...document.querySelectorAll<HTMLButtonElement>('button')];
const buttonByText = (text: string) => buttons().find((b) => b.textContent?.includes(text));
const links = () => [...document.querySelectorAll<HTMLAnchorElement>('a')];
const campo = (nombre: 'nombre' | 'telefono' | 'email' | 'direccion') => byId<HTMLInputElement>(`cliente-${nombre}`)!;
const errorDe = (nombre: string) => byId(`cliente-${nombre}-error`)?.textContent ?? '';
const labelDe = (nombre: string) => document.querySelector<HTMLLabelElement>(`label[for="cliente-${nombre}"]`)?.textContent ?? '';
const destino = (nombre: string) => byId(`destino-${nombre}`);
const stateDe = (el: HTMLElement | null) => JSON.parse(el!.dataset.state ?? 'null') as Record<string, unknown> | null;

async function click(el: HTMLElement | null | undefined) {
  if (!el) throw new Error('no se encontró el elemento a tocar');
  await act(async () => {
    el.click();
  });
  await settle(4);
}
async function tipear(el: HTMLInputElement | null, value: string) {
  if (!el) throw new Error('no se encontró el campo');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function guardar() {
  await act(async () => {
    buttonByText('Guardar cliente')!.click();
  });
  await settle(6);
}

let invalidadas: unknown[][] = [];
let invalidateSpy: ReturnType<typeof vi.spyOn>;
const invalido = (key: readonly unknown[]) => invalidadas.some((k) => JSON.stringify(k) === JSON.stringify(key));

beforeEach(() => {
  h.calls.length = 0;
  resetRoutes();
  installResponder();
  localStorage.clear();
  invalidadas = [];
  invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockImplementation(((filters?: { queryKey?: unknown[] }) => {
    if (filters?.queryKey) invalidadas.push(filters.queryKey);
    return Promise.resolve();
  }) as never);
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.scrollTo = (() => {}) as never;
  Element.prototype.scrollIntoView = (() => {}) as never;
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

// ---------------------------------------------------------------------------
// Alta
// ---------------------------------------------------------------------------
describe('alta de cliente: estructura', () => {
  it('título, campos en orden (nombre obligatorio, el resto opcional) y "Guardar cliente"', async () => {
    await mount();
    expect(document.querySelector('h1')!.textContent).toBe('Nuevo cliente');
    expect(labelDe('nombre')).toBe('Nombre');
    expect(labelDe('telefono')).toBe('Teléfono (opcional)');
    expect(labelDe('email')).toBe('Email (opcional)');
    expect(labelDe('direccion')).toBe('Dirección (opcional)');
    const orden = ['nombre', 'telefono', 'email', 'direccion'].map((n) => campo(n as never));
    for (let i = 1; i < orden.length; i++) {
      expect(orden[i - 1]!.compareDocumentPosition(orden[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(campo('nombre').getAttribute('aria-required')).toBe('true');
    expect(campo('telefono').type).toBe('tel');
    expect(campo('telefono').inputMode).toBe('tel');
    expect(campo('email').type).toBe('email');
    expect(campo('nombre').className).toContain('h-12');
    expect(buttonByText('Guardar cliente')!.className).toContain('h-14');
    expect(buttonByText('Eliminar cliente')).toBeUndefined(); // solo al editar
  });

  it('ningún campo ofrece autocompletado del navegador: son datos de un tercero, no del chofer', async () => {
    await mount();
    for (const nombre of ['nombre', 'telefono', 'email', 'direccion']) {
      expect(campo(nombre as never).getAttribute('autocomplete'), nombre).toBe('off');
    }
  });

  it('al abrirse pide SOLO la lista de clientes (para el aviso de duplicado) y no manda nada', async () => {
    await mount();
    expect(callsTo('clientes')).toHaveLength(1);
    expect(h.calls.filter((c) => c.table !== 'miembros')).toHaveLength(1);
  });

  it('el enlace de volver dice "Clientes" y vuelve a la lista con la búsqueda (saneada)', async () => {
    await mount({ pathname: NUEVO, state: { volver: '?q=alma&next=//evil.test' } });
    const volver = links().find((a) => a.textContent?.includes('Clientes'))!;
    expect(volver.getAttribute('href')).toBe('/clientes?q=alma');
  });
});

describe('alta de cliente: validación', () => {
  it('nombre vacío: error en el nombre, foco ahí y NO se manda nada', async () => {
    await mount();
    await guardar();
    expect(errorDe('nombre')).toBe('Escribe el nombre del cliente.');
    expect(document.activeElement).toBe(campo('nombre'));
    expect(inserts()).toHaveLength(0);
  });

  it('email sin forma de email: error en el email y foco ahí', async () => {
    await mount();
    await tipear(campo('nombre'), 'Distribuidora Este');
    await tipear(campo('email'), 'no tiene');
    await guardar();
    expect(errorDe('email')).toBe('Escribe un email válido, como nombre@empresa.test.');
    expect(document.activeElement).toBe(campo('email'));
    expect(inserts()).toHaveLength(0);
  });

  it('teléfono y dirección demasiado largos: un error en cada uno; tocar el campo borra su error', async () => {
    await mount();
    await tipear(campo('nombre'), 'Distribuidora Este');
    await tipear(campo('telefono'), '1'.repeat(51));
    await tipear(campo('direccion'), 'a'.repeat(301));
    await guardar();
    expect(errorDe('telefono')).toBe('El teléfono puede tener hasta 50 caracteres.');
    expect(errorDe('direccion')).toBe('La dirección puede tener hasta 300 caracteres.');
    expect(document.activeElement).toBe(campo('telefono'));
    await tipear(campo('telefono'), '351');
    expect(errorDe('telefono')).toBe('');
    expect(errorDe('direccion')).not.toBe('');
  });
});

describe('alta de cliente: guardar', () => {
  it('INSERT con las cuatro columnas (recortadas, null las vacías) y un client_ref; vuelve al detalle del nuevo con el aviso', async () => {
    await mount({ pathname: NUEVO, state: { volver: '?q=dis' } });
    await tipear(campo('nombre'), '  Distribuidora Este ');
    await tipear(campo('telefono'), ' 351 555-0000 ');
    await guardar();
    expect(inserts()).toHaveLength(1);
    const enviado = payloadOf(inserts()[0]!, 'insert');
    expect(enviado).toEqual({
      nombre: 'Distribuidora Este',
      contacto_telefono: '351 555-0000',
      contacto_email: null,
      direccion: null,
      client_ref: expect.stringMatching(UUID),
    });
    expect(enviado).not.toHaveProperty('id');
    expect(enviado).not.toHaveProperty('transportista_id');
    expect(destino('detalle')!.dataset.pathname).toBe(`/clientes/${C_NUEVO}`);
    expect(stateDe(destino('detalle'))).toEqual({ aviso: 'cliente-guardado', volver: '?q=dis' });
  });

  it('al guardar invalida la lista de clientes (la de la pantalla y la de los selectores)', async () => {
    await mount();
    await tipear(campo('nombre'), 'Distribuidora Este');
    await guardar();
    expect(invalido(clientesKeys.list('tenant-a'))).toBe(true);
  });

  it('doble toque: un solo INSERT', async () => {
    await mount();
    await tipear(campo('nombre'), 'Distribuidora Este');
    await act(async () => {
      buttonByText('Guardar cliente')!.click();
      buttonByText('Guardar cliente')?.click();
    });
    await settle(6);
    expect(inserts()).toHaveLength(1);
  });

  it('nombre repetido (sin tildes ni mayúsculas): NO guarda y avisa con "Guardar de todos modos" y "Ver ese cliente"', async () => {
    await mount({ pathname: NUEVO, state: { volver: '?q=a' } });
    await tipear(campo('nombre'), '  almacen   CENTRAL ');
    await guardar();
    expect(inserts()).toHaveLength(0);
    expect(bodyText()).toContain('Ya tienes un cliente llamado «Almacén Central».');
    const ver = links().find((a) => a.textContent?.includes('Ver ese cliente'))!;
    expect(ver.getAttribute('href')).toBe(`/clientes/${C_ALMACEN}`);
    expect(document.activeElement).toBe(campo('nombre'));
    expect(buttonByText('Guardar cliente')!.disabled).toBe(false); // el formulario sigue disponible
  });

  it('"Guardar de todos modos" crea el homónimo', async () => {
    await mount();
    await tipear(campo('nombre'), 'Almacén Central');
    await guardar();
    await click(buttonByText('Guardar de todos modos'));
    await settle(4);
    expect(inserts()).toHaveLength(1);
    expect(payloadOf(inserts()[0]!, 'insert').nombre).toBe('Almacén Central');
    expect(destino('detalle')).not.toBeNull();
  });

  it('seguir tipeando el nombre descarta el aviso de duplicado (era de OTRO nombre)', async () => {
    await mount();
    await tipear(campo('nombre'), 'Almacén Central');
    await guardar();
    expect(bodyText()).toContain('Ya tienes un cliente llamado');
    await tipear(campo('nombre'), 'Almacén Central Hnos');
    expect(bodyText()).not.toContain('Ya tienes un cliente llamado');
  });

  it('si falla por red: error con "Reintentar" y lo tipeado queda; el reintento manda el MISMO client_ref y, si ya estaba guardado, lo usa sin duplicar', async () => {
    let refGuardado: unknown = null;
    route.insertar = (call) => {
      const ref = payloadOf(call, 'insert').client_ref;
      if (refGuardado === ref) return refDuplicado();
      refGuardado = ref; // llegó a la base...
      return sinRed(); // ...pero se perdió la respuesta
    };
    route.porRef = (call) => ok(eqDe(call)[0]?.[1] === refGuardado ? { id: C_NUEVO, nombre: 'Distribuidora Este' } : null);
    await mount();
    await tipear(campo('nombre'), 'Distribuidora Este');
    await tipear(campo('email'), 'ventas@este.test');
    await guardar();
    expect(bodyText()).toContain('No hay conexión');
    expect(campo('nombre').value).toBe('Distribuidora Este');
    expect(campo('email').value).toBe('ventas@este.test');
    await click(buttonByText('Reintentar'));
    await settle(4);
    expect(inserts()).toHaveLength(2);
    expect(payloadOf(inserts()[1]!, 'insert').client_ref).toBe(payloadOf(inserts()[0]!, 'insert').client_ref);
    expect(lecturasPorRef()).toHaveLength(1);
    expect(updates()).toHaveLength(0);
    expect(destino('detalle')!.dataset.pathname).toBe(`/clientes/${C_NUEVO}`);
  });

  it('si cambió algo entre intentos: el reintento actualiza por client_ref con lo de ahora (sin mandar el client_ref)', async () => {
    let refGuardado: unknown = null;
    route.insertar = (call) => {
      const ref = payloadOf(call, 'insert').client_ref;
      if (refGuardado === ref) return refDuplicado();
      refGuardado = ref;
      return sinRed();
    };
    route.actualizar = () => ok([{ id: C_NUEVO, nombre: 'Distribuidora Este SA' }]);
    await mount();
    await tipear(campo('nombre'), 'Distribuidora Este');
    await guardar();
    await tipear(campo('nombre'), 'Distribuidora Este SA');
    await guardar();
    expect(updates()).toHaveLength(1);
    const upd = updates()[0]!;
    expect(eqDe(upd)).toEqual([['client_ref', refGuardado]]);
    expect(payloadOf(upd, 'update')).toEqual({ nombre: 'Distribuidora Este SA', contacto_telefono: null, contacto_email: null, direccion: null });
    expect(payloadOf(upd, 'update')).not.toHaveProperty('client_ref');
    expect(destino('detalle')!.dataset.pathname).toBe(`/clientes/${C_NUEVO}`);
  });

  it('un error de datos (check de la base) no ofrece "Reintentar" y no borra nada', async () => {
    route.insertar = () => fail('23514', 'new row violates check constraint "clientes_contacto_email_chk"');
    await mount();
    await tipear(campo('nombre'), 'Distribuidora Este');
    await guardar();
    expect(bodyText()).toContain('Alguno de los datos del cliente no es válido. Revísalos e inténtalo de nuevo.');
    expect(bodyText()).not.toContain('clientes_contacto_email_chk');
    expect(buttonByText('Reintentar')).toBeUndefined();
    expect(campo('nombre').value).toBe('Distribuidora Este');
  });

  it('si la lista de clientes no carga: error con "Reintentar" en vez del formulario', async () => {
    route.lista = () => sinRed();
    await mount();
    expect(bodyText()).toContain('No pudimos cargar tus clientes.');
    expect(byId('cliente-nombre')).toBeNull();
    route.lista = () => ok(LISTA);
    await click(buttonByText('Reintentar'));
    await settle(4);
    expect(byId('cliente-nombre')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Edición
// ---------------------------------------------------------------------------
describe('edición de cliente', () => {
  it('pide el cliente por id y precarga los campos; título "Editar cliente"; volver dice "Cliente" y va a su detalle', async () => {
    await mount({ pathname: EDITAR, state: { volver: '?q=alma' } });
    expect(document.querySelector('h1')!.textContent).toBe('Editar cliente');
    const detalle = clientesCon('maybeSingle')[0]!;
    expect(eqDe(detalle)).toEqual([['id', C_ALMACEN]]);
    expect(detalle.ops.find((o) => o.m === 'select')!.args[0]).not.toContain('client_ref');
    expect(campo('nombre').value).toBe('Almacén Central');
    expect(campo('telefono').value).toBe('351 555-1234');
    expect(campo('email').value).toBe('ventas@almacen.test');
    expect(campo('direccion').value).toBe('Ruta 9 km 12');
    const volver = links().find((a) => a.textContent?.includes('Cliente'))!;
    expect(volver.getAttribute('href')).toBe(`/clientes/${C_ALMACEN}`);
  });

  it('guardar: UPDATE por id con las cuatro columnas (vaciar un dato manda null), nunca client_ref; vuelve al detalle con el aviso', async () => {
    await mount({ pathname: EDITAR, state: { volver: '?q=alma' } });
    await tipear(campo('telefono'), '');
    await tipear(campo('direccion'), 'Ruta 8 km 5');
    await guardar();
    expect(inserts()).toHaveLength(0);
    expect(updates()).toHaveLength(1);
    expect(eqDe(updates()[0]!)).toEqual([['id', C_ALMACEN]]);
    const enviado = payloadOf(updates()[0]!, 'update');
    expect(enviado).toEqual({ nombre: 'Almacén Central', contacto_telefono: null, contacto_email: 'ventas@almacen.test', direccion: 'Ruta 8 km 5' });
    expect(enviado).not.toHaveProperty('client_ref');
    expect(destino('detalle')!.dataset.pathname).toBe(`/clientes/${C_ALMACEN}`);
    expect(stateDe(destino('detalle'))).toEqual({ aviso: 'cliente-guardado', volver: '?q=alma' });
  });

  it('al editar se refresca TODO lo que muestra el nombre del cliente, y nada más', async () => {
    await mount();
    await remount(EDITAR);
    await tipear(campo('nombre'), 'Almacén Central SA');
    await guardar();
    for (const key of [
      clientesKeys.list('tenant-a'),
      clientesKeys.vistas('tenant-a'),
      viajesKeys.vistas('tenant-a'),
      devolucionesKeys.delosViajes('tenant-a'),
      devolucionesKeys.delosMeses('tenant-a'),
    ]) {
      expect(invalido(key), JSON.stringify(key)).toBe(true);
    }
    for (const key of [
      viajesKeys.lists('tenant-a'),
      viajesKeys.all('tenant-a'),
      gastosKeys.all('tenant-a'),
      clientesKeys.all('tenant-a'),
      clientesKeys.detail('tenant-a', C_ALMACEN),
      devolucionesKeys.all('tenant-a'),
    ]) {
      expect(invalido(key), JSON.stringify(key)).toBe(false);
    }
  });

  it('también refresca si el guardado falla (la escritura pudo haberse aplicado igual)', async () => {
    route.actualizar = () => sinRed();
    await mount(EDITAR);
    await tipear(campo('nombre'), 'Almacén Central SA');
    await guardar();
    expect(bodyText()).toContain('No hay conexión');
    expect(invalido(devolucionesKeys.delosMeses('tenant-a'))).toBe(true);
    expect(invalido(viajesKeys.vistas('tenant-a'))).toBe(true);
  });

  it('renombrar como OTRO cliente avisa ("Ya tienes otro cliente llamado…") y no guarda', async () => {
    await mount(EDITAR);
    await tipear(campo('nombre'), 'bodega norte');
    await guardar();
    expect(updates()).toHaveLength(0);
    expect(bodyText()).toContain('Ya tienes otro cliente llamado «Bodega Norte».');
    await click(buttonByText('Guardar de todos modos'));
    await settle(4);
    expect(updates()).toHaveLength(1);
    expect(payloadOf(updates()[0]!, 'update').nombre).toBe('bodega norte');
  });

  it('el propio cliente no cuenta como duplicado: cambiar solo mayúsculas o tildes de su nombre, o solo el teléfono, no avisa', async () => {
    route.lista = () => ok([...LISTA, { id: 'a0000000-0000-4000-8000-0000000000cc', nombre: 'Almacén Central' }]); // con un homónimo
    await mount(EDITAR);
    await tipear(campo('telefono'), '351 000-0000');
    await guardar();
    expect(bodyText()).not.toContain('Ya tienes otro cliente');
    expect(updates()).toHaveLength(1);
    await remount(EDITAR);
    await tipear(campo('nombre'), 'ALMACEN central');
    await guardar();
    expect(bodyText()).not.toContain('Ya tienes otro cliente');
    expect(updates()).toHaveLength(2);
  });

  it('con la lista vieja (el propio cliente figura con otro nombre), volver a ese nombre NO avisa: el propio cliente nunca cuenta', async () => {
    // La lista en caché todavía tiene el nombre anterior de ESTE cliente (p.ej. se renombró desde otra pestaña).
    route.lista = () => ok([{ id: C_ALMACEN, nombre: 'Almacén Viejo' }, LISTA[1]!]);
    await mount(EDITAR);
    await tipear(campo('nombre'), 'Almacén Viejo');
    await guardar();
    expect(bodyText()).not.toContain('Ya tienes otro cliente');
    expect(updates()).toHaveLength(1);
    expect(payloadOf(updates()[0]!, 'update').nombre).toBe('Almacén Viejo');
  });

  it('si el cliente ya no existe al guardar (0 filas): "Cliente no encontrado"', async () => {
    route.actualizar = () => ok([]);
    await mount(EDITAR);
    await tipear(campo('nombre'), 'Almacén Central SA');
    await guardar();
    expect(bodyText()).toContain('Cliente no encontrado');
    expect(destino('detalle')).toBeNull();
  });

  it('un cliente que no existe (o es de otro transportista) -> "Cliente no encontrado"; un id que no es uuid ni se consulta', async () => {
    route.detalle = () => ok(null);
    await mount(EDITAR);
    expect(bodyText()).toContain('Cliente no encontrado');
    expect(byId('cliente-nombre')).toBeNull();
    h.calls.length = 0;
    await remount('/clientes/no-es-un-id/editar');
    expect(bodyText()).toContain('Cliente no encontrado');
    expect(callsTo('clientes')).toHaveLength(0);
  });

  it('el detalle de edición NO se refresca con el formulario abierto aunque se invaliden las listas', async () => {
    await mount(EDITAR);
    const lecturas = clientesCon('maybeSingle').length;
    await tipear(campo('nombre'), 'Lo que estoy tipeando');
    invalidateSpy.mockRestore();
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: clientesKeys.list('tenant-a') });
      await queryClient.invalidateQueries({ queryKey: clientesKeys.vistas('tenant-a') });
    });
    await settle(4);
    expect(clientesCon('maybeSingle').length).toBe(lecturas);
    expect(campo('nombre').value).toBe('Lo que estoy tipeando');
    invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  });
});

// ---------------------------------------------------------------------------
// Borrado
// ---------------------------------------------------------------------------
describe('eliminar cliente', () => {
  const pedirBorrado = () => click(buttonByText('Eliminar cliente'));

  it('al pedir la confirmación cuenta entregas y devoluciones (sin traer filas) y, sin ninguna, deja borrar', async () => {
    await mount({ pathname: EDITAR, state: { volver: '?q=alma' } });
    expect(callsTo('entregas')).toHaveLength(0); // no se cuenta hasta pedir la confirmación
    await pedirBorrado();
    for (const tabla of ['entregas', 'devoluciones']) {
      const [pedido] = callsTo(tabla);
      expect(pedido!.ops.find((o) => o.m === 'select')!.args).toEqual(['id', { count: 'exact', head: true }]);
      expect(eqDe(pedido!)).toEqual([['cliente_id', C_ALMACEN]]);
    }
    expect(bodyText()).toContain('¿Seguro? Esto no se puede deshacer.');
    await click(buttonByText('Sí, eliminar'));
    expect(deletes()).toHaveLength(1);
    expect(eqDe(deletes()[0]!)).toEqual([['id', C_ALMACEN]]);
    expect(destino('lista')!.dataset.search).toBe('?q=alma');
    expect(stateDe(destino('lista'))).toEqual({ aviso: 'cliente-eliminado' });
  });

  it('con entregas o devoluciones: NO aparece el botón de borrar, se explica con los números y "Entendido" cierra', async () => {
    route.contarEntregas = () => conteo(2);
    route.contarDevoluciones = () => conteo(1);
    await mount(EDITAR);
    await pedirBorrado();
    expect(bodyText()).toContain('No se puede eliminar: tiene 2 entregas y 1 devolución. Puedes renombrarlo.');
    expect(buttonByText('Sí, eliminar')).toBeUndefined();
    expect(buttons().some((b) => b.className.includes('destructive') && !b.className.includes('border-destructive'))).toBe(false);
    await click(buttonByText('Entendido'));
    expect(bodyText()).not.toContain('No se puede eliminar');
    expect(deletes()).toHaveLength(0);
  });

  it('solo con devoluciones también se bloquea', async () => {
    route.contarDevoluciones = () => conteo(3);
    await mount(EDITAR);
    await pedirBorrado();
    expect(bodyText()).toContain('No se puede eliminar: tiene 3 devoluciones. Puedes renombrarlo.');
    expect(buttonByText('Sí, eliminar')).toBeUndefined();
  });

  it('mientras cuenta, el botón de borrar espera (deshabilitado)', async () => {
    let soltar: () => void = () => {};
    route.contarEntregas = () =>
      new Promise((resolve) => {
        soltar = () => resolve(conteo(0));
      });
    await mount(EDITAR);
    await pedirBorrado();
    expect(bodyText()).toContain('Revisando si el cliente tiene entregas o devoluciones…');
    expect(buttonByText('Sí, eliminar')!.disabled).toBe(true);
    await act(async () => {
      soltar();
    });
    await settle(4);
    expect(buttonByText('Sí, eliminar')!.disabled).toBe(false);
  });

  it('si el conteo falla se puede intentar igual; con entregas, el 23503 (PostgreSQL 17) se explica y no ofrece reintentar', async () => {
    route.contarEntregas = () => sinRed();
    route.borrar = () => fail('23503', 'update or delete on table "clientes" violates foreign key constraint "entregas_cliente_fk" on table "entregas"');
    await mount(EDITAR);
    await pedirBorrado();
    expect(bodyText()).toContain('no se va a poder eliminar');
    await click(buttonByText('Sí, eliminar'));
    expect(deletes()).toHaveLength(1);
    expect(bodyText()).toContain('No se puede eliminar: este cliente tiene entregas o devoluciones. Puedes renombrarlo.');
    expect(bodyText()).not.toContain('entregas_cliente_fk');
    expect(buttonByText('Reintentar')).toBeUndefined();
    expect(buttonByText('Sí, eliminar')).toBeUndefined();
    expect(destino('lista')).toBeNull();
  });

  it('el 23001 de PostgreSQL 18 (restrict_violation) dice exactamente lo mismo', async () => {
    route.contarEntregas = () => sinRed();
    route.borrar = () => fail('23001', 'update or delete on table "clientes" violates RESTRICT setting of foreign key constraint "devoluciones_cliente_fk"');
    await mount(EDITAR);
    await pedirBorrado();
    await click(buttonByText('Sí, eliminar'));
    expect(bodyText()).toContain('No se puede eliminar: este cliente tiene entregas o devoluciones. Puedes renombrarlo.');
    expect(buttonByText('Reintentar')).toBeUndefined();
  });

  it('0 filas borradas (ya no estaba): para un borrado es lo mismo que éxito', async () => {
    route.borrar = () => ok([]);
    await mount(EDITAR);
    await pedirBorrado();
    await click(buttonByText('Sí, eliminar'));
    expect(stateDe(destino('lista'))).toEqual({ aviso: 'cliente-eliminado' });
  });

  it('al borrar se refrescan la lista y las vistas de clientes, pero NO los conteos de la confirmación', async () => {
    await mount(EDITAR);
    await pedirBorrado();
    await click(buttonByText('Sí, eliminar'));
    expect(invalido(clientesKeys.list('tenant-a'))).toBe(true);
    expect(invalido(clientesKeys.vistas('tenant-a'))).toBe(true);
    expect(invalido(clientesKeys.conteos('tenant-a', C_ALMACEN))).toBe(false);
    expect(invalido(clientesKeys.all('tenant-a'))).toBe(false);
  });

  it('los conteos se piden frescos cada vez que se abre la confirmación', async () => {
    await mount(EDITAR);
    await pedirBorrado();
    expect(callsTo('entregas')).toHaveLength(1);
    await click(buttonByText('Cancelar'));
    route.contarEntregas = () => conteo(1);
    await pedirBorrado();
    expect(callsTo('entregas')).toHaveLength(2);
    expect(bodyText()).toContain('No se puede eliminar: tiene 1 entrega. Puedes renombrarlo.');
  });
});
