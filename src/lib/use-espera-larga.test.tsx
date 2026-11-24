import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ESPERA_LARGA_MS, useEsperaLarga } from './use-espera-larga';

// El aviso de «sigue guardando» (tanda 3b, A21/B8): `useEsperaLarga(activa)` pasa a `true` cuando `activa` estuvo en `true` 8 segundos
// SEGUIDOS. Con temporizadores falsos (solo setTimeout y clearTimeout) para controlar el reloj al milisegundo.
let root: Root;
let container: HTMLElement;
let errorSpy: ReturnType<typeof vi.spyOn>;

function Sonda({ activa, ms }: { activa: boolean; ms?: number }) {
  const lento = useEsperaLarga(activa, ms);
  return <p>{lento ? 'lento' : 'normal'}</p>;
}

const estado = () => container.querySelector('p')!.textContent;
function dibujar(activa: boolean, ms?: number) {
  act(() => {
    root.render(<Sonda activa={activa} ms={ms} />);
  });
}
function pasar(milisegundos: number) {
  act(() => {
    vi.advanceTimersByTime(milisegundos);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.useRealTimers();
  // Ningún aviso de React (por ejemplo, un setState fuera de `act` por un temporizador que quedó vivo).
  expect(errorSpy.mock.calls.map((c: unknown[]) => String(c[0]))).toEqual([]);
  errorSpy.mockRestore();
});

describe('useEsperaLarga: los 8 segundos', () => {
  it('el umbral es de 8 segundos', () => {
    expect(ESPERA_LARGA_MS).toBe(8000);
  });

  it('a los 7,9 s no hay aviso; a los 8 s en punto, sí', () => {
    dibujar(true);
    expect(estado()).toBe('normal');
    pasar(7900);
    expect(estado()).toBe('normal');
    pasar(99);
    expect(estado()).toBe('normal'); // 7.999 ms
    pasar(1);
    expect(estado()).toBe('lento'); // 8.000 ms
  });

  it('una vez avisado, sigue avisando mientras siga esperando', () => {
    dibujar(true);
    pasar(8000);
    pasar(30_000);
    expect(estado()).toBe('lento');
  });

  it('sin una espera en curso nunca avisa, por más que pase el tiempo', () => {
    dibujar(false);
    pasar(60_000);
    expect(estado()).toBe('normal');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('acepta otro umbral (el 8 s es solo el valor por defecto)', () => {
    dibujar(true, 3000);
    pasar(2999);
    expect(estado()).toBe('normal');
    pasar(1);
    expect(estado()).toBe('lento');
  });
});

describe('useEsperaLarga: cuándo se va y cuándo no aparece', () => {
  it('desaparece apenas termina la espera (bien o mal: para el hook es lo mismo, la espera pasa a false)', () => {
    dibujar(true);
    pasar(9000);
    expect(estado()).toBe('lento');
    dibujar(false);
    expect(estado()).toBe('normal');
    pasar(60_000);
    expect(estado()).toBe('normal');
  });

  it('si la espera termina antes de los 8 s, no aparece nunca (y no queda ningún temporizador vivo)', () => {
    dibujar(true);
    pasar(7000);
    dibujar(false);
    expect(vi.getTimerCount()).toBe(0);
    pasar(10_000);
    expect(estado()).toBe('normal');
  });

  it('ni en un dibujado intermedio avisa con la espera ya terminada (no hay un cuadro de más con el aviso a la vista)', () => {
    const dibujados: Array<{ activa: boolean; lento: boolean }> = [];
    function SondaConRegistro({ activa }: { activa: boolean }) {
      const lento = useEsperaLarga(activa);
      dibujados.push({ activa, lento });
      return <p>{lento ? 'lento' : 'normal'}</p>;
    }
    act(() => {
      root.render(<SondaConRegistro activa />);
    });
    pasar(8000);
    expect(dibujados.some((d) => d.activa && d.lento)).toBe(true);
    act(() => {
      root.render(<SondaConRegistro activa={false} />);
    });
    // Cada vez que se dibujó con `activa` en false, `lento` ya era false: el estado viejo no se filtra ni por un instante.
    expect(dibujados.filter((d) => !d.activa).length).toBeGreaterThan(0);
    expect(dibujados.some((d) => !d.activa && d.lento)).toBe(false);
  });

  it('el temporizador se limpia al desmontar (sin setState sobre algo desmontado)', () => {
    dibujar(true);
    pasar(3000);
    expect(vi.getTimerCount()).toBe(1);
    act(() => {
      root.render(<p>afuera</p>);
    });
    expect(vi.getTimerCount()).toBe(0);
    pasar(60_000);
    expect(container.textContent).toBe('afuera');
  });
});

describe('useEsperaLarga: dos intentos seguidos', () => {
  it('el segundo arranca la cuenta de cero: 5 s + 5 s no suman 8', () => {
    dibujar(true);
    pasar(5000);
    dibujar(false); // el primer intento terminó (con error)
    dibujar(true); // «Reintentar»
    pasar(5000); // 10 s desde el primero, 5 s desde el segundo
    expect(estado()).toBe('normal');
    pasar(2900);
    expect(estado()).toBe('normal'); // 7,9 s del segundo
    pasar(100);
    expect(estado()).toBe('lento'); // 8 s del segundo
  });

  it('si el primero ya había avisado, el segundo NO arranca avisando: vuelve a esperar 8 s', () => {
    dibujar(true);
    pasar(8000);
    expect(estado()).toBe('lento');
    dibujar(false);
    expect(estado()).toBe('normal');
    dibujar(true);
    expect(estado()).toBe('normal');
    pasar(7999);
    expect(estado()).toBe('normal');
    pasar(1);
    expect(estado()).toBe('lento');
  });

  it('nunca hay más de un temporizador vivo', () => {
    dibujar(true);
    dibujar(false);
    dibujar(true);
    dibujar(false);
    dibujar(true);
    expect(vi.getTimerCount()).toBe(1);
  });
});
