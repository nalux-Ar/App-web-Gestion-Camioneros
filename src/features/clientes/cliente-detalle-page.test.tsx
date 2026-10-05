import { act, useMemo, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation, type InitialEntry } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock de supabase: registra cada pedido y responde según la tabla. Todo lo demás es código REAL del proyecto.
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
import { ClienteDetallePage } from '@/features/clientes/cliente-detalle-page';
import { clientesKeys } from '@/features/clientes/clientes-keys';
import { queryClient } from '@/lib/query-client';

type Resp = { data: unknown; error: { message: string; code: string } | null; status: number };
const ok = (data: unknown): Resp => ({ data, error: null, status: 200 });
const sinRed = (): Resp => ({ data: null, error: { code: '', message: 'TypeError: Failed to fetch' }, status: 0 });

const MIEMBRO = { rol: 'admin', tema: 'dark', color_acento: '#F59E0B', transportista_id: 'tenant-a', transportistas: { nombre: 'Transportes A' } };
const CLIENTE_ID = 'a0000000-0000-4000-8000-000000000001';
const V_1 = 'b0000000-0000-4000-8000-000000000001';
const V_2 = 'b0000000-0000-4000-8000-000000000002';
const D_1 = 'f0000000-0000-4000-8000-000000000001';
const D_2 = 'f0000000-0000-4000-8000-000000000002';

const cliente = (over: Record<string, unknown> = {}) => ({
  id: CLIENTE_ID,
  nombre: 'Almacén Central',
  contacto_telefono: '351 555-1234',
  contacto_email: 'ventas@almacen.test',
  direccion: 'Ruta 9 km 12',
  ...over,
});

const VIAJES = [
  {
    id: V_2,
    fecha: '2025-06-20',
    origen: 'Rosario',
    destino: 'Córdoba',
    entregas: [
      { id: 'e1', incidencias: 'Faltó un pallet' },
      { id: 'e2', incidencias: 'Llegó tarde' },
    ],
  },
  { id: V_1, fecha: '2024-12-02', origen: 'Pilar', destino: 'Villa María', entregas: [{ id: 'e3', incidencias: null }] },
];

const DEVOLUCIONES = [
  { id: D_2, motivo: 'otro', descripcion: 'El local estaba cerrado', viaje_id: V_2, created_at: '2025-06-21T10:00:00Z', viajes: { fecha: '2025-06-20', origen: 'Rosario', destino: 'Córdoba' } },
  { id: D_1, motivo: 'vencimiento', descripcion: null, viaje_id: V_1, created_at: '2024-12-03T10:00:00Z', viajes: { fecha: '2024-12-02', origen: 'Pilar', destino: 'Villa María' } },
];

type Handler = (call: Call) => unknown;
const route: { cliente: Handler; viajes: Handler; devoluciones: Handler } = {
  cliente: () => ok(cliente()),
  viajes: () => ok(VIAJES),
  devoluciones: () => ok(DEVOLUCIONES),
};

function installResponder() {
  h.state.responder = (call: Call) => {
    const has = (m: string) => call.ops.some((o) => o.m === m);
    if (call.table === 'miembros' && has('maybeSingle')) return ok(MIEMBRO);
    if (call.table === 'clientes' && has('maybeSingle')) return route.cliente(call);
    if (call.table === 'viajes') return route.viajes(call);
    if (call.table === 'devoluciones') return route.devoluciones(call);
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

function Destino({ nombre }: { nombre: string }) {
  const location = useLocation();
  return <div id={`destino-${nombre}`} data-pathname={location.pathname} data-search={location.search} data-state={JSON.stringify(location.state ?? null)} />;
}
function Estado() {
  const location = useLocation();
  return <span id="estado" data-state={JSON.stringify(location.state ?? null)} />;
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

const DETALLE = `/clientes/${CLIENTE_ID}`;

async function mount(entry: InitialEntry = DETALLE) {
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
                  <Route path="/clientes/:id" element={<ClienteDetallePage />} />
                  <Route path="/clientes/:id/editar" element={<Destino nombre="editar-cliente" />} />
                  <Route path="/clientes" element={<Destino nombre="lista" />} />
                  <Route path="/viajes/:id" element={<Destino nombre="viaje" />} />
                  <Route path="/viajes/:viajeId/devoluciones/:id/editar" element={<Destino nombre="editar-devolucion" />} />
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
const links = () => [...document.querySelectorAll<HTMLAnchorElement>('a')];
const linkTo = (href: string) => links().filter((a) => a.getAttribute('href') === href);
const section = (titulo: string) =>
  [...document.querySelectorAll('section')].find((s) => s.querySelector('h2')?.textContent?.startsWith(titulo)) as HTMLElement;
const stateOf = (el: Element | null) => JSON.parse((el as HTMLElement).dataset.state ?? 'null') as Record<string, unknown> | null;
const callsTo = (table: string) => h.calls.filter((c) => c.table === table);
const buttonByText = (text: string, dentro: ParentNode = document) =>
  [...dentro.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes(text));

async function click(el: HTMLElement | null | undefined) {
  if (!el) throw new Error('no se encontró el elemento a tocar');
  await act(async () => {
    el.click();
  });
  await settle(4);
}

beforeEach(() => {
  h.calls.length = 0;
  route.cliente = () => ok(cliente());
  route.viajes = () => ok(VIAJES);
  route.devoluciones = () => ok(DEVOLUCIONES);
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

describe('detalle de un cliente: datos y consultas', () => {
  it('el nombre es el título y se piden tres cosas en paralelo: el cliente, sus viajes y sus devoluciones', async () => {
    await mount();
    expect(document.querySelector('h1')!.textContent).toBe('Almacén Central');
    const [clientePedido] = callsTo('clientes');
    expect(clientePedido!.ops.find((o) => o.m === 'eq')!.args).toEqual(['id', CLIENTE_ID]);
    const [viajesPedido] = callsTo('viajes');
    expect(viajesPedido!.ops.find((o) => o.m === 'select')!.args[0]).toBe('id, fecha, origen, destino, entregas!inner(id, incidencias)');
    expect(viajesPedido!.ops.find((o) => o.m === 'eq')!.args).toEqual(['entregas.cliente_id', CLIENTE_ID]);
    const [devPedido] = callsTo('devoluciones');
    expect(devPedido!.ops.find((o) => o.m === 'eq')!.args).toEqual(['cliente_id', CLIENTE_ID]);
    // Solo lectura: nada de escrituras.
    expect(h.calls.some((c) => c.ops.some((o) => ['insert', 'update', 'delete'].includes(o.m)))).toBe(false);
  });

  it('un id en mayúsculas se consulta en minúsculas', async () => {
    await mount(`/clientes/${CLIENTE_ID.toUpperCase()}`);
    expect(callsTo('clientes')[0]!.ops.find((o) => o.m === 'eq')!.args).toEqual(['id', CLIENTE_ID]);
  });

  it('teléfono y email válidos son enlaces tel: y mailto: (armados con lo validado); la dirección es texto', async () => {
    await mount();
    const datos = section('Datos de contacto');
    const tel = datos.querySelector<HTMLAnchorElement>('a[href^="tel:"]')!;
    expect(tel.getAttribute('href')).toBe('tel:3515551234');
    expect(tel.textContent).toBe('351 555-1234');
    expect(tel.getAttribute('aria-label')).toBe('Llamar al 351 555-1234');
    expect(tel.className).toContain('min-h-12');
    const mail = datos.querySelector<HTMLAnchorElement>('a[href^="mailto:"]')!;
    expect(mail.getAttribute('href')).toBe('mailto:ventas@almacen.test');
    expect(datos.textContent).toContain('Ruta 9 km 12');
  });

  it('un teléfono o un email que no pasan la validación estricta se muestran como TEXTO, sin enlace', async () => {
    route.cliente = () => ok(cliente({ contacto_telefono: 'javascript:alert(1)', contacto_email: 'ventas@almacen.test?bcc=otro@evil.test' }));
    await mount();
    const datos = section('Datos de contacto');
    expect(datos.querySelectorAll('a[href^="tel:"], a[href^="mailto:"], a[href^="javascript:"]')).toHaveLength(0);
    expect(datos.textContent).toContain('javascript:alert(1)');
    expect(datos.textContent).toContain('ventas@almacen.test?bcc=otro@evil.test');
    for (const a of links()) expect(a.getAttribute('href') ?? '').not.toMatch(/^(javascript|data):/i);
  });

  it('un teléfono con una anotación se muestra tal cual, sin enlace', async () => {
    route.cliente = () => ok(cliente({ contacto_telefono: '351 555-1234 (pedir por Depósito)' }));
    await mount();
    expect(section('Datos de contacto').querySelector('a[href^="tel:"]')).toBeNull();
    expect(bodyText()).toContain('351 555-1234 (pedir por Depósito)');
  });

  it('sin datos de contacto lo dice; solo los que hay se muestran', async () => {
    route.cliente = () => ok(cliente({ contacto_telefono: null, contacto_email: null, direccion: null }));
    await mount();
    expect(section('Datos de contacto').textContent).toContain('Sin datos de contacto.');
    expect(document.querySelectorAll('dl')).toHaveLength(0);
    await act(async () => {
      root.unmount();
    });
    container.remove();
    queryClient.clear();
    route.cliente = () => ok(cliente({ contacto_email: null, direccion: null }));
    await mount();
    expect([...document.querySelectorAll('dt')].map((dt) => dt.textContent)).toEqual(['Teléfono']);
  });

  it('el nombre y los datos se muestran como texto (nunca HTML)', async () => {
    route.cliente = () => ok(cliente({ nombre: '<b>Hack</b>', direccion: '<img src=x onerror=alert(1)>' }));
    await mount();
    expect(document.querySelector('h1')!.textContent).toBe('<b>Hack</b>');
    expect(document.querySelector('h1 b, dd img')).toBeNull();
  });

  it('"Editar cliente" lleva a /clientes/<id>/editar con la búsqueda de la lista', async () => {
    await mount({ pathname: DETALLE, state: { volver: '?q=alma' } });
    const editar = linkTo(`/clientes/${CLIENTE_ID}/editar`)[0]!;
    expect(editar.textContent).toContain('Editar cliente');
    await click(editar);
    expect(stateOf(byId('destino-editar-cliente'))).toEqual({ volver: '?q=alma' });
  });

  it('el enlace "Clientes" vuelve a la lista con su búsqueda (saneada); un volver raro se descarta', async () => {
    await mount({ pathname: DETALLE, state: { volver: '?q=alma&next=//evil.test' } });
    const volver = links().find((a) => a.textContent?.includes('Clientes'))!;
    expect(volver.getAttribute('href')).toBe('/clientes?q=alma');
    expect(volver.className).toContain('min-h-12');
    await act(async () => {
      root.unmount();
    });
    container.remove();
    queryClient.clear();
    await mount({ pathname: DETALLE, state: { volver: 'https://evil.test' } });
    expect(links().find((a) => a.textContent?.includes('Clientes'))!.getAttribute('href')).toBe('/clientes');
  });
});

describe('detalle de un cliente: sus viajes', () => {
  it('título con la cantidad, cada viaje con su recorrido, la fecha con año y las incidencias de este cliente', async () => {
    await mount();
    const viajes = section('Viajes');
    expect(viajes.querySelector('h2')!.textContent).toBe('Viajes (2)');
    const filas = [...viajes.querySelectorAll<HTMLAnchorElement>('li a')];
    expect(filas.map((a) => a.getAttribute('href'))).toEqual([`/viajes/${V_2}`, `/viajes/${V_1}`]);
    expect(filas[0]!.textContent).toContain('Rosario');
    expect(filas[0]!.textContent).toContain('Córdoba');
    expect(filas[0]!.textContent).toContain('20 jun 2025');
    expect(filas[0]!.textContent).toContain('Incidencias: Faltó un pallet · Llegó tarde');
    expect(filas[1]!.textContent).toContain('2 dic 2024');
    expect(filas[1]!.textContent).not.toContain('Incidencias');
    expect(filas[0]!.className).toContain('min-h-16');
  });

  it('abrir un viaje lleva el cliente en el state (desdeCliente + la búsqueda de la lista), para volver acá', async () => {
    await mount({ pathname: DETALLE, state: { volver: '?q=alma' } });
    await click(section('Viajes').querySelector<HTMLAnchorElement>('li a'));
    expect(byId('destino-viaje')!.dataset.pathname).toBe(`/viajes/${V_2}`);
    expect(stateOf(byId('destino-viaje'))).toEqual({ desdeCliente: CLIENTE_ID, volverCliente: '?q=alma' });
  });

  it('sin viajes: lo dice', async () => {
    route.viajes = () => ok([]);
    await mount();
    expect(section('Viajes').querySelector('h2')!.textContent).toBe('Viajes');
    expect(section('Viajes').textContent).toContain('Todavía no hay viajes con entregas a este cliente.');
  });

  it('con más de 50: muestra los 50 más recientes, "50+" en el título y un aviso', async () => {
    route.viajes = () =>
      ok(Array.from({ length: 51 }, (_, i) => ({ id: `b1000000-0000-4000-8000-${String(i).padStart(12, '0')}`, fecha: '2025-06-01', origen: 'A', destino: 'B', entregas: [] })));
    await mount();
    expect(section('Viajes').querySelectorAll('li')).toHaveLength(50);
    expect(section('Viajes').querySelector('h2')!.textContent).toBe('Viajes (50+)');
    expect(section('Viajes').textContent).toContain('Se muestran los 50 viajes más recientes.');
  });

  it('si los viajes no cargan: error con "Reintentar" en SU sección; las devoluciones se ven igual', async () => {
    route.viajes = () => sinRed();
    await mount();
    expect(section('Viajes').textContent).toContain('No hay conexión');
    expect(section('Devoluciones').querySelectorAll('li')).toHaveLength(2);
    route.viajes = () => ok(VIAJES);
    await click(buttonByText('Reintentar', section('Viajes')));
    await settle(4);
    expect(section('Viajes').querySelectorAll('li')).toHaveLength(2);
  });

  it('un refresco fallido con la lista ya a la vista no la tapa: aviso arriba y la lista debajo', async () => {
    await mount();
    route.viajes = () => sinRed();
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: clientesKeys.viajesDelCliente('tenant-a', CLIENTE_ID) });
    });
    await settle(4);
    expect(section('Viajes').textContent).toContain('No hay conexión');
    expect(section('Viajes').querySelectorAll('li')).toHaveLength(2);
  });
});

describe('detalle de un cliente: sus devoluciones', () => {
  it('cada fila tiene DOS enlaces hermanos: editar la devolución (con origen "cliente") y el detalle del viaje', async () => {
    await mount({ pathname: DETALLE, state: { volver: '?q=alma' } });
    const devoluciones = section('Devoluciones');
    expect(devoluciones.querySelector('h2')!.textContent).toBe('Devoluciones (2)');
    const [primera] = [...devoluciones.querySelectorAll('li')];
    const enlaces = [...primera!.querySelectorAll<HTMLAnchorElement>(':scope > a')];
    expect(enlaces.map((a) => a.getAttribute('href'))).toEqual([`/viajes/${V_2}/devoluciones/${D_2}/editar`, `/viajes/${V_2}`]);
    expect(primera!.querySelectorAll('a a')).toHaveLength(0); // nunca un enlace dentro de otro
    expect(enlaces[0]!.textContent).toContain('Otro');
    expect(enlaces[0]!.textContent).toContain('El local estaba cerrado');
    expect(enlaces[1]!.textContent).toContain('Rosario');
    expect(enlaces[1]!.textContent).toContain('20 jun 2025');
  });

  it('editar una devolución lleva el origen "cliente" y el cliente en el state', async () => {
    await mount({ pathname: DETALLE, state: { volver: '?q=alma' } });
    await click(section('Devoluciones').querySelector<HTMLAnchorElement>('li > a'));
    expect(byId('destino-editar-devolucion')!.dataset.pathname).toBe(`/viajes/${V_2}/devoluciones/${D_2}/editar`);
    expect(stateOf(byId('destino-editar-devolucion'))).toEqual({ origen: 'cliente', desdeCliente: CLIENTE_ID, volverCliente: '?q=alma' });
  });

  it('la franja del viaje lleva al detalle del viaje con el cliente (sin origen)', async () => {
    await mount();
    const franja = section('Devoluciones').querySelectorAll<HTMLAnchorElement>('li > a')[1]!;
    await click(franja);
    expect(stateOf(byId('destino-viaje'))).toEqual({ desdeCliente: CLIENTE_ID, volverCliente: '' });
  });

  it('sin devoluciones: lo dice', async () => {
    route.devoluciones = () => ok([]);
    await mount();
    expect(section('Devoluciones').textContent).toContain('Este cliente no tiene devoluciones.');
  });

  it('con más de 50: "50+" y un aviso', async () => {
    route.devoluciones = () =>
      ok(
        Array.from({ length: 51 }, (_, i) => ({
          id: `f1000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
          motivo: 'vencimiento',
          descripcion: null,
          viaje_id: V_1,
          created_at: '2025-01-01T00:00:00Z',
          viajes: { fecha: '2025-01-01', origen: 'A', destino: 'B' },
        })),
      );
    await mount();
    expect(section('Devoluciones').querySelector('h2')!.textContent).toBe('Devoluciones (50+)');
    expect(section('Devoluciones').textContent).toContain('Se muestran las 50 devoluciones más recientes.');
  });

  it('si las devoluciones no cargan: error en SU sección; los viajes se ven igual', async () => {
    route.devoluciones = () => sinRed();
    await mount();
    expect(section('Devoluciones').textContent).toContain('No hay conexión');
    expect(section('Viajes').querySelectorAll('li')).toHaveLength(2);
  });
});

describe('detalle de un cliente: no encontrado, errores y avisos', () => {
  it('un cliente que no existe (o de otro transportista: la base no distingue) -> "Cliente no encontrado" con vuelta a la lista', async () => {
    route.cliente = () => ok(null);
    await mount({ pathname: DETALLE, state: { volver: '?q=x' } });
    expect(bodyText()).toContain('Cliente no encontrado');
    expect(linkTo('/clientes?q=x').some((a) => a.textContent?.includes('Volver a Clientes'))).toBe(true);
    expect(section('Viajes')).toBeUndefined();
  });

  it('un id que no es uuid: "no encontrado" SIN consultar nada', async () => {
    for (const ruta of ['/clientes/123', '/clientes/nuevo-x', `/clientes/${CLIENTE_ID}x`]) {
      h.calls.length = 0;
      await mount(ruta);
      expect(bodyText(), ruta).toContain('Cliente no encontrado');
      expect(h.calls.filter((c) => c.table !== 'miembros'), ruta).toHaveLength(0);
      await act(async () => {
        root.unmount();
      });
      container.remove();
      queryClient.clear();
    }
  });

  it('si el cliente no carga: error con "Reintentar" en vez de la pantalla', async () => {
    route.cliente = () => sinRed();
    await mount();
    expect(bodyText()).toContain('No hay conexión');
    expect(bodyText()).not.toContain('Cliente no encontrado');
    route.cliente = () => ok(cliente());
    await click(buttonByText('Reintentar'));
    await settle(4);
    expect(document.querySelector('h1')!.textContent).toBe('Almacén Central');
  });

  it('avisos de la lista blanca: "Cliente guardado." y los de devolución; al cerrarlo se conserva la búsqueda', async () => {
    await mount({ pathname: DETALLE, state: { aviso: 'cliente-guardado', volver: '?q=alma' } });
    expect(bodyText()).toContain('Cliente guardado.');
    await click(document.querySelector<HTMLButtonElement>('button[aria-label="Cerrar aviso"]'));
    expect(bodyText()).not.toContain('Cliente guardado.');
    expect(stateOf(byId('estado'))).toEqual({ volver: '?q=alma' });
    await act(async () => {
      root.unmount();
    });
    container.remove();
    queryClient.clear();
    await mount({ pathname: DETALLE, state: { aviso: 'devolucion-eliminada' } });
    expect(bodyText()).toContain('Devolución eliminada.');
  });

  it('cualquier otro aviso se ignora', async () => {
    await mount({ pathname: DETALLE, state: { aviso: 'cliente-eliminado' } });
    expect(document.querySelector('button[aria-label="Cerrar aviso"]')).toBeNull();
  });
});
