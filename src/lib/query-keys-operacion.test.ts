import { describe, expect, it } from 'vitest';

import { camionesKeys } from '@/features/camiones/camiones-keys';
import { clientesKeys } from '@/features/clientes/clientes-keys';
import { devolucionesKeys } from '@/features/devoluciones/devoluciones-keys';
import { gastosKeys } from '@/features/gastos/gastos-keys';
import { resumenKeys } from '@/features/resumen/resumen-keys';
import { viajesKeys } from '@/features/viajes/viajes-keys';
import { operacionDeQueryKey } from './errores-recientes';

// Lo que de una query key viaja en un reporte de problema (`operacion` del registro de errores recientes) es SOLO su parte
// fija. Esta prueba recorre TODAS las factories de keys del proyecto con argumentos de ejemplo (uuids, fechas y TEXTO
// LIBRE en minúsculas, que es lo que pasaría el filtro de rótulos) y compara contra una lista fija. Una key nueva (o un
// parámetro de texto libre en una posición de rótulo) rompe esta prueba en vez de filtrarse al reporte: hay que agregarla
// acá a propósito, mirando qué rótulo da.

const FACTORIES = { gastosKeys, viajesKeys, clientesKeys, camionesKeys, devolucionesKeys, resumenKeys } as const;

/** factory.función → el rótulo esperado. */
const ESPERADO: Record<string, string> = {
  'gastosKeys.all': 'gastos',
  'gastosKeys.list': 'gastos-lista',
  'gastosKeys.detail': 'gastos-detalle',
  'gastosKeys.delViaje': 'gastos-viaje',
  'gastosKeys.categorias': 'categorias-gasto',
  'viajesKeys.all': 'viajes',
  'viajesKeys.lists': 'viajes-lista',
  'viajesKeys.list': 'viajes-lista',
  'viajesKeys.recientes': 'viajes-lista',
  'viajesKeys.detail': 'viajes-detalle',
  'viajesKeys.opcion': 'viajes-opcion',
  'viajesKeys.vistas': 'viajes-vista',
  'viajesKeys.vista': 'viajes-vista',
  'viajesKeys.conteos': 'viajes-conteos-del-borrado',
  'clientesKeys.all': 'clientes',
  'clientesKeys.list': 'clientes-lista',
  'clientesKeys.vistas': 'clientes-vista',
  'clientesKeys.vista': 'clientes-vista',
  'clientesKeys.viajesDelCliente': 'clientes-vista',
  'clientesKeys.devolucionesDelCliente': 'clientes-vista',
  'clientesKeys.detail': 'clientes-detalle',
  'clientesKeys.conteos': 'clientes-conteos-del-borrado',
  'camionesKeys.all': 'camiones',
  'camionesKeys.list': 'camiones-lista',
  'camionesKeys.detail': 'camiones-detalle',
  'camionesKeys.sinCamion': 'camiones-conteo-sin-camion',
  'camionesKeys.gastosAMover': 'camiones-conteo-gastos-a-mover',
  'devolucionesKeys.all': 'devoluciones',
  'devolucionesKeys.delosViajes': 'devoluciones-viaje',
  'devolucionesKeys.delViaje': 'devoluciones-viaje',
  'devolucionesKeys.delosMeses': 'devoluciones-mes',
  'devolucionesKeys.delMes': 'devoluciones-mes',
  'devolucionesKeys.detail': 'devoluciones-detalle',
  'resumenKeys.all': 'resumen',
  'resumenKeys.gastos': 'resumen-gastos',
  'resumenKeys.mensual': 'resumen-mensual',
  'resumenKeys.combustible': 'resumen-combustible',
  'resumenKeys.viajes': 'resumen-viajes',
};

const TENANT = '7d1f0000-0000-4000-8000-000000000001';
/** Argumentos de ejemplo: los de verdad (uuids, fechas) y texto libre en minúsculas (el peor caso para el filtro). */
const MUESTRAS: ReadonlyArray<{ nombre: string; valor: unknown }> = [
  { nombre: 'uuid', valor: 'a1000000-0000-4000-8000-000000000002' },
  { nombre: 'fecha', valor: '2026-10-01' },
  { nombre: 'texto libre', valor: 'transportesejemplo' },
  { nombre: 'texto con guiones', valor: 'texto-libre' },
  { nombre: 'número', valor: 12 },
  { nombre: 'null', valor: null },
];

type Factory = Record<string, (...args: unknown[]) => unknown>;
const funciones = Object.entries(FACTORIES).flatMap(([nombre, factory]) =>
  Object.entries(factory as unknown as Factory).map(([funcion, fn]) => ({ id: `${nombre}.${funcion}`, fn })),
);

describe('operacionDeQueryKey contra TODAS las keys del proyecto', () => {
  it('cada función de cada factory está en la lista esperada (y la lista no tiene de más)', () => {
    expect(funciones.map((f) => f.id).sort()).toEqual(Object.keys(ESPERADO).sort());
  });

  it.each(funciones.map((f) => [f.id, f.fn] as const))('%s: solo su rótulo fijo, con cualquier argumento', (id, fn) => {
    for (const muestra of MUESTRAS) {
      const args = Array.from({ length: Math.max(0, fn.length - 1) }, () => muestra.valor);
      const operacion = operacionDeQueryKey(fn(TENANT, ...args));
      expect(operacion, `${id} con ${muestra.nombre}`).toBe(ESPERADO[id]);
    }
  });

  it('ninguna operación lleva el tenant, ids, fechas ni el texto libre de ejemplo', () => {
    for (const { fn } of funciones) {
      for (const muestra of MUESTRAS) {
        const args = Array.from({ length: Math.max(0, fn.length - 1) }, () => muestra.valor);
        const operacion = operacionDeQueryKey(fn(TENANT, ...args)) ?? '';
        expect(operacion).not.toMatch(/7d1f0000|a1000000|2026|transportesejemplo|texto-libre/);
      }
    }
  });
});
