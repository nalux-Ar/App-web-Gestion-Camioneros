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

/// Los pasos salen de `pasosDelTour(reportarVisible)`, una función pura: los dos estados de «Reportar un problema»
// (`reportar-config.ts`) se prueban aquí sin recargar módulos. `TOUR_PASOS` es lo mismo con el interruptor real.

/** Palabras de un texto: lo que queda al cortar por espacios («Ayuda» entre comillas cuenta como UNA). */
const contarPalabras = (texto: string) => texto.trim().split(/\s+/).filter(Boolean).length;
/** Cada texto del recorrido tiene hasta 15 palabras: lo lee gente mayor, a veces con sol de frente. */
const MAX_PALABRAS = 15;
/** Voseo y «acá»: palabras enteras (con letras acentuadas \b no sirve). */
const VOSEO = /(?<![\p{L}])(?:acá|vos|tenés|podés|querés|elegís|fijate|mirá|tocá|escribí|elegí|contanos|anotá|usá|andá|sos|hacé)(?![\p{L}])/iu;

describe('los pasos del recorrido', () => {
  it.each([
    [true, 5],
    [false, 4],
  ])('con «Reportar un problema» visible = %s: %i pasos, ids únicos, objetivos válidos para data-ayuda, textos planos de "tú"', (visible, cantidad) => {
    const pasos = pasosDelTour(visible);
    expect(pasos).toHaveLength(cantidad);
    expect(new Set(pasos.map((p) => p.id)).size).toBe(cantidad);
    for (const paso of pasos) {
      if (paso.objetivo !== null) expect(paso.objetivo).toMatch(/^[a-z0-9-]{1,40}$/);
      expect(`${paso.titulo} ${paso.texto}`).not.toMatch(/<|>/);
      expect(`${paso.titulo} ${paso.texto}`, paso.id).not.toMatch(VOSEO);
    }
  });

  it('ENCENDIDO: 5 pasos en este orden (invitación, barra, camión, reportar, cierre), cada uno con su objetivo y su regla `siFalta`', () => {
    const pasos = pasosDelTour(true);
    expect(pasos.map((p) => p.id)).toEqual(['bienvenida', 'barra', 'camion', 'reportar', 'cierre']);
    expect(pasos.map((p) => p.objetivo)).toEqual([null, 'nav', 'camion', 'reportar', 'ayuda-inicio']);
    // La invitación y el cierre van centrados si falta su objetivo; los de en medio se saltean.
    expect(pasos.map((p) => p.siFalta)).toEqual(['centrado', 'saltar', 'saltar', 'saltar', 'centrado']);
    expect(pasos[3]).toEqual({
      id: 'reportar',
      objetivo: 'reportar',
      titulo: 'Reportar un problema',
      texto: 'Si algo falla o se ve raro, cuéntanos desde aquí.',
      siFalta: 'saltar',
    });
  });

  it('APAGADO: los mismos pasos sin el de Reportar, en el mismo orden y sin tocar ninguno de los otros', () => {
    const pasos = pasosDelTour(false);
    expect(pasos.map((p) => p.id)).toEqual(['bienvenida', 'barra', 'camion', 'cierre']);
    expect(pasos.map((p) => p.objetivo)).toEqual([null, 'nav', 'camion', 'ayuda-inicio']);
    expect(pasos).toEqual(pasosDelTour(true).filter((p) => p.id !== 'reportar'));
    expect(pasos.at(-1)).toMatchObject({ id: 'cierre', siFalta: 'centrado' });
    // Ni el paso ni una mención suelta: nada del recorrido manda a una función oculta.
    expect(pasos.some((p) => p.id === 'reportar' || p.objetivo === 'reportar')).toBe(false);
    expect(pasos.map((p) => `${p.titulo} ${p.texto}`).join(' ')).not.toMatch(/Reportar/i);
  });

  it('los títulos y los textos son los aprobados, palabra por palabra', () => {
    expect(pasosDelTour(true).map((p) => [p.titulo, p.texto])).toEqual([
      ['¿Te mostramos cómo se usa?', 'Son pocos pasos. Después puedes verlo otra vez desde «Ayuda».'],
      ['Para ir a cada parte', 'Desde esta barra vas a Viajes, Gastos, Clientes y Resumen.'],
      ['Tu camión', 'Se usa en tus viajes y gastos. Si tienes varios, elige aquí cuál.'],
      ['Reportar un problema', 'Si algo falla o se ve raro, cuéntanos desde aquí.'],
      ['Si necesitas ayuda', 'Toca «Ayuda»: ahí puedes ver este recorrido otra vez.'],
    ]);
  });

  it.each([true, false])('con Reportar visible = %s: cada texto tiene hasta 15 palabras (y cada título, hasta 6)', (visible) => {
    for (const paso of pasosDelTour(visible)) {
      expect(contarPalabras(paso.texto), `${paso.id}: «${paso.texto}»`).toBeLessThanOrEqual(MAX_PALABRAS);
      expect(contarPalabras(paso.titulo), `${paso.id}: «${paso.titulo}»`).toBeLessThanOrEqual(6);
    }
  });

  it('el contador de palabras de la prueba cuenta como se espera (una frase de 16 se pasaría)', () => {
    expect(contarPalabras('uno  dos\ttres\n')).toBe(3);
    expect(contarPalabras('Toca «Ayuda»: ahí puedes ver este recorrido otra vez.')).toBe(9);
    expect(contarPalabras(Array.from({ length: 16 }, () => 'a').join(' '))).toBeGreaterThan(MAX_PALABRAS);
  });

  it('SOLO el primer paso es una invitación (con «Sí» y «Ahora no»); los demás llevan «Siguiente» o «Listo»', () => {
    for (const visible of [true, false]) {
      const pasos = pasosDelTour(visible);
      expect(pasos[0]).toMatchObject({ id: 'bienvenida', objetivo: null, invitacion: true });
      expect(pasos.slice(1).some((p) => p.invitacion === true)).toBe(false);
    }
  });

  it('el cierre manda a tocar «Ayuda» (no la «i») y ningún paso usa las palabras viejas: «cargar» un dato, «odómetro»', () => {
    const pasos = pasosDelTour(true);
    expect(pasos.at(-1)).toMatchObject({ titulo: 'Si necesitas ayuda', texto: 'Toca «Ayuda»: ahí puedes ver este recorrido otra vez.' });
    for (const paso of pasos) {
      const texto = `${paso.titulo} ${paso.texto}`;
      expect(texto, paso.id).not.toMatch(/«i»|"i"|odómetro/i);
      // «cargas de combustible» (la del tanque) es palabra del oficio y se queda.
      expect(texto.replace(/cargas? de combustible/gi, ''), paso.id).not.toMatch(/\bcarg(?:ar|as?|aste|ado|ada|ados|adas)\b/i);
    }
  });

  it('el recorrido ya NO tiene un paso por sección ni el de Configuración (se recortó de 9 a lo esencial)', () => {
    for (const visible of [true, false]) {
      const pasos = pasosDelTour(visible);
      const objetivos = pasos.map((p) => p.objetivo);
      for (const viejo of ['nav-viajes', 'nav-gastos', 'nav-clientes', 'nav-resumen', 'nav-configuracion']) expect(objetivos).not.toContain(viejo);
      for (const viejo of ['viajes', 'gastos', 'clientes', 'resumen', 'configuracion']) expect(pasos.map((p) => p.id)).not.toContain(viejo);
    }
  });

  it('`TOUR_PASOS` (lo que usa la app) es `pasosDelTour` con el interruptor real', () => {
    expect(TOUR_PASOS).toEqual(pasosDelTour(REPORTAR_VISIBLE));
  });
});

describe('la versión del recorrido', () => {
  // El recorrido se acortó de 9 a 4 pasos SIN subir la versión, a propósito: quien ya vio el recorrido largo (`miembros.tour_version_vista`
  // = 1) no lo repite. Solo lo ven los usuarios nuevos y quien lo pide desde «Ayuda». Si algún día se sube, es una decisión: vuelve a
  // mostrarlo a TODOS (y esta prueba tiene que cambiar a propósito).
  it('TOUR_VERSION sigue en 1: quien ya vio el recorrido de 9 pasos no lo ve de nuevo', () => {
    expect(TOUR_VERSION).toBe(1);
    expect(debeMostrarseElTour({ status: 'ready', pathname: '/', versionBase: 1, versionLocal: 0 })).toBe(false);
    expect(debeMostrarseElTour({ status: 'ready', pathname: '/', versionBase: 0, versionLocal: 1 })).toBe(false);
    // ...y un usuario nuevo (versión 0) sí lo ve.
    expect(debeMostrarseElTour({ status: 'ready', pathname: '/', versionBase: 0, versionLocal: 0 })).toBe(true);
  });
});
