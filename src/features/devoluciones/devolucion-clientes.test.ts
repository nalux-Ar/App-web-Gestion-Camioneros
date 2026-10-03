import { describe, expect, it } from 'vitest';

import { agruparClientes } from '@/features/devoluciones/devolucion-clientes';

// Ya vienen en el orden de la lista de clientes (por nombre): Almacén, Bodega, Cooperativa, Distribuidora, Frigorífico.
const ALMACEN = { id: 'a0000000-0000-4000-8000-000000000001', nombre: 'Almacén Central' };
const BODEGA = { id: 'a0000000-0000-4000-8000-000000000002', nombre: 'Bodega Norte' };
const COOP = { id: 'a0000000-0000-4000-8000-000000000003', nombre: 'Cooperativa Sur' };
const DISTRI = { id: 'a0000000-0000-4000-8000-000000000004', nombre: 'Distribuidora Este' };
const FRIGO = { id: 'a0000000-0000-4000-8000-000000000005', nombre: 'Frigorífico Oeste' };
const TODOS = [ALMACEN, BODEGA, COOP, DISTRI, FRIGO];

const nombres = (grupo: { clientes: Array<{ nombre: string }> }) => grupo.clientes.map((c) => c.nombre);

describe('agruparClientes', () => {
  it('con entregas: primero "Clientes de este viaje" y debajo "Otros clientes" con todos los demás', () => {
    const grupos = agruparClientes(TODOS, [COOP.id, ALMACEN.id]);
    expect(grupos.map((g) => g.label)).toEqual(['Clientes de este viaje', 'Otros clientes']);
    expect(nombres(grupos[0]!)).toEqual(['Almacén Central', 'Cooperativa Sur']);
    expect(nombres(grupos[1]!)).toEqual(['Bodega Norte', 'Distribuidora Este', 'Frigorífico Oeste']);
  });

  it('el orden dentro de cada grupo es el de la lista de clientes, NO el de las entregas', () => {
    const grupos = agruparClientes(TODOS, [FRIGO.id, COOP.id, ALMACEN.id]);
    expect(nombres(grupos[0]!)).toEqual(['Almacén Central', 'Cooperativa Sur', 'Frigorífico Oeste']);
  });

  it('sin duplicados: un cliente con varias entregas aparece UNA vez', () => {
    const grupos = agruparClientes(TODOS, [BODEGA.id, BODEGA.id, COOP.id, BODEGA.id]);
    expect(nombres(grupos[0]!)).toEqual(['Bodega Norte', 'Cooperativa Sur']);
    const ids = grupos.flatMap((g) => g.clientes.map((c) => c.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(TODOS.length); // cada cliente exactamente una vez en total
  });

  it('un cliente no está a la vez en los dos grupos', () => {
    const grupos = agruparClientes(TODOS, [ALMACEN.id]);
    expect(nombres(grupos[0]!)).toEqual(['Almacén Central']);
    expect(nombres(grupos[1]!)).not.toContain('Almacén Central');
  });

  it('sin entregas: un solo grupo "Clientes" con todos', () => {
    const grupos = agruparClientes(TODOS, []);
    expect(grupos).toHaveLength(1);
    expect(grupos[0]!.label).toBe('Clientes');
    expect(nombres(grupos[0]!)).toEqual(nombres({ clientes: TODOS }));
  });

  it('con entregas de clientes que no están en la lista (borrados, o fuera del tope): también un solo grupo "Clientes"', () => {
    const grupos = agruparClientes(TODOS, ['a0000000-0000-4000-8000-0000000000ff']);
    expect(grupos.map((g) => g.label)).toEqual(['Clientes']);
    expect(grupos[0]!.clientes).toHaveLength(5);
  });

  it('si todos los clientes son de entregas del viaje: un solo grupo "Clientes de este viaje" (nunca un grupo vacío)', () => {
    const grupos = agruparClientes([ALMACEN, BODEGA], [BODEGA.id, ALMACEN.id]);
    expect(grupos.map((g) => g.label)).toEqual(['Clientes de este viaje']);
    expect(nombres(grupos[0]!)).toEqual(['Almacén Central', 'Bodega Norte']);
  });

  it('sin clientes: ningún grupo', () => {
    expect(agruparClientes([], [])).toEqual([]);
    expect(agruparClientes([], [ALMACEN.id])).toEqual([]);
  });

  it('no modifica la lista que recibe', () => {
    const entrada = [...TODOS];
    agruparClientes(entrada, [COOP.id]);
    expect(entrada).toEqual(TODOS);
  });
});
