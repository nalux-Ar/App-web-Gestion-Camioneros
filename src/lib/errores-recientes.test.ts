import { beforeEach, describe, expect, it } from 'vitest';

import { DataRequestError } from './data-errors';
import {
  ERRORES_POR_REPORTE,
  erroresRecientes,
  limpiarErroresRecientes,
  MAX_ERRORES_GUARDADOS,
  operacionDeQueryKey,
  operacionValida,
  registrarErrorDeDatos,
  registrarErrorDeRender,
} from './errores-recientes';

const T0 = 1_800_000_000_000;

/** Un error de Postgres "real", con valores de los datos en todos los textos. */
const errorConDatos = {
  code: '23505',
  message: 'duplicate key value violates unique constraint "camiones_patente_uidx"',
  details: 'Key (transportista_id, patente)=(7d1f0000-0000-4000-8000-000000000001, AB123CD) already exists.',
  hint: 'Llamar al contacto 11-5555-0000',
};

beforeEach(() => {
  limpiarErroresRecientes();
});

describe('errores recientes: lista blanca', () => {
  it('de un error de Postgres guarda SOLO tipo, sqlstate, constraint y operación: nada de los textos', () => {
    registrarErrorDeDatos(errorConDatos, 'crear-camion', T0);
    const [entrada] = erroresRecientes(5, T0);
    expect(entrada).toEqual({ tipo: 'unique', sqlstate: '23505', constraint: 'camiones_patente_uidx', operacion: 'crear-camion', hace_s: 0 });
    const json = JSON.stringify(erroresRecientes(5, T0));
    for (const filtrado of ['AB123CD', '7d1f0000', 'Key (', 'contacto', '5555', 'duplicate key', 'already exists']) {
      expect(json).not.toContain(filtrado);
    }
  });

  it('un DataRequestError (lo que arma unwrap) también: el mensaje interno no viaja', () => {
    registrarErrorDeDatos(
      new DataRequestError({ code: '23514', message: 'new row for relation "gastos" violates check constraint "gastos_monto_chk"', details: 'Failing row contains (secreto, 9999)' }, 400),
      'crear-gasto',
      T0,
    );
    expect(erroresRecientes(5, T0)).toEqual([{ tipo: 'invalid-data', sqlstate: '23514', constraint: 'gastos_monto_chk', operacion: 'crear-gasto', hace_s: 0 }]);
    expect(JSON.stringify(erroresRecientes(5, T0))).not.toMatch(/secreto|9999|Failing/);
  });

  it('el sqlstate solo si son exactamente 5 alfanuméricos (los de PostgREST y lo raro quedan afuera)', () => {
    for (const code of ['PGRST116', '2350', '235055', '23 05', '23-05', '', 'abc"<', 12345]) {
      limpiarErroresRecientes();
      registrarErrorDeDatos({ code, message: 'x' }, undefined, T0);
      expect(erroresRecientes(5, T0)[0], String(code)).not.toHaveProperty('sqlstate');
    }
    registrarErrorDeDatos({ code: 'P0002' }, undefined, T0);
    expect(erroresRecientes(1, T0)[0]!.sqlstate).toBe('P0002');
  });

  it.each([
    ['23505', 'duplicate key value violates unique constraint "gastos_transportista_client_ref_uidx"', 'gastos_transportista_client_ref_uidx'],
    ['23514', 'new row for relation "gastos" violates check constraint "gastos_monto_chk"', 'gastos_monto_chk'],
    ['23503', 'insert or update on table "gastos" violates foreign key constraint "gastos_viaje_fk"', 'gastos_viaje_fk'],
    ['23503', 'update or delete on table "viajes" violates foreign key constraint "gastos_viaje_fk" on table "gastos"', 'gastos_viaje_fk'],
    ['23P01', 'conflicting key value violates exclusion constraint "turnos_sin_solape_excl"', 'turnos_sin_solape_excl'],
  ])('cada frase real de Postgres (%s) aporta SOLO el nombre del constraint', (code, message, esperado) => {
    registrarErrorDeDatos({ code, message, details: 'Key (patente)=(AB123CD) already exists.' }, undefined, T0);
    expect(erroresRecientes(1, T0)[0]!.constraint).toBe(esperado);
    expect(JSON.stringify(erroresRecientes(1, T0))).not.toMatch(/AB123CD|gastos"|viajes"/);
  });

  it('el nombre tiene que ser un identificador simple (minúsculas, dígitos y _; hasta 63)', () => {
    const casos: Array<[string, string | undefined]> = [
      ['new row for relation "gastos" violates check constraint "Gastos_Monto"', undefined], // mayúsculas: no
      ['new row for relation "gastos" violates check constraint "x; DROP TABLE gastos"', undefined],
      ['new row for relation "gastos" violates check constraint "nombre con espacios"', undefined],
      [`new row for relation "gastos" violates check constraint "${'a'.repeat(64)}"`, undefined], // 64: no
      [`new row for relation "gastos" violates check constraint "${'a'.repeat(63)}"`, 'a'.repeat(63)],
    ];
    for (const [message, esperado] of casos) {
      limpiarErroresRecientes();
      registrarErrorDeDatos({ code: '23514', message }, undefined, T0);
      expect(erroresRecientes(1, T0)[0]!.constraint, message).toBe(esperado);
    }
  });

  it('NUNCA de los detalles, aunque traigan una frase con el formato (los detalles llevan valores de los datos)', () => {
    const detallesHostiles = [
      'Failing row contains (7d1f0000-0000-4000-8000-000000000001, constraint "pass123secreta", 2026-10-01).',
      'new row for relation "x" violates check constraint "pass123secreta"',
      'duplicate key value violates unique constraint "pass123secreta"',
    ];
    for (const details of detallesHostiles) {
      limpiarErroresRecientes();
      registrarErrorDeDatos({ code: '23502', message: 'null value in column "nombre" of relation "clientes" violates not-null constraint', details }, 'crear-cliente', T0);
      expect(erroresRecientes(1, T0)[0], details).toEqual({ tipo: 'invalid-data', sqlstate: '23502', operacion: 'crear-cliente', hace_s: 0 });
      expect(JSON.stringify(erroresRecientes(1, T0))).not.toContain('pass123secreta');
    }
  });

  it('un mensaje que NO es exactamente una de las frases no aporta constraint, aunque adentro diga `constraint "…"`', () => {
    const mensajesHostiles = [
      // El texto del usuario dentro del mensaje, con comillas sin escapar y una frase entera adentro.
      'invalid input syntax for type uuid: "duplicate key value violates unique constraint "pass123secreta""',
      'invalid input syntax for type uuid: "a" violates check constraint "pass123secreta"',
      // Algo antes de la frase.
      'ERROR: duplicate key value violates unique constraint "pass123secreta"',
      'algo duplicate key value violates unique constraint "pass123secreta"',
      // Algo después de la frase.
      'duplicate key value violates unique constraint "gastos_x_uidx" y además "pass123secreta"',
      // Otras formas de nombrar un constraint que no son las frases.
      'violates check constraint "pass123secreta"',
      'constraint "pass123secreta"',
      'camion_archivado', // texto fijo de un trigger (55000): no es un constraint citado
    ];
    for (const message of mensajesHostiles) {
      limpiarErroresRecientes();
      registrarErrorDeDatos({ code: '22P02', message }, undefined, T0);
      expect(erroresRecientes(1, T0)[0], message).not.toHaveProperty('constraint');
      expect(JSON.stringify(erroresRecientes(1, T0))).not.toContain('pass123secreta');
    }
  });

  it('la operación solo si es un identificador corto y seguro', () => {
    expect(operacionValida('crear-gasto')).toBe('crear-gasto');
    expect(operacionValida('resumen-gastos')).toBe('resumen-gastos');
    for (const mala of ['Crear', 'crear gasto', 'crear_gasto', '<script>', 'a'.repeat(41), '', 7, null, undefined, { id: 'x' }]) {
      expect(operacionValida(mala), String(mala)).toBeUndefined();
    }
    registrarErrorDeDatos({ code: '' }, 'tenant/7d1f0000', T0);
    expect(erroresRecientes(1, T0)[0]).not.toHaveProperty('operacion');
  });

  it('errores raros (sin objeto, null, strings, Error común) se guardan solo con su tipo', () => {
    for (const raro of [null, undefined, 'texto suelto con datos 123', 42, new Error('Cannot read properties of undefined (reading "patente")')]) {
      limpiarErroresRecientes();
      registrarErrorDeDatos(raro, undefined, T0);
      expect(Object.keys(erroresRecientes(1, T0)[0]!).sort()).toEqual(['hace_s', 'tipo']);
    }
  });

  it('un error de red se clasifica (network) sin guardar su texto', () => {
    registrarErrorDeDatos({ code: '', message: 'TypeError: Failed to fetch https://api.ejemplo.test/rest/v1/gastos?select=*' }, 'crear-gasto', T0);
    expect(erroresRecientes(1, T0)).toEqual([{ tipo: 'network', operacion: 'crear-gasto', hace_s: 0 }]);
  });

  it('un error al dibujar: solo "render"', () => {
    registrarErrorDeRender(T0);
    expect(erroresRecientes(1, T0)).toEqual([{ tipo: 'render', hace_s: 0 }]);
  });
});

describe('errores recientes: cuántos y cuándo', () => {
  it(`guarda como máximo ${MAX_ERRORES_GUARDADOS} (descarta los más viejos) y para el reporte se leen los últimos ${ERRORES_POR_REPORTE}`, () => {
    for (let i = 0; i < 25; i++) registrarErrorDeDatos({ code: '23514' }, `op-${String.fromCharCode(97 + i)}`, T0 + i * 1000);
    expect(erroresRecientes(100, T0 + 30_000)).toHaveLength(MAX_ERRORES_GUARDADOS);
    expect(erroresRecientes(100, T0 + 30_000)[0]!.operacion).toBe('op-f'); // los 5 primeros (a..e) se descartaron
    const ultimos = erroresRecientes(undefined, T0 + 30_000);
    expect(ultimos.map((e) => e.operacion)).toEqual(['op-u', 'op-v', 'op-w', 'op-x', 'op-y']);
  });

  it('hace_s: segundos desde que pasó (redondeado, nunca negativo)', () => {
    registrarErrorDeDatos({ code: '' }, undefined, T0);
    expect(erroresRecientes(1, T0 + 90_400)[0]!.hace_s).toBe(90);
    expect(erroresRecientes(1, T0 - 5_000)[0]!.hace_s).toBe(0);
  });

  it('leer 0 o menos: nada; sin errores: lista vacía', () => {
    expect(erroresRecientes(5, T0)).toEqual([]);
    registrarErrorDeRender(T0);
    expect(erroresRecientes(0, T0)).toEqual([]);
    expect(erroresRecientes(-1, T0)).toEqual([]);
  });

  it('limpiar vacía todo', () => {
    registrarErrorDeRender(T0);
    registrarErrorDeDatos(errorConDatos, 'crear-camion', T0);
    limpiarErroresRecientes();
    expect(erroresRecientes(20, T0)).toEqual([]);
  });

  it('leer no cambia el registro (lo que se devuelve es una copia)', () => {
    registrarErrorDeDatos({ code: '23514' }, 'crear-gasto', T0);
    const leidos = erroresRecientes(5, T0);
    leidos[0]!.operacion = 'otra';
    leidos.pop();
    expect(erroresRecientes(5, T0)).toEqual([{ tipo: 'invalid-data', sqlstate: '23514', operacion: 'crear-gasto', hace_s: 0 }]);
  });
});

describe('operacionDeQueryKey: la parte fija de la key, sin tenant ni parámetros', () => {
  it.each([
    [['tenant', '7d1f0000-0000-4000-8000-000000000001', 'resumen', 'gastos', '2026-10-01', '2026-10-31'], 'resumen-gastos'],
    [['tenant', 'tenant-a', 'gastos', 'lista', '2026-10-01', '2026-11-01', 'todas'], 'gastos-lista'],
    [['tenant', 'tenant-a', 'clientes', 'vista', '7d1f0000-0000-4000-8000-000000000001', 'datos'], 'clientes-vista'],
    [['tenant', 'tenant-a', 'categorias-gasto'], 'categorias-gasto'],
    [['tenant', 'tenant-a', 'camiones', 'detalle', 'sin-id'], 'camiones-detalle'],
    [['tenant', 'tenant-a', 'resumen', 'mensual', '2026-01-01', 12], 'resumen-mensual'],
    [['miembro', '7d1f0000-0000-4000-8000-000000000001'], 'miembro'], // una key sin tenant: igual, sin el id
  ])('%j → %s', (key, esperado) => {
    expect(operacionDeQueryKey(key)).toBe(esperado);
  });

  it('nunca el tenant ni ids ni fechas; algo raro → nada', () => {
    expect(operacionDeQueryKey(['tenant', 'tenant-a', '2026-10-01'])).toBeUndefined();
    expect(operacionDeQueryKey(['tenant', 'tenant-a'])).toBeUndefined();
    expect(operacionDeQueryKey(['tenant', 'tenant-a', { recurso: 'x' }])).toBeUndefined();
    expect(operacionDeQueryKey('gastos')).toBeUndefined();
    expect(operacionDeQueryKey(undefined)).toBeUndefined();
    expect(operacionDeQueryKey(['tenant', 'tenant-a', 'Gastos'])).toBeUndefined();
    expect(operacionDeQueryKey(['tenant', 'tenant-a', 'a'.repeat(25), 'b'.repeat(25)])).toBeUndefined(); // > 40
  });
});

describe('errores recientes: el sqlstate solo en MAYÚSCULAS y dígitos', () => {
  it('minúsculas o mezcla: no se guarda', () => {
    for (const code of ['p0002', 'abcde', 'Pgrst', '2350a']) {
      limpiarErroresRecientes();
      registrarErrorDeDatos({ code }, undefined, T0);
      expect(erroresRecientes(1, T0)[0], code).not.toHaveProperty('sqlstate');
    }
  });

  it('mayúsculas y dígitos: sí', () => {
    for (const code of ['P0002', '23505', 'PT429', '22P02']) {
      limpiarErroresRecientes();
      registrarErrorDeDatos({ code }, undefined, T0);
      expect(erroresRecientes(1, T0)[0]!.sqlstate).toBe(code);
    }
  });
});
