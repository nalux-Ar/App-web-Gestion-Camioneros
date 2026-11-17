import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ResultadoParaMostrarDeQuitar } from './quitar-gastos-resultado';
import { ResultadoDeQuitar } from './resultado-de-quitar';

// El aviso de lo que pasó al tocar «Quitar»: lo quitado, que no se borró nada y lo que ya no estaba, con «Volver al viaje».

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

async function dibujar(resultado: ResultadoParaMostrarDeQuitar, state: unknown = { volver: '?mes=2025-06' }) {
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/quitar']}>
        <Routes>
          <Route path="/quitar" element={<ResultadoDeQuitar resultado={resultado} alViaje={{ to: `/viajes/${VIAJE}`, state }} />} />
          <Route path="/viajes/:id" element={<Destino />} />
        </Routes>
      </MemoryRouter>,
    );
  });
}

const aviso = () => container.querySelector<HTMLElement>('[role="status"]')!;
const parrafos = () => [...aviso().querySelectorAll('p')].map((p) => p.textContent);

describe('ResultadoDeQuitar', () => {
  it('es un aviso de estado (`role="status"`: el lector de pantalla lo anuncia sin interrumpir), no una alerta', async () => {
    await dibujar({ quitados: 1, yaNoEstaban: 0 });
    expect(aviso().getAttribute('role')).toBe('status');
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('solo quitados: «Quitaste N gastos del viaje.» y la aclaración de que NO se borraron, con el estilo de «salió bien»', async () => {
    await dibujar({ quitados: 3, yaNoEstaban: 0 });
    expect(parrafos()).toEqual(['Quitaste 3 gastos del viaje.', 'Los gastos no se borraron: quedaron sin viaje.']);
    expect(aviso().className).toContain('border-primary/50');
    expect(aviso().className).toContain('bg-primary/10');
    expect(aviso().querySelector('svg')!.getAttribute('class')).toContain('text-primary');
    expect(aviso().querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('en singular: «Quitaste 1 gasto del viaje.» y «El gasto no se borró: quedó sin viaje.»', async () => {
    await dibujar({ quitados: 1, yaNoEstaban: 0 });
    expect(parrafos()).toEqual(['Quitaste 1 gasto del viaje.', 'El gasto no se borró: quedó sin viaje.']);
  });

  it('quitados y que ya no estaban: «Quitaste…», la aclaración (pegada a lo que se quitó) y «K ya no estaban en este viaje.»', async () => {
    await dibujar({ quitados: 2, yaNoEstaban: 3 });
    expect(parrafos()).toEqual(['Quitaste 2 gastos del viaje.', 'Los gastos no se borraron: quedaron sin viaje.', '3 ya no estaban en este viaje.']);
    await dibujar({ quitados: 2, yaNoEstaban: 1 });
    expect(parrafos()).toEqual(['Quitaste 2 gastos del viaje.', 'Los gastos no se borraron: quedaron sin viaje.', '1 ya no estaba en este viaje.']);
  });

  it('solo «ya no estaban»: no dice «Quitaste 0» ni «No se quitó ningún gasto» (lo que se pidió ya estaba hecho) ni «no se borraron» (no se sabe dónde están)', async () => {
    await dibujar({ quitados: 0, yaNoEstaban: 2 });
    expect(parrafos()).toEqual(['2 ya no estaban en este viaje.']);
    expect(aviso().className).toContain('border-primary/50');
    expect(aviso().textContent).not.toContain('borr');
  });

  it('con 0 y 0 (no debería pasar: se manda siempre algo): «No se quitó ningún gasto.» y el aviso es neutro (sin el estilo de «salió bien»)', async () => {
    await dibujar({ quitados: 0, yaNoEstaban: 0 });
    expect(parrafos()).toEqual(['No se quitó ningún gasto.']);
    expect(aviso().className).not.toContain('border-primary');
    expect(aviso().querySelector('svg')!.getAttribute('class') ?? '').not.toContain('text-primary');
  });

  it('la aclaración va en peso normal (no en negrita como lo importante) y todo el texto es de 16 px o más', async () => {
    await dibujar({ quitados: 2, yaNoEstaban: 1 });
    expect(aviso().querySelectorAll('p')[1]!.className).toContain('font-normal');
    expect(aviso().querySelector('[data-slot="alert-description"]')!.className).toContain('font-medium');
    expect(container.querySelectorAll('[class*="text-xs"], [class*="text-sm"]')).toHaveLength(0);
  });

  it('«Volver al viaje» es un botón de 48 px (secundario, a todo el ancho en el celular) que lleva al detalle con el estado recibido', async () => {
    await dibujar({ quitados: 1, yaNoEstaban: 0 }, { volver: '?mes=2025-06', desdeCliente: 'a0000000-0000-4000-8000-0000000000c1' });
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

  it('también ofrece «Volver al viaje» cuando ya no estaban todos', async () => {
    await dibujar({ quitados: 0, yaNoEstaban: 4 });
    expect([...aviso().querySelectorAll('a')].some((a) => a.textContent === 'Volver al viaje')).toBe(true);
  });
});
