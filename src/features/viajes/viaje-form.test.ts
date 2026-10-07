import { describe, expect, it } from 'vitest';

import {
  CLIENTES_SIN_CARGAR_MESSAGE,
  CLIENTE_FALTA_MESSAGE,
  DESTINO_VACIO_MESSAGE,
  ENTREGAS_DEMASIADAS_MESSAGE,
  INCIDENCIAS_LARGO_MESSAGE,
  KM_FINAL_MENOR_MESSAGE,
  KM_INICIAL_FALTA_MESSAGE,
  OBSERVACIONES_LARGO_MESSAGE,
  ORIGEN_VACIO_MESSAGE,
  VIAJE_FIELD_ORDER,
  emptyViajeValues,
  firstFocusTarget,
  kmModoDe,
  newEntregaRow,
  validateKm,
  validateViajeForm,
  valuesFromViaje,
  type EntregaFormRow,
  type ViajeEditable,
  type ViajeFormValues,
  type ViajeValidation,
} from '@/features/viajes/viaje-form';
import { parseDecimal } from '@/lib/numbers';

const TODAY = '2026-10-02';
const NBSP = String.fromCharCode(0xa0); // espacio duro, armado con su codigo para que se vea en el codigo
const CLIENTE_A = '11111111-1111-4111-8111-111111111111';
const CLIENTE_B = '22222222-2222-4222-8222-222222222222';
const CLIENTES = [{ id: CLIENTE_A }, { id: CLIENTE_B }];
const ctx = { today: TODAY, clientes: CLIENTES };

/** Un formulario válido mínimo: lo único obligatorio es origen y destino (la fecha trae hoy). */
const base = (over: Partial<ViajeFormValues> = {}): ViajeFormValues => ({
  ...emptyViajeValues(TODAY),
  origen: 'Rosario',
  destino: 'Córdoba',
  ...over,
});

const fila = (key: string, over: Partial<EntregaFormRow> = {}): EntregaFormRow => ({
  key,
  id: null,
  clienteId: CLIENTE_A,
  incidencias: '',
  ...over,
});

function ok(v: ViajeValidation) {
  if (!v.ok) throw new Error(`se esperaba válido: ${JSON.stringify(v.errors)}`);
  return v.datos;
}
function fail(v: ViajeValidation) {
  if (v.ok) throw new Error('se esperaba inválido');
  return v;
}

describe('emptyViajeValues / newEntregaRow', () => {
  it('arranca con hoy, modo "Inicial y final", sin entregas y sin texto', () => {
    expect(emptyViajeValues(TODAY)).toEqual({
      fecha: TODAY,
      origen: '',
      destino: '',
      camionId: '', // sin camión elegido (si hay que elegir, se elige: sin preselección)
      kmModo: 'inicial-final',
      kmInicial: '',
      kmFinal: '',
      kmRecorridos: '',
      ingreso: '',
      observaciones: '',
      entregas: [],
    });
  });

  it('una fila nueva lleva su clave local, sin id y sin cliente', () => {
    expect(newEntregaRow(() => 'k-1')).toEqual({ key: 'k-1', id: null, clienteId: '', incidencias: '' });
  });
});

describe('validateViajeForm: lo mínimo y el recorte', () => {
  it('solo origen y destino: válido; km, ingreso y observaciones en null; sin entregas (cero es válido)', () => {
    const datos = ok(validateViajeForm(base(), ctx));
    expect(datos.columns).toEqual({
      fecha: TODAY,
      origen: 'Rosario',
      destino: 'Córdoba',
      camion_id: null, // sin contexto de camión (sin camiones): va sin camión
      km_inicial: null,
      km_final: null,
      km_recorridos: null,
      observaciones: null,
      ingreso: null,
    });
    expect(datos.entregas).toEqual([]);
  });

  it('recorta origen, destino y observaciones; vacío = null', () => {
    const datos = ok(validateViajeForm(base({ origen: '  San Lorenzo ', destino: '\tMendoza\n', observaciones: '  Sin novedades  ' }), ctx));
    expect(datos.columns.origen).toBe('San Lorenzo');
    expect(datos.columns.destino).toBe('Mendoza');
    expect(datos.columns.observaciones).toBe('Sin novedades');
    expect(ok(validateViajeForm(base({ observaciones: '   ' }), ctx)).columns.observaciones).toBeNull();
  });

  it('origen y destino vacíos o solo espacios -> error propio de cada uno', () => {
    for (const blank of ['', '   ', '\t \n', NBSP]) {
      const v = fail(validateViajeForm(base({ origen: blank, destino: blank }), ctx));
      expect(v.errors.campos.origen).toBe(ORIGEN_VACIO_MESSAGE);
      expect(v.errors.campos.destino).toBe(DESTINO_VACIO_MESSAGE);
    }
  });

  it('200 caracteres exactos es válido; 201 -> error de largo (cuenta code points)', () => {
    expect(validateViajeForm(base({ origen: 'a'.repeat(200) }), ctx).ok).toBe(true);
    expect(validateViajeForm(base({ origen: '😀'.repeat(200) }), ctx).ok).toBe(true);
    const largo = fail(validateViajeForm(base({ origen: 'a'.repeat(201), destino: 'b'.repeat(201) }), ctx));
    expect(largo.errors.campos.origen).toBe('El origen puede tener hasta 200 caracteres.');
    expect(largo.errors.campos.destino).toBe('El destino puede tener hasta 200 caracteres.');
    // El espacio de los costados no cuenta.
    expect(validateViajeForm(base({ origen: `  ${'a'.repeat(200)}  ` }), ctx).ok).toBe(true);
  });

  it('observaciones: 2000 válido, 2001 -> error', () => {
    expect(validateViajeForm(base({ observaciones: 'x'.repeat(2000) }), ctx).ok).toBe(true);
    const v = fail(validateViajeForm(base({ observaciones: 'x'.repeat(2001) }), ctx));
    expect(v.errors.campos.observaciones).toBe(OBSERVACIONES_LARGO_MESSAGE);
    expect(v.focus).toEqual({ tipo: 'campo', field: 'observaciones' });
  });
});

describe('validateViajeForm: fecha (2000-01-01 hasta hoy, en hora local)', () => {
  it('hoy, ayer y el 2000-01-01 son válidos', () => {
    for (const fecha of [TODAY, '2026-10-01', '2000-01-01']) {
      expect(ok(validateViajeForm(base({ fecha }), ctx)).columns.fecha).toBe(fecha);
    }
  });

  it('vacía, inexistente, futura o anterior al 2000 (año de 2 dígitos tipeado: 0026) -> error en fecha', () => {
    for (const fecha of ['', '2026-02-30', '2026-10-03', '1999-12-31', '0026-10-01', '202026-09-30']) {
      const v = fail(validateViajeForm(base({ fecha }), ctx));
      expect(v.errors.campos.fecha, fecha).toBeTruthy();
      expect(v.focus, fecha).toEqual({ tipo: 'campo', field: 'fecha' });
    }
  });
});

describe('kilometraje: modo "Inicial y final"', () => {
  const km = (kmInicial: string, kmFinal: string) => validateKm({ kmModo: 'inicial-final', kmInicial, kmFinal, kmRecorridos: '' });

  it('sin nada cargado: todo null y sin errores', () => {
    expect(km('', '')).toEqual({ errors: {}, km_inicial: null, km_final: null, km_recorridos: null });
  });

  it('solo el inicial es válido (viaje en curso)', () => {
    expect(km('1200', '')).toEqual({ errors: {}, km_inicial: 1200, km_final: null, km_recorridos: null });
  });

  it('inicial y final válidos; el final puede ser igual al inicial; cero es válido', () => {
    expect(km('1200', '1850,5')).toMatchObject({ errors: {}, km_inicial: 1200, km_final: 1850.5 });
    expect(km('1200', '1200')).toMatchObject({ errors: {}, km_inicial: 1200, km_final: 1200 });
    expect(km('0', '0')).toMatchObject({ errors: {}, km_inicial: 0, km_final: 0 });
  });

  it('final SIN inicial -> "Carga el km inicial." anclado al inicial (el campo que falta)', () => {
    const r = km('', '1850');
    expect(r.errors).toEqual({ kmInicial: KM_INICIAL_FALTA_MESSAGE });
    expect(KM_INICIAL_FALTA_MESSAGE).toBe('Carga el km inicial.');
    expect(r.km_final).toBeNull();
  });

  it('final MENOR que el inicial -> error en el final; comparado en décimas (sin ruido de coma flotante)', () => {
    expect(km('1200', '1199,9').errors).toEqual({ kmFinal: KM_FINAL_MENOR_MESSAGE });
    expect(km('1200', '900').errors).toEqual({ kmFinal: KM_FINAL_MENOR_MESSAGE });
    // 0,1 + 0,2 vs 0,3: la igualdad exacta tiene que valer.
    expect(km('0,3', '0,3').errors).toEqual({});
    expect(km('1,1', '1,1').errors).toEqual({});
  });

  it('formato inválido: error en el campo que está mal (negativo, 2 decimales, letras, demasiado grande)', () => {
    expect(km('-5', '').errors.kmInicial).toBeTruthy();
    expect(km('10,55', '').errors.kmInicial).toMatch(/1 decimal/);
    expect(km('abc', '').errors.kmInicial).toBeTruthy();
    expect(km('100000000', '').errors.kmInicial).toMatch(/demasiado grande/);
    expect(km('100', '12,25').errors.kmFinal).toMatch(/1 decimal/);
    expect(km('99999999,9', '').errors).toEqual({});
  });

  it('con el final mal escrito y sin inicial se informa el formato del final (no se adivina)', () => {
    expect(km('', 'abc').errors).toEqual({ kmFinal: expect.any(String) });
  });
});

describe('kilometraje: modo "Recorridos" y que los modos NO se mezclan', () => {
  it('un solo campo (>= 0, un decimal); vacío = null; cero es válido', () => {
    const r = (kmRecorridos: string) => validateKm({ kmModo: 'recorridos', kmInicial: '', kmFinal: '', kmRecorridos });
    expect(r('640,5')).toEqual({ errors: {}, km_inicial: null, km_final: null, km_recorridos: 640.5 });
    expect(r('0').km_recorridos).toBe(0);
    expect(r('')).toEqual({ errors: {}, km_inicial: null, km_final: null, km_recorridos: null });
    expect(r('-1').errors.kmRecorridos).toBeTruthy();
    expect(r('1,25').errors.kmRecorridos).toMatch(/1 decimal/);
  });

  it('en modo Recorridos, inicial y final tipeados (hasta basura) NO se envían: van en null y no dan error', () => {
    const r = validateKm({ kmModo: 'recorridos', kmInicial: '1200', kmFinal: 'abc', kmRecorridos: '300' });
    expect(r).toEqual({ errors: {}, km_inicial: null, km_final: null, km_recorridos: 300 });
  });

  it('en modo "Inicial y final", los recorridos tipeados (hasta basura) NO se envían: km_recorridos null y sin error', () => {
    const r = validateKm({ kmModo: 'inicial-final', kmInicial: '100', kmFinal: '200', kmRecorridos: 'xyz' });
    expect(r).toEqual({ errors: {}, km_inicial: 100, km_final: 200, km_recorridos: null });
  });

  it('en ninguna combinación se mandan recorridos junto con inicial o final (viajes_chk_modo_km)', () => {
    const textos = ['', '0', '10', '10,5', 'abc'];
    for (const kmModo of ['inicial-final', 'recorridos'] as const) {
      for (const kmInicial of textos) {
        for (const kmFinal of textos) {
          for (const kmRecorridos of textos) {
            const r = validateKm({ kmModo, kmInicial, kmFinal, kmRecorridos });
            const mezcla = r.km_recorridos !== null && (r.km_inicial !== null || r.km_final !== null);
            expect(mezcla, JSON.stringify({ kmModo, kmInicial, kmFinal, kmRecorridos })).toBe(false);
            // Y nunca un final sin inicial (viajes_chk_km_coherentes).
            expect(r.km_final !== null && r.km_inicial === null).toBe(false);
            if (r.km_final !== null && r.km_inicial !== null) expect(r.km_final).toBeGreaterThanOrEqual(r.km_inicial);
          }
        }
      }
    }
  });

  it('el formulario completo manda null en el modo inactivo aunque tenga texto', () => {
    const recorridos = ok(validateViajeForm(base({ kmModo: 'recorridos', kmInicial: '100', kmFinal: '200', kmRecorridos: '55' }), ctx));
    expect(recorridos.columns).toMatchObject({ km_inicial: null, km_final: null, km_recorridos: 55 });
    const inicialFinal = ok(validateViajeForm(base({ kmModo: 'inicial-final', kmInicial: '100', kmFinal: '200', kmRecorridos: '55' }), ctx));
    expect(inicialFinal.columns).toMatchObject({ km_inicial: 100, km_final: 200, km_recorridos: null });
  });
});

describe('ingreso', () => {
  const ingreso = (texto: string) => validateViajeForm(base({ ingreso: texto }), ctx);

  it('vacío = null; 0 ES válido (a diferencia del monto de un gasto)', () => {
    expect(ok(ingreso('')).columns.ingreso).toBeNull();
    expect(ok(ingreso('0')).columns.ingreso).toBe(0);
    expect(ok(ingreso('0,00')).columns.ingreso).toBe(0);
  });

  it('lee coma y punto, y redondea a 2 decimales de la columna', () => {
    expect(ok(ingreso('1500,5')).columns.ingreso).toBe(1500.5);
    expect(ok(ingreso('1.234,56')).columns.ingreso).toBe(1234.56);
    expect(ok(ingreso('9999999999,99')).columns.ingreso).toBe(9999999999.99);
  });

  it('negativo, 3 decimales, letras o demasiado grande -> error en ingreso', () => {
    for (const t of ['-1', '10,555', 'mil', '10000000000']) {
      const v = fail(ingreso(t));
      expect(v.errors.campos.ingreso, t).toBeTruthy();
      expect(v.focus).toEqual({ tipo: 'campo', field: 'ingreso' });
    }
  });
});

describe('entregas', () => {
  it('cero entregas es válido; no se exige una mínima', () => {
    expect(ok(validateViajeForm(base({ entregas: [] }), ctx)).entregas).toEqual([]);
  });

  it('con entregas y la lista de clientes sin cargar (null): error de la sección, no por fila; foco a la sección', () => {
    const v = fail(validateViajeForm(base({ entregas: [fila('k1')] }), { today: TODAY, clientes: null }));
    expect(v.errors.entregasGeneral).toBe(CLIENTES_SIN_CARGAR_MESSAGE);
    expect(v.errors.entregas).toEqual({});
    expect(v.focus).toEqual({ tipo: 'entregas' });
  });

  it('sin entregas, la lista de clientes sin cargar no impide guardar', () => {
    expect(validateViajeForm(base(), { today: TODAY, clientes: null }).ok).toBe(true);
  });

  it('cada fila exige un cliente: "Elige un cliente." anclado a la fila (por su key), no a su posición', () => {
    const v = fail(validateViajeForm(base({ entregas: [fila('k1'), fila('k2', { clienteId: '' }), fila('k3')] }), ctx));
    expect(v.errors.entregas).toEqual({ k2: { clienteId: CLIENTE_FALTA_MESSAGE } });
    expect(CLIENTE_FALTA_MESSAGE).toBe('Elige un cliente.');
    expect(v.focus).toEqual({ tipo: 'entrega', key: 'k2', field: 'clienteId' });
  });

  it('un cliente que no está en la lista cargada (borrado o fuera del tope) también pide elegir uno', () => {
    const v = fail(validateViajeForm(base({ entregas: [fila('k1', { clienteId: '99999999-9999-4999-8999-999999999999' })] }), ctx));
    expect(v.errors.entregas.k1?.clienteId).toBe(CLIENTE_FALTA_MESSAGE);
  });

  it('un mismo cliente en dos filas es válido', () => {
    const datos = ok(validateViajeForm(base({ entregas: [fila('k1'), fila('k2')] }), ctx));
    expect(datos.entregas.map((e) => e.cliente_id)).toEqual([CLIENTE_A, CLIENTE_A]);
  });

  it('incidencias: recortadas, vacías = null, hasta 2000 caracteres; el error se ancla a la fila', () => {
    const datos = ok(validateViajeForm(base({ entregas: [fila('k1', { incidencias: '  Faltó un pallet ' }), fila('k2', { incidencias: '  ' })] }), ctx));
    expect(datos.entregas.map((e) => e.incidencias)).toEqual(['Faltó un pallet', null]);
    expect(validateViajeForm(base({ entregas: [fila('k1', { incidencias: 'x'.repeat(2000) })] }), ctx).ok).toBe(true);
    const v = fail(validateViajeForm(base({ entregas: [fila('k1'), fila('k2', { incidencias: 'x'.repeat(2001) })] }), ctx));
    expect(v.errors.entregas).toEqual({ k2: { incidencias: INCIDENCIAS_LARGO_MESSAGE } });
    expect(v.focus).toEqual({ tipo: 'entrega', key: 'k2', field: 'incidencias' });
  });

  it('conserva el orden de carga y el id de las que ya existían (null las nuevas)', () => {
    const datos = ok(
      validateViajeForm(
        base({
          entregas: [fila('k1', { id: 'e-1', clienteId: CLIENTE_B }), fila('k2'), fila('k3', { id: 'e-3', incidencias: 'Golpe' })],
        }),
        ctx,
      ),
    );
    expect(datos.entregas).toEqual([
      { id: 'e-1', cliente_id: CLIENTE_B, incidencias: null },
      { id: null, cliente_id: CLIENTE_A, incidencias: null },
      { id: 'e-3', cliente_id: CLIENTE_A, incidencias: 'Golpe' },
    ]);
  });

  it('100 entregas es el máximo; 101 -> error de la sección', () => {
    const cien = Array.from({ length: 100 }, (_, i) => fila(`k${i}`));
    expect(validateViajeForm(base({ entregas: cien }), ctx).ok).toBe(true);
    const v = fail(validateViajeForm(base({ entregas: [...cien, fila('k100')] }), ctx));
    expect(v.errors.entregasGeneral).toBe(ENTREGAS_DEMASIADAS_MESSAGE);
    expect(v.focus).toEqual({ tipo: 'entregas' });
  });
});

describe('foco al primer error, en el orden VISUAL', () => {
  it('el orden de los campos es fecha, origen, destino, camión, km, ingreso y observaciones', () => {
    expect(VIAJE_FIELD_ORDER).toEqual([
      'fecha',
      'origen',
      'destino',
      'camionId',
      'kmInicial',
      'kmFinal',
      'kmRecorridos',
      'ingreso',
      'observaciones',
    ]);
  });

  it('con todo mal, el foco va a la fecha; al corregir de a uno, avanza por el orden visual', () => {
    const todoMal = base({
      fecha: '',
      origen: '',
      destino: '',
      kmInicial: '',
      kmFinal: '500',
      ingreso: '-1',
      observaciones: 'x'.repeat(2001),
      entregas: [fila('k1', { clienteId: '' })],
    });
    const orden: Array<Partial<ViajeFormValues>> = [
      {}, // todo mal -> fecha
      { fecha: TODAY }, // -> origen
      { origen: 'A' }, // -> destino
      { destino: 'B' }, // -> km inicial (final sin inicial)
      { kmFinal: '' }, // -> ingreso
      { ingreso: '' }, // -> observaciones
      { observaciones: '' }, // -> entrega
    ];
    const esperado = ['fecha', 'origen', 'destino', 'kmInicial', 'ingreso', 'observaciones', 'entrega'];
    let values = todoMal;
    orden.forEach((cambio, i) => {
      values = { ...values, ...cambio };
      const v = fail(validateViajeForm(values, ctx));
      const nombre = v.focus.tipo === 'campo' ? v.focus.field : v.focus.tipo;
      expect(nombre, `paso ${i}`).toBe(esperado[i]);
    });
  });

  it('los km de "Recorridos" van antes que el ingreso', () => {
    const v = fail(validateViajeForm(base({ kmModo: 'recorridos', kmRecorridos: 'abc', ingreso: '-1' }), ctx));
    expect(v.focus).toEqual({ tipo: 'campo', field: 'kmRecorridos' });
  });

  it('un error de campo gana sobre los de entregas; el de la sección gana sobre los de las filas; las filas por orden y "cliente" antes que "incidencias"', () => {
    const filas = [fila('k1', { incidencias: 'x'.repeat(2001) }), fila('k2', { clienteId: '' })];
    const errs = (campos: Record<string, string>, general?: string) => ({
      campos,
      entregas: { k1: { incidencias: 'a' }, k2: { clienteId: 'b', incidencias: 'c' } },
      ...(general ? { entregasGeneral: general } : {}),
    });
    expect(firstFocusTarget(errs({ origen: 'x' }), filas)).toEqual({ tipo: 'campo', field: 'origen' });
    expect(firstFocusTarget(errs({}, 'g'), filas)).toEqual({ tipo: 'entregas' });
    expect(firstFocusTarget(errs({}), filas)).toEqual({ tipo: 'entrega', key: 'k1', field: 'incidencias' });
    expect(firstFocusTarget({ campos: {}, entregas: { k2: { clienteId: 'b', incidencias: 'c' } } }, filas)).toEqual({
      tipo: 'entrega',
      key: 'k2',
      field: 'clienteId',
    });
    expect(firstFocusTarget({ campos: {}, entregas: {} }, filas)).toBeNull();
  });
});

describe('editar: deducción del modo de km y valores iniciales', () => {
  const viaje = (over: Partial<ViajeEditable> = {}): ViajeEditable => ({
    fecha: '2026-09-15',
    origen: 'Rosario',
    destino: 'Córdoba',
    km_inicial: null,
    km_final: null,
    km_recorridos: null,
    ingreso: null,
    observaciones: null,
    entregas: [],
    ...over,
  });

  it('con km_recorridos (aunque sea 0) -> "Recorridos"; si no -> "Inicial y final"', () => {
    expect(kmModoDe({ km_recorridos: 640 })).toBe('recorridos');
    expect(kmModoDe({ km_recorridos: 0 })).toBe('recorridos');
    expect(kmModoDe({ km_recorridos: '12.5' })).toBe('recorridos'); // PostgREST puede devolver numeric como texto
    expect(kmModoDe({ km_recorridos: null })).toBe('inicial-final');
  });

  it('inicial / final / sin km -> "Inicial y final" con los textos cargados', () => {
    const v = valuesFromViaje(viaje({ km_inicial: 1200, km_final: 1850.5 }), () => 'k');
    expect(v.kmModo).toBe('inicial-final');
    expect(parseDecimal(v.kmInicial)).toBe(1200);
    expect(parseDecimal(v.kmFinal)).toBe(1850.5);
    expect(v.kmRecorridos).toBe('');
    expect(valuesFromViaje(viaje(), () => 'k').kmModo).toBe('inicial-final');
    const enCurso = valuesFromViaje(viaje({ km_inicial: 300 }), () => 'k');
    expect(parseDecimal(enCurso.kmInicial)).toBe(300);
    expect(enCurso.kmFinal).toBe('');
  });

  it('con recorridos -> modo "Recorridos" y el campo cargado; inicial y final quedan vacíos', () => {
    const v = valuesFromViaje(viaje({ km_recorridos: 640.5 }), () => 'k');
    expect(v.kmModo).toBe('recorridos');
    expect(parseDecimal(v.kmRecorridos)).toBe(640.5);
    expect(v.kmInicial).toBe('');
    expect(v.kmFinal).toBe('');
  });

  it('ingreso 0 se precarga como "0" (no como vacío); sin ingreso queda vacío; observaciones null -> vacío', () => {
    expect(valuesFromViaje(viaje({ ingreso: 0 }), () => 'k').ingreso).toBe('0');
    expect(valuesFromViaje(viaje(), () => 'k').ingreso).toBe('');
    expect(valuesFromViaje(viaje(), () => 'k').observaciones).toBe('');
    expect(parseDecimal(valuesFromViaje(viaje({ ingreso: '2500.5' }), () => 'k').ingreso)).toBe(2500.5);
  });

  it('las entregas conservan su id, su orden y reciben una clave local distinta cada una', () => {
    let n = 0;
    const v = valuesFromViaje(
      viaje({
        entregas: [
          { id: 'e-1', cliente_id: CLIENTE_B, incidencias: 'Golpe' },
          { id: 'e-2', cliente_id: CLIENTE_A, incidencias: null },
        ],
      }),
      () => `k${++n}`,
    );
    expect(v.entregas).toEqual([
      { key: 'k1', id: 'e-1', clienteId: CLIENTE_B, incidencias: 'Golpe' },
      { key: 'k2', id: 'e-2', clienteId: CLIENTE_A, incidencias: '' },
    ]);
  });

  it('lo guardado, tal cual se precarga, vuelve a validar y manda los mismos datos (ida y vuelta)', () => {
    const guardado = viaje({
      km_inicial: 1200,
      km_final: 1850.5,
      ingreso: 1234.5,
      observaciones: 'Llegó tarde',
      entregas: [{ id: 'e-1', cliente_id: CLIENTE_A, incidencias: 'Golpe' }],
    });
    const datos = ok(validateViajeForm(valuesFromViaje(guardado, () => 'k'), ctx));
    expect(datos.columns).toEqual({
      fecha: '2026-09-15',
      origen: 'Rosario',
      destino: 'Córdoba',
      camion_id: null,
      km_inicial: 1200,
      km_final: 1850.5,
      km_recorridos: null,
      observaciones: 'Llegó tarde',
      ingreso: 1234.5,
    });
    expect(datos.entregas).toEqual([{ id: 'e-1', cliente_id: CLIENTE_A, incidencias: 'Golpe' }]);
  });
});

describe('validateViajeForm: el camión (Etapa 5b)', () => {
  it('sin resolución del camión (código viejo) va sin camión', () => {
    expect(ok(validateViajeForm(base(), ctx)).columns.camion_id).toBeNull();
  });

  it('lo resuelto va a camion_id tal cual', () => {
    const camionId = 'c0000000-0000-4000-8000-000000000001';
    expect(ok(validateViajeForm(base(), { ...ctx, camion: { ok: true, camionId } })).columns.camion_id).toBe(camionId);
    expect(ok(validateViajeForm(base(), { ...ctx, camion: { ok: true, camionId: null } })).columns.camion_id).toBeNull();
  });

  it('si falta el camión: el error va al campo camionId y el foco también (después de destino)', () => {
    const v = fail(validateViajeForm(base(), { ...ctx, camion: { ok: false, message: 'Elige el camión.' } }));
    expect(v.errors.campos.camionId).toBe('Elige el camión.');
    expect(v.focus).toEqual({ tipo: 'campo', field: 'camionId' });
  });

  it('con otro error antes (destino vacío), el foco va a ese', () => {
    const v = fail(validateViajeForm(base({ destino: '' }), { ...ctx, camion: { ok: false, message: 'Elige el camión.' } }));
    expect(v.errors.campos.camionId).toBe('Elige el camión.');
    expect(v.focus).toEqual({ tipo: 'campo', field: 'destino' });
  });

  it('el camión va en el orden de los campos justo después de destino', () => {
    expect(VIAJE_FIELD_ORDER.indexOf('camionId')).toBe(VIAJE_FIELD_ORDER.indexOf('destino') + 1);
  });

  it('valuesFromViaje: el camión que tenía (o vacío)', () => {
    const viaje = {
      fecha: '2026-01-01',
      origen: 'A',
      destino: 'B',
      km_inicial: null,
      km_final: null,
      km_recorridos: null,
      ingreso: null,
      observaciones: null,
      entregas: [],
    } as unknown as ViajeEditable;
    expect(valuesFromViaje({ ...viaje, camion_id: 'c-1' }).camionId).toBe('c-1');
    expect(valuesFromViaje({ ...viaje, camion_id: null }).camionId).toBe('');
    expect(valuesFromViaje(viaje).camionId).toBe('');
  });
});
