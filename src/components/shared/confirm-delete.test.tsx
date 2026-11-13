import { act, type ComponentProps } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Deja pasar `useSubmitFeedback` tal cual y anota el `context` con el que lo llama en cada render: así se comprueba que
// `ConfirmDelete` le da un contexto ESTABLE (el hook documenta que sea una constante, no un objeto nuevo por render).
const h = vi.hoisted(() => ({ contextos: [] as unknown[] }));
vi.mock('@/lib/use-submit-feedback', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/use-submit-feedback')>();
  return {
    ...original,
    useSubmitFeedback: (options?: { context?: unknown }) => {
      h.contextos.push(options?.context);
      return original.useSubmitFeedback(options as never);
    },
  };
});

import { ELIMINAR_GASTO_CONTEXT } from '@/features/gastos/constants';
import {
  NETWORK_DELETE_ERROR_MESSAGE,
  NETWORK_SAVE_ERROR_MESSAGE,
  RecordNotFoundError,
  TIMEOUT_DELETE_ERROR_MESSAGE,
  TIMEOUT_ERROR_MESSAGE,
  type DataErrorContext,
} from '@/lib/data-errors';
import { ConfirmDelete } from './confirm-delete';

// Eliminar NO es guardar un formulario: sin señal o con timeout el aviso dice que todavía NO se eliminó, no habla de «lo
// escrito» (no hay nada escrito) ni nombra ningún botón (con `keepConfirmLabelOnError` el botón conserva su rótulo y no dice
// «Reintentar»). Un `context` de la pantalla puede seguir pisando esos dos textos.
let root: Root;
let app: HTMLElement;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  app = document.createElement('div');
  document.body.appendChild(app);
  root = createRoot(app);
  h.contextos.length = 0;
});

afterEach(async () => {
  await act(async () => root.unmount());
  app.remove();
});

const SIN_RED = { message: 'TypeError: Failed to fetch', code: '' };
const timeout = () => new DOMException('signal timed out', 'TimeoutError');

const botones = () => [...app.querySelectorAll<HTMLButtonElement>('button')];
const boton = (texto: string) => botones().find((b) => b.textContent?.trim() === texto);
const textosDeBotones = () => botones().map((b) => b.textContent?.trim());
/** Solo el TEXTO del aviso de error (sin el botón «Reintentar» que algunos avisos traen adentro). */
const avisos = () => [...app.querySelectorAll('[role="alert"] [data-slot="alert-description"]')].map((el) => el.textContent);

async function asentar() {
  for (let i = 0; i < 3; i++) await act(async () => void (await new Promise((r) => setTimeout(r, 0))));
}
async function tocar(el: HTMLElement | undefined) {
  if (!el) throw new Error('no se encontró el botón a tocar');
  await act(async () => el.click());
  await asentar();
}
/** Monta, abre la confirmación y toca el botón que confirma. */
async function eliminar(props: Pick<ComponentProps<typeof ConfirmDelete>, 'onConfirm'> & Partial<ComponentProps<typeof ConfirmDelete>>) {
  await act(async () => root.render(<ConfirmDelete label="Eliminar" {...props} />));
  await tocar(boton('Eliminar'));
  await tocar(boton(props.confirmLabel ?? 'Sí, eliminar'));
}

const CASOS: Array<[string, () => unknown, string]> = [
  ['sin señal', () => SIN_RED, 'No hay señal. Todavía NO se eliminó. Cuando tengas señal, inténtalo de nuevo.'],
  ['con timeout', timeout, 'La señal está lenta y no sabemos si se eliminó. Inténtalo de nuevo.'],
];

describe('ConfirmDelete: sin señal y con timeout', () => {
  it.each(CASOS)('%s: dice que todavía NO se eliminó, sin hablar de guardar, de «lo escrito» ni de «Reintentar»', async (_nombre, falla, esperado) => {
    await eliminar({ onConfirm: () => Promise.reject(falla()) });
    expect(avisos()).toEqual([esperado]);
    expect(avisos()[0]).not.toMatch(/guard|lo escrito|Reintentar|no se duplica/i);
    expect(avisos()[0]).not.toBe(NETWORK_SAVE_ERROR_MESSAGE);
    expect(avisos()[0]).not.toBe(TIMEOUT_ERROR_MESSAGE);
  });

  it('los textos son las constantes de eliminar', async () => {
    await eliminar({ onConfirm: () => Promise.reject(SIN_RED) });
    expect(avisos()).toEqual([NETWORK_DELETE_ERROR_MESSAGE]);
  });

  it('por defecto el botón de confirmar pasa a «Reintentar» (eso no cambió) y volver a tocarlo repite la acción; el aviso no depende de ese rótulo', async () => {
    const onConfirm = vi.fn().mockRejectedValueOnce(SIN_RED).mockResolvedValueOnce(undefined);
    await eliminar({ onConfirm });
    expect(textosDeBotones()).toContain('Reintentar');
    expect(textosDeBotones()).not.toContain('Sí, eliminar');
    expect(avisos()).toEqual([NETWORK_DELETE_ERROR_MESSAGE]);
    await tocar(boton('Reintentar'));
    expect(onConfirm).toHaveBeenCalledTimes(2);
    expect(app.textContent).toContain('Eliminado.');
  });

  it.each(CASOS)(
    'con keepConfirmLabelOnError (un borrado que destruye datos), %s: el botón conserva su rótulo, no hay ningún «Reintentar» y el aviso es el de eliminar',
    async (_nombre, falla, esperado) => {
      const etiqueta = 'Borrar el viaje y sus devoluciones';
      await eliminar({ onConfirm: () => Promise.reject(falla()), confirmLabel: etiqueta, keepConfirmLabelOnError: true });
      expect(avisos()).toEqual([esperado]);
      expect(textosDeBotones()).toContain(etiqueta);
      expect(textosDeBotones()).not.toContain('Reintentar');
      expect(app.textContent).not.toMatch(/Reintentar|lo escrito|guard/i);
    },
  );

  it('con keepConfirmLabelOnError, volver a tocar el botón (con su rótulo) repite la acción', async () => {
    const onConfirm = vi.fn().mockRejectedValueOnce(timeout()).mockResolvedValueOnce(undefined);
    await eliminar({ onConfirm, confirmLabel: 'Borrar el viaje y su devolución', keepConfirmLabelOnError: true });
    await tocar(boton('Borrar el viaje y su devolución'));
    expect(onConfirm).toHaveBeenCalledTimes(2);
    expect(app.textContent).toContain('Eliminado.');
  });

  it.each([
    ['sin señal', () => SIN_RED, 'Red propia.'],
    ['con timeout', timeout, 'Tiempo propio.'],
  ] as Array<[string, () => unknown, string]>)(
    'un `context` de la pantalla puede pisar el texto de %s',
    async (_nombre, falla, propio) => {
      const contexto: DataErrorContext = { network: 'Red propia.', timeout: 'Tiempo propio.' };
      await eliminar({ onConfirm: () => Promise.reject(falla()), context: contexto });
      expect(avisos()).toEqual([propio]);
    },
  );

  it('un `context` que solo trae otros mensajes (como los de las pantallas) conserva los textos de eliminar y sus propios mensajes', async () => {
    await eliminar({ onConfirm: () => Promise.reject(SIN_RED), context: ELIMINAR_GASTO_CONTEXT });
    expect(avisos()).toEqual([NETWORK_DELETE_ERROR_MESSAGE]);
    await act(async () => root.unmount());
    root = createRoot(app);
    await eliminar({ onConfirm: () => Promise.reject({ message: 'violates foreign key constraint', code: '23503' }), context: ELIMINAR_GASTO_CONTEXT });
    expect(avisos()).toEqual(['No se pudo eliminar. Prueba de nuevo.']);
  });

  it('los demás errores no cambian (permiso, servidor): sus mensajes de siempre', async () => {
    await eliminar({ onConfirm: () => Promise.reject({ message: 'permission denied', code: '42501' }) });
    expect(avisos()).toEqual(['No tienes permiso para hacer esto.']);
    await act(async () => root.unmount());
    root = createRoot(app);
    await eliminar({ onConfirm: () => Promise.reject({ message: 'upstream connect error', code: '', status: 502 }) });
    expect(avisos()[0]).not.toBe(NETWORK_DELETE_ERROR_MESSAGE);
    expect(avisos()[0]).not.toBe(TIMEOUT_DELETE_ERROR_MESSAGE);
  });

  it('un re-render con las mismas props no borra el aviso ni cambia su texto', async () => {
    const onConfirm = () => Promise.reject(SIN_RED);
    await eliminar({ onConfirm });
    expect(avisos()).toEqual([NETWORK_DELETE_ERROR_MESSAGE]);
    await act(async () => root.render(<ConfirmDelete label="Eliminar" onConfirm={onConfirm} />));
    await asentar();
    expect(avisos()).toEqual([NETWORK_DELETE_ERROR_MESSAGE]);
  });

  it('le da a `useSubmitFeedback` UN solo contexto a lo largo de todos los renders (sin objeto nuevo por render), con o sin `context` de la pantalla', async () => {
    for (const context of [undefined, ELIMINAR_GASTO_CONTEXT]) {
      h.contextos.length = 0;
      await act(async () => root.unmount());
      root = createRoot(app);
      await eliminar({ onConfirm: () => Promise.reject(SIN_RED), context });
      await act(async () => root.render(<ConfirmDelete label="Eliminar" onConfirm={() => Promise.reject(SIN_RED)} context={context} />));
      await asentar();
      expect(h.contextos.length, String(context)).toBeGreaterThan(3); // hubo varios renders (abrir, confirmar, error, re-render)
      expect(new Set(h.contextos).size, String(context)).toBe(1);
      // Y es el compuesto: los textos de eliminar más lo que traiga la pantalla.
      expect(h.contextos[0]).toMatchObject({ network: NETWORK_DELETE_ERROR_MESSAGE, timeout: TIMEOUT_DELETE_ERROR_MESSAGE });
    }
  });

  it('el éxito sigue igual («Eliminado.») y un 0 filas (`RecordNotFoundError`) cuenta como éxito, sin aviso de error', async () => {
    await eliminar({ onConfirm: () => Promise.resolve() });
    expect(app.textContent).toContain('Eliminado.');
    expect(avisos()).toEqual([]);
    await act(async () => root.unmount());
    root = createRoot(app);
    await eliminar({ onConfirm: () => Promise.reject(new RecordNotFoundError()) });
    expect(app.textContent).toContain('Eliminado.');
    expect(avisos()).toEqual([]);
  });
});
