import { describe, expect, it } from 'vitest';

import type { CamionDeLista } from '@/features/camiones/camion';
import {
  CAMION_CREAR_MESSAGE,
  CAMION_FALTA_MESSAGE,
  camionDelViajeArchivadoMessage,
  combinarCamiones,
  decidirCamion,
  domIdDelCamion,
  resolverCamion,
  type DecisionCamion,
} from '@/features/camiones/camion-seleccion';

const c = (id: string, patente: string, activa = true): CamionDeLista => ({ id, patente, marca: null, modelo: null, anio: null, activa });
const A = c('a', 'AA111AA');
const B = c('b', 'BB222BB');
const C = c('c', 'CC333CC');
const D = c('d', 'DD444DD');
const E = c('e', 'EE555EE');
const X = c('x', 'XX999XX', false); // archivado

const ids = (decision: DecisionCamion) => (decision.tipo === 'elegir' ? decision.opciones.map((camion) => camion.id) : null);

describe('decidirCamion: VIAJE', () => {
  it('0 camiones (o solo archivados): nada que mostrar, el viaje va sin camión', () => {
    expect(decidirCamion({ camiones: [], original: null, contexto: 'viaje' })).toEqual({ tipo: 'ninguno' });
    expect(decidirCamion({ camiones: [X], original: null, contexto: 'viaje' })).toEqual({ tipo: 'ninguno' });
  });

  it('1 activo: se asigna solo (aunque haya archivados)', () => {
    expect(decidirCamion({ camiones: [A], original: null, contexto: 'viaje' })).toEqual({ tipo: 'auto', camion: A });
    expect(decidirCamion({ camiones: [X, A], original: null, contexto: 'viaje' })).toEqual({ tipo: 'auto', camion: A });
  });

  it('1 activo y el viaje ya lo tenía: se conserva (auto con ese)', () => {
    expect(decidirCamion({ camiones: [A], original: 'a', contexto: 'viaje' })).toEqual({ tipo: 'auto', camion: A });
  });

  it('2 activos: elegir con botones, SIN preselección, ordenados por patente', () => {
    const decision = decidirCamion({ camiones: [B, A], original: null, contexto: 'viaje' });
    expect(decision).toMatchObject({ tipo: 'elegir', control: 'botones' });
    expect(ids(decision)).toEqual(['a', 'b']);
  });

  it('hasta 4 elegibles son botones; desde 5, lista desplegable', () => {
    expect(decidirCamion({ camiones: [A, B, C, D], original: null, contexto: 'viaje' })).toMatchObject({ control: 'botones' });
    expect(decidirCamion({ camiones: [A, B, C, D, E], original: null, contexto: 'viaje' })).toMatchObject({ control: 'lista' });
  });

  it('los archivados NO se ofrecen (salvo el que el viaje ya tenía)', () => {
    expect(ids(decidirCamion({ camiones: [A, X, B], original: null, contexto: 'viaje' }))).toEqual(['a', 'b']);
  });

  it('el viaje ya tenía un camión ARCHIVADO: elegir, con ese primero (se conserva) y los activos después', () => {
    expect(ids(decidirCamion({ camiones: [A, X], original: 'x', contexto: 'viaje' }))).toEqual(['x', 'a']);
    // Aun con 0 activos: se muestra el archivado (no se reasigna en silencio ni desaparece).
    expect(ids(decidirCamion({ camiones: [X], original: 'x', contexto: 'viaje' }))).toEqual(['x']);
  });

  it('archivado + 4 activos = 5 elegibles: lista desplegable', () => {
    expect(decidirCamion({ camiones: [A, B, C, D, X], original: 'x', contexto: 'viaje' })).toMatchObject({ tipo: 'elegir', control: 'lista' });
  });

  it('un camión que el viaje tenía y no está en la lista se conserva como "no disponible"', () => {
    const decision = decidirCamion({ camiones: [A], original: 'perdido', contexto: 'viaje' });
    expect(ids(decision)).toEqual(['perdido', 'a']);
    expect(decision.tipo === 'elegir' && decision.opciones[0]).toMatchObject({ id: 'perdido', patente: '', activa: false });
  });

  it('el viaje NO mira el camión de ningún viaje (solo combustible)', () => {
    expect(decidirCamion({ camiones: [A, B], original: null, camionDelViaje: 'a', contexto: 'viaje' })).toMatchObject({ tipo: 'elegir' });
  });
});

describe('decidirCamion: COMBUSTIBLE', () => {
  it('0 camiones activos: hay que cargar uno (con litros hace falta camión)', () => {
    expect(decidirCamion({ camiones: [], original: null, contexto: 'combustible' })).toEqual({ tipo: 'crear' });
    expect(decidirCamion({ camiones: [X], original: null, contexto: 'combustible' })).toEqual({ tipo: 'crear' });
  });

  it('1 activo: auto; 2: elegir sin preselección; 5: lista', () => {
    expect(decidirCamion({ camiones: [A], original: null, contexto: 'combustible' })).toEqual({ tipo: 'auto', camion: A });
    expect(decidirCamion({ camiones: [A, B], original: null, contexto: 'combustible' })).toMatchObject({ tipo: 'elegir', control: 'botones' });
    expect(decidirCamion({ camiones: [A, B, C, D, E], original: null, contexto: 'combustible' })).toMatchObject({ control: 'lista' });
  });

  it('con un viaje que tiene camión: ESE camión, bloqueado (aunque haya otros)', () => {
    expect(decidirCamion({ camiones: [A, B], original: null, camionDelViaje: 'b', contexto: 'combustible' })).toEqual({
      tipo: 'del-viaje',
      camionId: 'b',
      camion: B,
      archivadoNuevo: false,
    });
  });

  it('el viaje tiene un camión archivado y la carga es nueva: no se puede guardar (archivadoNuevo)', () => {
    expect(decidirCamion({ camiones: [A, X], original: null, camionDelViaje: 'x', contexto: 'combustible' })).toMatchObject({
      tipo: 'del-viaje',
      archivadoNuevo: true,
    });
  });

  it('la carga YA tenía ese camión archivado (es el del viaje): se puede seguir editando', () => {
    expect(decidirCamion({ camiones: [A, X], original: 'x', camionDelViaje: 'x', contexto: 'combustible' })).toMatchObject({
      tipo: 'del-viaje',
      archivadoNuevo: false,
    });
  });

  it('el camión del viaje no está en la lista: del-viaje con camion null', () => {
    expect(decidirCamion({ camiones: [A], original: null, camionDelViaje: 'z', contexto: 'combustible' })).toEqual({
      tipo: 'del-viaje',
      camionId: 'z',
      camion: null,
      archivadoNuevo: false,
    });
  });

  it('un viaje SIN camión no bloquea nada: decide como si no hubiera viaje', () => {
    expect(decidirCamion({ camiones: [A, B], original: null, camionDelViaje: null, contexto: 'combustible' })).toMatchObject({ tipo: 'elegir' });
    expect(decidirCamion({ camiones: [], original: null, camionDelViaje: null, contexto: 'combustible' })).toEqual({ tipo: 'crear' });
  });

  it('una carga vieja con camión archivado y sin viaje: lo conserva entre las opciones', () => {
    expect(ids(decidirCamion({ camiones: [A, B, X], original: 'x', contexto: 'combustible' }))).toEqual(['x', 'a', 'b']);
  });
});

describe('resolverCamion (lo que se manda a la base)', () => {
  it('ninguno: null; auto: el único activo', () => {
    expect(resolverCamion({ tipo: 'ninguno' }, '')).toEqual({ ok: true, camionId: null });
    expect(resolverCamion({ tipo: 'auto', camion: A }, '')).toEqual({ ok: true, camionId: 'a' });
    // Lo que diga el formulario no cuenta con auto (no hay nada que elegir).
    expect(resolverCamion({ tipo: 'auto', camion: A }, 'b')).toEqual({ ok: true, camionId: 'a' });
  });

  it('elegir: lo elegido si es una de las opciones; si no, "Elige el camión."', () => {
    const elegir = decidirCamion({ camiones: [A, B], original: null, contexto: 'viaje' });
    expect(resolverCamion(elegir, 'b')).toEqual({ ok: true, camionId: 'b' });
    expect(resolverCamion(elegir, '')).toEqual({ ok: false, message: CAMION_FALTA_MESSAGE });
    expect(resolverCamion(elegir, 'x')).toEqual({ ok: false, message: CAMION_FALTA_MESSAGE }); // un archivado que no es el original
    expect(resolverCamion(elegir, 'inventado')).toEqual({ ok: false, message: CAMION_FALTA_MESSAGE });
  });

  it('elegir con el archivado original: conservarlo es válido', () => {
    const elegir = decidirCamion({ camiones: [A, X], original: 'x', contexto: 'viaje' });
    expect(resolverCamion(elegir, 'x')).toEqual({ ok: true, camionId: 'x' });
  });

  it('del-viaje: el camión del viaje (lo del formulario no cuenta); archivado y nuevo: error', () => {
    expect(resolverCamion({ tipo: 'del-viaje', camionId: 'b', camion: B, archivadoNuevo: false }, 'a')).toEqual({ ok: true, camionId: 'b' });
    const r = resolverCamion({ tipo: 'del-viaje', camionId: 'x', camion: X, archivadoNuevo: true }, '');
    expect(r).toEqual({ ok: false, message: camionDelViajeArchivadoMessage(X) });
    expect(camionDelViajeArchivadoMessage(X)).toBe(
      'El camión de este viaje (XX 999 XX) está archivado: reactívalo desde Camiones o carga el gasto sin viaje.',
    );
  });

  it('crear: error (no se guardan litros sin camión)', () => {
    expect(resolverCamion({ tipo: 'crear' }, '')).toEqual({ ok: false, message: CAMION_CREAR_MESSAGE });
    expect(resolverCamion({ tipo: 'crear' }, 'a')).toEqual({ ok: false, message: CAMION_CREAR_MESSAGE });
  });

  it('en combustible nunca resuelve null (con litros hace falta camión)', () => {
    for (const camiones of [[], [A], [A, B], [X], [A, X]]) {
      for (const valor of ['', 'a', 'b', 'x']) {
        const r = resolverCamion(decidirCamion({ camiones, original: null, contexto: 'combustible' }), valor);
        if (r.ok) expect(r.camionId, JSON.stringify({ camiones, valor })).not.toBeNull();
      }
    }
  });
});

describe('domIdDelCamion y combinarCamiones', () => {
  it('el foco va al primer botón, a la lista o al bloque', () => {
    expect(domIdDelCamion('viaje-camion', decidirCamion({ camiones: [A, B], original: null, contexto: 'viaje' }))).toBe('viaje-camion-0');
    expect(domIdDelCamion('viaje-camion', decidirCamion({ camiones: [A, B, C, D, E], original: null, contexto: 'viaje' }))).toBe('viaje-camion');
    expect(domIdDelCamion('gasto-camion', { tipo: 'crear' })).toBe('gasto-camion-bloque');
    expect(domIdDelCamion('gasto-camion', null)).toBe('gasto-camion-bloque');
  });

  it('suma los creados en la pantalla que la lista todavía no trae, sin repetir (los datos, de la lista)', () => {
    const creado = c('n', 'NN000NN');
    const viejo = { ...A, marca: 'vieja' };
    expect(combinarCamiones([A], [creado]).map((camion) => camion.id)).toEqual(['a', 'n']);
    expect(combinarCamiones([A], [viejo])).toEqual([A]);
  });

  it('uno REACTIVADO en la pantalla que la lista (todavía vieja) trae archivado cuenta como activo, con sus datos de la lista', () => {
    const conMarca = { ...X, marca: 'Fiat' };
    const reactivado = c('x', 'XX999XX', true);
    expect(combinarCamiones([A, conMarca], [reactivado])).toEqual([A, { ...conMarca, activa: true }]);
    // Y entonces se puede usar: con él hay 2 activos.
    expect(decidirCamion({ camiones: combinarCamiones([conMarca], [reactivado]), original: null, contexto: 'combustible' })).toMatchObject({
      tipo: 'auto',
      camion: { id: 'x', activa: true },
    });
  });

  it('un creado nunca archiva uno que la lista trae activo', () => {
    expect(combinarCamiones([A], [{ ...A, activa: false }])).toEqual([A]);
  });
});
