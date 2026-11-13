import { describe, expect, it } from 'vitest';

import {
  textoBorradoIncompleto,
  textoConteoCambiado,
  textosDeBorrado,
  type EstadoConteos,
} from '@/features/viajes/eliminar-viaje-textos';

const listo = (gastos: number, devoluciones: number): EstadoConteos => ({ tipo: 'listo', gastos, devoluciones });

describe('avisos cuando el borrado no se completa', () => {
  it('textoBorradoIncompleto: dice qué ya pasó (en singular o plural) y qué falta, seguido del motivo', () => {
    expect(textoBorradoIncompleto(1, 'No hay señal.')).toBe('El gasto ya quedó sin viaje, pero el viaje no se borró. No hay señal.');
    expect(textoBorradoIncompleto(4, 'No hay señal.')).toBe('Los 4 gastos ya quedaron sin viaje, pero el viaje no se borró. No hay señal.');
  });
});

describe('textoConteoCambiado: dice los números de AHORA (gastos y devoluciones) y pide volver a confirmar', () => {
  const REVISA = 'Revisa y vuelve a confirmar.';

  it('sin gastos ni devoluciones', () => {
    expect(textoConteoCambiado({ gastos: 0, devoluciones: 0 })).toBe(`Ahora el viaje no tiene gastos ni devoluciones. ${REVISA}`);
  });

  it('gastos y devoluciones: las cuatro combinaciones de singular y plural', () => {
    expect(textoConteoCambiado({ gastos: 3, devoluciones: 2 })).toBe(`Ahora el viaje tiene 3 gastos y 2 devoluciones. ${REVISA}`);
    expect(textoConteoCambiado({ gastos: 1, devoluciones: 2 })).toBe(`Ahora el viaje tiene 1 gasto y 2 devoluciones. ${REVISA}`);
    expect(textoConteoCambiado({ gastos: 3, devoluciones: 1 })).toBe(`Ahora el viaje tiene 3 gastos y 1 devolución. ${REVISA}`);
    expect(textoConteoCambiado({ gastos: 1, devoluciones: 1 })).toBe(`Ahora el viaje tiene 1 gasto y 1 devolución. ${REVISA}`);
  });

  it('solo gastos: singular y plural, sin mencionar devoluciones', () => {
    expect(textoConteoCambiado({ gastos: 1, devoluciones: 0 })).toBe(`Ahora el viaje tiene 1 gasto. ${REVISA}`);
    expect(textoConteoCambiado({ gastos: 7, devoluciones: 0 })).toBe(`Ahora el viaje tiene 7 gastos. ${REVISA}`);
  });

  it('solo devoluciones: singular y plural, sin mencionar gastos', () => {
    expect(textoConteoCambiado({ gastos: 0, devoluciones: 1 })).toBe(`Ahora el viaje tiene 1 devolución. ${REVISA}`);
    expect(textoConteoCambiado({ gastos: 0, devoluciones: 5 })).toBe(`Ahora el viaje tiene 5 devoluciones. ${REVISA}`);
  });

  it('nunca dice "1 gastos" ni "1 devoluciones"', () => {
    for (const [g, d] of [[1, 0], [0, 1], [1, 1], [1, 4], [4, 1]] as const) {
      const texto = textoConteoCambiado({ gastos: g, devoluciones: d });
      expect(texto).not.toContain('1 gastos');
      expect(texto).not.toContain('1 devoluciones');
    }
  });

  it('un número raro (negativo, decimal, NaN) no inventa un texto: cuenta como 0', () => {
    expect(textoConteoCambiado({ gastos: -2, devoluciones: Number.NaN })).toBe(`Ahora el viaje no tiene gastos ni devoluciones. ${REVISA}`);
  });
});

describe('textos de la confirmación de borrar un viaje: la tabla completa', () => {
  it('sin gastos ni devoluciones: el texto de siempre y "Sí, eliminar"', () => {
    expect(textosDeBorrado(listo(0, 0))).toEqual({
      prompt: '¿Seguro? Esto no se puede deshacer.',
      confirmLabel: 'Sí, eliminar',
      puedeConfirmar: true,
    });
  });

  describe('solo gastos (exactamente como antes de Devoluciones)', () => {
    it('1 gasto: singular', () => {
      expect(textosDeBorrado(listo(1, 0))).toEqual({
        prompt: '¿Seguro? Este viaje tiene 1 gasto. No se borra: queda sin viaje. Esto no se puede deshacer.',
        confirmLabel: 'Sí, eliminar el viaje',
        puedeConfirmar: true,
      });
    });

    it('N gastos: plural', () => {
      expect(textosDeBorrado(listo(7, 0))).toEqual({
        prompt: '¿Seguro? Este viaje tiene 7 gastos. No se borran: quedan sin viaje. Esto no se puede deshacer.',
        confirmLabel: 'Sí, eliminar el viaje',
        puedeConfirmar: true,
      });
    });
  });

  describe('solo devoluciones: se borran junto con el viaje', () => {
    it('1 devolución: singular', () => {
      expect(textosDeBorrado(listo(0, 1))).toEqual({
        prompt: '¿Seguro? Este viaje tiene 1 devolución. Se borra junto con el viaje. Esto no se puede deshacer.',
        confirmLabel: 'Borrar el viaje y su devolución',
        puedeConfirmar: true,
      });
    });

    it('N devoluciones: plural', () => {
      expect(textosDeBorrado(listo(0, 2))).toEqual({
        prompt: '¿Seguro? Este viaje tiene 2 devoluciones. Se borran junto con el viaje. Esto no se puede deshacer.',
        confirmLabel: 'Borrar el viaje y sus devoluciones',
        puedeConfirmar: true,
      });
    });
  });

  describe('gastos y devoluciones: los gastos se conservan, las devoluciones se borran', () => {
    it('N gastos y N devoluciones', () => {
      expect(textosDeBorrado(listo(3, 2))).toEqual({
        prompt:
          '¿Seguro? Este viaje tiene 3 gastos y 2 devoluciones. Los gastos no se borran: quedan sin viaje; las devoluciones se borran con el viaje. Esto no se puede deshacer.',
        confirmLabel: 'Borrar el viaje y sus devoluciones',
        puedeConfirmar: true,
      });
    });

    it('1 gasto y N devoluciones', () => {
      expect(textosDeBorrado(listo(1, 2))).toEqual({
        prompt:
          '¿Seguro? Este viaje tiene 1 gasto y 2 devoluciones. El gasto no se borra: queda sin viaje; las devoluciones se borran con el viaje. Esto no se puede deshacer.',
        confirmLabel: 'Borrar el viaje y sus devoluciones',
        puedeConfirmar: true,
      });
    });

    it('N gastos y 1 devolución', () => {
      expect(textosDeBorrado(listo(3, 1))).toEqual({
        prompt:
          '¿Seguro? Este viaje tiene 3 gastos y 1 devolución. Los gastos no se borran: quedan sin viaje; la devolución se borra con el viaje. Esto no se puede deshacer.',
        confirmLabel: 'Borrar el viaje y su devolución',
        puedeConfirmar: true,
      });
    });

    it('1 gasto y 1 devolución', () => {
      expect(textosDeBorrado(listo(1, 1))).toEqual({
        prompt:
          '¿Seguro? Este viaje tiene 1 gasto y 1 devolución. El gasto no se borra: queda sin viaje; la devolución se borra con el viaje. Esto no se puede deshacer.',
        confirmLabel: 'Borrar el viaje y su devolución',
        puedeConfirmar: true,
      });
    });
  });

  it('conteo fallido (cualquiera de los dos): texto genérico y se puede confirmar igual', () => {
    expect(textosDeBorrado({ tipo: 'error' })).toEqual({
      prompt:
        '¿Seguro? Si tiene gastos, no se borran: quedan sin viaje. Si tiene devoluciones, se borran con el viaje. Esto no se puede deshacer.',
      confirmLabel: 'Sí, eliminar',
      puedeConfirmar: true,
    });
  });

  it('mientras se cuenta: no se puede confirmar todavía', () => {
    expect(textosDeBorrado({ tipo: 'cargando' })).toEqual({
      prompt: 'Revisando si el viaje tiene gastos o devoluciones…',
      confirmLabel: 'Sí, eliminar',
      puedeConfirmar: false,
    });
  });

  it('un conteo negativo (no debería pasar) no inventa un texto con gastos ni devoluciones', () => {
    expect(textosDeBorrado(listo(-3, -1)).prompt).toBe('¿Seguro? Esto no se puede deshacer.');
    expect(textosDeBorrado(listo(-3, 2)).prompt).toBe('¿Seguro? Este viaje tiene 2 devoluciones. Se borran junto con el viaje. Esto no se puede deshacer.');
    expect(textosDeBorrado(listo(2, -1)).confirmLabel).toBe('Sí, eliminar el viaje');
  });

  it('sin las palabras difíciles: nada de «vinculado» ni «desvincular», en ningún estado', () => {
    const estados: EstadoConteos[] = [{ tipo: 'cargando' }, { tipo: 'error' }, ...[0, 1, 3].flatMap((g) => [0, 1, 2].map((d) => listo(g, d)))];
    for (const estado of estados) {
      const t = textosDeBorrado(estado);
      expect(`${t.prompt} ${t.confirmLabel}`, JSON.stringify(estado)).not.toMatch(/vincul/i);
    }
    for (const [g, d] of [[0, 0], [1, 0], [0, 2], [3, 2]] as const) expect(textoConteoCambiado({ gastos: g, devoluciones: d })).not.toMatch(/vincul/i);
    expect(textoBorradoIncompleto(2, 'Sin señal.')).not.toMatch(/vincul/i);
  });

  it('con gastos y sin devoluciones el botón es «Sí, eliminar el viaje» (el mismo para 1 gasto o varios) y el texto dice que NO se borran', () => {
    for (const g of [1, 2, 9]) {
      const t = textosDeBorrado(listo(g, 0));
      expect(t.confirmLabel).toBe('Sí, eliminar el viaje');
      expect(t.prompt).toMatch(/No se borran?: quedan? sin viaje\. Esto no se puede deshacer\.$/);
    }
  });

  it('ningún texto dice "1 gastos" ni "1 devoluciones", y solo hay botón "Sí, eliminar" cuando no hay nada que se borre ni se desvincule', () => {
    for (const g of [0, 1, 2]) {
      for (const d of [0, 1, 2]) {
        const t = textosDeBorrado(listo(g, d));
        expect(t.prompt, `${g}/${d}`).not.toContain('1 gastos');
        expect(t.prompt, `${g}/${d}`).not.toContain('1 devoluciones');
        expect(t.confirmLabel === 'Sí, eliminar', `${g}/${d}`).toBe(g === 0 && d === 0);
        expect(t.puedeConfirmar).toBe(true);
      }
    }
  });
});
