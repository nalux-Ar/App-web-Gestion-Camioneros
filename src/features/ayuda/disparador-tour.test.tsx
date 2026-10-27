import { act, Suspense, useMemo, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// El disparador del recorrido con el MemberProvider REAL (mock de supabase) y una "Inicio" falsa con los `data-ayuda`.
// jsdom no tiene layout: cada `data-ayuda` recibe un rectángulo falso; sin rectángulo, no se ve.
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
// `buscarObjetivo` real, pero contado: así se ve si el disparador se pone a esperar a Inicio cuando no corresponde.
const busquedas = vi.hoisted(() => ({ n: 0 }));
vi.mock('./posicion', async (original) => {
  const real = await original<typeof import('./posicion')>();
  return {
    ...real,
    buscarObjetivo: (...args: Parameters<typeof real.buscarObjetivo>) => {
      busquedas.n += 1;
      return real.buscarObjetivo(...args);
    },
  };
});

import { AuthContext, type AuthContextValue } from '@/features/auth/auth-context';
import { MemberProvider } from '@/features/member/member-provider';
// Se monta por la MISMA entrada diferida que usa el AppShell.
import { DisparadorTourDiferido } from './ayuda-lazy';
import { AYUDA_INICIO } from './ayuda-pantallas';
import { BotonAyuda } from './boton-ayuda';
import { pedirRecorrido } from './pedido-recorrido';
import type { Rect } from './posicion';
import { leerTourVistoLocal } from './tour-version';

const STORAGE = 'elan:tour-visto';
let versionEnBase: unknown = 0;
let hayMiembro = true;
let updateFalla = false;

function installResponder() {
  h.state.responder = (call: Call) => {
    if (call.table !== 'miembros') throw new Error(`pedido inesperado: ${call.table}`);
    if (call.ops.some((o) => o.m === 'update')) {
      if (updateFalla) return { data: null, error: { code: '', message: 'TypeError: Failed to fetch' }, status: 0 };
      return { data: null, error: null, status: 204 };
    }
    if (!hayMiembro) return { data: null, error: null, status: 200 };
    return {
      data: {
        rol: 'admin',
        tema: 'dark',
        color_acento: '#F59E0B',
        transportista_id: 'tenant-a',
        camion_activo_id: null,
        tour_version_vista: versionEnBase,
        transportistas: { nombre: 'Cuenta' },
      },
      error: null,
      status: 200,
    };
  };
}

const escrituras = () => h.calls.filter((c) => c.ops.some((o) => o.m === 'update'));

const rects = new Map<string, Rect>();
const originales = { rect: Element.prototype.getBoundingClientRect, cajas: Element.prototype.getClientRects, scroll: Element.prototype.scrollIntoView };

function AuthHarness({ children }: { children: ReactNode }) {
  const value = useMemo<AuthContextValue>(
    () => ({ session: { access_token: 't' } as never, user: { id: 'user-a', email: 'a@correo.test' } as never, status: 'ready', signOut: async () => ({ ok: true }) }),
    [],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** La navegación falsa: como en el AppShell, está en TODAS las rutas. */
function NavFalsa() {
  return (
    <nav>
      <a data-ayuda="nav-viajes" href="#v">Viajes</a>
      <a data-ayuda="nav-gastos" href="#g">Gastos</a>
    </nav>
  );
}

/** Una Inicio falsa: la tarjeta del camión y la "i" REAL de Inicio (con "Ver el recorrido otra vez" adentro de su hoja). */
function InicioFalsa() {
  return (
    <div>
      <div data-ayuda="camion">camión</div>
      <BotonAyuda ayuda={AYUDA_INICIO} dataAyuda="ayuda-inicio" conRecorrido />
    </div>
  );
}

let root: Root;
let app: HTMLElement;

async function settle(veces = 12) {
  for (let i = 0; i < veces; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
  }
}

async function montar(ruta = '/') {
  app = document.createElement('div');
  app.id = 'root';
  document.body.appendChild(app);
  root = createRoot(app);
  await act(async () => {
    root.render(
      <AuthHarness>
        <MemberProvider>
          <MemoryRouter initialEntries={[ruta]}>
            <NavFalsa />
            <Routes>
              <Route path="/" element={<InicioFalsa />} />
              <Route path="/viajes" element={<p>viajes</p>} />
            </Routes>
            <Suspense fallback={null}>
              <DisparadorTourDiferido />
            </Suspense>
          </MemoryRouter>
        </MemberProvider>
      </AuthHarness>,
    );
  });
  await settle();
}

async function desmontar() {
  await act(async () => root.unmount());
  app.remove();
}

const dialogo = () => document.querySelector<HTMLElement>('[role="dialog"]');
/** Espera (hasta ~1,5 s: el sondeo de Inicio más el reintento de Suspense) a que aparezca el recorrido. */
async function aparece() {
  for (let i = 0; i < 50 && !dialogo(); i++) await settle(1);
  return dialogo() !== null;
}
const boton = (texto: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === texto);
/** Abre la hoja de la "i" de Inicio y toca "Ver el recorrido otra vez" adentro. */
async function pedirDesdeLaAyuda() {
  await tocar(document.querySelector<HTMLElement>('button[aria-label="Ayuda de esta pantalla"]'));
  for (let i = 0; i < 100 && !boton('Ver el recorrido otra vez'); i++) await settle(1);
  await tocar(boton('Ver el recorrido otra vez'));
}
async function tocar(el: HTMLElement | undefined | null) {
  if (!el) throw new Error('no se encontró el elemento');
  await act(async () => el.click());
  await settle();
}

// El motor va diferido (`lazy`): se precarga una vez para que la primera prueba no dependa de cuánto tarda en transformarse.
beforeAll(async () => {
  await Promise.all([import('./tour-ayuda'), import('./disparador-tour')]);
});

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  h.calls.length = 0;
  versionEnBase = 0;
  hayMiembro = true;
  updateFalla = false;
  installResponder();
  localStorage.clear();
  rects.clear();
  rects.set('nav-viajes', { top: 744, left: 75, width: 75, height: 56 });
  rects.set('nav-gastos', { top: 744, left: 150, width: 75, height: 56 });
  rects.set('camion', { top: 150, left: 16, width: 343, height: 160 });
  rects.set('ayuda-inicio', { top: 20, left: 300, width: 48, height: 48 });
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const clave = this.getAttribute('data-ayuda');
    const r = (clave && rects.get(clave)) || { top: 0, left: 0, width: 0, height: 0 };
    return { ...r, x: r.left, y: r.top, right: r.left + r.width, bottom: r.top + r.height, toJSON: () => r } as DOMRect;
  };
  Element.prototype.getClientRects = function (this: Element) {
    const clave = this.getAttribute('data-ayuda');
    return (clave && rects.has(clave) ? [this.getBoundingClientRect()] : []) as unknown as DOMRectList;
  };
  Element.prototype.scrollIntoView = (() => {}) as typeof Element.prototype.scrollIntoView;
});

afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.innerHTML = '';
  Element.prototype.getBoundingClientRect = originales.rect;
  Element.prototype.getClientRects = originales.cajas;
  Element.prototype.scrollIntoView = originales.scroll;
});

describe('DisparadorTour: el recorrido automático', () => {
  it('con el miembro listo, en Inicio y sin la versión vista: arranca (bienvenida, "Paso 1 de N")', async () => {
    await montar('/');
    expect(await aparece()).toBe(true);
    expect(dialogo()!.querySelector('h2')!.textContent).toBe('Te mostramos la app');
    expect(dialogo()!.textContent).toMatch(/Paso 1 de \d/);
  });

  it('con la versión ya vista en la base: no arranca', async () => {
    versionEnBase = 1;
    await montar('/');
    expect(await aparece()).toBe(false);
  });

  it('con la versión vista en la copia LOCAL de este usuario (sin señal la otra vez): no arranca', async () => {
    localStorage.setItem(STORAGE, JSON.stringify({ userId: 'user-a', version: 1 }));
    await montar('/');
    expect(await aparece()).toBe(false);
  });

  it('la copia local de OTRO usuario no cuenta: arranca', async () => {
    localStorage.setItem(STORAGE, JSON.stringify({ userId: 'user-b', version: 1 }));
    await montar('/');
    expect(await aparece()).toBe(true);
  });

  it('fuera de Inicio no arranca', async () => {
    await montar('/viajes');
    expect(await aparece()).toBe(false);
  });

  it('sin miembro (va a /bienvenida): no arranca', async () => {
    hayMiembro = false;
    await montar('/');
    expect(await aparece()).toBe(false);
  });

  it('si Inicio todavía no dibujó (ningún objetivo visible): no arranca', async () => {
    rects.clear();
    await montar('/');
    expect(await aparece()).toBe(false);
  });

  it('espera a que Inicio dibuje: si los objetivos aparecen un rato después, arranca igual', async () => {
    const guardados = new Map(rects);
    rects.clear();
    await montar('/');
    expect(dialogo()).toBeNull();
    for (const [clave, rect] of guardados) rects.set(clave, rect);
    expect(await aparece()).toBe(true);
  });

  it('SALTAR lo marca como visto (local + base) y no vuelve a aparecer', async () => {
    await montar('/');
    expect(await aparece()).toBe(true);
    await tocar(boton('Saltar'));
    expect(dialogo()).toBeNull();
    expect(leerTourVistoLocal('user-a')).toBe(1);
    expect(escrituras()).toHaveLength(1);
    expect(escrituras()[0]!.ops.find((o) => o.m === 'update')!.args).toEqual([{ tour_version_vista: 1 }]);
    expect(await aparece()).toBe(false);
  });

  it('TERMINAR (Listo en el último paso) también lo marca como visto', async () => {
    await montar('/');
    expect(await aparece()).toBe(true);
    for (let i = 0; i < 12 && boton('Siguiente'); i++) await tocar(boton('Siguiente'));
    await tocar(boton('Listo'));
    expect(dialogo()).toBeNull();
    expect(escrituras()).toHaveLength(1);
    expect(leerTourVistoLocal('user-a')).toBe(1);
  });

  it('sin señal: corre igual, y al saltar queda la marca local (no vuelve a aparecer al volver a entrar)', async () => {
    updateFalla = true;
    await montar('/');
    expect(await aparece()).toBe(true);
    await tocar(boton('Saltar'));
    expect(leerTourVistoLocal('user-a')).toBe(1);
    await desmontar();
    h.calls.length = 0;
    await montar('/');
    expect(await aparece()).toBe(false);
  });
});

describe('DisparadorTour: "Ver el recorrido otra vez"', () => {
  it('lo muestra aunque ya esté visto, y al saltarlo NO escribe en la base ni toca la versión', async () => {
    versionEnBase = 1;
    await montar('/');
    expect(await aparece()).toBe(false);
    await pedirDesdeLaAyuda();
    expect(await aparece()).toBe(true);
    await tocar(boton('Saltar'));
    expect(dialogo()).toBeNull();
    expect(escrituras()).toHaveLength(0);
    expect(localStorage.getItem(STORAGE)).toBeNull();
  });

  it('fuera de Inicio, el pedido no lo muestra', async () => {
    await montar('/viajes');
    // Ni siquiera un instante: se registra cualquier aparición del diálogo o del `inert` en la app.
    let asomo = false;
    const observador = new MutationObserver((registros) => {
      for (const r of registros) {
        if (r.type === 'attributes' && r.attributeName === 'inert') asomo = true;
        for (const nodo of r.addedNodes) {
          if (nodo instanceof HTMLElement && (nodo.matches('[role="dialog"]') || nodo.querySelector('[role="dialog"]'))) asomo = true;
        }
      }
    });
    observador.observe(document.body, { subtree: true, childList: true, attributes: true });
    busquedas.n = 0;
    await act(async () => pedirRecorrido());
    expect(await aparece()).toBe(false);
    observador.disconnect();
    expect(asomo).toBe(false);
    // Y no se queda esperando a Inicio (ni buscando objetivos) fuera de Inicio.
    expect(busquedas.n).toBe(0);
  });

  it('desde la "i": la hoja se cierra, queda UN solo diálogo (el recorrido), la app inerte una sola vez y, al saltar, el foco vuelve a la "i"', async () => {
    versionEnBase = 1;
    await montar('/');
    const i = document.querySelector<HTMLElement>('button[aria-label="Ayuda de esta pantalla"]')!;
    await pedirDesdeLaAyuda();
    expect(await aparece()).toBe(true);
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(dialogo()!.querySelector('h2')!.textContent).toBe('Te mostramos la app');
    expect(document.querySelectorAll('[data-velo]')).toHaveLength(1);
    expect(app.hasAttribute('inert')).toBe(true);
    await tocar(boton('Saltar'));
    expect(dialogo()).toBeNull();
    expect(app.hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(i);
    expect(escrituras()).toHaveLength(0);
  });

  it('el último paso señala la "i" de Inicio (ya no cae centrado) y su texto dice dónde repetir el recorrido', async () => {
    await montar('/');
    expect(await aparece()).toBe(true);
    for (let n = 0; n < 12 && boton('Siguiente'); n++) await tocar(boton('Siguiente'));
    expect(dialogo()!.querySelector('h2')!.textContent).toBe('Listo');
    expect(dialogo()!.textContent).toContain('toca esta «i»');
    expect(dialogo()!.getAttribute('data-posicion')).not.toBe('centrado');
    expect(document.querySelector('[data-aro]')).not.toBeNull();
  });

  it('se puede pedir otra vez después de cerrarlo', async () => {
    versionEnBase = 1;
    await montar('/');
    await pedirDesdeLaAyuda();
    expect(await aparece()).toBe(true);
    await tocar(boton('Saltar'));
    expect(dialogo()).toBeNull();
    await pedirDesdeLaAyuda();
    expect(await aparece()).toBe(true);
  });
});
