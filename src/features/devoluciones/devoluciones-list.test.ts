import { describe, expect, it } from 'vitest';

import { MOTIVO_ORDER } from '@/features/devoluciones/constants';
import { resumenDelMes, textoPorMotivo, textoTotalDevoluciones } from '@/features/devoluciones/devoluciones-list';

const d = (motivo: Parameters<typeof resumenDelMes>[0][number]['motivo']) => ({ motivo });

describe('resumenDelMes', () => {
  it('sin devoluciones: total 0 y ningún motivo', () => {
    expect(resumenDelMes([])).toEqual({ total: 0, porMotivo: [] });
  });

  it('cuenta el total y cada motivo', () => {
    const resumen = resumenDelMes([d('rotura_danio'), d('vencimiento'), d('rotura_danio'), d('otro')]);
    expect(resumen.total).toBe(4);
    expect(resumen.porMotivo).toEqual([
      { motivo: 'rotura_danio', cantidad: 2 },
      { motivo: 'vencimiento', cantidad: 1 },
      { motivo: 'otro', cantidad: 1 },
    ]);
  });

  it('solo incluye los motivos con al menos una (nunca un 0)', () => {
    const resumen = resumenDelMes([d('mercaderia_incorrecta'), d('mercaderia_incorrecta')]);
    expect(resumen.porMotivo).toEqual([{ motivo: 'mercaderia_incorrecta', cantidad: 2 }]);
    expect(resumen.porMotivo.some((c) => c.cantidad === 0)).toBe(false);
  });

  it('va siempre en el orden fijo de los motivos, no en el de aparición', () => {
    const resumen = resumenDelMes([d('otro'), d('mercaderia_incorrecta'), d('vencimiento'), d('rotura_danio')]);
    expect(resumen.porMotivo.map((c) => c.motivo)).toEqual([...MOTIVO_ORDER]);
  });

  it('la suma de los motivos es el total', () => {
    const lista = [d('otro'), d('otro'), d('vencimiento'), d('rotura_danio'), d('rotura_danio'), d('rotura_danio')];
    const resumen = resumenDelMes(lista);
    expect(resumen.porMotivo.reduce((suma, c) => suma + c.cantidad, 0)).toBe(resumen.total);
  });

  it('no modifica la lista que recibe', () => {
    const lista = Object.freeze([d('otro'), d('vencimiento')]);
    expect(() => resumenDelMes(lista)).not.toThrow();
    expect(lista).toHaveLength(2);
  });
});

describe('textoTotalDevoluciones', () => {
  it('singular y plural', () => {
    expect(textoTotalDevoluciones(1, false)).toBe('1 devolución');
    expect(textoTotalDevoluciones(2, false)).toBe('2 devoluciones');
    expect(textoTotalDevoluciones(0, false)).toBe('0 devoluciones');
    expect(textoTotalDevoluciones(200, false)).toBe('200 devoluciones');
  });

  it('con la lista parcial aclara que son las más recientes', () => {
    expect(textoTotalDevoluciones(200, true)).toBe('200 devoluciones (las más recientes)');
  });
});

describe('textoPorMotivo', () => {
  it('"Rotura o daño 2 · Vencimiento 1"', () => {
    expect(
      textoPorMotivo([
        { motivo: 'rotura_danio', cantidad: 2 },
        { motivo: 'vencimiento', cantidad: 1 },
      ]),
    ).toBe('Rotura o daño 2 · Vencimiento 1');
  });

  it('con un solo motivo no lleva separador; sin motivos queda vacío', () => {
    expect(textoPorMotivo([{ motivo: 'mercaderia_incorrecta', cantidad: 3 }])).toBe('Mercadería incorrecta 3');
    expect(textoPorMotivo([])).toBe('');
  });

  it('de punta a punta con el resumen: los cuatro motivos', () => {
    const resumen = resumenDelMes([d('otro'), d('mercaderia_incorrecta'), d('vencimiento'), d('rotura_danio'), d('rotura_danio')]);
    expect(textoPorMotivo(resumen.porMotivo)).toBe('Rotura o daño 2 · Vencimiento 1 · Mercadería incorrecta 1 · Otro 1');
  });
});
