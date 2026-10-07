import { describe, expect, it } from 'vitest';

import { textosCambioDeCamion } from '@/features/viajes/viaje-camion';

describe('textosCambioDeCamion (el botón dice la consecuencia antes de guardar)', () => {
  it('sin cambio de camión: "Guardar viaje", sin aviso', () => {
    expect(textosCambioDeCamion({ tipo: 'sin-cambio' }, 'AB 123 CD')).toEqual({ label: 'Guardar viaje', aviso: null, puedeGuardar: true });
  });

  it('contando: el botón espera (no se guarda sin haber dicho cuántos se mueven)', () => {
    expect(textosCambioDeCamion({ tipo: 'cargando' }, 'AB 123 CD')).toEqual({
      label: 'Revisando los gastos del viaje…',
      aviso: null,
      puedeGuardar: false,
    });
  });

  it('0 gastos con otro camión: nada que decir', () => {
    expect(textosCambioDeCamion({ tipo: 'listo', cantidad: 0 }, 'AB 123 CD')).toEqual({ label: 'Guardar viaje', aviso: null, puedeGuardar: true });
  });

  it('N > 0: "Guardar y pasar N gastos al camión X" + aviso de que no queda registro del anterior', () => {
    expect(textosCambioDeCamion({ tipo: 'listo', cantidad: 3 }, 'AB 123 CD')).toEqual({
      label: 'Guardar y pasar 3 gastos al camión AB 123 CD',
      aviso: 'Este viaje tiene 3 gastos con otro camión: al guardar pasan al camión AB 123 CD. No queda registro del camión anterior.',
      puedeGuardar: true,
    });
  });

  it('singular', () => {
    const textos = textosCambioDeCamion({ tipo: 'listo', cantidad: 1 }, 'ABC 123');
    expect(textos.label).toBe('Guardar y pasar 1 gasto al camión ABC 123');
    expect(textos.aviso).toBe('Este viaje tiene 1 gasto con otro camión: al guardar pasa al camión ABC 123. No queda registro del camión anterior.');
  });

  it('no se pudo contar: se puede guardar, con un aviso sin números', () => {
    const textos = textosCambioDeCamion({ tipo: 'error' }, 'AB 123 CD');
    expect(textos.puedeGuardar).toBe(true);
    expect(textos.label).toBe('Guardar viaje');
    expect(textos.aviso).toBe('No pudimos revisar los gastos del viaje: si tiene gastos con otro camión, al guardar pasan al camión AB 123 CD.');
  });

  it('una cantidad rara (negativa, no entera, NaN) no inventa un número', () => {
    for (const cantidad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(textosCambioDeCamion({ tipo: 'listo', cantidad }, 'AB 123 CD').label, String(cantidad)).toBe('Guardar viaje');
    }
  });
});
