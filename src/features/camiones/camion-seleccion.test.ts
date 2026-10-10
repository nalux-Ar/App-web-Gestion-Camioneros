import { describe, expect, it } from 'vitest';

import type { CamionDeLista } from '@/features/camiones/camion';
import {
  AYUDA_ES_EL_ACTIVO,
  AYUDA_SUGERIR_ACTIVO,
  CAMION_CREAR_MESSAGE,
  CAMION_FALTA_MESSAGE,
  camionDelViajeArchivadoMessage,
  camionElegido,
  combinarCamiones,
  decidirCamion,
  domIdDelCamion,
  resolverCamion,
  type ContextoCamion,
  type DecidirCamionArgs,
  type DecisionCamion,
  type DecisionElegir,
  type ModoRegistro,
} from '@/features/camiones/camion-seleccion';

const c = (id: string, patente: string, activa = true): CamionDeLista => ({ id, patente, marca: null, modelo: null, anio: null, activa });
const A = c('a', 'AA111AA');
const B = c('b', 'BB222BB');
const C = c('c', 'CC333CC');
const D = c('d', 'DD444DD');
const E = c('e', 'EE555EE');
const X = c('x', 'XX999XX', false); // archivado

const ids = (decision: DecisionCamion) => (decision.tipo === 'elegir' ? decision.opciones.map((camion) => camion.id) : null);
const pre = (decision: DecisionCamion) => (decision.tipo === 'elegir' ? (decision.preseleccionado?.id ?? null) : undefined);
const elegir = (decision: DecisionCamion): DecisionElegir => {
  if (decision.tipo !== 'elegir') throw new Error(`se esperaba elegir y es ${decision.tipo}`);
  return decision;
};

/** Valores por defecto: viaje nuevo, sin camión activo guardado. */
const decidir = (over: Partial<DecidirCamionArgs> & Pick<DecidirCamionArgs, 'camiones'>) =>
  decidirCamion({ original: null, contexto: 'viaje', modo: 'nuevo', camionActivoId: null, ...over });

// ---------------------------------------------------------------------------
// Matriz completa: contexto x modo x cantidad de activos x camión activo x camión original x viaje con camión
// ---------------------------------------------------------------------------
type EstadoActivo = 'ninguno' | 'valido' | 'archivado' | 'inexistente';
type EstadoOriginal = 'ninguno' | 'activo' | 'archivado' | 'desconocido';

const ACTIVOS = [A, B, C, D, E];

interface Escenario {
  contexto: ContextoCamion;
  modo: ModoRegistro;
  n: 0 | 1 | 2 | 5;
  activo: EstadoActivo;
  original: EstadoOriginal;
  delViaje: boolean;
}

function argsDe(e: Escenario): DecidirCamionArgs {
  const activos = ACTIVOS.slice(0, e.n);
  // El camión activo válido es el ÚLTIMO activo y el original activo es el PRIMERO: así, con 2 o más, son distintos y se
  // ve cuál gana.
  const camionActivoId = { ninguno: null, valido: activos.at(-1)?.id ?? null, archivado: X.id, inexistente: 'borrado' }[e.activo];
  const original = { ninguno: null, activo: activos[0]?.id ?? null, archivado: X.id, desconocido: 'perdido' }[e.original];
  return {
    camiones: [...activos].reverse().concat(X), // desordenados a propósito: la decisión ordena
    original,
    camionDelViaje: e.delViaje ? B.id : null,
    contexto: e.contexto,
    modo: e.modo,
    camionActivoId,
  };
}

/** Las reglas aprobadas de la Etapa 5c, escritas de nuevo (sin mirar la implementación) para cotejar la matriz entera. */
function esperado(e: Escenario, args: DecidirCamionArgs): { tipo: DecisionCamion['tipo']; opciones?: string[]; pre?: string | null; ayuda?: string | null } {
  if (e.contexto === 'combustible' && e.delViaje) return { tipo: 'del-viaje' };
  const activos = ACTIVOS.slice(0, e.n).map((camion) => camion.id);
  const propio = e.modo === 'edicion' ? args.original : null;
  const propioArchivado = propio !== null && !activos.includes(propio);
  if (propioArchivado) return { tipo: 'elegir', opciones: [propio, ...activos], pre: propio, ayuda: null };
  if (e.n === 0) return { tipo: e.contexto === 'combustible' ? 'crear' : 'ninguno' };
  if (e.n === 1) return { tipo: 'auto' };
  if (e.modo === 'edicion') return { tipo: 'elegir', opciones: activos, pre: propio, ayuda: null };
  const valido = args.camionActivoId !== null && activos.includes(args.camionActivoId) ? args.camionActivoId : null;
  return { tipo: 'elegir', opciones: activos, pre: valido, ayuda: valido ? 'es-el-activo' : 'sugerir-activo' };
}

const ESCENARIOS: Escenario[] = [];
for (const contexto of ['viaje', 'combustible'] as const) {
  for (const modo of ['nuevo', 'edicion'] as const) {
    for (const n of [0, 1, 2, 5] as const) {
      for (const activo of ['ninguno', 'valido', 'archivado', 'inexistente'] as const) {
        for (const original of ['ninguno', 'activo', 'archivado', 'desconocido'] as const) {
          for (const delViaje of [false, true]) {
            if (n === 0 && (activo === 'valido' || original === 'activo')) continue; // sin activos no existen
            ESCENARIOS.push({ contexto, modo, n, activo, original, delViaje });
          }
        }
      }
    }
  }
}

describe('decidirCamion: la matriz completa contra las reglas aprobadas', () => {
  it(`cubre ${ESCENARIOS.length} combinaciones`, () => {
    expect(ESCENARIOS.length).toBeGreaterThan(400);
  });

  it.each(ESCENARIOS.map((e) => [JSON.stringify(e), e] as const))('%s', (_nombre, e) => {
    const args = argsDe(e);
    const decision = decidirCamion(args);
    const esp = esperado(e, args);
    expect(decision.tipo).toBe(esp.tipo);
    if (decision.tipo === 'elegir') {
      expect(ids(decision)).toEqual(esp.opciones);
      expect(pre(decision)).toBe(esp.pre);
      expect(decision.ayuda).toBe(esp.ayuda);
      expect(decision.control).toBe(decision.opciones.length <= 4 ? 'botones' : 'lista');
      // El precompletado siempre es una de las opciones, y en un registro NUEVO nunca es un archivado.
      if (decision.preseleccionado) expect(decision.opciones).toContain(decision.preseleccionado);
      if (e.modo === 'nuevo' && decision.preseleccionado) expect(decision.preseleccionado.activa).toBe(true);
    }
    if (decision.tipo === 'auto') expect(decision.camion).toBe(A);
    if (decision.tipo === 'del-viaje') expect(decision.camionId).toBe(B.id);
  });

  it('en un registro EDITADO el camión activo nunca cuenta (cualquiera da lo mismo)', () => {
    for (const e of ESCENARIOS.filter((esc) => esc.modo === 'edicion')) {
      const args = argsDe(e);
      const base = decidirCamion({ ...args, camionActivoId: null });
      for (const camionActivoId of [A.id, B.id, E.id, X.id, 'borrado']) {
        expect(decidirCamion({ ...args, camionActivoId }), JSON.stringify({ e, camionActivoId })).toEqual(base);
      }
    }
  });

  it('en un registro NUEVO el original nunca cuenta (un registro nuevo no tiene camión propio)', () => {
    for (const e of ESCENARIOS.filter((esc) => esc.modo === 'nuevo')) {
      const args = argsDe(e);
      expect(decidirCamion(args), JSON.stringify(e)).toEqual(decidirCamion({ ...args, original: null }));
    }
  });

  it('en Combustible, ninguna combinación resuelve una carga SIN camión', () => {
    for (const e of ESCENARIOS.filter((esc) => esc.contexto === 'combustible')) {
      const decision = decidirCamion(argsDe(e));
      for (const valor of ['', A.id, B.id, X.id, 'inventado']) {
        const r = resolverCamion(decision, valor);
        if (r.ok) expect(r.camionId, JSON.stringify({ e, valor })).not.toBeNull();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Casos explícitos (los de la especificación, legibles)
// ---------------------------------------------------------------------------
describe('decidirCamion: VIAJE', () => {
  it('0 camiones (o solo archivados): nada que mostrar, el viaje va sin camión', () => {
    expect(decidir({ camiones: [] })).toEqual({ tipo: 'ninguno' });
    expect(decidir({ camiones: [X] })).toEqual({ tipo: 'ninguno' });
    expect(decidir({ camiones: [X], camionActivoId: X.id })).toEqual({ tipo: 'ninguno' });
  });

  it('1 activo: se asigna solo (auto, visible), aunque haya archivados o un camión activo guardado obsoleto', () => {
    expect(decidir({ camiones: [A] })).toEqual({ tipo: 'auto', camion: A });
    expect(decidir({ camiones: [X, A] })).toEqual({ tipo: 'auto', camion: A });
    expect(decidir({ camiones: [X, A], camionActivoId: X.id })).toEqual({ tipo: 'auto', camion: A });
    expect(decidir({ camiones: [A], camionActivoId: 'borrado' })).toEqual({ tipo: 'auto', camion: A });
  });

  it('1 activo y el viaje (editado) ya lo tenía: auto con ese', () => {
    expect(decidir({ camiones: [A], original: 'a', modo: 'edicion' })).toEqual({ tipo: 'auto', camion: A });
  });

  it('viaje NUEVO, 2 activos y camión activo válido: precompletado con él (ayuda "es tu camión activo")', () => {
    const d = elegir(decidir({ camiones: [B, A], camionActivoId: 'b' }));
    expect(ids(d)).toEqual(['a', 'b']);
    expect(d.preseleccionado).toBe(B);
    expect(d.ayuda).toBe('es-el-activo');
    expect(d.control).toBe('botones');
  });

  it('viaje NUEVO, 2 activos sin camión activo: sin preselección (ayuda "puedes dejar uno en Inicio")', () => {
    const d = elegir(decidir({ camiones: [B, A] }));
    expect(d.preseleccionado).toBeNull();
    expect(d.ayuda).toBe('sugerir-activo');
  });

  it('viaje NUEVO, el camión activo guardado está ARCHIVADO o ya no existe: como si no hubiera (obsoleto)', () => {
    for (const camionActivoId of [X.id, 'borrado']) {
      const d = elegir(decidir({ camiones: [A, B, X], camionActivoId }));
      expect(d.preseleccionado, camionActivoId).toBeNull();
      expect(d.ayuda).toBe('sugerir-activo');
      expect(ids(d)).toEqual(['a', 'b']); // el archivado no se ofrece
    }
  });

  it('viaje EDITADO con su camión activo y otro más: precompletado con el SUYO, aunque el camión activo sea otro', () => {
    const d = elegir(decidir({ camiones: [A, B], original: 'a', modo: 'edicion', camionActivoId: 'b' }));
    expect(d.preseleccionado).toBe(A);
    expect(d.ayuda).toBeNull();
  });

  it('viaje EDITADO viejo SIN camión, 2 activos: NO se precompleta (ni con el camión activo): se elige', () => {
    const d = elegir(decidir({ camiones: [A, B], original: null, modo: 'edicion', camionActivoId: 'b' }));
    expect(d.preseleccionado).toBeNull();
    expect(d.ayuda).toBeNull(); // la sugerencia es solo para registros nuevos
  });

  it('el viaje (editado) ya tenía un camión ARCHIVADO: elegir, con ese primero y precompletado', () => {
    const d = elegir(decidir({ camiones: [A, X], original: 'x', modo: 'edicion', camionActivoId: 'a' }));
    expect(ids(d)).toEqual(['x', 'a']);
    expect(d.preseleccionado).toBe(X);
    // Aun con 0 activos: se muestra el archivado (no se reasigna en silencio ni desaparece).
    expect(ids(decidir({ camiones: [X], original: 'x', modo: 'edicion' }))).toEqual(['x']);
  });

  it('archivado + 4 activos = 5 elegibles: lista desplegable', () => {
    expect(decidir({ camiones: [A, B, C, D, X], original: 'x', modo: 'edicion' })).toMatchObject({ tipo: 'elegir', control: 'lista' });
  });

  it('hasta 4 elegibles son botones; desde 5, lista desplegable', () => {
    expect(decidir({ camiones: [A, B, C, D] })).toMatchObject({ control: 'botones' });
    expect(decidir({ camiones: [A, B, C, D, E], camionActivoId: 'e' })).toMatchObject({ control: 'lista', preseleccionado: E });
  });

  it('un camión que el viaje tenía y no está en la lista se conserva como "no disponible"', () => {
    const d = elegir(decidir({ camiones: [A], original: 'perdido', modo: 'edicion' }));
    expect(ids(d)).toEqual(['perdido', 'a']);
    expect(d.opciones[0]).toMatchObject({ id: 'perdido', patente: '', activa: false });
    expect(d.preseleccionado?.id).toBe('perdido');
  });

  it('el viaje NO mira el camión de ningún viaje (solo combustible)', () => {
    expect(decidir({ camiones: [A, B], camionDelViaje: 'a' })).toMatchObject({ tipo: 'elegir' });
  });
});

describe('decidirCamion: COMBUSTIBLE', () => {
  const comb = (over: Partial<DecidirCamionArgs> & Pick<DecidirCamionArgs, 'camiones'>) => decidir({ contexto: 'combustible', ...over });

  it('0 camiones activos: hay que cargar uno (con litros hace falta camión), con o sin camión activo guardado', () => {
    expect(comb({ camiones: [] })).toEqual({ tipo: 'crear' });
    expect(comb({ camiones: [X], camionActivoId: X.id })).toEqual({ tipo: 'crear' });
  });

  it('1 activo: auto; 2 con activo válido: precompletado; 5: lista', () => {
    expect(comb({ camiones: [A] })).toEqual({ tipo: 'auto', camion: A });
    expect(comb({ camiones: [A, B], camionActivoId: 'a' })).toMatchObject({ tipo: 'elegir', control: 'botones', preseleccionado: A });
    expect(comb({ camiones: [A, B, C, D, E] })).toMatchObject({ control: 'lista', preseleccionado: null });
  });

  it('con un viaje que tiene camión: ESE camión, bloqueado (aunque haya otros y un camión activo distinto)', () => {
    expect(comb({ camiones: [A, B], camionDelViaje: 'b', camionActivoId: 'a' })).toEqual({
      tipo: 'del-viaje',
      camionId: 'b',
      camion: B,
      archivadoNuevo: false,
    });
  });

  it('el viaje tiene un camión archivado y la carga es nueva: no se puede guardar (archivadoNuevo)', () => {
    expect(comb({ camiones: [A, X], camionDelViaje: 'x' })).toMatchObject({ tipo: 'del-viaje', archivadoNuevo: true });
  });

  it('la carga YA tenía ese camión archivado (es el del viaje): se puede seguir editando', () => {
    expect(comb({ camiones: [A, X], original: 'x', camionDelViaje: 'x', modo: 'edicion' })).toMatchObject({
      tipo: 'del-viaje',
      archivadoNuevo: false,
    });
  });

  it('el camión del viaje no está en la lista: del-viaje con camion null', () => {
    expect(comb({ camiones: [A], camionDelViaje: 'z' })).toEqual({ tipo: 'del-viaje', camionId: 'z', camion: null, archivadoNuevo: false });
  });

  it('un viaje SIN camión no bloquea nada: decide como si no hubiera viaje', () => {
    expect(comb({ camiones: [A, B], camionDelViaje: null, camionActivoId: 'b' })).toMatchObject({ tipo: 'elegir', preseleccionado: B });
    expect(comb({ camiones: [], camionDelViaje: null })).toEqual({ tipo: 'crear' });
  });

  it('una carga vieja (editada) con camión archivado y sin viaje: lo conserva entre las opciones, precompletado', () => {
    const d = elegir(comb({ camiones: [A, B, X], original: 'x', modo: 'edicion' }));
    expect(ids(d)).toEqual(['x', 'a', 'b']);
    expect(d.preseleccionado).toBe(X);
  });
});

// ---------------------------------------------------------------------------
// camionElegido y resolverCamion
// ---------------------------------------------------------------------------
describe('camionElegido (lo que vale ahora en `elegir`)', () => {
  const conPre = elegir(decidir({ camiones: [A, B], camionActivoId: 'b' }));
  const sinPre = elegir(decidir({ camiones: [A, B] }));

  it('sin tocar nada: el precompletado (o nada)', () => {
    expect(camionElegido(conPre, '')).toBe(B);
    expect(camionElegido(sinPre, '')).toBeNull();
  });

  it('lo elegido en pantalla gana sobre el precompletado', () => {
    expect(camionElegido(conPre, 'a')).toBe(A);
    expect(camionElegido(sinPre, 'a')).toBe(A);
  });

  it('un valor que no es una de las opciones no vale (aunque haya precompletado)', () => {
    expect(camionElegido(conPre, 'x')).toBeNull();
    expect(camionElegido(conPre, 'inventado')).toBeNull();
  });
});

describe('resolverCamion (lo que se manda a la base)', () => {
  it('ninguno: null; auto: el único activo (lo del formulario no cuenta)', () => {
    expect(resolverCamion({ tipo: 'ninguno' }, '')).toEqual({ ok: true, camionId: null });
    expect(resolverCamion({ tipo: 'auto', camion: A }, '')).toEqual({ ok: true, camionId: 'a' });
    expect(resolverCamion({ tipo: 'auto', camion: A }, 'b')).toEqual({ ok: true, camionId: 'a' });
  });

  it('elegir CON precompletado: sin tocar nada manda el precompletado; lo elegido, si es una opción', () => {
    const d = decidir({ camiones: [A, B], camionActivoId: 'b' });
    expect(resolverCamion(d, '')).toEqual({ ok: true, camionId: 'b' });
    expect(resolverCamion(d, 'a')).toEqual({ ok: true, camionId: 'a' });
    expect(resolverCamion(d, 'x')).toEqual({ ok: false, message: CAMION_FALTA_MESSAGE }); // archivado que no es el original
    expect(resolverCamion(d, 'inventado')).toEqual({ ok: false, message: CAMION_FALTA_MESSAGE });
  });

  it('elegir SIN precompletado: sin elegir, "Elige el camión."', () => {
    const d = decidir({ camiones: [A, B] });
    expect(resolverCamion(d, '')).toEqual({ ok: false, message: CAMION_FALTA_MESSAGE });
    expect(resolverCamion(d, 'b')).toEqual({ ok: true, camionId: 'b' });
  });

  it('editado con el archivado original: conservarlo (sin tocar o eligiéndolo) es válido', () => {
    const d = decidir({ camiones: [A, X], original: 'x', modo: 'edicion' });
    expect(resolverCamion(d, '')).toEqual({ ok: true, camionId: 'x' });
    expect(resolverCamion(d, 'x')).toEqual({ ok: true, camionId: 'x' });
    expect(resolverCamion(d, 'a')).toEqual({ ok: true, camionId: 'a' });
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

  it('los textos de ayuda', () => {
    expect(AYUDA_ES_EL_ACTIVO).toBe('Es tu camión activo. Si lo cambias aquí, solo cambia en este registro.');
    expect(AYUDA_SUGERIR_ACTIVO).toBe('Puedes dejar un camión activo en Inicio para no elegirlo cada vez.');
  });
});

describe('domIdDelCamion y combinarCamiones', () => {
  it('el foco va al primer botón, a la lista o al bloque (en `elegir`, siempre a las opciones)', () => {
    expect(domIdDelCamion('viaje-camion', decidir({ camiones: [A, B] }))).toBe('viaje-camion-0');
    expect(domIdDelCamion('viaje-camion', decidir({ camiones: [A, B], camionActivoId: 'a' }))).toBe('viaje-camion-0');
    expect(domIdDelCamion('viaje-camion', decidir({ camiones: [A, B, C, D, E] }))).toBe('viaje-camion');
    expect(domIdDelCamion('gasto-camion', { tipo: 'crear' })).toBe('gasto-camion-bloque');
    expect(domIdDelCamion('gasto-camion', { tipo: 'auto', camion: A })).toBe('gasto-camion-bloque');
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
    // Y entonces se puede usar: con él hay 1 activo.
    expect(decidir({ camiones: combinarCamiones([conMarca], [reactivado]), contexto: 'combustible' })).toMatchObject({
      tipo: 'auto',
      camion: { id: 'x', activa: true },
    });
  });

  it('un creado nunca archiva uno que la lista trae activo', () => {
    expect(combinarCamiones([A], [{ ...A, activa: false }])).toEqual([A]);
  });
});
