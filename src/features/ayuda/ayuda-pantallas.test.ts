import { describe, expect, it } from 'vitest';

import * as pantallas from './ayuda-pantallas';
import type { AyudaPantalla } from './ayuda-pantallas';

const TODAS = Object.entries(pantallas).filter(([nombre]) => nombre.startsWith('AYUDA_')) as Array<[string, AyudaPantalla]>;
const TEXTOS = TODAS.flatMap(([nombre, a]) => [{ nombre, texto: a.titulo }, ...a.puntos.map((texto) => ({ nombre, texto }))]);

/** Palabras enteras (con letras acentuadas: \b no sirve). */
const palabras = (lista: string) => new RegExp(String.raw`(?<![\p{L}])(?:${lista})(?![\p{L}])`, 'iu');

describe('textos de ayuda por pantalla', () => {
  it('hay una ayuda por cada pantalla con "i" (14)', () => {
    expect(TODAS).toHaveLength(14);
  });

  it.each(TODAS)('%s: título y entre 3 y 5 puntos, sin repetidos', (_nombre, a) => {
    expect(a.titulo.trim()).not.toBe('');
    expect(a.puntos.length).toBeGreaterThanOrEqual(3);
    expect(a.puntos.length).toBeLessThanOrEqual(5);
    expect(new Set(a.puntos).size).toBe(a.puntos.length);
  });

  it('los títulos no se repiten', () => {
    const titulos = TODAS.map(([, a]) => a.titulo);
    expect(new Set(titulos).size).toBe(titulos.length);
  });

  it('textos planos: nada de HTML ni de marcado', () => {
    for (const { nombre, texto } of TEXTOS) expect(texto, nombre).not.toMatch(/[<>]|&\w+;|\*\*|\]\(/);
  });

  it('español neutro "de tú": ni voseo ni "acá"', () => {
    const voseo = palabras('acá|vos|tenés|podés|querés|cargás|elegís|fijate|mirá|tocá|escribí|cargá|elegí|contanos|anotá|usá|andá|decime|sos|hacé|ponés');
    for (const { nombre, texto } of TEXTOS) expect(texto, nombre).not.toMatch(voseo);
  });

  it('con acentos donde corresponden (palabras frecuentes escritas sin tilde)', () => {
    const sinTilde = palabras('camion|tambien|aqui|asi|kilometros|odometro|descripcion|devolucion|configuracion|telefono|direccion|estan|facil|rapido|numero|electronico|mas');
    for (const { nombre, texto } of TEXTOS) expect(texto, nombre).not.toMatch(sinTilde);
  });

  it('sin datos de personas ni del negocio (correos, teléfonos, patentes, montos)', () => {
    for (const { nombre, texto } of TEXTOS) {
      expect(texto, nombre).not.toMatch(/@\w|\d{6,}|\b[A-Z]{2}\s?\d{3}\s?[A-Z]{2}\b|\$\s?\d/);
    }
  });

  it('el texto del botón del recorrido es el de siempre', () => {
    expect(pantallas.TEXTO_VER_RECORRIDO).toBe('Ver el recorrido otra vez');
  });
});
