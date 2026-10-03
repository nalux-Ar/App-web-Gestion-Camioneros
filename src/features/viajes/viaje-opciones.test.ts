import { describe, expect, it } from 'vitest';

import { etiquetaDeViaje, opcionesDeViaje, type ViajeOpcion } from '@/features/viajes/viaje-opciones';

const viaje = (n: number, over: Partial<ViajeOpcion> = {}): ViajeOpcion => ({
  id: `b0000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  fecha: '2026-10-02',
  origen: 'Pilar',
  destino: 'Villa María',
  ...over,
});

describe('etiquetaDeViaje', () => {
  it('del año actual: "2 oct · Pilar → Villa María" (sin año)', () => {
    expect(etiquetaDeViaje(viaje(1), '2026-10-02')).toBe('2 oct · Pilar → Villa María');
    expect(etiquetaDeViaje(viaje(1, { fecha: '2026-01-15' }), '2026-10-02')).toBe('15 ene · Pilar → Villa María');
  });

  it('de otro año: se agrega el año ("2 oct 2025 · ...")', () => {
    expect(etiquetaDeViaje(viaje(1, { fecha: '2025-10-02' }), '2026-10-02')).toBe('2 oct 2025 · Pilar → Villa María');
    expect(etiquetaDeViaje(viaje(1, { fecha: '2019-12-31' }), '2026-01-01')).toBe('31 dic 2019 · Pilar → Villa María');
  });

  it('el límite entre años se decide con la fecha de hoy que se pasa, no con el reloj', () => {
    expect(etiquetaDeViaje(viaje(1, { fecha: '2026-12-31' }), '2026-01-01')).toBe('31 dic · Pilar → Villa María');
    expect(etiquetaDeViaje(viaje(1, { fecha: '2026-12-31' }), '2027-01-01')).toBe('31 dic 2026 · Pilar → Villa María');
  });

  it('el texto de origen y destino va tal cual (sin interpretarse como HTML)', () => {
    expect(etiquetaDeViaje(viaje(1, { origen: '<b>A</b>', destino: 'B & C' }), '2026-10-02')).toBe('2 oct · <b>A</b> → B & C');
  });

  it('una fecha que no es válida no rompe la etiqueta', () => {
    expect(() => etiquetaDeViaje(viaje(1, { fecha: 'rara' }), '2026-10-02')).not.toThrow();
  });
});

describe('opcionesDeViaje', () => {
  const recientes = Array.from({ length: 50 }, (_, i) => viaje(i + 1));

  it('solo los recientes: los mismos 50, en su orden', () => {
    const r = opcionesDeViaje({ recientes, fijos: [] });
    expect(r).toHaveLength(50);
    expect(r.map((v) => v.id)).toEqual(recientes.map((v) => v.id));
  });

  it('50 recientes + el vinculado (viejo, fuera de los 50) + el preseleccionado: 52, con los dos fijos AL PRINCIPIO y sin repetidos', () => {
    const vinculado = viaje(100, { fecha: '2023-03-10' });
    const preseleccionado = viaje(101, { fecha: '2024-05-05' });
    const r = opcionesDeViaje({ recientes, fijos: [vinculado, preseleccionado, null, undefined] });
    expect(r).toHaveLength(52);
    expect(r[0]).toEqual(vinculado);
    expect(r[1]).toEqual(preseleccionado);
    expect(r.slice(2).map((v) => v.id)).toEqual(recientes.map((v) => v.id));
    expect(new Set(r.map((v) => v.id)).size).toBe(52);
  });

  it('un fijo que YA está entre los recientes no se duplica ni se mueve de lugar', () => {
    const r = opcionesDeViaje({ recientes, fijos: [recientes[7]!, recientes[0]!] });
    expect(r).toHaveLength(50);
    expect(r.map((v) => v.id)).toEqual(recientes.map((v) => v.id));
  });

  it('el mismo fijo repetido (p. ej. vinculado = preseleccionado) entra una sola vez', () => {
    const extra = viaje(100);
    const r = opcionesDeViaje({ recientes, fijos: [extra, extra, { ...extra }] });
    expect(r.filter((v) => v.id === extra.id)).toHaveLength(1);
    expect(r).toHaveLength(51);
  });

  it('sin recientes (la lista no cargó) el vinculado y el preseleccionado igual se ofrecen', () => {
    const vinculado = viaje(100);
    const preseleccionado = viaje(101);
    expect(opcionesDeViaje({ recientes: [], fijos: [vinculado, preseleccionado] }).map((v) => v.id)).toEqual([vinculado.id, preseleccionado.id]);
    expect(opcionesDeViaje({ recientes: [], fijos: [] })).toEqual([]);
  });

  it('el viaje elegido que la lista ya no trae (se actualizó y salió de los 50) sigue como opción', () => {
    const elegido = recientes[49]!;
    const actualizados = [viaje(200), ...recientes.slice(0, 49)]; // un viaje nuevo empujó al 50º afuera
    const r = opcionesDeViaje({ recientes: actualizados, fijos: [null, null, elegido] });
    expect(r.some((v) => v.id === elegido.id)).toBe(true);
    expect(r[0]!.id).toBe(elegido.id);
    expect(r).toHaveLength(51);
  });

  it('no modifica los arreglos que recibe', () => {
    const copia = [...recientes];
    opcionesDeViaje({ recientes, fijos: [viaje(100)] });
    expect(recientes).toEqual(copia);
  });
});
