import { act, useMemo, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation, type InitialEntry } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// "Volver al cliente": el detalle de un viaje abierto desde el detalle de un cliente y todo lo que se abre desde él (editar
// el viaje, cargar un gasto, cargar o editar una devolución), más la edición de una devolución abierta directamente desde
// el cliente (origen `cliente`). Mock de supabase (tablas y rpc); TODO lo demás (pantallas, formularios, hooks, router) es
// código REAL del proyecto.
type Op = { m: string; args: unknown[] };
type Call = { target: string; ops: Op[] };

const h = vi.hoisted(() => {
  const calls: Array<{ target: string; ops: Array<{ m: string; args: unknown[] }> }> = [];
  const state = { responder: null as null | ((call: { target: string; ops: Array<{ m: string; args: unknown[] }> }) => unknown) };
  function builder(target: string, firstOp?: { m: string; args: unknown[] }) {
    const call = { target, ops: firstOp ? [firstOp] : ([] as Array<{ m: string; args: unknown[] }>) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {};
    for (const m of ['select', 'update', 'insert', 'delete', 'eq', 'abortSignal', 'order', 'limit', 'gte', 'lt', 'maybeSingle', 'single']) {
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
import { DevolucionFormPage } from '@/features/devoluciones/devolucion-form-page';
import { GastoFormPage } from '@/features/gastos/gasto-form-page';
import { ViajeDetallePage } from '@/features/viajes/viaje-detalle-page';
import { ViajeFormPage } from '@/features/viajes/viaje-form-page';
import { queryClient } from '@/lib/query-client';

type Resp = { data: unknown; error: { message: string; code: string } | null; status: number };
const ok = (data: unknown): Resp => ({ data, error: null, status: 200 });

const MIEMBRO = { rol: 'admin', tema: 'dark', color_acento: '#F59E0B', transportista_id: 'tenant-a', transportistas: { nombre: 'Transportes A' } };
const VIAJE = 'b0000000-0000-4000-8000-000000000001';
const CLIENTE = 'a0000000-0000-4000-8000-000000000001';
const DEV = 'f0000000-0000-4000-8000-000000000001';
const GASTO = 'e0000000-0000-4000-8000-000000000001';
const ENTREGA = 'd0000000-0000-4000-8000-000000000001';
const PEAJES = '7a000000-0000-4000-8000-000000000001';
const CLIENTES = [{ id: CLIENTE, nombre: 'Almacén Central' }];
const CATS = [{ id: PEAJES, nombre: 'Peajes', activa: true, transportista_id: 'tenant-a' }];

const base = {
  id: VIAJE,
  fecha: '2025-06-15',
  origen: 'Rosario',
  destino: 'Córdoba',
  km_inicial: null,
  km_final: null,
  km_recorridos: null,
  ingreso: null,
  observaciones: null,
};
const VISTA = { ...base, entregas: [{ id: ENTREGA, cliente_id: CLIENTE, incidencias: null, created_at: '2025-06-15T10:00:00Z', clientes: { nombre: 'Almacén Central' } }] };
const EDICION = { ...base, camion_id: null, entregas: [{ id: ENTREGA, cliente_id: CLIENTE, incidencias: null, created_at: '2025-06-15T10:00:00Z' }] };
const DEVOLUCIONES = [{ id: DEV, motivo: 'otro', descripcion: 'Cerrado', cliente_id: CLIENTE, created_at: '2025-06-16T10:00:00Z', clientes: { nombre: 'Almacén Central' } }];
const GASTOS = [{ id: GASTO, categoria_id: PEAJES, fecha: '2025-06-15', monto: 100, descripcion: null, litros: null, created_at: '2025-06-15T12:00:00Z' }];

const route = { devolucionDetalle: (() => ok({ id: DEV, viaje_id: VIAJE, cliente_id: CLIENTE, motivo: 'otro', descripcion: 'Cerrado' })) as () => unknown };

function installResponder() {
  h.state.responder = (call: Call) => {
    const has = (m: string) => call.ops.some((o) => o.m === m);
    const select = String(call.ops.find((o) => o.m === 'select')?.args[0] ?? '');
    if (call.target === 'miembros' && has('maybeSingle')) return ok(MIEMBRO);
    if (call.target === 'clientes') return ok(CLIENTES);
    if (call.target === 'categorias_gasto') return ok(CATS);
    if (call.target === 'camiones') return ok([]); // sin camiones: el viaje va sin camión, como antes

    if (call.target === 'rpc:actualizar_viaje_con_entregas') return ok(null);
    if (call.target === 'viajes') {
      if (!has('maybeSingle')) return ok([]); // los viajes recientes del selector de gastos
      // La vista trae el nombre del cliente de cada entrega; la edición no (las dos traen camion_id desde la Etapa 5).
      if (select.includes('clientes(nombre)')) return ok({ ...VISTA, camion_id: null });
      if (select.includes('camion_id') && select.includes('entregas(')) return ok(EDICION);
      return ok({ id: VIAJE, fecha: base.fecha, origen: base.origen, destino: base.destino }); // el viaje preseleccionado de un gasto
    }
    if (call.target === 'gastos') return has('insert') ? ok(null) : ok(GASTOS);
    if (call.target === 'devoluciones') {
      if (has('update') || has('delete')) return ok([{ id: DEV }]);
      if (has('insert')) return ok(null);
      if (has('maybeSingle')) return route.devolucionDetalle();
      return ok(DEVOLUCIONES);
    }
    throw new Error(`pedido inesperado: ${call.target} ${call.ops.map((o) => o.m).join('.')}`);
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

function Destino({ nombre }: { nombre: string }) {
  const location = useLocation();
  return <div id={`destino-${nombre}`} data-pathname={location.pathname} data-search={location.search} data-state={JSON.stringify(location.state ?? null)} />;
}
function Estado() {
  const location = useLocation();
  return <span id="estado" data-pathname={location.pathname} data-state={JSON.stringify(location.state ?? null)} />;
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

async function mount(entry: InitialEntry) {
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
                <Estado />
                <Routes>
                  <Route path="/viajes/:id" element={<ViajeDetallePage />} />
                  <Route path="/viajes/:id/editar" element={<ViajeFormPage modo="editar" />} />
                  <Route path="/viajes/:viajeId/devoluciones/nueva" element={<DevolucionFormPage modo="nuevo" />} />
                  <Route path="/viajes/:viajeId/devoluciones/:id/editar" element={<DevolucionFormPage modo="editar" />} />
                  <Route path="/gastos/nuevo" element={<GastoFormPage modo="nuevo" />} />
                  <Route path="/gastos/:id/editar" element={<Destino nombre="editar-gasto" />} />
                  <Route path="/clientes/:id" element={<Destino nombre="cliente" />} />
                  <Route path="/viajes" element={<Destino nombre="lista-viajes" />} />
                </Routes>
              </RequireMember>
            </MemoryRouter>
          </MemberProvider>
        </AuthHarness>
      </QueryClientProvider>,
    );
  });
  await settle(8);
}

const byId = <T extends HTMLElement = HTMLElement>(elementId: string) => document.getElementById(elementId) as T | null;
const bodyText = () => document.body.textContent ?? '';
const links = () => [...document.querySelectorAll<HTMLAnchorElement>('a')];
const linkConTexto = (texto: string) => links().find((a) => a.textContent?.trim().endsWith(texto));
const buttonByText = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes(text));
const estado = () => JSON.parse(byId('estado')!.dataset.state ?? 'null') as Record<string, unknown> | null;
const ruta = () => byId('estado')!.dataset.pathname;
/** El enlace de volver de la pantalla (el primero, arriba del título). */
const enlaceVolver = () => document.querySelector<HTMLAnchorElement>('a.min-h-12')!;

async function click(el: HTMLElement | null | undefined) {
  if (!el) throw new Error('no se encontró el elemento a tocar');
  await act(async () => {
    el.click();
  });
  await settle(8);
}

const DESDE_CLIENTE = { desdeCliente: CLIENTE, volverCliente: '?q=alma' };
const DETALLE_DESDE_CLIENTE: InitialEntry = { pathname: `/viajes/${VIAJE}`, state: DESDE_CLIENTE };

/** En el detalle del viaje: ¿el enlace de volver lleva al cliente? */
function esperarVolverAlCliente() {
  expect(ruta()).toBe(`/viajes/${VIAJE}`);
  const volver = enlaceVolver();
  expect(volver.textContent?.trim()).toBe('Cliente');
  expect(volver.getAttribute('href')).toBe(`/clientes/${CLIENTE}`);
}

beforeEach(() => {
  h.calls.length = 0;
  route.devolucionDetalle = () => ok({ id: DEV, viaje_id: VIAJE, cliente_id: CLIENTE, motivo: 'otro', descripcion: 'Cerrado' });
  installResponder();
  localStorage.clear();
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
  queryClient.clear();
  expect(errorSpy.mock.calls.map((c: unknown[]) => String(c[0]))).toEqual([]);
  errorSpy.mockRestore();
});

describe('detalle del viaje abierto desde un cliente', () => {
  it('el enlace de volver dice "Cliente" y lleva a ESE cliente con la búsqueda de su lista', async () => {
    await mount(DETALLE_DESDE_CLIENTE);
    esperarVolverAlCliente();
    await click(enlaceVolver());
    expect(byId('destino-cliente')!.dataset.pathname).toBe(`/clientes/${CLIENTE}`);
    expect(JSON.parse(byId('destino-cliente')!.dataset.state!)).toEqual({ volver: '?q=alma' });
  });

  it('sin cliente en el state, el enlace de volver sigue siendo "Viajes" (como siempre)', async () => {
    await mount({ pathname: `/viajes/${VIAJE}`, state: { volver: '?mes=2025-06' } });
    expect(enlaceVolver().textContent?.trim()).toBe('Viajes');
    expect(enlaceVolver().getAttribute('href')).toBe('/viajes?mes=2025-06');
  });

  it('un desdeCliente que no es un uuid se ignora (rutas, URLs, objetos): vuelve a "Viajes"', async () => {
    for (const raro of ['/clientes/x', '//evil.test', 'https://evil.test', `${CLIENTE}/../gastos`, { id: CLIENTE }, 42]) {
      await mount({ pathname: `/viajes/${VIAJE}`, state: { desdeCliente: raro, volverCliente: '?q=a' } });
      expect(enlaceVolver().textContent?.trim(), JSON.stringify(raro)).toBe('Viajes');
      expect(links().some((a) => (a.getAttribute('href') ?? '').startsWith('/clientes')), JSON.stringify(raro)).toBe(false);
      await act(async () => {
        root.unmount();
      });
      container.remove();
      queryClient.clear();
    }
  });

  it('un volverCliente raro se sanea: el enlace al cliente lleva solo un ?q= (o nada)', async () => {
    await mount({ pathname: `/viajes/${VIAJE}`, state: { desdeCliente: CLIENTE, volverCliente: 'https://evil.test' } });
    await click(enlaceVolver());
    expect(JSON.parse(byId('destino-cliente')!.dataset.state!)).toEqual({ volver: '' });
  });

  it('cerrar el aviso conserva el cliente (el enlace sigue diciendo "Cliente")', async () => {
    await mount({ pathname: `/viajes/${VIAJE}`, state: { ...DESDE_CLIENTE, aviso: 'viaje-guardado' } });
    expect(bodyText()).toContain('Viaje guardado.');
    await click(document.querySelector<HTMLButtonElement>('button[aria-label="Cerrar aviso"]'));
    expect(bodyText()).not.toContain('Viaje guardado.');
    expect(estado()).toEqual({ volver: '', ...DESDE_CLIENTE });
    esperarVolverAlCliente();
  });

  it('abrir un gasto del viaje lleva el cliente en el state', async () => {
    await mount(DETALLE_DESDE_CLIENTE);
    await click(links().find((a) => a.getAttribute('href') === `/gastos/${GASTO}/editar`));
    expect(JSON.parse(byId('destino-editar-gasto')!.dataset.state!)).toEqual({ desdeViaje: VIAJE, volverViaje: '', ...DESDE_CLIENTE });
  });
});

describe('lo que se abre desde ese detalle devuelve el cliente al volver', () => {
  it('editar el viaje: el enlace "Viaje" y el guardado vuelven al detalle con el cliente', async () => {
    await mount(DETALLE_DESDE_CLIENTE);
    await click(linkConTexto('Editar viaje'));
    expect(document.querySelector('h1')!.textContent).toBe('Editar viaje');
    expect(enlaceVolver().textContent?.trim()).toBe('Viaje');
    await click(buttonByText('Guardar viaje'));
    expect(bodyText()).toContain('Viaje guardado.');
    expect(estado()).toMatchObject({ aviso: 'viaje-guardado', ...DESDE_CLIENTE });
    esperarVolverAlCliente();
  });

  it('editar el viaje y volver sin guardar: el detalle sigue ofreciendo "Cliente"', async () => {
    await mount(DETALLE_DESDE_CLIENTE);
    await click(linkConTexto('Editar viaje'));
    await click(enlaceVolver());
    esperarVolverAlCliente();
  });

  it('cargar un gasto del viaje: guardarlo vuelve al detalle con el aviso y el cliente', async () => {
    await mount(DETALLE_DESDE_CLIENTE);
    await click(links().find((a) => a.getAttribute('href') === `/gastos/nuevo?viaje=${VIAJE}`));
    expect(document.querySelector('h1')!.textContent).toBe('Nuevo gasto');
    await click(document.querySelector<HTMLInputElement>('input[type="radio"][value="' + PEAJES + '"]'));
    const monto = document.getElementById('gasto-monto') as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(monto, '1500');
      monto.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(buttonByText('Guardar gasto'));
    expect(bodyText()).toContain('Gasto guardado.');
    expect(estado()).toMatchObject({ aviso: 'gasto-guardado', ...DESDE_CLIENTE });
    esperarVolverAlCliente();
  });

  it('cargar un gasto y volver sin guardar: el detalle sigue ofreciendo "Cliente"', async () => {
    await mount(DETALLE_DESDE_CLIENTE);
    await click(links().find((a) => a.getAttribute('href') === `/gastos/nuevo?viaje=${VIAJE}`));
    expect(enlaceVolver().textContent?.trim()).toBe('Viaje');
    await click(enlaceVolver());
    esperarVolverAlCliente();
  });

  it('editar una devolución del viaje (sin origen): guardar vuelve al DETALLE DEL VIAJE con el cliente', async () => {
    await mount(DETALLE_DESDE_CLIENTE);
    await click(links().find((a) => a.getAttribute('href') === `/viajes/${VIAJE}/devoluciones/${DEV}/editar`));
    expect(document.querySelector('h1')!.textContent).toBe('Editar devolución');
    expect(enlaceVolver().textContent?.trim()).toBe('Viaje');
    await click(buttonByText('Guardar devolución'));
    expect(bodyText()).toContain('Devolución guardada.');
    esperarVolverAlCliente();
  });

  it('cargar una devolución desde ese detalle: guardar vuelve al detalle con el cliente', async () => {
    await mount(DETALLE_DESDE_CLIENTE);
    await click(linkConTexto('Cargar devolución'));
    expect(document.querySelector('h1')!.textContent).toBe('Nueva devolución');
    await click(document.querySelector<HTMLInputElement>('input[type="radio"][value="vencimiento"]'));
    const select = document.getElementById('devolucion-cliente') as HTMLSelectElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, CLIENTE);
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await click(buttonByText('Guardar devolución'));
    expect(bodyText()).toContain('Devolución guardada.');
    esperarVolverAlCliente();
  });
});

describe('edición de una devolución abierta DESDE EL CLIENTE (origen "cliente")', () => {
  const EDITAR_DEV = `/viajes/${VIAJE}/devoluciones/${DEV}/editar`;
  const DESDE_EL_CLIENTE: InitialEntry = { pathname: EDITAR_DEV, state: { origen: 'cliente', ...DESDE_CLIENTE } };

  it('el enlace de volver dice "Cliente" y lleva a ese cliente', async () => {
    await mount(DESDE_EL_CLIENTE);
    expect(enlaceVolver().textContent?.trim()).toBe('Cliente');
    expect(enlaceVolver().getAttribute('href')).toBe(`/clientes/${CLIENTE}`);
  });

  it('guardar vuelve al detalle del cliente con "Devolución guardada" y la búsqueda de su lista', async () => {
    await mount(DESDE_EL_CLIENTE);
    await click(buttonByText('Guardar devolución'));
    expect(byId('destino-cliente')!.dataset.pathname).toBe(`/clientes/${CLIENTE}`);
    expect(JSON.parse(byId('destino-cliente')!.dataset.state!)).toEqual({ aviso: 'devolucion-guardada', volver: '?q=alma' });
  });

  it('borrar vuelve al detalle del cliente con "Devolución eliminada"', async () => {
    await mount(DESDE_EL_CLIENTE);
    await click(buttonByText('Eliminar devolución'));
    await click(buttonByText('Sí, eliminar'));
    expect(JSON.parse(byId('destino-cliente')!.dataset.state!)).toEqual({ aviso: 'devolucion-eliminada', volver: '?q=alma' });
  });

  it('el origen "cliente" sin un cliente válido no cuenta: vuelve al viaje, como siempre', async () => {
    for (const desdeCliente of [undefined, '/clientes/x', '//evil.test', 42]) {
      await mount({ pathname: EDITAR_DEV, state: { origen: 'cliente', desdeCliente } });
      expect(enlaceVolver().textContent?.trim(), String(desdeCliente)).toBe('Viaje');
      await click(buttonByText('Guardar devolución'));
      expect(byId('destino-cliente'), String(desdeCliente)).toBeNull();
      expect(ruta(), String(desdeCliente)).toBe(`/viajes/${VIAJE}`);
      await act(async () => {
        root.unmount();
      });
      container.remove();
      queryClient.clear();
    }
  });

  it('un origen parecido ("Cliente", "clientes") no cuenta aunque traiga un cliente válido', async () => {
    await mount({ pathname: EDITAR_DEV, state: { origen: 'clientes', ...DESDE_CLIENTE } });
    expect(enlaceVolver().textContent?.trim()).toBe('Viaje');
  });

  it('el origen solo vale al EDITAR: una devolución nueva vuelve al viaje (con el cliente, para su enlace)', async () => {
    await mount({ pathname: `/viajes/${VIAJE}/devoluciones/nueva`, state: { origen: 'cliente', ...DESDE_CLIENTE } });
    expect(enlaceVolver().textContent?.trim()).toBe('Viaje');
  });

  it('"Devolución no encontrada" abierta desde el cliente ofrece volver al cliente', async () => {
    route.devolucionDetalle = () => ok(null);
    await mount(DESDE_EL_CLIENTE);
    expect(bodyText()).toContain('Devolución no encontrada');
    const volver = links().find((a) => a.textContent?.includes('Volver al cliente'))!;
    expect(volver.getAttribute('href')).toBe(`/clientes/${CLIENTE}`);
  });
});
