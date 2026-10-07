import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import type { Database } from '@/lib/database.types';
import { DataRequestError, mapDataError } from '@/lib/data-errors';
import { GUARDAR_VIAJE_CONTEXT } from '@/features/viajes/constants';
import type { ViajeDatos } from '@/features/viajes/viaje-form';
import {
  actualizarViaje,
  buildActualizarArgs,
  buildCrearArgs,
  buildEntregasPayload,
  crearViaje,
  fingerprintOf,
  type ActualizarViajeArgs,
  type CrearViajeArgs,
  type ViajeWriteIO,
} from '@/features/viajes/viaje-save';

const CLIENTE_A = '11111111-1111-4111-8111-111111111111';
const CLIENTE_B = '22222222-2222-4222-8222-222222222222';
const VIAJE_ID = '33333333-3333-4333-8333-333333333333';
const CAMION_ID = '44444444-4444-4444-8444-444444444444';
const REF = '55555555-5555-4555-8555-555555555555';

const datos = (over: Partial<ViajeDatos['columns']> = {}, entregas: ViajeDatos['entregas'] = []): ViajeDatos => ({
  columns: {
    fecha: '2026-10-02',
    origen: 'Rosario',
    destino: 'Córdoba',
    camion_id: null,
    km_inicial: null,
    km_final: null,
    km_recorridos: null,
    observaciones: null,
    ingreso: null,
    ...over,
  },
  entregas,
});

/** IO de prueba: `crear` y `actualizar` programables. */
function fakeIO(crear?: ViajeWriteIO['crear'], actualizar?: ViajeWriteIO['actualizar']) {
  const crearFn = vi.fn<ViajeWriteIO['crear']>(crear ?? (async () => ({ viajeId: VIAJE_ID, creado: true })));
  const actualizarFn = vi.fn<ViajeWriteIO['actualizar']>(actualizar ?? (async () => undefined));
  const io: ViajeWriteIO = { crear: crearFn, actualizar: actualizarFn };
  return { io, crear: crearFn, actualizar: actualizarFn };
}

const redCaida = () => new DataRequestError({ message: 'TypeError: Failed to fetch', code: '' });

// ---------------------------------------------------------------------------
// Armado de los argumentos
// ---------------------------------------------------------------------------
describe('buildEntregasPayload', () => {
  it('las nuevas van SIN la clave id; las existentes, con su id; el orden de carga se conserva', () => {
    const payload = buildEntregasPayload([
      { id: 'e-1', cliente_id: CLIENTE_B, incidencias: 'Golpe' },
      { id: null, cliente_id: CLIENTE_A, incidencias: null },
      { id: 'e-3', cliente_id: CLIENTE_A, incidencias: null },
    ]);
    expect(payload).toEqual([
      { id: 'e-1', cliente_id: CLIENTE_B, incidencias: 'Golpe' },
      { cliente_id: CLIENTE_A, incidencias: null },
      { id: 'e-3', cliente_id: CLIENTE_A, incidencias: null },
    ]);
    expect('id' in payload[1]!).toBe(false);
  });

  it('sin entregas -> lista vacía (no null): la base exige una lista', () => {
    expect(buildEntregasPayload([])).toEqual([]);
  });

  it('las incidencias vacías van en null (no como texto vacío)', () => {
    expect(buildEntregasPayload([{ id: null, cliente_id: CLIENTE_A, incidencias: null }])[0]!.incidencias).toBeNull();
  });
});

describe('buildCrearArgs', () => {
  it('manda exactamente los parámetros del alta, con null explícito para lo vacío', () => {
    const args = buildCrearArgs(datos(), REF);
    expect(args).toEqual({
      p_client_ref: REF,
      p_fecha: '2026-10-02',
      p_origen: 'Rosario',
      p_destino: 'Córdoba',
      p_camion_id: null,
      p_km_inicial: null,
      p_km_final: null,
      p_km_recorridos: null,
      p_observaciones: null,
      p_ingreso: null,
      p_entregas: [],
    });
    for (const clave of ['p_km_inicial', 'p_km_final', 'p_km_recorridos', 'p_observaciones', 'p_ingreso', 'p_camion_id']) {
      expect(args).toHaveProperty(clave, null);
    }
  });

  it('manda el p_camion_id que resolvió el formulario (null sin camión, explícito); nunca transportista_id ni id del viaje', () => {
    const args = buildCrearArgs(datos(), REF);
    expect(Object.prototype.hasOwnProperty.call(args, 'p_camion_id')).toBe(true);
    expect(args.p_camion_id).toBeNull();
    expect(buildCrearArgs(datos({ camion_id: CAMION_ID }), REF).p_camion_id).toBe(CAMION_ID);
    expect(Object.keys(args)).not.toContain('p_viaje_id');
    expect(JSON.stringify(args)).not.toContain('transportista');
  });

  it('con valores: los números y textos van tal cual; las entregas, sin id aunque vengan con él', () => {
    const args = buildCrearArgs(
      datos(
        { km_inicial: 1200, km_final: 1850.5, observaciones: 'Llegó tarde', ingreso: 0 },
        [
          { id: 'e-viejo', cliente_id: CLIENTE_A, incidencias: 'x' },
          { id: null, cliente_id: CLIENTE_B, incidencias: null },
        ],
      ),
      REF,
    );
    expect(args.p_km_inicial).toBe(1200);
    expect(args.p_km_final).toBe(1850.5);
    expect(args.p_ingreso).toBe(0); // 0 no es "vacío"
    expect(args.p_observaciones).toBe('Llegó tarde');
    expect(args.p_entregas).toEqual([
      { cliente_id: CLIENTE_A, incidencias: 'x' },
      { cliente_id: CLIENTE_B, incidencias: null },
    ]);
    expect(args.p_entregas.some((e) => 'id' in e)).toBe(false);
  });

  it('modo recorridos: km_recorridos con inicial y final en null', () => {
    const args = buildCrearArgs(datos({ km_recorridos: 640.5 }), REF);
    expect([args.p_km_inicial, args.p_km_final, args.p_km_recorridos]).toEqual([null, null, 640.5]);
  });
});

describe('buildActualizarArgs', () => {
  const COLUMNAS_ESPERADAS = [
    'p_camion_id',
    'p_destino',
    'p_entregas',
    'p_fecha',
    'p_ingreso',
    'p_km_final',
    'p_km_inicial',
    'p_km_recorridos',
    'p_observaciones',
    'p_origen',
    'p_viaje_id',
  ];

  it('manda los 11 parámetros (reemplazo completo), todos presentes aunque sean null', () => {
    const args = buildActualizarArgs(VIAJE_ID, datos());
    expect(Object.keys(args).sort()).toEqual(COLUMNAS_ESPERADAS);
    expect(args).toEqual({
      p_viaje_id: VIAJE_ID,
      p_fecha: '2026-10-02',
      p_origen: 'Rosario',
      p_destino: 'Córdoba',
      p_camion_id: null,
      p_km_inicial: null,
      p_km_final: null,
      p_km_recorridos: null,
      p_observaciones: null,
      p_ingreso: null,
      p_entregas: [],
    });
  });

  it('manda el camion_id del FORMULARIO (el que ya tenía o el elegido) y también el null', () => {
    expect(buildActualizarArgs(VIAJE_ID, datos({ camion_id: CAMION_ID })).p_camion_id).toBe(CAMION_ID);
    expect(buildActualizarArgs(VIAJE_ID, datos()).p_camion_id).toBeNull();
  });

  it('las entregas existentes van con su id, las nuevas sin id; las quitadas simplemente no vienen', () => {
    const args = buildActualizarArgs(
      VIAJE_ID,
      datos({ camion_id: CAMION_ID }, [
        { id: 'e-2', cliente_id: CLIENTE_A, incidencias: 'Cambió' }, // existente (la e-1 se quitó: no viene)
        { id: null, cliente_id: CLIENTE_B, incidencias: null }, // nueva
      ]),
    );
    expect(args.p_entregas).toEqual([
      { id: 'e-2', cliente_id: CLIENTE_A, incidencias: 'Cambió' },
      { cliente_id: CLIENTE_B, incidencias: null },
    ]);
    expect(args.p_entregas.map((e) => e.id)).not.toContain('e-1');
  });

  it('para vaciar un campo manda null explícito (no lo omite)', () => {
    const args = buildActualizarArgs(VIAJE_ID, datos({ km_inicial: null, ingreso: null, observaciones: null }));
    for (const clave of ['p_km_inicial', 'p_ingreso', 'p_observaciones', 'p_camion_id']) {
      expect(Object.prototype.hasOwnProperty.call(args, clave)).toBe(true);
      expect((args as unknown as Record<string, unknown>)[clave]).toBeNull();
    }
  });
});

describe('tipos a mano vs tipos generados (comprobación de compilación)', () => {
  type Funciones = Database['public']['Functions'];

  it('las claves de actualizar y de crear coinciden con las que generó Supabase (si la base cambia, esto deja de compilar)', () => {
    expectTypeOf<keyof ActualizarViajeArgs>().toEqualTypeOf<keyof Funciones['actualizar_viaje_con_entregas']['Args']>();
    // Desde la Etapa 5 el alta también manda p_camion_id: las claves son exactamente las generadas.
    expectTypeOf<keyof CrearViajeArgs>().toEqualTypeOf<keyof Funciones['crear_viaje_con_entregas']['Args']>();
    expect(true).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Huella de reintento
// ---------------------------------------------------------------------------
describe('fingerprintOf', () => {
  const entregas = [
    { id: null, cliente_id: CLIENTE_A, incidencias: 'x' },
    { id: null, cliente_id: CLIENTE_B, incidencias: null },
  ];

  it('mismos datos -> misma huella', () => {
    expect(fingerprintOf(datos({}, entregas))).toBe(fingerprintOf(datos({}, entregas.map((e) => ({ ...e })))));
  });

  it('cualquier cambio en lo que se manda cambia la huella', () => {
    const original = fingerprintOf(datos({}, entregas));
    const cambios: Array<ViajeDatos> = [
      datos({ fecha: '2026-10-01' }, entregas),
      datos({ origen: 'Rosarioo' }, entregas),
      datos({ destino: 'Salta' }, entregas),
      datos({ camion_id: CAMION_ID }, entregas), // otro camión
      datos({ km_inicial: 1 }, entregas),
      datos({ km_final: 1 }, entregas),
      datos({ km_recorridos: 1 }, entregas),
      datos({ observaciones: 'x' }, entregas),
      datos({ ingreso: 0 }, entregas),
      datos({}, entregas.slice(0, 1)), // una entrega menos
      datos({}, [...entregas].reverse()), // otro orden
      datos({}, [{ ...entregas[0]!, incidencias: 'y' }, entregas[1]!]), // otra incidencia
      datos({}, [{ ...entregas[0]!, cliente_id: CLIENTE_B }, entregas[1]!]), // otro cliente
      datos({}, [...entregas, { id: null, cliente_id: CLIENTE_A, incidencias: null }]), // una entrega más
    ];
    for (const [i, cambio] of cambios.entries()) expect(fingerprintOf(cambio), `cambio ${i}`).not.toBe(original);
  });

  it('null (vacío) y 0 no se confunden; tampoco "" con null', () => {
    expect(fingerprintOf(datos({ ingreso: 0 }))).not.toBe(fingerprintOf(datos({ ingreso: null })));
    expect(fingerprintOf(datos({ observaciones: '' }))).not.toBe(fingerprintOf(datos({ observaciones: null })));
  });
});

// ---------------------------------------------------------------------------
// Flujo de crearViaje (IO inyectado)
// ---------------------------------------------------------------------------
describe('crearViaje', () => {
  it('creado = true -> "creado": una sola llamada a crear, con el client_ref; no actualiza', async () => {
    const { io, crear, actualizar } = fakeIO();
    const sent = new Set<string>();
    const r = await crearViaje({ datos: datos({ ingreso: 500 }), clientRef: REF, sent, io });
    expect(r).toBe('creado');
    expect(crear).toHaveBeenCalledTimes(1);
    expect(crear.mock.calls[0]![0].p_client_ref).toBe(REF);
    expect(crear.mock.calls[0]![0].p_ingreso).toBe(500);
    expect(actualizar).not.toHaveBeenCalled();
    expect(sent.size).toBe(1);
  });

  it('creado = false con lo MISMO que se mandó -> "ya-guardado" (éxito, no error) y NO actualiza', async () => {
    const { io, crear, actualizar } = fakeIO(async () => ({ viajeId: VIAJE_ID, creado: false }));
    const r = await crearViaje({ datos: datos(), clientRef: REF, sent: new Set(), io });
    expect(r).toBe('ya-guardado');
    expect(crear).toHaveBeenCalledTimes(1);
    expect(actualizar).not.toHaveBeenCalled();
  });

  it('respuesta perdida y reintento SIN cambios: 1er intento falla por red, el 2º devuelve creado = false -> "ya-guardado"', async () => {
    let intento = 0;
    const { io, crear, actualizar } = fakeIO(async () => {
      intento += 1;
      if (intento === 1) throw redCaida(); // el pedido llegó a la base pero se perdió la respuesta
      return { viajeId: VIAJE_ID, creado: false };
    });
    const sent = new Set<string>();
    const mismo = datos({ origen: 'Rosario' }, [{ id: null, cliente_id: CLIENTE_A, incidencias: null }]);

    await expect(crearViaje({ datos: mismo, clientRef: REF, sent, io })).rejects.toThrow();
    const r = await crearViaje({ datos: mismo, clientRef: REF, sent, io });
    expect(r).toBe('ya-guardado');
    expect(actualizar).not.toHaveBeenCalled();
    // Los dos intentos usaron el MISMO client_ref.
    expect(crear.mock.calls.map((c) => c[0].p_client_ref)).toEqual([REF, REF]);
  });

  it('creado = false pero el usuario CAMBIÓ datos entre intentos -> actualiza el viaje con lo que hay en pantalla', async () => {
    let intento = 0;
    const { io, crear, actualizar } = fakeIO(async () => {
      intento += 1;
      if (intento === 1) throw redCaida();
      return { viajeId: VIAJE_ID, creado: false };
    });
    const sent = new Set<string>();
    const A = datos({ origen: 'Rosario' }, [{ id: null, cliente_id: CLIENTE_A, incidencias: null }]);
    const B = datos({ origen: 'San Lorenzo', km_inicial: 10 }, [
      { id: null, cliente_id: CLIENTE_B, incidencias: 'Golpe' },
      { id: null, cliente_id: CLIENTE_A, incidencias: null },
    ]);

    await expect(crearViaje({ datos: A, clientRef: REF, sent, io })).rejects.toThrow();
    const r = await crearViaje({ datos: B, clientRef: REF, sent, io });

    expect(r).toBe('ya-guardado-actualizado');
    expect(crear).toHaveBeenCalledTimes(2);
    expect(actualizar).toHaveBeenCalledTimes(1);
    const args = actualizar.mock.calls[0]![0];
    expect(args.p_viaje_id).toBe(VIAJE_ID);
    expect(args.p_origen).toBe('San Lorenzo');
    expect(args.p_km_inicial).toBe(10);
    expect(args.p_camion_id).toBeNull(); // B no tiene camión: lo que hay en pantalla
    // Entregas sin id: la función borra las que no vengan y crea las nuevas; el resultado queda igual a lo que se ve.
    expect(args.p_entregas).toEqual([
      { cliente_id: CLIENTE_B, incidencias: 'Golpe' },
      { cliente_id: CLIENTE_A, incidencias: null },
    ]);
  });

  it('BUG LATENTE corregido: ya guardado y con cambios, la actualización lleva el camión del FORMULARIO (no null, que lo borraría)', async () => {
    let intento = 0;
    const { io, actualizar } = fakeIO(async () => {
      intento += 1;
      if (intento === 1) throw redCaida();
      return { viajeId: VIAJE_ID, creado: false };
    });
    const sent = new Set<string>();
    await expect(crearViaje({ datos: datos({ camion_id: CAMION_ID }), clientRef: REF, sent, io })).rejects.toThrow();
    const r = await crearViaje({ datos: datos({ camion_id: CAMION_ID, origen: 'San Lorenzo' }), clientRef: REF, sent, io });
    expect(r).toBe('ya-guardado-actualizado');
    expect(actualizar.mock.calls[0]![0].p_camion_id).toBe(CAMION_ID);
  });

  it('cambiar SOLO el camión entre intentos también cuenta como cambio: actualiza con el camión nuevo', async () => {
    let intento = 0;
    const { io, actualizar } = fakeIO(async () => {
      intento += 1;
      if (intento === 1) throw redCaida();
      return { viajeId: VIAJE_ID, creado: false };
    });
    const sent = new Set<string>();
    await expect(crearViaje({ datos: datos(), clientRef: REF, sent, io })).rejects.toThrow();
    expect(await crearViaje({ datos: datos({ camion_id: CAMION_ID }), clientRef: REF, sent, io })).toBe('ya-guardado-actualizado');
    expect(actualizar.mock.calls[0]![0].p_camion_id).toBe(CAMION_ID);
  });

  it('el alta manda el camión en crear_viaje_con_entregas', async () => {
    const { io, crear } = fakeIO();
    await crearViaje({ datos: datos({ camion_id: CAMION_ID }), clientRef: REF, sent: new Set(), io });
    expect(crear.mock.calls[0]![0].p_camion_id).toBe(CAMION_ID);
  });

  it('1er intento falla con A, el usuario cambia a B y el 2º CREA (la base no tenía A): "creado", sin actualizar', async () => {
    let intento = 0;
    const { io, actualizar } = fakeIO(async () => {
      intento += 1;
      if (intento === 1) throw redCaida();
      return { viajeId: VIAJE_ID, creado: true };
    });
    const sent = new Set<string>();
    await expect(crearViaje({ datos: datos({ origen: 'A' }), clientRef: REF, sent, io })).rejects.toThrow();
    expect(await crearViaje({ datos: datos({ origen: 'B' }), clientRef: REF, sent, io })).toBe('creado');
    expect(actualizar).not.toHaveBeenCalled();
  });

  it('si la actualización falla (red), el próximo reintento vuelve a actualizar en vez de dar por bueno un estado sin confirmar', async () => {
    let llamadasActualizar = 0;
    const { io, actualizar } = fakeIO(
      async () => ({ viajeId: VIAJE_ID, creado: false }),
      async () => {
        llamadasActualizar += 1;
        if (llamadasActualizar === 1) throw redCaida();
      },
    );
    const sent = new Set<string>([fingerprintOf(datos({ origen: 'A' }))]); // un intento previo mandó A
    const B = datos({ origen: 'B' });
    await expect(crearViaje({ datos: B, clientRef: REF, sent, io })).rejects.toThrow();
    // Reintento con los mismos datos B: sent = {A, B} -> no es "lo mismo que todo lo enviado": actualiza otra vez.
    expect(await crearViaje({ datos: B, clientRef: REF, sent, io })).toBe('ya-guardado-actualizado');
    expect(actualizar).toHaveBeenCalledTimes(2);
  });

  it('un error de la base se propaga TAL CUAL (con su code) para que se traduzca; no se interpreta como "ya guardado"', async () => {
    for (const code of ['23503', '22023', '23514', '42501', '22003', '23502']) {
      const error = new DataRequestError({ message: `falla ${code}`, code }, 400);
      const { io, actualizar } = fakeIO(async () => {
        throw error;
      });
      await expect(crearViaje({ datos: datos(), clientRef: REF, sent: new Set(), io })).rejects.toBe(error);
      expect(actualizar).not.toHaveBeenCalled();
    }
  });

  it('nunca sale un 23505 de un alta repetida: aunque la base lo devolviera, se propaga como error normal (sin upsert ni parche)', async () => {
    const error = new DataRequestError({ message: 'duplicate key value violates unique constraint "viajes_transportista_client_ref_uidx"', code: '23505' }, 409);
    const { io } = fakeIO(async () => {
      throw error;
    });
    await expect(crearViaje({ datos: datos(), clientRef: REF, sent: new Set(), io })).rejects.toBe(error);
  });
});

describe('actualizarViaje', () => {
  it('reemplazo completo: pasa el camion_id del formulario y las entregas con/sin id', async () => {
    const { io, actualizar } = fakeIO();
    await actualizarViaje({
      viajeId: VIAJE_ID,
      datos: datos({ ingreso: 100, camion_id: CAMION_ID }, [
        { id: 'e-1', cliente_id: CLIENTE_A, incidencias: null },
        { id: null, cliente_id: CLIENTE_B, incidencias: 'Nueva' },
      ]),
      io,
    });
    expect(actualizar).toHaveBeenCalledTimes(1);
    const args = actualizar.mock.calls[0]![0];
    expect(args.p_viaje_id).toBe(VIAJE_ID);
    expect(args.p_camion_id).toBe(CAMION_ID);
    expect(args.p_ingreso).toBe(100);
    expect(args.p_entregas).toEqual([
      { id: 'e-1', cliente_id: CLIENTE_A, incidencias: null },
      { cliente_id: CLIENTE_B, incidencias: 'Nueva' },
    ]);
  });

  it('un viaje sin camión se actualiza con p_camion_id = null', async () => {
    const { io, actualizar } = fakeIO();
    await actualizarViaje({ viajeId: VIAJE_ID, datos: datos(), io });
    expect(actualizar.mock.calls[0]![0].p_camion_id).toBeNull();
  });

  it('propaga el error (P0002: el viaje cambió o ya no existe) y se traduce a un mensaje sin nombres internos', async () => {
    const error = new DataRequestError({ message: 'No se encontró el viaje', code: 'P0002' }, 400);
    const { io } = fakeIO(undefined, async () => {
      throw error;
    });
    await expect(actualizarViaje({ viajeId: VIAJE_ID, datos: datos(), io })).rejects.toBe(error);
    expect(mapDataError(error, GUARDAR_VIAJE_CONTEXT)).toBe('El viaje cambió o ya no existe. Vuelve a la lista y actualízala.');
  });
});
