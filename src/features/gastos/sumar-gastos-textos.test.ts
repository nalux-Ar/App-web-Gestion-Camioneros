import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { classifyDataError, DataRequestError, isRetryableDataError, mapDataError } from '@/lib/data-errors';
import { MAX_GASTOS_POR_VEZ } from './constants';
import type { MotivoNoSumado } from './sumar-gastos';
import * as textos from './sumar-gastos-textos';

// Los textos de «Sumar gastos que ya cargué»: todos juntos en un archivo, para que la responsable los revise de un vistazo.

/** Todo lo que el archivo de textos exporta como texto fijo, más lo que devuelven sus funciones con valores de ejemplo. */
function todosLosTextos(): string[] {
  const exportados: unknown[] = Object.values(textos); // los textos fijos, las funciones y los dos objetos: se miran solo los textos
  const fijos = exportados.filter((valor): valor is string => typeof valor === 'string');
  const deContexto = Object.values(textos.SUMAR_GASTOS_CONTEXT).filter((valor): valor is string => typeof valor === 'string');
  const deMotivos = Object.values(textos.MOTIVOS_NO_SUMADO);
  const deFunciones = [
    textos.textoMarcarTodos(1),
    textos.textoMarcarTodos(12),
    textos.textoOtroCamion('AB 123 CD'),
    textos.textoOtroCamion(null),
    textos.textoBotonSumar(0),
    textos.textoBotonSumar(1),
    textos.textoBotonSumar(7),
    textos.textoTotalMarcado('12.345,00'),
    textos.textoSumaste(1),
    textos.textoSumaste(5),
    textos.textoYaEstaban(1),
    textos.textoYaEstaban(4),
    textos.textoNoSeSumaron(1),
    textos.textoNoSeSumaron(3),
    textos.textoGastoNoSumado('Peajes', '15 jun 2025', 'en_otro_viaje'),
    textos.textoGastoNoSumado('Gasto', null, 'no_se_pudo'),
  ];
  return [...fijos, ...deContexto, ...deMotivos, ...deFunciones];
}

/** Palabras enteras (con letras acentuadas: \b no sirve). */
const palabras = (lista: string) => new RegExp(String.raw`(?<![\p{L}])(?:${lista})(?![\p{L}])`, 'iu');

describe('los textos de «Sumar gastos que ya cargué»', () => {
  it('los de la pantalla, tal cual los aprobó la responsable', () => {
    expect(textos.TITULO_SUMAR_GASTOS).toBe('Sumar gastos que ya cargué');
    expect(textos.BOTON_ENTRADA_SUMAR_GASTOS).toBe('Sumar gastos que ya cargué');
    expect(textos.TITULO_SIN_GASTOS_SUELTOS).toBe('No tienes gastos sin viaje.');
    expect(textos.TITULO_NO_SE_PUEDEN_SUMAR).toBe('No se pueden sumar');
    expect(textos.VOLVER_AL_VIAJE).toBe('Volver al viaje');
    expect(textos.MARCAR_TODOS_DESMARCADO).toBe('Desmarcar todos');
  });

  it('«Marcar todos (N)»', () => {
    expect(textos.textoMarcarTodos(12)).toBe('Marcar todos (12)');
    expect(textos.textoMarcarTodos(1)).toBe('Marcar todos (1)');
  });

  it('«Sumar N gastos al viaje», con «1 gasto» en singular y, sin nada marcado, sin número', () => {
    expect(textos.textoBotonSumar(1)).toBe('Sumar 1 gasto al viaje');
    expect(textos.textoBotonSumar(2)).toBe('Sumar 2 gastos al viaje');
    expect(textos.textoBotonSumar(100)).toBe('Sumar 100 gastos al viaje');
    expect(textos.textoBotonSumar(0)).toBe('Sumar gastos al viaje');
    expect(textos.textoBotonSumar(0)).not.toMatch(/\d/);
  });

  it('el total («Suman 12.345,00») y lo que se ve en su lugar sin nada marcado', () => {
    expect(textos.textoTotalMarcado('12.345,00')).toBe('Suman 12.345,00');
    expect(textos.MARCA_ALGUNO).toBe('Marca los que quieres sumar.');
  });

  it('el aviso de que hay más gastos nombra el tope de la base (MAX_GASTOS_POR_VEZ), no un número suelto', () => {
    expect(textos.AVISO_HAY_MAS).toBe(`Hay más gastos sin viaje; aquí se ven los ${MAX_GASTOS_POR_VEZ} más cercanos a la fecha del viaje.`);
    expect(textos.AVISO_HAY_MAS).toContain('100');
  });

  it('de otro camión: con la patente entre paréntesis y, si no se conoce, sin paréntesis', () => {
    expect(textos.textoOtroCamion('AB 123 CD')).toBe('Es de otro camión (AB 123 CD)');
    expect(textos.textoOtroCamion(null)).toBe('Es de otro camión');
  });

  it('el resultado: «Sumaste N gastos al viaje.», «K ya estaban…» y «M no se pudieron sumar:», con el singular de cada uno', () => {
    expect(textos.textoSumaste(3)).toBe('Sumaste 3 gastos al viaje.');
    expect(textos.textoSumaste(1)).toBe('Sumaste 1 gasto al viaje.');
    expect(textos.textoYaEstaban(2)).toBe('2 ya estaban en este viaje.');
    expect(textos.textoYaEstaban(1)).toBe('1 ya estaba en este viaje.');
    expect(textos.textoNoSeSumaron(2)).toBe('2 no se pudieron sumar:');
    expect(textos.textoNoSeSumaron(1)).toBe('1 no se pudo sumar:');
    expect(textos.NINGUNO_SUMADO).toBe('No se sumó ningún gasto.');
  });

  it('los cuatro motivos de «no se pudo sumar», con su texto fijo', () => {
    expect(textos.MOTIVOS_NO_SUMADO).toEqual({
      en_otro_viaje: 'Ya está en otro viaje.',
      camion_distinto: 'Es de otro camión.',
      no_encontrado: 'Ya no está disponible.',
      no_se_pudo: 'No se pudo sumar. Inténtalo de nuevo.',
    } satisfies Record<MotivoNoSumado, string>);
  });

  it('`no_encontrado` es UN solo texto: no dice si se borró o si es de otra cuenta (la base no lo distingue y la pantalla tampoco)', () => {
    const texto = textos.MOTIVOS_NO_SUMADO.no_encontrado;
    expect(texto).not.toMatch(/borr|elimin|otra cuenta|ajeno|existe/i);
    // y ningún otro motivo repite ese texto
    expect(Object.entries(textos.MOTIVOS_NO_SUMADO).filter(([, t]) => t === texto)).toHaveLength(1);
  });

  it('una línea de los que no se pudieron sumar: «Categoría · fecha: motivo»; sin fecha, «Categoría: motivo»', () => {
    expect(textos.textoGastoNoSumado('Peajes', '15 jun 2025', 'en_otro_viaje')).toBe('Peajes · 15 jun 2025: Ya está en otro viaje.');
    expect(textos.textoGastoNoSumado('Gasto', null, 'no_encontrado')).toBe('Gasto: Ya no está disponible.');
  });
});

describe('el idioma de los textos', () => {
  it('hay textos para revisar (no se está probando una lista vacía)', () => {
    expect(todosLosTextos().length).toBeGreaterThanOrEqual(40);
  });

  it('español neutro «de tú»: ni voseo ni «acá»', () => {
    const voseo = palabras(
      'acá|vos|tenés|podés|querés|cargás|elegís|fijate|mirá|tocá|escribí|cargá|elegí|contanos|anotá|usá|andá|decime|sos|hacé|ponés|marcá|sumá|volvé|probá|intentá|esperá|revisá|avisá|buscá',
    );
    for (const texto of todosLosTextos()) expect(texto).not.toMatch(voseo);
  });

  it('palabras de todos los días: nada de «vincular», «asociar», «lote»…', () => {
    const jerga = palabras('vincular|vinculados?|vinculadas?|vincula|asociar|asociados?|asociadas?|lote|lotes|batch|ids?|uuid|rpc|selección|seleccionar|seleccionados?');
    for (const texto of todosLosTextos()) expect(texto).not.toMatch(jerga);
  });

  it('con acentos donde corresponden (palabras frecuentes escritas sin tilde)', () => {
    const sinTilde = palabras('camion|tambien|aqui|asi|categoria|descripcion|sumo|mas|estan|senal|ningun|cargue');
    for (const texto of todosLosTextos()) expect(texto).not.toMatch(sinTilde);
    expect(textos.MOTIVOS_NO_SUMADO.en_otro_viaje).toContain('está');
    expect(textos.NINGUNO_SUMADO).toContain('sumó');
  });

  it('sin texto técnico del servidor ni marcado', () => {
    for (const texto of todosLosTextos()) {
      expect(texto).not.toMatch(/[<>]|&\w+;|\*\*|\]\(|PT\d{3}|P0002|23\d{3}|42501|\bPGRST/);
    }
  });

  it('sin símbolo de moneda (los montos van sin «$» en toda la app)', () => {
    for (const texto of todosLosTextos()) expect(texto).not.toMatch(/\$/);
  });
});

describe('los mensajes de error de «Sumar» (SUMAR_GASTOS_CONTEXT + mapDataError)', () => {
  const contexto = textos.SUMAR_GASTOS_CONTEXT;
  const error = (code: string, status?: number, message = 'texto interno del servidor') => new DataRequestError({ code, message }, status);

  it('sin señal y con el tiempo vencido: texto propio, que no nombra ningún botón ni habla de «lo escrito» (no hay nada escrito)', () => {
    const sinSenal = mapDataError(new DataRequestError({ message: 'TypeError: Failed to fetch', code: '' }, 0), contexto);
    expect(sinSenal).toBe('No hay señal. Todavía NO se sumaron. Cuando tengas señal, inténtalo de nuevo.');
    const lento = mapDataError(new DataRequestError({ message: 'TimeoutError: The operation timed out', code: '' }), contexto);
    expect(lento).toBe('La señal está lenta y no sabemos si se sumaron. Revisa el viaje o inténtalo de nuevo: si ya estaban sumados, no pasa nada.');
    for (const texto of [sinSenal, lento]) expect(texto).not.toMatch(/Reintentar|lo escrito|guard/i);
  });

  it('el viaje ya no existe (P0002): «Este viaje ya no existe.», sin «Reintentar»', () => {
    const e = error('P0002', 500);
    expect(mapDataError(e, contexto)).toBe('Este viaje ya no existe.');
    expect(isRetryableDataError(e, contexto)).toBe(false);
  });

  it('cuenta en solo lectura (PT402 o un 402): el mensaje general de la clase `payment`, sin «Reintentar» y sin el texto del servidor', () => {
    for (const e of [error('PT402', 402), error('', 402)]) {
      expect(classifyDataError(e)).toBe('payment');
      expect(isRetryableDataError(e, contexto)).toBe(false);
      expect(mapDataError(e, contexto)).toBe('Tu cuenta está en modo de solo lectura: por ahora no se pueden guardar cambios.');
      expect(mapDataError(e, contexto)).not.toContain('texto interno');
    }
  });

  it('datos inválidos (22023): un texto que habla de sumar, no el «Revisa los datos que ingresaste» de un formulario; sin «Reintentar»', () => {
    const e = error('22023');
    expect(mapDataError(e, contexto)).toBe('No se pudo sumar. Vuelve al viaje y prueba de nuevo.');
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
    expect(isRetryableDataError(error('57014'), contexto)).toBe(true);
    expect(isRetryableDataError(error('42501'), contexto)).toBe(false);
  });
});


describe('todos los textos visibles están en el archivo de textos (los componentes no escriben los suyos)', () => {
  const ARCHIVOS = [
    'src/features/gastos/sumar-gastos-page.tsx',
    'src/features/gastos/gastos-para-elegir.tsx',
    'src/features/gastos/resultado-de-sumar.tsx',
  ];

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
      // Los atributos no son texto (salvo los de `ATRIBUTOS_DE_TEXTO`, que mira `visitar`): no se entra a ellos.
      if (ts.isJsxAttribute(nodo)) return;
      if ((ts.isStringLiteral(nodo) || ts.isNoSubstitutionTemplateLiteral(nodo)) && tieneLetras(nodo.text)) {
        sueltos.push(nodo.text);
      }
      if ((ts.isTemplateHead(nodo) || ts.isTemplateMiddle(nodo) || ts.isTemplateTail(nodo)) && tieneLetras(nodo.text)) {
        sueltos.push(nodo.text);
      }
      ts.forEachChild(nodo, literalesDeUnaExpresion);
    }

    function visitar(nodo: ts.Node): void {
      if (ts.isJsxText(nodo) && tieneLetras(nodo.text)) sueltos.push(nodo.text.trim());
      if (ts.isJsxAttribute(nodo) && ATRIBUTOS_DE_TEXTO.has(nodo.name.getText(codigo)) && nodo.initializer && ts.isStringLiteral(nodo.initializer)) {
        sueltos.push(`${nodo.name.getText(codigo)}="${nodo.initializer.text}"`);
      }
      // Una expresión que es HIJO de una etiqueta (no el valor de un atributo): lo que tenga adentro se dibuja.
      if (ts.isJsxExpression(nodo) && nodo.expression && (ts.isJsxElement(nodo.parent) || ts.isJsxFragment(nodo.parent))) {
        literalesDeUnaExpresion(nodo.expression);
      }
      ts.forEachChild(nodo, visitar);
    }

    visitar(codigo);
    return sueltos;
  }

  describe('el detector', () => {
    it('encuentra el texto escrito a mano: entre etiquetas, en un atributo de texto, en una llave y en una condición', () => {
      expect(textosSueltos('const a = <button>Sumar</button>;')).toEqual(['Sumar']);
      expect(textosSueltos('const a = <p>Hola <b>mundo</b></p>;')).toEqual(['Hola', 'mundo']);
      expect(textosSueltos('const a = <input aria-label="Marcar gasto" />;')).toEqual(['aria-label="Marcar gasto"']);
      expect(textosSueltos("const a = <p>{'Sumar gastos'}</p>;")).toEqual(['Sumar gastos']);
      expect(textosSueltos("const a = <p>{ocupado ? 'Sumando…' : 'Sumar'}</p>;")).toEqual(['Sumando…', 'Sumar']);
      expect(textosSueltos('const a = <p>{`Suman ${total}`}</p>;')).toEqual(['Suman ']);
    });

    it('no confunde el código con texto: un `=>` o un `>` de una comparación, los valores de className y aria-hidden, las flechas y la «a» suelta', () => {
      expect(textosSueltos('const f = (x) => x > 0 ? 1 : 2;')).toEqual([]);
      expect(textosSueltos('const a = <ul>{items.map((item) => <li key={item.id}>{item.texto}</li>)}</ul>;')).toEqual([]);
      expect(textosSueltos('const a = <p className="text-base font-medium" aria-hidden="true">{cantidad > 0 ? texto : otro}</p>;')).toEqual([]);
      expect(textosSueltos('const a = <p>{origen} <span aria-hidden="true">→</span><span className="sr-only"> a </span> {destino} <span>·</span></p>;')).toEqual([]);
      expect(textosSueltos('const a = <Link to={ruta} state={{ volver }}>{VOLVER_AL_VIAJE}</Link>;')).toEqual([]);
      // las clases de una etiqueta que está DENTRO de una expresión tampoco son texto
      expect(textosSueltos("const a = <ul>{items.map((i) => <li key={i} className={cn('flex min-h-16 rounded-lg', marcado && 'border-primary')}>{i}</li>)}</ul>;")).toEqual([]);
    });

    it('sigue encontrando el atributo de texto de una etiqueta que está dentro de una expresión', () => {
      expect(textosSueltos('const a = <ul>{items.map((i) => <input key={i} aria-label="Marcar gasto" />)}</ul>;')).toEqual(['aria-label="Marcar gasto"']);
    });
  });

  it.each(ARCHIVOS)('%s: ningún texto escrito a mano en el JSX (todo sale de sumar-gastos-textos.ts)', (archivo) => {
    expect(textosSueltos(readFileSync(archivo, 'utf8'))).toEqual([]);
  });
});
