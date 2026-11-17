import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { classifyDataError, DataRequestError, isRetryableDataError, mapDataError } from '@/lib/data-errors';
import { LIST_LIMIT, MAX_GASTOS_POR_VEZ } from './constants';
import * as textos from './quitar-gastos-textos';
import * as textosDeSumar from './sumar-gastos-textos';

// Los textos de «Quitar gastos del viaje»: todos los NUEVOS juntos en un archivo, para que la responsable los revise de un vistazo. Lo
// que es idéntico a «Sumar» (`VOLVER_AL_VIAJE`, `textoTotalMarcado`…) lo toma la pantalla de `sumar-gastos-textos.ts`.

/** Todo lo que el archivo de textos exporta como texto fijo, más lo que devuelven sus funciones con valores de ejemplo. */
function todosLosTextos(): string[] {
  const exportados: unknown[] = Object.values(textos); // los textos fijos, las funciones y el contexto: se miran solo los textos
  const fijos = exportados.filter((valor): valor is string => typeof valor === 'string');
  const deContexto = Object.values(textos.QUITAR_GASTOS_CONTEXT).filter((valor): valor is string => typeof valor === 'string');
  const deFunciones = [
    textos.textoMarcarPrimeros(100),
    textos.textoBotonQuitar(0),
    textos.textoBotonQuitar(1),
    textos.textoBotonQuitar(7),
    textos.textoQuitaste(1),
    textos.textoQuitaste(5),
    textos.textoYaNoEstaban(1),
    textos.textoYaNoEstaban(4),
    textos.textoNoSeBorraron(1),
    textos.textoNoSeBorraron(3),
  ];
  return [...fijos, ...deContexto, ...deFunciones];
}

/** Palabras enteras (con letras acentuadas: \b no sirve). */
const palabras = (lista: string) => new RegExp(String.raw`(?<![\p{L}])(?:${lista})(?![\p{L}])`, 'iu');

describe('los textos de «Quitar gastos del viaje»', () => {
  it('los de la pantalla, tal cual los pidió la responsable', () => {
    expect(textos.TITULO_QUITAR_GASTOS).toBe('Quitar gastos del viaje');
    expect(textos.BOTON_ENTRADA_QUITAR_GASTOS).toBe('Quitar gastos del viaje');
    expect(textos.TITULO_SIN_GASTOS_EN_EL_VIAJE).toBe('Este viaje no tiene gastos.');
    expect(textos.TITULO_LISTA_DEL_VIAJE).toBe('Gastos del viaje');
    expect(textos.AYUDA_DE_LA_LISTA_QUITAR).toBe('Marca los que quieres quitar de este viaje.');
    expect(textos.MARCA_ALGUNO_QUITAR).toBe('Marca los que quieres quitar.');
  });

  it('«Quitar N gastos del viaje», con «1 gasto» en singular y, sin nada marcado, sin número', () => {
    expect(textos.textoBotonQuitar(1)).toBe('Quitar 1 gasto del viaje');
    expect(textos.textoBotonQuitar(2)).toBe('Quitar 2 gastos del viaje');
    expect(textos.textoBotonQuitar(100)).toBe('Quitar 100 gastos del viaje');
    expect(textos.textoBotonQuitar(0)).toBe('Quitar gastos del viaje');
    expect(textos.textoBotonQuitar(0)).not.toMatch(/\d/);
  });

  it('mientras corre: «Quitando…» si es ESTE pedido y un texto NEUTRO («Un momento…») si es otra operación (un «Sumar», por ejemplo)', () => {
    expect(textos.QUITANDO).toBe('Quitando…');
    // el neutro es el MISMO que usa «Sumar» (vive en sus textos) y no está repetido en los de «Quitar»
    expect(textosDeSumar.UN_MOMENTO).toBe('Un momento…');
    expect('UN_MOMENTO' in textos).toBe(false);
    // el neutro no dice qué se está haciendo: no puede nombrar ni «Quitar» ni «Sumar»
    expect(textosDeSumar.UN_MOMENTO).not.toMatch(/quit|sum/i);
  });

  it('«Marcar los primeros N» (cuando hay más gastos de los que se pueden quitar por vez)', () => {
    expect(textos.textoMarcarPrimeros(100)).toBe('Marcar los primeros 100');
    expect(textos.textoMarcarPrimeros(3)).toBe('Marcar los primeros 3');
  });

  it('los avisos del tope nombran los topes reales (MAX_GASTOS_POR_VEZ y LIST_LIMIT), no un número suelto', () => {
    expect(textos.AVISO_TOPE_POR_VEZ).toBe(`Puedes quitar hasta ${MAX_GASTOS_POR_VEZ} gastos por vez. Cuando termines, puedes seguir con los demás.`);
    expect(textos.AVISO_TOPE_POR_VEZ).toContain('100');
    expect(textos.AVISO_HAY_MAS_GASTOS).toBe(`Hay más de ${LIST_LIMIT} gastos en este viaje; aquí se ven los ${LIST_LIMIT} más recientes.`);
    expect(textos.AVISO_HAY_MAS_GASTOS).toContain('500');
    expect(textos.AVISO_MAXIMO_MARCADO).toBe(`Marcaste ${MAX_GASTOS_POR_VEZ}, el máximo por vez. Desmarca uno para elegir otro.`);
  });

  it('el resultado: «Quitaste N gastos del viaje.», «K ya no estaban en este viaje.» y la aclaración de que NO se borraron, con el singular de cada uno', () => {
    expect(textos.textoQuitaste(3)).toBe('Quitaste 3 gastos del viaje.');
    expect(textos.textoQuitaste(1)).toBe('Quitaste 1 gasto del viaje.');
    expect(textos.textoYaNoEstaban(2)).toBe('2 ya no estaban en este viaje.');
    expect(textos.textoYaNoEstaban(1)).toBe('1 ya no estaba en este viaje.');
    expect(textos.textoNoSeBorraron(2)).toBe('Los gastos no se borraron: quedaron sin viaje.');
    expect(textos.textoNoSeBorraron(1)).toBe('El gasto no se borró: quedó sin viaje.');
    expect(textos.NINGUNO_QUITADO).toBe('No se quitó ningún gasto.');
  });

  it('la aclaración dice las dos cosas: que NO se borraron y que quedaron SIN VIAJE', () => {
    for (const cantidad of [1, 2, 50]) {
      const texto = textos.textoNoSeBorraron(cantidad);
      expect(texto).toMatch(/no se borr/);
      expect(texto).toMatch(/sin viaje/);
    }
  });

  it('no repite ningún nombre de los textos de «Sumar»: lo idéntico se importa de ahí, no se copia', () => {
    const propios = Object.keys(textos);
    const ajenos = new Set(Object.keys(textosDeSumar));
    expect(propios.filter((nombre) => ajenos.has(nombre))).toEqual([]);
    // y lo que la pantalla reutiliza existe en el archivo de «Sumar»
    for (const nombre of ['VOLVER_AL_VIAJE', 'NOMBRE_GENERICO_DE_GASTO', 'ERROR_CATEGORIAS', 'MARCAR_TODOS_DESMARCADO', 'textoMarcarTodos', 'textoTotalMarcado']) {
      expect(ajenos.has(nombre), nombre).toBe(true);
    }
  });
});

describe('el idioma de los textos', () => {
  it('hay textos para revisar (no se está probando una lista vacía)', () => {
    expect(todosLosTextos().length).toBeGreaterThanOrEqual(22);
  });

  it('español neutro «de tú»: ni voseo ni «acá»', () => {
    const voseo = palabras(
      'acá|vos|tenés|podés|querés|cargás|elegís|fijate|mirá|tocá|escribí|cargá|elegí|contanos|anotá|usá|andá|decime|sos|hacé|ponés|marcá|desmarcá|quitá|sumá|volvé|probá|intentá|esperá|revisá|avisá|buscá|seguí|terminá|marcás|quitás',
    );
    for (const texto of todosLosTextos()) expect(texto).not.toMatch(voseo);
  });

  it('palabras de todos los días: nada de «vincular», «asociar», «lote»…', () => {
    const jerga = palabras('vincular|vinculados?|vinculadas?|vincula|desvincular|desvinculados?|desvincula|asociar|asociados?|asociadas?|desasociar|lote|lotes|batch|ids?|uuid|rpc|selección|seleccionar|seleccionados?|tanda|tandas');
    for (const texto of todosLosTextos()) expect(texto).not.toMatch(jerga);
  });

  it('con acentos donde corresponden (palabras frecuentes escritas sin tilde)', () => {
    const sinTilde = palabras('camion|tambien|aqui|asi|categoria|descripcion|mas|estan|senal|ningun|maximo|quito|borro|quedo|despues|demas|segun');
    for (const texto of todosLosTextos()) expect(texto).not.toMatch(sinTilde);
    expect(textos.NINGUNO_QUITADO).toContain('quitó');
    expect(textos.NINGUNO_QUITADO).toContain('ningún');
    expect(textos.AVISO_MAXIMO_MARCADO).toContain('máximo');
    expect(textos.AVISO_TOPE_POR_VEZ).toContain('demás');
    expect(textos.textoNoSeBorraron(1)).toContain('borró');
    expect(textos.textoNoSeBorraron(1)).toContain('quedó');
  });

  it('sin texto técnico del servidor ni marcado', () => {
    for (const texto of todosLosTextos()) {
      expect(texto).not.toMatch(/[<>]|&\w+;|\*\*|\]\(|PT\d{3}|P0002|23\d{3}|42501|\bPGRST|\bupdate\b|\bdelete\b|\bnull\b/i);
    }
  });

  it('sin símbolo de moneda (los montos van sin «$» en toda la app)', () => {
    for (const texto of todosLosTextos()) expect(texto).not.toMatch(/\$/);
  });

  it('ningún texto habla de «borrar» el gasto en lo que se HACE: quitar NO borra (solo la aclaración lo nombra, para negarlo)', () => {
    const otros = todosLosTextos().filter((texto) => !/no se borr/.test(texto));
    for (const texto of otros) expect(texto).not.toMatch(/borr|elimin/i);
  });
});

describe('los mensajes de error de «Quitar» (QUITAR_GASTOS_CONTEXT + mapDataError)', () => {
  const contexto = textos.QUITAR_GASTOS_CONTEXT;
  const error = (code: string, status?: number, message = 'texto interno del servidor') => new DataRequestError({ code, message }, status);

  it('sin señal y con el tiempo vencido: texto propio, que no nombra ningún botón ni habla de «lo escrito» (no hay nada escrito)', () => {
    const sinSenal = mapDataError(new DataRequestError({ message: 'TypeError: Failed to fetch', code: '' }, 0), contexto);
    expect(sinSenal).toBe('No hay señal. Todavía NO se quitaron. Cuando tengas señal, inténtalo de nuevo.');
    const lento = mapDataError(new DataRequestError({ message: 'TimeoutError: The operation timed out', code: '' }), contexto);
    expect(lento).toBe('La señal está lenta y no sabemos si se quitaron. Revisa el viaje o inténtalo de nuevo: si ya estaban quitados, no pasa nada.');
    for (const texto of [sinSenal, lento]) expect(texto).not.toMatch(/Reintentar|lo escrito|guard/i);
  });

  it('con el tiempo vencido dice que repetirlo no pasa nada (quitar es idempotente), a diferencia de un alta', () => {
    const lento = mapDataError(new DataRequestError({ message: 'TimeoutError: x', code: '' }), contexto);
    expect(lento).toContain('si ya estaban quitados, no pasa nada');
    expect(lento).not.toContain('no se duplica');
  });

  it('el viaje ya no existe (P0002, o un 404): «Este viaje ya no existe.», sin «Reintentar»', () => {
    for (const e of [error('P0002', 500), error('', 404)]) {
      expect(mapDataError(e, contexto)).toBe('Este viaje ya no existe.');
      expect(isRetryableDataError(e, contexto)).toBe(false);
    }
  });

  it('cuenta en solo lectura (PT402 o un 402): el mensaje general de la clase `payment`, sin «Reintentar» y sin el texto del servidor', () => {
    for (const e of [error('PT402', 402), error('', 402)]) {
      expect(classifyDataError(e)).toBe('payment');
      expect(isRetryableDataError(e, contexto)).toBe(false);
      expect(mapDataError(e, contexto)).toBe('Tu cuenta está en modo de solo lectura: por ahora no se pueden guardar cambios.');
      expect(mapDataError(e, contexto)).not.toContain('texto interno');
    }
  });

  it('datos inválidos (22023): un texto que habla de quitar, no el «Revisa los datos que ingresaste» de un formulario; sin «Reintentar»', () => {
    const e = error('22023');
    expect(mapDataError(e, contexto)).toBe('No se pudo quitar. Vuelve al viaje y prueba de nuevo.');
    expect(isRetryableDataError(e, contexto)).toBe(false);
  });

  it('ningún error muestra jamás el texto que manda el servidor', () => {
    const secreto = 'relation "gastos" violates constraint secreto_interno';
    for (const code of ['', 'PT402', 'P0002', '22023', '23503', '42501', '40001', '57014', 'PGRST301', 'XX000']) {
      expect(mapDataError(error(code, undefined, secreto), contexto), code).not.toContain('secreto_interno');
    }
  });

  it('red, tiempo vencido y servidor SÍ se pueden reintentar; no encontrado, permiso, solo lectura y datos inválidos, no', () => {
    expect(isRetryableDataError(new DataRequestError({ message: 'TypeError: Failed to fetch', code: '' }, 0), contexto)).toBe(true);
    expect(isRetryableDataError(new DataRequestError({ message: 'TimeoutError: x', code: '' }), contexto)).toBe(true);
    expect(isRetryableDataError(error('57014'), contexto)).toBe(true);
    expect(isRetryableDataError(error('42501'), contexto)).toBe(false);
    expect(isRetryableDataError(error('P0002'), contexto)).toBe(false);
    expect(isRetryableDataError(error('PT402', 402), contexto)).toBe(false);
    expect(isRetryableDataError(error('22023'), contexto)).toBe(false);
  });
});

describe('todos los textos visibles están en los archivos de textos (los componentes no escriben los suyos)', () => {
  const ARCHIVOS = ['src/features/gastos/quitar-gastos-page.tsx', 'src/features/gastos/resultado-de-quitar.tsx'];

  /** Los atributos que el lector de pantalla o la vista leen como texto. */
  const ATRIBUTOS_DE_TEXTO = new Set(['aria-label', 'aria-description', 'title', 'placeholder', 'alt', 'label']);
  const tieneLetras = (texto: string) => /\p{L}{2,}/u.test(texto);

  /**
   * Los textos escritos A MANO dentro del JSX de un código, leído con el parser de TypeScript (no con una expresión regular, que
   * confunde un `=>` o un `>` de código con el de una etiqueta): texto entre etiquetas, atributos de texto con un literal, y
   * literales de texto dentro de una expresión que se dibuja (`{cond ? 'Uno' : 'Otro'}`). Quedan afuera lo que no tiene dos letras
   * seguidas (la flecha «→», el punto medio «·» y la «a» suelta que lee el lector de pantalla) y los valores de atributos como
   * `className` o `aria-hidden`, que no son texto.
   */
  function textosSueltos(fuente: string): string[] {
    const codigo = ts.createSourceFile('archivo.tsx', fuente, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
    const sueltos: string[] = [];

    function literalesDeUnaExpresion(nodo: ts.Node): void {
      if (ts.isJsxAttribute(nodo)) return;
      if ((ts.isStringLiteral(nodo) || ts.isNoSubstitutionTemplateLiteral(nodo)) && tieneLetras(nodo.text)) sueltos.push(nodo.text);
      if ((ts.isTemplateHead(nodo) || ts.isTemplateMiddle(nodo) || ts.isTemplateTail(nodo)) && tieneLetras(nodo.text)) sueltos.push(nodo.text);
      ts.forEachChild(nodo, literalesDeUnaExpresion);
    }

    function visitar(nodo: ts.Node): void {
      if (ts.isJsxText(nodo) && tieneLetras(nodo.text)) sueltos.push(nodo.text.trim());
      if (ts.isJsxAttribute(nodo) && ATRIBUTOS_DE_TEXTO.has(nodo.name.getText(codigo)) && nodo.initializer && ts.isStringLiteral(nodo.initializer)) {
        sueltos.push(`${nodo.name.getText(codigo)}="${nodo.initializer.text}"`);
      }
      if (ts.isJsxExpression(nodo) && nodo.expression && (ts.isJsxElement(nodo.parent) || ts.isJsxFragment(nodo.parent))) {
        literalesDeUnaExpresion(nodo.expression);
      }
      ts.forEachChild(nodo, visitar);
    }

    visitar(codigo);
    return sueltos;
  }

  it('el detector encuentra el texto escrito a mano (entre etiquetas, en un atributo de texto, en una llave y en una condición) y no confunde el código con texto', () => {
    expect(textosSueltos('const a = <button>Quitar</button>;')).toEqual(['Quitar']);
    expect(textosSueltos('const a = <input aria-label="Marcar gasto" />;')).toEqual(['aria-label="Marcar gasto"']);
    expect(textosSueltos("const a = <p>{ocupado ? 'Quitando…' : 'Quitar'}</p>;")).toEqual(['Quitando…', 'Quitar']);
    expect(textosSueltos('const f = (x) => x > 0 ? 1 : 2;')).toEqual([]);
    expect(textosSueltos('const a = <p className="text-base font-medium" aria-hidden="true">{cantidad > 0 ? texto : otro}</p>;')).toEqual([]);
    expect(textosSueltos('const a = <Link to={ruta} state={{ volver }}>{VOLVER_AL_VIAJE}</Link>;')).toEqual([]);
  });

  it.each(ARCHIVOS)('%s: ningún texto escrito a mano en el JSX (todo sale de quitar-gastos-textos.ts o de sumar-gastos-textos.ts)', (archivo) => {
    expect(textosSueltos(readFileSync(archivo, 'utf8'))).toEqual([]);
  });
});
