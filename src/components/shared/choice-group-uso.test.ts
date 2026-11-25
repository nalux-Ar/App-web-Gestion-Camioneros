import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

// `apilarEnAngosto` (una columna si no entran 2 de 9,75 rem: pantalla angosta o letra grande) es SOLO del método de pago de «Nuevo gasto»: los demás grupos de botones
// (camión activo, tanque lleno, motivo, km del viaje, categoría al editar…) tienen que seguir con su cuadrícula de siempre. La prueba
// de `ChoiceGroup` fija que SIN la prop nada cambia; esta mira el CÓDIGO de las pantallas: que nadie más la pase. Si algún día otro
// grupo la necesita, se amplía la lista de abajo A PROPÓSITO (y se mide en el panel a 320 px).
function archivosDeCodigo(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entrada) => {
    const ruta = join(dir, entrada.name);
    if (entrada.isDirectory()) return archivosDeCodigo(ruta);
    return /\.tsx$/.test(entrada.name) && !/\.test\.tsx$/.test(entrada.name) ? [ruta] : [];
  });
}

interface UsoDelGrupo {
  archivo: string;
  id: string;
  columns: string | null;
  apila: boolean;
}

function usosDelGrupo(): UsoDelGrupo[] {
  const usos: UsoDelGrupo[] = [];
  for (const archivo of archivosDeCodigo('src')) {
    const fuente = readFileSync(archivo, 'utf8');
    if (!fuente.includes('<ChoiceGroup')) continue;
    const codigo = ts.createSourceFile(archivo, fuente, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
    const visitar = (nodo: ts.Node): void => {
      if ((ts.isJsxSelfClosingElement(nodo) || ts.isJsxOpeningElement(nodo)) && nodo.tagName.getText(codigo) === 'ChoiceGroup') {
        const atributo = (nombre: string) => nodo.attributes.properties.find((p): p is ts.JsxAttribute => ts.isJsxAttribute(p) && p.name.getText(codigo) === nombre);
        const valorDe = (nombre: string) => {
          const a = atributo(nombre);
          if (a?.initializer === undefined) return null;
          return ts.isJsxExpression(a.initializer) ? (a.initializer.expression?.getText(codigo) ?? null) : a.initializer.getText(codigo);
        };
        usos.push({ archivo: archivo.replaceAll('\\', '/'), id: valorDe('id') ?? '?', columns: valorDe('columns'), apila: atributo('apilarEnAngosto') !== undefined });
      }
      ts.forEachChild(nodo, visitar);
    };
    visitar(codigo);
  }
  return usos;
}

describe('quién usa `apilarEnAngosto` en los grupos de botones', () => {
  const usos = usosDelGrupo();

  it('la búsqueda ve los grupos de siempre (si no, esta prueba no estaría mirando nada)', () => {
    const archivos = new Set(usos.map((uso) => uso.archivo));
    for (const esperado of [
      'src/features/camiones/camion-activo-card.tsx',
      'src/features/camiones/camion-selector.tsx',
      'src/features/devoluciones/devolucion-formulario.tsx',
      'src/features/gastos/gasto-formulario.tsx',
      'src/features/viajes/viaje-formulario.tsx',
    ]) {
      expect(archivos.has(esperado), esperado).toBe(true);
    }
    expect(usos.length).toBeGreaterThanOrEqual(7);
  });

  it('solo lo pasa el método de pago de «Nuevo gasto» (el de campoMetodoDePago), y con columns={2}', () => {
    const conLaProp = usos.filter((uso) => uso.apila);
    expect(conLaProp).toHaveLength(1);
    expect(conLaProp[0]!.archivo).toBe('src/features/gastos/gasto-formulario.tsx');
    expect(conLaProp[0]!.id).toContain('.metodo');
    expect(conLaProp[0]!.columns).toBe('2');
  });
});
