import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// El aviso de «Sigue guardando…» (tanda 3b, A21/B8) llega a la `SubmitBar` por una prop (`lento`, de `useSubmitFeedback`). Esta prueba
// mira el CÓDIGO de todas las pantallas que usan la barra: que cada una le pase `lento` y que ese `lento` salga del `useSubmitFeedback`
// de la propia pantalla. Si una pantalla nueva (o una que se toca) se olvida de pasarlo, su guardado lento no avisaría nada y ninguna
// prueba de esa pantalla lo notaría.
function archivosDeCodigo(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entrada) => {
    const ruta = join(dir, entrada.name);
    if (entrada.isDirectory()) return archivosDeCodigo(ruta);
    return /\.tsx$/.test(entrada.name) && !/\.test\.tsx$/.test(entrada.name) ? [ruta] : [];
  });
}

interface UsoDeLaBarra {
  archivo: string;
  pasaLento: boolean;
  /** El valor que se pasa: `lento={lento}` es lo esperado. */
  expresion: string | null;
  /** Hay un `const { …, lento, … } = useSubmitFeedback(…)` en el archivo. */
  lentoDelHook: boolean;
}

function usosDeLaBarra(): UsoDeLaBarra[] {
  const usos: UsoDeLaBarra[] = [];
  for (const archivo of archivosDeCodigo('src')) {
    const fuente = readFileSync(archivo, 'utf8');
    if (!fuente.includes('<SubmitBar')) continue;
    const codigo = ts.createSourceFile(archivo, fuente, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
    const barras: ts.JsxAttributes[] = [];
    let lentoDelHook = false;
    const visitar = (nodo: ts.Node): void => {
      if ((ts.isJsxSelfClosingElement(nodo) || ts.isJsxOpeningElement(nodo)) && nodo.tagName.getText(codigo) === 'SubmitBar') barras.push(nodo.attributes);
      if (
        ts.isVariableDeclaration(nodo) &&
        ts.isObjectBindingPattern(nodo.name) &&
        nodo.initializer !== undefined &&
        ts.isCallExpression(nodo.initializer) &&
        nodo.initializer.expression.getText(codigo) === 'useSubmitFeedback' &&
        nodo.name.elements.some((elemento) => elemento.name.getText(codigo) === 'lento')
      ) {
        lentoDelHook = true;
      }
      ts.forEachChild(nodo, visitar);
    };
    visitar(codigo);
    for (const atributos of barras) {
      const atributo = atributos.properties.find((propiedad): propiedad is ts.JsxAttribute => ts.isJsxAttribute(propiedad) && propiedad.name.getText(codigo) === 'lento');
      usos.push({
        archivo,
        pasaLento: atributo !== undefined,
        expresion: atributo?.initializer && ts.isJsxExpression(atributo.initializer) ? (atributo.initializer.expression?.getText(codigo) ?? null) : null,
        lentoDelHook,
      });
    }
  }
  return usos;
}

describe('quién usa la SubmitBar', () => {
  const usos = usosDeLaBarra();

  it('la búsqueda encuentra las 6 pantallas de siempre (si no, esta prueba no estaría mirando nada)', () => {
    const archivos = usos.map((uso) => uso.archivo.replaceAll('\\', '/')).sort();
    expect(archivos).toEqual([
      'src/features/camiones/camion-formulario.tsx',
      'src/features/clientes/cliente-formulario.tsx',
      'src/features/devoluciones/devolucion-formulario.tsx',
      'src/features/gastos/gasto-formulario.tsx',
      'src/features/reportar/reportar-page.tsx',
      'src/features/viajes/viaje-formulario.tsx',
    ]);
  });

  it('todas le pasan `lento={lento}` y ese `lento` sale de su propio useSubmitFeedback', () => {
    for (const uso of usos) {
      expect(uso.pasaLento, `${uso.archivo} no le pasa «lento» a la SubmitBar`).toBe(true);
      expect(uso.expresion, uso.archivo).toBe('lento');
      expect(uso.lentoDelHook, `${uso.archivo}: «lento» no sale de useSubmitFeedback`).toBe(true);
    }
  });

  it('el detector detecta una pantalla que se olvida de pasarlo', () => {
    const codigo = ts.createSourceFile('x.tsx', '<SubmitBar pending={pending} error={error} />', ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
    let encontrada = false;
    const visitar = (nodo: ts.Node): void => {
      if (ts.isJsxSelfClosingElement(nodo)) encontrada = !nodo.attributes.properties.some((p) => ts.isJsxAttribute(p) && p.name.getText(codigo) === 'lento');
      ts.forEachChild(nodo, visitar);
    };
    visitar(codigo);
    expect(encontrada).toBe(true);
  });
});
