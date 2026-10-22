import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MutationObserver } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorBoundary } from '@/components/shared/error-boundary';
import { DataRequestError } from './data-errors';
import { erroresRecientes, limpiarErroresRecientes } from './errores-recientes';
import { queryClient, SIN_REGISTRO_DE_ERRORES } from './query-client';

// El registro de errores recientes se alimenta de forma CENTRAL: el QueryCache, el MutationCache y el ErrorBoundary. Acá
// se usa el `queryClient` REAL de la app (con su configuración de reintentos intacta).

const errorDeBase = () =>
  new DataRequestError({ code: '23514', message: 'new row for relation "gastos" violates check constraint "gastos_monto_chk"', details: 'Failing row contains (123456, dato real)' }, 400);

async function mutar(opciones: { scope?: { id: string }; meta?: Record<string, unknown> }) {
  const observer = new MutationObserver(queryClient, {
    mutationFn: () => Promise.reject(errorDeBase()),
    ...opciones,
  });
  await observer.mutate(undefined).catch(() => {});
}

beforeEach(() => {
  limpiarErroresRecientes();
});

afterEach(() => {
  queryClient.clear();
});

describe('query-client: registro central de errores recientes', () => {
  it('una consulta que falla se anota con la parte fija de su key (sin tenant ni parámetros) y sin el texto', async () => {
    await queryClient
      .fetchQuery({
        queryKey: ['tenant', '7d1f0000-0000-4000-8000-000000000001', 'resumen', 'gastos', '2026-10-01', '2026-10-31'],
        queryFn: () => Promise.reject(errorDeBase()),
      })
      .catch(() => {});
    expect(erroresRecientes()).toEqual([{ tipo: 'invalid-data', sqlstate: '23514', constraint: 'gastos_monto_chk', operacion: 'resumen-gastos', hace_s: expect.any(Number) }]);
    expect(JSON.stringify(erroresRecientes())).not.toMatch(/123456|dato real|7d1f0000/);
  });

  it('una consulta que sale bien no anota nada', async () => {
    await queryClient.fetchQuery({ queryKey: ['tenant', 't', 'gastos', 'lista'], queryFn: () => Promise.resolve([]) });
    expect(erroresRecientes()).toEqual([]);
  });

  it('un guardado que falla se anota con su scope', async () => {
    await mutar({ scope: { id: 'crear-gasto' } });
    expect(erroresRecientes()).toEqual([{ tipo: 'invalid-data', sqlstate: '23514', constraint: 'gastos_monto_chk', operacion: 'crear-gasto', hace_s: expect.any(Number) }]);
  });

  it('un guardado sin scope se anota sin operación', async () => {
    await mutar({});
    expect(erroresRecientes()).toEqual([{ tipo: 'invalid-data', sqlstate: '23514', constraint: 'gastos_monto_chk', hace_s: expect.any(Number) }]);
  });

  it('los errores del envío de un reporte (meta.sinRegistroDeErrores) NO se anotan', async () => {
    await mutar({ scope: { id: 'enviar-reporte' }, meta: SIN_REGISTRO_DE_ERRORES });
    expect(erroresRecientes()).toEqual([]);
  });

  it('la configuración de siempre sigue: los guardados no se reintentan solos ni se pausan sin red', () => {
    expect(queryClient.getDefaultOptions().mutations).toMatchObject({ retry: 0, networkMode: 'always' });
    expect(queryClient.getDefaultOptions().queries?.refetchOnWindowFocus).toBe(false);
  });
});

describe('ErrorBoundary: un error al dibujar se anota como "render" (nada del error)', () => {
  function Explota(): never {
    throw new Error('Cannot read properties of undefined (reading "patente AB123CD")');
  }

  it('se anota y se muestra la pantalla de error', async () => {
    const consola = vi.spyOn(console, 'error').mockImplementation(() => {});
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const container = document.createElement('div');
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <ErrorBoundary>
          <Explota />
        </ErrorBoundary>,
      );
    });
    expect(container.textContent).toContain('Algo salió mal');
    expect(erroresRecientes()).toEqual([{ tipo: 'render', hace_s: expect.any(Number) }]);
    expect(JSON.stringify(erroresRecientes())).not.toContain('AB123CD');
    await act(async () => root.unmount());
    consola.mockRestore();
  });
});
