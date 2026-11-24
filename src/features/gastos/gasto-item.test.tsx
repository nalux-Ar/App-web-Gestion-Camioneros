import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Categoria } from './categorias';
import { COMBUSTIBLE_CATEGORIA_ID } from './constants';
import type { GastoDeFila } from './gastos-api';
import { GastoItem } from './gasto-item';

// La fila de un gasto: el MONTO lleva «$» («$ 5.000», con centavos si los hay); los litros no. El «$» y la cifra van unidos por un
// espacio que no corta línea.

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

const COMBUSTIBLE: Categoria = { id: COMBUSTIBLE_CATEGORIA_ID, nombre: 'Combustible', activa: true, transportista_id: null };
const PEAJES: Categoria = { id: 'c-peajes', nombre: 'Peajes', activa: true, transportista_id: 'tenant-a' };

const gasto = (over: Partial<GastoDeFila> = {}): GastoDeFila => ({
  id: 'g-1',
  categoria_id: PEAJES.id,
  fecha: '2026-10-12',
  monto: 5000,
  descripcion: null,
  litros: null,
  created_at: '2026-10-12T10:00:00Z',
  ...over,
});

async function montar(g: GastoDeFila, categoria: Categoria | undefined) {
  await act(async () => {
    root.render(
      <MemoryRouter>
        <ul>
          <GastoItem gasto={g} categoria={categoria} />
        </ul>
      </MemoryRouter>,
    );
  });
}

/** El monto de la fila: el texto que va a la derecha. */
const monto = () => container.querySelector('a > p.font-semibold')!.textContent!;
const fila = () => container.querySelector('a')!.textContent!;

describe('GastoItem: el monto lleva «$»', () => {
  it('un monto entero va sin centavos: «$ 5.000»', async () => {
    await montar(gasto({ monto: 5000 }), PEAJES);
    expect(monto()).toBe('$\xa05.000');
  });

  it('con centavos, siempre 2 decimales: «$ 1.250,50»', async () => {
    await montar(gasto({ monto: 1250.5 }), PEAJES);
    expect(monto()).toBe('$\xa01.250,50');
  });

  it('un monto de 4 dígitos también lleva punto de miles, y uno grande también', async () => {
    await montar(gasto({ monto: 1234 }), PEAJES);
    expect(monto()).toBe('$\xa01.234');
    await montar(gasto({ monto: 1234567.89 }), PEAJES);
    expect(monto()).toBe('$\xa01.234.567,89');
  });

  it('sin el «,00» de los enteros ni el «$» pegado a la cifra', async () => {
    await montar(gasto({ monto: 800 }), PEAJES);
    expect(monto()).not.toContain(',');
    expect(monto()).toMatch(/^\$\xa0\d/);
  });
});

describe('GastoItem: los litros NO llevan «$»', () => {
  it('combustible con litros: «40 L» sin «$»; el «$» es solo el del monto', async () => {
    await montar(gasto({ categoria_id: COMBUSTIBLE.id, monto: 60000, litros: 40 }), COMBUSTIBLE);
    expect(fila()).toContain('40 L');
    expect(fila()).not.toMatch(/\$\xa0?40/);
    expect(monto()).toBe('$\xa060.000');
    expect(fila().match(/\$/g)).toHaveLength(1);
  });

  it('litros con decimales: «40,125 L», sin «$»', async () => {
    await montar(gasto({ categoria_id: COMBUSTIBLE.id, monto: 60000, litros: 40.125 }), COMBUSTIBLE);
    expect(fila()).toContain('40,125 L');
    expect(fila().match(/\$/g)).toHaveLength(1);
  });

  it('un gasto sin litros tiene un solo «$»: el de su monto', async () => {
    await montar(gasto({ descripcion: 'Peaje norte' }), PEAJES);
    expect(fila().match(/\$/g)).toHaveLength(1);
  });
});
