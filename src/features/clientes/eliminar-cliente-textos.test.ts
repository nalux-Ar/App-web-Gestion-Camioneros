import { describe, expect, it } from 'vitest';

import {
  PREGUNTA_GENERICA_CLIENTE,
  PREGUNTA_REVISANDO_CLIENTE,
  PREGUNTA_SIN_NADA_CLIENTE,
  textoNoSePuedeEliminar,
  textosBorradoCliente,
} from '@/features/clientes/eliminar-cliente-textos';

describe('textosBorradoCliente', () => {
  it('mientras cuenta: no se puede confirmar todavía', () => {
    expect(textosBorradoCliente({ tipo: 'cargando' })).toEqual({ prompt: PREGUNTA_REVISANDO_CLIENTE, puedeConfirmar: false, bloqueado: false });
    expect(PREGUNTA_REVISANDO_CLIENTE).toBe('Revisando si el cliente tiene entregas o devoluciones…');
  });

  it('sin entregas ni devoluciones: la pregunta de siempre y se puede borrar', () => {
    expect(textosBorradoCliente({ tipo: 'listo', entregas: 0, devoluciones: 0 })).toEqual({
      prompt: PREGUNTA_SIN_NADA_CLIENTE,
      puedeConfirmar: true,
      bloqueado: false,
    });
  });

  it('con entregas o devoluciones: bloqueado (no se ofrece borrar) y se explica con los números', () => {
    const r = textosBorradoCliente({ tipo: 'listo', entregas: 3, devoluciones: 2 });
    expect(r).toEqual({
      prompt: 'No se puede eliminar: tiene 3 entregas y 2 devoluciones. Puedes renombrarlo.',
      puedeConfirmar: false,
      bloqueado: true,
    });
    expect(textosBorradoCliente({ tipo: 'listo', entregas: 1, devoluciones: 0 }).bloqueado).toBe(true);
    expect(textosBorradoCliente({ tipo: 'listo', entregas: 0, devoluciones: 1 }).bloqueado).toBe(true);
  });

  it('si el conteo falla: texto genérico y se puede intentar (la base protege con RESTRICT)', () => {
    expect(textosBorradoCliente({ tipo: 'error' })).toEqual({ prompt: PREGUNTA_GENERICA_CLIENTE, puedeConfirmar: true, bloqueado: false });
    expect(PREGUNTA_GENERICA_CLIENTE).toContain('no se va a poder eliminar');
  });

  it('cantidades raras (negativas, NaN, infinito) cuentan como 0: no se inventa un texto', () => {
    expect(textosBorradoCliente({ tipo: 'listo', entregas: -1, devoluciones: Number.NaN }).bloqueado).toBe(false);
    expect(textosBorradoCliente({ tipo: 'listo', entregas: Number.POSITIVE_INFINITY, devoluciones: 0 }).bloqueado).toBe(false);
  });
});

describe('textoNoSePuedeEliminar (singular y plural, solo lo que tenga)', () => {
  it.each([
    [1, 0, 'No se puede eliminar: tiene 1 entrega. Puedes renombrarlo.'],
    [4, 0, 'No se puede eliminar: tiene 4 entregas. Puedes renombrarlo.'],
    [0, 1, 'No se puede eliminar: tiene 1 devolución. Puedes renombrarlo.'],
    [0, 2, 'No se puede eliminar: tiene 2 devoluciones. Puedes renombrarlo.'],
    [1, 1, 'No se puede eliminar: tiene 1 entrega y 1 devolución. Puedes renombrarlo.'],
    [2.7, 3, 'No se puede eliminar: tiene 2 entregas y 3 devoluciones. Puedes renombrarlo.'],
  ])('%s entregas y %s devoluciones', (entregas, devoluciones, texto) => {
    expect(textoNoSePuedeEliminar({ entregas, devoluciones })).toBe(texto);
  });
});
