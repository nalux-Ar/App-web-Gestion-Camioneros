import { describe, expect, it } from 'vitest';

import { textoPreguntaEliminar } from './gasto-textos';

// La pregunta de eliminar un gasto dice CUÁL es (categoría, monto con «$» y fecha corta).
const CATEGORIAS = [
  { id: 'c-peajes', nombre: 'Peajes' },
  { id: 'c-comb', nombre: 'Combustible' },
];

describe('textoPreguntaEliminar', () => {
  it('«¿Eliminar el gasto de Peajes por … del 12 oct? Esto no se puede deshacer.»', () => {
    const texto = textoPreguntaEliminar({ categoria_id: 'c-peajes', monto: 5000, fecha: '2026-10-12' }, CATEGORIAS);
    expect(texto).toBe(`¿Eliminar el gasto de Peajes por $\u00a05.000 del 12 oct? Esto no se puede deshacer.`);
  });

  it('el monto va con «$», sin centavos si es entero y con 2 decimales si no', () => {
    const texto = textoPreguntaEliminar({ categoria_id: 'c-comb', monto: 123456.5, fecha: '2026-01-03' }, CATEGORIAS);
    expect(texto).toContain(`por $\u00a0123.456,50 del 3 ene?`);
    expect(texto.match(/\$/g)).toHaveLength(1); // un solo «$»: el del monto
  });

  it('sin la categoría a mano (todavía no llegó, o ya no existe) la frase sigue completa, sin «de»', () => {
    const texto = textoPreguntaEliminar({ categoria_id: 'otra', monto: 800, fecha: '2026-10-12' }, CATEGORIAS);
    expect(texto).toBe(`¿Eliminar el gasto por $\u00a0800 del 12 oct? Esto no se puede deshacer.`);
    expect(textoPreguntaEliminar({ categoria_id: 'c-peajes', monto: 800, fecha: '2026-10-12' }, [])).not.toContain(' de Peajes');
  });

  it('conserva la advertencia de que no se puede deshacer y no es el «¿Seguro?» genérico', () => {
    const texto = textoPreguntaEliminar({ categoria_id: 'c-peajes', monto: 1, fecha: '2026-10-12' }, CATEGORIAS);
    expect(texto.endsWith('Esto no se puede deshacer.')).toBe(true);
    expect(texto).not.toContain('¿Seguro?');
  });

  it('el nombre de la categoría es texto: lo que traiga se muestra tal cual (sin interpretar nada)', () => {
    const texto = textoPreguntaEliminar({ categoria_id: 'x', monto: 10, fecha: '2026-10-12' }, [{ id: 'x', nombre: '<b>Gas</b>' }]);
    expect(texto).toContain('de <b>Gas</b> por');
  });
});
