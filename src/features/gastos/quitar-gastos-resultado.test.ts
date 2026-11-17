import { describe, expect, it } from 'vitest';

import { armarResultadoDeQuitar } from './quitar-gastos-resultado';

// Lo que muestra el aviso del resultado de un «Quitar»: cuántos gastos se quitaron del viaje y cuántos de los marcados ya no estaban.

const A = 'e1000000-0000-4000-8000-00000000000a';
const B = 'e1000000-0000-4000-8000-00000000000b';
const C = 'e1000000-0000-4000-8000-00000000000c';
const D = 'e1000000-0000-4000-8000-00000000000d';
const FUERA = 'e1000000-0000-4000-8000-0000000000ff';

describe('armarResultadoDeQuitar', () => {
  it('todo lo pedido se quitó: «quitados» es lo pedido y nada «ya no estaba»', () => {
    expect(armarResultadoDeQuitar([A, B, C], [A, B, C])).toEqual({ quitados: 3, yaNoEstaban: 0 });
  });

  it('lo pedido que la base NO devolvió ya no estaba en el viaje (otro dispositivo lo quitó o lo movió)', () => {
    expect(armarResultadoDeQuitar([A, B, C, D], [A, C])).toEqual({ quitados: 2, yaNoEstaban: 2 });
  });

  it('no se quitó ninguno: todos «ya no estaban»', () => {
    expect(armarResultadoDeQuitar([A, B], [])).toEqual({ quitados: 0, yaNoEstaban: 2 });
  });

  it('no importa el orden en que vuelve lo quitado', () => {
    expect(armarResultadoDeQuitar([A, B, C], [C, A])).toEqual({ quitados: 2, yaNoEstaban: 1 });
  });

  it('se cuentan los pedidos DISTINTOS: un repetido en lo pedido no cuenta dos veces', () => {
    expect(armarResultadoDeQuitar([A, B, A], [A, B])).toEqual({ quitados: 2, yaNoEstaban: 0 });
    expect(armarResultadoDeQuitar([A, A, B], [A])).toEqual({ quitados: 1, yaNoEstaban: 1 });
  });

  it('un id de más en la respuesta (que no se pidió) NO cuenta como quitado: nunca salen más quitados que pedidos', () => {
    expect(armarResultadoDeQuitar([A], [A, FUERA])).toEqual({ quitados: 1, yaNoEstaban: 0 });
    expect(armarResultadoDeQuitar([A], [FUERA])).toEqual({ quitados: 0, yaNoEstaban: 1 });
  });

  it('un id repetido en la respuesta cuenta una sola vez', () => {
    expect(armarResultadoDeQuitar([A, B], [A, A, A])).toEqual({ quitados: 1, yaNoEstaban: 1 });
  });

  it('un uuid en mayúsculas y el mismo en minúsculas son el mismo gasto', () => {
    expect(armarResultadoDeQuitar([A.toUpperCase(), B], [A, B.toUpperCase()])).toEqual({ quitados: 2, yaNoEstaban: 0 });
  });

  it('sin nada pedido: todo en cero, y no cambia lo que recibe', () => {
    expect(armarResultadoDeQuitar([], [])).toEqual({ quitados: 0, yaNoEstaban: 0 });
    const pedidos = Object.freeze([A, B]);
    const quitados = Object.freeze([A]);
    expect(armarResultadoDeQuitar(pedidos, quitados)).toEqual({ quitados: 1, yaNoEstaban: 1 });
    expect([...pedidos]).toEqual([A, B]);
    expect([...quitados]).toEqual([A]);
  });

  it('con 100 pedidos (el máximo) y 40 que ya no estaban', () => {
    const pedidos = Array.from({ length: 100 }, (_, i) => `g${i}`);
    expect(armarResultadoDeQuitar(pedidos, pedidos.slice(0, 60))).toEqual({ quitados: 60, yaNoEstaban: 40 });
  });
});
