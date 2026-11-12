import { beforeEach, describe, expect, it } from 'vitest';

import { REPORTAR_VISIBLE } from '@/features/reportar/reportar-config';
import { pasosDelTour, TOUR_PASOS } from './tour-pasos';
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

// Los pasos salen de `pasosDelTour(reportarVisible)`, una función pura: los dos estados de «Reportar un problema»
// (`reportar-config.ts`) se prueban aquí sin recargar módulos. `TOUR_PASOS` es lo mismo con el interruptor real.
describe('los pasos del recorrido', () => {
  it.each([
    [true, 9],
    [false, 8],
  ])('con «Reportar un problema» visible = %s: %i pasos, ids únicos, objetivos válidos para data-ayuda, textos planos de "tú"', (visible, cantidad) => {
    const pasos = pasosDelTour(visible);
    expect(pasos).toHaveLength(cantidad);
    expect(new Set(pasos.map((p) => p.id)).size).toBe(cantidad);
    for (const paso of pasos) {
      if (paso.objetivo !== null) expect(paso.objetivo).toMatch(/^[a-z0-9-]{1,40}$/);
      expect(`${paso.titulo} ${paso.texto}`).not.toMatch(/<|>|Acá|acá|\bvos\b/);
    }
  });

  it('ENCENDIDO: el recorrido completo de siempre (bienvenida centrada; navegación, camión, configuración y reportar; cierre centrado si falta su objetivo)', () => {
    const pasos = pasosDelTour(true);
    expect(pasos.map((p) => p.objetivo)).toEqual([
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
    expect(pasos[0]).toMatchObject({ titulo: 'Te mostramos la app', texto: 'Son pocos pasos. Puedes saltarlo cuando quieras.' });
    expect(pasos[7]).toEqual({
      id: 'reportar',
      objetivo: 'reportar',
      titulo: 'Reportar un problema',
      texto: 'Si algo falla o se ve raro, cuéntanos desde aquí.',
      siFalta: 'saltar',
    });
    expect(pasos[8]!.siFalta).toBe('centrado');
    expect(pasos[2]!.texto).toContain('el odómetro (los kilómetros del tablero)');
  });

  it('APAGADO: los mismos pasos sin el de Reportar, en el mismo orden y sin tocar ninguno de los otros', () => {
    const pasos = pasosDelTour(false);
    expect(pasos.map((p) => p.objetivo)).toEqual([
      null,
      'nav-viajes',
      'nav-gastos',
      'nav-clientes',
      'nav-resumen',
      'camion',
      'nav-configuracion',
      'ayuda-inicio',
    ]);
    expect(pasos).toEqual(pasosDelTour(true).filter((p) => p.id !== 'reportar'));
    expect(pasos[0]).toMatchObject({ titulo: 'Te mostramos la app', texto: 'Son pocos pasos. Puedes saltarlo cuando quieras.' });
    expect(pasos.at(-1)).toMatchObject({ id: 'cierre', siFalta: 'centrado' });
    expect(pasos[2]!.texto).toContain('el odómetro (los kilómetros del tablero)');
    // Ni el paso ni una mención suelta: nada del recorrido manda a una función oculta.
    expect(pasos.some((p) => p.id === 'reportar' || p.objetivo === 'reportar')).toBe(false);
    expect(pasos.map((p) => `${p.titulo} ${p.texto}`).join(' ')).not.toMatch(/Reportar/i);
  });

  it('`TOUR_PASOS` (lo que usa la app) es `pasosDelTour` con el interruptor real', () => {
    expect(TOUR_PASOS).toEqual(pasosDelTour(REPORTAR_VISIBLE));
  });
});
