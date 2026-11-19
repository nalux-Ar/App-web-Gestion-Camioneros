import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `useCrearGastos`: cargar varios gastos de una vez. Mock de supabase (anota cada método encadenado); TanStack Query con su
// configuración real y el hook, `crearGastos` y `gastoLoteWriteIO` son los reales. Lo que se mira: UN solo pedido con todas las
// filas y las MISMAS invalidaciones que `useCrearGasto` (gastos en éxito, viajes y camiones según el error, Resumen siempre).

const h = vi.hoisted(() => {
  const calls: Array<{ target: string; ops: Array<{ m: string; args: unknown[] }> }> = [];
  const state = { responder: null as null | ((call: { target: string; ops: Array<{ m: string; args: unknown[] }> }) => unknown) };
  function builder(target: string) {
    const call = { target, ops: [] as Array<{ m: string; args: unknown[] }> };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {};
    for (const m of ['select', 'update', 'insert', 'delete', 'eq', 'abortSignal']) {
      b[m] = (...args: unknown[]) => {
        call.ops.push({ m, args });
        return b;
      };
    }
    b.then = (onF: (v: unknown) => unknown, onR: (e: unknown) => unknown) => {
      calls.push(call);
      return Promise.resolve()
        .then(() => state.responder?.(call))
        .then(onF, onR);
    };
    return b;
  }
  return { calls, state, from: (table: string) => builder(table) };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from: h.from } }));

import { camionesKeys } from '@/features/camiones/camiones-keys';
import { CAMION_ARCHIVADO, GASTOS_CAMION_VIAJE } from '@/features/camiones/constants';
import { CLIENT_REF_CONSTRAINT } from '@/features/gastos/client-ref';
import { GASTOS_VIAJE_FK } from '@/features/gastos/constants';
import type { GastoColumns } from '@/features/gastos/gasto-form';
import type { GastoParaGuardar } from '@/features/gastos/gasto-lote-save';
import { gastosKeys } from '@/features/gastos/gastos-keys';
import { useCrearGastos, type CrearGastosVariables } from '@/features/gastos/use-gasto-mutations';
import { resumenKeys } from '@/features/resumen/resumen-keys';
import { viajesKeys } from '@/features/viajes/viajes-keys';
import { queryClient } from '@/lib/query-client';

type Resp = { data: unknown; error: { message: string; code: string } | null; status: number };
const ok = (): Resp => ({ data: null, error: null, status: 201 });
const fail = (code: string, message: string, status = 409): Resp => ({ data: null, error: { code, message }, status });
const sinRed = (): Resp => ({ data: null, error: { code: '', message: 'TypeError: Failed to fetch' }, status: 0 });

const T = 'tenant-a';
const OTRO_T = 'tenant-b';
const CAT_1 = 'a1000000-0000-4000-8000-000000000001';
const CAT_2 = 'a1000000-0000-4000-8000-000000000002';
const REF_1 = 'f2000000-0000-4000-8000-000000000001';
const REF_2 = 'f2000000-0000-4000-8000-000000000002';

const columnas = (categoria_id: string, monto: number): GastoColumns => ({
  categoria_id,
  monto,
  fecha: '2026-10-13',
  viaje_id: null,
  descripcion: null,
  metodo_pago: 'efectivo',
  litros: null,
  precio_por_litro: null,
  km_odometro: null,
  tanque_lleno: null,
  camion_id: null,
});
const dos = (): GastoParaGuardar[] => [
  { columns: columnas(CAT_1, 1000), clientRef: REF_1 },
  { columns: columnas(CAT_2, 2500), clientRef: REF_2 },
];

const probe: { crear?: ReturnType<typeof useCrearGastos> } = {};
function Probe() {
  probe.crear = useCrearGastos();
  return null;
}

let root: Root;
let container: HTMLElement;
let errorSpy: ReturnType<typeof vi.spyOn>;
let invalidadas: unknown[][] = [];
let invalidateSpy: ReturnType<typeof vi.spyOn>;
const veces = (clave: readonly unknown[]) => invalidadas.filter((k) => JSON.stringify(k) === JSON.stringify(clave)).length;

async function settle(times = 4) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

/** Corre la mutación y devuelve lo que salió o el error (sin tirar), y espera a que se asiente. */
async function correr(variables: CrearGastosVariables): Promise<{ resultado?: unknown; error?: unknown }> {
  let salida: { resultado?: unknown; error?: unknown } = {};
  await act(async () => {
    salida = await probe.crear!.mutateAsync(variables).then(
      (resultado) => ({ resultado }),
      (error: unknown) => ({ error }),
    );
  });
  await settle(2);
  return salida;
}

const variables = (over: Partial<CrearGastosVariables> = {}): CrearGastosVariables => ({ tenantId: T, items: dos(), sent: new Set(), ...over });
const pedidosDeGastos = () => h.calls.filter((call) => call.target === 'gastos');

beforeEach(async () => {
  h.calls.length = 0;
  h.state.responder = () => ok();
  invalidadas = [];
  invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries').mockImplementation(((filters?: { queryKey?: unknown[] }) => {
    if (filters?.queryKey) invalidadas.push(filters.queryKey);
    return Promise.resolve();
  }) as never);
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>,
    );
  });
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  invalidateSpy.mockRestore();
  queryClient.clear();
  expect(errorSpy.mock.calls.map((c: unknown[]) => String(c[0]))).toEqual([]);
  errorSpy.mockRestore();
});

describe('useCrearGastos: el pedido', () => {
  it('manda UN solo insert con las dos filas (cada una con su client_ref) y devuelve «creados»', async () => {
    const sent = new Set<string>();
    const salida = await correr(variables({ sent }));
    expect(salida.resultado).toBe('creados');

    const pedidos = pedidosDeGastos();
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]!.ops.map((o) => o.m)).toEqual(['insert', 'abortSignal']); // sin `select` ni filtros: es un alta
    const filas = pedidos[0]!.ops[0]!.args[0] as Array<Record<string, unknown>>;
    expect(filas).toHaveLength(2);
    expect(filas.map((fila) => fila.client_ref)).toEqual([REF_1, REF_2]);
    for (const fila of filas) expect(fila).not.toHaveProperty('transportista_id');
    expect(sent.size).toBe(1); // lo mandado quedó anotado en las huellas que le pasó quien llama
  });

  it('el 23505 del client_ref es «ya-guardados» y cuenta como éxito', async () => {
    h.state.responder = () => fail('23505', `duplicate key value violates unique constraint "${CLIENT_REF_CONSTRAINT}"`);
    const salida = await correr(variables());
    expect(salida.resultado).toBe('ya-guardados');
    expect(pedidosDeGastos()).toHaveLength(1);
    expect(veces(gastosKeys.all(T))).toBe(1);
  });

  it('NO reintenta sola: con un error de red hay un único pedido', async () => {
    h.state.responder = () => sinRed();
    const salida = await correr(variables());
    expect(salida.error).toBeInstanceOf(Error);
    expect(pedidosDeGastos()).toHaveLength(1);
  });

  it('un lote inválido (vacío) rechaza sin ningún pedido a la base', async () => {
    const salida = await correr(variables({ items: [] }));
    expect(salida.error).toMatchObject({ name: 'LoteDeGastosInvalidoError' });
    expect(h.calls).toEqual([]);
  });
});

describe('useCrearGastos: las invalidaciones (las mismas que useCrearGasto)', () => {
  it('en éxito: invalida los gastos del tenant (una vez) y el Resumen, y nada de viajes ni camiones', async () => {
    await correr(variables());
    expect(veces(gastosKeys.all(T))).toBe(1);
    expect(veces(resumenKeys.all(T))).toBe(1);
    expect(veces(viajesKeys.recientes(T))).toBe(0);
    expect(veces(camionesKeys.list(T))).toBe(0);
  });

  it('invalida el tenant de las VARIABLES (el de cuando empezó), no otro', async () => {
    await correr(variables({ tenantId: OTRO_T }));
    expect(veces(gastosKeys.all(OTRO_T))).toBe(1);
    expect(veces(resumenKeys.all(OTRO_T))).toBe(1);
    expect(veces(gastosKeys.all(T))).toBe(0);
    expect(veces(resumenKeys.all(T))).toBe(0);
  });

  it('si falla (sin señal): NO invalida los gastos, pero SÍ el Resumen (con un timeout la escritura pudo aplicarse igual)', async () => {
    h.state.responder = () => sinRed();
    await correr(variables());
    expect(veces(gastosKeys.all(T))).toBe(0);
    expect(veces(resumenKeys.all(T))).toBe(1);
    expect(veces(viajesKeys.recientes(T))).toBe(0);
    expect(veces(camionesKeys.list(T))).toBe(0);
  });

  it('el viaje ya no existe (23503 de gastos_viaje_fk): invalida los viajes recientes del selector', async () => {
    h.state.responder = () => fail('23503', `insert or update on table "gastos" violates foreign key constraint "${GASTOS_VIAJE_FK}"`, 409);
    await correr(variables());
    expect(veces(viajesKeys.recientes(T))).toBe(1);
    expect(veces(camionesKeys.list(T))).toBe(0);
    expect(veces(resumenKeys.all(T))).toBe(1);
  });

  it('el camión se archivó mientras tanto (55000): invalida la lista de camiones', async () => {
    h.state.responder = () => fail('55000', `El camión está archivado (${CAMION_ARCHIVADO})`, 400);
    await correr(variables());
    expect(veces(camionesKeys.list(T))).toBe(1);
    expect(veces(viajesKeys.recientes(T))).toBe(0);
  });

  it('el camión no es el del viaje (23514): invalida los viajes recientes Y la lista de camiones', async () => {
    h.state.responder = () => fail('23514', `violates check constraint "${GASTOS_CAMION_VIAJE}"`, 400);
    await correr(variables());
    expect(veces(viajesKeys.recientes(T))).toBe(1);
    expect(veces(camionesKeys.list(T))).toBe(1);
  });
});
