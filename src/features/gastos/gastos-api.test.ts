import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock de supabase: registra cada pedido (tabla o función + operaciones encadenadas) y responde según lo que defina cada
// prueba. El objeto que devuelve es un Proxy: acepta CUALQUIER método encadenado y lo anota, así que una operación que el
// código agregue o saque se ve en `ops`. TODO lo demás es código REAL del proyecto.
type Op = { m: string; args: unknown[] };
type Call = { target: string; ops: Op[] };

const h = vi.hoisted(() => {
  const calls: Array<{ target: string; ops: Array<{ m: string; args: unknown[] }> }> = [];
  const state = { responder: null as null | ((call: { target: string; ops: Array<{ m: string; args: unknown[] }> }) => unknown) };
  function builder(target: string, firstOp?: { m: string; args: unknown[] }): object {
    const call = { target, ops: firstOp ? [firstOp] : ([] as Array<{ m: string; args: unknown[] }>) };
    const proxy: object = new Proxy(
      {},
      {
        get(_objetivo, propiedad) {
          if (propiedad === 'then') {
            return (onF: (v: unknown) => unknown, onR: (e: unknown) => unknown) => {
              calls.push(call);
              return Promise.resolve()
                .then(() => state.responder?.(call))
                .then(onF, onR);
            };
          }
          return (...args: unknown[]) => {
            call.ops.push({ m: String(propiedad), args });
            return proxy;
          };
        },
      },
    );
    return proxy;
  }
  return {
    calls,
    state,
    from: (table: string) => builder(table),
    rpc: (fn: string, args: unknown) => builder(`rpc:${fn}`, { m: 'rpc', args: [args] }),
  };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from: h.from, rpc: h.rpc } }));

import { GENERIC_ERROR_MESSAGE } from '@/features/auth/auth-errors';
import { DataRequestError, classifyDataError, isRetryableDataError, mapDataError } from '@/lib/data-errors';
import { WRITE_TIMEOUT_MS } from '@/lib/db';
import { LIST_LIMIT, MAX_GASTOS_POR_VEZ } from '@/features/gastos/constants';
import {
  SeleccionDeGastosInvalidaError,
  fetchGastosDelRango,
  fetchGastosDelViaje,
  fetchGastosSueltos,
  quitarGastosDelViaje,
  vincularGastosAViaje,
} from '@/features/gastos/gastos-api';
import { distanciaEnDias } from '@/features/gastos/sumar-gastos';

const ok = (data: unknown) => ({ data, error: null, status: 200 });
const fail = (code: string, message = 'falla', status = 400) => ({ data: null, error: { code, message, details: '', hint: '' }, status });
const sinRed = () => fail('', 'TypeError: Failed to fetch', 0);

const VIAJE_ID = '33333333-3333-4333-8333-333333333333';
const FECHA = '2026-06-15';
const CATEGORIA = '44444444-4444-4444-8444-444444444444';
const idDe = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const [G1, G2, G3, G4] = [idDe(1), idDe(2), idDe(3), idDe(4)] as const;

/** La fecha 'YYYY-MM-DD' que queda `n` días después (o antes, con negativo) de la fecha del viaje. Solo UTC: sin zona horaria. */
const diaDelViaje = (n: number) => {
  const [anio, mes, dia] = FECHA.split('-').map(Number);
  const fecha = new Date(0);
  fecha.setUTCFullYear(anio!, mes! - 1, dia! + n);
  return fecha.toISOString().slice(0, 10);
};

const ops = (call: Call) => call.ops.map((o) => o.m);
const op = (call: Call, m: string) => call.ops.filter((o) => o.m === m);
const signal = () => new AbortController().signal;

/** Un gasto suelto tal como lo devuelve la consulta de la lista (las columnas de una fila). */
const gasto = (id: string, fecha: string, created_at = '2026-11-01T10:00:00+00:00') => ({
  id,
  categoria_id: CATEGORIA,
  fecha,
  monto: 1000,
  descripcion: null,
  litros: null,
  camion_id: null,
  created_at,
});

/** Ids que NO son un uuid; los de abajo con comillas, comas o paréntesis son los que podrían colar valores en `in.(...)`. */
const IDS_QUE_NO_SON_UUID = [
  '',
  ' ',
  'x',
  'null',
  'undefined',
  `${G1} `,
  ` ${G1}`,
  `{${G1}}`,
  G1.replace(/-/g, ''),
  `${G1}","${G2}`,
  `${G1},${G2}`,
  `(${G1})`,
  `${G1}) or (1=1`,
  'x"; drop table gastos; --',
];

let timeoutSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  h.calls.length = 0;
  h.state.responder = null;
  timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
});

afterEach(() => {
  timeoutSpy.mockRestore();
});

/** El pedido que filtra «desde la fecha del viaje» (`gte`) y el que filtra «antes» (`lt`). */
const consultaDesde = () => h.calls.find((c) => ops(c).includes('gte'))!;
const consultaAntes = () => h.calls.find((c) => ops(c).includes('lt'))!;
/** Responde cada lado con su lista. */
const sueltos = (posteriores: unknown[], anteriores: unknown[]) => (call: Call) => (ops(call).includes('gte') ? ok(posteriores) : ok(anteriores));

describe('fetchGastosSueltos: los gastos sin viaje, los más cercanos a la fecha del viaje primero', () => {
  it('son DOS consultas sobre gastos con `viaje_id is null`: desde la fecha del viaje (fecha ascendente) y antes (fecha descendente), 101 de cada una', async () => {
    h.state.responder = sueltos([], []);
    await fetchGastosSueltos({ fechaViaje: FECHA, signal: signal() });
    expect(h.calls).toHaveLength(2);
    for (const call of h.calls) expect(call.target).toBe('gastos');

    const desde = consultaDesde();
    expect(ops(desde)).toEqual(['select', 'is', 'gte', 'order', 'order', 'order', 'limit', 'abortSignal']);
    expect(op(desde, 'is')[0]!.args).toEqual(['viaje_id', null]);
    expect(op(desde, 'gte')[0]!.args).toEqual(['fecha', FECHA]);
    expect(op(desde, 'order').map((o) => o.args)).toEqual([
      ['fecha', { ascending: true }],
      ['created_at', { ascending: false }],
      ['id', { ascending: true }],
    ]);
    expect(op(desde, 'limit')[0]!.args).toEqual([MAX_GASTOS_POR_VEZ + 1]);

    const antes = consultaAntes();
    expect(ops(antes)).toEqual(['select', 'is', 'lt', 'order', 'order', 'order', 'limit', 'abortSignal']);
    expect(op(antes, 'is')[0]!.args).toEqual(['viaje_id', null]);
    expect(op(antes, 'lt')[0]!.args).toEqual(['fecha', FECHA]);
    expect(op(antes, 'order').map((o) => o.args)).toEqual([
      ['fecha', { ascending: false }],
      ['created_at', { ascending: false }],
      ['id', { ascending: true }],
    ]);
    expect(op(antes, 'limit')[0]!.args).toEqual([101]);
  });

  it('el límite es MAX_GASTOS_POR_VEZ + 1 = 101 (uno de más por lado: así se sabe si había más)', async () => {
    h.state.responder = sueltos([], []);
    await fetchGastosSueltos({ fechaViaje: FECHA, signal: signal() });
    expect(MAX_GASTOS_POR_VEZ).toBe(100);
    for (const call of h.calls) expect(op(call, 'limit')[0]!.args).toEqual([101]);
  });

  it('las columnas son las MISMAS que las de una fila de la lista (con `camion_id`: hace falta para la regla del camión)', async () => {
    h.state.responder = () => ok([]);
    await fetchGastosDelViaje(VIAJE_ID, signal());
    const columnasDeLaLista = op(h.calls[0]!, 'select')[0]!.args;
    h.calls.length = 0;
    h.state.responder = sueltos([], []);
    await fetchGastosSueltos({ fechaViaje: FECHA, signal: signal() });
    for (const call of h.calls) expect(op(call, 'select')[0]!.args).toEqual(columnasDeLaLista);
    expect(columnasDeLaLista[0]).toContain('camion_id');
    expect(columnasDeLaLista[0]).toContain('created_at');
    expect(columnasDeLaLista[0]).not.toContain('transportista_id');
  });

  it('es una LECTURA: las dos usan la señal de TanStack (no el timeout de escritura) y no escriben nada', async () => {
    h.state.responder = sueltos([], []);
    const s = signal();
    await fetchGastosSueltos({ fechaViaje: FECHA, signal: s });
    for (const call of h.calls) {
      expect(op(call, 'abortSignal')[0]!.args[0]).toBe(s);
      for (const escritura of ['update', 'insert', 'delete', 'upsert', 'rpc']) expect(ops(call)).not.toContain(escritura);
    }
    expect(timeoutSpy).not.toHaveBeenCalled();
  });

  it('las dos consultas SALEN A LA VEZ: la segunda no espera a la primera', async () => {
    const pedidosEnMarchaAlResponder: number[] = [];
    h.state.responder = () => {
      pedidosEnMarchaAlResponder.push(h.calls.length);
      return ok([]);
    };
    await fetchGastosSueltos({ fechaViaje: FECHA, signal: signal() });
    expect(pedidosEnMarchaAlResponder).toEqual([2, 2]);
  });

  it('junta las dos y las devuelve por cercanía a la fecha del viaje; con 100 o menos no hay «más»', async () => {
    const posteriores = [gasto(G1, '2026-06-18'), gasto(G2, '2026-06-15')];
    const anteriores = [gasto(G3, '2026-06-14'), gasto(G4, '2026-05-01')];
    h.state.responder = sueltos(posteriores, anteriores);
    const resultado = await fetchGastosSueltos({ fechaViaje: FECHA, signal: signal() });
    expect(resultado.items.map((x) => x.id)).toEqual([G2, G3, G1, G4]); // 0, 1, 3 y 45 días
    expect(resultado.hayMas).toBe(false);
    expect(resultado.items[0]).toBe(posteriores[1]); // las filas tal cual vinieron
  });

  it('a igual distancia, el posterior (fecha más reciente) antes que el anterior', async () => {
    h.state.responder = sueltos([gasto(G1, '2026-06-20')], [gasto(G2, '2026-06-10')]);
    const { items } = await fetchGastosSueltos({ fechaViaje: FECHA, signal: signal() });
    expect(items.map((x) => x.id)).toEqual([G1, G2]);
  });

  it('sin gastos sueltos: lista vacía y sin más', async () => {
    h.state.responder = sueltos([], []);
    await expect(fetchGastosSueltos({ fechaViaje: FECHA, signal: signal() })).resolves.toEqual({ items: [], hayMas: false });
  });

  it('un lado con 101 filas: se muestran 100 y hay más (el 101 es el más lejano)', async () => {
    const posteriores = Array.from({ length: 101 }, (_, i) => gasto(idDe(i), diaDelViaje(i))); // 0 a 100 días después
    h.state.responder = sueltos(posteriores, []);
    const { items, hayMas } = await fetchGastosSueltos({ fechaViaje: FECHA, signal: signal() });
    expect(items).toHaveLength(100);
    expect(hayMas).toBe(true);
    const distancias = items.map((x) => distanciaEnDias(x.fecha, FECHA)!);
    expect(distancias).toEqual([...distancias].sort((a, b) => a - b));
    expect(items.map((x) => x.id)).not.toContain(idDe(100));
  });

  it('101 de cada lado: quedan los 100 más cercanos de entre los dos y hay más', async () => {
    const posteriores = Array.from({ length: 101 }, (_, i) => gasto(idDe(1000 + i), diaDelViaje(i))); // 0 a 100 días después
    const anteriores = Array.from({ length: 101 }, (_, i) => gasto(idDe(2000 + i), diaDelViaje(-1 - i))); // 1 a 101 días antes
    h.state.responder = sueltos(posteriores, anteriores);
    const { items, hayMas } = await fetchGastosSueltos({ fechaViaje: FECHA, signal: signal() });
    expect(items).toHaveLength(100);
    expect(hayMas).toBe(true);
    expect(Math.max(...items.map((x) => distanciaEnDias(x.fecha, FECHA)!))).toBe(50);
    expect(items[99]!.id).toBe(idDe(1050)); // el lugar 100 es el posterior a 50 días; el anterior a 50 días queda afuera
  });

  it('si UNA de las dos consultas falla, falla todo: nunca se devuelve un lado solo', async () => {
    for (const lado of ['gte', 'lt']) {
      h.calls.length = 0;
      h.state.responder = (call) => (ops(call).includes(lado) ? sinRed() : ok([gasto(G1, '2026-06-15')]));
      const error = await fetchGastosSueltos({ fechaViaje: FECHA, signal: signal() }).then(
        () => null,
        (e: unknown) => e,
      );
      expect(error, lado).toBeInstanceOf(DataRequestError);
      expect(classifyDataError(error), lado).toBe('network');
      expect(isRetryableDataError(error), lado).toBe(true);
    }
  });

  it('un error de la base se propaga con su código (no se traga ni se cambia)', async () => {
    h.state.responder = (call) => (ops(call).includes('lt') ? fail('42501', 'permiso', 403) : ok([]));
    await expect(fetchGastosSueltos({ fechaViaje: FECHA, signal: signal() })).rejects.toMatchObject({ code: '42501', status: 403 });
  });

  it('no manda NUNCA `transportista_id` (lo filtra la base con la RLS)', async () => {
    h.state.responder = sueltos([], []);
    await fetchGastosSueltos({ fechaViaje: FECHA, signal: signal() });
    expect(JSON.stringify(h.calls)).not.toContain('transportista_id');
  });

  it('una fecha de viaje inválida tira RangeError ANTES de pedir nada', async () => {
    for (const mala of ['', 'hoy', '2026-02-30', '2026-6-15', '2026-06-15T00:00:00Z', 'infinity', undefined as unknown as string]) {
      await expect(fetchGastosSueltos({ fechaViaje: mala, signal: signal() }), String(mala)).rejects.toBeInstanceOf(RangeError);
    }
    expect(h.calls).toHaveLength(0);
  });

  it('un gasto con una fecha rara en la base (la base no la limita) no rompe la lista: queda al final', async () => {
    h.state.responder = sueltos([gasto(G1, 'infinity'), gasto(G2, '2026-06-16')], [gasto(G3, '-infinity'), gasto(G4, '2026-06-14')]);
    const { items } = await fetchGastosSueltos({ fechaViaje: FECHA, signal: signal() });
    expect(items.map((x) => x.id)).toEqual([G2, G4, G1, G3]);
  });
});

describe('el orden de las dos listas de gastos: fecha desc, created_at desc y id asc (desempate)', () => {
  // Los gastos que se cargan juntos (varias categorías de una vez, un solo INSERT) comparten fecha y created_at: sin el `id` como último
  // criterio su orden entre sí quedaría indefinido y podría cambiar de una lectura a otra. Es el mismo desempate de los gastos sueltos.
  const ORDEN = [
    ['fecha', { ascending: false }],
    ['created_at', { ascending: false }],
    ['id', { ascending: true }],
  ];
  const desde = '2026-06-01';
  const hasta = '2026-07-01';

  it('fetchGastosDelRango: tres órdenes, en ese orden y con el id al final, antes del límite de LIST_LIMIT + 1', async () => {
    h.state.responder = () => ok([]);
    await fetchGastosDelRango({ desde, hasta, categoriaId: null, signal: signal() });
    expect(h.calls).toHaveLength(1);
    const call = h.calls[0]!;
    expect(call.target).toBe('gastos');
    expect(ops(call)).toEqual(['select', 'gte', 'lt', 'order', 'order', 'order', 'limit', 'abortSignal']);
    expect(op(call, 'order').map((o) => o.args)).toEqual(ORDEN);
    expect(op(call, 'limit')[0]!.args).toEqual([LIST_LIMIT + 1]);
  });

  it('fetchGastosDelRango con una categoría filtra por ella y mantiene la MISMA cadena de órdenes', async () => {
    h.state.responder = () => ok([]);
    await fetchGastosDelRango({ desde, hasta, categoriaId: CATEGORIA, signal: signal() });
    const call = h.calls[0]!;
    expect(ops(call)).toEqual(['select', 'gte', 'lt', 'eq', 'order', 'order', 'order', 'limit', 'abortSignal']);
    expect(op(call, 'eq')[0]!.args).toEqual(['categoria_id', CATEGORIA]);
    expect(op(call, 'order').map((o) => o.args)).toEqual(ORDEN);
  });

  it('fetchGastosDelViaje: filtra por el viaje y pide los mismos tres órdenes, con el id al final, antes del límite de LIST_LIMIT + 1', async () => {
    h.state.responder = () => ok([]);
    await fetchGastosDelViaje(VIAJE_ID, signal());
    expect(h.calls).toHaveLength(1);
    const call = h.calls[0]!;
    expect(call.target).toBe('gastos');
    expect(ops(call)).toEqual(['select', 'eq', 'order', 'order', 'order', 'limit', 'abortSignal']);
    expect(op(call, 'eq')[0]!.args).toEqual(['viaje_id', VIAJE_ID]);
    expect(op(call, 'order').map((o) => o.args)).toEqual(ORDEN);
    expect(op(call, 'limit')[0]!.args).toEqual([LIST_LIMIT + 1]);
  });

  it('las dos listas, y la de los gastos sueltos, desempatan con el MISMO último criterio (id ascendente)', async () => {
    h.state.responder = () => ok([]);
    await fetchGastosDelRango({ desde, hasta, categoriaId: null, signal: signal() });
    await fetchGastosDelViaje(VIAJE_ID, signal());
    await fetchGastosSueltos({ fechaViaje: FECHA, signal: signal() });
    expect(h.calls).toHaveLength(4);
    for (const call of h.calls) expect(op(call, 'order').at(-1)!.args).toEqual(['id', { ascending: true }]);
  });
});

describe('vincularGastosAViaje (rpc vincular_gastos_a_viaje)', () => {
  const respuesta = (...filas: Array<[string, unknown]>) => filas.map(([gasto_id, resultado]) => ({ gasto_id, resultado }));

  it('llama a la función con SOLO p_viaje_id y p_gasto_ids, con el timeout de escritura, y devuelve qué pasó con cada gasto en el orden pedido', async () => {
    h.state.responder = () => ok(respuesta([G2, 'ya_estaba'], [G1, 'vinculado'], [G3, 'camion_distinto']));
    const resultados = await vincularGastosAViaje(VIAJE_ID, [G1, G2, G3]);
    expect(resultados).toEqual([
      { gastoId: G1, resultado: 'vinculado' },
      { gastoId: G2, resultado: 'ya_estaba' },
      { gastoId: G3, resultado: 'camion_distinto' },
    ]);
    expect(h.calls).toHaveLength(1);
    const [call] = h.calls;
    expect(call!.target).toBe('rpc:vincular_gastos_a_viaje');
    expect(ops(call!)).toEqual(['rpc', 'abortSignal']);
    expect(op(call!, 'rpc')[0]!.args[0]).toEqual({ p_viaje_id: VIAJE_ID, p_gasto_ids: [G1, G2, G3] });
    expect(Object.keys(op(call!, 'rpc')[0]!.args[0] as object).sort()).toEqual(['p_gasto_ids', 'p_viaje_id']);
  });

  it('es una ESCRITURA: el timeout es el de `writeTimeoutSignal` (20 s) y esa es la señal que se le pasa', async () => {
    h.state.responder = () => ok(respuesta([G1, 'vinculado']));
    await vincularGastosAViaje(VIAJE_ID, [G1]);
    expect(timeoutSpy).toHaveBeenCalledTimes(1);
    expect(timeoutSpy).toHaveBeenCalledWith(WRITE_TIMEOUT_MS);
    const enviada = op(h.calls[0]!, 'abortSignal')[0]!.args[0];
    expect(enviada).toBeInstanceOf(AbortSignal);
    expect(enviada).toBe(timeoutSpy.mock.results[0]!.value);
  });

  it('manda los ids SIN repetir, en el orden de la primera aparición, y la respuesta se lee contra esos mismos ids', async () => {
    h.state.responder = () => ok(respuesta([G2, 'vinculado'], [G1, 'ya_estaba']));
    const resultados = await vincularGastosAViaje(VIAJE_ID, [G2, G1, G2, G1, G2]);
    expect(op(h.calls[0]!, 'rpc')[0]!.args[0]).toEqual({ p_viaje_id: VIAJE_ID, p_gasto_ids: [G2, G1] });
    expect(resultados).toEqual([
      { gastoId: G2, resultado: 'vinculado' },
      { gastoId: G1, resultado: 'ya_estaba' },
    ]);
  });

  it('la respuesta se lee de forma ESTRICTA: lo que no se entiende, lo que no se pidió y lo que falta', async () => {
    h.state.responder = () => ok([...respuesta([G1, null], [G2, 'Vinculado'], [idDe(99), 'vinculado']), { gasto_id: G3 }, 'basura', null]);
    const resultados = await vincularGastosAViaje(VIAJE_ID, [G1, G2, G3, G4]);
    expect(resultados).toEqual([
      { gastoId: G1, resultado: 'no_se_pudo' }, // NULL
      { gastoId: G2, resultado: 'no_se_pudo' }, // un texto que no es exactamente el de la base
      { gastoId: G3, resultado: 'no_se_pudo' }, // sin `resultado`
      { gastoId: G4, resultado: 'no_se_pudo' }, // sin fila
    ]);
    expect(JSON.stringify(resultados)).not.toContain(idDe(99)); // el id que no se pidió no aparece
  });

  it('una respuesta que no es una lista (null, objeto) no tira: todo es «no_se_pudo»', async () => {
    for (const rara of [null, {}, 'ok', 7]) {
      h.state.responder = () => ok(rara);
      const resultados = await vincularGastosAViaje(VIAJE_ID, [G1, G2]);
      expect(resultados.map((r) => r.resultado), JSON.stringify(rara)).toEqual(['no_se_pudo', 'no_se_pudo']);
    }
  });

  describe('rechaza ANTES de tocar la red', () => {
    const capturar = (p: Promise<unknown>) =>
      p.then(
        () => null,
        (e: unknown) => e,
      );

    it('una lista vacía: SeleccionDeGastosInvalidaError («vacia»), sin ningún pedido', async () => {
      const error = await capturar(vincularGastosAViaje(VIAJE_ID, []));
      expect(error).toBeInstanceOf(SeleccionDeGastosInvalidaError);
      expect((error as SeleccionDeGastosInvalidaError).motivo).toBe('vacia');
      expect(h.calls).toHaveLength(0);
    });

    it('más de MAX_GASTOS_POR_VEZ ids DISTINTOS (101): SeleccionDeGastosInvalidaError («demasiados»), sin ningún pedido', async () => {
      const ciento1 = Array.from({ length: 101 }, (_, i) => idDe(i));
      const error = await capturar(vincularGastosAViaje(VIAJE_ID, ciento1));
      expect(error).toBeInstanceOf(SeleccionDeGastosInvalidaError);
      expect((error as SeleccionDeGastosInvalidaError).motivo).toBe('demasiados');
      expect(h.calls).toHaveLength(0);
    });

    it('exactamente 100 distintos SÍ se manda; y 150 entradas con solo 100 distintos también (se mandan 100)', async () => {
      const cien = Array.from({ length: 100 }, (_, i) => idDe(i));
      h.state.responder = () => ok([]);
      await vincularGastosAViaje(VIAJE_ID, cien);
      expect((op(h.calls[0]!, 'rpc')[0]!.args[0] as { p_gasto_ids: string[] }).p_gasto_ids).toEqual(cien);
      h.calls.length = 0;
      await vincularGastosAViaje(VIAJE_ID, [...cien, ...cien.slice(0, 50)]);
      expect((op(h.calls[0]!, 'rpc')[0]!.args[0] as { p_gasto_ids: string[] }).p_gasto_ids).toHaveLength(100);
    });

    it('un id que NO es un uuid (vacío, texto suelto, con comillas o comas para colar valores): «id-invalido», sin ningún pedido', async () => {
      for (const malo of IDS_QUE_NO_SON_UUID) {
        for (const lista of [[malo], [G1, malo], [malo, G1, G2]]) {
          const error = await capturar(vincularGastosAViaje(VIAJE_ID, lista));
          expect(error, malo).toBeInstanceOf(SeleccionDeGastosInvalidaError);
          expect((error as SeleccionDeGastosInvalidaError).motivo, malo).toBe('id-invalido');
        }
      }
      expect(h.calls).toHaveLength(0);
    });

    it('un uuid en MAYÚSCULAS sí es válido: se manda tal cual', async () => {
      const enMayusculas = 'ABCDEF00-0000-4000-8000-00000000000A';
      h.state.responder = () => ok([{ gasto_id: enMayusculas.toLowerCase(), resultado: 'vinculado' }]);
      const resultados = await vincularGastosAViaje(VIAJE_ID, [enMayusculas]);
      expect(op(h.calls[0]!, 'rpc')[0]!.args[0]).toEqual({ p_viaje_id: VIAJE_ID, p_gasto_ids: [enMayusculas] });
      // La base responde en minúsculas: se reconoce igual, y el id sale con la escritura con que se pidió.
      expect(resultados).toEqual([{ gastoId: enMayusculas, resultado: 'vinculado' }]);
    });

    it('el rechazo es de la clase «datos inválidos», NO se reintenta, y no muestra el texto interno', async () => {
      for (const lista of [[], Array.from({ length: 101 }, (_, i) => idDe(i)), ['no-es-un-uuid']]) {
        const error = await capturar(vincularGastosAViaje(VIAJE_ID, lista));
        expect(error).toBeInstanceOf(DataRequestError);
        expect((error as DataRequestError).code).toBe('22023'); // el mismo código que daría la base
        expect((error as Error).name).toBe('SeleccionDeGastosInvalidaError');
        expect(classifyDataError(error)).toBe('invalid-data');
        expect(isRetryableDataError(error)).toBe(false);
        expect(mapDataError(error)).toBe(mapDataError({ code: '22023', message: 'x' }));
        expect(mapDataError(error)).not.toContain('selección');
      }
    });
  });

  it('un error de la base se propaga con su código y NO se reintenta solo (un único pedido)', async () => {
    const casos: Array<{ respuesta: ReturnType<typeof fail>; clase: string; reintentable: boolean }> = [
      { respuesta: fail('42501', 'No perteneces a ningún transportista', 403), clase: 'permission', reintentable: false },
      { respuesta: fail('22023', 'Falta el id del viaje', 400), clase: 'invalid-data', reintentable: false },
      // PostgREST devuelve P0002 como HTTP 500: se clasifica por el código primero (no es un error del servidor).
      { respuesta: fail('P0002', 'No se encontró el viaje', 500), clase: 'not-found', reintentable: false },
      // La cuenta en solo lectura (más adelante, un trigger de la base): PostgREST lo devuelve como 402.
      { respuesta: fail('PT402', 'texto_fijo_de_prueba', 402), clase: 'payment', reintentable: false },
      { respuesta: fail('', 'Payment Required', 402), clase: 'payment', reintentable: false },
      { respuesta: sinRed(), clase: 'network', reintentable: true },
      { respuesta: fail('', 'TimeoutError: signal timed out', 0), clase: 'timeout', reintentable: true },
      { respuesta: fail('', 'Bad Gateway', 502), clase: 'server', reintentable: true },
    ];
    for (const { respuesta: r, clase, reintentable } of casos) {
      h.calls.length = 0;
      h.state.responder = () => r;
      const error = await vincularGastosAViaje(VIAJE_ID, [G1]).then(
        () => null,
        (e: unknown) => e,
      );
      const nombre = `${r.error.code} ${r.status}`;
      expect(error, nombre).toBeInstanceOf(DataRequestError);
      expect((error as DataRequestError).code, nombre).toBe(r.error.code);
      expect(classifyDataError(error), nombre).toBe(clase);
      expect(isRetryableDataError(error), nombre).toBe(reintentable);
      expect(h.calls, nombre).toHaveLength(1); // sin reintento automático
    }
  });

  it('el mensaje de pantalla de cada error de la base nunca trae el texto del servidor', async () => {
    h.state.responder = () => fail('P0002', 'No se encontró el viaje', 500);
    const error = await vincularGastosAViaje(VIAJE_ID, [G1]).then(
      () => null,
      (e: unknown) => e,
    );
    expect(mapDataError(error)).toBe('No encontramos ese registro.');
    h.state.responder = () => fail('PT402', 'texto_fijo_de_prueba', 402);
    const pago = await vincularGastosAViaje(VIAJE_ID, [G1]).then(
      () => null,
      (e: unknown) => e,
    );
    expect(mapDataError(pago)).toBe('Tu cuenta está en modo de solo lectura: por ahora no se pueden guardar cambios.');
    expect(mapDataError(pago)).not.toContain('texto_fijo');
  });

  it('no manda NUNCA `transportista_id`', async () => {
    h.state.responder = () => ok(respuesta([G1, 'vinculado']));
    await vincularGastosAViaje(VIAJE_ID, [G1]);
    expect(JSON.stringify(h.calls)).not.toContain('transportista_id');
  });

  it('no cambia la lista que recibe', async () => {
    h.state.responder = () => ok([]);
    const entrada = Object.freeze([G1, G1, G2]);
    await vincularGastosAViaje(VIAJE_ID, entrada);
    expect(entrada).toEqual([G1, G1, G2]);
  });
});

describe('quitarGastosDelViaje (UPDATE gastos SET viaje_id = null)', () => {
  const capturar = (p: Promise<unknown>) =>
    p.then(
      () => null,
      (e: unknown) => e,
    );

  it('UPDATE de gastos con SOLO `viaje_id: null`, de los ids pedidos Y de ESTE viaje, pidiendo los ids de vuelta y con timeout de escritura', async () => {
    h.state.responder = () => ok([{ id: G1 }, { id: G2 }]);
    const quitados = await quitarGastosDelViaje(VIAJE_ID, [G1, G2, G3]);
    expect(quitados).toEqual([G1, G2]);
    expect(h.calls).toHaveLength(1);
    const [call] = h.calls;
    expect(call!.target).toBe('gastos');
    expect(ops(call!)).toEqual(['update', 'in', 'eq', 'select', 'abortSignal']);
    expect(op(call!, 'update')[0]!.args[0]).toEqual({ viaje_id: null }); // null EXPLÍCITO y nada más
    expect(op(call!, 'in')[0]!.args).toEqual(['id', [G1, G2, G3]]);
    expect(op(call!, 'eq')[0]!.args).toEqual(['viaje_id', VIAJE_ID]); // solo los de ESTE viaje: uno de otro viaje no se toca
    expect(op(call!, 'select')[0]!.args).toEqual(['id']);
  });

  it('es una ESCRITURA: el timeout es el de `writeTimeoutSignal` (20 s) y esa es la señal que se le pasa', async () => {
    h.state.responder = () => ok([]);
    await quitarGastosDelViaje(VIAJE_ID, [G1]);
    expect(timeoutSpy).toHaveBeenCalledTimes(1);
    expect(timeoutSpy).toHaveBeenCalledWith(WRITE_TIMEOUT_MS);
    expect(op(h.calls[0]!, 'abortSignal')[0]!.args[0]).toBe(timeoutSpy.mock.results[0]!.value);
  });

  it('los gastos NO se borran, y no se escribe nada más que `viaje_id`', async () => {
    h.state.responder = () => ok([{ id: G1 }]);
    await quitarGastosDelViaje(VIAJE_ID, [G1]);
    const [call] = h.calls;
    for (const otra of ['delete', 'insert', 'upsert', 'rpc']) expect(ops(call!)).not.toContain(otra);
    expect(Object.keys(op(call!, 'update')[0]!.args[0] as object)).toEqual(['viaje_id']);
  });

  it('devuelve los ids que REALMENTE se quitaron, en el orden pedido y con lo que se pidió', async () => {
    h.state.responder = () => ok([{ id: G3 }, { id: G1 }]);
    await expect(quitarGastosDelViaje(VIAJE_ID, [G1, G2, G3])).resolves.toEqual([G1, G3]);
  });

  it('que se quiten menos de los pedidos NO es un error (alguien ya los había quitado); 0 filas tampoco', async () => {
    h.state.responder = () => ok([{ id: G2 }]);
    await expect(quitarGastosDelViaje(VIAJE_ID, [G1, G2, G3])).resolves.toEqual([G2]);
    h.state.responder = () => ok([]);
    await expect(quitarGastosDelViaje(VIAJE_ID, [G1, G2])).resolves.toEqual([]);
  });

  it('una fila con un id que no se pidió, o una fila rara DENTRO de la lista, no cuenta', async () => {
    h.state.responder = () => ok([{ id: idDe(99) }, { id: G1 }, { otra: 'cosa' }, null]);
    await expect(quitarGastosDelViaje(VIAJE_ID, [G1, G2])).resolves.toEqual([G1]);
  });

  it('una respuesta que NO es una lista (null, objeto, texto) es un error de clase «unknown», reintentable: no se toma por «ya no estaban»', async () => {
    for (const rara of [null, {}, 'x']) {
      h.calls.length = 0;
      h.state.responder = () => ok(rara);
      const nombre = JSON.stringify(rara);
      const error = await capturar(quitarGastosDelViaje(VIAJE_ID, [G1, G2]));
      expect(error, nombre).toBeInstanceOf(DataRequestError);
      expect((error as DataRequestError).code, nombre).toBe('');
      expect((error as DataRequestError).status, nombre).toBeUndefined();
      expect(classifyDataError(error), nombre).toBe('unknown');
      expect(isRetryableDataError(error), nombre).toBe(true); // reintentar es seguro: quitar es idempotente
      expect(h.calls, nombre).toHaveLength(1); // pero no se reintenta solo
      // Ni el texto interno ni el de pantalla traen ids.
      expect(mapDataError(error), nombre).toBe(GENERIC_ERROR_MESSAGE);
      for (const texto of [(error as Error).message, mapDataError(error)]) {
        for (const id of [G1, G2, VIAJE_ID]) expect(texto, nombre).not.toContain(id);
      }
    }
  });

  it('manda los ids sin repetir', async () => {
    h.state.responder = () => ok([{ id: G1 }]);
    await quitarGastosDelViaje(VIAJE_ID, [G1, G2, G1]);
    expect(op(h.calls[0]!, 'in')[0]!.args).toEqual(['id', [G1, G2]]);
  });

  it('rechaza ANTES de tocar la red una lista vacía, de más de MAX_GASTOS_POR_VEZ ids distintos o con un id que no es uuid', async () => {
    const vacio = await capturar(quitarGastosDelViaje(VIAJE_ID, []));
    expect(vacio).toBeInstanceOf(SeleccionDeGastosInvalidaError);
    expect((vacio as SeleccionDeGastosInvalidaError).motivo).toBe('vacia');
    const demasiados = await capturar(quitarGastosDelViaje(VIAJE_ID, Array.from({ length: 101 }, (_, i) => idDe(i))));
    expect(demasiados).toBeInstanceOf(SeleccionDeGastosInvalidaError);
    expect((demasiados as SeleccionDeGastosInvalidaError).motivo).toBe('demasiados');
    expect(h.calls).toHaveLength(0);
    // Un id que no es uuid tampoco se manda (en `in.(...)` colaría valores).
    for (const malo of IDS_QUE_NO_SON_UUID) {
      const error = await capturar(quitarGastosDelViaje(VIAJE_ID, [G1, malo]));
      expect(error, malo).toBeInstanceOf(SeleccionDeGastosInvalidaError);
      expect((error as SeleccionDeGastosInvalidaError).motivo, malo).toBe('id-invalido');
    }
    expect(h.calls).toHaveLength(0);
    // Con 100 distintos (aunque lleguen repetidos) sí se manda.
    h.state.responder = () => ok([]);
    const cien = Array.from({ length: 100 }, (_, i) => idDe(i));
    await quitarGastosDelViaje(VIAJE_ID, [...cien, ...cien]);
    expect((op(h.calls[0]!, 'in')[0]!.args[1] as string[]).length).toBe(100);
  });

  it('un error de la base se propaga con su código y NO se reintenta solo', async () => {
    for (const [respuesta, clase] of [
      [fail('42501', 'permiso', 403), 'permission'],
      [fail('PT402', 'texto_fijo_de_prueba', 402), 'payment'],
      [sinRed(), 'network'],
    ] as const) {
      h.calls.length = 0;
      h.state.responder = () => respuesta;
      const error = await capturar(quitarGastosDelViaje(VIAJE_ID, [G1]));
      expect(error, clase).toBeInstanceOf(DataRequestError);
      expect(classifyDataError(error), clase).toBe(clase);
      expect(h.calls, clase).toHaveLength(1);
    }
  });

  it('no manda NUNCA `transportista_id` ni `id` en lo que se escribe', async () => {
    h.state.responder = () => ok([{ id: G1 }]);
    await quitarGastosDelViaje(VIAJE_ID, [G1]);
    expect(JSON.stringify(op(h.calls[0]!, 'update'))).not.toMatch(/transportista_id|"id"/);
    expect(JSON.stringify(h.calls)).not.toContain('transportista_id');
  });
});

describe('lo que se valida antes de la red, en las dos escrituras (vincular y quitar)', () => {
  const capturar = (p: Promise<unknown>) =>
    p.then(
      () => null,
      (e: unknown) => e,
    );
  const conViaje: ReadonlyArray<readonly [string, (viajeId: string, gastoIds?: string[]) => Promise<unknown>]> = [
    ['vincularGastosAViaje', (viajeId, gastoIds = [G1]) => vincularGastosAViaje(viajeId, gastoIds)],
    ['quitarGastosDelViaje', (viajeId, gastoIds = [G1]) => quitarGastosDelViaje(viajeId, gastoIds)],
  ];

  describe('el id del viaje (defensa en profundidad: postgrest-js ya lo codifica en la URL)', () => {
    it.each(conViaje)('%s: un `viajeId` que NO es un uuid es «viaje-invalido», sin ningún pedido', async (_nombre, escribir) => {
      for (const malo of IDS_QUE_NO_SON_UUID) {
        const error = await capturar(escribir(malo));
        expect(error, malo).toBeInstanceOf(SeleccionDeGastosInvalidaError);
        expect((error as SeleccionDeGastosInvalidaError).motivo, malo).toBe('viaje-invalido');
      }
      expect(h.calls).toHaveLength(0);
    });

    it.each(conViaje)('%s: se mira PRIMERO: con un viaje inválido gana sobre una selección vacía o con ids inválidos', async (_nombre, escribir) => {
      for (const gastoIds of [[], ['x'], Array.from({ length: 101 }, (_, i) => idDe(i))]) {
        const error = await capturar(escribir('no-es-un-uuid', gastoIds));
        expect((error as SeleccionDeGastosInvalidaError).motivo).toBe('viaje-invalido');
      }
      expect(h.calls).toHaveLength(0);
    });

    it.each(conViaje)('%s: el rechazo es de la clase «datos inválidos», NO se reintenta, y su texto es fijo (no trae el id recibido)', async (_nombre, escribir) => {
      const textosInternos = new Set<string>();
      for (const malo of IDS_QUE_NO_SON_UUID) {
        const error = await capturar(escribir(malo));
        expect(error, malo).toBeInstanceOf(DataRequestError);
        expect((error as DataRequestError).code, malo).toBe('22023'); // el mismo código que daría la base
        expect((error as Error).name, malo).toBe('SeleccionDeGastosInvalidaError');
        expect(classifyDataError(error), malo).toBe('invalid-data');
        expect(isRetryableDataError(error), malo).toBe(false);
        expect(mapDataError(error), malo).toBe(mapDataError({ code: '22023', message: 'x' })); // el genérico de siempre para esa clase
        textosInternos.add((error as Error).message);
      }
      expect(textosInternos.size).toBe(1); // no depende de lo que se recibió
    });

    it('un uuid en MAYÚSCULAS sí es válido: se manda tal cual (vincular y quitar)', async () => {
      const enMayusculas = 'ABCDEF00-1111-4111-8111-00000000000B';
      h.state.responder = () => ok([]);
      await vincularGastosAViaje(enMayusculas, [G1]);
      expect(op(h.calls[0]!, 'rpc')[0]!.args[0]).toEqual({ p_viaje_id: enMayusculas, p_gasto_ids: [G1] });
      h.calls.length = 0;
      await quitarGastosDelViaje(enMayusculas, [G1]);
      expect(op(h.calls[0]!, 'eq')[0]!.args).toEqual(['viaje_id', enMayusculas]);
    });
  });

  describe('los ids de los gastos: se valida la selección ENTERA antes de juntar los repetidos y contar', () => {
    it.each(conViaje)('%s: un elemento que NO es texto (solo posible saltándose TypeScript) es «id-invalido»: sin pedido y sin TypeError', async (_nombre, escribir) => {
      const hostiles: unknown[][] = [[null], [undefined], [7], [{}], [[G1]], [{ toString: () => G1 }], [G1, null], [null, 7, {}]];
      for (const lista of hostiles) {
        const error = await capturar(escribir(VIAJE_ID, lista as string[]));
        const nombre = JSON.stringify(lista);
        expect(error, nombre).not.toBeInstanceOf(TypeError);
        expect(error, nombre).toBeInstanceOf(SeleccionDeGastosInvalidaError);
        expect((error as SeleccionDeGastosInvalidaError).motivo, nombre).toBe('id-invalido');
      }
      expect(h.calls).toHaveLength(0);
    });

    it.each(conViaje)('%s: 101 ids con uno inválido es «id-invalido» (se valida antes de contar), no «demasiados»', async (_nombre, escribir) => {
      const cien = Array.from({ length: 100 }, (_, i) => idDe(i));
      for (const lista of [[...cien, 'x'], ['x', ...cien], [...cien, ...cien, 'x']]) {
        const error = await capturar(escribir(VIAJE_ID, lista));
        expect((error as SeleccionDeGastosInvalidaError).motivo).toBe('id-invalido');
      }
      expect(h.calls).toHaveLength(0);
    });
  });
});
