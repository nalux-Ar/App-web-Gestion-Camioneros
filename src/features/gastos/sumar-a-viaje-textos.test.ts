import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { DataRequestError, isRetryableDataError, mapDataError } from '@/lib/data-errors';
import { LIST_LIMIT as LIST_LIMIT_VIAJES } from '@/features/viajes/constants';
import { LIST_LIMIT, MAX_GASTOS_POR_VEZ } from './constants';
import * as textosDeQuitar from './quitar-gastos-textos';
import * as textos from './sumar-a-viaje-textos';
import * as textosDeSumar from './sumar-gastos-textos';

// Los textos de «Sumar varios a un viaje» (la pantalla que se abre desde Gastos): todos los NUEVOS juntos en un archivo, para que la
// responsable los revise de un vistazo. Lo que es idéntico a «Sumar» o a «Quitar» lo toma la pantalla de sus archivos de textos.

/** Todo lo que el archivo de textos exporta como texto fijo, más lo que devuelven sus funciones con valores de ejemplo. */
function todosLosTextos(): string[] {
  const exportados: unknown[] = Object.values(textos);
  const fijos = exportados.filter((valor): valor is string => typeof valor === 'string');
  const deFunciones = [
    textos.textoSinGastosEnElMes('septiembre 2026', false),
    textos.textoSinGastosEnElMes('septiembre 2026', true),
    textos.textoTodosConViaje('septiembre 2026'),
    textos.textoResumenDeMarcados(1, '1.500,00'),
    textos.textoResumenDeMarcados(12, '12.345,00'),
    textos.textoNoHayViajes('septiembre 2026'),
    textos.textoOtroCamionEnElViaje(1),
    textos.textoOtroCamionEnElViaje(3),
    textos.textoBotonSumarAEsteViaje(0),
    textos.textoBotonSumarAEsteViaje(1),
    textos.textoBotonSumarAEsteViaje(7),
  ];
  return [...fijos, ...deFunciones];
}

/** Palabras enteras (con letras acentuadas: \b no sirve). */
const palabras = (lista: string) => new RegExp(String.raw`(?<![\p{L}])(?:${lista})(?![\p{L}])`, 'iu');

describe('los textos de «Sumar varios a un viaje»', () => {
  it('los de la entrada y el encabezado, tal cual los pidió la responsable', () => {
    expect(textos.TITULO_SUMAR_A_VIAJE).toBe('Sumar gastos a un viaje');
    expect(textos.BOTON_ENTRADA_SUMAR_A_VIAJE).toBe('Sumar varios a un viaje');
    expect(textos.ELEGIR_EL_VIAJE).toBe('Elegir el viaje');
    expect(textos.TITULO_A_QUE_VIAJE).toBe('¿A qué viaje?');
    expect(textos.VOLVER_A_GASTOS).toBe('Volver a Gastos');
    expect(textos.VER_EL_VIAJE).toBe('Ver el viaje');
  });

  it('el «Volver» del segundo paso dice solo «Volver» a la vista y a dónde lleva para el lector de pantalla', () => {
    expect(textos.BOTON_VOLVER).toBe('Volver');
    expect(textos.VOLVER_A_ELEGIR_GASTOS).toBe('a elegir los gastos');
  });

  it('los gastos que ya están en un viaje no se ofrecen, y una línea lo dice y dice cómo sacarlos', () => {
    expect(textos.AVISO_YA_EN_UN_VIAJE).toBe('Los gastos que ya están en un viaje no aparecen aquí. Para sacarlos, entra al viaje.');
  });

  it('los avisos del tope nombran los topes reales (MAX_GASTOS_POR_VEZ, LIST_LIMIT de gastos y de viajes), no un número suelto', () => {
    expect(textos.AVISO_TOPE_POR_VEZ_SUMAR).toBe(`Puedes sumar hasta ${MAX_GASTOS_POR_VEZ} gastos por vez. Cuando termines, puedes seguir con los demás.`);
    expect(textos.AVISO_TOPE_POR_VEZ_SUMAR).toContain('100');
    expect(textos.AVISO_HAY_MAS_GASTOS_DEL_MES).toContain(`${LIST_LIMIT} más recientes`);
    expect(textos.AVISO_HAY_MAS_GASTOS_DEL_MES).toContain('500');
    expect(textos.AVISO_HAY_MAS_VIAJES).toBe(`Hay más de ${LIST_LIMIT_VIAJES} viajes en este mes; aquí se ven los ${LIST_LIMIT_VIAJES} más recientes.`);
    expect(textos.AVISO_HAY_MAS_VIAJES).toContain('500');
  });

  it('al cambiar el mes o la categoría: el aviso dice qué cambió y que se desmarcó lo marcado', () => {
    expect(textos.AVISO_DESMARCADO_POR_MES).toBe('Cambiaste el mes: se desmarcó lo que habías marcado.');
    expect(textos.AVISO_DESMARCADO_POR_CATEGORIA).toBe('Cambiaste la categoría: se desmarcó lo que habías marcado.');
  });

  it('sin gastos: dice cuál es el caso (el mes vacío, con o sin categoría, o todos ya en un viaje)', () => {
    expect(textos.textoSinGastosEnElMes('junio 2026', false)).toBe('No hay gastos en junio 2026.');
    expect(textos.textoSinGastosEnElMes('junio 2026', true)).toBe('No hay gastos de esa categoría en junio 2026.');
    expect(textos.textoTodosConViaje('junio 2026')).toBe('Todos los gastos de junio 2026 ya están en un viaje.');
    expect(textos.textoNoHayViajes('junio 2026')).toBe('No hay viajes en junio 2026.');
  });

  it('el resumen de arriba del segundo paso: cuántos gastos y cuánto suman (singular y plural), sin símbolo de moneda', () => {
    expect(textos.textoResumenDeMarcados(1, '1.500,00')).toBe('Vas a sumar 1 gasto. Suma 1.500,00.');
    expect(textos.textoResumenDeMarcados(3, '4.500,00')).toBe('Vas a sumar 3 gastos. Suman 4.500,00.');
  });

  it('el aviso de otro camión: singular y plural, y que NO se van a sumar', () => {
    expect(textos.textoOtroCamionEnElViaje(1)).toBe('1 de los marcados es de otro camión: no se va a sumar.');
    expect(textos.textoOtroCamionEnElViaje(2)).toBe('2 de los marcados son de otro camión: no se van a sumar.');
    expect(textos.MARCADOS_DE_OTRO_CAMION).toBe('Los marcados son de otro camión.');
  });

  it('«Sumar N gastos a este viaje», con «1 gasto» en singular y, sin nada para sumar, sin número', () => {
    expect(textos.textoBotonSumarAEsteViaje(1)).toBe('Sumar 1 gasto a este viaje');
    expect(textos.textoBotonSumarAEsteViaje(2)).toBe('Sumar 2 gastos a este viaje');
    expect(textos.textoBotonSumarAEsteViaje(100)).toBe('Sumar 100 gastos a este viaje');
    expect(textos.textoBotonSumarAEsteViaje(0)).toBe('Sumar gastos a este viaje');
    expect(textos.textoBotonSumarAEsteViaje(0)).not.toMatch(/\d/);
  });

  it('sin viaje elegido, la tarjeta de abajo dice por qué el botón está apagado', () => {
    expect(textos.ELIGE_UN_VIAJE).toBe('Elige un viaje para sumar los gastos.');
    expect(textos.YA_NO_HAY_MARCADOS).toBe('Ya no hay gastos marcados. Vuelve y marca los que quieres sumar.');
  });

  it('no repite ningún nombre de los textos de «Sumar» ni de «Quitar»: lo idéntico se importa de ahí, no se copia', () => {
    const propios = Object.keys(textos);
    const ajenos = new Set([...Object.keys(textosDeSumar), ...Object.keys(textosDeQuitar)]);
    expect(propios.filter((nombre) => ajenos.has(nombre))).toEqual([]);
    // y lo que la pantalla reutiliza existe donde dice
    for (const nombre of ['TITULO_LISTA_SUELTOS', 'MARCAR_TODOS_DESMARCADO', 'textoMarcarTodos', 'textoTotalMarcado', 'MARCA_ALGUNO', 'SUMANDO', 'UN_MOMENTO', 'ERROR_CATEGORIAS']) {
      expect(nombre in textosDeSumar, nombre).toBe(true);
    }
    for (const nombre of ['textoMarcarPrimeros', 'AVISO_MAXIMO_MARCADO']) expect(nombre in textosDeQuitar, nombre).toBe(true);
  });

  it('ningún texto del mismo archivo repite el de otro (cada texto fijo es único)', () => {
    const fijos = (Object.values(textos) as unknown[]).filter((valor): valor is string => typeof valor === 'string');
    expect(new Set(fijos).size).toBe(fijos.length);
  });
});

describe('los errores de esta pantalla (SUMAR_A_VIAJE_CONTEXT)', () => {
  const nuevo = textos.SUMAR_A_VIAJE_CONTEXT;
  const de = textosDeSumar.SUMAR_GASTOS_CONTEXT;

  it('hereda sin señal, tiempo vencido y «el viaje ya no existe» del contexto de «Sumar» y solo cambia los datos inválidos', () => {
    expect(nuevo.network).toBe(de.network);
    expect(nuevo.timeout).toBe(de.timeout);
    expect(nuevo.notFound).toBe(de.notFound);
    expect(nuevo.invalidData).toBe('No se pudo sumar. Revisa los gastos y el viaje, y prueba de nuevo.');
    expect(nuevo.invalidData).not.toBe(de.invalidData);
    expect(Object.keys(nuevo).sort()).toEqual(Object.keys(de).sort());
  });

  it('el texto de datos inválidos no manda «volver al viaje» (acá no hay un viaje al que volver) y no cambia el de «Sumar»', () => {
    expect(nuevo.invalidData).not.toMatch(/vuelve|volver/i);
    expect(de.invalidData).toBe('No se pudo sumar. Vuelve al viaje y prueba de nuevo.');
  });

  it('con datos inválidos (22023) sale ese texto, sin «Reintentar» y sin el del servidor', () => {
    const e = new DataRequestError({ code: '22023', message: 'texto interno del servidor' });
    expect(mapDataError(e, nuevo)).toBe(nuevo.invalidData);
    expect(isRetryableDataError(e, nuevo)).toBe(false);
  });
});

describe('el idioma de los textos', () => {
  it('hay textos para revisar (no se está probando una lista vacía)', () => {
    expect(todosLosTextos().length).toBeGreaterThanOrEqual(25);
  });

  it('español neutro «de tú»: ni voseo ni «acá»', () => {
    const voseo = palabras(
      'acá|vos|tenés|podés|querés|cargás|elegís|fijate|mirá|tocá|escribí|cargá|elegí|contanos|anotá|usá|andá|decime|sos|hacé|ponés|marcá|desmarcá|quitá|sumá|volvé|probá|intentá|esperá|revisá|avisá|buscá|seguí|terminá|marcás|quitás|entrá|filtrá',
    );
    for (const texto of todosLosTextos()) expect(texto).not.toMatch(voseo);
  });

  it('palabras de todos los días: nada de «vincular», «asociar», «lote»…', () => {
    const jerga = palabras('vincular|vinculados?|vinculadas?|vincula|desvincular|asociar|asociados?|asociadas?|lote|lotes|batch|ids?|uuid|rpc|selección|seleccionar|seleccionados?|tanda|tandas|paso|pasos');
    for (const texto of todosLosTextos()) expect(texto).not.toMatch(jerga);
  });

  it('con acentos donde corresponden (palabras frecuentes escritas sin tilde)', () => {
    const sinTilde = palabras('camion|tambien|aqui|asi|categoria|descripcion|mas|estan|senal|ningun|maximo|despues|demas|segun|desmarco|habias');
    for (const texto of todosLosTextos()) expect(texto).not.toMatch(sinTilde);
    expect(textos.AVISO_DESMARCADO_POR_MES).toContain('desmarcó');
    expect(textos.AVISO_DESMARCADO_POR_MES).toContain('habías');
    expect(textos.AVISO_DESMARCADO_POR_CATEGORIA).toContain('categoría');
    expect(textos.TITULO_A_QUE_VIAJE).toContain('¿A qué');
    expect(textos.AVISO_YA_EN_UN_VIAJE).toContain('aquí');
  });

  it('sin texto técnico del servidor ni marcado', () => {
    for (const texto of todosLosTextos()) {
      expect(texto).not.toMatch(/[<>]|&\w+;|\*\*|\]\(|PT\d{3}|P0002|23\d{3}|42501|\bPGRST|\bupdate\b|\bdelete\b|\bnull\b/i);
    }
  });

  it('sin símbolo de moneda (los montos van sin «$» en toda la app)', () => {
    for (const texto of todosLosTextos()) expect(texto).not.toMatch(/\$/);
  });
});

describe('todos los textos visibles están en los archivos de textos (los componentes no escriben los suyos)', () => {
  const ARCHIVOS = [
    'src/features/gastos/sumar-a-viaje-page.tsx',
    'src/features/gastos/elegir-el-viaje.tsx',
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
    expect(textosSueltos('const a = <button>Elegir</button>;')).toEqual(['Elegir']);
    expect(textosSueltos('const a = <input aria-label="Marcar gasto" />;')).toEqual(['aria-label="Marcar gasto"']);
    expect(textosSueltos("const a = <p>{ocupado ? 'Sumando…' : 'Sumar'}</p>;")).toEqual(['Sumando…', 'Sumar']);
    expect(textosSueltos('const f = (x) => x > 0 ? 1 : 2;')).toEqual([]);
    expect(textosSueltos('const a = <p className="text-base font-medium" aria-hidden="true">{cantidad > 0 ? texto : otro}</p>;')).toEqual([]);
    expect(textosSueltos('const a = <Link to={ruta} state={{ volver }}>{VER_EL_VIAJE}</Link>;')).toEqual([]);
  });

  it.each(ARCHIVOS)('%s: ningún texto escrito a mano en el JSX (todo sale de sumar-a-viaje-textos.ts, sumar-gastos-textos.ts o quitar-gastos-textos.ts)', (archivo) => {
    expect(textosSueltos(readFileSync(archivo, 'utf8'))).toEqual([]);
  });

  it('el botón de la lista de Gastos tampoco escribe su texto a mano', () => {
    const fuente = readFileSync('src/features/gastos/gastos-page.tsx', 'utf8');
    expect(fuente).toContain('BOTON_ENTRADA_SUMAR_A_VIAJE');
    expect(fuente).not.toContain('Sumar varios a un viaje');
  });
});
