import { beforeEach, describe, expect, it, vi } from 'vitest';

// A diferencia de `devoluciones-api.test.ts` (que mockea el encadenado de supabase y mira qué métodos se llamaron), acá el
// cliente es el REAL de supabase-js (`createClient`) con un `fetch` falso: lo que se verifica es la URL exacta que se
// mandaría a PostgREST. Es la única prueba que ve cómo `.order('viajes(fecha)')` y los filtros de `viajes.fecha` se
// convierten en parámetros (y que NO sale `viajes.order=`, que ordenaría solo las filas embebidas). Todo lo demás es código
// REAL del proyecto; no se hace ningún pedido de red.
const h = vi.hoisted(() => ({ pedidos: [] as Array<{ metodo: string; url: URL }>, respuesta: [] as unknown[] }));

vi.mock('@/lib/supabase', async () => {
  const { createClient } = await import('@supabase/supabase-js');
  const fetchFalso: typeof fetch = async (entrada, init) => {
    h.pedidos.push({ metodo: init?.method ?? 'GET', url: new URL(String(entrada)) });
    return new Response(JSON.stringify(h.respuesta), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const supabase = createClient('https://ejemplo.invalid', 'clave-de-prueba', {
    global: { fetch: fetchFalso },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { supabase };
});

import { fetchDevolucionesDelMes } from '@/features/devoluciones/devoluciones-api';

beforeEach(() => {
  h.pedidos.length = 0;
  h.respuesta = [];
});

describe('fetchDevolucionesDelMes: la URL que llega a PostgREST', () => {
  async function pedir(desde = '2026-09-01', hasta = '2026-10-01') {
    await fetchDevolucionesDelMes({ desde, hasta, signal: new AbortController().signal });
    expect(h.pedidos).toHaveLength(1);
    return h.pedidos[0]!;
  }

  it('GET a /devoluciones con el select de la fila, el filtro del mes sobre viajes.fecha, el orden por la fecha del viaje y 201 filas', async () => {
    const { metodo, url } = await pedir();
    expect(metodo).toBe('GET');
    expect(url.pathname).toBe('/rest/v1/devoluciones');
    expect(url.searchParams.get('select')).toBe(
      'id,motivo,descripcion,cliente_id,viaje_id,created_at,clientes(nombre),viajes!inner(fecha,origen,destino)',
    );
    expect(url.searchParams.getAll('viajes.fecha')).toEqual(['gte.2026-09-01', 'lt.2026-10-01']);
    expect(url.searchParams.get('order')).toBe('viajes(fecha).desc,created_at.desc,id.desc');
    expect(url.searchParams.get('limit')).toBe('201');
  });

  it('NO ordena la tabla embebida (viajes.order): eso solo reordenaría el viaje de cada fila, no la lista', async () => {
    const { url } = await pedir();
    expect([...url.searchParams.keys()].filter((clave) => clave.endsWith('.order'))).toEqual([]);
  });

  it('el rango del mes llega tal cual (diciembre cruza el año)', async () => {
    const { url } = await pedir('2026-12-01', '2027-01-01');
    expect(url.searchParams.getAll('viajes.fecha')).toEqual(['gte.2026-12-01', 'lt.2027-01-01']);
  });

  it('con 201 filas devueltas se queda con 200 y marca la lista como parcial', async () => {
    h.respuesta = Array.from({ length: 201 }, (_, i) => ({ id: `d-${i}` }));
    const resultado = await fetchDevolucionesDelMes({ desde: '2026-09-01', hasta: '2026-10-01', signal: new AbortController().signal });
    expect(resultado.items).toHaveLength(200);
    expect(resultado.truncado).toBe(true);
  });
});
