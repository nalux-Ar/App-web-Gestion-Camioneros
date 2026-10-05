import { act, useMemo, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation, type InitialEntry } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock de supabase: registra cada pedido y responde según la tabla. TODO lo demás (pantalla, hooks, TanStack Query,
// router, búsqueda) es código REAL del proyecto.
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
import { ClientesPage } from '@/features/clientes/clientes-page';
import { queryClient } from '@/lib/query-client';

type Resp = { data: unknown; error: { message: string; code: string } | null; status: number };
const ok = (data: unknown): Resp => ({ data, error: null, status: 200 });
const sinRed = (): Resp => ({ data: null, error: { code: '', message: 'TypeError: Failed to fetch' }, status: 0 });

const MIEMBRO = { rol: 'admin', tema: 'dark', color_acento: '#F59E0B', transportista_id: 'tenant-a', transportistas: { nombre: 'Transportes A' } };
const id = (n: number) => `a0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
// Desordenados a propósito (la base ordena por `nombre` con mayúsculas primero): la pantalla los ordena en español.
const CLIENTES = [
  { id: id(1), nombre: 'almacén del puerto' },
  { id: id(2), nombre: 'Bodega Norte' },
  { id: id(3), nombre: 'Almacén Central' },
  { id: id(4), nombre: 'Cooperativa Agrícola' },
  { id: id(5), nombre: 'Distribuidora Este' },
];

const route = { clientes: (() => ok(CLIENTES)) as (call: Call) => unknown };

function installResponder() {
  h.state.responder = (call: Call) => {
    const has = (m: string) => call.ops.some((o) => o.m === m);
    if (call.table === 'miembros' && has('maybeSingle')) return ok(MIEMBRO);
    if (call.table === 'clientes') return route.clientes(call);
    throw new Error(`pedido inesperado: ${call.table} ${call.ops.map((o) => o.m).join('.')}`);
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

/** Dónde estamos: la ruta, el search y el state. */
function Estado() {
  const location = useLocation();
  return <span id="estado" data-pathname={location.pathname} data-search={location.search} data-state={JSON.stringify(location.state ?? null)} />;
}

function Destino({ nombre }: { nombre: string }) {
  const location = useLocation();
  return <div id={`destino-${nombre}`} data-state={JSON.stringify(location.state ?? null)} />;
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

async function mount(entry: InitialEntry = '/clientes') {
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
                  <Route path="/clientes" element={<ClientesPage />} />
                  <Route path="/clientes/nuevo" element={<Destino nombre="nuevo" />} />
                  <Route path="/clientes/:id" element={<Destino nombre="detalle" />} />
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

const byId = <T extends HTMLElement = HTMLElement>(elementId: string) => document.getElementById(elementId) as T | null;
const bodyText = () => document.body.textContent ?? '';
const buscador = () => byId<HTMLInputElement>('clientes-buscar');
const filas = () => [...document.querySelectorAll<HTMLAnchorElement>('ul li a[href^="/clientes/"]')];
const nombres = () => filas().map((a) => a.textContent?.trim());
const estado = () => byId('estado')!.dataset;
const conteo = () => document.querySelector('p[role="status"][aria-live="polite"]')?.textContent ?? '';
const buttonByText = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes(text));
const linksA = (href: string) => [...document.querySelectorAll<HTMLAnchorElement>('a')].filter((a) => a.getAttribute('href') === href);

async function click(el: HTMLElement | null | undefined) {
  if (!el) throw new Error('no se encontró el elemento a tocar');
  await act(async () => {
    el.click();
  });
  await settle(3);
}

async function tipear(el: HTMLInputElement | null, value: string) {
  if (!el) throw new Error('no se encontró el campo');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await settle(2);
}

beforeEach(() => {
  h.calls.length = 0;
  route.clientes = () => ok(CLIENTES);
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
  // Ninguna prueba debe dejar warnings de React (act, anidamiento inválido de DOM, keys...).
  expect(errorSpy.mock.calls.map((c: unknown[]) => String(c[0]))).toEqual([]);
  errorSpy.mockRestore();
});

describe('lista de Clientes', () => {
  it('título, todos los clientes en orden alfabético en español (sin distinguir mayúsculas ni tildes) y el conteo', async () => {
    await mount();
    expect(document.querySelector('h1')!.textContent).toBe('Clientes');
    expect(nombres()).toEqual(['Almacén Central', 'almacén del puerto', 'Bodega Norte', 'Cooperativa Agrícola', 'Distribuidora Este']);
    expect(conteo()).toBe('5 clientes');
  });

  it('pide UNA sola consulta, la misma lista que usan los selectores (id y nombre, con tope)', async () => {
    await mount();
    const pedidos = h.calls.filter((c) => c.table === 'clientes');
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]!.ops.find((o) => o.m === 'select')!.args).toEqual(['id, nombre']);
    expect(pedidos[0]!.ops.find((o) => o.m === 'limit')!.args).toEqual([501]);
    expect(h.calls.filter((c) => c.table !== 'clientes' && c.table !== 'miembros')).toHaveLength(0);
  });

  it('cada fila lleva al detalle del cliente (ruta con su id) con la búsqueda actual en el state, y es un área táctil grande', async () => {
    await mount();
    const fila = filas()[0]!;
    expect(fila.getAttribute('href')).toBe(`/clientes/${id(3)}`);
    expect(fila.className).toContain('min-h-14');
    await click(fila);
    expect(byId('destino-detalle')).not.toBeNull();
    expect(JSON.parse(byId('destino-detalle')!.dataset.state!)).toEqual({ volver: '' });
  });

  it('"Nuevo cliente": en el encabezado (desde md) y fijo abajo en el celular, a /clientes/nuevo con la búsqueda', async () => {
    await mount('/clientes?q=bodega');
    const nuevos = linksA('/clientes/nuevo');
    expect(nuevos).toHaveLength(2);
    expect(nuevos[0]!.closest('div')!.className).toContain('max-md:hidden');
    expect(nuevos[1]!.closest('.md\\:hidden')).not.toBeNull();
    await click(nuevos[1]);
    expect(JSON.parse(byId('destino-nuevo')!.dataset.state!)).toEqual({ volver: '?q=bodega' });
  });

  it('los nombres se muestran como texto: un nombre con HTML no se interpreta', async () => {
    route.clientes = () => ok([{ id: id(9), nombre: '<img src=x onerror=alert(1)><b>Hack</b>' }]);
    await mount();
    expect(nombres()).toEqual(['<img src=x onerror=alert(1)><b>Hack</b>']);
    expect(document.querySelector('ul li img')).toBeNull();
    expect(document.querySelector('ul li b')).toBeNull();
  });
});

describe('lista de Clientes: búsqueda local', () => {
  it('filtra al tipear, sin tildes ni mayúsculas, sin pedir nada a la base, y lo anuncia', async () => {
    await mount();
    const pedidosAntes = h.calls.length;
    await tipear(buscador(), 'ALMACEN');
    expect(nombres()).toEqual(['Almacén Central', 'almacén del puerto']);
    expect(conteo()).toBe('2 de 5 clientes');
    expect(h.calls.length).toBe(pedidosAntes); // búsqueda local
  });

  it('la búsqueda vive en la URL (?q=), sin apilar historial', async () => {
    await mount();
    await tipear(buscador(), 'bodega');
    expect(estado().search).toBe('?q=bodega');
    await tipear(buscador(), '');
    expect(estado().search).toBe('');
  });

  it('con ?q= en la URL arranca filtrada y con el texto en el campo', async () => {
    await mount('/clientes?q=coop');
    expect(buscador()!.value).toBe('coop');
    expect(nombres()).toEqual(['Cooperativa Agrícola']);
    expect(conteo()).toBe('1 de 5 clientes');
  });

  it('el enlace de una fila lleva la búsqueda en el state, para volver a la lista filtrada', async () => {
    await mount('/clientes?q=bodega');
    await click(filas()[0]);
    expect(JSON.parse(byId('destino-detalle')!.dataset.state!)).toEqual({ volver: '?q=bodega' });
  });

  it('un ?q= de más de 100 caracteres se corta a 100; el campo también tiene ese tope', async () => {
    await mount(`/clientes?q=${'a'.repeat(300)}`);
    expect(buscador()!.value).toHaveLength(100);
    expect(buscador()!.maxLength).toBe(100);
  });

  it('?q= con parámetros de más o texto raro: solo cuenta el q (como texto, nunca HTML) y NO se refleja en el título', async () => {
    await mount('/clientes?q=%3Cb%3Ezz%3C%2Fb%3E&next=//evil.test');
    expect(buscador()!.value).toBe('<b>zz</b>');
    // El título es fijo: lo de la URL solo se ve en el buscador (un enlace armado no elige el mensaje de la pantalla).
    expect(bodyText()).toContain('Ningún cliente coincide con tu búsqueda');
    expect(bodyText()).not.toContain('zz');
    expect(document.querySelector('h2 b, p b')).toBeNull();
  });

  it('sin resultados: lo dice y "Limpiar búsqueda" vuelve a todos, limpia la URL y deja el foco en el buscador', async () => {
    await mount();
    await tipear(buscador(), 'zzz');
    expect(filas()).toHaveLength(0);
    expect(bodyText()).toContain('Ningún cliente coincide con tu búsqueda');
    expect(bodyText()).not.toContain('zzz'); // lo tipeado se ve en el buscador, no en el título
    expect(buscador()!.value).toBe('zzz');
    expect(conteo()).toBe('0 de 5 clientes');
    await click(buttonByText('Limpiar búsqueda'));
    expect(nombres()).toHaveLength(5);
    expect(estado().search).toBe('');
    expect(document.activeElement).toBe(buscador());
  });

  it('el buscador tiene su etiqueta visible y es de 48 px', async () => {
    await mount();
    expect(document.querySelector('label[for="clientes-buscar"]')!.textContent).toBe('Buscar cliente');
    expect(buscador()!.className).toContain('h-12');
    expect(buscador()!.type).toBe('search');
  });
});

describe('lista de Clientes: estados', () => {
  it('sin clientes: explica cómo crearlos, sin buscador ni conteo', async () => {
    route.clientes = () => ok([]);
    await mount();
    expect(bodyText()).toContain('Todavía no tienes clientes');
    expect(bodyText()).toContain('al cargar una entrega en un viaje');
    expect(buscador()).toBeNull();
    expect(filas()).toHaveLength(0);
  });

  it('con más de 500 clientes avisa que se muestran (y se buscan) los primeros 500', async () => {
    route.clientes = () => ok(Array.from({ length: 501 }, (_, i) => ({ id: id(1000 + i), nombre: `Cliente ${String(i).padStart(3, '0')}` })));
    await mount();
    expect(filas()).toHaveLength(500);
    expect(bodyText()).toContain('Tienes más de 500 clientes: aquí se muestran (y se buscan) los primeros 500, por orden alfabético.');
  });

  it('si la lista no carga: error con "Reintentar" (nada de lista vacía engañosa), y al reintentar aparece', async () => {
    route.clientes = () => sinRed();
    await mount();
    expect(bodyText()).toContain('No hay conexión');
    expect(bodyText()).not.toContain('Todavía no tienes clientes');
    route.clientes = () => ok(CLIENTES);
    await click(buttonByText('Reintentar'));
    await settle(4);
    expect(nombres()).toHaveLength(5);
  });

  it('el aviso "Cliente eliminado." llega en el state, se puede cerrar y no se pierde la búsqueda', async () => {
    await mount({ pathname: '/clientes', search: '?q=bodega', state: { aviso: 'cliente-eliminado' } });
    expect(bodyText()).toContain('Cliente eliminado.');
    await click(document.querySelector<HTMLButtonElement>('button[aria-label="Cerrar aviso"]'));
    expect(bodyText()).not.toContain('Cliente eliminado.');
    expect(estado().search).toBe('?q=bodega');
  });

  it('cualquier otro aviso en el state se ignora', async () => {
    for (const aviso of ['cliente-guardado', 'eliminado', '<b>x</b>', 'toString']) {
      await mount({ pathname: '/clientes', state: { aviso } });
      expect(document.querySelector('button[aria-label="Cerrar aviso"]'), aviso).toBeNull();
      await act(async () => {
        root.unmount();
      });
      container.remove();
      queryClient.clear();
    }
  });
});
