import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AuthContext, type AuthContextValue } from '@/features/auth/auth-context';
import { MemberContext, type MemberContextValue } from '@/features/member/member-context';
import { TOUR_PASOS } from '@/features/ayuda/tour-pasos';
import { BottomNav } from './bottom-nav';
import { Header } from './header';
import { SidebarNav } from './sidebar-nav';

// Los objetivos del recorrido (`data-ayuda`) en la navegación: el MISMO valor en la barra de abajo y en la lateral (el
// motor elige el que se ve), y los dos accesos a Configuración (header en el celular, barra lateral en escritorio).
const auth = { session: null, user: null, status: 'ready', signOut: async () => ({ ok: true }) } as AuthContextValue;
const miembro = { member: null, status: 'ready', marcarTourVisto: async () => {} } as unknown as MemberContextValue;

let root: Root;
let contenedor: HTMLElement;

beforeEach(async () => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
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
});

afterEach(async () => {
  await act(async () => root.unmount());
  contenedor.remove();
});

/** Los `href` de los elementos con ese `data-ayuda`, y si están en el header o en una barra de navegación. */
function destinos(objetivo: string) {
  return [...document.querySelectorAll<HTMLAnchorElement>(`[data-ayuda="${objetivo}"]`)].map((a) => ({
    href: a.getAttribute('href'),
    zona: a.closest('header') ? 'header' : 'navegacion',
  }));
}

describe('objetivos del recorrido en la navegación', () => {
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

  it('"Reportar un problema": el atajo del header', () => {
    const lista = destinos('reportar');
    expect(lista).toHaveLength(1);
    expect(lista[0]!.zona).toBe('header');
    expect(lista[0]!.href).toBe('/reportar');
  });

  it('Inicio no es objetivo; ningún otro `data-ayuda` fuera de los del recorrido', () => {
    const validos = new Set(TOUR_PASOS.map((p) => p.objetivo).filter(Boolean));
    const usados = [...document.querySelectorAll('[data-ayuda]')].map((e) => e.getAttribute('data-ayuda'));
    expect(usados.length).toBe(4 * 2 + 2 + 1);
    for (const u of usados) expect(validos.has(u)).toBe(true);
    expect(document.querySelector('a[href="/"][data-ayuda]')).toBeNull();
  });
});
