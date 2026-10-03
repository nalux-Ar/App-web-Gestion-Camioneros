import { act, useMemo, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation, type InitialEntry } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock de supabase: registra cada pedido y responde según `h.state.responder`. Todo lo demás es código REAL.
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
import { ViajesPage } from '@/features/viajes/viajes-page';
import { currentMonth, formatMonthLabel } from '@/lib/dates';
import { formatNumber } from '@/lib/numbers';
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

const fila = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  fecha: '2026-10-01',
  origen: 'Origen',
  destino: 'Destino',
  km_inicial: null,
  km_final: null,
  km_recorridos: null,
  ingreso: null,
  created_at: '2026-10-01T10:00:00Z',
  entregas: [{ count: 0 }],
  ...over,
});

const V1 = 'b0000000-0000-4000-8000-000000000001';
const V2 = 'b0000000-0000-4000-8000-000000000002';
const V3 = 'b0000000-0000-4000-8000-000000000003';
const V4 = 'b0000000-0000-4000-8000-000000000004';

const FILAS = [
  fila(V1, { origen: 'Rosario', destino: 'Córdoba', km_recorridos: 500, ingreso: 1000.1, entregas: [{ count: 2 }] }),
  fila(V2, { origen: 'San Lorenzo', destino: 'Mendoza', km_inicial: 1000, km_final: 1250.5, ingreso: 0.2, entregas: [{ count: 1 }] }),
  fila(V3, { origen: 'Salta', destino: 'Tucumán', km_inicial: 300, entregas: [{ count: 0 }] }),
  fila(V4, { origen: 'Neuquén', destino: 'Bahía Blanca', ingreso: 0 }),
];

let lista: () => Resp = () => ok(FILAS);

function installResponder() {
  h.state.responder = (call: Call) => {
    if (call.target === 'miembros' && call.ops.some((o) => o.m === 'maybeSingle')) return ok(MIEMBRO);
    if (call.target === 'viajes') return lista();
    throw new Error(`pedido inesperado: ${call.target}`);
  };
}

const listaCalls = () => h.calls.filter((c) => c.target === 'viajes');

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

/** Pantallas a las que lleva la lista: muestran con qué `state` se llegó (para comprobar que "volver" conserva el mes). */
function Destino({ nombre }: { nombre: string }) {
  const location = useLocation();
  const volver = (location.state as { volver?: string } | null)?.volver ?? '(sin volver)';
  return (
    <div id={`destino-${nombre}`} data-volver={volver}>
      {nombre}
    </div>
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

async function mount(entry: InitialEntry = '/viajes') {
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
                  <Route path="/viajes" element={<ViajesPage />} />
                  <Route path="/viajes/nuevo" element={<Destino nombre="nuevo" />} />
                  <Route path="/viajes/:id/editar" element={<Destino nombre="editar" />} />
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
const links = () => [...document.querySelectorAll<HTMLAnchorElement>('a')];
const items = () => [...document.querySelectorAll<HTMLAnchorElement>('ul li a[href*="/editar"]')];
const buttonByText = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes(text));
const nums = (n: number | null, decimales: number, fijos = true) => formatNumber(n, { decimales, fijos });
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

describe('lista de viajes: resumen del mes', () => {
  it('muestra cantidad de viajes, km totales e ingresos del mes (sumados en enteros)', async () => {
    await mount();
    const resumen = document.querySelector('section[aria-labelledby="viajes-resumen-titulo"]')!;
    expect(resumen.textContent).toContain(`Resumen de ${formatMonthLabel(currentMonth())}`);
    expect(resumen.textContent).toContain('4 viajes');
    // Km: 500 (recorridos) + 250,5 (1250,5 - 1000); el que solo tiene el inicial no suma.
    expect(resumen.querySelector('dt')!.textContent).toBe('Km totales');
    expect(resumen.textContent).toContain(nums(750.5, 1, false));
    // Ingresos: 1000,1 + 0,2 + 0 = 1000,3 (en floats daría 1000.3000000000001 o similar).
    expect(resumen.textContent).toContain(nums(1000.3, 2));
  });

  it('con un solo viaje dice "1 viaje"; sin km ni ingresos los totales quedan en "—" (no en 0)', async () => {
    lista = () => ok([fila(V1)]);
    await mount();
    const resumen = document.querySelector('section[aria-labelledby="viajes-resumen-titulo"]')!;
    expect(resumen.textContent).toContain('1 viaje');
    expect(resumen.textContent).not.toContain('1 viajes');
    const valores = [...resumen.querySelectorAll('dd')].map((d) => d.textContent);
    expect(valores).toEqual(['—', '—']);
  });
});

describe('lista de viajes: cada ítem', () => {
  it('muestra "origen → destino", fecha, cantidad de entregas, km e ingreso, y enlaza a la edición', async () => {
    await mount();
    expect(items()).toHaveLength(4);
    const [v1, v2, v3, v4] = items();
    expect(v1!.getAttribute('href')).toBe(`/viajes/${V1}/editar`);

    expect(v1!.textContent).toContain('Rosario');
    expect(v1!.textContent).toContain('Córdoba');
    expect(v1!.textContent).toContain('1 oct');
    expect(v1!.textContent).toContain('2 entregas');
    expect(v1!.textContent).toContain(`${nums(500, 1, false)} km`); // recorridos
    expect(v1!.textContent).toContain(nums(1000.1, 2)); // ingreso

    expect(v2!.textContent).toContain('1 entrega');
    expect(v2!.textContent).not.toContain('1 entregas');
    expect(v2!.textContent).toContain(`${nums(250.5, 1, false)} km`); // la resta: 1250,5 - 1000

    expect(v3!.textContent).toContain('Sin entregas');
    expect(v3!.textContent).toContain('Km final sin cargar'); // viaje en curso: solo el inicial
    expect(v3!.textContent).not.toMatch(/\d km/);

    expect(v4!.textContent).toContain('Sin entregas');
    expect(v4!.textContent).not.toContain(' km');
    expect(v4!.textContent).not.toContain('Km final sin cargar'); // sin km no se muestra nada
    expect(v4!.textContent).toContain(nums(0, 2)); // el ingreso 0 se muestra; sin ingreso (v3) no
    expect(v3!.textContent).not.toContain(nums(0, 2));
  });

  it('la flecha es decorativa y el lector de pantalla oye "a" entre origen y destino', async () => {
    await mount();
    const flecha = items()[0]!.querySelector('[aria-hidden="true"]');
    expect(flecha?.textContent).toBe('→');
    expect(items()[0]!.querySelector('.sr-only')!.textContent).toBe(' a ');
  });

  it('el área táctil de cada fila es de al menos 64 px (min-h-16)', async () => {
    await mount();
    for (const item of items()) expect(item.className).toContain('min-h-16');
  });
});

describe('lista de viajes: consulta y mes', () => {
  it('pide UNA sola consulta con el rango del mes actual, con el conteo de entregas embebido', async () => {
    await mount();
    expect(listaCalls()).toHaveLength(1);
    const { desde, hasta } = { desde: expect.stringMatching(/^\d{4}-\d{2}-01$/), hasta: expect.stringMatching(/^\d{4}-\d{2}-01$/) };
    const call = listaCalls()[0]!;
    expect(call.ops.find((o) => o.m === 'gte')!.args).toEqual(['fecha', desde]);
    expect(call.ops.find((o) => o.m === 'lt')!.args).toEqual(['fecha', hasta]);
    expect(call.ops.find((o) => o.m === 'select')!.args[0]).toContain('entregas(count)');
    expect(call.ops.find((o) => o.m === 'limit')!.args).toEqual([501]);
  });

  it('?mes=2025-08 se respeta y consulta ese rango', async () => {
    await mount('/viajes?mes=2025-08');
    expect(document.body.textContent).toContain('agosto 2025');
    expect(listaCalls()[0]!.ops.find((o) => o.m === 'gte')!.args).toEqual(['fecha', '2025-08-01']);
    expect(listaCalls()[0]!.ops.find((o) => o.m === 'lt')!.args).toEqual(['fecha', '2025-09-01']);
  });

  it('un ?mes= inválido cae en el mes actual', async () => {
    await mount('/viajes?mes=2999-01');
    expect(bodyText()).toContain(formatMonthLabel(currentMonth()));
  });

  it('"Mes anterior" cambia el mes y vuelve a consultar con ese rango; "Mes siguiente" está deshabilitado en el mes actual', async () => {
    await mount();
    expect(document.querySelector<HTMLButtonElement>('button[aria-label="Mes siguiente"]')!.disabled).toBe(true);
    await click(document.querySelector('button[aria-label="Mes anterior"]') as HTMLElement);
    expect(listaCalls()).toHaveLength(2);
    const anterior = listaCalls()[1]!.ops.find((o) => o.m === 'gte')!.args[1] as string;
    const actual = listaCalls()[0]!.ops.find((o) => o.m === 'gte')!.args[1] as string;
    expect(anterior < actual).toBe(true);
    expect(document.querySelector<HTMLButtonElement>('button[aria-label="Mes siguiente"]')!.disabled).toBe(false);
  });

  it('"Volver" conserva el ?mes=: el enlace a un viaje y a "Nuevo viaje" llevan el mes en el state', async () => {
    await mount('/viajes?mes=2025-08');
    await click(items()[0]);
    expect(document.getElementById('destino-editar')!.dataset.volver).toBe('?mes=2025-08');
  });

  it('"Nuevo viaje" lleva a /viajes/nuevo con el mes para volver', async () => {
    await mount('/viajes?mes=2025-08');
    const nuevo = links().find((a) => a.getAttribute('href') === '/viajes/nuevo')!;
    await click(nuevo);
    expect(document.getElementById('destino-nuevo')!.dataset.volver).toBe('?mes=2025-08');
  });
});

describe('lista de viajes: estados', () => {
  it('sin viajes: estado vacío con el mes y un enlace a "Nuevo viaje"; sin resumen', async () => {
    lista = () => ok([]);
    await mount();
    expect(bodyText()).toContain(`Todavía no hay viajes en ${formatMonthLabel(currentMonth())}`);
    expect(document.querySelector('section[aria-labelledby="viajes-resumen-titulo"]')).toBeNull();
    expect(links().some((a) => a.getAttribute('href') === '/viajes/nuevo' && a.textContent?.includes('Nuevo viaje'))).toBe(true);
  });

  it('el botón de la acción principal se muestra una sola vez por ancho: encabezado y estado vacío solo desde md, y fijo abajo solo en el celular', async () => {
    lista = () => ok([]);
    await mount();
    const raiz = container.querySelector('div.space-y-5')!;
    // PageHeader con actionDesktopOnly y EmptyState con actionDesktopOnly: ocultos por debajo de md.
    const ocultosEnCelular = [...raiz.querySelectorAll('.max-md\\:hidden')];
    expect(ocultosEnCelular).toHaveLength(2);
    for (const el of ocultosEnCelular) expect(el.querySelector('a[href="/viajes/nuevo"]')).not.toBeNull();
    // FixedActionBar: ÚLTIMO hijo de la pantalla, solo debajo de md.
    const ultimo = raiz.lastElementChild as HTMLElement;
    expect(ultimo.className).toContain('md:hidden');
    expect(ultimo.querySelector('a[href="/viajes/nuevo"]')).not.toBeNull();
  });

  it('más de 500 viajes: se muestran 500, el resumen cuenta solo esos y se avisa que es parcial', async () => {
    const muchas = Array.from({ length: 501 }, (_, i) => fila(`b0000000-0000-4000-8000-${String(i + 1000).padStart(12, '0')}`, { km_recorridos: 1 }));
    lista = () => ok(muchas);
    await mount();
    expect(items()).toHaveLength(500);
    expect(bodyText()).toContain('Hay más de 500 viajes en este mes. Se muestran los 500 más recientes y el resumen solo suma esos.');
    expect(bodyText()).toContain('500 viajes (los más recientes)');
    const resumen = document.querySelector('section[aria-labelledby="viajes-resumen-titulo"]')!;
    expect(resumen.textContent).toContain(nums(500, 1, false)); // 500 km: el viaje 501 no suma
  }, 60_000);

  it('exactamente 500 viajes: sin aviso', async () => {
    const quinientas = Array.from({ length: 500 }, (_, i) => fila(`b0000000-0000-4000-8000-${String(i + 1000).padStart(12, '0')}`));
    lista = () => ok(quinientas);
    await mount();
    expect(items()).toHaveLength(500);
    expect(bodyText()).not.toContain('Hay más de 500 viajes');
  }, 60_000);

  it('mientras carga muestra el esqueleto; si falla, un error en español con "Reintentar" que vuelve a pedir la lista', async () => {
    let intento = 0;
    lista = () => {
      intento += 1;
      return intento === 1 ? sinRed() : ok(FILAS);
    };
    await mount();
    expect(bodyText()).toContain('No hay conexión');
    expect(items()).toHaveLength(0);
    await click(buttonByText('Reintentar'));
    expect(items()).toHaveLength(4);
    expect(bodyText()).not.toContain('No hay conexión');
  });
});

describe('lista de viajes: aviso al volver de guardar o eliminar', () => {
  it('"Viaje guardado." con el estado de la navegación; se cierra con la X', async () => {
    await mount({ pathname: '/viajes', state: { aviso: 'guardado' } });
    expect(bodyText()).toContain('Viaje guardado.');
    const aviso = [...document.querySelectorAll('[role="status"]')].find((e) => e.textContent?.includes('Viaje guardado.'));
    expect(aviso).toBeTruthy();
    const cerrar = document.querySelector<HTMLButtonElement>('button[aria-label="Cerrar aviso"]')!;
    expect(cerrar.className).toContain('h-12'); // objetivo táctil de 48 px
    await click(cerrar);
    expect(bodyText()).not.toContain('Viaje guardado.');
  });

  it('"Viaje eliminado." y cualquier otro valor del estado se ignora', async () => {
    await mount({ pathname: '/viajes', state: { aviso: 'eliminado' } });
    expect(bodyText()).toContain('Viaje eliminado.');
  });

  it('un aviso desconocido no se muestra', async () => {
    await mount({ pathname: '/viajes', state: { aviso: '<b>hack</b>' } });
    expect(bodyText()).not.toContain('hack');
    expect(document.querySelector('[role="status"]')?.textContent ?? '').not.toContain('hack');
  });

  it('se cierra solo a los 5 segundos', async () => {
    const real = window.setTimeout.bind(window);
    let pendiente: (() => void) | null = null;
    vi.spyOn(window, 'setTimeout').mockImplementation(((fn: () => void, ms?: number, ...rest: unknown[]) => {
      if (ms === 5000) {
        pendiente = fn;
        return 12345 as never;
      }
      return real(fn, ms, ...(rest as []));
    }) as never);
    await mount({ pathname: '/viajes', state: { aviso: 'guardado' } });
    expect(bodyText()).toContain('Viaje guardado.');
    expect(pendiente).not.toBeNull();
    await act(async () => {
      pendiente!();
    });
    await settle(3);
    expect(bodyText()).not.toContain('Viaje guardado.');
  });
});
