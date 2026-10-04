import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation, useNavigationType, useSearchParams } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readFiltro } from '@/features/viajes/viajes-filters';
import { ViajesPestanas } from '@/features/viajes/viajes-pestanas';

// El componente real, dentro de un router en memoria. `Pantalla` hace lo que la pantalla de Viajes: lee el filtro de la URL
// y se lo pasa a las pestañas; `Sonda` deja a la vista a dónde se navegó y cómo (PUSH o REPLACE).
function Pantalla() {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const tipo = useNavigationType();
  return (
    <>
      <ViajesPestanas filtro={readFiltro(searchParams)} />
      <div id="sonda" data-pathname={location.pathname} data-search={location.search} data-tipo={tipo} data-state={JSON.stringify(location.state ?? null)} />
    </>
  );
}

let root: Root;
let container: HTMLElement;
let errorSpy: ReturnType<typeof vi.spyOn>;

async function mount(entrada: string) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[entrada]}>
        <Routes>
          <Route path="/viajes" element={<Pantalla />} />
        </Routes>
      </MemoryRouter>,
    );
  });
}

const enlaces = () => [...document.querySelectorAll<HTMLAnchorElement>('nav a')];
const enlace = (texto: string) => enlaces().find((a) => a.textContent === texto)!;
const sonda = () => document.getElementById('sonda')!;
async function click(el: HTMLElement) {
  await act(async () => {
    el.click();
  });
}

beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  container?.remove();
  // Ninguna prueba debe dejar warnings de React.
  expect(errorSpy.mock.calls.map((c: unknown[]) => String(c[0]))).toEqual([]);
  vi.restoreAllMocks();
});

describe('pestañas de Viajes: estructura', () => {
  it('son dos ENLACES ("Viajes" y "Devoluciones") dentro de un nav con nombre; no son pestañas ARIA', async () => {
    await mount('/viajes');
    const nav = document.querySelector('nav')!;
    expect(nav.getAttribute('aria-label')).toBe('Viajes y devoluciones');
    expect(enlaces().map((a) => a.textContent)).toEqual(['Viajes', 'Devoluciones']);
    expect(document.querySelectorAll('nav a')).toHaveLength(2);
    // Nada de role="tab" / tablist / tabpanel (prometen un manejo de flechas que acá no existe) ni botones.
    expect(document.querySelector('[role="tab"], [role="tablist"], [role="tabpanel"]')).toBeNull();
    expect(nav.querySelector('button')).toBeNull();
  });

  it('por defecto (sin ?vista=) la activa es Viajes, con aria-current="page"; la otra no lo lleva', async () => {
    await mount('/viajes');
    expect(enlace('Viajes').getAttribute('aria-current')).toBe('page');
    expect(enlace('Devoluciones').hasAttribute('aria-current')).toBe(false);
  });

  it('con ?vista=devoluciones la activa es Devoluciones', async () => {
    await mount('/viajes?vista=devoluciones');
    expect(enlace('Devoluciones').getAttribute('aria-current')).toBe('page');
    expect(enlace('Viajes').hasAttribute('aria-current')).toBe(false);
  });

  it('un ?vista= inválido se ignora: la activa es Viajes', async () => {
    await mount('/viajes?vista=Devoluciones');
    expect(enlace('Viajes').getAttribute('aria-current')).toBe('page');
    expect(enlace('Devoluciones').hasAttribute('aria-current')).toBe(false);
  });

  it('exactamente UNA pestaña es la actual', async () => {
    for (const entrada of ['/viajes', '/viajes?vista=devoluciones', '/viajes?mes=2025-08&vista=devoluciones']) {
      await mount(entrada);
      expect(document.querySelectorAll('[aria-current="page"]'), entrada).toHaveLength(1);
      await act(async () => {
        root.unmount();
      });
      container.remove();
    }
  });
});

describe('pestañas de Viajes: los enlaces', () => {
  it('Viajes es /viajes y Devoluciones es /viajes?vista=devoluciones (el mes actual no se escribe)', async () => {
    await mount('/viajes');
    expect(enlace('Viajes').getAttribute('href')).toBe('/viajes');
    expect(enlace('Devoluciones').getAttribute('href')).toBe('/viajes?vista=devoluciones');
  });

  it('conservan el mes en las dos pestañas, desde cualquiera de las dos', async () => {
    await mount('/viajes?mes=2025-08');
    expect(enlace('Viajes').getAttribute('href')).toBe('/viajes?mes=2025-08');
    expect(enlace('Devoluciones').getAttribute('href')).toBe('/viajes?vista=devoluciones&mes=2025-08');
    await act(async () => {
      root.unmount();
    });
    container.remove();

    await mount('/viajes?vista=devoluciones&mes=2025-08');
    expect(enlace('Viajes').getAttribute('href')).toBe('/viajes?mes=2025-08');
    expect(enlace('Devoluciones').getAttribute('href')).toBe('/viajes?vista=devoluciones&mes=2025-08');
  });

  it('un mes inválido en la URL no se copia a los enlaces (cae en el actual y no se escribe)', async () => {
    await mount('/viajes?vista=devoluciones&mes=2999-01');
    expect(enlace('Viajes').getAttribute('href')).toBe('/viajes');
    expect(enlace('Devoluciones').getAttribute('href')).toBe('/viajes?vista=devoluciones');
  });

  it('los parámetros ajenos de la URL no se arrastran', async () => {
    await mount('/viajes?vista=devoluciones&mes=2025-08&evil=%3Cscript%3E');
    for (const a of enlaces()) expect(a.getAttribute('href'), a.textContent ?? '').not.toContain('evil');
  });
});

describe('pestañas de Viajes: cambiar de pestaña', () => {
  it('toca Devoluciones: va a /viajes?vista=devoluciones&mes=… con el mes conservado y el activo cambia', async () => {
    await mount('/viajes?mes=2025-08');
    await click(enlace('Devoluciones'));
    expect(sonda().dataset.pathname).toBe('/viajes');
    expect(sonda().dataset.search).toBe('?vista=devoluciones&mes=2025-08');
    expect(enlace('Devoluciones').getAttribute('aria-current')).toBe('page');
    expect(enlace('Viajes').hasAttribute('aria-current')).toBe(false);
  });

  it('vuelve a Viajes: la pestaña por defecto deja de escribirse y el mes se conserva', async () => {
    await mount('/viajes?vista=devoluciones&mes=2025-08');
    await click(enlace('Viajes'));
    expect(sonda().dataset.search).toBe('?mes=2025-08');
    expect(enlace('Viajes').getAttribute('aria-current')).toBe('page');
  });

  it('con el mes actual, Viajes queda en /viajes a secas', async () => {
    await mount('/viajes?vista=devoluciones');
    await click(enlace('Viajes'));
    expect(sonda().dataset.search).toBe('');
  });

  it('usa REPLACE (no apila historial), igual que el selector de mes', async () => {
    await mount('/viajes');
    expect(sonda().dataset.tipo).toBe('POP'); // la entrada inicial
    await click(enlace('Devoluciones'));
    expect(sonda().dataset.tipo).toBe('REPLACE');
    await click(enlace('Viajes'));
    expect(sonda().dataset.tipo).toBe('REPLACE');
  });

  it('no arrastra el state de la navegación (el aviso de "guardado" no sobrevive al cambio de pestaña)', async () => {
    await mount('/viajes');
    await click(enlace('Devoluciones'));
    expect(sonda().dataset.state).toBe('null');
  });
});

describe('pestañas de Viajes: accesibilidad y estilo', () => {
  it('cada enlace tiene alto táctil de 48 px (min-h-12) y el control ocupa dos columnas de ancho completo', async () => {
    await mount('/viajes');
    for (const a of enlaces()) expect(a.className, a.textContent ?? '').toContain('min-h-12');
    const clases = document.querySelector('nav')!.className;
    expect(clases).toContain('grid');
    expect(clases).toContain('grid-cols-2');
  });

  it('el foco es visible en cada enlace', async () => {
    await mount('/viajes');
    for (const a of enlaces()) expect(a.className, a.textContent ?? '').toContain('focus-visible:ring-2');
  });

  it('la activa no depende del color: lleva borde grueso y negrita; la inactiva, borde transparente y peso normal', async () => {
    await mount('/viajes');
    const activa = enlace('Viajes').className;
    const inactiva = enlace('Devoluciones').className;
    expect(activa).toContain('border-primary');
    expect(activa).toContain('font-semibold');
    expect(inactiva).toContain('border-transparent');
    expect(inactiva).not.toContain('font-semibold');
  });

  it('solo variables del tema: ningún color hardcodeado (ni hex ni colores de paleta ni blanco/negro)', async () => {
    await mount('/viajes?vista=devoluciones');
    const todo = document.querySelector('nav')!.outerHTML;
    expect(todo).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(todo).not.toMatch(/\b(?:bg|text|border|ring)-(?:white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)\b/);
    expect(todo).not.toMatch(/style=/);
  });
});
