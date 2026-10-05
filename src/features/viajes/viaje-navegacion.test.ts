import { describe, expect, it } from 'vitest';

import {
  DETALLE_AVISO_MENSAJES,
  LISTA_AVISO_MENSAJES,
  ORIGEN_CLIENTE,
  ORIGEN_LISTA_DEVOLUCIONES,
  destinoTrasDevolucion,
  estadoDesdeViaje,
  estadoEditarDesdeCliente,
  estadoEditarDesdeLista,
  leerAvisoDetalle,
  leerAvisoLista,
  leerDesdeViaje,
  leerOrigenDevolucion,
  rutaDelViaje,
  rutaEditarDevolucion,
  rutaListaDevoluciones,
  rutaNuevaDevolucion,
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

describe('rutas de las devoluciones (se arman en el código, con uuid ya validados)', () => {
  const DEV = 'f0000000-0000-4000-8000-000000000001';

  it('nueva: /viajes/<viaje>/devoluciones/nueva', () => {
    expect(rutaNuevaDevolucion(ID)).toBe(`/viajes/${ID}/devoluciones/nueva`);
  });

  it('editar: /viajes/<viaje>/devoluciones/<id>/editar', () => {
    expect(rutaEditarDevolucion(ID, DEV)).toBe(`/viajes/${ID}/devoluciones/${DEV}/editar`);
  });

  it('lo que sale de leerDesdeViaje arma siempre una ruta interna con uuid', () => {
    const leido = leerDesdeViaje({ desdeViaje: ID.toUpperCase() })!;
    expect(rutaNuevaDevolucion(leido.id)).toMatch(/^\/viajes\/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\/devoluciones\/nueva$/);
  });
});

describe('leerAvisoDetalle (lista blanca de avisos)', () => {
  it('acepta solo los cinco valores y cada uno tiene su mensaje', () => {
    expect(leerAvisoDetalle({ aviso: 'gasto-guardado' })).toBe('gasto-guardado');
    expect(leerAvisoDetalle({ aviso: 'gasto-eliminado' })).toBe('gasto-eliminado');
    expect(leerAvisoDetalle({ aviso: 'viaje-guardado' })).toBe('viaje-guardado');
    expect(leerAvisoDetalle({ aviso: 'devolucion-guardada' })).toBe('devolucion-guardada');
    expect(leerAvisoDetalle({ aviso: 'devolucion-eliminada' })).toBe('devolucion-eliminada');
    expect(DETALLE_AVISO_MENSAJES['gasto-guardado']).toBe('Gasto guardado.');
    expect(DETALLE_AVISO_MENSAJES['gasto-eliminado']).toBe('Gasto eliminado.');
    expect(DETALLE_AVISO_MENSAJES['viaje-guardado']).toBe('Viaje guardado.');
    expect(DETALLE_AVISO_MENSAJES['devolucion-guardada']).toBe('Devolución guardada.');
    expect(DETALLE_AVISO_MENSAJES['devolucion-eliminada']).toBe('Devolución eliminada.');
  });

  it('los avisos de las listas ("guardado" / "eliminado") y cualquier otra cosa NO pasan', () => {
    for (const raro of ['guardado', 'eliminado', 'devolucion', 'devolucion-guardado', 'DEVOLUCION-GUARDADA', '<b>hack</b>', '', 'GASTO-GUARDADO', 'toString', '__proto__', 'constructor', 42, null, undefined, {}, ['gasto-guardado'], ['devolucion-guardada']]) {
      expect(leerAvisoDetalle({ aviso: raro }), JSON.stringify(raro)).toBeNull();
    }
    for (const estado of [null, undefined, 'gasto-guardado', 'devolucion-guardada', 42, true, [], {}]) {
      expect(leerAvisoDetalle(estado), JSON.stringify(estado)).toBeNull();
    }
  });
});

describe('leerAvisoLista (lista blanca de avisos de la lista de /viajes)', () => {
  it('acepta los avisos de viaje y los de devolución, cada uno con su mensaje', () => {
    expect(leerAvisoLista({ aviso: 'guardado' })).toBe('guardado');
    expect(leerAvisoLista({ aviso: 'eliminado' })).toBe('eliminado');
    expect(leerAvisoLista({ aviso: 'devolucion-guardada' })).toBe('devolucion-guardada');
    expect(leerAvisoLista({ aviso: 'devolucion-eliminada' })).toBe('devolucion-eliminada');
    expect(LISTA_AVISO_MENSAJES.guardado).toBe('Viaje guardado.');
    expect(LISTA_AVISO_MENSAJES.eliminado).toBe('Viaje eliminado.');
    expect(LISTA_AVISO_MENSAJES['devolucion-guardada']).toBe('Devolución guardada.');
    expect(LISTA_AVISO_MENSAJES['devolucion-eliminada']).toBe('Devolución eliminada.');
  });

  it('los textos de devolución son los mismos que muestra el detalle del viaje', () => {
    expect(LISTA_AVISO_MENSAJES['devolucion-guardada']).toBe(DETALLE_AVISO_MENSAJES['devolucion-guardada']);
    expect(LISTA_AVISO_MENSAJES['devolucion-eliminada']).toBe(DETALLE_AVISO_MENSAJES['devolucion-eliminada']);
  });

  it('los avisos del detalle que no son de la lista (gasto, viaje-guardado) y cualquier otra cosa NO pasan', () => {
    for (const raro of ['gasto-guardado', 'gasto-eliminado', 'viaje-guardado', 'devolucion', 'GUARDADO', 'Guardado', '<b>hack</b>', '', 'toString', '__proto__', 'constructor', 42, null, undefined, {}, ['guardado'], ['devolucion-guardada']]) {
      expect(leerAvisoLista({ aviso: raro }), JSON.stringify(raro)).toBeNull();
    }
    for (const estado of [null, undefined, 'guardado', 'devolucion-guardada', 42, true, [], {}]) {
      expect(leerAvisoLista(estado), JSON.stringify(estado)).toBeNull();
    }
  });
});

describe('origen de la edición de una devolución (lista blanca de dos literales: la lista de Devoluciones y un cliente)', () => {
  it('el literal es "lista-devoluciones"', () => {
    expect(ORIGEN_LISTA_DEVOLUCIONES).toBe('lista-devoluciones');
  });

  it('el estado que arma la fila se lee de vuelta', () => {
    expect(estadoEditarDesdeLista('?vista=devoluciones&mes=2025-08')).toEqual({ volver: '?vista=devoluciones&mes=2025-08', origen: 'lista-devoluciones' });
    expect(leerOrigenDevolucion(estadoEditarDesdeLista('?vista=devoluciones'))).toBe('lista-devoluciones');
  });

  it('cualquier otro valor se ignora: rutas, URLs, mayúsculas, texto pegado, objetos, números y claves de objeto', () => {
    for (const raro of [
      '/viajes?vista=devoluciones',
      '//evil.com',
      'https://evil.com',
      'javascript:alert(1)',
      'Lista-Devoluciones',
      'LISTA-DEVOLUCIONES',
      ' lista-devoluciones',
      'lista-devoluciones ',
      'lista-devoluciones\n',
      'lista-devoluciones/../gastos',
      'lista',
      'devoluciones',
      'detalle',
      'toString',
      '__proto__',
      'constructor',
      '',
      1,
      true,
      null,
      undefined,
      {},
      [],
      ['lista-devoluciones'],
      { toString: () => 'lista-devoluciones' },
      new String('lista-devoluciones'),
    ]) {
      expect(leerOrigenDevolucion({ origen: raro }), JSON.stringify(raro)).toBeNull();
    }
  });

  it('un state que no es un objeto (o no trae la clave) da null; `vista` en el volver NO es una señal de origen', () => {
    for (const raro of [null, undefined, '', 'lista-devoluciones', 42, true, [], {}, { volver: '?vista=devoluciones' }, { Origen: 'lista-devoluciones' }, { desdeViaje: ID }]) {
      expect(leerOrigenDevolucion(raro), JSON.stringify(raro)).toBeNull();
    }
  });
});

describe('rutaListaDevoluciones (armada en el código: la pestaña no sale del texto)', () => {
  it('es /viajes con la pestaña Devoluciones y el mes del volver', () => {
    expect(rutaListaDevoluciones('?vista=devoluciones&mes=2025-08')).toBe('/viajes?vista=devoluciones&mes=2025-08');
    expect(rutaListaDevoluciones('?mes=2025-08')).toBe('/viajes?vista=devoluciones&mes=2025-08');
    expect(rutaListaDevoluciones('?vista=viajes&mes=2025-08')).toBe('/viajes?vista=devoluciones&mes=2025-08');
    expect(rutaListaDevoluciones('')).toBe('/viajes?vista=devoluciones');
  });

  it('un volver raro no cambia el path ni cuela nada: siempre /viajes y la pestaña Devoluciones', () => {
    for (const raro of ['//evil.com', 'https://evil.com', '?mes=<script>', '?next=//evil.com', 42, null, undefined, {}]) {
      expect(rutaListaDevoluciones(raro), JSON.stringify(raro)).toBe('/viajes?vista=devoluciones');
    }
  });
});

describe('destinoTrasDevolucion (a dónde se vuelve tras guardar o borrar)', () => {
  const VOLVER = '?vista=devoluciones&mes=2025-08';

  it('abierta desde la lista de Devoluciones: a esa lista (misma pestaña y mes), con el aviso y sin nada más en el state', () => {
    expect(destinoTrasDevolucion({ viajeId: ID, volver: VOLVER, origen: 'lista-devoluciones', aviso: 'devolucion-guardada' })).toEqual({
      to: '/viajes?vista=devoluciones&mes=2025-08',
      state: { aviso: 'devolucion-guardada' },
    });
    expect(destinoTrasDevolucion({ viajeId: ID, volver: VOLVER, origen: 'lista-devoluciones', aviso: 'devolucion-eliminada' })).toEqual({
      to: '/viajes?vista=devoluciones&mes=2025-08',
      state: { aviso: 'devolucion-eliminada' },
    });
  });

  it('sin origen: al detalle del viaje, como siempre, con el aviso y el volver', () => {
    expect(destinoTrasDevolucion({ viajeId: ID, volver: '?mes=2025-08', origen: null, aviso: 'devolucion-guardada' })).toEqual({
      to: `/viajes/${ID}`,
      state: { aviso: 'devolucion-guardada', volver: '?mes=2025-08' },
    });
  });

  it('un volver con la pestaña Devoluciones NO alcanza: sin la marca de origen se vuelve al detalle (la edición se abrió desde el detalle)', () => {
    const destino = destinoTrasDevolucion({ viajeId: ID, volver: VOLVER, origen: null, aviso: 'devolucion-eliminada' });
    expect(destino.to).toBe(`/viajes/${ID}`);
    expect(destino.state).toEqual({ aviso: 'devolucion-eliminada', volver: VOLVER });
  });

  it('el destino siempre es una ruta interna armada acá', () => {
    for (const origen of [null, 'lista-devoluciones'] as const) {
      const { to } = destinoTrasDevolucion({ viajeId: ID, volver: '//evil.com', origen, aviso: 'devolucion-guardada' });
      expect(to).toMatch(/^\/viajes(\?vista=devoluciones)?(\/[0-9a-f-]{36})?$/);
    }
  });
});

// ---------------------------------------------------------------------------
// "Volver al cliente": el detalle de un viaje abierto desde el detalle de un cliente
// ---------------------------------------------------------------------------
const CLIENTE = 'a0000000-0000-4000-8000-000000000001';

describe('el cliente viaja con el viaje (DesdeViaje.cliente)', () => {
  it('estadoDesdeViaje con cliente agrega desdeCliente y volverCliente; sin cliente, queda exactamente como antes', () => {
    expect(estadoDesdeViaje(ID, '?mes=2025-08', { id: CLIENTE, volver: '?q=almacen' })).toEqual({
      desdeViaje: ID,
      volverViaje: '?mes=2025-08',
      desdeCliente: CLIENTE,
      volverCliente: '?q=almacen',
    });
    expect(Object.keys(estadoDesdeViaje(ID, ''))).toEqual(['desdeViaje', 'volverViaje']);
    expect(Object.keys(estadoDesdeViaje(ID, '', null))).toEqual(['desdeViaje', 'volverViaje']);
  });

  it('leerDesdeViaje lee de vuelta el cliente (validado y en minúsculas, con la búsqueda saneada)', () => {
    expect(leerDesdeViaje(estadoDesdeViaje(ID, '', { id: CLIENTE, volver: '?q=a' }))).toEqual({
      id: ID,
      volver: '',
      cliente: { id: CLIENTE, volver: '?q=a' },
    });
    expect(leerDesdeViaje({ desdeViaje: ID, desdeCliente: CLIENTE.toUpperCase(), volverCliente: '?q=a&x=//evil.com' })!.cliente).toEqual({
      id: CLIENTE,
      volver: '?q=a',
    });
  });

  it('un cliente que no es un uuid se ignora: el viaje sigue valiendo, sin cliente (y sin la clave)', () => {
    for (const raro of ['/clientes', '//evil.com', `${CLIENTE}/x`, 42, null, { id: CLIENTE }]) {
      const leido = leerDesdeViaje({ desdeViaje: ID, desdeCliente: raro });
      expect(leido, JSON.stringify(raro)).toEqual({ id: ID, volver: '' });
      expect(Object.keys(leido!)).not.toContain('cliente');
    }
  });

  it('un cliente sin viaje no alcanza: leerDesdeViaje da null', () => {
    expect(leerDesdeViaje({ desdeCliente: CLIENTE })).toBeNull();
  });
});

describe('origen "cliente" de la edición de una devolución (lista blanca + cliente válido)', () => {
  it('el literal es "cliente" y el estado que arma el detalle del cliente se lee de vuelta', () => {
    expect(ORIGEN_CLIENTE).toBe('cliente');
    const estado = estadoEditarDesdeCliente({ id: CLIENTE, volver: '?q=bodega' });
    expect(estado).toEqual({ origen: 'cliente', desdeCliente: CLIENTE, volverCliente: '?q=bodega' });
    expect(leerOrigenDevolucion(estado)).toBe('cliente');
  });

  it('sin un cliente válido en el mismo state, el origen "cliente" NO cuenta', () => {
    for (const estado of [
      { origen: 'cliente' },
      { origen: 'cliente', desdeCliente: '/clientes/x' },
      { origen: 'cliente', desdeCliente: '//evil.com' },
      { origen: 'cliente', desdeCliente: 42 },
      { origen: 'cliente', cliente: CLIENTE },
    ]) {
      expect(leerOrigenDevolucion(estado), JSON.stringify(estado)).toBeNull();
    }
  });

  it('variantes del literal no pasan, aunque traigan un cliente válido', () => {
    for (const raro of ['Cliente', 'CLIENTE', ' cliente', 'cliente ', 'clientes', 'cliente/../x', ['cliente'], { toString: () => 'cliente' }, new String('cliente')]) {
      expect(leerOrigenDevolucion({ origen: raro, desdeCliente: CLIENTE }), JSON.stringify(raro)).toBeNull();
    }
  });

  it('un cliente en el state NO es una señal de origen por sí solo (sin `origen`)', () => {
    expect(leerOrigenDevolucion({ desdeCliente: CLIENTE, volverCliente: '?q=a' })).toBeNull();
  });
});

describe('destinoTrasDevolucion con cliente', () => {
  const CL = { id: CLIENTE, volver: '?q=almacen' };

  it('origen "cliente": al detalle de ESE cliente, con el aviso y la búsqueda de su lista', () => {
    expect(destinoTrasDevolucion({ viajeId: ID, volver: '?mes=2025-08', origen: 'cliente', aviso: 'devolucion-guardada', cliente: CL })).toEqual({
      to: `/clientes/${CLIENTE}`,
      state: { aviso: 'devolucion-guardada', volver: '?q=almacen' },
    });
    expect(destinoTrasDevolucion({ viajeId: ID, volver: '', origen: 'cliente', aviso: 'devolucion-eliminada', cliente: CL }).to).toBe(`/clientes/${CLIENTE}`);
  });

  it('origen "cliente" sin cliente (no debería pasar: leerOrigenDevolucion lo exige): al viaje, como siempre', () => {
    expect(destinoTrasDevolucion({ viajeId: ID, volver: '', origen: 'cliente', aviso: 'devolucion-guardada', cliente: null })).toEqual({
      to: `/viajes/${ID}`,
      state: { aviso: 'devolucion-guardada', volver: '' },
    });
  });

  it('sin origen pero con cliente (la devolución se abrió desde un viaje abierto desde un cliente): al viaje, llevándole el cliente', () => {
    expect(destinoTrasDevolucion({ viajeId: ID, volver: '?mes=2025-08', origen: null, aviso: 'devolucion-guardada', cliente: CL })).toEqual({
      to: `/viajes/${ID}`,
      state: { aviso: 'devolucion-guardada', volver: '?mes=2025-08', desdeCliente: CLIENTE, volverCliente: '?q=almacen' },
    });
  });

  it('la lista de Devoluciones gana: con su origen, el cliente no se usa', () => {
    expect(destinoTrasDevolucion({ viajeId: ID, volver: '?vista=devoluciones', origen: 'lista-devoluciones', aviso: 'devolucion-guardada', cliente: CL })).toEqual({
      to: '/viajes?vista=devoluciones',
      state: { aviso: 'devolucion-guardada' },
    });
  });

  it('el destino siempre es una ruta interna armada acá', () => {
    for (const origen of [null, 'lista-devoluciones', 'cliente'] as const) {
      const { to } = destinoTrasDevolucion({ viajeId: ID, volver: '//evil.com', origen, aviso: 'devolucion-guardada', cliente: CL });
      expect(to).toMatch(/^\/(viajes(\?vista=devoluciones)?(\/[0-9a-f-]{36})?|clientes\/[0-9a-f-]{36})$/);
    }
  });
});
