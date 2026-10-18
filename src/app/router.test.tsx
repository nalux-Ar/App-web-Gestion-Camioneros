import { act, useMemo, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation, useNavigationType } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock de supabase: registra cada pedido y responde según la tabla. TODO lo demás (el router REAL con sus guards y sus
// pantallas con carga diferida, el layout, TanStack Query) es código REAL del proyecto.
type Op = { m: string; args: unknown[] };
type Call = { table: string; ops: Op[] };

const h = vi.hoisted(() => {
  const calls: Array<{ table: string; ops: Array<{ m: string; args: unknown[] }> }> = [];
  const state = { responder: null as null | ((call: { table: string; ops: Array<{ m: string; args: unknown[] }> }) => unknown) };
  function from(table: string, firstOp?: { m: string; args: unknown[] }) {
    const call = { table, ops: firstOp ? [firstOp] : ([] as Array<{ m: string; args: unknown[] }>) };
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
  // Las funciones de la base (las del Resumen) se registran como `rpc:<función>`.
  const rpc = (fn: string, args: unknown) => from(`rpc:${fn}`, { m: 'rpc', args: [args] });
  return { calls, state, from: (table: string) => from(table), rpc };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from: h.from, rpc: h.rpc } }));

import { AppRouter } from '@/app/router';
import { AuthContext, type AuthContextValue } from '@/features/auth/auth-context';
import { MemberProvider } from '@/features/member/member-provider';
import { queryClient } from '@/lib/query-client';

const ok = (data: unknown) => ({ data, error: null, status: 200 });

const VIAJE = 'b0000000-0000-4000-8000-000000000001';
const DEV = 'f0000000-0000-4000-8000-000000000001';
const CLIENTE = 'a0000000-0000-4000-8000-000000000001';
const CAMION = 'c0000000-0000-4000-8000-000000000001';
const MIEMBRO = {
  rol: 'admin',
  tema: 'dark',
  color_acento: '#F59E0B',
  transportista_id: 'tenant-a',
  camion_activo_id: null,
  transportistas: { nombre: 'Transportes A' },
};
const VISTA = {
  id: VIAJE,
  fecha: '2025-06-15',
  origen: 'Rosario',
  destino: 'Córdoba',
  km_inicial: null,
  km_final: null,
  km_recorridos: null,
  ingreso: null,
  observaciones: null,
  entregas: [],
};
const DETALLE_VIAJE = { ...VISTA, camion_id: null };

function installResponder() {
  h.state.responder = (call: Call) => {
    const has = (m: string) => call.ops.some((o) => o.m === m);
    if (call.table === 'miembros' && has('maybeSingle')) return ok(MIEMBRO);
    if (call.table === 'clientes') {
      // El detalle y la edición de un cliente lo piden por id; la lista (pantalla y selectores) es un arreglo.
      if (has('maybeSingle')) {
        return ok({ id: CLIENTE, nombre: 'Almacén Central', contacto_telefono: null, contacto_email: null, direccion: null });
      }
      return ok([]);
    }
    if (call.table === 'categorias_gasto') return ok([]);
    if (call.table === 'camiones') {
      if (has('maybeSingle')) return ok({ id: CAMION, patente: 'AB123CD', marca: 'Scania', modelo: null, anio: null, activa: true });
      return ok([]);
    }
    if (call.table === 'gastos') return ok([]);
    if (call.table === 'viajes') {
      // La pantalla de solo lectura y la de edición piden el viaje por id (con entregas embebidas).
      const select = String(call.ops.find((o) => o.m === 'select')?.args[0] ?? '');
      return has('maybeSingle') ? ok(select.includes('camion_id') ? DETALLE_VIAJE : VISTA) : ok([]);
    }
    if (call.table === 'devoluciones') {
      if (has('maybeSingle')) return ok({ id: DEV, viaje_id: VIAJE, cliente_id: 'a0000000-0000-4000-8000-000000000001', motivo: 'otro', descripcion: 'x' });
      return ok([]);
    }
    // Resumen: un mes sin movimientos.
    if (call.table === 'rpc:resumen_gastos') return ok([{ grupo: 'total', clave: null, nombre: null, activa: null, cantidad: 0, monto: 0 }]);
    if (call.table === 'rpc:resumen_mensual') {
      // `p_meses` filas, una por mes desde `p_mes_desde` (1 en la vista Mes, 12 en la vista Año).
      const args = call.ops[0]!.args[0] as { p_mes_desde: string; p_meses: number };
      const anio = Number(args.p_mes_desde.slice(0, 4));
      const mes0 = Number(args.p_mes_desde.slice(5, 7)) - 1;
      return ok(
        Array.from({ length: args.p_meses }, (_, i) => ({
          mes: `${anio + Math.floor((mes0 + i) / 12)}-${String(((mes0 + i) % 12) + 1).padStart(2, '0')}-01`,
          gastos_cantidad: 0,
          gastos_monto: 0,
          combustible_cargas: 0,
          combustible_litros: 0,
          combustible_monto: 0,
          viajes_cantidad: 0,
          viajes_km: 0,
          viajes_con_ingreso: 0,
          viajes_sin_ingreso: 0,
          viajes_ingreso: 0,
          resultado: null,
        })),
      );
    }
    if (call.table === 'rpc:resumen_combustible' || call.table === 'rpc:resumen_viajes') return ok([]);
    throw new Error(`pedido inesperado: ${call.table} ${call.ops.map((o) => o.m).join('.')}`);
  };
}

function AuthHarness({ children, conSesion }: { children: ReactNode; conSesion: boolean }) {
  const value = useMemo<AuthContextValue>(
    () => ({
      session: conSesion ? ({ access_token: 't' } as never) : null,
      user: conSesion ? ({ id: 'user-a', email: 'a@correo.test' } as never) : null,
      status: 'ready',
      signOut: async () => ({ ok: true }),
    }),
    [conSesion],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Deja a la vista en qué ruta quedó el router (para las redirecciones). */
function Ubicacion() {
  const location = useLocation();
  const tipo = useNavigationType();
  return <div id="ubicacion" data-pathname={location.pathname} data-search={location.search} data-tipo={tipo} />;
}

let root: Root;
let container: HTMLElement;
let errorSpy: ReturnType<typeof vi.spyOn>;

const h1 = () => document.querySelector('h1')?.textContent ?? '';
const ubicacion = () => {
  const el = document.getElementById('ubicacion');
  return { pathname: el?.dataset.pathname ?? '', search: el?.dataset.search ?? '', tipo: el?.dataset.tipo ?? '' };
};

async function settle(times = 4) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

/** Espera (con act) a que se cumpla algo: las pantallas se cargan con `lazy`, así que tardan más que un turno. */
async function until(condition: () => boolean, ms = 15_000) {
  const limit = Date.now() + ms;
  while (!condition() && Date.now() < limit) await settle(1);
}

async function mount(path: string, conSesion = true) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <AuthHarness conSesion={conSesion}>
          <MemberProvider>
            <MemoryRouter initialEntries={[path]}>
              <AppRouter />
              <Ubicacion />
            </MemoryRouter>
          </MemberProvider>
        </AuthHarness>
      </QueryClientProvider>,
    );
  });
  await settle(4);
}

beforeEach(() => {
  h.calls.length = 0;
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

describe('router: las rutas de devoluciones, anidadas bajo el viaje', () => {
  it('/viajes/<id>/devoluciones/nueva abre el formulario de una devolución nueva, dentro del layout de la app', async () => {
    await mount(`/viajes/${VIAJE}/devoluciones/nueva`);
    await until(() => h1() === 'Nueva devolución');
    expect(h1()).toBe('Nueva devolución');
    expect(document.querySelector('header')).not.toBeNull(); // el layout (AppShell) de la app logueada
    await until(() => document.querySelector('input[type="radio"][value="otro"]') !== null);
    expect(document.querySelector('input[type="radio"][value="otro"]')).not.toBeNull();
  });

  it('/viajes/<id>/devoluciones/<id>/editar abre la edición de esa devolución', async () => {
    await mount(`/viajes/${VIAJE}/devoluciones/${DEV}/editar`);
    await until(() => h1() === 'Editar devolución');
    expect(h1()).toBe('Editar devolución');
    await until(() => document.querySelector('textarea') !== null);
    expect(document.querySelector<HTMLTextAreaElement>('#devolucion-descripcion')!.value).toBe('x');
  });

  it('no chocan con las rutas de viajes: /viajes/<id> sigue siendo el detalle, /viajes/<id>/editar la edición y /viajes/nuevo el alta', async () => {
    await mount(`/viajes/${VIAJE}`);
    await until(() => h1().includes('Rosario'));
    expect(h1()).toContain('Rosario');
    expect(h1()).not.toContain('devolución');
    await act(async () => {
      root.unmount();
    });
    container.remove();
    queryClient.clear();

    await mount(`/viajes/${VIAJE}/editar`);
    await until(() => h1() === 'Editar viaje');
    expect(h1()).toBe('Editar viaje');
    await act(async () => {
      root.unmount();
    });
    container.remove();
    queryClient.clear();

    await mount('/viajes/nuevo');
    await until(() => h1() === 'Nuevo viaje');
    expect(h1()).toBe('Nuevo viaje');
  });

  it('rutas parecidas que no existen (/devoluciones, /devoluciones/editar, /devoluciones/nueva/x, /devoluciones/<id>) caen en la ruta desconocida: nada de devoluciones y ninguna consulta', async () => {
    for (const ruta of [
      `/viajes/${VIAJE}/devoluciones`,
      `/viajes/${VIAJE}/devoluciones/editar`,
      `/viajes/${VIAJE}/devoluciones/nueva/x`,
      `/viajes/${VIAJE}/devoluciones/${DEV}`,
      `/viajes/${VIAJE}/devoluciones/${DEV}/editar/x`,
      '/devoluciones',
      '/devoluciones/nueva',
    ]) {
      h.calls.length = 0;
      await mount(ruta);
      await until(() => h1().startsWith('Hola'));
      expect(h1(), ruta).toMatch(/^Hola/); // la ruta desconocida lleva a Inicio
      expect(h.calls.filter((c) => c.table === 'devoluciones'), ruta).toHaveLength(0);
      await act(async () => {
        root.unmount();
      });
      container.remove();
      queryClient.clear();
    }
  });

  it('no hay pantalla general ni ítem de menú de Devoluciones: solo se llega desde el detalle de un viaje', async () => {
    await mount('/');
    await until(() => h1().startsWith('Hola'));
    const nav = [...document.querySelectorAll('nav a')].map((a) => a.textContent?.trim());
    expect(nav.some((texto) => texto?.toLowerCase().includes('devolucion'))).toBe(false);
    expect([...document.querySelectorAll('a')].some((a) => (a.getAttribute('href') ?? '') === '/devoluciones')).toBe(false);
  });

  it('están detrás de la sesión: sin sesión no se pide NADA y no se muestra el formulario', async () => {
    await mount(`/viajes/${VIAJE}/devoluciones/nueva`, false);
    await settle(6);
    expect(h1()).not.toBe('Nueva devolución');
    expect(document.querySelector('input[type="radio"][value="otro"]')).toBeNull();
    expect(h.calls.filter((c) => c.table === 'devoluciones' || c.table === 'clientes' || c.table === 'viajes')).toHaveLength(0);
  });
});

describe('router: las rutas de Clientes', () => {
  async function desmontar() {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    queryClient.clear();
  }

  it('/clientes ya no es "próximamente": es la lista de clientes, dentro del layout de la app', async () => {
    await mount('/clientes');
    await until(() => h1() === 'Clientes' && document.querySelector('a[href="/clientes/nuevo"]') !== null);
    expect(h1()).toBe('Clientes');
    expect(document.querySelector('header')).not.toBeNull();
    expect(document.querySelector('a[href="/clientes/nuevo"]')).not.toBeNull();
    expect(document.body.textContent).not.toContain('Próximamente');
  });

  it('/clientes/nuevo es el alta (el literal gana sobre /clientes/:id) y no consulta ningún cliente por id', async () => {
    await mount('/clientes/nuevo');
    await until(() => h1() === 'Nuevo cliente');
    expect(h1()).toBe('Nuevo cliente');
    await until(() => document.querySelector('#cliente-nombre') !== null);
    expect(h.calls.filter((c) => c.table === 'clientes' && c.ops.some((o) => o.m === 'maybeSingle'))).toHaveLength(0);
  });

  it('/clientes/<id> es el detalle y /clientes/<id>/editar la edición', async () => {
    await mount(`/clientes/${CLIENTE}`);
    await until(() => h1() === 'Almacén Central');
    expect(h1()).toBe('Almacén Central');
    await desmontar();

    await mount(`/clientes/${CLIENTE}/editar`);
    await until(() => h1() === 'Editar cliente');
    expect(h1()).toBe('Editar cliente');
    await until(() => document.querySelector('#cliente-nombre') !== null);
    expect(document.querySelector<HTMLInputElement>('#cliente-nombre')!.value).toBe('Almacén Central');
  });

  it('rutas parecidas que no existen caen en la ruta desconocida (Inicio), sin consultar clientes', async () => {
    for (const ruta of [`/clientes/${CLIENTE}/editar/x`, `/clientes/${CLIENTE}/viajes`, '/clientes/nuevo/x', '/cliente']) {
      h.calls.length = 0;
      await mount(ruta);
      await until(() => h1().startsWith('Hola'));
      expect(h1(), ruta).toMatch(/^Hola/);
      expect(h.calls.filter((c) => c.table === 'clientes'), ruta).toHaveLength(0);
      await desmontar();
    }
  });

  it('la barra de navegación sigue igual: "Clientes" lleva a /clientes', async () => {
    await mount('/');
    await until(() => h1().startsWith('Hola'));
    const enNav = [...document.querySelectorAll<HTMLAnchorElement>('nav a')].filter((a) => a.getAttribute('href') === '/clientes');
    expect(enNav.length).toBeGreaterThan(0);
    expect(enNav[0]!.textContent).toContain('Clientes');
  });

  it('están detrás de la sesión: sin sesión no se pide NADA', async () => {
    await mount(`/clientes/${CLIENTE}`, false);
    await settle(6);
    expect(h1()).not.toBe('Almacén Central');
    expect(h.calls.filter((c) => c.table === 'clientes')).toHaveLength(0);
  });
});

describe('router: las rutas de Camiones (fuera de la barra de abajo)', () => {
  async function desmontar() {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    queryClient.clear();
  }
  const lecturasDeUnCamion = () => h.calls.filter((c) => c.table === 'camiones' && c.ops.some((o) => o.m === 'maybeSingle'));

  it('/camiones es la lista de camiones, dentro del layout, con el volver a Configuración', async () => {
    await mount('/camiones');
    await until(() => h1() === 'Camiones' && document.querySelector('a[href="/configuracion"]') !== null);
    expect(h1()).toBe('Camiones');
    expect(document.querySelector('header')).not.toBeNull();
    expect(document.querySelector('a[href="/camiones/nuevo"]')).not.toBeNull();
  });

  it('/camiones/nuevo es el alta (el literal gana sobre /camiones/:id/editar) y no lee ningún camión por id', async () => {
    await mount('/camiones/nuevo');
    await until(() => document.querySelector('#camion-patente') !== null);
    expect(h1()).toBe('Nuevo camión');
    expect(lecturasDeUnCamion()).toHaveLength(0);
  });

  it('/camiones/<id>/editar es la edición, con los datos de ese camión', async () => {
    await mount(`/camiones/${CAMION}/editar`);
    await until(() => document.querySelector('#camion-patente') !== null);
    expect(h1()).toBe('Editar camión');
    expect(document.querySelector<HTMLInputElement>('#camion-patente')!.value).toBe('AB123CD');
    expect(document.querySelector<HTMLInputElement>('#camion-marca')!.value).toBe('Scania');
  });

  it('rutas parecidas que no existen caen en la ruta desconocida (Inicio), sin leer ningún camión', async () => {
    for (const ruta of [`/camiones/${CAMION}`, `/camiones/${CAMION}/editar/x`, '/camiones/nuevo/x', '/camion', `/camiones/${CAMION}/archivar`]) {
      h.calls.length = 0;
      await mount(ruta);
      await until(() => h1().startsWith('Hola'));
      expect(h1(), ruta).toMatch(/^Hola/);
      expect(lecturasDeUnCamion(), ruta).toHaveLength(0);
      await desmontar();
    }
  });

  it('la barra de navegación NO tiene Camiones; se llega desde Configuración', async () => {
    await mount('/configuracion');
    await until(() => document.querySelector('a[href="/camiones"]') !== null);
    expect([...document.querySelectorAll('nav a')].some((a) => a.getAttribute('href')?.startsWith('/camiones'))).toBe(false);
    const enlace = document.querySelector<HTMLAnchorElement>('a[href="/camiones"]')!;
    expect(enlace.textContent).toContain('Ver camiones');
    expect(enlace.closest('nav')).toBeNull();
  });

  it('Inicio, sin ningún camión (administrador): la tarjeta "Carga tu camión" lleva al alta', async () => {
    await mount('/');
    await until(() => document.querySelector('a[href="/camiones/nuevo"]') !== null);
    expect(document.body.textContent).toContain('Carga tu camión');
  });

  it('están detrás de la sesión: sin sesión no se pide NADA', async () => {
    await mount(`/camiones/${CAMION}/editar`, false);
    await settle(6);
    expect(h1()).not.toBe('Editar camión');
    expect(h.calls.filter((c) => c.table === 'camiones')).toHaveLength(0);
  });
});

describe('router: el Resumen (antes "Reportes")', () => {
  async function desmontar() {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    queryClient.clear();
  }
  const mesMostrado = () => document.querySelector('[role="group"][aria-label="Mes"] p')?.textContent ?? '';
  const pedidosDelResumen = () => h.calls.filter((c) => c.table.startsWith('rpc:resumen_'));

  it('/resumen es la pantalla Resumen (ya no "próximamente"), dentro del layout, y pide los datos del mes', async () => {
    await mount('/resumen');
    await until(() => h1() === 'Resumen' && mesMostrado() !== '');
    expect(h1()).toBe('Resumen');
    expect(document.querySelector('header')).not.toBeNull();
    expect(document.body.textContent).not.toContain('Próximamente');
    await until(() => pedidosDelResumen().length >= 5);
    expect(new Set(pedidosDelResumen().map((c) => c.table))).toEqual(
      new Set(['rpc:resumen_gastos', 'rpc:resumen_mensual', 'rpc:resumen_combustible', 'rpc:resumen_viajes']),
    );
  });

  it('/reportes redirige a /resumen REEMPLAZANDO la entrada del historial (sin búsqueda: queda sin búsqueda)', async () => {
    await mount('/reportes');
    await until(() => h1() === 'Resumen');
    expect(ubicacion()).toEqual({ pathname: '/resumen', search: '', tipo: 'REPLACE' });
  });

  it('/reportes?mes=… conserva la búsqueda: el Resumen abre en ese mes', async () => {
    await mount('/reportes?mes=2025-03');
    await until(() => h1() === 'Resumen' && mesMostrado() !== '');
    expect(ubicacion()).toEqual({ pathname: '/resumen', search: '?mes=2025-03', tipo: 'REPLACE' });
    expect(mesMostrado()).toBe('marzo 2025');
    await until(() => pedidosDelResumen().length > 0);
    expect(pedidosDelResumen().filter((c) => c.table === 'rpc:resumen_mensual').map((c) => c.ops[0]!.args[0])).toContainEqual({
      p_mes_desde: '2025-03-01',
      p_meses: 1,
    });
  });

  it('/reportes conserva la búsqueda completa, tal cual (la pantalla valida lo que entienda): ?vista=anio abre la vista Año', async () => {
    await mount('/reportes?vista=anio&anio=2025&otro=1');
    await until(() => h1() === 'Resumen' && document.querySelector('[role="group"][aria-label="Año"]') !== null);
    expect(ubicacion()).toEqual({ pathname: '/resumen', search: '?vista=anio&anio=2025&otro=1', tipo: 'REPLACE' });
    expect(document.querySelector('[role="group"][aria-label="Año"] p')!.textContent).toBe('2025');
    await until(() => pedidosDelResumen().some((c) => c.table === 'rpc:resumen_mensual'));
    expect(pedidosDelResumen().filter((c) => c.table === 'rpc:resumen_mensual').map((c) => c.ops[0]!.args[0])).toEqual([
      { p_mes_desde: '2025-01-01', p_meses: 12 },
    ]);
    expect(pedidosDelResumen().filter((c) => c.table === 'rpc:resumen_viajes')).toHaveLength(0);
  });

  it('rutas parecidas que no existen caen en la ruta desconocida (Inicio), sin pedir el resumen', async () => {
    for (const ruta of ['/reportes/x', '/resumen/x', '/resumenes']) {
      h.calls.length = 0;
      await mount(ruta);
      await until(() => h1().startsWith('Hola'));
      expect(h1(), ruta).toMatch(/^Hola/);
      expect(pedidosDelResumen(), ruta).toHaveLength(0);
      await desmontar();
    }
  });

  it('la barra de navegación tiene "Resumen" (a /resumen) en lugar de "Reportes"', async () => {
    await mount('/');
    await until(() => h1().startsWith('Hola'));
    const enNav = [...document.querySelectorAll<HTMLAnchorElement>('nav a')].filter((a) => a.getAttribute('href') === '/resumen');
    expect(enNav.length).toBeGreaterThan(0);
    for (const enlace of enNav) expect(enlace.textContent).toContain('Resumen');
    expect([...document.querySelectorAll('a')].some((a) => a.getAttribute('href') === '/reportes')).toBe(false);
    expect([...document.querySelectorAll('nav')].some((nav) => nav.textContent?.includes('Reportes'))).toBe(false);
  });

  it('está detrás de la sesión: sin sesión no se pide NADA (ni por /resumen ni por /reportes)', async () => {
    await mount('/resumen', false);
    await settle(6);
    expect(h1()).not.toBe('Resumen');
    expect(pedidosDelResumen()).toHaveLength(0);
    await desmontar();
    await mount('/reportes?mes=2025-03', false);
    await settle(6);
    expect(pedidosDelResumen()).toHaveLength(0);
  });
});
