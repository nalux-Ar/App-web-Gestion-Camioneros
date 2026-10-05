import { describe, expect, it } from 'vitest';

import {
  DETALLE_CLIENTE_AVISO_MENSAJES,
  LISTA_CLIENTES_AVISO_MENSAJES,
  estadoDesdeCliente,
  leerAvisoDetalleCliente,
  leerAvisoListaClientes,
  leerDesdeCliente,
  rutaDelCliente,
  rutaEditarCliente,
} from '@/features/clientes/cliente-navegacion';

const ID = 'a0000000-0000-4000-8000-000000000001';
const RUTA_CLIENTE = /^\/clientes\/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

describe('rutas de Clientes (armadas en el código)', () => {
  it('detalle y edición', () => {
    expect(rutaDelCliente(ID)).toBe(`/clientes/${ID}`);
    expect(rutaEditarCliente(ID)).toBe(`/clientes/${ID}/editar`);
  });
});

describe('leerDesdeCliente (lista blanca: solo un uuid)', () => {
  it('un uuid válido pasa, en minúsculas, con la búsqueda de la lista saneada', () => {
    expect(leerDesdeCliente({ desdeCliente: ID })).toEqual({ id: ID, volver: '' });
    expect(leerDesdeCliente({ desdeCliente: ID.toUpperCase(), volverCliente: '?q=almacen' })).toEqual({ id: ID, volver: '?q=almacen' });
  });

  it('el estado que arma el detalle del cliente se lee de vuelta', () => {
    expect(leerDesdeCliente(estadoDesdeCliente({ id: ID, volver: '?q=bodega' }))).toEqual({ id: ID, volver: '?q=bodega' });
  });

  it('rutas, URLs y texto pegado al uuid NO pasan', () => {
    for (const raro of [
      '/clientes',
      `/clientes/${ID}`,
      '//evil.test',
      'https://evil.test',
      'javascript:alert(1)',
      `${ID}/../viajes`,
      ` ${ID}`,
      `${ID}\n`,
      `${ID}?x=1`,
      ID.slice(1),
      `${ID}0`,
    ]) {
      expect(leerDesdeCliente({ desdeCliente: raro }), JSON.stringify(raro)).toBeNull();
    }
  });

  it('objetos, arreglos, números, null y estados que no son objetos NO pasan', () => {
    for (const raro of [{ id: ID }, [ID], 42, true, null, undefined, { toString: () => ID }, new String(ID)]) {
      expect(leerDesdeCliente({ desdeCliente: raro }), JSON.stringify(raro)).toBeNull();
    }
    for (const estado of [null, undefined, '', ID, 42, [], {}, { desdeViaje: ID }, { cliente: ID }]) {
      expect(leerDesdeCliente(estado), JSON.stringify(estado)).toBeNull();
    }
  });

  it('el volverCliente se sanea: solo un ?q=; lo demás se descarta', () => {
    expect(leerDesdeCliente({ desdeCliente: ID, volverCliente: '//evil.test' })!.volver).toBe('');
    expect(leerDesdeCliente({ desdeCliente: ID, volverCliente: '?q=a&next=https://evil.test' })!.volver).toBe('?q=a');
    expect(leerDesdeCliente({ desdeCliente: ID, volverCliente: { q: 'a' } })!.volver).toBe('');
  });

  it('lo que sale de leerDesdeCliente siempre arma una ruta interna /clientes/<uuid>', () => {
    for (const entrada of [ID, ID.toUpperCase()]) {
      expect(rutaDelCliente(leerDesdeCliente({ desdeCliente: entrada })!.id)).toMatch(RUTA_CLIENTE);
    }
  });
});

describe('estadoDesdeCliente', () => {
  it('con cliente: las dos claves', () => {
    expect(estadoDesdeCliente({ id: ID, volver: '?q=a' })).toEqual({ desdeCliente: ID, volverCliente: '?q=a' });
  });

  it('sin cliente: NINGUNA clave (ni con undefined): el state queda como antes de existir Clientes', () => {
    expect(Object.keys(estadoDesdeCliente(null))).toEqual([]);
    expect(Object.keys(estadoDesdeCliente(undefined))).toEqual([]);
  });
});

describe('avisos (listas blancas)', () => {
  it('la lista acepta solo "cliente-eliminado"', () => {
    expect(leerAvisoListaClientes({ aviso: 'cliente-eliminado' })).toBe('cliente-eliminado');
    expect(LISTA_CLIENTES_AVISO_MENSAJES['cliente-eliminado']).toBe('Cliente eliminado.');
    for (const raro of ['cliente-guardado', 'eliminado', 'guardado', 'CLIENTE-ELIMINADO', 'toString', '__proto__', '', 42, null, {}, ['cliente-eliminado']]) {
      expect(leerAvisoListaClientes({ aviso: raro }), JSON.stringify(raro)).toBeNull();
    }
    for (const estado of [null, undefined, 'cliente-eliminado', 42, [], {}]) {
      expect(leerAvisoListaClientes(estado), JSON.stringify(estado)).toBeNull();
    }
  });

  it('el detalle acepta "cliente-guardado" y los de devolución, con su texto', () => {
    expect(leerAvisoDetalleCliente({ aviso: 'cliente-guardado' })).toBe('cliente-guardado');
    expect(leerAvisoDetalleCliente({ aviso: 'devolucion-guardada' })).toBe('devolucion-guardada');
    expect(leerAvisoDetalleCliente({ aviso: 'devolucion-eliminada' })).toBe('devolucion-eliminada');
    expect(DETALLE_CLIENTE_AVISO_MENSAJES).toEqual({
      'cliente-guardado': 'Cliente guardado.',
      'devolucion-guardada': 'Devolución guardada.',
      'devolucion-eliminada': 'Devolución eliminada.',
    });
  });

  it('el detalle rechaza cualquier otro aviso (los de viaje, gasto, la lista) y valores raros', () => {
    for (const raro of ['cliente-eliminado', 'gasto-guardado', 'viaje-guardado', 'guardado', '<b>x</b>', 'toString', '', 1, null, {}, ['cliente-guardado']]) {
      expect(leerAvisoDetalleCliente({ aviso: raro }), JSON.stringify(raro)).toBeNull();
    }
    for (const estado of [null, undefined, 'cliente-guardado', 42, [], {}]) {
      expect(leerAvisoDetalleCliente(estado), JSON.stringify(estado)).toBeNull();
    }
  });
});
