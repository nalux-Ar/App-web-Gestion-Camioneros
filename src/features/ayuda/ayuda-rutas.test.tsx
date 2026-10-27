import { readFileSync } from 'node:fs';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Cobertura de la "i": se monta CADA pantalla de la app (las rutas de `router.tsx`, menos "Reportar un problema") con el
// código real y un supabase vacío, y se exige una "i" que abra la ayuda de ESA pantalla. Si se agrega una ruta y no se anota
// acá, falla. Las pantallas se ven en su primer estado (cargando o vacía): la "i" tiene que estar desde el primer render.
const h = vi.hoisted(() => {
  function from() {
    let uno = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === 'then') {
            return (onF: (v: unknown) => unknown, onR: (e: unknown) => unknown) =>
              Promise.resolve({ data: uno ? null : [], error: null, status: 200, count: 0 }).then(onF, onR);
          }
          return (...args: unknown[]) => {
            if (prop === 'maybeSingle' || prop === 'single') uno = true;
            void args;
            return b;
          };
        },
      },
    );
    return b;
  }
  return { from };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from: h.from } }));

import { AuthContext, type AuthContextValue } from '@/features/auth/auth-context';
import { MemberContext, type MemberContextValue } from '@/features/member/member-context';
import { CamionFormPage } from '@/features/camiones/camion-form-page';
import { CamionesPage } from '@/features/camiones/camiones-page';
import { ClienteDetallePage } from '@/features/clientes/cliente-detalle-page';
import { ClienteFormPage } from '@/features/clientes/cliente-form-page';
import { ClientesPage } from '@/features/clientes/clientes-page';
import { ConfiguracionPage } from '@/features/configuracion/configuracion-page';
import { DevolucionFormPage } from '@/features/devoluciones/devolucion-form-page';
import { GastoFormPage } from '@/features/gastos/gasto-form-page';
import { GastosPage } from '@/features/gastos/gastos-page';
import { InicioPage } from '@/features/home/inicio-page';
import { ReportarPage } from '@/features/reportar/reportar-page';
import { ResumenPage } from '@/features/resumen/resumen-page';
import { ViajeDetallePage } from '@/features/viajes/viaje-detalle-page';
import { ViajeFormPage } from '@/features/viajes/viaje-form-page';
import { ViajesPage } from '@/features/viajes/viajes-page';
import { queryClient } from '@/lib/query-client';
import * as textos from './ayuda-pantallas';

const ID = 'b0000000-0000-4000-8000-000000000001';
const ID2 = 'e0000000-0000-4000-8000-000000000002';

interface Pantalla {
  /** El `path` tal cual está en `router.tsx` ('' = la ruta index). */
  ruta: string;
  /** La URL concreta con la que se prueba. */
  url: string;
  pagina: ReactElement;
  ayuda: textos.AyudaPantalla;
}

const PANTALLAS: Pantalla[] = [
  { ruta: '', url: '/', pagina: <InicioPage />, ayuda: textos.AYUDA_INICIO },
  { ruta: 'viajes', url: '/viajes', pagina: <ViajesPage />, ayuda: textos.AYUDA_VIAJES },
  { ruta: 'viajes/nuevo', url: '/viajes/nuevo', pagina: <ViajeFormPage modo="nuevo" />, ayuda: textos.AYUDA_VIAJE_FORM },
  { ruta: 'viajes/:id', url: `/viajes/${ID}`, pagina: <ViajeDetallePage />, ayuda: textos.AYUDA_VIAJE_DETALLE },
  { ruta: 'viajes/:id/editar', url: `/viajes/${ID}/editar`, pagina: <ViajeFormPage modo="editar" />, ayuda: textos.AYUDA_VIAJE_FORM },
  { ruta: 'viajes/:viajeId/devoluciones/nueva', url: `/viajes/${ID}/devoluciones/nueva`, pagina: <DevolucionFormPage modo="nuevo" />, ayuda: textos.AYUDA_DEVOLUCION_FORM },
  { ruta: 'viajes/:viajeId/devoluciones/:id/editar', url: `/viajes/${ID}/devoluciones/${ID2}/editar`, pagina: <DevolucionFormPage modo="editar" />, ayuda: textos.AYUDA_DEVOLUCION_FORM },
  { ruta: 'gastos', url: '/gastos', pagina: <GastosPage />, ayuda: textos.AYUDA_GASTOS },
  { ruta: 'gastos/nuevo', url: '/gastos/nuevo', pagina: <GastoFormPage modo="nuevo" />, ayuda: textos.AYUDA_GASTO_FORM },
  { ruta: 'gastos/:id/editar', url: `/gastos/${ID}/editar`, pagina: <GastoFormPage modo="editar" />, ayuda: textos.AYUDA_GASTO_FORM },
  { ruta: 'clientes', url: '/clientes', pagina: <ClientesPage />, ayuda: textos.AYUDA_CLIENTES },
  { ruta: 'clientes/nuevo', url: '/clientes/nuevo', pagina: <ClienteFormPage modo="nuevo" />, ayuda: textos.AYUDA_CLIENTE_FORM },
  { ruta: 'clientes/:id', url: `/clientes/${ID}`, pagina: <ClienteDetallePage />, ayuda: textos.AYUDA_CLIENTE_DETALLE },
  { ruta: 'clientes/:id/editar', url: `/clientes/${ID}/editar`, pagina: <ClienteFormPage modo="editar" />, ayuda: textos.AYUDA_CLIENTE_FORM },
  { ruta: 'camiones', url: '/camiones', pagina: <CamionesPage />, ayuda: textos.AYUDA_CAMIONES },
  { ruta: 'camiones/nuevo', url: '/camiones/nuevo', pagina: <CamionFormPage modo="nuevo" />, ayuda: textos.AYUDA_CAMION_FORM },
  { ruta: 'camiones/:id/editar', url: `/camiones/${ID}/editar`, pagina: <CamionFormPage modo="editar" />, ayuda: textos.AYUDA_CAMION_FORM },
  { ruta: 'resumen', url: '/resumen', pagina: <ResumenPage />, ayuda: textos.AYUDA_RESUMEN },
  { ruta: 'configuracion', url: '/configuracion', pagina: <ConfiguracionPage />, ayuda: textos.AYUDA_CONFIGURACION },
];

/** Dentro de la app pero sin "i" a propósito (`reportar`), o que solo redirigen (`reportes`). */
const SIN_AYUDA = ['reportar'];
const REDIRECCIONES = ['reportes'];

/** Las rutas de la app logueada (las de adentro del `AppShell`), leídas de `router.tsx`. */
function rutasDeLaApp(): string[] {
  const fuente = readFileSync('src/app/router.tsx', 'utf8');
  const bloque = fuente.slice(fuente.indexOf('<AppShell />'), fuente.indexOf('path="*"'));
  const rutas = [...bloque.matchAll(/<Route\s+(?:path="([^"]+)"|index)/g)].map((m) => m[1] ?? '');
  return rutas;
}

const auth = {
  session: { access_token: 't' },
  user: { id: 'user-a', email: 'a@correo.test' },
  status: 'ready',
  signOut: async () => ({ ok: true }),
} as unknown as AuthContextValue;
const miembro = {
  member: {
    rol: 'admin',
    tema: 'dark',
    colorAcento: '#F59E0B',
    transportistaId: 'tenant-a',
    transportistaNombre: 'Cuenta',
    camionActivoId: null,
    tourVersionVista: 1,
  },
  status: 'ready',
  error: null,
  refetch: async () => {},
  updateLocalPreferences: () => {},
  updateLocalTransportistaNombre: () => {},
  updateLocalCamionActivo: () => {},
  marcarTourVisto: async () => {},
} as unknown as MemberContextValue;

let root: Root;
let app: HTMLElement;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  queryClient.clear();
  window.scrollTo = (() => {}) as typeof window.scrollTo;
  Element.prototype.scrollIntoView = (() => {}) as typeof Element.prototype.scrollIntoView;
  app = document.createElement('div');
  app.id = 'root';
  document.body.appendChild(app);
  root = createRoot(app);
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = '';
});

async function montar(ruta: string, url: string, pagina: ReactElement) {
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <AuthContext.Provider value={auth}>
          <MemberContext.Provider value={miembro}>
            <MemoryRouter initialEntries={[url]}>
              <Routes>
                <Route path={`/${ruta}`} element={pagina} />
              </Routes>
            </MemoryRouter>
          </MemberContext.Provider>
        </AuthContext.Provider>
      </QueryClientProvider>,
    );
  });
  for (let i = 0; i < 4; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))));
}

const botonesI = () => [...document.querySelectorAll<HTMLButtonElement>('button[aria-label="Ayuda de esta pantalla"]')];
const dialogo = () => document.querySelector<HTMLElement>('[role="dialog"]');
async function esperarDialogo() {
  for (let t = 0; t < 3000 && !dialogo(); t += 20) await act(async () => void (await new Promise((r) => setTimeout(r, 20))));
}

describe('cobertura: toda pantalla de la app (menos Reportar) tiene su "i"', () => {
  it('las pantallas de esta prueba son TODAS las rutas de router.tsx (menos Reportar y la redirección)', () => {
    const delRouter = rutasDeLaApp().filter((r) => !SIN_AYUDA.includes(r) && !REDIRECCIONES.includes(r));
    expect(delRouter.length).toBeGreaterThan(15);
    expect(PANTALLAS.map((p) => p.ruta).sort()).toEqual([...delRouter].sort());
    expect(rutasDeLaApp()).toContain('reportar');
  });

  it('cada pantalla usa una ayuda propia de su tipo (no se reutiliza la de otra)', () => {
    const porRuta = new Map(PANTALLAS.map((p) => [p.ruta, p.ayuda]));
    expect(porRuta.get('viajes')).not.toBe(porRuta.get('gastos'));
    expect(new Set(PANTALLAS.map((p) => p.ayuda)).size).toBe(14);
  });

  it.each(PANTALLAS.map((p) => [p.ruta || '(Inicio)', p] as const))('%s: una sola "i", que abre la ayuda de ESA pantalla y devuelve el foco', async (_nombre, p) => {
    await montar(p.ruta, p.url, p.pagina);
    expect(botonesI()).toHaveLength(1);
    const i = botonesI()[0]!;
    expect(i.getAttribute('type')).toBe('button');
    // La "i" está junto al título de la pantalla.
    expect(document.querySelector('h1')!.parentElement!.contains(i) || document.querySelector('h1')!.parentElement!.parentElement!.contains(i)).toBe(true);

    await act(async () => i.click());
    await esperarDialogo();
    expect(dialogo()!.querySelector('h2')!.textContent).toBe(p.ayuda.titulo);
    expect([...dialogo()!.querySelectorAll('li')].map((li) => li.textContent)).toEqual([...p.ayuda.puntos]);
    // El botón del recorrido solo vive en la ayuda de Inicio.
    const recorrido = [...dialogo()!.querySelectorAll('button')].some((b) => b.textContent?.includes('Ver el recorrido otra vez'));
    expect(recorrido).toBe(p.ruta === '');

    await act(async () => [...dialogo()!.querySelectorAll('button')].find((b) => b.textContent === 'Cerrar')!.click());
    expect(dialogo()).toBeNull();
    expect(document.activeElement).toBe(i);
  });

  it('Inicio: la "i" lleva data-ayuda="ayuda-inicio" (la señala el último paso del recorrido) y las demás no', async () => {
    await montar('', '/', <InicioPage />);
    expect(botonesI()[0]!.getAttribute('data-ayuda')).toBe('ayuda-inicio');
    for (const p of PANTALLAS.filter((x) => x.ruta !== '').slice(0, 3)) {
      await act(async () => root.unmount());
      root = createRoot(app);
      await montar(p.ruta, p.url, p.pagina);
      expect(botonesI()[0]!.hasAttribute('data-ayuda')).toBe(false);
    }
  });

  it('Inicio: ya no queda el botón "Ver el recorrido otra vez" al pie de la página', async () => {
    await montar('', '/', <InicioPage />);
    expect([...app.querySelectorAll('button')].some((b) => b.textContent?.includes('Ver el recorrido otra vez'))).toBe(false);
  });

  it('Reportar un problema NO tiene "i"', async () => {
    await montar('reportar', '/reportar', <ReportarPage />);
    expect(document.querySelector('h1')).not.toBeNull();
    expect(botonesI()).toHaveLength(0);
    expect(document.querySelector('[aria-label*="Ayuda" i]')).toBeNull();
  });
});
