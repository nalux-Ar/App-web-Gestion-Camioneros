import { describe, expect, it } from 'vitest';

import {
  AYUDA_EN_QUE_GASTASTE,
  ETIQUETA_DESCRIPCION,
  ETIQUETA_EN_QUE_GASTASTE,
  etiquetaDeNota,
  hayDatosEnElPliegue,
  textoDelPliegue,
} from './gasto-pliegue';

// El pliegue «Agregar nota o viaje»: textos y reglas puras.

describe('textoDelPliegue: lo que dice el botón según cuántas notas quedan adentro', () => {
  it('ninguna nota (solo queda el viaje): «Agregar viaje»', () => {
    expect(textoDelPliegue(0)).toBe('Agregar viaje');
  });

  it('una nota: «Agregar nota o viaje»', () => {
    expect(textoDelPliegue(1)).toBe('Agregar nota o viaje');
  });

  it('dos o más notas: «Agregar notas o viaje»', () => {
    expect(textoDelPliegue(2)).toBe('Agregar notas o viaje');
    expect(textoDelPliegue(3)).toBe('Agregar notas o viaje');
    expect(textoDelPliegue(10)).toBe('Agregar notas o viaje');
  });

  it('los tres textos son distintos y ninguno lleva un «+» como carácter (el «+» es un ícono aparte)', () => {
    const textos = [textoDelPliegue(0), textoDelPliegue(1), textoDelPliegue(2)];
    expect(new Set(textos).size).toBe(3);
    for (const texto of textos) {
      expect(texto).not.toContain('+');
      expect(texto.startsWith('Agregar')).toBe(true);
      expect(texto).toBe(texto.trim());
    }
  });
});

describe('los textos de «Gastos varios» y de las notas', () => {
  it('«¿En qué gastaste?» con su ayuda corta', () => {
    expect(ETIQUETA_EN_QUE_GASTASTE).toBe('¿En qué gastaste?');
    expect(AYUDA_EN_QUE_GASTASTE).toBe('Es obligatorio: cuéntanos de qué se trata.');
    expect(ETIQUETA_EN_QUE_GASTASTE).not.toContain('opcional');
    expect(AYUDA_EN_QUE_GASTASTE.length).toBeLessThanOrEqual(60);
  });

  it('con una sola categoría la descripción se llama como siempre; con varias, «Nota de <categoría>»', () => {
    expect(ETIQUETA_DESCRIPCION).toBe('Descripción');
    expect(etiquetaDeNota('Peajes')).toBe('Nota de Peajes');
    expect(etiquetaDeNota('Gastos varios')).toBe('Nota de Gastos varios');
  });

  it('español neutro «de tú»: sin voseo', () => {
    const voseo = /(?<![\p{L}])(?:acá|vos|tenés|podés|querés|contá|contanos|escribí|elegí|cargá|tocá|agregá|sumá)(?![\p{L}])/iu;
    for (const texto of [ETIQUETA_EN_QUE_GASTASTE, AYUDA_EN_QUE_GASTASTE, textoDelPliegue(0), textoDelPliegue(1), textoDelPliegue(2), etiquetaDeNota('X')]) {
      expect(texto).not.toMatch(voseo);
    }
  });
});

describe('hayDatosEnElPliegue: un pliegue con algo adentro no puede verse cerrado', () => {
  it('sin viaje y sin notas (o con notas vacías) no hay datos', () => {
    expect(hayDatosEnElPliegue({ viajeId: '', notas: [] })).toBe(false);
    expect(hayDatosEnElPliegue({ viajeId: '', notas: [''] })).toBe(false);
    expect(hayDatosEnElPliegue({ viajeId: '', notas: ['', ''] })).toBe(false);
  });

  it('un viaje elegido es un dato', () => {
    expect(hayDatosEnElPliegue({ viajeId: 'b0000000-0000-4000-8000-000000000001', notas: [] })).toBe(true);
    expect(hayDatosEnElPliegue({ viajeId: 'x', notas: [''] })).toBe(true);
  });

  it('texto en CUALQUIERA de las notas es un dato', () => {
    expect(hayDatosEnElPliegue({ viajeId: '', notas: ['Peaje de la ruta'] })).toBe(true);
    expect(hayDatosEnElPliegue({ viajeId: '', notas: ['', 'algo'] })).toBe(true);
    expect(hayDatosEnElPliegue({ viajeId: '', notas: ['algo', ''] })).toBe(true);
  });

  it('una nota que son solo espacios no es un dato (se guarda como vacía)', () => {
    expect(hayDatosEnElPliegue({ viajeId: '', notas: ['   ', '\n\t'] })).toBe(false);
    expect(hayDatosEnElPliegue({ viajeId: '', notas: ['  a  '] })).toBe(true);
  });
});
