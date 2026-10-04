import { act, useMemo, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation, type InitialEntry } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// La pestaña Devoluciones de /viajes. Mock de supabase: registra cada pedido y responde según `h.state.responder`. TODO lo
// demás (pantalla, pestañas, consulta, hooks, TanStack Query, router, resumen, filas) es código REAL del proyecto.
type Op = { m: string; args: unknown[] };
type Call = { target: string; ops: Op[] };

const h = vi.hoisted(() => {
  const calls: Array<{ target: string; ops: Array<{ m: string; args: unknown[] }> }> = [];
  const state = { responder: null as null | ((call: { target: string; ops: Array<{ m: string; args: unknown[] }> }) => unknown) };
  function from(table: string) {
    const call = { target: table, ops: [] as Array<{ m: string; args: unknown[] }> };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {};
    for (const m of ['select', 'eq', 'abortSignal', 'order', 'limit', 'gte', 'lt', 'maybeSingle']) {
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
  return { calls, state, from };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from: h.from } }));

import { AuthContext, type AuthContextValue } from '@/features/auth/auth-context';
import { MemberProvider } from '@/features/member/member-provider';
import { RequireMember } from '@/app/guards';
import { devolucionesKeys } from '@/features/devoluciones/devoluciones-keys';
import { ViajesPage } from '@/features/viajes/viajes-page';
import { currentMonth, formatMonthLabel } from '@/lib/dates';
import { queryClient } from '@/lib/query-client';

type Resp = { data: unknown; error: { message: string; code: string } | null; status: number };
const ok = (data: unknown): Resp => ({ data, error: null, status: 200 });
const sinRed = (): Resp => ({ data: null, error: { code: '', message: 'TypeError: Failed to fetch' }, status: 0 });

const MIEMBRO = {
  rol: 'admin',
  tema: 'dark',
  color_acento: '#F59E0B',
  transportista_id: 'tenant-a',
  transportistas: { nombre: 'Transportes A' },
};

const V1 = 'b0000000-0000-4000-8000-000000000001';
const V2 = 'b0000000-0000-4000-8000-000000000002';
const id = (n: number) => `f0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const fila = (n: number, over: Record<string, unknown> = {}) => ({
  id: id(n),
  motivo: 'rotura_danio',
  descripcion: null,
  cliente_id: 'a0000000-0000-4000-8000-000000000001',
  viaje_id: V1,
  created_at: '2025-08-15T10:00:00Z',
  clientes: { nombre: `Cliente ${n}` },
  viajes: { fecha: '2025-08-15', origen: 'Rosario', destino: 'Córdoba' },
  ...over,
});

// Ya vienen en el orden que da la base (fecha del viaje desc, created_at desc, id desc): la pantalla no reordena.
const FILAS = [
  fila(1, { motivo: 'rotura_danio', descripcion: 'Llegaron cajas rotas', clientes: { nombre: 'Almacén Central' } }),
  fila(2, { motivo: 'vencimiento', clientes: { nombre: 'Bodega Norte' }, viaje_id: V2, viajes: { fecha: '2025-08-10', origen: 'San Lorenzo', destino: 'Mendoza' } }),
  fila(3, { motivo: 'rotura_danio', clientes: { nombre: 'Cooperativa Sur' }, viaje_id: V2, viajes: { fecha: '2025-08-10', origen: 'San Lorenzo', destino: 'Mendoza' } }),
];

let lista: () => Resp = () => ok(FILAS);
let viajes: () => Resp = () => ok([]);

function installResponder() {
  h.state.responder = (call: Call) => {
    if (call.target === 'miembros' && call.ops.some((o) => o.m === 'maybeSingle')) return ok(MIEMBRO);
    if (call.target === 'devoluciones') return lista();
    if (call.target === 'viajes') return viajes();
    throw new Error(`pedido inesperado: ${call.target}`);
  };
}

const devolucionesCalls = () => h.calls.filter((c) => c.target === 'devoluciones');
const viajesCalls = () => h.calls.filter((c) => c.target === 'viajes');
const op = (call: Call, m: string) => call.ops.find((o) => o.m === m)!;

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

/** Deja a la vista dónde está el router: `search` y `state` (para ver el cambio de pestaña, de mes y el cierre del aviso). */
function Sonda() {
  const location = useLocation();
  return <div id="sonda" data-search={location.search} data-state={JSON.stringify(location.state ?? null)} />;
}

/** Pantallas a las que llevan las filas: muestran con qué `state` se llegó. */
function Destino({ nombre }: { nombre: string }) {
  const location = useLocation();
  return <div id={`destino-${nombre}`} data-pathname={location.pathname} data-state={JSON.stringify(location.state ?? null)} />;
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

async function mount(entry: InitialEntry = '/viajes?vista=devoluciones') {
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
                  <Route
                    path="/viajes"
                    element={
                      <>
                        <ViajesPage />
                        <Sonda />
                      </>
                    }
                  />
                  <Route path="/viajes/nuevo" element={<Destino nombre="nuevo" />} />
                  <Route path="/viajes/:viajeId/devoluciones/:id/editar" element={<Destino nombre="editar" />} />
                  <Route path="/viajes/:id" element={<Destino nombre="detalle" />} />
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

const bodyText = () => document.body.textContent ?? '';
const sonda = () => document.getElementById('sonda')!;
const links = () => [...document.querySelectorAll<HTMLAnchorElement>('a')];
const filas = () => [...document.querySelectorAll<HTMLLIElement>('ul > li')].filter((li) => li.querySelector('a'));
const principales = () => filas().map((li) => li.querySelectorAll('a')[0]!);
const franjas = () => filas().map((li) => li.querySelectorAll('a')[1]!);
const pestana = (texto: string) =>
  [...document.querySelectorAll<HTMLAnchorElement>('nav[aria-label="Viajes y devoluciones"] a')].find((a) => a.textContent === texto)!;
const buttonByText = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes(text));
const resumen = () => document.querySelector('section[aria-labelledby="devoluciones-resumen-titulo"]');
async function click(el: HTMLElement | null | undefined) {
  if (!el) throw new Error('no se encontró el elemento a tocar');
  await act(async () => {
    el.click();
  });
  await settle(4);
}

beforeEach(() => {
  h.calls.length = 0;
  lista = () => ok(FILAS);
  viajes = () => ok([]);
  installResponder();
  localStorage.clear();
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.scrollTo = (() => {}) as never;
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  container?.remove();
  queryClient.clear();
  // Ninguna prueba debe dejar warnings de React (act, anidamiento inválido de DOM, keys...).
  expect(errorSpy.mock.calls.map((c: unknown[]) => String(c[0]))).toEqual([]);
  vi.restoreAllMocks();
});

describe('pestaña Devoluciones: la pantalla', () => {
  it('el h1 sigue siendo "Viajes" y las dos pestañas están, con Devoluciones como la actual', async () => {
    await mount();
    expect(document.querySelectorAll('h1')).toHaveLength(1);
    expect(document.querySelector('h1')!.textContent).toBe('Viajes');
    expect(pestana('Devoluciones')!.getAttribute('aria-current')).toBe('page');
    expect(pestana('Viajes')!.hasAttribute('aria-current')).toBe(false);
  });

  it('la lista: una fila por devolución, en el orden en que llegó de la base', async () => {
    await mount();
    expect(filas()).toHaveLength(3);
    expect(principales().map((a) => a.querySelector('p')!.textContent)).toEqual(['Almacén Central', 'Bodega Norte', 'Cooperativa Sur']);
  });

  it('cada fila tiene sus dos enlaces: editar la devolución (principal) y el detalle del viaje (franja)', async () => {
    await mount();
    expect(principales().map((a) => a.getAttribute('href'))).toEqual([
      `/viajes/${V1}/devoluciones/${id(1)}/editar`,
      `/viajes/${V2}/devoluciones/${id(2)}/editar`,
      `/viajes/${V2}/devoluciones/${id(3)}/editar`,
    ]);
    expect(franjas().map((a) => a.getAttribute('href'))).toEqual([`/viajes/${V1}`, `/viajes/${V2}`, `/viajes/${V2}`]);
    expect(franjas()[1]!.textContent).toContain('San Lorenzo');
    expect(franjas()[1]!.textContent).toContain('10 ago');
  });

  it('el resumen: región con título, "N devoluciones" y el conteo por motivo (solo los que tienen)', async () => {
    await mount();
    const region = resumen()!;
    expect(region).not.toBeNull();
    const titulo = document.getElementById(region.getAttribute('aria-labelledby')!)!;
    expect(titulo.tagName).toBe('H2');
    expect(titulo.textContent).toBe(`Resumen de ${formatMonthLabel(currentMonth())}`);
    expect(region.textContent).toContain('3 devoluciones');
    expect(region.textContent).toContain('Rotura o daño 2 · Vencimiento 1');
    expect(region.textContent).not.toContain('Mercadería incorrecta');
    expect(region.textContent).not.toContain('Otro');
  });

  it('con una sola devolución dice "1 devolución" y un solo motivo', async () => {
    lista = () => ok([FILAS[0]]);
    await mount();
    expect(resumen()!.textContent).toContain('1 devolución');
    expect(resumen()!.textContent).not.toContain('1 devoluciones');
    expect(resumen()!.textContent).toContain('Rotura o daño 1');
  });

  it('sin buscador ni filtro: no hay campos de texto ni selectores', async () => {
    await mount();
    expect(document.querySelector('input, select, textarea, [role="searchbox"], [role="combobox"]')).toBeNull();
  });
});

describe('pestaña Devoluciones: la consulta', () => {
  it('con la pestaña Devoluciones pide UNA consulta de devoluciones con el rango del mes actual y NO pide la lista de viajes', async () => {
    await mount();
    expect(devolucionesCalls()).toHaveLength(1);
    expect(viajesCalls()).toHaveLength(0);
    const call = devolucionesCalls()[0]!;
    expect(op(call, 'select').args[0]).toContain('viajes!inner(fecha, origen, destino)');
    expect(op(call, 'gte').args).toEqual(['viajes.fecha', expect.stringMatching(/^\d{4}-\d{2}-01$/)]);
    expect(op(call, 'lt').args).toEqual(['viajes.fecha', expect.stringMatching(/^\d{4}-\d{2}-01$/)]);
    expect(op(call, 'limit').args).toEqual([201]);
  });

  it('con la pestaña Viajes (la de por defecto) pide la lista de viajes y NO pide devoluciones', async () => {
    await mount('/viajes');
    expect(viajesCalls()).toHaveLength(1);
    expect(devolucionesCalls()).toHaveLength(0);
  });

  it('un ?vista= inválido es la pestaña Viajes: tampoco pide devoluciones', async () => {
    await mount('/viajes?vista=Devoluciones');
    expect(devolucionesCalls()).toHaveLength(0);
    expect(viajesCalls()).toHaveLength(1);
  });

  it('?mes=2025-08 se respeta: consulta ese rango (por la fecha del viaje) y lo muestra', async () => {
    await mount('/viajes?vista=devoluciones&mes=2025-08');
    expect(bodyText()).toContain('agosto 2025');
    expect(op(devolucionesCalls()[0]!, 'gte').args).toEqual(['viajes.fecha', '2025-08-01']);
    expect(op(devolucionesCalls()[0]!, 'lt').args).toEqual(['viajes.fecha', '2025-09-01']);
  });

  it('un ?mes= inválido cae en el mes actual', async () => {
    await mount('/viajes?vista=devoluciones&mes=2999-01');
    expect(bodyText()).toContain(formatMonthLabel(currentMonth()));
  });

  it('cambiar de pestaña pide lo de la otra recién entonces: Viajes -> Devoluciones -> Viajes', async () => {
    await mount('/viajes');
    expect(devolucionesCalls()).toHaveLength(0);
    await click(pestana('Devoluciones'));
    expect(sonda().dataset.search).toBe('?vista=devoluciones');
    expect(devolucionesCalls()).toHaveLength(1);
    expect(filas()).toHaveLength(3);
    await click(pestana('Viajes'));
    expect(sonda().dataset.search).toBe('');
    expect(devolucionesCalls()).toHaveLength(1); // volver a Viajes no vuelve a pedir devoluciones
    expect(document.querySelector('nav[aria-label="Viajes y devoluciones"] a[aria-current="page"]')!.textContent).toBe('Viajes');
  });

  it('el selector de mes cambia el mes, vuelve a consultar con ese rango y conserva la pestaña en la URL (replace)', async () => {
    await mount('/viajes?vista=devoluciones');
    expect(document.querySelector<HTMLButtonElement>('button[aria-label="Mes siguiente"]')!.disabled).toBe(true);
    await click(document.querySelector('button[aria-label="Mes anterior"]') as HTMLElement);
    expect(devolucionesCalls()).toHaveLength(2);
    const anterior = op(devolucionesCalls()[1]!, 'gte').args[1] as string;
    const actual = op(devolucionesCalls()[0]!, 'gte').args[1] as string;
    expect(anterior < actual).toBe(true);
    expect(sonda().dataset.search).toMatch(/^\?vista=devoluciones&mes=\d{4}-\d{2}$/);
    expect(pestana('Devoluciones')!.getAttribute('aria-current')).toBe('page');
    // Las pestañas llevan el mes nuevo.
    expect(pestana('Viajes')!.getAttribute('href')).toMatch(/^\/viajes\?mes=\d{4}-\d{2}$/);
  });

  it('la caché de la lista cuelga de devolucionesKeys.delMes (el prefijo que invalidan las mutaciones)', async () => {
    await mount('/viajes?vista=devoluciones&mes=2025-08');
    const datos = queryClient.getQueryData(devolucionesKeys.delMes('tenant-a', '2025-08-01', '2025-09-01')) as { items: unknown[] };
    expect(datos.items).toHaveLength(3);
  });
});

describe('pestaña Devoluciones: sin "Nuevo viaje"', () => {
  it('con lista: ni en el encabezado ni fijo abajo, ni ningún enlace a /viajes/nuevo', async () => {
    await mount();
    expect(bodyText()).not.toContain('Nuevo viaje');
    expect(links().some((a) => a.getAttribute('href') === '/viajes/nuevo')).toBe(false);
    const raiz = container.querySelector('div.space-y-5')!;
    expect(raiz.querySelector('.max-md\\:hidden')).toBeNull(); // el encabezado no tiene acción
    expect(raiz.querySelector('.md\\:hidden')).toBeNull(); // ni barra fija
    expect(raiz.lastElementChild!.className).not.toContain('md:hidden'); // lo último de la pantalla no es la barra fija
  });

  it('vacía, cargando y con error: tampoco', async () => {
    lista = () => ok([]);
    await mount();
    expect(bodyText()).not.toContain('Nuevo viaje');
    expect(links().some((a) => a.getAttribute('href') === '/viajes/nuevo')).toBe(false);
    await act(async () => {
      root.unmount();
    });
    container.remove();
    queryClient.clear();

    lista = () => sinRed();
    await mount();
    expect(bodyText()).toContain('No hay conexión');
    expect(bodyText()).not.toContain('Nuevo viaje');
    expect(links().some((a) => a.getAttribute('href') === '/viajes/nuevo')).toBe(false);
  });

  it('la pestaña Viajes sigue teniendo "Nuevo viaje" (encabezado y barra fija)', async () => {
    // Con un viaje en la lista (sin lista, el estado vacío suma su propio botón).
    viajes = () => ok([{ id: V1, fecha: '2025-08-15', origen: 'Rosario', destino: 'Córdoba', km_inicial: null, km_final: null, km_recorridos: null, ingreso: null, created_at: '2025-08-15T10:00:00Z', entregas: [{ count: 0 }] }]);
    await mount('/viajes');
    expect(links().filter((a) => a.getAttribute('href') === '/viajes/nuevo')).toHaveLength(2);
  });
});

describe('pestaña Devoluciones: estados', () => {
  it('sin devoluciones: "No hay devoluciones en <mes>", explica dónde se cargan y ofrece ir a la pestaña Viajes del mismo mes; sin resumen', async () => {
    lista = () => ok([]);
    await mount('/viajes?vista=devoluciones&mes=2025-08');
    expect(bodyText()).toContain('No hay devoluciones en agosto 2025');
    expect(bodyText()).toContain('Las devoluciones se cargan desde el detalle de un viaje.');
    expect(resumen()).toBeNull();
    const vacio = document.querySelector('.border-dashed')!;
    const ir = [...vacio.querySelectorAll('a')].find((a) => a.textContent === 'Ir a Viajes')!;
    expect(ir.getAttribute('href')).toBe('/viajes?mes=2025-08');
  });

  it('el enlace del estado vacío se ve también en el celular (no está oculto debajo de md) y lleva a Viajes con el mes', async () => {
    lista = () => ok([]);
    await mount('/viajes?vista=devoluciones&mes=2025-08');
    const ir = [...document.querySelectorAll('a')].find((a) => a.textContent === 'Ir a Viajes')!;
    expect(ir.closest('.max-md\\:hidden')).toBeNull();
    await click(ir);
    expect(sonda().dataset.search).toBe('?mes=2025-08');
    expect(pestana('Viajes')!.getAttribute('aria-current')).toBe('page');
    expect(viajesCalls().length).toBeGreaterThan(0);
  });

  it('mientras carga muestra el esqueleto (sin lista ni resumen)', async () => {
    let soltar: () => void = () => {};
    const espera = new Promise<void>((resolve) => {
      soltar = resolve;
    });
    h.state.responder = (call: Call) => {
      if (call.target === 'miembros') return ok(MIEMBRO);
      return espera.then(() => ok(FILAS));
    };
    await mount();
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(bodyText()).toContain('Cargando…');
    expect(filas()).toHaveLength(0);
    expect(resumen()).toBeNull();
    soltar();
    await settle(4);
    expect(filas()).toHaveLength(3);
  });

  it('si falla: error en español con "Reintentar" que vuelve a pedir la lista', async () => {
    let intento = 0;
    lista = () => {
      intento += 1;
      return intento === 1 ? sinRed() : ok(FILAS);
    };
    await mount();
    expect(bodyText()).toContain('No hay conexión');
    expect(filas()).toHaveLength(0);
    await click(buttonByText('Reintentar'));
    expect(filas()).toHaveLength(3);
    expect(bodyText()).not.toContain('No hay conexión');
    expect(devolucionesCalls()).toHaveLength(2);
  });

  it('si ya había datos y el refresco falla: el aviso con "Reintentar" y la lista SIGUE debajo', async () => {
    await mount();
    expect(filas()).toHaveLength(3);
    lista = () => sinRed();
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: devolucionesKeys.delosMeses('tenant-a') });
    });
    await settle(4);
    expect(bodyText()).toContain('No hay conexión');
    expect(buttonByText('Reintentar')).toBeTruthy();
    expect(filas()).toHaveLength(3);
    expect(resumen()).not.toBeNull();
  });

  it('más de 200: se muestran 200, el resumen cuenta solo esas y se avisa que es parcial', async () => {
    const muchas = Array.from({ length: 201 }, (_, i) => fila(i + 1000, { motivo: i % 2 === 0 ? 'vencimiento' : 'otro' }));
    lista = () => ok(muchas);
    await mount();
    expect(filas()).toHaveLength(200);
    expect(bodyText()).toContain('Hay más de 200 devoluciones en este mes. Se muestran las 200 más recientes y el resumen solo suma esas.');
    expect(resumen()!.textContent).toContain('200 devoluciones (las más recientes)');
    expect(resumen()!.textContent).toContain('Vencimiento 100 · Otro 100'); // la 201 no suma (era "vencimiento")
  }, 60_000);

  it('exactamente 200: sin aviso', async () => {
    lista = () => ok(Array.from({ length: 200 }, (_, i) => fila(i + 1000)));
    await mount();
    expect(filas()).toHaveLength(200);
    expect(bodyText()).not.toContain('Hay más de 200 devoluciones');
    expect(resumen()!.textContent).toContain('200 devoluciones');
    expect(resumen()!.textContent).not.toContain('(las más recientes)');
  }, 60_000);
});

describe('pestaña Devoluciones: los enlaces de la fila desde la pantalla', () => {
  it('el principal abre la edición con el volver (pestaña y mes) y la marca de origen', async () => {
    await mount('/viajes?vista=devoluciones&mes=2025-08');
    await click(principales()[1]);
    const destino = document.getElementById('destino-editar')!;
    expect(destino.dataset.pathname).toBe(`/viajes/${V2}/devoluciones/${id(2)}/editar`);
    expect(JSON.parse(destino.dataset.state!)).toEqual({ volver: '?vista=devoluciones&mes=2025-08', origen: 'lista-devoluciones' });
  });

  it('la franja abre el detalle del viaje con el volver (pestaña y mes), sin marca de origen', async () => {
    await mount('/viajes?vista=devoluciones&mes=2025-08');
    await click(franjas()[0]);
    const destino = document.getElementById('destino-detalle')!;
    expect(destino.dataset.pathname).toBe(`/viajes/${V1}`);
    expect(JSON.parse(destino.dataset.state!)).toEqual({ volver: '?vista=devoluciones&mes=2025-08' });
  });

  it('con el mes actual el volver lleva solo la pestaña', async () => {
    await mount('/viajes?vista=devoluciones');
    await click(principales()[0]);
    expect(JSON.parse(document.getElementById('destino-editar')!.dataset.state!)).toEqual({ volver: '?vista=devoluciones', origen: 'lista-devoluciones' });
  });
});

describe('pestaña Devoluciones: aviso al volver de guardar o eliminar', () => {
  const cerrar = () => document.querySelector<HTMLButtonElement>('button[aria-label="Cerrar aviso"]');
  const aviso = (texto: string) => [...document.querySelectorAll('[role="status"]')].find((e) => e.textContent?.includes(texto));

  it('"Devolución guardada." con el estado de la navegación, en una región de estado', async () => {
    await mount({ pathname: '/viajes', search: '?vista=devoluciones&mes=2025-08', state: { aviso: 'devolucion-guardada' } });
    expect(aviso('Devolución guardada.')).toBeTruthy();
    expect(cerrar()!.className).toContain('h-12'); // objetivo táctil de 48 px
  });

  it('"Devolución eliminada."', async () => {
    await mount({ pathname: '/viajes', search: '?vista=devoluciones&mes=2025-08', state: { aviso: 'devolucion-eliminada' } });
    expect(aviso('Devolución eliminada.')).toBeTruthy();
  });

  it('la X cierra el aviso con replace y state: null, SIN perder la pestaña ni el mes', async () => {
    await mount({ pathname: '/viajes', search: '?vista=devoluciones&mes=2025-08', state: { aviso: 'devolucion-guardada' } });
    expect(sonda().dataset.search).toBe('?vista=devoluciones&mes=2025-08');
    await click(cerrar());
    expect(bodyText()).not.toContain('Devolución guardada.');
    expect(sonda().dataset.state).toBe('null');
    expect(sonda().dataset.search).toBe('?vista=devoluciones&mes=2025-08');
    expect(pestana('Devoluciones')!.getAttribute('aria-current')).toBe('page');
    expect(filas()).toHaveLength(3);
  });

  it('se cierra solo a los 5 segundos, también conservando la pestaña y el mes', async () => {
    const real = window.setTimeout.bind(window);
    let pendiente: (() => void) | null = null;
    vi.spyOn(window, 'setTimeout').mockImplementation(((fn: () => void, ms?: number, ...rest: unknown[]) => {
      if (ms === 5000) {
        pendiente = fn;
        return 12345 as never;
      }
      return real(fn, ms, ...(rest as []));
    }) as never);
    await mount({ pathname: '/viajes', search: '?vista=devoluciones&mes=2025-08', state: { aviso: 'devolucion-eliminada' } });
    expect(bodyText()).toContain('Devolución eliminada.');
    expect(pendiente).not.toBeNull();
    await act(async () => {
      pendiente!();
    });
    await settle(3);
    expect(bodyText()).not.toContain('Devolución eliminada.');
    expect(sonda().dataset.state).toBe('null');
    expect(sonda().dataset.search).toBe('?vista=devoluciones&mes=2025-08');
  });

  it('cambiar de pestaña descarta el aviso (la navegación no arrastra el state)', async () => {
    await mount({ pathname: '/viajes', search: '?vista=devoluciones', state: { aviso: 'devolucion-guardada' } });
    expect(bodyText()).toContain('Devolución guardada.');
    await click(pestana('Viajes'));
    expect(bodyText()).not.toContain('Devolución guardada.');
  });

  it('el aviso de devolución también se muestra si se llega a la pestaña Viajes (misma pantalla, mismos avisos)', async () => {
    await mount({ pathname: '/viajes', state: { aviso: 'devolucion-guardada' } });
    expect(bodyText()).toContain('Devolución guardada.');
  });

  it('los avisos de viaje de siempre se siguen mostrando ("Viaje guardado." / "Viaje eliminado.")', async () => {
    await mount({ pathname: '/viajes', state: { aviso: 'guardado' } });
    expect(bodyText()).toContain('Viaje guardado.');
    await act(async () => {
      root.unmount();
    });
    container.remove();
    await mount({ pathname: '/viajes', search: '?vista=devoluciones', state: { aviso: 'eliminado' } });
    expect(bodyText()).toContain('Viaje eliminado.');
  });

  it('un aviso desconocido, de otra pantalla (gasto, viaje del detalle) o con marcado NO se muestra', async () => {
    for (const raro of ['<b>hack</b>', 'gasto-guardado', 'viaje-guardado', 'devolucion', 'toString', '__proto__', 42, null, {}]) {
      await mount({ pathname: '/viajes', search: '?vista=devoluciones', state: { aviso: raro } });
      expect(bodyText(), JSON.stringify(raro)).not.toMatch(/Devolución (guardada|eliminada)|Viaje (guardado|eliminado)|Gasto|hack/);
      expect(document.querySelector('button[aria-label="Cerrar aviso"]'), JSON.stringify(raro)).toBeNull();
      await act(async () => {
        root.unmount();
      });
      container.remove();
      queryClient.clear();
      h.calls.length = 0;
    }
  });
});
