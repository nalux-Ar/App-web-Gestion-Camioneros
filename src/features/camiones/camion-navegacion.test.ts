import { describe, expect, it } from 'vitest';

import {
  RUTA_CAMIONES,
  RUTA_NUEVO_CAMION,
  estadoAvisoCamiones,
  leerAvisoCamiones,
  rutaEditarCamion,
  textoAsignados,
  textoAvisoCamiones,
  textoPrimerCamion,
} from '@/features/camiones/camion-navegacion';

describe('rutas', () => {
  it('se arman en el código', () => {
    expect(RUTA_CAMIONES).toBe('/camiones');
    expect(RUTA_NUEVO_CAMION).toBe('/camiones/nuevo');
    expect(rutaEditarCamion('c0000000-0000-4000-8000-000000000001')).toBe('/camiones/c0000000-0000-4000-8000-000000000001/editar');
  });
});

describe('aviso de la lista (lista blanca)', () => {
  it('ida y vuelta: el estado que arma el formulario se lee igual', () => {
    expect(leerAvisoCamiones(estadoAvisoCamiones('camion-guardado', { viajes: 6, gastos: 2 }))).toEqual({
      tipo: 'camion-guardado',
      viajesAsignados: 6,
      gastosAsignados: 2,
    });
    expect(leerAvisoCamiones(estadoAvisoCamiones('camion-archivado'))).toEqual({ tipo: 'camion-archivado', viajesAsignados: 0, gastosAsignados: 0 });
  });

  it('sin asignados, el state no lleva las cantidades', () => {
    expect(estadoAvisoCamiones('camion-guardado')).toEqual({ aviso: 'camion-guardado' });
    expect(estadoAvisoCamiones('camion-reactivado', { viajes: 0, gastos: 0 })).toEqual({ aviso: 'camion-reactivado' });
  });

  it('otro aviso (o un estado que no es objeto) no muestra nada', () => {
    for (const aviso of ['guardado', 'camion-eliminado', 'CAMION-GUARDADO', '<b>x</b>', 'toString', '__proto__', '', 1, null, {}, ['camion-guardado']]) {
      expect(leerAvisoCamiones({ aviso }), JSON.stringify(aviso)).toBeNull();
    }
    for (const estado of [null, undefined, 'camion-guardado', 42, []]) expect(leerAvisoCamiones(estado)).toBeNull();
  });

  it('cantidades raras cuentan como 0 (no se muestra un número inventado)', () => {
    for (const raro of [-1, 1.5, '3', null, Number.NaN, Number.POSITIVE_INFINITY, 10_000_001, {}]) {
      expect(leerAvisoCamiones({ aviso: 'camion-guardado', viajesAsignados: raro, gastosAsignados: raro }), JSON.stringify(raro)).toEqual({
        tipo: 'camion-guardado',
        viajesAsignados: 0,
        gastosAsignados: 0,
      });
    }
  });

  it('textos', () => {
    expect(textoAvisoCamiones({ tipo: 'camion-guardado', viajesAsignados: 0, gastosAsignados: 0 })).toBe('Camión guardado.');
    expect(textoAvisoCamiones({ tipo: 'camion-guardado', viajesAsignados: 6, gastosAsignados: 1 })).toBe(
      'Camión guardado. Se le asignaron 6 viajes y 1 carga de combustible que estaban sin camión.',
    );
    expect(textoAvisoCamiones({ tipo: 'camion-archivado', viajesAsignados: 3, gastosAsignados: 0 })).toBe('Camión archivado.');
    expect(textoAvisoCamiones({ tipo: 'camion-reactivado', viajesAsignados: 0, gastosAsignados: 0 })).toBe('Camión reactivado.');
  });
});

describe('textoAsignados y textoPrimerCamion', () => {
  it.each([
    [1, 0, '1 viaje'],
    [3, 0, '3 viajes'],
    [0, 1, '1 carga de combustible'],
    [0, 2, '2 cargas de combustible'],
    [2, 2, '2 viajes y 2 cargas de combustible'],
    [0, 0, ''],
  ])('%s viajes y %s cargas', (viajes, gastos, texto) => {
    expect(textoAsignados(viajes, gastos)).toBe(texto);
  });

  it('el aviso antes del primer camión según el conteo', () => {
    expect(textoPrimerCamion({ tipo: 'cargando' })).toBe('Es tu primer camión. Revisando tus viajes y cargas de combustible sin camión…');
    expect(textoPrimerCamion({ tipo: 'listo', viajes: 6, gastos: 2 })).toBe(
      'Es tu primer camión: 6 viajes y 2 cargas de combustible que cargaste sin camión van a quedar asignados a él.',
    );
    expect(textoPrimerCamion({ tipo: 'listo', viajes: 0, gastos: 0 })).toBe('Es tu primer camión.');
    expect(textoPrimerCamion({ tipo: 'error' })).toContain('van a quedar asignados a él');
  });
});
