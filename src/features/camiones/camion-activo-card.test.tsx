import { act, useMemo, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, type InitialEntry } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// La tarjeta del camión activo en Inicio y la etiqueta "Camión activo" de la pantalla de Camiones (Etapa 5c). Mock de
// supabase; todo lo demás (pantallas, provider del miembro, TanStack Query, la mutación pesimista) es código real.
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
    for (const m of ['select', 'update', 'insert', 'delete', 'eq', 'neq', 'is', 'not', 'abortSignal', 'order', 'limit', 'maybeSingle']) {
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
import { InicioPage } from '@/features/home/inicio-page';
import { CamionesPage } from '@/features/camiones/camiones-page';
import { camionesKeys } from '@/features/camiones/camiones-keys';
import { CAMION_ARCHIVADO_MESSAGE, CAMION_ELEGIDO_NO_EXISTE_MESSAGE } from '@/features/camiones/constants';
import { queryClient } from '@/lib/query-client';

const ok = (data: unknown): Resp => ({ data, error: null, status: 200 });
const fail = (code: string, message: string, status = 400): Resp => ({ data: null, error: { code, message, details: '', hint: '' }, status });
const sinRed = (): Resp => ({ data: null, error: { code: '', message: 'TypeError: Failed to fetch' }, status: 0 });

const cid = (n: number) => `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
type Fila = { id: string; patente: string; marca: string | null; modelo: string | null; anio: number | null; activa: boolean };
const camion = (n: number, patente: string, over: Partial<Fila> = {}): Fila => ({ id: cid(n), patente, marca: null, modelo: null, anio: null, activa: true, ...over });
const A = camion(1, 'AB123CD', { marca: 'Scania', modelo: 'R450' });
const B = camion(2, 'ABC123');
const C = camion(3, 'CC333CC');
const D = camion(4, 'DD444DD');
const E = camion(5, 'EE555EE', { marca: 'Iveco' });
const X = camion(9, 'XY987ZW', { activa: false });

let LISTA: Fila[] = [];
let CAMION_ACTIVO: string | null = null;
let onCamiones: () => unknown = () => ok(LISTA);
let onUpdate: (call: Call) => unknown = () => ok([]);

function installResponder() {
  h.state.responder = (call: Call) => {
    const has = (m: string) => call.ops.some((o) => o.m === m);
    if (call.table === 'miembros' && has('maybeSingle')) {
      return ok({
        rol: 'admin',
        tema: 'dark',
        color_acento: '#F59E0B',
        transportista_id: 'tenant-a',
        camion_activo_id: CAMION_ACTIVO,
        transportistas: { nombre: 'Transportes A' },
      });
    }
    if (call.table === 'miembros' && has('update')) return onUpdate(call);
    if (call.table === 'camiones') return onCamiones();
    throw new Error(`pedido inesperado: ${call.table} ${call.ops.map((o) => o.m).join('.')}`);
  };
}

/** La base guarda lo mandado y devuelve la fila. */
function guardar(call: Call): Resp {
  const payload = call.ops.find((o) => o.m === 'update')!.args[0] as { camion_activo_id: string | null };
  CAMION_ACTIVO = payload.camion_activo_id;
  return ok([{ camion_activo_id: CAMION_ACTIVO }]);
}

type Deferred = { promise: Promise<Resp>; resolve: (r: Resp) => void };
function deferred(): Deferred {
  let resolve!: (r: Resp) => void;
  const promise = new Promise<Resp>((r) => (resolve = r));
  return { promise, resolve };
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

async function mount(entry: InitialEntry = '/') {
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
                  <Route path="/" element={<InicioPage />} />
                  <Route path="/camiones" element={<CamionesPage />} />
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
const tarjeta = () => document.querySelector<HTMLElement>('[role="region"]');
const tituloDe = (region: HTMLElement) => document.getElementById(region.getAttribute('aria-labelledby') ?? '')?.textContent ?? null;
const radios = () => [...document.querySelectorAll<HTMLInputElement>('input[type="radio"][id^="camion-activo-"]')];
const radioDe = (texto: string) => radios().find((r) => r.closest('label')?.textContent?.includes(texto));
const etiquetas = () => radios().map((r) => r.closest('label')!.textContent);
const marcado = () => radios().find((r) => r.checked)?.closest('label')?.textContent ?? null;
const select = () => document.querySelector<HTMLSelectElement>('select#camion-activo');
const estado = () => tarjeta()?.querySelector('[role="status"]')?.textContent ?? null;
const updates = () => h.calls.filter((c) => c.table === 'miembros' && c.ops.some((o) => o.m === 'update'));
const buttonByText = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes(text));
const PIDE_ELEGIR = 'Elige el camión con el que vas a trabajar.';

async function click(el: HTMLElement | null | undefined) {
  if (!el) throw new Error('no se encontró el elemento a tocar');
  await act(async () => {
    el.click();
  });
  await settle(5);
}
async function selectValue(el: HTMLSelectElement | null, value: string) {
  if (!el) throw new Error('no se encontró el selector');
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await settle(5);
}

let invalidadas: unknown[][] = [];
let invalidateSpy: ReturnType<typeof vi.spyOn>;
const invalidoCamiones = () => invalidadas.some((k) => JSON.stringify(k) === JSON.stringify(camionesKeys.list('tenant-a')));

beforeEach(() => {
  h.calls.length = 0;
  LISTA = [A, B];
  CAMION_ACTIVO = null;
  onCamiones = () => ok(LISTA);
  onUpdate = guardar;
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
// Cuándo aparece
// ---------------------------------------------------------------------------
describe('tarjeta del camión activo en Inicio: cuándo aparece', () => {
  it('mientras la lista de camiones carga: nada', async () => {
    onCamiones = () => new Promise(() => {});
    await mount();
    expect(tarjeta()).toBeNull();
    expect(bodyText()).not.toMatch(/Camión activo|Tu camión/);
  });

  it('si la lista no carga: nada (no se adivina)', async () => {
    onCamiones = () => sinRed();
    await mount();
    expect(tarjeta()).toBeNull();
    expect(bodyText()).toContain('¿Qué quieres hacer hoy?');
  });

  it('0 camiones: nada (sale "Carga tu camión", que es la excluyente)', async () => {
    LISTA = [];
    await mount();
    expect(tarjeta()).toBeNull();
    expect(bodyText()).toContain('Carga tu camión');
  });

  it('solo camiones archivados (0 activos): nada, y tampoco "Carga tu camión"', async () => {
    LISTA = [X];
    CAMION_ACTIVO = X.id;
    await mount();
    expect(tarjeta()).toBeNull();
    expect(bodyText()).not.toContain('Carga tu camión');
  });
});

// ---------------------------------------------------------------------------
// 1 camión activo
// ---------------------------------------------------------------------------
describe('tarjeta del camión activo: 1 solo camión activo', () => {
  it('"Tu camión" con la patente y marca/modelo, SIN control (solo lectura)', async () => {
    LISTA = [A, X];
    await mount();
    const region = tarjeta()!;
    expect(tituloDe(region)).toBe('Tu camión');
    expect(region.textContent).toContain('AB 123 CD');
    expect(region.textContent).toContain('Scania R450');
    expect(region.querySelectorAll('input, select, button')).toHaveLength(0);
    expect(region.textContent).not.toContain(PIDE_ELEGIR);
    expect(region.className).not.toContain('border-primary');
  });

  it('con un camión activo guardado que ya no sirve (archivado), igual: el único activo, sin pedir nada', async () => {
    LISTA = [A, X];
    CAMION_ACTIVO = X.id;
    await mount();
    expect(tituloDe(tarjeta()!)).toBe('Tu camión');
    expect(tarjeta()!.textContent).toContain('AB 123 CD');
    expect(updates()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 2 o más camiones activos
// ---------------------------------------------------------------------------
describe('tarjeta del camión activo: 2 o más camiones activos', () => {
  it('"Camión activo" con la explicación y botones de los ACTIVOS; el activo válido, marcado; sin destacar', async () => {
    LISTA = [B, A, X];
    CAMION_ACTIVO = B.id;
    await mount();
    const region = tarjeta()!;
    expect(tituloDe(region)).toBe('Camión activo');
    expect(region.textContent).toContain('Se usa en tus viajes y cargas de combustible nuevos. En cada registro puedes elegir otro.');
    expect(etiquetas()).toEqual(['AB 123 CD', 'ABC 123']); // ordenados, sin el archivado
    expect(marcado()).toBe('ABC 123');
    expect(region.textContent).not.toContain(PIDE_ELEGIR);
    expect(region.className).not.toContain('border-primary');
  });

  it('sin camión activo guardado: destacada, lo pide y ninguno marcado', async () => {
    await mount();
    const region = tarjeta()!;
    expect(region.className).toContain('border-primary');
    expect(region.textContent).toContain(PIDE_ELEGIR);
    expect(marcado()).toBeNull();
  });

  it('el guardado está ARCHIVADO (obsoleto): como si no hubiera; el archivado no se ofrece', async () => {
    LISTA = [A, B, X];
    CAMION_ACTIVO = X.id;
    await mount();
    expect(tarjeta()!.className).toContain('border-primary');
    expect(tarjeta()!.textContent).toContain(PIDE_ELEGIR);
    expect(marcado()).toBeNull();
    expect(etiquetas()).not.toContain('XY 987 ZW (archivado)');
    expect(etiquetas()).toHaveLength(2);
  });

  it('el guardado ya no existe en la lista (obsoleto): como si no hubiera', async () => {
    CAMION_ACTIVO = cid(77);
    await mount();
    expect(tarjeta()!.textContent).toContain(PIDE_ELEGIR);
    expect(marcado()).toBeNull();
  });

  it('5 o más activos: lista desplegable (con marca) con el activo elegido', async () => {
    LISTA = [A, B, C, D, E];
    CAMION_ACTIVO = E.id;
    await mount();
    const sel = select()!;
    expect(sel).not.toBeNull();
    expect(radios()).toHaveLength(0);
    expect(sel.value).toBe(E.id);
    expect([...sel.options].map((o) => o.textContent)).toContain('EE 555 EE · Iveco');
    expect(document.querySelector('label[for="camion-activo"]')!.textContent).toBe('Elige el camión');
  });

  it('5 o más sin activo válido: la lista sin elegir ("Elige el camión") y la tarjeta lo pide', async () => {
    LISTA = [A, B, C, D, E];
    await mount();
    expect(select()!.value).toBe('');
    expect(tarjeta()!.textContent).toContain(PIDE_ELEGIR);
  });

  it('accesibilidad: región con nombre (el título), grupo con su leyenda y una región de estado siempre presente', async () => {
    CAMION_ACTIVO = A.id;
    await mount();
    const region = tarjeta()!;
    expect(region.getAttribute('role')).toBe('region');
    expect(tituloDe(region)).toBe('Camión activo');
    expect(region.querySelector('fieldset legend')!.textContent).toBe('Elige el camión');
    const status = region.querySelector('[role="status"]')!;
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.textContent).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Elegir (pesimista)
// ---------------------------------------------------------------------------
describe('tarjeta del camión activo: elegir', () => {
  it('guarda SOLO el camion_activo_id de la fila propia; mientras tanto, deshabilitada y "Guardando…", sin marcar el nuevo', async () => {
    CAMION_ACTIVO = A.id;
    await mount();
    const d = deferred();
    onUpdate = () => d.promise;
    await click(radioDe('ABC 123'));
    expect(updates()).toHaveLength(1);
    const call = updates()[0]!;
    expect(call.ops.find((o) => o.m === 'update')!.args[0]).toEqual({ camion_activo_id: B.id });
    expect(call.ops.find((o) => o.m === 'eq')!.args).toEqual(['user_id', 'user-a']);
    // Pesimista: sigue marcado el de antes, la opción elegida dice "Guardando…" y todo está deshabilitado.
    expect(marcado()).toBe('AB 123 CD');
    expect(etiquetas()).toEqual(['AB 123 CD', 'ABC 123 · Guardando…']);
    expect(tarjeta()!.querySelector('fieldset')!.disabled).toBe(true);
    expect(estado()).toBe('Guardando…');
    // La base confirma.
    await act(async () => d.resolve(ok([{ camion_activo_id: B.id }])));
    await settle(5);
    expect(marcado()).toBe('ABC 123');
    expect(etiquetas()).toEqual(['AB 123 CD', 'ABC 123']);
    expect(tarjeta()!.querySelector('fieldset')!.disabled).toBe(false);
    expect(estado()).toBe('Camión activo: ABC 123.');
  });

  it('sin activo válido: al elegir deja de pedirlo y de destacarse', async () => {
    await mount();
    await click(radioDe('AB 123 CD'));
    expect(marcado()).toBe('AB 123 CD');
    expect(tarjeta()!.textContent).not.toContain(PIDE_ELEGIR);
    expect(tarjeta()!.className).not.toContain('border-primary');
  });

  it('con la lista desplegable también', async () => {
    LISTA = [A, B, C, D, E];
    CAMION_ACTIVO = A.id;
    await mount();
    await selectValue(select(), D.id);
    expect(updates()[0]!.ops.find((o) => o.m === 'update')!.args[0]).toEqual({ camion_activo_id: D.id });
    expect(select()!.value).toBe(D.id);
    expect(estado()).toBe('Camión activo: DD 444 DD.');
  });

  it('error de la base (55000, se archivó mientras tanto): mensaje propio, sin "Reintentar", queda el de antes y se refresca la lista', async () => {
    CAMION_ACTIVO = A.id;
    await mount();
    onUpdate = () => fail('55000', 'El camión está archivado (camion_archivado)');
    await click(radioDe('ABC 123'));
    const alerta = tarjeta()!.querySelector('[role="alert"]')!;
    expect(alerta.textContent).toContain(CAMION_ARCHIVADO_MESSAGE);
    expect(alerta.textContent).not.toContain('camion_archivado');
    expect(buttonByText('Reintentar')).toBeUndefined();
    expect(marcado()).toBe('AB 123 CD');
    expect(etiquetas()).toEqual(['AB 123 CD', 'ABC 123']);
    expect(tarjeta()!.querySelector('fieldset')!.disabled).toBe(false);
    expect(invalidoCamiones()).toBe(true);
  });

  it('23503 (el camión ya no existe): "El camión elegido ya no existe. Elige otro." sin "Reintentar"', async () => {
    CAMION_ACTIVO = A.id;
    await mount();
    onUpdate = () => fail('23503', 'violates foreign key constraint "miembros_camion_activo_fk"', 409);
    await click(radioDe('ABC 123'));
    expect(tarjeta()!.querySelector('[role="alert"]')!.textContent).toContain(CAMION_ELEGIDO_NO_EXISTE_MESSAGE);
    expect(buttonByText('Reintentar')).toBeUndefined();
    expect(marcado()).toBe('AB 123 CD');
  });

  it('sin red: el error con "Reintentar", que vuelve a mandar el MISMO camión', async () => {
    CAMION_ACTIVO = A.id;
    await mount();
    onUpdate = () => sinRed();
    await click(radioDe('ABC 123'));
    expect(tarjeta()!.querySelector('[role="alert"]')!.textContent).toContain('No hay conexión');
    expect(marcado()).toBe('AB 123 CD');
    onUpdate = guardar;
    await click(buttonByText('Reintentar'));
    expect(updates()).toHaveLength(2);
    expect(updates()[1]!.ops.find((o) => o.m === 'update')!.args[0]).toEqual({ camion_activo_id: B.id });
    expect(marcado()).toBe('ABC 123');
    expect(tarjeta()!.querySelector('[role="alert"]')).toBeNull();
  });

  it('elegir el que ya es el activo no manda nada', async () => {
    CAMION_ACTIVO = A.id;
    await mount();
    await click(radioDe('AB 123 CD'));
    expect(updates()).toHaveLength(0);
  });

  it('en la lista desplegable, un "cambio" al mismo camión (algunos selectores del sistema lo disparan) tampoco manda nada', async () => {
    LISTA = [A, B, C, D, E];
    CAMION_ACTIVO = C.id;
    await mount();
    await selectValue(select(), C.id);
    expect(updates()).toHaveLength(0);
    expect(estado()).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Pantalla de Camiones: la etiqueta
// ---------------------------------------------------------------------------
describe('pantalla de Camiones: etiqueta "Camión activo"', () => {
  const filaDe = (id: string) => document.querySelector(`a[href="/camiones/${id}/editar"]`)?.textContent ?? '';
  const cuantas = () => bodyText().split('Camión activo').length - 1;

  it('con 2 o más activos, solo en el activo válido', async () => {
    LISTA = [A, B, X];
    CAMION_ACTIVO = B.id;
    await mount('/camiones');
    expect(filaDe(B.id)).toContain('Camión activo');
    expect(filaDe(A.id)).not.toContain('Camión activo');
    expect(cuantas()).toBe(1);
  });

  it('con 1 solo activo, ninguna (aunque esté guardado)', async () => {
    LISTA = [A, X];
    CAMION_ACTIVO = A.id;
    await mount('/camiones');
    expect(cuantas()).toBe(0);
  });

  it('el guardado está archivado: ninguna (ni en el archivado)', async () => {
    LISTA = [A, B, X];
    CAMION_ACTIVO = X.id;
    await mount('/camiones');
    expect(cuantas()).toBe(0);
  });

  it('sin camión activo guardado: ninguna', async () => {
    LISTA = [A, B];
    await mount('/camiones');
    expect(cuantas()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Objetivo del recorrido de bienvenida (`data-ayuda="camion"`) y "Ver el recorrido otra vez"
// ---------------------------------------------------------------------------
describe('Inicio: lo que usa el recorrido de bienvenida', () => {
  const objetivos = () => [...document.querySelectorAll<HTMLElement>('[data-ayuda="camion"]')];

  it.each([
    ['0 camiones ("Carga tu camión")', [] as Fila[], 'Carga tu camión'],
    ['1 camión activo ("Tu camión")', [A], 'Tu camión'],
    ['2 o más ("Camión activo")', [A, B], 'Camión activo'],
  ])('la tarjeta del camión es el objetivo "camion" con %s, y es UNA sola', async (_caso, lista, titulo) => {
    LISTA = lista;
    await mount();
    expect(objetivos()).toHaveLength(1);
    expect(objetivos()[0]!.textContent).toContain(titulo);
  });

  it('el botón "Ver el recorrido otra vez" pide el recorrido (sube el contador) y no manda nada a la base', async () => {
    const { usePedidosDeRecorrido } = await import('@/features/ayuda/pedido-recorrido');
    const visto: { n: number } = { n: -1 };
    function Pedidos() {
      visto.n = usePedidosDeRecorrido();
      return null;
    }
    await mount();
    const otro = document.createElement('div');
    document.body.appendChild(otro);
    const otraRaiz = createRoot(otro);
    await act(async () => otraRaiz.render(<Pedidos />));
    const antes = visto.n;
    const llamadas = h.calls.length;
    await click(buttonByText('Ver el recorrido otra vez'));
    expect(visto.n).toBe(antes + 1);
    expect(h.calls.length).toBe(llamadas);
    expect(buttonByText('Ver el recorrido otra vez')!.type).toBe('button');
    await act(async () => otraRaiz.unmount());
    otro.remove();
  });
});
