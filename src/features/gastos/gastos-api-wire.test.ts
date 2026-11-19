import { beforeEach, describe, expect, it, vi } from 'vitest';

// Contrato con la red de «Sumar gastos que ya cargué» y «Quitar del viaje». `gastos-api.test.ts` usa un Proxy que anota los
// métodos que se encadenan, así que no ve lo que de verdad viaja. Acá el cliente es el REAL de supabase-js (`createClient`) con un
// `fetch` falso que anota método, URL, cabeceras y cuerpo: lo que se verifica es lo que llegaría a PostgREST. No se hace ningún
// pedido de red (mismo recurso que `devoluciones-mes-url.test.ts`). Todo lo demás es código REAL del proyecto.
type Pedido = { metodo: string; url: URL; cabeceras: Headers; cuerpo: string | null };

const h = vi.hoisted(() => ({ pedidos: [] as Array<{ metodo: string; url: URL; cabeceras: Headers; cuerpo: string | null }>, respuesta: [] as unknown }));

vi.mock('@/lib/supabase', async () => {
  const { createClient } = await import('@supabase/supabase-js');
  const fetchFalso: typeof fetch = async (entrada, init) => {
    h.pedidos.push({
      metodo: init?.method ?? 'GET',
      url: new URL(String(entrada)),
      cabeceras: new Headers(init?.headers),
      cuerpo: typeof init?.body === 'string' ? init.body : null,
    });
    return new Response(JSON.stringify(h.respuesta), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const supabase = createClient('https://ejemplo.invalid', 'clave-de-prueba', {
    global: { fetch: fetchFalso },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { supabase };
});

import { fetchGastosDelRango, fetchGastosDelViaje, fetchGastosSueltos, quitarGastosDelViaje, vincularGastosAViaje } from '@/features/gastos/gastos-api';

const VIAJE = '33333333-3333-4333-8333-333333333333';
const [G1, G2, G3] = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003'];
const FECHA = '2026-06-15';
/** Las columnas de una fila de gasto: sin `transportista_id` (la base lo completa y lo filtra con la RLS) y sin el embed del viaje. */
const COLUMNAS_DE_LA_FILA = 'id,categoria_id,fecha,monto,descripcion,litros,camion_id,created_at';

beforeEach(() => {
  h.pedidos.length = 0;
  h.respuesta = [];
});

/** Todos los parámetros de la URL, ordenados por nombre: el conjunto EXACTO, sin que importe en qué orden se encadenaron. */
const parametros = (url: URL) => [...url.searchParams.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

/** Nada de lo que viaja (URL, cuerpo, cabeceras) nombra `transportista_id`: el cliente nunca lo manda. */
function sinTransportistaId({ url, cuerpo, cabeceras }: Pedido) {
  expect([url.href, cuerpo ?? '', JSON.stringify([...cabeceras.entries()])].join('\n')).not.toContain('transportista_id');
}

function unico(): Pedido {
  expect(h.pedidos).toHaveLength(1);
  return h.pedidos[0]!;
}

describe('quitarGastosDelViaje: lo que viaja', () => {
  it('PATCH a /gastos de los ids pedidos Y de ESTE viaje, con select=id, devolviendo las filas y el cuerpo {"viaje_id":null}', async () => {
    h.respuesta = [{ id: G1 }, { id: G2 }];
    await expect(quitarGastosDelViaje(VIAJE, [G1, G2, G3])).resolves.toEqual([G1, G2]);

    const pedido = unico();
    expect(pedido.metodo).toBe('PATCH');
    expect(pedido.url.pathname).toBe('/rest/v1/gastos');
    expect(parametros(pedido.url)).toEqual([
      ['id', `in.(${G1},${G2},${G3})`],
      ['select', 'id'],
      ['viaje_id', `eq.${VIAJE}`], // solo los de ESTE viaje: uno de otro viaje no se toca
    ]);
    // Exactamente eso y nada más: un `tx=rollback` descartaría la escritura sin avisar.
    expect(pedido.cabeceras.get('prefer')).toBe('return=representation');
    expect(pedido.cabeceras.get('content-type')).toBe('application/json');
    expect(pedido.cuerpo).toBe('{"viaje_id":null}'); // null EXPLÍCITO y ninguna otra columna
    sinTransportistaId(pedido);
  });
});

describe('vincularGastosAViaje: lo que viaja', () => {
  it('POST a /rpc/vincular_gastos_a_viaje con SOLO p_viaje_id y p_gasto_ids (sin repetir) en el cuerpo, y nada en la URL', async () => {
    h.respuesta = [
      { gasto_id: G2, resultado: 'vinculado' },
      { gasto_id: G1, resultado: 'ya_estaba' },
    ];
    await expect(vincularGastosAViaje(VIAJE, [G2, G1, G2])).resolves.toEqual([
      { gastoId: G2, resultado: 'vinculado' },
      { gastoId: G1, resultado: 'ya_estaba' },
    ]);

    const pedido = unico();
    expect(pedido.metodo).toBe('POST');
    expect(pedido.url.pathname).toBe('/rest/v1/rpc/vincular_gastos_a_viaje');
    expect(parametros(pedido.url)).toEqual([]);
    expect(pedido.cabeceras.get('content-type')).toBe('application/json');
    expect(JSON.parse(pedido.cuerpo ?? 'null')).toEqual({ p_viaje_id: VIAJE, p_gasto_ids: [G2, G1] });
    sinTransportistaId(pedido);
  });
});

describe('fetchGastosDelRango y fetchGastosDelViaje: el orden que viaja', () => {
  // El `id` va al final como desempate: los gastos que se cargan juntos (un solo INSERT) comparten fecha y created_at.
  const ORDEN = 'fecha.desc,created_at.desc,id.asc';
  const signal = () => new AbortController().signal;

  it('fetchGastosDelRango: GET a /gastos con order=fecha.desc,created_at.desc,id.asc, el rango de fechas y 501 filas', async () => {
    await fetchGastosDelRango({ desde: '2026-06-01', hasta: '2026-07-01', categoriaId: null, signal: signal() });

    const pedido = unico();
    expect(pedido.metodo).toBe('GET');
    expect(pedido.url.pathname).toBe('/rest/v1/gastos');
    expect(pedido.url.searchParams.get('order')).toBe(ORDEN);
    expect(pedido.url.searchParams.get('limit')).toBe('501'); // LIST_LIMIT + 1: el de más dice si se alcanzó el tope
    expect(pedido.url.searchParams.getAll('fecha')).toEqual(['gte.2026-06-01', 'lt.2026-07-01']);
    sinTransportistaId(pedido);
  });

  it('fetchGastosDelViaje: GET a /gastos de ESE viaje con order=fecha.desc,created_at.desc,id.asc y 501 filas', async () => {
    await fetchGastosDelViaje(VIAJE, signal());

    const pedido = unico();
    expect(pedido.metodo).toBe('GET');
    expect(pedido.url.pathname).toBe('/rest/v1/gastos');
    expect(pedido.url.searchParams.get('viaje_id')).toBe(`eq.${VIAJE}`);
    expect(pedido.url.searchParams.get('order')).toBe(ORDEN);
    expect(pedido.url.searchParams.get('limit')).toBe('501');
    sinTransportistaId(pedido);
  });
});

describe('fetchGastosSueltos: lo que viaja', () => {
  it('DOS GET a /gastos de los gastos sin viaje: desde la fecha del viaje (fecha ascendente) y antes (fecha descendente), 101 filas cada uno', async () => {
    await fetchGastosSueltos({ fechaViaje: FECHA, signal: new AbortController().signal });
    expect(h.pedidos).toHaveLength(2);

    // Cuál es cuál se reconoce por su filtro de fecha, no por el orden de llegada: salen a la vez.
    const delLado = (operador: 'gte' | 'lt') => h.pedidos.filter((p) => p.url.searchParams.get('fecha')?.startsWith(`${operador}.`));
    expect(delLado('gte')).toHaveLength(1);
    expect(delLado('lt')).toHaveLength(1);
    const [desde] = delLado('gte');
    const [antes] = delLado('lt');

    for (const pedido of h.pedidos) {
      expect(pedido.metodo).toBe('GET');
      expect(pedido.url.pathname).toBe('/rest/v1/gastos');
      sinTransportistaId(pedido);
    }
    expect(parametros(desde!.url)).toEqual([
      ['fecha', `gte.${FECHA}`],
      ['limit', '101'], // MAX_GASTOS_POR_VEZ + 1: el de más dice si había más
      ['order', 'fecha.asc,created_at.desc,id.asc'],
      ['select', COLUMNAS_DE_LA_FILA],
      ['viaje_id', 'is.null'],
    ]);
    expect(parametros(antes!.url)).toEqual([
      ['fecha', `lt.${FECHA}`],
      ['limit', '101'],
      ['order', 'fecha.desc,created_at.desc,id.asc'],
      ['select', COLUMNAS_DE_LA_FILA],
      ['viaje_id', 'is.null'],
    ]);
  });
});
