import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// El interruptor de «Reportar un problema» (`reportar-config.ts`) se lee al DIBUJAR el header: un getter sobre un estado que la
// prueba cambia permite probar los dos valores con el componente real y sin recargar módulos. Lo que se calcula al cargar un
// módulo (los pasos del recorrido) no sigue a este interruptor: se prueba con su función pura, `pasosDelTour(visible)`.
const reportar = vi.hoisted(() => ({ visible: false }));
vi.mock('@/features/reportar/reportar-config', () => ({
  get REPORTAR_VISIBLE() {
    return reportar.visible;
  },
}));

import { AuthContext, type AuthContextValue } from '@/features/auth/auth-context';
import { MemberContext, type MemberContextValue } from '@/features/member/member-context';
import { pasosDelTour } from '@/features/ayuda/tour-pasos';
import { BottomNav } from './bottom-nav';
import { Header } from './header';
import { SidebarNav } from './sidebar-nav';

// Los objetivos del recorrido (`data-ayuda`) en la navegación: el MISMO valor en la barra de abajo y en la lateral (el
// motor elige el que se ve), y los dos accesos a Configuración (header en el celular, barra lateral en escritorio).
const auth = { session: null, user: null, status: 'ready', signOut: async () => ({ ok: true }) } as AuthContextValue;
const miembro = { member: null, status: 'ready', marcarTourVisto: async () => {} } as unknown as MemberContextValue;

let root: Root;
let contenedor: HTMLElement;

/** Dibuja el header y las dos barras con «Reportar un problema» visible o no (el estado se fija ANTES de dibujar). */
async function montar(reportarVisible: boolean) {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  reportar.visible = reportarVisible;
  contenedor = document.createElement('div');
  document.body.appendChild(contenedor);
  root = createRoot(contenedor);
  await act(async () => {
    root.render(
      <AuthContext.Provider value={auth}>
        <MemberContext.Provider value={miembro}>
          <MemoryRouter initialEntries={['/']}>
            <Header />
            <SidebarNav />
            <BottomNav />
          </MemoryRouter>
        </MemberContext.Provider>
      </AuthContext.Provider>,
    );
  });
}

afterEach(async () => {
  await act(async () => root.unmount());
  contenedor.remove();
  reportar.visible = false;
});

/** Los `href` de los elementos con ese `data-ayuda`, y si están en el header o en una barra de navegación. */
function destinos(objetivo: string) {
  return [...document.querySelectorAll<HTMLAnchorElement>(`[data-ayuda="${objetivo}"]`)].map((a) => ({
    href: a.getAttribute('href'),
    zona: a.closest('header') ? 'header' : 'navegacion',
  }));
}

/** Los nombres accesibles de los enlaces y botones del header, en orden. */
const accionesDelHeader = () =>
  [...document.querySelector('header')!.querySelectorAll('a, button')].map((el) => el.getAttribute('aria-label'));

/** Lo que NO depende de «Reportar un problema»: la navegación es la misma con la función visible o oculta. */
function pruebasDeNavegacion() {
  it.each([
    ['nav-viajes', '/viajes'],
    ['nav-gastos', '/gastos'],
    ['nav-clientes', '/clientes'],
    ['nav-resumen', '/resumen'],
  ])('%s: en la barra lateral Y en la de abajo, los dos al mismo destino', (objetivo, href) => {
    const lista = destinos(objetivo);
    expect(lista).toHaveLength(2);
    expect(lista.every((d) => d.href === href)).toBe(true);
  });

  it('Configuración: el botón del header y el ítem de la barra lateral (no está en la de abajo)', () => {
    const lista = destinos('nav-configuracion');
    expect(lista).toHaveLength(2);
    expect(lista.every((d) => d.href === '/configuracion')).toBe(true);
    expect(lista.filter((d) => d.zona === 'header')).toHaveLength(1);
  });
}

describe('objetivos del recorrido en la navegación: «Reportar un problema» APAGADO (el estado por defecto)', () => {
  beforeEach(async () => {
    await montar(false);
  });

  pruebasDeNavegacion();

  it('no hay atajo de "Reportar un problema": ningún `data-ayuda="reportar"` ni enlace a /reportar; el header queda con Configuración y Salir', () => {
    expect(destinos('reportar')).toHaveLength(0);
    expect(document.querySelector('a[href="/reportar"]')).toBeNull();
    expect(accionesDelHeader()).toEqual(['Configuración', 'Salir']);
  });

  it('Inicio no es objetivo; ningún otro `data-ayuda` fuera de los del recorrido (sin el de Reportar)', () => {
    const validos = new Set(pasosDelTour(false).map((p) => p.objetivo).filter(Boolean));
    const usados = [...document.querySelectorAll('[data-ayuda]')].map((e) => e.getAttribute('data-ayuda'));
    expect(usados.length).toBe(4 * 2 + 2);
    for (const u of usados) expect(validos.has(u)).toBe(true);
    expect(document.querySelector('a[href="/"][data-ayuda]')).toBeNull();
  });
});

describe('objetivos del recorrido en la navegación: «Reportar un problema» ENCENDIDO', () => {
  beforeEach(async () => {
    await montar(true);
  });

  pruebasDeNavegacion();

  it('"Reportar un problema": el atajo del header', () => {
    const lista = destinos('reportar');
    expect(lista).toHaveLength(1);
    expect(lista[0]!.zona).toBe('header');
    expect(lista[0]!.href).toBe('/reportar');
  });

  it('el atajo: nombre accesible, ícono decorativo, 48 px y primero en el header (como antes de ocultarlo)', () => {
    const atajo = document.querySelector<HTMLAnchorElement>('header [data-ayuda="reportar"]')!;
    expect(atajo.getAttribute('aria-label')).toBe('Reportar un problema');
    expect(atajo.getAttribute('title')).toBe('Reportar un problema');
    expect(atajo.className).toContain('h-12');
    expect(atajo.className).toContain('w-12');
    expect(atajo.className).not.toContain('hidden');
    expect(atajo.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
    expect(accionesDelHeader()).toEqual(['Reportar un problema', 'Configuración', 'Salir']);
  });

  it('Inicio no es objetivo; ningún otro `data-ayuda` fuera de los del recorrido', () => {
    const validos = new Set(pasosDelTour(true).map((p) => p.objetivo).filter(Boolean));
    const usados = [...document.querySelectorAll('[data-ayuda]')].map((e) => e.getAttribute('data-ayuda'));
    expect(usados.length).toBe(4 * 2 + 2 + 1);
    for (const u of usados) expect(validos.has(u)).toBe(true);
    expect(document.querySelector('a[href="/"][data-ayuda]')).toBeNull();
  });
});
