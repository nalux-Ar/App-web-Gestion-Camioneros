import { describe, expect, it } from 'vitest';

import { isUuid } from '@/lib/uuid';
import { claveDeCategoria, nuevoEnvio, reiniciarEnvio } from './gasto-envio';

// Las claves de idempotencia y lo ya mandado van SIEMPRE juntos: la única forma de reiniciar es reemplazar el envío entero.

const A = 'a0000000-0000-4000-8000-000000000001';
const B = 'a0000000-0000-4000-8000-000000000002';

/** Un generador que da uuid conocidos y distintos, para saber cuántas veces se pidió una clave. */
function generador() {
  let n = 0;
  const pedidos: string[] = [];
  const generar = () => {
    n += 1;
    const clave = `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    pedidos.push(clave);
    return clave;
  };
  return { generar, pedidos };
}

describe('nuevoEnvio', () => {
  it('arranca sin nada mandado, con la clave del gasto único ya creada (un uuid) y sin claves por categoría', () => {
    const envio = nuevoEnvio();
    expect(envio.sent.size).toBe(0);
    expect(isUuid(envio.clave)).toBe(true);
    expect(envio.porCategoria.size).toBe(0);
  });

  it('dos envíos nuevos nunca comparten clave ni conjunto de huellas', () => {
    const uno = nuevoEnvio();
    const otro = nuevoEnvio();
    expect(uno.clave).not.toBe(otro.clave);
    expect(uno.sent).not.toBe(otro.sent);
    expect(uno.porCategoria).not.toBe(otro.porCategoria);
  });
});

describe('claveDeCategoria', () => {
  it('da UNA clave por categoría y siempre la misma (los reintentos mandan lo mismo)', () => {
    const { generar, pedidos } = generador();
    const envio = nuevoEnvio(generar);
    const deA = claveDeCategoria(envio, A, generar);
    expect(claveDeCategoria(envio, A, generar)).toBe(deA);
    expect(claveDeCategoria(envio, A, generar)).toBe(deA);
    expect(pedidos).toHaveLength(2); // la del gasto único y la de A: se generó UNA sola vez por categoría
  });

  it('cada categoría tiene la suya, distinta de las demás y de la del gasto único', () => {
    const envio = nuevoEnvio();
    const deA = claveDeCategoria(envio, A);
    const deB = claveDeCategoria(envio, B);
    expect(new Set([envio.clave, deA, deB]).size).toBe(3);
    expect(isUuid(deA) && isUuid(deB)).toBe(true);
  });

  it('no depende del orden en que se pidan', () => {
    const envio = nuevoEnvio();
    const deB = claveDeCategoria(envio, B);
    const deA = claveDeCategoria(envio, A);
    expect(claveDeCategoria(envio, B)).toBe(deB);
    expect(claveDeCategoria(envio, A)).toBe(deA);
  });
});

describe('reiniciarEnvio: lo mandado y las claves se renuevan JUNTOS, nunca una sola de las dos partes', () => {
  it('devuelve un envío entero nuevo: huellas vacías y TODAS las claves distintas de las de antes', () => {
    const antes = nuevoEnvio();
    const claveAntesDeA = claveDeCategoria(antes, A);
    const claveAntesDeB = claveDeCategoria(antes, B);
    antes.sent.add('lo que se mandó');

    const despues = reiniciarEnvio();
    expect(despues.sent.size).toBe(0);
    expect(despues.clave).not.toBe(antes.clave);
    expect(claveDeCategoria(despues, A)).not.toBe(claveAntesDeA);
    expect(claveDeCategoria(despues, B)).not.toBe(claveAntesDeB);
  });

  it('el envío de antes no se toca: no se vació solo el registro de lo mandado dejando las mismas claves', () => {
    const antes = nuevoEnvio();
    const claveAntesDeA = claveDeCategoria(antes, A);
    antes.sent.add('lo que se mandó');
    const despues = reiniciarEnvio();
    expect(despues).not.toBe(antes);
    expect(despues.sent).not.toBe(antes.sent);
    expect(antes.sent.size).toBe(1);
    expect(claveDeCategoria(antes, A)).toBe(claveAntesDeA);
  });

  it('en el envío nuevo no queda ninguna clave por categoría de antes: se piden de nuevo y salen otras', () => {
    const { generar } = generador();
    const antes = nuevoEnvio(generar);
    claveDeCategoria(antes, A, generar);
    const despues = reiniciarEnvio(generar);
    expect(despues.porCategoria.size).toBe(0);
    expect(claveDeCategoria(despues, A, generar)).not.toBe(antes.porCategoria.get(A));
  });

  it('el envío que devuelve tiene siempre la misma forma que uno nuevo (no hay un reinicio a medias)', () => {
    const reiniciado = reiniciarEnvio();
    expect(Object.keys(reiniciado).sort()).toEqual(Object.keys(nuevoEnvio()).sort());
    expect(isUuid(reiniciado.clave)).toBe(true);
  });
});
