import { act, useMemo, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock de supabase: registra cada pedido y responde segun la tabla. Todo lo demas es codigo REAL del proyecto.
type Op = { m: string; args: unknown[] };
type Call = { table: string; ops: Op[] };

const h = vi.hoisted(() => {
  const calls: Array<{ table: string; ops: Array<{ m: string; args: unknown[] }> }> = [];
  const state = { responder: null as null | ((call: { table: string; ops: Array<{ m: string; args: unknown[] }> }) => unknown) };
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
import { RequireMember } from '@/app/guards';
import { GastoFormPage } from '@/features/gastos/gasto-form-page';
import {
  DESCRIPCION_OBLIGATORIA_MESSAGE,
  GASTO_FIELD_ORDER,
  emptyGastoValues,
  esGastosVariosElegida,
  validateGastoForm,
  type GastoFormValues,
} from '@/features/gastos/gasto-form';
import { COMBUSTIBLE_CATEGORIA_ID, GASTOS_VARIOS_CATEGORIA_ID } from '@/features/gastos/constants';
import { isGastosVarios, type Categoria } from '@/features/gastos/categorias';
import { queryClient } from '@/lib/query-client';

const PEAJES_ID = '210b4f00-fdb4-499b-bf15-79ebe2aaf3c3';
const UREA_ID = '2fbf978b-cb94-4dcf-94d0-e9e3575025ac';
const PROPIA_ID = '99999999-9999-4999-8999-999999999999';

const CATS: Categoria[] = [
  { id: COMBUSTIBLE_CATEGORIA_ID, nombre: 'Combustible', activa: true, transportista_id: null },
  { id: GASTOS_VARIOS_CATEGORIA_ID, nombre: 'Gastos varios', activa: true, transportista_id: null },
  { id: PEAJES_ID, nombre: 'Peajes', activa: true, transportista_id: null },
  { id: UREA_ID, nombre: 'Urea/AdBlue', activa: true, transportista_id: null },
  // Categoria PROPIA que alguien llamo igual: NO debe exigir la descripcion.
  { id: PROPIA_ID, nombre: 'Gastos varios', activa: true, transportista_id: 'tenant-a' },
];
const TODAY = '2026-10-02';
const ctx = { categorias: CATS, today: TODAY };
const base = (over: Partial<GastoFormValues>): GastoFormValues => ({ ...emptyGastoValues(TODAY), monto: '1000', ...over });

// ---------------------------------------------------------------------------
// Logica pura
// ---------------------------------------------------------------------------
describe('validateGastoForm: descripcion obligatoria solo en Gastos varios', () => {
  it('Gastos varios con descripcion vacia -> error propio y el foco va a la descripcion', () => {
    const r = validateGastoForm(base({ categoriaId: GASTOS_VARIOS_CATEGORIA_ID }), ctx);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.descripcion).toBe('Escribe de qué se trata este gasto.');
    expect(r.errors.descripcion).toBe(DESCRIPCION_OBLIGATORIA_MESSAGE);
    expect(r.firstField).toBe('descripcion');
  });

  it('solo espacios (incluido NBSP y tabs) cuenta como vacia', () => {
    for (const blanks of ['   ', '  ', '\t \n']) {
      const r = validateGastoForm(base({ categoriaId: GASTOS_VARIOS_CATEGORIA_ID, descripcion: blanks }), ctx);
      expect(r.ok, JSON.stringify(blanks)).toBe(false);
      if (!r.ok) expect(r.errors.descripcion).toBe(DESCRIPCION_OBLIGATORIA_MESSAGE);
    }
  });

  it('Gastos varios con una palabra -> valido y se guarda recortada', () => {
    const r = validateGastoForm(base({ categoriaId: GASTOS_VARIOS_CATEGORIA_ID, descripcion: '  Lavado  ' }), ctx);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.columns.descripcion).toBe('Lavado');
  });

  it('Peajes, Urea/AdBlue y Combustible siguen con descripcion opcional (vacia = null)', () => {
    for (const categoriaId of [PEAJES_ID, UREA_ID]) {
      const r = validateGastoForm(base({ categoriaId }), ctx);
      expect(r.ok, categoriaId).toBe(true);
      if (r.ok) expect(r.columns.descripcion).toBeNull();
    }
    const fuel = validateGastoForm(base({ categoriaId: COMBUSTIBLE_CATEGORIA_ID, litros: '40' }), ctx);
    expect(fuel.ok).toBe(true);
    if (fuel.ok) expect(fuel.columns.descripcion).toBeNull();
  });

  it('una categoria PROPIA llamada "Gastos varios" no exige la descripcion', () => {
    const r = validateGastoForm(base({ categoriaId: PROPIA_ID }), ctx);
    expect(r.ok).toBe(true);
    expect(isGastosVarios(CATS.find((c) => c.id === PROPIA_ID))).toBe(false);
    expect(esGastosVariosElegida(PROPIA_ID, CATS)).toBe(false);
  });

  it('el id global pero con transportista_id no nulo (o dato ausente) NO cuenta como Gastos varios', () => {
    expect(isGastosVarios({ id: GASTOS_VARIOS_CATEGORIA_ID, transportista_id: 'tenant-a' })).toBe(false);
    expect(isGastosVarios(undefined)).toBe(false);
    expect(isGastosVarios(null)).toBe(false);
    expect(esGastosVariosElegida('', CATS)).toBe(false);
    expect(esGastosVariosElegida('no-existe', CATS)).toBe(false);
    expect(esGastosVariosElegida(GASTOS_VARIOS_CATEGORIA_ID, CATS)).toBe(true);
  });

  it('descripcion de mas de 2000 caracteres en Gastos varios -> error de largo, no el de obligatoria', () => {
    const r = validateGastoForm(base({ categoriaId: GASTOS_VARIOS_CATEGORIA_ID, descripcion: 'x'.repeat(2001) }), ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.descripcion).toMatch(/hasta 2000 caracteres/);
  });

  it('el foco sigue el orden visual: categoria -> descripcion -> monto', () => {
    expect(GASTO_FIELD_ORDER.slice(0, 3)).toEqual(['categoriaId', 'descripcion', 'monto']);
    const ambos = validateGastoForm(base({ categoriaId: GASTOS_VARIOS_CATEGORIA_ID, monto: '' }), ctx);
    expect(ambos.ok).toBe(false);
    if (!ambos.ok) {
      expect(Object.keys(ambos.errors).sort()).toEqual(['descripcion', 'monto']);
      expect(ambos.firstField).toBe('descripcion'); // arriba del monto
    }
    const sinCategoria = validateGastoForm(base({ categoriaId: '', monto: '' }), ctx);
    expect(sinCategoria.ok).toBe(false);
    if (!sinCategoria.ok) expect(sinCategoria.firstField).toBe('categoriaId');
    const soloMonto = validateGastoForm(base({ categoriaId: GASTOS_VARIOS_CATEGORIA_ID, descripcion: 'Lavado', monto: '' }), ctx);
    expect(soloMonto.ok).toBe(false);
    if (!soloMonto.ok) expect(soloMonto.firstField).toBe('monto');
  });
});

// ---------------------------------------------------------------------------
// Pantalla (codigo real; solo supabase esta mockeado)
// ---------------------------------------------------------------------------
const ok = (data: unknown) => ({ data, error: null, status: 200 });

function installResponder() {
  h.state.responder = (call: Call) => {
    if (call.table === 'miembros' && call.ops.some((o) => o.m === 'maybeSingle')) {
      return ok({
        rol: 'admin',
        tema: 'dark',
        color_acento: '#F59E0B',
        transportista_id: 'tenant-a',
        transportistas: { nombre: 'Transportes A' },
      });
    }
    if (call.table === 'categorias_gasto') return ok(CATS);
    if (call.table === 'gastos') return ok(null);
    throw new Error(`pedido inesperado: ${call.table} ${call.ops.map((o) => o.m).join('.')}`);
  };
}

const inserts = () => h.calls.filter((c) => c.table === 'gastos' && c.ops.some((o) => o.m === 'insert'));
const insertedRow = () => inserts()[0]!.ops.find((o) => o.m === 'insert')!.args[0] as Record<string, unknown>;

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

async function settle(times = 4) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

async function mountForm() {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <AuthHarness>
          <MemberProvider>
            <MemoryRouter initialEntries={['/gastos/nuevo']}>
              <RequireMember>
                <Routes>
                  <Route path="/gastos/nuevo" element={<GastoFormPage modo="nuevo" />} />
                  <Route path="/gastos" element={<div id="lista-de-gastos">lista</div>} />
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

const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T | null;
const radioOf = (categoriaId: string) => document.querySelector<HTMLInputElement>(`input[type="radio"][value="${categoriaId}"]`)!;
const labelOf = (controlId: string) => document.querySelector<HTMLLabelElement>(`label[for="${controlId}"]`)!;
const bodyText = () => document.body.textContent ?? '';
const guardar = () => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes('Guardar gasto'))!;

async function choose(categoriaId: string) {
  await act(async () => {
    radioOf(categoriaId).click();
  });
}
async function typeText(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function submit() {
  await act(async () => {
    guardar().click();
  });
  await settle(6);
}

beforeEach(() => {
  h.calls.length = 0;
  h.state.responder = null;
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

describe('formulario de gasto: la descripcion arriba del monto y obligatoria en Gastos varios', () => {
  it('orden en pantalla: Categoria -> Descripcion -> Monto -> Fecha -> Metodo de pago (la descripcion ya no queda al final)', async () => {
    installResponder();
    await mountForm();
    const cat = byId('gasto-categoria-0')!.closest('fieldset')!;
    const desc = byId('gasto-descripcion')!;
    const monto = byId('gasto-monto')!;
    const fecha = byId('gasto-fecha')!;
    const metodo = byId('gasto-metodo')!;
    expect(cat && desc && monto && fecha && metodo).toBeTruthy();
    const before = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(before(cat, desc)).toBe(true);
    expect(before(desc, monto)).toBe(true);
    expect(before(monto, fecha)).toBe(true);
    expect(before(fecha, metodo)).toBe(true);
    // Y despues de la descripcion no queda otro textarea (no esta duplicada al final).
    expect(document.querySelectorAll('textarea')).toHaveLength(1);
  });

  it('sin categoria o con una opcional: la etiqueta dice "(opcional)" y no hay ayuda de obligatoria', async () => {
    installResponder();
    await mountForm();
    expect(labelOf('gasto-descripcion').textContent).toContain('(opcional)');
    await choose(PEAJES_ID);
    expect(labelOf('gasto-descripcion').textContent).toContain('(opcional)');
    expect(bodyText()).not.toContain('Obligatoria en Gastos varios');
    expect(byId('gasto-descripcion')!.getAttribute('aria-required')).toBeNull();
  });

  it('Gastos varios: la etiqueta pierde "(opcional)", aparece la ayuda y el campo queda aria-required', async () => {
    installResponder();
    await mountForm();
    await choose(GASTOS_VARIOS_CATEGORIA_ID);
    expect(labelOf('gasto-descripcion').textContent).toBe('Descripción');
    expect(bodyText()).toContain('Obligatoria en Gastos varios: escribe de qué se trata.');
    expect(byId('gasto-descripcion')!.getAttribute('aria-required')).toBe('true');
    expect(byId('gasto-descripcion')!.getAttribute('aria-describedby')).toContain('gasto-descripcion-hint');
  });

  it('Gastos varios sin descripcion: error visible, foco en la descripcion, y NO se manda nada', async () => {
    installResponder();
    await mountForm();
    await choose(GASTOS_VARIOS_CATEGORIA_ID);
    await typeText(byId<HTMLInputElement>('gasto-monto')!, '500');
    await submit();
    expect(bodyText()).toContain('Escribe de qué se trata este gasto.');
    expect(byId('gasto-descripcion')!.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement?.id).toBe('gasto-descripcion');
    expect(inserts()).toHaveLength(0);
    expect(byId('lista-de-gastos')).toBeNull(); // sigue en el formulario
  });

  it('Gastos varios con descripcion: se guarda con esa descripcion (recortada) y vuelve a la lista', async () => {
    installResponder();
    await mountForm();
    await choose(GASTOS_VARIOS_CATEGORIA_ID);
    await typeText(byId<HTMLTextAreaElement>('gasto-descripcion')!, '  Lavado del camión  ');
    await typeText(byId<HTMLInputElement>('gasto-monto')!, '500');
    await submit();
    expect(inserts()).toHaveLength(1);
    const row = insertedRow();
    expect(row.descripcion).toBe('Lavado del camión');
    expect(row.categoria_id).toBe(GASTOS_VARIOS_CATEGORIA_ID);
    expect(row.monto).toBe(500);
    expect(byId('lista-de-gastos')).not.toBeNull();
  });

  it('Peajes sin descripcion se guarda igual (descripcion null)', async () => {
    installResponder();
    await mountForm();
    await choose(PEAJES_ID);
    await typeText(byId<HTMLInputElement>('gasto-monto')!, '800');
    await submit();
    expect(inserts()).toHaveLength(1);
    expect(insertedRow().descripcion).toBeNull();
    expect(bodyText()).not.toContain('Escribe de qué se trata este gasto.');
  });

  it('una categoria propia llamada "Gastos varios" no exige la descripcion', async () => {
    installResponder();
    await mountForm();
    await choose(PROPIA_ID);
    expect(labelOf('gasto-descripcion').textContent).toContain('(opcional)');
    await typeText(byId<HTMLInputElement>('gasto-monto')!, '300');
    await submit();
    expect(inserts()).toHaveLength(1);
    expect(insertedRow().descripcion).toBeNull();
  });

  it('ver el error de Gastos varios y cambiar a Peajes: el aviso desaparece (ya no es obligatoria) y se puede guardar', async () => {
    installResponder();
    await mountForm();
    await choose(GASTOS_VARIOS_CATEGORIA_ID);
    await typeText(byId<HTMLInputElement>('gasto-monto')!, '500');
    await submit();
    expect(bodyText()).toContain('Escribe de qué se trata este gasto.');

    await choose(PEAJES_ID);
    expect(bodyText()).not.toContain('Escribe de qué se trata este gasto.');
    expect(byId('gasto-descripcion')!.getAttribute('aria-invalid')).toBeNull();
    expect(labelOf('gasto-descripcion').textContent).toContain('(opcional)');

    await submit();
    expect(inserts()).toHaveLength(1);
    expect(insertedRow().categoria_id).toBe(PEAJES_ID);
  });

  it('el aviso de descripcion obligatoria se limpia al escribir, y tipear no lo vuelve a mostrar', async () => {
    installResponder();
    await mountForm();
    await choose(GASTOS_VARIOS_CATEGORIA_ID);
    await typeText(byId<HTMLInputElement>('gasto-monto')!, '500');
    await submit();
    expect(bodyText()).toContain('Escribe de qué se trata este gasto.');
    await typeText(byId<HTMLTextAreaElement>('gasto-descripcion')!, 'Lavado');
    expect(bodyText()).not.toContain('Escribe de qué se trata este gasto.');
  });

  it('volver a Gastos varios con la descripcion vacia la vuelve a exigir al guardar', async () => {
    installResponder();
    await mountForm();
    await choose(PEAJES_ID);
    await typeText(byId<HTMLInputElement>('gasto-monto')!, '500');
    await choose(GASTOS_VARIOS_CATEGORIA_ID);
    await submit();
    expect(inserts()).toHaveLength(0);
    expect(bodyText()).toContain('Escribe de qué se trata este gasto.');
  });
});
