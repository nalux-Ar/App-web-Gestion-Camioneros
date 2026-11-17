import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ResultadoDeSumar } from './resultado-de-sumar';
import type { ResultadoParaMostrar } from './sumar-gastos-resultado';

// El aviso de lo que pasó al tocar «Sumar»: lo sumado, lo que ya estaba y lo que no se pudo sumar (y por qué), con «Volver al viaje».

const VIAJE = 'b0000000-0000-4000-8000-000000000001';

function Destino() {
  const location = useLocation();
  return <div id="destino" data-pathname={location.pathname} data-state={JSON.stringify(location.state ?? null)} />;
}

let root: Root;
let container: HTMLElement;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  expect(errorSpy.mock.calls.map((c: unknown[]) => String(c[0]))).toEqual([]);
  errorSpy.mockRestore();
});

async function dibujar(resultado: ResultadoParaMostrar, state: unknown = { volver: '?mes=2025-06' }) {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/sumar']}>
        <Routes>
          <Route path="/sumar" element={<ResultadoDeSumar resultado={resultado} alViaje={{ to: `/viajes/${VIAJE}`, state }} />} />
          <Route path="/viajes/:id" element={<Destino />} />
        </Routes>
      </MemoryRouter>,
    );
  });
}

const aviso = () => container.querySelector<HTMLElement>('[role="status"]')!;
const parrafos = () => [...aviso().querySelectorAll('p')].map((p) => p.textContent);
const lineas = () => [...aviso().querySelectorAll('li')].map((li) => li.textContent);

describe('ResultadoDeSumar', () => {
  it('es un aviso de estado (`role="status"`: el lector de pantalla lo anuncia sin interrumpir)', async () => {
    await dibujar({ sumados: 1, yaEstaban: 0, noSumados: [] });
    expect(aviso().getAttribute('role')).toBe('status');
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('solo sumados: «Sumaste N gastos al viaje.», con el estilo de «salió bien» y sin lista', async () => {
    await dibujar({ sumados: 3, yaEstaban: 0, noSumados: [] });
    expect(parrafos()).toEqual(['Sumaste 3 gastos al viaje.']);
    expect(container.querySelector('ul')).toBeNull();
    expect(aviso().className).toContain('border-primary/50');
    expect(aviso().className).toContain('bg-primary/10');
    expect(aviso().querySelector('svg')!.getAttribute('class')).toContain('text-primary');
  });

  it('en singular: «Sumaste 1 gasto al viaje.»', async () => {
    await dibujar({ sumados: 1, yaEstaban: 0, noSumados: [] });
    expect(parrafos()).toEqual(['Sumaste 1 gasto al viaje.']);
  });

  it('sumados y que ya estaban: las dos frases, en ese orden', async () => {
    await dibujar({ sumados: 2, yaEstaban: 3, noSumados: [] });
    expect(parrafos()).toEqual(['Sumaste 2 gastos al viaje.', '3 ya estaban en este viaje.']);
    await dibujar({ sumados: 2, yaEstaban: 1, noSumados: [] });
    expect(parrafos()).toEqual(['Sumaste 2 gastos al viaje.', '1 ya estaba en este viaje.']);
  });

  it('solo «ya estaban»: no dice «Sumaste 0» ni «No se sumó ningún gasto» (lo que se pidió ya estaba hecho)', async () => {
    await dibujar({ sumados: 0, yaEstaban: 2, noSumados: [] });
    expect(parrafos()).toEqual(['2 ya estaban en este viaje.']);
    expect(aviso().className).toContain('border-primary/50');
  });

  it('con gastos que no se pudieron sumar: «M no se pudieron sumar:» y una línea por cada uno, en su orden', async () => {
    await dibujar({
      sumados: 1,
      yaEstaban: 1,
      noSumados: [
        { gastoId: 'a', texto: 'Peajes · 15 jun 2025: Ya está en otro viaje.' },
        { gastoId: 'b', texto: 'Lavado · 14 jun 2025: Es de otro camión.' },
      ],
    });
    expect(parrafos()).toEqual(['Sumaste 1 gasto al viaje.', '1 ya estaba en este viaje.', '2 no se pudieron sumar:']);
    expect(lineas()).toEqual(['Peajes · 15 jun 2025: Ya está en otro viaje.', 'Lavado · 14 jun 2025: Es de otro camión.']);
    expect(aviso().querySelector('ul')!.className).toContain('list-disc');
    expect(aviso().querySelector('ul')!.className).toContain('[overflow-wrap:anywhere]'); // un texto largo se parte, no se sale a 360 px
  });

  it('uno solo que no se pudo: «1 no se pudo sumar:» (singular)', async () => {
    await dibujar({ sumados: 2, yaEstaban: 0, noSumados: [{ gastoId: 'a', texto: 'Gasto: Ya no está disponible.' }] });
    expect(parrafos()).toEqual(['Sumaste 2 gastos al viaje.', '1 no se pudo sumar:']);
  });

  it('si no se sumó NADA: «No se sumó ningún gasto.» y el aviso es neutro (sin el estilo de «salió bien», con el ícono de información)', async () => {
    await dibujar({ sumados: 0, yaEstaban: 0, noSumados: [{ gastoId: 'a', texto: 'Peajes · 15 jun 2025: Ya está en otro viaje.' }] });
    expect(parrafos()).toEqual(['No se sumó ningún gasto.', '1 no se pudo sumar:']);
    expect(aviso().className).not.toContain('border-primary');
    expect(aviso().querySelector('svg')!.getAttribute('class') ?? '').not.toContain('text-primary');
  });

  it('cada línea es texto plano (nada de HTML interpretado) y el ícono es decorativo', async () => {
    await dibujar({ sumados: 0, yaEstaban: 0, noSumados: [{ gastoId: 'a', texto: '<img src=x onerror=alert(1)>: Ya está en otro viaje.' }] });
    expect(container.querySelector('img')).toBeNull();
    expect(lineas()[0]).toBe('<img src=x onerror=alert(1)>: Ya está en otro viaje.');
    expect(aviso().querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('«Volver al viaje» es un botón de 48 px (secundario, a todo el ancho en el celular) que lleva al detalle con el estado recibido', async () => {
    await dibujar({ sumados: 1, yaEstaban: 0, noSumados: [] }, { volver: '?mes=2025-06', desdeCliente: 'a0000000-0000-4000-8000-0000000000c1' });
    const volver = [...aviso().querySelectorAll('a')].find((a) => a.textContent === 'Volver al viaje')!;
    expect(volver.getAttribute('href')).toBe(`/viajes/${VIAJE}`);
    expect(volver.className).toContain('h-12');
    expect(volver.className).toContain('w-full');
    expect(volver.className).toContain('border'); // outline
    await act(async () => {
      volver.click();
    });
    const destino = document.getElementById('destino')!;
    expect(destino.dataset.pathname).toBe(`/viajes/${VIAJE}`);
    expect(JSON.parse(destino.dataset.state!)).toEqual({ volver: '?mes=2025-06', desdeCliente: 'a0000000-0000-4000-8000-0000000000c1' });
  });

  it('también ofrece «Volver al viaje» cuando no se sumó nada', async () => {
    await dibujar({ sumados: 0, yaEstaban: 0, noSumados: [{ gastoId: 'a', texto: 'x: y' }] });
    expect([...aviso().querySelectorAll('a')].some((a) => a.textContent === 'Volver al viaje')).toBe(true);
  });
});
