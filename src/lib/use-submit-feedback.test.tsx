import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NETWORK_SAVE_ERROR_MESSAGE, TIMEOUT_ERROR_MESSAGE, type DataErrorContext } from '@/lib/data-errors';
import { useSubmitFeedback } from '@/lib/use-submit-feedback';

// Sin señal AL GUARDAR: el hook arma el mensaje de «todavía NO se guardó, lo escrito sigue aquí» (el de leer una lista, en cambio,
// no habla de guardar). Un contexto de la pantalla puede poner su propio texto de red.
let root: Root;
let app: HTMLElement;
const sonda: { actual: ReturnType<typeof useSubmitFeedback> | null } = { actual: null };

function Probe({ context }: { context?: DataErrorContext }) {
  const feedback = useSubmitFeedback({ context });
  useEffect(() => {
    sonda.actual = feedback;
  });
  return <p data-error>{feedback.error ?? ''}</p>;
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  app = document.createElement('div');
  document.body.appendChild(app);
  root = createRoot(app);
  sonda.actual = null;
});

afterEach(async () => {
  await act(async () => root.unmount());
  app.remove();
});

async function fallar(error: unknown, context?: DataErrorContext) {
  await act(async () => root.render(<Probe context={context} />));
  await act(async () => {
    await sonda.actual!.run(async () => {
      throw error;
    });
  });
  return { texto: app.querySelector('[data-error]')!.textContent, retryable: sonda.actual!.retryable };
}

describe('useSubmitFeedback: los textos de red al guardar', () => {
  it('sin señal: «No hay señal. Todavía NO se guardó, pero lo escrito sigue aquí. Cuando vuelva, toca Reintentar.» y se puede reintentar', async () => {
    const { texto, retryable } = await fallar({ message: 'TypeError: Failed to fetch', code: '' });
    expect(texto).toBe('No hay señal. Todavía NO se guardó, pero lo escrito sigue aquí. Cuando vuelva, toca Reintentar.');
    expect(texto).toBe(NETWORK_SAVE_ERROR_MESSAGE);
    expect(retryable).toBe(true);
  });

  it('el contexto de la pantalla puede poner su propio texto de red', async () => {
    const { texto } = await fallar({ message: 'TypeError: Failed to fetch', code: '' }, { network: 'Texto propio.' });
    expect(texto).toBe('Texto propio.');
  });

  it('timeout de la escritura: «La señal está lenta y no sabemos si se guardó. Toca Reintentar: no se duplica.»', async () => {
    const { texto, retryable } = await fallar(new DOMException('signal timed out', 'TimeoutError'));
    expect(texto).toBe(TIMEOUT_ERROR_MESSAGE);
    expect(texto).toBe('La señal está lenta y no sabemos si se guardó. Toca Reintentar: no se duplica.');
    expect(retryable).toBe(true);
  });

  it('los demás errores no cambian: permiso, único y los mensajes del contexto siguen igual', async () => {
    expect((await fallar({ message: 'x', code: '42501' })).texto).toBe('No tienes permiso para hacer esto.');
    expect((await fallar({ message: 'x', code: '23505' }, { unique: 'Ya está.' })).texto).toBe('Ya está.');
  });

  it('los textos de guardar no llevan «$», voseo ni «acá»', () => {
    for (const texto of [NETWORK_SAVE_ERROR_MESSAGE, TIMEOUT_ERROR_MESSAGE]) {
      expect(texto).not.toMatch(/\$|\bacá\b|\b(?:tocá|revisá|probá|esperá)\b/i);
    }
  });
});
