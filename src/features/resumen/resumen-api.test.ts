import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock de supabase: registra cada llamada a una función (rpc + operaciones encadenadas) y responde según cada prueba.
type Op = { m: string; args: unknown[] };
type Call = { target: string; ops: Op[] };

const h = vi.hoisted(() => {
  const calls: Array<{ target: string; ops: Array<{ m: string; args: unknown[] }> }> = [];
  const state = { responder: null as null | ((call: { target: string; ops: Array<{ m: string; args: unknown[] }> }) => unknown) };
  function builder(target: string, firstOp: { m: string; args: unknown[] }) {
    const call = { target, ops: [firstOp] };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {};
    for (const m of ['abortSignal', 'select', 'eq']) {
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
    rpc: (fn: string, args: unknown) => builder(`rpc:${fn}`, { m: 'rpc', args: [args] }),
    from: () => {
      throw new Error('el Resumen no lee tablas: solo llama a las funciones de la 014');
    },
  };
});

vi.mock('@/lib/supabase', () => ({ supabase: { rpc: h.rpc, from: h.from } }));

import { fetchResumenCombustible, fetchResumenGastos, fetchResumenMensual, fetchResumenViajes } from '@/features/resumen/resumen-api';
import { resumenKeys } from '@/features/resumen/resumen-keys';
import {
  RESUMEN_ERROR_INESPERADO,
  RESUMEN_SIN_CUENTA,
  ResumenParametrosInvalidosError,
  ResumenRespuestaInesperadaError,
  mensajeErrorResumen,
} from '@/features/resumen/resumen-textos';
import { DataRequestError, isRetryableDataError } from '@/lib/data-errors';

const ok = (data: unknown) => ({ data, error: null, status: 200 });
const fail = (code: string, message: string, status = 400) => ({ data: null, error: { code, message, details: '', hint: '' }, status });
const signal = () => new AbortController().signal;
const OCT = { desde: '2026-10-01', hasta: '2026-10-31' };
const CAM = 'c1000000-0000-4000-8000-000000000001';
const TOTAL = { grupo: 'total', clave: null, nombre: null, activa: null, cantidad: 0, monto: 0 };

const argsDe = (call: Call) => call.ops.find((o) => o.m === 'rpc')!.args[0];
const err = async (promesa: Promise<unknown>) => promesa.then(() => null, (e: unknown) => e);

beforeEach(() => {
  h.calls.length = 0;
  h.state.responder = null;
});

describe('qué se llama y con qué', () => {
  it('resumen_gastos: desde y hasta INCLUSIVO, con la signal de TanStack', async () => {
    h.state.responder = () => ok([TOTAL]);
    const s = signal();
    await fetchResumenGastos(OCT, s);
    const [call] = h.calls;
    expect(call!.target).toBe('rpc:resumen_gastos');
    expect(argsDe(call!)).toEqual({ p_desde: '2026-10-01', p_hasta: '2026-10-31' });
    expect(call!.ops.find((o) => o.m === 'abortSignal')!.args[0]).toBe(s);
  });

  it('resumen_mensual: el primer día del mes y la cantidad de meses', async () => {
    h.state.responder = () => ok([]);
    await err(fetchResumenMensual({ year: 2026, month: 1 }, 12, signal()));
    expect(h.calls[0]!.target).toBe('rpc:resumen_mensual');
    expect(argsDe(h.calls[0]!)).toEqual({ p_mes_desde: '2026-01-01', p_meses: 12 });
  });

  it('resumen_combustible: sin camión NO manda p_camion_id (queda en su default); con camión, sí', async () => {
    h.state.responder = () => ok([]);
    await fetchResumenCombustible(OCT, null, signal());
    expect(argsDe(h.calls[0]!)).toEqual({ p_desde: '2026-10-01', p_hasta: '2026-10-31' });
    await fetchResumenCombustible(OCT, CAM, signal());
    expect(argsDe(h.calls[1]!)).toEqual({ p_desde: '2026-10-01', p_hasta: '2026-10-31', p_camion_id: CAM });
  });

  it('resumen_viajes', async () => {
    h.state.responder = () => ok([]);
    await fetchResumenViajes(OCT, signal());
    expect(h.calls[0]!.target).toBe('rpc:resumen_viajes');
    expect(argsDe(h.calls[0]!)).toEqual({ p_desde: '2026-10-01', p_hasta: '2026-10-31' });
  });

  it('ningún parámetro de tenant: la base filtra por la sesión', async () => {
    h.state.responder = () => ok([TOTAL]);
    await fetchResumenGastos(OCT, signal());
    expect(JSON.stringify(argsDe(h.calls[0]!))).not.toMatch(/transportista|tenant/);
  });
});

describe('topes controlados ANTES de llamar (la base daría 22023)', () => {
  it('gastos y combustible: hasta 366 días de diferencia; un año bisiesto entero entra', async () => {
    h.state.responder = () => ok([TOTAL]);
    await fetchResumenGastos({ desde: '2024-01-01', hasta: '2024-12-31' }, signal());
    await fetchResumenGastos({ desde: '2024-01-01', hasta: '2025-01-01' }, signal()); // 366: el tope, válido
    expect(h.calls).toHaveLength(2);
    const error = await err(fetchResumenGastos({ desde: '2024-01-01', hasta: '2025-01-02' }, signal()));
    expect(error).toBeInstanceOf(ResumenParametrosInvalidosError);
    expect((error as ResumenParametrosInvalidosError).motivo).toBe('más de 366 días');
    expect(await err(fetchResumenCombustible({ desde: '2024-01-01', hasta: '2025-01-02' }, null, signal()))).toBeInstanceOf(
      ResumenParametrosInvalidosError,
    );
    expect(h.calls).toHaveLength(2);
  });

  it('viajes: hasta 62 días', async () => {
    h.state.responder = () => ok([]);
    await fetchResumenViajes({ desde: '2026-09-01', hasta: '2026-11-02' }, signal()); // 62
    const error = await err(fetchResumenViajes({ desde: '2026-09-01', hasta: '2026-11-03' }, signal())); // 63
    expect((error as ResumenParametrosInvalidosError).motivo).toBe('más de 62 días');
    expect(h.calls).toHaveLength(1);
  });

  it('desde posterior a hasta, fechas inválidas, meses fuera de 1 a 24, camión que no es uuid: sin llamar', async () => {
    h.state.responder = () => ok([TOTAL]);
    const errores = await Promise.all([
      err(fetchResumenGastos({ desde: '2026-10-31', hasta: '2026-10-01' }, signal())),
      err(fetchResumenGastos({ desde: '2026-02-30', hasta: '2026-03-01' }, signal())),
      err(fetchResumenMensual({ year: 2026, month: 1 }, 0, signal())),
      err(fetchResumenMensual({ year: 2026, month: 1 }, 25, signal())),
      err(fetchResumenMensual({ year: 2026, month: 1 }, 1.5, signal())),
      err(fetchResumenCombustible(OCT, 'no-es-uuid', signal())),
    ]);
    for (const error of errores) {
      expect(error).toBeInstanceOf(ResumenParametrosInvalidosError);
      expect(mensajeErrorResumen(error)).toBe(RESUMEN_ERROR_INESPERADO);
      expect(isRetryableDataError(error)).toBe(false);
    }
    expect(h.calls).toHaveLength(0);
  });
});

describe('errores de la base y respuestas fuera de contrato', () => {
  it('22023 (no debería pasar): error inesperado, sin "Reintentar"', async () => {
    h.state.responder = () => fail('22023', 'Período inválido: no puede superar 366 días');
    const error = await err(fetchResumenGastos(OCT, signal()));
    expect(error).toBeInstanceOf(DataRequestError);
    expect(mensajeErrorResumen(error)).toBe(RESUMEN_ERROR_INESPERADO);
    expect(mensajeErrorResumen(error)).not.toContain('366');
  });

  it('42501 (sin cuenta): su mensaje, sin "Reintentar"', async () => {
    h.state.responder = () => fail('42501', 'No perteneces a ningún transportista', 403);
    const error = await err(fetchResumenViajes(OCT, signal()));
    expect(mensajeErrorResumen(error)).toBe(RESUMEN_SIN_CUENTA);
  });

  it('sin red: el mensaje de siempre, con "Reintentar"', async () => {
    h.state.responder = () => ({ data: null, error: { code: '', message: 'TypeError: Failed to fetch' }, status: 0 });
    const error = await err(fetchResumenCombustible(OCT, null, signal()));
    expect(mensajeErrorResumen(error)).toBe('No hay conexión. Revisa la señal y prueba de nuevo.');
  });

  it('la función no existe todavía (PGRST202, front antes que la 014): error genérico', async () => {
    h.state.responder = () => fail('PGRST202', 'Could not find the function public.resumen_gastos', 404);
    const error = await err(fetchResumenGastos(OCT, signal()));
    expect(mensajeErrorResumen(error)).not.toMatch(/resumen_gastos|PGRST/);
  });

  it('una respuesta fuera de contrato no devuelve datos: error de contrato', async () => {
    h.state.responder = () => ok([{ ...TOTAL, grupo: 'otro' }]);
    const error = await err(fetchResumenGastos(OCT, signal()));
    expect(error).toBeInstanceOf(ResumenRespuestaInesperadaError);
    h.state.responder = () => ok([]); // resumen_mensual con 0 filas para 1 mes
    expect(await err(fetchResumenMensual({ year: 2026, month: 10 }, 1, signal()))).toBeInstanceOf(ResumenRespuestaInesperadaError);
  });
});

describe('keys', () => {
  const empiezaCon = (key: readonly unknown[], prefijo: readonly unknown[]) => prefijo.every((parte, i) => key[i] === parte);

  it('todas con el tenant y colgadas de all (lo que invalidan las mutaciones)', () => {
    const t = 'tenant-a';
    const todas = [
      resumenKeys.gastos(t, '2026-10-01', '2026-10-31'),
      resumenKeys.mensual(t, '2026-01-01', 12),
      resumenKeys.combustible(t, '2026-10-01', '2026-10-31', null),
      resumenKeys.combustible(t, '2026-10-01', '2026-10-31', CAM),
      resumenKeys.viajes(t, '2026-10-01', '2026-10-31'),
    ];
    for (const key of todas) {
      expect(key[0]).toBe('tenant');
      expect(key[1]).toBe(t);
      expect(empiezaCon(key, resumenKeys.all(t))).toBe(true);
    }
    expect(resumenKeys.all(t)).toEqual(['tenant', t, 'resumen']);
  });

  it('cada período y cada función, su key (no se pisan)', () => {
    const t = 'tenant-a';
    const keys = [
      resumenKeys.gastos(t, '2026-10-01', '2026-10-31'),
      // Septiembre entero (mes cerrado) y del 1 al 13 (comparación del mes en curso): mismo desde, distinto hasta.
      resumenKeys.gastos(t, '2026-09-01', '2026-09-30'),
      resumenKeys.gastos(t, '2026-09-01', '2026-09-13'),
      resumenKeys.viajes(t, '2026-10-01', '2026-10-31'),
      resumenKeys.combustible(t, '2026-10-01', '2026-10-31', null),
      resumenKeys.combustible(t, '2026-10-01', '2026-10-31', CAM),
      resumenKeys.mensual(t, '2026-10-01', 1),
      resumenKeys.mensual(t, '2026-01-01', 12),
    ].map((key) => JSON.stringify(key));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('mensual: la key cambia con los MESES (la vista Mes de enero y la vista Año piden el mismo mes de inicio)', () => {
    const t = 'tenant-a';
    const enero1 = JSON.stringify(resumenKeys.mensual(t, '2026-01-01', 1));
    const enero12 = JSON.stringify(resumenKeys.mensual(t, '2026-01-01', 12));
    expect(enero1).not.toBe(enero12);
    expect(JSON.stringify(resumenKeys.mensual(t, '2026-01-01', 12))).toBe(enero12); // la misma llamada, la misma key
  });

  it('mensual: la key cambia con el mes de inicio', () => {
    const t = 'tenant-a';
    expect(JSON.stringify(resumenKeys.mensual(t, '2026-01-01', 1))).not.toBe(JSON.stringify(resumenKeys.mensual(t, '2026-02-01', 1)));
    expect(JSON.stringify(resumenKeys.mensual(t, '2025-01-01', 12))).not.toBe(JSON.stringify(resumenKeys.mensual(t, '2026-01-01', 12)));
  });

  it('sin tenant falla', () => {
    expect(() => resumenKeys.all('')).toThrow();
  });
});
