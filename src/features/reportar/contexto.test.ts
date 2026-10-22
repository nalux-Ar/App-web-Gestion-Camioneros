import { beforeEach, describe, expect, it } from 'vitest';

import { erroresRecientes, limpiarErroresRecientes, registrarErrorDeDatos, type ErrorReciente } from '@/lib/errores-recientes';
import { leerVersion } from '@/lib/version';
import { armarContexto, bytesDe, leerEntorno, MAX_CONTEXTO_BYTES, type Entorno } from './contexto';

const ENTORNO: Entorno = {
  userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile Safari/537.36',
  ancho: 390,
  alto: 844,
  enLinea: true,
  idioma: 'es-AR',
};
const ERROR: ErrorReciente = { tipo: 'network', operacion: 'crear-gasto', hace_s: 12 };

beforeEach(() => {
  limpiarErroresRecientes();
});

describe('armarContexto', () => {
  it('versión, navegador, tamaño, conexión, idioma y errores recientes: nada más', () => {
    const contexto = armarContexto(ENTORNO, [ERROR], 'abc1234');
    expect(contexto).toEqual({
      version: 'abc1234',
      navegador: ENTORNO.userAgent,
      pantalla_tamano: '390x844',
      en_linea: true,
      idioma: 'es-AR',
      errores_recientes: [ERROR],
    });
    expect(Object.keys(contexto).sort()).toEqual(['en_linea', 'errores_recientes', 'idioma', 'navegador', 'pantalla_tamano', 'version']);
  });

  it('el navegador recortado a 200 y sin caracteres de control', () => {
    const contexto = armarContexto({ ...ENTORNO, userAgent: `Agente\u0000\u0007raro ${'x'.repeat(500)}` }, []);
    expect(contexto.navegador).toHaveLength(200);
    expect(contexto.navegador.startsWith('Agenteraro ')).toBe(true);
  });

  it('tamaños raros quedan en 0; decimales se redondean', () => {
    expect(armarContexto({ ...ENTORNO, ancho: Number.NaN, alto: -5 }, []).pantalla_tamano).toBe('0x0');
    expect(armarContexto({ ...ENTORNO, ancho: 390.6, alto: 1e9 }, []).pantalla_tamano).toBe('391x99999');
  });

  it('un idioma con cosas raras se descarta', () => {
    expect(armarContexto({ ...ENTORNO, idioma: 'es"><script>' }, []).idioma).toBe('');
    expect(armarContexto({ ...ENTORNO, idioma: 'pt-BR' }, []).idioma).toBe('pt-BR');
  });

  it('sin conexión: en_linea false', () => {
    expect(armarContexto({ ...ENTORNO, enLinea: false }, []).en_linea).toBe(false);
  });

  it('por defecto toma los errores recientes del registro (los últimos 5)', () => {
    for (let i = 0; i < 8; i++) registrarErrorDeDatos({ code: '23514' }, `op-${String.fromCharCode(97 + i)}`);
    const contexto = armarContexto(ENTORNO);
    expect(contexto.errores_recientes.map((e) => e.operacion)).toEqual(['op-d', 'op-e', 'op-f', 'op-g', 'op-h']);
  });

  it('no modifica la lista de errores que recibe', () => {
    const errores = [ERROR, { ...ERROR, hace_s: 1 }];
    armarContexto(ENTORNO, errores, 'local', 10);
    expect(errores).toHaveLength(2);
  });
});

describe('armarContexto: tope de 4000 bytes', () => {
  it('lo normal entra holgado', () => {
    const errores = Array.from({ length: 5 }, () => ({ tipo: 'invalid-data', sqlstate: '23514', constraint: 'a'.repeat(63), operacion: 'b'.repeat(40), hace_s: 99999 }) as ErrorReciente);
    const contexto = armarContexto({ ...ENTORNO, userAgent: 'x'.repeat(1000) }, errores);
    expect(contexto.errores_recientes).toHaveLength(5);
    expect(bytesDe(contexto)).toBeLessThanOrEqual(MAX_CONTEXTO_BYTES);
  });

  it('si no entra, primero se van los errores más viejos', () => {
    const errores = Array.from({ length: 5 }, (_, i) => ({ ...ERROR, hace_s: i }));
    const sinErrores = bytesDe(armarContexto(ENTORNO, [], 'local'));
    const limite = sinErrores + 2 * bytesDe(ERROR) + 10;
    const contexto = armarContexto(ENTORNO, errores, 'local', limite);
    expect(contexto.errores_recientes.map((e) => e.hace_s)).toEqual([3, 4]); // los dos más nuevos
    expect(bytesDe(contexto)).toBeLessThanOrEqual(limite);
    expect(contexto.navegador).toBe(ENTORNO.userAgent);
  });

  it('después se acorta el navegador; versión, tamaño, conexión e idioma quedan siempre', () => {
    const contexto = armarContexto({ ...ENTORNO, userAgent: 'x'.repeat(200) }, [ERROR], 'local', 150);
    expect(contexto.errores_recientes).toEqual([]);
    expect(contexto.navegador.length).toBeLessThan(200);
    expect(contexto).toMatchObject({ version: 'local', pantalla_tamano: '390x844', en_linea: true, idioma: 'es-AR' });
    expect(bytesDe(contexto)).toBeLessThanOrEqual(150);
  });

  it('bytes, no caracteres: un userAgent con caracteres de varios bytes también respeta el tope', () => {
    const contexto = armarContexto({ ...ENTORNO, userAgent: 'ñ'.repeat(200) }, [], 'local', 200);
    expect(bytesDe(contexto)).toBeLessThanOrEqual(200);
  });
});

describe('contexto: nada personal', () => {
  it('aunque el registro tenga errores con datos, el contexto no lleva textos del servidor, correo ni ids', () => {
    registrarErrorDeDatos(
      { code: '23505', message: 'duplicate key value violates unique constraint "clientes_x_uidx" a@correo.test', details: 'Key (user_id)=(7d1f0000-0000-4000-8000-000000000001)' },
      'crear-cliente',
    );
    const json = JSON.stringify(armarContexto(ENTORNO));
    expect(json).not.toMatch(/correo\.test|7d1f0000|Key \(|duplicate/);
    expect(erroresRecientes()).toHaveLength(1);
  });

  it('leerEntorno lee el navegador (jsdom) sin datos de la persona', () => {
    const entorno = leerEntorno();
    expect(Object.keys(entorno).sort()).toEqual(['alto', 'ancho', 'enLinea', 'idioma', 'userAgent']);
    expect(typeof entorno.userAgent).toBe('string');
  });
});

describe('versión de la app', () => {
  it('solo un hash corto o "local"', () => {
    expect(leerVersion('abc1234')).toBe('abc1234');
    for (const raro of [undefined, '', 'ABC1234', 'abc12345', 'abc123', '<script>', 'local ']) expect(leerVersion(raro), String(raro)).toBe('local');
  });

  it('en las pruebas (sin la constante de build) es "local"', () => {
    expect(armarContexto(ENTORNO, []).version).toBe('local');
  });
});
