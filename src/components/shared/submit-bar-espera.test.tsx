import { act, type FormEvent } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSubmitFeedback } from '@/lib/use-submit-feedback';
import { SIGUE_GUARDANDO_MESSAGE, SubmitBar } from './submit-bar';

// El aviso de los 8 segundos (tanda 3b, A21/B8): cuando un guardado lleva 8 segundos seguidos sin terminar, la barra muestra una línea
// «Sigue guardando: la señal está lenta. No cierres la app.» y se la lleva apenas el intento termina, bien o mal. Con temporizadores
// falsos (solo setTimeout y clearTimeout), el hook REAL (`useSubmitFeedback`) y la barra REAL, sin tocar el flujo del guardado.
let root: Root;
let container: HTMLElement;
let errorSpy: ReturnType<typeof vi.spyOn>;

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
  expect(errorSpy.mock.calls.map((c: unknown[]) => String(c[0]))).toEqual([]);
  errorSpy.mockRestore();
});

const aviso = () => [...container.querySelectorAll('[role="status"]')].find((el) => el.textContent?.includes('Sigue guardando')) ?? null;
/** La región de aviso (la de la barra que NO es el «Guardando…» para lectores de pantalla ni el aviso de sin señal). */
const regionDeAviso = () => container.querySelector<HTMLElement>('div[role="status"][aria-live="polite"]');
const boton = () => container.querySelector<HTMLButtonElement>('button[type="submit"]')!;
function pasar(milisegundos: number) {
  act(() => {
    vi.advanceTimersByTime(milisegundos);
  });
}

describe('SubmitBar: la línea «Sigue guardando»', () => {
  const dibujar = (props: { pending: boolean; lento?: boolean; error?: string | null }) =>
    act(() => {
      root.render(<SubmitBar pending={props.pending} lento={props.lento} error={props.error ?? null} label="Guardar prueba" />);
    });

  it('el texto es exactamente el pedido', () => {
    expect(SIGUE_GUARDANDO_MESSAGE).toBe('Sigue guardando: la señal está lenta. No cierres la app.');
    expect(SIGUE_GUARDANDO_MESSAGE).not.toMatch(/\b(?:tocá|elegí|podés|esperá)\b/i);
  });

  it('sin `lento` no hay línea visible, pero la región en vivo ya existe (vacía y oculta) para que se anuncie al aparecer', () => {
    dibujar({ pending: true });
    expect(aviso()).toBeNull();
    const region = regionDeAviso()!;
    expect(region).not.toBeNull();
    expect(region.textContent).toBe('');
    expect(region.className).toContain('sr-only');
  });

  it('con `lento`: una línea de estado (role=status, aria-live polite) de 16 px, con los colores del tema y el ícono decorativo', () => {
    dibujar({ pending: true, lento: true });
    const linea = aviso()!;
    expect(linea.textContent).toBe(SIGUE_GUARDANDO_MESSAGE);
    expect(linea.getAttribute('role')).toBe('status');
    expect(linea.getAttribute('aria-live')).toBe('polite');
    expect(linea.className).toContain('text-base'); // 16 px
    expect(linea.className).not.toContain('sr-only');
    for (const clase of ['border-border', 'bg-muted', 'text-foreground']) expect(linea.className).toContain(clase);
    expect(linea.className).not.toMatch(/(?:text|bg|border)-(?:red|amber|yellow|orange|\[#)/);
    expect(linea.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('el botón y el resto de la barra no cambian con el aviso: sigue «Guardando…», apagado y de ancho completo', () => {
    dibujar({ pending: true, lento: true });
    expect(boton().disabled).toBe(true);
    expect(boton().textContent).toContain('Guardando…');
    expect(boton().getAttribute('aria-busy')).toBe('true');
    expect(boton().className).toContain('w-full');
    expect(boton().className).toContain('min-h-14');
    // El «Guardando…» para lectores de pantalla sigue presente.
    expect([...container.querySelectorAll('[role="status"]')].some((el) => el.textContent === 'Guardando…')).toBe(true);
  });

  it('el aviso va ANTES del botón (arriba de lo que se está mirando) y la línea ya no está sin `lento`', () => {
    dibujar({ pending: true, lento: true });
    const linea = aviso()!;
    expect(linea.compareDocumentPosition(boton()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    dibujar({ pending: true, lento: false });
    expect(aviso()).toBeNull();
  });
});

/** Un formulario de prueba con el hook y la barra reales; cada «Guardar» llama a `accion()` (que la prueba deja pendiente a voluntad). */
function Formulario({ accion }: { accion: () => Promise<void> }) {
  const { run, pending, lento, error, retryable } = useSubmitFeedback();
  return (
    <form
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        void run(accion);
      }}
    >
      <SubmitBar pending={pending} lento={lento} error={error} retryable={retryable} label="Guardar prueba" />
    </form>
  );
}

type Intento = { terminarBien: () => void; terminarMal: () => void };
/** `accion` que deja cada intento colgado; devuelve cómo terminar cada uno. */
function crearAccion() {
  const intentos: Intento[] = [];
  const accion = vi.fn(
    () =>
      new Promise<void>((resolve, reject) => {
        intentos.push({ terminarBien: () => resolve(), terminarMal: () => reject({ message: 'TypeError: Failed to fetch', code: '' }) });
      }),
  );
  return { accion, intentos };
}
function montar(accion: () => Promise<void>) {
  act(() => {
    root.render(<Formulario accion={accion} />);
  });
}
function guardar() {
  act(() => {
    boton().click();
  });
}
async function terminar(fn: () => void) {
  await act(async () => {
    fn();
  });
}

describe('SubmitBar con el guardado real: el aviso a los 8 segundos', () => {
  it('a los 7,9 s no hay aviso y a los 8 s sí', () => {
    const { accion } = crearAccion();
    montar(accion);
    guardar();
    expect(boton().disabled).toBe(true);
    pasar(7900);
    expect(aviso()).toBeNull();
    pasar(99);
    expect(aviso()).toBeNull();
    pasar(1);
    expect(aviso()!.textContent).toBe(SIGUE_GUARDANDO_MESSAGE);
  });

  it('sin guardar nada no aparece nunca', () => {
    const { accion } = crearAccion();
    montar(accion);
    pasar(60_000);
    expect(aviso()).toBeNull();
    expect(accion).not.toHaveBeenCalled();
  });

  it('desaparece apenas el intento termina BIEN, aunque la pantalla siga bloqueada en «Guardando…» hasta navegar', async () => {
    const { accion, intentos } = crearAccion();
    montar(accion);
    guardar();
    pasar(9000);
    expect(aviso()).not.toBeNull();
    await terminar(intentos[0]!.terminarBien);
    expect(aviso()).toBeNull();
    // El guard de siempre no cambió: tras un éxito el botón sigue bloqueado (la pantalla se va al navegar).
    expect(boton().disabled).toBe(true);
    expect(boton().textContent).toContain('Guardando…');
    pasar(60_000);
    expect(aviso()).toBeNull();
  });

  it('desaparece apenas el intento termina MAL, y aparece el error con «Reintentar»', async () => {
    const { accion, intentos } = crearAccion();
    montar(accion);
    guardar();
    pasar(9000);
    expect(aviso()).not.toBeNull();
    await terminar(intentos[0]!.terminarMal);
    expect(aviso()).toBeNull();
    expect(container.textContent).toContain('No hay señal. Todavía NO se guardó');
    expect(container.textContent).toContain('Reintentar');
    expect(boton().disabled).toBe(false);
  });

  it('si el intento termina antes de los 8 s (bien o mal) nunca aparece y no queda ningún temporizador', async () => {
    const { accion, intentos } = crearAccion();
    montar(accion);
    guardar();
    pasar(5000);
    await terminar(intentos[0]!.terminarBien);
    expect(vi.getTimerCount()).toBe(0);
    pasar(60_000);
    expect(aviso()).toBeNull();

    act(() => {
      root.render(<p>otra</p>);
    });
    montar(accion);
    guardar();
    pasar(5000);
    await terminar(intentos[1]!.terminarMal);
    expect(vi.getTimerCount()).toBe(0);
    pasar(60_000);
    expect(aviso()).toBeNull();
  });

  it('el temporizador se limpia al desmontar la pantalla mientras guarda', () => {
    const { accion } = crearAccion();
    montar(accion);
    guardar();
    pasar(3000);
    expect(vi.getTimerCount()).toBe(1);
    act(() => {
      root.render(<p>afuera</p>);
    });
    expect(vi.getTimerCount()).toBe(0);
    pasar(60_000);
    expect(container.textContent).toBe('afuera');
  });

  it('dos intentos seguidos: el segundo arranca la cuenta de cero (5 s del primero + 5 s del segundo no suman 8)', async () => {
    const { accion, intentos } = crearAccion();
    montar(accion);
    guardar();
    pasar(5000);
    await terminar(intentos[0]!.terminarMal);
    guardar(); // «Reintentar» (un botón de envío del mismo formulario)
    expect(accion).toHaveBeenCalledTimes(2);
    pasar(5000);
    expect(aviso()).toBeNull();
    pasar(2900);
    expect(aviso()).toBeNull(); // 7,9 s del segundo
    pasar(100);
    expect(aviso()).not.toBeNull(); // 8 s del segundo
  });

  it('si el primer intento ya había avisado, el segundo NO arranca avisando', async () => {
    const { accion, intentos } = crearAccion();
    montar(accion);
    guardar();
    pasar(8000);
    expect(aviso()).not.toBeNull();
    await terminar(intentos[0]!.terminarMal);
    guardar();
    expect(aviso()).toBeNull();
    pasar(7999);
    expect(aviso()).toBeNull();
    pasar(1);
    expect(aviso()).not.toBeNull();
  });

  it('el guard contra el doble envío no cambió: dos toques seguidos llaman UNA sola vez a la acción', () => {
    const { accion } = crearAccion();
    montar(accion);
    act(() => {
      boton().click();
      boton().click();
    });
    expect(accion).toHaveBeenCalledTimes(1);
  });
});
