import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// La invalidación del Resumen desde las mutaciones de OTRAS pantallas: cada mutación que cambia lo que leen las funciones
// de la 014 llama a `invalidarResumen` en su `onSettled` (también si falla). Mock de supabase; las mutaciones son las reales.
type Op = { m: string; args: unknown[] };
type Call = { target: string; ops: Op[] };

const h = vi.hoisted(() => {
  const calls: Array<{ target: string; ops: Array<{ m: string; args: unknown[] }> }> = [];
  const state = { responder: null as null | ((call: { target: string; ops: Array<{ m: string; args: unknown[] }> }) => unknown) };
  function builder(target: string, firstOp?: { m: string; args: unknown[] }) {
    const call = { target, ops: firstOp ? [firstOp] : ([] as Array<{ m: string; args: unknown[] }>) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {};
    for (const m of ['select', 'update', 'insert', 'delete', 'eq', 'neq', 'is', 'not', 'abortSignal', 'order', 'limit', 'maybeSingle']) {
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
  return {
    calls,
    state,
    from: (table: string) => builder(table),
    rpc: (fn: string, args: unknown) => builder(`rpc:${fn}`, { m: 'rpc', args: [args] }),
  };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from: h.from, rpc: h.rpc } }));

import { useActualizarGasto, useCrearGasto, useEliminarGasto } from '@/features/gastos/use-gasto-mutations';
import { useActualizarViaje, useCrearViaje, useEliminarViaje } from '@/features/viajes/use-viaje-mutations';
import { useActualizarCamion, useCambiarActivaCamion, useCrearCamion } from '@/features/camiones/use-camion-mutations';
import { estadoInicialAltaCamion } from '@/features/camiones/camion-alta';
import { useCrearDevolucion } from '@/features/devoluciones/use-devolucion-mutations';
import { resumenKeys } from '@/features/resumen/resumen-keys';
import type { GastoColumns } from '@/features/gastos/gasto-form';
import type { ViajeDatos } from '@/features/viajes/viaje-form';
import { queryClient } from '@/lib/query-client';

type Resp = { data: unknown; count?: unknown; error: { message: string; code: string } | null; status: number };
const ok = (data: unknown): Resp => ({ data, error: null, status: 200 });
const conteo = (count: number): Resp => ({ data: null, count, error: null, status: 200 });
const sinRed = (): Resp => ({ data: null, error: { code: '', message: 'TypeError: Failed to fetch' }, status: 0 });

const T = 'tenant-a';
const G = 'e1000000-0000-4000-8000-000000000001';
const V = 'b1000000-0000-4000-8000-000000000001';
const C = 'c1000000-0000-4000-8000-000000000001';
const CAT = 'a1000000-0000-4000-8000-000000000001';
const CLIENTE = 'd1000000-0000-4000-8000-000000000001';

/** La base "funciona": cada escritura devuelve lo que esperan las funciones de la api. */
function responderBien(call: Call): Resp {
  const has = (m: string) => call.ops.some((o) => o.m === m);
  if (call.target === 'rpc:crear_viaje_con_entregas') return ok([{ viaje_id: V, creado: true }]);
  if (call.target === 'rpc:actualizar_viaje_con_entregas') return ok(null);
  if (call.target === 'rpc:crear_camion') return ok([{ camion_id: C, creado: true, viajes_asignados: 2, gastos_asignados: 1, activa: true }]);
  if (call.ops.some((o) => o.m === 'select' && (o.args[1] as { head?: boolean } | undefined)?.head)) return conteo(call.target === 'camiones' ? 2 : 0);
  if (has('insert')) return call.target === 'devoluciones' ? ok({ id: 'f1000000-0000-4000-8000-000000000001' }) : ok(null);
  if (has('update') || has('delete')) return ok(call.target === 'gastos' && has('update') && call.ops.some((o) => o.m === 'eq' && o.args[0] === 'viaje_id') ? [] : [{ id: G }]);
  throw new Error(`pedido inesperado: ${call.target} ${call.ops.map((o) => o.m).join('.')}`);
}

const columnasGasto: GastoColumns = {
  categoria_id: CAT,
  monto: 1000,
  fecha: '2026-10-13',
  viaje_id: null,
  descripcion: null,
  metodo_pago: null,
  litros: null,
  precio_por_litro: null,
  km_odometro: null,
  tanque_lleno: null,
  camion_id: null,
};
const datosViaje: ViajeDatos = {
  columns: {
    fecha: '2026-10-13',
    origen: 'Rosario',
    destino: 'Córdoba',
    camion_id: null,
    km_inicial: null,
    km_final: null,
    km_recorridos: null,
    observaciones: null,
    ingreso: null,
  },
  entregas: [],
};

const probe: {
  crearGasto?: ReturnType<typeof useCrearGasto>;
  actualizarGasto?: ReturnType<typeof useActualizarGasto>;
  eliminarGasto?: ReturnType<typeof useEliminarGasto>;
  crearViaje?: ReturnType<typeof useCrearViaje>;
  actualizarViaje?: ReturnType<typeof useActualizarViaje>;
  eliminarViaje?: ReturnType<typeof useEliminarViaje>;
  crearCamion?: ReturnType<typeof useCrearCamion>;
  actualizarCamion?: ReturnType<typeof useActualizarCamion>;
  activaCamion?: ReturnType<typeof useCambiarActivaCamion>;
  crearDevolucion?: ReturnType<typeof useCrearDevolucion>;
} = {};

function Probe() {
  probe.crearGasto = useCrearGasto();
  probe.actualizarGasto = useActualizarGasto();
  probe.eliminarGasto = useEliminarGasto();
  probe.crearViaje = useCrearViaje();
  probe.actualizarViaje = useActualizarViaje();
  probe.eliminarViaje = useEliminarViaje();
  probe.crearCamion = useCrearCamion();
  probe.actualizarCamion = useActualizarCamion();
  probe.activaCamion = useCambiarActivaCamion();
  probe.crearDevolucion = useCrearDevolucion();
  return null;
}

let root: Root;
let container: HTMLElement;
let errorSpy: ReturnType<typeof vi.spyOn>;
let invalidadas: unknown[][] = [];
let invalidateSpy: ReturnType<typeof vi.spyOn>;
const invalidoResumen = () => invalidadas.filter((k) => JSON.stringify(k) === JSON.stringify(resumenKeys.all(T))).length;

async function settle(times = 4) {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

/** Corre la mutación (sin tirar si falla) y espera a que se asiente. */
async function correr(fn: () => Promise<unknown>) {
  await act(async () => {
    await fn().catch(() => {});
  });
  await settle(2);
}

beforeEach(async () => {
  h.calls.length = 0;
  h.state.responder = responderBien;
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

/** Cada mutación que tiene que invalidar el Resumen, con cómo llamarla. */
const MUTACIONES: Array<[string, () => Promise<unknown>]> = [
  ['crear un gasto', () => probe.crearGasto!.mutateAsync({ tenantId: T, columns: columnasGasto, clientRef: 'f2000000-0000-4000-8000-000000000001', sent: new Set() })],
  ['editar un gasto', () => probe.actualizarGasto!.mutateAsync({ tenantId: T, id: G, changes: { monto: 2000 } })],
  ['borrar un gasto', () => probe.eliminarGasto!.mutateAsync({ tenantId: T, id: G })],
  ['crear un viaje', () => probe.crearViaje!.mutateAsync({ tenantId: T, datos: datosViaje, clientRef: 'f2000000-0000-4000-8000-000000000002', sent: new Set() })],
  ['editar un viaje', () => probe.actualizarViaje!.mutateAsync({ tenantId: T, viajeId: V, datos: datosViaje })],
  ['borrar un viaje (desvincula sus gastos)', () => probe.eliminarViaje!.mutateAsync({ tenantId: T, id: V, conteosMostrados: { gastos: 0, devoluciones: 0 } })],
  [
    'crear el PRIMER camión (rellena camión en viajes y cargas)',
    () => probe.crearCamion!.mutateAsync({ tenantId: T, columns: { patente: 'AB123CD', marca: null, modelo: null, anio: null }, estado: estadoInicialAltaCamion(), eraElPrimero: true }),
  ],
  ['editar un camión (cambia la patente que muestra el Resumen)', () => probe.actualizarCamion!.mutateAsync({ tenantId: T, id: C, columns: { patente: 'AB123CE', marca: null, modelo: null, anio: null } })],
  ['archivar un camión', () => probe.activaCamion!.mutateAsync({ tenantId: T, id: C, activa: false })],
  ['reactivar un camión', () => probe.activaCamion!.mutateAsync({ tenantId: T, id: C, activa: true })],
];

describe('invalidarResumen en el onSettled de cada mutación que cambia lo que lee el Resumen', () => {
  it.each(MUTACIONES)('%s: si sale bien, invalida resumen.all del tenant de las variables', async (_nombre, fn) => {
    await correr(fn);
    expect(invalidoResumen()).toBe(1);
  });

  it.each(MUTACIONES)('%s: si FALLA (sin red), también (la escritura pudo haberse aplicado)', async (_nombre, fn) => {
    h.state.responder = (call: Call) => {
      if (call.ops.some((o) => o.m === 'select' && (o.args[1] as { head?: boolean } | undefined)?.head)) return responderBien(call);
      return sinRed();
    };
    await correr(fn);
    expect(invalidoResumen()).toBe(1);
  });
});

describe('lo que NO cambia los números del Resumen no lo invalida', () => {
  it('crear un camión que no es el primero y no rellenó nada', async () => {
    h.state.responder = (call: Call) =>
      call.target === 'rpc:crear_camion' ? ok([{ camion_id: C, creado: true, viajes_asignados: 0, gastos_asignados: 0, activa: true }]) : responderBien(call);
    await correr(() =>
      probe.crearCamion!.mutateAsync({ tenantId: T, columns: { patente: 'AB123CD', marca: null, modelo: null, anio: null }, estado: estadoInicialAltaCamion(), eraElPrimero: false }),
    );
    expect(invalidoResumen()).toBe(0);
  });

  it('crear una devolución', async () => {
    await correr(() =>
      probe.crearDevolucion!.mutateAsync({
        tenantId: T,
        viajeId: V,
        columns: { cliente_id: CLIENTE, motivo: 'otro', descripcion: 'x' },
        clientRef: 'f2000000-0000-4000-8000-000000000003',
        sent: new Set(),
      }),
    );
    expect(invalidoResumen()).toBe(0);
  });

  it('solo se invalida el Resumen del tenant de las variables', async () => {
    await correr(() => probe.eliminarGasto!.mutateAsync({ tenantId: 'tenant-b', id: G }));
    expect(invalidoResumen()).toBe(0);
    expect(invalidadas.some((k) => JSON.stringify(k) === JSON.stringify(resumenKeys.all('tenant-b')))).toBe(true);
  });
});
