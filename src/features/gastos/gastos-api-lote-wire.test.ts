import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Contrato con la red de cargar VARIOS gastos de una vez. Como `gastos-api-wire.test.ts`: el cliente es el REAL de supabase-js
// (`createClient`) con un `fetch` falso que anota método, URL, cabeceras y cuerpo, así que se verifica lo que de verdad llegaría a
// PostgREST. No se hace ningún pedido de red. Todo lo demás es código REAL del proyecto (`crearGastos` y `gastoLoteWriteIO`).
type Pedido = { metodo: string; url: URL; cabeceras: Headers; cuerpo: string | null; senal: AbortSignal | null | undefined };

const h = vi.hoisted(() => ({
  pedidos: [] as Array<{ metodo: string; url: URL; cabeceras: Headers; cuerpo: string | null; senal: AbortSignal | null | undefined }>,
  respuestas: [] as Array<{ status: number; cuerpo: unknown }>,
}));

vi.mock('@/lib/supabase', async () => {
  const { createClient } = await import('@supabase/supabase-js');
  const fetchFalso: typeof fetch = async (entrada, init) => {
    h.pedidos.push({
      metodo: init?.method ?? 'GET',
      url: new URL(String(entrada)),
      cabeceras: new Headers(init?.headers),
      cuerpo: typeof init?.body === 'string' ? init.body : null,
      senal: init?.signal,
    });
    const respuesta = h.respuestas.shift() ?? { status: 201, cuerpo: null }; // un INSERT sin `select` contesta 201 y sin cuerpo
    return new Response(respuesta.cuerpo === null ? null : JSON.stringify(respuesta.cuerpo), {
      status: respuesta.status,
      headers: { 'content-type': 'application/json' },
    });
  };
  const supabase = createClient('https://ejemplo.invalid', 'clave-de-prueba', {
    global: { fetch: fetchFalso },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { supabase };
});

import { CLIENT_REF_CONSTRAINT } from '@/features/gastos/client-ref';
import { COMBUSTIBLE_CATEGORIA_ID } from '@/features/gastos/constants';
import { buildInsertRow, type GastoColumns } from '@/features/gastos/gasto-form';
import { crearGastos, type GastoParaGuardar } from '@/features/gastos/gasto-lote-save';
import { gastoLoteWriteIO } from '@/features/gastos/gastos-api';
import { DataRequestError } from '@/lib/data-errors';
import { WRITE_TIMEOUT_MS } from '@/lib/db';

const CAT_PEAJES = '2a000000-0000-4000-8000-000000000001';
const CAT_COMIDA = '2a000000-0000-4000-8000-000000000002';
const CAMION = 'c0000000-0000-4000-8000-000000000001';
const VIAJE = 'b0000000-0000-4000-8000-000000000001';
const [REF_A, REF_B, REF_C] = [
  '5a000000-0000-4000-8000-0000000000a1',
  '5a000000-0000-4000-8000-0000000000b2',
  '5a000000-0000-4000-8000-0000000000c3',
] as const;

const peaje: GastoColumns = {
  categoria_id: CAT_PEAJES,
  monto: 300,
  fecha: '2026-10-02',
  viaje_id: VIAJE,
  descripcion: null,
  metodo_pago: 'efectivo',
  litros: null,
  precio_por_litro: null,
  km_odometro: null,
  tanque_lleno: null,
  camion_id: null,
};
const combustible: GastoColumns = {
  ...peaje,
  categoria_id: COMBUSTIBLE_CATEGORIA_ID,
  monto: 40000,
  metodo_pago: 'tarjeta_credito',
  litros: 40,
  precio_por_litro: 1000,
  km_odometro: 120000,
  tanque_lleno: true,
  camion_id: CAMION,
};
const comida: GastoColumns = { ...peaje, categoria_id: CAT_COMIDA, monto: 1500, descripcion: 'Almuerzo', viaje_id: null };
const tres = (): GastoParaGuardar[] => [
  { columns: peaje, clientRef: REF_A },
  { columns: combustible, clientRef: REF_B },
  { columns: comida, clientRef: REF_C },
];

/** Lo que la base NO recibe nunca en una fila nueva: la identidad la completa un trigger y las fechas de alta, el default. */
const COLUMNAS_DE_LA_BASE = ['id', 'transportista_id', 'created_at', 'updated_at'];
const COLUMNAS_DE_UN_GASTO = [
  'categoria_id',
  'monto',
  'fecha',
  'viaje_id',
  'descripcion',
  'metodo_pago',
  'litros',
  'precio_por_litro',
  'km_odometro',
  'tanque_lleno',
  'camion_id',
  'client_ref',
];

let timeoutSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  h.pedidos.length = 0;
  h.respuestas.length = 0;
  timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
});

afterEach(() => {
  timeoutSpy.mockRestore();
});

/** Todos los parámetros de la URL, ordenados por nombre. */
const parametros = (url: URL) => [...url.searchParams.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

/** Nada de lo que viaja (URL, cuerpo, cabeceras) nombra `transportista_id`: el cliente nunca lo manda. */
function sinTransportistaId({ url, cuerpo, cabeceras }: Pedido) {
  expect([url.href, cuerpo ?? '', JSON.stringify([...cabeceras.entries()])].join('\n')).not.toContain('transportista_id');
}

function unico(): Pedido {
  expect(h.pedidos).toHaveLength(1);
  return h.pedidos[0]!;
}

const filasDelCuerpo = (pedido: Pedido) => JSON.parse(pedido.cuerpo ?? 'null') as Array<Record<string, unknown>>;

describe('gastoLoteWriteIO.insertMany: lo que viaja', () => {
  it('UN solo POST a /rest/v1/gastos con un ARREGLO de N filas en el cuerpo (una transacción), no un pedido por fila', async () => {
    const filas = tres().map(({ columns, clientRef }) => buildInsertRow(columns, clientRef));
    await gastoLoteWriteIO.insertMany(filas);

    const pedido = unico();
    expect(pedido.metodo).toBe('POST');
    expect(pedido.url.pathname).toBe('/rest/v1/gastos');
    expect(pedido.cabeceras.get('content-type')).toBe('application/json');
    const cuerpo = filasDelCuerpo(pedido);
    expect(Array.isArray(cuerpo)).toBe(true);
    expect(cuerpo).toHaveLength(3);
  });

  it('cada fila lleva SU client_ref y todas las columnas de su gasto; ninguna lleva transportista_id, id ni timestamps', async () => {
    await gastoLoteWriteIO.insertMany(tres().map(({ columns, clientRef }) => buildInsertRow(columns, clientRef)));

    const pedido = unico();
    const cuerpo = filasDelCuerpo(pedido);
    expect(cuerpo.map((fila) => fila.client_ref)).toEqual([REF_A, REF_B, REF_C]);
    expect(cuerpo[0]).toEqual({ ...peaje, client_ref: REF_A });
    expect(cuerpo[1]).toEqual({ ...combustible, client_ref: REF_B });
    expect(cuerpo[2]).toEqual({ ...comida, client_ref: REF_C });
    for (const fila of cuerpo) {
      expect(Object.keys(fila).sort()).toEqual([...COLUMNAS_DE_UN_GASTO].sort());
      for (const columna of COLUMNAS_DE_LA_BASE) expect(fila).not.toHaveProperty(columna);
    }
    sinTransportistaId(pedido);
  });

  it('aunque una fila traiga id, transportista_id o timestamps (por ejemplo, armada con un spread de una fila leída), NO viajan', async () => {
    const conDeMas = {
      ...buildInsertRow(peaje, REF_A),
      id: 'e1000000-0000-4000-8000-000000000001',
      transportista_id: 'transportista-de-prueba',
      created_at: '2026-10-02T10:00:00Z',
      updated_at: '2026-10-02T10:00:00Z',
    };
    await gastoLoteWriteIO.insertMany([conDeMas, buildInsertRow(comida, REF_B)]);

    const pedido = unico();
    for (const fila of filasDelCuerpo(pedido)) {
      for (const columna of COLUMNAS_DE_LA_BASE) expect(fila).not.toHaveProperty(columna);
    }
    sinTransportistaId(pedido);
    expect(pedido.cuerpo).not.toContain('e1000000-0000-4000-8000-000000000001');
  });

  it('SIN `select` y sin pedir que devuelva las filas (PostgREST contesta sin cuerpo): el INSERT no depende de la policy de lectura; un `tx=rollback` descartaría la escritura sin avisar', async () => {
    await gastoLoteWriteIO.insertMany(tres().map(({ columns, clientRef }) => buildInsertRow(columns, clientRef)));

    const pedido = unico();
    expect(pedido.url.searchParams.has('select')).toBe(false);
    const prefer = pedido.cabeceras.get('prefer') ?? '';
    expect(prefer).not.toContain('return=representation');
    expect(prefer).not.toContain('tx=');
    // Los únicos parámetros son los de las columnas que arma el cliente para un INSERT de varias filas.
    expect(parametros(pedido.url).map(([nombre]) => nombre)).toEqual(['columns']);
    expect(pedido.url.searchParams.get('columns')?.split(',').map((c) => c.replaceAll('"', '')).sort()).toEqual([...COLUMNAS_DE_UN_GASTO].sort());
  });

  it('es una ESCRITURA: lleva el timeout de escritura (20 s) y no la señal de una lectura', async () => {
    await gastoLoteWriteIO.insertMany([buildInsertRow(peaje, REF_A)]);

    expect(timeoutSpy).toHaveBeenCalledTimes(1);
    expect(timeoutSpy).toHaveBeenCalledWith(WRITE_TIMEOUT_MS);
    expect(WRITE_TIMEOUT_MS).toBe(20_000);
    expect(unico().senal).toBeInstanceOf(AbortSignal);
  });

  it('una respuesta de error de la base se convierte en DataRequestError con su code (unwrap): no se toma como éxito', async () => {
    h.respuestas.push({ status: 409, cuerpo: { code: '23503', message: 'violates foreign key constraint "gastos_viaje_fk"', details: null, hint: null } });
    const error = await gastoLoteWriteIO.insertMany([buildInsertRow(peaje, REF_A)]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DataRequestError);
    expect((error as DataRequestError).code).toBe('23503');
  });
});

describe('gastoLoteWriteIO.updateByClientRef: es el mismo UPDATE de un gasto solo', () => {
  it('PATCH a /gastos filtrado por client_ref (eq), con select=id y SIN client_ref, id ni transportista_id en el cuerpo', async () => {
    h.respuestas.push({ status: 200, cuerpo: [{ id: 'e1000000-0000-4000-8000-000000000001' }] });
    // Aunque se le pase el client_ref adentro (un error de programación), nunca viaja en el UPDATE: es inmutable.
    await gastoLoteWriteIO.updateByClientRef(REF_A, { ...peaje, client_ref: REF_A } as never);

    const pedido = unico();
    expect(pedido.metodo).toBe('PATCH');
    expect(pedido.url.pathname).toBe('/rest/v1/gastos');
    expect(parametros(pedido.url)).toEqual([
      ['client_ref', `eq.${REF_A}`],
      ['select', 'id'],
    ]);
    expect(JSON.parse(pedido.cuerpo ?? 'null')).toEqual(peaje);
    expect(pedido.cuerpo).not.toContain('client_ref');
    sinTransportistaId(pedido);
  });

  it('sin filas afectadas tira RecordNotFoundError', async () => {
    h.respuestas.push({ status: 200, cuerpo: [] });
    await expect(gastoLoteWriteIO.updateByClientRef(REF_A, peaje)).rejects.toMatchObject({ name: 'RecordNotFoundError' });
  });
});

describe('crearGastos con el cliente real: el recorrido completo por la red', () => {
  it('«creados»: UN solo POST con las N filas', async () => {
    await expect(crearGastos({ items: tres(), sent: new Set(), io: gastoLoteWriteIO })).resolves.toBe('creados');
    const pedido = unico();
    expect(pedido.metodo).toBe('POST');
    expect(filasDelCuerpo(pedido)).toHaveLength(3);
    sinTransportistaId(pedido);
  });

  it('el 23505 real del client_ref (lo que contesta PostgREST) se reconoce -> «ya-guardados», con un solo POST y ningún PATCH', async () => {
    h.respuestas.push({
      status: 409,
      cuerpo: { code: '23505', message: `duplicate key value violates unique constraint "${CLIENT_REF_CONSTRAINT}"`, details: null, hint: null },
    });
    await expect(crearGastos({ items: tres(), sent: new Set(), io: gastoLoteWriteIO })).resolves.toBe('ya-guardados');
    expect(h.pedidos.map((p) => p.metodo)).toEqual(['POST']);
  });

  it('respuesta perdida y reintento con datos cambiados: POST, POST (23505) y un PATCH por CADA gasto, cada uno por su client_ref y sin client_ref en el cuerpo', async () => {
    const sent = new Set<string>();
    h.respuestas.push({ status: 504, cuerpo: { message: 'gateway timeout' } }); // sin respuesta útil: el primero pudo llegar
    await expect(crearGastos({ items: tres(), sent, io: gastoLoteWriteIO })).rejects.toBeInstanceOf(DataRequestError);

    h.respuestas.push({
      status: 409,
      cuerpo: { code: '23505', message: `duplicate key value violates unique constraint "${CLIENT_REF_CONSTRAINT}"`, details: null, hint: null },
    });
    h.respuestas.push({ status: 200, cuerpo: [{ id: 'e1000000-0000-4000-8000-000000000001' }] });
    h.respuestas.push({ status: 200, cuerpo: [{ id: 'e1000000-0000-4000-8000-000000000002' }] });
    h.respuestas.push({ status: 200, cuerpo: [{ id: 'e1000000-0000-4000-8000-000000000003' }] });
    const cambiados = [{ columns: { ...peaje, monto: 350 }, clientRef: REF_A }, ...tres().slice(1)];
    await expect(crearGastos({ items: cambiados, sent, io: gastoLoteWriteIO })).resolves.toBe('ya-guardados-actualizados');

    expect(h.pedidos.map((p) => p.metodo)).toEqual(['POST', 'POST', 'PATCH', 'PATCH', 'PATCH']);
    // Los dos POST llevan los MISMOS client_ref.
    expect(filasDelCuerpo(h.pedidos[0]!).map((f) => f.client_ref)).toEqual([REF_A, REF_B, REF_C]);
    expect(filasDelCuerpo(h.pedidos[1]!).map((f) => f.client_ref)).toEqual([REF_A, REF_B, REF_C]);
    const parches = h.pedidos.slice(2);
    expect(parches.map((p) => p.url.searchParams.get('client_ref'))).toEqual([`eq.${REF_A}`, `eq.${REF_B}`, `eq.${REF_C}`]);
    expect(JSON.parse(parches[0]!.cuerpo ?? 'null')).toEqual({ ...peaje, monto: 350 });
    for (const parche of parches) {
      expect(parche.cuerpo).not.toContain('client_ref');
      sinTransportistaId(parche);
    }
  });

  it('un conjunto de client_ref distinto tras un intento sin confirmar no sale a la red: no hay ningún pedido nuevo', async () => {
    const sent = new Set<string>();
    h.respuestas.push({ status: 504, cuerpo: { message: 'gateway timeout' } });
    await expect(crearGastos({ items: tres(), sent, io: gastoLoteWriteIO })).rejects.toBeInstanceOf(DataRequestError);
    expect(h.pedidos).toHaveLength(1);

    await expect(crearGastos({ items: tres().slice(0, 2), sent, io: gastoLoteWriteIO })).rejects.toMatchObject({ name: 'LoteDeGastosDistintoError' });
    expect(h.pedidos).toHaveLength(1);
  });

  it('una carga vacía no sale a la red', async () => {
    await expect(crearGastos({ items: [], sent: new Set(), io: gastoLoteWriteIO })).rejects.toMatchObject({ name: 'LoteDeGastosInvalidoError' });
    expect(h.pedidos).toEqual([]);
  });
});
