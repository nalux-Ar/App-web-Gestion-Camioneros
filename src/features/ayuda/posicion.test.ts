import { describe, expect, it } from 'vitest';

import {
  ANCHO_ESCRITORIO,
  buscarObjetivo,
  calcularPosicion,
  elegirObjetivoVisible,
  MARGEN,
  pasosResolubles,
  textoContador,
  type PasoTour,
  type Rect,
} from './posicion';

const CELULAR = { ancho: 375, alto: 800 };
const ESCRITORIO = { ancho: 1280, alto: 800 };
const TARJETA = { ancho: 300, alto: 200 };
const rect = (top: number, left: number, width = 100, height = 40): Rect => ({ top, left, width, height });

describe('calcularPosicion: celular (hoja fija)', () => {
  it('objetivo en la mitad de ARRIBA: hoja abajo', () => {
    expect(calcularPosicion(rect(60, 10), TARJETA, CELULAR)).toEqual({ modo: 'hoja', lado: 'abajo' });
  });

  it('objetivo en la mitad de ABAJO (p. ej. la barra de navegación): hoja arriba, para no taparlo', () => {
    expect(calcularPosicion(rect(744, 0, 75, 56), TARJETA, CELULAR)).toEqual({ modo: 'hoja', lado: 'arriba' });
  });

  it('decide por el CENTRO del objetivo (un objetivo alto que cruza la mitad)', () => {
    expect(calcularPosicion(rect(300, 0, 100, 80), TARJETA, CELULAR)).toEqual({ modo: 'hoja', lado: 'abajo' }); // centro 340
    expect(calcularPosicion(rect(380, 0, 100, 80), TARJETA, CELULAR)).toEqual({ modo: 'hoja', lado: 'arriba' }); // centro 420
    expect(calcularPosicion(rect(380, 0, 100, 40), TARJETA, CELULAR)).toEqual({ modo: 'hoja', lado: 'arriba' }); // centro 400 = mitad
  });

  it('con zoom o barra dinámica (offsetTop del visualViewport), mide contra lo visible', () => {
    expect(calcularPosicion(rect(450, 0), TARJETA, { ...CELULAR, offsetTop: 200 })).toEqual({ modo: 'hoja', lado: 'abajo' });
  });

  it('sin objetivo: hoja abajo', () => {
    expect(calcularPosicion(null, TARJETA, CELULAR)).toEqual({ modo: 'hoja', lado: 'abajo' });
  });

  it(`el corte es ${ANCHO_ESCRITORIO} px: uno menos es celular, ese mismo es escritorio`, () => {
    expect(calcularPosicion(rect(60, 10), TARJETA, { ancho: ANCHO_ESCRITORIO - 1, alto: 800 }).modo).toBe('hoja');
    expect(calcularPosicion(rect(60, 10), TARJETA, { ancho: ANCHO_ESCRITORIO, alto: 800 }).modo).toBe('tarjeta');
  });
});

describe('calcularPosicion: escritorio (tarjeta anclada)', () => {
  it('abajo del objetivo, centrada horizontalmente', () => {
    expect(calcularPosicion(rect(100, 500, 100, 40), TARJETA, ESCRITORIO)).toEqual({ modo: 'tarjeta', lado: 'abajo', top: 140 + MARGEN, left: 400 });
  });

  it('si abajo no entra: arriba (flip)', () => {
    expect(calcularPosicion(rect(700, 500, 100, 40), TARJETA, ESCRITORIO)).toEqual({ modo: 'tarjeta', lado: 'arriba', top: 700 - MARGEN - 200, left: 400 });
  });

  it('justo entra abajo (borde exacto)', () => {
    const top = 800 - MARGEN - 200 - MARGEN - 40; // abajo = top + 40 + margen = 800 - margen - 200
    expect(calcularPosicion(rect(top, 500), TARJETA, ESCRITORIO)).toMatchObject({ lado: 'abajo' });
  });

  it('ni abajo ni arriba (objetivo alto): a la derecha, con el top centrado y acotado', () => {
    const pos = calcularPosicion(rect(100, 200, 200, 600), TARJETA, ESCRITORIO);
    expect(pos).toEqual({ modo: 'tarjeta', lado: 'derecha', top: 300, left: 400 + MARGEN });
  });

  it('si tampoco entra a la derecha: a la izquierda', () => {
    const pos = calcularPosicion(rect(100, 900, 300, 600), TARJETA, ESCRITORIO);
    expect(pos).toEqual({ modo: 'tarjeta', lado: 'izquierda', top: 300, left: 900 - MARGEN - 300 });
  });

  it('si no entra por ningún lado: centrada', () => {
    expect(calcularPosicion(rect(0, 0, 1280, 800), TARJETA, ESCRITORIO)).toEqual({ modo: 'centrado' });
  });

  it('shift: un objetivo pegado al borde izquierdo o derecho no saca la tarjeta de la ventana', () => {
    expect(calcularPosicion(rect(100, 0, 40, 40), TARJETA, ESCRITORIO)).toMatchObject({ left: MARGEN });
    expect(calcularPosicion(rect(100, 1260, 20, 40), TARJETA, ESCRITORIO)).toMatchObject({ left: 1280 - MARGEN - 300 });
  });

  it('una tarjeta más ancha que la ventana queda pegada al margen izquierdo', () => {
    expect(calcularPosicion(rect(100, 400), { ancho: 2000, alto: 100 }, ESCRITORIO)).toMatchObject({ left: MARGEN });
  });

  it('con offsets del visualViewport, los límites se corren', () => {
    expect(calcularPosicion(rect(300, 0, 40, 40), TARJETA, { ...ESCRITORIO, offsetLeft: 100, offsetTop: 200 })).toMatchObject({ left: 100 + MARGEN });
  });

  it('sin objetivo: centrada', () => {
    expect(calcularPosicion(null, TARJETA, ESCRITORIO)).toEqual({ modo: 'centrado' });
  });
});

describe('elegirObjetivoVisible y buscarObjetivo', () => {
  const elemento = (cajas: number, ancho: number, alto: number) =>
    ({ getClientRects: () => ({ length: cajas }), getBoundingClientRect: () => ({ width: ancho, height: alto }) }) as unknown as Element;

  it('el PRIMERO que se ve (con cajas y tamaño)', () => {
    const oculto = elemento(0, 0, 0); // display: none (p. ej. el de la barra de abajo en escritorio)
    const visible = elemento(1, 80, 48);
    const otro = elemento(1, 80, 48);
    expect(elegirObjetivoVisible([oculto, visible, otro])).toBe(visible);
  });

  it('con cajas pero sin tamaño, o con tamaño en una sola dimensión: no cuenta', () => {
    expect(elegirObjetivoVisible([elemento(1, 0, 0), elemento(1, 80, 0), elemento(1, 0, 48)])).toBeNull();
    expect(elegirObjetivoVisible([])).toBeNull();
  });

  it('buscarObjetivo arma el selector SOLO con valores válidos (nada que inyectar en el selector)', () => {
    const pedidos: string[] = [];
    const raiz = { querySelectorAll: (selector: string) => (pedidos.push(selector), []) } as unknown as ParentNode;
    expect(buscarObjetivo('nav-viajes', raiz)).toBeNull();
    expect(pedidos).toEqual(['[data-ayuda="nav-viajes"]']);
    for (const malo of ['x"] , body', 'Nav', 'a b', '', 'a'.repeat(41)]) expect(buscarObjetivo(malo, raiz)).toBeNull();
    expect(pedidos).toHaveLength(1);
  });

  it('buscarObjetivo devuelve el visible de los que encuentra', () => {
    const visible = elemento(1, 10, 10);
    const raiz = { querySelectorAll: () => [elemento(0, 0, 0), visible] } as unknown as ParentNode;
    expect(buscarObjetivo('camion', raiz)).toBe(visible);
  });
});

describe('pasosResolubles y el contador', () => {
  const paso = (id: string, objetivo: string | null, siFalta: PasoTour['siFalta'] = 'saltar'): PasoTour => ({ id, objetivo, titulo: id, texto: id, siFalta });
  const pasos = [paso('hola', null), paso('a', 'a'), paso('b', 'b'), paso('c', 'c', 'centrado'), paso('fin', null)];

  it('centrados siempre; con objetivo, si existe; si falta, según siFalta', () => {
    const lista = pasosResolubles(pasos, (objetivo) => objetivo === 'a');
    expect(lista.map((p) => [p.id, p.conObjetivo])).toEqual([
      ['hola', false],
      ['a', true],
      ['c', false],
      ['fin', false],
    ]);
  });

  it('el contador es de la lista resuelta (no cuenta los salteados)', () => {
    const lista = pasosResolubles(pasos, () => false);
    expect(lista).toHaveLength(3);
    expect(textoContador(0, lista.length)).toBe('Paso 1 de 3');
    expect(textoContador(2, lista.length)).toBe('Paso 3 de 3');
  });

  it('no modifica los pasos recibidos', () => {
    pasosResolubles(pasos, () => true);
    expect(pasos[1]).not.toHaveProperty('conObjetivo');
  });
});
