import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ViajeItem } from './viaje-item';
import type { ViajeDeLista } from './viajes-list';

// La fila de un viaje: lo que cobraste se ve como «Cobraste $ 150.000» (solo si el viaje tiene ingreso); los kilómetros no llevan «$».

let root: Root;
let container: HTMLElement;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

const viaje = (over: Partial<ViajeDeLista> = {}): ViajeDeLista => ({
  id: 'v-1',
  fecha: '2026-10-12',
  origen: 'Rosario',
  destino: 'Córdoba',
  camion_id: null,
  km_inicial: null,
  km_final: null,
  km_recorridos: null,
  ingreso: null,
  created_at: '2026-10-12T10:00:00Z',
  cantidad_entregas: 2,
  ...over,
});

async function montar(v: ViajeDeLista) {
  await act(async () => {
    root.render(
      <MemoryRouter>
        <ul>
          <ViajeItem viaje={v} volver="" />
        </ul>
      </MemoryRouter>,
    );
  });
}

const fila = () => container.querySelector('a')!.textContent!;
/** El texto de cobro de la derecha, si hay. */
const cobro = () => container.querySelector('a > p.font-semibold')?.textContent ?? null;

describe('ViajeItem: «Cobraste $ …»', () => {
  it('con ingreso: «Cobraste $ 150.000»', async () => {
    await montar(viaje({ ingreso: 150000 }));
    expect(cobro()).toBe('Cobraste $\xa0150.000');
  });

  it('con centavos: «Cobraste $ 1.250,50»', async () => {
    await montar(viaje({ ingreso: 1250.5 }));
    expect(cobro()).toBe('Cobraste $\xa01.250,50');
  });

  it('un ingreso de 0 se muestra («Cobraste $ 0»): es distinto de no haberlo anotado', async () => {
    await montar(viaje({ ingreso: 0 }));
    expect(cobro()).toBe('Cobraste $\xa00');
  });

  it('sin ingreso no hay texto de cobro (ni «Cobraste» ni «$»)', async () => {
    await montar(viaje({ ingreso: null }));
    expect(cobro()).toBeNull();
    expect(fila()).not.toContain('Cobraste');
    expect(fila()).not.toContain('$');
  });

  it('el «$» y la cifra no se separan: el cobro se parte entre «Cobraste» y «$ 150.000» (ancho mínimo), nunca entre el «$» y la cifra', async () => {
    await montar(viaje({ ingreso: 150000 }));
    const p = container.querySelector('a > p.font-semibold')!;
    expect(p.className).toContain('w-min');
    expect(p.className).toContain('shrink-0');
    expect(p.textContent).toMatch(/\$\xa0\d/);
    expect(p.textContent).not.toMatch(/\$ \d/); // ningún espacio común entre el «$» y la cifra
  });
});

describe('ViajeItem: los kilómetros NO llevan «$»', () => {
  it('km recorridos: «1.234,5 km» y, con cobro, un solo «$»', async () => {
    await montar(viaje({ km_recorridos: 1234.5, ingreso: 150000 }));
    expect(fila()).toContain('1.234,5 km');
    expect(fila()).not.toMatch(/\$\xa01\.234/);
    expect(fila().match(/\$/g)).toHaveLength(1);
  });

  it('km inicial y final: la diferencia, sin «$»', async () => {
    await montar(viaje({ km_inicial: 45000, km_final: 45900 }));
    expect(fila()).toContain('900 km');
    expect(fila()).not.toContain('$');
  });

  it('sin ingreso y con km: ningún «$» en toda la fila', async () => {
    await montar(viaje({ km_recorridos: 640 }));
    expect(fila()).toContain('640 km');
    expect(fila()).not.toContain('$');
  });
});
