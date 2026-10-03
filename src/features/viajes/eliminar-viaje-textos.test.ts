import { describe, expect, it } from 'vitest';

import { textoBorradoIncompleto, textoConteoCambiado, textosDeBorrado } from '@/features/viajes/eliminar-viaje-textos';

describe('avisos cuando el borrado no se completa', () => {
  it('textoConteoCambiado: dice la cantidad de ahora (0, 1 en singular, N en plural) y pide volver a confirmar', () => {
    expect(textoConteoCambiado(0)).toBe('El viaje ya no tiene gastos vinculados. Revisa y vuelve a confirmar.');
    expect(textoConteoCambiado(1)).toBe('Ahora el viaje tiene 1 gasto vinculado. Revisa y vuelve a confirmar.');
    expect(textoConteoCambiado(7)).toBe('Ahora el viaje tiene 7 gastos vinculados. Revisa y vuelve a confirmar.');
  });

  it('textoBorradoIncompleto: dice qué ya pasó (en singular o plural) y qué falta, seguido del motivo', () => {
    expect(textoBorradoIncompleto(1, 'No hay conexión.')).toBe('El gasto ya quedó sin viaje, pero el viaje no se borró. No hay conexión.');
    expect(textoBorradoIncompleto(4, 'No hay conexión.')).toBe('Los 4 gastos ya quedaron sin viaje, pero el viaje no se borró. No hay conexión.');
  });
});

describe('textos de la confirmación de borrar un viaje', () => {
  it('0 gastos: el texto de siempre y "Sí, eliminar"', () => {
    expect(textosDeBorrado({ tipo: 'listo', cantidad: 0 })).toEqual({
      prompt: '¿Seguro? Esto no se puede deshacer.',
      confirmLabel: 'Sí, eliminar',
      puedeConfirmar: true,
    });
  });

  it('N gastos: dice cuántos, que se conservan y que quedan sin viaje; el botón lo nombra', () => {
    const t = textosDeBorrado({ tipo: 'listo', cantidad: 7 });
    expect(t.prompt).toContain('Este viaje tiene 7 gastos. Se conservan, pero quedan sin viaje.');
    expect(t.confirmLabel).toBe('Desvincular los gastos y borrar el viaje');
    expect(t.puedeConfirmar).toBe(true);
  });

  it('1 gasto: singular', () => {
    const t = textosDeBorrado({ tipo: 'listo', cantidad: 1 });
    expect(t.prompt).toContain('Este viaje tiene 1 gasto. Se conserva, pero queda sin viaje.');
    expect(t.prompt).not.toContain('1 gastos');
    expect(t.confirmLabel).toBe('Desvincular el gasto y borrar el viaje');
  });

  it('conteo fallido: texto genérico y se puede confirmar igual', () => {
    const t = textosDeBorrado({ tipo: 'error' });
    expect(t.prompt).toContain('Si tiene gastos vinculados, se conservan pero quedan sin viaje.');
    expect(t.confirmLabel).toBe('Sí, eliminar');
    expect(t.puedeConfirmar).toBe(true);
  });

  it('mientras se cuenta: no se puede confirmar todavía', () => {
    const t = textosDeBorrado({ tipo: 'cargando' });
    expect(t.puedeConfirmar).toBe(false);
    expect(t.prompt).toContain('Revisando');
  });

  it('un conteo negativo (no debería pasar) no inventa un texto con gastos', () => {
    expect(textosDeBorrado({ tipo: 'listo', cantidad: -3 }).prompt).toBe('¿Seguro? Esto no se puede deshacer.');
  });
});
