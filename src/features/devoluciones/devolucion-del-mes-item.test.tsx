import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DevolucionDelMesItem } from '@/features/devoluciones/devolucion-del-mes-item';
import type { DevolucionDelMes } from '@/features/devoluciones/devoluciones-api';

// La fila real dentro de un router en memoria. Las pantallas de destino de mentira dejan a la vista a dónde se llegó y con
// qué `state` (el `volver` y, en la edición, la marca de origen).
const VIAJE = 'b0000000-0000-4000-8000-000000000001';
const DEV = 'f0000000-0000-4000-8000-000000000001';
const VOLVER = '?vista=devoluciones&mes=2025-08';

const fila = (over: Partial<DevolucionDelMes> = {}): DevolucionDelMes => ({
  id: DEV,
  motivo: 'rotura_danio',
  descripcion: 'Llegaron cajas rotas',
  cliente_id: 'a0000000-0000-4000-8000-000000000001',
  viaje_id: VIAJE,
  created_at: '2025-08-15T10:00:00Z',
  clientes: { nombre: 'Almacén Central' },
  viajes: { fecha: '2025-08-15', origen: 'Rosario', destino: 'Córdoba' },
  ...over,
});

function Destino({ nombre }: { nombre: string }) {
  const location = useLocation();
  return <div id={`destino-${nombre}`} data-pathname={location.pathname} data-state={JSON.stringify(location.state ?? null)} />;
}

let root: Root;
let container: HTMLElement;
let errorSpy: ReturnType<typeof vi.spyOn>;

async function mount(devolucion: DevolucionDelMes = fila(), volver = VOLVER) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/viajes']}>
        <Routes>
          <Route
            path="/viajes"
            element={
              <ul>
                <DevolucionDelMesItem devolucion={devolucion} volver={volver} />
              </ul>
            }
          />
          <Route path="/viajes/:viajeId/devoluciones/:id/editar" element={<Destino nombre="editar" />} />
          <Route path="/viajes/:id" element={<Destino nombre="detalle" />} />
        </Routes>
      </MemoryRouter>,
    );
  });
}

const enlaces = () => [...document.querySelectorAll<HTMLAnchorElement>('li a')];
const principal = () => enlaces()[0]!;
const franja = () => enlaces()[1]!;
const destino = (nombre: string) => document.getElementById(`destino-${nombre}`);
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
  // Ninguna prueba debe dejar warnings de React (anidamiento inválido de DOM, keys...).
  expect(errorSpy.mock.calls.map((c: unknown[]) => String(c[0]))).toEqual([]);
  vi.restoreAllMocks();
});

describe('fila de la pestaña Devoluciones: dos enlaces hermanos', () => {
  it('son exactamente DOS enlaces dentro de la fila', async () => {
    await mount();
    expect(enlaces()).toHaveLength(2);
  });

  it('son HERMANOS: ningún enlace contiene a otro ni está dentro de otro', async () => {
    await mount();
    for (const a of enlaces()) {
      expect(a.querySelector('a'), 'un <a> dentro de otro <a>').toBeNull();
      expect(a.parentElement!.closest('a'), 'un <a> dentro de otro <a>').toBeNull();
    }
    expect(principal().parentElement).toBe(franja().parentElement);
    expect(principal().parentElement!.tagName).toBe('LI');
  });

  it('el principal lleva a EDITAR la devolución (ruta armada con los ids de la fila)', async () => {
    await mount();
    expect(principal().getAttribute('href')).toBe(`/viajes/${VIAJE}/devoluciones/${DEV}/editar`);
  });

  it('la franja lleva al DETALLE del viaje de la devolución', async () => {
    await mount();
    expect(franja().getAttribute('href')).toBe(`/viajes/${VIAJE}`);
  });

  it('cada área táctil es de al menos 44 px: 64 px (min-h-16) el principal y 48 px (min-h-12) la franja', async () => {
    await mount();
    expect(principal().className).toContain('min-h-16');
    expect(franja().className).toContain('min-h-12');
  });

  it('los dos con foco visible, dibujado hacia adentro (el recuadro de la fila no lo recorta)', async () => {
    await mount();
    for (const a of enlaces()) {
      expect(a.className).toContain('focus-visible:ring-2');
      expect(a.className).toContain('focus-visible:ring-inset');
    }
  });
});

describe('fila de la pestaña Devoluciones: lo que muestra', () => {
  it('el principal: cliente, motivo y descripción', async () => {
    await mount();
    const textos = [...principal().querySelectorAll('p')].map((p) => p.textContent);
    expect(textos).toEqual(['Almacén Central', 'Rotura o daño', 'Llegaron cajas rotas']);
    expect(principal().querySelector('p')!.className).toContain('font-medium'); // el cliente, destacado
  });

  it('la descripción se corta a 2 líneas y respeta cortes de palabras largas', async () => {
    await mount();
    const descripcion = principal().querySelectorAll('p')[2]!;
    expect(descripcion.className).toContain('line-clamp-2');
    expect(descripcion.className).toContain('break-words');
  });

  it('sin descripción no hay tercera línea', async () => {
    await mount(fila({ descripcion: null }));
    expect(principal().querySelectorAll('p')).toHaveLength(2);
    await act(async () => {
      root.unmount();
    });
    container.remove();
    await mount(fila({ descripcion: '' }));
    expect(principal().querySelectorAll('p')).toHaveLength(2);
  });

  it('cada motivo con su etiqueta', async () => {
    const esperado = { rotura_danio: 'Rotura o daño', vencimiento: 'Vencimiento', mercaderia_incorrecta: 'Mercadería incorrecta', otro: 'Otro' } as const;
    for (const [motivo, etiqueta] of Object.entries(esperado)) {
      await mount(fila({ motivo: motivo as DevolucionDelMes['motivo'] }));
      expect(principal().textContent).toContain(etiqueta);
      await act(async () => {
        root.unmount();
      });
      container.remove();
    }
  });

  it('un cliente borrado o que no vino embebido se muestra como "Cliente"', async () => {
    await mount(fila({ clientes: null }));
    expect(principal().querySelector('p')!.textContent).toBe('Cliente');
  });

  it('la franja: "origen → destino" y la fecha corta del viaje, como en la lista de viajes (flecha decorativa y " a " para el lector)', async () => {
    await mount();
    expect(franja().textContent).toContain('Rosario');
    expect(franja().textContent).toContain('Córdoba');
    expect(franja().textContent).toContain('15 ago');
    expect(franja().querySelector('[aria-hidden="true"]:not(svg)')!.textContent).toBe('→');
    expect(franja().querySelector('.sr-only')!.textContent).toBe(' a ');
  });

  it('el recorrido largo se corta a 2 líneas', async () => {
    await mount();
    expect(franja().querySelector('.line-clamp-2')).not.toBeNull();
  });
});

describe('fila de la pestaña Devoluciones: todo lo del usuario es TEXTO (nunca HTML)', () => {
  it('cliente, descripción, origen y destino con marcado se muestran literales y no crean elementos', async () => {
    await mount(
      fila({
        clientes: { nombre: '<img src=x onerror=alert(1)>Cliente' },
        descripcion: '<script>alert(1)</script><b>negrita</b>',
        viajes: { fecha: '2025-08-15', origen: '<i>Origen</i>', destino: '<a href="https://evil.test">Destino</a>' },
      }),
    );
    const li = document.querySelector('li')!;
    expect(li.querySelector('img, script, b, i')).toBeNull();
    expect(enlaces()).toHaveLength(2); // el <a> del destino NO se creó
    expect(li.textContent).toContain('<img src=x onerror=alert(1)>Cliente');
    expect(li.textContent).toContain('<script>alert(1)</script><b>negrita</b>');
    expect(li.textContent).toContain('<i>Origen</i>');
    expect(li.textContent).toContain('<a href="https://evil.test">Destino</a>');
  });
});

describe('fila de la pestaña Devoluciones: el state con el que se navega', () => {
  it('el principal lleva el volver (pestaña y mes) y la marca de ORIGEN "lista-devoluciones"', async () => {
    await mount();
    await click(principal());
    expect(destino('editar')).not.toBeNull();
    expect(destino('editar')!.dataset.pathname).toBe(`/viajes/${VIAJE}/devoluciones/${DEV}/editar`);
    expect(JSON.parse(destino('editar')!.dataset.state!)).toEqual({ volver: VOLVER, origen: 'lista-devoluciones' });
  });

  it('la franja lleva SOLO el volver: sin la marca de origen (esa es solo de la edición)', async () => {
    await mount();
    await click(franja());
    expect(destino('detalle')).not.toBeNull();
    expect(destino('detalle')!.dataset.pathname).toBe(`/viajes/${VIAJE}`);
    expect(JSON.parse(destino('detalle')!.dataset.state!)).toEqual({ volver: VOLVER });
  });
});
