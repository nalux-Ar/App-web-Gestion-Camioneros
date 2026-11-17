import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSeleccionConTope } from './use-seleccion-con-tope';

// Qué gastos están marcados en una lista que se puede refrescar sola, con un TOPE: lo de `useSeleccionDeGastos` (se recorta cuando
// cambia la lista, mirando CUÁLES hay; lo que se manda es siempre selección ∩ lista de ahora) más que nunca hay más de `tope` marcados.
// Se prueba el hook suelto, con una lista que la prueba cambia a mano.

const ids = (n: number) => Array.from({ length: n }, (_, i) => `g${String(i + 1).padStart(3, '0')}`);
const A = 'g-a';
const B = 'g-b';
const C = 'g-c';
const D = 'g-d';

const visto: { actual: ReturnType<typeof useSeleccionConTope> | null; dibujos: number } = { actual: null, dibujos: 0 };
const seleccion = () => visto.actual!;

function Arnes({ lista, tope }: { lista: string[]; tope: number }) {
  visto.actual = useSeleccionConTope(lista, tope);
  visto.dibujos += 1;
  return null;
}

let root: Root;
let container: HTMLElement;
let errorSpy: ReturnType<typeof vi.spyOn>;

async function mostrar(lista: string[], tope = 100) {
  await act(async () => {
    root.render(<Arnes lista={lista} tope={tope} />);
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

describe('useSeleccionConTope: lo de siempre (con un tope que no se alcanza)', () => {
  it('arranca SIN nada marcado', async () => {
    await mostrar([A, B, C]);
    expect(seleccion().marcados.size).toBe(0);
    expect(seleccion().idsParaEnviar).toEqual([]);
    expect(seleccion().todosMarcados).toBe(false);
    expect(seleccion().sinCupo).toBe(false);
  });

  it('alternar marca y desmarca, y lo que se manda sale en el orden de la LISTA (no en el que se marcó)', async () => {
    await mostrar([A, B, C]);
    await hacer(() => seleccion().alternar(C));
    await hacer(() => seleccion().alternar(A));
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

  it('marcarTodos con una lista de hasta el tope marca todo; desmarcarTodos y vaciar dejan la selección en blanco', async () => {
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

  it('con la lista vacía: nada marcado, «todos marcados» es false y marcarTodos no marca nada', async () => {
    await mostrar([]);
    await hacer(() => seleccion().marcarTodos());
    expect(seleccion().marcados.size).toBe(0);
    expect(seleccion().todosMarcados).toBe(false);
    expect(seleccion().sinCupo).toBe(false);
  });
});

describe('useSeleccionConTope: la selección sigue a la lista (mirando CUÁLES gastos hay, no cuántos)', () => {
  it('cuando la lista CAMBIA, lo que ya no está deja de estar marcado y no se manda', async () => {
    await mostrar([A, B, C]);
    await hacer(() => seleccion().marcarTodos());
    await mostrar([A, C]);
    expect(seleccion().marcados.has(B)).toBe(false);
    expect(seleccion().marcados.size).toBe(2);
    expect(seleccion().idsParaEnviar).toEqual([A, C]);
    expect(seleccion().todosMarcados).toBe(true);
  });

  it('si el gasto que salió de la lista VUELVE, vuelve SIN marcar (nunca se manda algo que no se marcó)', async () => {
    await mostrar([A, B, C]);
    await hacer(() => seleccion().alternar(B));
    await hacer(() => seleccion().alternar(A));
    await mostrar([A, C]);
    expect(seleccion().idsParaEnviar).toEqual([A]);
    await mostrar([A, B, C]);
    expect(seleccion().marcados.has(B)).toBe(false);
    expect(seleccion().idsParaEnviar).toEqual([A]);
  });

  it('EL HUECO: si SALE uno y ENTRA otro (la lista queda con la MISMA cantidad), lo que salió deja de estar marcado y, si vuelve, vuelve SIN marcar', async () => {
    await mostrar([A, B, C]);
    await hacer(() => seleccion().alternar(A));
    await hacer(() => seleccion().alternar(B));
    await mostrar([B, C, D]); // A sale y D entra: sigue habiendo 3
    expect(seleccion().marcados.has(A)).toBe(false);
    expect(seleccion().idsParaEnviar).toEqual([B]);
    await mostrar([A, B, C]); // A vuelve a aparecer
    expect(seleccion().marcados.has(A)).toBe(false);
    expect(seleccion().idsParaEnviar).toEqual([B]);
  });

  it('un gasto que aparece en la lista arranca SIN marcar', async () => {
    await mostrar([A, B]);
    await hacer(() => seleccion().marcarTodos());
    await mostrar([A, B, D]);
    expect(seleccion().idsParaEnviar).toEqual([A, B]);
    expect(seleccion().todosMarcados).toBe(false);
  });

  it('si la lista sigue igual (aunque llegue como un arreglo nuevo) no se pierde nada y no hay dibujos de más', async () => {
    await mostrar([A, B, C]);
    await hacer(() => seleccion().alternar(A));
    const antes = seleccion().marcados;
    const dibujos = visto.dibujos;
    await mostrar([A, B, C]);
    expect(seleccion().marcados).toBe(antes);
    expect(seleccion().idsParaEnviar).toEqual([A]);
    expect(visto.dibujos).toBe(dibujos + 1);
  });

  it('si la lista cambia de ORDEN sin perder nada, la selección se conserva y lo que se manda sigue el orden nuevo', async () => {
    await mostrar([A, B, C]);
    await hacer(() => seleccion().alternar(A));
    await hacer(() => seleccion().alternar(C));
    await mostrar([C, B, A]);
    expect(seleccion().idsParaEnviar).toEqual([C, A]);
  });

  it('después de vaciar, seguir marcando funciona', async () => {
    await mostrar([A, B]);
    await hacer(() => seleccion().marcarTodos());
    await hacer(() => seleccion().vaciar());
    await hacer(() => seleccion().alternar(B));
    expect(seleccion().idsParaEnviar).toEqual([B]);
  });
});

describe('useSeleccionConTope: el TOPE', () => {
  it('«marcar todos» con más gastos que el tope marca solo los PRIMEROS `tope`, en el orden de la lista', async () => {
    await mostrar(ids(5), 3);
    await hacer(() => seleccion().marcarTodos());
    expect(seleccion().idsParaEnviar).toEqual(['g001', 'g002', 'g003']);
    expect(seleccion().marcados.size).toBe(3);
  });

  it('con 100 / 101 / 500 gastos y tope 100: «marcar todos» deja exactamente 100 marcados (los 100 primeros)', async () => {
    for (const n of [100, 101, 500]) {
      await mostrar(ids(n), 100);
      await hacer(() => seleccion().marcarTodos());
      expect(seleccion().marcados.size, `con ${n}`).toBe(100);
      expect(seleccion().idsParaEnviar, `con ${n}`).toEqual(ids(100));
      await hacer(() => seleccion().vaciar());
    }
  });

  it('con el tope alcanzado y gastos sin marcar: `sinCupo` es true y marcar uno más NO hace nada', async () => {
    await mostrar(ids(5), 3);
    await hacer(() => seleccion().marcarTodos());
    expect(seleccion().sinCupo).toBe(true);
    await hacer(() => seleccion().alternar('g004'));
    expect(seleccion().marcados.has('g004')).toBe(false);
    expect(seleccion().idsParaEnviar).toEqual(['g001', 'g002', 'g003']);
  });

  it('con el tope alcanzado se puede DESMARCAR uno y entonces se puede marcar otro (de cualquier parte de la lista)', async () => {
    await mostrar(ids(5), 3);
    await hacer(() => seleccion().marcarTodos());
    await hacer(() => seleccion().alternar('g002'));
    expect(seleccion().sinCupo).toBe(false);
    expect(seleccion().idsParaEnviar).toEqual(['g001', 'g003']);
    await hacer(() => seleccion().alternar('g005'));
    expect(seleccion().idsParaEnviar).toEqual(['g001', 'g003', 'g005']);
    expect(seleccion().sinCupo).toBe(true);
  });

  it('el tope se aplica aunque dos toques lleguen en el MISMO dibujo (antes de que la pantalla se vuelva a dibujar)', async () => {
    await mostrar(ids(5), 2);
    await hacer(() => {
      seleccion().alternar('g001');
      seleccion().alternar('g002');
      seleccion().alternar('g003'); // el tercero ya no entra, aunque este dibujo todavía no vio los dos anteriores
      seleccion().alternar('g004');
    });
    expect(seleccion().idsParaEnviar).toEqual(['g001', 'g002']);
  });

  it('el tope nunca se pasa, hagas lo que hagas: marcar a mano hasta el tope y «marcar todos» después', async () => {
    await mostrar(ids(10), 4);
    for (const id of ids(10)) await hacer(() => seleccion().alternar(id));
    expect(seleccion().idsParaEnviar).toEqual(ids(4));
    await hacer(() => seleccion().marcarTodos());
    expect(seleccion().idsParaEnviar).toEqual(ids(4));
  });

  it('«marcar todos» REEMPLAZA lo marcado por los primeros `tope` (el rótulo «Marcar los primeros N» es siempre verdad)', async () => {
    await mostrar(ids(10), 3);
    await hacer(() => seleccion().alternar('g009'));
    await hacer(() => seleccion().alternar('g010'));
    await hacer(() => seleccion().marcarTodos());
    expect(seleccion().idsParaEnviar).toEqual(['g001', 'g002', 'g003']);
  });

  it('`todosMarcados` con una lista más larga que el tope: true al llegar al tope (no antes) y false al desmarcar uno', async () => {
    await mostrar(ids(5), 3);
    await hacer(() => seleccion().alternar('g001'));
    await hacer(() => seleccion().alternar('g002'));
    expect(seleccion().todosMarcados).toBe(false);
    await hacer(() => seleccion().alternar('g005'));
    expect(seleccion().todosMarcados).toBe(true);
    await hacer(() => seleccion().alternar('g005'));
    expect(seleccion().todosMarcados).toBe(false);
  });

  it('con la lista del tamaño justo del tope y toda marcada NO hay «sin cupo» (no queda nada sin marcar que apagar)', async () => {
    await mostrar(ids(3), 3);
    await hacer(() => seleccion().marcarTodos());
    expect(seleccion().todosMarcados).toBe(true);
    expect(seleccion().sinCupo).toBe(false);
  });

  it('si la lista se refresca y baja del tope, vuelve a haber cupo (los que ya no están dejan de contar)', async () => {
    await mostrar(ids(5), 3);
    await hacer(() => seleccion().marcarTodos());
    expect(seleccion().sinCupo).toBe(true);
    await mostrar(['g002', 'g003', 'g004', 'g005'], 3); // el primero (g001) salió de la lista
    expect(seleccion().idsParaEnviar).toEqual(['g002', 'g003']);
    expect(seleccion().sinCupo).toBe(false);
    await hacer(() => seleccion().alternar('g004'));
    expect(seleccion().idsParaEnviar).toEqual(['g002', 'g003', 'g004']);
  });

  it('después de quitar 100 de 101 (la lista se refresca y queda uno), «marcar todos» lo marca y no hay «sin cupo»', async () => {
    await mostrar(ids(101), 100);
    await hacer(() => seleccion().marcarTodos());
    expect(seleccion().sinCupo).toBe(true);
    await hacer(() => seleccion().vaciar()); // lo que hace la pantalla al terminar un «Quitar»
    await mostrar(['g101'], 100);
    expect(seleccion().marcados.size).toBe(0);
    await hacer(() => seleccion().marcarTodos());
    expect(seleccion().idsParaEnviar).toEqual(['g101']);
    expect(seleccion().sinCupo).toBe(false);
  });
});
