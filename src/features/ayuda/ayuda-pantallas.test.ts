import { describe, expect, it } from 'vitest';

import { REPORTAR_VISIBLE } from '@/features/reportar/reportar-config';
import * as pantallas from './ayuda-pantallas';
import type { AyudaPantalla } from './ayuda-pantallas';

const TODAS = Object.entries(pantallas).filter(([nombre]) => nombre.startsWith('AYUDA_')) as Array<[string, AyudaPantalla]>;

// Inicio y Configuración cambian con el interruptor de «Reportar un problema» (`reportar-config.ts`): se prueban en sus DOS
// estados, y las reglas de forma y de idioma de abajo valen para los dos.
const VARIANTES: Array<[string, AyudaPantalla]> = [
  ['ayudaInicio(false)', pantallas.ayudaInicio(false)],
  ['ayudaInicio(true)', pantallas.ayudaInicio(true)],
  ['ayudaConfiguracion(false)', pantallas.ayudaConfiguracion(false)],
  ['ayudaConfiguracion(true)', pantallas.ayudaConfiguracion(true)],
];
const CON_VARIANTES: Array<[string, AyudaPantalla]> = [...TODAS, ...VARIANTES];
const TEXTOS = CON_VARIANTES.flatMap(([nombre, a]) => [{ nombre, texto: a.titulo }, ...a.puntos.map((texto) => ({ nombre, texto }))]);

/** Palabras enteras (con letras acentuadas: \b no sirve). */
const palabras = (lista: string) => new RegExp(String.raw`(?<![\p{L}])(?:${lista})(?![\p{L}])`, 'iu');

describe('textos de ayuda por pantalla', () => {
  it('hay una ayuda por cada pantalla con "i" (14)', () => {
    expect(TODAS).toHaveLength(14);
  });

  it.each(CON_VARIANTES)('%s: título y entre 3 y 5 puntos, sin repetidos', (_nombre, a) => {
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

describe('«Reportar un problema» en la ayuda de Inicio y de Configuración', () => {
  const FRASE = 'Si algo falla o se ve raro, usa «Reportar un problema».';
  const CAMBIAN: Array<[string, (reportarVisible: boolean) => AyudaPantalla]> = [
    ['Inicio', pantallas.ayudaInicio],
    ['Configuración', pantallas.ayudaConfiguracion],
  ];

  it.each(CAMBIAN)('%s, APAGADO: 3 puntos y ninguno nombra la función', (_nombre, ayuda) => {
    const apagada = ayuda(false);
    expect(apagada.puntos).toHaveLength(3);
    expect(apagada.puntos.join(' ')).not.toMatch(/Reportar un problema/);
  });

  it.each(CAMBIAN)('%s, ENCENDIDO: es la de apagado MÁS la frase al final (mismo título, mismos puntos, mismo orden)', (_nombre, ayuda) => {
    expect(ayuda(true).titulo).toBe(ayuda(false).titulo);
    expect(ayuda(true).puntos).toEqual([...ayuda(false).puntos, FRASE]);
  });

  it('las demás ayudas no nombran la función (solo Inicio y Configuración, que cambian con el interruptor)', () => {
    const otras = TODAS.filter(([nombre]) => nombre !== 'AYUDA_INICIO' && nombre !== 'AYUDA_CONFIGURACION');
    expect(otras).toHaveLength(TODAS.length - 2);
    for (const [nombre, a] of otras) expect([a.titulo, ...a.puntos].join(' '), nombre).not.toMatch(/Reportar un problema/);
  });

  it('`AYUDA_INICIO` y `AYUDA_CONFIGURACION` (lo que usa la app) salen del interruptor real', () => {
    expect(pantallas.AYUDA_INICIO).toEqual(pantallas.ayudaInicio(REPORTAR_VISIBLE));
    expect(pantallas.AYUDA_CONFIGURACION).toEqual(pantallas.ayudaConfiguracion(REPORTAR_VISIBLE));
  });
});
