import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSeleccionDeGastos } from './use-seleccion-de-gastos';

// Qué gastos están marcados en una lista que se puede refrescar sola: se recorta cuando cambia la lista y lo que se manda es siempre
// selección ∩ lista de ahora. Se prueba el hook suelto, con una lista que la prueba cambia a mano.

const A = 'e1000000-0000-4000-8000-00000000000a';
const B = 'e1000000-0000-4000-8000-00000000000b';
const C = 'e1000000-0000-4000-8000-00000000000c';
const D = 'e1000000-0000-4000-8000-00000000000d';

const visto: { actual: ReturnType<typeof useSeleccionDeGastos> | null; dibujos: number } = { actual: null, dibujos: 0 };
const seleccion = () => visto.actual!;

function Arnes({ ids }: { ids: string[] }) {
  visto.actual = useSeleccionDeGastos(ids);
  visto.dibujos += 1;
  return null;
}

let root: Root;
let container: HTMLElement;
let errorSpy: ReturnType<typeof vi.spyOn>;

async function mostrar(ids: string[]) {
  await act(async () => {
    root.render(<Arnes ids={ids} />);
  });
}
async function hacer(accion: () => void) {
  await act(async () => {
    accion();
  });
}

beforeEach(() => {
  visto.actual = null;
  visto.dibujos = 0;
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

describe('useSeleccionDeGastos', () => {
  it('arranca SIN nada marcado', async () => {
    await mostrar([A, B, C]);
    expect(seleccion().marcados.size).toBe(0);
    expect(seleccion().idsParaEnviar).toEqual([]);
    expect(seleccion().todosMarcados).toBe(false);
  });

  it('alternar marca y desmarca, y lo que se manda sale en el orden de la LISTA (no en el que se marcó)', async () => {
    await mostrar([A, B, C]);
    await hacer(() => seleccion().alternar(C));
    await hacer(() => seleccion().alternar(A));
    expect(seleccion().marcados.has(A) && seleccion().marcados.has(C)).toBe(true);
    expect(seleccion().idsParaEnviar).toEqual([A, C]);
    await hacer(() => seleccion().alternar(C));
    expect(seleccion().idsParaEnviar).toEqual([A]);
    await hacer(() => seleccion().alternar(A));
    expect(seleccion().idsParaEnviar).toEqual([]);
  });

  it('un id que NO está en la lista no se puede marcar (lo marcado es siempre un subconjunto de la lista)', async () => {
    await mostrar([A, B]);
    await hacer(() => seleccion().alternar(D));
    expect(seleccion().marcados.size).toBe(0);
    expect(seleccion().idsParaEnviar).toEqual([]);
  });

  it('marcarTodos marca todo lo de la lista; desmarcarTodos y vaciar dejan la selección en blanco', async () => {
    await mostrar([A, B, C]);
    await hacer(() => seleccion().marcarTodos());
    expect(seleccion().idsParaEnviar).toEqual([A, B, C]);
    expect(seleccion().todosMarcados).toBe(true);
    await hacer(() => seleccion().desmarcarTodos());
    expect(seleccion().marcados.size).toBe(0);
    expect(seleccion().todosMarcados).toBe(false);
    await hacer(() => seleccion().marcarTodos());
    await hacer(() => seleccion().vaciar());
    expect(seleccion().marcados.size).toBe(0);
    expect(seleccion().idsParaEnviar).toEqual([]);
  });

  it('marcarTodos con algo ya marcado completa lo que falta', async () => {
    await mostrar([A, B, C]);
    await hacer(() => seleccion().alternar(B));
    expect(seleccion().todosMarcados).toBe(false);
    await hacer(() => seleccion().marcarTodos());
    expect(seleccion().idsParaEnviar).toEqual([A, B, C]);
  });

  it('con la lista vacía: nada marcado, «todos marcados» es false y marcarTodos no marca nada', async () => {
    await mostrar([]);
    await hacer(() => seleccion().marcarTodos());
    expect(seleccion().marcados.size).toBe(0);
    expect(seleccion().todosMarcados).toBe(false);
  });

  it('cuando la lista CAMBIA, la selección se recorta: lo que ya no está deja de estar marcado y no se manda', async () => {
    await mostrar([A, B, C]);
    await hacer(() => seleccion().marcarTodos());
    await mostrar([A, C]); // la lista se refrescó y B ya no está
    expect(seleccion().marcados.has(B)).toBe(false);
    expect(seleccion().marcados.size).toBe(2);
    expect(seleccion().idsParaEnviar).toEqual([A, C]);
    expect(seleccion().todosMarcados).toBe(true);
  });

  it('si el gasto que salió de la lista VUELVE, vuelve SIN marcar (nunca se manda algo que no se marcó)', async () => {
    await mostrar([A, B, C]);
    await hacer(() => seleccion().alternar(B));
    await hacer(() => seleccion().alternar(A));
    await mostrar([A, C]); // B sale
    expect(seleccion().idsParaEnviar).toEqual([A]);
    await mostrar([A, B, C]); // B vuelve
    expect(seleccion().marcados.has(B)).toBe(false);
    expect(seleccion().idsParaEnviar).toEqual([A]);
    expect(seleccion().todosMarcados).toBe(false);
  });

  it('si en el refresco SALE uno y ENTRA otro (la lista queda con la MISMA cantidad), lo que salió deja de estar marcado y, si vuelve, vuelve SIN marcar', async () => {
    await mostrar([A, B, C]);
    await hacer(() => seleccion().alternar(A));
    await hacer(() => seleccion().alternar(B));
    await mostrar([B, C, D]); // A sale y D entra: sigue habiendo 3
    expect(seleccion().marcados.has(A)).toBe(false);
    expect(seleccion().idsParaEnviar).toEqual([B]);
    await mostrar([A, B, C]); // A vuelve a aparecer
    expect(seleccion().marcados.has(A)).toBe(false); // nadie lo marcó de nuevo: no se suma algo que no se marcó
    expect(seleccion().idsParaEnviar).toEqual([B]);
  });

  it('un gasto que aparece en la lista arranca SIN marcar', async () => {
    await mostrar([A, B]);
    await hacer(() => seleccion().marcarTodos());
    await mostrar([A, B, D]);
    expect(seleccion().idsParaEnviar).toEqual([A, B]);
    expect(seleccion().todosMarcados).toBe(false);
  });

  it('si la lista sigue igual (aunque llegue como un arreglo nuevo) no se pierde nada y no hay renders de más', async () => {
    await mostrar([A, B, C]);
    await hacer(() => seleccion().alternar(A));
    const antes = seleccion().marcados;
    const dibujos = visto.dibujos;
    await mostrar([A, B, C]);
    expect(seleccion().marcados).toBe(antes); // el mismo conjunto
    expect(seleccion().idsParaEnviar).toEqual([A]);
    expect(visto.dibujos).toBe(dibujos + 1); // un solo dibujo por el cambio de propiedades, sin uno extra para recortar
  });

  it('si la lista cambia de ORDEN sin perder nada, la selección se conserva y lo que se manda sigue el orden nuevo', async () => {
    await mostrar([A, B, C]);
    await hacer(() => seleccion().alternar(A));
    await hacer(() => seleccion().alternar(C));
    await mostrar([C, B, A]);
    expect(seleccion().idsParaEnviar).toEqual([C, A]);
  });

  it('marcarTodos usa la lista de AHORA, no la del primer dibujo', async () => {
    await mostrar([A, B]);
    await mostrar([B, C, D]);
    await hacer(() => seleccion().marcarTodos());
    expect(seleccion().idsParaEnviar).toEqual([B, C, D]);
  });

  it('después de vaciar, seguir marcando funciona (vaciar no deja la selección rota)', async () => {
    await mostrar([A, B]);
    await hacer(() => seleccion().marcarTodos());
    await hacer(() => seleccion().vaciar());
    await hacer(() => seleccion().alternar(B));
    expect(seleccion().idsParaEnviar).toEqual([B]);
  });
});
