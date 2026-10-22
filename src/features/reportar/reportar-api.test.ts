import { beforeEach, describe, expect, it, vi } from 'vitest';

// La capa de datos del reporte contra un supabase falso que REGISTRA cada método que se llama: así se ve qué se manda y
// que nunca se pide leer la tabla.
const h = vi.hoisted(() => {
  const llamadas: Array<{ tabla: string; ops: Array<{ m: string; args: unknown[] }> }> = [];
  const estado = { respuesta: { error: null as unknown, status: 201 } };
  function from(tabla: string) {
    const llamada = { tabla, ops: [] as Array<{ m: string; args: unknown[] }> };
    llamadas.push(llamada);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = {};
    for (const m of ['select', 'insert', 'update', 'upsert', 'delete', 'eq', 'maybeSingle', 'single', 'abortSignal']) {
      b[m] = (...args: unknown[]) => {
        llamada.ops.push({ m, args });
        return b;
      };
    }
    b.then = (onF: (v: unknown) => unknown, onR: (e: unknown) => unknown) => Promise.resolve({ data: null, ...estado.respuesta }).then(onF, onR);
    return b;
  }
  return { llamadas, estado, from };
});

vi.mock('@/lib/supabase', () => ({ supabase: { from: h.from } }));

import { classifyDataError, DataRequestError, isRetryableDataError, mapDataError, UserMessageError } from '@/lib/data-errors';
import type { ContextoDelReporte } from './contexto';
import { ENVIAR_REPORTE_CONTEXT, enviarReporte, REPORTES_TOPE_SQLSTATE, type NuevoReporte } from './reportar-api';
import { MENSAJE_RECHAZADO, PROBLEMA_DE_LA_APP, TOPE_ALCANZADO } from './reportar-textos';

const CONTEXTO: ContextoDelReporte = {
  version: 'local',
  navegador: 'Agente',
  pantalla_tamano: '390x844',
  en_linea: true,
  idioma: 'es-AR',
  errores_recientes: [{ tipo: 'network', operacion: 'crear-gasto', hace_s: 3 }],
};
const REPORTE: NuevoReporte = {
  mensaje: 'No me deja guardar el gasto',
  pantalla: '/gastos/nuevo',
  contexto: CONTEXTO,
  clientRef: '7d1f0000-0000-4000-8000-000000000001',
};
const responde = (error: unknown, status = 400) => {
  h.estado.respuesta = { error, status };
};

beforeEach(() => {
  h.llamadas.length = 0;
  h.estado.respuesta = { error: null, status: 201 };
});

describe('enviarReporte: qué se manda', () => {
  it('un INSERT en `reportes` con SOLO mensaje, pantalla, contexto y client_ref', async () => {
    await enviarReporte(REPORTE);
    expect(h.llamadas).toHaveLength(1);
    expect(h.llamadas[0]!.tabla).toBe('reportes');
    const insert = h.llamadas[0]!.ops.find((op) => op.m === 'insert')!;
    expect(insert.args[0]).toEqual({
      mensaje: 'No me deja guardar el gasto',
      pantalla: '/gastos/nuevo',
      contexto: CONTEXTO,
      client_ref: '7d1f0000-0000-4000-8000-000000000001',
    });
    expect(Object.keys(insert.args[0] as object).sort()).toEqual(['client_ref', 'contexto', 'mensaje', 'pantalla']);
  });

  it('NUNCA manda lo que pone la base (id, transportista_id, user_id, estado, nota, created_at), aunque venga en el objeto', async () => {
    await enviarReporte({ ...REPORTE, estado: 'resuelto', transportista_id: 'otro', user_id: 'otro', id: 'x', nota: 'x', created_at: 'x' } as NuevoReporte);
    const enviado = h.llamadas[0]!.ops.find((op) => op.m === 'insert')!.args[0] as Record<string, unknown>;
    for (const columna of ['id', 'transportista_id', 'user_id', 'estado', 'nota', 'created_at', 'clientRef']) expect(enviado).not.toHaveProperty(columna);
  });

  it('SIN `.select()` ni ninguna lectura: solo insert y la señal de timeout de escritura', async () => {
    await enviarReporte(REPORTE);
    expect(h.llamadas[0]!.ops.map((op) => op.m)).toEqual(['insert', 'abortSignal']);
    expect(h.llamadas[0]!.ops[1]!.args[0]).toBeInstanceOf(AbortSignal);
  });

  it('el mensaje viaja tal cual como dato (HTML o SQL no se interpretan ni se escapan)', async () => {
    const raro = `<img src=x onerror=alert(1)>'); DROP TABLE reportes; --`;
    await enviarReporte({ ...REPORTE, mensaje: raro });
    expect((h.llamadas[0]!.ops[0]!.args[0] as { mensaje: string }).mensaje).toBe(raro);
  });

  it('pantalla null se manda como null', async () => {
    await enviarReporte({ ...REPORTE, pantalla: null });
    expect((h.llamadas[0]!.ops[0]!.args[0] as { pantalla: unknown }).pantalla).toBeNull();
  });
});

describe('enviarReporte: respuestas', () => {
  it('guardado: resuelve', async () => {
    await expect(enviarReporte(REPORTE)).resolves.toBeUndefined();
  });

  it('23505 del client_ref (un intento anterior ya llegó): ÉXITO', async () => {
    responde({ code: '23505', message: 'duplicate key value violates unique constraint "reportes_transportista_client_ref_uidx"', details: '' }, 409);
    await expect(enviarReporte(REPORTE)).resolves.toBeUndefined();
  });

  it('un 23505 de OTRO índice es un error', async () => {
    responde({ code: '23505', message: 'duplicate key value violates unique constraint "reportes_pkey"' }, 409);
    const error = await enviarReporte(REPORTE).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DataRequestError);
    expect(classifyDataError(error)).toBe('unique');
  });

  it(`el tope de la base (${REPORTES_TOPE_SQLSTATE}, HTTP 429): su propio mensaje y SIN reintento (no el texto de la base)`, async () => {
    responde({ code: 'PT429', message: 'Llegaste al límite de 30 reportes en 24 horas (texto de la base)' }, 429);
    const error = await enviarReporte(REPORTE).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UserMessageError);
    expect(mapDataError(error)).toBe(TOPE_ALCANZADO);
    expect(isRetryableDataError(error)).toBe(false);
    expect(mapDataError(error)).not.toContain('texto de la base');
  });

  it('el tope se reconoce también solo por el código (con otro status) o solo por el status 429', async () => {
    responde({ code: 'PT429', message: 'x' }, 400);
    expect(mapDataError(await enviarReporte(REPORTE).catch((e: unknown) => e))).toBe(TOPE_ALCANZADO);
    responde({ code: '', message: 'Too Many Requests' }, 429);
    const error = await enviarReporte(REPORTE).catch((e: unknown) => e);
    expect(mapDataError(error)).toBe(TOPE_ALCANZADO);
    expect(isRetryableDataError(error)).toBe(false);
  });

  it('un 54000 cualquiera ya NO es el tope (es un error de servidor, reintentable)', async () => {
    responde({ code: '54000', message: 'program limit exceeded' }, 500);
    const error = await enviarReporte(REPORTE).catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(UserMessageError);
    expect(isRetryableDataError(error)).toBe(true);
  });

  it('el 23505 del client_ref gana aunque la persona esté en el tope (el reintento de algo que ya llegó es éxito)', async () => {
    responde({ code: '23505', message: 'duplicate key value violates unique constraint "reportes_transportista_client_ref_uidx"' }, 409);
    await expect(enviarReporte(REPORTE)).resolves.toBeUndefined();
  });

  it.each([
    ['reportes_mensaje_chk', MENSAJE_RECHAZADO],
    ['reportes_pantalla_chk', PROBLEMA_DE_LA_APP],
    ['reportes_contexto_chk', PROBLEMA_DE_LA_APP],
  ])('el check %s: mensaje propio (con el contexto del envío) y sin reintento', async (constraint, mensaje) => {
    responde({ code: '23514', message: `new row for relation "reportes" violates check constraint "${constraint}"`, details: 'Failing row contains (datos)' }, 400);
    const error = await enviarReporte(REPORTE).catch((e: unknown) => e);
    expect(mapDataError(error, ENVIAR_REPORTE_CONTEXT)).toBe(mensaje);
    expect(isRetryableDataError(error, ENVIAR_REPORTE_CONTEXT)).toBe(false);
  });

  it('sin red: error de red, reintentable', async () => {
    responde({ code: '', message: 'TypeError: Failed to fetch' }, 0);
    const error = await enviarReporte(REPORTE).catch((e: unknown) => e);
    expect(classifyDataError(error)).toBe('network');
    expect(isRetryableDataError(error)).toBe(true);
  });

  it('timeout de escritura: reintentable (el client_ref evita duplicar)', async () => {
    responde({ code: '', message: 'TimeoutError: signal timed out' }, 0);
    const error = await enviarReporte(REPORTE).catch((e: unknown) => e);
    expect(classifyDataError(error)).toBe('timeout');
    expect(isRetryableDataError(error)).toBe(true);
  });

  it('un check violado (mensaje vacío o largo que se coló): datos inválidos, sin reintento', async () => {
    responde({ code: '23514', message: 'new row violates check constraint "reportes_mensaje_chk"' }, 400);
    const error = await enviarReporte(REPORTE).catch((e: unknown) => e);
    expect(classifyDataError(error)).toBe('invalid-data');
    expect(isRetryableDataError(error)).toBe(false);
  });

  it('sin permiso (42501): error de permiso', async () => {
    responde({ code: '42501', message: 'permission denied for table reportes' }, 403);
    expect(classifyDataError(await enviarReporte(REPORTE).catch((e: unknown) => e))).toBe('permission');
  });
});
