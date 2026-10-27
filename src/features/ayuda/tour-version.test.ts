import { beforeEach, describe, expect, it } from 'vitest';

import { TOUR_PASOS } from './tour-pasos';
import {
  debeMostrarseElTour,
  debeReintentarGuardar,
  guardarTourVistoLocal,
  leerTourVistoLocal,
  limpiarTourVistoLocal,
  normalizarVersion,
  TOUR_VERSION,
  versionVista,
} from './tour-version';

const STORAGE = 'elan:tour-visto';

beforeEach(() => {
  localStorage.clear();
});

describe('normalizarVersion', () => {
  it('enteros >= 0 tal cual; todo lo demás es 0', () => {
    expect(normalizarVersion(0)).toBe(0);
    expect(normalizarVersion(3)).toBe(3);
    for (const raro of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '1', null, undefined, {}, [1], true]) {
      expect(normalizarVersion(raro), String(raro)).toBe(0);
    }
  });
});

describe('copia local de la versión vista', () => {
  it('guarda { userId, version } y la lee SOLO para ese usuario', () => {
    guardarTourVistoLocal('user-a', 1);
    expect(JSON.parse(localStorage.getItem(STORAGE)!)).toEqual({ userId: 'user-a', version: 1 });
    expect(leerTourVistoLocal('user-a')).toBe(1);
    expect(leerTourVistoLocal('user-b')).toBe(0);
    expect(leerTourVistoLocal(null)).toBe(0);
  });

  it('nunca baja (guardar 1 con la 2 ya guardada deja la 2)', () => {
    guardarTourVistoLocal('user-a', 2);
    guardarTourVistoLocal('user-a', 1);
    expect(leerTourVistoLocal('user-a')).toBe(2);
  });

  it('un dato roto o raro se lee como 0', () => {
    for (const raw of ['no es json', '"texto"', 'null', '{"userId":"user-a","version":"1"}', '{"userId":"user-a","version":-3}', '{"version":1}']) {
      localStorage.setItem(STORAGE, raw);
      expect(leerTourVistoLocal('user-a'), raw).toBe(0);
    }
  });

  it('limpiar la borra', () => {
    guardarTourVistoLocal('user-a', 1);
    limpiarTourVistoLocal();
    expect(localStorage.getItem(STORAGE)).toBeNull();
  });

  it('sin storage (bloqueado), no tira', () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error('bloqueado');
    };
    expect(() => guardarTourVistoLocal('user-a', 1)).not.toThrow();
    Storage.prototype.setItem = original;
  });
});

describe('reconciliación base / local', () => {
  it('versionVista: la mayor de las dos', () => {
    expect(versionVista(0, 1)).toBe(1);
    expect(versionVista(2, 1)).toBe(2);
    expect(versionVista(-1, Number.NaN)).toBe(0);
  });

  it('debeReintentarGuardar: solo si lo local quedó adelante', () => {
    expect(debeReintentarGuardar(0, 1)).toBe(true);
    expect(debeReintentarGuardar(1, 1)).toBe(false);
    expect(debeReintentarGuardar(2, 1)).toBe(false);
  });
});

describe('debeMostrarseElTour', () => {
  const base = { status: 'ready' as const, pathname: '/', versionBase: 0, versionLocal: 0 };

  it('miembro listo, en Inicio y sin la versión actual vista: sí', () => {
    expect(debeMostrarseElTour(base)).toBe(true);
  });

  it('ya vista (en la base o en la copia local): no', () => {
    expect(debeMostrarseElTour({ ...base, versionBase: TOUR_VERSION })).toBe(false);
    expect(debeMostrarseElTour({ ...base, versionLocal: TOUR_VERSION })).toBe(false);
  });

  it('una versión NUEVA vuelve a mostrarlo', () => {
    expect(debeMostrarseElTour({ ...base, versionBase: 1, actual: 2 })).toBe(true);
  });

  it.each(['/viajes', '/bienvenida', '/restablecer-contrasena', '/configuracion', '', '/?x=1'])('fuera de Inicio (%s): no', (pathname) => {
    expect(debeMostrarseElTour({ ...base, pathname })).toBe(false);
  });

  it.each(['idle', 'loading', 'no-member', 'error'] as const)('sin miembro listo (%s): no', (status) => {
    expect(debeMostrarseElTour({ ...base, status })).toBe(false);
  });
});

describe('los 9 pasos', () => {
  it('9 pasos, ids únicos, objetivos válidos para data-ayuda, textos planos de "tú"', () => {
    expect(TOUR_PASOS).toHaveLength(9);
    expect(new Set(TOUR_PASOS.map((p) => p.id)).size).toBe(9);
    for (const paso of TOUR_PASOS) {
      if (paso.objetivo !== null) expect(paso.objetivo).toMatch(/^[a-z0-9-]{1,40}$/);
      expect(`${paso.titulo} ${paso.texto}`).not.toMatch(/<|>|Acá|acá|\bvos\b/);
    }
  });

  it('bienvenida centrada; navegación, camión, configuración y reportar; cierre centrado si falta su objetivo', () => {
    expect(TOUR_PASOS.map((p) => p.objetivo)).toEqual([
      null,
      'nav-viajes',
      'nav-gastos',
      'nav-clientes',
      'nav-resumen',
      'camion',
      'nav-configuracion',
      'reportar',
      'ayuda-inicio',
    ]);
    expect(TOUR_PASOS[0]).toMatchObject({ titulo: 'Te mostramos la app', texto: 'Son pocos pasos. Puedes saltarlo cuando quieras.' });
    expect(TOUR_PASOS[8]!.siFalta).toBe('centrado');
    expect(TOUR_PASOS[2]!.texto).toContain('el odómetro (los kilómetros del tablero)');
  });
});
