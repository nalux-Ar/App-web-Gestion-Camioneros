import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Las dos tarjetas del camión se prueban en `camion-activo-card.test.tsx` (con su base de mentira); acá son marcadores, para
// ver DÓNDE queda cada cosa de Inicio sin armar la base.
vi.mock('@/features/camiones/camion-activo-card', async () => {
  const { createElement } = await import('react');
  return { CamionActivoCard: () => createElement('div', { 'data-prueba': 'camion-activo', 'data-ayuda': 'camion' }) };
});
vi.mock('@/features/camiones/cargar-camion-card', async () => {
  const { createElement } = await import('react');
  return { CargarCamionCard: () => createElement('div', { 'data-prueba': 'cargar-camion' }) };
});

import { MemberContext, type MemberContextValue } from '@/features/member/member-context';
import { InicioPage } from './inicio-page';

const miembro = {
  member: { rol: 'admin', tema: 'dark', colorAcento: '#F59E0B', transportistaId: 'tenant-a', transportistaNombre: 'Cuenta', camionActivoId: null, tourVersionVista: 1 },
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

function Ubicacion() {
  const { pathname } = useLocation();
  return <div id="ubicacion" data-pathname={pathname} />;
}

beforeEach(async () => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  app = document.createElement('div');
  app.id = 'root';
  document.body.appendChild(app);
  root = createRoot(app);
  await act(async () => {
    root.render(
      <MemberContext.Provider value={miembro}>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/" element={<InicioPage />} />
            <Route path="*" element={<p>otra pantalla</p>} />
          </Routes>
          <Ubicacion />
        </MemoryRouter>
      </MemberContext.Provider>,
    );
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = '';
});

/** Los cuatro accesos de Inicio, en el orden en que están en la pantalla. */
const enlaces = () => [...app.querySelectorAll<HTMLAnchorElement>('a')];
const porTexto = (texto: string) => enlaces().find((a) => a.textContent?.trim() === texto)!;
const clases = (el: Element) => el.className.split(/\s+/);
const ubicacion = () => document.getElementById('ubicacion')!.dataset.pathname;

describe('Inicio: las acciones de todos los días', () => {
  it('hay EXACTAMENTE 4 enlaces, en este orden, con estos textos y estos destinos', () => {
    expect(enlaces().map((a) => [a.textContent?.trim(), a.getAttribute('href')])).toEqual([
      ['Anotar un gasto', '/gastos/nuevo'],
      ['Anotar un viaje', '/viajes/nuevo'],
      ['Ver mis viajes', '/viajes'],
      ['Resumen', '/resumen'],
    ]);
  });

  it('«Clientes» ya NO está en Inicio (ni como texto ni como enlace): sigue en las barras de navegación', () => {
    expect(app.textContent).not.toContain('Clientes');
    expect(app.querySelector('a[href^="/clientes"]')).toBeNull();
    // Y las otras tarjetas viejas tampoco: nada repite la barra de abajo.
    expect(app.querySelector('a[href="/gastos"]')).toBeNull();
    expect(app.querySelector('[class*="grid-cols-3"], [class*="sm:grid-cols-3"]')).toBeNull();
  });

  it('son ENLACES de verdad (<a href>), no botones que naveguen por código; el único botón de la pantalla es «Ayuda»', () => {
    for (const a of enlaces()) {
      expect(a.tagName).toBe('A');
      expect(a.getAttribute('href')).toMatch(/^\//);
      expect(a.getAttribute('data-slot')).toBe('button'); // con el aspecto de botón de la app
      expect(a.getAttribute('tabindex')).not.toBe('-1'); // entran en el Tab
      expect(a.hasAttribute('onclick')).toBe(false);
    }
    expect([...app.querySelectorAll('button')].map((b) => b.textContent?.trim())).toEqual(['Ayuda']);
  });

  it('los dos principales son GRANDES: 56 px (h-14), texto de 18 px (text-lg), a todo el ancho y del color principal', () => {
    for (const texto of ['Anotar un gasto', 'Anotar un viaje']) {
      const a = porTexto(texto);
      expect(clases(a), texto).toEqual(expect.arrayContaining(['h-14', 'text-lg', 'w-full', 'bg-primary', 'text-primary-foreground']));
    }
  });

  it('cada principal lleva su ícono decorativo (aria-hidden) y de tamaño visible: paquete para el gasto, camión para el viaje', () => {
    const gasto = porTexto('Anotar un gasto').querySelector('svg')!;
    const viaje = porTexto('Anotar un viaje').querySelector('svg')!;
    expect(gasto.getAttribute('aria-hidden')).toBe('true');
    expect(viaje.getAttribute('aria-hidden')).toBe('true');
    expect(gasto.getAttribute('class')).toContain('lucide-package');
    expect(viaje.getAttribute('class')).toContain('lucide-truck');
    // El texto del enlace (su nombre accesible) es solo el rótulo: el ícono no suma nada.
    expect(porTexto('Anotar un gasto').textContent).toBe('Anotar un gasto');
    // El botón los agranda de 16 a 24 px.
    expect(clases(porTexto('Anotar un gasto'))).toContain('[&_svg]:size-6');
  });

  it('los dos de abajo van en una fila de 2, de contorno, de 48 px como mínimo y con texto de 16 px o más', () => {
    const fila = porTexto('Ver mis viajes').parentElement!;
    expect(fila).toBe(porTexto('Resumen').parentElement);
    expect(clases(fila)).toEqual(expect.arrayContaining(['grid', 'grid-cols-2']));
    for (const texto of ['Ver mis viajes', 'Resumen']) {
      const a = porTexto(texto);
      expect(clases(a), texto).toEqual(expect.arrayContaining(['min-h-12', 'border-input', 'text-base']));
      expect(clases(a), texto).not.toContain('bg-primary');
      // Nada de texto chico (menos de 16 px).
      expect(clases(a).filter((c) => /^text-(?:xs|sm)$/.test(c)), texto).toEqual([]);
      // En una pantalla angosta el rótulo puede partirse en dos líneas en vez de salirse del botón.
      expect(clases(a), texto).toContain('whitespace-normal');
      expect(clases(a), texto).toContain('h-auto');
    }
  });

  it('el orden en pantalla: saludo, camión, los dos grandes, los dos de abajo (el camión queda arriba de los botones)', () => {
    const antes = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    const h1 = app.querySelector('h1')!;
    const cargar = app.querySelector('[data-prueba="cargar-camion"]')!;
    const camion = app.querySelector('[data-prueba="camion-activo"]')!;
    const orden = [h1, cargar, camion, porTexto('Anotar un gasto'), porTexto('Anotar un viaje'), porTexto('Ver mis viajes'), porTexto('Resumen')];
    for (let i = 0; i < orden.length - 1; i++) expect(antes(orden[i]!, orden[i + 1]!), `${i}`).toBe(true);
  });

  it('en escritorio la columna de acciones se limita (max-w-xl) y no se centra: los botones no quedan desmesurados', () => {
    const columna = porTexto('Anotar un gasto').parentElement!;
    expect(columna).toBe(porTexto('Anotar un viaje').parentElement);
    expect(columna.contains(porTexto('Resumen'))).toBe(true);
    expect(clases(columna)).toContain('max-w-xl');
    expect(clases(columna)).not.toContain('mx-auto');
  });

  it('el saludo, la pregunta, el botón «Ayuda» (data-ayuda="ayuda-inicio") y el camión (data-ayuda="camion") siguen como estaban', () => {
    expect(app.querySelector('h1')!.textContent).toBe('Hola, Cuenta');
    expect(app.textContent).toContain('¿Qué quieres hacer hoy?');
    expect(app.querySelector('button[aria-label="Ayuda de esta pantalla"]')!.getAttribute('data-ayuda')).toBe('ayuda-inicio');
    expect(app.querySelectorAll('[data-ayuda="camion"]')).toHaveLength(1);
  });

  it('solo colores del tema: ninguna clase de color fijo (ni hexadecimal)', () => {
    const todas = [...app.querySelectorAll('[class]')].map((el) => el.getAttribute('class')).join(' ');
    expect(todas).not.toMatch(/(?:bg|text|border|ring|shadow|fill|stroke)-(?:red|green|blue|gray|slate|zinc|neutral|black|white|yellow|amber|orange)\b/);
    expect(todas).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it.each([
    ['Anotar un gasto', '/gastos/nuevo'],
    ['Anotar un viaje', '/viajes/nuevo'],
    ['Ver mis viajes', '/viajes'],
    ['Resumen', '/resumen'],
  ])('tocar «%s» lleva a %s', async (texto, destino) => {
    expect(ubicacion()).toBe('/');
    await act(async () => porTexto(texto).click());
    expect(ubicacion()).toBe(destino);
    expect(app.textContent).toContain('otra pantalla');
  });
});
