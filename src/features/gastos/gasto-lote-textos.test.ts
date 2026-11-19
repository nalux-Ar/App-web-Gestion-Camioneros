import { describe, expect, it } from 'vitest';

import { GUARDAR_GASTO_CONTEXT } from '@/features/gastos/constants';
import { LOTE_DISTINTO, LoteDeGastosDistintoError } from '@/features/gastos/gasto-lote-errores';
import * as textosDelLote from '@/features/gastos/gasto-lote-textos';
import { GUARDAR_LOTE_CONTEXT, LOTE_DISTINTO_MESSAGE, LOTE_NO_ENCONTRADO_MESSAGE } from '@/features/gastos/gasto-lote-textos';
import { RecordNotFoundError, isRetryableDataError, mapDataError, type DataErrorContext } from '@/lib/data-errors';

// Los textos de los errores de guardar varios gastos de una vez. Fijan DOS cosas que una prueba de comportamiento no ve: la instrucción
// de seguridad («revisa la lista de Gastos»: evita que se vuelva a cargar algo que quizás ya se guardó) y el idioma de la app
// (español neutro de «tú», nunca voseo; en palabras de todos los días, sin nombres técnicos).

/** Todo texto que sale de este archivo: los `export const` de tipo texto y los valores de texto del contexto de errores. */
function valoresDeTexto(valor: unknown, camino = ''): Array<[string, string]> {
  if (typeof valor === 'string') return [[camino, valor]];
  if (typeof valor !== 'object' || valor === null) return [];
  return Object.entries(valor).flatMap(([clave, hijo]) => valoresDeTexto(hijo, camino === '' ? clave : `${camino}.${clave}`));
}

const TEXTOS_EXPORTADOS = (Object.entries(textosDelLote) as Array<[string, unknown]>).filter(
  (par): par is [string, string] => typeof par[1] === 'string',
);
const TEXTOS_DEL_CONTEXTO = valoresDeTexto(GUARDAR_LOTE_CONTEXT, 'GUARDAR_LOTE_CONTEXT');
/** Lo que ve el usuario: cada texto exportado y cada texto del contexto (sin repetir el mismo texto con otro nombre). */
const TODOS_LOS_TEXTOS = [...TEXTOS_EXPORTADOS.map(([nombre, texto]) => ({ nombre, texto })), ...TEXTOS_DEL_CONTEXTO.map(([nombre, texto]) => ({ nombre, texto }))];

/** Voseo y formas que no son del español neutro de «tú». */
const FORMAS_DE_VOSEO = [
  'vos', 'sos', 'acá', 'ponés', 'tenés', 'querés', 'podés', 'sabés', 'andás', 'venís', 'decís', 'hacés', 'necesitás',
  'empezá', 'revisá', 'volvé', 'hacé', 'tocá', 'elegí', 'mirá', 'escribí', 'guardá', 'cargá', 'intentá', 'esperá', 'probá', 'fijate',
  'andá', 'salí', 'entrá', 'seleccioná', 'confirmá', 'dejá', 'tené', 'pasá', 'poné', 'decime', 'avisá', 'completá', 'agregá', 'borrá',
  'eliminá', 'cambiá', 'buscá', 'usá', 'abrí', 'cerrá', 'continuá', 'seguí', 'tomá', 'sacá', 'marcá', 'ingresá', 'repetí', 'corregí',
] as const;

/** Nombres técnicos y de la jerga del desarrollo que no tienen que aparecer: se dice con palabras de todos los días. */
const JERGA = [
  /cargar varios/i,
  /\blotes?\b/i,
  /client[_ -]?ref/i,
  /\bconstraint\b/i,
  /\b[ií]ndices?\b/i,
  /\binsert\b/i,
  /\bupdate\b/i,
  /\buuid\b/i,
  /\bhuellas?\b/i,
  /\btransacci[oó]n\b/i,
  /\bsql\b/i,
  /\bsupabase\b/i,
  /\bpostgres\b/i,
  /\b2\d{4}\b/, // un código de error de la base (23505 y similares)
  /_/, // un nombre técnico con guion bajo (lote_de_gastos_distinto)
];

/** El contexto sin esas claves (para comparar todo lo demás). */
const sinLasClaves = (contexto: DataErrorContext, claves: readonly string[]) =>
  Object.fromEntries(Object.entries(contexto).filter(([clave]) => !claves.includes(clave)));

const sinLetraAlrededor = (palabra: string) => new RegExp(`(?<![\\p{L}])${palabra}(?![\\p{L}])`, 'iu');

/** Las formas de voseo que aparecen en el texto (en minúsculas), sin repetir. */
function formasDeVoseoEn(texto: string): string[] {
  return FORMAS_DE_VOSEO.filter((forma) => sinLetraAlrededor(forma).test(texto));
}

describe('el texto exacto de los errores del lote', () => {
  it('LOTE_DISTINTO_MESSAGE: dice qué pasó y qué hacer, y manda a revisar la lista antes de volver a cargar', () => {
    expect(LOTE_DISTINTO_MESSAGE).toBe(
      'Antes se intentó guardar con otras categorías y no sabemos si llegó. Empieza de nuevo y revisa la lista de Gastos antes de volver a cargar.',
    );
  });

  it('LOTE_NO_ENCONTRADO_MESSAGE: dice que uno de los gastos ya no está y manda a revisar la lista antes de volver a cargarlos', () => {
    expect(LOTE_NO_ENCONTRADO_MESSAGE).toBe('Uno de los gastos que se había guardado ya no está. Revisa la lista de Gastos antes de volver a cargarlos.');
  });

  it('los dos mandan a «revisar la lista de Gastos»: es lo que evita volver a cargar lo que quizás ya se guardó (seguridad de los datos)', () => {
    for (const texto of [LOTE_DISTINTO_MESSAGE, LOTE_NO_ENCONTRADO_MESSAGE]) {
      expect(texto).toMatch(/revisa la lista de Gastos/i);
      // Y la instrucción va ANTES de «volver a cargar»: primero mirar, después cargar.
      expect(texto.search(/revisa la lista de Gastos/i)).toBeLessThan(texto.search(/volver a cargar/i));
    }
  });

  it('los dos son frases completas, sin espacios de más y terminadas en punto, y son distintos entre sí', () => {
    for (const texto of [LOTE_DISTINTO_MESSAGE, LOTE_NO_ENCONTRADO_MESSAGE]) {
      expect(texto).toBe(texto.trim());
      expect(texto).not.toContain('  ');
      expect(texto.endsWith('.')).toBe(true);
      expect(texto.length).toBeGreaterThan(40);
    }
    expect(LOTE_DISTINTO_MESSAGE).not.toBe(LOTE_NO_ENCONTRADO_MESSAGE);
  });
});

describe('GUARDAR_LOTE_CONTEXT usa esos textos y conserva el contexto de un gasto solo', () => {
  it('el texto del conjunto distinto está en messagesByConstraint[LOTE_DISTINTO] y es el exportado', () => {
    expect(GUARDAR_LOTE_CONTEXT.messagesByConstraint?.[LOTE_DISTINTO]).toBe(LOTE_DISTINTO_MESSAGE);
  });

  it('«ya no está» es el texto en plural del lote y no el de un gasto solo (que manda a tocar «Guardar gasto»)', () => {
    expect(GUARDAR_LOTE_CONTEXT.notFound).toBe(LOTE_NO_ENCONTRADO_MESSAGE);
    expect(GUARDAR_LOTE_CONTEXT.notFound).not.toBe(GUARDAR_GASTO_CONTEXT.notFound);
    expect(GUARDAR_LOTE_CONTEXT.notFound).not.toContain('Guardar gasto');
  });

  it('conserva TODO lo demás del contexto de un gasto solo, tal cual (viaje, categoría y demás claves)', () => {
    const restoDelGastoSolo = sinLasClaves(GUARDAR_GASTO_CONTEXT, ['messagesByConstraint', 'notFound']);
    const restoDelLote = sinLasClaves(GUARDAR_LOTE_CONTEXT, ['messagesByConstraint', 'notFound']);
    expect(restoDelLote).toEqual(restoDelGastoSolo);
    expect(Object.keys(restoDelLote).length).toBeGreaterThanOrEqual(2); // hay algo que comparar (el contexto base no está vacío)
    // Y no agrega claves nuevas: las mismas que las del gasto solo.
    expect(Object.keys(GUARDAR_LOTE_CONTEXT).sort()).toEqual(Object.keys(GUARDAR_GASTO_CONTEXT).sort());
  });

  it('conserva los mensajes por constraint del gasto solo (camión, archivado, otro camión, carga sin camión) y suma uno: el del conjunto distinto', () => {
    const delGastoSolo = GUARDAR_GASTO_CONTEXT.messagesByConstraint ?? {};
    expect(Object.keys(delGastoSolo).length).toBeGreaterThanOrEqual(4);
    expect(GUARDAR_LOTE_CONTEXT.messagesByConstraint).toEqual({ ...delGastoSolo, [LOTE_DISTINTO]: LOTE_DISTINTO_MESSAGE });
    expect(Object.keys(GUARDAR_LOTE_CONTEXT.messagesByConstraint ?? {})).toHaveLength(Object.keys(delGastoSolo).length + 1);
  });

  it('el contexto es un objeto distinto del de un gasto solo: sumar el texto del lote no cambia el de un gasto solo', () => {
    expect(GUARDAR_LOTE_CONTEXT).not.toBe(GUARDAR_GASTO_CONTEXT);
    expect(GUARDAR_LOTE_CONTEXT.messagesByConstraint).not.toBe(GUARDAR_GASTO_CONTEXT.messagesByConstraint);
    expect(GUARDAR_GASTO_CONTEXT.messagesByConstraint).not.toHaveProperty(LOTE_DISTINTO);
  });

  it('lo que ve el usuario: el conjunto distinto y «ya no está» muestran esos textos, y ninguno de los dos se reintenta', () => {
    const distinto = new LoteDeGastosDistintoError();
    expect(mapDataError(distinto, GUARDAR_LOTE_CONTEXT)).toBe(LOTE_DISTINTO_MESSAGE);
    expect(isRetryableDataError(distinto, GUARDAR_LOTE_CONTEXT)).toBe(false);
    expect(mapDataError(new RecordNotFoundError(), GUARDAR_LOTE_CONTEXT)).toBe(LOTE_NO_ENCONTRADO_MESSAGE);
    // El texto interno del error (`message`) no es el que se muestra: nunca llega a la pantalla.
    expect(mapDataError(distinto, GUARDAR_LOTE_CONTEXT)).not.toContain(LOTE_DISTINTO);
  });
});

describe('el idioma de los textos: español neutro de «tú», nunca voseo', () => {
  it('hay textos que revisar (la prueba no queda vacía si se renombran los exports): los dos exportados y los del contexto', () => {
    expect(TEXTOS_EXPORTADOS.map(([nombre]) => nombre).sort()).toEqual(['LOTE_DISTINTO_MESSAGE', 'LOTE_NO_ENCONTRADO_MESSAGE']);
    expect(TEXTOS_DEL_CONTEXTO.length).toBeGreaterThanOrEqual(8);
    expect(TODOS_LOS_TEXTOS.length).toBeGreaterThanOrEqual(10);
  });

  it('ningún texto (los exportados ni los del contexto) tiene formas de voseo', () => {
    for (const { nombre, texto } of TODOS_LOS_TEXTOS) {
      expect(formasDeVoseoEn(texto), `${nombre}: «${texto}»`).toEqual([]);
    }
  });

  it('ningún texto dice «acá»: se usa «aquí»', () => {
    for (const { nombre, texto } of TODOS_LOS_TEXTOS) {
      expect(texto, nombre).not.toMatch(/(?<![\p{L}])acá(?![\p{L}])/iu);
    }
  });

  it('el detector de voseo funciona: encuentra las formas con voseo (también con mayúscula inicial y junto a signos) y no marca el español neutro', () => {
    expect(formasDeVoseoEn('Empezá de nuevo y revisá la lista.')).toEqual(['empezá', 'revisá']);
    expect(formasDeVoseoEn('¿Vos tenés el comprobante? Tocá acá.')).toEqual(['vos', 'acá', 'tenés', 'tocá']);
    expect(formasDeVoseoEn('Elegí otro; volvé más tarde, hacé la prueba.')).toEqual(['volvé', 'hacé', 'elegí']);
    expect(formasDeVoseoEn(LOTE_DISTINTO_MESSAGE)).toEqual([]);
    expect(formasDeVoseoEn('Empieza de nuevo y revisa la lista. Toca aquí, elige otro y vuelve más tarde. Tú puedes.')).toEqual([]);
    // Una forma de voseo dentro de otra palabra no cuenta: «sos» en «sosegado», «vos» en «voseo».
    expect(formasDeVoseoEn('Un ambiente sosegado, sin voseo.')).toEqual([]);
  });
});

describe('palabras de todos los días: ningún texto nombra algo técnico', () => {
  it('ningún texto dice «cargar varios», «lote», «client_ref» ni nombres técnicos', () => {
    for (const { nombre, texto } of TODOS_LOS_TEXTOS) {
      for (const termino of JERGA) {
        expect(texto, `${nombre} contiene ${String(termino)}`).not.toMatch(termino);
      }
    }
  });

  it('el detector de jerga funciona: marca lo técnico y no marca los textos de la app', () => {
    const marcado = (texto: string) => JERGA.some((termino) => termino.test(texto));
    for (const jerga of ['Se guardó el lote.', 'Falló el client_ref.', 'Quieres cargar varios gastos.', 'Error 23505.', 'violates constraint', 'lote_de_gastos_distinto']) {
      expect(marcado(jerga), jerga).toBe(true);
    }
    for (const { texto } of TODOS_LOS_TEXTOS) expect(marcado(texto), texto).toBe(false);
  });

  it('los textos del contexto son un texto completo (no vacíos ni con el nombre de la clave en lugar del texto)', () => {
    for (const [nombre, texto] of TEXTOS_DEL_CONTEXTO) {
      expect(texto.trim().length, nombre).toBeGreaterThan(10);
      expect(texto, nombre).toBe(texto.trim());
    }
  });
});
