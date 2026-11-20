import { describe, expect, it } from 'vitest';

import { MAX_GASTOS_POR_CARGA } from './constants';
import { esCantidadDeGastosGuardados, leerCantidadDeGastosGuardados, mensajeDeGastosGuardados } from './gasto-varios-avisos';

// «Guardaste N gastos.»: la cantidad viaja en el location.state, que NO es de confianza. Solo cuenta un entero entre 2 y el máximo.

describe('esCantidadDeGastosGuardados', () => {
  it('acepta los enteros desde 2 hasta el máximo por carga, y solo esos', () => {
    for (let n = 2; n <= MAX_GASTOS_POR_CARGA; n++) expect(esCantidadDeGastosGuardados(n), String(n)).toBe(true);
    for (const n of [-1, 0, 1, MAX_GASTOS_POR_CARGA + 1, 100, 1e9]) expect(esCantidadDeGastosGuardados(n), String(n)).toBe(false);
  });

  it('el máximo es el de la carga (10): con uno el aviso es «Gasto guardado.», que no lleva número', () => {
    expect(MAX_GASTOS_POR_CARGA).toBe(10);
    expect(esCantidadDeGastosGuardados(1)).toBe(false);
    expect(esCantidadDeGastosGuardados(10)).toBe(true);
    expect(esCantidadDeGastosGuardados(11)).toBe(false);
  });

  it('rechaza lo que no es un entero: decimales, NaN, infinitos', () => {
    for (const n of [2.5, 3.0000001, NaN, Infinity, -Infinity]) expect(esCantidadDeGastosGuardados(n), String(n)).toBe(false);
  });

  it('rechaza todo lo que no es un número: textos, objetos, booleanos, vacíos', () => {
    for (const raro of ['3', '2', ' 3', '3 gastos', '<b>3</b>', true, false, null, undefined, {}, [], [3], { valueOf: () => 3 }, 3n, Symbol('3')]) {
      expect(esCantidadDeGastosGuardados(raro), String(typeof raro)).toBe(false);
    }
  });
});

describe('leerCantidadDeGastosGuardados', () => {
  it('lee la cantidad válida del state', () => {
    expect(leerCantidadDeGastosGuardados({ aviso: 'guardados', cantidad: 3 })).toBe(3);
    expect(leerCantidadDeGastosGuardados({ cantidad: 10 })).toBe(10);
  });

  it('un state que no es un objeto, o sin cantidad, o con una cantidad que no sirve: null', () => {
    for (const estado of [null, undefined, 3, 'cantidad', true, [], {}, { cantidad: 1 }, { cantidad: 11 }, { cantidad: '3' }, { cantidad: 2.5 }]) {
      expect(leerCantidadDeGastosGuardados(estado), JSON.stringify(estado)).toBeNull();
    }
  });
});

describe('mensajeDeGastosGuardados', () => {
  it('«Guardaste N gastos.» con la cantidad validada', () => {
    expect(mensajeDeGastosGuardados({ cantidad: 2 })).toBe('Guardaste 2 gastos.');
    expect(mensajeDeGastosGuardados({ cantidad: 10 })).toBe('Guardaste 10 gastos.');
  });

  it('sin una cantidad válida no hay mensaje (el aviso no se muestra)', () => {
    expect(mensajeDeGastosGuardados({ cantidad: 1 })).toBeNull();
    expect(mensajeDeGastosGuardados({ cantidad: '5' })).toBeNull();
    expect(mensajeDeGastosGuardados(null)).toBeNull();
  });

  it('el texto NUNCA sale del estado: un texto raro en otra clave del state no llega al mensaje', () => {
    const mensaje = mensajeDeGastosGuardados({ cantidad: 3, mensaje: '<b>hack</b>', texto: 'Guardaste 999 gastos.', aviso: '<img src=x>' });
    expect(mensaje).toBe('Guardaste 3 gastos.');
    expect(mensaje).not.toContain('hack');
  });
});
