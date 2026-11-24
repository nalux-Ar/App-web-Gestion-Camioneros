import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { MAX_GASTOS_POR_CARGA } from './constants';
import * as textos from './gasto-varios-textos';

// Los textos de «Nuevo gasto» con varias categorías. Fijan DOS cosas que una prueba de comportamiento no ve: el idioma de la app (español
// neutro de «tú», nunca voseo, y en palabras de todos los días, sin nombres técnicos) y la instrucción de seguridad («revisa la lista de
// Gastos»: evita volver a anotar algo que quizás ya se guardó).

/** Todo texto que sale de este archivo: los de texto fijo y lo que dan las funciones con datos de ejemplo. */
function todosLosTextos(): Array<{ nombre: string; texto: string }> {
  const fijos = (Object.entries(textos) as Array<[string, unknown]>)
    .filter((par): par is [string, string] => typeof par[1] === 'string')
    .map(([nombre, texto]) => ({ nombre, texto }));
  const deFunciones = [
    { nombre: 'botonGuardarGastos(2)', texto: textos.botonGuardarGastos(2) },
    { nombre: 'botonGuardarGastos(10)', texto: textos.botonGuardarGastos(10) },
    { nombre: 'unirNombres(2)', texto: textos.unirNombres(['Combustible', 'Peajes']) },
    { nombre: 'unirNombres(3)', texto: textos.unirNombres(['Combustible', 'Peajes', 'Gastos varios']) },
    { nombre: 'anuncioDeGastos(1)', texto: textos.anuncioDeGastos(['Peajes']) },
    { nombre: 'anuncioDeGastos(2)', texto: textos.anuncioDeGastos(['Combustible', 'Peajes']) },
    { nombre: 'etiquetaMetodoDePago', texto: textos.etiquetaMetodoDePago('Peajes') },
    { nombre: 'textoGastosGuardados(3)', texto: textos.textoGastosGuardados(3) },
  ];
  return [...fijos, ...deFunciones];
}

/** Voseo y formas que no son del español neutro de «tú». */
const FORMAS_DE_VOSEO = [
  'vos', 'sos', 'acá', 'ponés', 'tenés', 'querés', 'podés', 'sabés', 'andás', 'venís', 'decís', 'hacés', 'necesitás', 'elegís', 'marcás',
  'empezá', 'revisá', 'volvé', 'hacé', 'tocá', 'elegí', 'mirá', 'escribí', 'guardá', 'cargá', 'intentá', 'esperá', 'probá', 'fijate',
  'andá', 'salí', 'entrá', 'seleccioná', 'confirmá', 'dejá', 'tené', 'pasá', 'poné', 'decime', 'avisá', 'completá', 'agregá', 'borrá',
  'eliminá', 'cambiá', 'buscá', 'usá', 'abrí', 'cerrá', 'continuá', 'seguí', 'tomá', 'sacá', 'marcá', 'desmarcá', 'ingresá', 'repetí', 'corregí',
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
  /\bbloques?\b/i,
  /\bidempoten/i,
  /\bsql\b/i,
  /\bsupabase\b/i,
  /\bpostgres\b/i,
  /\b2\d{4}\b/, // un código de error de la base (23505 y similares)
  /_/, // un nombre técnico con guion bajo
];

const sinLetraAlrededor = (palabra: string) => new RegExp(`(?<![\\p{L}])${palabra}(?![\\p{L}])`, 'iu');
const formasDeVoseoEn = (texto: string) => FORMAS_DE_VOSEO.filter((forma) => sinLetraAlrededor(forma).test(texto));

describe('el texto exacto de «Nuevo gasto» con varias categorías', () => {
  it('la ayuda de las categorías y el tope', () => {
    expect(textos.AYUDA_VARIAS_CATEGORIAS).toBe('Puedes marcar más de una: cada una se guarda como un gasto.');
    expect(textos.AVISO_TOPE_DE_CATEGORIAS).toBe(`Marcaste el máximo: ${MAX_GASTOS_POR_CARGA} categorías por vez. Desmarca una para elegir otra.`);
  });

  it('el aviso de las categorías fijas dice que ya se intentó y cómo salir', () => {
    expect(textos.AVISO_CATEGORIAS_FIJAS).toBe('Ya intentamos guardar. Para cambiar las categorías, empieza de nuevo.');
  });

  it('tras un intento de UN gasto: para cambiar la categoría hay que desmarcar la actual y marcar otra, y para sumar otra hay que empezar de nuevo', () => {
    expect(textos.AVISO_CATEGORIA_CAMBIABLE).toBe(
      'Ya intentamos guardar. Para cambiar la categoría, desmarca la actual y marca otra; para sumar otra, empieza de nuevo.',
    );
    // dice PRIMERO que hay que desmarcar la actual (las demás casillas están apagadas hasta entonces) y después marcar la otra
    expect(textos.AVISO_CATEGORIA_CAMBIABLE).toContain('desmarca la actual y marca otra');
    expect(textos.AVISO_CATEGORIA_CAMBIABLE.indexOf('desmarca la actual')).toBeLessThan(textos.AVISO_CATEGORIA_CAMBIABLE.indexOf('marca otra'));
    expect(textos.AVISO_CATEGORIA_CAMBIABLE).toContain('para sumar otra, empieza de nuevo');
    // No es el del tope de 10 ni el de las categorías totalmente fijas: dice lo contrario de «fijas»
    expect(textos.AVISO_CATEGORIA_CAMBIABLE).not.toBe(textos.AVISO_CATEGORIAS_FIJAS);
    expect(textos.AVISO_CATEGORIA_CAMBIABLE).not.toMatch(/máximo/i);
  });

  it('«Empezar de nuevo» y su confirmación en dos toques', () => {
    expect(textos.EMPEZAR_DE_NUEVO).toBe('Empezar de nuevo');
    expect(textos.CONFIRMAR_EMPEZAR_DE_NUEVO).toBe('Sí, empezar de nuevo');
    expect(textos.CANCELAR_EMPEZAR_DE_NUEVO).toBe('Cancelar');
  });

  it('la pregunta manda a REVISAR LA LISTA DE GASTOS antes de empezar de nuevo, porque lo anterior pudo guardarse (seguridad de los datos)', () => {
    expect(textos.PREGUNTA_EMPEZAR_DE_NUEVO).toBe('Antes de empezar de nuevo, revisa la lista de Gastos: puede que ya se hayan guardado.');
    expect(textos.PREGUNTA_EMPEZAR_DE_NUEVO).toMatch(/revisa la lista de Gastos/);
    expect(textos.PREGUNTA_EMPEZAR_DE_NUEVO.search(/revisa la lista de Gastos/)).toBeLessThan(textos.PREGUNTA_EMPEZAR_DE_NUEVO.search(/puede que ya se hayan guardado/));
  });

  it('el botón de guardar con la cantidad', () => {
    expect(textos.botonGuardarGastos(2)).toBe('Guardar 2 gastos');
    expect(textos.botonGuardarGastos(7)).toBe('Guardar 7 gastos');
  });

  it('el anuncio para el lector de pantalla: cuántos gastos y de qué categorías', () => {
    expect(textos.anuncioDeGastos(['Combustible', 'Peajes'])).toBe('Vas a guardar 2 gastos: Combustible y Peajes.');
    expect(textos.anuncioDeGastos(['Combustible', 'Peajes', 'Gastos varios'])).toBe('Vas a guardar 3 gastos: Combustible, Peajes y Gastos varios.');
    expect(textos.anuncioDeGastos(['Peajes'])).toBe('Vas a guardar 1 gasto: Peajes.');
    expect(textos.anuncioDeGastos([])).toBe('');
  });

  it('unirNombres: uno solo, dos con «y», tres o más con comas y «y»', () => {
    expect(textos.unirNombres([])).toBe('');
    expect(textos.unirNombres(['A'])).toBe('A');
    expect(textos.unirNombres(['A', 'B'])).toBe('A y B');
    expect(textos.unirNombres(['A', 'B', 'C', 'D'])).toBe('A, B, C y D');
  });

  it('el método de pago de cada gasto lleva el nombre de su categoría, y los títulos de la parte de abajo', () => {
    expect(textos.etiquetaMetodoDePago('Peajes')).toBe('Método de pago de Peajes');
    expect(textos.TITULO_COMO_PAGASTE).toBe('¿Cómo pagaste cada gasto?');
    expect(textos.TITULO_DATOS_DEL_COMBUSTIBLE).toBe('Datos del combustible');
  });

  it('el aviso al volver: «Guardaste N gastos.»', () => {
    expect(textos.textoGastosGuardados(2)).toBe('Guardaste 2 gastos.');
    expect(textos.textoGastosGuardados(10)).toBe('Guardaste 10 gastos.');
  });
});

describe('el idioma de los textos', () => {
  it('hay textos que revisar', () => {
    expect(todosLosTextos().length).toBeGreaterThanOrEqual(15);
  });

  it('español neutro de «tú»: nunca voseo', () => {
    for (const { nombre, texto } of todosLosTextos()) expect(formasDeVoseoEn(texto), `${nombre}: ${texto}`).toEqual([]);
  });

  it('usa las formas de «tú» que se esperan (empieza, revisa, desmarca, puedes)', () => {
    expect(textos.AVISO_CATEGORIAS_FIJAS).toContain('empieza');
    expect(textos.AVISO_CATEGORIA_CAMBIABLE).toContain('desmarca');
    expect(textos.AVISO_CATEGORIA_CAMBIABLE).toContain('marca otra');
    expect(textos.AVISO_CATEGORIA_CAMBIABLE).toContain('empieza');
    expect(textos.PREGUNTA_EMPEZAR_DE_NUEVO).toContain('revisa');
    expect(textos.AVISO_TOPE_DE_CATEGORIAS).toContain('Desmarca');
    expect(textos.AYUDA_VARIAS_CATEGORIAS).toContain('Puedes');
  });

  it('el detector de voseo detecta lo que tiene que detectar (y no confunde «marcaste» ni «empieza»)', () => {
    for (const mal of ['Empezá de nuevo', 'Revisá la lista', 'Podés marcar más de una', 'Tenés que elegir', 'Elegí una categoría', 'Marcá una categoría', 'Vos elegís']) {
      expect(formasDeVoseoEn(mal), mal).not.toEqual([]);
    }
    for (const bien of ['Empieza de nuevo', 'Revisa la lista', 'Puedes marcar más de una', 'Marcaste el máximo', 'Desmarca una']) {
      expect(formasDeVoseoEn(bien), bien).toEqual([]);
    }
  });

  it('palabras de todos los días: nada de «lote», «client_ref», «transacción» ni códigos de la base', () => {
    for (const { nombre, texto } of todosLosTextos()) {
      for (const jerga of JERGA) expect(texto, `${nombre} (${jerga})`).not.toMatch(jerga);
    }
  });

  it('el detector de jerga detecta lo que tiene que detectar', () => {
    for (const mal of ['Se guardó el lote', 'client_ref repetido', 'La transacción falló', 'Error 23505', 'Cada bloque se guarda']) {
      expect(JERGA.some((jerga) => jerga.test(mal)), mal).toBe(true);
    }
  });

  it('con tildes donde corresponden y sin «$» ni marcado escritos a mano', () => {
    const sinTilde = /(?<![\p{L}])(categoria|categorias|metodo|cuantos|mas|asi|aqui|despues|maximo)(?![\p{L}])/iu;
    for (const { nombre, texto } of todosLosTextos()) {
      expect(texto, nombre).not.toMatch(sinTilde);
      expect(texto, nombre).not.toMatch(/[<>$]|&\w+;|\*\*/);
    }
  });

  it('palabras del oficio: dice «anotar» y «guardar», no «cargar» un gasto', () => {
    for (const { nombre, texto } of todosLosTextos()) expect(texto, nombre).not.toMatch(/(?<![\p{L}])(cargar|carga|cargas|cargaste|cargado)(?![\p{L}])/iu);
  });
});

describe('los componentes nuevos no escriben textos a mano', () => {
  const textosSueltos = (fuente: string): string[] => {
    const codigo = ts.createSourceFile('archivo.tsx', fuente, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
    const sueltos: string[] = [];
    const tieneLetras = (texto: string) => /\p{L}{2,}/u.test(texto);
    const visitar = (nodo: ts.Node): void => {
      if (ts.isJsxText(nodo) && tieneLetras(nodo.text)) sueltos.push(nodo.text.trim());
      if (ts.isJsxAttribute(nodo) && ['aria-label', 'title', 'placeholder', 'alt'].includes(nodo.name.getText(codigo)) && nodo.initializer && ts.isStringLiteral(nodo.initializer)) {
        sueltos.push(`${nodo.name.getText(codigo)}="${nodo.initializer.text}"`);
      }
      ts.forEachChild(nodo, visitar);
    };
    visitar(codigo);
    return sueltos;
  };

  it('«Empezar de nuevo» saca todos sus textos de gasto-varios-textos.ts', () => {
    expect(textosSueltos(readFileSync('src/features/gastos/empezar-de-nuevo.tsx', 'utf8'))).toEqual([]);
  });

  /** Los textos que el código escribe (literales y texto entre etiquetas), sin los comentarios. */
  const literalesDelCodigo = (fuente: string): string[] => {
    const codigo = ts.createSourceFile('archivo.tsx', fuente, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
    const literales: string[] = [];
    const visitar = (nodo: ts.Node): void => {
      if (ts.isStringLiteral(nodo) || ts.isNoSubstitutionTemplateLiteral(nodo) || ts.isJsxText(nodo)) literales.push(nodo.text);
      if (ts.isTemplateHead(nodo) || ts.isTemplateMiddle(nodo) || ts.isTemplateTail(nodo)) literales.push(nodo.text);
      ts.forEachChild(nodo, visitar);
    };
    visitar(codigo);
    return literales;
  };

  it('el formulario no escribe a mano los textos nuevos: salen de gasto-varios-textos.ts', () => {
    const literales = literalesDelCodigo(readFileSync('src/features/gastos/gasto-formulario.tsx', 'utf8')).join('\n');
    for (const texto of ['Puedes marcar', 'Ya intentamos', 'Empezar de nuevo', 'Vas a guardar', 'Guardaste', 'Método de pago de', '¿Cómo pagaste', 'Datos del combustible', 'Marcaste el máximo', ' gastos']) {
      expect(literales, texto).not.toContain(texto);
    }
  });

  it('el buscador de textos del código mira los literales y no los comentarios', () => {
    expect(literalesDelCodigo('// Empezar de nuevo\nconst a = "Guardaste"; const b = <p>Hola</p>;')).toEqual(['Guardaste', 'Hola']);
  });

  it('el detector de textos sueltos encuentra el texto escrito a mano', () => {
    expect(textosSueltos('const a = <button>Empezar</button>;')).toEqual(['Empezar']);
    expect(textosSueltos('const a = <input aria-label="Marcar gasto" />;')).toEqual(['aria-label="Marcar gasto"']);
    expect(textosSueltos('const a = <p className="text-base">{TEXTO}</p>;')).toEqual([]);
  });
});
