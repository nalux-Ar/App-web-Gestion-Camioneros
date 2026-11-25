import { describe, expect, it } from 'vitest';

import { formatDateShort, formatDateWithYear } from '@/lib/dates';
import { BOTON_CAMBIAR_FECHA, NOMBRE_CAMBIAR_FECHA, ROTULO_FECHA, textoDeLaFecha } from './gasto-fecha-textos';

// La fila plegada de la fecha de «Nuevo gasto»: «Fecha: hoy» y «Cambiar».

const HOY = '2026-11-25';

describe('los textos de la fila de la fecha', () => {
  it('«Fecha:» y «Cambiar» (el nombre accesible, «Cambiar la fecha»)', () => {
    expect(ROTULO_FECHA).toBe('Fecha:');
    expect(BOTON_CAMBIAR_FECHA).toBe('Cambiar');
    expect(NOMBRE_CAMBIAR_FECHA).toBe('Cambiar la fecha');
  });

  it('el nombre accesible EMPIEZA con el texto que se ve en el botón (quien dice «tocar Cambiar» lo encuentra)', () => {
    expect(NOMBRE_CAMBIAR_FECHA.startsWith(BOTON_CAMBIAR_FECHA)).toBe(true);
  });

});

describe('textoDeLaFecha', () => {
  it('«hoy» si es la fecha de hoy', () => {
    expect(textoDeLaFecha(HOY, HOY)).toBe('hoy');
  });

  it('si no es hoy y es de este año, la fecha corta de las listas de gastos (formatDateShort)', () => {
    expect(textoDeLaFecha('2026-11-24', HOY)).toBe('24 nov');
    expect(textoDeLaFecha('2026-01-02', HOY)).toBe(formatDateShort('2026-01-02'));
    expect(textoDeLaFecha('2026-09-30', HOY)).toBe('30 sep');
  });

  it('de otro año lleva el año (así un gasto viejo no se confunde con uno de este año)', () => {
    expect(textoDeLaFecha('2025-11-25', HOY)).toBe('25 nov 2025');
    expect(textoDeLaFecha('2025-11-25', HOY)).toBe(formatDateWithYear('2025-11-25'));
    expect(textoDeLaFecha('2000-01-01', HOY)).toBe('1 ene 2000');
  });

  it('el mismo día de otro año NO es «hoy»', () => {
    expect(textoDeLaFecha('2025-11-25', HOY)).not.toBe('hoy');
  });

  it('mañana (una fecha futura, que la validación rechaza) no es «hoy»', () => {
    expect(textoDeLaFecha('2026-11-26', HOY)).toBe('26 nov');
  });

  it('un texto que no es una fecha se devuelve tal cual (no rompe el dibujo)', () => {
    expect(textoDeLaFecha('infinity', HOY)).not.toBe('hoy');
    expect(() => textoDeLaFecha('', HOY)).not.toThrow();
  });
});
