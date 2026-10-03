import { describe, expect, it } from 'vitest';

import {
  DETALLE_AVISO_MENSAJES,
  estadoDesdeViaje,
  leerAvisoDetalle,
  leerDesdeViaje,
  rutaDelViaje,
} from '@/features/viajes/viaje-navegacion';

const ID = 'b0000000-0000-4000-8000-000000000001';

describe('leerDesdeViaje (lista blanca: solo un uuid)', () => {
  it('un uuid válido pasa, en minúsculas', () => {
    expect(leerDesdeViaje({ desdeViaje: ID })).toEqual({ id: ID, volver: '' });
    expect(leerDesdeViaje({ desdeViaje: ID.toUpperCase() })).toEqual({ id: ID, volver: '' });
  });

  it('el estado que arma el detalle se lee de vuelta', () => {
    expect(leerDesdeViaje(estadoDesdeViaje(ID, '?mes=2025-08'))).toEqual({ id: ID, volver: '?mes=2025-08' });
    expect(leerDesdeViaje(estadoDesdeViaje(ID, ''))).toEqual({ id: ID, volver: '' });
  });

  it('rutas y URLs NO pasan: "/gastos", "//evil.com", "https://evil.com", "/viajes/<id>", "javascript:..."', () => {
    for (const ruta of [
      '/gastos',
      '/viajes',
      `/viajes/${ID}`,
      '//evil.com',
      '//evil.com/viajes',
      'https://evil.com',
      'http://localhost:3000/gastos',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      '../../etc/passwd',
      '\\\\evil.com',
    ]) {
      expect(leerDesdeViaje({ desdeViaje: ruta }), ruta).toBeNull();
    }
  });

  it('un uuid con algo pegado (ruta, espacios, salto de línea) NO pasa', () => {
    for (const raro of [`${ID}/../gastos`, ` ${ID}`, `${ID} `, `${ID}\n`, `${ID}?x=1`, `${ID}#hash`, `/${ID}`, ID.slice(1), `${ID}0`]) {
      expect(leerDesdeViaje({ desdeViaje: raro }), JSON.stringify(raro)).toBeNull();
    }
  });

  it('objetos, arreglos, números, booleanos, null y undefined NO pasan', () => {
    for (const raro of [{ id: ID }, [ID], 42, true, false, null, undefined, { toString: () => ID }, new String(ID)]) {
      expect(leerDesdeViaje({ desdeViaje: raro }), JSON.stringify(raro)).toBeNull();
    }
  });

  it('un state que no es un objeto (o no trae la clave) da null', () => {
    for (const raro of [null, undefined, '', ID, 42, true, [], {}, { volver: '?mes=2025-08' }, { desdeviaje: ID }]) {
      expect(leerDesdeViaje(raro), JSON.stringify(raro)).toBeNull();
    }
  });

  it('el volverViaje se sanea con la regla de la lista: solo lo que ella podría haber escrito', () => {
    expect(leerDesdeViaje({ desdeViaje: ID, volverViaje: '?mes=2025-08' })!.volver).toBe('?mes=2025-08');
    expect(leerDesdeViaje({ desdeViaje: ID, volverViaje: '?mes=2025-08&x=<script>' })!.volver).toBe('?mes=2025-08');
    expect(leerDesdeViaje({ desdeViaje: ID, volverViaje: '//evil.com' })!.volver).toBe('');
    expect(leerDesdeViaje({ desdeViaje: ID, volverViaje: 'https://evil.com' })!.volver).toBe('');
    expect(leerDesdeViaje({ desdeViaje: ID, volverViaje: { mes: '2025-08' } })!.volver).toBe('');
    expect(leerDesdeViaje({ desdeViaje: ID, volverViaje: '?mes=2999-01' })!.volver).toBe(''); // un mes futuro cae en el actual
  });
});

describe('rutaDelViaje', () => {
  it('arma la ruta en el código, con el id', () => {
    expect(rutaDelViaje(ID)).toBe(`/viajes/${ID}`);
  });

  it('lo que sale de leerDesdeViaje siempre arma una ruta interna /viajes/<uuid>', () => {
    for (const entrada of [ID, ID.toUpperCase()]) {
      const leido = leerDesdeViaje({ desdeViaje: entrada });
      expect(rutaDelViaje(leido!.id)).toMatch(/^\/viajes\/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
    }
  });
});

describe('leerAvisoDetalle (lista blanca de avisos)', () => {
  it('acepta solo los tres valores y cada uno tiene su mensaje', () => {
    expect(leerAvisoDetalle({ aviso: 'gasto-guardado' })).toBe('gasto-guardado');
    expect(leerAvisoDetalle({ aviso: 'gasto-eliminado' })).toBe('gasto-eliminado');
    expect(leerAvisoDetalle({ aviso: 'viaje-guardado' })).toBe('viaje-guardado');
    expect(DETALLE_AVISO_MENSAJES['gasto-guardado']).toBe('Gasto guardado.');
    expect(DETALLE_AVISO_MENSAJES['gasto-eliminado']).toBe('Gasto eliminado.');
    expect(DETALLE_AVISO_MENSAJES['viaje-guardado']).toBe('Viaje guardado.');
  });

  it('los avisos de las listas ("guardado" / "eliminado") y cualquier otra cosa NO pasan', () => {
    for (const raro of ['guardado', 'eliminado', '<b>hack</b>', '', 'GASTO-GUARDADO', 'toString', '__proto__', 'constructor', 42, null, undefined, {}, ['gasto-guardado']]) {
      expect(leerAvisoDetalle({ aviso: raro }), JSON.stringify(raro)).toBeNull();
    }
    for (const estado of [null, undefined, 'gasto-guardado', 42, true, [], {}]) {
      expect(leerAvisoDetalle(estado), JSON.stringify(estado)).toBeNull();
    }
  });
});
