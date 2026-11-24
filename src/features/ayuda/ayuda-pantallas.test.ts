import { describe, expect, it } from 'vitest';

import { MAX_GASTOS_POR_VEZ } from '@/features/gastos/constants';
import { ELEGIR_EL_VIAJE as BOTON_ELEGIR_EL_VIAJE } from '@/features/gastos/sumar-a-viaje-textos';
import { BOTON_ENTRADA_SUMAR_GASTOS } from '@/features/gastos/sumar-gastos-textos';
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
  it('hay una ayuda por cada pantalla con "i" (17)', () => {
    expect(TODAS).toHaveLength(17);
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

  it('sin las palabras viejas: «cargar» un dato, «odómetro», «Ingreso», «Incidencias», «archivar»', () => {
    const viejas = palabras('cargar|carga|cargas|cargaste|cargado|cargada|cargados|cargadas|odómetro|ingreso|ingresos|incidencias?|archivar|archivado|archivados');
    for (const { nombre, texto } of TEXTOS) {
      // «carga(s) de combustible» (la del tanque) es palabra del oficio y se queda.
      expect(texto.replace(/cargas? de combustible/gi, ''), nombre).not.toMatch(viejas);
    }
  });

  it('ninguna ayuda manda a tocar la «i»: el botón se llama «Ayuda»', () => {
    for (const { nombre, texto } of TEXTOS) expect(texto, nombre).not.toMatch(/«i»|"i"|“i”|\bla i\b/);
  });

  it('las ayudas nombran los botones con el texto nuevo: «Ya no uso este camión», «Lo que cobraste»', () => {
    expect(pantallas.AYUDA_CAMIONES.puntos.join(' ')).toContain('«Ya no uso este camión»');
    expect(pantallas.AYUDA_CAMION_FORM.puntos.join(' ')).toContain('«Ya no uso este camión»');
    expect(pantallas.AYUDA_VIAJE_FORM.puntos.join(' ')).toContain('«Lo que cobraste»');
  });

  it('la ayuda de Configuración dice que ahí se cierra la sesión (ya no hay «Salir» en el encabezado) y ninguna ayuda manda a «Salir»', () => {
    for (const reportar of [false, true]) {
      expect(pantallas.ayudaConfiguracion(reportar).puntos[0]).toBe('Aquí ves con qué cuenta iniciaste sesión y puedes cerrarla.');
    }
    for (const { nombre, texto } of TEXTOS) expect(texto, nombre).not.toMatch(/\bsalir\b/i);
  });

  it('el texto del botón del recorrido es el de siempre', () => {
    expect(pantallas.TEXTO_VER_RECORRIDO).toBe('Ver el recorrido otra vez');
  });
});

describe('la ayuda de «Sumar gastos que ya cargué»', () => {
  const ayuda = pantallas.AYUDA_SUMAR_GASTOS;
  const texto = ayuda.puntos.join(' ');

  it('tiene título propio y entre 3 y 5 puntos cortos', () => {
    expect(ayuda.titulo).toBe('Ayuda para sumar gastos al viaje');
    expect(ayuda.puntos.length).toBeGreaterThanOrEqual(3);
    expect(ayuda.puntos.length).toBeLessThanOrEqual(5);
    // cortos: ninguno pasa de 100 caracteres y todos juntos no son más largos que la ayuda más larga de las demás pantallas + 15 %
    for (const punto of ayuda.puntos) expect(punto.length).toBeLessThanOrEqual(100);
    const total = (a: AyudaPantalla) => a.puntos.join('').length;
    const lasDemas = TODAS.filter(([nombre]) => nombre !== 'AYUDA_SUMAR_GASTOS').map(([, a]) => total(a));
    expect(total(ayuda)).toBeLessThanOrEqual(Math.max(...lasDemas) * 1.15);
  });

  it('dice qué hace la pantalla y que se marcan los gastos y se toca «Sumar»', () => {
    expect(ayuda.puntos[0]).toContain('sin viaje');
    expect(texto).toContain('Marca los que fueron de este viaje');
    expect(texto).toContain('«Sumar»');
    expect(texto).toContain('«Marcar todos»');
  });

  it('dice que uno de otro camión, o que ya está en otro viaje, no se suma', () => {
    const punto = ayuda.puntos.find((p) => p.includes('otro camión'));
    expect(punto).toBeDefined();
    expect(punto).toMatch(/ya está en otro viaje/);
    expect(punto).toMatch(/no se suma/);
  });

  it('dice que sumar cambia la ganancia del viaje y «Por camión» del Resumen, pero NO los totales por fecha', () => {
    const punto = ayuda.puntos.find((p) => p.includes('ganancia'));
    expect(punto).toBeDefined();
    expect(punto).toContain('«Por camión»');
    expect(punto).toContain('Resumen');
    expect(punto).toMatch(/, pero no los totales por fecha\.$/);
  });
});

describe('la ayuda de «Quitar gastos del viaje»', () => {
  const ayuda = pantallas.AYUDA_QUITAR_GASTOS;
  const texto = ayuda.puntos.join(' ');

  it('tiene título propio, distinto del de «Sumar», y entre 3 y 5 puntos cortos', () => {
    expect(ayuda.titulo).toBe('Ayuda para quitar gastos del viaje');
    expect(ayuda.titulo).not.toBe(pantallas.AYUDA_SUMAR_GASTOS.titulo);
    expect(ayuda.puntos.length).toBeGreaterThanOrEqual(3);
    expect(ayuda.puntos.length).toBeLessThanOrEqual(4);
    // cortos: ninguno pasa de 100 caracteres y todos juntos no son más largos que la ayuda más larga de las demás pantallas + 15 %
    for (const punto of ayuda.puntos) expect(punto.length).toBeLessThanOrEqual(100);
    const total = (a: AyudaPantalla) => a.puntos.join('').length;
    const lasDemas = TODAS.filter(([nombre]) => nombre !== 'AYUDA_QUITAR_GASTOS').map(([, a]) => total(a));
    expect(total(ayuda)).toBeLessThanOrEqual(Math.max(...lasDemas) * 1.15);
  });

  it('dice qué hace la pantalla: se marcan los gastos de este viaje y se toca «Quitar»', () => {
    expect(ayuda.puntos[0]).toContain('gastos de este viaje');
    expect(texto).toContain('Marca los que quieres sacar');
    expect(texto).toContain('«Quitar»');
  });

  it('dice que los gastos NO se borran: quedan sin viaje', () => {
    const punto = ayuda.puntos.find((p) => p.includes('no se borran'));
    expect(punto).toBeDefined();
    expect(punto).toContain('quedan sin viaje');
  });

  it('dice que se pueden quitar hasta 100 por vez, el mismo número que el tope real (MAX_GASTOS_POR_VEZ)', () => {
    expect(texto).toContain(`hasta ${MAX_GASTOS_POR_VEZ} por vez`);
  });

  it('dice que quitar cambia la ganancia del viaje y «Por camión» del Resumen, pero NO los totales por fecha', () => {
    const punto = ayuda.puntos.find((p) => p.includes('ganancia'));
    expect(punto).toBeDefined();
    expect(punto).toContain('«Por camión»');
    expect(punto).toContain('Resumen');
    expect(punto).toMatch(/, pero no los totales por fecha.$/);
  });

  it('dice cómo volver a ponerlos: «Sumar gastos que ya cargué»', () => {
    const punto = ayuda.puntos.find((p) => p.includes('volver a ponerlos'));
    expect(punto).toBeDefined();
    expect(punto).toContain('«Sumar gastos que ya cargué»');
    expect(punto).toContain(BOTON_ENTRADA_SUMAR_GASTOS); // el nombre es el del botón de verdad
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

describe('la ayuda de «Sumar varios a un viaje»', () => {
  const ayuda = pantallas.AYUDA_SUMAR_A_VIAJE;
  const texto = ayuda.puntos.join(' ');

  it('tiene título propio, distinto del de las otras pantallas de sumar y quitar, y entre 3 y 4 puntos cortos', () => {
    expect(ayuda.titulo).toBe('Ayuda para sumar varios gastos a un viaje');
    expect(ayuda.titulo).not.toBe(pantallas.AYUDA_SUMAR_GASTOS.titulo);
    expect(ayuda.titulo).not.toBe(pantallas.AYUDA_QUITAR_GASTOS.titulo);
    expect(ayuda.puntos.length).toBeGreaterThanOrEqual(3);
    expect(ayuda.puntos.length).toBeLessThanOrEqual(4);
    for (const punto of ayuda.puntos) expect(punto.length).toBeLessThanOrEqual(130);
  });

  it('dice qué hace: se marcan los gastos sin viaje del mes y se toca «Elegir el viaje» (el nombre del botón de verdad)', () => {
    expect(ayuda.puntos[0]).toContain('gastos sin viaje');
    expect(texto).toContain(`«${BOTON_ELEGIR_EL_VIAJE}»`);
  });

  it('dice que después se elige el viaje, que se puede cambiar de mes para buscarlo y que se pueden sumar hasta 100 por vez (el tope real)', () => {
    expect(texto).toContain('Después eliges el viaje');
    expect(texto).toContain('cambiar de mes');
    expect(texto).toContain(`hasta ${MAX_GASTOS_POR_VEZ} por vez`);
  });

  it('avisa que cambiar el mes o la categoría desmarca lo marcado', () => {
    expect(ayuda.puntos.some((p) => p.includes('mes') && p.includes('categoría') && p.includes('se desmarca'))).toBe(true);
  });

  it('dice que los gastos que ya están en un viaje no aparecen y que uno de otro camión no se suma, y que se avisa CUÁNTOS (no cuáles)', () => {
    const punto = ayuda.puntos.find((p) => p.includes('otro camión'));
    expect(punto).toBe('Los gastos que ya están en un viaje no aparecen aquí. Si uno es de otro camión que el viaje, no se suma: te avisamos cuántos son.');
    expect(texto).not.toContain('te avisamos cuál.');
  });
});

describe('la ayuda de «Nuevo gasto»: se puede marcar más de una categoría', () => {
  const ayuda = pantallas.AYUDA_GASTO_FORM;

  it('tiene un punto corto que dice que se puede marcar más de una categoría y que cada una se guarda como un gasto', () => {
    const punto = ayuda.puntos.find((p) => p.includes('más de una categoría'));
    expect(punto).toBeDefined();
    expect(punto).toContain('cada una se guarda como un gasto');
    expect(punto!.length).toBeLessThanOrEqual(100);
  });

  it('sigue siendo UNA sola ayuda, con su título de siempre y entre 3 y 5 puntos (no cambia la cantidad de pantallas de ayuda)', () => {
    expect(ayuda.titulo).toBe('Ayuda para anotar un gasto');
    expect(ayuda.puntos.length).toBeGreaterThanOrEqual(3);
    expect(ayuda.puntos.length).toBeLessThanOrEqual(5);
    expect(TODAS).toHaveLength(17);
  });

  it('lo de siempre sigue: categoría, monto y fecha, cómo se pagó, combustible, viaje y «Gastos varios»', () => {
    const texto = ayuda.puntos.join(' ');
    expect(texto).toContain('Elige la categoría, anota el monto y la fecha.');
    expect(texto).toContain('cómo pagaste');
    expect(texto).toContain('combustible');
    expect(texto).toContain('viaje');
    expect(texto).toContain('«Gastos varios»');
  });
});
